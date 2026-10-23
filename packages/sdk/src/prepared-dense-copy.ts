import { keelPreparedDenseCopyBootSuffix } from "./prepared-dense-framing.js";
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
import { unpackKeelInlineDescriptors } from "./inline-descriptor-columns.js";
import { buildCompactInlineKeelShell } from "./verification-shell.js";
import { encodeKeelDenseTransport, serializeKeelDenseTransportJSON, prepareKeelDenseCopyFragment, } from "./dense-transport.js";

/** Prepare one fresh COPY carrier. Only preparedBytes is uploaded; the local
 * compressed bytes supply the source commitment for the container descriptor. */
export function prepareKeelDensePayload(source: Uint8Array, options: {
  readonly compression?: "auto" | "brotli" | "none";
  readonly transportProfile?: "uri81-block-v1";
  /** Authenticated immutable readers may require stricter percent literals. */
  readonly readerGrammar?: "uri81" | "legacy-strict";
  /** Pinned build-time quality; independent of process environment. */
  readonly brotliQuality?: number;
} = {}) {
  if (!(source instanceof Uint8Array) || source.length > 32 * 1024 * 1024) throw new RangeError("Dense payload source exceeds its byte bound.");
  const requested = options.compression ?? "auto";
  if (!["auto", "brotli", "none"].includes(requested)) throw new TypeError("Unsupported fresh dense payload compression.");
  const quality = options.brotliQuality ?? 11;
  if (!Number.isInteger(quality) || quality < 0 || quality > 11) throw new RangeError("Brotli quality must be an integer from 0 through 11.");
  const transportProfile = options.transportProfile ?? "uri81-block-v1";
  if (transportProfile !== "uri81-block-v1") throw new TypeError("Fresh prepared COPY uses URI81. Reuse existing Base90/91 objects unchanged instead of preparing new legacy carriers.");
  const original = Buffer.from(source);
  const candidate = requested === "none" ? original : brotliCompressSync(original, { params: { [constants.BROTLI_PARAM_QUALITY as number]: quality } });
  const prepare = (bytes: Uint8Array) => {
    const dense = encodeKeelDenseTransport(bytes, transportProfile);
    return { dense, bytes: prepareKeelDenseCopyFragment(serializeKeelDenseTransportJSON(dense).slice(1, -1),
      options.readerGrammar === undefined ? {} : { readerGrammar: options.readerGrammar }) };
  };
  // The decoded source bound is larger than the dense stored-carrier bound.
  // An unavailable raw alternative must not reject a valid compressed carrier.
  const maxStoredBytes = 4 * 1024 * 1024;
  const originalPrepared = original.length <= maxStoredBytes ? prepare(original) : undefined;
  const candidatePrepared = requested === "none" ? originalPrepared
    : candidate.length <= maxStoredBytes ? prepare(candidate) : undefined;
  // Pay for the exact escaped COPY carrier, not the pre-encoding estimate.
  const compression = requested === "brotli" || requested === "auto"
    && candidate.length < original.length && candidatePrepared !== undefined
    && (originalPrepared === undefined || candidatePrepared.bytes.length < originalPrepared.bytes.length) ? "brotli" as const : "none" as const;
  const compressedBytes = compression === "brotli" ? candidate : original;
  if (compression === "brotli" && !brotliDecompressSync(compressedBytes, { maxOutputLength: Math.max(1, original.length) }).equals(original)) throw new TypeError("Brotli preparation changed source bytes.");
  const selected = compression === "brotli" ? candidatePrepared : originalPrepared;
  if (selected === undefined) throw new RangeError("Selected dense payload exceeds its stored-carrier byte bound.");
  const storedDense = selected.dense;
  const preparedBytes = selected.bytes;
  const integrity = (bytes: Uint8Array) => { const hash = createHash("sha256"); hash.update(bytes); return { algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: bytes.length }; };
  return { compression, brotliQuality: quality, transportProfile, storedDense,
    optimization: { sourceBytes: original.length, compressedBytes: compressedBytes.length,
      preparedBytes: preparedBytes.length, uncompressedPreparedBytes: originalPrepared?.bytes.length ?? null,
      preparedBytesSaved: originalPrepared === undefined ? null : originalPrepared.bytes.length - preparedBytes.length,
      sourceByteIdentity: "verified-exact" as const, selection: requested }, compressedBytes: new Uint8Array(compressedBytes), preparedBytes,
    decodedIntegrity: integrity(original), storedIntegrity: integrity(compressedBytes), preparedIntegrity: integrity(preparedBytes),
    mediaType: "application/vnd.keel.token-uri-raw-percent-fragment" as const, payloadPreparation: "build-time" as const };
}

/** Base64 encodes only the canonical shell fragments. Dense payloads stay outside
 * those strings. The browser assembles the exact canonical document; tokenURI
 * copies prepared fragments without converting any payload. */
export async function buildKeelPreparedDenseCopyShell(input: Parameters<typeof buildCompactInlineKeelShell>[0] & {
  readonly context?: Readonly<Record<string, unknown>>;
  readonly shellBootCompression?: "gzip" | "none";
  readonly itemDescriptorCarriage?: "json" | "columns-v1";
  /** Build-time compressor only; accepted after exact bounded gzip replay. */
  readonly gzipCompressor?: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;
}) {
  const { context, shellBootCompression = "gzip", itemDescriptorCarriage = "json", gzipCompressor, ...options } = input;
  if (options.legacyPreparedDenseDelivery && (context !== undefined || itemDescriptorCarriage !== "json" || options.binaryPayloadCarriage !== undefined)) throw new TypeError("Legacy prepared COPY uses the actual appended collection context and its distinct Base90 descriptor profile.");
  if (!["json","columns-v1"].includes(itemDescriptorCarriage)) throw new TypeError("Unknown descriptor carriage");
  if (gzipCompressor && shellBootCompression !== "gzip") throw new TypeError("Gzip compressor requires gzip boot");
  if (shellBootCompression !== "gzip" && shellBootCompression !== "none") throw new TypeError("Unsupported shell boot compression.");
  const carriage = options.binaryPayloadCarriage ?? "uri81";
  if (!options.legacyPreparedDenseDelivery && carriage !== "uri81") throw new TypeError("Fresh prepared COPY requires URI81; legacy Base90/91 objects must be reused unchanged.");
  const canonical = await buildCompactInlineKeelShell({ ...options, codecProfile: options.codecProfile ?? "brotli-js", ...(options.legacyPreparedDenseDelivery ? {} : { binaryPayloadCarriage: carriage }) });
  if (!canonical.containerBridge) throw new TypeError("Prepared dense COPY requires embedded container delivery.");
  const prefix = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><script>'
    + (context ? 'globalThis.__KEEL_CONTEXT__=' + serializeKeelDenseTransportJSON(context) + ';' : '')
    + 'const __KEEL_PREPARED_DENSE_PACKS__=[');
  const pack = async (bytes: Uint8Array) => {
    const packed=shellBootCompression === "gzip" ? gzipCompressor ? await gzipCompressor(bytes.slice()) : gzipSync(bytes,{level:9}) : bytes;
    if(!(packed instanceof Uint8Array)||packed.length>2_000_000)throw new RangeError("Invalid packed shell");
    if(shellBootCompression === "gzip" && !Buffer.from(gunzipSync(packed,{maxOutputLength:bytes.length})).equals(Buffer.from(bytes)))throw new TypeError("Shell compressor changed canonical bytes");
    return Buffer.from(packed).toString("base64");
  };
  const prefix64 = await pack(canonical.prefix);
  const compactDescriptorContext=options.embeddedContainerDelivery;
  const unpack=itemDescriptorCarriage === "columns-v1" ? 'const compactDescriptorContext='+JSON.stringify(compactDescriptorContext)+';'+(await transform('globalThis.__KEEL_ITEMS__=('+unpackKeelInlineDescriptors.toString()+')(globalThis.__KEEL_ITEMS__,compactDescriptorContext.chainId,compactDescriptorContext.store);',{minify:true,target:'es2022'})).code : '';
  if(unpack && (canonical.suffix[0]!==93||canonical.suffix[1]!==59))throw new TypeError("Canonical descriptor expansion hook is missing");
  const canonicalSuffix=unpack?Buffer.concat([Buffer.from('];'+unpack),canonical.suffix.subarray(2)]):canonical.suffix;
  const suffix64 = await pack(canonicalSuffix);
  const bridge = Buffer.from(canonical.containerBridge).toString("utf8");
  const suffix = Buffer.from(keelPreparedDenseCopyBootSuffix(prefix64, suffix64, bridge, shellBootCompression, !!options.legacyPreparedDenseDelivery));
  const commitment = (bytes: Uint8Array) => { const hash = createHash("sha256"); hash.update(bytes); return {algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: bytes.byteLength}; };
  return { ...canonical, prefix, suffix, prefixIntegrity: commitment(prefix), suffixIntegrity: commitment(suffix), canonicalPrefixIntegrity: canonical.prefixIntegrity,
    canonicalSuffixIntegrity: commitment(canonicalSuffix), shellBootEncoding: "base64" as const, shellBootCompression, itemDescriptorCarriage,
    payloadPreparation: "build-time" as const, contractOperation: "verified-copy" as const };
}


/** Prepare a new, authorized dense COPY payload once at build time. This is
 * local byte preparation, not selected-chain registration or upload approval.
 * The caller stores one chosen representation; existing objects need reuse.
 * Gzip is deterministic and selected only when it saves bytes. No decoder or
 * shell is manufactured here, and tokenURI never performs this conversion.
 */
export function prepareKeelGzipDensePayload(bytes: Uint8Array, options: {
  readonly compression?: "auto" | "gzip" | "none";
  readonly readerGrammar?: "uri81" | "legacy-strict";
  readonly transportProfile?: "uri81-block-v1";
} = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Dense COPY payload must be bytes.");
  if (bytes.byteLength > 4 * 1024 * 1024) throw new RangeError("Dense COPY payload exceeds its byte bound.");
  if (options.compression !== undefined && options.compression !== "auto" && options.compression !== "gzip" && options.compression !== "none") {
    throw new TypeError("Unsupported dense COPY payload compression.");
  }
  const source = Buffer.from(bytes);
  const gzip = options.compression === "none" ? null : gzipSync(source, { level: 9 });
  if (options.readerGrammar !== undefined && !["uri81", "legacy-strict"].includes(options.readerGrammar)) throw new TypeError("Unsupported prepared COPY reader grammar.");
  const compression = gzip && (options.compression === "gzip" || gzip.byteLength < source.byteLength) ? "gzip" as const : "none" as const;
  const compressedBytes = compression === "gzip" ? gzip! : source;
  if (compression === "gzip" && !gunzipSync(compressedBytes, { maxOutputLength: source.byteLength }).equals(source)) {
    throw new TypeError("Dense COPY compression changed source bytes.");
  }
  const transportProfile = options.transportProfile ?? "uri81-block-v1";
  if (transportProfile !== "uri81-block-v1") throw new TypeError("Fresh prepared COPY uses the URI81 transport profile.");
  const storedDense = encodeKeelDenseTransport(compressedBytes, transportProfile);
  const integrity = (value: Uint8Array) => {
    const hash = createHash("sha256"); hash.update(value);
    return { algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: value.byteLength };
  };
  const preparedBytes = prepareKeelDenseCopyFragment(serializeKeelDenseTransportJSON(storedDense).slice(1,-1),
    options.readerGrammar === undefined ? {} : { readerGrammar: options.readerGrammar });
  const rawPreparedBytes = compression === "none" ? preparedBytes.length : prepareKeelDenseCopyFragment(serializeKeelDenseTransportJSON(encodeKeelDenseTransport(source, transportProfile)).slice(1,-1), options.readerGrammar === undefined ? {} : { readerGrammar: options.readerGrammar }).length;
  return { compression, compressedBytes, storedDense, transportProfile, preparedBytes, preparedIntegrity: integrity(preparedBytes),
    decodedIntegrity: integrity(source), sourceIntegrity: integrity(source), storedIntegrity: integrity(compressedBytes),
    optimization: { sourceBytes: source.length, compressedBytes: compressedBytes.length, preparedBytes: preparedBytes.length,
      uncompressedPreparedBytes: rawPreparedBytes, preparedBytesSaved: rawPreparedBytes - preparedBytes.length,
      sourceByteIdentity: "verified-exact" as const, selection: options.compression ?? "auto" } };
}
