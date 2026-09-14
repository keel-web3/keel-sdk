import {
  assessKeelInlinePresentation,
  KEEL_INLINE_COMPRESSED_ASSET_BYTES,
  KEEL_INLINE_MAX_TOKEN_URI_BYTES,
  KEEL_INLINE_SAFE_RPC_GAS,
  keelInlineReadGasLimit,
  planKeelAssetPresentation,
  type KeelPresentationMode,
} from "./presentation.js";

/**
 * The default Tezos compatibility lane.  These are the same KEEL roles used
 * by the Ethereum publication path, expressed through the Tezos contracts:
 * native OnchFS storage, the canonical harness, the index, a real FA2, and a
 * small compatibility sleeve for ordinary token_uri readers.
 */
export const KEEL_TEZOS_STANDARD_MODULES = Object.freeze([
  "keel-hold-onchfs",
  "keel-index",
  "keel-harness-builder",
  "keel-collection-fa2",
  "keel-sleeve",
] as const);

export const KEEL_TEZOS_STANDARD_ROUTE = "keel-tezos-standard-fa2-onchfs@1" as const;
export const KEEL_TEZOS_STANDARD_STORAGE = "native-keel-onchfs" as const;
export const KEEL_TEZOS_STANDARD_PUBLIC_SURFACE = "FA2/TZIP-12 token_metadata" as const;
export const KEEL_TEZOS_STANDARD_COMPATIBILITY_SURFACE = "KeelSleeve.token_uri -> token_json" as const;

export interface KeelTezosStandardRouteInput {
  readonly network: string;
  /** The original creator asset or canonical root-shell byte count. */
  readonly originalAssetByteLength: number;
  /** The measured stored child-resource size used by the compact default. */
  readonly compressedAssetByteLength: number;
  /** The complete prepared inline animation/tokenURI return, not decoded browser bytes. */
  readonly completeInlineByteLength: number;
  readonly builderConfigured: boolean;
  readonly bootShellCompression?: string;
  readonly mediaType?: string;
  readonly html?: string;
  readonly mode?: "auto" | "inline" | "hybrid";
  readonly readGas?: bigint;
  readonly blockGasLimit?: bigint;
}

const TEZOS_NETWORK = /^Net[1-9A-HJ-NP-Za-km-z]{12}$/u;

function assertByteLength(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a nonnegative safe byte count.`);
}

function assertNetwork(value: string): void {
  if (typeof value !== "string" || !TEZOS_NETWORK.test(value)) throw new TypeError("network must be an exact Tezos Net... identity.");
}

/**
 * Apply the shared KEEL presentation gate to the Tezos compatibility lane.
 *
 * The selected carrier does not change when the presentation mode changes:
 * both routes keep the immutable bytes in OnchFS.  Inline is the ordinary
 * self-contained data:text/html route; Hybrid is the fail-closed route where
 * the canonical shell resolves the same KEEL objects through read-only RPC.
 */
export function planKeelTezosStandardRoute(input: KeelTezosStandardRouteInput) {
  assertNetwork(input.network);
  assertByteLength(input.originalAssetByteLength, "originalAssetByteLength");
  assertByteLength(input.compressedAssetByteLength, "compressedAssetByteLength");
  assertByteLength(input.completeInlineByteLength, "completeInlineByteLength");
  if (input.mode !== undefined && !["auto", "inline", "hybrid"].includes(input.mode)) throw new TypeError("Unsupported Tezos presentation mode.");
  if (input.readGas !== undefined && input.readGas < 0n) throw new TypeError("Read gas cannot be negative.");
  if (input.blockGasLimit !== undefined && input.blockGasLimit <= 0n) throw new TypeError("Block gas limit must be positive.");

  const compactPlan = planKeelAssetPresentation({
    originalByteLength: input.originalAssetByteLength,
    compressedByteLength: input.compressedAssetByteLength,
    graphByteLength: input.completeInlineByteLength,
    tokenUriByteLength: input.completeInlineByteLength,
    ...(input.mode === undefined ? {} : { mode: input.mode }),
    ...(input.readGas === undefined ? {} : { readGas: input.readGas }),
    ...(input.blockGasLimit === undefined ? {} : { blockGasLimit: input.blockGasLimit }),
  });
  const assessment = assessKeelInlinePresentation({
    builderConfigured: input.builderConfigured,
    bootShellCompression: input.bootShellCompression ?? "none",
    tokenUriByteLength: input.completeInlineByteLength,
    mediaType: input.mediaType ?? "text/html",
    ...(input.html === undefined ? {} : { html: input.html }),
  });
  const gasLimit = input.blockGasLimit === undefined ? KEEL_INLINE_SAFE_RPC_GAS : keelInlineReadGasLimit(input.blockGasLimit);
  const readGasExceeded = input.readGas !== undefined && input.readGas > gasLimit;
  const automaticMode: KeelPresentationMode = compactPlan.automaticMode === "inline" && assessment.recommendedMode === "inline" && !readGasExceeded ? "inline" : "hybrid";
  const mode: KeelPresentationMode = input.mode === undefined || input.mode === "auto" ? automaticMode : input.mode;
  const warnings = [...compactPlan.warnings];
  if (automaticMode === "hybrid" && !warnings.some((warning) => warning.code === "rpc-presentation")) {
    warnings.push({
      code: "rpc-presentation",
      message: readGasExceeded ? `The measured public read gas exceeds the selected ${gasLimit.toString()}-gas boundary.` : assessment.reason,
      remedy: "Keep the canonical KEEL shell and native OnchFS objects. Let the shell resolve them through a read-only RPC reader and expose direct contract retrieval beside the viewer.",
    });
  }
  if (mode === "inline" && automaticMode === "hybrid" && !warnings.some((warning) => warning.code === "explicit-inline-risk")) {
    warnings.push({
      code: "explicit-inline-risk",
      message: "Inline was explicitly selected even though the automatic Tezos gate chose Hybrid.",
      remedy: "Re-measure the complete return and the selected-chain read gas before wallet review; the default remains Hybrid until both pass.",
    });
  }

  return {
    schema: KEEL_TEZOS_STANDARD_ROUTE,
    status: "review-only" as const,
    family: "tezos" as const,
    network: input.network,
    defaults: {
      shell: "registered-canonical-shell" as const,
      storage: KEEL_TEZOS_STANDARD_STORAGE,
      carrier: "onchfs" as const,
      publicSurface: KEEL_TEZOS_STANDARD_PUBLIC_SURFACE,
      compatibilitySurface: KEEL_TEZOS_STANDARD_COMPATIBILITY_SURFACE,
      presentation: "auto-inline-then-hybrid-rpc" as const,
      modules: KEEL_TEZOS_STANDARD_MODULES,
      optionalModules: [] as const,
    },
    storage: {
      mode: "native" as const,
      carrier: "onchfs" as const,
      immutableBytesRemainOnchain: true as const,
      externalStorageFallback: false as const,
      note: "Hybrid changes presentation retrieval, not storage. It is not IPFS and does not move the artwork offchain.",
    },
    measurements: {
      originalAssetByteLength: input.originalAssetByteLength,
      compressedAssetByteLength: input.compressedAssetByteLength,
      completeInlineByteLength: input.completeInlineByteLength,
      compactCutoffBytes: KEEL_INLINE_COMPRESSED_ASSET_BYTES,
      publicReadLimitBytes: KEEL_INLINE_MAX_TOKEN_URI_BYTES,
      ...(input.readGas === undefined ? {} : { readGas: input.readGas.toString() }),
      ...(input.blockGasLimit === undefined ? {} : { blockGasLimit: input.blockGasLimit.toString() }),
    },
    presentation: {
      mode,
      automaticMode,
      inlineEligible: assessment.eligible && automaticMode === "inline",
      reason: mode === "hybrid" ? readGasExceeded ? `The measured public read gas exceeds the selected ${gasLimit.toString()}-gas boundary.` : assessment.reason : compactPlan.mode === "inline" ? assessment.reason : "Inline was explicitly selected; the automatic gate remains available for review.",
      warnings,
      inline: {
        route: "complete data:text/html animation_url with no RPC fetch",
        requires: ["verified canonical shell", "configured KEEL builder", "complete return at or below the public-read limit", "selected-chain read-gas proof"],
      },
      hybrid: {
        route: "canonical shell resolves native KEEL objects through read-only RPC",
        requires: ["verified canonical shell", "native OnchFS object read-back", "declared RPC reader", "direct contract retrieval beside the viewer"],
        networkPresentationDependency: true,
      },
    },
    publication: {
      signing: "not-performed" as const,
      submission: "not-performed" as const,
      publicationReady: false as const,
      remainingChecks: ["receipt-backed Hold, Index, HarnessBuilder, FA2, and Sleeve bindings", "exact OnchFS file/object read-back", "selected-chain public read and gas evidence", "wallet review of the final calls"],
    },
  };
}
