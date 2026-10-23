import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import solc from "solc";
import { encodeAbiParameters, encodeFunctionData, keccak256, toHex } from "viem";
import { simulateKeelPublicationBeforeFunding } from "../packages/sdk/dist/publication-preflight.js";
import { createKeelPublicSepoliaSimulationPool } from "../packages/sdk/dist/public-simulation-pool.js";
import { createNativeGethRuntime } from "./lib/native-geth-runtime.mjs";
import { measureNativeFixtureRequestCapacity } from "./lib/native-geth-capacity-fixture.mjs";

// Official Geth v1.17.8, commit a579077007b98217c3e253a66e4b452ca0c32b96.
// Pull explicitly before running. The test itself cannot download an image.
const image = "ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd";
const forkImage = "ghcr.io/foundry-rs/foundry@sha256:32c8ea9ef052a440cb1620175987a3f49eff8b068a0c6a3d09ebf7f5f9a0e043";
const fixtureRoot = fileURLToPath(new URL("../tests/fixtures/native-geth-publication/", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "keel-native-publication-"));
const container = `keel-native-publication-${process.pid}`;
const containerUser = `${process.getuid()}:${process.getgid()}`;
// Optional cloud fallback when the existing Docker data filesystem is full.
// The separately reviewed runtime bundle contains the byte-verified image
// binary plus a fresh user/network-namespace launcher and bounded IPC helper.
const nativeRuntime = process.env.KEEL_NATIVE_GETH_RUNTIME_DIR;
const nativeEngine = nativeRuntime ? createNativeGethRuntime({ runtimeDirectory: nativeRuntime,
  dataDirectory: join(temporary, "data"), ipcPath: join(temporary, "geth.ipc"), logPath: join(temporary, "geth.log") }) : undefined;
const owner = `0x${"11".repeat(20)}`, reader = `0x${"22".repeat(20)}`;
const expectedTokenURI = 'data:application/json,{"name":"Synthetic state sequence"}';
const selectedGasLimit = 200_000_000n;
const syntheticClock = Date.parse("2026-10-11T12:00:00Z");
const actualDateNow = Date.now;
const clockStarted = performance.now();
const evidence = { schema: "keel-native-geth-publication-test@1", image, synthetic: true,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
  testedFileSha256: Object.fromEntries(["scripts/verify-native-geth-publication.mjs", "scripts/lib/native-geth-runtime.mjs", "scripts/lib/native-geth-capacity-fixture.mjs", "packages/sdk/dist/rpc.js",
    "packages/sdk/dist/publication-preflight.js", "packages/sdk/dist/public-simulation-pool.js", "packages/sdk/dist/simulation-connection.js",
    "packages/sdk/dist/transaction-gas-policy.js"]
    .map(path => [path, createHash("sha256").update(readFileSync(join(repositoryRoot, path))).digest("hex")])),
  network: "none", productionStateUsed: false, signing: "not-performed", submission: "not-performed", checks: [] };
let started = false;
let forkStarted = false;
const forkContainer = `${container}-fork`;
if (nativeEngine) {
  evidence.executionEngine = nativeEngine.evidence.executionEngine;
  evidence.nativeRuntime = nativeEngine.evidence;
} else evidence.executionEngine = "docker-network-none";
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
const record = (name, details = {}) => { evidence.checks.push({ name, ...details }); console.log(`PASS ${name}`); };
const source = readFileSync(join(fixtureRoot, "StateSequence.sol"), "utf8");
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "StateSequence.sol": { content: source } },
  settings: { evmVersion: "osaka", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } } } })));
assert.deepEqual((compiled.errors ?? []).filter(error => error.severity === "error"), []);
const artifact = compiled.contracts["StateSequence.sol"].StateSequence;
const runtime = `0x${artifact.evm.deployedBytecode.object}`;
const genesis = JSON.parse(readFileSync(join(fixtureRoot, "genesis.json"), "utf8"));
// The pool checks head freshness against Date.now. Keep both clocks fixed after
// Amsterdam activation; this is not a real Sepolia block or a head override.
genesis.timestamp = toHex(BigInt(syntheticClock / 1000));
// Only synthetic genesis funding: the shared pool's public zero-address probe
// must prove strict nonce/fee validation without any per-request state override.
genesis.alloc["0".repeat(40)] = { balance: genesis.alloc[owner.slice(2)].balance };
genesis.alloc[reader.slice(2)] = { balance: "0x0", code: runtime };
writeFileSync(join(temporary, "genesis.json"), JSON.stringify(genesis));
const calldata = (name, args = []) => encodeFunctionData({ abi: artifact.abi, functionName: name, args });
const calls = [0, 1, 2, 3, 4].map(nonce => ({ from: owner, to: reader, data: calldata("write", [100n]),
  value: "0x0", gas: toHex(16_000_000n), nonce: toHex(nonce), gasPrice: "0x30" }));
const allowedMethods = new Set(["web3_clientVersion", "eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionCount", "eth_getBalance", "eth_getCode", "eth_call", "eth_simulateV1"]);
function rpc(method, params, port = 8545) {
  assert.ok(allowedMethods.has(method), `Unexpected RPC method: ${method}`);
  const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  writeFileSync(join(temporary, "request.json"), request);
  // The only network access is loopback inside a --network none container.
  const response = nativeEngine ? nativeEngine.rawRequest(method, params)
    : JSON.parse(docker("exec", container, "wget", "-Y", "off", "-q", "-O", "-", "--header=Content-Type: application/json",
      "--post-file=/fixture/request.json", `http://127.0.0.1:${port}`));
  if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
  return response.result;
}
async function stop() {
  if (!started) return;
  if (nativeEngine) await nativeEngine.stop();
  else docker("rm", "-f", container);
  started = false;
}
async function start(budget) {
  await stop();
  if (nativeEngine) { await nativeEngine.start(budget); started = true; return; }
  docker("run", "--pull=never", "-d", "--name", container, "--network", "none", "--user", containerUser, "--memory", "768m", "--cpus", "2", "-v", `${temporary}:/fixture`, image,
    "--datadir", "/fixture/data", "--networkid", "31337", "--syncmode", "full", "--nodiscover", "--maxpeers", "0", "--cache", "64", "--ipcdisable",
    "--http", "--http.addr", "127.0.0.1", "--http.vhosts", "localhost", "--http.api", "eth,net,web3", "--rpc.gascap", String(budget), "--rpc.evmtimeout", "30s", "--rpc.http-body-limit", "16");
  started = true;
  for (let attempt = 0; ; attempt++) {
    try { rpc("eth_chainId", []); break; } catch (error) { if (attempt >= 40) throw error; await delay(100); }
  }
  assert.equal(JSON.parse(docker("inspect", container))[0].HostConfig.NetworkMode, "none");
}
const simulate = planned => rpc("eth_simulateV1", [{ blockStateCalls: planned.map(call => ({ calls: [call] })), validation: true, traceTransfers: false, returnFullTransactions: true }, "0x0"]);
const summary = blocks => blocks.map(block => ({ number: block.number, gas: BigInt(block.transactions[0].gas).toString(), gasUsed: BigInt(block.calls[0].gasUsed).toString(),
  maxUsedGas: BigInt(block.calls[0].maxUsedGas).toString(), status: block.calls[0].status, returnData: block.calls[0].returnData }));
const plan = { planFingerprint: `0x${"aa".repeat(32)}`, chainId: 11155111, blockNumber: 0n, reader, readerRuntimeCodeHash: keccak256(runtime),
  preparationCalls: calls.map(call => ({ ...call, gas: toHex(selectedGasLimit) })),
  assertions: calls.map((_, index) => ({ callIndex: index, returnData: encodeAbiParameters([{ type: "uint256" }], [BigInt((index + 1) * 100)]) })),
  requiredReaderCalls: [{ call: { from: owner, to: reader, data: calldata("read"), value: "0x0", gas: toHex(1_000_000n) },
    expectedReturn: encodeAbiParameters([{ type: "uint256" }], [500n]), gasMargin: 10_000n }],
  metadataCall: { from: owner, to: reader, data: calldata("tokenURI", [1n]), value: "0x0", gas: toHex(1_000_000n) },
  expectedTokenURI, maximumTokenUriBytes: 2_000_000, maximumReadGas: 1_000_000n, collectionOverheadGas: 10_000n, maximumTransactionGas: selectedGasLimit };
const transport = { request: async ({ method, params }) => rpc(method, params) };
const syntheticEndpoints = ["https://approved-a.native.invalid", "https://approved-b.native.invalid"];
function nativePool(base, { endpoints = syntheticEndpoints, approved = endpoints, beforeNative, measuredRequestCapacity } = {}) {
  if (measuredRequestCapacity) assert.equal(measuredRequestCapacity.evidence.blockHash, base.hash, "Measured capacity belongs to this exact synthetic snapshot");
  const requests = [];
  const pool = createKeelPublicSepoliaSimulationPool({ rpcUrls: endpoints, approvedProjectRpcUrls: approved,
    readTransport: transport, block: { number: 0n, hash: base.hash }, minIntervalMs: 0,
    ...(measuredRequestCapacity ? { providerCapabilities: endpoints.map(rpcUrl => ({ chainId: 11155111, rpcUrl,
      measuredAt: measuredRequestCapacity.measuredAt, limits: { requestGasCap: measuredRequestCapacity.requestGasCap } })) } : {}),
    fetchImpl: async (url, init) => {
      assert.ok(endpoints.includes(url), "Only synthetic endpoint labels may reach the local adapter");
      assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
      const body = JSON.parse(init.body);
      const project = body.method === "eth_simulateV1" && body.params[0].blockStateCalls.some(block =>
        block.calls.some(call => call.data !== "0x" || call.from?.toLowerCase() === owner));
      const entry = { endpoint: url, method: body.method, params: structuredClone(body.params), project };
      requests.push(entry);
      // Fault hooks may only inject failure/delay. Every successful JSON-RPC
      // envelope and result below comes unchanged from the isolated real Geth.
      const interrupted = await beforeNative?.(entry);
      if (interrupted !== undefined) {
        assert.ok(interrupted instanceof Response && !interrupted.ok, "Fault hooks cannot fabricate a successful response");
        entry.httpStatus = interrupted.status;
        return interrupted;
      }
      try {
        const result = rpc(body.method, body.params);
        entry.result = result;
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      } catch (error) {
        assert.equal(typeof error.code, "number", "A Docker/adapter failure must not become an invented RPC rejection");
        entry.rpcCode = error.code;
        return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: error.code, message: error.message,
          ...(error.data === undefined ? {} : { data: error.data }) } });
      }
    },
  });
  return { pool, requests };
}
const projectRequests = fixture => fixture.requests.filter(request => request.project);
const poolProof = async (fixture, input = plan) => {
  try { return await simulateKeelPublicationBeforeFunding(input, fixture.pool); }
  finally { await fixture.pool.close(); }
};
function assertNativePoolProof(fixture, proof, expected = plan) {
  const projects = projectRequests(fixture).filter(request => request.result !== undefined);
  assert.equal(proof.state, "ephemeral-simulation");
  assert.equal(proof.signing, "not-performed"); assert.equal(proof.submission, "not-performed");
  assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(expected.expectedTokenURI));
  assert.equal(proof.validatedTransactionCalls, expected.preparationCalls.length);
  assert.deepEqual(projects.map(request => request.params[0].validation), [false, true, false]);
  // Amsterdam discovery preserves the original fee-bound calls. Only the
  // measured gas envelopes may change for strict validation and reader replay.
  assert.deepEqual(projects[0].params[0].blockStateCalls.map(block => block.calls[0]), expected.preparationCalls);
  assert.deepEqual(projects[1].params[0].blockStateCalls.map(({ calls: [call] }) => { const { gas, ...rest } = call; return rest; }),
    expected.preparationCalls.map(({ gas, ...call }) => call));
  assert.deepEqual(projects[1].params[0].blockStateCalls, projects[2].params[0].blockStateCalls.slice(0, expected.preparationCalls.length));
  for (const request of projects) {
    assert.equal(request.params[1], "0x0");
    assert.deepEqual(request.result.map(block => block.calls[0].status), request.result.map(() => "0x1"));
    assert.deepEqual(request.result.map(block => block.transactions[0].gas), request.params[0].blockStateCalls.map(block => block.calls[0].gas));
  }
  const fullReturn = projects.at(-1).result.at(-1).calls[0].returnData;
  assert.equal(fullReturn, encodeAbiParameters([{ type: "string" }], [expected.expectedTokenURI]));
  return { phases: projects.map(request => ({ endpoint: request.endpoint, validation: request.params[0].validation,
    blocks: request.params[0].blockStateCalls.length })), fullReturnHash: keccak256(fullReturn),
    completeTokenUriBytes: proof.completeTokenUriBytes, transactionGasUsed: proof.transactionGasUsed,
    simulationFingerprint: proof.simulationFingerprint };
}
try {
  Date.now = () => syntheticClock + Math.floor(performance.now() - clockStarted);
  evidence.syntheticClock = new Date(syntheticClock).toISOString();
  evidence.clockAdvancement = "elapsed-monotonic-time";
  evidence.syntheticFundedProbe = `0x${"0".repeat(40)}`;
  if (nativeEngine) nativeEngine.init(join(temporary, "genesis.json"));
  else {
    docker("image", "inspect", image);
    docker("run", "--pull=never", "--rm", "--network", "none", "--user", containerUser, "-v", `${temporary}:/fixture`, image, "--datadir", "/fixture/data", "init", "/fixture/genesis.json");
  }
  await start(50_000_000);
  evidence.clientVersion = rpc("web3_clientVersion", []);
  evidence.compiler = solc.version();
  const base = rpc("eth_getBlockByNumber", ["0x0", false]);
  evidence.syntheticBlockHash = base.hash;
  assert.equal(BigInt(base.gasLimit), selectedGasLimit);
  const limited = simulate(calls);
  assert.deepEqual(limited.map(block => block.calls[0].status), ["0x1", "0x1", "0x1", "0x1", "0x0"]);
  assert.ok(BigInt(limited[4].transactions[0].gas) < BigInt(calls[4].gas));
  assert.match(limited[4].calls[0].error.message, /global gas cap/);
  record("50M budget exhausts across blocks despite each requested transaction being 16M", { blocks: summary(limited) });
  await assert.rejects(simulateKeelPublicationBeforeFunding(plan, transport), error => error.kind === "provider-limit");
  record("SDK refuses a provider-clamped 200M discovery envelope");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...plan, preparationCalls: calls }, transport), error => error.kind === "provider-limit");
  record("SDK also refuses aggregate exhaustion when each discovery envelope is only 16M");
  const emptySequence = simulate(Array.from({ length: 14 }, (_, i) => ({ ...calls[0], to: owner, data: "0x", nonce: toHex(i), gas: toHex(49_976_000n) })));
  assert.ok(emptySequence.every(block => BigInt(block.calls[0].gasUsed) === 12_000n));
  assert.equal(BigInt(emptySequence[3].transactions[0].gas), 49_964_000n);
  record("native shared budget reproduces the 12000-gas public-probe decrement", { blocks: summary(emptySequence) });
  const smallPlan = { ...plan, discoveryGasPolicy: "provider-capacity",
    preparationCalls: Array.from({ length: 14 }, (_, i) => ({ ...plan.preparationCalls[0], data: calldata("write", [1n]), nonce: toHex(i) })),
    assertions: Array.from({ length: 14 }, (_, i) => ({ callIndex: i, returnData: encodeAbiParameters([{ type: "uint256" }], [BigInt(i + 1)]) })),
    requiredReaderCalls: [{ ...plan.requiredReaderCalls[0], expectedReturn: encodeAbiParameters([{ type: "uint256" }], [14n]) }],
    metadataCall: { ...plan.metadataCall, data: calldata("tokenURIForCount", [14n]) },
  };
  const smallBefore = structuredClone(smallPlan);
  await assert.rejects(simulateKeelPublicationBeforeFunding(smallPlan, transport), error =>
    error.kind === "provider-limit" && error.diagnostic?.stage === "discovery-capacity-scope");
  assert.deepEqual(smallPlan, smallBefore);
  record("unscoped later project remainder cannot authorize whole-request discovery allocation");
  const measuredRequestCapacity = await measureNativeFixtureRequestCapacity({ rpc, configuredGasCap: 50_000_000n,
    block: base, account: owner, gasPrice: calls[0].gasPrice });
  record("controlled 50M request cap is corroborated by real public empty-call envelopes and strict nonce rejection", measuredRequestCapacity.evidence);
  const smallFixture = nativePool(base, { endpoints: [syntheticEndpoints[0]], measuredRequestCapacity });
  const smallProof = await poolProof(smallFixture, smallPlan);
  const smallRequests = projectRequests(smallFixture).map(request => request.params);
  assert.deepEqual(smallPlan, smallBefore);
  assert.equal(smallProof.validatedTransactionCalls, 14);
  assert.equal(smallProof.completeTokenUriBytes, Buffer.byteLength(expectedTokenURI));
  assert.equal(smallProof.discoveryGas.capacityAttempts.length, 1);
  assert.equal(smallProof.discoveryGas.capacityAttempts[0].programGasBudget, "50000000");
  assert.deepEqual(smallRequests.map(([program]) => program.validation), [false, true, false]);
  const smallStrict = smallRequests.find(([program]) => program.validation);
  assert.ok(smallStrict);
  assert.deepEqual(smallRequests.at(-1)[0].blockStateCalls.slice(0, 14), smallStrict[0].blockStateCalls);
  assert.ok(smallProof.transactionGasLimits.every((gas, i) => BigInt(gas) > BigInt(smallProof.transactionGasUsed[i])));
  record("14-call shared-budget discovery fully replays strict state and exact metadata without reducing measured margins", {
    capacityAttempts: smallProof.discoveryGas.capacityAttempts, transactionGasLimits: smallProof.transactionGasLimits,
    transactionGasUsed: smallProof.transactionGasUsed, completeTokenUriBytes: smallProof.completeTokenUriBytes,
    phases: smallRequests.map(([program]) => ({ validation: program.validation, blocks: program.blockStateCalls.length })),
  });
  // A valid ABI call with synthetic zero padding has a calldata floor above
  // cap/N. Reserve that floor before allocating the remaining discovery gas.
  const paddedData = calldata("write", [1n]).padEnd(2 + 69_316 * 2, "0");
  const paddedPlan = { ...smallPlan, preparationCalls: smallPlan.preparationCalls.map((call, index) =>
    index === 0 ? { ...call, data: paddedData } : call) };
  const paddedBefore = structuredClone(paddedPlan), paddedPool = nativePool(base, { endpoints: [syntheticEndpoints[0]], measuredRequestCapacity });
  const paddedProof = await poolProof(paddedPool, paddedPlan);
  assert.deepEqual(paddedPlan, paddedBefore);
  assert.equal(paddedProof.completeTokenUriBytes, Buffer.byteLength(expectedTokenURI));
  assert.ok(BigInt(paddedProof.discoveryGas.effectiveGasLimits[0]) >= 4_451_224n);
  assert.ok(BigInt(paddedProof.transactionGasUsed[0]) >= 4_451_224n);
  const paddedProjects = projectRequests(paddedPool);
  assert.equal(paddedProjects.length, 3);
  assert.equal(paddedProjects[0].params[0].blockStateCalls[0].calls[0].data, paddedData);
  assert.deepEqual(paddedProjects[2].params[0].blockStateCalls.slice(0, 14), paddedProjects[1].params[0].blockStateCalls);
  assert.equal(paddedProjects[2].result.at(-1).calls[0].returnData, encodeAbiParameters([{ type: "string" }], [expectedTokenURI]));
  record("unequal calldata floors retain exact native calls through shared-pool discovery, strict replay and complete metadata", {
    calldataBytes: 69_316, minimumCallGas: "4451224", effectiveGasLimits: paddedProof.discoveryGas.effectiveGasLimits,
    transactionGasUsed: paddedProof.transactionGasUsed, capacityAttempts: paddedProof.discoveryGas.capacityAttempts,
  });
  const impossiblePlan = { ...smallPlan, preparationCalls: Array.from({ length: 45 }, (_, index) =>
    ({ ...smallPlan.preparationCalls[0], data: paddedData, nonce: toHex(index) })), assertions: [],
    requiredReaderCalls: [{ ...smallPlan.requiredReaderCalls[0], expectedReturn: encodeAbiParameters([{ type: "uint256" }], [45n]) }],
    metadataCall: { ...smallPlan.metadataCall, data: calldata("tokenURIForCount", [45n]) } };
  const impossibleBefore = structuredClone(impossiblePlan), impossiblePool = nativePool(base, { endpoints: [syntheticEndpoints[0]], measuredRequestCapacity });
  let impossibleDiagnostic;
  await assert.rejects(poolProof(impossiblePool, impossiblePlan), error => {
    assert.equal(error.kind, "provider-limit"); assert.equal(error.diagnostic.stage, "discovery-minimum");
    assert.equal(error.diagnostic.minimumProgramGas, "200305080");
    assert.equal(error.diagnostic.providerGasCap, "50000000");
    impossibleDiagnostic = error.diagnostic; return true;
  });
  assert.deepEqual(impossiblePlan, impossibleBefore);
  assert.equal(projectRequests(impossiblePool).length, 0);
  record("native numeric capacity evidence rejects impossible aggregate calldata minima before any private project request", {
    syntheticCalls: 45, minimumProgramGas: impossibleDiagnostic.minimumProgramGas,
    observedProviderGasCap: impossibleDiagnostic.providerGasCap, projectRequests: 0,
  });
  // Uneven synthetic state writes reproduce a carrier-style allocation
  // boundary without including any creator payload or project state.
  const unevenCounts = Array.from({ length: 14 }, (_, i) => i === 2 ? 60n : 1n);
  let unevenTotal = 0n;
  const unevenPlan = { ...smallPlan,
    preparationCalls: smallPlan.preparationCalls.map((call, i) => ({ ...call, data: calldata("write", [unevenCounts[i]]) })),
    assertions: unevenCounts.map((count, callIndex) => ({ callIndex, returnData: encodeAbiParameters([{ type: "uint256" }], [unevenTotal += count]) })),
    requiredReaderCalls: [{ ...smallPlan.requiredReaderCalls[0], expectedReturn: encodeAbiParameters([{ type: "uint256" }], [73n]) }],
    metadataCall: { ...smallPlan.metadataCall, data: calldata("tokenURIForCount", [73n]) },
  };
  const unevenBefore = structuredClone(unevenPlan);
  const unevenFixture = nativePool(base, { endpoints: [syntheticEndpoints[0]], measuredRequestCapacity });
  const unevenProof = await poolProof(unevenFixture, unevenPlan);
  const unevenRequests = projectRequests(unevenFixture).map(request => request.params);
  assert.deepEqual(unevenPlan, unevenBefore);
  assert.equal(unevenProof.discoveryGas.allocationAttempts[0].callIndex, 2);
  assert.equal(unevenProof.discoveryGas.allocationAttempts[0].strategy, "prefix-reuse");
  assert.ok(BigInt(unevenProof.transactionGasUsed[2]) > BigInt(unevenProof.discoveryGas.capacityAttempts.at(-1).perCallGasLimit));
  assert.ok(BigInt(unevenProof.transactionGasLimits[2]) > BigInt(unevenProof.transactionGasUsed[2]));
  const unevenStrict = unevenRequests.find(([program]) => program.validation);
  assert.deepEqual(unevenRequests.at(-1)[0].blockStateCalls.slice(0, 14), unevenStrict[0].blockStateCalls);
  assert.equal(unevenProof.validatedTransactionCalls, 14);
  assert.equal(unevenProof.completeTokenUriBytes, Buffer.byteLength(expectedTokenURI));
  record("uneven 14-call discovery reallocates measured prefix slack before complete strict and metadata replay", {
    allocationAttempts: unevenProof.discoveryGas.allocationAttempts,
    transactionGasLimits: unevenProof.transactionGasLimits, transactionGasUsed: unevenProof.transactionGasUsed,
    phases: unevenRequests.map(([program]) => ({ validation: program.validation, blocks: program.blockStateCalls.length })),
  });
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...plan, discoveryGasPolicy: "provider-capacity" }, transport), error => ["provider-limit", "execution-reverted"].includes(error.kind));
  record("shared-budget discovery still refuses a program whose actual execution exceeds provider capacity");
  await start(200_000_000);
  const empty = simulate([{ ...calls[0], to: owner, data: "0x", gas: toHex(selectedGasLimit) }]);
  assert.equal(BigInt(empty[0].transactions[0].gas), selectedGasLimit);
  assert.equal(empty[0].calls[0].status, "0x1");
  await assert.rejects(simulateKeelPublicationBeforeFunding(plan, transport), error => error.kind === "provider-limit");
  record("retaining one 200M empty-call envelope does not qualify the complete stateful program");
  await start(500_000_000);
  assert.equal(rpc("eth_getBlockByNumber", ["0x0", false]).hash, base.hash);
  const complete = simulate(calls);
  assert.deepEqual(complete.map(block => block.transactions[0].gas), calls.map(call => call.gas));
  assert.deepEqual(complete.map(block => block.calls[0].status), calls.map(() => "0x1"));
  assert.deepEqual(complete.map(block => BigInt(block.calls[0].returnData)), [100n, 200n, 300n, 400n, 500n]);
  const total = complete.reduce((sum, block) => sum + BigInt(block.calls[0].gasUsed), 0n);
  assert.ok(total > 50_000_000n);
  record("500M RPC budget preserves all original envelopes and carries state across blocks", { totalGasUsed: total.toString(), blocks: summary(complete), unchangedBlockGasLimit: selectedGasLimit.toString() });
  assert.throws(() => simulate([calls[1]]), /nonce too high/);
  assert.equal(BigInt(simulate([{ ...calls[1], nonce: "0x0" }])[0].calls[0].returnData), 100n);
  assert.equal(rpc("eth_getBlockByHash", [complete.at(-1).hash, false]), null);
  assert.throws(() => rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: [calls[1]] }], validation: true }, { blockHash: complete.at(-1).hash }]), /not found|unknown|invalid/i);
  record("separate requests cannot continue ephemeral state or reuse its block hash");
  const requests = [];
  const proof = await simulateKeelPublicationBeforeFunding(plan, { request: async request => {
    if (request.method === "eth_simulateV1") requests.push(request.params);
    return rpc(request.method, request.params);
  } });
  assert.equal(proof.state, "ephemeral-simulation");
  assert.equal(proof.signing, "not-performed");
  assert.equal(proof.submission, "not-performed");
  assert.equal(proof.validatedTransactionCalls, 5);
  assert.equal(proof.requiredReaderChecks, 1);
  assert.equal(proof.transactionGasPolicy.maximumTotalGas, "200000000");
  assert.equal(proof.transactionGasPolicy.maximumExecutionGas, "16777216");
  assert.deepEqual(requests.map(([program]) => program.validation), [false, true, false]);
  assert.deepEqual(requests.map(([program]) => program.blockStateCalls.length), [5, 5, 7]);
  for (const [program, tag] of requests) {
    assert.equal(tag, "0x0");
    assert.deepEqual(Object.keys(program).sort(), ["blockStateCalls", "returnFullTransactions", "traceTransfers", "validation"]);
    for (const block of program.blockStateCalls) {
      assert.deepEqual(Object.keys(block), ["calls"]);
      for (const call of block.calls) assert.ok(Object.keys(call).every(key => ["from", "to", "data", "value", "gas", "nonce", "gasPrice"].includes(key)));
    }
  }
  assert.deepEqual(requests[0][0].blockStateCalls.map(block => block.calls[0].gas), plan.preparationCalls.map(call => call.gas));
  assert.deepEqual(requests[1][0].blockStateCalls.map(block => block.calls[0]), requests[2][0].blockStateCalls.slice(0, 5).map(block => block.calls[0]));
  record("SDK completes discovery, strict replay, reader assertion and exact tokenURI without overrides", {
    phases: requests.map(([program]) => ({ validation: program.validation, blocks: program.blockStateCalls.length })),
    transactionGasLimits: proof.transactionGasLimits, transactionGasUsed: proof.transactionGasUsed,
    gasMeasurement: proof.gasMeasurement, simulationFingerprint: proof.simulationFingerprint,
  });
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...plan, expectedTokenURI: `${expectedTokenURI}wrong` }, transport), error => error.kind === "metadata-mismatch");
  record("exact metadata mismatch still blocks approval");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...plan, preparationCalls: plan.preparationCalls.map(call => ({ ...call, gasPrice: "0x0" })) }, transport), error => error.kind === "rpc-unavailable");
  record("native strict validation rejects a fee envelope below base fee");
  await assert.rejects(simulateKeelPublicationBeforeFunding({ ...plan, maximumTransactionGas: selectedGasLimit + 1n }, transport), error => error.kind === "configuration-invalid");
  record("selected-chain transaction cap remains enforced");
  const initialPool = nativePool(base);
  const initialPoolProof = await poolProof(initialPool);
  record("deployed shared pool completes real native qualification, stateful strict replay and the full metadata return",
    assertNativePoolProof(initialPool, initialPoolProof));

  let injected503 = false;
  const recovering = nativePool(base, { beforeNative: entry => {
    if (entry.project && entry.endpoint === syntheticEndpoints[0] && !injected503) {
      injected503 = true; return new Response("Synthetic transport outage", { status: 503 });
    }
  } });
  const recovered = await poolProof(recovering);
  const recoveryRequests = projectRequests(recovering);
  assert.equal(recoveryRequests.filter(request => request.endpoint === syntheticEndpoints[0]).length, 1);
  assert.equal(recoveryRequests.filter(request => request.endpoint === syntheticEndpoints[1]).length, 3);
  assert.equal(recoveryRequests[0].httpStatus, 503);
  assert.deepEqual(recoveryRequests[0].params, recoveryRequests[1].params);
  assert.ok(recovering.requests.filter(request => request.endpoint === syntheticEndpoints[1] && !request.project)
    .some(request => request.rpcCode === -38011), "Replacement must prove native strict nonce enforcement before project replay");
  record("shared pool recovers synthetic HTTP 503 by requalifying and replaying the whole unchanged program on the second approved label",
    { ...assertNativePoolProof(recovering, recovered), observedHttpStatus: recoveryRequests[0].httpStatus,
      unchangedProgramHash: keccak256(toHex(JSON.stringify(recoveryRequests[0].params))) });

  const unapproved = nativePool(base, { endpoints: [syntheticEndpoints[0]], approved: [] });
  await assert.rejects(poolProof(unapproved), error => error.kind === "configuration-invalid" && error.diagnostic?.recipientApprovalRequired === 1);
  assert.equal(projectRequests(unapproved).length, 0);
  assert.ok(unapproved.requests.some(request => request.rpcCode === -38011));
  record("native capability success never sends a project to an unapproved endpoint label");

  const reverting = nativePool(base);
  const revertingPlan = { ...plan, preparationCalls: [{ ...calls[0], data: calldata("tokenURIForCount", [1n]) }], assertions: [] };
  await assert.rejects(poolProof(reverting, revertingPlan), error => error.kind === "execution-reverted" && error.diagnostic?.callIndex === 0);
  assert.equal(projectRequests(reverting).length, 1);
  assert.equal(reverting.requests.some(request => request.endpoint === syntheticEndpoints[1]), false);
  const nativeRevert = projectRequests(reverting)[0].result[0].calls[0];
  assert.equal(nativeRevert.status, "0x0"); assert.equal(nativeRevert.error.code, 3);
  record("real EVM revert remains terminal without shopping for a passing backend", {
    rpcCode: nativeRevert.error.code, gasUsed: BigInt(nativeRevert.gasUsed).toString(), maxUsedGas: BigInt(nativeRevert.maxUsedGas).toString(),
    returnDataHash: keccak256(nativeRevert.returnData),
  });

  const mismatch = nativePool(base);
  await assert.rejects(poolProof(mismatch, { ...plan, expectedTokenURI: `${expectedTokenURI}wrong` }), error => error.kind === "metadata-mismatch");
  assert.equal(mismatch.requests.some(request => request.endpoint === syntheticEndpoints[1]), false);
  assert.equal(projectRequests(mismatch).at(-1).result.at(-1).calls[0].returnData,
    encodeAbiParameters([{ type: "string" }], [expectedTokenURI]));
  record("shared pool's real complete metadata result cannot satisfy different expected bytes");

  let releaseCancelled, reachedCancelled;
  const cancellationGate = new Promise(resolve => { releaseCancelled = resolve; });
  const cancellationReached = new Promise(resolve => { reachedCancelled = resolve; });
  const cancelled = nativePool(base, { beforeNative: async entry => {
    if (entry.project) { reachedCancelled(); await cancellationGate; }
  } });
  const cancelledRun = simulateKeelPublicationBeforeFunding(plan, cancelled.pool);
  // Attach rejection handling before closing, then allow the synthetic fetcher
  // to return a late *real* native result, which must never become a proof.
  const refusedCancellation = assert.rejects(cancelledRun, error => error.kind === "rpc-unavailable");
  await cancellationReached;
  const independent = nativePool(base);
  assertNativePoolProof(independent, await poolProof(independent));
  await cancelled.pool.close();
  releaseCancelled();
  await refusedCancellation;
  assert.equal(projectRequests(cancelled).length, 1);
  assert.equal(cancelled.requests.some(request => request.endpoint === syntheticEndpoints[1]), false);
  assert.ok(projectRequests(cancelled)[0].result, "Cancellation fixture must actually return the late native result");
  const reloaded = nativePool(base);
  record("cancellation discards late native success without poisoning an independent or reloaded saved-plan check",
    assertNativePoolProof(reloaded, await poolProof(reloaded)));

  let single503 = false;
  const singleRecipient = nativePool(base, { endpoints: [syntheticEndpoints[0]], beforeNative: entry => {
    if (entry.project && !single503) { single503 = true; return new Response("Synthetic one-recipient outage", { status: 503 }); }
  } });
  let singleProof;
  try { singleProof = await poolProof(singleRecipient); }
  catch (error) {
    const failure = { kind: error.kind, diagnostic: error.diagnostic,
      privateRequests: projectRequests(singleRecipient).length, synthetic: true, signing: "not-performed", submission: "not-performed" };
    console.error("SINGLE_RECIPIENT_503_FAILURE", JSON.stringify(failure));
    if (process.env.KEEL_NATIVE_GETH_EVIDENCE) writeFileSync(process.env.KEEL_NATIVE_GETH_EVIDENCE,
      `${JSON.stringify({ ...evidence, status: "failed", failedCheck: "single-approved-recipient-503-recovery", failure }, null, 2)}\n`);
    throw error;
  }
  const singleRequests = projectRequests(singleRecipient);
  assert.equal(singleRequests[0].httpStatus, 503);
  assert.deepEqual(singleRequests[0].params, singleRequests[1].params);
  assert.equal(singleRequests.length, 4, "Only one bounded retry may precede normal strict/read phases");
  record("a single approved recipient recovers one observed HTTP 503 automatically through complete native requalification and replay",
    assertNativePoolProof(singleRecipient, singleProof));
  const heavyPlan = { ...plan,
    preparationCalls: Array.from({ length: 200 }, (_, index) => ({ ...plan.preparationCalls[0], nonce: toHex(index) })),
    assertions: Array.from({ length: 200 }, (_, index) => ({ callIndex: index, returnData: encodeAbiParameters([{ type: "uint256" }], [BigInt((index + 1) * 100)]) })),
    requiredReaderCalls: [{ ...plan.requiredReaderCalls[0], expectedReturn: encodeAbiParameters([{ type: "uint256" }], [20_000n]) }],
    metadataCall: { ...plan.metadataCall, data: calldata("tokenURIForCount", [20_000n]) } };
  await assert.rejects(poolProof(nativePool(base), heavyPlan), error => error.kind === "configuration-invalid" && error.diagnostic?.rpcCode === -38013);
  record("200 heavy native calls reject the original over-capacity sequence without rewriting or splitting its program");
  const longPlan = { ...plan,
    preparationCalls: Array.from({ length: 200 }, (_, index) => ({ ...plan.preparationCalls[0], nonce: toHex(index), data: calldata("write", [1n]) })),
    assertions: Array.from({ length: 200 }, (_, index) => ({ callIndex: index, returnData: encodeAbiParameters([{ type: "uint256" }], [BigInt(index + 1)]) })),
    requiredReaderCalls: [{ ...plan.requiredReaderCalls[0], expectedReturn: encodeAbiParameters([{ type: "uint256" }], [200n]) }],
    metadataCall: { ...plan.metadataCall, data: calldata("tokenURIForCount", [200n]) } };
  const longFixture = nativePool(base);
  record("200 dependent native writes retain every nonce, state assertion and full metadata through discovery and strict replay",
    assertNativePoolProof(longFixture, await poolProof(longFixture, longPlan), longPlan));
  assert.equal(BigInt(rpc("eth_call", [{ to: reader, data: calldata("read") }, "0x0"])), 0n);
  assert.equal(rpc("eth_getTransactionCount", [owner, "0x0"]), "0x0");
  assert.equal(rpc("eth_getBlockByNumber", ["latest", false]).hash, base.hash);
  record("all simulations leave canonical state, nonce and block unchanged");
  if (process.env.KEEL_NATIVE_FORK_COMPARISON === "1") {
    if (nativeEngine) throw new Error("Fork comparison requires the isolated Docker fixture, not native-runtime mode.");
    docker("image", "inspect", forkImage);
    docker("run", "--pull=never", "-d", "--name", forkContainer, "--network", `container:${container}`, "--memory", "768m", "--cpus", "2",
      // Clear proxying only inside the already network-disabled synthetic fixture.
      "--env", "HTTP_PROXY=", "--env", "HTTPS_PROXY=", "--env", "ALL_PROXY=", "--env", "NO_PROXY=127.0.0.1,localhost",
      "--entrypoint", "anvil", forkImage, "--accounts", "0", "--no-mining", "--enable-tx-gas-limit", "--fork-url", "http://127.0.0.1:8545",
      "--fork-block-number", "0", "--host", "127.0.0.1", "--port", "8546");
    forkStarted = true;
    for (let attempt = 0; ; attempt++) {
      try { rpc("eth_chainId", [], 8546); break; } catch (error) { if (attempt >= 80) throw error; await delay(100); }
    }
    assert.equal(JSON.parse(docker("inspect", forkContainer))[0].HostConfig.NetworkMode, `container:${JSON.parse(docker("inspect", container))[0].Id}`);
    const forkBlock = rpc("eth_getBlockByNumber", ["0x0", false], 8546);
    assert.equal(forkBlock.hash, base.hash);
    assert.equal(forkBlock.gasLimit, base.gasLimit);
    const forkProbe = rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: [{ ...calls[0], to: owner, data: "0x", gas: toHex(selectedGasLimit) }] }], validation: true, traceTransfers: false, returnFullTransactions: true }, "0x0"], 8546);
    assert.equal(BigInt(forkProbe[0].transactions[0].gas), 50_000_000n);
    await assert.rejects(simulateKeelPublicationBeforeFunding(plan, { request: async ({ method, params }) => rpc(method, params, 8546) }), error => error.kind === "provider-limit");
    record("stock Anvil 1.8.5 fork retains the base block but caps simulation gas at 50M", { image: forkImage,
      clientVersion: rpc("web3_clientVersion", [], 8546), requestedGas: selectedGasLimit.toString(), returnedGas: "50000000", baseHashUnchanged: true, blockGasLimitUnchanged: true,
      accountsCreated: 0, mining: false, productionStateUsed: false, qualifiedForPublication: false });
  }
  if (process.env.KEEL_NATIVE_GETH_EVIDENCE) writeFileSync(process.env.KEEL_NATIVE_GETH_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ passed: evidence.checks.length, image, synthetic: true, published: false }));
} catch (error) {
  if (process.env.KEEL_NATIVE_GETH_EVIDENCE) writeFileSync(process.env.KEEL_NATIVE_GETH_EVIDENCE,
    `${JSON.stringify({ ...evidence, status: "failed", failure: { name: error.name, message: error.message,
      ...(error.kind === undefined ? {} : { kind: error.kind }), ...(error.diagnostic === undefined ? {} : { diagnostic: error.diagnostic }) } }, null, 2)}\n`);
  throw error;
} finally {
  Date.now = actualDateNow;
  if (forkStarted) docker("rm", "-f", forkContainer);
  await stop();
  rmSync(temporary, { recursive: true, force: true });
}
