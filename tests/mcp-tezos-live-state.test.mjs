import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMcpServer } from "../packages/mcp/dist/index.js";
import { keelTezosScriptExpr, runKeelTezosLiveStateFragment } from "../packages/sdk/dist/index.js";

const initialize = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tezos-live-state-test", version: "1" } };
const network = "NetXynUjJNZm7wi";
// Octez mockup address (never a live deployment).
const cart = "KT1BCTYMUJ1LoQhzpCDS6oevoHAHQ7sLu8Wb";

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "keel-tezos-live-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await createMcpServer({ workspaceRoot: dir });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initialize });
  let id = 2;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  return { server, call };
}

/** A loopback Octez-shaped RPC: chain id, head header, the contract script and one big_map value. */
async function loopbackRpc(t, generation) {
  const expr = keelTezosScriptExpr("nat", 7);
  const code = [
    { prim: "parameter", args: [{ prim: "unit" }] },
    { prim: "storage", args: [{ prim: "pair", args: [{ prim: "address", annots: ["%fa2"] }, { prim: "big_map", args: [{ prim: "nat" }, { prim: "nat" }], annots: ["%generation_count"] }] }] },
    { prim: "code", args: [[]] },
  ];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const send = (value, status = 200) => { response.writeHead(status, { "content-type": "application/json" }); response.end(value === undefined ? "" : JSON.stringify(value)); };
      const url = request.url ?? "";
      if (url === "/chains/main/chain_id") return send(network);
      if (url.endsWith("/header")) return send({ level: 50 });
      if (url.endsWith(`/context/contracts/${cart}/script`)) return send({ code, storage: { prim: "Pair", args: [{ string: cart }, { int: "17" }] } });
      if (url.endsWith(`/context/big_maps/17/${expr}/normalized`) && request.method === "POST" && JSON.parse(body).unparsing_mode === "Readable") return send({ int: String(generation.value) });
      return send({ error: "not found" }, 404);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const READ = { name: "generation", kind: "big_map", contract: cart, bigMap: "generation_count", key: { type: "nat", value: 7 }, value: "nat", absent: 0 };

test("keel-tezos-live-state-prepare is listed with a review-only description", async (t) => {
  const { server } = await fixture(t);
  const listed = await server.handle({ jsonrpc: "2.0", id: 9, method: "tools/list", params: {} });
  const tool = listed.result.tools.find((item) => item.name === "keel-tezos-live-state-prepare");
  assert.ok(tool);
  assert.match(tool.description, /without rewriting token_metadata/u);
  assert.match(tool.description, /no signing/iu);
  assert.deepEqual(tool.inputSchema.required, ["network", "reads", "rpcUrls"]);
});

test("reads the snapshot over a loopback RPC, then the fragment follows the chain", async (t) => {
  const { call } = await fixture(t);
  const generation = { value: 2 };
  const rpcUrl = await loopbackRpc(t, generation);
  const result = await call("keel-tezos-live-state-prepare", { network, reads: [READ], rpcUrl, rpcUrls: [rpcUrl], allowLoopbackEndpoints: true, autoRefresh: false });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const prepared = result.structuredContent;
  assert.equal(prepared.snapshot.level, 50);
  assert.deepEqual(prepared.snapshot.values, { generation: 2 });
  assert.equal(prepared.reads[0].bigMapId, "17");
  assert.equal(prepared.reads[0].scriptExpr, keelTezosScriptExpr("nat", 7));
  assert.equal(prepared.typeChecks[0].checked, true);
  assert.equal(prepared.signing, "not-performed");
  generation.value = 3;
  const api = runKeelTezosLiveStateFragment(prepared.fragment, { fetch });
  assert.equal(api.values.generation, 2);
  assert.equal((await api.refresh()).status, "live");
  assert.equal(api.values.generation, 3);
});

test("offline snapshots work without a network; keys, bad endpoints and bad snapshots are refused", async (t) => {
  const { call } = await fixture(t);
  const offline = await call("keel-tezos-live-state-prepare", { network, reads: [{ ...READ, bigMap: undefined, bigMapId: 17 }], snapshot: { level: 10, values: { generation: 1 } }, rpcUrls: ["https://rpc.tzkt.io/mainnet"], tzktUrls: ["https://api.tzkt.io"] });
  assert.equal(offline.isError, undefined, JSON.stringify(offline));
  assert.equal(runKeelTezosLiveStateFragment(offline.structuredContent.fragment).values.generation, 1);
  const refusals = [
    [{ network, reads: [READ], snapshot: { level: 1, values: { generation: 1 } }, rpcUrls: ["https://rpc.tzkt.io/mainnet"], wallet: { secretKey: "edsk" } }, /Private signer material/u],
    [{ network, reads: [{ ...READ, bigMapId: 17 }], snapshot: { level: 1, values: { generation: 1 } }, rpcUrls: ["http://rpc.tzkt.io/mainnet"] }, /HTTPS/u],
    [{ network, reads: [{ ...READ, bigMapId: 17 }], snapshot: { level: 1, values: { generation: "1" } }, rpcUrls: ["https://rpc.tzkt.io/mainnet"] }, /canonical/u],
    [{ network, reads: [READ], snapshot: { level: 1, values: { generation: 1 } }, rpcUrls: ["https://rpc.tzkt.io/mainnet"] }, /offline/u],
  ];
  for (const [args, pattern] of refusals) {
    const refused = await call("keel-tezos-live-state-prepare", args);
    assert.equal(refused.isError, true);
    assert.match(JSON.stringify(refused.content), pattern);
  }
});
