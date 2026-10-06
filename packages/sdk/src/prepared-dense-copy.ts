import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { transform } from "esbuild";
import { unpackKeelInlineDescriptors } from "./inline-descriptor-columns.js";
import { buildCompactInlineKeelShell } from "./verification-shell.js";
import { encodeKeelDenseTransport, serializeKeelDenseTransportJSON, prepareKeelDenseCopyFragment, type KeelDenseTransportProfile } from "./dense-transport.js";

/** Prepare one fresh COPY carrier. Only preparedBytes is uploaded; the local
 * compressed bytes supply the source commitment for the container descriptor. */
export function prepareKeelDensePayload(source: Uint8Array, options: {
  readonly compression?: "auto" | "brotli" | "none";
  readonly transportProfile?: KeelDenseTransportProfile;
} = {}) {
  if (!(source instanceof Uint8Array) || source.length > 32 * 1024 * 1024) throw new RangeError("Dense payload source exceeds its byte bound.");
  const requested = options.compression ?? "auto";
  if (!["auto", "brotli", "none"].includes(requested)) throw new TypeError("Unsupported fresh dense payload compression.");
  const original = Buffer.from(source);
  const candidate = requested === "none" ? original : brotliCompressSync(original, { params: { [constants.BROTLI_PARAM_QUALITY as number]: 9 } });
  const compression = requested === "brotli" || requested === "auto" && candidate.length < original.length ? "brotli" as const : "none" as const;
  const compressedBytes = compression === "brotli" ? candidate : original;
  if (compression === "brotli" && !brotliDecompressSync(compressedBytes, { maxOutputLength: Math.max(1, original.length) }).equals(original)) throw new TypeError("Brotli preparation changed source bytes.");
  const transportProfile = options.transportProfile ?? "base90-v1";
  const storedDense = encodeKeelDenseTransport(compressedBytes, transportProfile);
  const jsonText = serializeKeelDenseTransportJSON(storedDense).slice(1, -1);
  const preparedBytes = prepareKeelDenseCopyFragment(jsonText);
  const integrity = (bytes: Uint8Array) => { const hash = createHash("sha256"); hash.update(bytes); return { algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: bytes.length }; };
  return { compression, transportProfile, storedDense, compressedBytes: new Uint8Array(compressedBytes), preparedBytes,
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
  if (!["json","columns-v1"].includes(itemDescriptorCarriage)) throw new TypeError("Unknown descriptor carriage");
  if (gzipCompressor && shellBootCompression !== "gzip") throw new TypeError("Gzip compressor requires gzip boot");
  if (shellBootCompression !== "gzip" && shellBootCompression !== "none") throw new TypeError("Unsupported shell boot compression.");
  const carriage = options.binaryPayloadCarriage ?? "base90";
  if (!["base90", "base91", "base90-block", "uri81"].includes(carriage)) throw new TypeError("Prepared dense COPY requires an explicit dense payload format.");
  const canonical = await buildCompactInlineKeelShell({ ...options, codecProfile: options.codecProfile ?? "brotli-js", binaryPayloadCarriage: carriage });
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
  const suffix = Buffer.from('];queueMicrotask(async()=>{const safe=v=>JSON.stringify(v).replace(/<(?=\\/script|script|!--)/giu,"\\\\u003c").replaceAll("\\u2028","\\\\u2028").replaceAll("\\u2029","\\\\u2029");'
    + (shellBootCompression === "gzip"
      ? 'const bootCompression="gzip";const utf8=async s=>new TextDecoder().decode(await new Response(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());'
      : 'const utf8=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));')
    + 'const html=(await utf8(' + JSON.stringify(prefix64) + '))+safe(__KEEL_PREPARED_DENSE_PACKS__).slice(1,-1)+' + JSON.stringify(bridge)
    + '+safe(globalThis.__KEEL_ITEMS__).slice(5,-1)+(await utf8(' + JSON.stringify(suffix64) + '));document.open();document.write(html);document.close()});</script></body></html>');
  const commitment = (bytes: Uint8Array) => { const hash = createHash("sha256"); hash.update(bytes); return {algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: bytes.byteLength}; };
  return { ...canonical, prefix, suffix, prefixIntegrity: commitment(prefix), suffixIntegrity: commitment(suffix), canonicalPrefixIntegrity: canonical.prefixIntegrity,
    canonicalSuffixIntegrity: commitment(canonicalSuffix), shellBootEncoding: "base64" as const, shellBootCompression, itemDescriptorCarriage,
    payloadPreparation: "build-time" as const, contractOperation: "verified-copy" as const };
}
