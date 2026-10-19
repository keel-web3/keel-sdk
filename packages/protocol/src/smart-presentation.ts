import { decodeBase64, encodeBase64 } from "./bytes.js";
import { canonicalJson } from "./canonical.js";
import { sha256Hex } from "./integrity.js";

/** Decimal byte counts. Asset size, encoded image size and complete metadata are independent gates. */
export const KEEL_SMART_INLINE_ASSET_MAX_BYTES = 500_000;
export const KEEL_SMART_SPLIT_ASSET_THRESHOLD_BYTES = 2_000_000;
export const KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES = 1_750_000;
export const KEEL_SMART_TOKEN_URI_MAX_BYTES = 2_000_000;
export const KEEL_ASSET_PRESENTATION_PREFERENCES = ["automatic", "external-preview", "inline-image-hybrid-verifier"] as const;
export type KeelAssetPresentationPreference = (typeof KEEL_ASSET_PRESENTATION_PREFERENCES)[number];
export const KEEL_PRESENTATION_FALLBACK_DELIVERIES = ["ipfs", "hosted"] as const;
export type KeelPresentationFallbackDelivery = (typeof KEEL_PRESENTATION_FALLBACK_DELIVERIES)[number];
export interface KeelExternalPresentation { readonly delivery: KeelPresentationFallbackDelivery; readonly imageUri: string; readonly animationUri: string; readonly contentDigest: `0x${string}` }
export type KeelAssetExecution = "static" | "script" | "unknown";
export interface KeelPresentationSource {
  readonly resourceId: string;
  readonly mediaType: string;
  readonly byteLength?: number;
  readonly digest?: `0x${string}`;
  readonly onchain?: { readonly chainId: number; readonly store: `0x${string}`; readonly objectId: `0x${string}` };
}
export interface KeelSmartPresentationMeasurements {
  readonly imageUriBytes?: number;
  /** Image contribution after the actual outer JSON/URI encoding, including its delimiters. */
  readonly encodedImageSlotBytes?: number;
  readonly completeTokenUriBytes?: number;
  readonly maximumTokenUriBytes?: number;
  readonly embeddedAnimationUriBytes?: number;
  /** Actual animation contribution under the original outer URI/JSON grammar. */
  readonly encodedAnimationSlotBytes?: number;
  readonly embeddedProgramBytes?: number;
  /** Payload bytes duplicated into persistent literal metadata, not return-memory encoding. */
  readonly literalMediaPrefixBytes?: number;
  readonly prefixBytes?: number;
  readonly suffixBytes?: number;
  readonly maxEnvelopeBytes?: number;
  readonly executionGas?: bigint | string;
  readonly maxExecutionGas?: bigint | string;
  readonly stateGas?: bigint | string;
  readonly maxStateGas?: bigint | string;
  readonly readGas?: bigint | string;
  readonly maxReadGas?: bigint | string;
}
export type KeelPresentationQualification = "qualified" | "unsupported" | "unknown";
export interface KeelSmartPresentationCapabilities {
  readonly directAsset: KeelPresentationQualification;
  readonly shellInline: KeelPresentationQualification;
  readonly shellHybrid: KeelPresentationQualification;
  readonly externalPresentation?: KeelPresentationQualification;
  /** MIME support comes from the qualified module/renderer profile, never a source label alone. */
  readonly inlineImageTypes?: readonly string[];
  readonly inlineMediaTypes?: readonly string[];
  readonly identity?: {
    readonly chainId: number;
    readonly blockNumber: string;
    readonly blockHash: `0x${string}`;
    readonly factory?: `0x${string}`;
    readonly creationCodeHash?: `0x${string}`;
    readonly reader?: `0x${string}`;
    readonly runtimeCodeHash?: `0x${string}`;
  };
}
export interface KeelSmartAssetPresentationInput {
  readonly contextIdentity?: { readonly projectId: string; readonly revision: string; readonly defaultsRevision: string };
  readonly source: KeelPresentationSource;
  readonly preview?: KeelPresentationSource;
  /** Derived from actual source inspection. Script MIME types cannot be overridden by this field. */
  readonly execution: KeelAssetExecution;
  readonly assetPresentation?: KeelAssetPresentationPreference;
  /** Explicit project choice; a saved external-preview preference does not authorize an invented URL. */
  readonly externalPreviewUri?: string;
  readonly fallbackDelivery?: KeelPresentationFallbackDelivery;
  readonly externalPresentation?: KeelExternalPresentation;
  readonly measurements?: KeelSmartPresentationMeasurements;
  readonly capabilities?: KeelSmartPresentationCapabilities;
  readonly selection?: KeelAssetPresentationSelection;
  readonly candidateMeasurements?: Partial<Record<KeelAssetPresentationCandidateId, KeelSmartPresentationMeasurements>>;
  readonly nonstandardCompatibilityAcknowledged?: boolean;
  readonly omittedGridImageAcknowledged?: boolean;
}
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
    || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function count(value: unknown, label: string, positive = false): number {
  if (!Number.isSafeInteger(value) || Number(value) < (positive ? 1 : 0)) throw new TypeError(`Invalid ${label} byte count.`);
  return Number(value);
}
function source(value: KeelPresentationSource): KeelPresentationSource {
  record(value, ["resourceId", "mediaType", "byteLength", "digest", "onchain"], "presentation source");
  if (typeof value.resourceId !== "string" || !value.resourceId.trim() || value.resourceId.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value.resourceId)) throw new TypeError("A bounded exact source identity is required.");
  if (typeof value.mediaType !== "string" || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(value.mediaType)) throw new TypeError("An exact normalized source MIME type is required.");
  if (value.digest !== undefined && !/^0x[0-9a-f]{64}$/iu.test(value.digest)) throw new TypeError("A source SHA256 commitment is required.");
  let onchain: KeelPresentationSource["onchain"];
  if (value.onchain !== undefined) {
    const reference = value.onchain; record(reference, ["chainId", "store", "objectId"], "native source reference");
    if (!Number.isSafeInteger(reference.chainId) || reference.chainId < 1 || !/^0x[0-9a-f]{40}$/iu.test(reference.store) || !/^0x[0-9a-f]{64}$/iu.test(reference.objectId)) throw new TypeError("Invalid exact native source reference.");
    onchain = Object.freeze({ chainId: reference.chainId, store: reference.store.toLowerCase() as `0x${string}`, objectId: reference.objectId.toLowerCase() as `0x${string}` });
  }
  return Object.freeze({ resourceId: value.resourceId, mediaType: value.mediaType, ...(onchain === undefined ? {} : { onchain }),
    ...(value.byteLength === undefined ? {} : { byteLength: count(value.byteLength, "source") }),
    ...(value.digest === undefined ? {} : { digest: value.digest.toLowerCase() as `0x${string}` }) });
}
function nativeReferenceURI(value: KeelPresentationSource): string | undefined {
  const reference = value.onchain;
  return reference === undefined ? undefined : `web3://${reference.store}:${reference.chainId}/haulObject/${reference.objectId}?mime.type=${encodeURIComponent(value.mediaType)}`;
}
export function parseKeelAssetPresentationPreference(value: unknown): KeelAssetPresentationPreference {
  if (!KEEL_ASSET_PRESENTATION_PREFERENCES.includes(value as KeelAssetPresentationPreference)) throw new TypeError("Choose automatic, external-preview or inline-image-hybrid-verifier presentation.");
  return value as KeelAssetPresentationPreference;
}
export function parseKeelPresentationFallbackDelivery(value: unknown): KeelPresentationFallbackDelivery {
  if (!KEEL_PRESENTATION_FALLBACK_DELIVERIES.includes(value as KeelPresentationFallbackDelivery)) throw new TypeError("Choose IPFS or hosted presentation fallback.");
  return value as KeelPresentationFallbackDelivery;
}
export function parseKeelExternalPreviewUri(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) throw new TypeError("Use an explicit HTTPS or IPFS preview URL.");
  let url: URL; try { url = new URL(value); } catch { throw new TypeError("Use an explicit HTTPS or IPFS preview URL."); }
  if (!["https:", "ipfs:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) throw new TypeError("Use an explicit HTTPS or IPFS preview URL without credentials or a fragment.");
  return url.toString();
}
const scriptMIME = /^(?:text\/(?:html|javascript|ecmascript)|application\/(?:javascript|ecmascript|wasm|x-shockwave-flash|xhtml\+xml))$/u;
/** Conservative source inspection, independent of a supplied extension or static declaration. */
export function classifyKeelAssetExecution(input: { readonly mediaType: string; readonly bytes: Uint8Array; readonly declaredScript?: boolean }): KeelAssetExecution {
  const mime = input.mediaType.split(";", 1)[0]!.trim().toLowerCase();
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.length) throw new TypeError("Actual source bytes are required for execution inspection.");
  if (input.declaredScript === true || scriptMIME.test(mime)) return "script";
  let text = new TextDecoder("utf-8").decode(input.bytes.subarray(0, 65_536));
  if (/^\s*(?:<!doctype\s+html|<html\b|<script\b|(?:import|export|function|const|let|var)\s)/iu.test(text)) return "script";
  if (mime === "image/svg+xml" || /^\s*(?:<\?xml[^>]*>\s*)?<svg\b/iu.test(text)) {
    if (input.bytes.length > 32 * 1024 * 1024) return "unknown";
    text = new TextDecoder("utf-8").decode(input.bytes);
    if (/<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|application\/(?:javascript|ecmascript))/iu.test(text)) return "script";
    if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/iu.test(text) || /<!DOCTYPE|<!ENTITY|&#|\b(?:href|src)\s*=\s*["']?(?:https?:|\/\/)/iu.test(text)) return "unknown";
    return "static";
  }
  // PDF can hide executable actions inside compressed objects; a prefix scan cannot establish static media.
  if (mime === "application/pdf") return /\/(?:JavaScript|JS)\b/u.test(text) ? "script" : "unknown";
  const magic = input.bytes;
  const knownImage = magic[0] === 0x89 && text.slice(1, 4) === "PNG" ? "image/png"
    : text.startsWith("GIF87a") || text.startsWith("GIF89a") ? "image/gif"
    : magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff ? "image/jpeg"
    : text.startsWith("RIFF") && text.slice(8, 12) === "WEBP" ? "image/webp" : undefined;
  if (knownImage && mime !== knownImage && mime !== "application/octet-stream") return "unknown";
  if (mime.startsWith("image/") && !knownImage && !["image/avif", "image/heic", "image/heif", "image/tiff", "image/bmp", "image/apng"].includes(mime)) return "unknown";
  if (knownImage) return "static";
  const ftyp = text.slice(4, 8) === "ftyp";
  if ((mime.startsWith("video/") || mime.startsWith("audio/")) && (ftyp || text.startsWith("OggS") || text.startsWith("fLaC") || text.startsWith("ID3") || text.startsWith("RIFF") || magic[0] === 0xff && (magic[1]! & 0xe0) === 0xe0)) return "static";
  if (mime === "model/gltf-binary" && text.startsWith("glTF")) return "static";
  if (mime === "text/plain") return "static";
  return "unknown";
}

export const KEEL_ASSET_IMAGE_DELIVERIES = ["inline", "external", "onchain-reference", "omitted"] as const;
export const KEEL_ASSET_ANIMATION_DELIVERIES = ["inline-shell", "hybrid-shell", "ipfs-shell", "hosted-shell", "inline-media", "onchain-reference", "omitted"] as const;
export const KEEL_ASSET_PRESENTATION_FALLBACK_DELIVERIES = KEEL_PRESENTATION_FALLBACK_DELIVERIES;
export interface KeelAssetPresentationSelection {
  readonly image: (typeof KEEL_ASSET_IMAGE_DELIVERIES)[number];
  readonly animation: (typeof KEEL_ASSET_ANIMATION_DELIVERIES)[number];
}
export const KEEL_ASSET_PRESENTATION_CANDIDATE_IDS = ["canonical-inline", "canonical-hybrid", "external-preview-inline", "external-preview-hybrid", "direct-onchain-asset", "image-only-inline", "media-only-inline", "hybrid-verifier-only", "ipfs-presentation", "hosted-presentation"] as const;
export type KeelAssetPresentationCandidateId = (typeof KEEL_ASSET_PRESENTATION_CANDIDATE_IDS)[number];
const layouts: Readonly<Record<KeelAssetPresentationCandidateId, KeelAssetPresentationSelection>> = {
  "canonical-inline": { image: "inline", animation: "inline-shell" },
  "canonical-hybrid": { image: "inline", animation: "hybrid-shell" },
  "external-preview-inline": { image: "external", animation: "inline-shell" },
  "external-preview-hybrid": { image: "external", animation: "hybrid-shell" },
  "direct-onchain-asset": { image: "onchain-reference", animation: "onchain-reference" },
  "image-only-inline": { image: "inline", animation: "omitted" },
  "media-only-inline": { image: "inline", animation: "inline-media" },
  "hybrid-verifier-only": { image: "omitted", animation: "hybrid-shell" },
  "ipfs-presentation": { image: "external", animation: "ipfs-shell" },
  "hosted-presentation": { image: "external", animation: "hosted-shell" },
};
export function resolveKeelAssetPresentationSelection(id: KeelAssetPresentationCandidateId, mediaType: string): KeelAssetPresentationSelection {
  if (!KEEL_ASSET_PRESENTATION_CANDIDATE_IDS.includes(id)) throw new TypeError("Unsupported presentation candidate.");
  const selection = { ...layouts[id] };
  if (id === "direct-onchain-asset" && mediaType.startsWith("image/")) selection.animation = "omitted";
  return Object.freeze(selection);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function measurementsOf(input: KeelSmartPresentationMeasurements | undefined) {
  const result: Record<string, number | string> = {};
  const byteKeys = ["imageUriBytes", "encodedImageSlotBytes", "completeTokenUriBytes", "maximumTokenUriBytes", "embeddedAnimationUriBytes", "encodedAnimationSlotBytes", "embeddedProgramBytes", "literalMediaPrefixBytes", "prefixBytes", "suffixBytes", "maxEnvelopeBytes"];
  const gasKeys = ["executionGas", "maxExecutionGas", "stateGas", "maxStateGas", "readGas", "maxReadGas"];
  if (input !== undefined) {
    const values = record(input, [...byteKeys, ...gasKeys], "presentation measurements");
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (byteKeys.includes(key)) result[key] = count(value, key);
      else { if (typeof value !== "bigint" && (typeof value !== "string" || !/^\d+$/u.test(value)) || BigInt(value as string | bigint) < 0n) throw new TypeError("Gas measurements must be nonnegative integer quantities."); result[key] = BigInt(value as string | bigint).toString(); }
    }
  }
  return result;
}
/** Candidate policy is review data. Only an actual selected-chain adapter can qualify a layout. */
export function planKeelSmartAssetPresentation(input: KeelSmartAssetPresentationInput) {
  record(input, ["contextIdentity", "source", "preview", "execution", "assetPresentation", "externalPreviewUri", "fallbackDelivery", "externalPresentation", "measurements", "candidateMeasurements", "capabilities", "selection", "nonstandardCompatibilityAcknowledged", "omittedGridImageAcknowledged"], "smart presentation input");
  const contextIdentity = input.contextIdentity === undefined ? undefined : { ...input.contextIdentity };
  if (contextIdentity) { record(contextIdentity, ["projectId", "revision", "defaultsRevision"], "presentation context identity"); for (const value of Object.values(contextIdentity)) if (typeof value !== "string" || !value || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("Invalid presentation revision identity."); }
  const original = source(input.source), preview = input.preview === undefined ? undefined : source(input.preview);
  if (!["static", "script", "unknown"].includes(input.execution)) throw new TypeError("Actual source execution classification is required.");
  const execution = scriptMIME.test(original.mediaType) ? "script" : input.execution;
  const assetPresentation = parseKeelAssetPresentationPreference(input.assetPresentation ?? "automatic");
  const fallbackDelivery = input.fallbackDelivery === undefined ? undefined : parseKeelPresentationFallbackDelivery(input.fallbackDelivery);
  const externalPreviewUri = input.externalPreviewUri === undefined ? undefined : parseKeelExternalPreviewUri(input.externalPreviewUri);
  let externalPresentation: KeelExternalPresentation | undefined;
  if (input.externalPresentation !== undefined) {
    const selected = input.externalPresentation; record(selected, ["delivery", "imageUri", "animationUri", "contentDigest"], "external presentation");
    const delivery = parseKeelPresentationFallbackDelivery(selected.delivery);
    const imageUri = parseKeelExternalPreviewUri(selected.imageUri), animationUri = parseKeelExternalPreviewUri(selected.animationUri);
    if (!/^0x[0-9a-f]{64}$/iu.test(selected.contentDigest) || [imageUri, animationUri].some(uri => delivery === "ipfs" ? !uri.startsWith("ipfs:") : !/^https?:/u.test(uri))) throw new TypeError("External presentation needs exact delivery and package commitment.");
    externalPresentation = { delivery, imageUri, animationUri, contentDigest: selected.contentDigest.toLowerCase() as `0x${string}` };
  }
  const capabilities = input.capabilities === undefined ? undefined : JSON.parse(JSON.stringify(input.capabilities)) as KeelSmartPresentationCapabilities;
  if (capabilities) {
    record(capabilities, ["directAsset", "shellInline", "shellHybrid", "externalPresentation", "inlineImageTypes", "inlineMediaTypes", "identity"], "presentation capabilities");
    for (const key of ["directAsset", "shellInline", "shellHybrid"] as const) if (!["qualified", "unsupported", "unknown"].includes(capabilities[key])) throw new TypeError("Invalid presentation qualification.");
    if (capabilities.externalPresentation !== undefined && !["qualified", "unsupported", "unknown"].includes(capabilities.externalPresentation)) throw new TypeError("Invalid external presentation qualification.");
    for (const key of ["inlineImageTypes", "inlineMediaTypes"] as const) if (capabilities[key] !== undefined) {
      const types = capabilities[key]!;
      if (!Array.isArray(types) || types.length > 64 || new Set(types).size !== types.length || types.some(mime => typeof mime !== "string" || !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mime))) throw new TypeError("Invalid qualified inline renderer MIME profile.");
    }
    if (capabilities.identity) {
      const identity = capabilities.identity; record(identity, ["chainId", "blockNumber", "blockHash", "factory", "creationCodeHash", "reader", "runtimeCodeHash"], "qualified chain identity");
      if (!Number.isSafeInteger(identity.chainId) || identity.chainId < 1 || !/^(?:0x[0-9a-f]+|\d+)$/iu.test(identity.blockNumber) || !/^0x[0-9a-f]{64}$/iu.test(identity.blockHash)) throw new TypeError("Invalid qualified chain identity.");
      for (const key of ["factory", "reader"] as const) if (identity[key] !== undefined && !/^0x[0-9a-f]{40}$/iu.test(identity[key]!)) throw new TypeError("Invalid qualified contract identity.");
      for (const key of ["creationCodeHash", "runtimeCodeHash"] as const) if (identity[key] !== undefined && !/^0x[0-9a-f]{64}$/iu.test(identity[key]!)) throw new TypeError("Invalid qualified code identity.");
    }
  }
  for (const key of ["nonstandardCompatibilityAcknowledged", "omittedGridImageAcknowledged"] as const) if (input[key] !== undefined && typeof input[key] !== "boolean") throw new TypeError("Invalid presentation compatibility preference.");
  const explicit = input.selection === undefined ? undefined : { ...input.selection };
  if (explicit) {
    record(explicit, ["image", "animation"], "presentation selection");
    if (!KEEL_ASSET_IMAGE_DELIVERIES.includes(explicit.image) || !KEEL_ASSET_ANIMATION_DELIVERIES.includes(explicit.animation)) throw new TypeError("Unsupported presentation selection.");
  }
  if (input.candidateMeasurements) record(input.candidateMeasurements, KEEL_ASSET_PRESENTATION_CANDIDATE_IDS, "candidate measurements");
  const isImage = original.mediaType.startsWith("image/");
  const initialMeasurements = measurementsOf(input.measurements);
  const candidates = KEEL_ASSET_PRESENTATION_CANDIDATE_IDS.map(id => {
    const layout = { ...layouts[id] };
    const imageSource = isImage && (id === "image-only-inline" || id === "direct-onchain-asset") ? original : preview ?? (isImage ? original : undefined);
    if (id === "direct-onchain-asset" && isImage) layout.animation = "omitted";
    const measured = input.candidateMeasurements?.[id] === undefined ? id === "canonical-inline" ? { ...initialMeasurements } : {} : measurementsOf(input.candidateMeasurements[id]);
    const hardBlockers: string[] = [], compatibilityWarnings: string[] = [], remainingChecks: string[] = [];
    if (id === "media-only-inline" && isImage) hardBlockers.push("inline-media-requires-nonimage-source");
    if (id === "media-only-inline" && !capabilities?.inlineMediaTypes?.includes(original.mediaType)) hardBlockers.push("qualified-inline-media-renderer-required");
    if (id === "image-only-inline" && !capabilities?.inlineImageTypes?.includes(imageSource?.mediaType ?? "")) hardBlockers.push("qualified-inline-image-renderer-required");
    if (id === "direct-onchain-asset") compatibilityWarnings.push("native-object-references-may-not-load-in-marketplace-grids");
    if (original.byteLength === 0) hardBlockers.push("empty-source");
    if (capabilities?.identity && [original, preview].some(value => value?.onchain !== undefined && value.onchain.chainId !== capabilities.identity!.chainId)) hardBlockers.push("source-reference-chain-mismatch");
    const shell = layout.animation.endsWith("shell"), hybrid = layout.animation === "hybrid-shell", external = layout.animation === "ipfs-shell" || layout.animation === "hosted-shell";
    if (execution !== "static" && !shell) hardBlockers.push("script-requires-registered-verifier");
    if (execution === "unknown") remainingChecks.push("source-execution-inspection");
    if (original.byteLength === undefined || original.digest === undefined) remainingChecks.push("exact-source-commitment");
    if (layout.image !== "omitted" && (!imageSource || !imageSource.mediaType.startsWith("image/"))) hardBlockers.push("usable-grid-image-required");
    if (layout.image === "omitted") compatibilityWarnings.push("collection-grids-will-not-show-an-image");
    if (layout.animation === "omitted" && !isImage) compatibilityWarnings.push("full-media-playback-is-omitted");
    if (layout.image === "external" && !external && !externalPreviewUri) hardBlockers.push("explicit-external-preview-url-required");
    const delivery = layout.animation === "ipfs-shell" ? "ipfs" : layout.animation === "hosted-shell" ? "hosted" : undefined;
    if (external && externalPresentation?.delivery !== delivery) hardBlockers.push("verified-external-presentation-package-required");
    const requiredCapability = external ? "externalPresentation" : shell ? hybrid ? "shellHybrid" : "shellInline" : "directAsset";
    if (!capabilities?.identity || capabilities[requiredCapability] !== "qualified") hardBlockers.push(`qualified-${requiredCapability}-required`);
    const over = (actual: string, maximum: string) => measured[actual] !== undefined && measured[maximum] !== undefined && BigInt(measured[actual]!) > BigInt(measured[maximum]!);
    if (over("prefixBytes", "maxEnvelopeBytes") || over("suffixBytes", "maxEnvelopeBytes")) hardBlockers.push("deployed-envelope-limit");
    if (Number(measured.literalMediaPrefixBytes ?? 0) > 0) hardBlockers.push("native-media-duplicated-in-literal-prefix");
    for (const [actual, maximum, reason] of [["executionGas", "maxExecutionGas", "transaction-execution-limit"], ["stateGas", "maxStateGas", "transaction-state-limit"], ["readGas", "maxReadGas", "public-read-limit"], ["completeTokenUriBytes", "maximumTokenUriBytes", "actual-reader-output-limit"]]) if (over(actual!, maximum!)) hardBlockers.push(reason!);
    if (Number(measured.completeTokenUriBytes ?? 0) > KEEL_SMART_TOKEN_URI_MAX_BYTES) compatibilityWarnings.push("complete-metadata-above-standard-target");
    if (layout.image === "inline" && (Number(measured.imageUriBytes ?? 0) > KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES || Number(measured.encodedImageSlotBytes ?? 0) > KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES)) compatibilityWarnings.push("inline-image-above-compatibility-target");
    if (measured.completeTokenUriBytes === undefined) remainingChecks.push("actual-complete-render-measurement");
    if (layout.image === "inline" && (measured.imageUriBytes === undefined || measured.encodedImageSlotBytes === undefined)) remainingChecks.push("actual-image-uri-and-outer-encoding-measurement");
    if (shell) remainingChecks.push("exact-registered-shell-and-embedded-program");
    remainingChecks.push("same-exact-complete-program-simulation", "exact-source-and-reader-receipt-readback");
    const image = layout.image === "omitted" ? null : imageSource ? { resourceId: imageSource.resourceId, commitment: imageSource, delivery: layout.image,
      ...(layout.image === "onchain-reference" && imageSource.onchain !== undefined ? { uri: nativeReferenceURI(imageSource) } : {}),
      ...(layout.image === "external" ? { uri: external ? externalPresentation?.delivery === delivery ? externalPresentation!.imageUri : null : externalPreviewUri ?? null } : {}) } : null;
    const animation = { resourceId: original.resourceId, commitment: original, delivery: layout.animation,
      ...(layout.animation === "onchain-reference" && original.onchain !== undefined ? { uri: nativeReferenceURI(original) } : {}),
      ...(external ? { uri: externalPresentation?.delivery === delivery ? externalPresentation!.animationUri : null } : {}) };
    const route = id === "direct-onchain-asset" ? "direct-onchain-asset" : id === "image-only-inline" ? "image-only" : id === "media-only-inline" ? "inline-media" : external ? "external-presentation" : hybrid ? "canonical-shell-hybrid" : "canonical-shell-inline";
    return { id, selection: layout, route, image, animation, viewer: shell ? "keel-verification-shell" as const : "none" as const,
      mode: external ? "external" as const : hybrid ? "hybrid" as const : shell ? "inline" as const : "direct" as const,
      measurements: measured, measurementBasis: "provisional-local-measurements" as const, standardsCompatible: measured.completeTokenUriBytes === undefined ? null : Number(measured.completeTokenUriBytes) <= KEEL_SMART_TOKEN_URI_MAX_BYTES && !compatibilityWarnings.includes("inline-image-above-compatibility-target"),
      measurementComplete: measured.completeTokenUriBytes !== undefined, hardBlockers, compatibilityWarnings, remainingChecks, requiredCapability,
      status: hardBlockers.length ? "blocked" as const : "requires-validation" as const, publicationReady: false as const };
  });
  const large = (original.byteLength ?? 0) > KEEL_SMART_SPLIT_ASSET_THRESHOLD_BYTES;
  const intermediate = (original.byteLength ?? 0) > KEEL_SMART_INLINE_ASSET_MAX_BYTES && !large;
  const preferred: KeelAssetPresentationCandidateId[] = assetPresentation === "external-preview" ? large ? ["external-preview-hybrid", "external-preview-inline"] : ["external-preview-inline", "external-preview-hybrid"]
    : assetPresentation === "inline-image-hybrid-verifier" ? ["canonical-hybrid"]
    : large ? ["canonical-hybrid", "external-preview-hybrid", "canonical-inline"]
    : intermediate && execution === "static" ? [isImage ? "image-only-inline" : "media-only-inline", "canonical-inline", "canonical-hybrid", "external-preview-hybrid"]
    : ["canonical-inline", "canonical-hybrid", isImage ? "image-only-inline" : "media-only-inline", "external-preview-hybrid"];
  const usable = (id: KeelAssetPresentationCandidateId) => candidates.find(c => c.id === id)!;
  const qualified = preferred.map(usable).filter(c => c.hardBlockers.length === 0);
  const recommended = qualified.find(c => c.measurementComplete && c.standardsCompatible) ?? qualified.find(c => c.standardsCompatible !== false) ?? qualified[0] ?? usable(preferred[0]!);
  const selected = explicit ? candidates.find(c => c.selection.image === explicit.image && c.selection.animation === explicit.animation) : assetPresentation === "automatic" ? recommended : usable(preferred[0]!);
  if (!selected) throw new TypeError("This slot combination has no maintained presentation adapter.");
  const selectionSource = explicit ? "explicit" as const : assetPresentation === "automatic" ? "recommended" as const : "preset" as const;
  const suggestions: { candidateId?: KeelAssetPresentationCandidateId; code: string }[] = [];
  if (Number(selected.measurements.completeTokenUriBytes ?? 0) > KEEL_SMART_TOKEN_URI_MAX_BYTES && selected.selection.animation === "hybrid-shell") {
    if (execution === "static") suggestions.push({ candidateId: "image-only-inline", code: "review-image-only-to-save-space" });
    suggestions.push({ candidateId: "hybrid-verifier-only", code: "review-verifier-without-inline-grid-image" });
    if (Number(selected.measurements.encodedAnimationSlotBytes ?? selected.measurements.embeddedAnimationUriBytes ?? 0) > KEEL_SMART_TOKEN_URI_MAX_BYTES) {
      suggestions.push({ candidateId: fallbackDelivery === "hosted" ? "hosted-presentation" : "ipfs-presentation", code: "embedded-verifier-alone-above-standard-target" });
      if (fallbackDelivery === undefined) suggestions.push({ code: "choose-ipfs-or-hosted-if-external-presentation-is-desired" });
    }
  }
  const acknowledgementKey = canonicalJson({ contextIdentity: contextIdentity ?? null, source: original, preview: preview ?? null, execution, assetPresentation, selection: selected.selection, fallbackDelivery: fallbackDelivery ?? null, externalPreviewUri: externalPreviewUri ?? null, externalPresentation: externalPresentation ?? null, capabilities: capabilities ?? null, candidateMeasurements: candidates.map(c => [c.id, c.measurements]) });
  const compatibilityReviewRequired = selected.compatibilityWarnings.some(w => w !== "collection-grids-will-not-show-an-image") && input.nonstandardCompatibilityAcknowledged !== true
    || selected.image === null && input.omittedGridImageAcknowledged !== true;
  const policy = { schema: "keel-smart-asset-presentation@1" as const, ...(contextIdentity === undefined ? {} : { contextIdentity }), assetPresentation, source: original, ...(preview === undefined ? {} : { preview }), execution,
    ...(fallbackDelivery === undefined ? {} : { fallbackDelivery }), ...(externalPreviewUri === undefined ? {} : { externalPreviewUri }), ...(externalPresentation === undefined ? {} : { externalPresentation }),
    ...(capabilities === undefined ? {} : { capabilities }),
    ...selected, selectedCandidateId: selected.id, recommendedCandidateId: recommended.id, selectionSource,
    candidates, suggestions, acknowledgementKey, nonstandardCompatibilityAcknowledged: input.nonstandardCompatibilityAcknowledged === true, omittedGridImageAcknowledged: input.omittedGridImageAcknowledged === true,
    thresholds: { assetInlineBytes: KEEL_SMART_INLINE_ASSET_MAX_BYTES, assetSplitReadBytes: KEEL_SMART_SPLIT_ASSET_THRESHOLD_BYTES, encodedImageUriBytes: KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES, completeTokenUriBytes: KEEL_SMART_TOKEN_URI_MAX_BYTES },
    reasons: [large ? "split-read-recommended-for-source-size" : intermediate ? "direct-native-media-recommended-for-source-size" : "registered-verifier-default", ...selected.hardBlockers], blockers: selected.hardBlockers,
    status: selected.hardBlockers.length ? "blocked" as const : compatibilityReviewRequired ? "compatibility-review-required" as const : "requires-validation" as const,
    publicationReady: false as const, requiresExactFullSimulation: true as const, requiredNativeStorageCopies: 1 as const };
  return freeze({ ...policy, planKey: canonicalJson(policy) });
}
export type KeelSmartAssetPresentationPlan = ReturnType<typeof planKeelSmartAssetPresentation>;
export async function hashKeelSmartAssetPresentationPlan(plan: KeelSmartAssetPresentationPlan): Promise<`0x${string}`> {
  const { planKey, ...policy } = plan;
  if (canonicalJson(policy) !== planKey) throw new TypeError("Presentation policy changed after planning.");
  return sha256Hex(new TextEncoder().encode(planKey));
}
function decodeDataURI(uri: string): Uint8Array {
  const comma = uri.indexOf(","); if (comma < 0) throw new TypeError("Malformed complete data URI.");
  return /;base64$/iu.test(uri.slice(0, comma)) ? decodeBase64(uri.slice(comma + 1)) : new TextEncoder().encode(decodeURIComponent(uri.slice(comma + 1)));
}
/** Find a top-level member in the original JSON, retaining spelling and whitespace. */
function stringMemberSpan(json: string, member: string) {
  let cursor = 0, previousComma: number | null = null;
  const whitespace = () => { while (cursor < json.length && /\s/u.test(json[cursor]!)) cursor++; };
  const stringEnd = (start: number) => {
    let index = start + 1;
    while (index < json.length) { const char = json[index++]!; if (char === "\\") index++; else if (char === '"') return index; }
    throw new TypeError("Malformed metadata string.");
  };
  const valueEnd = (start: number) => {
    if (json[start] === '"') return stringEnd(start);
    if (json[start] !== "{" && json[start] !== "[") { let end = start; while (end < json.length && !/[\s,}\]]/u.test(json[end]!)) end++; return end; }
    const stack: string[] = [json[start]!]; let index = start + 1;
    while (stack.length && index < json.length) {
      const char = json[index]!;
      if (char === '"') { index = stringEnd(index); continue; }
      if (char === "{" || char === "[") stack.push(char); else if (char === "}" || char === "]") stack.pop();
      index++;
    }
    return index;
  };
  whitespace(); if (json[cursor++] !== "{") throw new TypeError("Metadata must be an object.");
  let selected: { memberStart: number; memberEnd: number; valueStart: number; valueEnd: number } | null = null;
  whitespace();
  while (json[cursor] !== "}") {
    const keyStart = cursor, keyEnd = stringEnd(keyStart), key = JSON.parse(json.slice(keyStart, keyEnd)) as string;
    cursor = keyEnd; whitespace(); if (json[cursor++] !== ":") throw new TypeError("Malformed metadata member.");
    whitespace(); const start = cursor, end = valueEnd(start); cursor = end; whitespace();
    const comma = json[cursor] === "," ? cursor : null;
    if (key === member) {
      if (selected !== null) throw new TypeError(`Duplicate metadata ${member} members cannot be measured unambiguously.`);
      if (json[start] !== '"') throw new TypeError(`Metadata ${member} must be one unambiguous string member.`);
      selected = { memberStart: previousComma ?? keyStart, memberEnd: previousComma === null && comma !== null ? comma + 1 : end, valueStart: start, valueEnd: end };
    }
    if (comma === null) break;
    previousComma = comma; cursor++; whitespace();
  }
  return selected;
}
/** Measure original percent spans or the original JSON bytes under its canonical
 * Base64 grammar. No alternate JSON serialization or URI escaping is introduced. */
function encodedMemberContribution(uri: string, json: string, member: string) {
  const span = stringMemberSpan(json, member); if (!span) return null;
  const comma = uri.indexOf(","), body = uri.slice(comma + 1), utf8 = new TextEncoder();
  if (/;base64$/iu.test(uri.slice(0, comma))) {
    const raw = utf8.encode(json);
    if (body !== encodeBase64(raw)) throw new TypeError("Noncanonical outer Base64 cannot be measured without changing its grammar.");
    const memberBytes = utf8.encode(json.slice(span.memberStart, span.memberEnd)).length;
    const valueBytes = utf8.encode(json.slice(span.valueStart + 1, span.valueEnd - 1)).length;
    const encodedLength = (bytes: number) => 4 * Math.ceil(bytes / 3);
    return { encodedSlotBytes: body.length - encodedLength(raw.length - memberBytes), encodedValueBytes: body.length - encodedLength(raw.length - valueBytes) };
  }
  const positions = [...new Set([span.memberStart, span.memberEnd, span.valueStart + 1, span.valueEnd - 1])].map(position => ({ position, byteOffset: utf8.encode(json.slice(0, position)).length })).sort((a, b) => a.byteOffset - b.byteOffset);
  const offsets = new Map<number, number>(); let rawOffset = 0, decodedBytes = 0;
  for (const target of positions) {
    while (decodedBytes < target.byteOffset) {
      if (body[rawOffset] === "%") { decodedBytes++; rawOffset += 3; }
      else { const code = body.codePointAt(rawOffset)!; decodedBytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; rawOffset += code > 0xffff ? 2 : 1; }
    }
    if (decodedBytes !== target.byteOffset) throw new TypeError("Metadata span splits an encoded code point.");
    offsets.set(target.position, rawOffset);
  }
  const size = (start: number, end: number) => utf8.encode(body.slice(offsets.get(start)!, offsets.get(end)!)).length;
  return { encodedSlotBytes: size(span.memberStart, span.memberEnd), encodedValueBytes: size(span.valueStart + 1, span.valueEnd - 1) };
}

/** The renderer must assemble the complete chosen return, including every embedded instruction.
 * Compatibility targets are warnings; actual qualified reader/gas limits remain hard gates. */
export async function measureKeelSmartAssetPresentation(plan: KeelSmartAssetPresentationPlan, renderTokenURI: (plan: KeelSmartAssetPresentationPlan) => string | Promise<string>) {
  await hashKeelSmartAssetPresentationPlan(plan);
  const tokenURI = await renderTokenURI(plan);
  await hashKeelSmartAssetPresentationPlan(plan);
  if (typeof tokenURI !== "string" || !/^data:application\/json(?:[;,])/iu.test(tokenURI)) throw new TypeError("Render the actual complete JSON metadata data URI.");
  const completeTokenUriBytes = new TextEncoder().encode(tokenURI).length;
  let metadata: Record<string, unknown>, json: string;
  try { json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(decodeDataURI(tokenURI)); metadata = JSON.parse(json) as Record<string, unknown>; }
  catch { throw new TypeError("Malformed complete metadata encoding."); }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") throw new TypeError("Malformed complete metadata JSON.");
  const hardBlockers = [...plan.hardBlockers], compatibilityWarnings: string[] = [];
  if (plan.image === null) { if (metadata.image !== undefined && metadata.image !== null && metadata.image !== "") hardBlockers.push("omitted-image-selection-changed"); compatibilityWarnings.push("collection-grids-will-not-show-an-image"); }
  else if (typeof metadata.image !== "string" || !metadata.image) hardBlockers.push("usable-grid-image-required");
  if (plan.animation.delivery === "omitted") { if (metadata.animation_url !== undefined && metadata.animation_url !== null && metadata.animation_url !== "") hardBlockers.push("omitted-animation-selection-changed"); }
  else if (typeof metadata.animation_url !== "string" || !metadata.animation_url) hardBlockers.push("chosen-animation-required");
  let embeddedAnimationIntegrity: { digest: `0x${string}`; byteLength: number } | null = null, embeddedAnimationUriBytes: number | null = null;
  let encodedAnimationSlotBytes: number | null = null, encodedAnimationValueBytes: number | null = null;
  let inlineMediaIntegrity: { digest: `0x${string}`; byteLength: number } | null = null;
  if (plan.animation.delivery === "inline-shell" || plan.animation.delivery === "hybrid-shell") {
    if (typeof metadata.animation_url !== "string" || !/^data:text\/html[;,]/iu.test(metadata.animation_url)) hardBlockers.push("registered-animation-shell-required");
    else { const bytes = decodeDataURI(metadata.animation_url); embeddedAnimationIntegrity = { digest: await sha256Hex(bytes), byteLength: bytes.length }; embeddedAnimationUriBytes = new TextEncoder().encode(metadata.animation_url).length;
      const contribution = encodedMemberContribution(tokenURI, json, "animation_url");
      if (contribution) { encodedAnimationSlotBytes = contribution.encodedSlotBytes; encodedAnimationValueBytes = contribution.encodedValueBytes; }
      if ((encodedAnimationSlotBytes ?? embeddedAnimationUriBytes) > KEEL_SMART_TOKEN_URI_MAX_BYTES) compatibilityWarnings.push("embedded-verifier-above-compatibility-target");
    }
  } else if (plan.animation.delivery === "inline-media") {
    if (typeof metadata.animation_url !== "string" || !metadata.animation_url.startsWith(`data:${plan.source.mediaType};`) && !metadata.animation_url.startsWith(`data:${plan.source.mediaType},`)) hardBlockers.push("inline-native-media-required");
    else {
      const bytes = decodeDataURI(metadata.animation_url);
      inlineMediaIntegrity = { digest: await sha256Hex(bytes), byteLength: bytes.length };
      if (bytes.length !== plan.source.byteLength || inlineMediaIntegrity.digest !== plan.source.digest) hardBlockers.push("inline-native-media-source-changed");
      embeddedAnimationUriBytes = new TextEncoder().encode(metadata.animation_url).length;
      const contribution = encodedMemberContribution(tokenURI, json, "animation_url");
      if (contribution) { encodedAnimationSlotBytes = contribution.encodedSlotBytes; encodedAnimationValueBytes = contribution.encodedValueBytes; }
    }
  } else if ((plan.animation.delivery === "ipfs-shell" || plan.animation.delivery === "hosted-shell") && metadata.animation_url !== plan.animation.uri) hardBlockers.push("external-presentation-selection-changed");
  let imageUriBytes: number | null = null, encodedImageSlotBytes: number | null = null, encodedImageValueBytes: number | null = null;
  if (typeof metadata.image === "string") {
    imageUriBytes = new TextEncoder().encode(metadata.image).length;
    const contribution = encodedMemberContribution(tokenURI, json, "image");
    if (contribution) { encodedImageSlotBytes = contribution.encodedSlotBytes; encodedImageValueBytes = contribution.encodedValueBytes; }
    if (plan.image?.delivery === "inline") {
      if (!metadata.image.startsWith(`data:${plan.image.commitment.mediaType};`) && !metadata.image.startsWith(`data:${plan.image.commitment.mediaType},`)) hardBlockers.push("inline-grid-image-required");
      else { const bytes = decodeDataURI(metadata.image); if (bytes.length !== plan.image.commitment.byteLength || await sha256Hex(bytes) !== plan.image.commitment.digest) hardBlockers.push("inline-image-source-changed"); }
      if (imageUriBytes > KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES || (encodedImageSlotBytes ?? 0) > KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES) compatibilityWarnings.push("inline-image-above-compatibility-target");
    } else if (plan.image?.delivery === "onchain-reference" && plan.image.uri !== undefined && metadata.image !== plan.image.uri) hardBlockers.push("native-image-reference-changed");
    else if (plan.image?.delivery === "external" && metadata.image !== plan.image.uri) hardBlockers.push("external-preview-selection-changed");
  }
  if (plan.animation.delivery === "onchain-reference" && plan.animation.uri !== undefined && metadata.animation_url !== plan.animation.uri) hardBlockers.push("native-media-reference-changed");
  if (completeTokenUriBytes > KEEL_SMART_TOKEN_URI_MAX_BYTES) compatibilityWarnings.push("complete-metadata-above-standard-target");
  if (plan.measurements.maximumTokenUriBytes !== undefined && completeTokenUriBytes > Number(plan.measurements.maximumTokenUriBytes)) hardBlockers.push("actual-reader-output-limit");
  const recommendations: { candidateId?: KeelAssetPresentationCandidateId; code: string }[] = [];
  if (completeTokenUriBytes > KEEL_SMART_TOKEN_URI_MAX_BYTES && plan.animation.delivery === "hybrid-shell") {
    if (plan.execution === "static") recommendations.push({ candidateId: "image-only-inline", code: "review-image-only-to-save-space" });
    recommendations.push({ candidateId: "hybrid-verifier-only", code: "review-verifier-without-inline-grid-image" });
    if ((encodedAnimationSlotBytes ?? embeddedAnimationUriBytes ?? 0) > KEEL_SMART_TOKEN_URI_MAX_BYTES) recommendations.push({ candidateId: plan.fallbackDelivery === "hosted" ? "hosted-presentation" : "ipfs-presentation", code: "embedded-verifier-alone-above-standard-target" });
  }
  const standardsCompatible = completeTokenUriBytes <= KEEL_SMART_TOKEN_URI_MAX_BYTES && (plan.image?.delivery !== "inline" || (imageUriBytes ?? 0) <= KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES && (encodedImageSlotBytes ?? 0) <= KEEL_SMART_INLINE_IMAGE_URI_MAX_BYTES);
  const compatibilityReviewRequired = !standardsCompatible && !plan.nonstandardCompatibilityAcknowledged || plan.image === null && !plan.omittedGridImageAcknowledged;
  const result = { schema: "keel-smart-presentation-return-measurement@1" as const, planKey: plan.planKey, acknowledgementKey: plan.acknowledgementKey,
    tokenURI, completeTokenUriBytes, imageUriBytes, encodedImageSlotBytes, encodedImageValueBytes, encodedAnimationSlotBytes, encodedAnimationValueBytes, inlineMediaIntegrity, embeddedAnimationIntegrity, embeddedAnimationUriBytes, standardsCompatible, measurementBasis: "actual-rendered-complete-return" as const,
    hardBlockers: [...new Set(hardBlockers)], compatibilityWarnings: [...new Set(compatibilityWarnings)], recommendations,
    tokenUriDigest: await sha256Hex(new TextEncoder().encode(tokenURI)),
    status: hardBlockers.length ? "blocked" as const : compatibilityReviewRequired ? "compatibility-review-required" as const : "requires-selected-chain-simulation" as const,
    publicationReady: false as const, requiresExactFullSimulation: true as const };
  return freeze({ ...result, measurementKey: canonicalJson({ tokenUriDigest: result.tokenUriDigest, completeTokenUriBytes, imageUriBytes, encodedImageSlotBytes, encodedImageValueBytes, encodedAnimationSlotBytes, encodedAnimationValueBytes, inlineMediaIntegrity, embeddedAnimationIntegrity, embeddedAnimationUriBytes, selectedPlanKey: plan.planKey, standardsCompatible, hardBlockers: result.hardBlockers, compatibilityWarnings: result.compatibilityWarnings }) });
}
/** Measure only supported candidate adapters. Unavailable layouts stay visibly unqualified. */
export async function measureKeelSmartPresentationMatrix(input: KeelSmartAssetPresentationInput,
  renderCandidate: (candidate: KeelSmartAssetPresentationPlan["candidates"][number], plan: KeelSmartAssetPresentationPlan) => string | null | Promise<string | null>) {
  const snapshot = JSON.parse(JSON.stringify(input, (_, value) => typeof value === "bigint" ? value.toString() : value)) as KeelSmartAssetPresentationInput;
  const plan = planKeelSmartAssetPresentation(snapshot);
  const results: { candidateId: KeelAssetPresentationCandidateId; status: Awaited<ReturnType<typeof measureKeelSmartAssetPresentation>>["status"] | "blocked" | "unavailable"; hardBlockers?: readonly string[]; measurement?: Awaited<ReturnType<typeof measureKeelSmartAssetPresentation>> }[] = [];
  for (const candidate of plan.candidates) {
    if (candidate.hardBlockers.length) { results.push({ candidateId: candidate.id, status: "blocked" as const, hardBlockers: candidate.hardBlockers }); continue; }
    const selected = planKeelSmartAssetPresentation({ ...snapshot, selection: candidate.selection });
    const tokenURI = await renderCandidate(candidate, selected);
    if (tokenURI === null) { results.push({ candidateId: candidate.id, status: "unavailable" as const }); continue; }
    const measurement = await measureKeelSmartAssetPresentation(selected, () => tokenURI);
    results.push({ candidateId: candidate.id, status: measurement.status, measurement });
  }
  const actual = (id: KeelAssetPresentationCandidateId) => results.find(result => result.candidateId === id && "measurement" in result)?.measurement;
  const chosen = actual(plan.selectedCandidateId), withoutImage = actual("hybrid-verifier-only"), imageOnly = actual("image-only-inline");
  const recommendations: { candidateId: KeelAssetPresentationCandidateId; code: string; completeTokenUriBytes: number }[] = [];
  if (chosen && chosen.completeTokenUriBytes > KEEL_SMART_TOKEN_URI_MAX_BYTES && plan.animation.delivery === "hybrid-shell") {
    if (imageOnly && imageOnly.hardBlockers.length === 0 && imageOnly.completeTokenUriBytes <= KEEL_SMART_TOKEN_URI_MAX_BYTES) recommendations.push({ candidateId: "image-only-inline", code: "measured-image-only-within-standard-target", completeTokenUriBytes: imageOnly.completeTokenUriBytes });
    if (withoutImage && withoutImage.hardBlockers.length === 0) recommendations.push({ candidateId: "hybrid-verifier-only", code: withoutImage.completeTokenUriBytes <= KEEL_SMART_TOKEN_URI_MAX_BYTES ? "measured-verifier-without-grid-image-within-target" : "measured-verifier-only-metadata-above-target", completeTokenUriBytes: withoutImage.completeTokenUriBytes });
    if (withoutImage && (withoutImage.encodedAnimationSlotBytes ?? withoutImage.embeddedAnimationUriBytes ?? 0) > KEEL_SMART_TOKEN_URI_MAX_BYTES) recommendations.push({ candidateId: plan.fallbackDelivery === "hosted" ? "hosted-presentation" : "ipfs-presentation", code: "review-external-presentation-after-measured-verifier-only", completeTokenUriBytes: withoutImage.completeTokenUriBytes });
  }
  return freeze({ schema: "keel-smart-presentation-matrix-measurement@1" as const, planKey: plan.planKey, results, recommendations, publicationReady: false as const });
}
