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
  const graph = input.graph, image = input.sharedCollectorImage, at = image.documentPartIndex;
  if (graph.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment" || !valid(input.imageObjectId)
      || !Number.isSafeInteger(at) || at < 0 || at >= graph.parts.length || graph.parts.length > 128 || input.fragments.length !== graph.parts.length
      || input.fragments[at] !== null || !["image/png","image/jpeg","image/gif","image/webp","image/avif"].includes(image.mediaType)
      || image.bytes.length < 1 || image.bytes.length > 2_000_000 || image.integrity.byteLength !== image.bytes.length || hash(image.bytes) !== image.integrity.digest
      || Buffer.from(graph.parts[at]!.bytes).toString("utf8") !== Buffer.from(image.bytes).toString("base64")) throw new TypeError("Invalid exact shared native-image program binding.");
  let renderedLength = 0;
  for (const part of graph.parts) {
    if (!(part.bytes instanceof Uint8Array) || part.bytes.length > 2_000_000 - renderedLength) throw new TypeError("Prepared graph exceeds the complete Inline bound.");
    renderedLength += part.bytes.length;
  }
  const rendered = Uint8Array.from(Buffer.concat(graph.parts.map(part => part.bytes)));
  if (renderedLength !== graph.fragmentBytes.length || graph.fragmentIntegrity.algorithm !== "sha256"
      || graph.fragmentIntegrity.byteLength !== renderedLength || !valid(graph.fragmentIntegrity.digest)
      || hash(rendered) !== graph.fragmentIntegrity.digest || !Buffer.from(rendered).equals(Buffer.from(graph.fragmentBytes))) throw new TypeError("Prepared graph rendered commitment differs from its exact parts.");
  const ids: Hex[] = [], digests: Hex[] = [], modes: number[] = [];
  for (let index = 0; index < graph.parts.length; index++) {
    if (index === at) { ids.push(input.imageObjectId); digests.push(image.integrity.digest); modes.push(1); continue; }
    const binding = input.fragments[index], part = graph.parts[index]!;
    if (!binding || !valid(binding.objectId) || !valid(binding.digest) || hash(part.bytes) !== binding.digest) throw new TypeError("COPY fragment binding differs from its exact prepared bytes.");
    ids.push(binding.objectId); digests.push(binding.digest); modes.push(0);
  }
  const bytes = hexToBytes(encodeAbiParameters(parameters, [KEEL_LEGACY_SHARED_IMAGE_PROGRAM_TAG, BigInt(graph.fragmentBytes.length), graph.fragmentIntegrity.digest,
    input.imageObjectId, image.integrity.digest, BigInt(image.bytes.length), ids, digests, modes]));
  return { profile: KEEL_LEGACY_SHARED_IMAGE_PROGRAM_PROFILE, mediaType: KEEL_LEGACY_SHARED_IMAGE_PROGRAM_MEDIA_TYPE, bytes,
    integrity: { algorithm: "sha256" as const, digest: hash(bytes), byteLength: bytes.length }, imageObjectId: input.imageObjectId,
    imageIntegrity: { ...image.integrity }, renderedIntegrity: { ...graph.fragmentIntegrity }, imagePartIndex: at,
    requiredBuilder: "KeelLegacySharedImageTokenURIBuilder" as const, immutableLiteralImageEnvelopeSupported: false as const,
    storage: { nativeImagePayloadBytes: image.bytes.length, encodedImagePayloadBytes: 0 as const, returnedImageBase64Bytes: graph.parts[at]!.bytes.length },
    selectedChainBindingVerified: false as const, signing: "not-performed" as const, submission: "not-performed" as const };
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
