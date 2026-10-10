import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import solc from "solc";
import { encodeAbiParameters, encodeFunctionData, keccak256, toHex } from "viem";
import { simulateKeelPublicationBeforeFunding } from "../packages/sdk/dist/publication-preflight.js";

// Official Geth v1.17.8, commit a579077007b98217c3e253a66e4b452ca0c32b96.
// Pull explicitly before running. The test itself cannot download an image.
const image = "ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd";
const forkImage = "ghcr.io/foundry-rs/foundry@sha256:32c8ea9ef052a440cb1620175987a3f49eff8b068a0c6a3d09ebf7f5f9a0e043";
const fixtureRoot = fileURLToPath(new URL("../tests/fixtures/native-geth-publication/", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "keel-native-publication-"));
const container = `keel-native-publication-${process.pid}`;
const containerUser = `${process.getuid()}:${process.getgid()}`;
const owner = `0x${"11".repeat(20)}`, reader = `0x${"22".repeat(20)}`;
const expectedTokenURI = 'data:application/json,{"name":"Synthetic state sequence"}';
const selectedGasLimit = 200_000_000n;
const evidence = { schema: "keel-native-geth-publication-test@1", image, synthetic: true,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
  network: "none", productionStateUsed: false, signing: "not-performed", submission: "not-performed", checks: [] };
let started = false;
let forkStarted = false;
const forkContainer = `${container}-fork`;
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
const record = (name, details = {}) => { evidence.checks.push({ name, ...details }); console.log(`PASS ${name}`); };
const source = readFileSync(join(fixtureRoot, "StateSequence.sol"), "utf8");
const compiled = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "StateSequence.sol": { content: source } },
  settings: { evmVersion: "osaka", optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } } } })));
assert.deepEqual((compiled.errors ?? []).filter(error => error.severity === "error"), []);
const artifact = compiled.contracts["StateSequence.sol"].StateSequence;
const runtime = `0x${artifact.evm.deployedBytecode.object}`;
const genesis = JSON.parse(readFileSync(join(fixtureRoot, "genesis.json"), "utf8"));
genesis.alloc[reader.slice(2)] = { balance: "0x0", code: runtime };
writeFileSync(join(temporary, "genesis.json"), JSON.stringify(genesis));
const calldata = (name, args = []) => encodeFunctionData({ abi: artifact.abi, functionName: name, args });
const calls = [0, 1, 2, 3, 4].map(nonce => ({ from: owner, to: reader, data: calldata("write", [100n]),
  value: "0x0", gas: toHex(16_000_000n), nonce: toHex(nonce), gasPrice: "0x30" }));
const allowedMethods = new Set(["web3_clientVersion", "eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionCount", "eth_getCode", "eth_call", "eth_simulateV1"]);
function rpc(method, params, port = 8545) {
  assert.ok(allowedMethods.has(method), `Unexpected RPC method: ${method}`);
  writeFileSync(join(temporary, "request.json"), JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
  // The only network access is loopback inside a --network none container.
  const response = JSON.parse(docker("exec", container, "wget", "-Y", "off", "-q", "-O", "-", "--header=Content-Type: application/json",
    "--post-file=/fixture/request.json", `http://127.0.0.1:${port}`));
  if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.result;
}
async function start(budget) {
  if (started) { docker("rm", "-f", container); started = false; }
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
try {
  docker("image", "inspect", image);
  docker("run", "--pull=never", "--rm", "--network", "none", "--user", containerUser, "-v", `${temporary}:/fixture`, image, "--datadir", "/fixture/data", "init", "/fixture/genesis.json");
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
  assert.equal(BigInt(rpc("eth_call", [{ to: reader, data: calldata("read") }, "0x0"])), 0n);
  assert.equal(rpc("eth_getTransactionCount", [owner, "0x0"]), "0x0");
  assert.equal(rpc("eth_getBlockByNumber", ["latest", false]).hash, base.hash);
  record("all simulations leave canonical state, nonce and block unchanged");
  if (process.env.KEEL_NATIVE_FORK_COMPARISON === "1") {
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
} finally {
  if (forkStarted) docker("rm", "-f", forkContainer);
  if (started) docker("rm", "-f", container);
  rmSync(temporary, { recursive: true, force: true });
}
