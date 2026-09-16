/**
 * Collector-facing presentation policy.
 *
 * Storage and presentation are separate, but a collector-facing Inline token
 * must still be directly readable by a marketplace. This policy is shared by
 * the SDK, MCP and release scripts so an external locator cannot slip in
 * through a convenience helper.
 */

const INLINE_HTML_PREFIX = "data:text/html;charset=utf-8,";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

/**
 * Validate the source container before it becomes a collector-facing image.
 * This deliberately checks the media container, not its pixels: the source
 * digest and exact public-chain read-back remain the authority for content.
 * In particular, a short placeholder such as `AA==` is not an image.
 */
export function assertKeelInlineImageBytes(bytes: Uint8Array, mediaType: string, label = "Inline image"): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new TypeError(`${label} source bytes cannot be empty.`);
  }
  switch (mediaType.toLowerCase()) {
    case "image/png":
      if (!startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        throw new TypeError(`${label} is not a PNG source.`);
      }
      return;
    case "image/webp":
      if (bytes.byteLength < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
        throw new TypeError(`${label} is not a WebP source.`);
      }
      return;
    case "image/avif": {
      const brands = bytes.byteLength >= 16 && ascii(bytes, 4, 4) === "ftyp"
        ? ascii(bytes, 8, Math.min(32, bytes.byteLength - 8))
        : "";
      if (!brands.includes("avif") && !brands.includes("avis")) {
        throw new TypeError(`${label} is not an AVIF source.`);
      }
      return;
    }
    case "image/jpeg":
      if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        throw new TypeError(`${label} is not a JPEG source.`);
      }
      return;
    case "image/gif": {
      if (bytes.byteLength < 14 || (ascii(bytes, 0, 6) !== "GIF87a" && ascii(bytes, 0, 6) !== "GIF89a")) {
        throw new TypeError(`${label} is not a GIF source.`);
      }
      const width = bytes[6]! | (bytes[7]! << 8);
      const height = bytes[8]! | (bytes[9]! << 8);
      if (width === 0 || height === 0 || bytes[bytes.byteLength - 1] !== 0x3b) {
        throw new TypeError(`${label} does not contain a complete GIF canvas and trailer.`);
      }
      return;
    }
    case "image/svg+xml":
      if (!/<svg(?:\s|\/?>)/iu.test(decoder.decode(bytes))) {
        throw new TypeError(`${label} is not an SVG source.`);
      }
      return;
    default:
      throw new TypeError(`${label} uses an unsupported image media type.`);
  }
}

function exactBase64ImageBytes(value: string, label: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError(`${label} has an invalid Base64 payload.`);
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (Buffer.from(bytes).toString("base64") !== value) throw new TypeError(`${label} is not canonical Base64.`);
  return bytes;
}

export type KeelPresentationPolicy = "collector-inline" | "external-resolver" | "raw-artifact";

/**
 * The prepared media boundary used by collector-facing Inline viewers.
 *
 * Source bytes are validated and Base64-carried once during preparation. A
 * publisher may store `payloadBytes` (or the complete `uri`) as one exact
 * ASCII resource. A contract/viewer must only copy that prepared carriage;
 * it must not Base64-encode or decode media while serving tokenURI.
 */
export interface KeelPreparedInlineImageCarriage {
  readonly mediaType: string;
  readonly header: string;
  readonly payload: string;
  readonly payloadBytes: Uint8Array;
  readonly sourceByteLength: number;
  readonly sourceBytes: Uint8Array;
  readonly uri: string;
}

/**
 * Prepare a direct raster image carriage once, with exact source validation.
 * SVG remains the separate raw-percent text-media route. This helper exists so
 * SDK, MCP and contract publishers share the same default instead of each
 * deciding where to encode a GIF independently.
 */
export function prepareKeelInlineImageCarriage(
  bytes: Uint8Array,
  mediaType: string,
  label = "Inline image",
): KeelPreparedInlineImageCarriage {
  if (mediaType.toLowerCase() === "image/svg+xml") {
    throw new TypeError(`${label} SVG must use the raw-percent text-media route.`);
  }
  assertKeelInlineImageBytes(bytes, mediaType, label);
  const sourceBytes = Uint8Array.from(bytes);
  const payload = Buffer.from(sourceBytes).toString("base64");
  const payloadBytes = Uint8Array.from(Buffer.from(payload, "ascii"));
  /* Decode immediately so a later publisher cannot carry a truncated or
     non-canonical payload while still claiming the source digest. */
  const decoded = exactBase64ImageBytes(payload, `${label} prepared payload`);
  if (!Buffer.from(decoded).equals(Buffer.from(sourceBytes))) {
    throw new TypeError(`${label} prepared payload does not round-trip to the source bytes.`);
  }
  const header = `data:${mediaType};base64,`;
  return {
    mediaType,
    header,
    payload,
    payloadBytes,
    sourceByteLength: sourceBytes.byteLength,
    sourceBytes,
    uri: `${header}${payload}`,
  };
}

function assertDataURI(value: string, label: string, prefix: string): void {
  if (!value.startsWith(prefix)) throw new TypeError(`${label} must be a self-contained ${prefix} URI.`);
  const comma = value.indexOf(",");
  const minimumComma = prefix.endsWith(",") ? prefix.length - 1 : prefix.length;
  if (comma < minimumComma) throw new TypeError(`${label} is not a complete data URI.`);
  const header = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  const base64 = /;base64$/iu.test(header);
  const mediaType = header.replace(/;base64$/iu, "");
  if (base64) {
    const bytes = exactBase64ImageBytes(payload, `${label} Base64 payload`);
    assertKeelInlineImageBytes(bytes, mediaType, label);
    return;
  }
  if (mediaType.startsWith("image/") && mediaType !== "image/svg+xml") {
    throw new TypeError(`${label} raster bytes must use the canonical exact Base64 image carriage.`);
  }
  for (let index = 0; index < payload.length; index += 1) {
    const code = payload.charCodeAt(index);
    if ((code >= 0x21 && code <= 0x7e) || code === 0x20 || code === 0x09) {
      if (code === 0x25 && !/^[0-9a-f]{2}$/iu.test(payload.slice(index + 1, index + 3))) {
        throw new TypeError(`${label} contains a percent sign that is not escaped.`);
      }
      if (code === 0x25) index += 2;
      continue;
    }
    throw new TypeError(`${label} contains a non-URI-safe character.`);
  }
  if (mediaType === "image/svg+xml") {
    try {
      assertKeelInlineImageBytes(encoder.encode(decodeURIComponent(payload)), mediaType, label);
    } catch (error) {
      if (error instanceof TypeError && error.message.startsWith(`${label} `)) throw error;
      throw new TypeError(`${label} contains invalid SVG source bytes.`);
    }
  }
}

/**
 * Enforce the default marketplace-facing Inline envelope.
 *
 * This does not claim that bytes were published. The caller must still verify
 * the canonical shell, receipts, exact object bytes and public-chain tokenURI.
 */
export function assertKeelCollectorInlineMetadata(
  metadata: Readonly<Record<string, unknown>>,
  options: { readonly requireCanonicalShell?: boolean } = {},
): void {
  const image = metadata.image;
  const animation = metadata.animation_url;
  if (typeof image !== "string") throw new TypeError("Collector Inline metadata must include image.");
  if (typeof animation !== "string") throw new TypeError("Collector Inline metadata must include animation_url.");
  if (/^(?:https?|ipfs|ar|web3|keel-onchain):/iu.test(image)) throw new TypeError("Collector Inline image cannot be an external locator.");
  if (/^(?:https?|ipfs|ar|web3|keel-onchain):/iu.test(animation)) throw new TypeError("Collector Inline animation_url cannot be an external locator.");
  assertDataURI(image, "Collector Inline image", "data:image/");
  if (!animation.startsWith(INLINE_HTML_PREFIX)) {
    throw new TypeError("Collector Inline animation_url must be the raw-percent data:text/html;charset=utf-8 URI.");
  }
  if (animation.startsWith("data:text/html;base64,")) {
    throw new TypeError("Collector Inline animation_url cannot use the legacy complete-HTML Base64 carriage.");
  }
  assertDataURI(animation, "Collector Inline animation_url", INLINE_HTML_PREFIX);
  let html: string;
  try {
    html = decodeURIComponent(animation.slice(INLINE_HTML_PREFIX.length));
  } catch {
    throw new TypeError("Collector Inline animation_url contains invalid percent encoding.");
  }
  if (html.length === 0) throw new TypeError("Collector Inline animation_url cannot be empty.");
  if (options.requireCanonicalShell !== false && !html.includes("verify-corner")) {
    throw new TypeError("Collector Inline animation_url does not contain the registered canonical KEEL verification shell.");
  }
  /* Protocol names may appear in the shell's explanatory verifier code, but
     actual resource tags must not reach off-chain files or gateways. Inline
     collectors get only data URIs, fragment links, or inert blank targets. */
  const resourceTag = /<(?:img|iframe|script|link|video|audio|source|object|embed|form)\b[^>]+\b(?:src|href|action|poster|data-src|data-href)\s*=\s*["'](?!data:|#|about:blank|javascript:)[^"']+/iu;
  const externalCss = /\burl\(\s*["']?(?:https?|ipfs|ar|web3|file):/iu;
  if (resourceTag.test(html) || externalCss.test(html)) {
    throw new TypeError("Collector Inline animation_url contains an external or relative resource reference.");
  }
}

export const KEEL_COLLECTOR_INLINE_DEFAULTS = Object.freeze({
  policy: "collector-inline" as const,
  image: "self-contained data:image/* URI",
  imageStorage: "prepare the exact media carriage once; publish one ASCII payload or complete URI, never raw-plus-encoded duplicates",
  imageBoundary: "build and validate data:image/<type>;base64,<payload> before publication; tokenURI only copies header/payload/footer",
  gif: "direct data:image/gif;base64 URI from the exact GIF; never runtime Base64, an SVG wrapper or a placeholder",
  animation: INLINE_HTML_PREFIX,
  carriage: "raw-percent" as const,
  shell: "registered keel-verification-shell" as const,
  externalResolvers: false,
});
