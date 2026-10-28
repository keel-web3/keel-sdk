import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createMcpServer } from "../packages/mcp/dist/index.js";

test("keel-send-window-plan gives a compiled publication's next calls their nonces and simulated gas", async () => {
  const root = await mkdtemp("/tmp/keel-send-window-"), previous = { fetch: globalThis.fetch, rpc: process.env.KEEL_RPC_URL };
  try {
    process.env.KEEL_RPC_URL = "https://rpc.example/";
    const to = "0x" + "2".repeat(40), from = "0x" + "1".repeat(40);
    await writeFile(root + "/steps.json", JSON.stringify({ steps: Array.from({ length: 5 }, (_, i) => ({ id: `upload:${i}`, call: { from, to, data: "0x0" + i, value: "0x0" } })) }));
    const methods = [];
    globalThis.fetch = async (url, request) => {
      const body = JSON.parse(request.body); methods.push(body.method);
      assert.ok(!/send/u.test(body.method));
      const result = body.method === "eth_chainId" ? "0xaa36a7" : body.method === "eth_blockNumber" ? "0x100"
        : body.method === "eth_getBlockByNumber" ? { number: "0x100", hash: "0x" + "a".repeat(64), timestamp: "0x6ad00000", gasLimit: "0xbebc200" }
        : body.method === "eth_getTransactionCount" ? "0x9"
        : body.method === "eth_simulateV1" ? body.params[0].blockStateCalls.map(() => ({ calls: [{ status: "0x1", gasUsed: "0x989680" }] })) : null;
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    };
    const server = await createMcpServer({ workspaceRoot: root, pluginConfig: false });
    await server.handle({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "send-window-test", version: "1" } } });
    const r = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "keel-send-window-plan", arguments: { chainId: 11155111, from, callsPath: "steps.json", startIndex: 1, out: "window.json" } } })).result;
    assert.equal(r.isError, undefined, JSON.stringify(r));
    const w = r.structuredContent;
    assert.equal(w.schema, "keel-send-window@1");
    assert.deepEqual(w.calls.map(c => [c.index, c.nonce, c.gas]), [[1, "0x9", "0xc65d40"], [2, "0xa", "0xc65d40"], [3, "0xb", "0xc65d40"], [4, "0xc", "0xc65d40"]]);
    assert.equal(w.nextIndex, 5); assert.equal(w.remaining, 0); assert.equal(w.gasPolicy, "sepolia-amsterdam");
    assert.equal(w.signing, "not-performed");
    assert.ok(methods.includes("eth_simulateV1"));
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.rpc === undefined) delete process.env.KEEL_RPC_URL; else process.env.KEEL_RPC_URL = previous.rpc;
    await rm(root, { recursive: true, force: true });
  }
});
