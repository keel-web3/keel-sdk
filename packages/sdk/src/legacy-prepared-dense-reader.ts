import type { KeelStandaloneViewerItem } from "./verification-shell.js";

export const KEEL_LEGACY_PREPARED_DENSE_PROFILE = "keel.legacy-prepared-dense-copy@1" as const;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;
const HASH = /^0x[0-9a-f]{64}$/u;
type Commitment = { readonly algorithm: "sha256"; readonly digest: `0x${string}`; readonly byteLength: number };
export type KeelLegacyPreparedDensePack = {
  readonly id: `0x${string}`;
  readonly compression: "none" | "brotli" | "gzip" | "deflate";
  readonly storedIntegrity: Commitment;
  readonly integrity: Commitment;
  readonly storedDense: string;
};
export type KeelLegacyPreparedDenseItem = KeelStandaloneViewerItem & {
  readonly preparedCopy: { readonly segments: readonly { readonly packId: `0x${string}` }[] };
};
function plain(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
      || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => field.get || field.set)) throw new TypeError(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function integrity(value: unknown, maximum: number): Commitment {
  const entry = plain(value, ["algorithm", "digest", "byteLength"], "legacy COPY commitment");
  if (entry.algorithm !== "sha256" || typeof entry.digest !== "string" || !HASH.test(entry.digest)
      || !Number.isSafeInteger(entry.byteLength) || (entry.byteLength as number) < 1 || (entry.byteLength as number) > maximum) throw new TypeError("Invalid legacy COPY commitment.");
  return Object.freeze({ algorithm: "sha256", digest: entry.digest as `0x${string}`, byteLength: entry.byteLength as number });
}
/** Read-only diagnostic alias; current publication imports prepared-context directly. */
export { validateKeelPreparedContext as validateKeelLegacyPreparedContext } from "./prepared-context.js";
/** Canonical content identity deliberately names a prepared payload, not a chain object. */
export function keelLegacyPreparedDensePackIdentity(pack: Omit<KeelLegacyPreparedDensePack, "id" | "storedDense">): Uint8Array {
  const commitment = (value: Commitment) => ({ algorithm: value.algorithm, byteLength: value.byteLength, digest: value.digest });
  return new TextEncoder().encode(JSON.stringify({ protocol: KEEL_LEGACY_PREPARED_DENSE_PROFILE,
    compression: pack.compression, integrity: commitment(pack.integrity), storedIntegrity: commitment(pack.storedIntegrity) }));
}
/** All caller-controlled data is snapshotted synchronously, before any async verifier runs. */
export function createKeelLegacyPreparedDenseReader(input: {
  readonly transportProfile?: "base90-v1";
  readonly items: readonly KeelStandaloneViewerItem[];
  readonly payloads: readonly KeelLegacyPreparedDensePack[];
  readonly decodeTransport: (text: string, byteLength: number) => Uint8Array;
  readonly verify: (bytes: Uint8Array, integrity: Commitment, label: string) => Promise<Uint8Array>;
  readonly decompress: (codec: string, bytes: Uint8Array, decodedByteLength: number) => Promise<Uint8Array>;
}) {
  if (input.transportProfile !== undefined && input.transportProfile !== "base90-v1") throw new TypeError("Wrong legacy COPY transport profile.");
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 2048
      || !Array.isArray(input.payloads) || !input.payloads.length || input.payloads.length > 2048) throw new RangeError("Legacy COPY resource/segment count exceeds its supported boundary.");
  const verify = input.verify, decompress = input.decompress, decodeTransport = input.decodeTransport;
  const packs = new Map<string, KeelLegacyPreparedDensePack>();
  let storedTotal = 0, textTotal = 0;
  for (const value of input.payloads) {
    const pack = plain(value, ["id", "compression", "storedIntegrity", "integrity", "storedDense"], "legacy COPY pack");
    if (typeof pack.id !== "string" || !HASH.test(pack.id) || packs.has(pack.id) || !["none", "brotli", "gzip", "deflate"].includes(String(pack.compression))
        || typeof pack.storedDense !== "string" || !pack.storedDense.length) throw new TypeError("Invalid or duplicate legacy COPY pack.");
    const storedIntegrity = integrity(pack.storedIntegrity, 4 * 1024 * 1024);
    storedTotal += storedIntegrity.byteLength; textTotal += pack.storedDense.length;
    if (storedTotal > 2_000_000 || textTotal > 2_000_000) throw new RangeError("Legacy COPY payloads alone exceed the complete Inline return boundary.");
    if (pack.storedDense.length > 2 * Math.ceil(storedIntegrity.byteLength * 8 / 12) + 2) throw new RangeError("Legacy dense pack exceeds its exact transport bound.");
    packs.set(pack.id, Object.freeze({ id: pack.id as `0x${string}`, compression: pack.compression as KeelLegacyPreparedDensePack["compression"],
      storedIntegrity, integrity: integrity(pack.integrity, MAX_SEGMENT_BYTES), storedDense: pack.storedDense }));
  }
  const members = new Map<string, { exact: string; integrity: Commitment; segments: readonly string[]; storedText?: string; storedIntegrity?: Commitment }>();
  const names = new Map<string, string>();
  const usedPacks = new Set<string>();
  let sourceBytes = 0;
  // Descriptor groups bound each internal table without limiting the complete graph to 128 members.
  const groups: Array<readonly string[]> = [];
  for (let offset = 0; offset < input.items.length; offset += 128) {
    const group: string[] = [];
    for (const item of input.items.slice(offset, offset + 128)) {
      const embeddedText = Object.hasOwn(item, "embedded");
      const keys = ["id", "aliases", "role", "mediaType", "integrity", embeddedText ? "embedded" : "preparedCopy", ...(Object.hasOwn(item, "backgroundColor") ? ["backgroundColor"] : [])];
      const member = plain(item, keys, "legacy COPY descriptor");
      if (typeof member.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/@-]{0,159}$/u.test(member.id) || members.has(member.id)
          || !["entrypoint", "module", "asset", "data"].includes(String(member.role)) || typeof member.mediaType !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(member.mediaType)
          || !Array.isArray(member.aliases) || member.aliases.length > 128 || member.aliases.some(alias => typeof alias !== "string" || !alias.length || alias.length > 512 || /[\u0000-\u001f\u007f]/u.test(alias))) throw new TypeError("Invalid legacy COPY descriptor values.");
      if (member.backgroundColor !== undefined && (typeof member.backgroundColor !== "string" || !/^#?[0-9a-f]{6}$/iu.test(member.backgroundColor))) throw new TypeError("Invalid legacy COPY background color.");
      for (const name of [member.id, ...member.aliases as string[]]) {
        if (names.has(name) && names.get(name) !== member.id) throw new TypeError("Ambiguous legacy COPY resource alias.");
        names.set(name, member.id);
      }
      const commitment = integrity(member.integrity, MAX_SOURCE_BYTES);
      sourceBytes += commitment.byteLength;
      if (sourceBytes > 2 * MAX_SOURCE_BYTES) throw new RangeError("Legacy COPY decoded graph and reusable modules exceed the supported byte bound.");
      if (embeddedText) {
        const source = plain(member.embedded, ["compression", "storedText", ...(Object.hasOwn(member.embedded as object, "storedIntegrity") ? ["storedIntegrity"] : [])], "legacy existing UTF-8 module");
        if (!["module", "data"].includes(String(member.role)) || source.compression !== "none" || typeof source.storedText !== "string" || !source.storedText.length
            || new TextEncoder().encode(source.storedText).length !== commitment.byteLength) throw new TypeError("Legacy COPY only accepts exact existing UTF-8 module slots.");
        members.set(member.id, Object.freeze({ exact: JSON.stringify(item), integrity: commitment, segments: Object.freeze([]), storedText: source.storedText,
          ...(source.storedIntegrity === undefined ? {} : { storedIntegrity: integrity(source.storedIntegrity, MAX_SOURCE_BYTES) }) }));
        group.push(member.id); continue;
      }
      const prepared = plain(member.preparedCopy, ["segments"], "legacy COPY segments");
      if (!Array.isArray(prepared.segments) || !prepared.segments.length || prepared.segments.length > 1024) throw new TypeError("Invalid legacy COPY segments.");
      const segments = prepared.segments.map(value => {
        const segment = plain(value, ["packId"], "legacy COPY segment");
        if (typeof segment.packId !== "string" || !packs.has(segment.packId)) throw new TypeError("Missing legacy COPY segment.");
        usedPacks.add(segment.packId); return segment.packId;
      });
      if (segments.reduce((sum, id) => sum + packs.get(id)!.integrity.byteLength, 0) !== commitment.byteLength) throw new TypeError("Legacy COPY segment lengths differ from the original resource.");
      members.set(member.id, Object.freeze({ exact: JSON.stringify(item), integrity: commitment, segments: Object.freeze(segments) }));
      group.push(member.id);
    }
    groups.push(Object.freeze(group));
  }
  if (usedPacks.size !== packs.size) throw new TypeError("Legacy COPY contains an unused payload copy.");
  const stored = new Map<string, Uint8Array>();
  let checked: Promise<void> | undefined;
  const check = () => checked ??= (async () => {
    for (const pack of packs.values()) {
      const identity = keelLegacyPreparedDensePackIdentity(pack);
      await verify(identity, { algorithm: "sha256", digest: pack.id, byteLength: identity.length }, "Legacy COPY payload identity");
      const bytes = Uint8Array.from(decodeTransport(pack.storedDense, pack.storedIntegrity.byteLength));
      await verify(bytes, pack.storedIntegrity, "Legacy COPY compressed bytes");
      stored.set(pack.id, bytes);
    }
  })();
  const decoded = new Map<string, Promise<Uint8Array>>();
  let decodeCount = 0;
  async function resolve(item: KeelStandaloneViewerItem) {
    const member = members.get(item.id);
    if (!member || JSON.stringify(item) !== member.exact) throw new TypeError("Legacy COPY descriptor changed after snapshot.");
    await check();
    if (member.storedText !== undefined) {
      const output = new TextEncoder().encode(member.storedText);
      if (member.storedIntegrity) await verify(output, member.storedIntegrity, "Existing UTF-8 module stored bytes");
      await verify(output, member.integrity, item.id); return output;
    }
    const output = new Uint8Array(member.integrity.byteLength);
    let offset = 0;
    for (const id of member.segments) {
      let pending = decoded.get(id);
      if (!pending) {
        const pack = packs.get(id)!;
        pending = (async () => {
          decodeCount++;
          const bytes = Uint8Array.from(await decompress(pack.compression, Uint8Array.from(stored.get(id)!), pack.integrity.byteLength));
          await verify(bytes, pack.integrity, "Legacy COPY decoded segment"); return bytes;
        })();
        decoded.set(id, pending);
      }
      const bytes = await pending; output.set(bytes, offset); offset += bytes.length;
    }
    await verify(output, member.integrity, item.id); return output;
  }
  return Object.freeze({ resolve, snapshot: () => Object.freeze({ members: members.size, physicalPayloads: packs.size, descriptorGroups: groups.map(group => group.length), sourceBytes, decodeCount }) });
}
