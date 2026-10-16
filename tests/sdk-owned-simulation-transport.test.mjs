import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createKeelOwnedSepoliaSimulationTransport, measureKeelPublicationSimulationRequest } from "../packages/sdk/dist/owned-simulation-transport.js";

const hash = number => `0x${number.toString(16).padStart(64, "0")}`;
const block = { number: 42n, hash: hash(42) };
const gas = 200_000_000n;
const call = { from: `0x${"11".repeat(20)}`, to: `0x${"22".repeat(20)}`, data: "0x1234", value: "0x0", gas: `0x${gas.toString(16)}`, gasPrice: "0x30" };
const program = (count = 2) => ({ method: "eth_simulateV1", params: [{ blockStateCalls: Array.from({ length: count }, () => ({ calls: [{ ...call }] })), validation: true, traceTransfers: false, returnFullTransactions: true }, "0x2a"] });

async function endpoint(change = {}) {
  const received = [];
  const server = createServer(async (request, response) => {
    let text = ""; for await (const part of request) text += part;
    const body = JSON.parse(text); received.push({ text, body });
    if (change.onRequest) await change.onRequest(body);
    if (change.httpStatus) { response.writeHead(change.httpStatus, change.headers ?? {}); response.end("private-secret"); return; }
    const result = value => response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }));
    const snapshot = { number: "0x2a", hash: block.hash, timestamp: `0x${(BigInt(Math.floor(Date.now() / 1000)) - 12n).toString(16)}`, gasLimit: call.gas, baseFeePerGas: "0xf", ...change.snapshot };
    if (body.method === "eth_chainId") return result(change.chain ?? "0xaa36a7");
    if (body.method === "web3_clientVersion") return result(change.version ?? "Geth/v1.17.8-stable-a5790770/linux-amd64/go1.27.1");
    if (body.method === "eth_syncing") return result(change.syncing ?? false);
    if (body.method === "eth_getBlockByNumber") return result(body.params[0] === "0x0"
      ? { hash: change.genesis ?? "0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9" }
      : body.params[0] === "latest" ? { ...snapshot, ...change.latest } : snapshot);
    if (body.method === "eth_getTransactionCount") return result("0x0");
    if (body.method === "eth_getBalance") return result("0xc9f2c9cd04674edea40000000");
    if (body.method === "eth_getCode") return result("0x");
    if (body.method === "eth_simulateV1") {
      const planned = body.params[0].blockStateCalls;
      if (body.params[0].validation && planned.length === 1 && planned[0].calls[0].nonce === "0x1" && !change.ignoreNonce)
        return response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -38011, message: "nonce too high" } }));
      return result(planned.map(({ calls }, index) => ({ number: `0x${(43 + index).toString(16)}`, hash: hash(43 + index), parentHash: hash(42 + index),
        timestamp: `0x${(BigInt(snapshot.timestamp) + BigInt(12 * (index + 1))).toString(16)}`, blockAccessListHash: hash(90 + index),
        transactions: calls.map(item => ({ ...item, ...(change.clamp ? { gas: "0x5208" } : {}) })),
        calls: [{ status: "0x1", returnData: "0x", gasUsed: "0x5208", ...(change.omitMaximum ? {} : { maxUsedGas: "0x5208" }) }],
      })));
    }
    response.writeHead(500); response.end();
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  return { received, url, transport: limits => createKeelOwnedSepoliaSimulationTransport({ url, block, rpcGasCap: 10_000_000_000n, maximumRequestBytes: 16 * 1024 * 1024, ...limits }),
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test("exact wire sizing includes the JSON-RPC envelope and sums all call gas", () => {
  for (const count of [1, 2, 34, 36, 40, 256]) {
    const request = program(count), measured = measureKeelPublicationSimulationRequest(request);
    assert.equal(measured.conservativeGasBudget, gas * BigInt(count));
    assert.equal(measured.maximumCallGas, gas);
    assert.equal(measured.requestBytes, Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 1, ...request })));
  }
});

test("sizing rejects overrides, omitted envelopes, non-pinned tags and overflow", () => {
  for (const change of [p => { p.params[1] = "latest"; }, p => { p.params[0].blockStateCalls[0].stateOverrides = {}; },
    p => { p.params[0].blockStateCalls[0].calls[0].stateOverride = {}; }, p => { delete p.params[0].blockStateCalls[0].calls[0].gas; },
    p => { p.params[0].returnFullTransactions = false; }, p => { p.params[0].blockStateCalls[0].calls[0].gas = "0xffffffffffffffff"; }]) {
    const p = program(); change(p); assert.throws(() => measureKeelPublicationSimulationRequest(p), error => error.kind === "configuration-invalid");
  }
  assert.throws(() => measureKeelPublicationSimulationRequest(program(257)));
});

test("offline sizing reports the largest full phase without exposing calldata or malformed input", () => {
  const directory = mkdtempSync(join(tmpdir(), "keel-sizing-")), file = join(directory, "requests.json");
  const script = fileURLToPath(new URL("../scripts/size-publication-simulation.mjs", import.meta.url));
  try {
    writeFileSync(file, JSON.stringify([program(40), program(34), program(36)]));
    const text = execFileSync(process.execPath, [script, file], { encoding: "utf8" });
    const result = JSON.parse(text);
    assert.equal(result.requiredRpcGasCap, "8000000000");
    assert.equal(result.phases.length, 3);
    assert.equal(result.networkRequests, 0);
    assert.ok(!text.includes(call.data) && !text.includes(call.from));
    writeFileSync(file, '{"private-secret');
    const failed = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(failed.status, 1); assert.equal(failed.stdout, ""); assert.ok(!failed.stderr.includes("private-secret"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("under-budget, under-body-limit, wrong-block and signing calls are rejected before any network read", async () => {
  const e = await endpoint();
  try {
    const p = program(), measured = measureKeelPublicationSimulationRequest(p);
    // Pad synthetic calldata so the one-byte-under limit exceeds the minimum config size.
    p.params[0].blockStateCalls[0].calls[0].data = `0x${"ab".repeat(1200)}`;
    for (const [request, limits] of [[program(), { rpcGasCap: measured.conservativeGasBudget - 1n }],
      [p, { maximumRequestBytes: measureKeelPublicationSimulationRequest(p).requestBytes - 1 }],
      [{ ...program(), params: [program().params[0], "0x2b"] }, {}], [{ method: "eth_sendRawTransaction", params: ["0x1234"] }, {}]]) {
      const transport = e.transport(limits);
      await assert.rejects(transport.request(request)); await transport.close();
    }
    assert.equal(e.received.length, 0);
  } finally { await e.close(); }
});

test("qualified owned HTTP sends the exact admitted program, fee and gas bytes", async () => {
  const e = await endpoint(), p = program();
  const measured = measureKeelPublicationSimulationRequest(p);
  const transport = e.transport({ rpcGasCap: measured.conservativeGasBudget });
  try {
    const response = await transport.request(p);
    assert.equal(response.length, 2);
    const privateRequests = e.received.filter(({ body }) => body.method === "eth_simulateV1" && body.params[0].blockStateCalls[0].calls[0].data === "0x1234");
    assert.equal(privateRequests.length, 1);
    assert.deepEqual(privateRequests[0].body, { jsonrpc: "2.0", id: 1, ...p });
    assert.equal(Buffer.byteLength(privateRequests[0].text), measured.requestBytes);
  } finally { await transport.close(); await e.close(); }
});

for (const [name, change, kind] of [
  ["syncing", { syncing: { currentBlock: "0x1" } }, "rpc-unavailable"],
  ["stale head", { latest: { timestamp: "0x1" } }, "rpc-unavailable"],
  ["future head", { latest: { timestamp: "0xffffffffffff" } }, "rpc-unavailable"],
  ["behind selected block", { latest: { number: "0x29" } }, "rpc-unavailable"],
  ["wrong genesis", { genesis: hash(1) }, "wrong-chain"],
  ["wrong chain", { chain: "0x1" }, "wrong-chain"],
  ["unreviewed client", { version: "anvil/v1.8.5" }, "unsupported-simulation"],
  ["wrong pinned block", { snapshot: { hash: hash(1) } }, "chain-reorganized"],
  ["actual provider clamp", { clamp: true }, "provider-limit"],
  ["absent pre-refund gas", { omitMaximum: true }, "unsupported-simulation"],
  ["ignored strict nonce", { ignoreNonce: true }, "unsupported-simulation"],
]) test(`${name} blocks private calldata before execution`, async () => {
  const e = await endpoint(change), transport = e.transport();
  try {
    await assert.rejects(transport.request(program()), error => error.kind === kind);
    assert.ok(e.received.every(({ body }) => body.method !== "eth_simulateV1" || body.params[0].blockStateCalls.every(block => block.calls.every(call => call.data === "0x"))));
  } finally { await transport.close(); await e.close(); }
});

test("unavailable endpoint and redirect cannot send the plan to another recipient", async () => {
  const other = await endpoint();
  for (const change of [{ httpStatus: 503 }, { httpStatus: 307, headers: { location: other.url } }]) {
    const e = await endpoint(change), transport = e.transport();
    try {
      await assert.rejects(transport.request(program()), error => error.kind === "rpc-unavailable" && !error.message.includes("private-secret"));
      assert.equal(other.received.length, 0);
      assert.ok(e.received.every(({ body }) => body.method !== "eth_simulateV1"));
    } finally { await transport.close(); await e.close(); }
  }
  await other.close();
});

test("cancel aborts an active check and releases capacity for a fresh attempt", async () => {
  let started; const start = new Promise(resolve => { started = resolve; });
  let release; const hold = new Promise(resolve => { release = resolve; });
  let held = false;
  const e = await endpoint({ onRequest: async body => {
    if (!held && body.method === "eth_simulateV1" && body.params[0].blockStateCalls[0].calls[0].data === "0x1234") { held = true; started(); await hold; }
  } });
  const first = e.transport();
  try {
    const pending = first.request(program());
    const rejection = assert.rejects(pending, error => error.kind === "rpc-unavailable");
    await start;
    const competing = e.transport();
    try { await assert.rejects(competing.request(program()), error => error.kind === "rpc-unavailable"); }
    finally { await competing.close(); }
    await first.close(); await rejection; release();
    const fresh = e.transport();
    try { assert.equal((await fresh.request(program())).length, 2); } finally { await fresh.close(); }
  } finally { release(); await first.close(); await e.close(); }
});

test("readiness is rechecked for later phases and configuration is snapshotted", async () => {
  const change = {}, e = await endpoint(change);
  const config = { url: e.url, block: { ...block }, rpcGasCap: 400_000_000n, maximumRequestBytes: 16 * 1024 * 1024 };
  const transport = createKeelOwnedSepoliaSimulationTransport(config);
  try {
    config.block.hash = hash(99); config.rpcGasCap = 1n;
    await transport.request(program());
    const count = e.received.length; change.syncing = {};
    await assert.rejects(transport.request(program()), error => error.kind === "rpc-unavailable");
    assert.ok(e.received.slice(count).every(({ body }) => body.method !== "eth_simulateV1"));
  } finally { await transport.close(); await e.close(); }
});
