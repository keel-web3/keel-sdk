#!/usr/bin/env node
/**
 * Build the staged, receipt-bound Shadow Net publication plan for a prepared
 * KEEL Tezos one-of-one.  This command reads the local artifact only and
 * never signs, originates, or submits an operation.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, createIntegrity, utf8ToBytes } from "@keel/protocol";
import { concatHex, keccak256 } from "viem";
import { buildKeelOnchfsCarrier } from "../../packages/studio-core/dist/index.js";
import {
  KEEL_TEZOS_ADMIN_PLACEHOLDER,
  KEEL_TEZOS_DEPENDENCY_PLACEHOLDER,
  KEEL_TEZOS_PUBLICATION_NETWORK,
  KEEL_TEZOS_PUBLICATION_PROTOCOL,
  KEEL_TEZOS_PUBLICATION_RPC,
  KeelTezosPublicationAdapter,
  buildKeelCollectionPresentation,
  buildKeelCollectionSetMinter,
  buildKeelCollectionStrike,
  buildKeelForgeHarness,
  buildKeelHoldCarrierOperations,
  buildKeelHoldConfigureVerifier,
  buildKeelIndexActivateCollection,
  buildKeelIndexPublishCollection,
  buildKeelIndexRegisterCollection,
  buildTezosOneOfOneOriginations,
} from "../../packages/sdk/dist/index.js";

const DEFAULT_BUNDLE = "/Users/ravonus/.codex/visualizations/2026/09/08/01a07ece-e1bd-76c1-867d-0187e66f986f/keel-tezos-one-of-one-q45-standard-eth-modules-v1";
const DUMMY_HOLD = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const DUMMY_INDEX = DUMMY_HOLD;
const DUMMY_COLLECTION = DUMMY_HOLD;
const DUMMY_SOURCE = "tz1WKJQZ88sbVJFxQTNjZFPVHd7k6KKx9nzM";

function fail(message) { throw new TypeError(message); }
function valueAfter(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}
function required(flag, argv) {
  const value = valueAfter(flag, argv);
  if (value === undefined || value.length === 0) fail(`Missing ${flag}.`);
  return value;
}
function assertFlags(argv) {
  const withValues = new Set(["--bundle", "--output", "--creator", "--network", "--rpc"]);
  for (let i = 0; i < argv.length; i += 1) {
    if (!withValues.has(argv[i])) fail(`Unsupported option: ${argv[i]}`);
    i += 1;
  }
}
function hex(value) { return `0x${value.replace(/^0x/u, "")}`; }
function replaceValue(value, from, to) {
  if (Array.isArray(value)) return value.map((item) => replaceValue(item, from, to));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceValue(child, from, to)]));
  return value === from ? to : value;
}
function withDestination(operation, destination) {
  return { ...operation, destination };
}
function unique(values) { return [...new Set(values)]; }
async function jsonFile(file) { return JSON.parse(await readFile(file, "utf8")); }
async function integrityOf(bytes) { return await createIntegrity(bytes); }

function bytesHex(bytes) { return `0x${Buffer.from(bytes).toString("hex")}`; }

/**
 * The standard Hold harness deliberately reads raw bytes.  OnchFS may gzip
 * its normal file carrier, so add a raw overlay for the exact shell parts
 * that the verifier and harness will concatenate.  The normal OnchFS
 * directory remains intact; these are ordinary standard create_file and
 * weld_object operations bound to the same Hold.
 */
async function buildRawHarnessOverlay(files) {
  const inscriptions = [];
  const keelObjects = [];
  const chunkSize = 16_384;
  for (const file of files) {
    const chunks = [];
    for (let offset = 0; offset < file.bytes.byteLength; offset += chunkSize) {
      const chunk = bytesHex(file.bytes.slice(offset, offset + chunkSize));
      const hash = keccak256(chunk);
      chunks.push({ content: chunk.slice(2), hash: hash.slice(2) });
      inscriptions.push({ type: "chunk", content: chunk.slice(2), hash: hash.slice(2) });
    }
    const metadata = "";
    const contentHash = keccak256(concatHex(chunks.map((chunk) => `0x${chunk.content}`)));
    const fileCid = keccak256(concatHex(["0x01", contentHash, keccak256("0x")]));
    inscriptions.push({ type: "file", cid: fileCid.slice(2), metadata, chunks: chunks.map((chunk) => chunk.hash) });
    const manifestValue = {
      protocol: "keel-tezos-onchfs-binding@1",
      path: file.path,
      decoded: { algorithm: "sha256", digest: file.integrity.digest, byteLength: file.bytes.byteLength, mediaType: file.mediaType },
      carrier: {
        kind: "onchfs",
        fileCid,
        storedIntegrity: file.integrity,
        compression: "none",
      },
    };
    const manifestBytes = utf8ToBytes(canonicalJson(manifestValue));
    const manifestIntegrity = await integrityOf(manifestBytes);
    keelObjects.push({
      objectId: manifestIntegrity.digest.slice(2),
      fileCid: fileCid.slice(2),
      path: file.path,
      manifest: bytesHex(manifestBytes).slice(2),
      manifestSha256: manifestIntegrity.digest.slice(2),
      storedSha256: file.integrity.digest.slice(2),
      storedByteLength: file.bytes.byteLength,
      decodedSha256: file.integrity.digest.slice(2),
      decodedByteLength: file.bytes.byteLength,
      mediaType: file.mediaType,
      compression: "none",
    });
  }
  return { document: { inscriptions, keelObjects } };
}

async function readBundle(bundle) {
  const reportPath = path.join(bundle, "keel-tezos-one-of-one.json");
  const report = await jsonFile(reportPath);
  const rootBytes = new Uint8Array(await readFile(path.join(bundle, "canonical-shell.html")));
  const rootIntegrity = await integrityOf(rootBytes);
  if (rootIntegrity.digest !== report.verification.localRootIntegrity.digest || rootIntegrity.byteLength !== report.verification.localRootIntegrity.byteLength) fail("canonical-shell.html does not match the preparation report.");
  let offset = 0;
  const files = [];
  const composition = report.verification.composition;
  for (let index = 0; index < composition.length; index += 1) {
    const part = composition[index];
    const bytes = rootBytes.slice(offset, offset + part.byteLength);
    offset += part.byteLength;
    const actual = await integrityOf(bytes);
    if (actual.digest !== part.integrity.digest || actual.byteLength !== part.integrity.byteLength) fail(`Canonical shell part ${index} failed its reported integrity.`);
    let fileName;
    let mediaType;
    if (part.role === "shell-prefix") { fileName = "index.html"; mediaType = "text/html"; }
    else if (part.role === "shell-suffix") { fileName = "shell-suffix.html"; mediaType = "text/html"; }
    else if (part.role === "module") { fileName = "runtime-module.js"; mediaType = "application/javascript"; }
    else if (part.role === "entrypoint") { fileName = "animation-entry.html"; mediaType = "text/html"; }
    else { fileName = `asset-${index}.fragment`; mediaType = "application/octet-stream"; }
    files.push({ path: fileName, bytes, mediaType, integrity: actual });
  }
  if (offset !== rootBytes.byteLength) fail("Canonical shell composition did not consume the complete root.");
  const directory = {
    manifest: {},
    integrity: rootIntegrity,
    files,
  };
  const profile = {
    protocol: "keel-measured-read-profile@1",
    network: `tezos:${report.network.identity ?? KEEL_TEZOS_PUBLICATION_NETWORK}`,
    contract: DUMMY_HOLD,
    reader: "onchfs-compatible-view@1",
    measuredAt: new Date().toISOString(),
    pinnedBlock: "not-selected",
    maxFileBytes: 4_000_000,
    maxDirectoryBytes: 8_000_000,
    maxFiles: 64,
    evidenceDigest: rootIntegrity.digest,
  };
  const carrier = await buildKeelOnchfsCarrier(directory, profile);
  const rawCarrier = await buildRawHarnessOverlay(files);
  const bindings = Object.fromEntries(carrier.document.keelObjects.map((item) => [item.path, item]));
  const rawBindings = Object.fromEntries(rawCarrier.document.keelObjects.map((item) => [item.path, item]));
  const prefix = bindings["index.html"];
  const suffix = bindings["shell-suffix.html"];
  const rawPrefix = rawBindings["index.html"];
  const rawSuffix = rawBindings["shell-suffix.html"];
  if (prefix === undefined || suffix === undefined || rawPrefix === undefined || rawSuffix === undefined) fail("Carrier did not preserve shell prefix and suffix bindings.");
  const slotObjects = files.slice(1, -1).map((item) => bindings[item.path]);
  const rawSlotObjects = files.slice(1, -1).map((item) => rawBindings[item.path]);
  if (slotObjects.some((item) => item === undefined) || rawSlotObjects.some((item) => item === undefined)) fail("Carrier lost a canonical shell slot binding.");
  const slotBytes = new Uint8Array(files.slice(1, -1).reduce((sum, item) => sum + item.bytes.byteLength, 0));
  let slotOffset = 0;
  for (const item of files.slice(1, -1)) { slotBytes.set(item.bytes, slotOffset); slotOffset += item.bytes.byteLength; }
  const slotIntegrity = await integrityOf(slotBytes);
  const salt = (await integrityOf(utf8ToBytes("keel.tezos.one-of-one.shadow-net.v1"))).digest;
  return { report, rootBytes, rootIntegrity, carrier, rawCarrier, bindings, rawBindings, prefix, suffix, rawPrefix, rawSuffix, slotObjects, rawSlotObjects, slotIntegrity, salt, profile };
}

async function contractArtifacts(bundle, artifactRoot) {
  const names = ["hold", "index", "shell", "collection"];
  const artifacts = {};
  for (const name of names) {
    const directory = path.join(artifactRoot, `one_of_one_${name}`);
    const [code, storage] = await Promise.all([
      jsonFile(path.join(directory, "contract.json")),
      jsonFile(path.join(directory, "storage.json")),
    ]);
    artifacts[name] = {
      key: name,
      label: `Keel ${name}`,
      dependency: name === "shell" ? "hold" : name === "collection" ? "index" : undefined,
      script: { code, storage },
      paths: { code: path.join(directory, "contract.tz"), storage: path.join(directory, "storage.json") },
    };
  }
  return artifacts;
}

function templateDestination(operation, destination) {
  return { ...operation, destination };
}

function templateCollectionAddress(value) {
  if (Array.isArray(value)) return value.map((item) => templateCollectionAddress(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, templateCollectionAddress(child)]));
  return value === DUMMY_COLLECTION ? "${receipt:collection}" : value;
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one:plan -- --bundle DIR --creator tz... [--output FILE] [--network Net...] [--rpc URL]\n");
    return;
  }
  assertFlags(argv);
  const bundle = path.resolve(valueAfter("--bundle", argv) ?? DEFAULT_BUNDLE);
  const output = path.resolve(valueAfter("--output", argv) ?? path.join(bundle, "shadow-net-publication-plan.json"));
  const creator = valueAfter("--creator", argv) ?? DUMMY_SOURCE;
  const network = valueAfter("--network", argv) ?? KEEL_TEZOS_PUBLICATION_NETWORK;
  const rpc = valueAfter("--rpc", argv) ?? KEEL_TEZOS_PUBLICATION_RPC;
  const report = await jsonFile(path.join(bundle, "keel-tezos-one-of-one.json"));
  const artifactRoot = path.join(bundle, "tezos-contracts");
  const [prepared, artifacts, chain] = await Promise.all([
    readBundle(bundle),
    contractArtifacts(bundle, artifactRoot),
    new KeelTezosPublicationAdapter({ rpcUrl: rpc, network }).preflight(creator),
  ]);
  const originations = buildTezosOneOfOneOriginations({ creator, network, artifacts });
  const carrierOperations = buildKeelHoldCarrierOperations({ hold: DUMMY_HOLD, source: creator, document: prepared.carrier.document });
  const rawCarrierOperations = buildKeelHoldCarrierOperations({ hold: DUMMY_HOLD, source: creator, document: prepared.rawCarrier.document });
  const holdOperations = [...carrierOperations, ...rawCarrierOperations].map((operation) => templateDestination(operation, "${receipt:hold}"));
  const configure = buildKeelHoldConfigureVerifier({ hold: DUMMY_HOLD, source: creator, prefixObjectId: prepared.rawPrefix.objectId, suffixObjectId: prepared.rawSuffix.objectId });
  const forge = buildKeelForgeHarness({ hold: DUMMY_HOLD, source: creator, salt: prepared.salt, slotObjectIds: prepared.rawSlotObjects.map((item) => item.objectId), manifestSha256: prepared.slotIntegrity.digest });
  const register = templateCollectionAddress(buildKeelIndexRegisterCollection({ index: DUMMY_INDEX, source: creator, collection: DUMMY_COLLECTION }));
  const manifestUri = `keel+tezos://${network}/${"${receipt:hold}"}/harness/${"${receipt:harnessId}"}`;
  const presentation = buildKeelCollectionPresentation({ collection: DUMMY_COLLECTION, source: creator, manifestUri, manifestDigest: prepared.rootIntegrity.digest });
  const publish = templateCollectionAddress(buildKeelIndexPublishCollection({ index: DUMMY_INDEX, source: creator, collection: DUMMY_COLLECTION, manifestUri, manifestDigest: prepared.rootIntegrity.digest }));
  const activate = templateCollectionAddress(buildKeelIndexActivateCollection({ index: DUMMY_INDEX, source: creator, collection: DUMMY_COLLECTION }));
  const setMinter = buildKeelCollectionSetMinter({ collection: DUMMY_COLLECTION, source: creator });
  const strike = buildKeelCollectionStrike({ collection: DUMMY_COLLECTION, source: creator });
  const unresolved = ["${receipt:hold}", "${receipt:index}", "${receipt:collection}", "${receipt:harnessId}"];
  const plan = {
    schema: KEEL_TEZOS_PUBLICATION_PROTOCOL,
    status: "review-only",
    family: "tezos",
    network: { identity: network, rpc, chainId: chain.chainId, head: chain.head, balanceMutez: chain.balanceMutez, preflight: "read-only" },
    expectedSender: creator,
    source: "wallet-approval-required",
    signing: "not-performed",
    submission: "not-performed",
    collection: { standard: "FA2", editionSize: 1, selectedAddress: null, tokenId: 1, addressBinding: "${receipt:collection}" },
    contractArtifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, { label: value.label, codePath: value.paths.code, storagePath: value.paths.storage, dependency: value.dependency ?? null }])),
    standardModules: { catalog: "packages/sdk/src/tezos-modules.generated.ts", selected: ["keel-hold-onchfs", "keel-index", "keel-harness-builder", "keel-collection-fa2"], notSelected: [{ key: "keel-manager", reason: "not required for this direct 1/1 mint" }, { key: "keel-mint-gate", reason: "direct creator-controlled 1/1 mint keeps the standard gate out of the first publication" }, { key: "one-mint-controller", reason: "not required for the direct strike path" }] },
    artifact: { rootIntegrity: prepared.rootIntegrity, rootByteLength: prepared.rootBytes.byteLength, slotIntegrity: prepared.slotIntegrity, slotObjectCount: prepared.rawSlotObjects.length, prefixObjectId: prepared.rawPrefix.objectId, suffixObjectId: prepared.rawSuffix.objectId, carrier: prepared.carrier.receipt, rawHarnessOverlay: { protocol: "keel-tezos-raw-harness-overlay@1", files: prepared.rawCarrier.document.keelObjects.map((item) => ({ path: item.path, objectId: item.objectId, fileCid: item.fileCid, compression: item.compression })), operations: rawCarrierOperations.length }, localPreview: path.join(bundle, "preview.html") },
    originations,
    stages: [
      { id: "carrier-objects", after: ["${receipt:hold}"], operationCount: holdOperations.length, operations: holdOperations, readback: ["hold.get_object for every canonical shell part", "hold.read_file for every bound file", "hold.get_verifier"] },
      { id: "configure-and-forge", after: ["${receipt:hold}"], operations: [templateDestination(configure, "${receipt:hold}"), templateDestination(forge, "${receipt:hold}")], expected: { harnessManifestSha256: prepared.slotIntegrity.digest, harnessId: "${receipt:harnessId}", exactRootIntegrity: prepared.rootIntegrity.digest }, readback: ["hold.get_harness(${receipt:harnessId})", "hold.harness_html(${receipt:harnessId}) equals canonical-shell.html"] },
      { id: "collection-and-index", after: ["${receipt:index}", "${receipt:collection}", "${receipt:harnessId}"], operations: [templateDestination(register, "${receipt:index}"), templateDestination(presentation, "${receipt:collection}"), templateDestination(setMinter, "${receipt:collection}"), templateDestination(publish, "${receipt:index}"), templateDestination(activate, "${receipt:index}"), templateDestination(strike, "${receipt:collection}")], readback: ["index.active_collection_revision(${receipt:collection})", "collection storage: max_supply=1 and token 1 owned by creator", "collection default presentation digest equals canonical root digest"] },
    ],
    readback: { required: true, unresolvedBindings: unresolved, rpcChecks: ["chain_id", "head header", "operation contents and internal operation results", "contract storage", "run_script_view hold.harness_html"], exactBrowserCheck: "local canonical verification shell preview must remain data-verification=verified and GIF state=ready" },
    blocker: "No chain address, wallet receipt, selected publication contract, or view readback exists yet. Replace every ${receipt:*} binding from the wallet's applied operation receipts before signing the next stage.",
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output, status: plan.status, chain: plan.network, carrierOperations: holdOperations.length, slotObjects: plan.artifact.slotObjectCount, unresolvedBindings: plan.readback.unresolvedBindings }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
