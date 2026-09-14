#!/usr/bin/env node
/**
 * Publish the current KEEL animated piece as a fresh Ethereum Sepolia 1/1.
 *
 * The heavy AVIF carrier, timing data, palette, and GIF reconstruction module
 * are native KeelHold objects.  The contract stores only the small canonical
 * RPC-backed KEEL viewer as its harness, so the ERC-721 remains readable by
 * ordinary metadata consumers without pretending a 1.97 MB carrier is a
 * compact inline tokenURI.
 *
 * Read-only planning is the default.  Execution requires both:
 *   KEEL_SEPOLIA_HYBRID_EXECUTE=1
 *   KEEL_SEPOLIA_HYBRID_PRIVATE_KEY=0x...
 *
 * The key is never written to the journal or printed.  The supplied signer
 * must match the existing Sepolia KEEL mint lane.  The default is the project
 * signer used by the earlier one-mint workflow; an explicit executor override
 * remains available for another reviewed lane.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  buildStandaloneKeelViewer,
} from "@keel/sdk/verification-shell";
import { keelHoldAbi, keelIndexAbi, keel721Abi } from "@keel/sdk/abi";
import { keelWeb3ObjectURI } from "@keel/sdk/presentation";
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  stringToHex,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const chainId = 11_155_111;
const repositoryRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const bundleRoot = process.env.KEEL_SEPOLIA_HYBRID_BUNDLE?.trim()
  || "/Users/ravonus/.codex/visualizations/2026/09/08/01a07ece-e1bd-76c1-867d-0187e66f986f/keel-tezos-one-of-one-q45-standard-eth-modules-v1";
const rpcUrl = process.env.KEEL_SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com";
const viewerRpcUrl = process.env.KEEL_SEPOLIA_HYBRID_VIEWER_RPC_URL?.trim() || rpcUrl;
const execute = process.env.KEEL_SEPOLIA_HYBRID_EXECUTE === "1";
const store = getAddress(process.env.KEEL_SEPOLIA_KEEL_HOLD?.trim() || "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267");
const builder = getAddress(process.env.KEEL_SEPOLIA_HARNESS_BUILDER?.trim() || "0x63a172ae55a6c7413a2f80be9de9cd9cb106973d");
const factory = getAddress(process.env.KEEL_SEPOLIA_FACTORY?.trim() || "0xBE2342F18e26E443e8c22B92F8F17a30933A3dF2");
const keelIndex = getAddress(process.env.KEEL_SEPOLIA_INDEX?.trim() || "0x2b706ded15fb27a582da256321f2b3295413b8ac");
const executorAddress = getAddress(process.env.KEEL_SEPOLIA_EXECUTOR?.trim() || "0x5E2a993c132A6869b9e636D139E1Ba698F7918F0");
const recipient = getAddress(process.env.KEEL_SEPOLIA_RECIPIENT?.trim() || "0x764E3EE7A844d9165937c41fd08086e43b997149");
const journalPath = path.join(bundleRoot, "sepolia-eth-keel-hybrid-one-of-one.journal.json");
const planPath = path.join(bundleRoot, "sepolia-eth-keel-hybrid-one-of-one.plan.json");

const publicClient = createPublicClient({ transport: http(rpcUrl, { timeout: 120_000, retryCount: 1 }) });
const holdAbi = parseAbi(keelHoldAbi);
const indexAbi = parseAbi(keelIndexAbi);
const collectionAbi = parseAbi([
  ...keel721Abi,
  "function collectionDescription() view returns (string)",
  "function defaultPresentationBinding() view returns (bytes32)",
  "function onchainHarnessBuilder() view returns (address)",
  "function onchainHarnessObjectId() view returns (bytes32)",
  "function onchainHarnessDigest() view returns (bytes32)",
  "function presentation(uint256 tokenId) view returns (string manifestURI,bytes32 manifestDigest,string previewImageURI)",
  "function presentationURI(uint256 tokenId) view returns (string)",
  "function presentationDigest(uint256 tokenId) view returns (bytes32)",
]);
const factoryAbi = parseAbi([
  "function creatorNonces(address creator) view returns (uint256)",
  "function predictDieAddress((string name,string symbol,address admin,address royaltyReceiver,uint96 royaltyBps,uint256 maxSupply,address mintManager,address keelIndex) config,address creator,uint256 nonce) view returns (address)",
  "function castDie((string name,string symbol,address admin,address royaltyReceiver,uint96 royaltyBps,uint256 maxSupply,address mintManager,address keelIndex) config) returns (address)",
]);
const builderAbi = parseAbi([
  "function harnessSourceValid(bytes32 objectId,bytes32 expectedDigest) view returns (bool)",
  "function harnessHTML(bytes32 objectId,bytes32 expectedDigest) view returns (string)",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(message);
}

async function standardInput() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

function sha256(bytes) {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

function tupleValue(value, name, index) {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === "object" && name in value) return value[name];
  return value?.[index];
}

function canonicalJson(value) {
  return JSON.stringify(value, (_key, child) => (
    child && typeof child === "object" && !Array.isArray(child)
      ? Object.fromEntries(Object.keys(child).sort().map((key) => [key, child[key]]))
      : child
  ));
}

function leafObjectId(input) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes1" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint8" },
      { type: "bytes32" },
    ],
    [
      "0x00",
      keccak256(concatHex(input.slugIds)),
      input.digest,
      BigInt(input.byteLength),
      BigInt(input.storedByteLength),
      input.compression,
      keccak256(stringToHex(input.mediaType)),
    ],
  ));
}

function objectIdentity(bytes, mediaType) {
  const payloads = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 23_000) {
    payloads.push(toHex(bytes.slice(offset, Math.min(bytes.byteLength, offset + 23_000))));
  }
  const digest = sha256(bytes);
  return {
    digest,
    objectId: leafObjectId({
      slugIds: payloads.map((payload) => keccak256(payload)),
      digest,
      byteLength: bytes.byteLength,
      storedByteLength: bytes.byteLength,
      compression: 0,
      mediaType,
    }),
    byteLength: bytes.byteLength,
    payloads,
  };
}

function parseEmbeddedBundleItems(source) {
  const marker = "globalThis.__KEEL_ITEMS__=";
  const start = source.indexOf(marker);
  if (start < 0) fail("The canonical KEEL animation bundle has no committed item graph.");
  const arrayStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let arrayEnd = -1;
  for (let index = arrayStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }
    if (character === "\"") {
      inString = true;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        arrayEnd = index + 1;
        break;
      }
    }
  }
  if (arrayEnd < 0) fail("The canonical KEEL animation item graph is truncated.");
  return JSON.parse(source.slice(arrayStart, arrayEnd)).filter(Boolean);
}

function decodeEmbeddedItem(item) {
  const stored = Buffer.from(item.embedded.storedBase64, "base64");
  if (item.embedded.compression === "gzip") return new Uint8Array(gunzipSync(stored));
  if (item.embedded.compression === "none") return new Uint8Array(stored);
  fail(`Unsupported local bundle compression for ${item.id}.`);
}

async function loadArtworkItems() {
  const shell = await readFile(path.join(bundleRoot, "canonical-shell.html"), "utf8");
  const embedded = new Map(parseEmbeddedBundleItems(shell).map((item) => [item.id, item]));
  const ids = ["keel.gif-encoder", "keel.animation", "keel.palette", "keel.timing", "keel.animation-entry"];
  const items = [];
  for (const id of ids) {
    const item = embedded.get(id);
    if (!item?.embedded) fail(`The current KEEL bundle is missing ${id}.`);
    const bytes = decodeEmbeddedItem(item);
    const digest = sha256(bytes);
    if (digest.toLowerCase() !== item.integrity.digest.toLowerCase() || bytes.byteLength !== item.integrity.byteLength) {
      fail(`${id} does not match its committed local integrity record.`);
    }
    items.push({
      id,
      role: item.role,
      mediaType: item.mediaType,
      aliases: item.aliases,
      bytes,
      integrity: { algorithm: "sha256", digest, byteLength: bytes.byteLength },
    });
  }
  return items;
}

async function readPoster() {
  const candidates = [
    path.join(bundleRoot, "tezos-contracts/one_of_one_standard_collection/display-preview.jpg"),
    path.join(bundleRoot, "tezos-contracts/one_of_one_nft_collection/display-preview.jpg"),
    path.join(bundleRoot, "tezos-contracts/one_of_one_standard_collection/display.jpg"),
    path.join(bundleRoot, "tezos-contracts/one_of_one_nft_collection/display.jpg"),
  ];
  for (const candidate of candidates) {
    const bytes = await readFile(candidate).catch(() => undefined);
    if (bytes !== undefined) return new Uint8Array(bytes);
  }
  fail("The committed display poster is missing from the current KEEL bundle.");
}

function configFor(collectionCreator) {
  return {
    name: "KEEL Ethereum Sepolia 1/1",
    symbol: "KEEL",
    admin: collectionCreator,
    royaltyReceiver: recipient,
    royaltyBps: 750,
    maxSupply: 1n,
    mintManager: collectionCreator,
    keelIndex,
  };
}

async function getFees() {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const gasPrice = await publicClient.getGasPrice();
  if (block.baseFeePerGas === null) return { gasPrice };
  const priority = gasPrice > 1_000_000_000n ? 1_000_000_000n : gasPrice;
  return { maxFeePerGas: block.baseFeePerGas * 2n + priority, maxPriorityFeePerGas: priority };
}

async function readReceipt(hash) {
  const immediate = await publicClient.getTransactionReceipt({ hash }).catch(() => undefined);
  if (immediate !== undefined) return immediate;
  return publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 240_000 });
}

async function writeJournal(journal) {
  await mkdir(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, journalPath);
}

async function objectMatches(identity, mediaType) {
  const object = await publicClient.readContract({
    address: store,
    abi: holdAbi,
    functionName: "getObject",
    args: [identity.objectId],
  }).catch(() => undefined);
  return object !== undefined
    && tupleValue(object, "digest", 0)?.toLowerCase() === identity.digest.toLowerCase()
    && tupleValue(object, "byteLength", 3) === BigInt(identity.byteLength)
    && tupleValue(object, "storedByteLength", 4) === BigInt(identity.byteLength)
    && tupleValue(object, "compression", 6) === 0
    && tupleValue(object, "composite", 7) === false
    && tupleValue(object, "exists", 8) === true
    && tupleValue(object, "mediaType", 9) === mediaType;
}

async function publishLeaf(label, bytes, mediaType, journal) {
  const identity = objectIdentity(bytes, mediaType);
  if (await objectMatches(identity, mediaType)) return identity;
  const carrierKey = `${label}:carriers`;
  for (let offset = 0; offset < identity.payloads.length; offset += 3) {
    const payloads = identity.payloads.slice(offset, offset + 3);
    const slugIds = payloads.map((payload) => keccak256(payload));
    const missing = [];
    for (let index = 0; index < payloads.length; index += 1) {
      const pointer = await publicClient.readContract({ address: store, abi: holdAbi, functionName: "slugPointer", args: [slugIds[index]] });
      if (pointer === "0x0000000000000000000000000000000000000000") missing.push(payloads[index]);
      else {
        const existing = await publicClient.readContract({ address: store, abi: holdAbi, functionName: "getSlug", args: [slugIds[index]] });
        if (!exactBytes(hexToBytes(existing), hexToBytes(payloads[index]))) fail(`${label} has a changed existing carrier.`);
      }
    }
    if (missing.length === 0) continue;
    await sendStep(`${carrierKey}:${offset / 3}`, async () => {
      const wallet = executionWallet;
      if (!wallet || !executionAccount) fail("Execution wallet is unavailable.");
      return wallet.writeContract({
        account: executionAccount,
        address: store,
        abi: holdAbi,
        functionName: "castSlugs",
        args: [missing],
        ...(await getFees()),
      });
    }, async () => (await Promise.all(slugIds.map((slugId) => publicClient.readContract({ address: store, abi: holdAbi, functionName: "slugPointer", args: [slugId] })))).every((pointer) => pointer !== "0x0000000000000000000000000000000000000000"), journal);
  }
  if (await objectMatches(identity, mediaType)) return identity;
  await sendStep(`${label}:weld:${identity.objectId}`, async () => {
    const wallet = executionWallet;
    if (!wallet || !executionAccount) fail("Execution wallet is unavailable.");
    return wallet.writeContract({
      account: executionAccount,
      address: store,
      abi: holdAbi,
      functionName: "weldObject",
      args: [identity.payloads.map((payload) => keccak256(payload)), identity.digest, BigInt(bytes.byteLength), 0, mediaType],
      ...(await getFees()),
    });
  }, () => objectMatches(identity, mediaType), journal);
  return identity;
}

async function sendStep(key, submit, complete, journal) {
  const saved = journal.steps[key];
  if (saved?.status === "confirmed") {
    if (!await complete()) fail(`Saved step ${key} no longer has exact read-back.`);
    return saved.activeHash;
  }
  if (!execute) return undefined;
  if (!executionWallet) fail("No execution signer is loaded.");
  if (saved?.status === "submitted") {
    const receipt = await readReceipt(saved.activeHash);
    if (receipt.status !== "success") fail(`Saved transaction ${saved.activeHash} failed.`);
    journal.steps[key] = { ...saved, status: "confirmed", blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), actualFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString() };
    await writeJournal(journal);
    if (!await complete()) fail(`Saved transaction ${saved.activeHash} succeeded but read-back failed.`);
    return saved.activeHash;
  }
  const hash = await submit();
  journal.steps[key] = { status: "submitted", activeHash: hash, transactionHashes: [hash] };
  await writeJournal(journal);
  const receipt = await readReceipt(hash);
  if (receipt.status !== "success") fail(`Transaction ${hash} failed.`);
  journal.steps[key] = { status: "confirmed", activeHash: hash, transactionHashes: [hash], blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), actualFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString() };
  await writeJournal(journal);
  if (!await complete()) fail(`Transaction ${hash} succeeded but exact read-back failed.`);
  return hash;
}

const readEnvKey = async (file, name) => readFile(file, "utf8")
  .then((source) => source.match(new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, "m"))?.[1]?.replace(/^(['"])(.*)\1$/u, "$2").trim())
  .catch(() => undefined);
const existingProjectSignerKey = execute
  ? (await readEnvKey("/Users/ravonus/dev/keel-contracts/.env.deployer", "KEEL_DEPLOYER_PK")
    || await readEnvKey("/Users/ravonus/dev/onchaininator/.env", "PRIVATE_KEY"))
  : undefined;
const privateKey = execute
  ? (process.env.KEEL_SEPOLIA_HYBRID_PRIVATE_KEY?.trim()
    || process.env.KEEL_SIX_MINT_PRIVATE_KEY?.trim()
    || existingProjectSignerKey
    || ((process.env.KEEL_SEPOLIA_HYBRID_PRIVATE_KEY_STDIN === "1" || process.env.KEEL_SIX_MINT_PRIVATE_KEY_STDIN === "1") ? await standardInput() : undefined))
  : undefined;
if (execute && !/^0x[0-9a-f]{64}$/iu.test(privateKey ?? "")) {
  fail("Execution requires KEEL_SEPOLIA_HYBRID_PRIVATE_KEY=0x...; no transaction was sent.");
}
const executionAccount = privateKey === undefined ? undefined : privateKeyToAccount(privateKey);
if (executionAccount && executionAccount.address.toLowerCase() !== executorAddress.toLowerCase()) {
  fail(`The supplied signer is ${executionAccount.address}, but the canonical Sepolia executor is ${executorAddress}; no transaction was sent.`);
}
const executionWallet = executionAccount === undefined
  ? undefined
  : createWalletClient({ account: executionAccount, chain: null, transport: http(rpcUrl, { timeout: 120_000, retryCount: 1 }) });

const [artworkItems, poster] = await Promise.all([loadArtworkItems(), readPoster()]);
const identities = artworkItems.map((item) => ({ item, identity: objectIdentity(item.bytes, item.mediaType) }));
const liveNonce = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "creatorNonces", args: [executorAddress] });
const config = configFor(executorAddress);
const collection = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "predictDieAddress", args: [config, executorAddress, liveNonce] });
const posterIdentity = objectIdentity(poster, "image/jpeg");
const previewImageURI = keelWeb3ObjectURI({
  chainId,
  storeAddress: store,
  objectId: posterIdentity.objectId,
  mediaType: "image/jpeg",
});
const rpcItems = identities.map(({ item, identity }) => ({
  id: item.id,
  role: item.role,
  mediaType: item.mediaType,
  aliases: item.aliases,
  integrity: item.integrity,
  chainId,
  store,
  objectId: identity.objectId,
}));
const viewer = await buildStandaloneKeelViewer({
  repositoryRoot,
  envelope: {
    protocol: "keel-standalone-viewer@1",
    title: config.name,
    deliveryProfile: "onchain-recursive",
    rpcUrls: [viewerRpcUrl],
    blockTag: "latest",
    entrypoint: "keel.animation-entry",
    runtimeExpectations: { minimumCanvasCount: 0 },
    items: rpcItems,
  },
  brotliDecoder: "disabled",
});
if (viewer.html.byteLength >= 2_000_000) fail(`The hybrid boot viewer is ${viewer.html.byteLength} bytes and exceeds the standard KEEL harness ceiling.`);
const viewerIdentity = objectIdentity(viewer.html, "text/html");
const manifestValue = {
  schema: "keel-sepolia-hybrid-one-of-one@1",
  chainId,
  collection,
  tokenId: "1",
  title: config.name,
  description: "A KEEL one-of-one animation using the canonical RPC-backed viewer, an onchain AVIF carrier, and automatic browser GIF reconstruction.",
  presentation: {
    mode: "hybrid",
    protocol: "keel-standalone-viewer@1",
    deliveryProfile: "onchain-recursive",
    viewer: { store, objectId: viewerIdentity.objectId, digest: viewerIdentity.digest, byteLength: viewer.html.byteLength },
    rpcUrls: [viewerRpcUrl],
  },
  resources: identities.map(({ item, identity }) => ({ id: item.id, role: item.role, mediaType: item.mediaType, objectId: identity.objectId, digest: identity.digest, byteLength: item.bytes.byteLength })),
  poster: { mediaType: "image/jpeg", objectId: posterIdentity.objectId, digest: posterIdentity.digest, byteLength: poster.byteLength },
  source: { mediaType: "image/gif", path: "source.gif", digest: "0xacd707a99ee27d01b623fa32bfc4e0bea4e241239eac460a75fb90bbbb27b910", byteLength: 15_665_832, storage: "local-provenance-only" },
  immutable: true,
};
const manifestBytes = encoder.encode(canonicalJson(manifestValue));
const manifestIdentity = objectIdentity(manifestBytes, "application/json");
const manifestURI = keelWeb3ObjectURI({ chainId, storeAddress: store, objectId: manifestIdentity.objectId, mediaType: "application/json" });
const [resourceReuse, viewerReuse, posterReuse, manifestReuse] = await Promise.all([
  Promise.all(identities.map(({ item, identity }) => objectMatches(identity, item.mediaType))),
  objectMatches(viewerIdentity, "text/html"),
  objectMatches(posterIdentity, "image/jpeg"),
  objectMatches(manifestIdentity, "application/json"),
]);
const reusedObjectIds = identities
  .filter((_, index) => resourceReuse[index])
  .map(({ identity }) => identity.objectId);
if (viewerReuse) reusedObjectIds.push(viewerIdentity.objectId);
if (posterReuse) reusedObjectIds.push(posterIdentity.objectId);
if (manifestReuse) reusedObjectIds.push(manifestIdentity.objectId);
const plan = {
  schema: "keel-sepolia-hybrid-one-of-one-plan@1",
  status: execute ? "execution-authorized" : "read-only-plan",
  chainId,
  rpcUrl,
  store,
  builder,
  factory,
  keelIndex,
  executor: executorAddress,
  recipient,
  factoryNonce: liveNonce.toString(),
  collection,
  tokenId: "1",
  contractConfig: { ...config, maxSupply: config.maxSupply.toString() },
  presentation: { mode: "hybrid", viewerObjectId: viewerIdentity.objectId, viewerDigest: viewerIdentity.digest, viewerBytes: viewer.html.byteLength, viewerCompressedBytes: viewer.compressedHtml.byteLength, viewerAlreadyOnchain: viewerReuse, manifestObjectId: manifestIdentity.objectId, manifestDigest: manifestIdentity.digest, manifestBytes: manifestBytes.byteLength, manifestURI, manifestAlreadyOnchain: manifestReuse, previewImageURI, previewImageBytes: poster.byteLength },
  resources: identities.map(({ item, identity }, index) => ({ id: item.id, mediaType: item.mediaType, objectId: identity.objectId, digest: identity.digest, byteLength: item.bytes.byteLength, carrierCount: identity.payloads.length, alreadyOnchain: resourceReuse[index] })),
  poster: { uri: previewImageURI, objectId: posterIdentity.objectId, digest: posterIdentity.digest, byteLength: poster.byteLength, carrierCount: posterIdentity.payloads.length, alreadyOnchain: posterReuse },
  reuse: { alreadyOnchainObjectIds: reusedObjectIds, newObjectIds: [viewerIdentity, posterIdentity, manifestIdentity, ...identities.map(({ identity }) => identity)].filter((identity) => !reusedObjectIds.includes(identity.objectId)).map((identity) => identity.objectId) },
  source: manifestValue.source,
  unsigned: !execute,
  submitted: false,
};
await mkdir(path.dirname(planPath), { recursive: true });
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({
  ...plan,
  next: execute ? "publishing native objects and minting" : "set KEEL_SEPOLIA_HYBRID_EXECUTE=1 with the canonical executor key to submit",
}, null, 2));
if (!execute) process.exit(0);

const previousJournal = await readFile(journalPath, "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => undefined);
const journal = previousJournal?.schema === "keel-sepolia-hybrid-one-of-one-journal@1"
  && previousJournal.plan?.collection?.toLowerCase() === collection.toLowerCase()
  ? { ...previousJournal, plan, steps: previousJournal.steps ?? {} }
  : { schema: "keel-sepolia-hybrid-one-of-one-journal@1", plan, steps: {} };
await writeJournal(journal);

for (const { item } of identities) {
  await publishLeaf(`resource:${item.id}`, item.bytes, item.mediaType, journal);
}
await publishLeaf("viewer", viewer.html, "text/html", journal);
await publishLeaf("poster", poster, "image/jpeg", journal);
await publishLeaf("manifest", manifestBytes, "application/json", journal);

const codeAtCollection = async () => {
  const code = await publicClient.getCode({ address: collection });
  if (!code || code === "0x") return false;
  const [name, symbol, maxSupply] = await Promise.all([
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "name" }),
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "symbol" }),
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "maxSupply" }),
  ]);
  if (name !== config.name || symbol !== config.symbol || maxSupply !== 1n) fail("The predicted Sepolia collection is occupied by another configuration.");
  return true;
};
if (await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "creatorNonces", args: [executorAddress] }) !== liveNonce && !await codeAtCollection()) {
  fail("The factory nonce changed before collection creation; no duplicate collection was opened.");
}
await sendStep(`collection:${collection}`, async () => executionWallet.writeContract({ account: executionAccount, address: factory, abi: factoryAbi, functionName: "castDie", args: [config], ...(await getFees()) }), codeAtCollection, journal);

const description = manifestValue.description;
await sendStep(`description:${sha256(encoder.encode(description))}`, async () => executionWallet.writeContract({ account: executionAccount, address: collection, abi: collectionAbi, functionName: "setCollectionDescription", args: [description], ...(await getFees()) }), async () => (await publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "collectionDescription" })) === description, journal);
await sendStep(`presentation:${manifestIdentity.objectId}`, async () => executionWallet.writeContract({ account: executionAccount, address: collection, abi: collectionAbi, functionName: "setDefaultPresentation", args: [manifestURI, manifestIdentity.digest, previewImageURI, ""], ...(await getFees()) }), async () => {
  // Token-scoped presentation getters call ownerOf(tokenId), but the standard
  // setup sequence configures presentation before the 1/1 is struck. The
  // final read-back below checks the exact token-scoped values after mint;
  // here the nonzero binding proves the default presentation write landed.
  const binding = await publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "defaultPresentationBinding" });
  return binding !== `0x${"0".repeat(64)}`;
}, journal);
await sendStep(`harness:${viewerIdentity.objectId}`, async () => executionWallet.writeContract({ account: executionAccount, address: collection, abi: collectionAbi, functionName: "setOnchainHarness", args: [builder, viewerIdentity.objectId, viewerIdentity.digest], ...(await getFees()) }), async () => {
  const [liveBuilder, liveObjectId, liveDigest] = await Promise.all([
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "onchainHarnessBuilder" }),
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "onchainHarnessObjectId" }),
    publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "onchainHarnessDigest" }),
  ]);
  return liveBuilder.toLowerCase() === builder.toLowerCase() && liveObjectId === viewerIdentity.objectId && liveDigest === viewerIdentity.digest;
}, journal);
await sendStep(`mint:1:${recipient}`, async () => executionWallet.writeContract({ account: executionAccount, address: collection, abi: collectionAbi, functionName: "adminStrike", args: [recipient, 1n], ...(await getFees()) }), async () => (await publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "ownerOf", args: [1n] })).toLowerCase() === recipient.toLowerCase(), journal);

const indexActive = async () => {
  const active = await publicClient.readContract({ address: keelIndex, abi: indexAbi, functionName: "activePresentation", args: [collection, 1n] }).catch(() => undefined);
  return active !== undefined && tupleValue(active, "manifestURI", 0) === manifestURI && tupleValue(active, "manifestDigest", 1) === manifestIdentity.digest;
};
if (!await indexActive()) {
  const status = await publicClient.readContract({ address: keelIndex, abi: indexAbi, functionName: "scopeStatus", args: [collection, 1n, true] });
  const latest = BigInt(tupleValue(status, "latest", 0));
  const active = BigInt(tupleValue(status, "active", 1));
  if (tupleValue(status, "frozen", 2) === true) fail("The new token scope is unexpectedly frozen in KeelIndex.");
  const revision = latest === active ? latest + 1n : latest;
  if (latest === active) {
    await sendStep(`index:publish:${revision}`, async () => executionWallet.writeContract({ account: executionAccount, address: keelIndex, abi: indexAbi, functionName: "publishTokenRevision", args: [collection, 1n, manifestURI, manifestIdentity.digest, latest, 1n, revision, 3, 0n], ...(await getFees()) }), async () => {
      const candidate = await publicClient.readContract({ address: keelIndex, abi: indexAbi, functionName: "revisionOf", args: [collection, 1n, true, revision] });
      return tupleValue(candidate, "manifestURI", 0) === manifestURI && tupleValue(candidate, "manifestDigest", 1) === manifestIdentity.digest;
    }, journal);
  }
  await sendStep(`index:activate:${revision}`, async () => executionWallet.writeContract({ account: executionAccount, address: keelIndex, abi: indexAbi, functionName: "activateTokenRevision", args: [collection, 1n, revision], ...(await getFees()) }), indexActive, journal);
}

const [tokenURI, owner, totalSupply, harnessHTML, hauledViewer, hauledManifest] = await Promise.all([
  publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "tokenURI", args: [1n], gas: 120_000_000n }),
  publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "ownerOf", args: [1n] }),
  publicClient.readContract({ address: collection, abi: collectionAbi, functionName: "totalSupply" }),
  publicClient.readContract({ address: builder, abi: builderAbi, functionName: "harnessHTML", args: [viewerIdentity.objectId, viewerIdentity.digest], gas: 120_000_000n }),
  publicClient.readContract({ address: store, abi: holdAbi, functionName: "haulObject", args: [viewerIdentity.objectId], gas: 120_000_000n }),
  publicClient.readContract({ address: store, abi: holdAbi, functionName: "haulObject", args: [manifestIdentity.objectId], gas: 120_000_000n }),
]);
if (owner.toLowerCase() !== recipient.toLowerCase() || totalSupply !== 1n) fail("Sepolia 1/1 ownership read-back failed.");
if (harnessHTML !== decoder.decode(viewer.html)) fail("The builder did not read back the exact canonical hybrid viewer.");
if (!exactBytes(hexToBytes(hauledViewer), viewer.html) || !exactBytes(hexToBytes(hauledManifest), manifestBytes)) fail("KeelHold object read-back failed.");
if (!tokenURI.startsWith("data:application/json;base64,")) fail("The collection did not return ordinary base64 ERC-721 metadata.");
const metadata = JSON.parse(Buffer.from(tokenURI.slice(tokenURI.indexOf(",") + 1), "base64").toString("utf8"));
const animationUrl = metadata.animation_url;
if (typeof animationUrl !== "string" || !animationUrl.startsWith("data:text/html;charset=utf-8,")) fail("The ERC-721 metadata has no standard data HTML animation URL.");
if (decodeURIComponent(animationUrl.slice(animationUrl.indexOf(",") + 1)) !== decoder.decode(viewer.html)) fail("The animation URL is not the exact canonical hybrid viewer.");
if (metadata.keel_manifest !== manifestURI || metadata.keel_manifest_digest !== manifestIdentity.digest) fail("The KEEL manifest binding did not read back.");
if (metadata.image !== previewImageURI) fail("The standard image field did not retain the canonical KEEL web3 preview URI.");
if (!await indexActive()) fail("KeelIndex active presentation read-back failed.");

const completedJournal = { ...journal, status: "minted-and-verified", submitted: true, contract: collection, tokenId: "1", tokenURIBytes: Buffer.byteLength(tokenURI), readBack: { owner, totalSupply: totalSupply.toString(), viewerObjectId: viewerIdentity.objectId, manifestObjectId: manifestIdentity.objectId, manifestURI, tokenURIIntegrity: sha256(encoder.encode(tokenURI)) } };
await writeJournal(completedJournal);
console.log(JSON.stringify({ status: "minted-and-verified", chainId, contract: collection, tokenId: "1", tokenURIBytes: Buffer.byteLength(tokenURI), manifestURI, journalPath }, null, 2));
