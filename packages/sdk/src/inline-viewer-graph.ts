import { snapshotKeelExplicitExternalPreview, assertKeelExternalPreviewImageURI, type KeelExplicitExternalPreview } from "./external-preview.js";
export { prepareKeelExplicitExternalPreview, snapshotKeelExplicitExternalPreview } from "./external-preview.js";
export type { KeelExplicitExternalPreview } from "./external-preview.js";
import { assertKeelRegisteredNativeGzipProof, createKeelRegisteredNativeGzipProof, snapshotKeelRegisteredNativeGzipBinding, KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE, type KeelRegisteredNativeGzipBinding, type KeelRegisteredNativeGzipProof } from "./registered-native-gzip.js";
import { assertKeelFreshPayloadCarriage, assertKeelPreparedCollectorInlineMetadata as assertKeelCollectorInlineMetadata } from "./inline-transport-audit.js";
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
  canonicalJson,
  resolveKeelPayloadStorage,
  type KeelPayloadStorageMode,
  isDataUriLiteralByte,
  serializeScriptJSON,
  toPercentDataUrl,
  type Hex,
  type Integrity,
  resolveKeelPreparationReadBounds,
  type KeelTokenURIPreparationBudget, type KeelExplicitNonstandardReadPolicy,
} from "@keel/protocol";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { decodeLzmaCommittedSync } from "./decoders/node.js";
import { gzipSync, gunzip, gunzipSync, inflate, inflateSync, brotliDecompress, brotliDecompressSync } from "node:zlib";
import { encodeAbiParameters, getAddress, keccak256, stringToHex } from "viem";

import { KEEL_INLINE_MAX_TOKEN_URI_BYTES, keelWeb3ObjectURI, resolveKeelInlineCarriage, type KeelInlineCarriage } from "./presentation.js";
import { assertKeelInlineImageBytes, prepareKeelInlineImageCarriage, type KeelPresentationPolicy } from "./collector-policy.js";
import { KEEL_CREATIVE_RUNTIME_CATALOG } from './creative-runtime-catalog.js';
import {inspectKeelModelMedia, KEEL_MODEL_MEDIA_TYPES, type KeelModelMediaType, type KeelModelResource} from "./model-media.js";
import {KEEL_MODEL_VENDOR_MODULES, KEEL_MODEL_DISPLAY_MODULE_ID, KEEL_MODEL_DISPLAY_REVISION, keelModelDisplayModuleBytes, keelModelViewerModuleProfiles} from "./model-viewer-module.js";
import {
  KEEL_ASSET_DISPLAY_MEDIA_TYPES,
  KEEL_ASSET_DISPLAY_MODULE_ID,
  KEEL_ASSET_DISPLAY_MODULE_VERSION,
  keelAssetDisplayKind,
  keelAssetDisplayModuleRevision,
  keelAssetDisplayModuleBytes,
  type KeelAssetDisplayKind,
  type KeelAssetDisplayMediaType,
} from "./asset-display.js";
import {
  buildCompactInlineKeelShell,
  buildEmbeddedKeelViewerSlot,
  isKeelViewerTextMediaType,
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

export type KeelInlineCodecProfile = "native" | "brotli-js" | "lzma-js" | "brotli-lzma-js";
export type KeelInlineCompression = "none" | "gzip" | "deflate" | "brotli" | "lzma";

function inlineCompression(mode: KeelPayloadStorageMode, compression: KeelInlineCompression | undefined, fallback: KeelInlineCompression): KeelInlineCompression {
  if (mode === "raw" && compression !== undefined && compression !== "none") {
    throw new TypeError("Raw payload storage preserves supplied bytes; remove the Inline compression override or select Compact.");
  }
  return mode === "raw" ? "none" : compression ?? fallback;
}

function assetCompression(asset: { readonly payloadStorage?: KeelPayloadStorageMode; readonly compression?: KeelInlineCompression; readonly mediaType: string; readonly source: Uint8Array }, mode: KeelPayloadStorageMode): KeelInlineCompression {
  const storage = inheritInlineStorage(mode, asset.payloadStorage);
  const selected = inlineCompression(storage, asset.compression, "none");
  if (asset.compression !== undefined || storage === "raw" || isKeelViewerTextMediaType(asset.mediaType)) return selected;
  return gzipSync(asset.source, { level: 9 }).byteLength < asset.source.byteLength ? "gzip" : "none";
}

function inheritInlineStorage(parent: KeelPayloadStorageMode, child?: KeelPayloadStorageMode): KeelPayloadStorageMode {
  const storage = resolveKeelPayloadStorage(child ?? parent);
  if (parent === "raw" && storage !== "raw") throw new TypeError("A Compact child cannot override Raw payload storage.");
  return storage;
}

const INLINE_PROFILE_CODECS: Readonly<Record<KeelInlineShellFragments["codecProfile"], readonly KeelInlineCompression[]>> = {
  "browser-gzip-deflate": ["none", "gzip", "deflate"],
  "browser-gzip-deflate-brotli-js": ["none", "gzip", "deflate", "brotli"],
  "browser-gzip-deflate-lzma-js": ["none", "gzip", "deflate", "lzma"],
  "browser-gzip-deflate-brotli-lzma-js": ["none", "gzip", "deflate", "brotli", "lzma"],
};

export interface KeelInlineShellFragments {
  readonly schema: "keel-inline-shell-fragments@1";
  readonly codecProfile: "browser-gzip-deflate" | "browser-gzip-deflate-brotli-js" | "browser-gzip-deflate-lzma-js" | "browser-gzip-deflate-brotli-lzma-js";
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
  readonly role: "shell-prefix" | "module" | "entrypoint" | "asset" | "shell-suffix";
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

/** Reuse published prepared bytes; this context never authorizes new source objects. */
export interface KeelInlineExistingObjectReuse {
  readonly mode: "assembly-only";
  readonly chainId: number;
  readonly store: Hex;
}

/** Ordered receipt/read-back bytes, not a locally prepared replacement. */
export interface KeelInlineExistingObjectReusePart extends KeelPublishedInlineFragment {
  readonly role: KeelInlineDocumentPart["role"];
  readonly moduleId?: string;
  readonly moduleVersion?: string;
  readonly execution?: "classic" | "module";
  readonly phase?: KeelModulePhase;
  readonly weight?: number;
}

export interface KeelInlineExistingObjectReuseOptions {
  readonly registeredNativeGzip?: KeelRegisteredNativeGzipProof | undefined;
  readonly nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy;
  readonly preparationReadBudget?: KeelTokenURIPreparationBudget;
  readonly existingParts?: readonly KeelPublishedInlineFragment[];
  readonly existingObjectReuse?: KeelInlineExistingObjectReuse;
}

export interface KeelInlineExistingObjectReuseInspection {
  readonly root: KeelInlineGraphDocument;
  readonly carriage: Exclude<KeelInlineCarriage, "compact">;
  readonly existingParts: readonly KeelInlineExistingObjectReusePart[];
  readonly reusedObjectIds: readonly Hex[];
  readonly newSourcePublicationBytes: 0;
  readonly storageTransform: "none";
  /** Byte inspection does not replace selected-chain registration/read-back proof. */
  readonly selectedChainBindingVerified: false;
}

export interface KeelInlineLocalDocument extends KeelInlineGraphDocument {
  readonly schema: "keel-inline-local-document@1";
}

export interface KeelInlineModelMediaDocument extends KeelInlineLocalDocument {
  /** Byte inspection only; selected-chain reauthentication is still mandatory. */
  readonly registeredNativeGzip?: KeelRegisteredNativeGzipProof;
  readonly modelPresentation: {
    readonly schema: "keel-model-presentation@1";
    readonly originalEntry: {readonly id: string; readonly mediaType: KeelModelMediaType; readonly aliases: readonly string[]; readonly integrity: Integrity};
    readonly originalDependencies: readonly {readonly id: string; readonly mediaType: string; readonly aliases: readonly string[]; readonly integrity: Integrity}[];
    readonly generatedEntry: {readonly id: string; readonly mediaType: "text/html"; readonly integrity: Integrity; readonly kind: "derived-presentation"};
    readonly bindingIntegrity: Integrity;
    readonly sourceStorage: readonly {readonly id: string; readonly compression: "none" | "gzip"; readonly decodedByteLength: number; readonly storedByteLength: number; readonly descriptorByteLength: number}[];
    readonly byteCounts: {readonly originalSources: number; readonly generatedHTML: number; readonly sharedDecodedModules: number; readonly completeHTML: number};
  };
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
  readonly registeredNativeGzip?: KeelRegisteredNativeGzipProof | undefined;
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
  readonly externalPreview?: KeelExplicitExternalPreview;
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
const brotliDecompressAsync = promisify(brotliDecompress);
const SAFE_INLINE_MODULE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
// Arweave locators carry an authority or a 32-byte base64url transaction ID.
// A minified JS ternary such as `ready ? ar : 1` is not a content locator.
const EXTERNAL_RESOURCE_LITERAL = /\b(?:(?:https?|ipfs|web3|keel-onchain):[^\s"'<>\\]+|ar:(?:\/\/[^\s"'<>\\]+|[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])(?:\/[^\s"'<>\\]*)?))/giu;

/** Shared library bytes are not creator resources. Match the full pinned artifact. */
async function assertInlineModuleDependencies(bytes: Uint8Array, moduleId: string): Promise<void> {
  const model = KEEL_MODEL_VENDOR_MODULES.find(module => module.moduleId === moduleId)
    ?? (moduleId === KEEL_MODEL_DISPLAY_MODULE_ID ? KEEL_MODEL_DISPLAY_REVISION : undefined);
  if (model !== undefined) {
    const actual = await createIntegrity(bytes);
    if (actual.digest !== model.digest || actual.byteLength !== model.byteLength) throw new TypeError(`Inline model runtime ${moduleId} differs from its pinned artifact.`);
    return;
  }
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
  const scanLimit = 32 * 1024 * 1024;
  let expandedBytes = 0;
  const inspect = (candidate: Uint8Array, depth: number): void => {
    let text: string;
    try {
      text = decoder.decode(candidate);
    } catch {
      return;
    }
    const digest = createHash("sha256"); digest.update(candidate);
    const key = `${depth}:${digest.digest("hex")}`;
    if (visited.has(key)) return;
    visited.add(key);
    if (depth < 4) {
      let percentDecoded: string | undefined;
      try { percentDecoded = decodeURIComponent(text); } catch { /* Not percent-encoded text. */ }
      if (percentDecoded !== undefined && percentDecoded !== text) inspect(encoder.encode(percentDecoded), depth + 1);
    }
    if (/keel\.invalid/iu.test(text)) found.add("keel.invalid");
    for (const match of text.matchAll(EXTERNAL_RESOURCE_LITERAL)) {
      const value = match[0].replace(/[),.;]+$/u, "");
      if (value !== "http://www.w3.org/2000/svg") found.add(value);
    }
    if (depth >= 4) return;
    const expanded = (value: Uint8Array): void => {
      expandedBytes += value.byteLength;
      if (expandedBytes > scanLimit) throw new TypeError(label + " exceeds nested resource scan bounds.");
      inspect(value, depth + 1);
    };
    // Exact JSON slot descriptors carry the output commitment needed by LZMA-alone.
    // The native stream header commonly has no size; never infer or guess one.
    const knownLzma = new Set<string>();
    let json: unknown;
    try { if (/compression["']?\s*:\s*["']lzma["']/u.test(text)) json = JSON.parse(text.trimStart().replace(/^,/u, "")); } catch { /* Source code need not be JSON. */ }
    const objects: unknown[] = json === undefined ? [] : [json];
    for (let at = 0; at < objects.length; at++) {
      if (objects.length > 65536) throw new TypeError(label + " exceeds nested descriptor bounds.");
      const value = objects[at];
      if (value === null || typeof value !== "object") continue;
      const item = value as { embedded?: { compression?: unknown; storedBase64?: unknown }; integrity?: { byteLength?: unknown } };
      if (item.embedded?.compression === "lzma" && typeof item.embedded.storedBase64 === "string") {
        const length = item.integrity?.byteLength;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > scanLimit - expandedBytes) {
          throw new TypeError(label + " needs a bounded decoded length for nested LZMA.");
        }
        const packed = exactBase64Bytes(item.embedded.storedBase64, label + " nested LZMA");
        expanded(decodeLzmaCommittedSync(packed, { decodedByteLength: length, maxDecodedBytes: scanLimit - expandedBytes }));
        knownLzma.add(item.embedded.storedBase64);
      }
      const children = Object.values(value);
      if (objects.length + children.length > 65536) throw new TypeError(label + " exceeds nested descriptor bounds.");
      for (const child of children) objects.push(child);
    }
    for (const match of text.matchAll(/storedBase64["']?\s*:\s*["']([A-Za-z0-9+/=]+)["']/gu)) {
      if (knownLzma.has(match[1]!)) continue;
      if (/compression["']?\s*:\s*["']lzma["']/u.test(text)) {
        throw new TypeError(label + " contains nested LZMA without an exact JSON output commitment.");
      }
      const stored = Buffer.from(match[1]!, "base64"), remaining = Math.max(1, scanLimit - expandedBytes);
      for (const unpack of [
        () => gunzipSync(stored, { maxOutputLength: remaining }),
        () => inflateSync(stored, { maxOutputLength: remaining }),
        () => brotliDecompressSync(stored, { maxOutputLength: remaining }),
      ]) {
        let unpacked: Uint8Array;
        try { unpacked = new Uint8Array(unpack()); }
        catch (error) {
          if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new TypeError(label + " exceeds nested resource scan bounds.");
          continue; // May use another supported compression.
        }
        expanded(unpacked);
        break;
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
    // URI81 registrations also copy the three RFC-valid URI literals that the
    // older writer escapes. Decode either registration without rewriting it.
    return exactPercentPayloadBytes(exactPercentPayloadBytes(bytes, "Inline metadata fragment", true), "Inline HTML fragment", true);
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

/**
 * Inspect exact published prepared fragments without encoding, padding or
 * compressing them. The host must verify their selected-chain receipts,
 * registration and original graph order before proposing an assembly revision.
 * Raw binary objects are incompatible with a prepared-copy carriage: fail
 * instead of silently transcoding or republishing them.
 */
export async function inspectKeelInlineExistingObjectReuse(input: {
  readonly nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy;
  readonly preparationReadBudget?: KeelTokenURIPreparationBudget;
  readonly existingObjectReuse: KeelInlineExistingObjectReuse;
  readonly existingParts: readonly KeelInlineExistingObjectReusePart[];
  readonly carriage?: KeelInlineCarriage;
}): Promise<KeelInlineExistingObjectReuseInspection> {
  const readBounds = resolveKeelPreparationReadBounds(input);
  const scope = { ...input.existingObjectReuse };
  const requestedCarriage = input.carriage;
  if (scope?.mode !== "assembly-only" || !Number.isSafeInteger(scope.chainId) || scope.chainId <= 0
      || !/^0x[0-9a-f]{40}$/iu.test(scope.store) || /^0x0{40}$/iu.test(scope.store)) {
    throw new TypeError("Existing-object reuse requires an assembly-only selected-chain store binding.");
  }
  if (!Array.isArray(input.existingParts) || input.existingParts.length < 2 || input.existingParts.length > 128
      || input.existingParts[0]?.role !== "shell-prefix" || input.existingParts.at(-1)?.role !== "shell-suffix") {
    throw new TypeError("Existing-object reuse requires 2–128 ordered published parts with both shell boundaries.");
  }
  // Capture every caller-owned value before the first digest await.
  const suppliedParts = input.existingParts.map(source => ({ ...source,
    bytes: source.bytes instanceof Uint8Array ? new Uint8Array(source.bytes) : source.bytes,
    carrier: { ...source.carrier }, integrity: { ...source.integrity } }));
  const existingParts: KeelInlineExistingObjectReusePart[] = [];
  const parts: KeelInlineDocumentPart[] = [];
  const commitments = new Map<string, string>();
  let storedBytes = 0;
  for (let index = 0; index < suppliedParts.length; index += 1) {
    const source = suppliedParts[index]!;
    if (!["shell-prefix", "module", "entrypoint", "asset", "shell-suffix"].includes(source.role)
        || (index > 0 && index < suppliedParts.length - 1 && source.role.startsWith("shell-"))) {
      throw new TypeError("Existing-object reuse cannot move shell boundaries into body slots.");
    }
    if (!(source.bytes instanceof Uint8Array) || source.bytes.byteLength === 0
        || source.carrier?.chainId !== scope.chainId || typeof source.carrier.store !== "string"
        || source.carrier.store.toLowerCase() !== scope.store.toLowerCase()
        || !/^0x[0-9a-f]{64}$/iu.test(source.carrier.objectId) || /^0x0{64}$/iu.test(source.carrier.objectId)
        || source.integrity?.algorithm !== "sha256" || !/^0x[0-9a-f]{64}$/iu.test(source.integrity.digest)) {
      throw new TypeError(`Existing Inline part ${index} has an invalid selected-chain object or SHA-256 commitment.`);
    }
    storedBytes += source.bytes.byteLength;
    if (storedBytes > readBounds.maximumTokenUriBytes) {
      throw new RangeError(`Existing prepared bytes exceed the ${readBounds.maximumTokenUriBytes.toLocaleString()}-byte selected public-read ceiling.`);
    }
    const published = source;
    await assertPublishedFragmentIntegrity(published, `Existing Inline ${source.role}`);
    const media = published.carrier.mediaType;
    if (!["application/vnd.keel.token-uri-raw-percent-fragment", "application/vnd.keel.token-uri-percent-fragment",
      "application/vnd.keel.token-uri-base64-fragment", "application/vnd.keel.token-uri-base64-body-fragment"].includes(media)) {
      throw new TypeError(`Existing Inline part ${index} has incompatible prepared-copy media ${media}; reuse never transcodes stored bytes.`);
    }
    const decodedBytes = decodePublishedGraphPart(published);
    if (media !== "application/vnd.keel.token-uri-raw-percent-fragment" && decoder.decode(published.bytes).includes("=")) {
      throw new TypeError("Existing prepared fragments must be unpadded for exact concatenation.");
    }
    if (media.includes("base64") && decodedBytes.byteLength % 9 !== 0) {
      throw new TypeError("Existing Base64 fragments must retain their exact nine-byte HTML alignment.");
    }
    const id = published.carrier.objectId.toLowerCase();
    const commitment = JSON.stringify([media, published.carrier.compression, published.integrity.digest.toLowerCase(), published.bytes.byteLength]);
    if (commitments.has(id) && commitments.get(id) !== commitment) {
      throw new TypeError("One immutable object ID has conflicting prepared-byte commitments.");
    }
    commitments.set(id, commitment);
    existingParts.push(published);
    parts.push({ kind: "existing", role: published.role,
      ...(published.moduleId === undefined ? {} : { moduleId: published.moduleId }),
      ...(published.moduleVersion === undefined ? {} : { moduleVersion: published.moduleVersion }),
      ...(published.execution === undefined ? {} : { execution: published.execution }),
      ...(published.phase === undefined ? {} : { phase: published.phase }),
      ...(published.weight === undefined ? {} : { weight: published.weight }),
      bytes: decodedBytes, byteLength: decodedBytes.byteLength, integrity: await createIntegrity(decodedBytes) });
  }
  const media = existingParts.map(part => part.carrier.mediaType);
  if (!media.every(value => value === "application/vnd.keel.token-uri-raw-percent-fragment")) {
    throw new KeelLegacyCarriageError("Existing non-raw-percent prepared fragments");
  }
  const carriage = "raw-percent" as const;
  if (requestedCarriage !== undefined && resolveKeelInlineCarriage(requestedCarriage) !== carriage) {
    throw new TypeError(`Requested Inline carriage does not match the existing ${carriage} prepared bytes.`);
  }
  const rootBytes = concat(parts.map(part => part.bytes));
  return { root: { rootBytes, rootIntegrity: await createIntegrity(rootBytes), byteLength: rootBytes.byteLength, parts },
    carriage, existingParts, reusedObjectIds: existingParts.map(part => part.carrier.objectId),
    newSourcePublicationBytes: 0, storageTransform: "none", selectedChainBindingVerified: false };
}

async function inspectExistingGraphReuse(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions,
  carriage?: KeelInlineCarriage,
): Promise<KeelInlineExistingObjectReuseInspection | undefined> {
  if (options.existingObjectReuse === undefined) return undefined;
  root = { ...root, rootBytes: new Uint8Array(root.rootBytes), rootIntegrity: { ...root.rootIntegrity },
    parts: root.parts.map(part => ({ ...part, bytes: new Uint8Array(part.bytes), integrity: { ...part.integrity } })) };
  if (root.parts.some(part => part.kind !== "existing") || options.existingParts?.length !== root.parts.length) {
    throw new TypeError("Assembly-only reuse requires an exact published object for every ordered part; new source publication is forbidden.");
  }
  const inspected = await inspectKeelInlineExistingObjectReuse({ existingObjectReuse: options.existingObjectReuse, ...(options.nonstandardReadPolicy === undefined ? {} : { nonstandardReadPolicy: options.nonstandardReadPolicy }), ...(options.preparationReadBudget === undefined ? {} : { preparationReadBudget: options.preparationReadBudget }),
    existingParts: options.existingParts.map((part, index) => ({ ...root.parts[index]!, ...part, role: root.parts[index]!.role })),
    ...(carriage === undefined ? {} : { carriage }) });
  for (let index = 0; index < root.parts.length; index += 1) {
    const source = root.parts[index]!;
    const actual = inspected.root.parts[index]!;
    if (source.byteLength !== source.bytes.byteLength || !exactBytes(source.bytes, actual.bytes)
        || (source.kind === "existing" && actual.kind === "existing"
          && ["moduleId", "moduleVersion", "execution", "phase", "weight"].some(key =>
            source[key as keyof typeof source] !== actual[key as keyof typeof actual]))
        || source.integrity.algorithm !== actual.integrity.algorithm || source.integrity.byteLength !== actual.integrity.byteLength
        || source.integrity.digest.toLowerCase() !== actual.integrity.digest.toLowerCase()) {
      throw new TypeError(`Existing Inline part ${index} differs from the published decoded source; reuse cannot replace or repad it.`);
    }
  }
  if (root.byteLength !== root.rootBytes.byteLength || !exactBytes(root.rootBytes, inspected.root.rootBytes)
      || root.rootIntegrity.algorithm !== inspected.root.rootIntegrity.algorithm
      || root.rootIntegrity.byteLength !== inspected.root.rootIntegrity.byteLength
      || root.rootIntegrity.digest.toLowerCase() !== inspected.root.rootIntegrity.digest.toLowerCase()) {
    throw new TypeError("Existing Inline root differs from its exact ordered published source commitment.");
  }
  return inspected;
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
    || !["none", "gzip", "deflate", "brotli", "lzma"].includes(item.embedded.compression)
  ) {
    throw new TypeError(`Inline module ${input.moduleId} metadata does not match its SDK declaration.`);
  }
  const hasText = item.embedded.storedText !== undefined, hasBase64 = item.embedded.storedBase64 !== undefined;
  if (hasText === hasBase64 || (hasText && (typeof item.embedded.storedText !== "string" || item.embedded.compression !== "none"))
      || (hasBase64 && typeof item.embedded.storedBase64 !== "string")) {
    throw new TypeError(`Inline module ${input.moduleId} has ambiguous or invalid embedded bytes.`);
  }
  const stored = hasText ? encoder.encode(item.embedded.storedText!)
    : exactBase64Bytes(item.embedded.storedBase64!, `Inline module ${input.moduleId} payload`);
  if (hasText && new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stored) !== item.embedded.storedText) {
    throw new TypeError(`Inline module ${input.moduleId} has invalid UTF-8 text.`);
  }
  const decoded = item.embedded.compression === "gzip"
    ? new Uint8Array(await gunzipAsync(stored, { maxOutputLength: Math.max(1, input.decodedBytes.byteLength) }))
    : item.embedded.compression === "deflate"
      ? new Uint8Array(await inflateAsync(stored, { maxOutputLength: Math.max(1, input.decodedBytes.byteLength) }))
      : item.embedded.compression === "brotli"
        ? new Uint8Array(await brotliDecompressAsync(stored, { maxOutputLength: Math.max(1, input.decodedBytes.byteLength) }))
        : item.embedded.compression === "lzma"
          ? await (await import("./decoders/index.js")).decodeLzma(stored, { decodedByteLength: input.decodedBytes.byteLength })
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

function exactPercentPayloadBytes(payload: Uint8Array, label: string, allowURI81Literals = false): Uint8Array {
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
    if (!isDataUriLiteralByte(byte) && !(allowURI81Literals && (byte === 0x3f || byte === 0x27 || byte === 0x26))) {
      throw new TypeError(`${label} contains an unsafe literal byte.`);
    }
    output.push(byte);
  }
  return new Uint8Array(output);
}

function isRawPercentReadLiteralByte(byte: number): boolean {
  return isDataUriLiteralByte(byte) || byte === 0x3f || byte === 0x27 || byte === 0x26;
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

/** Retired whole-document Base64 publication entrypoint. */
export async function buildKeelPreparedTokenURIFragment(
  source: Uint8Array | string,
): Promise<KeelPreparedTokenURIFragment> {
  throw new KeelLegacyCarriageError("buildKeelPreparedTokenURIFragment");
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
    if (isRawPercentReadLiteralByte(character)) continue;
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

/** Build official reusable shell halves with an explicit optional JavaScript decoder profile. */
export async function buildKeelInlineShellFragments(input: {
  readonly repositoryRoot?: string;
  readonly codecProfile?: KeelInlineCodecProfile;
  readonly optionalMarketplaceInfo?: import("./marketplace-reader.js").KeelShellMarketplaceConfig;
} = {}): Promise<KeelInlineShellFragments> {
  const shell = await buildCompactInlineKeelShell(input);
  return {
    schema: "keel-inline-shell-fragments@1",
    codecProfile: input.codecProfile === undefined || input.codecProfile === "native"
      ? "browser-gzip-deflate" : `browser-gzip-deflate-${input.codecProfile}`,
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
  readonly compression?: KeelInlineCompression;
  readonly payloadStorage?: KeelPayloadStorageMode;
  /** Exact precompressed input; required for LZMA. The SDK validates its reconstruction. */
  readonly storedBytes?: Uint8Array;
  readonly execution?: "classic" | "module";
  readonly phase?: KeelModulePhase;
  readonly weight?: number;
}): Promise<KeelInlineModuleFragment> {
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
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
    compression: inlineCompression(payloadStorage, input.compression, "none"),
    ...(input.storedBytes === undefined ? {} : { storedBytes: input.storedBytes }),
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
    compression: "none",
    execution: "classic",
    phase: "render",
  }) as KeelInlineAssetDisplayModuleFragment;
}

function isNormalMediaEntry(mediaType: string): mediaType is KeelAssetDisplayMediaType {
  return (KEEL_ASSET_DISPLAY_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

function isModelMediaEntry(mediaType: string): mediaType is KeelModelMediaType {
  return (KEEL_MODEL_MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/** Exact complete-model closure, never arbitrary modules or a first-primitive fallback. */
async function assertCanonicalModelMediaGraph(entry: KeelModelResource, assets: readonly KeelModelResource[], modules: readonly KeelInlineModuleFragment[]): Promise<void> {
  const inspection = inspectKeelModelMedia(entry, assets);
  const expected = keelModelViewerModuleProfiles(inspection.format, inspection.materialLibraryIds.length !== 0);
  if (modules.length !== expected.length) throw new TypeError("Direct models require the exact complete registered model-viewer dependency closure.");
  for (let index = 0; index < expected.length; index++) {
    const profile = expected[index]!, module = modules[index]!, embedded = module.item.embedded;
    if (module.moduleId !== profile.moduleId || module.version !== profile.version || module.phase !== profile.phase || module.execution !== profile.execution || module.weight !== profile.weight || embedded === undefined || !["none", "gzip"].includes(embedded.compression)) throw new TypeError("Model module identity, order, execution or codec differs from its exact closure.");
    const stored = embedded.storedText === undefined ? exactBase64Bytes(embedded.storedBase64 ?? "", "Model module") : encoder.encode(embedded.storedText);
    const decoded = embedded.compression === "gzip" ? new Uint8Array(gunzipSync(stored, {maxOutputLength: profile.byteLength})) : stored;
    const integrity = await createIntegrity(decoded);
    if (integrity.digest !== profile.digest || integrity.byteLength !== profile.byteLength) throw new TypeError("Model module source does not match its pinned official byte profile.");
    const canonical = await buildKeelInlineModuleFragment({moduleId: profile.moduleId, version: profile.version, mediaType: "text/javascript", aliases: profile.aliases, decodedBytes: decoded, compression: embedded.compression as "none" | "gzip", execution: profile.execution, phase: profile.phase, weight: profile.weight});
    if (!exactBytes(module.bytes, canonical.bytes) || module.integrity.digest !== canonical.integrity.digest || module.integrity.byteLength !== canonical.integrity.byteLength || module.item.role !== "module") throw new TypeError("Model module fragment or aliases differ from the canonical closed graph.");
  }
}

/** Local preparation only: published reuse still needs exact same-chain receipts/read-back. */
export async function buildKeelInlineModelViewerModules(input: {readonly format: "gltf" | "obj"; readonly materialLibraries?: boolean; readonly three: {readonly main: Uint8Array; readonly core: Uint8Array}}): Promise<readonly KeelInlineModuleFragment[]> {
  return await Promise.all(keelModelViewerModuleProfiles(input.format, input.materialLibraries).map(async profile => {
    const source = profile.moduleId === "three-r180-core" ? input.three.core : profile.moduleId === "three-r180-module" ? input.three.main : profile.moduleId === KEEL_MODEL_DISPLAY_MODULE_ID ? keelModelDisplayModuleBytes() : new TextEncoder().encode(KEEL_MODEL_VENDOR_MODULES.find(module => module.moduleId === profile.moduleId)!.source);
    const integrity = await createIntegrity(source);
    if (integrity.digest !== profile.digest || integrity.byteLength !== profile.byteLength) throw new TypeError("Model graph needs the exact pinned source bytes.");
    return await buildKeelInlineModuleFragment({moduleId: profile.moduleId, version: profile.version, mediaType: "text/javascript", aliases: profile.aliases, decodedBytes: source, compression: "gzip", execution: profile.execution, phase: profile.phase, weight: profile.weight});
  }));
}

async function assertCanonicalAssetDisplayModule(module: KeelInlineModuleFragment): Promise<void> {
  const revision = keelAssetDisplayModuleRevision(module.version);
  const embedded = module.item.embedded;
  if (revision === undefined || embedded === undefined || !["none", "gzip"].includes(embedded.compression)) {
    throw new TypeError("Direct media requires the exact registered keel.asset-display module in a supported canonical revision.");
  }
  const stored = embedded.storedText !== undefined
    ? encoder.encode(embedded.storedText)
    : exactBase64Bytes(embedded.storedBase64 ?? "", "Canonical asset-display payload");
  const decoded = embedded.compression === "gzip"
    ? new Uint8Array(gunzipSync(stored, {maxOutputLength: revision.byteLength}))
    : stored;
  const decodedHash=createHash("sha256"); decodedHash.update(decoded);
  if (decoded.byteLength !== revision.byteLength || "0x" + decodedHash.digest("hex") !== revision.digest) {
    throw new TypeError("Direct media asset-display bytes do not match their canonical revision.");
  }
  const expected = await buildKeelInlineModuleFragment({
    moduleId: KEEL_ASSET_DISPLAY_MODULE_ID,
    version: revision.version,
    mediaType: "text/javascript",
    aliases: [KEEL_ASSET_DISPLAY_MODULE_ID],
    decodedBytes: decoded,
    compression: embedded.compression as "none" | "gzip",
    execution: "classic",
    phase: "render",
    weight: 0,
  });
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
  readonly payloadStorage?: KeelPayloadStorageMode;
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
    readonly compression?: KeelInlineCompression;
  readonly payloadStorage?: KeelPayloadStorageMode;
  /** Exact precompressed input; required for LZMA. The SDK validates its reconstruction. */
  readonly storedBytes?: Uint8Array;
  }[];
  readonly entry: {
    readonly id: string;
    /** Metadata background_color, or omit to match a uniform image border. */
    readonly backgroundColor?: string;
    /** Text artwork, or the direct creator media entry mounted by keel.asset-display. */
    readonly mediaType: "text/html" | "text/javascript" | KeelAssetDisplayMediaType | KeelModelMediaType;
    readonly source: Uint8Array;
    readonly compression?: KeelInlineCompression;
  readonly payloadStorage?: KeelPayloadStorageMode;
  /** Exact precompressed input; required for LZMA. The SDK validates its reconstruction. */
  readonly storedBytes?: Uint8Array;
    readonly aliases?: readonly string[];
  };
}): Promise<KeelInlineLocalDocument> {
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  const entryCompression = inlineCompression(inheritInlineStorage(payloadStorage, input.entry.payloadStorage), input.entry.compression, "none");
  const orderedModules = orderKeelModules(input.modules);
  const assets = input.assets ?? [];
  const supported = INLINE_PROFILE_CODECS[input.shell.codecProfile];
  if (supported === undefined) throw new TypeError("Unknown Inline decoder shell profile.");
  const requireCodec = (compression: string, label: string): void => {
    if (!supported.includes(compression as KeelInlineCompression)) {
      throw new TypeError(`${label} requires a declared ${compression} decoder shell profile.`);
    }
  };
  requireCodec(entryCompression, `Inline entrypoint ${input.entry.id}`);
  for (const asset of assets) requireCodec(assetCompression(asset, payloadStorage), `Inline asset ${asset.id}`);
  const ids = new Set<string>();
  for (const module of orderedModules) {
    if (!SAFE_INLINE_MODULE_ID.test(module.moduleId) || module.item.id !== module.moduleId) {
      throw new TypeError(`Inline module ${module.moduleId} has an unsafe or mismatched resource ID.`);
    }
    if (ids.has(module.moduleId)) throw new TypeError(`Duplicate Inline resource ID ${module.moduleId}.`);
    ids.add(module.moduleId);
    requireCodec(module.item.embedded?.compression ?? "none", `Inline module ${module.moduleId}`);
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
  const modelMedia = isModelMediaEntry(input.entry.mediaType);
  const directMedia = modelMedia || isNormalMediaEntry(input.entry.mediaType);
  if (modelMedia) {
    inspectKeelModelMedia(input.entry, assets);
    throw new TypeError("Direct models require buildKeelInlineModelMediaDocument: a derived verified presentation entry and exact complete loader closure, never the retired first-primitive renderer.");
  } else if (directMedia) {
    if (assets.length !== 0) {
      throw new TypeError("A direct image, video, or GLB entry cannot declare additional creator assets.");
    }
    if (orderedModules.length !== 1) {
      throw new TypeError("A direct image, video, or GLB entry requires exactly one registered keel.asset-display module.");
    }
    await assertCanonicalAssetDisplayModule(orderedModules[0]!);
  }
  const source = directMedia ? undefined : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.entry.source);
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
  if (input.entry.storedBytes !== undefined && (dataScripts.length !== 0 || input.entry.mediaType === "text/javascript")) {
    throw new TypeError("A precompressed Inline entry must use its exact final HTML/media bytes; data-script insertion and JavaScript wrapping change them.");
  }
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
    compression: entryCompression,
    ...(input.entry.storedBytes === undefined ? {} : { storedBytes: input.entry.storedBytes }),
  });
  const assetSlots = await Promise.all(assets.map(async (asset) => ({
    asset,
    slot: await buildEmbeddedKeelViewerSlot({
      id: asset.id,
      role: "asset",
      mediaType: asset.mediaType,
      ...(asset.aliases === undefined ? {} : { aliases: asset.aliases }),
      bytes: asset.source,
      compression: assetCompression(asset, payloadStorage),
      ...(asset.storedBytes === undefined ? {} : { storedBytes: asset.storedBytes }),
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

/** Complete inspected originals, exact loader closure and every retained dependency. */
export async function buildKeelInlineModelMediaDocument(input: {
  readonly shell: KeelInlineShellFragments;
  readonly modules: readonly KeelInlineModuleFragment[];
  readonly entry: KeelModelResource & {readonly mediaType: KeelModelMediaType};
  readonly assets?: readonly KeelModelResource[];
  /** Exact current reader binding, authenticated by the caller; never inferred from a local module label. */
  readonly registeredNativeGzipBinding?: KeelRegisteredNativeGzipBinding;
}): Promise<KeelInlineModelMediaDocument> {
  // Snapshot every byte/identity before the first asynchronous digest or catalog read.
  const shell = structuredClone(input.shell), modules = structuredClone(input.modules), entry = structuredClone(input.entry), assets = structuredClone(input.assets ?? []);
  const nativeBinding = input.registeredNativeGzipBinding === undefined ? undefined : snapshotKeelRegisteredNativeGzipBinding(input.registeredNativeGzipBinding);
  if (nativeBinding) {
    const profile = KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE;
    for (const [part, length, digest] of [[shell.prefix, profile.prefixByteLength, profile.prefixDigest], [shell.suffix, profile.suffixByteLength, profile.suffixDigest]] as const) {
      if (shell.codecProfile !== "browser-gzip-deflate" || part.bytes.length !== length || `0x${createHash("sha256").update(part.bytes).digest("hex")}` !== digest) throw new TypeError("Models require the exact authenticated current native Gzip frames.");
    }
  } else {
    const canonical = await buildKeelInlineShellFragments({repositoryRoot: ""});
    if (!exactBytes(shell.prefix.bytes, canonical.prefix.bytes) || !exactBytes(shell.suffix.bytes, canonical.suffix.bytes)) throw new TypeError("Models require exact canonical shell fragments; local bytes are not registration evidence.");
  }
  await assertCanonicalModelMediaGraph(entry, assets, orderKeelModules(modules));
  const identities = await Promise.all([entry, ...assets].map(async resource => ({id: resource.id, mediaType: resource.mediaType, aliases: [...(resource.aliases ?? [])], integrity: await createIntegrity(resource.source)})));
  const originalEntry = {...identities[0]!, mediaType: entry.mediaType}, binding = {schema: "keel-model-presentation@1", original: {...originalEntry, name: entry.aliases?.[0] ?? entry.id}, resources: identities,
    modules: modules.map(module => ({id: module.moduleId, version: module.version, digest: module.item.integrity.digest, byteLength: module.item.integrity.byteLength}))};
  const bindingJSON = serializeScriptJSON(binding), generatedId = "keel-model-presentation";
  if ([entry, ...assets].some(resource => resource.id === generatedId || resource.aliases?.includes(generatedId))) throw new TypeError("Original model resource conflicts with its derived presentation identity.");
  const html = encoder.encode(`<!doctype html><html><head><meta charset="utf-8"><style>html,body,#keel-asset-display{width:100%;height:100%;margin:0;overflow:hidden;background:#05060b}</style></head><body><main id="keel-asset-display"></main><script type="module">import{createModelViewer}from"keel.model-display";Object.defineProperty(globalThis,"__KEEL_MODEL_VIEWER__",{value:createModelViewer(${bindingJSON}),writable:false,configurable:false});</script></body></html>`);
  const sources: readonly (KeelModelResource & {readonly role: "asset" | "entrypoint"})[] = [...[entry, ...assets].map(resource => ({...resource, role: "asset" as const})), {id: generatedId, mediaType: "text/html", source: html, role: "entrypoint" as const}];
  const sourceStorage = await Promise.all(sources.map(async resource => {
    // Current native frames admit exact text or validated raster None siblings.
    // Other binary None/Base64 is not an admissible fresh recipe, even if shorter.
    const codecs: readonly ("none" | "gzip")[] = nativeBinding && !isKeelViewerTextMediaType(resource.mediaType) && !["image/png", "image/jpeg"].includes(resource.mediaType) ? ["gzip"] : ["none", "gzip"];
    const candidates = await Promise.all(codecs.map(async compression => {
      const slot = await buildEmbeddedKeelViewerSlot({id: resource.id, mediaType: resource.mediaType, role: resource.role, ...(resource.aliases === undefined ? {} : {aliases: resource.aliases}), bytes: resource.source, compression});
      return {id: resource.id, compression, decodedByteLength: resource.source.length, storedByteLength: slot.item.embedded!.storedIntegrity!.byteLength, descriptorByteLength: slot.fragment.length};
    }));
    return candidates.reduce((best, candidate) => candidate.descriptorByteLength < best.descriptorByteLength ? candidate : best);
  }));
  const document = await buildKeelInlineLocalDocument({shell, modules, assets: [entry, ...assets].map((resource, index) => ({...resource, compression: sourceStorage[index]!.compression})), entry: {id: generatedId, mediaType: "text/html", source: html, compression: sourceStorage.at(-1)!.compression}});
  const registeredNativeGzip = nativeBinding === undefined ? undefined : createKeelRegisteredNativeGzipProof({binding: nativeBinding, documentBytes: document.rootBytes});
  return {...document, ...(registeredNativeGzip === undefined ? {} : {registeredNativeGzip}), modelPresentation: {schema: "keel-model-presentation@1", originalEntry, originalDependencies: identities.slice(1), generatedEntry: {id: generatedId, mediaType: "text/html", integrity: await createIntegrity(html), kind: "derived-presentation"}, bindingIntegrity: await createIntegrity(encoder.encode(bindingJSON)), sourceStorage, byteCounts: {originalSources: [entry, ...assets].reduce((n, resource) => n + resource.source.length, 0), generatedHTML: html.length, sharedDecodedModules: modules.reduce((n, module) => n + module.item.integrity.byteLength, 0), completeHTML: document.byteLength}}};
}

/** Selected-chain read-back gate. Local profiles alone never become registered modules. */
export async function buildKeelRegisteredInlineModelMediaTokenURIGraph(input: {
  readonly shell: KeelInlineShellFragments;
  readonly modules: readonly KeelInlineModuleFragment[];
  readonly entry: KeelModelResource & {readonly mediaType: KeelModelMediaType};
  readonly assets?: readonly KeelModelResource[];
  readonly chainId: number;
  readonly store: Hex;
  readonly builder: Hex;
  readonly readScope: {readonly blockNumber: bigint; readonly blockHash: Hex};
  /** Ordered exact prefix, every closed-graph module, then suffix. */
  readonly existingParts: readonly KeelPublishedInlineFragment[];
  /** Existing authorized object reader; no signing or provider fallback is performed here. */
  readonly readObject: (carrier: KeelPublishedInlineFragment["carrier"], scope: {readonly blockNumber: bigint; readonly blockHash: Hex}) => Promise<Uint8Array>;
  /** Correct deployed registry ABI supplied by the selected-chain integration. */
  readonly readRegistration: (input: {readonly chainId: number; readonly store: Hex; readonly objectId: Hex; readonly builder: Hex; readonly blockNumber: bigint; readonly blockHash: Hex}) => Promise<boolean>;
  readonly readBlockHash: (blockNumber: bigint) => Promise<Hex>;
  readonly registeredNativeGzipBinding: KeelRegisteredNativeGzipBinding;
  /** Existing Site authenticator must re-read metadata, registry, deployed reader and exact frame receipts at this scope. */
  readonly readCurrentNativeGzipBinding: (scope: {readonly blockNumber: bigint; readonly blockHash: Hex}) => Promise<KeelRegisteredNativeGzipBinding>;
}): Promise<KeelInlineRawPercentTokenURIGraph & {readonly modelPresentation: KeelInlineModelMediaDocument["modelPresentation"]}> {
  input = {...input, shell: structuredClone(input.shell), modules: structuredClone(input.modules), entry: structuredClone(input.entry), assets: structuredClone(input.assets ?? []), existingParts: structuredClone(input.existingParts), readScope: {...input.readScope}, registeredNativeGzipBinding: snapshotKeelRegisteredNativeGzipBinding(input.registeredNativeGzipBinding)};
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new TypeError("Models need an explicit selected chain.");
  if (input.readScope.blockNumber < 0n || !/^0x[0-9a-f]{64}$/iu.test(input.readScope.blockHash)) throw new TypeError("Models require an exact selected-chain block scope.");
  const store = getAddress(input.store), builder = getAddress(input.builder), binding = input.registeredNativeGzipBinding;
  if (input.chainId !== binding.chainId || store !== getAddress(binding.store) || builder !== getAddress(binding.reader)) throw new TypeError("Model native Gzip binding must match the selected chain, store and deployed reader.");
  const assertCurrentBinding = async () => {
    const current = snapshotKeelRegisteredNativeGzipBinding(await input.readCurrentNativeGzipBinding({...input.readScope}));
    if (canonicalJson(current) !== canonicalJson(binding)) throw new TypeError("Model native Gzip reader binding changed; preserve the source and review again.");
  };
  await assertCurrentBinding();
  const document = await buildKeelInlineModelMediaDocument(input);
  const reusable = document.parts.filter(part => part.kind === "existing");
  if (input.existingParts.length !== reusable.length) throw new TypeError("Model registered closure has missing or extra reusable fragments.");
  for (const [index, part] of reusable.entries()) {
    const published = input.existingParts[index]!;
    if (published.carrier.chainId !== input.chainId || getAddress(published.carrier.store) !== store) throw new TypeError("Model reuse must stay on the exact selected chain and store.");
    await assertPublishedFragmentIntegrity(published, "Registered model reusable fragment");
    if (part.role !== "module" && published.carrier.objectId !== (part.role === "shell-prefix" ? binding.prefixObjectId : binding.suffixObjectId)) throw new TypeError("Model native Gzip shell object differs from the authenticated current reader.");
    if (!await input.readRegistration({chainId: input.chainId, store: input.store, objectId: published.carrier.objectId, builder, ...input.readScope})) throw new TypeError("Model reusable fragment is not registered for the exact selected builder at the pinned block.");
    const observed = await input.readObject({...published.carrier}, {...input.readScope});
    if (!exactBytes(observed, published.bytes)) throw new TypeError("Registered model read-back differs from the exact selected fragment.");
    if (part.role === "module") {
      const declared = input.modules.find(module => module.moduleId === part.moduleId)!;
      const embedded = declared.item.embedded!, stored = embedded.storedText === undefined ? exactBase64Bytes(embedded.storedBase64 ?? "", "Model module") : encoder.encode(embedded.storedText);
      const decoded = embedded.compression === "gzip" ? new Uint8Array(gunzipSync(stored)) : stored;
      await verifyKeelPublishedInlineModuleFragment({fragment: published, moduleId: declared.moduleId, mediaType: "text/javascript", aliases: declared.item.aliases, decodedBytes: decoded});
    } else if (!exactBytes(decodePublishedGraphPart(published), part.bytes)) throw new TypeError("Registered model shell differs from the exact canonical shell.");
  }
  await assertCurrentBinding();
  if ((await input.readBlockHash(input.readScope.blockNumber)).toLowerCase() !== input.readScope.blockHash.toLowerCase()) throw new TypeError("Model read-back block changed; reprepare the exact selected-chain closure.");
  let existingIndex = 0;
  const publishedBytes = concat(document.parts.map(part => part.kind === "existing" ? decodePublishedGraphPart(input.existingParts[existingIndex++]!) : part.bytes));
  const registeredNativeGzip = createKeelRegisteredNativeGzipProof({binding, documentBytes: publishedBytes});
  const graph = await buildKeelInlineRawPercentTokenURIGraph(document, {existingParts: input.existingParts, registeredNativeGzip});
  return {...graph, modelPresentation: document.modelPresentation};
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
  if ((KEEL_MODEL_MEDIA_TYPES as readonly string[]).includes(input.asset.mediaType)) {
    inspectKeelModelMedia(input.asset);
    throw new TypeError("Models require the exact complete loader closure and derived presentation, never the retired flat-primitive renderer.");
  }
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
  /** Only the current compact raw-percent composer is publishable. */
  readonly carriage?: "compact" | "raw-percent";
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


/** Retired publication carriage cannot be re-enabled by options or environment. */
export interface KeelLegacyCarriageOptions {
  readonly legacyCarriage?: never;
}

export class KeelLegacyCarriageError extends Error {
  readonly lane: string;
  constructor(lane: string) {
    super(`${lane} is retired for publication. Use buildKeelInlineRawPercentTokenURIGraph (compact raw-percent); acknowledgements and environment switches cannot select historical carriage.`);
    this.name = "KeelLegacyCarriageError";
    this.lane = lane;
  }
}

export function assertLegacyCarriageAllowed(lane: string, options: KeelLegacyCarriageOptions | undefined): void {
  throw new KeelLegacyCarriageError(lane);
}

export async function buildKeelInlinePreEncodedTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions & KeelLegacyCarriageOptions = {},
): Promise<KeelInlinePreEncodedTokenURIGraph> {
  throw new KeelLegacyCarriageError("buildKeelInlinePreEncodedTokenURIGraph");
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
  options: KeelLegacyCarriageOptions & KeelInlineExistingObjectReuseOptions & {
    /**
     * Explicitly reviewed public-read ceiling for unusually large immutable
     * works. The protocol default remains 2 MB; callers may raise it only when
     * they also benchmark the exact contract read path and RPC response.
     */
    readonly maxTokenURIBytes?: number;
  } = {},
): Promise<KeelInlineEscapedTokenURIGraph> {
  throw new KeelLegacyCarriageError("buildKeelInlineEscapedTokenURIGraph");
}

/**
 * Build the raw-storage carriage used when the whole-token Base64 wrapper is
 * the read-gas bottleneck. Each verified HTML part is escaped for its own HTML
 * data URI, then only that ASCII is escaped for the outer JSON data URI. The
 * stored bytes are copied verbatim by KeelRawTokenURIBuilder.
 */
export async function buildKeelInlineRawPercentTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions & {
    readonly maxTokenURIBytes?: number;
  } = {},
): Promise<KeelInlineRawPercentTokenURIGraph> {
  // Capture all bytes, identities and the typed proof before the first await.
  // Published module bytes may differ only in their lossless compression.
  root = { ...root, rootBytes: new Uint8Array(root.rootBytes), rootIntegrity: { ...root.rootIntegrity },
    parts: root.parts.map(part => ({ ...part, bytes: new Uint8Array(part.bytes), integrity: { ...part.integrity } })) };
  const readBounds = resolveKeelPreparationReadBounds(options);
  options = { ...options,
    ...(options.existingObjectReuse === undefined ? {} : { existingObjectReuse: { ...options.existingObjectReuse } }),
    ...(options.existingParts === undefined ? {} : { existingParts: options.existingParts.map(part => ({ ...part,
      bytes: new Uint8Array(part.bytes), integrity: { ...part.integrity }, carrier: { ...part.carrier } })) }),
    ...(options.registeredNativeGzip === undefined ? {} : { registeredNativeGzip: assertKeelRegisteredNativeGzipProof(options.registeredNativeGzip) }),
    ...(readBounds.nonstandardReadPolicy === undefined ? {} : { nonstandardReadPolicy: readBounds.nonstandardReadPolicy }),
    ...(readBounds.preparationReadBudget === undefined ? {} : { preparationReadBudget: readBounds.preparationReadBudget }) };
  const reuse = await inspectExistingGraphReuse(root, options, "raw-percent");
  if (reuse !== undefined) { root = reuse.root; options = { ...options, existingParts: reuse.existingParts }; }
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
      escapedHtmlBytes = exactPercentPayloadBytes(bytes, `Published raw-percent Inline ${part.role}`, true);
      decodedHtmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, `Published raw-percent decoded ${part.role}`, true);
      if (options.registeredNativeGzip !== undefined && part.role === "module") {
        const declared = JSON.parse(decoder.decode(part.bytes).replace(/^,/, "")) as Record<string, unknown>;
        const actual = JSON.parse(decoder.decode(decodedHtmlBytes).replace(/^,/, "")) as Record<string, unknown>;
        const { embedded: _declaredStorage, ...expectedDeclaration } = declared;
        const { embedded: _actualStorage, ...actualDeclaration } = actual;
        if (canonicalJson(expectedDeclaration) !== canonicalJson(actualDeclaration)) {
          throw new TypeError("Published native Gzip module changed the declared source identity or metadata.");
        }
      }
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
  const maxTokenURIBytes = options.maxTokenURIBytes ?? readBounds.maximumTokenUriBytes;
  if (!Number.isSafeInteger(maxTokenURIBytes) || maxTokenURIBytes <= 0 || readBounds.nonstandardReadPolicy !== undefined && maxTokenURIBytes > readBounds.maximumTokenUriBytes) {
    throw new RangeError("The raw-percent tokenURI public-read ceiling must be a positive safe integer.");
  }
  if (fragmentBytes.byteLength > maxTokenURIBytes) {
    throw new RangeError(`The raw-percent Inline tokenURI stream is ${fragmentBytes.byteLength.toLocaleString()} bytes, above the reviewed ${maxTokenURIBytes.toLocaleString()}-byte public-read ceiling.`);
  }
  const escapedHtmlBytes = exactPercentPayloadBytes(fragmentBytes, "Raw-percent metadata middle", true);
  const htmlBytes = exactPercentPayloadBytes(escapedHtmlBytes, "Raw-percent HTML stream", true);
  if (!exactBytes(htmlBytes, concat(htmlParts))) {
    throw new Error("Raw-percent Inline fragments do not reconstruct the exact source HTML.");
  }
  // Authenticate the exact assembled return, including retained published
  // slots, rather than the unused local recompression of those slots.
  assertKeelFreshPayloadCarriage(htmlBytes, options);
  return {
    schema: "keel-inline-raw-percent-token-uri@1",
    ...(options.registeredNativeGzip === undefined ? {} : { registeredNativeGzip: assertKeelRegisteredNativeGzipProof(options.registeredNativeGzip, htmlBytes) }),
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
  readonly nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy;
  readonly preparationReadBudget?: KeelTokenURIPreparationBudget;
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
  const readBounds = resolveKeelPreparationReadBounds(input);
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
  if (bytes.length > readBounds.maximumTokenUriBytes) {
    throw new RangeError(`Complete web3 JSON is ${bytes.length} bytes, above KEEL's ${readBounds.maximumTokenUriBytes}-byte public-read limit.`);
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

/** Shared SDK/MCP planner. Fresh publication and exact object reuse both require compact raw-percent carriage. */
export function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options?: KeelInlineExistingObjectReuseOptions & { readonly existingObjectReuse?: never; readonly maxTokenURIBytes?: number; readonly carriage?: "compact" | "raw-percent" },
): Promise<KeelInlineRawPercentTokenURIGraph>;
export function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions & KeelLegacyCarriageOptions & { readonly maxTokenURIBytes?: number; readonly carriage?: KeelInlineCarriage },
): Promise<KeelInlineRawPercentTokenURIGraph>;
export async function buildKeelInlineTokenURIGraph(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions & KeelLegacyCarriageOptions & { readonly maxTokenURIBytes?: number; readonly carriage?: KeelInlineCarriage } = {},
) {
  if (Object.hasOwn(options, "legacyCarriage")) throw new KeelLegacyCarriageError("legacyCarriage option");
  resolveKeelInlineCarriage(options.carriage);
  // The raw builder snapshots input immediately and authenticates the exact
  // assembled published slots. Do not inspect an unused local recompression.
  return buildKeelInlineRawPercentTokenURIGraph(root, options);
}

/** Retired comparison entrypoint; publication has one current raw-percent carriage. */
export async function compareKeelInlineTokenURICarriages(
  root: KeelInlineGraphDocument,
): Promise<KeelInlineTokenURICarriageComparison> {
  throw new KeelLegacyCarriageError("compareKeelInlineTokenURICarriages");
}

/** Retired follow-latest publication entrypoint. Use the qualified current shell graph. */
export async function buildKeelInlineFollowLatestTokenURIBodyGraph(
  root: KeelInlineGraphDocument,
  options: KeelInlineExistingObjectReuseOptions & KeelLegacyCarriageOptions = {},
): Promise<KeelInlinePreEncodedTokenURIBodyGraph> {
  throw new KeelLegacyCarriageError("buildKeelInlineFollowLatestTokenURIBodyGraph");
}

/**
 * Finish an immutable 1/1 ERC-721 tokenURI entirely at release-build time.
 * The collection address must already be deterministically predicted. The
 * contract stores these two raw-percent slices and directly copies the
 * reusable middle graph between them.
 */
export async function buildKeelPreparedOneOfOneTokenURI(input: {
  readonly externalPreview?: KeelExplicitExternalPreview;
  readonly registeredNativeGzip?: KeelRegisteredNativeGzipProof | undefined;
  readonly graph: Pick<KeelInlineRawPercentTokenURIGraph, "fragmentBytes" | "mediaType">;
  /** Current raw-percent graphs already include their exact shell. */
  readonly shellFragments?: never;
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
  const externalPreview = input.externalPreview === undefined ? undefined : snapshotKeelExplicitExternalPreview(input.externalPreview);
  if (externalPreview !== undefined && (input.graph.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment" || input.presentationPolicy !== undefined && input.presentationPolicy !== "collector-inline")) throw new TypeError("Explicit external preview requires the raw-percent canonical collector route.");
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
  if (externalPreview === undefined) assertPreparedImageURI(input.imageURI);
  else assertKeelExternalPreviewImageURI(input.imageURI, externalPreview);
  const prefixHead = [
    `{"name":${JSON.stringify(`${input.collectionName} #1`)}`,
    `,"description":${JSON.stringify(input.description)}`,
    `,"image":${JSON.stringify(input.imageURI)}`,
  ].join("");
  if (input.graph.mediaType !== "application/vnd.keel.token-uri-raw-percent-fragment" || input.shellFragments !== undefined) {
    throw new KeelLegacyCarriageError("Prepared tokenURI graph media/shell carriage");
  }
  const animationEncoding = "raw-percent" as const;
  const prefixRaw = `${prefixHead},"animation_url":"data:text/html;charset=utf-8,`;
  const suffixRaw = [
    decoder.decode(compactPercentPayload(encoder.encode(tokenContextHTMLTail(contextJSON, contextDigest, contextBytes.byteLength)))) ,
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
  {
    const presentationFragmentBytes = input.graph.fragmentBytes;
    const encodedPrefix = compactPercentPayload(encoder.encode(prefixRaw));
    const encodedSuffix = compactPercentPayload(encoder.encode(suffixRaw));
    const tokenURIPayload = concat([encodedPrefix, presentationFragmentBytes, encodedSuffix]);
    const tokenJSON = decoder.decode(exactPercentPayloadBytes(tokenURIPayload, "Prepared raw-percent token JSON", true));
    const animationMiddle = decoder.decode(exactPercentPayloadBytes(
      presentationFragmentBytes,
      "Prepared raw-percent animation middle",
      true,
    ));
    const expectedJSON = `${prefixRaw}${animationMiddle}${suffixRaw}`;
    if (tokenJSON !== expectedJSON) throw new Error("Prepared raw-percent fragments changed the exact token JSON bytes.");
    const metadata = JSON.parse(tokenJSON) as { readonly animation_url?: unknown };
    if (typeof metadata.animation_url !== "string") throw new Error("Prepared token metadata has no animation_url.");
    if (presentationPolicy === "collector-inline") assertKeelCollectorInlineMetadata(metadata, { registeredNativeGzip: input.registeredNativeGzip, externalPreview });
    else assertMarketplaceSafeDataURI(metadata.animation_url, "Prepared token animation_url");
    return {
      schema: "keel-prepared-one-of-one-token-uri@1",
      ...(externalPreview === undefined ? {} : { externalPreview }),
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
  throw new Error("Unreachable prepared carriage.");
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
  if ((KEEL_MODEL_MEDIA_TYPES as readonly string[]).includes(input.asset.mediaType)) {
    inspectKeelModelMedia(input.asset);
    throw new TypeError("Models require the exact complete loader closure and derived presentation, never the retired flat-primitive renderer.");
  }
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


/** Prepare one creator-owned HTML document. No canonical verification shell is
 * inserted, no source is minified, and no Base64 copy of the document is made.
 * Raw keeps deliberate creator-authored encodings as part of the supplied HTML.
 * The percent carriage is URI syntax; publish its one fragment, not a second
 * copy of the original HTML. Public-chain read-back remains a separate gate. */
export async function buildKeelCreatorOwnedInlineDocument(input: {
  readonly source: Uint8Array;
  readonly nonstandardReadPolicy?: KeelExplicitNonstandardReadPolicy;
  readonly preparationReadBudget?: KeelTokenURIPreparationBudget;
  readonly payloadStorage?: KeelPayloadStorageMode;
}): Promise<{ readonly root: KeelInlineLocalDocument; readonly graph: KeelInlineRawPercentTokenURIGraph }> {
  const readBounds = resolveKeelPreparationReadBounds(input);
  resolveKeelPayloadStorage(input.payloadStorage);
  if (!(input.source instanceof Uint8Array) || input.source.byteLength === 0) {
    throw new TypeError("A creator-owned shell needs nonempty UTF-8 HTML.");
  }
  const source = input.source.slice();
  const html = new TextDecoder("utf-8", { fatal: true }).decode(source);
  assertKeelInlineNoExternalDependencies(source, "Creator-owned shell");
  const embedded = (reference: string): boolean => reference === "" || reference.startsWith("#")
    || reference.startsWith("data:") || reference.startsWith("blob:") || reference === "about:blank";
  const references = [
    ...html.matchAll(/\b(?:src|href|poster)\s*=\s*(?:(["'])(.*?)\1|([^\s"'=<>`]+))/giu),
    ...html.matchAll(/\burl\(\s*(["']?)([^"')\s]+)\1\s*\)/giu),
    ...html.matchAll(/@import\s*(["'])(.*?)\1/giu),
    ...html.matchAll(/\b(?:fetch|import)\s*\(\s*(["'])(.*?)\1/gu),
    ...html.matchAll(/\b(?:import|export)\s+[^;]*?\bfrom\s*(["'])(.*?)\1/gu),
  ];
  for (const match of references) {
    const reference = (match[2] ?? match[3] ?? "").trim();
    if (!embedded(reference)) throw new TypeError("Creator-owned Inline HTML must be self-contained; unsupported resource " + reference + ".");
  }
  const sourceIntegrity = await createIntegrity(source);
  const escapedHtmlBytes = compactPercentPayload(source);
  const fragmentBytes = compactPercentPayload(escapedHtmlBytes);
  if (fragmentBytes.byteLength > readBounds.maximumTokenUriBytes) {
    throw new RangeError("The creator-owned Inline carriage exceeds the public-read byte ceiling.");
  }
  const fragmentIntegrity = await createIntegrity(fragmentBytes);
  const root: KeelInlineLocalDocument = {
    schema: "keel-inline-local-document@1", rootBytes: source, rootIntegrity: sourceIntegrity,
    byteLength: source.byteLength,
    parts: [{ kind: "creator", role: "entrypoint", bytes: source, byteLength: source.byteLength, integrity: sourceIntegrity }],
  };
  const graph: KeelInlineRawPercentTokenURIGraph = {
    schema: "keel-inline-raw-percent-token-uri@1",
    mediaType: "application/vnd.keel.token-uri-raw-percent-fragment",
    contextParameter: "keel-context", contextDelivery: "percent-html-tail",
    fragmentBytes, fragmentIntegrity, htmlBytes: source, htmlIntegrity: sourceIntegrity,
    escapedHtmlBytes, creatorPublicationBytes: fragmentBytes.byteLength,
    parts: [{ role: "entrypoint", sourceKind: "creator", bytes: fragmentBytes, integrity: fragmentIntegrity,
      sourceIntegrity, decodedHtmlBytes: source, escapedHtmlBytes, encodedMetadataBytes: fragmentBytes }],
  };
  return { root, graph };
}
