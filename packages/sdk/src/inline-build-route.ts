import { resolveKeelPayloadStorage, type KeelPayloadStorageMode } from "@keel/protocol";
import { prepareKeelDensePayload } from "./prepared-dense-copy.js";

/** Build policy is resolved before any upload. Capabilities must come from the
 * authenticated selected publication path, never the decoder installed locally. */
export function resolveKeelInlineBuildRoute(input: {
  readonly payloadStorage?: KeelPayloadStorageMode;
  readonly compression?: "auto" | "brotli" | "none";
  readonly brotliQuality?: number;
  readonly resources: readonly { readonly id: string; readonly bytes: Uint8Array }[];
}) {
  const storage = resolveKeelPayloadStorage(input.payloadStorage);
  if (storage === "raw" && input.compression !== undefined && input.compression !== "none") {
    throw new TypeError("Raw payload storage cannot enable automatic compression.");
  }
  const compression = storage === "raw" ? "none" : input.compression ?? "auto";
  const resources = input.resources.map(resource => {
    const payload = prepareKeelDensePayload(resource.bytes, { compression,
      ...(input.brotliQuality === undefined ? {} : { brotliQuality: input.brotliQuality }) });
    return { id: resource.id, compression: payload.compression, ...payload.optimization };
  });
  const prepared = resources.some(resource => resource.compression === "brotli");
  return { route: prepared ? "creator-prepared-copy" as const : "legacy-uncompressed" as const,
    compression, resources, sourceBytes: resources.reduce((n, r) => n + r.sourceBytes, 0),
    compressedBytes: resources.reduce((n, r) => n + r.compressedBytes, 0),
    storagePlacement: "onchain" as const,
    requiresFullReadValidation: true as const, requiresDeliveryValidation: true as const,
    alternatives: [
      { route: "creator-prepared-copy" as const, storagePlacement: "onchain" as const, delivery: "inline" as const, resourceBytes: "losslessly-compressed" as const, status: "requires-validation" as const },
      { route: "original-assisted-delivery" as const, storagePlacement: "onchain" as const, delivery: "hybrid" as const, resourceBytes: "original" as const, status: "requires-validation" as const },
      { route: "creator-custom" as const, storagePlacement: "creator-selected" as const, delivery: "creator-selected" as const, resourceBytes: "creator-selected" as const, status: "requires-validation" as const },
    ], offchainPayloads: [] as readonly string[] };
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
