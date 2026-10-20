import { createIntegrity, parseKeelExternalPreviewUri } from "@keel/protocol";
import { assertKeelInlineImageBytes } from "./collector-policy.js";

type SourceIntegrity = { readonly algorithm: "sha256"; readonly digest: `0x${string}`; readonly byteLength: number };
/** Explicit creator choice and source commitment only. This is not a network
 * receipt, a public-availability claim or permission to externalize animation. */
export interface KeelExplicitExternalPreview {
  readonly schema: "keel-explicit-external-preview@1";
  readonly uri: string;
  readonly mediaType: string;
  readonly sourceIntegrity: SourceIntegrity;
}
const MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/svg+xml"]);
function plain(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set || !field.enumerable)) {
    throw new TypeError("External preview requires exact plain commitment data.");
  }
}
/** Snapshot before any asynchronous work. URL normalization must not silently
 * change the exact string that the creator selected and the contract copies. */
export function snapshotKeelExplicitExternalPreview(value: KeelExplicitExternalPreview): KeelExplicitExternalPreview {
  plain(value, ["schema", "uri", "mediaType", "sourceIntegrity"]);
  plain(value.sourceIntegrity, ["algorithm", "digest", "byteLength"]);
  if (value.schema !== "keel-explicit-external-preview@1" || typeof value.uri !== "string"
      || /%(?![0-9a-f]{2})/iu.test(value.uri) || typeof value.mediaType !== "string" || !MIMES.has(value.mediaType)
      || value.sourceIntegrity.algorithm !== "sha256" || typeof value.sourceIntegrity.digest !== "string"
      || !/^0x[0-9a-f]{64}$/u.test(value.sourceIntegrity.digest) || !Number.isSafeInteger(value.sourceIntegrity.byteLength)
      || value.sourceIntegrity.byteLength < 1) throw new TypeError("Invalid exact external preview URI, image MIME or original source commitment.");
  parseKeelExternalPreviewUri(value.uri); // Validate existing public-URL policy; retain the exact URI.
  return Object.freeze({ schema: "keel-explicit-external-preview@1", uri: value.uri, mediaType: value.mediaType,
    sourceIntegrity: Object.freeze({ algorithm: "sha256", digest: value.sourceIntegrity.digest, byteLength: value.sourceIntegrity.byteLength }) });
}
/** Validate original bytes locally. Studio separately authenticates the actual
 * remote response against the same saved commitment. No fetch occurs here. */
export async function prepareKeelExplicitExternalPreview(input: {
  readonly uri: string; readonly mediaType: string; readonly sourceBytes: Uint8Array; readonly expectedSourceIntegrity: SourceIntegrity;
}): Promise<KeelExplicitExternalPreview> {
  plain(input, ["uri", "mediaType", "sourceBytes", "expectedSourceIntegrity"]);
  const proof = snapshotKeelExplicitExternalPreview({ schema: "keel-explicit-external-preview@1", uri: input.uri,
    mediaType: input.mediaType, sourceIntegrity: input.expectedSourceIntegrity });
  if (!(input.sourceBytes instanceof Uint8Array)) throw new TypeError("External preview needs the actual original image bytes.");
  const bytes = Uint8Array.from(input.sourceBytes);
  assertKeelInlineImageBytes(bytes, proof.mediaType, "External preview");
  const actual = await createIntegrity(bytes);
  if (actual.digest !== proof.sourceIntegrity.digest || actual.byteLength !== proof.sourceIntegrity.byteLength)
    throw new TypeError("The external preview source differs from its saved original image commitment.");
  return proof;
}
export function assertKeelExternalPreviewImageURI(uri: unknown, proof: KeelExplicitExternalPreview): KeelExplicitExternalPreview {
  const snapshot = snapshotKeelExplicitExternalPreview(proof);
  if (uri !== snapshot.uri) throw new TypeError("The metadata image differs from the exact explicitly selected external preview URI.");
  return snapshot;
}
