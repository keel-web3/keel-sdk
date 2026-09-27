/**
 * KEEL standards enforcement: the preflight receipt, the token standard audit, and the gate every signing-request
 * tool runs before it prepares contract, collection, metadata or viewer work.
 *
 * Advisory text did not stop an agent from shipping an ERC-721 whose tokenURI pointed its image at a web server.
 * These are hard gates instead: a tool that would hand a wallet request to the user refuses, with a refusal code and
 * the exact next tool, unless it is shown (1) a live preflight receipt and (2) where a token is involved, a passing
 * audit digest. Both are content-addressed records in the workspace evidence store, so they survive a restart and
 * any edit to them breaks the digest.
 */
import { createHash } from "node:crypto";
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { buildCompactInlineKeelShell } from "@keel/sdk";
import { createIntegrity } from "@keel/protocol";
import type { ToolContext, Workspace } from "./types.js";

export const EVIDENCE_DIRECTORY = ".keel-mcp";
export const PREFLIGHT_RECEIPT_SCHEMA = "keel-contract-workflow-receipt@1" as const;
export const TOKEN_STANDARD_AUDIT_SCHEMA = "keel-token-standard-audit@1" as const;
export const STANDARDS_CLEARANCE_SCHEMA = "keel-standards-clearance@1" as const;
/** Public-read ceiling for tokenURI: above this a marketplace or wallet RPC will not reliably return it. */
export const TOKEN_URI_READ_GAS_LIMIT = 30_000_000;
export const TOKEN_URI_MAX_BYTES = 2_000_000;
export const EVIDENCE_TTL_MS = 24 * 60 * 60 * 1000;
/** The single protocol literal allowed anywhere: the SVG namespace is syntax, not a fetch. */
export const ALLOWED_LITERAL_URLS = Object.freeze(["http://www.w3.org/2000/svg"]);
/** The order agents must follow. Refusals point at the next entry. */
export const KEEL_STANDARD_WORKFLOW = Object.freeze([
  "keel-contract-workflow-preflight",
  "keel-engine-catalog",
  "keel-network-inspect",
  "keel-library-search",
  "keel-contract-controls",
  "build (keel-inline-prepare / build / upload-plan)",
  "keel-token-standard-audit",
  "request (wallet-request-prepare / publish-plan / keel-creator-collection-prepare / wallet-link / keel-shell-prepare)",
] as const);

const MAX_DECODE_DEPTH = 8;
const MAX_DECODED_BYTES = 64 * 1024 * 1024;
const MAX_FINDINGS = 200;
const MAX_RPC_RESPONSE_BYTES = 16 * 1024 * 1024;

// ─── shared helpers ──────────────────────────────────────────────────────────────────────────────────────────────

type Hex = `0x${string}`;

function sha256(bytes: Uint8Array | string): Hex {
  const hash = createHash("sha256");
  hash.update(bytes);
  return `0x${String(hash.digest("hex"))}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Deterministic JSON: object keys sorted, so the same record always has the same digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

const DIGEST = /^0x[0-9a-f]{64}$/u;

function digestFile(kind: "receipts" | "audits", digest: string): string {
  return `${EVIDENCE_DIRECTORY}/${kind}/${digest.slice(2)}.json`;
}

// ─── refusals ────────────────────────────────────────────────────────────────────────────────────────────────────

export type StandardsRefusalCode =
  | "standards-evidence-required"
  | "preflight-receipt-required"
  | "preflight-receipt-invalid"
  | "preflight-receipt-expired"
  | "preflight-receipt-stale"
  | "storage-only-not-verified"
  | "token-standard-audit-required"
  | "token-standard-audit-invalid"
  | "token-standard-audit-failed"
  | "token-standard-audit-expired"
  | "token-standard-audit-subject-mismatch";

export interface StandardsRefusalDetail {
  readonly schema: "keel-standards-refusal@1";
  readonly status: "refused";
  readonly code: StandardsRefusalCode;
  readonly tool: string;
  readonly message: string;
  readonly nextTool: string;
  readonly next: string;
  readonly workflow: readonly string[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

/** Thrown by a gate. The server turns it into an isError tool result that still carries structuredContent. */
export class StandardsRefusal extends Error {
  readonly refusal: StandardsRefusalDetail;
  constructor(tool: string, code: StandardsRefusalCode, message: string, nextTool: string, next: string) {
    super(`REFUSED ${code}: ${message} Next: call ${nextTool}. ${next}`);
    this.name = "StandardsRefusal";
    this.refusal = Object.freeze({
      schema: "keel-standards-refusal@1",
      status: "refused",
      code,
      tool,
      message,
      nextTool,
      next,
      workflow: KEEL_STANDARD_WORKFLOW,
      signing: "not-performed",
      submission: "not-performed",
    });
  }
}

// ─── preflight receipt ───────────────────────────────────────────────────────────────────────────────────────────

export interface PreflightDocument { readonly path: string; readonly byteLength: number; readonly sha256: string }

interface PreflightReceiptBody {
  readonly schema: typeof PREFLIGHT_RECEIPT_SCHEMA;
  readonly workspace: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly documents: readonly PreflightDocument[];
  readonly requiredNext: readonly string[];
}

export async function issuePreflightReceipt(workspace: Workspace, documents: readonly PreflightDocument[], requiredNext: readonly string[], now = Date.now()) {
  const body: PreflightReceiptBody = {
    schema: PREFLIGHT_RECEIPT_SCHEMA,
    workspace: workspace.root,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EVIDENCE_TTL_MS).toISOString(),
    nonce: `0x${hex(crypto.getRandomValues(new Uint8Array(16)))}`,
    documents: documents.map((document) => ({ path: document.path, byteLength: document.byteLength, sha256: document.sha256 })),
    requiredNext,
  };
  const id = sha256(canonicalJson(body));
  const recordPath = digestFile("receipts", id);
  await workspace.writeText(recordPath, `${JSON.stringify({ id, body }, null, 2)}\n`);
  return Object.freeze({
    id,
    path: recordPath,
    issuedAt: body.issuedAt,
    expiresAt: body.expiresAt,
    use: "Pass this id as standards.preflightReceipt to every tool that prepares a wallet request for contract, collection, metadata or viewer work.",
  });
}

async function readRecord(workspace: Workspace, kind: "receipts" | "audits", digest: string): Promise<{ readonly id: string; readonly body: Record<string, unknown> } | undefined> {
  let loaded: { readonly bytes: Uint8Array };
  try {
    loaded = await workspace.readFile(digestFile(kind, digest), 4 * 1024 * 1024);
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as { readonly id?: unknown; readonly body?: unknown };
  if (record.id !== digest || record.body === null || typeof record.body !== "object" || Array.isArray(record.body)) return undefined;
  // The digest is recomputed, so an edited record is simply not a record.
  if (sha256(canonicalJson(record.body)) !== digest) return undefined;
  return { id: digest, body: record.body as Record<string, unknown> };
}

async function verifyPreflightReceipt(context: ToolContext, tool: string, id: unknown, now: number) {
  const preflight = "keel-contract-workflow-preflight";
  if (id === undefined) throw new StandardsRefusal(tool, "preflight-receipt-required", "This request prepares contract, collection, metadata or viewer work and has no preflight receipt.", preflight, "Pass its receipt.id as standards.preflightReceipt.");
  if (typeof id !== "string" || !DIGEST.test(id)) throw new StandardsRefusal(tool, "preflight-receipt-invalid", "standards.preflightReceipt must be the 0x-prefixed 64-hex receipt.id.", preflight, "Use the receipt.id it returns verbatim.");
  const record = await readRecord(context.workspace, "receipts", id);
  if (record === undefined || record.body.schema !== PREFLIGHT_RECEIPT_SCHEMA) throw new StandardsRefusal(tool, "preflight-receipt-invalid", "No intact preflight receipt with that id exists in this workspace's evidence store.", preflight, "Run it in this workspace and use the new receipt.id.");
  const body = record.body as unknown as PreflightReceiptBody;
  if (body.workspace !== context.workspace.root) throw new StandardsRefusal(tool, "preflight-receipt-invalid", "The receipt was issued for a different workspace.", preflight, "Run it in this workspace.");
  if (Date.parse(body.expiresAt) <= now) throw new StandardsRefusal(tool, "preflight-receipt-expired", `The receipt expired at ${body.expiresAt}.`, preflight, "Re-read the docs by running it again.");
  for (const document of body.documents) {
    let current: string | undefined;
    try {
      current = (await createIntegrity((await context.workspace.readFile(document.path, 1_000_000)).bytes)).digest;
    } catch {
      current = undefined;
    }
    if (current !== document.sha256) throw new StandardsRefusal(tool, "preflight-receipt-stale", `${document.path} changed after the receipt was issued.`, preflight, "Re-read the changed docs by running it again.");
  }
  return { id, issuedAt: body.issuedAt, expiresAt: body.expiresAt, documents: body.documents.map((document) => document.path) };
}

// ─── token standard audit ────────────────────────────────────────────────────────────────────────────────────────

export type AuditFindingCode =
  | "read-failed"
  | "read-gas-exceeds-limit"
  | "token-uri-too-large"
  | "token-uri-empty"
  | "token-uri-not-data-json"
  | "metadata-invalid-json"
  | "metadata-base64"
  | "external-locator"
  | "image-missing"
  | "image-not-onchain"
  | "data-uri-invalid"
  | "html-base64-not-raw-percent"
  | "viewer-not-canonical-shell"
  | "viewer-relative-resource"
  | "decode-limit-exceeded";

/** These describe whether the token can be read at all; no exception can waive them. */
const NON_EXCEPTABLE: ReadonlySet<AuditFindingCode> = new Set([
  "read-failed", "read-gas-exceeds-limit", "token-uri-too-large", "token-uri-empty", "metadata-invalid-json", "data-uri-invalid", "decode-limit-exceeded", "image-missing",
]);

export interface AuditFinding {
  readonly code: AuditFindingCode;
  readonly severity: "error" | "warning";
  readonly at: string;
  readonly detail: string;
  readonly exceptable: boolean;
}

export interface AuditException {
  readonly codes: readonly AuditFindingCode[];
  readonly reason: string;
  readonly reviewer: string;
  readonly signature?: string;
}

interface ShellFragments { readonly prefix: string; readonly suffix: string }
let shellCache: Promise<ShellFragments> | undefined;
/** The registered canonical KEEL verification shell, from the SDK's pinned packaged source. */
export function canonicalShellFragments(): Promise<ShellFragments> {
  shellCache ??= buildCompactInlineKeelShell().then((shell) => ({
    prefix: new TextDecoder().decode(shell.prefix),
    suffix: new TextDecoder().decode(shell.suffix),
  }));
  return shellCache;
}

/** Percent-decode bytes without throwing on stray '%' (raw-percent carriage is not always URI-component clean). */
function percentDecode(text: string): Uint8Array {
  const source = Buffer.from(text, "utf8");
  const out = new Uint8Array(source.byteLength);
  let length = 0;
  for (let index = 0; index < source.byteLength; index += 1) {
    const byte = source[index]!;
    if (byte === 0x25 && index + 2 < source.byteLength) {
      const pair = String.fromCharCode(source[index + 1]!, source[index + 2]!);
      if (/^[0-9A-Fa-f]{2}$/u.test(pair)) {
        out[length] = Number.parseInt(pair, 16);
        length += 1;
        index += 2;
        continue;
      }
    }
    out[length] = byte;
    length += 1;
  }
  return out.slice(0, length);
}

function utf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

interface DataUri { readonly mediaType: string; readonly params: readonly string[]; readonly base64: boolean; readonly bytes: Uint8Array }

function parseDataUri(value: string): DataUri | undefined {
  const match = /^data:([^,]*),/isu.exec(value);
  if (match === null) return undefined;
  const header = match[1]!.split(";").map((part) => part.trim());
  const mediaType = (header[0] || "text/plain").toLowerCase();
  const params = header.slice(1).map((part) => part.toLowerCase());
  const base64 = params.includes("base64");
  const payload = value.slice(match[0].length);
  if (base64) {
    const clean = payload.replace(/%([0-9A-Fa-f]{2})/gu, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\s+/gu, "");
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/u.test(clean)) return undefined;
    return { mediaType, params, base64, bytes: new Uint8Array(Buffer.from(clean, "base64")) };
  }
  return { mediaType, params, base64, bytes: percentDecode(payload) };
}

const LOCATOR = /\b(?:(?:https?|ipfs|ipns|web3|keel-onchain|arweave):[^\s"'<>\\`)\]]+|ar:\/\/[^\s"'<>\\`)\]]+)|keel\.invalid/giu;
const PROTOCOL_RELATIVE = /(?:\b(?:src|href|action|poster|data|srcset)\s*=\s*["']?|\burl\(\s*["']?|@import\s+["'])(\/\/[A-Za-z0-9.-]+[^\s"'<>)]*)/giu;
const RESOURCE_TAG = /<(?:img|iframe|script|link|video|audio|source|object|embed|form)\b[^>]+\b(?:src|href|action|poster|data-src|data-href)\s*=\s*["'](?!data:|#|about:blank|javascript:|blob:)([^"']+)/giu;
const COMPRESSED_BASE64 = /(?:H4sI|eJ[wxyz0-9A-Za-z]|eF[0-9A-Za-z]|eNo|eAE)[A-Za-z0-9+/]{12,}={0,2}/gu;
const NESTED_DATA_URI = /data:[A-Za-z0-9.+/-]*(?:;[A-Za-z0-9.+=_-]+)*,[^"'\s<>`)\]]+/giu;

class AuditWalker {
  readonly findings: AuditFinding[] = [];
  private readonly seen = new Set<string>();
  private decoded = 0;
  htmlDocuments = 0;
  canonicalShells = 0;
  constructor(private readonly shell: ShellFragments) {}

  add(code: AuditFindingCode, at: string, detail: string, severity: "error" | "warning" = "error"): void {
    const key = `${code}|${at}|${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.findings.length >= MAX_FINDINGS) return;
    this.findings.push({ code, severity, at, detail: detail.length > 240 ? `${detail.slice(0, 237)}...` : detail, exceptable: !NON_EXCEPTABLE.has(code) });
  }

  private budget(bytes: number, at: string): boolean {
    this.decoded += bytes;
    if (this.decoded > MAX_DECODED_BYTES) {
      this.add("decode-limit-exceeded", at, `Decoded content exceeds the ${MAX_DECODED_BYTES}-byte audit budget.`);
      return false;
    }
    return true;
  }

  /** Scan text for locators, nested data: URIs and packed gzip/deflate slots. */
  scanText(text: string, at: string, depth: number): void {
    if (!this.budget(text.length, at)) return;
    for (const match of text.matchAll(LOCATOR)) {
      const value = match[0].replace(/[),.;:]+$/u, "");
      if (ALLOWED_LITERAL_URLS.includes(value)) continue;
      this.add("external-locator", at, value);
    }
    for (const match of text.matchAll(PROTOCOL_RELATIVE)) this.add("external-locator", at, match[1]!);
    if (depth >= MAX_DECODE_DEPTH) return;
    // A URL hidden behind one percent-encoding layer is still a URL.
    if (/%(?:3A|2F)/iu.test(text)) {
      const once = utf8(percentDecode(text));
      if (once !== undefined && once !== text) {
        for (const match of once.matchAll(LOCATOR)) {
          const value = match[0].replace(/[),.;:]+$/u, "");
          if (!ALLOWED_LITERAL_URLS.includes(value)) this.add("external-locator", at, value);
        }
      }
    }
    for (const match of text.matchAll(NESTED_DATA_URI)) {
      if (match.index === 0 && match[0].length === text.length) continue;
      this.dataUri(match[0], `${at}>data:`, depth + 1);
    }
    for (const match of text.matchAll(COMPRESSED_BASE64)) {
      const packed = new Uint8Array(Buffer.from(match[0], "base64"));
      const unpacked = this.inflate(packed);
      if (unpacked !== undefined) this.bytes(unpacked, "application/octet-stream", `${at}>packed`, depth + 1);
    }
  }

  private inflate(bytes: Uint8Array): Uint8Array | undefined {
    const options = { maxOutputLength: 32 * 1024 * 1024 };
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const isZlib = bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1]!);
    for (const unpack of isGzip ? [gunzipSync] : isZlib ? [inflateSync] : []) {
      try {
        return new Uint8Array(unpack(bytes, options));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  /** Decoded resource bytes: unpack compression, then scan whatever text they hold. */
  bytes(bytes: Uint8Array, mediaType: string, at: string, depth: number, hints: readonly string[] = []): void {
    if (depth > MAX_DECODE_DEPTH) return;
    if (!this.budget(bytes.byteLength, at)) return;
    const unpacked = this.inflate(bytes) ?? (hints.some((hint) => /deflate/u.test(hint)) ? (() => {
      try {
        return new Uint8Array(inflateRawSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }));
      } catch {
        return undefined;
      }
    })() : undefined);
    if (unpacked !== undefined) {
      this.bytes(unpacked, mediaType, `${at}>unpacked`, depth + 1);
      return;
    }
    if (/^image\/(?:png|jpe?g|gif|webp|avif|bmp)$/u.test(mediaType)) return;
    const text = utf8(bytes);
    if (text === undefined) return;
    if (mediaType === "text/html" || /^\s*<!doctype html|^\s*<html[\s>]/iu.test(text)) this.html(text, at, depth);
    else this.scanText(text, at, depth);
  }

  dataUri(value: string, at: string, depth: number): DataUri | undefined {
    const parsed = parseDataUri(value);
    if (parsed === undefined) {
      this.add("data-uri-invalid", at, `Undecodable data: URI (${value.slice(0, 48)}...).`);
      return undefined;
    }
    if (parsed.mediaType === "text/html" && parsed.base64) {
      this.add("html-base64-not-raw-percent", at, "Complete-HTML Base64 carriage; the KEEL standard is raw-percent data:text/html;charset=utf-8.");
    }
    this.bytes(parsed.bytes, parsed.mediaType, at, depth, parsed.params);
    return parsed;
  }

  html(text: string, at: string, depth: number): void {
    this.htmlDocuments += 1;
    const { prefix, suffix } = this.shell;
    const suffixAt = text.startsWith(prefix) ? text.indexOf(suffix, prefix.length) : -1;
    let creator = text;
    if (suffixAt >= 0) {
      // Exactly the registered shell: its pinned verifier code names protocols in prose, so only the creator
      // bytes around it are scanned. Anything else in the document is scanned in full.
      this.canonicalShells += 1;
      creator = text.slice(prefix.length, suffixAt) + text.slice(suffixAt + suffix.length);
    } else {
      this.add("viewer-not-canonical-shell", at, "HTML viewer is not the registered canonical KEEL verification shell (prefix/suffix bytes do not match @keel/sdk buildCompactInlineKeelShell).");
    }
    for (const match of creator.matchAll(RESOURCE_TAG)) {
      if (/^(?:https?|ipfs|ar|web3|keel-onchain):|^\/\//iu.test(match[1]!)) continue;
      this.add("viewer-relative-resource", at, `Resource tag loads ${match[1]!.slice(0, 80)} relative to whatever host serves the page.`);
    }
    this.scanText(creator, at, depth);
  }

  /** Walk metadata JSON: every string that is a data: URI is decoded; every other string is scanned. */
  json(value: unknown, at: string, depth: number): void {
    if (typeof value === "string") {
      if (/^data:/iu.test(value)) this.dataUri(value, at, depth + 1);
      else this.scanText(value, at, depth);
      return;
    }
    if (Array.isArray(value)) value.forEach((entry, index) => this.json(entry, `${at}[${index}]`, depth));
    else if (value !== null && typeof value === "object") for (const [key, entry] of Object.entries(value)) this.json(entry, `${at}.${key}`, depth);
  }
}

export interface TokenUriAnalysis {
  readonly findings: readonly AuditFinding[];
  readonly tokenUri: { readonly byteLength: number; readonly sha256: Hex; readonly encoding: string };
  readonly metadata?: { readonly keys: readonly string[]; readonly image?: string; readonly animation?: string; readonly htmlDocuments: number; readonly canonicalShells: number };
}

/** Pure offline audit of complete tokenURI text. */
export async function analyzeTokenUri(tokenUri: string): Promise<TokenUriAnalysis> {
  const walker = new AuditWalker(await canonicalShellFragments());
  const byteLength = Buffer.byteLength(tokenUri, "utf8");
  const summary = { byteLength, sha256: sha256(tokenUri) };
  if (byteLength > TOKEN_URI_MAX_BYTES) walker.add("token-uri-too-large", "$tokenURI", `${byteLength} bytes, above the ${TOKEN_URI_MAX_BYTES}-byte public-read ceiling.`);
  if (tokenUri.length === 0) {
    walker.add("token-uri-empty", "$tokenURI", "tokenURI returned an empty string.");
    return { findings: walker.findings, tokenUri: { ...summary, encoding: "empty" } };
  }
  if (!/^data:application\/json[;,]/iu.test(tokenUri)) {
    walker.add("token-uri-not-data-json", "$tokenURI", `tokenURI is not a data:application/json URI (${tokenUri.slice(0, 64)}).`);
    walker.scanText(tokenUri.slice(0, 4096), "$tokenURI", 0);
    return { findings: walker.findings, tokenUri: { ...summary, encoding: "external" } };
  }
  const parsed = parseDataUri(tokenUri);
  if (parsed === undefined) {
    walker.add("data-uri-invalid", "$tokenURI", "tokenURI data: URI cannot be decoded.");
    return { findings: walker.findings, tokenUri: { ...summary, encoding: "invalid" } };
  }
  const encoding = parsed.base64 ? "base64" : "raw-percent";
  if (parsed.base64) walker.add("metadata-base64", "$tokenURI", "Metadata JSON is Base64-wrapped; the KEEL Collector Inline default is raw-percent.", "warning");
  const unpacked = (() => {
    try {
      if (parsed.bytes[0] === 0x1f && parsed.bytes[1] === 0x8b) return new Uint8Array(gunzipSync(parsed.bytes, { maxOutputLength: 32 * 1024 * 1024 }));
    } catch {
      return undefined;
    }
    return parsed.bytes;
  })();
  const text = unpacked === undefined ? undefined : utf8(unpacked);
  let metadata: unknown;
  try {
    if (text === undefined) throw new Error("not UTF-8");
    metadata = JSON.parse(text);
  } catch (error) {
    walker.add("metadata-invalid-json", "$", `Metadata is not valid UTF-8 JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { findings: walker.findings, tokenUri: { ...summary, encoding } };
  }
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    walker.add("metadata-invalid-json", "$", "Metadata JSON must be an object.");
    return { findings: walker.findings, tokenUri: { ...summary, encoding } };
  }
  const record = metadata as Record<string, unknown>;
  const image = record.image;
  const imageData = record.image_data;
  if (typeof image !== "string" || image.length === 0) {
    if (typeof imageData !== "string" || !/<svg[\s>]/iu.test(imageData)) walker.add("image-missing", "$.image", "Metadata has no image.");
  } else if (!/^data:image\//iu.test(image)) {
    walker.add("image-not-onchain", "$.image", `image is not an onchain data:image URI (${image.slice(0, 96)}).`);
  } else {
    const decoded = parseDataUri(image);
    if (decoded === undefined || decoded.bytes.byteLength === 0) walker.add("image-not-onchain", "$.image", "image data: URI is empty or undecodable.");
  }
  walker.json(record, "$", 1);
  const animation = typeof record.animation_url === "string" ? record.animation_url.slice(0, 48) : undefined;
  return {
    findings: walker.findings,
    tokenUri: { ...summary, encoding },
    metadata: {
      keys: Object.keys(record),
      ...(typeof image === "string" ? { image: image.slice(0, 48) } : {}),
      ...(animation === undefined ? {} : { animation }),
      htmlDocuments: walker.htmlDocuments,
      canonicalShells: walker.canonicalShells,
    },
  };
}

// ─── live read ───────────────────────────────────────────────────────────────────────────────────────────────────

class RpcError extends Error {
  constructor(message: string, readonly rpcCode?: number) { super(message); }
}

async function rpc(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(60_000),
  });
  const reader = response.body?.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  if (reader !== undefined) {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RPC_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RpcError(`${method} response exceeds ${MAX_RPC_RESPONSE_BYTES} bytes.`);
      }
      parts.push(next.value);
    }
  }
  const text = Buffer.concat(parts).toString("utf8");
  let body: { readonly result?: unknown; readonly error?: { readonly message?: unknown; readonly code?: unknown } };
  try {
    body = JSON.parse(text) as typeof body;
  } catch {
    throw new RpcError(`${method} returned HTTP ${response.status} without JSON-RPC.`);
  }
  if (body.error !== undefined) throw new RpcError(`${method}: ${String(body.error.message ?? "error")}`, typeof body.error.code === "number" ? body.error.code : undefined);
  return body.result;
}

function decodeAbiString(returned: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(returned) || returned.length < 2 + 128) throw new TypeError("tokenURI returned no ABI-encoded string.");
  const bytes = Buffer.from(returned.slice(2), "hex");
  const offset = Number(BigInt(`0x${hex(bytes.subarray(0, 32))}`));
  if (offset + 32 > bytes.byteLength) throw new TypeError("tokenURI string offset is out of range.");
  const length = Number(BigInt(`0x${hex(bytes.subarray(offset, offset + 32))}`));
  if (offset + 32 + length > bytes.byteLength) throw new TypeError("tokenURI string length is out of range.");
  const text = utf8(bytes.subarray(offset + 32, offset + 32 + length));
  if (text === undefined) throw new TypeError("tokenURI string is not UTF-8.");
  return text;
}

function tokenUriCalldata(tokenId: bigint): Hex {
  return `0xc87b56dd${tokenId.toString(16).padStart(64, "0")}`;
}

export interface LiveRead {
  readonly tokenUri?: string;
  readonly chainId: number;
  readonly block: string;
  readonly gasLimit: number;
  readonly estimatedGas?: number;
  readonly estimateNote: string;
  readonly failure?: { readonly code: "read-failed" | "read-gas-exceeds-limit"; readonly detail: string };
}

/**
 * Read tokenURI exactly the way a marketplace must be able to: one eth_call capped at 30M gas at a pinned block.
 * eth_estimateGas is reported but never trusted as the gate -- some nodes truncate or under-report large returns.
 */
export async function readTokenUri(rpcUrl: string, contract: string, tokenId: bigint): Promise<LiveRead> {
  const chainId = Number(BigInt(String(await rpc(rpcUrl, "eth_chainId", []))));
  const block = String(await rpc(rpcUrl, "eth_blockNumber", []));
  const call = { to: contract, data: tokenUriCalldata(tokenId) };
  const estimateNote = "eth_estimateGas is advisory: nodes can silently truncate or undercount large string returns. The gate is the eth_call capped at 30,000,000 gas.";
  let estimatedGas: number | undefined;
  try {
    estimatedGas = Number(BigInt(String(await rpc(rpcUrl, "eth_estimateGas", [call, block]))));
  } catch {
    estimatedGas = undefined;
  }
  const base = { chainId, block, gasLimit: TOKEN_URI_READ_GAS_LIMIT, ...(estimatedGas === undefined ? {} : { estimatedGas }), estimateNote };
  let result: unknown;
  try {
    result = await rpc(rpcUrl, "eth_call", [{ ...call, gas: `0x${TOKEN_URI_READ_GAS_LIMIT.toString(16)}` }, block]);
  } catch (capped) {
    // Distinguish "needs more than 30M" from "reverts": retry at the node's own (higher) cap.
    try {
      await rpc(rpcUrl, "eth_call", [call, block]);
      return { ...base, failure: { code: "read-gas-exceeds-limit", detail: `tokenURI(${tokenId}) fails within ${TOKEN_URI_READ_GAS_LIMIT} gas but succeeds with the node's higher cap.` } };
    } catch {
      return { ...base, failure: { code: "read-failed", detail: `tokenURI(${tokenId}) eth_call failed: ${capped instanceof Error ? capped.message : String(capped)}` } };
    }
  }
  try {
    return { ...base, tokenUri: decodeAbiString(String(result)) };
  } catch (error) {
    return { ...base, failure: { code: "read-failed", detail: error instanceof Error ? error.message : String(error) } };
  }
}

// ─── audit tool ──────────────────────────────────────────────────────────────────────────────────────────────────

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`${label}.${key} is not supported.`);
}

function parseException(value: unknown): AuditException | undefined {
  if (value === undefined) return undefined;
  const input = plainObject(value, "exception");
  onlyKeys(input, ["codes", "reason", "reviewer", "signature"], "exception");
  const codes = input.codes;
  if (!Array.isArray(codes) || codes.length === 0 || codes.some((code) => typeof code !== "string")) throw new TypeError("exception.codes must list the exact finding codes being excepted.");
  if (typeof input.reason !== "string" || input.reason.trim().length < 20) throw new TypeError("exception.reason must explain the reviewed exception in at least 20 characters.");
  if (typeof input.reviewer !== "string" || input.reviewer.trim().length === 0) throw new TypeError("exception.reviewer must name who reviewed it (wallet address or person).");
  if (input.signature !== undefined && (typeof input.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/u.test(input.signature))) throw new TypeError("exception.signature must be a 65-byte hex signature.");
  return { codes: codes as AuditFindingCode[], reason: input.reason.trim(), reviewer: input.reviewer.trim(), ...(input.signature === undefined ? {} : { signature: input.signature as string }) };
}

export interface AuditRecordBody {
  readonly schema: typeof TOKEN_STANDARD_AUDIT_SCHEMA;
  readonly auditedAt: string;
  readonly expiresAt: string;
  readonly subject: { readonly kind: "contract"; readonly chainId: number; readonly contract: string; readonly tokenId: string; readonly block: string } | { readonly kind: "bytes"; readonly source: string };
  readonly verdict: "pass" | "pass-with-exception" | "fail";
  readonly tokenUri?: TokenUriAnalysis["tokenUri"];
  readonly findings: readonly AuditFinding[];
  readonly exception?: AuditException & { readonly declared: true; readonly signatureVerified: false };
}

/** Run the audit, persist the content-addressed record, and return the machine verdict. */
export async function recordTokenStandardAudit(
  workspace: Workspace,
  input: { readonly subject: AuditRecordBody["subject"]; readonly analysis?: TokenUriAnalysis; readonly readFinding?: AuditFinding; readonly exception?: AuditException; readonly read?: Omit<LiveRead, "tokenUri" | "failure"> },
  now = Date.now(),
) {
  const findings = [...(input.readFinding === undefined ? [] : [input.readFinding]), ...(input.analysis?.findings ?? [])];
  const errors = findings.filter((finding) => finding.severity === "error");
  const exception = input.exception;
  if (exception !== undefined) {
    const present = new Set(errors.map((finding) => finding.code));
    const notPresent = exception.codes.filter((code) => !present.has(code));
    if (notPresent.length) throw new TypeError(`exception names codes that were not found: ${notPresent.join(", ")}. An exception must name exactly the findings it waives.`);
    const locked = exception.codes.filter((code) => NON_EXCEPTABLE.has(code));
    if (locked.length) throw new TypeError(`These findings cannot be excepted: ${locked.join(", ")}.`);
  }
  const waived = new Set(exception?.codes ?? []);
  const remaining = errors.filter((finding) => !waived.has(finding.code));
  const verdict: AuditRecordBody["verdict"] = remaining.length ? "fail" : waived.size ? "pass-with-exception" : "pass";
  const body: AuditRecordBody = {
    schema: TOKEN_STANDARD_AUDIT_SCHEMA,
    auditedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EVIDENCE_TTL_MS).toISOString(),
    subject: input.subject,
    verdict,
    ...(input.analysis === undefined ? {} : { tokenUri: input.analysis.tokenUri }),
    findings,
    ...(exception === undefined ? {} : { exception: { ...exception, declared: true as const, signatureVerified: false as const } }),
  };
  const digest = sha256(canonicalJson(body));
  const recordPath = digestFile("audits", digest);
  await workspace.writeText(recordPath, `${JSON.stringify({ id: digest, body }, null, 2)}\n`);
  return {
    schema: TOKEN_STANDARD_AUDIT_SCHEMA,
    verdict,
    pass: verdict !== "fail",
    digest,
    recordPath,
    subject: body.subject,
    ...(input.read === undefined ? {} : { read: input.read }),
    ...(body.tokenUri === undefined ? {} : { tokenUri: body.tokenUri }),
    ...(input.analysis?.metadata === undefined ? {} : { metadata: input.analysis.metadata }),
    summary: {
      errors: errors.length,
      warnings: findings.length - errors.length,
      waived: errors.length - remaining.length,
      blocking: [...new Set(remaining.map((finding) => finding.code))],
    },
    findings,
    ...(body.exception === undefined ? {} : { exception: body.exception }),
    next: verdict === "fail"
      ? "Blocked. Fix every blocking finding (onchain data:image, registered canonical shell via keel-inline-prepare, raw-percent HTML, no external locators) and run keel-token-standard-audit again. A reviewed exception must be declared explicitly with codes, reason and reviewer."
      : "Pass this digest as standards.auditDigest (with standards.preflightReceipt) to the tool that prepares the wallet request.",
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  };
}

export async function tokenStandardAuditTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = plainObject(value, "keel-token-standard-audit arguments");
  onlyKeys(input, ["rpcUrl", "contract", "tokenId", "chainId", "tokenUri", "tokenUriPath", "exception"], "keel-token-standard-audit arguments");
  const exception = parseException(input.exception);
  const live = input.rpcUrl !== undefined || input.contract !== undefined || input.tokenId !== undefined;
  const offline = input.tokenUri !== undefined || input.tokenUriPath !== undefined;
  if (live === offline) throw new TypeError("Provide either rpcUrl + contract + tokenId (live read) or tokenUri / tokenUriPath (prepared bytes), not both.");
  if (live) {
    if (typeof input.rpcUrl !== "string" || !/^https?:\/\/[^\s]+$/u.test(input.rpcUrl) || input.rpcUrl.length > 2048) throw new TypeError("rpcUrl must be an http(s) JSON-RPC URL.");
    if (typeof input.contract !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(input.contract)) throw new TypeError("contract must be a 20-byte 0x address.");
    if (typeof input.tokenId !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(input.tokenId)) throw new TypeError("tokenId must be canonical unsigned decimal text.");
    const tokenId = BigInt(input.tokenId);
    if (tokenId >= 2n ** 256n) throw new TypeError("tokenId exceeds uint256.");
    const read = await readTokenUri(input.rpcUrl, input.contract, tokenId);
    if (input.chainId !== undefined && input.chainId !== read.chainId) throw new TypeError(`RPC reports chain ${read.chainId}, not the expected ${String(input.chainId)}.`);
    const { tokenUri, failure, ...readSummary } = read;
    const subject = { kind: "contract" as const, chainId: read.chainId, contract: input.contract.toLowerCase(), tokenId: input.tokenId, block: read.block };
    const readFinding: AuditFinding | undefined = failure === undefined ? undefined : { code: failure.code, severity: "error", at: "$read", detail: failure.detail, exceptable: false };
    const analysis = tokenUri === undefined ? undefined : await analyzeTokenUri(tokenUri);
    const estimateFinding: AuditFinding | undefined = read.estimatedGas !== undefined && read.estimatedGas > TOKEN_URI_READ_GAS_LIMIT
      ? { code: "read-gas-exceeds-limit", severity: "error", at: "$read", detail: `eth_estimateGas reports ${read.estimatedGas} gas, above ${TOKEN_URI_READ_GAS_LIMIT}.`, exceptable: false }
      : undefined;
    const blockingRead = readFinding ?? estimateFinding;
    return recordTokenStandardAudit(context.workspace, {
      subject,
      ...(analysis === undefined ? {} : { analysis }),
      ...(blockingRead === undefined ? {} : { readFinding: blockingRead }),
      ...(exception === undefined ? {} : { exception }),
      read: readSummary,
    });
  }
  let tokenUri: string;
  let source: string;
  if (input.tokenUriPath !== undefined) {
    if (typeof input.tokenUriPath !== "string") throw new TypeError("tokenUriPath must be a workspace path.");
    const loaded = await context.workspace.readFile(input.tokenUriPath, TOKEN_URI_MAX_BYTES * 4);
    const text = utf8(loaded.bytes);
    if (text === undefined) throw new TypeError("tokenUriPath must contain UTF-8 tokenURI text.");
    tokenUri = text.replace(/\r?\n$/u, "");
    source = `file:${input.tokenUriPath}`;
  } else {
    if (typeof input.tokenUri !== "string") throw new TypeError("tokenUri must be text.");
    tokenUri = input.tokenUri;
    source = "input";
  }
  const analysis = await analyzeTokenUri(tokenUri);
  return recordTokenStandardAudit(context.workspace, { subject: { kind: "bytes", source }, analysis, ...(exception === undefined ? {} : { exception }) });
}

// ─── the gate ────────────────────────────────────────────────────────────────────────────────────────────────────

export const WORK_KINDS = ["token-contract", "collection", "metadata", "viewer", "registry-or-module", "storage-only"] as const;
export type WorkKind = typeof WORK_KINDS[number];
const AUDITED_WORK: ReadonlySet<WorkKind> = new Set(["token-contract", "collection", "metadata"]);

export interface StandardsRequirement {
  /** The tool enforcing the gate (named in refusals). */
  readonly tool: string;
  /** Used when the caller does not declare standards.workKind. */
  readonly defaultWorkKind: WorkKind;
  /** Work kinds this tool accepts from the caller; a narrower list stops an agent declaring its way out. */
  readonly allowedWorkKinds?: readonly WorkKind[];
  /** True only when the tool itself proved every call is a KeelHold storage write. */
  readonly storageVerified?: boolean;
  /** Where the audit must point when it is a live-contract audit. */
  readonly auditChainId?: number;
  readonly auditContract?: string;
  /** Require a live-contract audit of exactly auditContract (for an existing token contract). */
  readonly requireContractAudit?: boolean;
  /** Set only where no audit exists for the family yet (Tezos); the receipt is still required and the gap is recorded. */
  readonly auditUnavailable?: string;
}

export interface StandardsClearance {
  readonly schema: typeof STANDARDS_CLEARANCE_SCHEMA;
  readonly tool: string;
  readonly workKind: WorkKind;
  readonly preflightReceipt?: Awaited<ReturnType<typeof verifyPreflightReceipt>>;
  readonly audit?: { readonly digest: string; readonly verdict: string; readonly subject: unknown; readonly auditedAt: string; readonly exception?: unknown } | { readonly status: "not-available"; readonly reason: string };
  readonly storageOnly?: true;
}

/**
 * The hard gate. Returns a clearance record to embed in the tool's result, or throws StandardsRefusal naming the
 * exact next tool. Storage-only work passes without evidence only when the calling tool verified it.
 */
export async function enforceStandards(context: ToolContext, raw: unknown, requirement: StandardsRequirement, now = Date.now()): Promise<StandardsClearance> {
  const { tool } = requirement;
  const evidence = raw === undefined ? {} : plainObject(raw, "standards");
  onlyKeys(evidence, ["preflightReceipt", "auditDigest", "workKind"], "standards");
  const declared = evidence.workKind;
  if (declared !== undefined && (typeof declared !== "string" || !(WORK_KINDS as readonly string[]).includes(declared))) throw new TypeError(`standards.workKind must be one of ${WORK_KINDS.join(", ")}.`);
  const workKind = (declared as WorkKind | undefined) ?? requirement.defaultWorkKind;
  if (requirement.allowedWorkKinds !== undefined && !requirement.allowedWorkKinds.includes(workKind)) {
    throw new TypeError(`${tool} does not accept standards.workKind ${workKind}; use one of ${requirement.allowedWorkKinds.join(", ")}.`);
  }
  if (workKind === "storage-only") {
    if (requirement.storageVerified === true) return { schema: STANDARDS_CLEARANCE_SCHEMA, tool, workKind, storageOnly: true };
    throw new StandardsRefusal(tool, "storage-only-not-verified", "standards.workKind is storage-only but these calls are not KeelHold storage writes.", "keel-contract-workflow-preflight", "Declare the real workKind and supply its receipt (and an audit digest when a token is involved).");
  }
  if (raw === undefined) {
    throw new StandardsRefusal(tool, "standards-evidence-required", `This request is ${workKind} work and carries no standards evidence.`, "keel-contract-workflow-preflight", "Then follow the workflow and pass standards: { preflightReceipt, auditDigest }.");
  }
  const preflightReceipt = await verifyPreflightReceipt(context, tool, evidence.preflightReceipt, now);
  if (!AUDITED_WORK.has(workKind) && !requirement.requireContractAudit) {
    return { schema: STANDARDS_CLEARANCE_SCHEMA, tool, workKind, preflightReceipt };
  }
  if (requirement.auditUnavailable !== undefined) {
    return { schema: STANDARDS_CLEARANCE_SCHEMA, tool, workKind, preflightReceipt, audit: { status: "not-available", reason: requirement.auditUnavailable } };
  }
  const audit = "keel-token-standard-audit";
  const digest = evidence.auditDigest;
  if (digest === undefined) throw new StandardsRefusal(tool, "token-standard-audit-required", `${workKind} work needs a passing token standard audit.`, audit, "Audit the live contract (rpcUrl + contract + tokenId) or the prepared tokenURI bytes, then pass its digest as standards.auditDigest.");
  if (typeof digest !== "string" || !DIGEST.test(digest)) throw new StandardsRefusal(tool, "token-standard-audit-invalid", "standards.auditDigest must be the 0x-prefixed 64-hex digest.", audit, "Use the digest it returns verbatim.");
  const record = await readRecord(context.workspace, "audits", digest);
  if (record === undefined || record.body.schema !== TOKEN_STANDARD_AUDIT_SCHEMA) throw new StandardsRefusal(tool, "token-standard-audit-invalid", "No intact audit record with that digest exists in this workspace's evidence store.", audit, "Run the audit in this workspace.");
  const body = record.body as unknown as AuditRecordBody;
  if (body.verdict === "fail") {
    const blocking = [...new Set(body.findings.filter((finding) => finding.severity === "error").map((finding) => finding.code))];
    throw new StandardsRefusal(tool, "token-standard-audit-failed", `The audit failed: ${blocking.join(", ")}.`, audit, "Fix the findings and audit again; a waiver must be an explicit reviewed exception.");
  }
  if (Date.parse(body.expiresAt) <= now) throw new StandardsRefusal(tool, "token-standard-audit-expired", `The audit expired at ${body.expiresAt}.`, audit, "Audit again.");
  const subject = body.subject;
  if (requirement.requireContractAudit) {
    if (subject.kind !== "contract" || subject.contract !== requirement.auditContract?.toLowerCase() || (requirement.auditChainId !== undefined && subject.chainId !== requirement.auditChainId)) {
      throw new StandardsRefusal(tool, "token-standard-audit-subject-mismatch", `This request targets ${requirement.auditContract ?? "a token contract"} on chain ${requirement.auditChainId ?? "?"}; the audit covers ${subject.kind === "contract" ? `${subject.contract} on chain ${subject.chainId}` : "prepared bytes"}.`, audit, "Audit the live token contract this request targets.");
    }
  } else if (subject.kind === "contract" && requirement.auditChainId !== undefined && subject.chainId !== requirement.auditChainId) {
    throw new StandardsRefusal(tool, "token-standard-audit-subject-mismatch", `The audit read chain ${subject.chainId}; this request is for chain ${requirement.auditChainId}.`, audit, "Audit on the selected chain.");
  }
  return {
    schema: STANDARDS_CLEARANCE_SCHEMA,
    tool,
    workKind,
    preflightReceipt,
    audit: { digest, verdict: body.verdict, subject, auditedAt: body.auditedAt, ...(body.exception === undefined ? {} : { exception: body.exception }) },
  };
}
