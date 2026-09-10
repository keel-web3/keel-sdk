/**
 * KEEL presentation vocabulary and the fail-closed Inline eligibility check.
 *
 * Storage and presentation are separate decisions. A resource can remain in
 * native KEEL storage while its presentation is either Inline or Hybrid.
 */

/** Maximum complete tokenURI string returned through the public RPC read. */
export const KEEL_INLINE_MAX_TOKEN_URI_BYTES = 2_000_000;
/** Default automatic switch after resource compression; never an Inline admission limit. */
export const KEEL_INLINE_COMPRESSED_ASSET_BYTES = 1_750_000;

/** Local measurements choose presentation; they never establish chain publication. */
export function planKeelAssetPresentation(input: {
  readonly originalByteLength: number;
  readonly compressedByteLength: number;
  readonly mode?: "auto" | "inline" | "hybrid";
  readonly tokenUriByteLength?: number;
  /** Prepared graph only; the final metadata and preview envelope must still be measured. */
  readonly graphByteLength?: number;
  readonly readGas?: bigint;
  readonly blockGasLimit?: bigint;
}) {
  for (const [key, value] of Object.entries(input)) {
    if (["originalByteLength", "compressedByteLength", "tokenUriByteLength", "graphByteLength"].includes(key) && (!Number.isSafeInteger(value) || Number(value) < 0)) throw new TypeError(`${key} must be a nonnegative safe byte count.`);
  }
  if (!Number.isSafeInteger(input.originalByteLength) || !Number.isSafeInteger(input.compressedByteLength)) throw new TypeError("Original and compressed byte measurements are required.");
  if (input.mode !== undefined && !["auto", "inline", "hybrid"].includes(input.mode)) throw new TypeError("Unsupported presentation mode.");
  if (input.readGas !== undefined && input.readGas < 0n) throw new TypeError("Read gas cannot be negative.");
  // Complete graph/URI measurements inform compatibility checks separately.
  // Neither those measurements nor the default may replace an explicit choice.
  const automaticMode = input.compressedByteLength <= KEEL_INLINE_COMPRESSED_ASSET_BYTES ? "inline" : "hybrid";
  const mode = !input.mode || input.mode === "auto" ? automaticMode : input.mode;
  const warnings: { code: string; message: string; remedy: string }[] = [];
  if (mode === "hybrid") warnings.push({ code: "rpc-presentation", message: "The HTML viewer reconstructs the work through read-only RPC calls. All published resource bytes can still remain onchain.", remedy: "Use declared RPC providers, verify every resource digest, and expose direct contract retrieval alongside the viewer. Some collectors block network access inside animation_url." });
  if (input.compressedByteLength > KEEL_INLINE_COMPRESSED_ASSET_BYTES && mode === "inline") warnings.push({ code: "above-inline-default", message: "Inline is selected above the 1.75 MB automatic switching point. Your choice is preserved.", remedy: "Measure the complete tokenURI and public read cost; choose RPC reconstruction if the selected reader cannot return it." });
  if (input.tokenUriByteLength !== undefined && input.tokenUriByteLength > KEEL_INLINE_MAX_TOKEN_URI_BYTES) warnings.push({ code: "token-uri-size", message: "The complete tokenURI exceeds KEEL's 2 MB public-reader compatibility limit. This is a reader limit, not a file-import limit or an ERC-721 file-size rule.", remedy: "Reuse registered modules, reduce metadata/preview overhead, or explicitly choose RPC reconstruction. Keep original onchain bytes directly retrievable." });
  const gasLimit = input.blockGasLimit === undefined ? KEEL_INLINE_SAFE_RPC_GAS : keelInlineReadGasLimit(input.blockGasLimit);
  if (input.readGas !== undefined && input.readGas > gasLimit) warnings.push({ code: "read-gas", message: "The measured complete read exceeds the selected RPC gas boundary.", remedy: "Use paged readSlug calls and reconstruct locally, or choose a reader that can execute the full read. Publication gas is a separate measurement." });
  return {
    schema: "keel-asset-presentation-plan@1" as const,
    mode, automaticMode, cutoffBytes: KEEL_INLINE_COMPRESSED_ASSET_BYTES,
    carriage: "raw-percent" as const, completeDocumentBase64Layers: 0 as const,
    ...(input.graphByteLength === undefined ? {} : { graphByteLength: input.graphByteLength }),
    originalByteLength: input.originalByteLength, compressedByteLength: input.compressedByteLength,
    shell: "registered-canonical-shell" as const, warnings,
    publicationReady: false as const,
    remainingChecks: ["Exact registered shell and module bindings on the chosen chain", "Complete prepared tokenURI byte length and public RPC read gas", "Receipts and exact object read-back"],
    retrieval: {
      descriptor: "getObject(bytes32 objectId)",
      fullUncompressedObject: "haulObject(bytes32 objectId)",
      pagedStoredBytes: "readSlug(bytes32 objectId, uint256 index)",
      explanation: "For an uncompressed object, haulObject returns the complete original bytes if the reader's gas/response limits permit. Compressed objects require readSlug in order until hasNext is false; concatenate, decompress using getObject.compression, then verify byteLength and SHA-256 digest. This uses contract calls directly and does not require the HTML viewer.",
      fullCallOption: "To support a single onchain call for a compressed presentation asset, retain a separate uncompressed original object and expose its object ID. Its extra publication/storage cost must be included in review; onchain Gzip decompression is not provided by haulObject.",
    },
  };
}
/** @deprecated Use KEEL_INLINE_MAX_TOKEN_URI_BYTES; decoded browser bytes are not the RPC boundary. */
export const KEEL_INLINE_MAX_RECONSTRUCTED_BYTES = KEEL_INLINE_MAX_TOKEN_URI_BYTES;
/**
 * Upper bound KEEL will ever request for a read-only Inline reconstruction.
 * The caller must also cap this at the selected chain's latest block gas
 * limit; a hard-coded 30M ceiling incorrectly rejects valid reads on chains
 * whose public RPC execution boundary is higher.
 */
export const KEEL_INLINE_SAFE_RPC_GAS = 60_000_000n;
export const KEEL_INLINE_TOKEN_URI_FIXED_GAS = 5_000_000n;
export const KEEL_INLINE_TOKEN_URI_GAS_PER_BYTE = 90n;
export const KEEL_PREENCODED_TOKEN_URI_COLLECTION_MARGIN = 5_000_000n;

export function keelInlineReadGasLimit(blockGasLimit: bigint): bigint {
  if (blockGasLimit <= 0n) throw new RangeError("Inline read block gas limit must be positive.");
  return blockGasLimit < KEEL_INLINE_SAFE_RPC_GAS ? blockGasLimit : KEEL_INLINE_SAFE_RPC_GAS;
}

/**
 * Conservative pre-deployment budget for the complete ERC-721 read.
 *
 * The exact harness call is measured by the selected chain. `tokenURI` then
 * JSON-wraps that returned animation URI and Base64-encodes the complete JSON.
 * The 90 gas/byte allowance plus a 5M fixed margin bounds the measured KEEL721
 * path without pretending the cheaper harness-only call proves marketplace
 * readability.
 */
export function keelInlineTokenUriReadGasEstimate(input: {
  readonly harnessReadGas: bigint;
  readonly animationUriByteLength: number | bigint;
}): bigint {
  const byteLength = BigInt(input.animationUriByteLength);
  if (input.harnessReadGas < 0n) throw new RangeError("Inline harness read gas cannot be negative.");
  if (byteLength < 0n) throw new RangeError("Inline animation URI byte length cannot be negative.");
  return input.harnessReadGas
    + KEEL_INLINE_TOKEN_URI_FIXED_GAS
    + byteLength * KEEL_INLINE_TOKEN_URI_GAS_PER_BYTE;
}

/**
 * Complete collection-read budget for the direct pre-encoded lane. The
 * measured builder call already copies the final static tokenURI bytes, so it
 * must not be charged the old per-byte re-encoding allowance a second time.
 */
export function keelPreEncodedTokenUriReadGasEstimate(input: {
  readonly assemblyReadGas: bigint;
}): bigint {
  if (input.assemblyReadGas < 0n) throw new RangeError("Inline assembly read gas cannot be negative.");
  return input.assemblyReadGas + KEEL_PREENCODED_TOKEN_URI_COLLECTION_MARGIN;
}

export type KeelPresentationMode = "inline" | "hybrid" | "ipfs";

export interface KeelWeb3ObjectURIInput {
  readonly chainId: number;
  readonly storeAddress: `0x${string}`;
  readonly objectId: `0x${string}`;
  readonly mediaType: string;
}

/**
 * Build the ERC-4804/6860 URL for the bytes returned by KeelHold.haulObject.
 *
 * `getObject`/`object` returns KEEL's descriptor, not the resource body. The
 * web3 route must therefore call `haulObject(bytes32)` and declare the exact
 * MIME type for ordinary image, metadata, and browser consumers.
 */
export function keelWeb3ObjectURI(input: KeelWeb3ObjectURIInput): string {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new TypeError("A KEEL web3 object URI needs a positive safe chain ID.");
  }
  if (!/^0x[0-9a-f]{40}$/iu.test(input.storeAddress)) {
    throw new TypeError("A KEEL web3 object URI needs a canonical EVM store address.");
  }
  if (!/^0x[0-9a-f]{64}$/iu.test(input.objectId)) {
    throw new TypeError("A KEEL web3 object URI needs a canonical bytes32 object ID.");
  }
  const mediaType = input.mediaType.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(mediaType)) {
    throw new TypeError("A KEEL web3 object URI needs one exact MIME type without parameters.");
  }
  return `web3://${input.storeAddress.toLowerCase()}:${input.chainId}/haulObject/${input.objectId.toLowerCase()}?mime.type=${encodeURIComponent(mediaType)}`;
}

export const KEEL_PRESENTATION_TERMS = Object.freeze({
  bootShell: "Small, uncompressed HTML that starts the verified viewer.",
  resourceGraph: "Digest-bound scripts, modules, assets, and data used by the viewer. Child resources may be compressed.",
  browserDecoder: "A committed browser or WASM decoder that expands compressed child resources after their stored bytes are verified.",
  inline: "The complete animation_url is assembled onchain as a data:text/html URI. It has no gateway, IPFS, /content, or RPC fetch dependency.",
  hybrid: "The boot shell is onchain and resolves exact native KEEL objects through an RPC reader. The artwork remains fully onchain, but presentation needs RPC access.",
  ipfs: "The shell or resource graph is delivered from an explicitly selected IPFS URI and verified against its commitments.",
} as const);

/**
 * Codec policy exposed to Studio and agents. Compression belongs to graph
 * resources, not to the contract-readable boot shell.
 */
export const KEEL_PRESENTATION_CODEC_POLICY = Object.freeze({
  none: {
    decoder: "none",
    requirement: "Use for the boot shell and small resources that do not benefit from compression.",
  },
  gzip: {
    decoder: "browser-decompression-stream",
    requirement: "The committed shell must capability-check the browser Gzip decoder before exposing verified decoded bytes.",
  },
  deflate: {
    decoder: "browser-decompression-stream",
    requirement: "The committed shell must capability-check the browser Deflate decoder before exposing verified decoded bytes.",
  },
  brotli: {
    decoder: "declared-keel-module",
    requirement: "Reference an exact digest-locked KEEL Brotli decoder module, normally the reusable thin WASM decoder published once per chain. Do not make each creator upload it again or assume native browser Brotli support.",
  },
} as const);

export interface KeelInlinePresentationAssessment {
  readonly eligible: boolean;
  readonly recommendedMode: "inline" | "hybrid";
  readonly reason: string;
}

/**
 * Assess whether the current HTML can be returned as a complete Inline
 * animation_url by the configured contract builder.
 *
 * Only the boot shell must be uncompressed. Compressed child resources are
 * valid when the contract assembles their committed stored bytes into the
 * returned document and the shell's committed browser decoder expands them.
 * A shell that still fetches `/content`, `/api/onchain`, or an HTTP URL is
 * Hybrid, even when every referenced byte is native KEEL storage.
 */
export function assessKeelInlinePresentation(input: {
  readonly builderConfigured: boolean;
  readonly bootShellCompression: string;
  /** Prepared tokenURI return bytes, never the browser-decoded module size. */
  readonly tokenUriByteLength?: number | bigint;
  readonly mediaType: string;
  readonly html?: string;
}): KeelInlinePresentationAssessment {
  const tokenUriByteLength = input.tokenUriByteLength === undefined
    ? undefined
    : Number(input.tokenUriByteLength);
  if (tokenUriByteLength !== undefined && (!Number.isSafeInteger(tokenUriByteLength) || tokenUriByteLength < 0)) {
    return {
      eligible: false,
      recommendedMode: "hybrid",
      reason: "The prepared tokenURI return length could not be verified safely. Hybrid remains fail-closed and keeps the immutable bytes onchain.",
    };
  }
  if (!/^text\/html(?:;|$)/iu.test(input.mediaType.trim())) {
    return {
      eligible: false,
      recommendedMode: "hybrid",
      reason: "The selected boot shell is not HTML, so KEEL cannot return it as animation_url.",
    };
  }
  if (input.bootShellCompression !== "none") {
    return {
      eligible: false,
      recommendedMode: "hybrid",
      reason: "The boot shell is compressed. The current contract builder must read that root HTML directly; compress child modules and assets instead.",
    };
  }
  if (tokenUriByteLength !== undefined && tokenUriByteLength > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
    return {
      eligible: false,
      recommendedMode: "hybrid",
      reason: `The prepared tokenURI return is ${tokenUriByteLength.toLocaleString()} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES.toLocaleString()}-byte public-read limit.`,
    };
  }
  if (input.html !== undefined) {
    // Module aliases are inert data until the verified shell replaces them
    // with digest-checked blob/data URLs. Do not reject an Inline document
    // merely because an alias string contains `/content/...`; reject only an
    // active URL-bearing HTML attribute or network call.
    const requiresNetworkResolution = /(?:src|href)\s*=\s*["'](?:https?:\/\/|\/(?:api\/onchain|content)\/)/iu.test(input.html)
      || /(?:fetch|import)\s*\(\s*["'](?:https?:\/\/|\/(?:api\/onchain|content)\/)/iu.test(input.html);
    if (requiresNetworkResolution) {
      return {
        eligible: false,
        recommendedMode: "hybrid",
        reason: "This boot shell still resolves resources at runtime. Its immutable bytes may all be native KEEL storage, but presentation requires the Hybrid RPC reader.",
      };
    }
  }
  if (!input.builderConfigured) {
    return {
      eligible: false,
      recommendedMode: "hybrid",
      reason: "This chain has no verified KEEL inline builder. Hybrid is available without changing where the immutable bytes are stored.",
    };
  }
  return {
    eligible: true,
    recommendedMode: "inline",
    reason: tokenUriByteLength === undefined
      ? "The HTML is self-contained. KEEL will build and measure the exact tokenURI return before wallet review."
      : "The prepared tokenURI return is under 2 MB. KEEL must still prove the exact builder read stays within the selected chain's current public RPC gas boundary before wallet review.",
  };
}
