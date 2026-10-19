import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createIntegrity } from "../packages/protocol/dist/index.js";
import {
  buildKeelInlineTokenURIGraph, buildKeelPreparedOneOfOneTokenURI,
  buildKeelInlineImageURI, assertLegacyCarriageAllowed,
  buildKeelInlineShellFragments, buildKeelInlineLocalDocument,
  assertKeelPreparedCopyRead, createKeelPublishReviewPlan, verifyKeelPublishReviewPlan,
} from "../packages/sdk/dist/index.js";
import { createMcpServer } from "../packages/mcp/dist/index.js";

const bytes = text => new TextEncoder().encode(text);
const store = "0x1111111111111111111111111111111111111111";
const chainId = 11155111;
async function document() {
  const shell = await buildKeelInlineShellFragments();
  return buildKeelInlineLocalDocument({ shell, modules: [],
    entry: { id: "entry", mediaType: "text/javascript", source: bytes('document.body.textContent="Water: 水 🐟";') } });
}
async function fixture(carriage = "compact") {
  const root = await document();
  const graph = await buildKeelInlineTokenURIGraph(root,
    carriage === "compact" ? {} : { carriage, legacyCarriage: "acknowledged" });
  const prepared = await buildKeelPreparedOneOfOneTokenURI({ graph,
    chainId, collection: "0x2222222222222222222222222222222222222222",
    collectionName: "Original art", description: "COPY fixture", manifestURI: "",
    manifestDigest: `0x${"33".repeat(32)}`,
    imageURI: buildKeelInlineImageURI(bytes('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>'), "image/svg+xml"),
    ...(carriage === "compact" ? {} : { presentationPolicy: "raw-artifact" }),
  });
  const evidence = { graphBytes: graph.fragmentBytes, expectedTokenURI: prepared.tokenURI,
    returnedTokenURI: prepared.tokenURI, callGasLimit: 30_000_000n, blockGasLimit: 60_000_000n };
  const bound = { ...evidence, chainId, store, mediaType: graph.mediaType, graphIntegrity: graph.fragmentIntegrity };
  const chunks = [];
  for (let at = 0; at < graph.fragmentBytes.length; at += 23000) {
    const data = graph.fragmentBytes.slice(at, at + 23000);
    chunks.push({ byteLength: data.length, integrity: await createIntegrity(data) });
  }
  const casts = [];
  for (let at = 0; at < chunks.length; at += 3) {
    const batch = chunks.slice(at, at + 3);
    casts.push({ kind: "castSlugs", function: "castSlugs(bytes[])", payloadEncoding: "raw-bytes-from-files",
      chunkCount: batch.length, chunkByteLengths: batch.map(c => c.byteLength), chunkIntegrities: batch.map(c => c.integrity), slugIds: "derived-keccak256-after-review" });
  }
  const chainPlan = {
    schema: "keel-chain-operation-plan@1", status: "review-only", materialized: true,
    descriptorMaterialized: true, chainReady: false,
    target: { family: "ethereum", chainId, address: store },
    sourcePlan: { schema: "keel-upload-plan@2", objectName: "viewer", mediaType: graph.mediaType, integrity: graph.fragmentIntegrity },
    operations: [
      ...casts,
      { kind: "weldObject", function: "weldObject(bytes32[],bytes32,uint64,uint8,string)", slugIds: "from-preceding-castSlugs",
        digest: graph.fragmentIntegrity, byteLength: graph.fragmentBytes.length, compression: "none", mediaType: graph.mediaType },
    ], encoding: "deferred-contract-abi", walletApproval: "required", signing: "not-performed", submission: "not-performed", caveat: "Local fixture only.",
  };
  return { root, graph, prepared, evidence, bound, chainPlan };
}

test("shared planner no longer auto-acknowledges a fresh Base64 carriage", async () => {
  const root = await document();
  for (const carriage of ["pinned", "percent", "follow-latest"]) {
    await assert.rejects(buildKeelInlineTokenURIGraph(root, { carriage }), /explicit|acknowledged|raw-percent/i);
  }
});

test("environment configuration cannot bypass fresh encoding review", () => {
  const before = process.env.KEEL_LEGACY_CARRIAGE;
  process.env.KEEL_LEGACY_CARRIAGE = "allow";
  try { assert.throws(() => assertLegacyCarriageAllowed("test", {}), /raw-percent/i); }
  finally { if (before === undefined) delete process.env.KEEL_LEGACY_CARRIAGE; else process.env.KEEL_LEGACY_CARRIAGE = before; }
});

for (const carriage of ["compact", "pinned", "percent"]) test(`complete ${carriage} COPY retains exact prepared bytes and binds the plan`, async () => {
  const f = await fixture(carriage);
  const checked = await assertKeelPreparedCopyRead(f.bound);
  assert.equal(checked.completeTokenURIBytes, Buffer.byteLength(f.prepared.tokenURI));
  assert.equal(checked.selectedChainReadAuthenticated, false);
  assert.deepEqual(checked.graphIntegrity, f.graph.fragmentIntegrity);
  const envelope = await createKeelPublishReviewPlan(f.chainPlan, { preparedCopy: f.evidence });
  assert.deepEqual(envelope.plan.preparedCopy, checked);
  assert.equal((await verifyKeelPublishReviewPlan(envelope)).valid, true);
  assert.equal(envelope.plan.chainReady, false);
});

test("SDK refuses a prepared viewer plan with missing full-return evidence", async () => {
  const f = await fixture();
  await assert.rejects(createKeelPublishReviewPlan(f.chainPlan), /preparedCopy.*full-return/i);
});

test("SDK stops a different return, transport or source before producing a plan", async () => {
  const f = await fixture();
  for (const returnedTokenURI of [f.prepared.tokenURI + "extra", "data:application/json;base64," + Buffer.from(f.prepared.tokenJSON).toString("base64"), "data:application/json;charset=utf-8," + Buffer.from(f.prepared.tokenJSON).toString("hex")]) {
    await assert.rejects(createKeelPublishReviewPlan(f.chainPlan, { preparedCopy: { ...f.evidence, returnedTokenURI } }), /differs from canonical/);
  }
  await assert.rejects(createKeelPublishReviewPlan(f.chainPlan, { preparedCopy: { ...f.evidence, graphBytes: bytes("different") } }), /source bytes/);
  await assert.rejects(assertKeelPreparedCopyRead({ ...f.bound, mediaType: "application/octet-stream" }), /supported prepared COPY/);
});

test("COPY checks are commitment-bound and cannot be stripped or moved to another chain/store", async () => {
  const f = await fixture();
  const envelope = await createKeelPublishReviewPlan(f.chainPlan, { preparedCopy: f.evidence });
  const variants = [structuredClone(envelope), structuredClone(envelope), structuredClone(envelope)];
  delete variants[0].plan.preparedCopy;
  variants[1].plan.target.chainId = 1;
  variants[2].plan.target.address = "0x4444444444444444444444444444444444444444";
  for (const variant of variants) assert.equal((await verifyKeelPublishReviewPlan(variant)).valid, false);
});

test("read caps use the selected chain boundary and never stand in for authenticated gas proof", async () => {
  const f = await fixture();
  await assert.rejects(assertKeelPreparedCopyRead({ ...f.bound, blockGasLimit: 20_000_000n }), /gas boundary/);
  await assert.rejects(assertKeelPreparedCopyRead({ ...f.bound, callGasLimit: 61_000_000n }), /gas boundary/);
});

async function mcp(t) {
  const dir = await mkdtemp(path.join("/tmp", "keel-copy-enforcement-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const server = await createMcpServer({ workspaceRoot: dir });
  await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "copy-gate", version: "1" } } });
  let id = 2;
  const call = async (name, args) => (await server.handle({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } })).result;
  const f = await fixture();
  await writeFile(path.join(dir, "graph.bin"), f.graph.fragmentBytes);
  await writeFile(path.join(dir, "expected.uri"), f.prepared.tokenURI);
  await writeFile(path.join(dir, "returned.uri"), f.prepared.tokenURI);
  const files = { graphPath: "graph.bin", expectedTokenURIPath: "expected.uri", returnedTokenURIPath: "returned.uri", callGasLimit: "30000000", blockGasLimit: "60000000" };
  return { ...f, dir, call, files };
}

test("fresh MCP cannot select an alternative carriage under another presentation label", async t => {
  const { call } = await mcp(t);
  for (const carriage of ["pinned", "percent", "follow-latest"]) {
    const result = await call("keel-inline-prepare", { carriage, presentationPolicy: "raw-artifact", entry: "unused.js" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /compact raw-percent COPY/);
  }
});

test("MCP publish-plan requires evidence, reruns the SDK gate and rejects file tampering", async t => {
  const f = await mcp(t);
  const plan = { publicationIntent: "new-object", chainPlan: f.chainPlan };
  const absent = await f.call("publish-plan", plan);
  assert.equal(absent.isError, true);
  assert.match(absent.content[0].text, /full-return evidence/);
  const checked = await f.call("keel-inline-publication-check", { ...f.files, chainId, store, mediaType: f.graph.mediaType, digest: f.graph.fragmentIntegrity.digest, byteLength: f.graph.fragmentBytes.length });
  assert.equal(checked.isError, undefined, JSON.stringify(checked));
  assert.equal(checked.structuredContent.chainReady, false);
  const accepted = await f.call("publish-plan", { ...plan, preparedCopy: f.files });
  assert.equal(accepted.isError, undefined, JSON.stringify(accepted));
  assert.equal(accepted.structuredContent.envelope.plan.preparedCopy.requiredBuilder, "KeelRawTokenURIBuilder");
  await writeFile(path.join(f.dir, "returned.uri"), f.prepared.tokenURI + "extra transport");
  const tampered = await f.call("publish-plan", { ...plan, preparedCopy: f.files });
  assert.equal(tampered.isError, true);
  assert.match(tampered.content[0].text, /differs from canonical/);
});

test('publication rejects browser-tolerated unescaped outer metadata',async()=>{
 const f=await fixture();const uri=f.prepared.tokenURI.replace('%7B','{');
 await assert.rejects(assertKeelPreparedCopyRead({...f.bound,expectedTokenURI:uri,returnedTokenURI:uri}),/unescaped URI/);
});

async function unescapedAnimationFixture() {
  const f = await fixture();
  const metadata = JSON.parse(decodeURIComponent(f.prepared.tokenURI.slice(f.prepared.tokenURI.indexOf(',') + 1)));
  metadata.animation_url = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body>Exact</body>').replace('%3C', '<');
  const uri = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(metadata));
  const graphBytes = bytes(encodeURIComponent(encodeURIComponent('</body>')));
  return { ...f.bound, graphBytes, graphIntegrity: await createIntegrity(graphBytes), expectedTokenURI: uri, returnedTokenURI: uri };
}

test('publication rejects unescaped animation even when outer metadata is escaped', async () => {
  await assert.rejects(assertKeelPreparedCopyRead(await unescapedAnimationFixture()), /Prepared animation_url.*unescaped URI/);
});

test('MCP publication check rejects unescaped characters at either URI boundary', async t => {
  const f = await mcp(t);
  const outer = f.prepared.tokenURI.replace('%7B', '{');
  for (const input of [{...f.bound, expectedTokenURI: outer, returnedTokenURI: outer}, await unescapedAnimationFixture()]) {
    await writeFile(path.join(f.dir, 'graph.bin'), input.graphBytes);
    await writeFile(path.join(f.dir, 'expected.uri'), input.expectedTokenURI);
    await writeFile(path.join(f.dir, 'returned.uri'), input.returnedTokenURI);
    const result = await f.call('keel-inline-publication-check', { ...f.files, chainId, store, mediaType: input.mediaType, digest: input.graphIntegrity.digest, byteLength: input.graphBytes.length });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /unescaped URI/);
  }
});
