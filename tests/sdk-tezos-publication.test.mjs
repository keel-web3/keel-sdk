import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEL_TEZOS_ADMIN_PLACEHOLDER,
  KEEL_TEZOS_DEPENDENCY_PLACEHOLDER,
  KEEL_TEZOS_STANDARD_MODULES,
  buildKeelCollectionFreezeTokenMetadata,
  buildKeelCollectionPresentation,
  buildKeelCollectionSetTokenJson,
  buildKeelCollectionSetTokenMetadata,
  buildKeelHoldCarrierOperations,
  buildKeelTezosNftMint,
  buildKeelTezosNftPrepareRelease,
  buildKeelTezosNftReserveRelease,
  buildKeelTezosNftStoreContent,
  buildTezosOneOfOneOriginations,
  buildTezosNftCollectionOrigination,
  prepareTezosDependentOriginations,
  planKeelTezosStandardRoute,
} from "../packages/sdk/dist/index.js";

const creator = "tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM";
const hold = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const index = "KT1Qw5r2s2NbmefwbuwbdxtonRJ6PbjHpwc3M5";
const code = [{ prim: "parameter", args: [{ prim: "unit" }] }];

function artifact(key, dependency) {
  return { key, label: key, ...(dependency === undefined ? {} : { dependency }), script: { code, storage: { prim: "Pair", args: [{ string: KEEL_TEZOS_ADMIN_PLACEHOLDER }, { string: KEEL_TEZOS_DEPENDENCY_PLACEHOLDER }] } } };
}

test("Tezos one-of-one originations stay staged at receipt-backed dependencies", () => {
  const plan = buildTezosOneOfOneOriginations({
    creator,
    network: "NetXsqzbfFenSTS",
    artifacts: { hold: artifact("hold"), index: artifact("index"), shell: artifact("shell", "hold"), collection: artifact("collection", "index") },
  });
  assert.equal(plan.status, "review-only");
  assert.equal(plan.signing, "not-performed");
  assert.deepEqual(plan.stages[0].operations.map((item) => item.artifact), ["hold", "index"]);
  assert.equal(plan.stages[1].operations[0].operation, null);
  assert.deepEqual(plan.stages[1].operations[0].unresolvedBindings, ["hold"]);
  assert.equal(JSON.stringify(plan).includes("mnemonic"), false);
  const dependent = prepareTezosDependentOriginations({
    creator,
    network: "NetXsqzbfFenSTS",
    artifacts: { hold: artifact("hold"), index: artifact("index"), shell: artifact("shell", "hold"), collection: artifact("collection", "index") },
  }, { hold, index }, ["shell", "collection"]);
  assert.equal(dependent.length, 2);
  assert.equal(JSON.stringify(dependent[0]).includes(hold), true);
  assert.equal(JSON.stringify(dependent[1]).includes(index), true);
});

test("OnchFS carrier operations preserve chunks, files, and object welds", () => {
  const operations = buildKeelHoldCarrierOperations({
    hold,
    source: creator,
    document: {
      inscriptions: [
        { type: "chunk", content: "6162", hash: "00".repeat(32) },
        { type: "file", cid: "11".repeat(32), metadata: "", chunks: ["22".repeat(32)] },
        { type: "directory", cid: "33".repeat(32), files: { "index.html": "11".repeat(32) } },
      ],
      keelObjects: [{ objectId: "44".repeat(32), fileCid: "11".repeat(32), manifest: "55", manifestSha256: "66".repeat(32), storedSha256: "77".repeat(32), storedByteLength: 2, decodedSha256: "88".repeat(32), decodedByteLength: 2, mediaType: "text/html", compression: "none" }],
    },
  });
  assert.deepEqual(operations.map((item) => item.parameters.entrypoint), ["write_chunk", "create_file", "create_directory", "weld_object"]);
  assert.equal(operations[3].destination, hold);
});

test("Tezos presentation calls encode bytes rather than URLs as JSON strings", () => {
  const operation = buildKeelCollectionPresentation({ collection: hold, source: creator, manifestUri: "keel+tezos://NetXsqzbfFenSTS/KT1/view", manifestDigest: "aa".repeat(32) });
  assert.equal(operation.parameters.entrypoint, "set_default_presentation");
  assert.deepEqual(operation.parameters.value.args?.[0], { bytes: Buffer.from("keel+tezos://NetXsqzbfFenSTS/KT1/view").toString("hex") });
});

test("Tezos standard token metadata stays public while the Keel JSON route stays separate", () => {
  const carrier = "onchfs://" + "11".repeat(32);
  const metadata = buildKeelCollectionSetTokenMetadata({
    collection: hold,
    source: creator,
    tokenInfo: {
      "": carrier,
      artifactUri: carrier,
      animation_url: carrier,
      displayUri: carrier,
    },
  });
  assert.equal(metadata.parameters.entrypoint, "set_token_metadata");
  assert.equal(metadata.parameters.value.args?.[0]?.int, "1");
  assert.deepEqual(metadata.parameters.value.args?.[1]?.map((entry) => entry.args?.[0]?.string), ["", "animation_url", "artifactUri", "displayUri"]);
  assert.equal(metadata.parameters.value.args?.[1]?.find((entry) => entry.args?.[0]?.string === "animation_url")?.args?.[1]?.bytes, Buffer.from(carrier).toString("hex"));

  const json = buildKeelCollectionSetTokenJson({ collection: hold, source: creator, value: JSON.stringify({ animation_url: carrier }) });
  assert.equal(json.parameters.entrypoint, "set_token_json");
  assert.deepEqual(json.parameters.value.args?.[1], { string: JSON.stringify({ animation_url: carrier }) });

  const freeze = buildKeelCollectionFreezeTokenMetadata({ collection: hold, source: creator });
  assert.equal(freeze.parameters.entrypoint, "freeze_token_metadata");
  assert.deepEqual(freeze.parameters.value, { int: "1" });
  assert.equal(JSON.stringify(metadata).includes("keel+tezos://"), false);
});

test("Tezos NFT prototype uses the native ledger and token-metadata release path", () => {
  const content = buildKeelTezosNftStoreContent({ collection: hold, source: creator, key: "token-1.json", value: Buffer.from('{"name":"KEEL Tezos 1/1"}').toString("hex") });
  assert.equal(content.parameters.entrypoint, "store_content");
  assert.deepEqual(content.parameters.value.args?.[0], { string: "token-1.json" });

  const prepare = buildKeelTezosNftPrepareRelease({
    collection: hold,
    source: creator,
    tokenInfo: { "": Buffer.from("tezos-storage:token-1.json").toString("hex"), decimals: Buffer.from("0").toString("hex") },
  });
  assert.equal(prepare.parameters.entrypoint, "prepare_release");
  assert.deepEqual(prepare.parameters.value.args?.[0], { int: "1" });
  assert.equal(prepare.parameters.value.args?.[1]?.args?.[0]?.int, "1");
  assert.equal(prepare.parameters.value.args?.[1]?.args?.[1]?.[0]?.prim, "Elt");
  assert.deepEqual(prepare.parameters.value.args?.[1]?.args?.[1]?.map((entry) => entry.args?.[0]?.string), ["", "decimals"]);

  const reserve = buildKeelTezosNftReserveRelease({ collection: hold, source: creator, expectedMetadataUri: "tezos-storage:token-1.json" });
  assert.equal(reserve.parameters.entrypoint, "reserve_release");
  assert.deepEqual(reserve.parameters.value.args?.[1]?.args?.[0], { bytes: Buffer.from("tezos-storage:token-1.json").toString("hex") });

  const mint = buildKeelTezosNftMint({ collection: hold, source: creator });
  assert.equal(mint.parameters.entrypoint, "mint");
  assert.deepEqual(mint.parameters.value.args?.[0], { string: creator });
  assert.deepEqual(mint.parameters.value.args?.[1], { int: "1" });
});

test("Tezos NFT origination binds only the receipt-time creator placeholder", () => {
  const operation = buildTezosNftCollectionOrigination({
    creator,
    network: "NetXsqzbfFenSTS",
    code,
    storage: { prim: "Pair", args: [{ string: KEEL_TEZOS_ADMIN_PLACEHOLDER }, { string: "immutable" }] },
  });
  assert.equal(operation.kind, "origination");
  assert.deepEqual(operation.script?.storage, { prim: "Pair", args: [{ string: creator }, { string: "immutable" }] });
});

test("Tezos standard route inherits the KEEL default and selects Hybrid from measured size", () => {
  const large = planKeelTezosStandardRoute({
    network: "NetXsqzbfFenSTS",
    originalAssetByteLength: 15665832,
    compressedAssetByteLength: 1968333,
    completeInlineByteLength: 2704242,
    builderConfigured: true,
  });
  assert.equal(large.presentation.mode, "hybrid");
  assert.equal(large.presentation.automaticMode, "hybrid");
  assert.equal(large.storage.immutableBytesRemainOnchain, true);
  assert.deepEqual(large.defaults.modules, KEEL_TEZOS_STANDARD_MODULES);
  assert.equal(large.defaults.publicSurface, "FA2/TZIP-12 token_metadata");
  assert.equal(large.defaults.compatibilitySurface, "KeelSleeve.token_uri -> token_json");
  assert.equal(JSON.stringify(large.defaults.modules).includes("PixelFingerprint"), false);

  const compact = planKeelTezosStandardRoute({
    network: "NetXsqzbfFenSTS",
    originalAssetByteLength: 1000000,
    compressedAssetByteLength: 1000000,
    completeInlineByteLength: 1000000,
    builderConfigured: true,
  });
  assert.equal(compact.presentation.mode, "inline");
  assert.equal(compact.presentation.inlineEligible, true);

  const gasBound = planKeelTezosStandardRoute({
    network: "NetXsqzbfFenSTS",
    originalAssetByteLength: 1000000,
    compressedAssetByteLength: 1000000,
    completeInlineByteLength: 1000000,
    builderConfigured: true,
    readGas: 70000000n,
    blockGasLimit: 80000000n,
  });
  assert.equal(gasBound.presentation.mode, "hybrid");
  assert.match(gasBound.presentation.reason, /read gas/iu);
});
