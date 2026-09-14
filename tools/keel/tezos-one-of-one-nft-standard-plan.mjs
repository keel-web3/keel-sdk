#!/usr/bin/env node
/**
 * Build the receipt-bound standard Tezos NFT plan for a prepared KEEL 1/1.
 *
 * The public route is ordinary FA2/TZIP metadata whose artifact and animation
 * fields point to standard OnchFS file CIDs.  The KEEL harness is retained as
 * a compatibility/readback route over the same canonical shell.  This command
 * is review-only: it reads the selected chain, prepares wallet operations, and
 * never signs or submits them.
 */
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, createIntegrity, utf8ToBytes } from "@keel/protocol";
import { concatHex, keccak256 } from "viem";
import {
  KEEL_TEZOS_ADMIN_PLACEHOLDER,
  KEEL_TEZOS_PUBLICATION_NETWORK,
  KEEL_TEZOS_PUBLICATION_PROTOCOL,
  KEEL_TEZOS_PUBLICATION_RPC,
  KEEL_TEZOS_STANDARD_MODULES,
  KeelTezosPublicationAdapter,
  planKeelTezosStandardRoute,
  buildKeelCollectionFreezeTokenMetadata,
  buildKeelCollectionPresentation,
  buildKeelCollectionSetTokenJson,
  buildKeelCollectionSetTokenMetadata,
  buildKeelCollectionSetMinter,
  buildKeelCollectionStrike,
  buildKeelHoldCarrierOperations,
  buildKeelIndexActivateCollection,
  buildKeelIndexPublishCollection,
  buildKeelIndexRegisterCollection,
  prepareTezosDependentOriginations,
} from "../../packages/sdk/dist/index.js";

const DEFAULT_BUNDLE = "/Users/ravonus/.codex/visualizations/2026/09/08/01a07ece-e1bd-76c1-867d-0187e66f986f/keel-tezos-one-of-one-q45-standard-eth-modules-v1";
const DUMMY_COLLECTION = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton";
const COLLECTION_BINDING = "${receipt:collection}";
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

function fail(message) { throw new TypeError(message); }

function valueAfter(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail(`${flag} requires a value.`);
  return value;
}

function assertFlags(argv) {
  const withValues = new Set([
    "--bundle", "--output", "--foundation-receipts", "--creator", "--network", "--rpc",
    "--ipfs-animation", "--ipfs-display", "--ipfs-metadata",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    if (!withValues.has(argv[index])) fail(`Unsupported option: ${argv[index]}`);
    index += 1;
  }
}

async function jsonFile(file) { return JSON.parse(await readFile(file, "utf8")); }

function bytesHex(value) { return `0x${Buffer.from(value).toString("hex")}`; }
function pair(left, right) { return { prim: "Pair", args: [left, right] }; }

function bytesResult(value) {
  if (value && typeof value === "object" && typeof value.bytes === "string") return value.bytes.replace(/^0x/u, "").toLowerCase();
  if (value && typeof value === "object" && value.data !== undefined) return bytesResult(value.data);
  throw new Error("Tezos view did not return Micheline bytes.");
}

function containsBytes(value, expected) {
  if (Array.isArray(value)) return value.some((item) => containsBytes(item, expected));
  if (!value || typeof value !== "object") return false;
  if (typeof value.bytes === "string" && value.bytes.replace(/^0x/u, "").toLowerCase() === expected.replace(/^0x/u, "").toLowerCase()) return true;
  return Object.values(value).some((item) => containsBytes(item, expected));
}

function replaceCollection(value) {
  if (Array.isArray(value)) return value.map(replaceCollection);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceCollection(child)]));
  return value === DUMMY_COLLECTION ? COLLECTION_BINDING : value;
}

async function buildOnchfsFile(file) {
  const chunkSize = 16_384;
  const inscriptions = [];
  const chunks = [];
  for (let offset = 0; offset < file.bytes.byteLength; offset += chunkSize) {
    const content = bytesHex(file.bytes.slice(offset, offset + chunkSize));
    const hash = keccak256(content);
    chunks.push({ content: content.slice(2), hash: hash.slice(2) });
    inscriptions.push({ type: "chunk", content: content.slice(2), hash: hash.slice(2) });
  }
  const contentHash = keccak256(concatHex(chunks.map((chunk) => `0x${chunk.content}`)));
  const fileCid = keccak256(concatHex(["0x01", contentHash, keccak256("0x")]));
  const manifestValue = {
    protocol: "keel-tezos-onchfs-binding@1",
    path: file.path,
    decoded: {
      algorithm: "sha256",
      digest: file.integrity.digest,
      byteLength: file.bytes.byteLength,
      mediaType: file.mediaType,
    },
    carrier: {
      kind: "onchfs",
      fileCid,
      storedIntegrity: file.integrity,
      compression: "none",
    },
  };
  const manifestBytes = utf8ToBytes(canonicalJson(manifestValue));
  const manifestIntegrity = await createIntegrity(manifestBytes);
  return {
    file,
    fileCid,
    uri: `onchfs://${fileCid.slice(2)}`,
    document: {
      inscriptions: [
        ...inscriptions,
        { type: "file", cid: fileCid.slice(2), metadata: "", chunks: chunks.map((chunk) => chunk.hash) },
      ],
      keelObjects: [{
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
      }],
    },
  };
}

async function assertSharedFoundation({ bundle, foundation, creator, network, rpc, report }) {
  if (foundation.status !== "published-and-read-back") fail("The existing KEEL foundation receipt is not a completed read-back journal.");
  if (foundation.expectedSender !== creator) fail("The foundation creator does not match the NFT creator.");
  if (foundation.network?.identity !== network || foundation.network?.rpc !== rpc) fail("The existing foundation was not published on the selected Shadow Net.");
  const bindings = foundation.bindings ?? {};
  for (const name of ["hold", "index", "shell", "harnessId"]) {
    if (typeof bindings[name] !== "string" || bindings[name].length === 0) fail(`Foundation receipt is missing ${name}.`);
  }
  const rootBytes = new Uint8Array(await readFile(path.join(bundle, "canonical-shell.html")));
  const rootIntegrity = await createIntegrity(rootBytes);
  if (rootIntegrity.digest !== report.verification.localRootIntegrity.digest || rootIntegrity.byteLength !== report.verification.localRootIntegrity.byteLength) fail("canonical-shell.html does not match the local KEEL report.");
  const adapter = new KeelTezosPublicationAdapter({ rpcUrl: rpc, network });
  const html = Buffer.from(bytesResult(await adapter.view(bindings.hold, "harness_html", { bytes: bindings.harnessId.replace(/^0x/u, "") })), "hex");
  if (!Buffer.from(rootBytes).equals(html)) fail("The shared Hold harness does not read back as the local canonical verification shell.");
  const activeRevision = await adapter.view(bindings.index, "active_revision", pair({ string: bindings.collection }, { int: "1" }));
  if (!containsBytes(activeRevision, rootIntegrity.digest)) fail("The shared Index does not read back the canonical root digest.");
  return { adapter, bindings, rootBytes, rootIntegrity, compatibilityUri: `keel+tezos://${network}/${bindings.hold}/harness/${bindings.harnessId}` };
}

async function main() {
  const rawArgv = process.argv.slice(2);
  const argv = rawArgv[0] === "--" ? rawArgv.slice(1) : rawArgv;
  if (argv.length === 0 || argv.includes("--help")) {
    process.stdout.write("Usage: pnpm keel:tezos-one-of-one:nft:plan -- --bundle DIR --creator tz... [--foundation-receipts FILE] [--output FILE] [--network Net...] [--rpc URL]\n");
    return;
  }
  assertFlags(argv);
  const bundle = path.resolve(valueAfter("--bundle", argv) ?? DEFAULT_BUNDLE);
  const foundationPath = path.resolve(valueAfter("--foundation-receipts", argv) ?? path.join(bundle, "shadow-net-publication-receipts.json"));
  const output = path.resolve(valueAfter("--output", argv) ?? path.join(bundle, "shadow-net-nft-standard-publication-plan.json"));
  const foundation = await jsonFile(foundationPath);
  const report = await jsonFile(path.join(bundle, "keel-tezos-one-of-one.json"));
  const creator = valueAfter("--creator", argv) ?? foundation.expectedSender;
  const network = valueAfter("--network", argv) ?? KEEL_TEZOS_PUBLICATION_NETWORK;
  const rpc = valueAfter("--rpc", argv) ?? KEEL_TEZOS_PUBLICATION_RPC;
  const shared = await assertSharedFoundation({ bundle, foundation, creator, network, rpc, report });
  const preflight = await shared.adapter.preflight(creator);
  if (preflight.balanceMutez === "0") fail("The Tezos creator has no Shadow Net balance.");

  const artifactDirectory = path.join(bundle, "tezos-contracts", "one_of_one_standard_collection");
  const [code, storage, poster, posterInfo] = await Promise.all([
    jsonFile(path.join(artifactDirectory, "contract.json")),
    jsonFile(path.join(artifactDirectory, "storage.json")),
    readFile(path.join(artifactDirectory, "display.jpg")),
    stat(path.join(artifactDirectory, "display.jpg")),
  ]);
  if (posterInfo.size !== poster.byteLength || posterInfo.size < 1) fail("The prepared NFT poster is missing or empty.");

  const ipfsFallback = {
    animation: valueAfter("--ipfs-animation", argv) ?? null,
    display: valueAfter("--ipfs-display", argv) ?? null,
    metadata: valueAfter("--ipfs-metadata", argv) ?? null,
    status: ["--ipfs-animation", "--ipfs-display", "--ipfs-metadata"].every((flag) => valueAfter(flag, argv) !== undefined) ? "declared" : "not-supplied",
  };
  const suppliedIpfsValues = [ipfsFallback.animation, ipfsFallback.display, ipfsFallback.metadata].filter((value) => value !== null);
  if (suppliedIpfsValues.length !== 0 && suppliedIpfsValues.length !== 3) fail("Declare all three IPFS fallback URIs together: --ipfs-animation, --ipfs-display, and --ipfs-metadata.");

  const posterIntegrity = await createIntegrity(new Uint8Array(poster));
  const animationFile = await buildOnchfsFile({ path: "animation.html", bytes: shared.rootBytes, mediaType: "text/html", integrity: shared.rootIntegrity });
  const displayFile = await buildOnchfsFile({ path: "display.jpg", bytes: new Uint8Array(poster), mediaType: "image/jpeg", integrity: posterIntegrity });
  const tokenJsonPlaceholder = {
    name: "KEEL Tezos 1/1",
    symbol: "KEEL",
    decimals: 0,
    description: "A creator-owned native Tezos one-of-one using the standard FA2/TZIP metadata path, standard OnchFS bytes, and the shared KEEL verification shell.",
    creators: [creator],
    minter: creator,
    mintingTool: "KEEL SDK Tezos native FA2 collection",
    image: displayFile.uri,
    displayUri: displayFile.uri,
    thumbnailUri: displayFile.uri,
    artifactUri: animationFile.uri,
    animation_url: animationFile.uri,
    keelArtifactUri: shared.compatibilityUri,
    keelViewer: { view: "harness_html", contract: shared.bindings.hold, harnessId: shared.bindings.harnessId },
    canonicalSha256: shared.rootIntegrity.digest,
    canonicalByteLength: shared.rootIntegrity.byteLength,
    selectedCarrier: "onchfs",
    carrierFallback: ipfsFallback.status === "declared"
      ? { kind: "ipfs", animation: ipfsFallback.animation, display: ipfsFallback.display, metadata: ipfsFallback.metadata, verification: "pending-equal-sha256-readback" }
      : null,
    formats: [
      { uri: displayFile.uri, mimeType: "image/jpeg", fileSize: posterInfo.size, hash: posterIntegrity.digest },
      { uri: animationFile.uri, mimeType: "text/html", fileSize: shared.rootBytes.byteLength, hash: shared.rootIntegrity.digest },
    ],
    interfaces: ["TZIP-12", "TZIP-16", "TZIP-21"],
  };
  const tokenJson = canonicalJson(tokenJsonPlaceholder);
  const tokenJsonBytes = utf8ToBytes(tokenJson);
  const tokenJsonIntegrity = await createIntegrity(tokenJsonBytes);
  const finalTokenJsonFile = await buildOnchfsFile({ path: "token-1.json", bytes: tokenJsonBytes, mediaType: "application/json", integrity: tokenJsonIntegrity });
  const inlineAnimationUri = `data:text/html,${encodeURIComponent(Buffer.from(shared.rootBytes).toString("utf8"))}`;
  const presentationPolicy = planKeelTezosStandardRoute({
    network,
    originalAssetByteLength: shared.rootBytes.byteLength,
    compressedAssetByteLength: shared.rootBytes.byteLength,
    completeInlineByteLength: Buffer.byteLength(inlineAnimationUri, "utf8"),
    // The receipt-backed foundation is a native KEEL harness, not proof of a
    // Tezos inline tokenURI builder.  The policy therefore fails closed to
    // Hybrid for this route until that selected-chain builder is read back.
    builderConfigured: false,
    bootShellCompression: "none",
    mediaType: "text/html",
  });

  const tokenInfo = {
    "": finalTokenJsonFile.uri,
    name: tokenJsonPlaceholder.name,
    symbol: tokenJsonPlaceholder.symbol,
    decimals: "0",
    artifactUri: animationFile.uri,
    animation_url: animationFile.uri,
    displayUri: displayFile.uri,
    thumbnailUri: displayFile.uri,
    mimeType: "text/html",
    keelArtifactUri: shared.compatibilityUri,
    keelViewerDigest: shared.rootIntegrity.digest,
    canonicalSha256: shared.rootIntegrity.digest,
    selectedCarrier: "onchfs",
    ...(ipfsFallback.status === "declared" ? {
      ipfsArtifactUri: ipfsFallback.animation,
      ipfsDisplayUri: ipfsFallback.display,
      ipfsMetadataUri: ipfsFallback.metadata,
    } : {}),
  };

  const carrierDocument = {
    inscriptions: [
      ...animationFile.document.inscriptions,
      ...displayFile.document.inscriptions,
      ...finalTokenJsonFile.document.inscriptions,
    ],
    keelObjects: [
      ...animationFile.document.keelObjects,
      ...displayFile.document.keelObjects,
      ...finalTokenJsonFile.document.keelObjects,
    ],
  };
  const carrierOperations = buildKeelHoldCarrierOperations({ hold: shared.bindings.hold, source: creator, document: carrierDocument });

  const collectionArtifact = {
    key: "collection",
    label: "KeelCollectionFA2 standard one-of-one",
    dependency: "index",
    script: { code, storage },
  };
  const collectionOrigination = prepareTezosDependentOriginations(
    { creator, network, artifacts: { collection: collectionArtifact } },
    { index: shared.bindings.index },
    ["collection"],
  )[0];
  const presentation = replaceCollection(buildKeelCollectionPresentation({ collection: DUMMY_COLLECTION, source: creator, manifestUri: animationFile.uri, manifestDigest: shared.rootIntegrity.digest, previewUri: displayFile.uri }));
  const register = replaceCollection(buildKeelIndexRegisterCollection({ index: shared.bindings.index, source: creator, collection: DUMMY_COLLECTION, controller: creator }));
  const publish = replaceCollection(buildKeelIndexPublishCollection({ index: shared.bindings.index, source: creator, collection: DUMMY_COLLECTION, manifestUri: animationFile.uri, manifestDigest: shared.rootIntegrity.digest }));
  const activate = replaceCollection(buildKeelIndexActivateCollection({ index: shared.bindings.index, source: creator, collection: DUMMY_COLLECTION, revision: 1 }));
  const setMinter = replaceCollection(buildKeelCollectionSetMinter({ collection: DUMMY_COLLECTION, source: creator, account: creator }));
  const strike = replaceCollection(buildKeelCollectionStrike({ collection: DUMMY_COLLECTION, source: creator, recipient: creator, quantity: 1 }));
  const setMetadata = replaceCollection(buildKeelCollectionSetTokenMetadata({ collection: DUMMY_COLLECTION, source: creator, tokenId: 1, tokenInfo }));
  const setJson = replaceCollection(buildKeelCollectionSetTokenJson({ collection: DUMMY_COLLECTION, source: creator, tokenId: 1, value: tokenJson }));
  const freezeToken = replaceCollection(buildKeelCollectionFreezeTokenMetadata({ collection: DUMMY_COLLECTION, source: creator, tokenId: 1 }));
  const freezeDefault = replaceCollection({ kind: "transaction", amount: "0", destination: DUMMY_COLLECTION, parameters: { entrypoint: "freeze_default_presentation", value: { prim: "Unit" } } });

  const plan = {
    schema: "keel.tezos.native-nft-publication-plan@2",
    status: "review-only",
    family: "tezos",
    network: { identity: network, rpc, chainId: preflight.chainId, head: preflight.head, balanceMutez: preflight.balanceMutez, preflight: "read-only" },
    expectedSender: creator,
    source: "canonical KeelCollectionFA2 plus shared KeelHoldOnchFS foundation",
    signing: "not-performed",
    submission: "not-performed",
    collection: { standard: "FA2 NFT / TZIP-12 token_metadata view", contractPrototype: "KeelCollectionFA2", editionSize: 1, selectedAddress: null, tokenId: 1, addressBinding: COLLECTION_BINDING },
    contractArtifacts: { nftCollection: { label: collectionArtifact.label, codePath: path.join(artifactDirectory, "contract.json"), storagePath: path.join(artifactDirectory, "storage.json"), prototypePath: path.join(artifactDirectory, "prototype.json") } },
    standardModules: {
      catalog: "packages/sdk/src/tezos-modules.generated.ts",
      selected: KEEL_TEZOS_STANDARD_MODULES,
      publicRoute: "FA2/TZIP-12 token_metadata -> onchfs://<hex file CID>",
      keelRoute: "KeelHoldOnchFS.harness_html(harnessId)",
      compatibility: "KeelSleeve.token_uri -> token_json -> standard JSON data URI",
    },
    presentationPolicy,
    reuse: {
      foundationReceipt: foundationPath,
      hold: shared.bindings.hold,
      index: shared.bindings.index,
      shell: shared.bindings.shell,
      historicalCollection: foundation.bindings.collection ?? null,
      harnessId: shared.bindings.harnessId,
      canonicalRootDigest: shared.rootIntegrity.digest,
      canonicalShell: path.join(bundle, "canonical-shell.html"),
    },
    carriers: {
      selected: "onchfs",
      animation: { uri: animationFile.uri, fileCid: animationFile.fileCid, sha256: shared.rootIntegrity.digest, byteLength: shared.rootBytes.byteLength },
      display: { uri: displayFile.uri, fileCid: displayFile.fileCid, sha256: posterIntegrity.digest, byteLength: poster.byteLength },
      metadata: { uri: finalTokenJsonFile.uri, fileCid: finalTokenJsonFile.fileCid, sha256: tokenJsonIntegrity.digest, byteLength: tokenJsonBytes.byteLength },
      ipfsFallback,
      migration: { stableIdentity: ["collection", "tokenId", "canonicalSha256", "decodedByteLength"], gate: "read both carriers and require equal decoded SHA-256 and byte length before changing token_info" },
    },
    artifact: { rootIntegrity: shared.rootIntegrity, rootByteLength: shared.rootBytes.byteLength, localPreview: path.join(bundle, "preview.html") },
    originations: { stages: [{ id: "originate-collection", purpose: "Originate the canonical Tezos FA2 one-of-one collection after the shared index receipt is known.", operations: [{ label: collectionArtifact.label, artifact: "nftCollection", dependsOn: ["index"], operation: collectionOrigination }] }], addressBindings: [{ name: "collection", source: "operation-receipt", requiredBefore: "collection-metadata-and-mint" }] },
    stages: [
      { id: "standard-onchfs-carrier", after: [], operations: carrierOperations, readback: ["hold.read_file(animationFileCid) equals canonical-shell.html", "hold.read_file(displayFileCid) equals reviewed poster", "hold.read_file(metadataFileCid) equals reviewed FA2 JSON", "every object manifest and SHA-256 matches"] },
      { id: "collection-metadata-and-mint", after: [COLLECTION_BINDING], operations: [setMinter, strike, presentation, setMetadata, setJson, freezeToken, freezeDefault], readback: ["collection.token_metadata(1) exposes ordinary standard fields", "token_info[animation_url] is onchfs:// and never keel+tezos://", "collection.token_json(1) equals the standard JSON", "token 1 balance belongs to creator", "metadata weld is frozen"] },
      { id: "index-and-activate", after: [COLLECTION_BINDING], operations: [register, publish, activate], readback: ["index.active_revision(new collection)", "index revision carries the standard onchfs:// route and canonical digest"] },
    ],
    readback: { required: true, unresolvedBindings: [COLLECTION_BINDING], rpcChecks: ["chain_id", "head header", "operation contents and internal operation results", "collection.token_metadata view", "collection.token_json view", "hold.read_file", "hold.harness_html", "index.active_revision"], exactCanonicalShell: true, localPreview: path.join(bundle, "preview.html") },
    blocker: "The collection address remains unresolved until the wallet applies the canonical FA2 origination. No signing or submission was performed; bind the collection only from that receipt, then run every listed readback before freezing or publishing.",
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(bundle, "tezos-standard-token-metadata.json"), `${tokenJson}\n`, { flag: "wx" });
  await copyFile(path.join(SCRIPT_DIRECTORY, "tezos-standard-carrier-viewer.html"), path.join(bundle, "tezos-standard-carrier-viewer.html"));
  process.stdout.write(`${JSON.stringify({ output, status: plan.status, network: plan.network, selectedCarrier: plan.carriers.selected, carrierOperations: carrierOperations.length, unresolvedBindings: plan.readback.unresolvedBindings }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
