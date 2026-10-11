import { SIGNATURE_PRIVACY_TOOL_DEFINITIONS } from "./signature-privacy-tools.js";
import { MEDIA_EDIT_TOOL_DEFINITIONS } from "./media-edit-tools.js";
import { startStudioConnection, getStudioConnection, completeStudioConnection, loadStudioAgentToken, type StudioConnectionScope } from "@keel/sdk/studio-connection-node";
import { resolveKeelShell, resolveKeelPayloadStorage, resolveKeelPayloadCompression } from "@keel/protocol";
import { loadCopyReadFiles } from "./copy-read-tool.js";
import { CURATION_TOOL_DEFINITIONS } from './curation-tools.js';
import { MATRIX_TOOL_DEFINITIONS } from './matrix-tools.js';
import { METADATA_TOOL_DEFINITIONS } from './metadata-tools.js';
import { PREREVEAL_TOOL_DEFINITIONS } from './prereveal-tools.js';
import { ARENA_TOOL_DEFINITIONS } from './arena-tools.js';
import { LAYERED_TOOL_DEFINITIONS } from './layered-tools.js';
import { SVG_TOOL_DEFINITIONS } from './svg-tools.js';
import { CREATOR_INLINE_TOOL_DEFINITIONS } from './creator-inline-tools.js';
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
  assertKeelInlineDeliveryProfile,
  buildKeelInlineShellFragments,
  buildKeelInlineModuleFragment,
  buildKeelInlineLocalDocument,
  buildKeelCreatorOwnedInlineDocument,
  buildKeelInlinePreEncodedTokenURIGraph,
  buildKeelInlineFollowLatestTokenURIBodyGraph,
  buildKeelInlineEscapedTokenURIGraph,
  buildKeelInlineTokenURIGraph,
  buildKeelPreparedOneOfOneTokenURI,
  buildKeelWeb3TokenJSONGraph,
  buildKeelInlineImageURI,
  KEEL_INLINE_MAX_TOKEN_URI_BYTES,
  createKeelWalletRequest,
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
import { TOOL_SCHEMAS } from "./schemas.js";
import { mcpRpc } from "./rpc-tools.js";
import { redactRpcUrl } from "@keel/protocol";
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
// toolResult carries the same value as structuredContent and text; keep
// detailed plans bounded so the duplicated JSON stays below the 1 MiB frame.
const MAX_PLAN_RESPONSE_BYTES = 256 * 1024;

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
  const input = record(value, ["input", "mediaType", "payloadStorage", "compression", "maxChunkBytes", "leafDecodedBytes", "maxPartsPerComposite", "maxTreeDepth"], "cost arguments");
  const loaded = await context.workspace.readFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const compressionValue = optionalString(input, "compression");
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  if (compressionValue !== undefined && !["auto", "none", "brotli", "gzip", "deflate"].includes(compressionValue)) throw new TypeError("compression is unsupported.");
  const mediaType = optionalString(input, "mediaType");
  const maxChunkBytes = optionalNumber(input, "maxChunkBytes");
  const leafDecodedBytes = optionalNumber(input, "leafDecodedBytes");
  const maxPartsPerComposite = optionalNumber(input, "maxPartsPerComposite");
  const maxTreeDepth = optionalNumber(input, "maxTreeDepth");
  const options: CostAnalysisOptions = {
    ...(mediaType === undefined ? {} : { mediaType }),
    compression: resolveKeelPayloadCompression(payloadStorage, compressionValue as CostAnalysisOptions["compression"]),
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
  const input = record(value, ["input", "objectName", "mediaType", "strategy", "payloadStorage", "compression", "maxChunkBytes", "leafDecodedBytes", "maxPartsPerComposite"], "upload-plan arguments");
  const source = await context.workspace.readFile(requiredString(input, "input"), MAX_MEDIA_BYTES);
  const objectName = boundedPlanText(input.objectName, "objectName", 128);
  if (objectName === "." || objectName === ".." || objectName.includes("/") || objectName.includes("\\")) throw new TypeError("objectName must be a metadata-safe name.");
  const mediaType = boundedPlanText(input.mediaType, "mediaType", 128);
  const strategyValue = optionalString(input, "strategy");
  if (strategyValue !== undefined && strategyValue !== "flat" && strategyValue !== "recursive") throw new TypeError("strategy must be flat or recursive.");
  const strategy = strategyValue ?? "flat";
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  const compression = resolveKeelPayloadCompression(payloadStorage, planCompression(input.compression));
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
      payloadStorage,
      ...(compression === undefined ? {} : { compression }),
      ...(maxChunkBytes === undefined ? {} : { maxChunkBytes }),
    };
    const plan = strategy === "recursive"
      ? await (await builder()).createRecursiveUploadPlan(source.bytes, { ...common, ...(leafDecodedBytes === undefined ? {} : { leafDecodedBytes }), ...(maxPartsPerComposite === undefined ? {} : { maxPartsPerComposite }) })
      : await (await builder()).createUploadPlan(source.bytes, common);
    const planBytes = new TextEncoder().encode(JSON.stringify(plan)).byteLength;
    if (planBytes > MAX_PLAN_RESPONSE_BYTES) throw new RangeError(`upload plan response exceeds the ${MAX_PLAN_RESPONSE_BYTES}-byte MCP detail limit; use larger leaves or the builder CLI for a materialized plan.`);
    return { status: "planned", dryRun: true, materialized: false, files: "unavailable-after-dry-run", payloadStorage, storageEncoding: "native-bytes", strategy, plan };
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

async function publishPlanTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainPlan", "publicationIntent", "revision", "preparedCopy"], "publish review plan arguments");
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
  const envelope = await createKeelPublishReviewPlan(input.chainPlan,
    input.preparedCopy === undefined ? undefined : { preparedCopy: await loadCopyReadFiles(context, input.preparedCopy) });
  const preparedCopy = envelope.plan.preparedCopy;
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
    ...(revisionPlan === undefined ? {} : { revisionPlan }),
    ...(preparedCopy === undefined ? {} : { preparedCopy }),
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

async function walletRequestPrepareTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["request", "qr"], "wallet request arguments");
  const envelope = await createKeelWalletRequest(input.request);
  const qr = optionalBoolean(input, "qr");
  const qrPayload = qr === true ? await encodeKeelWalletRequestQr(envelope) : undefined;
  return {
    status: "prepared-only",
    signing: "not-performed",
    submission: "not-performed",
    envelope,
    ...(qrPayload === undefined ? {} : { qr: qrPayload }),
  };
}

async function walletLinkTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["link"], "wallet link arguments");
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
    workspace: context.workspace.root,
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
async function onchainDataTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainId", "rpcUrl", "reads", "record", "blockTag", "globalName", "moduleId", "version"], "On-chain data arguments");
  const seedInput = input.record === undefined ? undefined : record(input.record, ["address", "recordId", "batchSize"], "Seed record");
  const seedBatchSize = seedInput === undefined ? undefined : optionalNumber(seedInput, "batchSize");
  const seedRecord = seedInput === undefined ? undefined : {
    address: requiredString(seedInput, "address") as `0x${string}`,
    recordId: requiredString(seedInput, "recordId"),
    ...(seedBatchSize === undefined ? {} : { batchSize: seedBatchSize }),
  };
  const reads = seedRecord && Array.isArray(input.reads) && input.reads.length === 0 ? [] : parseOnchainReads(input.reads);
  const explicitRpc = optionalString(input, "rpcUrl") ?? process.env.KEEL_ONCHAIN_RPC_URL;
  const chainId = optionalNumber(input, "chainId");
  const rpc = await mcpRpc(context, { ...(explicitRpc === undefined ? {} : { rpcUrl: explicitRpc }), ...(chainId === undefined ? {} : { chainId }) }, true);
  const blockTag = optionalString(input, "blockTag");
  const globalName = optionalString(input, "globalName");
  const moduleId = optionalString(input, "moduleId") ?? "keel/onchain-data";
  const layer = await readOnchainData({
    rpcUrl: rpc.rpcUrl,
    fetchImpl: rpc.fetchImpl,
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
    rpcUrl: redactRpcUrl(rpc.rpcUrl),
    rpcUrlSource: rpc.configuration.source,
    rpcProviders: rpc.pool.status(),
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

async function endpointConfigTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainId", "studioUrl", "publicRpcUrl", "indexerUrl"], "KEEL endpoint arguments");
  const studioUrl = optionalString(input, "studioUrl");
  const publicRpcUrl = optionalString(input, "publicRpcUrl");
  const indexerUrl = optionalString(input, "indexerUrl");
  const chainId = optionalNumber(input, "chainId");
  const rpc = await mcpRpc(context, { ...(publicRpcUrl === undefined ? {} : { rpcUrl: publicRpcUrl }), ...(chainId === undefined ? {} : { chainId }) });
  const endpoints = resolveKeelEndpoints({
    ...(studioUrl === undefined ? {} : { studioUrl }),
    publicRpcUrl: rpc.rpcUrl,
    ...(indexerUrl === undefined ? {} : { indexerUrl }),
  }, process.env);
  return { ...endpoints, publicRpcUrl: redactRpcUrl(rpc.rpcUrl), publicRpcUrls: rpc.configuration.rpcUrls.map(redactRpcUrl), chainId: rpc.configuration.chainId, rpcSource: rpc.configuration.source, sources: { ...endpoints.sources, publicRpcUrl: rpc.configuration.source } };
}

async function moduleReviewPrepareTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["review"], "module review arguments");
  const review = record(
    input.review,
    ["chainId", "registry", "action", "spec", "specDigest", "reviewDigest", "reasonDigest", "replacementSpecDigest", "validUntil"],
    "module review",
  );
  return buildKeelModuleReviewRequest(review as unknown as KeelModuleReviewInput);
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

async function studioConnectTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["operation", "studioUrl", "label", "scopes", "reconnect"], "Studio connection arguments");
  const operation = requiredString(input, "operation");
  const configured = optionalString(input, "studioUrl");
  const options = { workspace: context.workspace.root, studioUrl: resolveKeelEndpoints(configured ? { studioUrl: configured } : {}, process.env).studioUrl };
  if (operation === "status") return getStudioConnection(options);
  if (operation === "complete") return completeStudioConnection(options);
  if (operation !== "start") throw new TypeError("operation must be start, status, or complete.");
  if (input.reconnect !== undefined && typeof input.reconnect !== "boolean") throw new TypeError("reconnect must be a boolean.");
  return startStudioConnection({ ...options, ...(input.label === undefined ? {} : { label: requiredString(input, "label") }),
    ...(input.scopes === undefined ? {} : { scopes: input.scopes as StudioConnectionScope[] }), ...(input.reconnect === undefined ? {} : { reconnect: input.reconnect as boolean }) });
}

async function studioAccessTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["operation", "releaseId", "input", "studioUrl"], "Studio access arguments");
  const operation = requiredString(input, "operation"), releaseId = optionalString(input, "releaseId");
  const configured = optionalString(input, "studioUrl");
  const { createConnectedStudioAccessClient } = await import("@keel/sdk/studio-connection-node");
  const client = await createConnectedStudioAccessClient({ workspace: context.workspace.root, studioUrl: resolveKeelEndpoints(configured ? { studioUrl: configured } : {}, process.env).studioUrl });
  if (operation === "providers") return { ...await client.providers(), setupUrl: `${configured ?? "https://studio.onkeel.io"}/studio` , instructions: "Open a release access page and its Verification provider setup. Never ask for credentials in chat. Desktop is optional." };
  if (!releaseId) throw new TypeError("Use a Studio release UUID.");
  if (operation === "benefits") return client.benefits(releaseId);
  if (operation === "benefit-prepare") { const data = record(input.input, ["groupId", "stageIndex"], "Audience activation"); return client.prepareBenefit(releaseId, requiredString(data, "groupId"), Number(data.stageIndex)); }
  if (operation === "raffle-status") return client.raffleStatus(releaseId);
  if (operation === "raffle-prepare") return client.prepareRaffle(releaseId);
  if (operation === "raffle-draw") return client.drawRaffle(releaseId);
  if (operation === "raffle-cancel") return client.cancelUnsignedRaffle(releaseId);
  if (operation === "raffle-record" || operation === "raffle-confirm") { const data = record(input.input, ["transactionHash"], "Raffle receipt"); const hash = requiredString(data, "transactionHash"); if (!/^0x[0-9a-f]{64}$/iu.test(hash)) throw new TypeError("Use a transaction hash."); return operation === "raffle-record" ? client.recordRaffleTransaction(releaseId, hash as `0x${string}`) : client.confirmRaffle(releaseId, hash as `0x${string}`); }
  if (operation === "read") return client.read(releaseId);
  if (operation === "requests") return client.requests(releaseId);
  const data = record(input.input, operation === "update" ? ["wallets", "expectedRevision", "campaign", "members"] : operation === "test" ? ["wallet", "claimIds"] : ["requestId", "signature"], "Studio access input");
  if (operation === "update") return client.update(releaseId, data as unknown as Parameters<typeof client.update>[1]);
  if (operation === "test") return client.test(releaseId, requiredString(data, "wallet") as `0x${string}`, (data.claimIds ?? []) as string[]);
  if (operation === "approve") return client.approve(releaseId, requiredString(data, "requestId"), requiredString(data, "signature") as `0x${string}`);
  throw new TypeError("Use read, update, test, requests or approve.");
}

async function studioDraftTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "operation", "releaseId", "projectId", "expectedRevision", "draft", "planningCommand", "defaultsCommand", "profileCommand", "profileSelection", "conversationCommand", "includeReadCall", "operationId", "transactionHashes", "recoveryInput"], "Studio draft arguments");
  const operation = requiredString(input, "operation");
  if (!["list", "read", "diagnose", "continue-publication", "cancel-review", "storage-recovery", "recover", "recover-wallet-rejection", "plan", "plan-edit", "defaults", "defaults-edit", "profiles", "profiles-edit", "profile-select", "conversation", "conversation-suggest", "prepare-review", "storage-review", "create", "update"].includes(operation)) throw new TypeError("operation must be list, read, diagnose, continue-publication, cancel-review, storage-recovery, recover, recover-wallet-rejection, plan, plan-edit, defaults, defaults-edit, conversation, conversation-suggest, prepare-review, storage-review, create, or update.");
  const configuredStudioUrl = optionalString(input, "studioUrl");
  const studioUrl = resolveKeelEndpoints({
    ...(configuredStudioUrl === undefined ? {} : { studioUrl: configuredStudioUrl }),
  }, process.env).studioUrl;
  const token = await loadStudioAgentToken({ workspace: context.workspace.root, studioUrl });
  const releaseId = optionalString(input, "releaseId");
  const expectedRevision = optionalNumber(input, "expectedRevision");
  return executeKeelStudioAgentDraftOperation({
    studioUrl,
    grantToken: token,
    ...(input.operationId === undefined ? {} : { operationId: requiredString(input, "operationId") }),
    ...(input.transactionHashes === undefined ? {} : { transactionHashes: input.transactionHashes as string[] }),
    ...(input.recoveryInput === undefined ? {} : { recoveryInput: input.recoveryInput as never }),
    operation: operation as "list" | "read" | "diagnose" | "continue-publication" | "cancel-review" | "storage-recovery" | "recover" | "recover-wallet-rejection" | "plan" | "plan-edit" | "defaults" | "defaults-edit" | "profiles" | "profiles-edit" | "profile-select" | "conversation" | "conversation-suggest" | "prepare-review" | "storage-review" | "create" | "update",
    ...(input.includeReadCall === undefined ? {} : { includeReadCall: optionalBoolean(input, "includeReadCall")! }),
    ...(input.conversationCommand === undefined ? {} : { conversationCommand: input.conversationCommand as never }),
    ...(input.profileCommand === undefined ? {} : { profileCommand: input.profileCommand as never }),
    ...(input.profileSelection === undefined ? {} : { profileSelection: input.profileSelection as never }),
    ...(input.defaultsCommand === undefined ? {} : { defaultsCommand: input.defaultsCommand as never }),
    ...(input.planningCommand === undefined ? {} : { planningCommand: input.planningCommand as never }),
    ...(input.projectId === undefined ? {} : { projectId: requiredString(input, "projectId") }),
    ...(releaseId === undefined ? {} : { releaseId }),
    ...(input.draft === undefined ? {} : { draft: input.draft as never }),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  });
}

async function studioStageProjectTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["studioUrl", "title", "description", "storageStrategy", "payloadStorage", "marketplaceExportMode", "viewer", "files", "reusableModule", "releaseIntent", "projectProfile"], "Studio stage project arguments");
  const configuredStudioUrl = optionalString(input, "studioUrl");
  const studioUrl = resolveKeelEndpoints({ ...(configuredStudioUrl === undefined ? {} : { studioUrl: configuredStudioUrl }) }, process.env).studioUrl;
  const token = await loadStudioAgentToken({ workspace: context.workspace.root, studioUrl });
  const title = requiredBoundedString(input, "title", 160);
  const description = optionalString(input, "description") ?? "";
  if (description.length > 2_000 || /[\u0000-\u001f\u007f]/u.test(description)) throw new TypeError("description must be bounded text.");
  const storageStrategy = requiredString(input, "storageStrategy");
  if (!["local", "onchain", "hybrid"].includes(storageStrategy)) throw new TypeError("storageStrategy must be local, onchain, or hybrid.");
  const marketplaceExportMode = optionalString(input, "marketplaceExportMode");
  if (marketplaceExportMode !== undefined && !["recursive", "packed", "hybrid", "onchfs"].includes(marketplaceExportMode)) throw new TypeError("marketplaceExportMode is unsupported.");
  const viewer = optionalString(input, "viewer");
  if (viewer !== undefined && viewer !== "keel-verification-shell" && viewer !== "none") throw new TypeError("viewer must be keel-verification-shell or none.");
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
    ...(input.payloadStorage === undefined ? {} : { payloadStorage: resolveKeelPayloadStorage(input.payloadStorage) }),
    ...(marketplaceExportMode === undefined ? {} : { marketplaceExportMode: marketplaceExportMode as "recursive" | "packed" | "hybrid" | "onchfs" }),
    ...(viewer === undefined ? {} : { viewer: viewer as "keel-verification-shell" | "none" }),
    files,
    ...(reusableModule === undefined ? {} : { reusableModule }),
    ...(input.projectProfile === undefined ? {} : { projectProfile: input.projectProfile as never }),
    ...(input.releaseIntent === undefined ? {} : { releaseIntent: input.releaseIntent as never }),
  });
}

async function creatorCollectionPrepareTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["chainId", "creator", "instance", "creatorNonce", "operation"], "Creator collection prepare arguments");
  if (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("chainId must be a positive safe integer.");
  const creator = requiredString(input, "creator");
  const instance = optionalString(input, "instance");
  const creatorNonce = requiredString(input, "creatorNonce");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(creatorNonce)) throw new TypeError("creatorNonce must be canonical unsigned decimal text.");
  const operation = record(input.operation, ["kind", "implementation", "config", "name", "metadataDigest", "tokenContract"], "Creator collection operation");
  return prepareKeelCreatorCollectionWalletReview({
    chainId: input.chainId,
    creator: creator as `0x${string}`,
    ...(instance === undefined ? {} : { instance }),
    creatorNonce,
    operation: operation as unknown as KeelCreatorCollectionWalletReviewInput["operation"],
  });
}

async function shellPrepareTool(_context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(
    value,
    ["operation", "creator", "name", "description", "version", "tags", "builderAddress", "shellId", "salt", "prefixObjectId", "suffixObjectId", "metadataObjectId", "payloadMode"],
    "Shell prepare arguments",
  );
  const operation = requiredString(input, "operation");
  if (operation !== "manifest" && operation !== "register" && operation !== "update" && operation !== "freeze") {
    throw new TypeError("operation must be manifest, register, update, or freeze.");
  }
  const creator = requiredString(input, "creator") as `0x${string}`;
  if (operation === "freeze") {
    return Object.freeze({
      schema: "keel.creator-shell-prepare@1" as const,
      status: "review-only" as const,
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
    ["repositoryRoot", "entry", "entryMediaType", "modules", "assets", "viewer", "payloadStorage", "carriage", "presentationPolicy", "collection",
     "collectionName", "description", "imagePath", "manifestURI", "manifestDigest", "chainId",
     "metadataTransport", "metadataPath", "tokenId", "tokenIdFieldsJson", "web3ImageResolver", "deliveryProfile"],
    "Inline prepare arguments",
  );
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  const viewer = resolveKeelShell(input.viewer);
  assertKeelInlineDeliveryProfile(input.deliveryProfile ?? "embedded-assembled");
  if (resolveKeelInlineCarriage(optionalString(input, "carriage") ?? "compact") !== "raw-percent") {
    throw new TypeError("Fresh MCP preparation only supports compact raw-percent COPY. Existing aligned Base64/percent objects use keel-inline-reuse-plan; do not encode a replacement.");
  }
  const repositoryRoot = optionalString(input, "repositoryRoot");
  const entryMediaType = (optionalString(input, "entryMediaType") ?? (viewer === "none" ? "text/html" : "text/javascript")) as "text/javascript" | "text/html";
  const entryBytes = (await context.workspace.readFile(requiredString(input, "entry"), MAX_MEDIA_BYTES)).bytes;
  const entryText = new TextDecoder("utf-8", { fatal: true }).decode(entryBytes);
  if (payloadStorage === "compact" && /(?:;base64,|"storedBase64"\s*:)[A-Za-z0-9+/=]{4096,}/u.test(entryText)) {
    throw new TypeError(
      "Large encoded artwork was embedded inside the Inline entry. Declare creator binary files in assets so KEEL packs them once and reports their exact overhead.",
    );
  }

  const shell = viewer === "none" ? undefined : await buildKeelInlineShellFragments(repositoryRoot === undefined ? {} : { repositoryRoot });

  const declared = input.modules === undefined ? [] : input.modules;
  if (!Array.isArray(declared)) throw new TypeError("modules must be a list.");
  if (viewer === "none" && (entryMediaType !== "text/html" || declared.length || (Array.isArray(input.assets) && input.assets.length))) {
    throw new TypeError("Creator-owned shell preparation requires self-contained text/html. Supply dependencies in your own document or use an explicit native-resource composer; KEEL will not silently add the verification shell.");
  }
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
      payloadStorage,
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
    const compression = optionalString(asset, "compression") as "none" | "gzip" | "deflate" | undefined;
    if (compression !== undefined && compression !== "none" && compression !== "gzip" && compression !== "deflate") {
      throw new TypeError("Inline asset compression must be none, gzip, or deflate.");
    }
    creatorSourceBytes += source.byteLength;
    assets.push({
      id: requiredString(asset, "assetId"),
      mediaType: requiredString(asset, "mediaType"),
      source,
      ...(compression === undefined ? {} : { compression }),
    });
  }

  const custom = viewer === "none" ? await buildKeelCreatorOwnedInlineDocument({ source: entryBytes, payloadStorage }) : undefined;
  const document = custom?.root ?? await buildKeelInlineLocalDocument({
    shell: shell!,
    payloadStorage,
    modules,
    assets,
    entry: { id: "entry", mediaType: entryMediaType, source: entryBytes },
  });

  const carriage = optionalString(input, "carriage") ?? "compact";
  const resolvedCarriage = resolveKeelInlineCarriage(carriage);
  const presentationPolicy = (optionalString(input, "presentationPolicy") ?? (viewer === "none" ? "raw-artifact" : "collector-inline")) as "collector-inline" | "external-resolver" | "raw-artifact";
  if (!["collector-inline", "external-resolver", "raw-artifact"].includes(presentationPolicy)) throw new TypeError("Unsupported presentationPolicy.");
  if (presentationPolicy === "collector-inline" && resolvedCarriage !== "raw-percent") {
    throw new TypeError("Collector-facing Inline defaults to raw-percent. Legacy carriage requires an explicit external-resolver or raw-artifact presentationPolicy.");
  }
  if (viewer === "none" && presentationPolicy !== "raw-artifact") throw new TypeError("A creator-owned shell uses raw-artifact presentationPolicy and does not claim canonical verification.");
  const graph = custom?.graph ?? await buildKeelInlineTokenURIGraph(document, { carriage: resolvedCarriage });

  const shared = document.parts.filter((part) => part.kind === "existing");
  const creator = document.parts.filter((part) => part.kind === "creator");
  const creatorAssetParts = creator.filter((part) => part.role === "asset");
  if (creatorAssetParts.length !== assets.length) {
    throw new Error("Inline creator asset accounting did not match the verified document graph.");
  }
  const assetMeasurements = assets.map((asset, index) => {
    const part = creatorAssetParts[index]!;
    const item = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(part.bytes).slice(1)) as {
      readonly embedded?: { readonly storedBase64?: unknown; readonly storedText?: unknown; readonly compression?: string };
    };
    if (typeof item.embedded?.storedBase64 !== "string" && typeof item.embedded?.storedText !== "string") {
      throw new Error(`Inline asset ${asset.id} has no canonical packed resource slot.`);
    }
    const storedBinaryBytes = typeof item.embedded?.storedText === "string"
      ? new TextEncoder().encode(item.embedded.storedText).byteLength
      : Buffer.from(item.embedded!.storedBase64 as string, "base64").byteLength;
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
      compression: item.embedded?.compression,
      binaryPackingLayers: typeof item.embedded?.storedText === "string" ? 0 : 1,
    });
  });
  const assetSourceBytes = assetMeasurements.reduce((total, asset) => total + asset.sourceBytes, 0);
  const assetPackedBytes = assetMeasurements.reduce((total, asset) => total + asset.packedFragmentBytes, 0);

  let prepared;
  let web3Metadata;
  const metadataTransport = optionalString(input, "metadataTransport");
  if (viewer === "none" && metadataTransport === "web3-json") throw new TypeError("Creator-owned shell preparation currently uses the raw-percent tokenURI route; web3-json needs an explicit compatible reader.");
  if (metadataTransport !== undefined && metadataTransport !== "web3-json") throw new TypeError("Unknown metadata transport.");
  if (metadataTransport === undefined && (input.metadataPath !== undefined || input.tokenId !== undefined || input.web3ImageResolver !== undefined)) {
    throw new TypeError("metadataPath, tokenId and web3ImageResolver require metadataTransport: web3-json.");
  }
  const collection = optionalString(input, "collection");
  if (metadataTransport === "web3-json" && resolvedCarriage !== "raw-percent") {
    throw new TypeError("web3-json uses the compact raw-percent viewer carriage.");
  }
  if (collection !== undefined || metadataTransport === "web3-json") {
    const imagePath = optionalString(input, "imagePath");
    if (imagePath === undefined) {
      throw new TypeError(
        "A prepared one-of-one tokenURI needs imagePath. Keel inlines the poster as a data: URI; "
        + "leaving it out makes KEEL721 fall back to the manifest locator, which marketplaces cannot fetch.",
      );
    }
    const poster = (await context.workspace.readFile(imagePath, MAX_MEDIA_BYTES)).bytes;
    const posterType = imagePath.endsWith(".webp") ? "image/webp"
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
    const preparedTokenURIBytes = prepared === undefined ? web3Metadata!.byteLength : Buffer.byteLength(prepared.tokenURI, "utf8");
    if (preparedTokenURIBytes > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
      throw new RangeError(
        `The complete prepared tokenURI is ${preparedTokenURIBytes.toLocaleString()} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES.toLocaleString()}-byte public-read limit.`,
      );
    }
  }

  return Object.freeze({
    schema: "keel.inline-prepare@1" as const,
    viewer,
    payloadStorage,
    canonicalProtection: viewer === "keel-verification-shell",
    status: "review-only" as const,
    carriage,
    resolvedCarriage,
    publicationCheck: "keel-inline-publication-check",
    readOperation: "copy-prepared-fragments",
    presentationPolicy,
    shell: { prefixBytes: shell?.prefix.bytes.byteLength ?? 0, suffixBytes: shell?.suffix.bytes.byteLength ?? 0 },
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
      note: "These are prepared-COPY presentation measurements, not a native Hold inventory. Native binary uses a verified reader/composer and may encode only the returned bytes; do not upload a generated Base64/hex sibling. Compact/Raw storage and shell ownership are independent.",
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
  },
};

async function tezosPublicationPrepareTool(_context: ToolContext, value: unknown) {
  const input = value as Record<string, any>;
  for (const key of Object.keys(input)) if (/(?:private|secret|mnemonic|seed|passphrase)/iu.test(key)) throw new TypeError("Private signer material is never accepted by the Tezos publication adapter.");
  if (!/^Net[1-9A-HJ-NP-Za-km-z]{12}$/u.test(input.network)) throw new TypeError("network must be an exact Tezos Net... identity.");
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
    signing: "not-performed",
    submission: "not-performed",
    caveat: "This is one receipt-bound call from the staged KEEL Tezos one-of-one adapter. It does not originate, sign, submit, or invent a contract address.",
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...MEDIA_EDIT_TOOL_DEFINITIONS,
  ...SIGNATURE_PRIVACY_TOOL_DEFINITIONS,
  tool("keel-tezos-shell-prepare", "Prepare native Tezos shell registration, update, or permanent freeze parameters with explicit network and sender. Read-only preparation: no RPC, signing, submission, or default-shell replacement. Receipt-backed selected-chain object and registry checks are still required.", tezosShellPrepareSchema, async (_context, value) => prepareKeelTezosShell(value as KeelTezosShellPrepareInput)),
  tool("keel-tezos-publication-prepare", "Prepare one exact receipt-bound Tezos KEEL one-of-one publication call using the standard Hold, Index, and FA2 modules. The public route is ordinary FA2/TZIP-12 token_metadata with onchfs:// or another selected carrier; the KEEL JSON/harness route is compatibility-only. Review-only: no private key, origination, signing, submission, or fake address is accepted.", tezosPublicationPrepareSchema, tezosPublicationPrepareTool),
  ...ENGINE_TOOL_DEFINITIONS,
  ...EDITOR_TOOL_DEFINITIONS,
  ...LAYERED_TOOL_DEFINITIONS,
  ...SVG_TOOL_DEFINITIONS,
  ...CREATOR_INLINE_TOOL_DEFINITIONS,
  ...CURATION_TOOL_DEFINITIONS,
  ...MATRIX_TOOL_DEFINITIONS,
  ...METADATA_TOOL_DEFINITIONS,
  ...PREREVEAL_TOOL_DEFINITIONS,
  ...ARENA_TOOL_DEFINITIONS,
  tool("analyze", "Analyze a workspace media file and report integrity and wrapper support.", TOOL_SCHEMAS.analyze, analyzeTool),
  tool("media-optimize", "Dry-run a reversible media optimization. It reports only repository-supported adapters and never writes, changes storage mode, uploads, or touches a chain.", TOOL_SCHEMAS.mediaOptimize, mediaOptimizeTool),
  tool("media-optimize-apply", "Write one new optimized file only when its recomputed digest and byte length exactly match a reviewed media-optimize result. The source and selected storage mode are preserved; no upload, wallet, or chain action occurs.", TOOL_SCHEMAS.mediaOptimizeApply, mediaOptimizeApplyTool),
  tool("build", "Build and verify a deterministic local media artifact; no chain or wallet action occurs.", TOOL_SCHEMAS.build, buildTool),
  tool("verify", "Verify a local artifact manifest and its available relative resources.", TOOL_SCHEMAS.verify, verifyTool),
  tool("cost", "Estimate compression, chunks, recursive depth, transactions, and calldata using an offline model.", TOOL_SCHEMAS.cost, costTool),
  tool("upload-plan", "Plan flat or recursive chunk uploads from bounded local bytes without writing to the workspace or touching a chain.", TOOL_SCHEMAS.uploadPlan, uploadPlanTool),
  tool("chain-plan", "Verify a materialized upload plan and emit deterministic review-only contract operation descriptors; no ABI encoding, signing, or submission occurs.", TOOL_SCHEMAS.chainPlan, chainPlanTool),
  tool("ethereum-encode", "Encode verified local Ethereum KeelHold operations with viem for review only; no RPC, signing, submission, or QR payload is produced.", TOOL_SCHEMAS.ethereumEncode, ethereumEncodeTool),
  tool("publish-plan", "Bind a verified review-only chain descriptor to a canonical SDK envelope. Prepared viewer fragments REQUIRE preparedCopy full-return evidence bound to this source, chain and store; missing evidence or a changed/encoded return is rejected. Existing graph revisions must pass the one-resource delta gate and the upload digest must match that resource; unrelated asset republishing stops before wallet review. No ABI encoding, signing, or submission occurs.", TOOL_SCHEMAS.publishPlan, publishPlanTool),
  tool("module-resolve", "Resolve one exact module selector from a local snapshot without fetching carriers.", TOOL_SCHEMAS.moduleResolve, moduleResolveTool),
  tool("module-lock", "Write a canonical local module lock and unavailable-by-default receipt.", TOOL_SCHEMAS.moduleLock, moduleLockTool),
  tool("wallet-request-prepare", "Prepare a canonical user-reviewable wallet request or QR payload without signing or submitting.", TOOL_SCHEMAS.walletRequestPrepare, walletRequestPrepareTool),
  tool("wallet-link", "Prepare a review-only account-to-agent KeelFactory castDieFor authorization and JSON-safe EIP-712 typed data; no signing, RPC, or submission occurs.", TOOL_SCHEMAS.walletLink, walletLinkTool),
  tool("module-review-prepare", "Prepare a review-only KeelModuleReviewRegistry action (submit/sanction/deprecate/revoke a non-contract module's on-chain trust) as a canonical descriptor; no signing, encoding, or submission occurs.", TOOL_SCHEMAS.moduleReview, moduleReviewPrepareTool),
  tool("fray-auction-intake", "Collect the title, description, chain, and one of exactly four Fray auction presets before emitting a user-approved API and wallet handoff; no signing or submission occurs.", TOOL_SCHEMAS.frayAuctionIntake, frayAuctionIntakeTool),
  tool("fray-stage-project", "Upload bounded source bytes to the configured Fray Studio temporary project store, prepare still/video previews, preflight the fee, and return a wallet-facing handoff; no signing or submission occurs.", TOOL_SCHEMAS.frayStageProject, frayStageProjectTool),
  tool("keel-chain-guide", "List wallet connection profiles and human faucet links; these do not establish KEEL deployments. Use keel-network-discover for deployed networks; the MCP server never claims faucet funds or moves wallet assets.", TOOL_SCHEMAS.chainGuide, chainGuideTool),
  tool("keel-library-search", "Search configured Keel Studio Keel indexes for exact reusable library/module candidates; metadata only, no carrier bytes are fetched.", TOOL_SCHEMAS.keelLibrarySearch, keelLibrarySearchTool),
  tool("keel-onchain-data-prepare", "Turn declared contract reads into artwork variables. With record, automatically discover its KEEL seed profile and expose KEEL.data.token without individual field declarations; the contract must advertise IKeelMintSeededData. Each declared read becomes one eth_call, the answers are frozen into a canonical pack, and the tool returns the init fragment that publishes them as a frozen global before any runtime or render module runs, so creator code reads KEEL.data.<name> instead of fetching at draw time and finding undefined. Static return types only: a dynamic return needs an offset table, and guessing it would hand back a plausible wrong number. Arguments are decimal or 0x-hex text because a uint256 does not survive a JSON number. An omitted rpcUrl resolves KEEL_ONCHAIN_RPC_URL, then environment or private workspace RPC configuration, then the index/config-selected network public RPC pool; loopback HTTP is accepted so a local anvil is the ordinary target while a work is being built. The returned fragment is executed before it is returned, so the published values are checked, not assumed. Read-only: eth_call plus chain identity and head. No signing or submission occurs, no state is written, and no wallet is touched.", TOOL_SCHEMAS.onchainData, onchainDataTool),
  tool("keel-endpoint-config", "Resolve the hosted Studio website (https://studio.onkeel.io by default; Desktop is optional), indexer settings and the index/config-selected network RPC pool with explicit input, environment or private workspace configuration. Keyed RPC paths/query strings are redacted in the response; deployment index may be fetched; no wallet request occurs.", TOOL_SCHEMAS.endpointConfig, endpointConfigTool),
  tool("keel-studio-capabilities", "Inspect a Studio's supported chains, zero-spend sandbox, staging, authorization, and MSP readiness before any upload or wallet action.", TOOL_SCHEMAS.studioCapabilities, studioCapabilitiesTool),
  tool("keel-studio-project-intake", "Ask only for missing project decisions, then return either storage-only preparation or an editable release/listing intent. No upload, signature, wallet request, or transaction occurs.", TOOL_SCHEMAS.studioProjectIntake, studioProjectIntakeTool),
  tool("keel-studio-connect", "Connect this workspace to the user’s Studio account without copying keys. start returns a public approveUrl and code: open it for the user, who signs in and approves permissions. complete collects and privately saves the approved key; status never returns secrets. Draft/staging tools automatically use the saved connection. Never approve access for the user. No Desktop app or wallet transaction is required.", TOOL_SCHEMAS.studioConnect, studioConnectTool),
  tool("keel-studio-access", "Read, revision-safely update or test the creator's access list with access:read/access:write. Supports named ALL/ANY audience groups, access or benefit-only audiences, provider readiness, durable verifiable raffles, unsigned benefit activation, automatic conditions and agent-managed custom rules, plus pending EIP-712 packets for a caller-owned signer. Read the current Studio access schema before editing. Never send a private key. approve submits only the configured signer's exact signature; it sends no transaction.", { type: "object", properties: { operation: { type: "string", enum: ["read", "update", "test", "requests", "approve", "providers", "raffle-status", "raffle-prepare", "raffle-record", "raffle-confirm", "raffle-draw", "raffle-cancel", "benefits", "benefit-prepare"] }, releaseId: { type: "string", pattern: "^[0-9a-f-]{36}$" }, studioUrl: { type: "string" }, input: { type: "object" } }, required: ["operation"], additionalProperties: false }, studioAccessTool),
  tool("keel-studio-draft", "Create a website wallet-review route by creating a private release draft in the user's Studio account, or list/read/diagnose/revision-safely edit it. After the shared plan is confirmed, use prepare-review with releaseId and expectedRevision to save the exact unsigned owner action and return its pinned reviewUrl. The creator still reviews and signs in Studio. Use conversation/conversation-suggest with separate conversations:read/conversations:write grants to read the in-editor chat or share typed owner-reviewable forms. For creator-directed defaults use defaults/defaults-edit with separate preferences:read/preferences:write grants; existing projects retain their pinned settings. Default to plan and plan-edit: ask the returned next question, preserve explicit answers and revision, and share the returned planningUrl for focused creator edits through their scoped key. Use continue-publication with releaseId and expectedRevision to automatically reconcile existing recorded rejection or receipt evidence through the same service as Publish. This bounded action returns the exact next step and never signs, submits, prepares an operation, or infers a missing owner observation. Use cancel-review with releaseId, expectedRevision and operationId to edit an exact safely unsubmitted review; pending or unknown attempts remain locked. For blocked legacy storage use storage-recovery with the existing projectId, then the returned bounded next action. Diagnose reruns read-only compatibility checks on the same release and returns receipt-aware recovery actions without creating a chain operation or uploading files. After the owner has recorded a confirmed wallet rejection through Studio, use recover-wallet-rejection with releaseId and the exact recoveryInput from diagnose, setting its rejection to the returned ownerRecordedRejection. If ownerRecordedRejection is absent, keep the operation blocked and ask the owner to record the actual outcome in Studio; never invent a rejection code. An agent cannot assert a new rejection. This uses the existing drafts:write grant and preserves the same operation; A missing hash does not prove rejection. Returns reviewUrl for the creator to open in their browser and publish with their existing connected wallet. KEEL Desktop and a separate signing page are not required. This tool does not sign or submit a chain action.", TOOL_SCHEMAS.studioDraft, studioDraftTool),
  tool("keel-studio-stage-project", "Stage bounded creator resources/modules and return the server-issued Studio handoff. Omitted viewer selects Studio's canonical KEEL Inline graph for later preparation; `none` is the explicit raw-artifact route with no viewer and does not prevent a later release or mint. Automatic compact preparation requires the exact selected-chain KeelRawTokenURIBuilder and canonical raw-percent shell fragments with receipts/read-back; Studio must never fall back to legacy Base64 carriage silently. A direct image, video, or self-contained GLB resolves to registered shell plus registered keel.asset-display@1 plus the creator media entry, never zero modules or a generated index.html. Legacy protector getters and NoProtector do not determine default Inline readiness. Creator HTML is content, never a replacement shell, and agents must not upload a locally manufactured KEEL shell, protected-harness wrapper, or local wrapper when the catalog is incomplete. Studio must fail closed for an incomplete selected-chain catalog during preparation. The scoped key is loaded from the private Studio connection or an existing environment override; no wallet signature or chain action occurs.", TOOL_SCHEMAS.studioStageProject, studioStageProjectTool),
  tool("keel-creator-collection-prepare", "Prepare one exact EIP-5792 KeelCreatorFactory batch plus its durable recovery envelope. This never signs or submits. Missing or ambiguous factory/renderer deployments stop before any wallet approval.", TOOL_SCHEMAS.creatorCollectionPrepare, creatorCollectionPrepareTool),
  tool("keel-shell-search", "Search the read-back-verified shell catalogue by creator, name, version, or tags. Returns top/bottom object pointers and metadata only; it never fetches carrier bytes, signs, or submits.", TOOL_SCHEMAS.shellSearch, shellSearchTool),
  tool("keel-inline-prepare", "NEW SOURCE ONLY: for existing onchain objects call keel-inline-reuse-plan first; preserve exact prepared carriage and never republish it. Plan a new INLINE Keel graph. The registered verification shell is the default; explicit viewer=none preserves self-contained creator-owned HTML without canonical protection. Shell choice is independent of Compact/Raw payload storage. Reusable modules and separate assets require a compatible reader. Omitted carriage and presentationPolicy use the automatic compact raw-percent saver plus collector-inline: exact supplied data:image/* bytes and complete data:text/html;charset=utf-8 HTML, with no IPFS/HTTP/web3 resolver or legacy complete-HTML Base64. For new source prepare one exact ASCII image carriage at build time; the final image field only copies its prepared header, payload and footer. Never add a runtime media encoder or publish raw and encoded copies. GIF is direct data:image/gif and never an SVG wrapper or placeholder. The result reports source, stored graph, and complete tokenURI bytes and rejects a result above the public-read ceiling. External resolvers and legacy artifact carriage require explicit reviewed policies. Review-only: it never signs or submits.", TOOL_SCHEMAS.inlinePrepare, inlinePrepareTool),
  tool("keel-shell-prepare", "Create canonical creator/tag shell metadata or prepare creator registration, update, or irreversible freeze calls. One stable shell ID can publish revisions until its creator freezes it. The recommended viewer follows the current revision; pinning one revision is explicit. A shell is one reusable top and bottom around the work graph; this tool never signs, submits, or invents a replacement default shell.", TOOL_SCHEMAS.shellPrepare, shellPrepareTool),
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((entry) => entry.descriptor.name === name);
}
