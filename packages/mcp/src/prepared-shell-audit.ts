/** Inspect the supported COPY wrapper without executing any supplied JavaScript.
 * Exact SDK shell bytes and framing are checked before unpacking creator data.
 * Registry/receipt authentication remains a separate selected-chain gate. */
import { createHash } from 'node:crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { buildCompactInlineKeelShell, inspectKeelPreparedDenseCopyDocument, readKeelInlineJSONArray,
  serializeKeelDenseTransportJSON, createKeelEmbeddedContainerReader, decodeKeelDenseTransport,
  validateKeelEmbeddedContainerContext, type KeelStandaloneViewerItem,
  type KeelEmbeddedContainerPayload } from '@keel/sdk';

const LIMIT = 32 * 1024 * 1024;
const dec = new TextDecoder('utf-8', { fatal: true });
const hash = (bytes: Uint8Array) => `0x${createHash('sha256').update(bytes).digest('hex')}`;
export interface PreparedShellAudit {
  readonly tail: string;
  readonly resources: readonly { readonly id: string; readonly aliases: readonly string[]; readonly mediaType: string; readonly bytes: Uint8Array }[];
}
export async function inspectPreparedShellForAudit(html: string): Promise<PreparedShellAudit | undefined> {
  if (!html.startsWith('<!doctype html><html><head><meta charset="utf-8"></head><body><script>const __KEEL_PREPARED_DENSE_PACKS__=[')) return undefined;
  const prepared = inspectKeelPreparedDenseCopyDocument(html);
  if (!prepared || prepared.legacyPreparedProfile || prepared.transportProfile !== 'uri81-block-v1') throw new TypeError('Unsupported current COPY shell profile.');
  const items = prepared.items.filter(value => value !== null) as unknown as KeelStandaloneViewerItem[];
  if (!items.length || items.length > 128) throw new TypeError('Invalid COPY resource count.');
  const containers = items.flatMap(item => item.containerBindings ?? []);
  const binding = containers[0];
  if (!binding) throw new TypeError('COPY shell has no selected-chain container binding.');
  const canonical = await buildCompactInlineKeelShell({ codecProfile: 'brotli-js', binaryPayloadCarriage: 'uri81',
    embeddedContainerDelivery: { chainId: binding.chainId, store: binding.store as `0x${string}` } });
  const prefix = dec.decode(canonical.prefix), suffix = dec.decode(canonical.suffix), bridge = dec.decode(canonical.containerBridge!);
  const packs = readKeelInlineJSONArray(html, 'const __KEEL_PREPARED_DENSE_PACKS__=') as unknown as KeelEmbeddedContainerPayload[];
  const descriptors = serializeKeelDenseTransportJSON([null, ...items]).slice(5, -1);
  const inner = prefix + serializeKeelDenseTransportJSON(packs).slice(1, -1) + bridge + descriptors + suffix;
  if (prepared.html !== inner) throw new TypeError('COPY shell differs from the pinned SDK verifier.');
  // Preserve the literal gzip streams: equivalent compressor headers are fine;
  // their complete decoded verifier was compared byte-for-byte above.
  const formula = /const html=\(await utf8\(("[A-Za-z0-9+/=]+")\)\)\+safe\(__KEEL_PREPARED_DENSE_PACKS__\)\.slice\(1,-1\)\+("(?:[^"\\]|\\.)*")\+safe\(globalThis\.__KEEL_ITEMS__\)\.slice\(5,-1\)\+\(await utf8\(("[A-Za-z0-9+/=]+")\)\);document.open\(\);document.write\(html\);document.close\(\)/u.exec(html);
  if (!formula || JSON.parse(formula[2]!) !== bridge) throw new TypeError('Invalid COPY boot formula.');
  const boot = '];queueMicrotask(async()=>{const safe=v=>JSON.stringify(v).replace(/<(?=\\/script|script|!--)/giu,"\\\\u003c").replaceAll("\\u2028","\\\\u2028").replaceAll("\\u2029","\\\\u2029");'
    + (prepared.shellBootCompression === 'gzip'
      ? 'const bootCompression="gzip";const utf8=async s=>new TextDecoder().decode(await new Response(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());'
      : 'const utf8=s=>new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)));')
    + `const html=(await utf8(${formula[1]}))+safe(__KEEL_PREPARED_DENSE_PACKS__).slice(1,-1)+${formula[2]}+safe(globalThis.__KEEL_ITEMS__).slice(5,-1)+(await utf8(${formula[3]}));document.open();document.write(html);document.close()});</script></body></html>`;
  const framing = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>const __KEEL_PREPARED_DENSE_PACKS__=['
    + serializeKeelDenseTransportJSON(packs).slice(1, -1) + bridge + descriptors + boot;
  if (!html.startsWith(framing)) throw new TypeError('COPY wrapper contains code outside its exact supported framing.');
  const tail = html.slice(framing.length);
  const contextLiteral = /^<script>\(\(\)=>\{try\{const v="([A-Za-z0-9_-]+)"/u.exec(tail);
  if (!contextLiteral || contextLiteral[1]!.length > 16384) throw new TypeError('Missing bounded COPY collection context.');
  const context = validateKeelEmbeddedContainerContext(JSON.parse(dec.decode(Buffer.from(contextLiteral[1]!, 'base64url'))), binding.chainId);
  const reader = createKeelEmbeddedContainerReader({ chainId: binding.chainId, store: binding.store, containers: containers as Parameters<typeof createKeelEmbeddedContainerReader>[0]["containers"],
    payloads: packs, items, tableDigest: context.containerTableDigest as `0x${string}`, transportProfile: 'uri81-block-v1',
    decodeTransport: (text, byteLength) => decodeKeelDenseTransport(text, { profile: 'uri81-block-v1', byteLength }),
    verify: async (bytes, integrity, label) => { if (bytes.length !== integrity.byteLength || hash(bytes) !== integrity.digest) throw new TypeError(`${label}: byte commitment mismatch.`); return bytes; },
    decompress: async (codec, bytes, length) => {
      if (length < 1 || length > LIMIT) throw new RangeError('COPY decoded resource exceeds audit budget.');
      const opts = { maxOutputLength: length };
      if (codec === 'none') return bytes;
      if (codec === 'gzip') return gunzipSync(bytes, opts);
      if (codec === 'deflate') return inflateSync(bytes, opts);
      if (codec === 'brotli') return brotliDecompressSync(bytes, opts);
      throw new TypeError(`Unsupported audited COPY codec: ${codec}.`);
    } });
  const resources = [];
  for (const item of items) resources.push({ id: item.id, aliases: item.aliases ?? [], mediaType: item.mediaType, bytes: await reader.resolve(item) });
  return { tail, resources };
}
