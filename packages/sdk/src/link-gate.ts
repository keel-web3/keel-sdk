import { sha256 as viemSha256 } from "viem";

import { KEEL_CREATIVE_RUNTIME_CATALOG } from "./creative-runtime-catalog.js";
import { KEEL_MODEL_VENDOR_MODULES } from "./model-viewer-vendor.js";
import { snapshotKeelExplicitExternalPreview, type KeelExplicitExternalPreview } from "./external-preview.js";
export type { KeelExplicitExternalPreview } from "./external-preview.js";

/**
 * KEEL link gate: the one check every KEEL-driven onchain push runs before it
 * produces an upload plan or a wallet request.
 *
 * Bytes headed onchain must not name the web. The gate scans every resource,
 * then every layer it can open inside it (gzip, zlib, raw deflate, Brotli,
 * percent/URI81, Base64 runs, data URIs and JavaScript/JSON string escapes,
 * recursively), and refuses on any concrete http(s)://, ipfs://, ar://,
 * web3:// or keel-onchain:// locator. Only the SVG namespace is allowed; it is
 * syntax, not a fetch. A refusal names the resource, the byte offset, the URL
 * and its context.
 *
 * The module finder runs over the same bytes. Exact sha256, license banners and
 * the URLs themselves (CDN package@version paths, GitHub repositories) map to
 * registered KEEL modules a creator should reuse instead of embedding a copy.
 * Suggestions are metadata: the gate never substitutes bytes.
 *
 * Environment-neutral: Node's zlib and crypto are read through
 * process.getBuiltinModule, so wallet-request stays bundle-safe. Without them
 * compressed layers are reported as uninspected in `coverage`.
 */

export const KEEL_LINK_GATE_PROTOCOL = "keel-link-gate@1" as const;
/** The single protocol literal allowed in onchain bytes: the SVG namespace is syntax, not a fetch. */
export const KEEL_LINK_GATE_ALLOWED_URLS: readonly string[] = Object.freeze(["http://www.w3.org/2000/svg"]);

/**
 * Concrete network/content locators. Arweave locators carry an authority or a
 * 32-byte base64url transaction ID; a minified ternary such as `ready ? ar : 1`
 * is not a content locator. Shared with the Inline preparation checks.
 */
export const KEEL_EXTERNAL_RESOURCE_LITERAL = /\b(?:(?:https?|ipfs|web3|keel-onchain|oca-onchain|oca):[^\s"'<>\\]+|ar:(?:\/\/[^\s"'<>\\]+|[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])(?:\/[^\s"'<>\\]*)?))/giu;
// The gate reads layers byte-for-byte (latin1), so a locator ends at the first non-ASCII byte.
const GATE_LOCATOR = /\b(?:(?:https?|ipfs|web3|keel-onchain|oca-onchain|oca):[^\s"'<>\\\u0000-\u001f\u007f-\uffff]+|ar:(?:\/\/[^\s"'<>\\\u0000-\u001f\u007f-\uffff]+|[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])(?:\/[^\s"'<>\\\u0000-\u001f\u007f-\uffff]*)?))/gu;
const SENTINEL = /keel\.invalid/giu;

const MAX_DEPTH = 6;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_LAYERS = 4096;
const MAX_REPORTED_HITS = 200;
const MAX_BASE64_RUNS_PER_LAYER = 4096;
const MAX_EMBEDDED_STREAMS_PER_LAYER = 64;
const CONTEXT_BYTES = 40;

export interface KeelLinkGateResource {
  /** Name shown in the report: a file path, module id or `calldata`. */
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
}

export interface KeelLinkGateHit {
  readonly resource: string;
  /** Offset in the resource as supplied: the hit itself, or the start of the outermost encoded span holding it. */
  readonly offset: number;
  /** Offset of the locator inside the innermost decoded layer. */
  readonly layerOffset: number;
  /** Decoding path from the resource to the layer, outermost first, e.g. ["base64@120", "gzip@0"]. */
  readonly layers: readonly string[];
  readonly url: string;
  readonly scheme: string;
  readonly context: string;
}

export interface KeelLinkGateExemption {
  readonly resource: string;
  readonly url: string;
  readonly reason: "registered-module-bytes" | "registered-module-context" | "registered-shell-context" | "explicit-external-preview" | "keel-manifest-pointer";
  readonly moduleId?: string;
  readonly version?: string;
}

export interface KeelLinkGateModuleCandidate {
  readonly moduleId: string;
  readonly version: string;
  /** 0x-prefixed sha256 of the exact module bytes. */
  readonly digest: string;
  readonly byteLength: number | null;
  readonly library: string;
  readonly mediaType?: string;
  readonly source: "keel-pinned" | "keel-index" | "keel-library-index";
  readonly pinnedIn?: string;
  readonly sourceRepository?: string;
  readonly chainId?: number;
  readonly selection?: Readonly<Record<string, unknown>>;
}

export interface KeelLinkGateAvailability {
  readonly selectedChainId: number | null;
  readonly status: "reference-on-selected-chain" | "reference-on-other-chain" | "reference-listed" | "index-listed" | "not-claimed";
  readonly references: readonly {
    readonly chainId: number;
    readonly reference: string;
    readonly resourceId?: string;
    readonly containerId?: string;
    readonly offset?: number;
  }[];
  readonly verification: "requires-selected-chain-readback";
}

export interface KeelLinkGateSuggestion {
  readonly resource: string;
  readonly library: string;
  readonly detectedVersion: string | null;
  readonly match: {
    readonly kind: "sha256" | "banner" | "url";
    readonly evidence: string;
    readonly versionMatch: "exact" | "different-version" | "unknown";
  };
  readonly module: KeelLinkGateModuleCandidate;
  readonly availability: KeelLinkGateAvailability;
  readonly action: string;
  readonly substitution: "never-automatic";
}

export interface KeelLinkGateReport {
  readonly protocol: typeof KEEL_LINK_GATE_PROTOCOL;
  readonly route: string;
  readonly status: "clear" | "blocked";
  readonly allowlist: readonly string[];
  readonly resources: readonly {
    readonly id: string;
    readonly byteLength: number;
    readonly sha256: string;
    readonly mediaType?: string;
    readonly registeredModule?: { readonly moduleId: string; readonly version: string };
  }[];
  readonly hitCount: number;
  readonly hits: readonly KeelLinkGateHit[];
  readonly exemptions: readonly KeelLinkGateExemption[];
  readonly suggestions: readonly KeelLinkGateSuggestion[];
  readonly coverage: {
    readonly codecs: "node-zlib" | "unavailable";
    readonly layersInspected: number;
    readonly expandedBytes: number;
    readonly uninspected: readonly string[];
  };
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

/** A registry or index entry the finder may suggest in addition to the pinned local modules. */
export interface KeelLinkGateIndexEntry {
  readonly moduleId: string;
  readonly version: string;
  readonly digest: string;
  readonly byteLength?: number | null;
  readonly library?: string;
  readonly names?: readonly string[];
  readonly chainId?: number;
  readonly source?: "keel-index" | "keel-library-index";
  readonly selection?: Readonly<Record<string, unknown>>;
}

/** A deployment reference: which digests are carried on which chain. */
export interface KeelLinkGateReference {
  readonly name: string;
  readonly chainId: number;
  readonly resources: readonly { readonly digest: string; readonly id?: string; readonly containerId?: string; readonly offset?: number }[];
}

export interface KeelLinkGateInput {
  /** The push route, e.g. "upload-plan" or "wallet-request-prepare". */
  readonly route: string;
  readonly resources: readonly KeelLinkGateResource[];
  /** Selected chain for module availability. */
  readonly chainId?: number;
  /** Extra registered module candidates, e.g. from keel-library-search. */
  readonly index?: readonly KeelLinkGateIndexEntry[];
  /** Deployment references; defaults to this checkout's deployments/ manifests when readable. */
  readonly references?: readonly KeelLinkGateReference[];
  /** Directory whose deployments/ manifests are also read for availability. */
  readonly workspaceRoot?: string;
  /**
   * Explicit, source-committed external preview images (keel-explicit-external-preview@1, already
   * validated by snapshotKeelExplicitExternalPreview). Only that exact URI string is admitted.
   */
  readonly externalPreviews?: readonly KeelExplicitExternalPreview[];
}

/** Full image-only source commitments, snapshotted before asynchronous work.
 * This does not authenticate remote availability or authorize another URI. */
export function snapshotKeelLinkGatePreviews(value: readonly KeelExplicitExternalPreview[] | undefined): readonly KeelExplicitExternalPreview[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("At most16 exact external image-preview commitments are allowed.");
  return Object.freeze(value.map(snapshotKeelExplicitExternalPreview));
}

// ─── environment ────────────────────────────────────────────────────────────────────────────────────────────────

type Zlib = typeof import("node:zlib");
type NodeCrypto = typeof import("node:crypto");
type NodeFs = typeof import("node:fs");
type NodePath = typeof import("node:path");

function builtin<T>(name: string): T | undefined {
  const get = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process?.getBuiltinModule;
  try { return typeof get === "function" ? get(name) as T : undefined; } catch { return undefined; }
}

let zlibCache: Zlib | null | undefined;
function zlib(): Zlib | undefined {
  if (zlibCache === undefined) zlibCache = builtin<Zlib>("node:zlib") ?? null;
  return zlibCache ?? undefined;
}

let cryptoCache: NodeCrypto | null | undefined;
function sha256Hex(bytes: Uint8Array): string {
  if (cryptoCache === undefined) cryptoCache = builtin<NodeCrypto>("node:crypto") ?? null;
  if (cryptoCache) return "0x" + cryptoCache.createHash("sha256").update(bytes).digest("hex");
  return viemSha256(bytes);
}

function normalizeDigest(value: string): string {
  const hex = value.toLowerCase().replace(/^sha256:/u, "").replace(/^0x/u, "");
  return /^[0-9a-f]{64}$/u.test(hex) ? "0x" + hex : value.toLowerCase();
}

const latin1Decoder = new TextDecoder("latin1");
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** One character per byte, so string indices are byte offsets. */
function byteText(bytes: Uint8Array): string {
  // WHATWG latin1 is windows-1252: still exactly one UTF-16 unit per byte, ASCII unchanged.
  return latin1Decoder.decode(bytes);
}

function isUtf8(bytes: Uint8Array): boolean {
  try { utf8Decoder.decode(bytes); return true; } catch { return false; }
}

function textLike(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  if (isUtf8(bytes)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.byteLength, 4096));
  let printable = 0;
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) printable += 1;
  return printable / sample.byteLength >= 0.9;
}

// ─── pinned modules ─────────────────────────────────────────────────────────────────────────────────────────────

interface LibrarySignature {
  readonly library: string;
  /** Banner patterns; group 1 is the version when present. */
  readonly banners: readonly RegExp[];
  readonly versionFromBanner?: (value: string) => string;
  readonly urls: readonly RegExp[];
  readonly npm: readonly string[];
  readonly cdnjs: readonly string[];
}

/** Libraries KEEL carries as registered modules, recognised by banner, URL and package name. */
export const KEEL_LINK_GATE_LIBRARIES: readonly LibrarySignature[] = Object.freeze([
  {
    library: "tone",
    banners: [/\bTone\.js\s+v?(\d+\.\d+\.\d+)/u, /\btone@(\d+\.\d+\.\d+)/u, /\bversion\s*=\s*["'](\d+\.\d+\.\d+)["'][^\n]{0,80}\bTone\b/u],
    urls: [/github\.com\/Tonejs\/Tone\.js/iu, /tonejs\.github\.io/iu],
    npm: ["tone"], cdnjs: ["tone"],
  },
  {
    library: "p5",
    banners: [/\bp5\.js\s+v?(\d+\.\d+\.\d+)/u],
    urls: [/github\.com\/processing\/p5\.js/iu, /\bp5js\.org/iu],
    npm: ["p5"], cdnjs: ["p5.js"],
  },
  {
    library: "three",
    banners: [/\bREVISION\s*=\s*["'](\d{2,3})(?:dev)?["']/u, /\bthree(?:\.js)?\s+r(\d{2,3})\b/iu, /Copyright\s+\d{4}-\d{4}\s+Three\.js\s+Authors/iu],
    versionFromBanner: (value) => /^\d{2,3}$/u.test(value) ? `0.${value}.0` : value,
    urls: [/github\.com\/mrdoob\/three\.js/iu, /\bthreejs\.org/iu],
    npm: ["three"], cdnjs: ["three.js"],
  },
  {
    library: "flash-ruffle",
    banners: [/\bruffle(?:-rs)?[^\n]{0,40}?\b(\d+\.\d+\.\d+)\b/iu],
    urls: [/github\.com\/ruffle-rs\/ruffle/iu, /\bruffle\.rs\b/iu],
    npm: ["@ruffle-rs/ruffle"], cdnjs: [],
  },
  {
    library: "doom-wasm",
    banners: [],
    urls: [/github\.com\/jacobenget\/doom\.wasm/iu],
    npm: [], cdnjs: [],
  },
  {
    library: "keel-audio",
    banners: [/\bkeel-audio\s+(\d+\.\d+\.\d+)/u],
    urls: [],
    npm: [], cdnjs: [],
  },
] satisfies readonly LibrarySignature[]);

const LIBRARY_BY_CATALOG: Readonly<Record<string, string>> = { p5: "p5", three: "three", "doom-wasm": "doom-wasm", "flash-ruffle": "flash-ruffle", tone: "tone", "keel-audio": "keel-audio" };
const PINNED_IN: Readonly<Record<string, string>> = {
  "tone-native": "packages/sdk/src/audio-module.ts (KEEL_TONE_15)",
  "keel-audio": "packages/sdk/src/audio-module.ts (KEEL_AUDIO_RUNTIME)",
};

interface PinnedModule extends KeelLinkGateModuleCandidate { readonly localPath: string | null; readonly inlineSource?: string }

let pinnedCache: readonly PinnedModule[] | undefined;
/** Every module KEEL pins locally: the creative runtime catalog plus the model-viewer vendor modules. */
export function keelLinkGatePinnedModules(): readonly KeelLinkGateModuleCandidate[] {
  return pinnedModules().map(({ localPath: _path, inlineSource: _source, ...module }) => module);
}

function pinnedModules(): readonly PinnedModule[] {
  if (pinnedCache) return pinnedCache;
  const modules: PinnedModule[] = [];
  for (const entry of KEEL_CREATIVE_RUNTIME_CATALOG) {
    for (const resource of entry.resources) {
      if (resource.integrity === null) continue;
      modules.push({
        moduleId: resource.id, version: resource.version, digest: normalizeDigest(resource.integrity.digest),
        byteLength: resource.integrity.byteLength, library: LIBRARY_BY_CATALOG[entry.id] ?? entry.id, mediaType: resource.mediaType,
        source: "keel-pinned", pinnedIn: PINNED_IN[resource.id] ?? "packages/sdk/src/creative-runtime-catalog.ts",
        sourceRepository: resource.sourceRepository, localPath: resource.localPath,
      });
    }
  }
  for (const module of KEEL_MODEL_VENDOR_MODULES) {
    modules.push({
      moduleId: module.moduleId, version: module.version, digest: normalizeDigest(module.digest), byteLength: module.byteLength,
      library: "three", mediaType: "text/javascript", source: "keel-pinned", pinnedIn: "packages/sdk/src/model-viewer-vendor.ts",
      sourceRepository: "https://github.com/mrdoob/three.js", localPath: null, inlineSource: module.source,
    });
  }
  pinnedCache = Object.freeze(modules);
  return pinnedCache;
}

function repositoryRoot(): string | undefined {
  try {
    const path = builtin<NodePath>("node:path"), url = builtin<typeof import("node:url")>("node:url");
    if (!path || !url || !import.meta.url.startsWith("file:")) return undefined;
    return path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../../..");
  } catch { return undefined; }
}

let pinnedTextCache: readonly { readonly module: PinnedModule; readonly text: string }[] | undefined;
/** Exact bytes of pinned modules, for the registered-module context exemption. Empty outside a KEEL checkout. */
function pinnedTexts(): readonly { readonly module: PinnedModule; readonly text: string }[] {
  if (pinnedTextCache) return pinnedTextCache;
  const fs = builtin<NodeFs>("node:fs"), path = builtin<NodePath>("node:path"), root = repositoryRoot();
  const texts: { module: PinnedModule; text: string }[] = [];
  for (const module of pinnedModules()) {
    if (module.inlineSource !== undefined) { texts.push({ module, text: byteText(new TextEncoder().encode(module.inlineSource)) }); continue; }
    if (!fs || !path || !root || module.localPath === null) continue;
    try {
      const bytes = fs.readFileSync(path.join(root, module.localPath));
      if (bytes.byteLength <= 8 * 1024 * 1024) texts.push({ module, text: byteText(bytes) });
    } catch { /* This checkout does not carry the module bytes. */ }
  }
  pinnedTextCache = Object.freeze(texts);
  return pinnedTextCache;
}

// ─── references (selected-chain availability) ────────────────────────────────────────────────────────────────────

function referencesFromJson(name: string, value: unknown): KeelLinkGateReference | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const chainId = (value as { chainId?: unknown }).chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) return undefined;
  const resources: { digest: string; id?: string; containerId?: string; offset?: number }[] = [];
  const stack: unknown[] = [value];
  let visited = 0;
  while (stack.length > 0 && visited < 200_000) {
    const current = stack.pop(); visited += 1;
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) { for (const item of current) stack.push(item); continue; }
    const record = current as Record<string, unknown>;
    const integrity = record.integrity as { digest?: unknown } | undefined;
    if (integrity && typeof integrity.digest === "string" && /^(?:0x|sha256:)?[0-9a-f]{64}$/iu.test(integrity.digest)) {
      const onchain = record.onchain as { containerId?: unknown; offset?: unknown } | undefined;
      resources.push({
        digest: normalizeDigest(integrity.digest),
        ...(typeof record.id === "string" ? { id: record.id } : {}),
        ...(typeof onchain?.containerId === "string" ? { containerId: onchain.containerId } : {}),
        ...(typeof onchain?.offset === "number" ? { offset: onchain.offset } : {}),
      });
    }
    for (const child of Object.values(record)) stack.push(child);
  }
  return resources.length > 0 ? { name, chainId, resources } : undefined;
}

const referenceCache = new Map<string, readonly KeelLinkGateReference[]>();
/** Read bounded deployment reference manifests (deployments/*.json) under one directory root. */
export function loadKeelLinkGateReferences(root: string): readonly KeelLinkGateReference[] {
  const cached = referenceCache.get(root);
  if (cached) return cached;
  const fs = builtin<NodeFs>("node:fs"), path = builtin<NodePath>("node:path");
  const references: KeelLinkGateReference[] = [];
  if (fs && path) {
    const directory = path.join(root, "deployments");
    let names: string[] = [];
    try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().slice(0, 128); } catch { /* No reference manifests here. */ }
    for (const name of names) {
      try {
        const file = path.join(directory, name);
        const info = fs.lstatSync(file);
        if (!info.isFile() || info.size > 8 * 1024 * 1024) continue;
        const reference = referencesFromJson(name.replace(/\.json$/u, ""), JSON.parse(fs.readFileSync(file, "utf8")));
        if (reference) references.push(reference);
      } catch { /* Malformed manifests are not evidence. */ }
    }
  }
  const frozen = Object.freeze(references);
  referenceCache.set(root, frozen);
  return frozen;
}

function availability(module: KeelLinkGateModuleCandidate, chainId: number | undefined, references: readonly KeelLinkGateReference[]): KeelLinkGateAvailability {
  const matches = references.flatMap((reference) => reference.resources
    .filter((resource) => resource.digest === module.digest)
    .map((resource) => ({
      chainId: reference.chainId, reference: reference.name,
      ...(resource.id === undefined ? {} : { resourceId: resource.id }),
      ...(resource.containerId === undefined ? {} : { containerId: resource.containerId }),
      ...(resource.offset === undefined ? {} : { offset: resource.offset }),
    })));
  const selected = chainId ?? null;
  const onSelected = selected !== null && (matches.some((match) => match.chainId === selected) || module.chainId === selected);
  const status = onSelected ? "reference-on-selected-chain"
    : matches.length > 0 ? (selected === null ? "reference-listed" : "reference-on-other-chain")
      : module.source !== "keel-pinned" ? "index-listed" : "not-claimed";
  return { selectedChainId: selected, status, references: matches.slice(0, 16), verification: "requires-selected-chain-readback" };
}

// ─── scanning ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Layer {
  readonly resource: string;
  readonly bytes: Uint8Array;
  readonly path: readonly string[];
  readonly depth: number;
  readonly parent?: Layer;
  /** Byte in the parent layer that produced this byte: exact for percent/escape views, the span start for codecs. */
  readonly toParent?: (offset: number) => number;
  /** Set when this layer or an enclosing one is the exact bytes of a pinned registered module. */
  readonly pinned?: PinnedModule;
  /** A byte-for-byte re-reading (percent/escape) of its parent, mapped exactly by toParent. */
  readonly view?: boolean;
}

function resourceOffset(layer: Layer, offset: number): number {
  let current: Layer | undefined = layer, at = offset;
  while (current?.parent !== undefined && current.toParent !== undefined) { at = current.toParent(at); current = current.parent; }
  return at;
}

interface ScanState {
  readonly hits: KeelLinkGateHit[];
  readonly hitKeys: Set<string>;
  readonly exemptions: KeelLinkGateExemption[];
  readonly layers: Layer[];
  readonly visited: Set<string>;
  readonly uninspected: Set<string>;
  readonly digestOf: Map<Uint8Array, string>;
  expandedBytes: number;
  hitCount: number;
  exemptLayer: (bytes: Uint8Array) => PinnedModule | undefined;
  readonly previews: ReadonlySet<string>;
}

function snippet(text: string, start: number, end: number): string {
  const before = text.slice(Math.max(0, start - CONTEXT_BYTES), start);
  const after = text.slice(end, end + CONTEXT_BYTES);
  const clean = (value: string) => value.replace(/[^\x20-\x7e]/gu, ".");
  return `${start > CONTEXT_BYTES ? "…" : ""}${clean(before)}[${clean(text.slice(start, end))}]${clean(after)}${end + CONTEXT_BYTES < text.length ? "…" : ""}`;
}

/** A hit in a percent/escape view is exempt when the bytes it came from are registered context. */
function viewExemption<T>(layer: Layer, start: number, end: number, match: (text: string, start: number, end: number) => T | undefined): T | undefined {
  let current: Layer = layer, from = start, to = end;
  while (current.view === true && current.parent !== undefined && current.toParent !== undefined) {
    from = current.toParent(from); to = current.toParent(Math.max(from, to - 1)) + 1;
    current = current.parent;
    const found = match(byteText(current.bytes), from, to);
    if (found) return found;
  }
  return undefined;
}

function contextNeedle(text: string, start: number, end: number): string | undefined {
  const before = text.slice(Math.max(0, start - 32), start), after = text.slice(end, end + 32);
  return before.length + after.length < 24 ? undefined : before + text.slice(start, end) + after;
}

function contextExemption(text: string, start: number, end: number): PinnedModule | undefined {
  const needle = contextNeedle(text, start, end);
  return needle === undefined ? undefined : pinnedTexts().find((entry) => entry.text.includes(needle))?.module;
}

function infrastructureExemption(text: string, start: number, end: number): KeelLinkGateInfrastructure | undefined {
  const needle = contextNeedle(text, start, end);
  return needle === undefined || infrastructureCache === undefined ? undefined : infrastructureCache.find((entry) => entry.texts.some((value) => value.includes(needle)));
}

interface MappedBytes { readonly bytes: Uint8Array; readonly map: Uint32Array }

function decodePercent(text: string): MappedBytes | undefined {
  if (!/%[0-9A-Fa-f]{2}/u.test(text)) return undefined;
  const bytes = new Uint8Array(text.length), map = new Uint32Array(text.length);
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    map[length] = index;
    if (text.charCodeAt(index) === 37 && /^[0-9A-Fa-f]{2}$/u.test(text.slice(index + 1, index + 3))) {
      bytes[length++] = Number.parseInt(text.slice(index + 1, index + 3), 16);
      index += 2;
    } else bytes[length++] = text.charCodeAt(index) & 0xff;
  }
  return { bytes: bytes.slice(0, length), map: map.slice(0, length) };
}

/** JavaScript/JSON string escapes (\/, \uXXXX, \xXX) that hide a locator from a literal scan. */
function unescapeScript(text: string): MappedBytes | undefined {
  if (!/\\(?:\/|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2})/u.test(text)) return undefined;
  const bytes: number[] = [], map: number[] = [];
  const emit = (code: number, source: number) => {
    const encoded = code < 0x100 ? [code] : [...new TextEncoder().encode(String.fromCharCode(code))];
    for (const byte of encoded) { bytes.push(byte); map.push(source); }
  };
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 92) { emit(text.charCodeAt(index) & 0xff, index); continue; }
    const rest = text.slice(index, index + 6);
    let match: RegExpExecArray | null;
    if ((match = /^\\u([0-9A-Fa-f]{4})/u.exec(rest))) { emit(Number.parseInt(match[1]!, 16), index); index += 5; }
    else if ((match = /^\\x([0-9A-Fa-f]{2})/u.exec(rest))) { emit(Number.parseInt(match[1]!, 16), index); index += 3; }
    else if (rest.startsWith("\\/")) { emit(47, index); index += 1; }
    else emit(text.charCodeAt(index) & 0xff, index);
  }
  return { bytes: Uint8Array.from(bytes), map: Uint32Array.from(map) };
}

function base64Bytes(value: string): Uint8Array | undefined {
  const normal = value.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/u, "");
  if (normal.length % 4 === 1) return undefined;
  try {
    const binary = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { return undefined; }
}

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

function isZlibHeader(bytes: Uint8Array): boolean {
  const first = bytes[0], second = bytes[1];
  return first !== undefined && second !== undefined && (first & 0x0f) === 8 && (first >> 4) <= 7 && ((first << 8) | second) % 31 === 0;
}

function interesting(bytes: Uint8Array): boolean {
  return bytes.byteLength > 0 && (textLike(bytes) || (bytes[0] === 0x1f && bytes[1] === 0x8b) || isZlibHeader(bytes));
}

function decompress(state: ScanState, kind: "gzip" | "zlib" | "deflate-raw" | "brotli", bytes: Uint8Array, required = false): Uint8Array | undefined {
  const z = zlib();
  if (!z) {
    // Unframed Brotli/deflate are speculative guesses on arbitrary binary.
    // Only an announced codec is recognized content requiring inspection.
    if (required || kind === "gzip" || kind === "zlib") state.uninspected.add(`${kind}: codecs unavailable in this runtime`);
    return undefined;
  }
  const maxOutputLength = Math.max(1, MAX_EXPANDED_BYTES - state.expandedBytes);
  try {
    const flush = { finishFlush: z.constants.Z_SYNC_FLUSH, maxOutputLength };
    const out = kind === "gzip" ? z.gunzipSync(bytes, flush)
      : kind === "zlib" ? z.inflateSync(bytes, flush)
        : kind === "deflate-raw" ? z.inflateRawSync(bytes, flush)
          : z.brotliDecompressSync(bytes, { finishFlush: z.constants.BROTLI_OPERATION_FLUSH, maxOutputLength });
    return out.byteLength > 0 ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength) : undefined;
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") state.uninspected.add(`${kind}: exceeds the ${MAX_EXPANDED_BYTES}-byte scan bound`);
    return undefined;
  }
}

function digestOf(state: ScanState, bytes: Uint8Array): string {
  let digest = state.digestOf.get(bytes);
  if (digest === undefined) { digest = sha256Hex(bytes); state.digestOf.set(bytes, digest); }
  return digest;
}

function inspect(state: ScanState, layer: Layer): void {
  const digest = digestOf(state, layer.bytes);
  const key = `${layer.resource}\u0000${digest}`;
  if (state.visited.has(key)) return;
  if (state.layers.length >= MAX_LAYERS) { state.uninspected.add(`more than ${MAX_LAYERS} nested layers`); return; }
  state.visited.add(key);
  state.layers.push(layer);
  const pinned = layer.pinned ?? state.exemptLayer(layer.bytes);
  const text = byteText(layer.bytes);
  const record = (start: number, end: number, url: string, scheme: string, rawURL = url) => {
    if (KEEL_LINK_GATE_ALLOWED_URLS.includes(rawURL)) return;
    // The committed preview URI, also when a decoded view of it (`%20` → space) cuts the locator short.
    const preview = (value: string, at: number) => [...state.previews].some((uri) => {
      if (!value.startsWith(uri, at)) return false;
      const next = value[at + uri.length];
      // An exact commitment cannot authorize a longer path/query/fragment.
      return next === undefined || /[\s"'<>\\]/u.test(next);
    }) || undefined;
    if (state.previews.has(rawURL) || preview(text, start) || viewExemption(layer, start, end, preview)) {
      if (state.exemptions.length < MAX_REPORTED_HITS) state.exemptions.push({ resource: layer.resource, url, reason: "explicit-external-preview" });
      return;
    }
    // KEEL metadata names its onchain manifest by web3:// with a digest beside it; the artwork never fetches it.
    if (scheme === "web3" && text.slice(Math.max(0, start - 17), start) === '"keel_manifest":"' && /^","keel_manifest_digest":"0x[0-9a-f]{64}"/u.test(text.slice(end, end + 93))) {
      if (state.exemptions.length < MAX_REPORTED_HITS) state.exemptions.push({ resource: layer.resource, url, reason: "keel-manifest-pointer" });
      return;
    }
    const module = pinned ?? contextExemption(text, start, end) ?? viewExemption(layer, start, end, contextExemption);
    const infrastructure = module ? undefined : infrastructureExemption(text, start, end) ?? viewExemption(layer, start, end, infrastructureExemption);
    if (infrastructure) {
      const key = `${layer.resource}\u0000${url}\u0000exempt`;
      if (state.hitKeys.has(key)) return;
      state.hitKeys.add(key);
      if (state.exemptions.length < MAX_REPORTED_HITS) state.exemptions.push({ resource: layer.resource, url, reason: "registered-shell-context", moduleId: infrastructure.id, version: infrastructure.digest });
      return;
    }
    if (module) {
      const key = `${layer.resource}\u0000${url}\u0000exempt`;
      if (state.hitKeys.has(key)) return;
      state.hitKeys.add(key);
      if (state.exemptions.length < MAX_REPORTED_HITS) state.exemptions.push({ resource: layer.resource, url, reason: pinned ? "registered-module-bytes" : "registered-module-context", moduleId: module.moduleId, version: module.version });
      return;
    }
    // The same locator reached through two decoding paths is one hit.
    const offset = resourceOffset(layer, start), context = snippet(text, start, end), key = `${layer.resource}\u0000${url}\u0000${context}`;
    if (state.hitKeys.has(key)) return;
    state.hitKeys.add(key);
    state.hitCount += 1;
    if (state.hits.length < MAX_REPORTED_HITS) state.hits.push({ resource: layer.resource, offset, layerOffset: start, layers: layer.path, url, scheme, context });
  };
  for (const match of text.matchAll(GATE_LOCATOR)) {
    const url = match[0].replace(/[),.;]+$/u, "");
    record(match.index, match.index + url.length, url, url.slice(0, url.indexOf(":")).toLowerCase(), match[0]);
  }
  for (const match of text.matchAll(SENTINEL)) record(match.index, match.index + match[0].length, match[0], "keel.invalid");

  const child = (bytes: Uint8Array | undefined, codec: string, at: number, map?: Uint32Array) => {
    if (bytes === undefined || bytes.byteLength === 0) return;
    if (layer.depth >= MAX_DEPTH) { state.uninspected.add(`${codec}: exceeds the ${MAX_DEPTH}-layer nesting bound`); return; }
    if (state.expandedBytes + bytes.byteLength > MAX_EXPANDED_BYTES) { state.uninspected.add(`${codec}: exceeds the ${MAX_EXPANDED_BYTES}-byte scan bound`); return; }
    state.expandedBytes += bytes.byteLength;
    const toParent = map === undefined ? () => at : (offset: number) => map[offset] ?? at;
    inspect(state, { resource: layer.resource, bytes, path: [...layer.path, `${codec}@${at}`], depth: layer.depth + 1, parent: layer, toParent, ...(map === undefined ? {} : { view: true }), ...(pinned === undefined ? {} : { pinned }) });
  };

  // Owned embedded slots declare their codec. Unlike speculative binary
  // guesses, a declared compressed payload must be opened or remain blocked.
  let declared: unknown;
  try { declared = JSON.parse(text.startsWith(",") ? text.slice(1).trimEnd() : text); } catch { /* Not a JSON slot. */ }
  const pending: unknown[] = declared === undefined ? [] : [declared];
  let inspectedObjects = 0;
  while (pending.length > 0) {
    if (++inspectedObjects > 4096) { state.uninspected.add("declared embedded slots exceed the object inspection bound"); break; }
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    const object = value as Record<string, unknown>;
    if (typeof object["compression"] === "string" && Object.hasOwn(object, "storedBase64")) {
      const codec = object["compression"];
      const encoded = typeof object["storedBase64"] === "string" ? base64Bytes(object["storedBase64"]) : undefined;
      if (!encoded) { state.uninspected.add(`declared ${codec}: invalid storedBase64`); continue; }
      let opened: Uint8Array | undefined;
      if (codec === "none") opened = encoded;
      else if (codec === "gzip") opened = decompress(state, "gzip", encoded, true);
      else if (codec === "brotli") opened = decompress(state, "brotli", encoded, true);
      else if (codec === "deflate") opened = decompress(state, isZlibHeader(encoded) ? "zlib" : "deflate-raw", encoded, true);
      else { state.uninspected.add(`declared ${codec}: no available inspection codec`); continue; }
      if (!opened) state.uninspected.add(`declared ${codec}: payload could not be completely inspected`);
      else child(opened, `declared-${codec}`, 0);
    }
    for (const nested of Object.values(object)) if (nested !== null && typeof nested === "object") pending.push(nested);
  }

  // Whole-layer compression: gzip and zlib announce themselves; Brotli and raw deflate do not,
  // so binary layers are tried and kept only when they open into something readable.
  if (layer.bytes[0] === GZIP_MAGIC[0] && layer.bytes[1] === GZIP_MAGIC[1] && layer.bytes[2] === GZIP_MAGIC[2]) child(decompress(state, "gzip", layer.bytes), "gzip", 0);
  else if (isZlibHeader(layer.bytes)) child(decompress(state, "zlib", layer.bytes), "zlib", 0);
  const text8 = textLike(layer.bytes);
  if (!text8 && layer.bytes.byteLength >= 4) {
    for (const kind of ["brotli", "deflate-raw"] as const) {
      const out = decompress(state, kind, layer.bytes);
      if (out !== undefined && interesting(out)) { child(out, kind, 0); break; }
    }
  }
  // Gzip members embedded in a larger binary layer (calldata, archives, concatenated slugs).
  let embedded = 0;
  for (let at = layer.bytes.indexOf(GZIP_MAGIC[0], 1); at > 0 && embedded < MAX_EMBEDDED_STREAMS_PER_LAYER; at = layer.bytes.indexOf(GZIP_MAGIC[0], at + 1)) {
    if (layer.bytes[at + 1] !== GZIP_MAGIC[1] || layer.bytes[at + 2] !== GZIP_MAGIC[2]) continue;
    embedded += 1;
    child(decompress(state, "gzip", layer.bytes.subarray(at)), "gzip", at);
  }
  if (text8) {
    const percent = decodePercent(text), escaped = unescapeScript(text);
    if (percent) child(percent.bytes, "percent", 0, percent.map);
    if (escaped) child(escaped.bytes, "escape", 0, escaped.map);
  }
  // data: URIs, then any remaining Base64 runs (storedBase64 slots, inline blobs, JSON payloads).
  const covered: [number, number][] = [];
  for (const match of text.matchAll(/data:([a-z0-9.+\/-]*)((?:;[a-z0-9.+=-]+)*?)(;base64)?,([^\s"'<>\\]{8,})/giu)) {
    const at = match.index + match[0].length - match[4]!.length;
    const payload = match[3] ? /^[A-Za-z0-9+\/=_%-]*/u.exec(match[4]!)![0] : match[4]!;
    covered.push([at, at + payload.length]);
    const bytes = match[3] ? base64Bytes(decodeURIComponentSafe(payload)) : decodePercent(payload)?.bytes;
    child(bytes, `data-uri${match[1] ? `(${match[1]})` : ""}${match[3] ? "-base64" : ""}`, at);
  }
  let runs = 0;
  for (const match of text.matchAll(/[A-Za-z0-9+\/_-]{32,}={0,2}/gu)) {
    if (runs >= MAX_BASE64_RUNS_PER_LAYER) { state.uninspected.add(`more than ${MAX_BASE64_RUNS_PER_LAYER} Base64 runs in one layer`); break; }
    const at = match.index;
    if (covered.some(([start, end]) => at >= start && at < end)) continue;
    runs += 1;
    const bytes = base64Bytes(match[0]);
    if (bytes !== undefined && interesting(bytes)) child(bytes, "base64", at);
  }
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

// ─── module finder ──────────────────────────────────────────────────────────────────────────────────────────────

interface Detection { readonly resource: string; readonly library: string; readonly version: string | null; readonly kind: "banner" | "url"; readonly evidence: string }

function libraryFor(name: string, field: "npm" | "cdnjs"): LibrarySignature | undefined {
  const lower = name.toLowerCase();
  return KEEL_LINK_GATE_LIBRARIES.find((library) => library[field].includes(lower));
}

/** Map a CDN/registry/GitHub locator to a library and version. Exported for the CLI and tests. */
export function keelLinkGateLibraryFromUrl(url: string): { readonly library: string; readonly version: string | null; readonly evidence: string } | undefined {
  const npm = /(?:cdn\.jsdelivr\.net\/npm|unpkg\.com|esm\.sh|cdn\.skypack\.dev|esm\.run)\/((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@([0-9][0-9A-Za-z.+-]*))?/iu.exec(url)
    ?? /registry\.npmjs\.org\/((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)\/-\/[a-z0-9._-]+-(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)\.tgz/iu.exec(url);
  if (npm) {
    const library = libraryFor(npm[1]!, "npm");
    if (library) return { library: library.library, version: npm[2] ?? null, evidence: `npm ${npm[1]}${npm[2] ? "@" + npm[2] : ""}` };
  }
  const cdnjs = /cdnjs\.cloudflare\.com\/ajax\/libs\/([A-Za-z0-9._-]+)\/([0-9][0-9A-Za-z.+-]*)/u.exec(url);
  if (cdnjs) {
    const library = libraryFor(cdnjs[1]!, "cdnjs");
    if (library) return { library: library.library, version: cdnjs[2]!.replace(/^r(\d+)$/u, "0.$1.0"), evidence: `cdnjs ${cdnjs[1]}/${cdnjs[2]}` };
  }
  const github = /(?:github\.com|raw\.githubusercontent\.com|cdn\.jsdelivr\.net\/gh)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@([^/]+))?(?:[/#?]|$)/iu.exec(url);
  if (github) {
    const repo = `github.com/${github[1]}/${github[2]}`.toLowerCase();
    for (const module of pinnedModules()) {
      if (module.sourceRepository && module.sourceRepository.toLowerCase().replace(/^https?:\/\//u, "").replace(/\.git$/u, "") === repo) {
        return { library: module.library, version: github[3]?.replace(/^v/u, "") ?? null, evidence: `GitHub ${github[1]}/${github[2]}` };
      }
    }
  }
  for (const library of KEEL_LINK_GATE_LIBRARIES) {
    if (library.urls.some((pattern) => pattern.test(url))) return { library: library.library, version: null, evidence: `URL ${url.slice(0, 120)}` };
  }
  return undefined;
}

function detect(layer: Layer): Detection[] {
  const text = byteText(layer.bytes.subarray(0, Math.min(layer.bytes.byteLength, 4 * 1024 * 1024)));
  const found: Detection[] = [];
  for (const library of KEEL_LINK_GATE_LIBRARIES) {
    for (const banner of library.banners) {
      const match = banner.exec(text);
      if (!match) continue;
      const raw = match[1] ?? null;
      found.push({ resource: layer.resource, library: library.library, version: raw === null ? null : (library.versionFromBanner?.(raw) ?? raw), kind: "banner", evidence: match[0].replace(/[^\x20-\x7e]/gu, ".").slice(0, 120) });
      break;
    }
  }
  return found;
}

function compareVersion(detected: string | null, module: string): "exact" | "different-version" | "unknown" {
  if (detected === null) return "unknown";
  const normal = (value: string) => value.replace(/^v/u, "").replace(/^r(\d+)$/u, "0.$1.0");
  return normal(detected) === normal(module) ? "exact" : "different-version";
}

function suggestionsFor(state: ScanState, input: KeelLinkGateInput, references: readonly KeelLinkGateReference[]): KeelLinkGateSuggestion[] {
  const indexCandidates: KeelLinkGateModuleCandidate[] = (input.index ?? []).map((entry) => ({
    moduleId: entry.moduleId, version: entry.version, digest: normalizeDigest(entry.digest), byteLength: entry.byteLength ?? null,
    library: (entry.library ?? entry.names?.[0] ?? entry.moduleId).toLowerCase(), source: entry.source ?? "keel-index",
    ...(entry.chainId === undefined ? {} : { chainId: entry.chainId }),
    ...(entry.selection === undefined ? {} : { selection: entry.selection }),
  }));
  const candidates: KeelLinkGateModuleCandidate[] = [...keelLinkGatePinnedModules(), ...indexCandidates];
  const byDigest = new Map<string, KeelLinkGateModuleCandidate[]>();
  for (const candidate of candidates) byDigest.set(candidate.digest, [...(byDigest.get(candidate.digest) ?? []), candidate]);
  const indexNames = (entry: KeelLinkGateIndexEntry) => [entry.library, ...(entry.names ?? []), entry.moduleId].filter((value): value is string => typeof value === "string").map((value) => value.toLowerCase());
  // Banner and URL matches point at the library's runtime modules; vendor add-ons (three.js loaders) only match by sha256.
  const forLibrary = (library: string) => candidates.filter((candidate) => (candidate.library === library && candidate.pinnedIn !== "packages/sdk/src/model-viewer-vendor.ts")
    || (candidate.source !== "keel-pinned" && (input.index ?? []).some((entry) => normalizeDigest(entry.digest) === candidate.digest && indexNames(entry).some((name) => name.includes(library)))));

  const suggestions: KeelLinkGateSuggestion[] = [];
  const seen = new Set<string>();
  const push = (resource: string, library: string, detectedVersion: string | null, kind: "sha256" | "banner" | "url", evidence: string, module: KeelLinkGateModuleCandidate, versionMatch: "exact" | "different-version" | "unknown") => {
    const key = `${resource}\u0000${module.moduleId}\u0000${module.digest}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({
      resource, library, detectedVersion, match: { kind, evidence, versionMatch }, module,
      availability: availability(module, input.chainId, references),
      action: kind === "sha256"
        ? `These bytes are ${module.moduleId}@${module.version}. Reference the registered module (or reuse its existing object ID) instead of uploading another copy.`
        : `Remove the embedded ${library} copy and declare ${module.moduleId}@${module.version} (${module.digest}) as a module dependency${versionMatch === "different-version" ? "; the registered version differs, so test the piece against it" : ""}.`,
      substitution: "never-automatic",
    });
  };

  for (const layer of state.layers) {
    for (const module of byDigest.get(digestOf(state, layer.bytes)) ?? []) push(layer.resource, module.library, module.version, "sha256", `sha256 ${module.digest}`, module, "exact");
    for (const detection of detect(layer)) {
      for (const module of forLibrary(detection.library)) push(detection.resource, detection.library, detection.version, "banner", detection.evidence, module, compareVersion(detection.version, module.version));
    }
  }
  for (const hit of state.hits) {
    const found = keelLinkGateLibraryFromUrl(hit.url);
    if (!found) continue;
    for (const module of forLibrary(found.library)) push(hit.resource, found.library, found.version, "url", `${found.evidence} at byte ${hit.offset}`, module, compareVersion(found.version, module.version));
  }
  const rank = { sha256: 0, banner: 1, url: 2 } as const, versionRank = { exact: 0, unknown: 1, "different-version": 2 } as const;
  return suggestions.sort((left, right) => rank[left.match.kind] - rank[right.match.kind] || versionRank[left.match.versionMatch] - versionRank[right.match.versionMatch]).slice(0, 64);
}

// ─── public API ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Scan onchain-bound bytes and report locators plus registered KEEL modules to reuse. Never throws on a hit. */
export function scanKeelLinkGate(input: KeelLinkGateInput): KeelLinkGateReport {
  if (typeof input.route !== "string" || input.route.length === 0) throw new TypeError("KEEL link gate needs the push route name.");
  if (!Array.isArray(input.resources)) throw new TypeError("KEEL link gate resources must be a list.");
  const byDigest = new Map(pinnedModules().map((module) => [module.digest, module] as const));
  const state: ScanState = {
    hits: [], hitKeys: new Set(), exemptions: [], layers: [], visited: new Set(), uninspected: new Set(), digestOf: new Map(), expandedBytes: 0, hitCount: 0,
    exemptLayer: (bytes) => byDigest.get(digestOf(state, bytes)),
    previews: new Set(snapshotKeelLinkGatePreviews(input.externalPreviews).map(preview => preview.uri)),
  };
  const resources: KeelLinkGateReport["resources"][number][] = [];
  for (const resource of input.resources) {
    if (!(resource?.bytes instanceof Uint8Array) || typeof resource.id !== "string") throw new TypeError("Each KEEL link gate resource needs an id and bytes.");
    const digest = digestOf(state, resource.bytes);
    const registered = byDigest.get(digest);
    resources.push({ id: resource.id, byteLength: resource.bytes.byteLength, sha256: digest, ...(resource.mediaType === undefined ? {} : { mediaType: resource.mediaType }), ...(registered ? { registeredModule: { moduleId: registered.moduleId, version: registered.version } } : {}) });
    inspect(state, { resource: resource.id, bytes: resource.bytes, path: [], depth: 0 });
  }
  const root = repositoryRoot();
  const references = input.references ?? [
    ...(root === undefined ? [] : loadKeelLinkGateReferences(root)),
    ...(input.workspaceRoot === undefined || input.workspaceRoot === root ? [] : loadKeelLinkGateReferences(input.workspaceRoot)),
  ];
  return {
    protocol: KEEL_LINK_GATE_PROTOCOL,
    route: input.route,
    status: state.hitCount > 0 || state.uninspected.size > 0 ? "blocked" : "clear",
    allowlist: KEEL_LINK_GATE_ALLOWED_URLS,
    resources,
    hitCount: state.hitCount,
    hits: state.hits,
    exemptions: state.exemptions,
    suggestions: suggestionsFor(state, input, references),
    coverage: { codecs: zlib() ? "node-zlib" : "unavailable", layersInspected: state.layers.length, expandedBytes: state.expandedBytes, uninspected: [...state.uninspected] },
    signing: "not-performed",
    submission: "not-performed",
  };
}

export interface KeelLinkGateRefusalDetail {
  readonly schema: "keel-link-gate-refusal@1";
  readonly status: "refused";
  readonly code: "external-link-found" | "inspection-incomplete";
  readonly tool: string;
  readonly message: string;
  readonly nextTool: "keel-link-gate";
  readonly next: string;
  readonly hits: readonly KeelLinkGateHit[];
  readonly hitCount: number;
  readonly suggestions: readonly KeelLinkGateSuggestion[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

/** Thrown when onchain-bound bytes carry a locator. `refusal` is the MCP structured result. */
export class KeelLinkGateRefusal extends Error {
  readonly code: "external-link-found" | "inspection-incomplete";
  readonly report: KeelLinkGateReport;
  readonly refusal: KeelLinkGateRefusalDetail;
  constructor(report: KeelLinkGateReport) {
    const message = formatKeelLinkGateReport(report);
    super(message);
    this.name = "KeelLinkGateRefusal";
    this.report = report;
    this.code = report.hitCount > 0 ? "external-link-found" : "inspection-incomplete";
    this.refusal = Object.freeze({
      schema: "keel-link-gate-refusal@1", status: "refused", code: this.code, tool: report.route, message,
      nextTool: "keel-link-gate",
      next: "Remove each locator (or replace an embedded library with the suggested registered KEEL module), then rerun the same tool. Only http://www.w3.org/2000/svg is allowed.",
      hits: report.hits.slice(0, 32), hitCount: report.hitCount, suggestions: report.suggestions.slice(0, 16),
      signing: "not-performed", submission: "not-performed",
    });
  }
}

/** Human-readable refusal: resource, byte offset, decoding path, URL, context and modules to reuse. */
export function formatKeelLinkGateReport(report: KeelLinkGateReport): string {
  if (report.status === "clear") return `KEEL link gate cleared ${report.route}: no external locators in ${report.resources.length} resource(s).`;
  const lines = [`KEEL link gate refused ${report.route}: ${report.hitCount} external locator(s) in bytes headed onchain.`];
  for (const hit of report.hits.slice(0, 8)) {
    lines.push(`- ${hit.resource} @ byte ${hit.offset}${hit.layers.length ? ` (inside ${hit.layers.join(" > ")}, layer byte ${hit.layerOffset})` : ""}: ${hit.url}  ${hit.context}`);
  }
  if (report.hitCount > 8) lines.push(`- … ${report.hitCount - 8} more; run keel-link-gate for the full report.`);
  if (report.hits.some((hit) => hit.scheme.startsWith("oca"))) {
    lines.push("OCA is retired: oca-onchain:// and oca: are not KEEL locators. Present the work Inline, or link a manifest with keelManifestURI (web3://).");
  }
  for (const reason of report.coverage.uninspected.slice(0, 8)) lines.push(`- Inspection incomplete: ${reason}. Use a supported bounded representation and rerun before publication.`);
  const shown = new Set<string>();
  const reuse = report.suggestions.filter((suggestion) => {
    const key = suggestion.module.moduleId + suggestion.module.digest;
    if (shown.has(key)) return false;
    shown.add(key); return true;
  }).slice(0, 4);
  if (reuse.length) {
    lines.push("Reuse registered KEEL modules instead of embedding a copy:");
    for (const suggestion of reuse) lines.push(`- ${suggestion.module.moduleId}@${suggestion.module.version} ${suggestion.module.digest}${suggestion.module.pinnedIn ? ` (${suggestion.module.pinnedIn})` : ""}: ${suggestion.match.kind} ${suggestion.match.evidence}; ${suggestion.availability.status}`);
  }
  lines.push(`Only ${KEEL_LINK_GATE_ALLOWED_URLS.join(", ")} is allowed. No wallet request or upload plan was produced.`);
  return lines.join("\n");
}

/** The push gate: returns the clear report, or throws KeelLinkGateRefusal. There is no bypass option. */
export function assertKeelLinkGate(input: KeelLinkGateInput): KeelLinkGateReport {
  const report = scanKeelLinkGate(input);
  if (report.status === "blocked") throw new KeelLinkGateRefusal(report);
  return report;
}

// ─── registered KEEL infrastructure ─────────────────────────────────────────────────────────────────────────────

/**
 * KEEL's own registered shell, published-view reader and managed-shell runtime carry explorer, gallery and
 * gateway links for collectors. Bytes that reproduce them verbatim (32 bytes of context either side) are that
 * infrastructure, not a creator embedding a link. Loaded once per process, only when a scan was blocked.
 */
export interface KeelLinkGateInfrastructure {
  readonly id: string;
  /** 0x sha256 of the infrastructure bytes as built or read. */
  readonly digest: string;
  readonly texts: readonly string[];
}

let infrastructureCache: readonly KeelLinkGateInfrastructure[] | undefined;
let infrastructureLoad: Promise<readonly KeelLinkGateInfrastructure[]> | undefined;

/** Every decoded layer text of `bytes`, so infrastructure stored compressed or encoded is matched as built. */
function layerTexts(id: string, bytes: Uint8Array): string[] {
  const state: ScanState = {
    hits: [], hitKeys: new Set(), exemptions: [], layers: [], visited: new Set(), uninspected: new Set(), digestOf: new Map(), expandedBytes: 0, hitCount: 0,
    exemptLayer: () => undefined, previews: new Set(),
  };
  inspect(state, { resource: id, bytes, path: [], depth: 0 });
  return state.layers.map((layer) => byteText(layer.bytes));
}

/** Build (once) the registered KEEL shell and read the registered reader/runtime assets for the shell-context exemption. */
export function loadKeelLinkGateInfrastructure(): Promise<readonly KeelLinkGateInfrastructure[]> {
  infrastructureLoad ??= (async () => {
    const entries: KeelLinkGateInfrastructure[] = [];
    const add = (id: string, value: string | Uint8Array) => {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      entries.push({ id, digest: sha256Hex(bytes), texts: layerTexts(id, bytes) });
    };
    const fs = builtin<NodeFs>("node:fs"), path = builtin<NodePath>("node:path"), root = repositoryRoot();
    if (fs && path && root) {
      for (const [id, file] of [
        ["keel.published-view-reader", "packages/sdk/dist/assets/keel-published-view-reader-v1.js"],
        ["keel.verification-chrome", "packages/viewer/src/keel-verification-chrome.js"],
        ["keel.managed-shell-runtime", "packages/sdk/dist/managed-shell-runtime.js"],
      ] as const) {
        try { add(id, new Uint8Array(fs.readFileSync(path.join(root, file)))); } catch { /* Not part of this checkout or bundle. */ }
      }
      try {
        // Not statically analysable: browser bundles of wallet-request must not pull in the shell builder.
        const url = builtin<typeof import("node:url")>("node:url");
        if (!url) throw new Error("Node URL resolution is unavailable.");
        const specifier = url.pathToFileURL(path.join(path.dirname(url.fileURLToPath(import.meta.url)), "inline-viewer-graph.js")).href;
        const graph = await import(/* webpackIgnore: true */ /* @vite-ignore */ specifier) as typeof import("./inline-viewer-graph.js");
        const shell = await graph.buildKeelInlineShellFragments({ repositoryRoot: root });
        add("keel.verification-shell.prefix", shell.prefix.bytes);
        add("keel.verification-shell.suffix", shell.suffix.bytes);
      } catch { /* The shell sources are not available here; only the static assets are exempt. */ }
    }
    infrastructureCache = Object.freeze(entries);
    return infrastructureCache;
  })();
  return infrastructureLoad;
}

/**
 * The push gate every KEEL route awaits: scans, and when blocked, loads KEEL's registered infrastructure once and
 * rescans so bytes reproducing the registered shell/reader verbatim pass. Throws KeelLinkGateRefusal otherwise.
 */
export async function enforceKeelLinkGate(input: KeelLinkGateInput): Promise<KeelLinkGateReport> {
  const snapshot = { ...input, externalPreviews: snapshotKeelLinkGatePreviews(input.externalPreviews) };
  const report = scanKeelLinkGate(snapshot);
  if (report.status === "clear" || infrastructureCache !== undefined) {
    if (report.status === "blocked") throw new KeelLinkGateRefusal(report);
    return report;
  }
  await loadKeelLinkGateInfrastructure();
  return assertKeelLinkGate(snapshot);
}

function hexBytes(value: string): Uint8Array | undefined {
  const hex = value.replace(/^0x/iu, "");
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/iu.test(hex)) return undefined;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

const CAST_SLUGS_SELECTOR = "0d1ff9e2";

/** ABI `bytes[]` elements of castSlugs calldata, so chunk payloads are scanned as one stream. */
function castSlugsPayload(data: Uint8Array): Uint8Array | undefined {
  const word = (at: number) => {
    if (at + 32 > data.byteLength) return undefined;
    let value = 0;
    for (let index = at + 24; index < at + 32; index += 1) value = value * 256 + data[index]!;
    return value;
  };
  const args = 4, head = word(args);
  if (head === undefined) return undefined;
  const count = word(args + head);
  if (count === undefined || count > 4096) return undefined;
  const parts: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = word(args + head + 32 + index * 32);
    if (offset === undefined) return undefined;
    const at = args + head + 32 + offset, length = word(at);
    if (length === undefined || at + 32 + length > data.byteLength) return undefined;
    parts.push(data.subarray(at + 32, at + 32 + length));
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0), out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

/** Onchain-bound bytes of a wallet request: EVM calldata (plus castSlugs payloads) or Tezos parameters. */
export function keelLinkGateWalletRequestResources(request: { readonly family?: unknown; readonly data?: unknown; readonly parameters?: unknown }): readonly KeelLinkGateResource[] {
  const resources: KeelLinkGateResource[] = [];
  if (request.family === "ethereum" && typeof request.data === "string") {
    const data = hexBytes(request.data);
    if (data !== undefined && data.byteLength > 0) {
      resources.push({ id: "calldata", bytes: data });
      if (request.data.replace(/^0x/iu, "").slice(0, 8).toLowerCase() === CAST_SLUGS_SELECTOR) {
        const payload = castSlugsPayload(data);
        if (payload !== undefined && payload.byteLength > 0) resources.push({ id: "castSlugs payload", bytes: payload });
      }
    }
  }
  if (request.family === "tezos" && typeof request.parameters === "string") {
    resources.push({ id: "parameters", bytes: new TextEncoder().encode(request.parameters) });
    for (const match of request.parameters.matchAll(/"bytes"\s*:\s*"([0-9a-fA-F]+)"/gu)) {
      const bytes = hexBytes(match[1]!);
      if (bytes !== undefined && bytes.byteLength > 0) resources.push({ id: `parameters bytes@${match.index}`, bytes });
    }
  }
  return resources;
}
