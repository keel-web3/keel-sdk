import type { JsonSchema } from "./types.js";

const string = (description?: string, maxLength?: number): JsonSchema => ({ type: "string", ...(description === undefined ? {} : { description }), ...(maxLength === undefined ? {} : { maxLength }) });
const integer = (description?: string, minimum?: number, maximum?: number): JsonSchema => ({ type: "integer", ...(description === undefined ? {} : { description }), ...(minimum === undefined ? {} : { minimum }), ...(maximum === undefined ? {} : { maximum }) });
const boolean = (): JsonSchema => ({ type: "boolean" });
const object = (properties: Readonly<Record<string, JsonSchema>>, required: readonly string[] = []): JsonSchema => ({
  type: "object",
  properties,
  ...(required.length === 0 ? {} : { required }),
  additionalProperties: false,
});

/**
 * Evidence every signing-request tool checks before it prepares anything for contract, collection, metadata or
 * viewer work. Order: keel-contract-workflow-preflight (receipt) → keel-engine-catalog → keel-network-inspect →
 * keel-library-search → keel-contract-controls → build → keel-token-standard-audit (auditDigest) → request.
 */
export const standardsEvidence: JsonSchema = object({
  preflightReceipt: string("receipt.id returned by keel-contract-workflow-preflight (0x + 64 hex)."),
  auditDigest: string("digest returned by a passing keel-token-standard-audit (0x + 64 hex). Required whenever a token contract, collection or token metadata is involved."),
  workKind: {
    type: "string",
    enum: ["token-contract", "collection", "metadata", "viewer", "registry-or-module", "role-admin", "fungible-token", "storage-only"],
    description: "What this request changes. Omitted: decided from the decoded (inner) function -- KeelHold storage writes are storage-only, grantRole/revokeRole/renounceRole-style calls are role-admin, calls to an ERC-20 are fungible-token (receipt only, no tokenURI audit); anything else is token-contract (the strictest). Declared kinds are verified.",
  },
});

const moduleSelector: JsonSchema = {
  anyOf: [
    object({ sha256: string(), byteLength: integer() }, ["sha256", "byteLength"]),
    object({
      name: string(),
      artist: string(),
      tags: { type: "array", items: string(), minItems: 1, maxItems: 16 },
    }, ["name"]),
    object({ artist: string(), tags: { type: "array", items: string(), minItems: 1, maxItems: 16 } }, ["artist"]),
    object({ artist: string(), tags: { type: "array", items: string(), minItems: 1, maxItems: 16 } }, ["tags"]),
  ],
};

const walletRequest: JsonSchema = {
  oneOf: [
    object({
      protocol: string(), requestId: string(), label: string(), transport: string(), family: { type: "string", enum: ["ethereum"] },
      chainId: integer(), to: string(), data: string(), valueWei: string(),
    }, ["protocol", "requestId", "label", "family", "chainId", "to", "data", "valueWei"]),
    object({
      protocol: string(), requestId: string(), label: string(), transport: string(), family: { type: "string", enum: ["tezos"] },
      network: string(), destination: string(), amountMutez: string(), entrypoint: string(), parameters: string(),
    }, ["protocol", "requestId", "label", "family", "network", "destination", "amountMutez"]),
  ],
};

const walletLinkTarget: JsonSchema = object({
  chainId: integer("Ethereum chain ID.", 1),
  factoryAddress: string("KeelFactory address."),
  factoryVersion: string("Pinned KeelFactory FACTORY_VERSION bytes32."),
  creationCodeHash: string("Pinned KEEL721 creation-code hash bytes32."),
  operation: { type: "string", enum: ["keelFactory.castDie"] },
  configDigest: string("KeelFactory.dieConfigDigest(config) bytes32."),
  configEncoding: { type: "string", enum: ["keel-factory-config-keccak@1"] },
  authorizationNonce: string("Creator's current KeelFactory nonce."),
}, ["chainId", "factoryAddress", "factoryVersion", "creationCodeHash", "operation", "configDigest", "configEncoding", "authorizationNonce"]);
const collectionConfig: JsonSchema = object({
  name: string("Collection name.", 256),
  symbol: string("Collection symbol.", 256),
  admin: string("Initial collection admin address."),
  royaltyReceiver: string("ERC-2981 royalty receiver address."),
  royaltyBps: string("Canonical uint96 royalty basis points."),
  maxSupply: string("Canonical uint256 maximum supply."),
  mintManager: string("Initial mint manager address; zero is allowed."),
  keelIndex: string("Artifact registry address; zero is allowed."),
}, ["name", "symbol", "admin", "royaltyReceiver", "royaltyBps", "maxSupply", "mintManager", "keelIndex"]);
const walletLink: JsonSchema = object({
  family: { type: "string", enum: ["ethereum", "tezos"] },
  accountAddress: string("Account/creator wallet address."),
  agentAddress: string("Agent wallet address."),
  target: walletLinkTarget,
  scopes: { type: "array", items: { type: "string", enum: ["read", "analyze", "prepare", "request", "create-collection"] }, minItems: 1, maxItems: 5 },
  issuedAt: integer("Unix seconds.", 0),
  expiresAt: integer("Unix seconds; at most 30 days after issuedAt.", 1),
  nonce: string("Link nonce.", 96),
  transport: { type: "string", enum: ["injected", "walletconnect-qr", "ledger", "tezconnect", "local-encrypted"] },
  revocation: object({ status: { type: "string", enum: ["active", "revoked"] }, nonce: string(undefined, 128), revokedAt: integer(undefined, 0) }, ["status", "nonce"]),
  rotation: object({ sequence: integer(undefined, 0), previousLinkDigest: string() }, ["sequence"]),
  collectionConfig,
}, ["family", "accountAddress", "agentAddress", "target", "scopes", "issuedAt", "expiresAt", "nonce"]);

const moduleSpec: JsonSchema = object({
  moduleId: string("Module id bytes32."),
  moduleVersion: integer("Module version uint64.", 0),
  format: { type: "string", enum: ["es-module", "classic-script", "umd", "commonjs", "wasm"] },
  graphId: string("Backing KeelGraphRegistry graph id bytes32."),
  graphVersion: integer("Graph version uint64.", 0),
  manifestDigest: string("Committed manifest digest bytes32."),
  resourceGraphDigest: string("Committed resource-graph digest bytes32."),
  metadataDigest: string("Committed metadata digest bytes32."),
}, ["moduleId", "moduleVersion", "format", "graphId", "graphVersion", "manifestDigest", "resourceGraphDigest", "metadataDigest"]);
const moduleReview: JsonSchema = object({
  chainId: integer("EVM chain id.", 1),
  registry: string("Deployed KeelModuleReviewRegistry address."),
  action: { type: "string", enum: ["submit", "sanction", "deprecate", "revoke"] },
  spec: moduleSpec,
  specDigest: string("Target spec digest for sanction/deprecate/revoke."),
  reviewDigest: string("Review receipt digest for sanction."),
  reasonDigest: string("Reason digest for deprecate/revoke."),
  replacementSpecDigest: string("Optional replacement spec digest."),
  validUntil: integer("Optional expiry unix seconds; 0 means no expiry.", 0),
}, ["chainId", "registry", "action"]);

const integrity: JsonSchema = object({ algorithm: string(), digest: string(), byteLength: integer(undefined, 1) }, ["algorithm", "digest", "byteLength"]);
const chainTarget: JsonSchema = object({ family: { type: "string", enum: ["ethereum"] }, network: integer(undefined, 1), address: string() }, ["family", "network", "address"]);
const chainSource: JsonSchema = object({ path: string(), schema: string(), objectName: string(), mediaType: string(), integrity }, ["schema", "objectName", "mediaType", "integrity"]);
const castSlugsOperation: JsonSchema = object({
  kind: { type: "string", enum: ["castSlugs"] }, function: string(), payloadEncoding: string(),
  chunkFiles: { type: "array", items: string(), minItems: 1, maxItems: 3 },
  chunkByteLengths: { type: "array", items: integer(undefined, 1, 23000), minItems: 1, maxItems: 3 },
  chunkIntegrities: { type: "array", items: integrity, minItems: 1, maxItems: 3 }, slugIds: string(),
}, ["kind", "function", "payloadEncoding", "chunkFiles", "chunkByteLengths", "chunkIntegrities", "slugIds"]);
const createObjectOperation: JsonSchema = object({
  kind: { type: "string", enum: ["weldObject"] }, function: string(), objectId: string(), slugIds: string(), digest: integrity,
  byteLength: integer(undefined, 1, 268435456), compression: { type: "string", enum: ["none", "gzip", "deflate", "brotli"] }, mediaType: string(),
}, ["kind", "function", "slugIds", "digest", "byteLength", "compression", "mediaType"]);
const compositeOperation: JsonSchema = object({
  kind: { type: "string", enum: ["weldComposite"] }, function: string(), objectId: string(),
  partObjectIds: { type: "array", items: string(), minItems: 1, maxItems: 128 }, digest: integrity,
  byteLength: integer(undefined, 1, 268435456), mediaType: string(),
}, ["kind", "function", "objectId", "partObjectIds", "digest", "byteLength", "mediaType"]);
const chainOperationPlan: JsonSchema = object({
  schema: string(), status: string(), materialized: boolean(), descriptorMaterialized: boolean(), chainReady: boolean(),
  target: chainTarget,
  sourcePlan: chainSource,
  operations: { type: "array", items: { oneOf: [castSlugsOperation, createObjectOperation, compositeOperation] }, minItems: 1, maxItems: 16384 },
  encoding: string(), walletApproval: string(), signing: string(), submission: string(), caveat: string(),
}, ["schema", "status", "materialized", "descriptorMaterialized", "chainReady", "target", "sourcePlan", "operations", "encoding", "walletApproval", "signing", "submission", "caveat"]);

const revisionResource: JsonSchema = object({
  id: string("Stable logical resource ID.", 128),
  role: { type: "string", enum: ["shell-prefix", "module", "entrypoint", "asset", "shell-suffix"] },
  version: integer("Sequential logical resource version.", 1),
  store: string("Exact selected-chain KeelHold address.", 42),
  objectId: string("Exact selected-chain object ID.", 66),
  mediaType: string("Exact resource media type.", 128),
  integrity,
  storedByteLength: integer("Measured immutable storage bytes after the declared codec.", 1, 268435456),
}, ["id", "role", "version", "store", "objectId", "mediaType", "integrity", "storedByteLength"]);

const revisionSnapshot: JsonSchema = object({
  chainId: integer("Exact selected EVM chain ID.", 1),
  graphRegistry: string("Exact selected-chain KeelGraphRegistry address.", 42),
  graphId: string("Stable KeelGraphRegistry graph ID.", 66),
  graphVersion: integer("Sequential graph version.", 1),
  resources: { type: "array", items: revisionResource, minItems: 1, maxItems: 128 },
}, ["chainId", "graphRegistry", "graphId", "graphVersion", "resources"]);

const graphRevision: JsonSchema = object({
  kind: { type: "string", enum: ["module-revision", "entrypoint-revision", "asset-revision", "shell-revision"] },
  bindingMode: { type: "string", enum: ["follow-latest", "pinned"] },
  changedResourceIds: {
    type: "array",
    items: string("The one creator-declared changed file or module ID.", 128),
    minItems: 1,
    maxItems: 1,
  },
  live: revisionSnapshot,
  candidate: revisionSnapshot,
}, ["kind", "bindingMode", "changedResourceIds", "live", "candidate"]);

const frayAuctionIntake: JsonSchema = object({
  sourcePath: string("Optional workspace-relative artwork path.", 1024),
  title: string("Artwork title.", 160),
  description: string("Artwork description.", 2000),
  useDefaultDescription: boolean(),
  auctionPreset: integer("Choose exactly 1, 2, 3, or 4.", 1, 4),
  family: { type: "string", enum: ["ethereum", "tezos"] },
  network: string("Supported testnet name, such as sepolia or shadownet.", 64),
  reuseQuery: string("Optional Keel Library/module search query.", 160),
});
const previewCapture: JsonSchema = object({
  still: object({
    mode: { type: "string", enum: ["hook", "timestamp", "settle"] },
    atMs: integer("Still timestamp in milliseconds; used with timestamp mode.", 0, 86400000),
  }, ["mode"]),
  video: object({
    enabled: boolean(),
    mode: { type: "string", enum: ["hook", "timestamp", "settle"] },
    atMs: integer("Video start timestamp in milliseconds; used with timestamp mode.", 0, 86400000),
    durationMs: integer("Preview video duration in milliseconds.", 1000, 30000),
    fps: integer("Preview video frames per second.", 1, 30),
  }, ["enabled", "mode", "durationMs", "fps"]),
}, ["still", "video"]);
const frayStageProject: JsonSchema = object({
  studioUrl: string("Optional KEEL Studio HTTPS URL; KEEL_STUDIO_URL, then the deprecated FRAY_STUDIO_URL alias, is used otherwise.", 512),
  sourcePath: string("Workspace-relative source path.", 1024),
  title: string("Artwork title.", 120),
  description: string("Collector-facing description.", 2000),
  family: { type: "string", enum: ["ethereum", "tezos"] },
  network: string("Supported testnet, such as sepolia or shadownet.", 64),
  auctionPreset: integer("Choose exactly 1, 2, 3, or 4.", 1, 4),
  metadataMode: { type: "string", enum: ["IPFS", "Onchain"] },
  releaseOutcome: { type: "string", enum: ["bidder", "patrons"] },
  mediaType: string("Optional printable media type.", 128),
  previewExecution: { type: "string", enum: ["none", "doom-wasm-sandbox", "html-sandbox"] },
  viewerModules: { type: "array", items: string(), minItems: 0, maxItems: 32 },
  previewCapture,
}, ["sourcePath", "title", "description", "family", "network", "auctionPreset"]);
const chainGuide: JsonSchema = object({
  family: { type: "string", enum: ["ethereum", "tezos"] },
  network: string("Optional network name or chain ID.", 64),
});
const keelLibrarySearch: JsonSchema = object({
  studioUrl: string("Optional HTTPS Keel Studio URL; KEEL_STUDIO_URL is used otherwise.", 512),
  query: string("Module or library search text.", 160),
  limit: integer("Maximum candidates to return.", 1, 100),
}, ["query"]);
const studioCapabilities: JsonSchema = object({
  studioUrl: string("Optional HTTPS Studio URL; KEEL_STUDIO_URL, then the canonical KEEL test URL, is used otherwise.", 512),
});
const studioProjectIntake: JsonSchema = object({
  title: string("Optional work title; the tool returns a question when omitted.", 160),
  description: string("Optional collector-facing description; the tool returns a question when omitted.", 2000),
  outcome: { type: "string", enum: ["storage-only", "release"] },
  chainId: integer("Required only for a release.", 1),
  release: object({
    type: { type: "string", enum: ["one-of-one", "open-edition", "limited-edition"] },
    saleMechanism: { type: "string", enum: ["fixed-price", "auction", "claim"] },
    priceEth: string("Editable ETH price; required only for a release.", 80),
    supply: string("Positive integer copy count required for limited editions. Omit for open editions.", 78),
    startsAt: string("Optional ISO timestamp. Omit for immediate availability.", 64),
    endsAt: string("Optional ISO timestamp.", 64),
  }),
});
const studioDraft: JsonSchema = object({
  studioUrl: string("Optional HTTPS Studio URL; KEEL_STUDIO_URL is used otherwise.", 512),
  operation: { type: "string", enum: ["list", "read", "create", "update"] },
  releaseId: string("Required for read or update.", 128),
  expectedRevision: integer("Required for update; prevents a stale agent from overwriting newer browser work.", 1),
  draft: {
    type: "object",
    description: "Complete Studio release draft. Required for create or update and validated again by the SDK and Studio.",
  },
}, ["operation"]);
const studioStageFile: JsonSchema = object({
  path: string("Workspace-relative creator resource or module; never a locally manufactured KEEL shell, protected-harness wrapper, or local replacement wrapper.", 512),
  mediaType: string("Printable media type.", 160),
  role: { type: "string", enum: ["entrypoint", "renderer", "runtime", "script", "module", "style", "shader", "sprite-atlas", "sprite-loader", "audio-engine", "wallet-runtime", "font", "audio", "video", "model", "data", "plugin", "library", "image", "other"] },
  format: { type: "string", enum: ["asset", "classic-script", "es-module", "umd", "wasm"] },
  updateMode: { type: "string", enum: ["locked", "manual"] },
  label: string("Creator-facing component label. Do not declare a KEEL verification shell or replacement wrapper.", 96),
}, ["path", "mediaType", "role", "format"]);
const studioReusableModule: JsonSchema = object({
  resourcePaths: { type: "array", items: string("Path of a staged module resource.", 512), minItems: 1, maxItems: 256 },
  assetType: { type: "string", enum: ["runtime", "library", "tool", "other"] },
  license: string("SPDX identifier or exact license name.", 120),
  accessMode: { type: "string", enum: ["open", "paid", "license", "subscription", "request", "special"] },
  tags: { type: "array", items: string("Reusable-module search tag.", 64), minItems: 0, maxItems: 24 },
}, ["resourcePaths", "assetType", "license"]);
const studioStageProject: JsonSchema = object({
  studioUrl: string("Optional HTTPS Studio URL; KEEL_STUDIO_URL is used otherwise.", 512),
  title: string("Project title.", 160),
  description: string("Collector-facing project description.", 2_000),
  storageStrategy: { type: "string", enum: ["local", "onchain", "hybrid"] },
  marketplaceExportMode: { type: "string", enum: ["recursive", "packed", "hybrid", "onchfs"] },
  viewer: { type: "string", enum: ["keel-verification-shell", "none"], description: "Omit to select Studio's canonical KEEL Inline graph for later preparation. Standalone image, video, and self-contained GLB use the registered keel.asset-display module plus the direct creator asset, never zero modules or a generated index.html. `none` opts out of the shell only: the immutable artifact may still be released, minted, and retrieved through its contract read. Creator HTML remains content, never a replacement shell or protected-harness/local wrapper." },
  files: { type: "array", items: studioStageFile, minItems: 1, maxItems: 256 },
  reusableModule: studioReusableModule,
  releaseIntent: { type: "object", description: "Optional editable keel-release-intent@1 produced by keel-studio-project-intake." },
}, ["title", "storageStrategy", "files"]);
const creator721Config: JsonSchema = object({
  name: string("Collection name.", 128), symbol: string("Collection symbol.", 32), maxSupply: integer("Maximum ERC-721 supply.", 1),
  royaltyReceiver: string("Optional ERC-2981 receiver."), royaltyBps: integer("Optional royalty basis points.", 0, 10_000), metadataDigest: string("Exact bytes32 project metadata digest."),
}, ["name", "symbol", "maxSupply", "metadataDigest"]);
const creator1155Config: JsonSchema = object({
  name: string("Collection name.", 128), symbol: string("Collection symbol.", 32),
  royaltyReceiver: string("Optional ERC-2981 receiver."), royaltyBps: integer("Optional royalty basis points.", 0, 10_000), metadataDigest: string("Exact bytes32 project metadata digest."),
}, ["name", "symbol", "metadataDigest"]);
const creatorCollectionOperation: JsonSchema = {
  oneOf: [
    object({ kind: { type: "string", enum: ["dedicated-erc721"] }, implementation: { type: "string", enum: ["erc721a", "erc721"] }, config: creator721Config }, ["kind", "config"]),
    object({ kind: { type: "string", enum: ["dedicated-erc1155"] }, config: creator1155Config }, ["kind", "config"]),
    object({ kind: { type: "string", enum: ["shared-erc1155"] }, name: string(undefined, 128), metadataDigest: string() }, ["kind", "name", "metadataDigest"]),
    object({ kind: { type: "string", enum: ["external"] }, tokenContract: string(), name: string(undefined, 128), metadataDigest: string() }, ["kind", "tokenContract", "name", "metadataDigest"]),
  ],
};
const creatorCollectionPrepare: JsonSchema = object({
  chainId: integer("Ethereum chain ID.", 1), creator: string("Creator wallet that will review the call."),
  instance: string("Optional exact recorded deployment instance.", 96),
  creatorNonce: string("Exact creator nonce read before preparation, encoded as canonical unsigned decimal text.", 78),
  operation: creatorCollectionOperation,
  standards: { ...standardsEvidence, description: "Required: preflightReceipt and a passing auditDigest for the collection's prepared tokenURI (or the external token contract)." },
}, ["chainId", "creator", "creatorNonce", "operation", "standards"]);
const shellManifestFields: Readonly<Record<string, JsonSchema>> = {
  creator: string("Creator wallet used for namespacing and catalogue indexing."),
  name: string("Human-readable shell name.", 96),
  description: string("Human-readable shell description.", 512),
  version: string("Creator shell version.", 32),
  tags: { type: "array", items: string("Lowercase kebab-case discovery tag.", 32), minItems: 0, maxItems: 16 },
};
const shellMutationFields: Readonly<Record<string, JsonSchema>> = {
  builderAddress: string("Exact KeelHarnessBuilder address."),
  shellId: string("Stable creator shell ID required for update or freeze."),
  salt: string("Required for register: immutable bytes32 creator namespace salt."),
  prefixObjectId: string("Committed shell top object ID."),
  suffixObjectId: string("Committed shell bottom object ID."),
  metadataObjectId: string("Committed JSON manifest object ID."),
  payloadMode: { type: "string", enum: ["sandboxed-html", "gzip-base64", "pre-encoded-graph"] },
};
// One flat object, not a top-level oneOf: MCP clients require inputSchema.type "object" and reject the whole
// tools/list otherwise (the host then shows zero tools). Per-operation requirements are enforced at runtime.
const shellPrepare: JsonSchema = object({
  operation: {
    type: "string",
    enum: ["manifest", "register", "update", "freeze"],
    description: "manifest needs creator, name, version. register adds builderAddress, salt, prefixObjectId, suffixObjectId, metadataObjectId. update adds builderAddress, shellId and the three object IDs. freeze needs creator, builderAddress, shellId. register/update/freeze require standards.preflightReceipt.",
  },
  ...shellManifestFields,
  ...shellMutationFields,
  standards: standardsEvidence,
}, ["operation", "creator"]);
const inlinePrepare: JsonSchema = object({
  repositoryRoot: string("Optional checkout verification. Omit to use the packaged canonical shell."),
  entry: string("Workspace-relative creator entry. JavaScript is composed by the SDK; HTML must be a complete document."),
  entryMediaType: { type: "string", enum: ["text/javascript", "text/html"] },
  modules: {
    type: "array",
    maxItems: 16,
    description: "Reusable graph modules published once per chain. A text/javascript module MUST be a classic script: the shell executes it with document.head.append(script), so an ES module fails on `export`.",
    items: object({
      moduleId: string("Safe module id, e.g. keel.micropython.", 64),
      version: string(undefined, 32),
      path: string("Workspace-relative module payload."),
      mediaType: string(undefined, 128),
      execution: { type: "string", enum: ["classic", "module"] },
      phase: { type: "string", enum: ["data", "runtime"] },
      weight: integer("Ordering weight.", 0, 1000),
    }, ["moduleId", "version", "path", "mediaType"]),
  },
  assets: {
    type: "array",
    maxItems: 32,
    description: "Creator-specific artwork, media, palettes, timing, and data. KEEL packs these once at their binary slot and keeps them creator-owned.",
    items: object({
      assetId: string("Safe resource id used by __KEEL_CONTENT__, e.g. keel.animation.", 128),
      path: string("Workspace-relative creator asset."),
      mediaType: string(undefined, 128),
      compression: { type: "string", enum: ["none", "gzip", "deflate"] },
    }, ["assetId", "path", "mediaType"]),
  },
  carriage: {
    type: "string",
    enum: ["compact", "raw-percent", "percent", "follow-latest", "pinned"],
    description: "Optional. Omit for compact raw-percent, which is the storage-saving default. Legacy Base64 carriages require explicit selection.",
  },
  presentationPolicy: {
    type: "string",
    enum: ["collector-inline", "external-resolver", "raw-artifact"],
    description: "Optional. Defaults to collector-inline: self-contained data:image/* plus raw-percent data:text/html HTML inside the registered canonical KEEL verification shell. Prepare the exact image carriage once at build time and publish one ASCII payload or URI; never publish raw image bytes plus a second encoded copy. The contract/viewer only copies the prepared header/payload/footer and never Base64-encodes media during tokenURI. GIF is direct data:image/gif from the exact source, never an SVG wrapper, resize or placeholder. External resolvers and legacy artifact routes require an explicit policy.",
  },
  collection: string("Collection address for a prepared one-of-one tokenURI.", 42),
  metadataTransport: { type: "string", enum: ["web3-json"], description: "Existing collection URI route: prepare raw JSON with inline SVG/image and canonical HTML, without KEEL721-specific binding calls." },
  web3ImageResolver: { type: "string", maxLength: 42, description: "Explicit separate SVG matrix address on chainId. Requires web3-json and the source imagePath; keeps animation inline and prepares both responses with shared layers. Does not verify deployment or bind the endpoint." },
  metadataPath: string("Original contract-referenced metadata JSON. Required for web3-json; fields are preserved except image and animation_url."),
  tokenId: string("Explicit decimal token ID for web3-json, including token zero.", 78),
  tokenIdFieldsJson: string('Optional exact field patterns, e.g. {"name":{"prefix":"Gator #","suffix":""}}. Values must match original metadata; the matrix generates the ID at read time.', 16000),
  collectionName: string(undefined, 128),
  description: string(undefined, 1024),
  imagePath: string("Workspace-relative original image bytes. The SDK validates the source and prepares one exact data:image URI/payload carriage; the contract/viewer must only copy it and never encode/decode GIF at read time or wrap it in SVG."),
  imageSvgPath: string("Workspace-relative SVG image (a sample svg(uint256) from keel-svg-create or the renderer). Inlined as data:image/svg+xml; must be passive."),
  imageRoute: { type: "string", enum: ["prepared", "contract-svg"], description: "contract-svg: the live image is generated by an onchain SVG renderer; needs imageSvgPath. The live tokenURI must then pass keel-token-standard-audit." },
  outputDirectory: string("Workspace directory for the graph part bytes, the full fragment and (with collection) tokenURI.txt."),
  hold: string("KeelHold address. With outputDirectory, also writes graph-weld.json: every part's object id, castSlugs/weldObject calldata and the ROOT weldComposite."),
  manifestURI: string(undefined, 512),
  manifestDigest: string("0x-prefixed sha256 of the canonical manifest.", 66),
  chainId: integer("EVM chain id.", 1),
}, ["entry"]);
const shellSearch: JsonSchema = object({
  studioUrl: string("Optional configured KEEL Studio origin.", 512),
  query: string("Shell name, description, version, creator, or tag query.", 120),
  creator: string("Optional exact creator wallet filter.", 42),
}, ["query"]);
const onchainRead: JsonSchema = object({
  name: string("The variable the artwork reads, e.g. \"health\" becomes KEEL.data.health. Must be a JavaScript identifier.", 64),
  address: string("Contract address to call.", 66),
  signature: string("Solidity signature, e.g. \"bornBodyOf(uint256)\".", 256),
  args: {
    type: "array",
    items: string("Decimal or 0x-hex argument. Text, never a JSON number, so a uint256 survives.", 80),
    maxItems: 16,
    description: "Static arguments in declaration order.",
  },
  returns: {
    type: "array",
    items: string("Static return type: bool, address, bytes32, or uint/int of any declared width.", 16),
    minItems: 1,
    maxItems: 32,
    description: "Return types in order. Dynamic types are refused rather than mis-decoded.",
  },
  pick: integer("Take one member of a multi-value return instead of the whole tuple.", 0, 31),
}, ["name", "address", "signature", "returns"]);
const onchainData: JsonSchema = object({
  rpcUrl: string("Optional JSON-RPC endpoint. Omit to resolve KEEL_ONCHAIN_RPC_URL, then the configured public RPC. HTTP is accepted only on a loopback host, which is how a local anvil is reached.", 512),
  reads: { type: "array", items: onchainRead, minItems: 0, maxItems: 64, description: "Additional values this artwork needs. Can be empty when record is supplied." },
  record: object({
    address: string("Selected contract exposing the optional KEEL seed-profile interface.", 42),
    recordId: string("Exact record or token ID as decimal or hexadecimal text.", 80),
    batchSize: integer("Word reads per HTTP batch. Defaults to 64; use 1 for a provider without batch support.", 1, 256),
  }, ["address", "recordId"]),
  blockTag: string("Block to read at. Defaults to latest; pin a hex block number for a reproducible build.", 32),
  globalName: string("Global the fragment publishes. Defaults to KEEL, so creator code reads KEEL.data.<name>.", 64),
  moduleId: string("Inline module ID for the emitted fragment. Defaults to keel/onchain-data.", 120),
  version: string("Inline module version recorded with the fragment. Defaults to 1.0.0.", 32),
}, ["reads"]);
const endpointConfig: JsonSchema = object({
  studioUrl: string("Optional credential-free HTTPS Studio origin.", 512),
  publicRpcUrl: string("Optional credential-free HTTPS public wallet/browser RPC origin.", 512),
  indexerUrl: string("Optional credential-free HTTPS indexer origin.", 512),
});

export const TOOL_SCHEMAS = {
  analyze: object({ input: string("Workspace-relative media path."), mediaType: string() }, ["input"]),
  mediaOptimize: object({
    input: string("Workspace-relative image, video, or 3D source path."), mediaType: string("Optional explicit source media type."),
    quality: integer("WebP quality for a supported image plan.", 1, 100), effort: integer("WebP encoder effort for a supported image plan.", 0, 6),
    videoCrf: integer("VP9 constant-quality value for a supported video plan.", 0, 63), videoCpuUsed: integer("VP9 speed setting for a supported video plan.", 0, 8),
    selectedStorageMode: string("Informational current storage selection. The optimizer never changes it.", 128),
  }, ["input"]),
  mediaOptimizeApply: object({
    input: string("Workspace-relative source path used for the reviewed dry-run."),
    output: string("New workspace-relative output path. Existing files are never overwritten."),
    expectedOutputDigest: string("Exact SHA-256 digest returned by media-optimize."),
    expectedAfterBytes: integer("Exact output byte length returned by media-optimize.", 1),
    mediaType: string("Optional explicit source media type."),
    quality: integer("WebP quality; must match the reviewed plan.", 1, 100), effort: integer("WebP effort; must match the reviewed plan.", 0, 6),
    videoCrf: integer("VP9 constant-quality value; must match the reviewed plan.", 0, 63), videoCpuUsed: integer("VP9 speed setting; must match the reviewed plan.", 0, 8),
    selectedStorageMode: string("Informational current storage selection. The optimizer never changes it.", 128),
  }, ["input", "output", "expectedOutputDigest", "expectedAfterBytes"]),
  build: object({
    input: string(), outputDirectory: string(), createdAt: string(), name: string(), description: string(), id: string(),
    creator: string(), sourceRepository: string(), viewerBaseUrl: string(), webpQuality: integer(), preserveOriginal: boolean(),
    sourceMode: { type: "string", enum: ["files", "inline"] },
  }, ["input", "outputDirectory", "createdAt"]),
  verify: object({ directory: string(), manifestName: string() }, ["directory"]),
  cost: object({
    input: string(), mediaType: string(), compression: { type: "string", enum: ["auto", "none", "brotli", "gzip", "deflate"] },
    maxChunkBytes: integer(), leafDecodedBytes: integer(), maxPartsPerComposite: integer(), maxTreeDepth: integer(),
  }, ["input"]),
  uploadPlan: object({
    input: string("Workspace-relative source file."), objectName: string(undefined, 128), mediaType: string(undefined, 128),
    strategy: { type: "string", enum: ["flat", "recursive"] },
    compression: { type: "string", enum: ["auto", "none", "brotli", "gzip", "deflate"] },
    maxChunkBytes: integer(undefined, 1, 23000), leafDecodedBytes: integer(undefined, 4096), maxPartsPerComposite: integer(undefined, 2, 128),
  }, ["input", "objectName", "mediaType"]),
  chainPlan: object({
    plan: string("Workspace-relative materialized upload-plan JSON."),
    family: { type: "string", enum: ["ethereum"] },
    chainId: integer(undefined, 1), target: string(),
    out: string("Optional workspace-relative .json path. Large descriptor plans are written in full to a file and returned as path + sha256; pass that path to publish-plan as chainPlanPath."),
  }, ["plan", "family", "chainId", "target"]),
  ethereumEncode: object({
    plan: string("Workspace-relative materialized upload-plan JSON."),
    family: { type: "string", enum: ["ethereum"] },
    chainId: integer(undefined, 1), target: string(), qr: boolean(),
    out: string("Optional workspace-relative .json path. Results above the 256 KiB inline budget are always written in full to a file (default <plan>.ethereum-encode.json) and returned as path + sha256; never re-encode by hand."),
  }, ["plan", "family", "chainId", "target"]),
  publishPlan: object({
    chainPlan: { ...chainOperationPlan, description: "The structured result returned by chain-plan. Use chainPlanPath instead when chain-plan delivered a workspace file." },
    chainPlanPath: string("Workspace-relative chain-plan result file (delivery.path from chain-plan)."),
    publicationIntent: {
      type: "string",
      enum: ["new-object", "existing-graph-revision"],
      description: "Derived from the target state by Studio or the caller; creators are not asked to identify protocol mechanics.",
    },
    revision: { ...graphRevision, description: "Required for an existing graph revision and forbidden for a new object." },
    standards: standardsEvidence,
  }, ["publicationIntent"]),
  revisionPlan: graphRevision,
  tokenStandardAudit: object({
    rpcUrl: string("Live read: http(s) JSON-RPC URL of the selected chain.", 2048),
    contract: string("Live read: token contract address."),
    tokenId: string("Live read: token ID as canonical unsigned decimal text.", 78),
    chainId: integer("Optional expected chain ID; the audit fails if the RPC reports another.", 1),
    tokenUri: string("Offline: complete prepared tokenURI text (small documents; the stdio frame is 1 MiB).", 900000),
    tokenUriPath: string("Offline: workspace-relative file holding the complete prepared tokenURI text."),
    exception: object({
      codes: { type: "array", items: string(undefined, 64), minItems: 1, maxItems: 16, description: "Exact finding codes being waived. Read, size, gas and decode findings cannot be waived." },
      reason: string("Why this reviewed exception is acceptable (at least 20 characters).", 2000),
      reviewer: string("Who reviewed it: wallet address or name.", 256),
      signature: string("Optional 65-byte hex signature by the reviewer over the reason (recorded, not verified)."),
    }, ["codes", "reason", "reviewer"]),
  }),
  moduleResolve: object({ snapshot: string(), selector: moduleSelector }, ["snapshot", "selector"]),
  moduleLock: object({ snapshot: string(), out: string(), selector: moduleSelector }, ["snapshot", "out", "selector"]),
  walletRequestPrepare: object({
    request: walletRequest,
    deploy: object({
      artifactPath: string("Workspace compiler artifact JSON (Foundry out/*.json or Hardhat) with abi and creation bytecode."),
      chainId: integer("Target EVM chain ID.", 1),
      args: { type: "array", maxItems: 64, description: "Ordered constructor arguments; integers as decimal strings, tuples as arrays." },
      bytecode: string("Optional creation bytecode; must equal the artifact byte for byte."),
      valueWei: string("Native value for a payable constructor, decimal.", 78),
      label: string(undefined, 128),
      requestId: string(undefined, 128),
    }, ["artifactPath", "chainId"]),
    call: object({
      chainId: integer("Target EVM chain ID.", 1),
      to: string("Contract the call targets (EIP-55 or lowercase)."),
      signature: string("Exact function signature, e.g. setRenderer(address).", 512),
      args: { type: "array", maxItems: 64, description: "Ordered arguments: integers as decimal strings, tuples as arrays. A bytes argument may be {\"call\":{signature,args,abiPath|abiJson,to?}} to nest an encoded inner call." },
      valueWei: string("Native value; only for payable functions.", 78),
      abiPath: string("Workspace compiler artifact or ABI JSON."),
      abiJson: string("Inline ABI or artifact JSON.", 512000),
      via: object({ authority: string("KeelAuthority address."), function: { type: "string", enum: ["execute", "callAsDelegate"] } }, ["authority"]),
      label: string(undefined, 128),
      requestId: string(undefined, 128),
    }, ["chainId", "to", "signature"]),
    controlsAbiPath: string("Workspace ABI/artifact of the (forwarded) target, for prepared calldata: confirms the function is a listed write and the token shape."),
    targetRpcUrl: string("Optional read-only RPC to detect the target's token shape (ERC-165 NFT vs ERC-20 decimals()).", 2048),
    qr: boolean(),
    standards: standardsEvidence,
  }),
  graphWeld: object({
    hold: string("KeelHold address on the selected chain."),
    chainId: integer("Selected chain ID (recorded).", 1),
    mediaType: string("Composite media type. Default application/vnd.keel.token-uri-raw-percent-fragment.", 128),
    parts: {
      type: "array", minItems: 1, maxItems: 128,
      description: "Ordered graph parts. path = part bytes in the workspace (object planned here); objectId alone = an already-published part (then contentPath is required).",
      items: object({ path: string(), objectId: string("bytes32 object id."), label: string(undefined, 128) }),
    },
    contentPath: string("The exact concatenated graph bytes the root commits to (checked against part files when all are given)."),
    out: string("Optional workspace-relative .json path for the full plan."),
  }, ["hold", "parts"]),
  walletLink: object({ link: walletLink, standards: standardsEvidence }, ["link"]),
  moduleReview: object({ review: moduleReview, standards: standardsEvidence }, ["review"]),
  frayAuctionIntake,
  frayStageProject,
  chainGuide,
  keelLibrarySearch,
  onchainData,
  endpointConfig,
  studioCapabilities,
  studioProjectIntake,
  studioDraft,
  studioStageProject,
  creatorCollectionPrepare,
  inlinePrepare,
  shellSearch,
  shellPrepare,
} as const;
