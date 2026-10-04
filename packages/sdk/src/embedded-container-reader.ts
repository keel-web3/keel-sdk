/** Canonical offline reader: all packed bytes are already in the tokenURI response. */
import type { KeelBinaryContainer, KeelBinaryIntegrity } from "./onchain-resource-reader.js";
import type { KeelStandaloneViewerItem } from "./verification-shell.js";

import type { KeelDenseTransportProfile } from "./dense-transport.js";
type KeelEmbeddedPayloadIdentity =
  | { readonly containerId: `0x${string}`; readonly objectId: `0x${string}` }
  | { readonly objectId: `0x${string}`; readonly containerId?: never };
export type KeelEmbeddedContainerPayload = KeelEmbeddedPayloadIdentity & { readonly storedIntegrity: KeelBinaryIntegrity } & (
  | { readonly storedBase64: string; readonly storedDense?: never }
  | { readonly storedDense: string; readonly storedBase64?: never }
);

const HASH = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const MAX_STORED = 4 * 1024 * 1024;
const MAX_TOTAL_STORED = 16 * 1024 * 1024;
const MAX_DECODED = 32 * 1024 * 1024;
const CODECS = ["none", "gzip", "deflate", "brotli", "lzma"];
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function record(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).some(key => !keys.includes(key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set)) throw new TypeError(`Invalid ${label}.`);
}
function integer(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new RangeError(`Invalid ${label}.`);
  return value as number;
}
function commitment(value: unknown, maximum: number): KeelBinaryIntegrity {
  record(value, ["algorithm", "digest", "byteLength"], "offline commitment");
  if (value.algorithm !== "sha256" || typeof value.digest !== "string" || !HASH.test(value.digest)) throw new TypeError("Offline resources require exact SHA-256 commitments.");
  const byteLength = integer(value.byteLength, maximum, "offline committed length");
  if (!byteLength) throw new RangeError("Empty offline commitment.");
  return Object.freeze({ algorithm: "sha256", digest: value.digest as `0x${string}`, byteLength });
}
function base64Length(value: unknown): number {
  if (typeof value !== "string" || !value.length || value.length > 4 * Math.ceil(MAX_STORED / 3)
      || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) throw new TypeError("Invalid or oversized offline Base64 payload.");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  if (padding && (alphabet.indexOf(value[value.length - padding - 1]!) & (padding === 2 ? 15 : 3))) throw new TypeError("Noncanonical offline Base64 pad bits.");
  const length = value.length / 4 * 3 - padding;
  if (!length || length > MAX_STORED) throw new RangeError("Offline packed payload exceeds its byte bound.");
  return length;
}
const canonicalCommitment = (value: KeelBinaryIntegrity) => ({ algorithm: value.algorithm, byteLength: value.byteLength, digest: value.digest });
const canonicalBinding = (value: Omit<KeelBinaryContainer, "id">) => new TextEncoder().encode(JSON.stringify({
  chainId: value.chainId, compression: value.compression, integrity: canonicalCommitment(value.integrity),
  objectId: value.objectId, store: value.store, storedIntegrity: canonicalCommitment(value.storedIntegrity),
}));

export function createKeelEmbeddedContainerReader(input: {
  /** Explicit dense profile; omitted keeps the existing Base64 wire schema. */
  readonly transportProfile?: KeelDenseTransportProfile;
  readonly decodeTransport?: (text: string, byteLength: number) => Uint8Array;
  readonly chainId: number;
  readonly store: string;
  readonly containers: readonly KeelBinaryContainer[];
  readonly payloads: readonly KeelEmbeddedContainerPayload[];
  /** SHA-256 of the exact ABI-encoded, revision-selected packtable artifact. */
  readonly tableDigest: `0x${string}`;
  readonly items: readonly KeelStandaloneViewerItem[];
  readonly verify: (bytes: Uint8Array, integrity: KeelBinaryIntegrity, label: string) => Promise<Uint8Array>;
  readonly decompress: (codec: string, bytes: Uint8Array, decodedByteLength: number) => Promise<Uint8Array>;
}) {
  const dense = input.transportProfile !== undefined;
  if (dense && !["base90-v1", "base91-v1", "base90-block-v2"].includes(input.transportProfile!)) throw new TypeError("Unsupported offline dense transport profile.");
  if (dense !== (typeof input.decodeTransport === "function")) throw new TypeError("Offline dense transport requires its matching decoder.");
  if (!integer(input.chainId, Number.MAX_SAFE_INTEGER, "offline chain ID") || !ADDRESS.test(input.store) || /^0x0{40}$/iu.test(input.store)) throw new TypeError("Invalid offline selected-chain binding.");
  if (!Array.isArray(input.containers) || !input.containers.length || input.containers.length > 128
      || !Array.isArray(input.payloads) || !input.payloads.length || input.payloads.length > 128
      || !Array.isArray(input.items) || !input.items.length || input.items.length > 128) throw new RangeError("Offline table/item count must be 1..128.");
  const declared = input.items.flatMap(item => item.containerBindings ?? []);
  if (JSON.stringify(declared) !== JSON.stringify(input.containers)) throw new TypeError("Offline binding table differs from the exact member descriptors.");
  const containers = new Map<string, KeelBinaryContainer>();
  const containerObjects = new Set<string>();
  for (const value of input.containers) {
    record(value, ["id", "chainId", "store", "objectId", "compression", "storedIntegrity", "integrity"], "offline container binding");
    if (typeof value.id !== "string" || !HASH.test(value.id) || containers.has(value.id)
        || value.chainId !== input.chainId || typeof value.store !== "string" || value.store.toLowerCase() !== input.store.toLowerCase()
        || typeof value.objectId !== "string" || !HASH.test(value.objectId) || containerObjects.has(value.objectId) || !CODECS.includes(value.compression as string)) throw new TypeError("Invalid or conflicting offline container binding.");
    containerObjects.add(value.objectId);
    containers.set(value.id, Object.freeze({ id: value.id, chainId: value.chainId, store: value.store, objectId: value.objectId,
      compression: value.compression, storedIntegrity: commitment(value.storedIntegrity, MAX_STORED), integrity: commitment(value.integrity, MAX_DECODED) }) as KeelBinaryContainer);
  }
  if (!HASH.test(input.tableDigest)) throw new TypeError("Invalid offline packtable commitment.");
  const payloads = new Map<string, { readonly text: string; readonly length: number; readonly integrity: KeelBinaryIntegrity; readonly objectId: string; readonly containerId?: string }>();
  const payloadObjects = new Set<string>();
  let storedTotal = 0;
  for (const value of input.payloads) {
    record(value, ["containerId", "objectId", "storedBase64", "storedDense", "storedIntegrity"], "offline packed payload");
    if (Object.hasOwn(value, "storedDense") !== dense || Object.hasOwn(value, "storedBase64") === dense) throw new TypeError("Offline payload encoding differs from its shell profile.");
    const shared = Object.hasOwn(value, "containerId");
    const id = shared ? value.containerId : value.objectId;
    if (typeof id !== "string" || !HASH.test(id) || /^0x0{64}$/u.test(id)
        || typeof value.objectId !== "string" || !HASH.test(value.objectId) || /^0x0{64}$/u.test(value.objectId) || payloadObjects.has(value.objectId)) throw new TypeError("Invalid or duplicate offline payload identity.");
    payloadObjects.add(value.objectId);
    const key = `${shared ? "container" : "object"}:${id}`;
    if (payloads.has(key)) throw new TypeError("Duplicate offline packed payload.");
    const integrity = commitment(value.storedIntegrity, MAX_STORED);
    const text = dense ? value.storedDense : value.storedBase64;
    if (dense && (typeof text !== "string" || !text.length || text.length > 2 * Math.ceil(integrity.byteLength * 8 / 12) + 2)) throw new RangeError("Invalid or oversized offline dense payload.");
    const length = dense ? integrity.byteLength : base64Length(text); storedTotal += length;
    if (storedTotal > MAX_TOTAL_STORED) throw new RangeError("Offline packed table exceeds its total byte bound.");
    if (integrity.byteLength !== length || (!shared && containerObjects.has(id))) throw new Error("Offline payload length or object identity conflicts with its commitment.");
    const known = shared ? containers.get(id) : undefined;
    if (known && (known.objectId !== value.objectId || JSON.stringify(canonicalCommitment(known.storedIntegrity)) !== JSON.stringify(canonicalCommitment(integrity)))) throw new Error("Offline table row conflicts with its declared container binding.");
    payloads.set(key, Object.freeze({ text: text as string, length, integrity, objectId: value.objectId as string, ...(shared ? { containerId: id } : {}) }));
  }
  const members = new Map<string, { readonly exact: string; readonly key: string; readonly offset: number; readonly binding: Omit<KeelBinaryContainer, "id">; readonly integrity: KeelBinaryIntegrity }>();
  const cacheBindings = new Map<string, string>();
  for (const item of input.items) {
    record(item, ["id", "role", "mediaType", "aliases", "integrity", "chainId", "store", "objectId", "onchain", "containerBindings", "backgroundColor"], "offline member descriptor");
    if (typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@-]{0,159}$/u.test(item.id) || members.has(item.id)
        || !["entrypoint", "module", "asset", "data"].includes(item.role as string)
        || typeof item.mediaType !== "string" || !item.mediaType.length || item.mediaType.length > 255
        || !Array.isArray(item.aliases) || item.aliases.length > 128 || item.aliases.some(alias => typeof alias !== "string" || !alias.length || alias.length > 512)) throw new TypeError("Invalid or duplicate offline member.");
    const member = commitment(item.integrity, MAX_DECODED);
    record(item.onchain, ["containerId", "offset", "storeKind", "compression", "storedIntegrity", "range"], "offline member source");
    let key: string, offset: number, binding: Omit<KeelBinaryContainer, "id">;
    if (Object.hasOwn(item.onchain, "containerId")) {
      if (Object.keys(item.onchain).some(field => !["containerId", "offset"].includes(field)) || item.chainId !== undefined || item.store !== undefined || item.objectId !== undefined
          || typeof item.onchain.containerId !== "string") throw new TypeError("Ambiguous offline shared-container member.");
      const found = containers.get(item.onchain.containerId);
      if (!found) throw new Error("Unknown offline container reference.");
      const payload = payloads.get(`container:${found.id}`);
      if (!payload || payload.objectId !== found.objectId || JSON.stringify(canonicalCommitment(payload.integrity)) !== JSON.stringify(canonicalCommitment(found.storedIntegrity))) throw new Error("Missing or mismatched referenced offline container payload.");
      key = `container:${found.id}`; offset = integer(item.onchain.offset, MAX_DECODED, "offline member offset"); binding = found;
    } else {
      if (Object.keys(item.onchain).some(field => !["storeKind", "compression", "storedIntegrity", "range"].includes(field))
          || item.chainId !== input.chainId || typeof item.store !== "string" || item.store.toLowerCase() !== input.store.toLowerCase()
          || typeof item.objectId !== "string" || !HASH.test(item.objectId) || item.onchain.storeKind !== "keel-hold" || !CODECS.includes(item.onchain.compression as string)) throw new TypeError("Invalid offline standalone object binding.");
      let full = member; offset = 0;
      if (item.onchain.range !== undefined) {
        record(item.onchain.range, ["offset", "containerIntegrity"], "offline standalone range");
        offset = integer(item.onchain.range.offset, MAX_DECODED, "offline standalone offset"); full = commitment(item.onchain.range.containerIntegrity, MAX_DECODED);
      }
      key = `object:${item.objectId}`;
      binding = Object.freeze({ chainId: item.chainId, store: item.store, objectId: item.objectId, compression: item.onchain.compression,
        storedIntegrity: commitment(item.onchain.storedIntegrity, MAX_STORED), integrity: full }) as Omit<KeelBinaryContainer, "id">;
      const payload = payloads.get(key);
      if (!payload || JSON.stringify(canonicalCommitment(payload.integrity)) !== JSON.stringify(canonicalCommitment(binding.storedIntegrity))) throw new Error("Missing or length-mismatched offline standalone payload.");
    }
    if (member.byteLength > binding.integrity.byteLength - offset) throw new RangeError("Offline member exceeds its committed container.");
    const exactBinding = new TextDecoder().decode(canonicalBinding(binding)), known = cacheBindings.get(key);
    if (known !== undefined && known !== exactBinding) throw new TypeError("Offline packed payload aliases conflicting commitments.");
    cacheBindings.set(key, exactBinding);
    members.set(item.id, Object.freeze({ exact: JSON.stringify(item), key, offset, binding, integrity: member }));
  }
  const storedBytes = new Map<string, Uint8Array>();
  let checkedTable: Promise<void> | undefined;
  const verifyTable = () => checkedTable ??= (async () => {
    // abi.encode(PackRow[]): dynamic offset, array length, then four words per row.
    const table = new Uint8Array(64 + payloads.size * 128);
    const word = (offset: number, value: bigint) => {
      for (let index = 31; index >= 0; index--) { table[offset + index] = Number(value & 255n); value >>= 8n; }
    };
    const hashWord = (offset: number, value: string) => {
      for (let index = 0; index < 32; index++) table[offset + index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
    };
    word(0, 32n); word(32, BigInt(payloads.size));
    let offset = 64;
    for (const payload of payloads.values()) {
      word(offset, BigInt(payload.length)); hashWord(offset + 32, payload.integrity.digest);
      hashWord(offset + 64, payload.objectId); hashWord(offset + 96, payload.containerId ?? `0x${"0".repeat(64)}`); offset += 128;
    }
    await input.verify(table, { algorithm: "sha256", digest: input.tableDigest, byteLength: table.length }, "Revision-selected offline packtable artifact");
    for (const container of containers.values()) {
      const bytes = canonicalBinding(container);
      await input.verify(bytes, { algorithm: "sha256", digest: container.id, byteLength: bytes.length }, "Immutable offline container binding ID");
    }
    // Superset table entries are allowed, but every supplied packed byte is
    // checked before any child executes. Unused decoded data stays lazy.
    for (const [key, payload] of payloads) {
      const stored = dense ? input.decodeTransport!(payload.text, payload.length)
        : Uint8Array.from(atob(payload.text), character => character.charCodeAt(0));
      await input.verify(stored, payload.integrity, "Offline supplied packed bytes");
      storedBytes.set(key, stored);
    }
  })();
  let decodedTotal = 0, decodeCount = 0;
  const cache = new Map<string, Promise<Uint8Array>>();
  async function resolve(item: KeelStandaloneViewerItem): Promise<Uint8Array> {
    const member = members.get(item.id);
    if (!member || JSON.stringify(item) !== member.exact) throw new Error("Offline member descriptor changed after the graph was frozen.");
    await verifyTable();
    let pending = cache.get(member.key);
    if (!pending) {
      decodedTotal += member.binding.integrity.byteLength;
      if (decodedTotal > MAX_DECODED || cache.size >= 128) throw new RangeError("Offline decoded graph exceeds its total work/output bound.");
      pending = (async () => {
        // Copies isolate the cache from decoder mutation and Buffer views.
        const stored = Uint8Array.from(storedBytes.get(member.key)!);
        decodeCount++;
        const decoded = Uint8Array.from(await input.decompress(member.binding.compression, stored, member.binding.integrity.byteLength));
        if (decoded.byteLength !== member.binding.integrity.byteLength) throw new Error("Offline decoded container length mismatch.");
        await input.verify(decoded, member.binding.integrity, "Offline decoded container");
        return decoded;
      })();
      // Immutable failures stay cached: repeated/concurrent requests cannot repeat expensive decode work.
      cache.set(member.key, pending);
    }
    const container = await pending;
    const bytes = Uint8Array.from(container.subarray(member.offset, member.offset + member.integrity.byteLength));
    await input.verify(bytes, member.integrity, item.id);
    return bytes;
  }
  return Object.freeze({ resolve, snapshot: () => Object.freeze({ storedBytes: storedTotal, payloads: payloads.size,
    committedContainers: containers.size, members: members.size, decodedContainerBytes: decodedTotal, decodeCount }) });
}
