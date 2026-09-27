import { CURATION_TOOL_DEFINITIONS } from './curation-tools.js';
import { MATRIX_TOOL_DEFINITIONS } from './matrix-tools.js';
import { ARENA_TOOL_DEFINITIONS } from './arena-tools.js';
import { LAYERED_TOOL_DEFINITIONS } from './layered-tools.js';
import { SVG_TOOL_DEFINITIONS } from './svg-tools.js';
import { resolveKeelInlineCarriage } from "@keel/sdk/presentation";
import {
  prepareKeelTezosShell,
  buildKeelCollectionPresentation,
  buildKeelCollectionSetTokenMetadata,
  buildKeelCollectionSetTokenJson,
  buildKeelCollectionFreezeTokenMetadata,
  buildKeelCollectionSetMinter,
  buildKeelCollectionStrike,
  buildKeelForgeHarness,
  buildKeelHoldConfigureVerifier,
  buildKeelIndexActivateCollection,
  buildKeelIndexPublishCollection,
  buildKeelIndexRegisterCollection,
  type KeelTezosShellPrepareInput,
} from "@keel/sdk";
import type { CostAnalysisOptions, KeelModuleResolverSnapshot, KeelModuleSelector } from "@keel/builder";
/**
 * The heavy modules are loaded ON FIRST USE, not on import. Statically they cost ~50 s (@keel/builder) and ~19 s
 * (@keel/ethereum-adapter) before this process can answer anything, which put the handshake past every MCP client's
 * connect timeout. Nothing here is needed to LIST tools -- only to run one -- so the wait moves to the first call that
 * actually needs it. Each namespace is fetched once and kept.
 */
let builderMod: typeof import("@keel/builder") | undefined;
const builder = async (): Promise<typeof import("@keel/builder")> => (builderMod ??= await import("@keel/builder"));
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildKeelInlineShellFragments,
  buildKeelInlineModuleFragment,
  buildKeelInlineLocalDocument,
  buildKeelInlinePreEncodedTokenURIGraph,
  buildKeelInlineFollowLatestTokenURIBodyGraph,
  buildKeelInlineEscapedTokenURIGraph,
  buildKeelInlineTokenURIGraph,
  buildKeelPreparedOneOfOneTokenURI,
  buildKeelWeb3TokenJSONGraph,
  buildKeelInlineImageURI,
  KEEL_INLINE_MAX_TOKEN_URI_BYTES,
  createKeelWalletRequest,
  prepareContractDeployment,
  prepareContractCall,
  contractControlForCalldata,
  KEEL_ROLE_ADMIN_SELECTORS,
  tokenKindFromAbi,
  decodeKeelAuthorityCall,
  encodeKeelAuthorityCall,
  encodeKeelWalletRequestQr,
  createKeelPublishReviewPlan,
  planKeelGraphRevision,
  assertKeelRevisionUploadMatchesPlan,
  createKeelWalletLink,
  createCollectionAuthorizationTypedData,
  fetchStudioCapabilities,
  buildKeelModuleReviewRequest,
  prepareKeelStudioProjectIntake,
  executeKeelStudioAgentDraftOperation,
  prepareKeelCreatorCollectionWalletReview,
  buildKeelCreatorShellFreezeCall,
  buildKeelCreatorShellRegistrationCall,
  buildKeelCreatorShellUpdateCall,
  createKeelShellManifest,
  keelCreatorShellId,
  searchKeelShells,
  stageKeelStudioProject,
  resolveKeelEndpoints,
  assertOnchainDataRoundTrip,
  buildOnchainDataFragment,
  readOnchainData,
  resolveKeelOnchainRpcUrl,
  type KeelOnchainRead,
  type KeelWalletLinkInput,
  type KeelModuleReviewInput,
  type KeelCreatorCollectionWalletReviewInput,
  type StageKeelStudioProjectInput,
  type FrayAuctionPresetId,
} from "@keel/sdk";
import type { KeelFactoryCollectionConfig } from "@keel/ethereum-adapter";
let ethMod: typeof import("@keel/ethereum-adapter") | undefined;
const ethereumAdapter = async (): Promise<typeof import("@keel/ethereum-adapter")> => (ethMod ??= await import("@keel/ethereum-adapter"));
import type { Compression, Hex } from "@keel/protocol";
import { standardsEvidence, TOOL_SCHEMAS } from "./schemas.js";
import { analyzeTokenUri, detectTokenKind, enforceStandards, recordTokenStandardAudit, StandardsRefusal, tokenStandardAuditTool } from "./standards.js";
import { deliverResult, sha256Hex } from "./large-output.js";
import { graphWeldPrepareTool, planGraphWeld, summarizeGraphWeld } from "./graph-weld.js";
import { ENGINE_TOOL_DEFINITIONS } from "./engine-tools.js";
import { EDITOR_TOOL_DEFINITIONS } from "./editor-tools.js";
import { createChainOperationPlan } from "./chain-plan.js";
import { ethereumEncodeTool as runEthereumEncodeTool } from "./ethereum-encode.js";
import { chainGuide, prepareFrayAuctionIntake, searchKeelIndexes, stageFrayProject, type FrayPreviewCapture } from "./fray-agent.js";
import type { JsonSchema, ToolContext, ToolDefinition } from "./types.js";

const MAX_MEDIA_BYTES = 256 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const MAX_PLAN_OBJECTS = 512;
const MAX_PLAN_DEPTH = 8;

function record(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const result = value as Record<string, unknown>;
  const fields = new Set(allowed);
  for (const key of Object.keys(result)) if (!fields.has(key)) throw new TypeError(`${label}.${key} is not supported.`);
  return result;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${key} must be a non-empty string.`);
  return value;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${key} must be text.`);
  return value;
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new TypeError(`${key} must be a safe integer.`);
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${key} must be boolean.`);
  return value;
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function storedUploadBytes(operations: readonly { readonly kind: string; readonly descriptor: Readonly<Record<string, unknown>> }[]): number {
  let total = 0;
  for (const operation of operations) {
    if (operation.kind !== "castSlugs") continue;
    const lengths = operation.descriptor.chunkByteLengths;
    if (!Array.isArray(lengths) || lengths.some((item) => typeof item !== "number" || !Number.isSafeInteger(item) || item < 1)) {
      throw new TypeError("The publish plan does not contain measurable carrier chunk lengths.");
    }
    for (const length of lengths as number[]) {
      total += length;
      if (!Number.isSafeInteger(total)) throw new RangeError("The publish plan stored-byte total is unsafe.");
    }
  }
  if (total < 1) throw new TypeError("The publish plan contains no stored carrier bytes.");
  return total;
}

function selectorValue(value: unknown): KeelModuleSelector {
  const input = record(value, ["sha256", "byteLength", "name", "artist", "tags"], "selector");
  const digest = input.sha256;
  if (digest !== undefined || input.byteLength !== undefined) {
    if (typeof digest !== "string" || typeof input.byteLength !== "number") throw new TypeError("hash selector requires sha256 and byteLength.");
    if (!/^0x[0-9a-f]{64}$/u.test(digest) || !Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) throw new TypeError("hash selector is invalid.");
    return { sha256: digest as Hex, byteLength: input.byteLength };
  }
  const name = optionalString(input, "name");
  const artist = optionalString(input, "artist");
  const tagsValue = input.tags;
  if (tagsValue !== undefined && (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string"))) throw new TypeError("selector.tags must be text values.");
  if (name === undefined && artist === undefined && (!Array.isArray(tagsValue) || tagsValue.length === 0)) throw new TypeError("query selector needs name, artist, or tags.");
  return { ...(name === undefined ? {} : { name }), ...(artist === undefined ? {} : { artist }), ...(tagsValue === undefined ? {} : { tags: tagsValue as string[] }) };
}

async function snapshot(context: ToolContext, pathValue: string): Promise<KeelModuleResolverSnapshot> {
  const loaded = await context.workspace.readFile(pathValue, MAX_SNAPSHOT_BYTES);
  const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as unknown;
  // (An assertion function must be called through a plain name that carries an explicit type annotation.)
  const assertSnapshot: (value: unknown) => asserts value is KeelModuleResolverSnapshot =
    (await builder()).assertValidKeelModuleResolverSnapshot;
  assertSnapshot(parsed);
  return parsed;
}

async function analyzeTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["input", "mediaType"], "analyze arguments");
  const file = await context.workspace.resolveExistingFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const mediaType = optionalString(input, "mediaType");
  return (await builder()).analyzeMedia({ input: file, maxInputBytes: MAX_MEDIA_BYTES, ...(mediaType === undefined ? {} : { mediaType }) });
}

/** Always dry-run: the creator must review this result before a separate apply call. */
async function mediaOptimizeTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["input", "mediaType", "quality", "effort", "videoCrf", "videoCpuUsed", "selectedStorageMode"], "media optimize arguments");
  const file = await context.workspace.resolveExistingFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const mediaType = optionalString(input, "mediaType");
  const quality = optionalNumber(input, "quality");
  const effort = optionalNumber(input, "effort");
  const videoCrf = optionalNumber(input, "videoCrf");
  const videoCpuUsed = optionalNumber(input, "videoCpuUsed");
  const selectedStorageMode = optionalString(input, "selectedStorageMode");
  return (await builder()).planMediaOptimization({
    input: file,
    maxInputBytes: MAX_MEDIA_BYTES,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(quality === undefined ? {} : { quality }),
    ...(effort === undefined ? {} : { effort }),
    ...(videoCrf === undefined ? {} : { videoCrf }),
    ...(videoCpuUsed === undefined ? {} : { videoCpuUsed }),
    ...(selectedStorageMode === undefined ? {} : { selectedStorageMode }),
  });
}

async function mediaOptimizeApplyTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(
    value,
    ["input", "output", "expectedOutputDigest", "expectedAfterBytes", "mediaType", "quality", "effort", "videoCrf", "videoCpuUsed", "selectedStorageMode"],
    "media optimize apply arguments",
  );
  const file = await context.workspace.resolveExistingFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const outputValue = requiredString(input, "output");
  const outputName = path.basename(outputValue);
  if (outputName === "." || outputName === ".." || /[\\\u0000-\u001f\u007f]/u.test(outputName)) {
    throw new TypeError("output must be a regular workspace-relative file path.");
  }
  const outputDirectory = await context.workspace.resolveExistingDirectory(path.dirname(outputValue));
  const expectedOutputDigest = requiredString(input, "expectedOutputDigest");
  if (!/^0x[0-9a-f]{64}$/u.test(expectedOutputDigest)) throw new TypeError("expectedOutputDigest must be a lowercase SHA-256 digest.");
  const expectedAfterBytes = optionalNumber(input, "expectedAfterBytes");
  if (expectedAfterBytes === undefined || expectedAfterBytes <= 0) throw new TypeError("expectedAfterBytes must be a positive safe integer.");
  const mediaType = optionalString(input, "mediaType");
  const quality = optionalNumber(input, "quality");
  const effort = optionalNumber(input, "effort");
  const videoCrf = optionalNumber(input, "videoCrf");
  const videoCpuUsed = optionalNumber(input, "videoCpuUsed");
  const selectedStorageMode = optionalString(input, "selectedStorageMode");
  const plan = await (await builder()).planMediaOptimization({
    input: file,
    maxInputBytes: MAX_MEDIA_BYTES,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(quality === undefined ? {} : { quality }),
    ...(effort === undefined ? {} : { effort }),
    ...(videoCrf === undefined ? {} : { videoCrf }),
    ...(videoCpuUsed === undefined ? {} : { videoCpuUsed }),
    ...(selectedStorageMode === undefined ? {} : { selectedStorageMode }),
  });
  if (plan.output?.integrity.digest !== expectedOutputDigest || plan.measurements.afterBytes !== expectedAfterBytes) {
    throw new Error("The current optimization candidate does not match the reviewed dry-run digest and byte length; review it again before applying.");
  }
  return (await builder()).applyMediaOptimization({ plan, output: path.join(outputDirectory, outputName) });
}

async function buildTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["input", "outputDirectory", "createdAt", "name", "description", "id", "creator", "sourceRepository", "viewerBaseUrl", "webpQuality", "preserveOriginal", "sourceMode"], "build arguments");
  const source = await context.workspace.resolveExistingFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const outputDirectory = await context.workspace.resolveOutputDirectory(requiredString(input, "outputDirectory"));
  const createdAt = requiredString(input, "createdAt");
  const name = optionalString(input, "name");
  const description = optionalString(input, "description");
  const id = optionalString(input, "id");
  const creator = optionalString(input, "creator");
  const sourceRepository = optionalString(input, "sourceRepository");
  const viewerBaseUrl = optionalString(input, "viewerBaseUrl");
  const webpQuality = optionalNumber(input, "webpQuality");
  const preserveOriginal = optionalBoolean(input, "preserveOriginal");
  const sourceMode = optionalString(input, "sourceMode");
  if (sourceMode !== undefined && sourceMode !== "files" && sourceMode !== "inline") throw new TypeError("sourceMode must be files or inline.");
  return (await builder()).runMediaPipeline({
    input: source,
    outputDirectory,
    createdAt,
    maxInputBytes: MAX_MEDIA_BYTES,
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    ...(id === undefined ? {} : { id }),
    ...(creator === undefined ? {} : { creator }),
    ...(sourceRepository === undefined ? {} : { sourceRepository }),
    ...(viewerBaseUrl === undefined ? {} : { viewerBaseUrl }),
    ...(webpQuality === undefined ? {} : { webpQuality }),
    ...(preserveOriginal === undefined ? {} : { preserveOriginal }),
    ...(sourceMode === undefined ? {} : { sourceMode }),
  });
}

async function verifyTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["directory", "manifestName"], "verify arguments");
  const directory = await context.workspace.resolveExistingDirectory(requiredString(input, "directory"));
  const manifestName = optionalString(input, "manifestName");
  const manifestPath = `${directory}/${manifestName ?? "manifest.json"}`;
  let manifestBytes: { readonly path: string; readonly bytes: Uint8Array };
  try {
    manifestBytes = await context.workspace.readFile(manifestPath, MAX_SNAPSHOT_BYTES);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return (await builder()).verifyBuiltArtifact({ directory, maxManifestBytes: MAX_SNAPSHOT_BYTES, maxSourceBytes: MAX_MEDIA_BYTES, ...(manifestName === undefined ? {} : { manifestName }) });
    throw error;
  }
  try { JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes.bytes)); }
  catch { return (await builder()).verifyBuiltArtifact({ directory, maxManifestBytes: MAX_SNAPSHOT_BYTES, maxSourceBytes: MAX_MEDIA_BYTES, ...(manifestName === undefined ? {} : { manifestName }) }); }
  try {
    await context.workspace.readFile(`${directory}/manifest.integrity.json`, MAX_SNAPSHOT_BYTES);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return (await builder()).verifyBuiltArtifact({ directory, maxManifestBytes: MAX_SNAPSHOT_BYTES, maxSourceBytes: MAX_MEDIA_BYTES, ...(manifestName === undefined ? {} : { manifestName }) });
}

async function costTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["input", "mediaType", "compression", "maxChunkBytes", "leafDecodedBytes", "maxPartsPerComposite", "maxTreeDepth"], "cost arguments");
  const loaded = await context.workspace.readFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const compressionValue = optionalString(input, "compression");
  if (compressionValue !== undefined && !["auto", "none", "brotli", "gzip", "deflate"].includes(compressionValue)) throw new TypeError("compression is unsupported.");
  const mediaType = optionalString(input, "mediaType");
  const maxChunkBytes = optionalNumber(input, "maxChunkBytes");
  const leafDecodedBytes = optionalNumber(input, "leafDecodedBytes");
  const maxPartsPerComposite = optionalNumber(input, "maxPartsPerComposite");
  const maxTreeDepth = optionalNumber(input, "maxTreeDepth");
  const options: CostAnalysisOptions = {
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(compressionValue === undefined ? {} : { compression: compressionValue as Exclude<CostAnalysisOptions["compression"], undefined> }),
    ...(maxChunkBytes === undefined ? {} : { maxChunkBytes }),
    ...(leafDecodedBytes === undefined ? {} : { leafDecodedBytes }),
    ...(maxPartsPerComposite === undefined ? {} : { maxPartsPerComposite }),
    ...(maxTreeDepth === undefined ? {} : { maxTreeDepth }),
  };
  return (await builder()).analyzeCost(loaded.bytes, options);
}

function boundedPlanText(value: unknown, key: string, max: number): string {
  const textValue = requiredString({ [key]: value }, key);
  if (textValue.length > max || /[\u0000-\u001f\u007f]/u.test(textValue)) throw new TypeError(`${key} is invalid.`);
  if (new TextEncoder().encode(textValue).byteLength > max) throw new TypeError(`${key} exceeds its UTF-8 byte limit.`);
  return textValue;
}

function planCompression(value: unknown): Compression | "auto" | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !["auto", "none", "brotli", "gzip", "deflate"].includes(value)) throw new TypeError("compression is unsupported.");
  return value as Compression | "auto";
}

function planInteger(value: unknown, key: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${key} must be an integer from ${minimum} through ${maximum}.`);
  return value;
}

function estimatedRecursiveObjects(leafCount: number, maxParts: number): number {
  let total = leafCount;
  let level = leafCount;
  while (level > 1) {
    level = Math.ceil(level / maxParts);
    total += level;
  }
  return total;
}

async function uploadPlanTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["input", "objectName", "mediaType", "strategy", "compression", "maxChunkBytes", "leafDecodedBytes", "maxPartsPerComposite"], "upload-plan arguments");
  const source = await context.workspace.readFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const objectName = boundedPlanText(input.objectName, "objectName", 128);
  if (objectName === "." || objectName === ".." || objectName.includes("/") || objectName.includes("\\")) throw new TypeError("objectName must be a metadata-safe name.");
  const mediaType = boundedPlanText(input.mediaType, "mediaType", 128);
  const strategyValue = optionalString(input, "strategy");
  if (strategyValue !== undefined && strategyValue !== "flat" && strategyValue !== "recursive") throw new TypeError("strategy must be flat or recursive.");
  const strategy = strategyValue ?? "flat";
  const compression = planCompression(input.compression);
  const maxChunkBytes = planInteger(input.maxChunkBytes, "maxChunkBytes", 1, 23_000);
  const leafDecodedBytes = planInteger(input.leafDecodedBytes, "leafDecodedBytes", 4_096, MAX_MEDIA_BYTES);
  const maxPartsPerComposite = planInteger(input.maxPartsPerComposite, "maxPartsPerComposite", 2, 128);
  if (strategy === "recursive") {
    const leaves = Math.ceil(source.bytes.byteLength / (leafDecodedBytes ?? 512 * 1024));
    const objects = estimatedRecursiveObjects(leaves, maxPartsPerComposite ?? 64);
    if (objects > MAX_PLAN_OBJECTS) throw new RangeError(`recursive plan exceeds the ${MAX_PLAN_OBJECTS}-object inspection limit; increase leafDecodedBytes or maxPartsPerComposite.`);
    let depth = 0;
    for (let level = leaves; level > 1; level = Math.ceil(level / (maxPartsPerComposite ?? 64))) depth += 1;
    if (depth > MAX_PLAN_DEPTH) throw new RangeError(`recursive plan depth ${depth} exceeds the direct reader limit of ${MAX_PLAN_DEPTH}.`);
  }
  const scratch = await mkdtemp(path.join("/tmp", "keel-mcp-upload-plan-"));
  try {
    const common = {
      objectName,
      mediaType,
      outputDirectory: scratch,
      ...(compression === undefined ? {} : { compression }),
      ...(maxChunkBytes === undefined ? {} : { maxChunkBytes }),
    };
    const plan = strategy === "recursive"
      ? await (await builder()).createRecursiveUploadPlan(source.bytes, { ...common, ...(leafDecodedBytes === undefined ? {} : { leafDecodedBytes }), ...(maxPartsPerComposite === undefined ? {} : { maxPartsPerComposite }) })
      : await (await builder()).createUploadPlan(source.bytes, common);
    // Too large to return inline: write the complete dry-run plan to the workspace (path + sha256) rather than
    // pushing the agent out of the MCP to a CLI.
    return deliverResult(context.workspace, { status: "planned", dryRun: true, materialized: false, files: "unavailable-after-dry-run", strategy, plan }, {
      outPath: `${objectName}.upload-plan.dry-run.json`,
      summary: (value) => ({ status: value.status, dryRun: true, materialized: false, files: value.files, strategy, planSchema: (plan as { readonly schema?: unknown }).schema }),
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function moduleResolveTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["snapshot", "selector"], "module resolve arguments");
  return (await builder()).resolveModule(await snapshot(context, requiredString(input, "snapshot")), selectorValue(input.selector));
}

async function chainPlanTool(context: ToolContext, value: unknown): Promise<unknown> {
  return createChainOperationPlan(context.workspace, value);
}

async function ethereumEncodeTool(context: ToolContext, value: unknown): Promise<unknown> {
  return runEthereumEncodeTool(context.workspace, value);
}

/** Bytes that become token metadata or a viewer, rather than plain assets. */
const DOCUMENT_MEDIA = /^(?:text\/html|application\/xhtml\+xml|application\/json|application\/[a-z0-9.+-]*\+json|application\/vnd\.keel\.token-uri[a-z0-9.+-]*)(?:;|$)/iu;

async function publishPlanTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainPlan", "chainPlanPath", "publicationIntent", "revision", "standards"], "publish review plan arguments");
  if ((input.chainPlan === undefined) === (input.chainPlanPath === undefined)) throw new TypeError("Provide exactly one of chainPlan or chainPlanPath.");
  const chainPlan = input.chainPlanPath === undefined
    ? input.chainPlan
    : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode((await context.workspace.readFile(requiredString(input, "chainPlanPath"), 512 * 1024 * 1024)).bytes)) as unknown;
  const publicationIntent = requiredString(input, "publicationIntent");
  if (publicationIntent !== "new-object" && publicationIntent !== "existing-graph-revision") {
    throw new TypeError("publicationIntent must be new-object or existing-graph-revision.");
  }
  if (publicationIntent === "new-object" && input.revision !== undefined) {
    throw new TypeError("A new-object publish plan cannot include an existing graph revision.");
  }
  if (publicationIntent === "existing-graph-revision" && input.revision === undefined) {
    throw new TypeError("An existing graph revision requires the live and candidate graph gate.");
  }
  const revisionPlan = publicationIntent === "existing-graph-revision"
    ? planKeelGraphRevision(input.revision)
    : undefined;
  const envelope = await createKeelPublishReviewPlan(chainPlan);
  const mediaType = String(envelope.plan.source.mediaType);
  const document = DOCUMENT_MEDIA.test(mediaType);
  const storageOnly = !document && envelope.plan.operations.every((operation) => ["castSlugs", "weldObject", "weldComposite"].includes(operation.kind));
  const clearance = await enforceStandards(context, input.standards, {
    tool: "publish-plan",
    defaultWorkKind: document ? "viewer" : "storage-only",
    storageVerified: storageOnly,
    auditChainId: envelope.plan.target.chainId,
  });
  if (revisionPlan !== undefined) {
    assertKeelRevisionUploadMatchesPlan(revisionPlan, {
      chainId: envelope.plan.target.chainId,
      store: envelope.plan.target.address,
      mediaType: envelope.plan.source.mediaType,
      integrity: envelope.plan.source.integrity,
      storedByteLength: storedUploadBytes(envelope.plan.operations),
    });
  }
  return {
    status: "review-only",
    chainReady: false,
    publicationIntent,
    signing: "not-performed",
    submission: "not-performed",
    standards: clearance,
    ...(revisionPlan === undefined ? {} : { revisionPlan }),
    envelope,
  };
}

async function moduleLockTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["snapshot", "out", "selector"], "module lock arguments");
  const result = await (await builder()).resolveModule(await snapshot(context, requiredString(input, "snapshot")), selectorValue(input.selector));
  if (result.status !== "bytes-unavailable" && result.status !== "resolved") throw new Error(`Module cannot be locked: ${result.status}.`);
  const out = await context.workspace.writeJson(requiredString(input, "out"), result.lock);
  const receiptEnvelope = { receipt: result.receipt, integrity: result.receiptDigest };
  const receipt = await context.workspace.writeJson(`${requiredString(input, "out")}.receipt.json`, receiptEnvelope);
  return { status: "locked", lockPath: out, receiptPath: receipt, lock: result.lock, receipt: result.receipt, receiptDigest: result.receiptDigest, bytes: "unavailable" };
}

/** KeelHold storage writes. A request made only of these is storage, not contract/metadata/viewer work. */
const KEEL_HOLD_STORAGE_SELECTORS: ReadonlySet<string> = new Set([
  "0x0d1ff9e2", // castSlugs(bytes[])
  "0xb17463a8", // weldObject(bytes32[],bytes32,uint64,uint8,string)
  "0x5f97a164", // weldComposite(bytes32[],bytes32,uint64,string)
]);

/**
 * Contract deployment: no `to`, init code from a compiler artifact. The SDK checks the bytecode against the
 * artifact and encodes the constructor exactly like keel-contract-controls; the same standards gate applies.
 */
async function walletDeployPrepare(context: ToolContext, input: Record<string, unknown>): Promise<unknown> {
  const deploy = record(input.deploy, ["artifactPath", "chainId", "args", "bytecode", "valueWei", "label", "requestId"], "deploy");
  const artifactPath = requiredString(deploy, "artifactPath");
  const artifactBytes = (await context.workspace.readFile(artifactPath, 32 * 1024 * 1024)).bytes;
  if (typeof deploy.chainId !== "number") throw new TypeError("deploy.chainId is required.");
  if (deploy.args !== undefined && !Array.isArray(deploy.args)) throw new TypeError("deploy.args must be the ordered constructor arguments (integers as decimal strings).");
  // A fungible ERC-20 has no tokenURI: deploying one needs the receipt, not a metadata audit.
  let artifactAbi: unknown;
  try { artifactAbi = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes)); } catch { artifactAbi = undefined; }
  let deployKind: "nft" | "erc20" | "unknown" = "unknown";
  try { deployKind = artifactAbi === undefined ? "unknown" : tokenKindFromAbi(artifactAbi); } catch { deployKind = "unknown"; }
  const declaredDeploy = input.standards !== null && typeof input.standards === "object" ? (input.standards as Record<string, unknown>).workKind : undefined;
  if (declaredDeploy === "fungible-token" && deployKind !== "erc20") throw new StandardsRefusal("wallet-request-prepare", "work-kind-not-verified", "fungible-token deployment needs an artifact ABI with decimals() and transfer() and no tokenURI/uri.", "keel-contract-controls", "Declare the real workKind.");
  const clearance = await enforceStandards(context, input.standards, {
    tool: "wallet-request-prepare",
    defaultWorkKind: deployKind === "erc20" ? "fungible-token" : "token-contract",
    allowedWorkKinds: ["token-contract", "collection", "metadata", "viewer", "registry-or-module", "fungible-token"],
    auditChainId: deploy.chainId,
  });
  const deployment = prepareContractDeployment({
    artifact: new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes),
    chainId: deploy.chainId,
    ...(deploy.args === undefined ? {} : { args: deploy.args as unknown[] }),
    ...(deploy.bytecode === undefined ? {} : { bytecode: requiredString(deploy, "bytecode") }),
    ...(deploy.valueWei === undefined ? {} : { valueWei: requiredString(deploy, "valueWei") }),
  });
  const request = {
    protocol: "keel-wallet-deploy-request@1",
    requestId: optionalString(deploy, "requestId") ?? `deploy-${deployment.initCodeKeccak.slice(2, 14)}`,
    label: optionalString(deploy, "label") ?? `Deploy ${path.basename(artifactPath, ".json")}`,
    family: "ethereum",
    chainId: deployment.chainId,
    to: null,
    data: deployment.data,
    valueWei: deployment.valueWei,
  };
  const result = {
    status: "prepared-only",
    kind: "contract-deployment",
    signing: "not-performed",
    submission: "not-performed",
    standards: clearance,
    artifact: { path: artifactPath, sha256: sha256Hex(artifactBytes), bytecodeKeccak: deployment.bytecodeKeccak },
    constructor: deployment.constructor,
    initCodeKeccak: deployment.initCodeKeccak,
    envelope: { request, integrity: { algorithm: "sha256", digest: sha256Hex(JSON.stringify(request)) } },
    requires: deployment.requires,
  };
  return deliverResult(context.workspace, result, {
    outPath: `.keel-mcp/deployments/${deployment.initCodeKeccak.slice(2, 18)}.json`,
    summary: (full) => ({ ...full, envelope: { request: { ...full.envelope.request, data: `${full.envelope.request.data.slice(0, 66)}…` }, integrity: full.envelope.integrity, dataBytes: (full.envelope.request.data.length - 2) / 2 } }),
  });
}

/** ABI for a `call` spec: an inline ABI/artifact JSON string or a workspace artifact file. */
async function callAbi(context: ToolContext, spec: Record<string, unknown>): Promise<unknown> {
  if ((spec.abiPath === undefined) === (spec.abiJson === undefined)) throw new TypeError("call needs exactly one of abiPath (workspace artifact/ABI JSON) or abiJson.");
  const text = spec.abiPath !== undefined
    ? new TextDecoder("utf-8", { fatal: true }).decode((await context.workspace.readFile(requiredString(spec, "abiPath"), 32 * 1024 * 1024)).bytes)
    : requiredString(spec, "abiJson");
  const parsed = JSON.parse(text) as unknown;
  // Artifacts can be large; the controls only need the ABI.
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && "abi" in parsed ? { abi: (parsed as { abi: unknown }).abi } : parsed;
}

/**
 * Encode a call through keel-contract-controls (exact signature, coerced args). An argument written as
 * { call: {...} } is itself encoded first and passed as bytes, so calls nest.
 */
async function encodeCallSpec(context: ToolContext, value: unknown, chainId: number, depth: number): Promise<{ readonly to: string; readonly data: `0x${string}`; readonly valueWei: string; readonly signature: string; readonly nested: readonly { readonly data: string; readonly abi: unknown }[]; readonly abi: unknown }> {
  if (depth > 4) throw new RangeError("call nesting is limited to 4 levels.");
  const spec = record(value, ["to", "signature", "args", "valueWei", "abiPath", "abiJson"], "call");
  const to = optionalString(spec, "to") ?? "0x0000000000000000000000000000000000000001";
  if (spec.args !== undefined && !Array.isArray(spec.args)) throw new TypeError("call.args must be the ordered arguments.");
  const nested: { readonly data: string; readonly abi: unknown; readonly signature: string; readonly to: string }[] = [];
  // { call: {...} } anywhere in the arguments (including inside tuples/arrays) becomes its encoded bytes.
  const resolve = async (argument: unknown): Promise<unknown> => {
    if (Array.isArray(argument)) return Promise.all(argument.map(resolve));
    if (argument !== null && typeof argument === "object" && Object.keys(argument).length === 1 && "call" in argument) {
      const inner = await encodeCallSpec(context, (argument as { call: unknown }).call, chainId, depth + 1);
      nested.push({ signature: inner.signature, to: inner.to, data: inner.data, abi: inner.abi }, ...inner.nested as { readonly data: string; readonly abi: unknown; readonly signature: string; readonly to: string }[]);
      return inner.data;
    }
    return argument;
  };
  const args = await resolve((spec.args as unknown[] | undefined) ?? []) as unknown[];
  const abi = await callAbi(context, spec);
  const prepared = prepareContractCall({ abi, chainId, to, signature: requiredString(spec, "signature"), args, ...(spec.valueWei === undefined ? {} : { valueWei: requiredString(spec, "valueWei") }) });
  return { to: prepared.to.toLowerCase(), data: prepared.data, valueWei: prepared.valueWei, signature: prepared.signature, nested, abi };
}

/** Turn a `call` input (optionally wrapped by a KeelAuthority) into a canonical wallet request. */
async function requestFromCall(context: ToolContext, value: unknown) {
  const spec = record(value, ["chainId", "to", "signature", "args", "valueWei", "abiPath", "abiJson", "via", "label", "requestId"], "call");
  if (typeof spec.chainId !== "number" || !Number.isSafeInteger(spec.chainId) || spec.chainId < 1) throw new TypeError("call.chainId is required.");
  requiredString(spec, "to");
  const { chainId, via, label, requestId, ...callSpec } = spec;
  const inner = await encodeCallSpec(context, callSpec, chainId as number, 0);
  let to = inner.to;
  let data: string = inner.data;
  let valueWei = inner.valueWei;
  let wrapped: Record<string, unknown> | undefined;
  if (via !== undefined) {
    const route = record(via, ["authority", "function"], "call.via");
    const functionName = (optionalString(route, "function") ?? "execute") as "execute" | "callAsDelegate";
    if (functionName !== "execute" && functionName !== "callAsDelegate") throw new TypeError("call.via.function must be execute or callAsDelegate (executeSigned needs collected signatures).");
    const authority = requiredString(route, "authority");
    if (!/^0x[0-9a-fA-F]{40}$/u.test(authority)) throw new TypeError("call.via.authority must be an address.");
    data = encodeKeelAuthorityCall(functionName, { target: inner.to, value: inner.valueWei, data: inner.data });
    wrapped = { authority: authority.toLowerCase(), function: functionName, target: inner.to, innerSignature: inner.signature };
    to = authority.toLowerCase();
    valueWei = functionName === "execute" ? inner.valueWei : "0";
  }
  return {
    request: { protocol: "keel-wallet-request@1", requestId: typeof requestId === "string" ? requestId : `call-${sha256Hex(data).slice(2, 14)}`, label: typeof label === "string" ? label : wrapped === undefined ? inner.signature : `${String(wrapped.function)} → ${inner.signature}`, family: "ethereum", chainId, to, data, valueWei },
    call: { signature: inner.signature, to: inner.to, data: inner.data, nested: inner.nested.map(({ abi: _abi, ...entry }) => entry), ...(wrapped === undefined ? {} : { via: wrapped }) },
    // ABIs of every call encoded here, so the gate can read the forwarded target's function and token shape.
    abis: [{ data: inner.data.toLowerCase(), abi: inner.abi }, ...inner.nested.map((entry) => ({ data: entry.data.toLowerCase(), abi: entry.abi }))],
  };
}

/** The contract a call really acts on: KeelAuthority forwards are unwrapped (up to 4 levels). */
function effectiveCall(to: string, data: string): { readonly target: string; readonly data: string; readonly via: readonly { readonly authority: string; readonly function: string }[] } {
  const via: { authority: string; function: string }[] = [];
  let target = to.toLowerCase();
  let current = data;
  for (let depth = 0; depth < 4; depth += 1) {
    const forwarded = decodeKeelAuthorityCall(current);
    if (forwarded === undefined) break;
    via.push({ authority: target, function: forwarded.functionName });
    target = forwarded.target;
    current = forwarded.data;
  }
  return { target, data: current, via };
}

async function walletRequestPrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["request", "deploy", "call", "qr", "standards", "controlsAbiPath", "targetRpcUrl"], "wallet request arguments");
  if ([input.request, input.deploy, input.call].filter((entry) => entry !== undefined).length !== 1) throw new TypeError("Provide exactly one of request (prepared calldata), call (ABI + signature + args) or deploy (a contract deployment).");
  if (input.deploy !== undefined) return walletDeployPrepare(context, input);
  const built = input.call === undefined ? undefined : await requestFromCall(context, input.call);
  if (built !== undefined) input.request = built.request;
  const request = input.request !== null && typeof input.request === "object" && !Array.isArray(input.request) ? input.request as Record<string, unknown> : {};
  const ethereum = request.family === "ethereum";
  const effective = ethereum && typeof request.to === "string" && typeof request.data === "string" ? effectiveCall(request.to, request.data) : undefined;
  const data = (effective?.data ?? (typeof request.data === "string" ? request.data : "")).toLowerCase();
  const storage = ethereum && KEEL_HOLD_STORAGE_SELECTORS.has(data.slice(0, 10)) && request.valueWei === "0";
  // Decide by the decoded inner function: role administration and fungible tokens never need a tokenURI audit.
  const targetAbi = built?.abis.find((entry) => entry.data === data)?.abi ?? (input.controlsAbiPath === undefined ? undefined : await callAbi(context, { abiPath: input.controlsAbiPath }));
  const control = targetAbi === undefined || !ethereum ? undefined : contractControlForCalldata(targetAbi, data);
  const roleSignature = ethereum ? KEEL_ROLE_ADMIN_SELECTORS.get(data.slice(0, 10)) : undefined;
  let tokenKind: "nft" | "erc20" | "unknown" = targetAbi === undefined ? "unknown" : tokenKindFromAbi(targetAbi);
  if (tokenKind === "unknown" && effective !== undefined && typeof input.targetRpcUrl === "string") tokenKind = await detectTokenKind(input.targetRpcUrl, effective.target);
  const declared = input.standards !== null && typeof input.standards === "object" ? (input.standards as Record<string, unknown>).workKind : undefined;
  const defaultWorkKind = storage ? "storage-only" : roleSignature !== undefined ? "role-admin" : tokenKind === "erc20" ? "fungible-token" : "token-contract";
  const workKind = declared ?? defaultWorkKind;
  if (workKind === "role-admin" && roleSignature === undefined) throw new StandardsRefusal("wallet-request-prepare", "work-kind-not-verified", `role-admin is only for role administration (${[...KEEL_ROLE_ADMIN_SELECTORS.values()].join(", ")}); this call is ${data.slice(0, 10)}.`, "keel-contract-controls", "Declare the real workKind.");
  if (workKind === "fungible-token" && tokenKind !== "erc20") throw new StandardsRefusal("wallet-request-prepare", "work-kind-not-verified", "fungible-token needs the target to be shown as an ERC-20: its ABI (call abiPath or controlsAbiPath) with decimals() and no tokenURI, or targetRpcUrl answering decimals() without ERC-721/1155.", "keel-contract-controls", "Pass the target ABI or targetRpcUrl.");
  if (workKind === "role-admin" && (control === undefined || control.mode !== "write")) throw new StandardsRefusal("wallet-request-prepare", "contract-controls-required", `Role administration needs ${roleSignature ?? "the function"} confirmed as a listed write of the target.`, "keel-contract-controls", "Pass call with the target's abiPath/abiJson, or controlsAbiPath for prepared calldata.");
  const clearance = await enforceStandards(context, input.standards, {
    tool: "wallet-request-prepare",
    defaultWorkKind,
    storageVerified: storage,
    ...(ethereum && typeof request.chainId === "number" ? { auditChainId: request.chainId } : {}),
    // Through a KeelAuthority the audited contract is the forwarded target, not the authority.
    ...(effective !== undefined ? { auditContract: effective.target } : {}),
    // A call to an existing token contract must be backed by an audit of THAT contract's live tokenURI.
    requireContractAudit: ethereum && workKind === "token-contract",
    ...(ethereum ? {} : { auditUnavailable: "keel-token-standard-audit reads EVM tokenURI; Tezos token metadata is not audited yet." }),
  });
  const envelope = await createKeelWalletRequest(input.request);
  const qr = optionalBoolean(input, "qr");
  const qrPayload = qr === true ? await encodeKeelWalletRequestQr(envelope) : undefined;
  return {
    status: "prepared-only",
    signing: "not-performed",
    submission: "not-performed",
    standards: clearance,
    ...(effective !== undefined && effective.via.length ? { forwarded: { via: effective.via, target: effective.target, selector: effective.data.slice(0, 10) } } : {}),
    ...(built === undefined ? {} : { call: built.call }),
    classification: { workKind: clearance.workKind, tokenKind, ...(roleSignature === undefined ? {} : { roleAdmin: roleSignature }), ...(control === undefined ? {} : { control: { signature: control.signature, mode: control.mode } }) },
    envelope,
    ...(qrPayload === undefined ? {} : { qr: qrPayload }),
  };
}

async function walletLinkTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["link", "standards"], "wallet link arguments");
  const rawLink = record(input.link, ["family", "accountAddress", "agentAddress", "target", "scopes", "issuedAt", "expiresAt", "nonce", "transport", "revocation", "rotation", "collectionConfig"], "wallet link");
  const { collectionConfig: rawConfig, ...linkInput } = rawLink;
  const link = await createKeelWalletLink(linkInput as unknown as KeelWalletLinkInput);
  if (link.status === "deferred") return { status: "deferred", chainReady: false, walletApproval: "required", link, signing: "not-performed", submission: "not-performed" };
  if (link.revocation.status === "revoked") {
    return {
      status: "deferred",
      chainReady: false,
      walletApproval: "required",
      code: "link-revoked",
      family: "ethereum",
      issues: ["The wallet link is revoked; typed data was not emitted."],
      signing: "not-performed",
      submission: "not-performed",
      link,
    };
  }
  if (rawConfig === undefined) {
    return {
      status: "deferred",
      code: "config-verification-required",
      family: "ethereum",
      chainReady: false,
      walletApproval: "required",
      issues: ["An exact KeelFactory collectionConfig is required before emitting account-signable typed data."],
      signing: "not-performed",
      submission: "not-performed",
      link,
    };
  }
  const normalizedConfig: KeelFactoryCollectionConfig = (await ethereumAdapter()).normalizeKeelFactoryCollectionConfig(rawConfig);
  const computedDigest = (await ethereumAdapter()).createKeelFactoryConfigDigest(normalizedConfig);
  if (computedDigest !== link.target.configDigest) throw new Error("collectionConfig digest does not match wallet link.target.configDigest.");
  // Typed data here authorizes creating a collection: the same evidence as keel-creator-collection-prepare.
  const clearance = await enforceStandards(context, input.standards, {
    tool: "wallet-link",
    defaultWorkKind: "collection",
    allowedWorkKinds: ["collection"],
    auditChainId: link.target.chainId,
  });
  const typed = createCollectionAuthorizationTypedData(link.target.chainId, link.target.factoryAddress, {
    creator: link.accountAddress as `0x${string}`,
    agent: link.agentAddress as `0x${string}`,
    nonce: BigInt(link.target.authorizationNonce),
    deadline: BigInt(link.expiresAt),
    configDigest: link.target.configDigest as `0x${string}`,
  });
  const jsonTyped = {
    ...typed,
    domain: { ...typed.domain, chainId: typed.domain.chainId.toString() },
    message: { ...typed.message, nonce: typed.message.nonce.toString(), deadline: typed.message.deadline.toString() },
  };
  return {
    status: "review-only",
    chainReady: false,
    walletApproval: "required",
    signing: "not-performed",
    submission: "not-performed",
    approval: "not-granted",
    collectionConfig: normalizedConfig,
    configDigestVerified: true,
    standards: clearance,
    link,
    typedData: jsonTyped,
  };
}

async function frayAuctionIntakeTool(_context: ToolContext, value: unknown): Promise<unknown> {
  return prepareFrayAuctionIntake(value);
}

async function frayStageProjectTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "sourcePath", "title", "description", "family", "network", "auctionPreset", "metadataMode", "releaseOutcome", "mediaType", "previewExecution", "viewerModules", "previewCapture"], "Fray stage project arguments");
  const sourcePath = requiredString(input, "sourcePath");
  if (sourcePath.startsWith("/") || sourcePath.split("/").some((part) => part === "." || part === "..")) throw new TypeError("sourcePath must be a safe workspace-relative path.");
  const loaded = await context.workspace.readFile(sourcePath, MAX_MEDIA_BYTES);
  const family = requiredString(input, "family");
  if (family !== "ethereum" && family !== "tezos") throw new TypeError("family must be ethereum or tezos.");
  const metadataMode = optionalString(input, "metadataMode") ?? "Onchain";
  if (metadataMode !== "IPFS" && metadataMode !== "Onchain") throw new TypeError("metadataMode must be IPFS or Onchain.");
  const rawOutcome = optionalString(input, "releaseOutcome");
  const releaseOutcome = rawOutcome ?? (Number(input.auctionPreset) === 1 ? "bidder" : "patrons");
  if (releaseOutcome !== "bidder" && releaseOutcome !== "patrons") throw new TypeError("releaseOutcome must be bidder or patrons.");
  const preset = input.auctionPreset;
  if (typeof preset !== "number" || !Number.isSafeInteger(preset) || preset < 1 || preset > 4) throw new TypeError("auctionPreset must be 1, 2, 3, or 4.");
  const mediaType = optionalString(input, "mediaType") ?? inferMediaType(sourcePath);
  const title = requiredBoundedString(input, "title", 120);
  const description = requiredBoundedString(input, "description", 2_000);
  const network = requiredBoundedString(input, "network", 64);
  const previewExecution = optionalString(input, "previewExecution") ?? inferPreviewExecution(sourcePath, mediaType);
  if (previewExecution !== "none" && previewExecution !== "doom-wasm-sandbox" && previewExecution !== "html-sandbox") throw new TypeError("previewExecution is invalid.");
  const viewerModules = input.viewerModules === undefined
    ? defaultViewerModules(previewExecution)
    : parseViewerModules(input.viewerModules);
  const studioUrl = optionalString(input, "studioUrl");
  return stageFrayProject({
    ...(studioUrl === undefined ? {} : { studioUrl }),
    sourcePath,
    sourceFileName: path.basename(sourcePath),
    sourceMediaType: mediaType,
    sourceBytes: loaded.bytes,
    title,
    description,
    family,
    network,
    auctionPreset: preset as FrayAuctionPresetId,
    metadataMode,
    releaseOutcome,
    previewExecution,
    viewerModules,
    ...(input.previewCapture === undefined ? {} : { previewCapture: parsePreviewCapture(input.previewCapture) }),
  });
}

function requiredBoundedString(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = requiredString(input, key).trim();
  if (value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${key} must be bounded text.`);
  return value;
}

function inferMediaType(sourcePath: string): string {
  const extension = path.extname(sourcePath).toLowerCase();
  return ({
    ".wasm": "application/wasm",
    ".html": "text/html",
    ".htm": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
  } as Record<string, string>)[extension] ?? "application/octet-stream";
}

function inferPreviewExecution(sourcePath: string, mediaType: string): "none" | "doom-wasm-sandbox" | "html-sandbox" {
  if (mediaType === "text/html") return "html-sandbox";
  if (mediaType === "application/wasm" && path.basename(sourcePath).toLowerCase().includes("doom")) return "doom-wasm-sandbox";
  return "none";
}

function defaultViewerModules(execution: "none" | "doom-wasm-sandbox" | "html-sandbox"): readonly string[] {
  if (execution === "doom-wasm-sandbox") return ["render:wasm-sandbox", "verify:keel-object", "runtime:doom-wasm", "lifecycle:preview", "lifecycle:auction-reveal", "lifecycle:token-resolution"];
  if (execution === "html-sandbox") return ["render:html-sandbox", "verify:keel-object", "lifecycle:preview", "lifecycle:auction-reveal", "lifecycle:token-resolution"];
  return ["verify:keel-object", "lifecycle:preview", "lifecycle:auction-reveal"];
}

function parseViewerModules(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32 || value.some((entry) => typeof entry !== "string" || entry.length === 0 || entry.length > 120)) throw new TypeError("viewerModules must contain at most 32 non-empty module names.");
  return value as string[];
}

function parsePreviewCapture(value: unknown): FrayPreviewCapture {
  const input = record(value, ["still", "video"], "previewCapture");
  const still = record(input.still, ["mode", "atMs"], "previewCapture.still");
  const video = record(input.video, ["enabled", "mode", "atMs", "durationMs", "fps"], "previewCapture.video");
  const stillMode = requiredString(still, "mode");
  const videoMode = requiredString(video, "mode");
  if (!["hook", "timestamp", "settle"].includes(stillMode) || !["hook", "timestamp", "settle"].includes(videoMode)) throw new TypeError("preview capture mode must be hook, timestamp, or settle.");
  const enabled = video.enabled;
  if (typeof enabled !== "boolean") throw new TypeError("previewCapture.video.enabled must be boolean.");
  const durationMs = video.durationMs;
  const fps = video.fps;
  if (typeof durationMs !== "number" || !Number.isSafeInteger(durationMs) || durationMs < 1_000 || durationMs > 30_000) throw new TypeError("previewCapture.video.durationMs must be 1000-30000 milliseconds.");
  if (typeof fps !== "number" || !Number.isSafeInteger(fps) || fps < 1 || fps > 30) throw new TypeError("previewCapture.video.fps must be 1-30.");
  const atMs = (entry: Record<string, unknown>, label: string): number | undefined => {
    const candidate = entry.atMs;
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 0 || candidate > 86_400_000) throw new TypeError(`${label}.atMs must be a non-negative millisecond timestamp.`);
    return candidate;
  };
  const stillAt = atMs(still, "previewCapture.still");
  const videoAt = atMs(video, "previewCapture.video");
  return {
    still: { mode: stillMode as FrayPreviewCapture["still"]["mode"], ...(stillAt === undefined ? {} : { atMs: stillAt }) },
    video: { enabled, mode: videoMode as FrayPreviewCapture["video"]["mode"], ...(videoAt === undefined ? {} : { atMs: videoAt }), durationMs, fps },
  };
}

async function chainGuideTool(_context: ToolContext, value: unknown): Promise<unknown> {
  return chainGuide(value);
}

async function keelLibrarySearchTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "query", "limit"], "Keel index search arguments");
  const query = requiredString(input, "query");
  const studioUrl = optionalString(input, "studioUrl");
  const limit = optionalNumber(input, "limit");
  return searchKeelIndexes({ query, ...(studioUrl === undefined ? {} : { studioUrl }), ...(limit === undefined ? {} : { limit }) });
}

async function studioCapabilitiesTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl"], "Studio capabilities arguments");
  const studioUrl = optionalString(input, "studioUrl");
  const endpoints = resolveKeelEndpoints(
    { ...(studioUrl === undefined ? {} : { studioUrl }) },
    process.env,
  );
  return fetchStudioCapabilities(new URL(endpoints.studioUrl));
}

function parseOnchainReads(value: unknown): readonly KeelOnchainRead[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError("reads must declare 1 to 64 values.");
  }
  return value.map((entry) => {
    const read = record(entry, ["name", "address", "signature", "args", "returns", "pick"], "on-chain read");
    const args = read.args;
    if (args !== undefined && (!Array.isArray(args) || args.length > 16 || args.some((argument) => typeof argument !== "string"))) {
      // JSON numbers stop being exact well below uint256, and an argument that
      // silently loses its low bits selects a different token.
      throw new TypeError("read args must be decimal or 0x-hex text, never JSON numbers.");
    }
    const returns = read.returns;
    if (!Array.isArray(returns) || returns.length === 0 || returns.length > 32 || returns.some((type) => typeof type !== "string")) {
      throw new TypeError("Each read declares 1 to 32 return types.");
    }
    const pick = optionalNumber(read, "pick");
    if (pick !== undefined && (pick < 0 || pick >= returns.length)) throw new TypeError("read pick must name one of the declared return types.");
    return {
      name: requiredString(read, "name"),
      address: requiredString(read, "address"),
      signature: requiredString(read, "signature"),
      ...(args === undefined ? {} : { args: args as readonly string[] }),
      returns: returns as readonly string[],
      ...(pick === undefined ? {} : { pick }),
    };
  });
}

/**
 * The on-chain-to-script route, made reachable.
 *
 * An agent asked to put a chain value into an artwork otherwise writes a fetch
 * into the artwork and hopes it resolves before the first frame. This tool ends
 * that: it declares the reads, performs them, and hands back the init fragment
 * that publishes the answers as frozen globals ahead of every other module. The
 * fragment is executed here before it is returned, so "init works" is a checked
 * fact in the response rather than a claim in a comment.
 */
async function onchainDataTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["rpcUrl", "reads", "record", "blockTag", "globalName", "moduleId", "version"], "On-chain data arguments");
  const seedInput = input.record === undefined ? undefined : record(input.record, ["address", "recordId", "batchSize"], "Seed record");
  const seedBatchSize = seedInput === undefined ? undefined : optionalNumber(seedInput, "batchSize");
  const seedRecord = seedInput === undefined ? undefined : {
    address: requiredString(seedInput, "address") as `0x${string}`,
    recordId: requiredString(seedInput, "recordId"),
    ...(seedBatchSize === undefined ? {} : { batchSize: seedBatchSize }),
  };
  const reads = seedRecord && Array.isArray(input.reads) && input.reads.length === 0 ? [] : parseOnchainReads(input.reads);
  const rpc = resolveKeelOnchainRpcUrl(optionalString(input, "rpcUrl"), process.env);
  const blockTag = optionalString(input, "blockTag");
  const globalName = optionalString(input, "globalName");
  const moduleId = optionalString(input, "moduleId") ?? "keel/onchain-data";
  const layer = await readOnchainData({
    rpcUrl: rpc.url,
    reads,
    ...(seedRecord === undefined ? {} : { record: seedRecord }),
    ...(blockTag === undefined ? {} : { blockTag }),
  });
  const fragment = buildOnchainDataFragment(layer, {
    moduleId,
    ...(globalName === undefined ? {} : { globalName }),
  });
  assertOnchainDataRoundTrip(layer, fragment);
  return Object.freeze({
    schema: "keel.onchain-data@1" as const,
    status: "ok" as const,
    rpcUrl: rpc.url,
    rpcUrlSource: rpc.source,
    chainId: layer.chainId,
    blockNumber: layer.blockNumber,
    blockTag: blockTag ?? "latest",
    globalName: globalName ?? "KEEL",
    variables: Object.keys(layer.values),
    values: layer.values,
    initVerified: true,
    fragment: Object.freeze({
      moduleId: fragment.moduleId,
      phase: fragment.phase,
      weight: fragment.weight,
      mediaType: "text/javascript" as const,
      execution: "classic" as const,
      digest: fragment.digest,
      packByteLength: fragment.byteLength,
      sourceByteLength: new TextEncoder().encode(fragment.source).byteLength,
      source: fragment.source,
    }),
    /* Write `source` to a workspace file, then hand this back to
       keel-inline-prepare under `modules` with that file's `path`. The phase and
       classic execution are what put the values in place before the artwork
       looks for them; changing either breaks the guarantee. */
    inlineModuleDeclaration: Object.freeze({
      moduleId: fragment.moduleId,
      version: optionalString(input, "version") ?? "1.0.0",
      mediaType: "text/javascript" as const,
      execution: "classic" as const,
      phase: fragment.phase,
      weight: fragment.weight,
    }),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  });
}

async function endpointConfigTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "publicRpcUrl", "indexerUrl"], "KEEL endpoint arguments");
  const studioUrl = optionalString(input, "studioUrl");
  const publicRpcUrl = optionalString(input, "publicRpcUrl");
  const indexerUrl = optionalString(input, "indexerUrl");
  return resolveKeelEndpoints({
    ...(studioUrl === undefined ? {} : { studioUrl }),
    ...(publicRpcUrl === undefined ? {} : { publicRpcUrl }),
    ...(indexerUrl === undefined ? {} : { indexerUrl }),
  }, process.env);
}

async function moduleReviewPrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["review", "standards"], "module review arguments");
  const review = record(
    input.review,
    ["chainId", "registry", "action", "spec", "specDigest", "reviewDigest", "reasonDigest", "replacementSpecDigest", "validUntil"],
    "module review",
  );
  const clearance = await enforceStandards(context, input.standards, { tool: "module-review-prepare", defaultWorkKind: "registry-or-module", allowedWorkKinds: ["registry-or-module"] });
  const request = await buildKeelModuleReviewRequest(review as unknown as KeelModuleReviewInput);
  return request !== null && typeof request === "object" && !Array.isArray(request) ? { ...request, standards: clearance } : { request, standards: clearance };
}

async function studioProjectIntakeTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["title", "description", "outcome", "chainId", "release"], "Studio project intake arguments");
  const outcome = optionalString(input, "outcome");
  if (outcome !== undefined && outcome !== "storage-only" && outcome !== "release") {
    throw new TypeError("outcome must be storage-only or release; fixed-price and claim belong in release.saleMechanism, and Fray auctions use fray-auction-intake.");
  }
  if (input.release !== undefined) {
    const release = record(input.release, ["type", "saleMechanism", "priceEth", "supply", "startsAt", "endsAt"], "release");
    const releaseType = optionalString(release, "type");
    if (releaseType !== undefined && !["one-of-one", "open-edition", "limited-edition"].includes(releaseType)) {
      throw new TypeError("release.type must be one-of-one, open-edition, or limited-edition.");
    }
    const saleMechanism = optionalString(release, "saleMechanism");
    if (saleMechanism !== undefined && !["fixed-price", "auction", "claim"].includes(saleMechanism)) {
      throw new TypeError("release.saleMechanism must be fixed-price, auction, or claim.");
    }
  }
  return prepareKeelStudioProjectIntake(input as Parameters<typeof prepareKeelStudioProjectIntake>[0]);
}

async function studioDraftTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "operation", "releaseId", "expectedRevision", "draft"], "Studio draft arguments");
  const operation = requiredString(input, "operation");
  if (!["list", "read", "create", "update"].includes(operation)) throw new TypeError("operation must be list, read, create, or update.");
  const token = process.env.KEEL_STUDIO_AGENT_TOKEN;
  if (typeof token !== "string" || token.length < 48) {
    throw new TypeError("KEEL Studio draft access requires KEEL_STUDIO_AGENT_TOKEN. Create a scoped key in Studio account settings; never put it in MCP arguments.");
  }
  const configuredStudioUrl = optionalString(input, "studioUrl");
  const studioUrl = resolveKeelEndpoints({
    ...(configuredStudioUrl === undefined ? {} : { studioUrl: configuredStudioUrl }),
  }, process.env).studioUrl;
  const releaseId = optionalString(input, "releaseId");
  const expectedRevision = optionalNumber(input, "expectedRevision");
  return executeKeelStudioAgentDraftOperation({
    studioUrl,
    grantToken: token,
    operation: operation as "list" | "read" | "create" | "update",
    ...(releaseId === undefined ? {} : { releaseId }),
    ...(input.draft === undefined ? {} : { draft: input.draft as never }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });
}

async function studioStageProjectTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "title", "description", "storageStrategy", "marketplaceExportMode", "viewer", "files", "reusableModule", "releaseIntent"], "Studio stage project arguments");
  const token = process.env.KEEL_STUDIO_AGENT_TOKEN;
  if (typeof token !== "string" || token.length < 48) {
    throw new TypeError("KEEL Studio staging requires KEEL_STUDIO_AGENT_TOKEN. Create a scoped key in Studio account settings; never put it in MCP arguments.");
  }
  const configuredStudioUrl = optionalString(input, "studioUrl");
  const studioUrl = resolveKeelEndpoints({ ...(configuredStudioUrl === undefined ? {} : { studioUrl: configuredStudioUrl }) }, process.env).studioUrl;
  const title = requiredBoundedString(input, "title", 160);
  const description = optionalString(input, "description") ?? "";
  if (description.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(description)) throw new TypeError("description must be bounded text.");
  const storageStrategy = requiredString(input, "storageStrategy");
  if (!["local", "onchain", "hybrid"].includes(storageStrategy)) throw new TypeError("storageStrategy must be local, onchain, or hybrid.");
  const marketplaceExportMode = optionalString(input, "marketplaceExportMode");
  if (marketplaceExportMode !== undefined && !["recursive", "packed", "hybrid", "onchfs"].includes(marketplaceExportMode)) throw new TypeError("marketplaceExportMode is unsupported.");
  const viewer = optionalString(input, "viewer") ?? "keel-verification-shell";
  if (viewer !== "keel-verification-shell" && viewer !== "none") throw new TypeError("viewer must be keel-verification-shell or none.");
  if (!Array.isArray(input.files) || input.files.length < 1 || input.files.length > 256) throw new TypeError("files must contain from 1 through 256 entries.");
  let totalBytes = 0;
  const files = [];
  for (const [index, candidate] of input.files.entries()) {
    const file = record(candidate, ["path", "mediaType", "role", "format", "updateMode", "label"], `files[${index}]`);
    const sourcePath = requiredString(file, "path");
    const loaded = await context.workspace.readFile(sourcePath, MAX_MEDIA_BYTES);
    totalBytes += loaded.bytes.byteLength;
    if (totalBytes > MAX_MEDIA_BYTES) throw new RangeError(`Staged project exceeds the ${MAX_MEDIA_BYTES.toString()} byte MCP limit.`);
    const role = requiredString(file, "role");
    if (!["entrypoint", "renderer", "runtime", "script", "module", "style", "shader", "sprite-atlas", "sprite-loader", "audio-engine", "wallet-runtime", "font", "audio", "video", "model", "data", "plugin", "library", "image", "other"].includes(role)) throw new TypeError(`files[${index}].role is unsupported.`);
    const format = requiredString(file, "format");
    if (!["asset", "classic-script", "es-module", "umd", "wasm"].includes(format)) throw new TypeError(`files[${index}].format is unsupported.`);
    const updateMode = optionalString(file, "updateMode");
    if (updateMode !== undefined && updateMode !== "locked" && updateMode !== "manual") throw new TypeError(`files[${index}].updateMode is unsupported.`);
    const label = optionalString(file, "label");
    files.push({
      path: sourcePath,
      bytes: loaded.bytes,
      mediaType: requiredBoundedString(file, "mediaType", 160),
      role: role as "entrypoint" | "renderer" | "runtime" | "script" | "module" | "style" | "shader" | "sprite-atlas" | "sprite-loader" | "audio-engine" | "wallet-runtime" | "font" | "audio" | "video" | "model" | "data" | "plugin" | "library" | "image" | "other",
      format: format as "asset" | "classic-script" | "es-module" | "umd" | "wasm",
      ...(updateMode === undefined ? {} : { updateMode: updateMode as "locked" | "manual" }),
      ...(label === undefined ? {} : { label }),
    });
  }
  let reusableModule: StageKeelStudioProjectInput["reusableModule"];
  if (input.reusableModule !== undefined) {
    const module = record(input.reusableModule, ["resourcePaths", "assetType", "license", "accessMode", "tags"], "reusableModule");
    if (!Array.isArray(module.resourcePaths) || module.resourcePaths.length < 1 || module.resourcePaths.length > 256 || module.resourcePaths.some((item) => typeof item !== "string" || item.length < 1 || item.length > 512)) {
      throw new TypeError("reusableModule.resourcePaths must contain from 1 through 256 staged paths.");
    }
    const stagedPaths = new Set(files.map((file) => file.path));
    if (module.resourcePaths.some((item) => !stagedPaths.has(item as string))) throw new TypeError("Every reusableModule.resourcePaths entry must name a staged file.");
    const assetType = requiredString(module, "assetType");
    if (!["runtime", "library", "tool", "other"].includes(assetType)) throw new TypeError("reusableModule.assetType is unsupported.");
    const license = requiredBoundedString(module, "license", 120);
    const accessMode = optionalString(module, "accessMode");
    if (accessMode !== undefined && !["open", "paid", "license", "subscription", "request", "special"].includes(accessMode)) throw new TypeError("reusableModule.accessMode is unsupported.");
    const tags = module.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 24 || tags.some((item) => typeof item !== "string" || item.length < 1 || item.length > 64)) throw new TypeError("reusableModule.tags is invalid.");
    reusableModule = {
      resourcePaths: module.resourcePaths as string[],
      assetType: assetType as "runtime" | "library" | "tool" | "other",
      license,
      ...(accessMode === undefined ? {} : { accessMode: accessMode as "open" | "paid" | "license" | "subscription" | "request" | "special" }),
      tags: tags as string[],
    };
  }
  return stageKeelStudioProject({
    studioUrl,
    agentToken: token,
    title,
    description,
    storageStrategy: storageStrategy as "local" | "onchain" | "hybrid",
    ...(marketplaceExportMode === undefined ? {} : { marketplaceExportMode: marketplaceExportMode as "recursive" | "packed" | "hybrid" | "onchfs" }),
    viewer: viewer as "keel-verification-shell" | "none",
    files,
    ...(reusableModule === undefined ? {} : { reusableModule }),
    ...(input.releaseIntent === undefined ? {} : { releaseIntent: input.releaseIntent as never }),
  });
}

async function creatorCollectionPrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainId", "creator", "instance", "creatorNonce", "operation", "standards"], "Creator collection prepare arguments");
  if (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("chainId must be a positive safe integer.");
  const creator = requiredString(input, "creator");
  const instance = optionalString(input, "instance");
  const creatorNonce = requiredString(input, "creatorNonce");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(creatorNonce)) throw new TypeError("creatorNonce must be canonical unsigned decimal text.");
  const operation = record(input.operation, ["kind", "implementation", "config", "name", "metadataDigest", "tokenContract"], "Creator collection operation");
  const external = operation.kind === "external" && typeof operation.tokenContract === "string";
  const clearance = await enforceStandards(context, input.standards, {
    tool: "keel-creator-collection-prepare",
    defaultWorkKind: "collection",
    allowedWorkKinds: ["collection"],
    auditChainId: input.chainId,
    // Registering someone's existing contract: audit that contract. A new collection: audit its prepared tokenURI.
    ...(external ? { auditContract: operation.tokenContract as string, requireContractAudit: true } : {}),
  });
  const prepared = await prepareKeelCreatorCollectionWalletReview({
    chainId: input.chainId,
    creator: creator as `0x${string}`,
    ...(instance === undefined ? {} : { instance }),
    creatorNonce,
    operation: operation as unknown as KeelCreatorCollectionWalletReviewInput["operation"],
  });
  return { ...prepared, standards: clearance };
}

async function shellPrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(
    value,
    ["operation", "creator", "name", "description", "version", "tags", "builderAddress", "shellId", "salt", "prefixObjectId", "suffixObjectId", "metadataObjectId", "payloadMode", "standards"],
    "Shell prepare arguments",
  );
  const operation = requiredString(input, "operation");
  if (operation !== "manifest" && operation !== "register" && operation !== "update" && operation !== "freeze") {
    throw new TypeError("operation must be manifest, register, update, or freeze.");
  }
  const creator = requiredString(input, "creator") as `0x${string}`;
  // Registering, revising or freezing a shell is viewer work that ends in a wallet call.
  const clearance = operation === "manifest"
    ? undefined
    : await enforceStandards(context, input.standards, { tool: "keel-shell-prepare", defaultWorkKind: "viewer", allowedWorkKinds: ["viewer"] });
  if (operation === "freeze") {
    return Object.freeze({
      schema: "keel.creator-shell-prepare@1" as const,
      status: "review-only" as const,
      standards: clearance,
      creator,
      call: buildKeelCreatorShellFreezeCall({
        builderAddress: requiredString(input, "builderAddress") as `0x${string}`,
        shellId: requiredString(input, "shellId") as `0x${string}`,
      }),
    });
  }
  const tags = input.tags === undefined ? [] : input.tags;
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) throw new TypeError("tags must be text values.");
  const manifest = await createKeelShellManifest({
    creator,
    name: requiredString(input, "name"),
    description: optionalString(input, "description") ?? "",
    version: requiredString(input, "version"),
    tags: tags as string[],
  });
  const metadata = Object.freeze({
    protocol: manifest.value.protocol,
    json: manifest.json,
    integrity: manifest.integrity,
    publication: "required-before-registration" as const,
  });
  if (operation === "manifest") {
    return Object.freeze({
      schema: "keel.creator-shell-prepare@1" as const,
      status: "manifest-ready" as const,
      metadata,
      signing: "not-performed" as const,
      submission: "not-performed" as const,
    });
  }
  const builderAddress = requiredString(input, "builderAddress") as `0x${string}`;
  const prefixObjectId = requiredString(input, "prefixObjectId") as `0x${string}`;
  const suffixObjectId = requiredString(input, "suffixObjectId") as `0x${string}`;
  const metadataObjectId = requiredString(input, "metadataObjectId") as `0x${string}`;
  const payloadMode = (optionalString(input, "payloadMode") ?? "pre-encoded-graph") as "sandboxed-html" | "gzip-base64" | "pre-encoded-graph";
  if (operation === "update") {
    return Object.freeze({
      schema: "keel.creator-shell-prepare@1" as const,
      status: "review-only" as const,
      standards: clearance,
      shellId: requiredString(input, "shellId") as `0x${string}`,
      metadata,
      call: buildKeelCreatorShellUpdateCall({
        builderAddress,
        shellId: requiredString(input, "shellId") as `0x${string}`,
        prefixObjectId,
        suffixObjectId,
        metadataObjectId,
        payloadMode,
      }),
    });
  }
  const salt = requiredString(input, "salt") as `0x${string}`;
  const call = buildKeelCreatorShellRegistrationCall({ builderAddress, salt, prefixObjectId, suffixObjectId, metadataObjectId, payloadMode });
  return Object.freeze({
    schema: "keel.creator-shell-prepare@1" as const,
    status: "review-only" as const,
    standards: clearance,
    shellId: keelCreatorShellId(creator, salt),
    metadata,
    call,
  });
}

async function shellSearchTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "query", "creator"], "shell search arguments");
  const configuredStudioUrl = optionalString(input, "studioUrl");
  const creator = optionalString(input, "creator");
  const resolvedStudioUrl = configuredStudioUrl ?? resolveKeelEndpoints({}, process.env).studioUrl;
  const shells = await searchKeelShells({
    studioUrl: resolvedStudioUrl,
    query: requiredString(input, "query"),
    ...(creator === undefined ? {} : { creator: creator as `0x${string}` }),
  });
  return Object.freeze({
    schema: "keel.shell-search@1" as const,
    status: "ok" as const,
    source: resolvedStudioUrl,
    shells,
    carrierBytesFetched: false,
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  });
}

function tool(name: string, description: string, inputSchema: JsonSchema, run: ToolDefinition["run"]): ToolDefinition {
  return { descriptor: { name, description, inputSchema }, run };
}


/**
 * The inline route, made reachable.
 *
 * Before this tool existed the MCP exposed no way to build an inline graph, so
 * every agent driving Keel through it fell back to a manifest locator in
 * `image` and `animation_url`. The correct builders lived in @keel/sdk and were
 * documented in resources.ts, but there was no door to them. This is the door.
 *
 * Review-only: it plans bytes and returns digests. It never signs or submits.
 */
async function inlinePrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(
    value,
    ["repositoryRoot", "entry", "entryMediaType", "modules", "assets", "carriage", "presentationPolicy", "collection",
     "collectionName", "description", "imagePath", "manifestURI", "manifestDigest", "chainId",
     "metadataTransport", "metadataPath", "tokenId", "tokenIdFieldsJson", "web3ImageResolver",
     "imageSvgPath", "imageRoute", "hold", "outputDirectory"],
    "Inline prepare arguments",
  );
  const repositoryRoot = optionalString(input, "repositoryRoot");
  const entryMediaType = (optionalString(input, "entryMediaType") ?? "text/javascript") as "text/javascript" | "text/html";
  const entryBytes = (await context.workspace.readFile(requiredString(input, "entry"), MAX_MEDIA_BYTES)).bytes;
  const entryText = new TextDecoder("utf-8", { fatal: true }).decode(entryBytes);
  if (/(?:;base64,|"storedBase64"\s*:)[A-Za-z0-9+/=]{4096,}/u.test(entryText)) {
    throw new TypeError(
      "Large encoded artwork was embedded inside the Inline entry. Declare creator binary files in assets so KEEL packs them once and reports their exact overhead.",
    );
  }

  const shell = await buildKeelInlineShellFragments(repositoryRoot === undefined ? {} : { repositoryRoot });

  const declared = input.modules === undefined ? [] : input.modules;
  if (!Array.isArray(declared)) throw new TypeError("modules must be a list.");
  const modules = [];
  for (const entry of declared) {
    const module = record(entry, ["moduleId", "version", "path", "mediaType", "execution", "phase", "weight"], "Inline module");
    const mediaType = requiredString(module, "mediaType");
    if (!/^(?:text|application)\/(?:javascript|ecmascript)$/u.test(mediaType) && mediaType !== "application/wasm") {
      throw new TypeError(
        `Inline module ${requiredString(module, "moduleId")} is creator media, not reusable executable code. `
        + "Declare it in assets so its bytes remain creator-owned and receive the automatic single-pack saver path.",
      );
    }
    const execution = (optionalString(module, "execution") ?? "classic") as "classic" | "module";
    // The canonical shell runs role:"module" JavaScript with
    // document.head.append(script). An ES module there dies on `export`, which
    // is a confusing runtime failure, so refuse it at plan time instead.
    if (mediaType === "text/javascript" && execution !== "classic") {
      throw new TypeError(
        `Inline module ${requiredString(module, "moduleId")} is text/javascript with execution "${execution}". `
        + "The canonical shell appends module JavaScript as a classic script, so it must be a classic script "
        + "that publishes a global, not an ES module.",
      );
    }
    modules.push(await buildKeelInlineModuleFragment({
      moduleId: requiredString(module, "moduleId"),
      version: requiredString(module, "version"),
      mediaType,
      aliases: [requiredString(module, "moduleId")],
      decodedBytes: (await context.workspace.readFile(requiredString(module, "path"), MAX_MEDIA_BYTES)).bytes,
      execution,
      phase: (optionalString(module, "phase") ?? "runtime") as "data" | "runtime",
      weight: typeof module.weight === "number" ? module.weight : 0,
    }));
  }

  const declaredAssets = input.assets === undefined ? [] : input.assets;
  if (!Array.isArray(declaredAssets)) throw new TypeError("assets must be a list.");
  const assets = [];
  let creatorSourceBytes = entryBytes.byteLength;
  for (const entry of declaredAssets) {
    const asset = record(entry, ["assetId", "path", "mediaType", "compression"], "Inline asset");
    const source = (await context.workspace.readFile(requiredString(asset, "path"), MAX_MEDIA_BYTES)).bytes;
    const compression = (optionalString(asset, "compression") ?? "gzip") as "none" | "gzip" | "deflate";
    if (compression !== "none" && compression !== "gzip" && compression !== "deflate") {
      throw new TypeError("Inline asset compression must be none, gzip, or deflate.");
    }
    creatorSourceBytes += source.byteLength;
    assets.push({
      id: requiredString(asset, "assetId"),
      mediaType: requiredString(asset, "mediaType"),
      source,
      compression,
    });
  }

  const document = await buildKeelInlineLocalDocument({
    shell,
    modules,
    assets,
    entry: { id: "entry", mediaType: entryMediaType, source: entryBytes },
  });

  const carriage = optionalString(input, "carriage") ?? "compact";
  const resolvedCarriage = resolveKeelInlineCarriage(carriage);
  const presentationPolicy = (optionalString(input, "presentationPolicy") ?? "collector-inline") as "collector-inline" | "external-resolver" | "raw-artifact";
  if (!["collector-inline", "external-resolver", "raw-artifact"].includes(presentationPolicy)) throw new TypeError("Unsupported presentationPolicy.");
  if (presentationPolicy === "collector-inline" && resolvedCarriage !== "raw-percent") {
    throw new TypeError("Collector-facing Inline defaults to raw-percent. Legacy carriage requires an explicit external-resolver or raw-artifact presentationPolicy.");
  }
  const graph = await buildKeelInlineTokenURIGraph(document, { carriage: resolvedCarriage });

  const shared = document.parts.filter((part) => part.kind === "existing");
  const creator = document.parts.filter((part) => part.kind === "creator");
  const creatorAssetParts = creator.filter((part) => part.role === "asset");
  if (creatorAssetParts.length !== assets.length) {
    throw new Error("Inline creator asset accounting did not match the verified document graph.");
  }
  const assetMeasurements = assets.map((asset, index) => {
    const part = creatorAssetParts[index]!;
    const item = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(part.bytes).slice(1)) as {
      readonly embedded?: { readonly storedBase64?: unknown };
    };
    if (typeof item.embedded?.storedBase64 !== "string") {
      throw new Error(`Inline asset ${asset.id} has no canonical packed resource slot.`);
    }
    const storedBinaryBytes = Buffer.from(item.embedded.storedBase64, "base64").byteLength;
    const sourceBytes = asset.source.byteLength;
    const packedFragmentBytes = part.byteLength;
    return Object.freeze({
      assetId: asset.id,
      mediaType: asset.mediaType,
      sourceBytes,
      storedBinaryBytes,
      packedFragmentBytes,
      sourceToPackedOverheadBytes: packedFragmentBytes - sourceBytes,
      sourceToPackedOverheadPercent: ((packedFragmentBytes - sourceBytes) / sourceBytes) * 100,
      compression: asset.compression,
      binaryPackingLayers: 1,
    });
  });
  const assetSourceBytes = assetMeasurements.reduce((total, asset) => total + asset.sourceBytes, 0);
  const assetPackedBytes = assetMeasurements.reduce((total, asset) => total + asset.packedFragmentBytes, 0);

  let prepared;
  let web3Metadata;
  let preparedAudit: Awaited<ReturnType<typeof recordTokenStandardAudit>> | undefined;
  const metadataTransport = optionalString(input, "metadataTransport");
  if (metadataTransport !== undefined && metadataTransport !== "web3-json") throw new TypeError("Unknown metadata transport.");
  if (metadataTransport === undefined && (input.metadataPath !== undefined || input.tokenId !== undefined || input.web3ImageResolver !== undefined)) {
    throw new TypeError("metadataPath, tokenId and web3ImageResolver require metadataTransport: web3-json.");
  }
  const collection = optionalString(input, "collection");
  const imageRoute = optionalString(input, "imageRoute") ?? "prepared";
  if (imageRoute !== "prepared" && imageRoute !== "contract-svg") throw new TypeError("imageRoute must be prepared or contract-svg.");
  if (metadataTransport === "web3-json" && resolvedCarriage !== "raw-percent") {
    throw new TypeError("web3-json uses the compact raw-percent viewer carriage.");
  }
  if (collection !== undefined || metadataTransport === "web3-json") {
    const imageSvgPath = optionalString(input, "imageSvgPath");
    if (imageRoute === "contract-svg" && imageSvgPath === undefined) throw new TypeError("imageRoute contract-svg needs imageSvgPath: a sample svg(uint256) output from keel-svg-create or the deployed renderer.");
    const imagePath = optionalString(input, "imagePath") ?? imageSvgPath;
    if (imagePath === undefined) {
      throw new TypeError(
        "A prepared one-of-one tokenURI needs an onchain image: imagePath (poster inlined as data:image) or, for a "
        + "contract-generated SVG, imageRoute: contract-svg with imageSvgPath. Leaving it out makes KEEL721 fall back "
        + "to the manifest locator, which marketplaces cannot fetch.",
      );
    }
    if (optionalString(input, "imagePath") !== undefined && imageSvgPath !== undefined) throw new TypeError("Provide imagePath or imageSvgPath, not both.");
    const poster = (await context.workspace.readFile(imagePath, MAX_MEDIA_BYTES)).bytes;
    if (imageSvgPath !== undefined) {
      const svgText = new TextDecoder("utf-8", { fatal: true }).decode(poster);
      if (!/<svg[\s>]/iu.test(svgText)) throw new TypeError("imageSvgPath must be an SVG document.");
      if (/<script[\s>]|\son[a-z]+\s*=/iu.test(svgText)) throw new TypeError("A token image SVG must be passive: no <script> or event handlers.");
    }
    const posterType = imageSvgPath !== undefined ? "image/svg+xml" : imagePath.endsWith(".webp") ? "image/webp"
      : imagePath.endsWith(".png") ? "image/png"
      : imagePath.endsWith(".avif") ? "image/avif"
      : /\.jpe?g$/iu.test(imagePath) ? "image/jpeg"
      : imagePath.endsWith(".gif") ? "image/gif"
      : imagePath.endsWith(".svg") ? "image/svg+xml" : "image/webp";
    if (metadataTransport === "web3-json") {
      const original = (await context.workspace.readFile(requiredString(input, "metadataPath"), MAX_MEDIA_BYTES)).bytes;
      web3Metadata = await buildKeelWeb3TokenJSONGraph({
        document, metadata: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(original)),
        imageURI: buildKeelInlineImageURI(poster, posterType), tokenId: requiredString(input, "tokenId"),
        ...(input.tokenIdFieldsJson === undefined ? {} : { tokenIdFields: JSON.parse(requiredString(input, "tokenIdFieldsJson")) }),
        ...(input.web3ImageResolver === undefined ? {} : { web3Image: { resolver: requiredString(input, "web3ImageResolver") as `0x${string}`, chainId: input.chainId as number } }),
        presentationPolicy,
      });
    } else prepared = await buildKeelPreparedOneOfOneTokenURI({
      graph,
      chainId: typeof input.chainId === "number" ? input.chainId : 11_155_111,
      collection: collection as `0x${string}`,
      collectionName: optionalString(input, "collectionName") ?? "",
      description: optionalString(input, "description") ?? "",
      imageURI: buildKeelInlineImageURI(poster, posterType),
      manifestURI: optionalString(input, "manifestURI") ?? "",
      manifestDigest: (optionalString(input, "manifestDigest") ?? `0x${"0".repeat(64)}`) as `0x${string}`,
      tokenId: 1,
      presentationPolicy,
    });
    if (prepared !== undefined) {
      // build → audit: the exact prepared tokenURI is audited here, so its digest can back the wallet request.
      preparedAudit = await recordTokenStandardAudit(context.workspace, { subject: { kind: "bytes", source: "keel-inline-prepare" }, analysis: await analyzeTokenUri(prepared.tokenURI) });
    }
    const preparedTokenURIBytes = prepared === undefined ? web3Metadata!.byteLength : Buffer.byteLength(prepared.tokenURI, "utf8");
    if (preparedTokenURIBytes > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
      throw new RangeError(
        `The complete prepared tokenURI is ${preparedTokenURIBytes.toLocaleString()} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES.toLocaleString()}-byte public-read limit.`,
      );
    }
  }

  // Part bytes, object ids and the storage operations, so the whole graph (and its root weld) comes from the MCP.
  const outputDirectory = optionalString(input, "outputDirectory");
  const hold = optionalString(input, "hold");
  if (hold !== undefined && outputDirectory === undefined) throw new TypeError("hold needs outputDirectory: the part bytes and the weld plan are written there.");
  let graphOutput: Record<string, unknown> | undefined;
  if (outputDirectory !== undefined) {
    const safe = (value: string) => value.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 64);
    const written: Array<Record<string, unknown> & { readonly path: string }> = [];
    for (const [index, part] of graph.parts.entries()) {
      const source = document.parts[index] as { readonly moduleId?: string; readonly id?: string } | undefined;
      const name = `part-${String(index).padStart(2, "0")}-${part.role}${source?.moduleId ? `-${safe(source.moduleId)}` : ""}.txt`;
      await context.workspace.writeText(`${outputDirectory}/${name}`, new TextDecoder().decode(part.bytes));
      written.push({ index, role: part.role, sourceKind: (part as { sourceKind?: string }).sourceKind, ...((part as { sourceObjectId?: string }).sourceObjectId === undefined ? {} : { sourceObjectId: (part as { sourceObjectId?: string }).sourceObjectId }), path: `${outputDirectory}/${name}`, byteLength: part.bytes.byteLength, sha256: sha256Hex(part.bytes) });
    }
    await context.workspace.writeText(`${outputDirectory}/graph-fragment.txt`, new TextDecoder().decode(graph.fragmentBytes));
    if (prepared !== undefined) await context.workspace.writeText(`${outputDirectory}/tokenURI.txt`, prepared.tokenURI);
    let weld: Record<string, unknown> | undefined;
    if (hold !== undefined) {
      const plan = await planGraphWeld({ hold, mediaType: graph.mediaType, parts: graph.parts.map((part, index) => ({ bytes: part.bytes, label: `${index}:${part.role}`, path: written[index]!.path })), content: graph.fragmentBytes });
      const weldPath = await context.workspace.writeText(`${outputDirectory}/graph-weld.json`, `${JSON.stringify(plan, null, 2)}\n`);
      weld = { ...summarizeGraphWeld(plan), planPath: `${outputDirectory}/graph-weld.json`, planSha256: sha256Hex(`${JSON.stringify(plan, null, 2)}\n`), absolutePath: weldPath };
    }
    graphOutput = { directory: outputDirectory, fragmentPath: `${outputDirectory}/graph-fragment.txt`, ...(prepared === undefined ? {} : { tokenURIPath: `${outputDirectory}/tokenURI.txt` }), parts: written, ...(weld === undefined ? {} : { weld }) };
  }

  return Object.freeze({
    schema: "keel.inline-prepare@1" as const,
    ...(graphOutput === undefined ? {} : { graph: graphOutput }),
    ...(collection === undefined ? {} : { image: imageRoute === "contract-svg"
      ? { route: "contract-svg", note: "The prepared tokenURI embeds the sample SVG for review and audit. Live, the renderer contract generates the image (svg(uint256)); after binding it, run keel-token-standard-audit against the live contract." }
      : { route: "prepared", note: "The exact image carriage is prepared once and copied by tokenURI." } }),
    status: "review-only" as const,
    carriage,
    resolvedCarriage,
    presentationPolicy,
    shell: { prefixBytes: shell.prefix.bytes.byteLength, suffixBytes: shell.suffix.bytes.byteLength },
    modules: modules.map((module) => Object.freeze({
      moduleId: module.moduleId, version: module.version, execution: module.execution,
      fragmentBytes: module.bytes.byteLength, integrity: module.integrity,
    })),
    assets: assetMeasurements,
    storage: {
      sharedBytes: shared.reduce((total, part) => total + part.byteLength, 0),
      creatorBytes: creator.reduce((total, part) => total + part.byteLength, 0),
      creatorSourceBytes,
      graphStoredBytes: graph.fragmentBytes.byteLength,
      sourceToGraphOverheadBytes: graph.fragmentBytes.byteLength - creatorSourceBytes,
      sourceToGraphOverheadPercent: creatorSourceBytes === 0
        ? 0
        : ((graph.fragmentBytes.byteLength - creatorSourceBytes) / creatorSourceBytes) * 100,
      assetSourceBytes,
      assetPackedBytes,
      assetPackingOverheadBytes: assetPackedBytes - assetSourceBytes,
      assetPackingOverheadPercent: assetSourceBytes === 0
        ? 0
        : ((assetPackedBytes - assetSourceBytes) / assetSourceBytes) * 100,
      artworkBinaryPackingLayers: assets.length === 0 ? 0 : 1,
      completeDocumentBase64Layers: resolvedCarriage === "raw-percent" ? 0 : resolvedCarriage === "percent" ? 1 : 2,
      imageSourceStorage: "source bytes retained for validation; publish one prepared ASCII image payload/URI and never raw-plus-encoded duplicates",
      imageBoundary: "one canonical Base64 data:image carriage prepared before publication; tokenURI only copies its header/payload/footer",
      note: "Compact is automatic: creator assets are packed once at their binary slot; the complete HTML and metadata are not Base64-wrapped again, and media is never encoded during a read.",
    },
    tokenURIBytes: graph.fragmentBytes.byteLength,
    fragmentIntegrity: graph.fragmentIntegrity,
    mediaType: graph.mediaType,
    ...(web3Metadata === undefined ? {} : {
      web3Metadata: {
        schema: web3Metadata.schema, tokenId: web3Metadata.tokenId,
        mediaType: web3Metadata.mediaType, byteLength: web3Metadata.byteLength,
        integrity: web3Metadata.integrity,
        imageTransport: web3Metadata.imageTransport,
        ...(web3Metadata.imageResponse === undefined ? {} : { imageResponse: {
          uri: web3Metadata.imageResponse.uri, mediaType: web3Metadata.imageResponse.mediaType,
          byteLength: web3Metadata.imageResponse.byteLength, integrity: web3Metadata.imageResponse.integrity,
          parts: web3Metadata.imageResponse.parts.map(part => ({ role: part.role, sourceKind: part.sourceKind, integrity: part.integrity })),
          read: "KeelTokenMatrix.tokenJSON(uint256)", published: false, selectedChainBindingVerified: false, readLimitsVerified: false,
        } }),
        originalMetadataIntegrity: web3Metadata.originalMetadataIntegrity,
        completeDocumentBase64Layers: 0,
        parts: web3Metadata.parts.map(part => ({ role: part.role, sourceKind: part.sourceKind, integrity: part.integrity })),
        read: "KeelTokenMatrix.tokenJSON(uint256)",
        binding: "Compile shared parts with keel-token-matrix-prepare. Each explicit token ID selects a template and compact trait/resource choices; no complete JSON is stored per token.",
        selectedChainBindingVerified: false,
      },
    }),
    ...(prepared === undefined ? {} : {
      prepared: Object.freeze({
        requiredBuilder: prepared.requiredBuilder,
        animationEncoding: prepared.animationEncoding,
        encodedPrefixBytes: prepared.encodedPrefix.byteLength,
        encodedSuffixBytes: prepared.encodedSuffix.byteLength,
        tokenURIBytes: Buffer.byteLength(prepared.tokenURI, "utf8"),
        standardAudit: preparedAudit === undefined ? undefined : {
          verdict: preparedAudit.verdict, digest: preparedAudit.digest, recordPath: preparedAudit.recordPath,
          blocking: preparedAudit.summary.blocking, findings: preparedAudit.findings.slice(0, 16),
          use: "Pass digest as standards.auditDigest to keel-creator-collection-prepare / wallet-link / wallet-request-prepare.",
        },
        bind: prepared.requiredBuilder === "KeelHarnessBuilder"
          ? "KEEL721.setPreEncodedOnchainHarness(builder, compositeObjectId, digest)"
          : "KEEL721.setPreparedOnchainHarness(builder, compositeObjectId, digest, encodedPrefix, encodedSuffix)",
      }),
    }),
    caveat: "Bytes are planned, not published. Cast the fragments into KeelHold, weld the composite, then bind.",
  });
}

const tezosShellPrepareSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  required: ["network", "builder", "creator", "action"],
  properties: {
    network: { type: "string", description: "Explicit Tezos chain ID (Net...), checked with its Base58 checksum." },
    builder: { type: "string", description: "Originated KT1 KeelHarnessBuilder address." },
    creator: { type: "string", description: "Expected Tezos sender; used in the native creator-shell identity." },
    action: { type: "string", enum: ["register", "update", "freeze"] },
    salt: { type: "string", description: "bytes32 salt; registration only." },
    shellId: { type: "string", description: "bytes32 shell ID; update or freeze only." },
    prefixObjectId: { type: "string" }, suffixObjectId: { type: "string" }, metadataObjectId: { type: "string" },
    payloadMode: { type: "string", enum: ["sandboxed-html", "gzip-base64", "pre-encoded-graph"] },
    standards: standardsEvidence,
  },
};

const tezosPublicationPrepareSchema: JsonSchema = {
  type: "object", additionalProperties: false,
  required: ["network", "creator", "action"],
  properties: {
    network: { type: "string", description: "Exact selected Tezos Net... chain identity." },
    creator: { type: "string", description: "Expected wallet sender; no key material is accepted." },
    action: { type: "string", enum: ["configure-verifier", "forge-harness", "register-collection", "publish-collection", "activate-collection", "set-minter", "set-presentation", "set-token-metadata", "set-token-json", "freeze-token-metadata", "strike"] },
    hold: { type: "string" }, index: { type: "string" }, collection: { type: "string" },
    prefixObjectId: { type: "string" }, suffixObjectId: { type: "string" },
    salt: { type: "string" }, slotObjectIds: { type: "array", items: { type: "string" }, maxItems: 128 }, manifestSha256: { type: "string" },
    manifestUri: { type: "string", maxLength: 2048 }, manifestDigest: { type: "string" }, previewUri: { type: "string", maxLength: 2048 },
    revision: { type: "integer", minimum: 1 }, tokenId: { type: "integer", minimum: 1 }, tokenInfo: { type: "object", description: "FA2/TZIP-12 token_info map. Values are ordinary URI or metadata strings; onchfs:// is supported." }, tokenJson: { type: "string", maxLength: 262144, description: "Raw JSON compatibility document returned by the KeelSleeve route." }, account: { type: "string" }, enabled: { type: "boolean" }, recipient: { type: "string" }, quantity: { type: "integer", minimum: 1 },
    standards: standardsEvidence,
  },
};

const TEZOS_AUDIT_GAP = "keel-token-standard-audit reads EVM tokenURI; Tezos token metadata is not audited yet.";

async function tezosPublicationPrepareTool(context: ToolContext, value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Tezos publication arguments must be an object.");
  const { standards, ...input } = value as Record<string, any>;
  for (const key of Object.keys(input)) if (/(?:private|secret|mnemonic|seed|passphrase)/iu.test(key)) throw new TypeError("Private signer material is never accepted by the Tezos publication adapter.");
  if (!/^Net[1-9A-HJ-NP-Za-km-z]{12}$/u.test(input.network)) throw new TypeError("network must be an exact Tezos Net... identity.");
  const clearance = await enforceStandards(context, standards, { tool: "keel-tezos-publication-prepare", defaultWorkKind: "metadata", allowedWorkKinds: ["metadata", "collection", "viewer", "registry-or-module"], auditUnavailable: TEZOS_AUDIT_GAP });
  const common = { source: input.creator };
  let operation;
  switch (input.action) {
    case "configure-verifier": operation = buildKeelHoldConfigureVerifier({ ...common, hold: input.hold, prefixObjectId: input.prefixObjectId, suffixObjectId: input.suffixObjectId }); break;
    case "forge-harness": operation = buildKeelForgeHarness({ ...common, hold: input.hold, salt: input.salt, slotObjectIds: input.slotObjectIds, manifestSha256: input.manifestSha256 }); break;
    case "register-collection": operation = buildKeelIndexRegisterCollection({ ...common, index: input.index, collection: input.collection, controller: input.account }); break;
    case "publish-collection": operation = buildKeelIndexPublishCollection({ ...common, index: input.index, collection: input.collection, manifestUri: input.manifestUri, manifestDigest: input.manifestDigest, ...(input.revision === undefined ? {} : { parentRevision: Math.max(0, input.revision - 1) }) }); break;
    case "activate-collection": operation = buildKeelIndexActivateCollection({ ...common, index: input.index, collection: input.collection, revision: input.revision }); break;
    case "set-minter": operation = buildKeelCollectionSetMinter({ ...common, collection: input.collection, account: input.account, enabled: input.enabled }); break;
    case "set-presentation": operation = buildKeelCollectionPresentation({ ...common, collection: input.collection, manifestUri: input.manifestUri, manifestDigest: input.manifestDigest, previewUri: input.previewUri }); break;
    case "set-token-metadata": {
      if (input.tokenInfo === null || typeof input.tokenInfo !== "object" || Array.isArray(input.tokenInfo)) throw new TypeError("tokenInfo must be an object.");
      for (const [key, value] of Object.entries(input.tokenInfo)) if (typeof value !== "string") throw new TypeError(`tokenInfo.${key} must be a string.`);
      operation = buildKeelCollectionSetTokenMetadata({ ...common, collection: input.collection, tokenId: input.tokenId, tokenInfo: input.tokenInfo });
      break;
    }
    case "set-token-json": {
      if (typeof input.tokenJson !== "string") throw new TypeError("tokenJson must be a string.");
      operation = buildKeelCollectionSetTokenJson({ ...common, collection: input.collection, tokenId: input.tokenId, value: input.tokenJson });
      break;
    }
    case "freeze-token-metadata": operation = buildKeelCollectionFreezeTokenMetadata({ ...common, collection: input.collection, tokenId: input.tokenId }); break;
    case "strike": operation = buildKeelCollectionStrike({ ...common, collection: input.collection, recipient: input.recipient, quantity: input.quantity }); break;
    default: throw new TypeError("Unsupported Tezos publication action.");
  }
  return {
    schema: "keel.tezos.publication-call-prepare@1",
    status: "review-only",
    family: "tezos",
    network: input.network,
    expectedSender: input.creator,
    operation,
    standards: clearance,
    signing: "not-performed",
    submission: "not-performed",
    caveat: "This is one receipt-bound call from the staged KEEL Tezos one-of-one adapter. It does not originate, sign, submit, or invent a contract address.",
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  tool("keel-tezos-shell-prepare", "Prepare native Tezos shell registration, update, or permanent freeze parameters with explicit network and sender. Requires standards.preflightReceipt. Read-only preparation: no RPC, signing, submission, or default-shell replacement. Receipt-backed selected-chain object and registry checks are still required.", tezosShellPrepareSchema, async (context, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Tezos shell arguments must be an object.");
    const { standards, ...input } = value as Record<string, unknown>;
    const clearance = await enforceStandards(context, standards, { tool: "keel-tezos-shell-prepare", defaultWorkKind: "viewer", allowedWorkKinds: ["viewer"] });
    const prepared = await prepareKeelTezosShell(input as unknown as KeelTezosShellPrepareInput);
    return prepared !== null && typeof prepared === "object" && !Array.isArray(prepared) ? { ...prepared, standards: clearance } : { prepared, standards: clearance };
  }),
  tool("keel-tezos-publication-prepare", "Prepare one exact receipt-bound Tezos KEEL one-of-one publication call using the standard Hold, Index, and FA2 modules. The public route is ordinary FA2/TZIP-12 token_metadata with onchfs:// or another selected carrier; the KEEL JSON/harness route is compatibility-only. Requires standards.preflightReceipt. Review-only: no private key, origination, signing, submission, or fake address is accepted.", tezosPublicationPrepareSchema, tezosPublicationPrepareTool),
  ...ENGINE_TOOL_DEFINITIONS,
  tool("keel-token-standard-audit", "HARD GATE for tokens, collections, metadata and viewers. Reads tokenURI live (rpcUrl + contract + tokenId: one eth_call capped at 30M gas at a pinned block; eth_estimateGas is advisory only) or audits prepared bytes (tokenUri / tokenUriPath). Decodes the data: JSON (raw-percent or base64) and every embedded data: URI, unpacking gzip/deflate, and FAILS CLOSED on any http(s), ipfs, ar/arweave, web3:// or keel-onchain locator (only http://www.w3.org/2000/svg is allowed), an image that is not an onchain data:image, an HTML viewer that is not the registered canonical KEEL shell, complete-HTML Base64, reads above 30M gas or tokenURI over 2 MB. Returns verdict, exact findings and a digest; pass the digest as standards.auditDigest. A waiver must be an explicit exception {codes, reason, reviewer}. Writes only its record under .keel-mcp/audits/.", TOOL_SCHEMAS.tokenStandardAudit, tokenStandardAuditTool),
  ...EDITOR_TOOL_DEFINITIONS,
  ...LAYERED_TOOL_DEFINITIONS,
  ...SVG_TOOL_DEFINITIONS,
  ...CURATION_TOOL_DEFINITIONS,
  ...MATRIX_TOOL_DEFINITIONS,
  ...ARENA_TOOL_DEFINITIONS,
  tool("analyze", "Analyze a workspace media file and report integrity and wrapper support.", TOOL_SCHEMAS.analyze, analyzeTool),
  tool("media-optimize", "Dry-run a reversible media optimization. It reports only repository-supported adapters and never writes, changes storage mode, uploads, or touches a chain.", TOOL_SCHEMAS.mediaOptimize, mediaOptimizeTool),
  tool("media-optimize-apply", "Write one new optimized file only when its recomputed digest and byte length exactly match a reviewed media-optimize result. The source and selected storage mode are preserved; no upload, wallet, or chain action occurs.", TOOL_SCHEMAS.mediaOptimizeApply, mediaOptimizeApplyTool),
  tool("build", "Build and verify a deterministic local media artifact; no chain or wallet action occurs.", TOOL_SCHEMAS.build, buildTool),
  tool("verify", "Verify a local artifact manifest and its available relative resources.", TOOL_SCHEMAS.verify, verifyTool),
  tool("cost", "Estimate compression, chunks, recursive depth, transactions, and calldata using an offline model.", TOOL_SCHEMAS.cost, costTool),
  tool("upload-plan", "Plan flat or recursive chunk uploads from bounded local bytes without writing to the workspace or touching a chain.", TOOL_SCHEMAS.uploadPlan, uploadPlanTool),
  tool("keel-graph-weld-prepare", "Plan a multi-part KEEL graph in KeelHold from the MCP: each part's castSlugs + weldObject and the ROOT weldComposite joining them in order (e.g. canonical shell top + modules + assets + entry + shell bottom from keel-inline-prepare outputDirectory). Returns object ids and exact calldata (large plans as a workspace file + sha256). Storage-only; review-only, never signs or submits.", TOOL_SCHEMAS.graphWeld, graphWeldPrepareTool),
  tool("chain-plan", "Verify a materialized upload plan and emit deterministic review-only contract operation descriptors; no ABI encoding, signing, or submission occurs.", TOOL_SCHEMAS.chainPlan, chainPlanTool),
  tool("ethereum-encode", "Encode verified local Ethereum KeelHold operations with viem for review only; no RPC, signing, submission, or QR payload is produced. Results above the inline budget are written in full to a workspace file and returned as path + sha256 (never re-encode by hand).", TOOL_SCHEMAS.ethereumEncode, ethereumEncodeTool),
  tool("publish-plan", "Bind a verified review-only chain descriptor (chainPlan, or chainPlanPath when chain-plan delivered a file) to a canonical SDK envelope. Plain asset storage passes as storage-only; HTML, JSON or KEEL tokenURI fragment bytes are viewer/metadata work and require standards.preflightReceipt (metadata also standards.auditDigest). Existing graph revisions must pass the one-resource delta gate. No ABI encoding, signing, or submission occurs.", TOOL_SCHEMAS.publishPlan, publishPlanTool),
  tool("module-resolve", "Resolve one exact module selector from a local snapshot without fetching carriers.", TOOL_SCHEMAS.moduleResolve, moduleResolveTool),
  tool("module-lock", "Write a canonical local module lock and unavailable-by-default receipt.", TOOL_SCHEMAS.moduleLock, moduleLockTool),
  tool("wallet-request-prepare", "Prepare a canonical user-reviewable wallet request: request (prepared calldata), call (ABI/artifact + exact signature + args, encoded through keel-contract-controls; a {call:{...}} argument nests, and via:{authority} wraps it in KeelAuthority.execute/callAsDelegate), or a contract deployment (deploy: compiler artifact + constructor args; bytecode is checked against the artifact and args are encoded like keel-contract-controls) without signing or submitting. Addresses may be EIP-55 checksummed. Only KeelHold storage writes (castSlugs/weldObject/weldComposite, zero value) pass without evidence. Anything else refuses unless standards.preflightReceipt is valid, and token-contract work (the default) also needs standards.auditDigest from a passing keel-token-standard-audit of the exact target contract.", TOOL_SCHEMAS.walletRequestPrepare, walletRequestPrepareTool),
  tool("wallet-link", "Prepare a review-only account-to-agent KeelFactory castDieFor authorization and JSON-safe EIP-712 typed data. Emitting typed data requires standards.preflightReceipt and a passing standards.auditDigest of the collection's prepared tokenURI. No signing, RPC, or submission occurs.", TOOL_SCHEMAS.walletLink, walletLinkTool),
  tool("module-review-prepare", "Prepare a review-only KeelModuleReviewRegistry action (submit/sanction/deprecate/revoke a non-contract module's onchain trust) as a canonical descriptor. Requires standards.preflightReceipt. No signing, encoding, or submission occurs.", TOOL_SCHEMAS.moduleReview, moduleReviewPrepareTool),
  tool("fray-auction-intake", "Collect the title, description, chain, and one of exactly four Fray auction presets before emitting a user-approved API and wallet handoff; no signing or submission occurs.", TOOL_SCHEMAS.frayAuctionIntake, frayAuctionIntakeTool),
  tool("fray-stage-project", "Upload bounded source bytes to the configured Fray Studio temporary project store, prepare still/video previews, preflight the fee, and return a wallet-facing handoff; no signing or submission occurs.", TOOL_SCHEMAS.frayStageProject, frayStageProjectTool),
  tool("keel-chain-guide", "List supported testnets and human faucet links; the MCP server never claims faucet funds or moves wallet assets.", TOOL_SCHEMAS.chainGuide, chainGuideTool),
  tool("keel-library-search", "Search configured Keel Studio Keel indexes for exact reusable library/module candidates; metadata only, no carrier bytes are fetched.", TOOL_SCHEMAS.keelLibrarySearch, keelLibrarySearchTool),
  tool("keel-onchain-data-prepare", "Turn declared contract reads into artwork variables. With record, automatically discover its KEEL seed profile and expose KEEL.data.token without individual field declarations; the contract must advertise IKeelMintSeededData. Each declared read becomes one eth_call, the answers are frozen into a canonical pack, and the tool returns the init fragment that publishes them as a frozen global before any runtime or render module runs, so creator code reads KEEL.data.<name> instead of fetching at draw time and finding undefined. Static return types only: a dynamic return needs an offset table, and guessing it would hand back a plausible wrong number. Arguments are decimal or 0x-hex text because a uint256 does not survive a JSON number. An omitted rpcUrl resolves KEEL_ONCHAIN_RPC_URL, then the configured public RPC; loopback HTTP is accepted so a local anvil is the ordinary target while a work is being built. The returned fragment is executed before it is returned, so the published values are checked, not assumed. Read-only: eth_call plus chain identity and head. No signing or submission occurs, no state is written, and no wallet is touched.", TOOL_SCHEMAS.onchainData, onchainDataTool),
  tool("keel-endpoint-config", "Resolve the Studio, public RPC, and optional indexer URLs using explicit input, KEEL environment configuration, then canonical test defaults; no network request occurs.", TOOL_SCHEMAS.endpointConfig, endpointConfigTool),
  tool("keel-studio-capabilities", "Inspect a Studio's supported chains, zero-spend sandbox, staging, authorization, and MSP readiness before any upload or wallet action.", TOOL_SCHEMAS.studioCapabilities, studioCapabilitiesTool),
  tool("keel-studio-project-intake", "Ask only for missing project decisions, then return either storage-only preparation or an editable release/listing intent. No upload, signature, wallet request, or transaction occurs.", TOOL_SCHEMAS.studioProjectIntake, studioProjectIntakeTool),
  tool("keel-studio-draft", "List, read, create, or revision-safely edit a creator's private Studio release draft through a scoped key. It cannot prepare, sign, submit, cancel, or publish a chain action.", TOOL_SCHEMAS.studioDraft, studioDraftTool),
  tool("keel-studio-stage-project", "Stage bounded creator resources/modules and return the server-issued Studio handoff. Omitted viewer selects Studio's canonical KEEL Inline graph for later preparation; `none` is the explicit raw-artifact route with no viewer and does not prevent a later release or mint. Automatic compact preparation requires the exact selected-chain KeelRawTokenURIBuilder and canonical raw-percent shell fragments with receipts/read-back; Studio must never fall back to legacy Base64 carriage silently. A direct image, video, or self-contained GLB resolves to registered shell plus registered keel.asset-display@1 plus the creator media entry, never zero modules or a generated index.html. Legacy protector getters and NoProtector do not determine default Inline readiness. Creator HTML is content, never a replacement shell, and agents must not upload a locally manufactured KEEL shell, protected-harness wrapper, or local wrapper when the catalog is incomplete. Studio must fail closed for an incomplete selected-chain catalog during preparation. The scoped agent key remains in the MCP environment; no wallet signature or chain action occurs.", TOOL_SCHEMAS.studioStageProject, studioStageProjectTool),
  tool("keel-creator-collection-prepare", "Prepare one exact EIP-5792 KeelCreatorFactory batch plus its durable recovery envelope. Requires standards.preflightReceipt and a passing standards.auditDigest (the prepared tokenURI, or the live external token contract). This never signs or submits. Missing or ambiguous factory/renderer deployments stop before any wallet approval.", TOOL_SCHEMAS.creatorCollectionPrepare, creatorCollectionPrepareTool),
  tool("keel-shell-search", "Search the read-back-verified shell catalogue by creator, name, version, or tags. Returns top/bottom object pointers and metadata only; it never fetches carrier bytes, signs, or submits.", TOOL_SCHEMAS.shellSearch, shellSearchTool),
  tool("keel-inline-prepare", "Plan a collector-facing INLINE Keel graph with the registered canonical shell, reusable executable modules, creator-owned assets, and one creator entry. Omitted carriage and presentationPolicy use the automatic compact raw-percent saver plus collector-inline: exact supplied data:image/* bytes and complete data:text/html;charset=utf-8 HTML, with no IPFS/HTTP/web3 resolver or legacy complete-HTML Base64. Original binary image bytes are stored once; the final image field assembles its data:image/<type>;base64 header, canonical Base64 exact payload and JSON delimiter/footer. GIF is direct data:image/gif and never an SVG wrapper or placeholder. The result reports source, stored graph, and complete tokenURI bytes and rejects a result above the public-read ceiling. External resolvers and legacy artifact carriage require explicit reviewed policies. Review-only: it never signs or submits.", TOOL_SCHEMAS.inlinePrepare, inlinePrepareTool),
  tool("keel-shell-prepare", "Create canonical creator/tag shell metadata or prepare creator registration, update, or irreversible freeze calls (register/update/freeze require standards.preflightReceipt). One stable shell ID can publish revisions until its creator freezes it. The recommended viewer follows the current revision; pinning one revision is explicit. A shell is one reusable top and bottom around the work graph; this tool never signs, submits, or invents a replacement default shell.", TOOL_SCHEMAS.shellPrepare, shellPrepareTool),
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((entry) => entry.descriptor.name === name);
}
