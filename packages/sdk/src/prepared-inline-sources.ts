import { createHash } from "node:crypto";
import { gunzipSync, inflateSync } from "node:zlib";
import { createKeelEmbeddedContainerReader, type KeelEmbeddedContainerPayload } from "./embedded-container-reader.js";
import { decodeKeelResource } from "./decoders/index.js";
import { decodeKeelDenseTransport } from "./dense-transport.js";
import { inspectKeelPreparedDenseCopyDocument, readKeelInlineJSONArray } from "./inline-transport-audit.js";
import type { KeelBinaryIntegrity } from "./onchain-resource-reader.js";
import type { KeelStandaloneViewerItem } from "./verification-shell.js";

/** Read original modular sources through the same table/member reader used by
 * the browser. Static boot parsing never executes an imported document. The
 * caller separately authenticates the selected chain and exact table artifact.
 */
export async function readKeelPreparedInlineSources(input: {
  readonly htmlBytes: Uint8Array;
  readonly chainId: number;
  readonly store: string;
  readonly tableDigest: `0x${string}`;
  /** Host intake budget, bounded additionally by this reader's 32 MiB graph. */
  readonly maximumDecodedSourceBytes?: number;
  readonly signal?: AbortSignal;
}) {
  if (!(input.htmlBytes instanceof Uint8Array) || input.htmlBytes.length > 2_000_000) throw new RangeError("Prepared Inline document exceeds its byte boundary.");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const document = inspectKeelPreparedDenseCopyDocument(decoder.decode(input.htmlBytes));
  if (!document) throw new TypeError("The document is not a supported prepared Inline profile.");
  const items = document.items.filter(value => value !== null) as readonly KeelStandaloneViewerItem[];
  const requestedMaximum = input.maximumDecodedSourceBytes ?? 32 * 1024 * 1024;
  if (!Number.isSafeInteger(requestedMaximum) || requestedMaximum < 1 || requestedMaximum > 256 * 1024 * 1024) throw new RangeError("Invalid prepared source intake byte budget.");
  const maximum = Math.min(requestedMaximum, 32 * 1024 * 1024);
  if (!items.length || items.length > 40) throw new RangeError("Prepared creator source import supports 1..40 modular resources.");
  let declaredSourceBytes = 0;
  for (const item of items) {
    const length = item?.integrity?.byteLength;
    if (!Number.isSafeInteger(length) || length === undefined || length < 1 || length > maximum) throw new RangeError("Prepared source member exceeds its intake byte budget.");
    declaredSourceBytes += length;
    if (declaredSourceBytes > maximum) throw new RangeError("Prepared decoded sources exceed the intake byte budget.");
  }
  if (items.filter(item => item.role === "entrypoint").length !== 1) throw new TypeError("Prepared Inline requires exactly one entrypoint.");
  const verify = async (bytes: Uint8Array, integrity: KeelBinaryIntegrity, label: string) => {
    if (bytes.byteLength !== integrity.byteLength || "0x" + createHash("sha256").update(bytes).digest("hex") !== integrity.digest) throw new TypeError(`${label} SHA-256 or length mismatch.`);
    return bytes;
  };
  const reader = createKeelEmbeddedContainerReader({
    chainId: input.chainId, store: input.store, tableDigest: input.tableDigest,
    transportProfile: document.transportProfile,
    decodeTransport: (text, byteLength) => decodeKeelDenseTransport(text, { profile: document.transportProfile, byteLength }),
    containers: items.flatMap(item => item.containerBindings ?? []), items,
    payloads: readKeelInlineJSONArray(document.html, "globalThis.__KEEL_EMBEDDED_CONTAINERS__=") as readonly KeelEmbeddedContainerPayload[],
    verify,
    decompress: async (codec, bytes, decodedByteLength) => {
      input.signal?.throwIfAborted();
      if (codec === "none") return bytes;
      if (codec === "gzip" || codec === "deflate") {
        const options = { maxOutputLength: decodedByteLength };
        return new Uint8Array(codec === "gzip" ? gunzipSync(bytes, options) : inflateSync(bytes, options));
      }
      if (codec !== "brotli" && codec !== "lzma" && codec !== "ppmd") throw new TypeError("Unsupported prepared Inline codec.");
      return decodeKeelResource(codec, bytes, { decodedByteLength, ...(codec === "ppmd" ? { maxDictionaryBytes: 64 * 1024 * 1024 } : {}), ...(input.signal === undefined ? {} : { signal: input.signal }) });
    },
  });
  const resources = [];
  for (const item of items) {
    input.signal?.throwIfAborted();
    const bytes = await reader.resolve(item);
    const binding = item.onchain && "containerId" in item.onchain
      ? items.flatMap(value => value.containerBindings ?? []).find(value => value.id === item.onchain?.containerId)
      : undefined;
    resources.push(Object.freeze({ id: item.id, aliases: Object.freeze([...item.aliases]), role: item.role, mediaType: item.mediaType,
      integrity: Object.freeze({ ...item.integrity }), bytes, compression: binding?.compression ?? item.onchain?.compression,
      objectId: binding?.objectId ?? item.objectId }));
  }
  return Object.freeze({ protocol: "keel-prepared-inline-source-read@1" as const,
    transportProfile: document.transportProfile, shellBootCompression: document.shellBootCompression,
    resources: Object.freeze(resources), decodedSourceBytes: resources.reduce((sum, item) => sum + item.bytes.length, 0),
    reader: reader.snapshot(), selectedChainBindingVerified: false as const, browserVerified: false as const,
    onchainStorage: { status: "not-inspected" as const }, signing: "not-performed" as const, submission: "not-performed" as const });
}
