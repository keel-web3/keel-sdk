import { createHash } from "node:crypto";
import { decodeAbiParameters, encodeAbiParameters, hexToBytes, keccak256, stringToHex, type Hex } from "viem";
import type { KeelInlineRawPercentTokenURIGraph } from "./inline-viewer-graph.js";
export { KEEL_LEGACY_SHARED_IMAGE_PROFILE } from "./legacy-shared-image-reader.js";
export const KEEL_LEGACY_SHARED_IMAGE_PROGRAM_PROFILE = "keel.legacy-shared-image-copy-program@1" as const;
export const KEEL_LEGACY_SHARED_IMAGE_PROGRAM_MEDIA_TYPE = "application/vnd.keel.legacy-shared-image-copy-program" as const;
export const KEEL_LEGACY_SHARED_IMAGE_PROGRAM_TAG = keccak256(stringToHex(KEEL_LEGACY_SHARED_IMAGE_PROGRAM_PROFILE));
const parameters = [{type:"bytes32"},{type:"uint256"},{type:"bytes32"},{type:"bytes32"},{type:"bytes32"},{type:"uint256"},{type:"bytes32[]"},{type:"bytes32[]"},{type:"uint8[]"}] as const;
const hash = (value: Uint8Array): Hex => `0x${createHash("sha256").update(value).digest("hex")}`;
const valid = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) && !/^0x0{64}$/u.test(value);
export interface KeelLegacySharedCollectorImage {
  readonly resourceId: string; readonly mediaType: string; readonly bytes: Uint8Array;
  readonly integrity: { readonly algorithm: "sha256"; readonly digest: Hex; readonly byteLength: number };
  /** This graph part is produced by the native-image reader and MUST NOT be uploaded. */
  readonly documentPartIndex: number;
}
/** Bind predicted/existing exact Hold IDs after normal storage planning. Null is required
 * at the return-only image slot; this prevents accidentally paying for its encoded copy. */
export function encodeKeelLegacySharedImageCopyProgram(input: {
  readonly graph: KeelInlineRawPercentTokenURIGraph;
  readonly sharedCollectorImage: KeelLegacySharedCollectorImage;
  readonly imageObjectId: Hex;
  readonly fragments: readonly ({ readonly objectId: Hex; readonly digest: Hex } | null)[];
}) {
  throw new TypeError("encodeKeelLegacySharedImageCopyProgram is retired for fresh publication. Use the registered canonical raw-percent resource pipeline.");
}
/** Local exact replay, not selected-chain registration or contract execution proof. */
export async function readKeelLegacySharedImageCopyProgram(input: { readonly bytes: Uint8Array;
  readonly readObject: (objectId: Hex) => Promise<Uint8Array> }) {
  const [tag, length, digest, imageId, imageDigest, imageLength, ids, digests, modes] = decodeAbiParameters(parameters, `0x${Buffer.from(input.bytes).toString("hex")}`);
  const canonical = hexToBytes(encodeAbiParameters(parameters, [tag, length, digest, imageId, imageDigest, imageLength, ids, digests, modes]));
  if (!Buffer.from(canonical).equals(Buffer.from(input.bytes))) throw new TypeError("Noncanonical shared image program ABI.");
  if (tag !== KEEL_LEGACY_SHARED_IMAGE_PROGRAM_TAG || length < 1n || length > 2_000_000n || imageLength < 1n || imageLength > 2_000_000n
      || !valid(imageId) || !valid(imageDigest) || !valid(digest) || !ids.length || ids.length > 128 || ids.length !== digests.length || ids.length !== modes.length
      || modes.filter(mode => mode === 1).length !== 1 || modes.some(mode => mode !== 0 && mode !== 1)) throw new TypeError("Unsupported or malformed shared image program.");
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < ids.length; index++) {
    const value = Uint8Array.from(await input.readObject(ids[index]!));
    const renderedLength = modes[index] === 1 ? 4 * Math.ceil(value.length / 3) : value.length;
    if (renderedLength > Number(length) - total) throw new TypeError("Shared image program exceeds its committed render length.");
    total += renderedLength;
    if (hash(value) !== digests[index]) throw new TypeError("Shared image program object SHA-256 mismatch.");
    if (modes[index] === 1) {
      if (ids[index] !== imageId || digests[index] !== imageDigest || BigInt(value.length) !== imageLength) throw new TypeError("Unknown shared image binding.");
      parts.push(new TextEncoder().encode(Buffer.from(value).toString("base64")));
    } else parts.push(value);
  }
  const bytes = Uint8Array.from(Buffer.concat(parts));
  if (BigInt(bytes.length) !== length || hash(bytes) !== digest) throw new TypeError("Shared image program rendered SHA-256 or length mismatch.");
  return { bytes, imageObjectId: imageId, imageDigest, selectedChainBindingVerified: false as const };
}
