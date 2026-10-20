import { gzipSync } from "node:zlib";
import { resolveKeelPayloadStorage, type KeelPayloadStorageMode } from "@keel/protocol";
import { prepareKeelDensePayload } from "./prepared-dense-copy.js";
export { selectKeelRegisteredInlineCandidate, keelRegisteredInlineRecipeDigest } from "./registered-inline-candidates.js";
export type { KeelRegisteredInlineCodec, KeelRegisteredInlineSource, KeelRegisteredInlinePart, KeelRegisteredInlineRecipe,
  KeelRegisteredInlineMeasurementScope, KeelRegisteredInlineBuiltCandidate, KeelRegisteredInlineCandidate } from "./registered-inline-candidates.js";

/** Build policy is resolved before any upload. Capabilities must come from the
 * authenticated selected publication path, never the decoder installed locally. */
export function resolveKeelInlineBuildRoute(input: {
  readonly payloadStorage?: KeelPayloadStorageMode;
  readonly compression?: "auto" | "brotli" | "gzip" | "none";
  readonly brotliQuality?: number;
  /** Planning input from the selected reader's authenticated fresh carriage.
   * This is not registration evidence. Omit to retain the unqualified planner. */
  readonly freshReaderCompressions?: readonly ("none" | "gzip" | "brotli")[];
  readonly resources: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}) {
  const storage = resolveKeelPayloadStorage(input.payloadStorage);
  if (storage === "raw" && input.compression !== undefined && input.compression !== "none") {
    throw new TypeError("Raw payload storage cannot enable automatic compression.");
  }
  const compression = storage === "raw" ? "none" : input.compression ?? "auto";
  const freshReaderCompressions = input.freshReaderCompressions === undefined ? undefined : [...input.freshReaderCompressions];
  if (freshReaderCompressions !== undefined && (!freshReaderCompressions.includes("none")
    || new Set(freshReaderCompressions).size !== freshReaderCompressions.length
    || freshReaderCompressions.some(codec => codec !== "none" && codec !== "gzip" && codec !== "brotli"))) {
    throw new TypeError("Fresh reader compression choices must include none and contain only unique supported codecs.");
  }
  if ((compression === "brotli" || compression === "gzip") && freshReaderCompressions !== undefined && !freshReaderCompressions.includes(compression)) {
    throw new KeelInlineReaderCodecUnavailableError(compression);
  }
  const effectiveCompression = compression === "auto" && freshReaderCompressions !== undefined && !freshReaderCompressions.includes("brotli") ? "none" : compression;
  const resources = input.resources.map(resource => {
    if (effectiveCompression === "gzip") {
      const packed = gzipSync(resource.bytes, { level: 9 });
      return { id: resource.id, compression: "gzip" as const, sourceBytes: resource.bytes.length,
        compressedBytes: packed.length, preparedBytes: null, uncompressedPreparedBytes: null, preparedBytesSaved: null,
        sourceByteIdentity: "verified-exact" as const, selection: compression };
    }
    const payload = prepareKeelDensePayload(resource.bytes, { compression: effectiveCompression,
      ...(input.brotliQuality === undefined ? {} : { brotliQuality: input.brotliQuality }) });
    return { id: resource.id, compression: payload.compression, ...payload.optimization, selection: compression };
  });
  const prepared = resources.some(resource => resource.compression === "brotli");
  return { route: prepared ? "creator-prepared-copy" as const : "legacy-uncompressed" as const,
    compression, resources, ...(freshReaderCompressions === undefined ? {} : { freshReaderCompressions,
      readerSelection: effectiveCompression === "none" && compression === "auto" ? "auto-reader-compatible-none" as const : "reader-compatible" as const }),
    sourceBytes: resources.reduce((n, r) => n + r.sourceBytes, 0),
    compressedBytes: resources.reduce((n, r) => n + r.compressedBytes, 0),
    storagePlacement: "onchain" as const,
    requiresFullReadValidation: true as const, requiresDeliveryValidation: true as const,
    alternatives: [
      { route: "creator-prepared-copy" as const, storagePlacement: "onchain" as const, delivery: "inline" as const, resourceBytes: "losslessly-compressed" as const, status: "requires-validation" as const },
      { route: "original-assisted-delivery" as const, storagePlacement: "onchain" as const, delivery: "hybrid" as const, resourceBytes: "original" as const, status: "requires-validation" as const },
      { route: "creator-custom" as const, storagePlacement: "creator-selected" as const, delivery: "creator-selected" as const, resourceBytes: "creator-selected" as const, status: "requires-validation" as const },
    ], offchainPayloads: [] as readonly string[] };
}

export class KeelInlineReaderCodecUnavailableError extends TypeError {
  readonly code = "KEEL_INLINE_CODEC_UNSUPPORTED";
  constructor(codec: "gzip" | "brotli" = "brotli") {
    super(`KEEL_INLINE_CODEC_UNSUPPORTED: Explicit ${codec === "brotli" ? "Brotli" : "Gzip"} requires the exact selected-chain registered decoder and fresh carriage. The selected reader cannot carry that choice; preserve the original source, compression preference and existing plans before reviewing a compatible reader.`);
    this.name = "KeelInlineReaderCodecUnavailableError";
  }
}

export class KeelInlineDeliveryPlanRequiredError extends TypeError {
  readonly code = "KEEL_INLINE_DELIVERY_PLAN_REQUIRED";
  constructor(readonly decision: ReturnType<typeof resolveKeelInlineBuildRoute>) {
    super(`KEEL_INLINE_DELIVERY_PLAN_REQUIRED: Lossless Brotli can reduce ${decision.sourceBytes} source bytes to ${decision.compressedBytes} compressed bytes, but this legacy Inline reader cannot use that prepared decoder. Choose a validated delivery plan: optimized Inline, original onchain bytes with assisted Hybrid delivery, or the creator's custom route. Original bytes may remain onchain; Hybrid delivery does not imply offchain storage. No codec, storage location or delivery mode has been changed. Compressed size excludes shell, encoding and metadata overhead.`);
    this.name = "KeelInlineDeliveryPlanRequiredError";
  }
}

export function assertKeelInlineBuildRoute(input: Parameters<typeof resolveKeelInlineBuildRoute>[0] & {
  readonly publicationPath: "legacy-collection-harness" | "creator-prepared-renderer";
}) {
  const plan = resolveKeelInlineBuildRoute(input);
  if (plan.route === "creator-prepared-copy" && input.publicationPath !== "creator-prepared-renderer") {
    throw new KeelInlineDeliveryPlanRequiredError(plan);
  }
  return plan;
}

export { createKeelRegisteredNativeGzipProof, assertKeelRegisteredNativeGzipProof, snapshotKeelRegisteredNativeGzipBinding, KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE } from "./registered-native-gzip.js";
export type { KeelRegisteredNativeGzipBinding, KeelRegisteredNativeGzipProof } from "./registered-native-gzip.js";
