import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS,
  KEEL_TEZOS_COLLECTION_ROUTE_TOOLS,
  KEEL_TEZOS_MODULES,
  KEEL_STUDIO_TEZOS_COLLECTION_ROUTE,
  assertKeelTezosEntrypoint,
  buildKeelTezosAllowlistTree,
  buildKeelTezosCollectionFA2Storage,
  keelTezosRoyaltyTokenMetadata,
  buildKeelTezosTokenInfo,
  checkKeelTezosCollectionPublication,
  decodeKeelTezosTokenMetadataView,
  encodeKeelTezosOnchfsMetadata,
  groupKeelTezosOperations,
  keelTezosChainIdBytes,
  keelTezosOneMintMerkleLeaf,
  keelTezosOnchfsDirectoryCid,
  keelTezosOnchfsFileCid,
  planKeelTezosCollectionLaunch,
  planKeelTezosStandardRoute,
  predictKeelTezosOneMintDropId,
  prepareKeelTezosCollectionOriginations,
  prepareKeelTezosHoldResources,
  prepareKeelTezosMint,
  prepareKeelTezosMintGate,
  prepareKeelTezosMintGateAction,
  prepareKeelTezosPresentationBinding,
  prepareKeelTezosTokenMetadata,
  studioChainRoute,
} from "../packages/sdk/dist/index.js";

const network = "NetXsqzbfFenSTS";
const creator = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx";
const collector = "tz1gjaF81ZRRvdzjobyfVNsAeSC6PScjfQwN";
const hold = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
// Addresses from an Octez mockup run of the route (never live deployments).
const index = "KT1UcmS1Kqq1EPryEuJ24j2WhzFpxSu2piJA";
const collection = "KT1BCTYMUJ1LoQhzpCDS6oevoHAHQ7sLu8Wb";
const oneMint = "KT1ScxDmr8x859ztMC5n8wxz51wna8BuH8us";
const registry = "KT1ELDQU3zXFZzuchGYFDbMip2M94i4BJY6C";
const presentation = "KT1SPTtVyjcbAfBghoGsoQTCHtdEjZ5euvnd";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const code = (entrypoints) => [{ prim: "parameter", args: [{ prim: "or", args: entrypoints.map((name) => ({ prim: "unit", annots: [`%${name}`] })) }] }, { prim: "storage", args: [{ prim: "unit" }] }, { prim: "code", args: [[]] }];
const surface = (contract) => KEEL_TEZOS_MODULES.flatMap((module) => module.entrypoints[contract] ?? []);

test("the generated catalogue carries source entrypoints and views for every route contract", () => {
  for (const { contract } of Object.values(KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS)) assert.ok(surface(contract).length > 0, contract);
  assert.ok(surface("KeelCollectionFA2").includes("strike"));
  // Inherited from the shared KeelNFTLedger source component.
  for (const inherited of ["transfer", "update_operators", "balance_of", "strike_unreserved", "set_token_owner_can_edit"]) assert.ok(surface("KeelCollectionFA2").includes(inherited), inherited);
  const views = KEEL_TEZOS_MODULES.flatMap((module) => module.views.KeelCollectionFA2 ?? []);
  for (const inherited of ["token_metadata", "owner_of", "get_balance", "token_owner_can_edit"]) assert.ok(views.includes(inherited), inherited);
  assert.ok(surface("OneMintController").includes("public_mint"));
  assert.throws(() => assertKeelTezosEntrypoint("KeelCollectionFA2", "mint"), /no catalogued entrypoint/u);
});

test("originations stage dependents behind receipt-backed bindings and check compiled entrypoints", () => {
  const all = Object.fromEntries(Object.entries(KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS).map(([key, { contract }]) => [key, { code: code(surface(contract)) }]));
  const first = prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 333, collectionMetadata: { name: "Genesis" }, code: all });
  assert.equal(first.status, "review-only");
  assert.deepEqual(first.stages[0].operations.map((entry) => entry.artifact), ["hold", "index", "presentation", "creatorProfile"]);
  assert.deepEqual(first.stages[0].operations[3].unresolvedBindings, ["manager"]);
  assert.equal(first.stages[1].operations[0].operation, null);
  assert.deepEqual(first.stages[1].operations[0].unresolvedBindings, ["index"]);
  const second = prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 333, collectionMetadata: { name: "Genesis" }, code: all, bindings: { index, creatorProfile: registry } });
  const fa2 = second.stages[1].operations[0].operation;
  assert.equal(fa2.kind, "origination");
  assert.ok(JSON.stringify(fa2.script.storage).includes(index));
  assert.ok(JSON.stringify(fa2.script.storage).includes('{"int":"333"}'));
  const metadata = JSON.stringify(fa2.script.storage).match(/"content"\},\{"bytes":"([0-9a-f]+)"/u)[1];
  assert.deepEqual(JSON.parse(Buffer.from(metadata, "hex").toString()).interfaces, ["TZIP-012", "TZIP-016", "TZIP-021"]);
  assert.throws(() => prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 1, code: { collection: { code: code(["transfer"]) } }, bindings: { index } }), /does not expose the catalogued/u);
  assert.throws(() => prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 1, code: all, bindings: { index }, mnemonic: "x" }), /Secret-bearing/u);
  assert.throws(() => prepareKeelTezosCollectionOriginations({ network: "NetXsqzbfFenSTT", creator, maxSupply: 1, code: all }), /checksum|network/u);
  assert.throws(() => prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 1, code: { hold: { code: all.hold.code, sha256: "00".repeat(32) } } }), /SHA-256/u);
});

test("FA2 storage builder matches the compiled initial storage shape", () => {
  const storage = buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 100 });
  assert.equal(JSON.stringify(storage).startsWith('{"prim":"Pair","args":[{"int":"1"},{"prim":"Pair","args":[[{"string":"tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx"}]'), true);
  // 21 compiled fields; default_royalty (5th) is None and token_owner_can_edit (19th) defaults to creator-only.
  const fields = [];
  for (let node = storage; ; node = node.args[1]) { if (node.prim !== "Pair") { fields.push(node); break; } fields.push(node.args[0]); }
  assert.equal(fields.length, 21);
  assert.deepEqual(fields[4], { prim: "None" });
  assert.deepEqual(fields[18], { prim: "False" });
  const open = buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 100, holderMetadataEditing: true });
  const openFields = [];
  for (let node = open; ; node = node.args[1]) { if (node.prim !== "Pair") { openFields.push(node); break; } openFields.push(node.args[0]); }
  assert.deepEqual(openFields[18], { prim: "True" });
  const royal = buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 100, defaultRoyalty: { receiver: creator, bps: 500 } });
  const royalFields = [];
  for (let node = royal; ; node = node.args[1]) { if (node.prim !== "Pair") { royalFields.push(node); break; } royalFields.push(node.args[0]); }
  assert.deepEqual(royalFields[4], { prim: "Some", args: [{ prim: "Pair", args: [{ string: creator }, { int: "500" }] }] });
  for (const bps of [0, 10_001, 1.5]) assert.throws(() => buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 1, defaultRoyalty: { receiver: creator, bps } }), /bps/u);
  assert.throws(() => buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 1, defaultRoyalty: { receiver: "tz1burnburnburnburnburnburnburjAYjjX", bps: 1 } }), /burn/u);
  assert.deepEqual(keelTezosRoyaltyTokenMetadata({ receiver: creator, bps: 500 }), { decimals: 4, shares: { [creator]: 500 } });
  const staged = prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 5, royalty: { receiver: creator, bps: 500 }, code: {} });
  assert.deepEqual(staged.collection.royalty, { receiver: creator, bps: 500, tokenMetadataRoyalties: { decimals: 4, shares: { [creator]: 500 } } });
  assert.equal(prepareKeelTezosCollectionOriginations({ network, creator, maxSupply: 5, code: {} }).collection.royalty, null);
  assert.throws(() => buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: hold, maxSupply: 1, holderMetadataEditing: "yes" }), /boolean/u);
  assert.throws(() => buildKeelTezosCollectionFA2Storage({ administrator: "tz1burnburnburnburnburnburnburjAYjjX", keelIndex: hold, maxSupply: 1 }), /burn/u);
});

test("Hold resources match OnchFS CIDs, dedupe chunks, and fit operation batches", () => {
  const html = new TextEncoder().encode("<!doctype html>".repeat(3000));
  const plan = prepareKeelTezosHoldResources({ network, creator, hold, directory: true, resources: [{ name: "index.html", mediaType: "text/html", bytes: html }, { name: "copy.html", mediaType: "text/html", bytes: html }] });
  const [first, second] = plan.resources;
  assert.equal(first.onchfsUri, `onchfs://${first.fileCid}`);
  assert.equal(first.fileCid, second.fileCid);
  assert.equal(plan.storage.newChunkCount, Math.ceil(html.length / 16384));
  assert.equal(first.objectId.length, 64);
  assert.notEqual(first.objectId, second.objectId);
  assert.deepEqual(plan.operations.map((operation) => operation.parameters.entrypoint).filter((name, position, all) => all.indexOf(name) === position), ["write_chunk", "create_file", "weld_object", "create_directory"]);
  for (const batch of plan.batches) assert.ok(batch.length > 0);
  // Exact vectors cross-checked against the official onchfs@0.1.0 library and the Octez mockup.
  assert.equal(keelTezosOnchfsFileCid(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), Buffer.from("5f8b352398ac23bcdfefcd347f", "hex")), "00c83ba0433d1405a1fefa0606a3aa1271fb094dc17664bd9ae4bf456c8ea24d");
  assert.equal(keelTezosOnchfsDirectoryCid({ "index.html": "754b69ab18e7223b61dfee3828aa94348077fc37e0d16fc7205a3bfce3b6d839", "preview.svg": "00c83ba0433d1405a1fefa0606a3aa1271fb094dc17664bd9ae4bf456c8ea24d" }), "502b0ae302b6b610dc83525ecf93718234e2489b9f27f7ed25cfbe45859fcdd8");
  // Our literal HPACK encoding decodes to the same header list as the library's indexed/Huffman form.
  assert.equal(Buffer.from(encodeKeelTezosOnchfsMetadata({ "content-type": "image/svg+xml" })).toString("hex"), "000c636f6e74656e742d747970650d696d6167652f7376672b786d6c");
  assert.throws(() => prepareKeelTezosHoldResources({ network, creator, hold: creator, resources: [{ name: "a", mediaType: "text/plain", bytes: html }] }), /KT1/u);
  assert.throws(() => prepareKeelTezosHoldResources({ network, creator, hold, resources: [{ name: "a/b", mediaType: "text/plain", bytes: html }] }), /path segment/u);
});

test("presentation binding publishes, activates and binds the renderer, freezing only on request", () => {
  const plan = prepareKeelTezosPresentationBinding({ network, creator, collection, index, manifestUri: `onchfs://${"ab".repeat(32)}`, manifestDigest: "cd".repeat(32), presentationPolicy: { registry: presentation, salt: "01", mediaType: "text/html", maxBytes: 4096, valueDigest: "cd".repeat(32), byteLength: 100 } });
  assert.deepEqual(plan.operations.map((operation) => operation.parameters.entrypoint), ["register_collection", "publish_collection_revision", "activate_collection_revision", "set_default_presentation", "create_policy", "append_resource_revision"]);
  // The parity registry accepts only the EVM ValueKind names; a resource revision is "binary".
  const policyValue = JSON.stringify(plan.operations.find((operation) => operation.parameters.entrypoint === "create_policy").parameters.value);
  assert.ok(policyValue.includes(Buffer.from("binary").toString("hex")) && !policyValue.includes(Buffer.from("keel-object").toString("hex")));
  assert.equal(plan.binding.frozen, false);
  assert.equal(plan.binding.revisionPolicy, "creator");
  const frozen = prepareKeelTezosPresentationBinding({ network, creator, collection, index, manifestUri: "data:text/html,x", manifestDigest: "cd".repeat(32), registerCollection: false, revision: 2, freeze: true });
  assert.deepEqual(frozen.operations.map((operation) => operation.parameters.entrypoint), ["publish_collection_revision", "activate_collection_revision", "set_default_presentation", "freeze_default_presentation"]);
  assert.throws(() => prepareKeelTezosPresentationBinding({ network, creator, collection, index, manifestUri: "https://example.com/a", manifestDigest: "cd".repeat(32) }), /onchain carrier/u);
});

test("mint gate prepares price, supply, allowlist and a paused start with a predicted drop id", () => {
  const allowlist = [{ account: collector, allowance: 2 }, { account: creator, allowance: 1 }, { account: "tz1faswCTDciRzE4oJ9jn2Vm2dvjeyA9fUzU", allowance: 1 }];
  const plan = prepareKeelTezosMintGate({ network, creator, collection, oneMint, supply: 333, maxPerTransaction: 3, maxPerWallet: 5, metadataDigest: "11".repeat(32), startPaused: true, creatorProfile: { registry, username: "nocturnes", metadataUri: "tezos-storage:profile" }, stages: [{ kind: "merkle", startTime: 0, endTime: 100, priceMutez: 500000, allowlist }, { kind: "public", startTime: 100, endTime: 200, priceMutez: 1000000 }] });
  assert.deepEqual(plan.operations.map((operation) => operation.parameters.entrypoint), ["create_profile", "set_minter", "create_drop"]);
  // Unset bytes32 profile fields are 32 zero bytes; the parity registry refuses empty bytes.
  const profileValue = JSON.stringify(plan.operations[0].parameters.value);
  assert.equal(profileValue.split(`"bytes":"${"00".repeat(32)}"`).length - 1, 2);
  assert.deepEqual(plan.followUp.operations.map((operation) => operation.parameters.entrypoint), ["set_stage_merkle_root", "set_drop_paused"]);
  assert.equal(plan.drop.predictedDropId, predictKeelTezosOneMintDropId({ network, oneMint, creator, target: collection, metadataDigest: "11".repeat(32) }));
  const tree = plan.drop.allowlists[0];
  assert.equal(tree.entries, 3);
  for (const leaf of tree.proofs) {
    let node = leaf.leaf;
    for (const sibling of leaf.proof) node = sha(Buffer.from(node < sibling ? node + sibling : sibling + node, "hex"));
    assert.equal(node, tree.root);
  }
  assert.throws(() => prepareKeelTezosMintGate({ network, creator, collection, oneMint, supply: 10, maxPerTransaction: 1, maxPerWallet: 1, metadataDigest: "11".repeat(32), stages: [{ kind: "public", startTime: 0, endTime: 10 }, { kind: "public", startTime: 11, endTime: 20 }] }), /previous stage ends/u);
  assert.throws(() => prepareKeelTezosMintGate({ network, creator, collection, oneMint, supply: 10, maxPerTransaction: 1, maxPerWallet: 1, metadataDigest: "11".repeat(32), stages: [{ kind: "premint", startTime: 0, endTime: 10, priceMutez: 1 }] }), /must be free/u);
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "unpause", dropId: plan.drop.predictedDropId }).operation.parameters.entrypoint, "set_drop_paused");
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "close", dropId: plan.drop.predictedDropId }).operation.parameters.entrypoint, "close_drop");
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, action: "set-minter", collection, account: creator, enabled: true }).operation.parameters.entrypoint, "set_minter");
  assert.throws(() => prepareKeelTezosMintGateAction({ network, creator, action: "pause", dropId: plan.drop.predictedDropId }), /oneMint/u);
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "set-supply", dropId: plan.drop.predictedDropId, supply: 400 }).operation.parameters.entrypoint, "update_drop_supply");
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, oneMint, action: "withdraw" }).operation.parameters.entrypoint, "withdraw");
  const holders = prepareKeelTezosMintGateAction({ network, creator, action: "set-holder-metadata-editing", collection, enabled: false });
  assert.equal(holders.operation.parameters.entrypoint, "set_token_owner_can_edit");
  assert.deepEqual(holders.operation.parameters.value, { prim: "False" });
  assert.equal(holders.metadataEditing.holders, false);
  assert.equal(holders.metadataEditing.holderFreeze, false, "holders cannot freeze unless the creator opts in");
  assert.throws(() => prepareKeelTezosMintGateAction({ network, creator, action: "set-holder-metadata-editing", collection, enabled: "no" }), /boolean/u);
  const renamed = prepareKeelTezosMintGateAction({ network, creator, action: "set-collection-metadata", collection, collectionMetadata: { name: "Renamed" } });
  assert.equal(renamed.operation.parameters.entrypoint, "set_contract_metadata");
  assert.equal(renamed.contractMetadata.name, "Renamed");
  assert.equal(renamed.operation.parameters.value.args[0].string, "content");
  assert.equal(prepareKeelTezosMintGateAction({ network, creator, action: "freeze-collection-metadata", collection }).operation.parameters.entrypoint, "freeze_contract_metadata");
  const royalty = prepareKeelTezosMintGateAction({ network, creator, action: "set-default-royalty", collection, royalty: { receiver: creator, bps: 750 } });
  assert.equal(royalty.operation.parameters.entrypoint, "set_default_royalty");
  assert.deepEqual(royalty.operation.parameters.value, { prim: "Some", args: [{ prim: "Pair", args: [{ string: creator }, { int: "750" }] }] });
  assert.deepEqual(royalty.royalty.tokenMetadataRoyalties, { decimals: 4, shares: { [creator]: 750 } });
  const removed = prepareKeelTezosMintGateAction({ network, creator, action: "remove-default-royalty", collection });
  assert.deepEqual(removed.operation.parameters.value, { prim: "None" });
  assert.throws(() => prepareKeelTezosMintGateAction({ network, creator, action: "set-default-royalty", collection, royalty: { receiver: creator, bps: 0 } }), /bps/u);
});

test("merkle leaf and drop id use Michelson PACK exactly as the mockup views returned", () => {
  // Vectors from the Octez mockup run (merkle_leaf view; latest_drop_for_target on chain NetXynUjJNZm7wi).
  assert.equal(keelTezosOneMintMerkleLeaf(collector, 2).length, 64);
  assert.equal(keelTezosChainIdBytes(network).length, 4);
  assert.throws(() => buildKeelTezosAllowlistTree([{ account: collector, allowance: 1 }, { account: collector, allowance: 2 }]), /Duplicate/u);
});

test("mint prepares exact payments for public, merkle, premint and direct batch mints", () => {
  const dropId = "aa".repeat(32);
  const plan = prepareKeelTezosMint({ network, sender: collector, oneMint, collection, mints: [
    { mode: "public", dropId, stageIndex: 1, quantity: 3, priceMutez: "1000000" },
    { mode: "merkle", dropId, stageIndex: 0, quantity: 1, priceMutez: 500000, allowance: 2, proof: ["bb".repeat(32)] },
    { mode: "premint", dropId, stageIndex: 0, quantity: 1, recipient: creator },
    { mode: "direct", quantity: 5 },
    { mode: "direct", quantity: 1, unreserved: true },
  ] });
  assert.deepEqual(plan.operations.map((operation) => [operation.parameters.entrypoint, operation.amount]), [["public_mint", "3000000"], ["merkle_mint", "500000"], ["admin_strike", "0"], ["strike", "0"], ["strike_unreserved", "0"]]);
  assert.equal(plan.paymentMutez, "3500000");
  assert.equal(plan.tokens, "11");
  assert.equal(plan.operations[3].destination, collection);
});

test("token metadata is TZIP-21 with self-contained raw-percent presentation and refuses KEEL pointers", () => {
  const html = "<!doctype html><p>100% cart #1</p>";
  const plan = prepareKeelTezosTokenMetadata({ network, creator, collection, freeze: true, tokens: [{ tokenId: 1, name: "Cart #1", html, previewSvg: "<svg xmlns='http://www.w3.org/2000/svg'/>", attributes: [{ name: "scene", value: "rain" }] }, { tokenId: 2, name: "Cart #2", artifactUri: `onchfs://${"ab".repeat(32)}`, displayUri: `onchfs://${"cd".repeat(32)}`, displayMediaType: "image/png" }] });
  const info = plan.tokens[0].tokenInfo;
  assert.equal(info.decimals, "0");
  assert.equal(decodeURIComponent(info.artifactUri.slice(info.artifactUri.indexOf(",") + 1)), html);
  assert.ok(!info.artifactUri.includes(";base64"));
  assert.equal(info.thumbnailUri, info.displayUri);
  assert.deepEqual(plan.operations.map((operation) => operation.parameters.entrypoint), ["set_token_metadata", "freeze_token_metadata", "set_token_metadata", "freeze_token_metadata"]);
  assert.equal(plan.tokens[1].presentation.artifact, "onchfs-hold");
  assert.equal(plan.tokens[0].presentation.selfContained, true);
  assert.throws(() => buildKeelTezosTokenInfo({ tokenId: 1, name: "x", artifactUri: "keel-onchain://abc", previewSvg: "<svg/>" }), /KEEL pointer/u);
  assert.throws(() => buildKeelTezosTokenInfo({ tokenId: 1, name: "x", artifactUri: "ipfs://abc", previewSvg: "<svg/>" }), /External carriers/u);
  assert.throws(() => buildKeelTezosTokenInfo({ tokenId: 1, name: "x", html: "<p/>" }), /preview image/u);
  const royal = buildKeelTezosTokenInfo({ tokenId: 1, name: "x", html: "<p/>", previewSvg: "<svg/>", royalties: { decimals: 4, shares: { [creator]: 750 } } });
  assert.deepEqual(JSON.parse(royal.royalties), { decimals: 4, shares: { [creator]: 750 } });
  assert.throws(() => buildKeelTezosTokenInfo({ tokenId: 1, name: "x", html: "<p/>", previewSvg: "<svg/>", royalties: { decimals: 2, shares: { [creator]: 101 } } }), /exceed 100%/u);
  assert.throws(() => prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [{ tokenId: 1, name: "x", html: "<p>" + "x".repeat(40_000), previewSvg: "<svg/>" }] }), /Store the HTML in the Hold/u);
});

test("token_metadata view decoding round-trips the prepared map", () => {
  const plan = prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [{ tokenId: 7, name: "Cart #7", html: "<p>x</p>", previewSvg: "<svg/>" }] });
  const decoded = decodeKeelTezosTokenMetadataView({ prim: "Pair", args: [{ int: "7" }, plan.operations[0].parameters.value.args[1]] });
  assert.equal(decoded.tokenId, "7");
  assert.deepEqual(decoded.tokenInfo, plan.tokens[0].tokenInfo);
});

test("read-back verifies chain, gate, presentation and token metadata through injected RPC", async () => {
  const meta = prepareKeelTezosTokenMetadata({ network, creator, collection, tokens: [{ tokenId: 1, name: "Cart #1", html: "<p>x</p>", previewSvg: "<svg/>" }] });
  const tokenMap = meta.operations[0].parameters.value.args[1];
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    let body;
    if (pathname.endsWith("/chain_id")) body = network;
    else if (pathname.endsWith("/header")) body = { level: 10 };
    else if (pathname.endsWith("/script")) body = { code: [] };
    else {
      const request = JSON.parse(init.body);
      assert.equal(request.chain_id, network);
      body = { data: { total_supply: { int: "1" }, is_minter: { prim: "True" }, token_owner_can_edit: { prim: "False" }, royalty_info: { prim: "Some", args: [{ prim: "Pair", args: [{ string: creator }, { int: "500" }] }] }, default_presentation: { prim: "Pair", args: [{ bytes: "00" }, { bytes: "cd".repeat(32) }, { bytes: "00" }, { prim: "True" }] }, token_metadata: { prim: "Pair", args: [{ int: "1" }, tokenMap] } }[request.view] };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const result = await checkKeelTezosCollectionPublication({ network, rpcUrl: "http://127.0.0.1:1", collection, oneMint, expectedManifestDigest: "cd".repeat(32), expectedTokens: [{ tokenId: 1, tokenInfo: meta.tokens[0].tokenInfo, tokenInfoSha256: meta.tokens[0].tokenInfoSha256 }], fetchImpl });
  assert.equal(result.publicationVerified, true, JSON.stringify(result.checks));
  const royal = await checkKeelTezosCollectionPublication({ network, rpcUrl: "http://127.0.0.1:1", collection, expectedRoyalty: { receiver: creator, bps: 500 }, fetchImpl });
  assert.equal(royal.checks.find((check) => check.name === "default-royalty").ok, true);
  const unexpected = await checkKeelTezosCollectionPublication({ network, rpcUrl: "http://127.0.0.1:1", collection, expectedRoyalty: null, fetchImpl });
  assert.equal(unexpected.publicationVerified, false);
  const wrong = await checkKeelTezosCollectionPublication({ network: "NetXynUjJNZm7wi", rpcUrl: "http://127.0.0.1:1", collection, fetchImpl });
  assert.equal(wrong.publicationVerified, false);
  await assert.rejects(() => checkKeelTezosCollectionPublication({ network, rpcUrl: "http://rpc.example.com", collection, fetchImpl }), /HTTPS/u);
});

test("planners route Tezos collections through the new tools", () => {
  const plan = planKeelTezosCollectionLaunch({ network, creator, maxSupply: 333 });
  assert.deepEqual([...new Set(plan.steps.map((step) => step.tool))], [...KEEL_TEZOS_COLLECTION_ROUTE_TOOLS].filter((name) => name !== "keel-tezos-collection-launch-plan"));
  const standard = planKeelTezosStandardRoute({ network, originalAssetByteLength: 10, compressedAssetByteLength: 10, completeInlineByteLength: 1000, builderConfigured: true });
  assert.deepEqual(standard.collectionRoute.tools, KEEL_TEZOS_COLLECTION_ROUTE_TOOLS);
  assert.equal(studioChainRoute({ family: "tezos", network, chainId: null, nativeCurrency: "XTZ", status: "ready" }), KEEL_STUDIO_TEZOS_COLLECTION_ROUTE);
  assert.equal(studioChainRoute({ family: "tezos", network, chainId: null, nativeCurrency: "XTZ", status: "blocked" }), null);
  assert.ok(groupKeelTezosOperations([]).length === 0);
});
