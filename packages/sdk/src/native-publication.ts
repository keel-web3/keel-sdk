import { createKeelChunkPlan } from "./keel-document.js";
import type { Hex } from "./types.js";
export { createKeelChunkPlan } from "./keel-document.js";

export interface KeelNativeObjectPlan {
  readonly protocol: "keel-native-object-publication@1";
  readonly storageMode: "keel-hold";
  readonly compression: 0;
  readonly digest: Hex;
  readonly byteLength: number;
  readonly mediaType: string;
  readonly slugIds: readonly Hex[];
  /** Missing, deduplicated raw payloads. These belong in the user's transaction. */
  readonly chunks: readonly Uint8Array[];
  /** Batches follow the selected Hold limit; legacy default is three payloads. */
  readonly carrierBatches: readonly (readonly Uint8Array[])[];
  readonly storedBytes: number;
  readonly reusedBytes: number;
}

/** Portable, unsigned KEEL publication preparation for web servers and browsers.
 * Reuses the canonical SDK chunk planner. It performs no signing or uploads.
 * A host supplies its selected-chain read function and its Keccak implementation.
 * Existing chunks are reused only after exact byte read-back. A failed read is
 * propagated, never treated as permission to pay for a redundant upload.
 */
export async function createKeelNativeObjectPlan(bytes: Uint8Array, options: {
  readonly objectName: string;
  readonly mediaType: string;
  readonly maxChunkBytes?: number;
  readonly maxBatchSlugs?: number;
  readonly keccak256: (bytes: Uint8Array) => Hex | Promise<Hex>;
  readonly readSlug?: (slugId: Hex) => Promise<Uint8Array | null>;
}): Promise<KeelNativeObjectPlan> {
  if (!options.objectName.trim() || !options.mediaType.trim() || new TextEncoder().encode(options.mediaType).length > 128)
    throw new TypeError("A bounded media type and object name are required.");
  // Snapshot caller-owned memory before any asynchronous hashing/read work.
  const plan = await createKeelChunkPlan(bytes.slice(), options);
  const unique = new Map<Hex, Uint8Array>();
  for (const chunk of plan.chunks) {
    if (!chunk.slugId || !/^0x[0-9a-fA-F]{64}$/.test(chunk.slugId)) throw new TypeError("Invalid KEEL slug digest.");
    const key = chunk.slugId.toLowerCase() as Hex;
    const prior = unique.get(key);
    if (prior && (prior.length !== chunk.bytes.length || prior.some((byte, i) => byte !== chunk.bytes[i])))
      throw new Error("Conflicting KEEL chunk digest.");
    unique.set(key, chunk.bytes);
  }
  const missing = new Map<Hex, Uint8Array>();
  // Bounded concurrency, including when this API is installed in a web server.
  const entries = [...unique];
  for (let start = 0; start < entries.length; start += 8) {
    await Promise.all(entries.slice(start, start + 8).map(async ([id, raw]) => {
      const existing = options.readSlug ? await options.readSlug(id) : null;
      if (existing === null) { missing.set(id, raw); return; }
      if (existing.length !== raw.length || existing.some((byte, i) => byte !== raw[i]))
        throw new Error("KEEL stored chunk differs from its source bytes.");
    }));
  }
  // Keep deterministic order even when RPC reads finish out of order.
  const chunks = entries.filter(([id]) => missing.has(id)).map(([, raw]) => raw);
  const batchLimit = options.maxBatchSlugs ?? 3;
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > 0xffff_ffff) throw new RangeError("Invalid Hold batch limit.");
  const carrierBatches: Uint8Array[][] = [];
  for (let i = 0; i < chunks.length; i += batchLimit) carrierBatches.push(chunks.slice(i, i + batchLimit));
  const storedBytes = chunks.reduce((total, raw) => total + raw.length, 0);
  return {
    protocol: "keel-native-object-publication@1", storageMode: "keel-hold", compression: 0,
    digest: plan.integrity.digest, byteLength: plan.byteLength, mediaType: plan.mediaType,
    slugIds: plan.chunks.map(chunk => chunk.slugId!.toLowerCase() as Hex), chunks, carrierBatches,
    storedBytes, reusedBytes: plan.byteLength - storedBytes,
  };
}
