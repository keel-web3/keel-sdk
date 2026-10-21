import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonicalJson } from "@keel/protocol";
import { assertKeelInlineImageBytes } from "./collector-policy.js";
import { validateKeelPreparedContext } from "./prepared-context.js";

type Hash = `0x${string}`;
type Commitment = { readonly algorithm: "sha256"; readonly digest: Hash; readonly byteLength: number };
/** Off-chain evidence of the existing registered reader, not a new chain
 * protocol or a substitute for selected-chain authentication. */
export interface KeelRegisteredNativeGzipBinding {
  readonly profile: "keel.canonical-native-gzip@1";
  readonly chainId: number;
  readonly store: Hash;
  readonly registry: Hash;
  readonly reader: Hash;
  readonly readerRuntimeCodeHash: Hash;
  readonly readerDeploymentTransactionHash: Hash;
  readonly revision: number;
  readonly metadataObjectId: Hash;
  readonly metadataIntegrity: Commitment;
  readonly registeredPrefixObjectId: Hash;
  readonly registeredSuffixObjectId: Hash;
  readonly prefixObjectId: Hash;
  readonly suffixObjectId: Hash;
}
export interface KeelRegisteredNativeGzipProof {
  readonly schema: "keel-registered-native-gzip-proof@1";
  readonly binding: KeelRegisteredNativeGzipBinding;
  readonly bindingDigest: Hash;
  readonly documentIntegrity: Commitment;
  readonly members: readonly { readonly id: string; readonly mediaType: string; readonly integrity: Commitment; readonly storedIntegrity: Commitment }[];
}
const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const HASH = /^0x[0-9a-f]{64}$/u;
const sha = (bytes: Uint8Array): Hash => `0x${createHash("sha256").update(bytes).digest("hex")}`;
const integrity = (bytes: Uint8Array): Commitment => ({ algorithm: "sha256", digest: sha(bytes), byteLength: bytes.length });
// Exact public revision-5 frames, metadata and COPY runtime, independently
// recorded in the incident. Unknown readers remain on the ordinary guard.
export const KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE = Object.freeze({
  chainId: 11155111, revision: 5,
  store: "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267",
  registry: "0x63a172ae55a6c7413a2f80be9de9cd9cb106973d",
  reader: "0xfbbb2a0c470ac0e81ed35de6722e26ca8ff8134d",
  readerRuntimeCodeHash: "0x4b38e44025978596b6940908c5494c2358125b832e3086b54291bca626b35c2c",
  readerDeploymentTransactionHash: "0x66ee037713d4878d90a1b551c58b53e62dad8a8ada51edc2ec27ee4c65af4cf2",
  registeredPrefixObjectId: "0xbbf6276ebdae7e2ae63fd717b7a11d926efba10ba781e1235fe3c169a612cdfd",
  registeredSuffixObjectId: "0x45fec4ee001146ca2a2fe93ffbe4692abcd13f316c8a8ef5fb28b3092322c0b5",
  prefixObjectId: "0xe9a47cc4f074a03ac1ba6ad69804f051db5c54fac0c5afba6a31d6c81689377c",
  suffixObjectId: "0x2a8f3e49f6535a3d319f7ecafd075e0f780f16879af28fa8e3ee966ef051eda0",
  metadataObjectId: "0x6aee9cecc863b0282d10ea1f475a8e0d3fd6211ec4ce53dfddcfddf1a493fd52",
  metadataDigest: "0x02185406cc4bf392af5012384e397095584f2401575cd8bf28888d7468c10a90", metadataByteLength: 303,
  prefixDigest: "0xd9fb62d4b85337813dfd60cbd66a0d46601eccbff5f08d5ab566e816da429f31", prefixByteLength: 662,
  suffixDigest: "0x30b18de74a98d17e1043f8e38fb22852a38212ddf204cb9f5477b40a504711b7", suffixByteLength: 83826,
});
const profile = KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE;
function plain(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set)) throw new TypeError("Native Gzip requires plain exact recipe data.");
}
function commitment(value: unknown): asserts value is Commitment {
  plain(value);
  if (Object.keys(value).sort().join() !== "algorithm,byteLength,digest" || value.algorithm !== "sha256" || typeof value.digest !== "string" || !HASH.test(value.digest)
    || !Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 1 || Number(value.byteLength) > 32 * 1024 * 1024) throw new TypeError("Invalid native Gzip commitment.");
}
export function snapshotKeelRegisteredNativeGzipBinding(input: KeelRegisteredNativeGzipBinding) {
  plain(input); commitment(input.metadataIntegrity);
  const expectedKeys = ["profile", "chainId", "store", "registry", "reader", "readerRuntimeCodeHash", "readerDeploymentTransactionHash", "revision",
    "metadataObjectId", "metadataIntegrity", "registeredPrefixObjectId", "registeredSuffixObjectId", "prefixObjectId", "suffixObjectId"].sort().join();
  if (Object.keys(input).sort().join() !== expectedKeys || input.profile !== "keel.canonical-native-gzip@1"
    || input.chainId !== profile.chainId || input.revision !== profile.revision
    || input.store.toLowerCase() !== profile.store || input.registry.toLowerCase() !== profile.registry || input.reader.toLowerCase() !== profile.reader
    || input.readerRuntimeCodeHash !== profile.readerRuntimeCodeHash || input.metadataObjectId !== profile.metadataObjectId
    || input.metadataIntegrity.digest !== profile.metadataDigest || input.metadataIntegrity.byteLength !== profile.metadataByteLength
    || (["readerDeploymentTransactionHash", "registeredPrefixObjectId", "registeredSuffixObjectId", "prefixObjectId", "suffixObjectId"] as const).some(key => input[key] !== profile[key])) {
    throw new TypeError("The native Gzip recipe does not match the exact maintained selected-chain registered reader.");
  }
  return JSON.parse(canonicalJson(input)) as KeelRegisteredNativeGzipBinding;
}
function contextTail(json: string) {
  const bytes = enc.encode(json), digest = sha(bytes), v = Buffer.from(bytes).toString("base64url");
  return `<script>(()=>{try{const v="${v}",b=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4),j=atob(b),c=Object.freeze(JSON.parse(j)),o=Object.freeze({json:j,digest:"${digest}",byteLength:${bytes.length}});Object.defineProperty(globalThis,"__KEEL_CONTEXT__",{value:c,enumerable:true,writable:false,configurable:false});Object.defineProperty(globalThis,"__KEEL_ONCHAIN_CONTEXT__",{value:o,enumerable:true,writable:false,configurable:false})}catch(e){document.documentElement.dataset.keelContext="failed";throw e}})()</script>`;
}
function inspectDocument(bytes: Uint8Array, binding: KeelRegisteredNativeGzipBinding) {
  if (!(bytes instanceof Uint8Array) || bytes.length < profile.prefixByteLength + profile.suffixByteLength || bytes.length > 2_000_000) throw new RangeError("Native Gzip document exceeds the current exact reader inspection bound.");
  const prefix = bytes.subarray(0, profile.prefixByteLength), suffix = bytes.subarray(-profile.suffixByteLength);
  if (sha(prefix) !== profile.prefixDigest || sha(suffix) !== profile.suffixDigest) throw new TypeError("Native Gzip requires the exact authenticated canonical reader frames.");
  const body = dec.decode(bytes.subarray(prefix.length, bytes.length - suffix.length));
  if (!body.startsWith(",") || /<\/?script|<!--|[\u2028\u2029]/iu.test(body)) throw new TypeError("Native Gzip cannot admit code outside its exact descriptor array.");
  const items: unknown = JSON.parse("[null" + body + "]");
  if (!Array.isArray(items) || items.length < 2 || items.length > 129) throw new RangeError("Native Gzip resource count exceeds its existing bounded reader.");
  let total = 0; const ids = new Set<string>(), members = [];
  for (const item of items.slice(1)) {
    plain(item); commitment(item.integrity); plain(item.embedded);
    if (Object.keys(item).some(key => !["id", "role", "mediaType", "aliases", "integrity", "embedded", "backgroundColor"].includes(key))
      || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.mediaType !== "string" || !item.mediaType) throw new TypeError("Invalid native Gzip source descriptor.");
    ids.add(item.id); total += item.integrity.byteLength;
    if (total > 32 * 1024 * 1024) throw new RangeError("Native Gzip decoded graph exceeds its actual reader bound.");
    const embedded = item.embedded;
    if (embedded.compression === "none") {
      const fields = Object.keys(embedded).sort().join();
      let source: Uint8Array;
      if (fields === "compression,storedIntegrity,storedText" && typeof embedded.storedText === "string") source = enc.encode(embedded.storedText);
      else if (fields === "compression,storedBase64,storedIntegrity" && typeof embedded.storedBase64 === "string"
        && ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(item.mediaType)) {
        source = Buffer.from(embedded.storedBase64, "base64");
        if (Buffer.from(source).toString("base64") !== embedded.storedBase64) throw new TypeError("Invalid exact image carriage.");
        assertKeelInlineImageBytes(source, item.mediaType);
      } else throw new TypeError("Native Gzip cannot admit another encoded None body.");
      commitment(embedded.storedIntegrity);
      if (canonicalJson(integrity(source)) !== canonicalJson(item.integrity) || canonicalJson(item.integrity) !== canonicalJson(embedded.storedIntegrity)) throw new TypeError("Native Gzip sibling source integrity mismatch.");
      continue;
    }
    if (Object.keys(embedded).sort().join() !== "compression,storedBase64,storedIntegrity" || embedded.compression !== "gzip"
      || typeof embedded.storedBase64 !== "string") throw new TypeError("This registered allowance supports only exact per-resource native Gzip, never Brotli or another encoding.");
    commitment(embedded.storedIntegrity);
    if (embedded.storedIntegrity.byteLength > 4 * 1024 * 1024 || embedded.storedBase64.length > 4 * Math.ceil(embedded.storedIntegrity.byteLength / 3)) throw new RangeError("Native Gzip compressed source exceeds its bound.");
    const stored = Buffer.from(embedded.storedBase64, "base64");
    if (stored.toString("base64") !== embedded.storedBase64 || stored.length !== embedded.storedIntegrity.byteLength || sha(stored) !== embedded.storedIntegrity.digest) throw new TypeError("Native Gzip stored source integrity mismatch.");
    const decoded = gunzipSync(stored, { maxOutputLength: item.integrity.byteLength });
    if (decoded.length !== item.integrity.byteLength || sha(decoded) !== item.integrity.digest) throw new TypeError("Native Gzip decoded source integrity mismatch.");
    members.push({ id: item.id, mediaType: item.mediaType, integrity: { ...item.integrity }, storedIntegrity: { ...embedded.storedIntegrity } });
  }
  if (!members.length) throw new TypeError("No exact native Gzip member was prepared.");
  void binding;
  return members;
}
export function createKeelRegisteredNativeGzipProof(input: { readonly binding: KeelRegisteredNativeGzipBinding; readonly documentBytes: Uint8Array }) {
  const binding = snapshotKeelRegisteredNativeGzipBinding(input.binding), document = Uint8Array.from(input.documentBytes);
  return Object.freeze({ schema: "keel-registered-native-gzip-proof@1" as const, binding,
    bindingDigest: sha(enc.encode(canonicalJson(binding))), documentIntegrity: integrity(document), members: inspectDocument(document, binding) });
}
/** Exact byte inspection only; the normal Site authenticator still verifies
 * current chain/registry/code/receipt/read-back before every eligible use. */
export function assertKeelRegisteredNativeGzipProof(input: KeelRegisteredNativeGzipProof, html?: Uint8Array): KeelRegisteredNativeGzipProof {
  plain(input); const binding = snapshotKeelRegisteredNativeGzipBinding(input.binding); commitment(input.documentIntegrity);
  if (Object.keys(input).sort().join() !== "binding,bindingDigest,documentIntegrity,members,schema" || input.schema !== "keel-registered-native-gzip-proof@1"
    || input.bindingDigest !== sha(enc.encode(canonicalJson(binding))) || !Array.isArray(input.members) || !input.members.length || input.members.length > 128) throw new TypeError("Invalid native Gzip evidence identity.");
  const ids = new Set<string>();
  for (const member of input.members) {
    plain(member); commitment(member.integrity); commitment(member.storedIntegrity);
    if (Object.keys(member).sort().join() !== "id,integrity,mediaType,storedIntegrity" || typeof member.id !== "string" || !member.id || ids.has(member.id)
      || typeof member.mediaType !== "string" || !member.mediaType || member.storedIntegrity.byteLength > 4 * 1024 * 1024) throw new TypeError("Invalid native Gzip evidence member.");
    ids.add(member.id);
  }
  if (html) {
    const root = html.subarray(0, input.documentIntegrity.byteLength);
    if (root.length !== input.documentIntegrity.byteLength || sha(root) !== input.documentIntegrity.digest
      || canonicalJson(inspectDocument(root, binding)) !== canonicalJson(input.members)) throw new TypeError("Native Gzip source, frame or member evidence changed.");
    const tail = dec.decode(html.subarray(root.length));
    if (tail) {
      const match = /^<script>\(\(\)=>\{try\{const v="([A-Za-z0-9_-]+)"/u.exec(tail);
      if (!match) throw new TypeError("Unrecognized native Gzip context tail.");
      const contextBytes = Buffer.from(match[1]!, "base64url"), json = dec.decode(contextBytes), context = JSON.parse(json); validateKeelPreparedContext(context, binding.chainId);
      if (Buffer.from(contextBytes).toString("base64url") !== match[1] || context.protocol !== "keel-context@1" || context.chainId !== String(binding.chainId)
        || tail !== contextTail(json)) throw new TypeError("The native Gzip context changed chain or contains extra code.");
    }
  }
  return JSON.parse(canonicalJson(input)) as KeelRegisteredNativeGzipProof;
}
