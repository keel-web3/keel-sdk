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
  if (resolveKeelPayloadStorage(input.payloadStorage) !== "compact") throw new TypeError("Explicit Raw must use the existing exact raw-text/carriage route. It cannot be silently changed to Dense COPY.");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("Invalid legacy prepared chain.");
  const limits = { ...input.sourceLimits ?? { maximumResources: 256, maximumDecodedSourceBytes: 128 * 1024 * 1024 } };
  if (!Number.isSafeInteger(limits.maximumResources) || limits.maximumResources < 1 || limits.maximumResources > 1024
      || !Number.isSafeInteger(limits.maximumDecodedSourceBytes) || limits.maximumDecodedSourceBytes < 1 || limits.maximumDecodedSourceBytes > 512 * 1024 * 1024) throw new TypeError("Invalid host source limits.");
  if (!Array.isArray(input.resources) || !input.resources.length || input.resources.length > limits.maximumResources) throw new RangeError("Legacy prepared sources exceed the configured upload file limit.");
  // Capture every caller value before shell-building awaits.
  const chainId = input.chainId, entryId = input.entryId, posterResourceId = input.posterResourceId, sharedImageId = input.sharedCollectorImageResourceId;
  const compression = input.compression ?? "auto", quality = input.brotliQuality;
  const shellBootCompression = input.shellBootCompression;
  const resources = input.resources.map(resource => ({ ...resource, bytes: Uint8Array.from(resource.bytes), aliases: [...resource.aliases ?? [resource.id]],
    ...(resource.storedBytes === undefined ? {} : { storedBytes: Uint8Array.from(resource.storedBytes) }) }));
  const modules = (input.modules ?? []).map(module => ({ ...module, bytes: Uint8Array.from(module.bytes), item: JSON.parse(JSON.stringify(module.item)) as typeof module.item }));
  if (modules.some(module => module.item.embedded?.compression !== "none" || typeof module.item.embedded.storedText !== "string")) throw new TypeError("This legacy Dense adapter preserves exact registered UTF-8 module slots. Compressed/Base64 module reuse requires its receipt-aware existing-object reader; it cannot be silently re-encoded.");
  let sourceBytes = 0;
  for (const resource of resources) {
    if (!(resource.bytes instanceof Uint8Array) || !resource.bytes.length) throw new TypeError("Legacy prepared sources must be nonempty byte arrays.");
    sourceBytes += resource.bytes.length;
    if (sourceBytes > limits.maximumDecodedSourceBytes) throw new RangeError("Legacy prepared sources exceed the configured upload byte limit.");
    assertKeelInlineNoExternalDependencies(resource.bytes, `Legacy Inline resource ${resource.id}`);
  }
  if (resources.filter(resource => resource.role === "entrypoint").length !== 1 || resources.find(resource => resource.id === entryId)?.role !== "entrypoint"
      || resources.find(resource => resource.id === entryId)?.mediaType !== "text/html"
      || posterResourceId !== undefined && !resources.some(resource => resource.id === posterResourceId && resource.mediaType.startsWith("image/"))) throw new TypeError("Legacy prepared source entry/poster identity is invalid.");
  const sharedImage = sharedImageId === undefined ? undefined : resources.find(resource => resource.id === sharedImageId);
  if (sharedImageId !== undefined && (!sharedImage || sharedImage.role !== "asset" || !["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(sharedImage.mediaType)
      || sharedImage.bytes.length > 2_000_000 || sharedImage.storedBytes !== undefined || !["auto", "none"].includes(sharedImage.compression ?? compression))) throw new TypeError("Shared collector image requires one exact native supported raster within the complete Inline bound; explicit compressed streams require their compatible image reader.");
  const packs = new Map<string, KeelLegacyPreparedDensePack>();
  const descriptors: KeelLegacyPreparedDenseItem[] = [];
  const measurements: Array<{ id: string; compression: string; sourceBytes: number; segments: number }> = [];
  function prepareSegment(source: Uint8Array, requested: typeof compression): readonly KeelLegacyPreparedDensePack[] {
    try {
      let stored: Uint8Array, selected: KeelLegacyPreparedDensePack["compression"];
      if (requested === "gzip" || requested === "deflate") { stored = requested === "gzip" ? gzipSync(source, { level: 9 }) : deflateSync(source, { level: 9 }); selected = requested; }
      else {
        const compress = (codec: KeelLegacyPreparedDensePack["compression"]) => codec === "none" ? Uint8Array.from(source) : codec === "brotli"
          ? Uint8Array.from(brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: quality ?? 11, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC } }))
          : Uint8Array.from(codec === "gzip" ? gzipSync(source, { level: 9 }) : deflateSync(source, { level: 9 }));
        selected = requested === "auto" ? "none" : requested;
        stored = compress(selected);
        if (requested === "auto") for (const codec of ["brotli", "gzip", "deflate", "none"] as const) {
          const candidate = compress(codec);
          if (candidate.length < stored.length) { stored = candidate; selected = codec; }
        }
      }
      const pack = { compression: selected, integrity: commitment(source), storedIntegrity: commitment(stored), storedDense: encodeKeelDenseTransport(stored, "base90-v1") };
      const id = commitment(keelLegacyPreparedDensePackIdentity(pack)).digest;
      return [{ id, ...pack }];
    } catch (error) {
      // Split only to meet the encoder's existing per-carrier bound; exact resource identity and chosen codec survive.
      if (!(error instanceof RangeError) || !/stored-carrier|transport input/u.test(error.message) || source.length < 2) throw error;
      const split = Math.ceil(source.length / 2);
      return [...prepareSegment(source.subarray(0, split), requested), ...prepareSegment(source.subarray(split), requested)];
    }
  }
  for (const resource of resources) {
    if (resource.id === sharedImageId) {
      descriptors.push({ id: resource.id, aliases: resource.aliases, role: resource.role, mediaType: resource.mediaType, integrity: commitment(resource.bytes),
        embedded: { compression: "none", storedBase64: Buffer.from(resource.bytes).toString("base64") } } as unknown as KeelLegacyPreparedDenseItem);
      measurements.push({ id: resource.id, compression: "native-shared-image", sourceBytes: resource.bytes.length, segments: 0 }); continue;
    }
    const selected = resource.compression ?? compression;
    const segments: KeelLegacyPreparedDensePack[] = [];
    if (resource.storedBytes !== undefined) {
      if (selected === "auto") throw new TypeError("Exact stored bytes require their explicit original codec.");
      if (resource.bytes.length > 32 * 1024 * 1024) throw new TypeError("An existing compressed stream above the decoder segment boundary needs its original segmented descriptor; it cannot be silently repacked.");
      const decoded = selected === "none" ? resource.storedBytes : selected === "brotli" ? brotliDecompressSync(resource.storedBytes, { maxOutputLength: resource.bytes.length })
        : selected === "gzip" ? gunzipSync(resource.storedBytes, { maxOutputLength: resource.bytes.length }) : inflateSync(resource.storedBytes, { maxOutputLength: resource.bytes.length });
      if (!Buffer.from(decoded).equals(Buffer.from(resource.bytes))) throw new TypeError("Exact original compressed bytes differ from the decoded resource.");
      const pack = { compression: selected, integrity: commitment(resource.bytes), storedIntegrity: commitment(resource.storedBytes), storedDense: encodeKeelDenseTransport(resource.storedBytes, "base90-v1") };
      segments.push({ id: commitment(keelLegacyPreparedDensePackIdentity(pack)).digest, ...pack });
    } else for (let offset = 0; offset < resource.bytes.length; offset += KEEL_LEGACY_PREPARED_LEAF_DECODED_BYTES) segments.push(...prepareSegment(resource.bytes.subarray(offset, offset + KEEL_LEGACY_PREPARED_LEAF_DECODED_BYTES), selected));
    for (const pack of segments) packs.set(pack.id, pack);
    descriptors.push({ id: resource.id, aliases: resource.aliases, role: resource.role, mediaType: resource.mediaType, integrity: commitment(resource.bytes),
      preparedCopy: { segments: segments.map(pack => ({ packId: pack.id })) }, ...(resource.backgroundColor === undefined ? {} : { backgroundColor: resource.backgroundColor }) });
    measurements.push({ id: resource.id, compression: selected, sourceBytes: resource.bytes.length, segments: segments.length });
  }
  // Shared reader validation rejects conflicting IDs/aliases/codec commitments before generating a shell.
  const reader = (sharedImage ? createKeelLegacySharedImageReader : createKeelLegacyPreparedDenseReader)({ items: [...modules.map(module => module.item), ...descriptors], payloads: [...packs.values()], decodeTransport: () => { throw new Error("Build validation does not decode."); },
    verify: async value => value, decompress: async (_codec, value) => value });
  const shell = await buildKeelPreparedDenseCopyShell({ legacyPreparedDenseDelivery: { chainId, ...(sharedImage ? { sharedImage: true } : {}) }, ...(shellBootCompression === undefined ? {} : { shellBootCompression }) });
  const parts: KeelInlineDocumentPart[] = [];
  const add = (kind: "existing" | "creator", role: "shell-prefix" | "shell-suffix" | "asset", value: Uint8Array) => {
    parts.push({ kind, role, bytes: value, byteLength: value.length, integrity: commitment(value) } as KeelInlineDocumentPart);
  };
  add("existing", "shell-prefix", Uint8Array.from(shell.prefix));
  const physical = [...packs.values()];
  // Keep the established 64-part physical graph boundary. Logical resources stay
  // independently identified while bounded groups share a COPY fragment.
  for (let offset = 0; offset < physical.length; offset += 128) add("creator", "asset",
    bytes((offset ? "," : "") + physical.slice(offset, offset + 128).map(serializeKeelDenseTransportJSON).join(",")));
  add("creator", "asset", Uint8Array.from(shell.containerBridge!));
  for (const module of modules) {
    const actual = text(module.bytes);
    if (!actual.startsWith(",") || canonicalJson(JSON.parse(actual.slice(1))) !== canonicalJson(module.item) || commitment(module.bytes).digest !== module.integrity.digest) throw new TypeError("Existing module fragment differs from its exact committed descriptor.");
    parts.push({ kind: "existing", role: "module", moduleId: module.moduleId, moduleVersion: module.version, execution: module.execution, phase: module.phase, weight: module.weight,
      bytes: Uint8Array.from(module.bytes), byteLength: module.bytes.length, integrity: module.integrity });
  }
  let sharedImageDocumentPartIndex: number | undefined;
  if (!sharedImage) add("creator", "asset", bytes("," + descriptors.map(serializeKeelDenseTransportJSON).join(",")));
  else {
    // Isolate only the return-time native image transform. Every original descriptor stays in order.
    const serialized = "," + descriptors.map(serializeKeelDenseTransportJSON).join(",");
    const imageText = Buffer.from(sharedImage.bytes).toString("base64");
    const marker = '"storedBase64":"' + imageText + '"';
    const at = serialized.indexOf(marker);
    if (at < 0 || serialized.indexOf(marker, at + marker.length) >= 0) throw new TypeError("Ambiguous shared image slot.");
    const start = at + '"storedBase64":"'.length;
    add("creator", "asset", bytes(serialized.slice(0, start)));
    sharedImageDocumentPartIndex = parts.length;
    add("creator", "asset", bytes(imageText));
    add("creator", "asset", bytes(serialized.slice(start + imageText.length)));
  }
  add("existing", "shell-suffix", Uint8Array.from(shell.suffix));
  const rootBytes = concat(parts.map(part => part.bytes));
  assertKeelFreshPayloadCarriage(rootBytes);
  const document: KeelInlineLocalDocument = { schema: "keel-inline-local-document@1", rootBytes, rootIntegrity: commitment(rootBytes), byteLength: rootBytes.length, parts };
  return { protocol: sharedImage ? KEEL_LEGACY_SHARED_IMAGE_PROFILE : KEEL_LEGACY_PREPARED_DENSE_PROFILE, document,
    ...(sharedImage ? { sharedCollectorImage: { resourceId: sharedImage.id, mediaType: sharedImage.mediaType, bytes: Uint8Array.from(sharedImage.bytes), integrity: commitment(sharedImage.bytes), documentPartIndex: sharedImageDocumentPartIndex! } } : {}), resources: descriptors, entryId, ...(posterResourceId === undefined ? {} : { posterResourceId }),
    payloadStorage: "compact" as const, sourceLimits: Object.freeze(limits),
    shellRegistration: { profile: sharedImage ? KEEL_LEGACY_SHARED_IMAGE_PROFILE : KEEL_LEGACY_PREPARED_DENSE_PROFILE, shellId: sharedImage ? KEEL_LEGACY_SHARED_IMAGE_SHELL_ID : KEEL_LEGACY_PREPARED_DENSE_SHELL_ID, resourceProfile: shell.resourceProfile,
      prefix: Uint8Array.from(shell.prefix), suffix: Uint8Array.from(shell.suffix), prefixIntegrity: shell.prefixIntegrity, suffixIntegrity: shell.suffixIntegrity,
      canonicalPrefixIntegrity: shell.canonicalPrefixIntegrity, canonicalSuffixIntegrity: shell.canonicalSuffixIntegrity,
      decoderIntegrity: shell.decoderIntegrity, transportDecoderIntegrity: shell.transportDecoderIntegrity,
      bodySchema: sharedImage ? "keel.legacy-prepared-dense-packs-and-native-image@1" as const : "keel.legacy-prepared-dense-packs-and-segments@1" as const,
      contextSchema: "keel-context@1:legacy-six-fields" as const, selectedChainRegistrationVerified: false as const },
    optimization: { sourceBytes, physicalPayloadCount: packs.size, logicalResourceCount: resources.length, leafDecodedBytes: KEEL_LEGACY_PREPARED_LEAF_DECODED_BYTES,
      compressedPayloadBytes: physical.reduce((sum, pack) => sum + pack.storedIntegrity.byteLength, 0),
      completeDocumentBytes: rootBytes.length, descriptorGroups: reader.snapshot().descriptorGroups, resources: measurements },
    completeTokenURIBytes: null, status: "review-only" as const, signing: "not-performed" as const, submission: "not-performed" as const };
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
