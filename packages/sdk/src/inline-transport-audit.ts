import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { decodeKeelDenseTransport, serializeKeelDenseTransportJSON, type KeelDenseTransportProfile } from "./dense-transport.js";
import { createIntegrity } from "@keel/protocol";
import { assertKeelInlineImageBytes } from "./collector-policy.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_BYTES = 2_000_000;
type Entry = Record<string, unknown>;
function object(value: unknown): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Inline payload record.");
  return value as Entry;
}

/** Parse only data, never execute artwork while inspecting its transport. */
export function readKeelInlineJSONArray(html: string, marker: string): readonly unknown[] {
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const first = start + marker.length;
  if (html[first] !== "[") throw new TypeError("Malformed Inline resource array.");
  let depth = 0, quoted = false, escaped = false;
  for (let at = first; at < html.length; at++) {
    const c = html[at];
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        const value = JSON.parse(html.slice(first, at + 1)) as unknown;
        if (!Array.isArray(value)) throw new TypeError("Invalid Inline resource array.");
        return value;
      }
    }
  }
  throw new TypeError("Incomplete Inline resource array.");
}

export function decodeKeelInlineDataURI(uri: unknown, mediaPrefix: string): Uint8Array {
  if (typeof uri !== "string" || !uri.startsWith("data:")) throw new TypeError("Inline requires a self-contained data URI.");
  const parsed = new URL(uri);
  if (parsed.hash || parsed.href !== uri) throw new TypeError("Inline data URI is not canonical: URL normalization or a fragment would change the bytes.");
  const comma = uri.indexOf(",");
  if (comma < 5 || encoder.encode(uri).length > MAX_BYTES) throw new RangeError("Invalid or oversized Inline data URI.");
  const header = uri.slice(0, comma), text = uri.slice(comma + 1);
  const [media = "", ...parameters] = header.slice(5).toLowerCase().split(";");
  if ((mediaPrefix === "image/" ? !/^image\/[a-z0-9.+-]+$/u.test(media) : media !== mediaPrefix.toLowerCase())
      || parameters.some(parameter => parameter !== "charset=utf-8" && parameter !== "base64")
      || new Set(parameters).size !== parameters.length
      || parameters.includes("base64") && parameters.at(-1) !== "base64") throw new TypeError("Unsupported or noncanonical Inline MIME/encoding header.");
  if (!/;base64$/iu.test(header)) return encoder.encode(decodeURIComponent(text));
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) throw new TypeError("Invalid prepared Base64 data URI.");
  const bytes = new Uint8Array(Buffer.from(text, "base64"));
  if (Buffer.from(bytes).toString("base64") !== text) throw new TypeError("Noncanonical prepared Base64 data URI.");
  return bytes;
}

/** Inspect the two literal shell strings and data arrays without executing the bootstrap. */
export function inspectKeelPreparedDenseCopyDocument(html: string) {
  if (!html.includes("const __KEEL_PREPARED_DENSE_PACKS__=")) return undefined;
  const formula = /const html=(?:\(await )?utf8\(("[A-Za-z0-9+/=]+")\)\)?\+safe\(__KEEL_PREPARED_DENSE_PACKS__\)\.slice\(1,-1\)\+("(?:[^"\\]|\\.)*")\+safe\(globalThis\.__KEEL_ITEMS__\)\.slice\(5,-1\)\+(?:\(await )?utf8\(("[A-Za-z0-9+/=]+")\)\)?;document.open\(\);document.write\(html\);document.close\(\)/u.exec(html);
  if (!formula) throw new TypeError("Unsupported prepared dense COPY bootstrap.");
  const shellBootCompression = html.includes('const bootCompression="gzip";const utf8=async s=>') ? "gzip" as const : "none" as const;
  const decode = (literal: string) => {
    const text = JSON.parse(literal) as string;
    if (text.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) throw new TypeError("Invalid prepared shell Base64.");
    const bytes = Buffer.from(text, "base64");
    if (bytes.toString("base64") !== text) throw new TypeError("Noncanonical prepared shell Base64.");
    return decoder.decode(shellBootCompression === "gzip" ? gunzipSync(bytes, {maxOutputLength: MAX_BYTES}) : bytes);
  };
  const prefix = decode(formula[1]!), suffix = decode(formula[3]!), bridge = JSON.parse(formula[2]!) as string;
  if (bridge !== "];globalThis.__KEEL_ITEMS__=[null") throw new TypeError("Invalid prepared dense COPY bridge.");
  const profiles = [...suffix.matchAll(/transportProfile:\s*"(base89-v1|base90-v1|base91-v1|base90-block-v2)"/gu)].map(match => match[1]);
  if (profiles.length !== 1) throw new TypeError("Prepared dense COPY must declare one exact decoder profile.");
  const packs = readKeelInlineJSONArray(html, "const __KEEL_PREPARED_DENSE_PACKS__="), items = readKeelInlineJSONArray(html, "globalThis.__KEEL_ITEMS__=");
  if (!packs.length || items[0] !== null || items.length < 2) throw new TypeError("Incomplete prepared dense COPY resources.");
  return { html: prefix + serializeKeelDenseTransportJSON(packs).slice(1,-1) + bridge + serializeKeelDenseTransportJSON(items).slice(5,-1) + suffix,
    transportProfile: profiles[0] as KeelDenseTransportProfile, shellBootEncoding: "base64" as const, shellBootCompression, payloadPreparation: "build-time" as const, contractOperation: "verified-copy" as const };
}

export function inspectKeelInlinePayloadCarriage(htmlBytes: Uint8Array) {
  if (htmlBytes.length > MAX_BYTES) throw new RangeError("Inline HTML exceeds the inspection limit.");
  const source = decoder.decode(htmlBytes), preparedDenseCopy = inspectKeelPreparedDenseCopyDocument(source);
  const html = preparedDenseCopy?.html ?? source;
  const containers = readKeelInlineJSONArray(html, "globalThis.__KEEL_EMBEDDED_CONTAINERS__=");
  const items = readKeelInlineJSONArray(html, "globalThis.__KEEL_ITEMS__=");
  const payloads = [];
  for (const [container, values] of [[true, containers], [false, items]] as const) {
    for (const value of values) {
      if (value === null) continue;
      const item = object(value);
      if (!container && item.embedded === undefined) continue;
      const payload = container ? item : object(item.embedded);
      const choices = ["storedBase64", "storedHex", "storedText", "storedDense"].filter(key => Object.hasOwn(payload, key));
      if (choices.length !== 1) throw new TypeError("Inline payload needs exactly one byte representation.");
      const field = choices[0]!, text = payload[field];
      if (typeof text !== "string" || text.length === 0) throw new TypeError("Empty or invalid Inline payload.");
      const encoding = field === "storedBase64" ? "base64" : field === "storedHex" ? "hex" : field === "storedDense" ? "dense" : "text";
      let bytes: Uint8Array;
      if (encoding === "dense") {
        if (!container || !preparedDenseCopy) throw new TypeError("Dense bodies require the prepared COPY wrapper and matching decoder profile.");
        const integrity = object(payload.storedIntegrity);
        if (integrity.algorithm !== "sha256" || typeof integrity.digest !== "string" || !/^0x[0-9a-f]{64}$/iu.test(integrity.digest) || !Number.isSafeInteger(integrity.byteLength) || (integrity.byteLength as number) < 1) throw new TypeError("Invalid dense stored commitment.");
        bytes = decodeKeelDenseTransport(text, { profile: preparedDenseCopy.transportProfile, byteLength: integrity.byteLength as number });
        const hash = createHash("sha256"); hash.update(bytes);
        if (`0x${hash.digest("hex")}` !== integrity.digest.toLowerCase()) throw new TypeError("Dense payload differs from its stored commitment.");
      } else if (encoding === "base64") {
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) throw new TypeError("Malformed child Base64.");
        bytes = new Uint8Array(Buffer.from(text, "base64"));
        if (Buffer.from(bytes).toString("base64") !== text) throw new TypeError("Noncanonical child Base64.");
      } else if (encoding === "hex") {
        if (!/^(?:[0-9a-f]{2})+$/iu.test(text)) throw new TypeError("Malformed child hex.");
        bytes = new Uint8Array(Buffer.from(text, "hex"));
      } else {
        if (payload.compression !== "none") throw new TypeError("Text payloads must declare compression none.");
        bytes = encoder.encode(text);
      }
      const mediaType = typeof item.mediaType === "string" ? item.mediaType : "application/octet-stream";
      const imageMedia = mediaType.toLowerCase().split(";", 1)[0]!;
      const directImage = !container && mediaType.startsWith("image/") && payload.compression === "none"
        && (encoding === "text" && imageMedia === "image/svg+xml"
          || encoding === "base64" && ["image/png", "image/gif", "image/jpeg", "image/webp", "image/avif"].includes(imageMedia));
      if (directImage) assertKeelInlineImageBytes(bytes, mediaType);
      payloads.push(Object.freeze({
        id: typeof item.id === "string" ? item.id : typeof item.objectId === "string" ? item.objectId : "container",
        mediaType, encoding, compression: typeof payload.compression === "string" ? payload.compression : "container-bound",
        binaryBytes: bytes.length, textCarriageBytes: encoder.encode(text).length,
        directImage, requiresExistingPreparedReuse: encoding !== "text" && encoding !== "dense" && !directImage,
        ...(encoding === "dense" ? {transportProfile: preparedDenseCopy!.transportProfile} : {}),
      }));
    }
  }
  return Object.freeze({ schema: "keel-inline-payload-carriage@1" as const,
    payloadCount: payloads.length,
    packedPayloadBytes: payloads.reduce((n, p) => n + p.binaryBytes, 0),
    payloadTextCarriageBytes: payloads.reduce((n, p) => n + p.textCarriageBytes, 0),
    addedTextBytes: payloads.reduce((n, p) => n + p.textCarriageBytes - p.binaryBytes, 0),
    requiresExistingPreparedReuse: payloads.some(p => p.requiresExistingPreparedReuse), payloads,
    ...(preparedDenseCopy ? {preparedDenseCopy: {transportProfile: preparedDenseCopy.transportProfile, shellBootEncoding: preparedDenseCopy.shellBootEncoding, shellBootCompression: preparedDenseCopy.shellBootCompression, payloadPreparation: preparedDenseCopy.payloadPreparation, contractOperation: preparedDenseCopy.contractOperation}} : {}) });
}

/** Fresh publication must not silently encode a binary/text body. Existing
 * prepared objects use the exact assembly-only reuse inspector instead. */
export function assertKeelFreshPayloadCarriage(html: Uint8Array): void {
  const audit = inspectKeelInlinePayloadCarriage(html);
  if (audit.requiresExistingPreparedReuse) throw new TypeError(
    "Fresh Inline forbids new storedBase64/storedHex body copies. Use raw UTF-8 text or exact existing prepared COPY; incompatible binary needs a verified reader recipe, not an encoding fallback.");
}

/** Check the serialized audit again when reading a digest-bound review plan.
 * This does not replace parsing the source bytes when creating that plan. */
export function assertKeelFreshPayloadAudit(value: unknown): void {
  const audit = object(value);
  const fields = ["schema", "payloadCount", "packedPayloadBytes", "payloadTextCarriageBytes", "addedTextBytes", "requiresExistingPreparedReuse", "payloads", "preparedDenseCopy"];
  if (Object.keys(audit).some(key => !fields.includes(key)) || audit.schema !== "keel-inline-payload-carriage@1"
      || audit.requiresExistingPreparedReuse !== false || !Array.isArray(audit.payloads) || audit.payloads.length > 16_384
      || audit.payloadCount !== audit.payloads.length) throw new TypeError("Invalid fresh payload carriage audit.");
  const prepared = audit.preparedDenseCopy === undefined ? undefined : object(audit.preparedDenseCopy);
  if (prepared && (Object.keys(prepared).some(key => !["transportProfile","shellBootEncoding","shellBootCompression","payloadPreparation","contractOperation"].includes(key)) || !["base89-v1","base90-v1","base91-v1","base90-block-v2"].includes(prepared.transportProfile as string) || prepared.shellBootEncoding !== "base64" || prepared.shellBootCompression !== undefined && prepared.shellBootCompression !== "gzip" && prepared.shellBootCompression !== "none" || prepared.payloadPreparation !== "build-time" || prepared.contractOperation !== "verified-copy")) throw new TypeError("Invalid prepared dense COPY audit.");
  let binary = 0, carried = 0;
  for (const value of audit.payloads) {
    const payload = object(value);
    if (typeof payload.id !== "string" || payload.id.length > 512 || typeof payload.mediaType !== "string" || payload.mediaType.length > 128
        || !Number.isSafeInteger(payload.binaryBytes) || (payload.binaryBytes as number) <= 0 || (payload.binaryBytes as number) > MAX_BYTES
        || !Number.isSafeInteger(payload.textCarriageBytes) || (payload.textCarriageBytes as number) <= 0 || (payload.textCarriageBytes as number) > MAX_BYTES
        || payload.requiresExistingPreparedReuse !== false || typeof payload.directImage !== "boolean") throw new TypeError("Invalid fresh payload record.");
    const rawText = payload.encoding === "text" && payload.compression === "none" && payload.binaryBytes === payload.textCarriageBytes;
    const imageMedia = payload.mediaType.toLowerCase().split(";", 1)[0]!;
    const image = payload.encoding === "base64" && payload.compression === "none" && payload.directImage === true
      && ["image/png", "image/gif", "image/jpeg", "image/webp", "image/avif"].includes(imageMedia)
      && payload.textCarriageBytes === Math.ceil((payload.binaryBytes as number) / 3) * 4;
    const dense = payload.encoding === "dense" && prepared !== undefined && payload.transportProfile === prepared.transportProfile && payload.compression === "container-bound" && payload.directImage === false;
    if (!rawText && !image && !dense) throw new TypeError("Fresh payload audit contains a newly encoded body.");
    binary += payload.binaryBytes as number; carried += payload.textCarriageBytes as number;
  }
  if (binary !== audit.packedPayloadBytes || carried !== audit.payloadTextCarriageBytes || carried - binary !== audit.addedTextBytes) throw new TypeError("Fresh payload carriage totals disagree.");
}

/** Measurements from the complete token return, not the compressed pack total. */
export async function auditKeelInlineTokenURI(tokenURI: string) {
  if (typeof tokenURI !== "string" || encoder.encode(tokenURI).length > MAX_BYTES) throw new RangeError("Complete tokenURI exceeds the inspection limit.");
  const json = decodeKeelInlineDataURI(tokenURI, "application/json");
  const metadata = object(JSON.parse(decoder.decode(json)));
  const html = decodeKeelInlineDataURI(metadata.animation_url, "text/html");
  const image = decodeKeelInlineDataURI(metadata.image, "image/");
  const imageURI = metadata.image as string;
  const imageMedia = imageURI.slice(5, imageURI.indexOf(",")).split(";", 1)[0]!;
  assertKeelInlineImageBytes(image, imageMedia);
  const carriage = inspectKeelInlinePayloadCarriage(html);
  return Object.freeze({ schema: "keel-inline-token-audit@1" as const,
    completeTokenURIBytes: encoder.encode(tokenURI).length, metadataBytes: json.length,
    htmlBytes: html.length, imageBytes: image.length,
    completeDocumentBase64Layers: Number(/^data:application\/json[^,]*;base64,/iu.test(tokenURI))
      + Number(/^data:text\/html[^,]*;base64,/iu.test(metadata.animation_url as string)),
    tokenURIIntegrity: await createIntegrity(encoder.encode(tokenURI)), htmlIntegrity: await createIntegrity(html), carriage,
    freshPayloadPolicySatisfied: !carriage.requiresExistingPreparedReuse,
    freshPreparedCopyPolicySatisfied: !carriage.requiresExistingPreparedReuse,
    payloadPolicyScope: "prepared-copy-representation" as const,
    onchainStorage: { status: "not-inspected" as const, storedBytes: null, duplicateEncodedCopy: null,
      explanation: "Returned Base64/hex may be emitted from native Hold bytes at read time. Verify object records, carrier bytes and the upload inventory before claiming stored duplication or storage savings." },
    browserVerified: false as const });
}
