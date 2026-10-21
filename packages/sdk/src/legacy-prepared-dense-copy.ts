import { createKeelLegacySharedImageReader, KEEL_LEGACY_SHARED_IMAGE_PROFILE } from "./legacy-shared-image-reader.js";
import { createHash } from "node:crypto";
import { brotliCompressSync, brotliDecompressSync, constants, deflateSync, gzipSync } from "node:zlib";
import { canonicalJson, resolveKeelPayloadStorage, type KeelPayloadStorageMode } from "@keel/protocol";
import { buildKeelPreparedDenseCopyShell } from "./prepared-dense-copy.js";
import { encodeKeelDenseTransport, serializeKeelDenseTransportJSON } from "./dense-transport.js";
import { assertKeelInlineNoExternalDependencies, type KeelInlineLocalDocument, type KeelInlineDocumentPart, type KeelInlineModuleFragment } from "./inline-viewer-graph.js";
import { assertKeelFreshPayloadCarriage, inspectKeelPreparedDenseCopyDocument, readKeelInlineJSONArray } from "./inline-transport-audit.js";
import { KEEL_LEGACY_PREPARED_DENSE_PROFILE, createKeelLegacyPreparedDenseReader, keelLegacyPreparedDensePackIdentity,
  type KeelLegacyPreparedDensePack, type KeelLegacyPreparedDenseItem } from "./legacy-prepared-dense-reader.js";
import { decodeKeelDenseTransport } from "./dense-transport.js";
import { decodeBrotli } from "./decoders/index.js";
import { gunzipSync, inflateSync } from "node:zlib";
import { keccak256, stringToHex } from "viem";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (value: Uint8Array) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
const commitment = (value: Uint8Array) => Object.freeze({ algorithm: "sha256" as const, digest: `0x${createHash("sha256").update(value).digest("hex")}` as const, byteLength: value.length });
const concat = (parts: readonly Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));
/** Distinct registry identity: never replace the canonical follow-latest shell head. */
export const KEEL_LEGACY_PREPARED_DENSE_SHELL_ID = keccak256(stringToHex("keel.shell.legacy-prepared-dense-copy@1"));
export const KEEL_LEGACY_SHARED_IMAGE_SHELL_ID = keccak256(stringToHex("keel.shell.legacy-prepared-dense-shared-image@1"));
export const KEEL_LEGACY_PREPARED_LEAF_DECODED_BYTES = 512 * 1024;
export type KeelLegacyPreparedDenseResource = {
  readonly id: string; readonly aliases?: readonly string[]; readonly role: "entrypoint" | "module" | "asset" | "data";
  readonly mediaType: string; readonly bytes: Uint8Array; readonly backgroundColor?: string;
  readonly compression?: "auto" | "brotli" | "none" | "gzip" | "deflate";
  /** Existing exact per-resource compressed bytes; no repacking or second binary upload. */
  readonly storedBytes?: Uint8Array;
};
/** Compatible with the ordinary KEEL721 prepared envelope and public drop compiler.
 * This builds no collection, mint, registration, or authority-changing call. */
export async function buildKeelLegacyPreparedDenseDocument(input: {
  readonly chainId: number;
  readonly payloadStorage?: KeelPayloadStorageMode;
  readonly resources: readonly KeelLegacyPreparedDenseResource[];
  /** Existing exact module fragments remain separate reusable publication parts. */
  readonly modules?: readonly KeelInlineModuleFragment[];
  readonly entryId: string;
  readonly posterResourceId?: string;
  /** Explicit dual consumer: native image stored once, new compatible reader injects its return-only Base64 slot. */
  readonly sharedCollectorImageResourceId?: string;
  readonly compression?: "auto" | "brotli" | "none" | "gzip" | "deflate";
  readonly brotliQuality?: number;
  readonly shellBootCompression?: "gzip" | "none";
  readonly sourceLimits?: { readonly maximumResources: number; readonly maximumDecodedSourceBytes: number };
}) {
  throw new TypeError("buildKeelLegacyPreparedDenseDocument is retired for fresh publication. Use the registered canonical raw-percent resource pipeline.");
}

/** Local replay of the actual prepared body; selected-chain authentication remains separate. */
export async function readKeelLegacyPreparedDenseSources(input: { readonly htmlBytes: Uint8Array }) {
  const inspected = inspectKeelPreparedDenseCopyDocument(text(input.htmlBytes));
  if (!inspected || ![KEEL_LEGACY_PREPARED_DENSE_PROFILE, KEEL_LEGACY_SHARED_IMAGE_PROFILE].includes(inspected.legacyPreparedProfile!)) throw new TypeError("Expected the distinct legacy prepared dense profile.");
  const items = inspected.items.filter(value => value !== null) as unknown as readonly KeelLegacyPreparedDenseItem[];
  const reader = (inspected.legacyPreparedProfile === KEEL_LEGACY_SHARED_IMAGE_PROFILE ? createKeelLegacySharedImageReader : createKeelLegacyPreparedDenseReader)({ items, payloads: readKeelInlineJSONArray(inspected.html, "globalThis.__KEEL_EMBEDDED_CONTAINERS__=") as readonly KeelLegacyPreparedDensePack[],
    decodeTransport: (value, byteLength) => decodeKeelDenseTransport(value, { profile: "base90-v1", byteLength }),
    verify: async (value, expected, label) => { const actual = commitment(value); if (actual.byteLength !== expected.byteLength || actual.digest !== expected.digest) throw new TypeError(`${label} SHA-256 or length mismatch.`); return value; },
    decompress: async (codec, value, byteLength) => codec === "none" ? value : codec === "brotli" ? decodeBrotli(value, { decodedByteLength: byteLength })
      : Uint8Array.from(codec === "gzip" ? gunzipSync(value, { maxOutputLength: byteLength }) : inflateSync(value, { maxOutputLength: byteLength })) });
  const resources = [];
  for (const item of items) resources.push({ id: item.id, aliases: [...item.aliases], role: item.role, mediaType: item.mediaType, integrity: { ...item.integrity }, bytes: await reader.resolve(item) });
  return { protocol: "keel.legacy-prepared-dense-source-read@1" as const, resources, reader: reader.snapshot(), selectedChainBindingVerified: false as const, browserVerified: false as const };
}
