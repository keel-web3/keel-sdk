import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMcpServer } from "../packages/mcp/dist/index.js";
import { KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS, KEEL_TEZOS_COLLECTION_ROUTE_TOOLS, KEEL_TEZOS_MODULES } from "../packages/sdk/dist/index.js";

const initialize = { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tezos-collection-test", version: "1" } };
const network = "NetXsqzbfFenSTS";
const creator = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
const collector = "tz1gjaF81ZRRvdzjobyfVNsAeSC6PScjfQwN";
// Octez mockup addresses (never live deployments).
const hold = "KT1BZxyjk9FSoFZi2bnDMut8qMECMRBLiVBX";
const index = "KT1UcmS1Kqq1EPryEuJ24j2WhzFpxSu2piJA";
const collection = "KT1BCTYMUJ1LoQhzpCDS6oevoHAHQ7sLu8Wb";
const oneMint = "KT1ScxDmr8x859ztMC5n8wxz51wna8BuH8us";
const registry = "KT1ELDQU3zXFZzuchGYFDbMip2M94i4BJY6C";
const DIRECTORIES = { hold: "collection_route_hold", index: "collection_route_index", collection: "collection_route_collection", presentation: "collection_route_presentation", creatorProfile: "collection_route_creator_profile", oneMint: "collection_route_one_mint" };

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "keel-tezos-collection-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [key, directory] of Object.entries(DIRECTORIES)) {
    const contract = KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS[key].contract;
    const entrypoints = KEEL_TEZOS_MODULES.flatMap((module) => module.entrypoints[contract] ?? []);
    const code = [{ prim: "parameter", args: [{ prim: "or", args: entrypoints.map((name) => ({ prim: "unit", annots: [`%${name}`] })) }] }, { prim: "storage", args: [{ prim: "unit" }] }, { prim: "code", args: [[]] }];
    await mkdir(path.join(dir, "targets", directory), { recursive: true });
    await writeFile(path.join(dir, "targets", directory, "step_001_cont_0_contract.json"), JSON.stringify(code));
  }
  await writeFile(path.join(dir, "cart.html"), "<!doctype html><title>cart</title><p>rain</p>");
  await writeFile(path.join(dir, "preview.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  const server = await createMcpServer({ workspaceRoot: dir });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: initialize });
  let id = 2;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  return { dir, server, call };
}

test("MCP lists every Tezos collection-route tool with a schema", async (t) => {
  const { server } = await fixture(t);
  const listed = await server.handle({ jsonrpc: "2.0", id: 9, method: "tools/list" });
  const names = listed.result.tools.map((tool) => tool.name);
  for (const name of KEEL_TEZOS_COLLECTION_ROUTE_TOOLS) {
    assert.ok(names.includes(name), name);
    const tool = listed.result.tools.find((item) => item.name === name);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test("MCP plans, originates, stores, binds, gates, mints and writes metadata review-only", async (t) => {
  const { call } = await fixture(t);
  const plan = await call("keel-tezos-collection-launch-plan", { network, creator, maxSupply: "333" });
  assert.equal(plan.isError, undefined, JSON.stringify(plan));
  assert.equal(plan.structuredContent.steps[0].tool, "keel-tezos-collection-originate-prepare");

  const originate = await call("keel-tezos-collection-originate-prepare", { network, creator, maxSupply: 333, artifactsDir: "targets", collectionMetadata: { name: "NOCTURNES Genesis" }, bindings: { index, creatorProfile: registry } });
  assert.equal(originate.isError, undefined, JSON.stringify(originate));
  const collectionEntry = originate.structuredContent.stages[1].operations.find((entry) => entry.artifact === "collection");
  assert.equal(collectionEntry.operation.kind, "origination");
  assert.deepEqual(originate.structuredContent.collection.metadataEditing, { creator: true, holders: false, holderFreeze: true });
  const holders = await call("keel-tezos-mint-gate-prepare", { network, creator, action: "set-holder-metadata-editing", collection, enabled: true });
  assert.equal(holders.isError, undefined, JSON.stringify(holders));
  assert.equal(holders.structuredContent.operation.parameters.entrypoint, "set_token_owner_can_edit");
  assert.deepEqual(holders.structuredContent.operation.parameters.value, { prim: "True" });
  assert.equal(originate.structuredContent.signing, "not-performed");

  const resources = await call("keel-tezos-hold-resources-prepare", { network, creator, hold, directory: true, resources: [{ name: "cart.html", mediaType: "text/html", path: "cart.html" }, { name: "preview.svg", mediaType: "image/svg+xml", path: "preview.svg" }] });
  assert.equal(resources.isError, undefined, JSON.stringify(resources));
  const [html, svg] = resources.structuredContent.resources;
  assert.match(html.onchfsUri, /^onchfs:\/\/[0-9a-f]{64}$/u);

  const bind = await call("keel-tezos-presentation-bind-prepare", { network, creator, collection, index, manifestUri: html.onchfsUri, manifestDigest: html.decodedSha256, previewUri: svg.onchfsUri });
  assert.deepEqual(bind.structuredContent.operations.map((operation) => operation.parameters.entrypoint), ["register_collection", "publish_collection_revision", "activate_collection_revision", "set_default_presentation"]);

  const gate = await call("keel-tezos-mint-gate-prepare", { network, creator, collection, oneMint, supply: "333", maxPerTransaction: 3, maxPerWallet: 5, metadataDigest: "11".repeat(32), startPaused: true, stages: [{ kind: "merkle", startTime: 0, endTime: 100, priceMutez: "500000", allowlist: [{ account: collector, allowance: 2 }] }, { kind: "public", startTime: 100, endTime: 200, priceMutez: "1000000" }] });
  assert.equal(gate.isError, undefined, JSON.stringify(gate));
  const dropId = gate.structuredContent.drop.predictedDropId;
  const pause = await call("keel-tezos-mint-gate-prepare", { network, creator, oneMint, action: "pause", dropId });
  assert.equal(pause.structuredContent.operation.parameters.entrypoint, "set_drop_paused");

  const proof = gate.structuredContent.drop.allowlists[0].proofs[0].proof;
  const mint = await call("keel-tezos-mint-prepare", { network, sender: collector, oneMint, mints: [{ mode: "merkle", dropId, stageIndex: 0, quantity: 2, priceMutez: "500000", allowance: 2, proof }, { mode: "public", dropId, stageIndex: 1, quantity: 3, priceMutez: "1000000" }] });
  assert.equal(mint.structuredContent.paymentMutez, "4000000");

  const metadata = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "Cart #1", htmlPath: "cart.html", previewSvgPath: "preview.svg" }, { tokenId: 2, name: "Cart #2", artifactUri: html.onchfsUri, displayUri: svg.onchfsUri, royalties: { decimals: 4, shares: [{ recipient: creator, share: 1000 }] } }] });
  assert.equal(metadata.isError, undefined, JSON.stringify(metadata));
  assert.match(metadata.structuredContent.tokens[0].tokenInfo.artifactUri, /^data:text\/html;charset=utf-8,/u);
  assert.deepEqual(JSON.parse(metadata.structuredContent.tokens[1].tokenInfo.royalties), { decimals: 4, shares: { [creator]: 1000 } });

  const pointer = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "x", artifactUri: "keel-onchain://x", previewSvgPath: "preview.svg" }] });
  assert.equal(pointer.isError, true);
});

test("MCP Tezos tools refuse key material and wrong network identities", async (t) => {
  const { call } = await fixture(t);
  const secret = await call("keel-tezos-mint-prepare", { network, sender: collector, oneMint, privateKey: "edsk...", mints: [{ mode: "direct", quantity: 1 }] });
  assert.equal(secret.isError, true);
  assert.match(secret.content[0].text, /Private signer material/u);
  const nested = await call("keel-tezos-collection-launch-plan", { network, creator, maxSupply: 1, extra: { mnemonic: "x" } });
  assert.equal(nested.isError, true);
  const badNetwork = await call("keel-tezos-collection-launch-plan", { network: "mainnet", creator, maxSupply: 1 });
  assert.equal(badNetwork.isError, true);
});

test("MCP read-back verifies a collection against a loopback Tezos RPC", async (t) => {
  const { call } = await fixture(t);
  const metadata = await call("keel-tezos-token-metadata-prepare", { network, creator, collection, tokens: [{ tokenId: 1, name: "Cart #1", html: "<p>x</p>", previewSvg: "<svg/>" }] });
  const tokenMap = metadata.structuredContent.operations[0].parameters.value.args[1];
  const rpc = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      let body;
      if (request.url.endsWith("/chain_id")) body = network;
      else if (request.url.endsWith("/header")) body = { level: 42 };
      else if (request.url.endsWith("/script")) body = { code: [] };
      else body = { data: { total_supply: { int: "1" }, is_minter: { prim: "True" }, token_owner_can_edit: { prim: "False" }, token_metadata: { prim: "Pair", args: [{ int: "1" }, tokenMap] } }[JSON.parse(raw).view] };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    });
  });
  await new Promise((done) => rpc.listen(0, "127.0.0.1", done));
  t.after(() => rpc.close());
  const rpcUrl = `http://127.0.0.1:${rpc.address().port}`;
  const result = await call("keel-tezos-readback-check", { network, rpcUrl, collection, oneMint, expectedTokens: [{ tokenId: 1, tokenInfoSha256: metadata.structuredContent.tokens[0].tokenInfoSha256 }] });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.equal(result.structuredContent.publicationVerified, true, JSON.stringify(result.structuredContent.checks));
  const tampered = await call("keel-tezos-readback-check", { network, rpcUrl, collection, expectedTokens: [{ tokenId: 1, tokenInfoSha256: "00".repeat(32) }] });
  assert.equal(tampered.structuredContent.publicationVerified, false);
  // A collection that lets holders edit is not the creator-only collection the caller expects.
  const holderEditable = await call("keel-tezos-readback-check", { network, rpcUrl, collection, expectedHolderMetadataEditing: true });
  assert.equal(holderEditable.structuredContent.publicationVerified, false);
  assert.equal(holderEditable.structuredContent.checks.find((check) => check.name === "metadata-editing-authority").ok, false);
});
