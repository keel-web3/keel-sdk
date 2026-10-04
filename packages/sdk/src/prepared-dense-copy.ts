import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { buildCompactInlineKeelShell } from "./verification-shell.js";
import { serializeKeelDenseTransportJSON } from "./dense-transport.js";

/** Base64 encodes only the canonical shell fragments. Dense payloads stay outside
 * those strings. The browser assembles the exact canonical document; tokenURI
 * copies prepared fragments without converting any payload. */
export async function buildKeelPreparedDenseCopyShell(input: Parameters<typeof buildCompactInlineKeelShell>[0] & {
  readonly context?: Readonly<Record<string, unknown>>;
  readonly shellBootCompression?: "gzip" | "none";
}) {
  const { context, shellBootCompression = "gzip", ...options } = input;
  if (shellBootCompression !== "gzip" && shellBootCompression !== "none") throw new TypeError("Unsupported shell boot compression.");
  const carriage = options.binaryPayloadCarriage ?? "base90";
  if (!["base89", "base90", "base91", "base90-block"].includes(carriage)) throw new TypeError("Prepared dense COPY requires an explicit dense payload format.");
  const canonical = await buildCompactInlineKeelShell({ ...options, binaryPayloadCarriage: carriage });
  if (!canonical.containerBridge) throw new TypeError("Prepared dense COPY requires embedded container delivery.");
  const prefix = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><script>'
    + (context ? 'globalThis.__KEEL_CONTEXT__=' + serializeKeelDenseTransportJSON(context) + ';' : '')
    + 'const __KEEL_PREPARED_DENSE_PACKS__=[');
  const pack = (bytes: Uint8Array) => (shellBootCompression === "gzip" ? gzipSync(bytes, {level: 9}) : Buffer.from(bytes)).toString("base64");
  const prefix64 = pack(canonical.prefix), suffix64 = pack(canonical.suffix);
  const bridge = Buffer.from(canonical.containerBridge).toString("utf8");
  const suffix = Buffer.from('];queueMicrotask(async()=>{const safe=v=>JSON.stringify(v).replace(/<(?=\\/script|script|!--)/giu,"\\\\u003c").replaceAll("\\u2028","\\\\u2028").replaceAll("\\u2029","\\\\u2029");'
    + (shellBootCompression === "gzip"
      ? 'const bootCompression="gzip";const utf8=async s=>new TextDecoder().decode(await new Response(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());'
      : 'const utf8=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));')
    + 'const html=(await utf8(' + JSON.stringify(prefix64) + '))+safe(__KEEL_PREPARED_DENSE_PACKS__).slice(1,-1)+' + JSON.stringify(bridge)
    + '+safe(globalThis.__KEEL_ITEMS__).slice(5,-1)+(await utf8(' + JSON.stringify(suffix64) + '));document.open();document.write(html);document.close()});</script></body></html>');
  const commitment = (bytes: Uint8Array) => { const hash = createHash("sha256"); hash.update(bytes); return {algorithm: "sha256" as const, digest: `0x${hash.digest("hex")}` as const, byteLength: bytes.byteLength}; };
  return { ...canonical, prefix, suffix, prefixIntegrity: commitment(prefix), suffixIntegrity: commitment(suffix), canonicalPrefixIntegrity: canonical.prefixIntegrity,
    canonicalSuffixIntegrity: canonical.suffixIntegrity, shellBootEncoding: "base64" as const, shellBootCompression,
    payloadPreparation: "build-time" as const, contractOperation: "verified-copy" as const };
}
