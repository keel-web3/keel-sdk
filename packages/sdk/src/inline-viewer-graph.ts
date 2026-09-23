/**
 * Node-only planner for a modular Inline KEEL viewer.
 *
 * Shared shell/module fragments are published once per chain. A creator root
 * references those immutable objects and publishes only its small entry slot.
 * This file prepares and verifies bytes; it never signs or submits.
 */
import {
  assertDataUriMediaType,
  createIntegrity,
  isDataUriLiteralByte,
  serializeScriptJSON,
  toPercentDataUrl,
  type Hex,
  type Integrity,
} from "@keel/protocol";
import { promisify } from "node:util";
import { gunzip, gunzipSync, inflate, inflateSync } from "node:zlib";
import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

import { KEEL_INLINE_MAX_TOKEN_URI_BYTES, keelWeb3ObjectURI, resolveKeelInlineCarriage, type KeelInlineCarriage } from "./presentation.js";
import { assertKeelCollectorInlineMetadata, assertKeelInlineImageBytes, prepareKeelInlineImageCarriage, type KeelPresentationPolicy } from "./collector-policy.js";
import { KEEL_CREATIVE_RUNTIME_CATALOG } from './creative-runtime-catalog.js';
import {
  KEEL_ASSET_DISPLAY_MEDIA_TYPES,
  KEEL_ASSET_DISPLAY_MODULE_ID,
  KEEL_ASSET_DISPLAY_MODULE_VERSION,
  keelAssetDisplayKind,
  keelAssetDisplayModuleBytes,
  type KeelAssetDisplayKind,
  type KeelAssetDisplayMediaType,
} from "./asset-display.js";
import {
  buildCompactInlineKeelShell,
  buildEmbeddedKeelViewerSlot,
  type KeelStandaloneViewerItem,
} from "./verification-shell.js";
import { orderKeelModules, type KeelModulePhase } from "./data-layer.js";
import { KEEL_INLINE_PROTECTION_SHELL_ID } from "./shell-registry.js";

export {
  KEEL_ASSET_DISPLAY_MEDIA_TYPES,
  KEEL_ASSET_DISPLAY_MODULE_ID,
  KEEL_ASSET_DISPLAY_MODULE_VERSION,
  keelAssetDisplayKind,
  keelAssetDisplayModuleBytes,
};
export type { KeelAssetDisplayKind, KeelAssetDisplayMediaType };

function isCanonicalBase64Text(value: string): boolean {
  if (value.length % 4 !== 0) return false;
  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x3d) {
      if (index < value.length - 2) return false;
      padding += 1;
      continue;
    }
    if (padding !== 0) return false;
    const alphabet = (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2b
      || code === 0x2f;
    if (!alphabet) return false;
  }
  return padding <= 2;
}

export interface KeelComposableBase64Fragment {
  /** UTF-8/binary byte length before harmless boundary padding. */
  readonly rawByteLength: number;
  /** Harmless raw bytes appended before the one build-time Base64 encode. */
  readonly paddingBytes: 0 | 1 | 2;
  /** RFC 4648 text forming an exact slice of the outer Base64 document. */
  readonly base64: string;
}

function assertWellFormedUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError("Composable text contains an unpaired high surrogate.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("Composable text contains an unpaired low surrogate.");
    }
  }
}

/**
 * Prepare one exact slice of a larger Base64 stream. This is a build-only
 * operation: contracts store/copy the returned ASCII and never encode it.
 */
export function createComposableBase64Fragment(
  raw: Uint8Array | string,
  options: {
    readonly mustAllowFollowingFragment?: boolean;
    readonly paddingStrategy?: "space" | "json-whitespace";
  } = {},
): KeelComposableBase64Fragment {
  if (typeof raw === "string") assertWellFormedUnicode(raw);
  if (!(typeof raw === "string" || raw instanceof Uint8Array)) {
    throw new TypeError("A composable fragment must be UTF-8 text or Uint8Array bytes.");
  }
  const bytes = typeof raw === "string" ? encoder.encode(raw) : raw.slice();
  const mustAlign = options.mustAllowFollowingFragment ?? true;
  const missing = mustAlign ? (3 - (bytes.byteLength % 3)) % 3 : 0;
  const paddingBytes = missing as 0 | 1 | 2;
  if (paddingBytes !== 0 && options.paddingStrategy !== undefined
      && options.paddingStrategy !== "space" && options.paddingStrategy !== "json-whitespace") {
    throw new TypeError("Unsupported composable-fragment padding strategy.");
  }
  const aligned = paddingBytes === 0 ? bytes : concat([bytes, encoder.encode(" ".repeat(paddingBytes))]);
  const base64 = Buffer.from(aligned).toString("base64");
  if (!isCanonicalBase64Text(base64) || (mustAlign && (aligned.byteLength % 3 !== 0 || base64.includes("=")))) {
    throw new Error("Composable Base64 fragment failed its RFC 4648 alignment invariant.");
  }
  return { rawByteLength: bytes.byteLength, paddingBytes, base64 };
}

/** Escape JSON for a raw script-text slot before UTF-8 sizing/alignment. */
export function serializeInlineScriptJSON(value: unknown): string {
  return serializeScriptJSON(value);
}

/** Validate and join fragments without decoding or re-encoding any payload. */
export function concatenateComposableBase64Fragments(
  fragments: readonly KeelComposableBase64Fragment[],
): string {
  if (fragments.length === 0) return "";
  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index]!;
    if (!Number.isSafeInteger(fragment.rawByteLength) || fragment.rawByteLength < 0
        || !Number.isSafeInteger(fragment.paddingBytes) || fragment.paddingBytes < 0 || fragment.paddingBytes > 2
        || !isCanonicalBase64Text(fragment.base64)) {
      throw new TypeError(`Malformed composable Base64 fragment at index ${index}.`);
    }
    if (index < fragments.length - 1 && fragment.base64.includes("=")) {
      throw new TypeError(`Non-terminal composable Base64 fragment ${index} contains padding.`);
    }
  }
  return fragments.map((fragment) => fragment.base64).join("");
}

export interface KeelInlineFragmentBytes {
  readonly bytes: Uint8Array;
  readonly integrity: Integrity;
}

export interface KeelPublishedInlineFragment extends KeelInlineFragmentBytes {
  readonly carrier: {
    readonly chainId: number;
    readonly store: Hex;
    readonly objectId: Hex;
    readonly mediaType: string;
    readonly compression: "none";
    readonly storedByteLength: number;
  };
}

export interface KeelInlineShellFragments {
  readonly schema: "keel-inline-shell-fragments@1";
  readonly codecProfile: "browser-gzip-deflate";
  readonly prefix: KeelInlineFragmentBytes;
  readonly suffix: KeelInlineFragmentBytes;
}

export interface KeelInlineModuleFragment extends KeelInlineFragmentBytes {
  readonly schema: "keel-inline-module-fragment@1";
  readonly moduleId: string;
  readonly version: string;
  readonly execution: "classic" | "module";
  readonly phase: KeelModulePhase;
  readonly weight: number;
  readonly item: KeelStandaloneViewerItem;
}

export type KeelInlineAssetDisplayModuleFragment = KeelInlineModuleFragment & {
  readonly moduleId: typeof KEEL_ASSET_DISPLAY_MODULE_ID;
  readonly version: typeof KEEL_ASSET_DISPLAY_MODULE_VERSION;
};

export type KeelInlineDocumentPart = {
  readonly kind: "existing";
  readonly role: "shell-prefix" | "module" | "entrypoint" | "shell-suffix";
  readonly moduleId?: string;
  readonly moduleVersion?: string;
  readonly execution?: "classic" | "module";
  readonly phase?: KeelModulePhase;
  readonly weight?: number;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly integrity: Integrity;
} | {
  readonly kind: "creator";
  readonly role: "entrypoint" | "asset";
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly integrity: Integrity;
};

export interface KeelInlineGraphDocument {
  readonly rootBytes: Uint8Array;
  readonly rootIntegrity: Integrity;
  readonly byteLength: number;
  readonly parts: readonly KeelInlineDocumentPart[];
}

export interface KeelInlineLocalDocument extends KeelInlineGraphDocument {
  readonly schema: "keel-inline-local-document@1";
}

/**
 * Canonical composition for one normal image, video, or GLB. The shell and
 * asset-display module are reusable objects; the sole creator object is
 * the artist's original media asset.
 */
export interface KeelInlineNormalMediaDocument extends KeelInlineGraphDocument {
  readonly schema: "keel-inline-normal-media-document@1";
  readonly declaration: {
    readonly shellId: typeof KEEL_INLINE_PROTECTION_SHELL_ID;
    readonly assetDisplay: {
      readonly moduleId: typeof KEEL_ASSET_DISPLAY_MODULE_ID;
      readonly version: typeof KEEL_ASSET_DISPLAY_MODULE_VERSION;
      readonly integrity: Integrity;
    };
    readonly creatorAsset: {
      readonly id: string;
      readonly mediaType: KeelAssetDisplayMediaType;
      readonly integrity: Integrity;
    };
  };
}

export interface KeelInlinePreEncodedTokenURIFragment extends KeelInlineFragmentBytes {
  readonly role: "shell-prefix" | "module" | "entrypoint" | "asset" | "shell-suffix";
  readonly sourceKind: "existing" | "creator";
  readonly sourceObjectId?: Hex;
  readonly sourceIntegrity: Integrity;
  readonly decodedHtmlBytes: Uint8Array;
}

/**
 * Static middle of an ERC-721 Base64 JSON tokenURI. Its bytes are themselves
 * Base64 text and can be copied directly between aligned, dynamically encoded
 * JSON prefix/suffix fragments without re-encoding the complete viewer.
 */
export interface KeelInlinePreEncodedTokenURIGraph {
  readonly schema: "keel-inline-preencoded-token-uri@1";
  readonly mediaType: "application/vnd.keel.token-uri-base64-fragment";
  readonly contextParameter: "keel-context";
  readonly contextDelivery: "base64-html-tail";
  readonly fragmentBytes: Uint8Array;
  readonly fragmentIntegrity: Integrity;
  readonly htmlBytes: Uint8Array;
  readonly htmlIntegrity: Integrity;
  readonly creatorPublicationBytes: number;
  readonly parts: readonly KeelInlinePreEncodedTokenURIFragment[];
}

export interface KeelInlineEscapedTokenURIFragment extends KeelInlineFragmentBytes {
  readonly role: "shell-prefix" | "module" | "entrypoint" | "asset" | "shell-suffix";
  readonly sourceKind: "existing" | "creator";
  readonly sourceObjectId?: Hex;
  readonly sourceIntegrity: Integrity;
  /** Exact HTML bytes after the harmless fragment-alignment comment. */
  readonly decodedHtmlBytes: Uint8Array;
  /** URI-safe ASCII copied into the animation_url after the outer JSON decode. */
  readonly escapedHtmlBytes: Uint8Array;
}

/**
 * Storage-minimal prepared graph. The contract still copies RFC 4648 Base64
 * slices into the outer JSON tokenURI, but decoding that JSON reveals a
 * percent-carried HTML animation URL rather than another Base64 document.
 * Embedded gzip/Base64 resource strings remain literal (`+`, `/`, and `=` do
 * not expand) and only parser-significant bytes are escaped.
 */
export interface KeelInlineEscapedTokenURIGraph {
  readonly schema: "keel-inline-escaped-token-uri@1";
  readonly mediaType: "application/vnd.keel.token-uri-percent-fragment";
  readonly contextParameter: "keel-context";
  readonly contextDelivery: "percent-html-tail";
  readonly fragmentBytes: Uint8Array;
  readonly fragmentIntegrity: Integrity;
  readonly htmlBytes: Uint8Array;
  readonly htmlIntegrity: Integrity;
  readonly escapedHtmlBytes: Uint8Array;
  readonly creatorPublicationBytes: number;
  readonly parts: readonly KeelInlineEscapedTokenURIFragment[];
}

export interface KeelInlineRawPercentTokenURIFragment extends KeelInlineFragmentBytes {
  readonly role: "shell-prefix" | "module" | "entrypoint" | "asset" | "shell-suffix";
  readonly sourceKind: "existing" | "creator";
  readonly sourceObjectId?: Hex;
  readonly sourceIntegrity: Integrity;
  /** Exact verified HTML bytes. */
  readonly decodedHtmlBytes: Uint8Array;
  /** Percent-carried HTML bytes that become the animation_url payload. */
  readonly escapedHtmlBytes: Uint8Array;
  /** Outer percent-carried bytes copied directly into the metadata data URI. */
  readonly encodedMetadataBytes: Uint8Array;
}

/**
 * Raw KeelHold carriage for large immutable Inline works. The metadata data
 * URI itself is percent-carried, so neither the HTML document nor the complete
 * JSON envelope receives an additional Base64 layer.
 */
export interface KeelInlineRawPercentTokenURIGraph {
  readonly schema: "keel-inline-raw-percent-token-uri@1";
  readonly mediaType: "application/vnd.keel.token-uri-raw-percent-fragment";
  readonly contextParameter: "keel-context";
  readonly contextDelivery: "percent-html-tail";
  readonly fragmentBytes: Uint8Array;
  readonly fragmentIntegrity: Integrity;
  readonly htmlBytes: Uint8Array;
  readonly htmlIntegrity: Integrity;
  readonly escapedHtmlBytes: Uint8Array;
  readonly creatorPublicationBytes: number;
  readonly parts: readonly KeelInlineRawPercentTokenURIFragment[];
}

export interface KeelInlineTokenURICarriageComparison {
  readonly schema: "keel-inline-token-uri-carriage-comparison@1";
  readonly preferred: "base64" | "percent";
  readonly base64StorageBytes: number;
  readonly percentStorageBytes: number;
  /** Positive when the preferred carriage stores fewer graph bytes. */
  readonly savingsBytes: number;
  readonly savingsPercent: number;
  readonly base64: KeelInlinePreEncodedTokenURIGraph;
  readonly percent: KeelInlineEscapedTokenURIGraph;
}

/**
 * Immutable work/module body stored without a shell boundary. The active
 * KeelHarnessBuilder wraps these bytes with the current canonical shell during
 * `preparedTokenURI`, so already-minted default viewers follow reviewed shell
 * updates. Creators that need a frozen presentation should publish the full
 * `KeelInlinePreEncodedTokenURIGraph` instead.
 */
export interface KeelInlinePreEncodedTokenURIBodyGraph {
  readonly schema: "keel-inline-preencoded-token-uri-body@1";
  readonly mediaType: "application/vnd.keel.token-uri-base64-body-fragment";
  readonly shellSelection: "follow-latest";
  readonly shellId: typeof KEEL_INLINE_PROTECTION_SHELL_ID;
  readonly fragmentBytes: Uint8Array;
  readonly fragmentIntegrity: Integrity;
  readonly htmlBytes: Uint8Array;
  readonly htmlIntegrity: Integrity;
  readonly creatorPublicationBytes: number;
  readonly parts: readonly KeelInlinePreEncodedTokenURIFragment[];
}

/**
 * Build-time carrier for an immutable prepared tokenURI. The chain stores the
 * `fragmentBytes` as an uncompressed Keel object and copies those bytes between
 * the small outer Base64 prefix/suffix. The decoded HTML is padded only with
 * legal trailing spaces so both Base64 layers remain exactly aligned.
 */
export interface KeelPreparedTokenURIFragment {
  readonly schema: "keel-prepared-token-uri-fragment@1";
  readonly mediaType: "application/vnd.keel.token-uri-base64-fragment";
  readonly sourceByteLength: number;
  readonly sourceIntegrity: Integrity;
  readonly htmlBytes: Uint8Array;
  readonly htmlIntegrity: Integrity;
  readonly fragmentBytes: Uint8Array;
  readonly fragmentIntegrity: Integrity;
}

export interface KeelPreparedOneOfOneTokenURI {
  readonly schema: "keel-prepared-one-of-one-token-uri@1";
  readonly animationEncoding: "base64" | "percent" | "raw-percent";
  readonly requiredBuilder: "KeelHarnessBuilder" | "KeelPercentTokenURIBuilder" | "KeelRawTokenURIBuilder";
  readonly encodedPrefix: Uint8Array;
  readonly encodedSuffix: Uint8Array;
  readonly tokenURI: string;
  readonly tokenJSON: string;
  readonly contextJSON: string;
  readonly contextDigest: Hex;
  readonly derivedTokenSeed: Hex;
}

export interface KeelOnchainShellLoaderInput {
  /** Public, CORS-enabled JSON-RPC endpoint used only to read the committed shell. */
  readonly rpcUrl: string;
  /** The deployed KeelHarnessBuilder that owns the committed shell object. */
  readonly builder: Hex;
  /** The existing uncompressed shell object root. */
  readonly objectId: Hex;
  /** SHA-256 digest committed for the shell object. */
  readonly digest: Hex;
  /**
   * Optional immutable token context. Supplying it makes the loader
   * independent of a contract-side context injector, which is useful with
   * the legacy `setOnchainHarness` route. The object is serialized through
   * the same script-safe JSON boundary as every other inline value.
   */
  readonly context?: {
    readonly json: string;
    readonly digest: Hex;
    readonly byteLength: number;
  };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const SAFE_INLINE_MODULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
// Arweave locators carry an authority or a 32-byte base64url transaction ID.
// A minified JS ternary such as `ready ? ar : 1` is not a content locator.
const EXTERNAL_RESOURCE_LITERAL = /\b(?:(?:https?|ipfs|web3|keel-onchain):[^\s"'<>\\]+|ar:(?:\/\/[^\s"'<>\\]+|[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])(?:\/[^\s"'<>\\]*)?))/giu;

/** Shared library bytes are not creator resources. Match the full pinned artifact. */
async function assertInlineModuleDependencies(bytes: Uint8Array, moduleId: string): Promise<void> {
  const candidates: Array<{ id: string; integrity: Integrity | null }> = KEEL_CREATIVE_RUNTIME_CATALOG.flatMap(runtime => runtime.resources.filter(resource => resource.referenceStatus === 'active'));
  if (moduleId === 'keel-layered-runtime-v4') {
    const generated = './layered-runtime-info.js';
    const { LAYERED_RUNTIME } = await import(generated);
    candidates.push(LAYERED_RUNTIME);
  }
  const candidate = candidates.find(resource => resource.id === moduleId && resource.integrity !== null);
  if (candidate?.integrity) {
    const actual = await createIntegrity(bytes);
    if (actual.digest === candidate.integrity.digest && actual.byteLength === candidate.integrity.byteLength) return;
    throw new TypeError(`Inline shared runtime ${moduleId} differs from its pinned artifact.`);
  }
  assertKeelInlineNoExternalDependencies(bytes, 'Inline module ' + moduleId);
}

/**
 * Reject concrete network/content locators in creator-owned Inline bytes.
 *
 * Checkers inspect the decoded contents of embedded gzip/deflate slots, so a
 * URL hidden inside a packed JavaScript module is still an external
 * dependency. The SVG namespace is syntax rather than a fetchable resource;
 * it is the sole protocol URL allowed in creator bytes. Onchain content
 * runtimes must use their injected content reader and a path/identifier, not
 * a URL sentinel.
 */
export function assertKeelInlineNoExternalDependencies(
  bytes: Uint8Array,
  label = "Inline creator resource",
): void {
  const found = new Set<string>();
  const visited = new Set<string>();
  const inspect = (candidate: Uint8Array, depth: number): void => {
    let text: string;
    try {
      text = decoder.decode(candidate);
    } catch {
      return;
    }
    const key = `${depth}:${text}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (depth < 4) {
      try {
        const percentDecoded = decodeURIComponent(text);
        if (percentDecoded !== text) inspect(encoder.encode(percentDecoded), depth + 1);
      } catch {
        // A non-percent text layer is checked as-is.
      }
    }
    if (/keel\.invalid/iu.test(text)) found.add("keel.invalid");
    for (const match of text.matchAll(EXTERNAL_RESOURCE_LITERAL)) {
      const value = match[0].replace(/[),.;]+$/u, "");
      if (value !== "http://www.w3.org/2000/svg") found.add(value);
    }
    if (depth >= 4) return;
    for (const match of text.matchAll(/storedBase64["']?\s*:\s*["']([A-Za-z0-9+/=]+)["']/gu)) {
      const stored = Buffer.from(match[1]!, "base64");
      for (const unpack of [
        () => gunzipSync(stored),
        () => inflateSync(stored),
      ]) {
        try {
          inspect(new Uint8Array(unpack()), depth + 1);
          break;
        } catch {
          // The slot may use the other supported compression.
        }
      }
    }
  }
  inspect(bytes, 0);
  if (found.size > 0) {
    throw new TypeError(label + " contains external resource locator(s): " + [...found].slice(0, 4).join(", "));
  }
}

function base64Bytes(bytes: Uint8Array): Uint8Array {
  return encoder.encode(Buffer.from(bytes).toString("base64"));
}

function exactBase64Bytes(value: string, label: string): Uint8Array {
  if (!isCanonicalBase64Text(value)) throw new TypeError(`${label} is not canonical RFC 4648 Base64.`);
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (Buffer.from(bytes).toString("base64") !== value) throw new TypeError(`${label} is not canonical RFC 4648 Base64.`);
  return bytes;
}

export function decodeKeelInlineGraphFragment(bytes: Uint8Array, mediaType: string): Uint8Array {
  if (mediaType === "application/vnd.keel.token-uri-raw-percent-fragment") {
    return exactPercentPayloadBytes(exactPercentPayloadBytes(bytes, "Inline metadata fragment"), "Inline HTML fragment");
  }
  const outer = exactBase64Bytes(decoder.decode(bytes), "Published Inline fragment");
  if (mediaType === "application/vnd.keel.token-uri-percent-fragment") {
    return exactPercentPayloadBytes(outer, "Inline HTML fragment");
  }
  if (mediaType !== "application/vnd.keel.token-uri-base64-fragment"
      && mediaType !== "application/vnd.keel.token-uri-base64-body-fragment") {
    throw new TypeError(`Unsupported Inline fragment media type: ${mediaType}`);
  }
  return exactBase64Bytes(decoder.decode(outer), "Published Inline decoded HTML fragment");
}

function decodePublishedGraphPart(fragment: KeelPublishedInlineFragment): Uint8Array {
  return decodeKeelInlineGraphFragment(fragment.bytes, fragment.carrier.mediaType);
}

async function assertPublishedFragmentIntegrity(fragment: KeelPublishedInlineFragment, label: string): Promise<void> {
  if (
    fragment.carrier.compression !== "none"
    || fragment.carrier.storedByteLength !== fragment.bytes.byteLength
    || fragment.integrity.byteLength !== fragment.bytes.byteLength
  ) {
    throw new TypeError(`${label} must be an exact uncompressed reusable fragment object.`);
  }
  const integrity = await createIntegrity(fragment.bytes);
  if (
    integrity.algorithm !== fragment.integrity.algorithm
    || integrity.digest.toLowerCase() !== fragment.integrity.digest.toLowerCase()
    || integrity.byteLength !== fragment.integrity.byteLength
  ) {
    throw new TypeError(`${label} bytes do not match their reusable object commitment.`);
  }
}

function exactStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

/**
 * Verify that a canonical published module fragment expands to the exact
 * decoded SDK module bytes. Publication must consume this stored fragment,
 * not recompress the module with the server's platform zlib implementation.
 */
export async function verifyKeelPublishedInlineModuleFragment(input: {
  readonly fragment: KeelPublishedInlineFragment;
  readonly moduleId: string;
  readonly mediaType: string;
  readonly aliases: readonly string[];
  readonly decodedBytes: Uint8Array;
}): Promise<void> {
  await assertPublishedFragmentIntegrity(input.fragment, `Inline module ${input.moduleId}`);
  const decodedHtmlBytes = decodePublishedGraphPart(input.fragment);
  const text = decoder.decode(decodedHtmlBytes);
  const trailing = text.length - text.trimEnd().length;
  const trailingText = trailing === 0 ? "" : text.slice(text.length - trailing);
  if (!text.startsWith(",") || trailing > 8 || !/^ *$/u.test(trailingText)) {
    throw new TypeError(`Inline module ${input.moduleId} is not one aligned KEEL viewer slot.`);
  }
  let item: KeelStandaloneViewerItem;
  try {
    item = JSON.parse(text.slice(1).trimEnd()) as KeelStandaloneViewerItem;
  } catch {
    throw new TypeError(`Inline module ${input.moduleId} does not contain canonical viewer-slot JSON.`);
  }
  if (
    item.id !== input.moduleId
    || item.role !== "module"
    || item.mediaType !== input.mediaType
    || !exactStringArray(item.aliases, input.aliases)
    || item.integrity.algorithm !== "sha256"
    || item.integrity.byteLength !== input.decodedBytes.byteLength
    || item.embedded === undefined
    || !["none", "gzip", "deflate"].includes(item.embedded.compression)
  ) {
    throw new TypeError(`Inline module ${input.moduleId} metadata does not match its SDK declaration.`);
  }
  const stored = exactBase64Bytes(item.embedded.storedBase64, `Inline module ${input.moduleId} payload`);
  const decoded = item.embedded.compression === "gzip"
    ? new Uint8Array(await gunzipAsync(stored))
    : item.embedded.compression === "deflate"
      ? new Uint8Array(await inflateAsync(stored))
      : stored;
  await assertInlineModuleDependencies(decoded, input.moduleId);
  const [decodedIntegrity, storedIntegrity] = await Promise.all([
    createIntegrity(decoded),
    createIntegrity(stored),
  ]);
  if (
    !exactBytes(decoded, input.decodedBytes)
    || decodedIntegrity.digest.toLowerCase() !== item.integrity.digest.toLowerCase()
    || decodedIntegrity.byteLength !== item.integrity.byteLength
    || (item.embedded.storedIntegrity !== undefined && (
      storedIntegrity.digest.toLowerCase() !== item.embedded.storedIntegrity.digest.toLowerCase()
      || storedIntegrity.byteLength !== item.embedded.storedIntegrity.byteLength
    ))
  ) {
    throw new TypeError(`Inline module ${input.moduleId} payload does not match its decoded SDK bytes.`);
  }
}

function appendSpacesToMultiple(bytes: Uint8Array, multiple: number): Uint8Array {
  const missing = (multiple - (bytes.byteLength % multiple)) % multiple;
  return missing === 0 ? bytes.slice() : concat([bytes, encoder.encode(" ".repeat(missing))]);
}

function compactPercentPayload(bytes: Uint8Array): Uint8Array {
  const compactURI = toPercentDataUrl("application/octet-stream", bytes);
  return encoder.encode(compactURI.slice(compactURI.indexOf(",") + 1));
}

function alignedPercentPayload(bytes: Uint8Array): Uint8Array {
  const compact = decoder.decode(compactPercentPayload(bytes));
  const remainder = compact.length % 3;
  // Turning one safe literal `A` into its equivalent `%41` adds two ASCII
  // bytes without changing the decoded HTML. One forced escape fixes remainder
  // 1; two fix remainder 2. This is the entire composability overhead.
  let forceEscapes = remainder === 1 ? 1 : remainder === 2 ? 2 : 0;
  if (forceEscapes === 0) return encoder.encode(compact);
  let payload = "";
  for (const byte of bytes) {
    if (isDataUriLiteralByte(byte) && forceEscapes > 0) {
      payload += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      forceEscapes -= 1;
    } else {
      payload += isDataUriLiteralByte(byte)
        ? String.fromCharCode(byte)
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  if (forceEscapes !== 0 || encoder.encode(payload).byteLength % 3 !== 0) {
    throw new Error("Escaped Inline fragment could not align at the outer Base64 boundary.");
  }
  return encoder.encode(payload);
}

function exactPercentPayloadBytes(payload: Uint8Array, label: string): Uint8Array {
  const output: number[] = [];
  for (let at = 0; at < payload.byteLength; at += 1) {
    const byte = payload[at]!;
    if (byte === 0x25) {
      if (at + 2 >= payload.byteLength) throw new TypeError(`${label} has a truncated percent escape.`);
      const pair = String.fromCharCode(payload[at + 1]!, payload[at + 2]!);
      if (!/^[0-9A-F]{2}$/u.test(pair)) throw new TypeError(`${label} has a non-canonical percent escape.`);
      output.push(Number.parseInt(pair, 16));
      at += 2;
      continue;
    }
    if (!isDataUriLiteralByte(byte)) throw new TypeError(`${label} contains an unsafe literal byte.`);
    output.push(byte);
  }
  return new Uint8Array(output);
}

/**
 * Build a small self-contained bridge to an already committed Keel shell.
 *
 * The bridge is useful when a tokenURI must stay small: it contains no project
 * host, IPFS gateway, or mutable asset URL. It performs one public JSON-RPC
 * read of `harnessHTML`, carries the prepared token context into the returned
 * document, and replaces itself with the canonical verification shell. The
 * outer tokenURI is still Base64 encoded by `buildKeelPreparedOneOfOneTokenURI`.
 */
export function buildKeelOnchainShellLoader(input: KeelOnchainShellLoaderInput): string {
  if (typeof input.rpcUrl !== "string" || input.rpcUrl.trim() === "") {
    throw new TypeError("An onchain shell loader needs a public RPC URL.");
  }
  let rpc: URL;
  try {
    rpc = new URL(input.rpcUrl);
  } catch {
    throw new TypeError("The onchain shell loader RPC URL is malformed.");
  }
  if (rpc.protocol !== "https:" || rpc.username !== "" || rpc.password !== "" || rpc.hash !== "") {
    throw new TypeError("The onchain shell loader RPC URL must be a credential-free HTTPS endpoint.");
  }
  const builder = getAddress(input.builder);
  if (!/^0x[0-9a-f]{64}$/iu.test(input.objectId) || !/^0x[0-9a-f]{64}$/iu.test(input.digest)) {
    throw new TypeError("The onchain shell loader needs canonical object and digest bytes32 values.");
  }
  const selector = keccak256(stringToHex("harnessHTML(bytes32,bytes32)")).slice(0, 10);
  const callData = `${selector}${input.objectId.slice(2)}${input.digest.slice(2)}`;
  let contextLiteral = "null";
  if (input.context !== undefined) {
    if (typeof input.context.json !== "string" || !/^0x[0-9a-f]{64}$/iu.test(input.context.digest)
        || !Number.isSafeInteger(input.context.byteLength) || input.context.byteLength < 0
        || input.context.byteLength !== encoder.encode(input.context.json).byteLength) {
      throw new TypeError("The onchain shell loader context must contain canonical JSON bytes, digest, and length.");
    }
    contextLiteral = serializeInlineScriptJSON(input.context);
  }
  const rpcLiteral = serializeInlineScriptJSON(rpc.toString());
  const builderLiteral = serializeInlineScriptJSON(builder);
  const callLiteral = serializeInlineScriptJSON(callData);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keel shell loader</title></head><body><p id="keel-loader-status">Loading committed Keel shell…</p><script>(()=>{const R=${rpcLiteral},T=${builderLiteral},D=${callLiteral},C=${contextLiteral},E=50000000;const fail=e=>{document.body.textContent="Keel shell load failed: "+(e?.message??e);document.documentElement.dataset.keelLoader="failed"};const hexBytes=h=>{if(typeof h!=="string"||!/^0x[0-9a-f]*$/i.test(h)||h.length%2!==0)throw new Error("RPC returned malformed bytes.");const a=new Uint8Array((h.length-2)/2);for(let i=0;i<a.length;i++)a[i]=Number.parseInt(h.slice(2+i*2,4+i*2),16);return a};const resultBytes=h=>{const o=Number(BigInt("0x"+h.slice(2,66))),p=2+o*2,l=Number(BigInt("0x"+h.slice(p,p+64)));return hexBytes("0x"+h.slice(p+64,p+64+l*2))};const safe=v=>{const s=String.fromCharCode(92),j=JSON.stringify(v);if(j===undefined)throw new Error("Prepared context is not JSON serializable.");return j.replaceAll("&",s+"u0026").replaceAll("<",s+"u003c").replaceAll(">",s+"u003e").replaceAll(String.fromCharCode(8232),s+"u2028").replaceAll(String.fromCharCode(8233),s+"u2029")};(async()=>{await new Promise(r=>setTimeout(r,0));const response=await fetch(R,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_call",params:[{to:T,data:D,gas:"0x"+E.toString(16)},"latest"]})});const body=await response.json();if(!response.ok||body.error||typeof body.result!=="string")throw new Error(body.error?.message??"RPC shell read failed.");const html=new TextDecoder("utf-8",{fatal:true}).decode(resultBytes(body.result));if(!html.includes("verify-corner"))throw new Error("Committed shell failed its canonical check.");const c=C??globalThis.__KEEL_ONCHAIN_CONTEXT__;if(!c||typeof c.json!=="string"||typeof c.digest!=="string"||!Number.isSafeInteger(c.byteLength))throw new Error("Prepared Keel context was not available.");const injection="<scr"+"ipt>globalThis.__KEEL_ONCHAIN_CONTEXT__=Object.freeze({json:"+safe(c.json)+",digest:"+safe(c.digest)+",byteLength:"+c.byteLength+"})</scr"+"ipt>";const head=/<head(?:\\s[^>]*)?>/i;const next=head.test(html)?html.replace(head,m=>m+injection):injection+html;document.open();document.write(next);document.close()})().catch(fail)})()</script></body></html>`;
}

/**
 * Encode one complete HTML document for KEEL's prepared tokenURI lane.
 *
 * The result is deliberately two Base64 layers: the inner layer is the HTML
 * payload and the outer layer is the exact ASCII stream copied by the
 * contract. No HTML, JSON, whitespace, delimiter, or control byte survives in
 * the published fragment, so URI readers cannot reinterpret content as syntax.
 */
export async function buildKeelPreparedTokenURIFragment(
  source: Uint8Array | string,
): Promise<KeelPreparedTokenURIFragment> {
  if (typeof source === "string") assertWellFormedUnicode(source);
  if (!(typeof source === "string" || source instanceof Uint8Array)) {
    throw new TypeError("A prepared tokenURI fragment must be UTF-8 text or Uint8Array bytes.");
  }
  const sourceBytes = typeof source === "string" ? encoder.encode(source) : source.slice();
  if (sourceBytes.byteLength === 0) throw new TypeError("A prepared tokenURI fragment cannot be empty.");
  const htmlBytes = appendSpacesToMultiple(sourceBytes, 9);
  const inner = base64Bytes(htmlBytes);
  if (inner.byteLength % 3 !== 0) {
    throw new Error("Prepared tokenURI HTML did not align at the outer Base64 boundary.");
  }
  const fragmentBytes = base64Bytes(inner);
  const fragmentText = decoder.decode(fragmentBytes);
  if (fragmentBytes.byteLength % 4 !== 0 || /=/u.test(fragmentText)) {
    throw new Error("Prepared tokenURI fragment must be unpadded RFC 4648 Base64.");
  }
  return {
    schema: "keel-prepared-token-uri-fragment@1",
    mediaType: "application/vnd.keel.token-uri-base64-fragment",
    sourceByteLength: sourceBytes.byteLength,
    sourceIntegrity: await createIntegrity(sourceBytes),
    htmlBytes,
    htmlIntegrity: await createIntegrity(htmlBytes),
    fragmentBytes,
    fragmentIntegrity: await createIntegrity(fragmentBytes),
  };
}

function tokenContextHTMLTail(contextJSON: string, contextDigest: Hex, contextByteLength: number): string {
  const contextBase64URL = Buffer.from(contextJSON, "utf8").toString("base64url");
  return `<script>(()=>{try{const v="${contextBase64URL}",b=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4),j=atob(b),c=Object.freeze(JSON.parse(j)),o=Object.freeze({json:j,digest:"${contextDigest}",byteLength:${contextByteLength}});Object.defineProperty(globalThis,"__KEEL_CONTEXT__",{value:c,enumerable:true,writable:false,configurable:false});Object.defineProperty(globalThis,"__KEEL_ONCHAIN_CONTEXT__",{value:o,enumerable:true,writable:false,configurable:false})}catch(e){document.documentElement.dataset.keelContext="failed";throw e}})()</script>`;
}

function assertMarketplaceSafeDataURI(value: string, label: string): void {
  if (!value.startsWith("data:")) return;
  const comma = value.indexOf(",");
  if (comma < 5) throw new TypeError(`${label} is not a complete data URI.`);
  const header = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  const mediaType = header.replace(/;base64$/iu, "");
  const imageMediaType = mediaType.split(";", 1)[0]!;
  assertDataUriMediaType(mediaType);
  if (mediaType !== header) {
    const bytes = exactBase64Bytes(payload, `${label} Base64 payload`);
    if (imageMediaType.startsWith("image/")) assertKeelInlineImageBytes(bytes, imageMediaType, label);
    return;
  }
  for (let at = 0; at < payload.length; at += 1) {
    const character = payload.charCodeAt(at);
    if (isDataUriLiteralByte(character)) continue;
    if (character === 0x25 && /^[0-9a-f]{2}$/iu.test(payload.slice(at + 1, at + 3))) {
      at += 2;
      continue;
    }
    throw new TypeError(`${label} contains raw text that must be percent-escaped.`);
  }
  if (imageMediaType === "image/svg+xml") {
    assertKeelInlineImageBytes(encoder.encode(decodeURIComponent(payload)), imageMediaType, label);
  } else if (imageMediaType.startsWith("image/")) {
    throw new TypeError(`${label} raster bytes must use the canonical exact Base64 image carriage.`);
  }
}

function assertPreparedImageURI(value: string): void {
  if (value.startsWith("data:")) {
    assertMarketplaceSafeDataURI(value, "Prepared token image");
    return;
  }
  if (
    /^web3:\/\/0x[0-9a-f]{40}:[1-9][0-9]*\/haulObject\/0x[0-9a-f]{64}\?mime\.type=image%2F[a-z0-9!#$&^_.+%~-]+$/iu.test(value)
  ) return;
  throw new TypeError("A prepared Inline token image must be a self-contained data URI or an exact KEEL web3 object URI.");
}

/**
 * Prepare the direct image carriage once. Raster payload text is then split
 * into its resource slot by the graph builder; a publisher or contract copies
 * that exact ASCII payload and never encodes/decodes media at read time. SVG is
 * the separate raw-percent text-media exception. GIF is never wrapped in SVG.
 */
export function buildKeelInlineImageURI(bytes: Uint8Array, mediaType: string): string {
  if (!['image/png', 'image/webp', 'image/avif', 'image/jpeg', 'image/gif', 'image/svg+xml'].includes(mediaType)) {
    throw new TypeError('Choose a supported inline image media type.');
  }
  if (!bytes.byteLength) throw new TypeError('An inline image cannot be empty.');
  assertKeelInlineImageBytes(bytes, mediaType);
  if (mediaType !== 'image/svg+xml') return prepareKeelInlineImageCarriage(bytes, mediaType).uri;
  const base64 = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
  const percent = `data:${mediaType},${decoder.decode(compactPercentPayload(bytes))}`;
  const uri = percent.length < base64.length ? percent : base64;
  assertPreparedImageURI(uri);
  return uri;
}

async function exactFragment(bytes: Uint8Array): Promise<KeelInlineFragmentBytes> {
  if (bytes.byteLength === 0) throw new TypeError("An Inline fragment cannot be empty.");
  return { bytes, integrity: await createIntegrity(bytes) };
}

/** Build the small reusable shell halves without embedding Brotli WASM. */
export async function buildKeelInlineShellFragments(input: {
  readonly repositoryRoot?: string;
} = {}): Promise<KeelInlineShellFragments> {
  const shell = await buildCompactInlineKeelShell(input);
  return {
    schema: "keel-inline-shell-fragments@1",
    codecProfile: "browser-gzip-deflate",
    prefix: await exactFragment(shell.prefix),
    suffix: await exactFragment(shell.suffix),
  };
}

/**
 * Build the exact reusable JSON slot for a browser module. Publish this slot
 * once per chain and retain its object ID with the module catalogue record.
 */
export async function buildKeelInlineModuleFragment(input: {
  readonly moduleId: string;
  readonly version: string;
  readonly mediaType: string;
  readonly aliases?: readonly string[];
  readonly decodedBytes: Uint8Array;
  readonly compression?: "none" | "gzip" | "deflate";
  readonly execution?: "classic" | "module";
  readonly phase?: KeelModulePhase;
  readonly weight?: number;
}): Promise<KeelInlineModuleFragment> {
  if (input.moduleId.trim() === "" || input.version.trim() === "") {
    throw new TypeError("An Inline module fragment needs an exact module ID and version.");
  }
  if (!SAFE_INLINE_MODULE_ID.test(input.moduleId)) {
    throw new TypeError("An Inline module fragment ID must be safe in an HTML source attribute.");
  }
  const phase = input.phase ?? "runtime";
  const execution = input.execution ?? "module";
  if (phase === "data" && execution !== "classic") {
    throw new TypeError("Inline data modules must use classic execution so they run before renderer code.");
  }
  await assertInlineModuleDependencies(input.decodedBytes, input.moduleId);
  const weight = input.weight ?? 0;
  orderKeelModules([{ moduleId: input.moduleId, phase, weight }]);
  const slot = await buildEmbeddedKeelViewerSlot({
    id: input.moduleId,
    role: phase === "data" ? "data" : "module",
    mediaType: input.mediaType,
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
    bytes: input.decodedBytes,
    compression: input.compression ?? "gzip",
  });
  return {
    schema: "keel-inline-module-fragment@1",
    moduleId: input.moduleId,
    version: input.version,
    execution,
    phase,
    weight,
    item: slot.item,
    bytes: slot.fragment,
    integrity: slot.fragmentIntegrity,
  };
}

/** Build the exact reusable normal-media renderer slot for one chain catalogue. */
export async function buildKeelInlineAssetDisplayModuleFragment(): Promise<KeelInlineAssetDisplayModuleFragment> {
  return await buildKeelInlineModuleFragment({
    moduleId: KEEL_ASSET_DISPLAY_MODULE_ID,
    version: KEEL_ASSET_DISPLAY_MODULE_VERSION,
    mediaType: "text/javascript",
    aliases: [KEEL_ASSET_DISPLAY_MODULE_ID],
    decodedBytes: keelAssetDisplayModuleBytes(),
    compression: "gzip",
    execution: "classic",
    phase: "render",
  }) as KeelInlineAssetDisplayModuleFragment;
}

function isNormalMediaEntry(mediaType: string): mediaType is KeelAssetDisplayMediaType {
  return (KEEL_ASSET_DISPLAY_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

async function assertCanonicalAssetDisplayModule(module: KeelInlineModuleFragment): Promise<void> {
  const expected = await buildKeelInlineAssetDisplayModuleFragment();
  if (
    module.moduleId !== expected.moduleId
    || module.version !== expected.version
    || module.execution !== expected.execution
    || module.phase !== expected.phase
    || module.item.role !== "module"
    || !exactBytes(module.bytes, expected.bytes)
    || module.integrity.digest.toLowerCase() !== expected.integrity.digest.toLowerCase()
  ) {
    throw new TypeError("Direct image, video, and GLB entries require the exact registered keel.asset-display module.");
  }
}

/**
 * Build the exact local document used for sandboxing and deterministic
 * fragment generation. It deliberately has no carrier identities: the only
 * publishable graph is the pre-encoded composable graph derived from it.
 */
export async function buildKeelInlineLocalDocument(input: {
  readonly shell: KeelInlineShellFragments;
  readonly modules: readonly KeelInlineModuleFragment[];
  /**
   * Creator-specific binary/data resources. These are verified by the same
   * shell as reusable modules, but remain creator parts in the publication
   * graph so artwork is never mislabeled as a once-per-chain dependency.
   */
  readonly assets?: readonly {
    readonly id: string;
    readonly mediaType: string;
    readonly source: Uint8Array;
    readonly aliases?: readonly string[];
    readonly compression?: "none" | "gzip" | "deflate";
  }[];
  readonly entry: {
    readonly id: string;
    /** Metadata background_color, or omit to match a uniform image border. */
    readonly backgroundColor?: string;
    /** Text artwork, or the direct creator media entry mounted by keel.asset-display. */
    readonly mediaType: "text/html" | "text/javascript" | KeelAssetDisplayMediaType;
    readonly source: Uint8Array;
    readonly compression?: "none" | "gzip" | "deflate";
    readonly aliases?: readonly string[];
  };
}): Promise<KeelInlineLocalDocument> {
  const orderedModules = orderKeelModules(input.modules);
  const assets = input.assets ?? [];
  const ids = new Set<string>();
  for (const module of orderedModules) {
    if (!SAFE_INLINE_MODULE_ID.test(module.moduleId) || module.item.id !== module.moduleId) {
      throw new TypeError(`Inline module ${module.moduleId} has an unsafe or mismatched resource ID.`);
    }
    if (ids.has(module.moduleId)) throw new TypeError(`Duplicate Inline resource ID ${module.moduleId}.`);
    ids.add(module.moduleId);
    if (module.item.embedded?.compression === "brotli") {
      throw new TypeError(`Inline module ${module.moduleId} requires a declared Brotli decoder shell profile.`);
    }
  }
  if (!SAFE_INLINE_MODULE_ID.test(input.entry.id) || ids.has(input.entry.id)) {
    throw new TypeError(`Inline entrypoint ${input.entry.id} has an unsafe or duplicate resource ID.`);
  }
  ids.add(input.entry.id);
  for (const asset of assets) {
    if (!SAFE_INLINE_MODULE_ID.test(asset.id) || ids.has(asset.id)) {
      throw new TypeError(`Inline asset ${asset.id} has an unsafe or duplicate resource ID.`);
    }
    if (asset.source.byteLength === 0) throw new TypeError(`Inline asset ${asset.id} cannot be empty.`);
    ids.add(asset.id);
  }
  const directMedia = isNormalMediaEntry(input.entry.mediaType);
  if (directMedia) {
    if (assets.length !== 0) {
      throw new TypeError("A direct image, video, or GLB entry cannot declare additional creator assets.");
    }
    if (orderedModules.length !== 1) {
      throw new TypeError("A direct image, video, or GLB entry requires exactly one registered keel.asset-display module.");
    }
    await assertCanonicalAssetDisplayModule(orderedModules[0]!);
  }
  const source = directMedia ? undefined : new TextDecoder("utf-8", { fatal: true }).decode(input.entry.source);
  if (input.entry.mediaType === "text/javascript" && source !== undefined && /<\/script/iu.test(source)) {
    throw new TypeError("An Inline JavaScript entry cannot contain a closing script tag.");
  }
  const dataScripts = orderedModules
    .filter((module) => module.phase === "data")
    .map((module) => `<script src="${module.moduleId}"></script>`);
  const htmlEntry = directMedia || source === undefined
    ? undefined
    : dataScripts.length === 0 ? input.entry.source : new TextEncoder().encode(
      /<head(?:\s[^>]*)?>/iu.test(source)
        ? source.replace(/<head(?:\s[^>]*)?>/iu, (head) => `${head}${dataScripts.join("")}`)
        : `<!doctype html><html><head>${dataScripts.join("")}</head><body>${source}</body></html>`,
    );
  const entrySource = directMedia
    ? input.entry.source
    : input.entry.mediaType === "text/javascript" && source !== undefined
      ? new TextEncoder().encode([
          '<div id="stage"></div>',
          ...orderedModules
            .filter((module) => module.execution === "classic")
            .map((module) => {
              return `<script src="${module.moduleId}"></script>`;
            }),
          `<script type="module">${source}</script>`,
        ].join(""))
      : htmlEntry!;
  assertKeelInlineNoExternalDependencies(entrySource, "Inline entrypoint " + input.entry.id);
  const entry = await buildEmbeddedKeelViewerSlot({
    id: input.entry.id,
    ...(input.entry.backgroundColor === undefined ? {} : { backgroundColor: input.entry.backgroundColor }),
    role: "entrypoint",
    mediaType: directMedia ? input.entry.mediaType : "text/html",
    ...(input.entry.aliases === undefined ? {} : { aliases: input.entry.aliases }),
    bytes: entrySource,
    compression: input.entry.compression ?? (directMedia ? "none" : "gzip"),
  });
  const assetSlots = await Promise.all(assets.map(async (asset) => ({
    asset,
    slot: await buildEmbeddedKeelViewerSlot({
      id: asset.id,
      role: "asset",
      mediaType: asset.mediaType,
      ...(asset.aliases === undefined ? {} : { aliases: asset.aliases }),
      bytes: asset.source,
      compression: asset.compression ?? "gzip",
    }),
  })));
  for (const asset of assets) {
    assertKeelInlineNoExternalDependencies(asset.source, "Inline asset " + asset.id);
  }
  const parts: KeelInlineLocalDocument["parts"] = [
    { kind: "existing", role: "shell-prefix", bytes: input.shell.prefix.bytes, byteLength: input.shell.prefix.bytes.byteLength, integrity: input.shell.prefix.integrity },
    ...orderedModules.map((module) => ({
      kind: "existing" as const,
      role: "module" as const,
      moduleId: module.moduleId,
      moduleVersion: module.version,
      execution: module.execution,
      phase: module.phase,
      weight: module.weight,
      bytes: module.bytes,
      byteLength: module.bytes.byteLength,
      integrity: module.integrity,
    })),
    ...assetSlots.map(({ slot }) => ({
      kind: "creator" as const,
      role: "asset" as const,
      bytes: slot.fragment,
      byteLength: slot.fragment.byteLength,
      integrity: slot.fragmentIntegrity,
    })),
    { kind: "creator", role: "entrypoint", bytes: entry.fragment, byteLength: entry.fragment.byteLength, integrity: entry.fragmentIntegrity },
    { kind: "existing", role: "shell-suffix", bytes: input.shell.suffix.bytes, byteLength: input.shell.suffix.bytes.byteLength, integrity: input.shell.suffix.integrity },
  ];
  const rootBytes = concat(parts.map((part) => part.bytes));
  return {
    schema: "keel-inline-local-document@1",
    rootBytes,
    rootIntegrity: await createIntegrity(rootBytes),
    byteLength: rootBytes.byteLength,
    parts,
  };
}

/**
 * Compose a normal single-file image, video, or self-contained GLB without
 * authoring a project wrapper. The registered KEEL shell and asset-display
 * module are reusable graph objects; only `asset.source` is creator-specific.
 */
export async function buildKeelInlineNormalMediaDocument(input: {
  readonly shell: KeelInlineShellFragments;
  readonly asset: {
    readonly id: string;
    readonly backgroundColor?: string;
    readonly mediaType: KeelAssetDisplayMediaType;
    readonly source: Uint8Array;
    readonly aliases?: readonly string[];
  };
}): Promise<KeelInlineNormalMediaDocument> {
  keelAssetDisplayKind(input.asset.mediaType);
  const [assetDisplay, canonicalShell] = await Promise.all([
    buildKeelInlineAssetDisplayModuleFragment(),
    buildKeelInlineShellFragments({ repositoryRoot: "" }),
  ]);
  if (
    !exactBytes(input.shell.prefix.bytes, canonicalShell.prefix.bytes)
    || !exactBytes(input.shell.suffix.bytes, canonicalShell.suffix.bytes)
  ) {
    throw new TypeError("Normal media must use the exact canonical registered KEEL Inline shell fragments.");
  }
  const local = await buildKeelInlineLocalDocument({
    shell: input.shell,
    modules: [assetDisplay],
    entry: input.asset,
  });
  const entry = local.parts[2];
  if (entry === undefined || entry.kind !== "creator" || entry.role !== "entrypoint") {
    throw new Error("Canonical normal-media composition did not produce the creator entrypoint.");
  }
  const entryItem = JSON.parse(decoder.decode(entry.bytes).slice(1)) as KeelStandaloneViewerItem;
  if (entryItem.mediaType !== input.asset.mediaType || entryItem.integrity === undefined) {
    throw new Error("Canonical normal-media composition did not preserve the creator asset commitment.");
  }
  return {
    schema: "keel-inline-normal-media-document@1",
    rootBytes: local.rootBytes,
    rootIntegrity: local.rootIntegrity,
    byteLength: local.byteLength,
    parts: local.parts,
    declaration: {
      shellId: KEEL_INLINE_PROTECTION_SHELL_ID,
      assetDisplay: {
        moduleId: KEEL_ASSET_DISPLAY_MODULE_ID,
        version: KEEL_ASSET_DISPLAY_MODULE_VERSION,
        integrity: assetDisplay.integrity,
      },
      creatorAsset: {
        id: input.asset.id,
        mediaType: input.asset.mediaType,
        integrity: entryItem.integrity,
      },
    },
  };
}

async function assertCanonicalNormalMediaDocument(root: KeelInlineNormalMediaDocument): Promise<void> {
  if (
    root.schema !== "keel-inline-normal-media-document@1"
    || root.declaration.shellId !== KEEL_INLINE_PROTECTION_SHELL_ID
    || root.declaration.assetDisplay.moduleId !== KEEL_ASSET_DISPLAY_MODULE_ID
    || root.declaration.assetDisplay.version !== KEEL_ASSET_DISPLAY_MODULE_VERSION
    || root.parts.length !== 4
    || root.parts[0]?.kind !== "existing" || root.parts[0].role !== "shell-prefix"
    || root.parts[1]?.kind !== "existing" || root.parts[1].role !== "module"
    || root.parts[2]?.kind !== "creator" || root.parts[2].role !== "entrypoint"
    || root.parts[3]?.kind !== "existing" || root.parts[3].role !== "shell-suffix"
  ) {
    throw new TypeError("Normal media must be exactly shell-prefix, keel.asset-display, creator entrypoint, shell-suffix.");
  }
  const [shell, assetDisplay] = await Promise.all([
    buildKeelInlineShellFragments({ repositoryRoot: "" }),
    buildKeelInlineAssetDisplayModuleFragment(),
  ]);
  const expectedRootBytes = concat(root.parts.map((part) => part.bytes));
  const [expectedRootIntegrity, ...partIntegrities] = await Promise.all([
    createIntegrity(expectedRootBytes),
    ...root.parts.map((part) => createIntegrity(part.bytes)),
  ]);
  if (
    !exactBytes(root.rootBytes, expectedRootBytes)
    || root.rootIntegrity.digest.toLowerCase() !== expectedRootIntegrity.digest.toLowerCase()
    || root.rootIntegrity.byteLength !== expectedRootIntegrity.byteLength
    || root.parts.some((part, index) => part.byteLength !== part.bytes.byteLength
      || part.integrity.digest.toLowerCase() !== partIntegrities[index]!.digest.toLowerCase()
      || part.integrity.byteLength !== partIntegrities[index]!.byteLength)
    || !exactBytes(root.parts[0].bytes, shell.prefix.bytes)
    || !exactBytes(root.parts[3].bytes, shell.suffix.bytes)
    || root.declaration.assetDisplay.integrity.digest.toLowerCase() !== assetDisplay.integrity.digest.toLowerCase()
    || root.declaration.assetDisplay.integrity.byteLength !== assetDisplay.integrity.byteLength
  ) {
    throw new TypeError("Normal-media graph does not match the exact canonical KEEL shell and asset-display declarations.");
  }
  await assertCanonicalAssetDisplayModule({
    schema: "keel-inline-module-fragment@1",
    moduleId: root.declaration.assetDisplay.moduleId,
    version: root.declaration.assetDisplay.version,
    execution: root.parts[1].execution ?? "module",
    phase: root.parts[1].phase ?? "runtime",
    weight: root.parts[1].weight ?? 0,
    item: assetDisplay.item,
    bytes: root.parts[1].bytes,
    integrity: root.parts[1].integrity,
  });
  const item = JSON.parse(decoder.decode(root.parts[2].bytes).slice(1)) as KeelStandaloneViewerItem;
  if (
    item.id !== root.declaration.creatorAsset.id
    || item.role !== "entrypoint"
    || item.mediaType !== root.declaration.creatorAsset.mediaType
    || item.integrity.digest.toLowerCase() !== root.declaration.creatorAsset.integrity.digest.toLowerCase()
    || item.integrity.byteLength !== root.declaration.creatorAsset.integrity.byteLength
  ) {
    throw new TypeError("Normal media creator entrypoint does not match its immutable declaration.");
  }
  keelAssetDisplayKind(item.mediaType);
}

/**
 * Turn a normal-media document into a publishable graph only after all three
 * reusable catalogue fragments are supplied. The check compares the complete
 * decoded graph, so another object with the same label cannot substitute for
 * the registered shell or asset-display module.
 */
export async function buildKeelRegisteredInlineNormalMediaTokenURIGraph(input: {
  readonly document: KeelInlineNormalMediaDocument;
  readonly shellId?: typeof KEEL_INLINE_PROTECTION_SHELL_ID;
  /** Omitted selects the compact saver; legacy publication needs an explicit selection. */
  readonly carriage?: "compact" | "raw-percent" | "pinned";
  readonly existingParts: readonly [KeelPublishedInlineFragment, KeelPublishedInlineFragment, KeelPublishedInlineFragment];
}): Promise<KeelInlineRawPercentTokenURIGraph | KeelInlineEscapedTokenURIGraph | KeelInlinePreEncodedTokenURIGraph | KeelInlinePreEncodedTokenURIBodyGraph> {
  if ((input.shellId ?? KEEL_INLINE_PROTECTION_SHELL_ID) !== KEEL_INLINE_PROTECTION_SHELL_ID) {
    throw new TypeError("Normal media must use the canonical registered KEEL Inline protection shell.");
  }
  await assertCanonicalNormalMediaDocument(input.document);
  const expected = await buildKeelInlineTokenURIGraph(input.document, { carriage: input.carriage ?? "compact" });
  const graph = await buildKeelInlineTokenURIGraph(input.document, { carriage: input.carriage ?? "compact", existingParts: input.existingParts });
  const expectedExisting = expected.parts.filter((part) => part.sourceKind === "existing");
  const actualExisting = graph.parts.filter((part) => part.sourceKind === "existing");
  if (
    expectedExisting.length !== 3
    || actualExisting.length !== 3
    || expectedExisting.some((part, index) => !exactBytes(part.decodedHtmlBytes, actualExisting[index]!.decodedHtmlBytes))
  ) {
    throw new TypeError("Normal-media graph does not match the registered KEEL shell and asset-display module.");
  }
  return graph;
}


/**
 * Build the reusable pre-encoded tokenURI lane from an already verified Inline
 * graph. Every non-terminal HTML fragment is padded with legal inter-fragment
 * whitespace to a nine-byte boundary. That makes both Base64 layers line up:
 * concatenating these stored fragments is byte-identical to encoding the
 * completed HTML and then the completed JSON at read time.
 *
 * Existing shell/module source objects yield deterministic reusable fragment
 * bytes and are published once per chain. The creator entry remains the only
 * artwork-specific publication payload.
 */
/**
 * The compact raw-percent lane is the standard. The Base64-carried lanes stay
 * in the SDK for already-minted collections and reviewed exceptions, but they
 * cannot be reached by accident: a caller must acknowledge the legacy carriage
 * in its options, or the operator must set KEEL_LEGACY_CARRIAGE=allow.
 */
export interface KeelLegacyCarriageOptions {
  readonly legacyCarriage?: "acknowledged";
}

export class KeelLegacyCarriageError extends Error {
  readonly lane: string;
  constructor(lane: string) {
    super(
      `${lane} is a legacy Base64-carried Inline lane. Use buildKeelInlineRawPercentTokenURIGraph (compact raw-percent), `
      + "or pass { legacyCarriage: \"acknowledged\" } after an explicit creator/agent instruction, "
      + "or set KEEL_LEGACY_CARRIAGE=allow for a reviewed environment.",
    );
    this.name = "KeelLegacyCarriageError";
    this.lane = lane;
  }
}

export function assertLegacyCarriageAllowed(lane: string, options: KeelLegacyCarriageOptions | undefined): void {
  if (options?.legacyCarriage === "acknowledged") return;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.["KEEL_LEGACY_CARRIAGE"] === "allow") return;
  throw new KeelLegacyCarriageError(lane);
}

export async function buildKeelInlinePreEncodedTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: { readonly existingParts?: readonly KeelPublishedInlineFragment[] } & KeelLegacyCarriageOptions = {},
): Promise<KeelInlinePreEncodedTokenURIGraph> {
  assertLegacyCarriageAllowed("buildKeelInlinePreEncodedTokenURIGraph", options);
  if (root.parts.length < 2 || root.parts.at(-1)?.role !== "shell-suffix") {
    throw new TypeError("An Inline pre-encoded tokenURI graph requires an ordered shell and terminal suffix.");
  }

  const fragments: KeelInlinePreEncodedTokenURIFragment[] = [];
  const htmlParts: Uint8Array[] = [];
  let existingIndex = 0;
  for (let index = 0; index < root.parts.length; index += 1) {
    const part = root.parts[index]!;
    const published = part.kind === "existing" ? options.existingParts?.[existingIndex++] : undefined;
    if (options.existingParts !== undefined && part.kind === "existing" && published === undefined) {
      throw new TypeError(`Inline ${part.role} has no canonical published fragment.`);
    }
    if (published !== undefined) {
      await assertPublishedFragmentIntegrity(published, `Inline ${part.role}`);
      const decodedHtmlBytes = decodePublishedGraphPart(published);
      fragments.push({
        bytes: published.bytes.slice(),
        integrity: published.integrity,
        role: part.role,
        sourceKind: part.kind,
        sourceObjectId: published.carrier.objectId,
        sourceIntegrity: await createIntegrity(decodedHtmlBytes),
        decodedHtmlBytes,
      });
      htmlParts.push(decodedHtmlBytes);
      continue;
    }
    const decodedHtmlBytes = appendSpacesToMultiple(part.bytes, 9);
    const inner = base64Bytes(decodedHtmlBytes);
    if (inner.byteLength % 3 !== 0) {
      throw new Error(`Inline ${part.role} fragment did not align at the outer Base64 boundary.`);
    }
    const bytes = base64Bytes(inner);
    const sourceIntegrity = await createIntegrity(part.bytes);
    fragments.push({
      bytes,
      integrity: await createIntegrity(bytes),
      role: part.role,
      sourceKind: part.kind,
      sourceIntegrity,
      decodedHtmlBytes,
    });
    htmlParts.push(decodedHtmlBytes);
  }

  if (options.existingParts !== undefined && existingIndex !== options.existingParts.length) {
    throw new TypeError("Inline graph contains unused canonical published fragments.");
  }

  const fragmentBytes = concat(fragments.map((fragment) => fragment.bytes));
  if (fragmentBytes.byteLength > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
    throw new RangeError(`The prepared Inline tokenURI stream is ${fragmentBytes.byteLength.toLocaleString()} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES.toLocaleString()}-byte public-read limit.`);
  }
  if (/=/u.test(decoder.decode(fragmentBytes))) {
    throw new Error("Reusable Inline tokenURI fragments must be unpadded Base64 for exact concatenation.");
  }
  const decodedStatic = Buffer.from(decoder.decode(fragmentBytes), "base64").toString("utf8");
  const htmlBytes = exactBase64Bytes(decodedStatic, "Pre-encoded Inline HTML stream");
  const expectedHtml = concat(htmlParts);
  if (!exactBytes(htmlBytes, expectedHtml)) {
    throw new Error("Pre-encoded Inline tokenURI fragments do not reconstruct the exact aligned HTML.");
  }

  return {
    schema: "keel-inline-preencoded-token-uri@1",
    mediaType: "application/vnd.keel.token-uri-base64-fragment",
    contextParameter: "keel-context",
    contextDelivery: "base64-html-tail",
    fragmentBytes,
    fragmentIntegrity: await createIntegrity(fragmentBytes),
    htmlBytes,
    htmlIntegrity: await createIntegrity(htmlBytes),
    creatorPublicationBytes: fragments
      .filter((fragment) => fragment.sourceKind === "creator")
      .reduce((total, fragment) => total + fragment.bytes.byteLength, 0),
    parts: fragments,
  };
}

/**
 * Build the explicit storage-minimal carriage for a verified Inline graph.
 * Each HTML fragment is percent-escaped independently and then encoded once as
 * an aligned slice of the outer token JSON Base64 stream. At most two otherwise
 * literal bytes per fragment are written as equivalent `%HH` escapes to align
 * the slices, so concatenation needs no runtime codec and changes no HTML byte.
 */
export async function buildKeelInlineEscapedTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: KeelLegacyCarriageOptions & {
    readonly existingParts?: readonly KeelPublishedInlineFragment[];
    /**
     * Explicitly reviewed public-read ceiling for unusually large immutable
     * works. The protocol default remains 2 MB; callers may raise it only when
     * they also benchmark the exact contract read path and RPC response.
     */
    readonly maxTokenURIBytes?: number;
  } = {},
): Promise<KeelInlineEscapedTokenURIGraph> {
  assertLegacyCarriageAllowed("buildKeelInlineEscapedTokenURIGraph", options);
  if (root.parts.length < 2 || root.parts.at(-1)?.role !== "shell-suffix") {
    throw new TypeError("An Inline escaped tokenURI graph requires an ordered shell and terminal suffix.");
  }

  const fragments: KeelInlineEscapedTokenURIFragment[] = [];
  const htmlParts: Uint8Array[] = [];
  let existingIndex = 0;
  for (const part of root.parts) {
    const published = part.kind === "existing" ? options.existingParts?.[existingIndex++] : undefined;
    if (options.existingParts !== undefined && part.kind === "existing" && published === undefined) {
      throw new TypeError(`Inline ${part.role} has no canonical published escaped fragment.`);
    }
    let bytes: Uint8Array;
    let escapedHtmlBytes: Uint8Array;
    let decodedHtmlBytes: Uint8Array;
    if (published !== undefined) {
      await assertPublishedFragmentIntegrity(published, `Inline ${part.role}`);
      if (published.carrier.mediaType !== "application/vnd.keel.token-uri-percent-fragment") {
        throw new TypeError(`Inline ${part.role} reusable object is not a compact percent fragment.`);
      }
      bytes = published.bytes.slice();
      escapedHtmlBytes = exactBase64Bytes(decoder.decode(bytes), `Published escaped Inline ${part.role}`);
      decodedHtmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, `Published escaped Inline ${part.role}`);
    } else {
      decodedHtmlBytes = part.bytes.slice();
      escapedHtmlBytes = alignedPercentPayload(decodedHtmlBytes);
      bytes = base64Bytes(escapedHtmlBytes);
    }
    if (escapedHtmlBytes.byteLength % 3 !== 0 || /=/u.test(decoder.decode(bytes))) {
      throw new Error(`Inline ${part.role} escaped fragment must be aligned unpadded Base64 for exact concatenation.`);
    }
    fragments.push({
      bytes,
      integrity: published?.integrity ?? await createIntegrity(bytes),
      role: part.role,
      sourceKind: part.kind,
      ...(published === undefined ? {} : { sourceObjectId: published.carrier.objectId }),
      sourceIntegrity: await createIntegrity(decodedHtmlBytes),
      decodedHtmlBytes,
      escapedHtmlBytes,
    });
    htmlParts.push(decodedHtmlBytes);
  }

  if (options.existingParts !== undefined && existingIndex !== options.existingParts.length) {
    throw new TypeError("Inline graph contains unused canonical published escaped fragments.");
  }
  const fragmentBytes = concat(fragments.map((fragment) => fragment.bytes));
  const maxTokenURIBytes = options.maxTokenURIBytes ?? KEEL_INLINE_MAX_TOKEN_URI_BYTES;
  if (!Number.isSafeInteger(maxTokenURIBytes) || maxTokenURIBytes <= 0) {
    throw new RangeError("The escaped Inline tokenURI public-read ceiling must be a positive safe integer.");
  }
  if (fragmentBytes.byteLength > maxTokenURIBytes) {
    throw new RangeError(`The escaped Inline tokenURI stream is ${fragmentBytes.byteLength.toLocaleString()} bytes, above the reviewed ${maxTokenURIBytes.toLocaleString()}-byte public-read ceiling.`);
  }
  const escapedHtmlBytes = exactBase64Bytes(decoder.decode(fragmentBytes), "Escaped Inline outer fragment stream");
  const htmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, "Escaped Inline HTML stream");
  if (!exactBytes(htmlBytes, concat(htmlParts))) {
    throw new Error("Escaped Inline tokenURI fragments do not reconstruct the exact source HTML.");
  }
  return {
    schema: "keel-inline-escaped-token-uri@1",
    mediaType: "application/vnd.keel.token-uri-percent-fragment",
    contextParameter: "keel-context",
    contextDelivery: "percent-html-tail",
    fragmentBytes,
    fragmentIntegrity: await createIntegrity(fragmentBytes),
    htmlBytes,
    htmlIntegrity: await createIntegrity(htmlBytes),
    escapedHtmlBytes,
    creatorPublicationBytes: fragments
      .filter((fragment) => fragment.sourceKind === "creator")
      .reduce((total, fragment) => total + fragment.bytes.byteLength, 0),
    parts: fragments,
  };
}

/**
 * Build the raw-storage carriage used when the whole-token Base64 wrapper is
 * the read-gas bottleneck. Each verified HTML part is escaped for its own HTML
 * data URI, then only that ASCII is escaped for the outer JSON data URI. The
 * stored bytes are copied verbatim by KeelRawTokenURIBuilder.
 */
export async function buildKeelInlineRawPercentTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: {
    readonly existingParts?: readonly KeelPublishedInlineFragment[];
    readonly maxTokenURIBytes?: number;
  } = {},
): Promise<KeelInlineRawPercentTokenURIGraph> {
  if (root.parts.length < 2 || root.parts.at(-1)?.role !== "shell-suffix") {
    throw new TypeError("An Inline raw-percent tokenURI graph requires an ordered shell and terminal suffix.");
  }
  const fragments: KeelInlineRawPercentTokenURIFragment[] = [];
  const htmlParts: Uint8Array[] = [];
  let existingIndex = 0;
  for (const part of root.parts) {
    const published = part.kind === "existing" ? options.existingParts?.[existingIndex++] : undefined;
    if (options.existingParts !== undefined && part.kind === "existing" && published === undefined) {
      throw new TypeError(`Inline ${part.role} has no canonical published raw-percent fragment.`);
    }
    let bytes: Uint8Array;
    let escapedHtmlBytes: Uint8Array;
    let decodedHtmlBytes: Uint8Array;
    if (published !== undefined) {
      await assertPublishedFragmentIntegrity(published, `Inline ${part.role}`);
      if (published.carrier.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment") {
        throw new TypeError(`Inline ${part.role} reusable object is not a raw-percent fragment.`);
      }
      bytes = published.bytes.slice();
      escapedHtmlBytes = exactPercentPayloadBytes(bytes, `Published raw-percent Inline ${part.role}`);
      decodedHtmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, `Published raw-percent decoded ${part.role}`);
    } else {
      decodedHtmlBytes = part.bytes.slice();
      escapedHtmlBytes = compactPercentPayload(decodedHtmlBytes);
      bytes = compactPercentPayload(escapedHtmlBytes);
    }
    fragments.push({
      bytes,
      integrity: published?.integrity ?? await createIntegrity(bytes),
      role: part.role,
      sourceKind: part.kind,
      ...(published === undefined ? {} : { sourceObjectId: published.carrier.objectId }),
      sourceIntegrity: await createIntegrity(decodedHtmlBytes),
      decodedHtmlBytes,
      escapedHtmlBytes,
      encodedMetadataBytes: bytes,
    });
    htmlParts.push(decodedHtmlBytes);
  }
  if (options.existingParts !== undefined && existingIndex !== options.existingParts.length) {
    throw new TypeError("Inline graph contains unused canonical published raw-percent fragments.");
  }
  const fragmentBytes = concat(fragments.map((fragment) => fragment.bytes));
  const maxTokenURIBytes = options.maxTokenURIBytes ?? KEEL_INLINE_MAX_TOKEN_URI_BYTES;
  if (!Number.isSafeInteger(maxTokenURIBytes) || maxTokenURIBytes <= 0) {
    throw new RangeError("The raw-percent tokenURI public-read ceiling must be a positive safe integer.");
  }
  if (fragmentBytes.byteLength > maxTokenURIBytes) {
    throw new RangeError(`The raw-percent Inline tokenURI stream is ${fragmentBytes.byteLength.toLocaleString()} bytes, above the reviewed ${maxTokenURIBytes.toLocaleString()}-byte public-read ceiling.`);
  }
  const escapedHtmlBytes = exactPercentPayloadBytes(fragmentBytes, "Raw-percent metadata middle");
  const htmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, "Raw-percent HTML stream");
  if (!exactBytes(htmlBytes, concat(htmlParts))) {
    throw new Error("Raw-percent Inline fragments do not reconstruct the exact source HTML.");
  }
  return {
    schema: "keel-inline-raw-percent-token-uri@1",
    mediaType: "application/vnd.keel.token-uri-raw-percent-fragment",
    contextParameter: "keel-context",
    contextDelivery: "percent-html-tail",
    fragmentBytes,
    fragmentIntegrity: await createIntegrity(fragmentBytes),
    htmlBytes,
    htmlIntegrity: await createIntegrity(htmlBytes),
    escapedHtmlBytes,
    creatorPublicationBytes: fragments
      .filter((fragment) => fragment.sourceKind === "creator")
      .reduce((total, fragment) => total + fragment.bytes.byteLength, 0),
    parts: fragments,
  };
}

/** Raw web3 JSON keeps the same canonical viewer parts, but has no outer data:
 * JSON encoding. Existing collections can point their URI at a token resolver
 * without implementing KEEL721's prepared-harness setters. This prepares bytes
 * only; chain bindings and the resolver's token mapping still require read-back.
 */
export async function buildKeelWeb3TokenJSONGraph(input: {
  readonly document: KeelInlineGraphDocument;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly imageURI: string;
  readonly tokenId: string;
  /** Exact collection naming/URL patterns, never guessed from a token name. */
  readonly tokenIdFields?: Readonly<Record<string, { readonly prefix: string; readonly suffix: string }>>;
  /** Explicit separate SVG read. The source image remains required so both
   * matrix responses reuse the exact prepared asset slots. Never automatic. */
  readonly web3Image?: { readonly chainId: number; readonly resolver: Hex };
  /** External image resolvers are an explicit existing-collection route. */
  readonly presentationPolicy?: KeelPresentationPolicy;
}) {
  if (!/^(0|[1-9][0-9]*)$/u.test(input.tokenId) || BigInt(input.tokenId) >= 1n << 256n) {
    throw new TypeError("tokenId must be a canonical uint256 decimal string.");
  }
  if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) {
    throw new TypeError("Original token metadata must be a JSON object.");
  }
  assertMarketplaceSafeDataURI(input.imageURI, "Token image");
  if (!input.imageURI.startsWith("data:image/")) throw new TypeError("Token image must be an inline image URI.");
  const presentationPolicy = input.presentationPolicy ?? "collector-inline";
  if (!["collector-inline", "external-resolver", "raw-artifact"].includes(presentationPolicy)) throw new TypeError("Unsupported presentation policy.");
  if (input.web3Image !== undefined && presentationPolicy !== "external-resolver") {
    throw new TypeError("web3Image is disabled for collector-facing Inline by default; select presentationPolicy: external-resolver explicitly for an existing collection.");
  }
  let imageURI = input.imageURI;
  if (input.web3Image !== undefined) {
    if (!Number.isSafeInteger(input.web3Image.chainId) || input.web3Image.chainId <= 0) throw new TypeError("The image endpoint needs an explicit positive chain ID.");
    const resolver = getAddress(input.web3Image.resolver);
    if (/^0x0{40}$/iu.test(resolver)) throw new TypeError("The image endpoint needs a nonzero resolver.");
    if (!input.imageURI.startsWith("data:image/svg+xml,")) throw new TypeError("A separate image read requires the compact prepared SVG source.");
    imageURI = `web3://${resolver.toLowerCase()}:${input.web3Image.chainId}/tokenJSON/${input.tokenId}?mime.type=svg`;
  }
  // This helper also prepares an outer data-URI encoding that raw web3 JSON
  // does not return. Percent encoding expands each input byte by at most 3x;
  // keep the intermediate bounded, then enforce the response budget on the
  // actual JSON below. The inline tokenURI lane retains its original limit.
  const graph = await buildKeelInlineRawPercentTokenURIGraph(input.document, {
    maxTokenURIBytes: 3 * KEEL_INLINE_MAX_TOKEN_URI_BYTES,
  });
  const originalJSON = JSON.stringify(input.metadata);
  const original = JSON.parse(originalJSON) as Record<string, unknown>;
  const { image: _image, animation_url: _animation, ...preserved } = original;
  if (input.tokenIdFields !== undefined) {
    if (!input.tokenIdFields || typeof input.tokenIdFields !== "object" || Array.isArray(input.tokenIdFields)) throw new TypeError("Invalid token field patterns.");
    for (const [key, pattern] of Object.entries(input.tokenIdFields)) {
      if (!Object.hasOwn(preserved, key) || !pattern || typeof pattern.prefix !== "string" || typeof pattern.suffix !== "string"
          || Object.keys(pattern).some(field => field !== "prefix" && field !== "suffix")) throw new TypeError("Invalid token field pattern.");
    }
  }
  // JSON escaping is applied independently to each already URI-escaped HTML
  // part. No whole-document Base64 or percent decode is needed onchain.
  const metadataParts: { role: string; sourceKind: string; bytes: Uint8Array }[] = [];
  const addMetadata = (role: string, value: string) => metadataParts.push({ role, sourceKind: "creator", bytes: encoder.encode(value) });
  addMetadata("metadata-open", "{");
  const fields = Object.entries(preserved);
  for (const [index, [key, value]] of fields.entries()) {
    addMetadata("metadata-field", `${index ? "," : ""}${JSON.stringify(key)}:`);
    const pattern = input.tokenIdFields?.[key];
    if (pattern !== undefined) {
      if (value !== pattern.prefix + input.tokenId + pattern.suffix) throw new Error(`Token field ${key} does not match the collection pattern.`);
      addMetadata("metadata-value-prefix", JSON.stringify(pattern.prefix).slice(0, -1));
      addMetadata("token-id", input.tokenId);
      addMetadata("metadata-value-suffix", JSON.stringify(pattern.suffix).slice(1));
    } else if (key === "attributes" && Array.isArray(value)) {
      addMetadata("attributes-open", "[");
      value.forEach((attribute, at) => {
        if (at) addMetadata("attribute-separator", ",");
        addMetadata("trait", JSON.stringify(attribute));
      });
      addMetadata("attributes-close", "]");
    } else addMetadata("metadata-value", JSON.stringify(value));
  }
  addMetadata("image-field", `${fields.length ? "," : ""}"image":"`);
  // Separate the already-prepared raster payload from SVG markup. The payload
  // is a single exact ASCII resource slot that can be reused by different
  // token graphs; no contract-side image encoding is implied by this split.
  const imageParts: { role: string; sourceKind: string; bytes: Uint8Array }[] = [];
  let imageCursor = 0;
  for (const match of input.imageURI.matchAll(/base64,([A-Za-z0-9+/=]+)/gu)) {
    const start = match.index! + "base64,".length;
    imageParts.push({ role: "image-markup", sourceKind: "creator", bytes: encoder.encode(JSON.stringify(input.imageURI.slice(imageCursor, start)).slice(1, -1)) });
    imageParts.push({ role: "image-asset", sourceKind: "creator", bytes: encoder.encode(match[1]!) });
    imageCursor = start + match[1]!.length;
  }
  if (imageCursor < input.imageURI.length) imageParts.push({ role: "image-markup", sourceKind: "creator", bytes: encoder.encode(JSON.stringify(input.imageURI.slice(imageCursor)).slice(1, -1)) });
  // Reuse the already prepared image resource slots inside HTML asset
  // descriptors. KeelHold stores each identical slot once; the matrix reader
  // only copies bytes. Do not encode media or serialize JSON during a read.
  const assetSlots = imageParts.filter(part => part.role === "image-asset")
    .map(part => ({ text: decoder.decode(part.bytes), bytes: part.bytes }));
  // The SVG matrix returns raw SVG, without a data URI or JSON wrapper. Its
  // raster slots are already safe ASCII and identical to the HTML's slots.
  const imageResponseParts = input.web3Image === undefined ? undefined : imageParts.map((part, index) => {
    if (part.role === "image-asset") return part;
    let text = JSON.parse(`"${decoder.decode(part.bytes)}"`) as string;
    if (index === 0) text = text.slice("data:image/svg+xml,".length);
    return { ...part, bytes: exactPercentPayloadBytes(encoder.encode(text), "SVG response markup") };
  });
  const imageResponseBytes = imageResponseParts === undefined ? undefined : concat(imageResponseParts.map(part => part.bytes));
  const viewerParts = graph.parts.flatMap(part => {
    const bytes = encoder.encode(JSON.stringify(decoder.decode(part.escapedHtmlBytes)).slice(1, -1));
    const unchanged = { role: part.role, sourceKind: part.sourceKind, bytes };
    if (part.sourceKind !== "creator" || part.role !== "asset") return [unchanged];
    const text = decoder.decode(bytes), split: typeof imageParts = [];
    let cursor = 0;
    while (cursor < text.length) {
      let next: { at: number; text: string; bytes: Uint8Array } | undefined;
      for (const slot of assetSlots) {
        const at = text.indexOf(slot.text, cursor);
        if (at >= 0 && (!next || at < next.at || (at === next.at && slot.text.length > next.text.length))) next = { at, ...slot };
      }
      if (!next) break;
      if (next.at > cursor) split.push({ ...unchanged, bytes: encoder.encode(text.slice(cursor, next.at)) });
      split.push({ role: "image-asset", sourceKind: "creator", bytes: next.bytes });
      cursor = next.at + next.text.length;
    }
    if (!split.length) return [unchanged];
    if (cursor < text.length) split.push({ ...unchanged, bytes: encoder.encode(text.slice(cursor)) });
    return split;
  });
  const parts = [
    ...metadataParts,
    ...(input.web3Image === undefined ? imageParts : [
      { role: "image-link-prefix", sourceKind: "creator", bytes: encoder.encode(imageURI.slice(0, imageURI.lastIndexOf("/") + 1)) },
      { role: "token-id", sourceKind: "creator", bytes: encoder.encode(input.tokenId) },
      { role: "image-link-suffix", sourceKind: "creator", bytes: encoder.encode("?mime.type=svg") },
    ]),
    { role: "media-boundary", sourceKind: "creator", bytes: encoder.encode('","animation_url":"data:text/html;charset=utf-8,') },
    ...viewerParts,
    { role: "metadata-suffix", sourceKind: "creator", bytes: encoder.encode('"}') },
  ];
  const bytes = concat(parts.map(part => part.bytes));
  if (bytes.length > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
    throw new RangeError(`Complete web3 JSON is ${bytes.length} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES}-byte public-read limit.`);
  }
  const metadata = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
  if (JSON.stringify(metadata) !== JSON.stringify({ ...preserved, image: imageURI,
    animation_url: `data:text/html;charset=utf-8,${decoder.decode(graph.escapedHtmlBytes)}` })) {
    throw new Error("Web3 metadata graph changed its original fields or media.");
  }
  if (presentationPolicy === "collector-inline") assertKeelCollectorInlineMetadata(metadata);
  return {
    schema: "keel-web3-token-json-graph@1" as const,
    tokenId: input.tokenId, mediaType: "application/json" as const,
    bytes, byteLength: bytes.length, integrity: await createIntegrity(bytes),
    originalMetadataBytes: encoder.encode(originalJSON),
    originalMetadataIntegrity: await createIntegrity(encoder.encode(originalJSON)),
    metadata, parts: await Promise.all(parts.map(async part => ({ ...part, integrity: await createIntegrity(part.bytes) }))),
    imageTransport: input.web3Image === undefined ? "inline" as const : "web3-svg" as const,
    ...(imageResponseBytes === undefined ? {} : { imageResponse: {
      mediaType: "image/svg+xml" as const, uri: imageURI,
      bytes: imageResponseBytes, byteLength: imageResponseBytes.length,
      integrity: await createIntegrity(imageResponseBytes),
      parts: await Promise.all(imageResponseParts!.map(async part => ({ ...part, integrity: await createIntegrity(part.bytes) }))),
      published: false, selectedChainBindingVerified: false, readLimitsVerified: false,
    } }),
    completeDocumentBase64Layers: 0,
    published: false,
  };
}

/** Shared SDK, MCP and editor entrypoint. No override means the compact saver. */
export function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options?: { readonly existingParts?: readonly KeelPublishedInlineFragment[]; readonly maxTokenURIBytes?: number; readonly carriage?: "compact" | "raw-percent" },
): Promise<KeelInlineRawPercentTokenURIGraph>;
export function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: { readonly existingParts?: readonly KeelPublishedInlineFragment[]; readonly maxTokenURIBytes?: number; readonly carriage?: KeelInlineCarriage },
): Promise<KeelInlineRawPercentTokenURIGraph | KeelInlineEscapedTokenURIGraph | KeelInlinePreEncodedTokenURIGraph | KeelInlinePreEncodedTokenURIBodyGraph>;
export function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: { readonly existingParts?: readonly KeelPublishedInlineFragment[]; readonly maxTokenURIBytes?: number; readonly carriage?: KeelInlineCarriage } = {},
) {
  const carriage = resolveKeelInlineCarriage(options.carriage);
  if (carriage === "raw-percent") return buildKeelInlineRawPercentTokenURIGraph(root, options);
  // Reached only through an explicit caller selection, never a fallback.
  const legacy = { ...(options.existingParts === undefined ? {} : { existingParts: options.existingParts }), legacyCarriage: "acknowledged" as const };
  if (carriage === "percent") return buildKeelInlineEscapedTokenURIGraph(root, legacy);
  if (carriage === "pinned") return buildKeelInlinePreEncodedTokenURIGraph(root, legacy);
  return buildKeelInlineFollowLatestTokenURIBodyGraph(root, legacy);
}

/** Compare both explicit carriage modes without silently selecting publication bytes. */
export async function compareKeelInlineTokenURICarriages(
  root: KeelInlineGraphDocument,
): Promise<KeelInlineTokenURICarriageComparison> {
  const [base64, percent] = await Promise.all([
    /* Why: a size comparison measures the legacy carriages; it publishes nothing. */
    buildKeelInlinePreEncodedTokenURIGraph(root, { legacyCarriage: "acknowledged" }),
    buildKeelInlineEscapedTokenURIGraph(root, { legacyCarriage: "acknowledged" }),
  ]);
  const preferred = percent.fragmentBytes.byteLength < base64.fragmentBytes.byteLength ? "percent" : "base64";
  const larger = Math.max(base64.fragmentBytes.byteLength, percent.fragmentBytes.byteLength);
  const smaller = Math.min(base64.fragmentBytes.byteLength, percent.fragmentBytes.byteLength);
  return {
    schema: "keel-inline-token-uri-carriage-comparison@1",
    preferred,
    base64StorageBytes: base64.fragmentBytes.byteLength,
    percentStorageBytes: percent.fragmentBytes.byteLength,
    savingsBytes: larger - smaller,
    savingsPercent: larger === 0 ? 0 : ((larger - smaller) / larger) * 100,
    base64,
    percent,
  };
}

/**
 * Build KEEL's recommended default viewer payload: immutable modules/work only,
 * with no copied shell top or bottom. The canonical shell is resolved by its
 * stable registry ID at contract-read time and therefore follows the latest
 * registered revision until that shell is frozen.
 *
 * This is deliberately separate from `buildKeelInlinePreEncodedTokenURIGraph`:
 * the older full-graph helper remains the explicit pinned/frozen-shell lane.
 */
export async function buildKeelInlineFollowLatestTokenURIBodyGraph(
  root: KeelInlineGraphDocument,
  options: { readonly existingParts?: readonly KeelPublishedInlineFragment[] } & KeelLegacyCarriageOptions = {},
): Promise<KeelInlinePreEncodedTokenURIBodyGraph> {
  assertLegacyCarriageAllowed("buildKeelInlineFollowLatestTokenURIBodyGraph", options);
  const full = await buildKeelInlinePreEncodedTokenURIGraph(root, options);
  const first = full.parts[0];
  const last = full.parts.at(-1);
  if (first?.role !== "shell-prefix" || last?.role !== "shell-suffix") {
    throw new TypeError("A follow-latest Inline body requires one canonical shell prefix and suffix.");
  }
  const parts = full.parts.slice(1, -1);
  if (parts.length === 0 || parts.some((part) => part.role === "shell-prefix" || part.role === "shell-suffix")) {
    throw new TypeError("A follow-latest Inline body must contain immutable work or module parts between the shell boundaries.");
  }
  const fragmentBytes = concat(parts.map((part) => part.bytes));
  const htmlBytes = concat(parts.map((part) => part.decodedHtmlBytes));
  if (fragmentBytes.byteLength > KEEL_INLINE_MAX_TOKEN_URI_BYTES) {
    throw new RangeError(`The prepared Inline body stream is ${fragmentBytes.byteLength.toLocaleString()} bytes, above KEEL's ${KEEL_INLINE_MAX_TOKEN_URI_BYTES.toLocaleString()}-byte public-read limit.`);
  }
  const decodedMiddle = Buffer.from(decoder.decode(fragmentBytes), "base64").toString("utf8");
  const decodedBody = exactBase64Bytes(decodedMiddle, "Pre-encoded Inline body stream");
  if (!exactBytes(decodedBody, htmlBytes)) {
    throw new Error("Pre-encoded Inline body fragments do not reconstruct the exact aligned body HTML.");
  }
  return {
    schema: "keel-inline-preencoded-token-uri-body@1",
    mediaType: "application/vnd.keel.token-uri-base64-body-fragment",
    shellSelection: "follow-latest",
    shellId: KEEL_INLINE_PROTECTION_SHELL_ID,
    fragmentBytes,
    fragmentIntegrity: await createIntegrity(fragmentBytes),
    htmlBytes,
    htmlIntegrity: await createIntegrity(htmlBytes),
    creatorPublicationBytes: parts
      .filter((part) => part.sourceKind === "creator")
      .reduce((total, part) => total + part.bytes.byteLength, 0),
    parts,
  };
}

/**
 * Finish an immutable 1/1 ERC-721 tokenURI entirely at release-build time.
 * The collection address must already be deterministically predicted. The
 * contract stores these two small outer-Base64 slices and directly copies the
 * reusable middle graph between them.
 */
export async function buildKeelPreparedOneOfOneTokenURI(input: {
  readonly graph: Pick<
    KeelInlinePreEncodedTokenURIGraph
      | KeelInlinePreEncodedTokenURIBodyGraph
      | KeelInlineEscapedTokenURIGraph
      | KeelInlineRawPercentTokenURIGraph,
    "fragmentBytes" | "mediaType"
  >;
  /**
   * Exact registered shell fragments that the onchain builder will wrap around
   * a follow-latest body. Omit this only for a legacy graph that already
   * contains its pinned shell boundaries.
   */
  readonly shellFragments?: {
    readonly prefix: Uint8Array;
    readonly suffix: Uint8Array;
  };
  readonly chainId: number;
  readonly collection: Hex;
  readonly collectionName: string;
  readonly description: string;
  readonly imageURI: string;
  readonly manifestURI: string;
  readonly manifestDigest: Hex;
  /**
   * The creator's immutable artifact, independent of the selected shell.
   * KEEL-aware readers can call `haulObject(bytes32)` directly even when the
   * normal `animation_url` presents the work through a registered shell.
   */
  readonly artifact?: {
    readonly store: Hex;
    readonly objectId: Hex;
    readonly digest: Hex;
    readonly byteLength: number;
    readonly mediaType: string;
  };
  /** Optional ERC-4804 resolver URI. When supplied it is emitted exactly like
   * KEEL721's on-chain prepared envelope. */
  readonly erc4804MetadataURI?: string;
  readonly tokenId?: 1;
  readonly attributes?: readonly unknown[];
  /**
   * Optional chain-derived replay seed. When omitted the historical
   * collection/manifest fallback is retained for callers that do not have a
   * SeedRegistry binding. Immutable seeded releases should pass the value
   * returned by KeelSeedRegistry.deriveTokenSeed so the embedded context and
   * the contract's seed system are byte-for-byte aligned.
   */
  readonly derivedTokenSeed?: Hex;
  /** Collector-facing Inline is the default. Other routes must be explicit. */
  readonly presentationPolicy?: KeelPresentationPolicy;
}): Promise<KeelPreparedOneOfOneTokenURI> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new TypeError("A prepared tokenURI needs a positive safe chain ID.");
  }
  if (!/^0x[0-9a-f]{64}$/iu.test(input.manifestDigest)) {
    throw new TypeError("A prepared tokenURI needs a canonical manifest digest.");
  }
  const collection = getAddress(input.collection);
  const presentationPolicy = input.presentationPolicy ?? "collector-inline";
  if (!["collector-inline", "external-resolver", "raw-artifact"].includes(presentationPolicy)) throw new TypeError("Unsupported presentation policy.");
  const artifact = input.artifact === undefined ? undefined : (() => {
    const store = getAddress(input.artifact.store);
    if (!/^0x[0-9a-f]{64}$/iu.test(input.artifact.objectId)) {
      throw new TypeError("A prepared artifact needs a canonical object ID.");
    }
    if (!/^0x[0-9a-f]{64}$/iu.test(input.artifact.digest)) {
      throw new TypeError("A prepared artifact needs a canonical digest.");
    }
    if (!Number.isSafeInteger(input.artifact.byteLength) || input.artifact.byteLength <= 0) {
      throw new TypeError("A prepared artifact needs a positive safe byte length.");
    }
    const mediaType = input.artifact.mediaType.trim().toLowerCase();
    assertDataUriMediaType(mediaType);
    const objectId = input.artifact.objectId.toLowerCase() as Hex;
    const digest = input.artifact.digest.toLowerCase() as Hex;
    return Object.freeze({
      store: store.toLowerCase(),
      object_id: objectId,
      digest,
      byte_length: input.artifact.byteLength,
      media_type: mediaType,
      uri: keelWeb3ObjectURI({
        chainId: input.chainId,
        storeAddress: store,
        objectId,
        mediaType,
      }),
    });
  })();
  const tokenId = input.tokenId ?? 1;
  if (tokenId !== 1) throw new RangeError("The prepared immutable route currently supports token 1 of 1 only.");
  const derivedTokenSeed = input.derivedTokenSeed === undefined
    ? keccak256(encodeAbiParameters(
      [
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      ["keel.inline-token-seed@1", BigInt(input.chainId), collection, 1n, input.manifestDigest],
    ))
    : input.derivedTokenSeed.toLowerCase() as Hex;
  if (!/^0x[0-9a-f]{64}$/iu.test(derivedTokenSeed)) {
    throw new TypeError("A prepared tokenURI derived token seed must be canonical bytes32.");
  }
  const contextJSON = JSON.stringify({
    protocol: "keel-context@1",
    chainId: String(input.chainId),
    collection: collection.toLowerCase(),
    tokenId: "1",
    derivedTokenSeed,
    manifestDigest: input.manifestDigest.toLowerCase(),
  });
  const contextBytes = encoder.encode(contextJSON);
  const contextDigest = (await createIntegrity(contextBytes)).digest as Hex;
  assertPreparedImageURI(input.imageURI);
  const prefixHead = [
    `{"name":${JSON.stringify(`${input.collectionName} #1`)}`,
    `,"description":${JSON.stringify(input.description)}`,
    `,"image":${JSON.stringify(input.imageURI)}`,
  ].join("");
  const animationEncoding = input.graph.mediaType === "application/vnd.keel.token-uri-raw-percent-fragment"
    ? "raw-percent"
    : input.graph.mediaType === "application/vnd.keel.token-uri-percent-fragment"
      ? "percent"
      : "base64";
  if (presentationPolicy === "collector-inline" && animationEncoding !== "raw-percent") {
    throw new TypeError("Collector-facing Inline requires the automatic raw-percent carriage. Legacy Base64 requires an explicit presentation policy.");
  }
  if (
    input.graph.mediaType !== "application/vnd.keel.token-uri-base64-fragment"
    && input.graph.mediaType !== "application/vnd.keel.token-uri-base64-body-fragment"
    && input.graph.mediaType !== "application/vnd.keel.token-uri-percent-fragment"
    && input.graph.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment"
  ) {
    throw new TypeError(`Unsupported prepared tokenURI graph media type: ${input.graph.mediaType}`);
  }
  if (animationEncoding !== "base64" && input.shellFragments !== undefined) {
    throw new TypeError("Percent tokenURI graphs already include their pinned shell; percent follow-latest fragments are not supported.");
  }
  const animationKey = animationEncoding === "base64"
    ? ',"animation_url":"data:text/html;base64,'
    : ',"animation_url":"data:text/html;charset=utf-8,';
  const prefixPadding = animationEncoding === "raw-percent"
    ? 0
    : (3 - ((encoder.encode(prefixHead).byteLength + encoder.encode(animationKey).byteLength) % 3)) % 3;
  const prefixRaw = `${prefixHead}${" ".repeat(prefixPadding)}${animationKey}`;
  const suffixRaw = [
    animationEncoding !== "base64"
      ? decoder.decode(compactPercentPayload(encoder.encode(tokenContextHTMLTail(contextJSON, contextDigest, contextBytes.byteLength))))
      : Buffer.from(tokenContextHTMLTail(contextJSON, contextDigest, contextBytes.byteLength), "utf8").toString("base64"),
    '","keel_schema":"keel-manifest@2"',
    `,"keel_manifest":${JSON.stringify(input.manifestURI)}`,
    `,"keel_manifest_digest":${JSON.stringify(input.manifestDigest.toLowerCase())}`,
    ...(artifact === undefined ? [] : [`,"keel_artifact":${serializeInlineScriptJSON(artifact)}`]),
    ...(input.erc4804MetadataURI === undefined ? [] : [
      `,"keel_erc4804_metadata":${JSON.stringify(input.erc4804MetadataURI)}`,
    ]),
    ...(input.attributes === undefined ? [] : [`,"attributes":${serializeInlineScriptJSON(input.attributes)}`]),
    "}",
  ].join("");
  if (animationEncoding === "raw-percent") {
    const presentationFragmentBytes = input.graph.fragmentBytes;
    const encodedPrefix = compactPercentPayload(encoder.encode(prefixRaw));
    const encodedSuffix = compactPercentPayload(encoder.encode(suffixRaw));
    const tokenURIPayload = concat([encodedPrefix, presentationFragmentBytes, encodedSuffix]);
    const tokenJSON = decoder.decode(exactPercentPayloadBytes(tokenURIPayload, "Prepared raw-percent token JSON"));
    const animationMiddle = decoder.decode(exactPercentPayloadBytes(
      presentationFragmentBytes,
      "Prepared raw-percent animation middle",
    ));
    const expectedJSON = `${prefixRaw}${animationMiddle}${suffixRaw}`;
    if (tokenJSON !== expectedJSON) throw new Error("Prepared raw-percent fragments changed the exact token JSON bytes.");
    const metadata = JSON.parse(tokenJSON) as { readonly animation_url?: unknown };
    if (typeof metadata.animation_url !== "string") throw new Error("Prepared token metadata has no animation_url.");
    if (presentationPolicy === "collector-inline") assertKeelCollectorInlineMetadata(metadata);
    else assertMarketplaceSafeDataURI(metadata.animation_url, "Prepared token animation_url");
    return {
      schema: "keel-prepared-one-of-one-token-uri@1",
      animationEncoding,
      requiredBuilder: "KeelRawTokenURIBuilder",
      encodedPrefix,
      encodedSuffix,
      tokenURI: `data:application/json;charset=utf-8,${decoder.decode(tokenURIPayload)}`,
      tokenJSON,
      contextJSON,
      contextDigest,
      derivedTokenSeed,
    };
  }
  const prefix = createComposableBase64Fragment(prefixRaw, {
    mustAllowFollowingFragment: true,
    paddingStrategy: "json-whitespace",
  });
  if (prefix.paddingBytes !== 0) throw new Error("Prepared token JSON prefix failed its pre-animation alignment.");
  const presentationFragmentBytes = input.shellFragments === undefined
    ? input.graph.fragmentBytes
    : concat([input.shellFragments.prefix, input.graph.fragmentBytes, input.shellFragments.suffix]);
  const middleBase64 = decoder.decode(presentationFragmentBytes);
  const middleRaw = exactBase64Bytes(middleBase64, "Prepared tokenURI middle fragment");
  if (animationEncoding === "percent") {
    exactPercentPayloadBytes(middleRaw, "Prepared escaped animation middle");
  } else {
    exactBase64Bytes(decoder.decode(middleRaw), "Prepared Base64 animation middle");
  }
  const suffix = createComposableBase64Fragment(suffixRaw, { mustAllowFollowingFragment: false });
  const tokenURIBase64 = concatenateComposableBase64Fragments([
    prefix,
    { rawByteLength: middleRaw.byteLength, paddingBytes: 0, base64: middleBase64 },
    suffix,
  ]);
  const tokenJSON = Buffer.from(tokenURIBase64, "base64").toString("utf8");
  const expectedJSON = `${prefixRaw}${" ".repeat(prefix.paddingBytes)}${decoder.decode(middleRaw)}${suffixRaw}`;
  if (tokenJSON !== expectedJSON) throw new Error("Prepared tokenURI fragments changed the exact token JSON bytes.");
  const metadata = JSON.parse(tokenJSON) as { readonly animation_url?: unknown };
  if (typeof metadata.animation_url !== "string") throw new Error("Prepared token metadata has no animation_url.");
  if (presentationPolicy === "collector-inline") assertKeelCollectorInlineMetadata(metadata);
  else assertMarketplaceSafeDataURI(metadata.animation_url, "Prepared token animation_url");
  return {
    schema: "keel-prepared-one-of-one-token-uri@1",
    animationEncoding,
    requiredBuilder: animationEncoding === "percent" ? "KeelPercentTokenURIBuilder" : "KeelHarnessBuilder",
    encodedPrefix: encoder.encode(prefix.base64),
    encodedSuffix: encoder.encode(suffix.base64),
    tokenURI: `data:application/json;base64,${tokenURIBase64}`,
    tokenJSON,
    contextJSON,
    contextDigest,
    derivedTokenSeed,
  };
}

/** Exact default-fragment byte counts for previews, without allocating another large document. */
export function measureKeelInlineCompactGraph(root: KeelInlineGraphDocument) {
  let graphByteLength = 0;
  let creatorPublicationBytes = 0;
  for (const part of root.parts) {
    let byteLength = 0;
    // One unsafe source byte becomes %HH inside HTML, then %25HH in metadata.
    for (const byte of part.bytes) byteLength += isDataUriLiteralByte(byte) ? 1 : 5;
    graphByteLength += byteLength;
    if (part.kind === "creator") creatorPublicationBytes += byteLength;
  }
  return { carriage: "raw-percent" as const, completeDocumentBase64Layers: 0 as const,
    graphByteLength, creatorPublicationBytes, requiredBuilder: "KeelRawTokenURIBuilder" as const };
}

/** Reuse Studio's selected-chain normal-media composition without rebuilding
 * a newer local shell. Callers must verify registeredShell against the selected
 * chain registration; this function verifies byte commitments and carriage. */
export async function buildKeelPublishedInlineNormalMediaTokenURIGraph(input: {
  readonly asset: { readonly id: string; readonly mediaType: KeelAssetDisplayMediaType; readonly source: Uint8Array; readonly compression?: "none" | "gzip" | "deflate" };
  readonly registeredShell: readonly [KeelPublishedInlineFragment, KeelPublishedInlineFragment];
  readonly existingParts: readonly [KeelPublishedInlineFragment, KeelPublishedInlineFragment, KeelPublishedInlineFragment];
}) {
  keelAssetDisplayKind(input.asset.mediaType);
  const halves = [];
  for (const [index, published] of [input.existingParts[0], input.existingParts[2]].entries()) {
    const registered = input.registeredShell[index]!;
    await assertPublishedFragmentIntegrity(registered, "Registered shell");
    await assertPublishedFragmentIntegrity(published, "Compact shell");
    const bytes = decodePublishedGraphPart(published);
    const normalize = (v: Uint8Array) => decoder.decode(v).replace(/ {0,8}$/u, "");
    if (normalize(bytes) !== normalize(decodePublishedGraphPart(registered))) throw new Error("Compact shell differs from the registered canonical shell.");
    halves.push({ bytes, integrity: await createIntegrity(bytes) });
  }
  await verifyKeelPublishedInlineModuleFragment({ fragment: input.existingParts[1],
    moduleId: KEEL_ASSET_DISPLAY_MODULE_ID, mediaType: "text/javascript",
    aliases: [KEEL_ASSET_DISPLAY_MODULE_ID], decodedBytes: keelAssetDisplayModuleBytes() });
  const document = await buildKeelInlineLocalDocument({
    shell: { schema: "keel-inline-shell-fragments@1", codecProfile: "browser-gzip-deflate", prefix: halves[0]!, suffix: halves[1]! },
    modules: [await buildKeelInlineAssetDisplayModuleFragment()], entry: input.asset,
  });
  const graph = await buildKeelInlineTokenURIGraph(document, { existingParts: input.existingParts });
  const reused = graph.parts.filter(part => part.sourceKind === "existing");
  if (reused.length !== 3 || reused.some((part, index) => !exactBytes(part.bytes, input.existingParts[index]!.bytes))) {
    throw new Error("Inline graph did not preserve the exact registered fragments.");
  }
  return { document, graph };
}
