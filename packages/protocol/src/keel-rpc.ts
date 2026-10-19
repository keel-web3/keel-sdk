/**
 * The Keel RPC module: one way to read a chain, for every chain Keel
 * preserves onto.
 *
 * ## Why this exists
 *
 * A Keel viewer document can get the artwork it renders two ways. It can
 * *carry* it — the document is a KeelHold composite whose parts include the
 * artwork object, so rendering it and verifying it are the same act and nothing
 * is fetched. Or it can *read* it — a ~30KB document that pulls the bytes at
 * render time. Carrying is stronger and this protocol prefers it, but a
 * quarter-megabyte artwork carried inline is a quarter-megabyte `animation_url`
 * that every marketplace, wallet, and indexer has to move before anything
 * appears, and past a point a node's `eth_call` response cap simply refuses.
 * Reading keeps the document small and the token renderable.
 *
 * The old way to read was a content host: an IPFS or HTTPS mirror named in the
 * token's metadata. This module is the other way — the bytes come back off the
 * same ledger that proved them, over `eth_call` on Ethereum and a script view
 * on Tezos, and no content host is in the path at all.
 *
 * ## What it looks like to use
 *
 * The transport is deliberately invisible at the call site. A script inside a
 * viewer asks for an object the way it would ask a contract, and the JSON-RPC
 * envelope, the endpoint failover, and the ABI or Michelson decoding all happen
 * underneath:
 *
 *     const chain = createKeelRpcClient({ family: "ethereum", chainId: 1, endpoints });
 *     const artwork = await chain.haulObject(keelHold, assetObjectId);
 *
 *     const chain = createKeelRpcClient({ family: "tezos", network: "NetXdQprcVkpaWU", endpoints });
 *     const artwork = await chain.haulObject(kt1Store, assetObjectId);
 *
 * Same call, same return, different chain. That is the point: a viewer written
 * against this reads on-chain objects without knowing or caring which family it
 * landed on.
 *
 * ## What it does not hide
 *
 * It hides the plumbing from whoever writes the viewer. It does not hide the
 * dependency from whoever reads the token, and the two must not be confused. A
 * document that reads through a host has a host in its trust path, and
 * `disclosure()` exists so the verification chrome can say so plainly. Masking
 * that would make this worse than the mirror it replaces, not better — a viewer
 * that claims "no external dependencies" while holding an open socket is
 * exactly the lie this protocol is meant to be the opposite of.
 *
 * What the reader still gets, and what a mirror never gave them:
 *   - the bytes are content-addressed, so `haulObjectVerified` can prove the
 *     node returned the object that was asked for and not another one;
 *   - the endpoint is governed rather than ad hoc — see `keel-rpc-policy`;
 *   - more than one endpoint can be supplied, and a node that lies or dies is
 *     simply the next one's turn.
 */

import { verifyIntegrity } from "./integrity.js";
import type { Integrity } from "./types.js";
import {
  assertKeelRpcUrl,
  redactRpcUrl,
  KEEL_DEFAULT_RPC_HOSTS,
  type KeelRpcHostList,
} from "./keel-rpc-policy.js";

export type KeelRpcFamily = "ethereum" | "tezos";

/** `KeelHold.haulObject(bytes32)`. Verified against the live KeelHold interface. */
export const KEEL_READ_OBJECT_SELECTOR = "0xed12d693" as const;
/** `KeelHold.getObject(bytes32)`. */
export const KEEL_GET_OBJECT_SELECTOR = "0x05144857" as const;
/** The Tezos on-chain view every Keel store exposes. */
export const KEEL_TEZOS_OBJECT_VIEW = "haul_object" as const;

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Tenderbake finalises at two blocks; deeper only adds margin. */
const DEFAULT_TEZOS_CONFIRMATIONS = 2;

export class KeelRpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly endpoint?: string,
    readonly terminal = false,
  ) {
    super(message);
    this.name = "KeelRpcError";
  }
}

function terminalRpcFailure(value: unknown): "rpc.execution-reverted" | "transport.access-denied" | undefined {
  const work: unknown[] = [value];
  for (let count = 0; work.length && count < 32; count++) {
    const node = work.shift(); if (!node || typeof node !== "object") continue;
    const e = node as Record<string, unknown>, message = typeof e.message === "string" ? e.message.slice(0, 2048) : "";
    if (e.code === 3 || /\brevert(?:ed|ing)?\b/iu.test(message)) return "rpc.execution-reverted";
    if (e.code === 401 || e.code === 403 || e.status === 401 || e.status === 403 || e.httpStatus === 401 || e.httpStatus === 403 || /^(?:unauthori[sz]ed|forbidden|access denied)\b/iu.test(message)) return "transport.access-denied";
    for (const key of ["cause", "error", "data"]) { const child = e[key]; if (Array.isArray(child)) work.push(...child.slice(0, 8)); else if (child && typeof child === "object") work.push(child); }
  }
  return undefined;
}

function isCapacityRpcError(value: unknown, requestId: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>, error = body.error as Record<string, unknown> | null;
  if (body.jsonrpc !== "2.0" || body.id !== requestId || !Object.keys(body).every(key => ["jsonrpc", "id", "error"].includes(key))
    || !error || typeof error !== "object" || Array.isArray(error) || ![-32005, 429].includes(error.code as number)
    || typeof error.message !== "string" || error.message.length > 2048
    || !Object.keys(error).every(key => ["code", "message", "data"].includes(key))
    || error.data !== null && typeof error.data === "object") return false;
  if (typeof error.data === "string" && (error.data.length > 4096 || terminalRpcFailure({ message: error.data }))) return false;
  return terminalRpcFailure(error) === undefined;
}

function isUnsupportedPinnedRpcError(value: unknown, requestId: unknown, method?: string, params?: readonly unknown[]): boolean {
  if (!["eth_call", "eth_getCode"].includes(method ?? "") || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>, error = body.error as Record<string, unknown> | null, selector = params?.[1] as Record<string, unknown> | null;
  return body.jsonrpc === "2.0" && body.id === requestId && Object.keys(body).every(key => ["jsonrpc", "id", "error"].includes(key))
    && !!error && typeof error === "object" && !Array.isArray(error) && error.code === -32602 && typeof error.message === "string" && error.message.length <= 2048
    && Object.keys(error).every(key => ["code", "message"].includes(key)) && terminalRpcFailure(error) === undefined
    && !!selector && typeof selector === "object" && !Array.isArray(selector) && selector.requireCanonical === true
    && typeof selector.blockHash === "string" && /^0x[0-9a-f]{64}$/iu.test(selector.blockHash)
    && Object.keys(selector).every(key => ["blockHash", "requireCanonical"].includes(key));
}

/** A fully read error body may be a transport message, never a partial RPC envelope. */
function httpErrorFailure(text: string, contentType: string, requestId: unknown, method?: string, params?: readonly unknown[]): string | undefined {
  const sample = text.trim();
  if (/json/iu.test(contentType) || /^[\[{]/u.test(sample)) {
    let body: Record<string, unknown>;
    try { body = JSON.parse(sample) as Record<string, unknown>; } catch { return "transport.unclassified-http-error"; }
    const reason = terminalRpcFailure(body);
    if (reason) return reason;
    if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== requestId) return "transport.unclassified-http-error";
    if (!Object.hasOwn(body, "error") && Object.hasOwn(body, "result")) return undefined;
    // Recognized capacity errors remain retryable. Arbitrary structured errors
    // can be contract failures even without the conventional code/message.
    if (isCapacityRpcError(body, requestId) || isUnsupportedPinnedRpcError(body, requestId, method, params)) return undefined;
    return "transport.unclassified-http-error";
  }
  if (/\b(?:unauthori[sz]ed|forbidden|access denied)\b/iu.test(sample)) return "transport.access-denied";
  if (/\b(?:revert(?:ed|ing)?|execution failed)\b/iu.test(sample)) return "rpc.execution-reverted";
  return undefined; // Complete bounded plain-text HTTP transport failure.
}

export interface KeelRpcClientOptions {
  readonly family: KeelRpcFamily;
  /** Tried in order; the first that answers wins. */
  readonly endpoints: readonly string[];
  /** EVM chain id, for disclosure and for callers that pin one. */
  readonly chainId?: number;
  /** Tezos chain id (`NetXdQprcVkpaWU`), for disclosure and endpoint checks. */
  readonly network?: string;
  /** Check the expected EVM chain on every endpoint, including failover. */
  readonly verifyChainId?: boolean;
  /**
   * The governed host list. Defaults to the built-in genesis list; pass the
   * deployment's own list (read from `KeelManager.rpcHostList`) to hold
   * endpoints to what governance actually blessed.
   */
  readonly hostList?: KeelRpcHostList | readonly string[];
  /** Local chains only. See `keelRpcUrlAllowed`. */
  readonly allowPrivateNetworkHosts?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxConcurrentReads?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly maxResponseBytes?: number;
  /** Tezos read depth. Ignored on Ethereum. */
  readonly confirmations?: number;
  readonly signal?: AbortSignal;
}

/** What the verification chrome shows about how these bytes were obtained. */
export interface KeelRpcDisclosure {
  readonly family: KeelRpcFamily;
  readonly chain: string;
  /** Origins only — an endpoint URL routinely carries an API key in its path. */
  readonly endpoints: readonly string[];
  /** The endpoint that actually answered, if one has. */
  readonly servedBy?: string;
  readonly hostListRevision?: number;
  readonly hostListEpoch?: number;
  readonly hostListStale?: boolean;
  readonly reads: number;
  /** Includes chain checks, retries and failed physical requests. */
  readonly physicalRequests: number;
}

export interface KeelEthCall {
  readonly to: string;
  readonly data: string;
  /** `"latest"`, a block number, or an EIP-1898 hash selector. */
  readonly block?: string | { readonly blockHash: string; readonly requireCanonical: true };
}

export interface KeelTezosView {
  readonly contract: string;
  readonly view?: string;
  readonly input: unknown;
  readonly block?: string;
}

export interface KeelRpcSnapshot {
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly timestamp: string;
}

export interface KeelRpcClient {
  readonly family: KeelRpcFamily;
  /** An arbitrary read. Ethereum only; throws on a Tezos client. */
  call(request: KeelEthCall): Promise<string>;
  /** Read deployed EVM code at the same pinned snapshot as contract calls. */
  getCode(address: string, block?: KeelEthCall["block"]): Promise<string>;
  /** An EVM block snapshot for consistent EIP-1898 reads. No signing methods. */
  snapshot(): Promise<KeelRpcSnapshot>;
  /** An arbitrary on-chain view. Tezos only; throws on an Ethereum client. */
  view(request: KeelTezosView): Promise<unknown>;
  /** The bytes of one Keel object, whichever family holds it. */
  haulObject(store: string, objectId: string): Promise<Uint8Array>;
  /**
   * The same read, refused unless the bytes hash to what was asked for. This is
   * what makes reading through a host acceptable rather than merely convenient.
   */
  haulObjectVerified(store: string, objectId: string, integrity: Integrity): Promise<Uint8Array>;
  disclosure(): KeelRpcDisclosure;
}

function hostsOf(hostList: KeelRpcClientOptions["hostList"]): readonly string[] {
  if (hostList === undefined) return KEEL_DEFAULT_RPC_HOSTS;
  return Array.isArray(hostList) ? hostList : (hostList as KeelRpcHostList).hosts;
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || /[^0-9a-fA-F]/u.test(body)) {
    throw new KeelRpcError("Response is not hex.", "decode.hex");
  }
  const out = new Uint8Array(body.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(body.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

/**
 * Decode an ABI `bytes` return: an offset word, a length word, then the data.
 * The length is checked against what actually arrived, so a truncated or
 * over-long response is an error rather than a silently short artwork.
 */
export function decodeAbiBytes(result: string, maxBytes: number): Uint8Array {
  const body = result.startsWith("0x") ? result.slice(2) : result;
  if (body.length < 128) throw new KeelRpcError("Response is too short to be ABI bytes.", "decode.abi");
  const length = Number.parseInt(body.slice(64, 128), 16);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new KeelRpcError("Response declares an unusable length.", "decode.abi");
  }
  if (length > maxBytes) {
    throw new KeelRpcError(`Object is ${length} bytes; the limit is ${maxBytes}.`, "limit.response-bytes");
  }
  const data = body.slice(128, 128 + length * 2);
  if (data.length !== length * 2) {
    throw new KeelRpcError("Response is shorter than the length it declares.", "decode.abi");
  }
  return hexToBytes(data);
}

/** Unwrap `bytes`, or an `option bytes`, out of a Michelson view result. */
export function decodeMichelsonBytes(expression: unknown): string | null {
  if (expression !== null && typeof expression === "object") {
    const node = expression as { bytes?: unknown; prim?: unknown; args?: unknown };
    if (typeof node.bytes === "string") return node.bytes.toLowerCase();
    if (node.prim === "Some" && Array.isArray(node.args) && node.args.length === 1) {
      return decodeMichelsonBytes(node.args[0]);
    }
    if (node.prim === "None") return null;
  }
  throw new KeelRpcError("Unexpected Michelson view result.", "decode.michelson");
}

function normalizedObjectId(objectId: string): string {
  const body = objectId.startsWith("0x") ? objectId.slice(2) : objectId;
  if (!/^[0-9a-fA-F]{64}$/u.test(body)) throw new KeelRpcError("objectId must be 32 bytes.", "request.objectId");
  return body.toLowerCase();
}

export function createKeelRpcClient(options: KeelRpcClientOptions): KeelRpcClient {
  const { family } = options;
  if (options.verifyChainId && (family !== "ethereum" || !Number.isSafeInteger(options.chainId) || options.chainId! <= 0)) {
    throw new TypeError("Chain checking requires an expected EVM chainId.");
  }
  if (family !== "ethereum" && family !== "tezos") {
    throw new TypeError(`Unsupported RPC family ${String(family)}.`);
  }
  if (options.endpoints.length === 0) throw new RangeError("At least one RPC endpoint is required.");

  const hosts = hostsOf(options.hostList);
  const policy = { allowPrivateNetworkHosts: options.allowPrivateNetworkHosts ?? false };
  // Every endpoint is checked once, here. A client that exists is a client whose
  // endpoints governance blessed, so no call site has to remember to check.
  const endpoints = options.endpoints.map((endpoint) =>
    assertKeelRpcUrl(endpoint, hosts, policy).replace(/\/+$/u, ""),
  );

  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const confirmations = options.confirmations ?? DEFAULT_TEZOS_CONFIRMATIONS;
  const list = options.hostList === undefined || Array.isArray(options.hostList)
    ? undefined
    : (options.hostList as KeelRpcHostList);

  const maximum = options.maxConcurrentReads ?? 4, retries = options.maxRetries ?? 0, retryDelay = options.retryDelayMs ?? 250;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64 || !Number.isSafeInteger(retries) || retries < 0 || retries > 3 || !Number.isSafeInteger(retryDelay) || retryDelay < 1 || retryDelay > 5000) throw new TypeError("Invalid bounded RPC window/retry policy.");
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || !Number.isSafeInteger(maxResponseBytes * 2 + 1024) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("Invalid RPC response/deadline bounds.");
  let terminal: KeelRpcError | undefined, active = 0, abandoned = 0;
  type Pending = { readonly run: () => void; readonly reject: (error: unknown) => void; next: Pending | undefined };
  let first: Pending | undefined, lastPending: Pending | undefined;
  function drain(): void {
    while (first && (terminal || options.signal?.aborted || active < maximum || abandoned > 0 && active >= maximum)) {
      const item = first; first = item.next; if (!first) lastPending = undefined;
      if (terminal || options.signal?.aborted || abandoned > 0 && active >= maximum) item.reject(terminal ?? new KeelRpcError("RPC request aborted or waiting for a timed-out physical read to settle.", options.signal?.aborted ? "transport.aborted" : "transport.timeout")); else item.run();
    }
  }
  options.signal?.addEventListener("abort", drain, { once: true });
  const checkedChains = new Map<string, Promise<void>>();
  let servedBy: string | undefined;
  let reads = 0, physicalRequests = 0;

  async function attempt<T>(run: (endpoint: string) => Promise<T>): Promise<T> {
    if (terminal) throw terminal;
    let last: unknown;
    for (const endpoint of endpoints) {
      for (let retry = 0; ; retry++) {
        try {
          if (terminal) throw terminal;
          if (options.verifyChainId) await checkChain(endpoint);
          const value = await run(endpoint); servedBy = endpoint; reads += 1; return value;
        } catch (error) {
          last = error;
          if (terminal || options.signal?.aborted) throw terminal ?? error;
          const transient = error as { retryable?: boolean; retryAfterMs?: number; code?: string; noFallback?: boolean };
          if (transient.noFallback) throw error;
          if (retry >= retries || !(transient.retryable || transient.code === "transport.timeout")) break;
          const delay = Math.max(transient.retryAfterMs ?? 0, retryDelay * 2 ** retry);
          if (delay > 5000) throw error; // Respect a longer Retry-After; caller can resume later.
          await new Promise<void>((resolve, reject) => {
            const abort = () => { clearTimeout(timer); reject(new KeelRpcError("RPC request aborted.", "transport.aborted")); };
            const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, delay);
            options.signal?.addEventListener("abort", abort, { once: true });
          });
        }
      }
    }
    throw last instanceof Error ? last : new KeelRpcError("Every RPC endpoint failed.", "transport.exhausted");
  }

  function request(endpoint: string, path: string, body?: unknown): Promise<unknown> {
    if (terminal || options.signal?.aborted) return Promise.reject(terminal ?? new KeelRpcError("RPC request aborted.", "transport.aborted"));
    if (abandoned && active >= maximum) return Promise.reject(Object.assign(new KeelRpcError("RPC timed-out physical window is occupied; resume after it settles.", "transport.timeout"), { noFallback: true }));
    return new Promise((resolve, reject) => {
      const run = () => {
        active++; let timedOut = false; const state = { errorBodyPending: false };
        const timer = setTimeout(() => { timedOut = true; abandoned++; if (state.errorBodyPending) { terminal = new KeelRpcError("RPC HTTP error body could not be completely classified.", "transport.unclassified-http-error", redactRpcUrl(endpoint), true); reject(terminal); } else reject(Object.assign(new KeelRpcError("RPC request timed out.", "transport.timeout", redactRpcUrl(endpoint)), { noFallback: active >= maximum })); drain(); }, timeoutMs + 5);
        void requestPhysical(endpoint, path, body, state).then(resolve, reject).finally(() => { clearTimeout(timer); if (timedOut) abandoned--; active--; drain(); });
      };
      if (active < maximum && !first) run(); else { const item: Pending = { run, reject, next: undefined }; if (lastPending) lastPending.next = item; else first = item; lastPending = item; }
    });
  }

  async function requestPhysical(endpoint: string, path: string, body: unknown, state: { errorBodyPending: boolean }): Promise<unknown> {
    if (options.signal?.aborted) throw new KeelRpcError("RPC request aborted.", "transport.aborted");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      physicalRequests++;
      const response = await doFetch(`${endpoint}${path}`, {
        ...(body === undefined
          ? { method: "GET" }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        const denied = response.status === 401 || response.status === 403;
        state.errorBodyPending = !denied;
        const unclassified = (): KeelRpcError => { terminal = new KeelRpcError("RPC HTTP error body could not be completely classified.", "transport.unclassified-http-error", redactRpcUrl(endpoint), true); drain(); return terminal; };
        if (!denied && response.body) {
          const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
          try {
            for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65536) throw unclassified(); chunks.push(next.value); }
            const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
            const rpc = body as { id?: unknown; method?: string; params?: readonly unknown[] } | undefined;
            const reason = httpErrorFailure(new TextDecoder("utf-8", { fatal: true }).decode(bytes), response.headers.get("content-type") ?? "", rpc?.id, rpc?.method, rpc?.params);
            if (reason) { terminal = new KeelRpcError("The exact RPC error cannot be treated as transport success.", reason, redactRpcUrl(endpoint), true); drain(); throw terminal; }
            state.errorBodyPending = false;
          } catch (error) { if (error instanceof KeelRpcError && error.terminal) throw error; throw unclassified(); }
          finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        }
        if (!denied && !response.body) {
          if (httpErrorFailure("", response.headers.get("content-type") ?? "", (body as { id?: unknown } | undefined)?.id)) throw unclassified();
          state.errorBodyPending = false;
        }
        const error = new KeelRpcError(`HTTP ${response.status} from ${redactRpcUrl(endpoint)}.`, denied ? "transport.access-denied" : "transport.http", redactRpcUrl(endpoint), denied);
        if (denied) { terminal = error; drain(); }
        const after = response.headers.get("retry-after");
        const retryAfterMs = after && /^\d+(?:\.\d+)?$/u.test(after) ? Number(after) * 1000 : after ? Math.max(0, Date.parse(after) - Date.now()) : 0;
        await response.body?.cancel().catch(() => undefined);
        throw Object.assign(error, { retryable: [429, 502, 503, 504].includes(response.status), retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0 });
      }
      // Enforce the cap while reading, before allocating an unbounded string.
      // ABI hex has two ASCII characters per byte plus its JSON envelope.
      const reader = response.body?.getReader();
      if (!reader) throw new KeelRpcError("RPC response has no body.", "rpc.empty");
      const decoder = new TextDecoder("utf-8", {fatal: true});
      const chunks: string[] = []; let size = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxResponseBytes * 2 + 1024) {
            throw new KeelRpcError("RPC response exceeds the configured limit.", "limit.response-bytes");
          }
          chunks.push(decoder.decode(value, {stream: true}));
        }
        chunks.push(decoder.decode());
        return JSON.parse(chunks.join("")) as unknown;
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (error) {
      const reason = terminalRpcFailure(error);
      if (reason && !options.signal?.aborted) { terminal = new KeelRpcError("The exact RPC operation was denied or reverted.", reason, redactRpcUrl(endpoint), true); drain(); throw terminal; }
      if (state.errorBodyPending && !options.signal?.aborted && !(error instanceof KeelRpcError && error.terminal)) { terminal = new KeelRpcError("RPC HTTP error body could not be completely classified.", "transport.unclassified-http-error", redactRpcUrl(endpoint), true); drain(); throw terminal; }
      if (error instanceof KeelRpcError) throw error;
      if (options.signal?.aborted) throw new KeelRpcError("RPC request aborted.", "transport.aborted");
      throw new KeelRpcError("RPC request failed.", controller.signal.aborted ? "transport.timeout" : "transport.failed", redactRpcUrl(endpoint));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function jsonRpcResult(endpoint: string, method: string, params: readonly unknown[]): Promise<unknown> {
    // Qualify only the fields actually serialized on the wire, not inherited or
    // subsequently mutated caller properties used by a selector exception.
    params = JSON.parse(JSON.stringify(params)) as readonly unknown[];
    const body = (await request(endpoint, "", { jsonrpc: "2.0", id: 1, method, params })) as {
      jsonrpc?: string; id?: unknown; result?: unknown; error?: { message?: string; code?: number };
    };
    const reason = terminalRpcFailure(body?.error);
    if (reason) { terminal = new KeelRpcError("The exact RPC operation was denied or reverted.", reason, redactRpcUrl(endpoint), true); drain(); throw terminal; }
    if (body?.error !== undefined && body.error !== null) {
      if (isCapacityRpcError(body, 1)) throw Object.assign(new KeelRpcError("RPC provider capacity is unavailable.", "rpc.rate-limited", redactRpcUrl(endpoint)), { retryable: true });
      if (isUnsupportedPinnedRpcError(body, 1, method, params)) throw new KeelRpcError("RPC provider rejected the exact canonical block selector.", "rpc.unsupported-block-selector", redactRpcUrl(endpoint));
      terminal = new KeelRpcError("The exact RPC error cannot be classified as a provider capacity failure.", "rpc.unclassified-error", redactRpcUrl(endpoint), true); drain(); throw terminal;
    }
    if (body?.jsonrpc !== "2.0" || body.id !== 1 || body.error !== undefined || !Object.hasOwn(body, "result")) {
      throw new KeelRpcError(`${method} returned an invalid response.`, "rpc.error", redactRpcUrl(endpoint));
    }
    return body.result;
  }

  async function jsonRpc(endpoint: string, method: string, params: readonly unknown[]): Promise<string> {
    const result = await jsonRpcResult(endpoint, method, params);
    if (typeof result !== "string") throw new KeelRpcError(`${method} returned no result.`, "rpc.empty", redactRpcUrl(endpoint));
    return result;
  }

  function checkChain(endpoint: string): Promise<void> {
    let pending = checkedChains.get(endpoint);
    if (pending === undefined) {
      pending = jsonRpc(endpoint, "eth_chainId", []).then(value => {
        if (!/^0x[0-9a-f]+$/iu.test(value) || BigInt(value) !== BigInt(options.chainId!)) {
          throw new KeelRpcError("RPC returned a different chain.", "chain.mismatch", redactRpcUrl(endpoint));
        }
      });
      checkedChains.set(endpoint, pending);
      void pending.catch(() => { if (checkedChains.get(endpoint) === pending) checkedChains.delete(endpoint); });
    }
    return pending;
  }

  function requireFamily(expected: KeelRpcFamily, method: string): void {
    if (family !== expected) {
      throw new KeelRpcError(`${method} is a ${expected} read; this client is ${family}.`, "family.mismatch");
    }
  }

  const client: KeelRpcClient = {
    family,

    async call(callRequest: KeelEthCall): Promise<string> {
      requireFamily("ethereum", "call");
      const block = callRequest.block ?? "latest";
      return attempt((endpoint) =>
        jsonRpc(endpoint, "eth_call", [{ to: callRequest.to, data: callRequest.data }, block]),
      );
    },

    async getCode(address: string, block: KeelEthCall["block"] = "latest"): Promise<string> {
      requireFamily("ethereum", "getCode");
      if (!/^0x[0-9a-f]{40}$/iu.test(address)) throw new TypeError("Invalid code address.");
      return attempt(async endpoint => {
        const result = await jsonRpc(endpoint, "eth_getCode", [address, block]);
        if (!/^0x(?:[0-9a-f]{2})*$/iu.test(result)) throw new KeelRpcError("RPC returned invalid code.", "decode.hex");
        return result;
      });
    },

    async snapshot(): Promise<KeelRpcSnapshot> {
      requireFamily("ethereum", "snapshot");
      if (!Number.isSafeInteger(options.chainId) || options.chainId! <= 0) throw new TypeError("An EVM snapshot requires chainId.");
      return attempt(async endpoint => {
        await checkChain(endpoint);
        const raw = await jsonRpcResult(endpoint, "eth_getBlockByNumber", ["latest", false]);
        const block = raw as { number?: unknown; hash?: unknown; timestamp?: unknown } | null;
        if (!block || typeof block.number !== "string" || !/^0x[0-9a-f]+$/iu.test(block.number)
          || typeof block.hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(block.hash)
          || typeof block.timestamp !== "string" || !/^0x[0-9a-f]+$/iu.test(block.timestamp)) {
          throw new KeelRpcError("RPC block snapshot is incomplete.", "snapshot.invalid", redactRpcUrl(endpoint));
        }
        return Object.freeze({chainId: options.chainId!, blockNumber: BigInt(block.number).toString(),
          blockHash: block.hash.toLowerCase(), timestamp: BigInt(block.timestamp).toString()});
      });
    },

    async view(viewRequest: KeelTezosView): Promise<unknown> {
      requireFamily("tezos", "view");
      const block = viewRequest.block ?? `head~${confirmations}`;
      return attempt(async (endpoint) => {
        const result = (await request(
          endpoint,
          `/chains/main/blocks/${block}/helpers/scripts/run_script_view`,
          {
            contract: viewRequest.contract,
            view: viewRequest.view ?? KEEL_TEZOS_OBJECT_VIEW,
            input: viewRequest.input,
            ...(options.network === undefined ? {} : { chain_id: options.network }),
            unparsing_mode: "Readable",
          },
        )) as { data?: unknown };
        if (result.data === undefined) {
          throw new KeelRpcError("Script view returned no data.", "rpc.empty", redactRpcUrl(endpoint));
        }
        return result.data;
      });
    },

    async haulObject(store: string, objectId: string): Promise<Uint8Array> {
      const id = normalizedObjectId(objectId);
      if (family === "ethereum") {
        const result = await client.call({ to: store, data: `${KEEL_READ_OBJECT_SELECTOR}${id}` });
        return decodeAbiBytes(result, maxResponseBytes);
      }
      const data = await client.view({ contract: store, input: { bytes: id } });
      const hex = decodeMichelsonBytes(data);
      if (hex === null) throw new KeelRpcError(`Object ${objectId} is not held by ${store}.`, "object.missing");
      return hexToBytes(hex);
    },

    async haulObjectVerified(store: string, objectId: string, integrity: Integrity): Promise<Uint8Array> {
      const bytes = await client.haulObject(store, objectId);
      if (!(await verifyIntegrity(bytes, integrity))) {
        // The node answered, and answered with something else. Which node it
        // was matters to whoever has to go ask why.
        throw new KeelRpcError(
          `Object ${objectId} did not hash to its committed digest.`,
          "object.digest-mismatch",
          servedBy === undefined ? undefined : redactRpcUrl(servedBy),
        );
      }
      return bytes;
    },

    disclosure(): KeelRpcDisclosure {
      return {
        family,
        chain: family === "ethereum"
          ? `eip155:${options.chainId ?? "unknown"}`
          : `tezos:${options.network ?? "unknown"}`,
        endpoints: endpoints.map(redactRpcUrl),
        ...(servedBy === undefined ? {} : { servedBy: redactRpcUrl(servedBy) }),
        ...(list === undefined
          ? {}
          : {
              hostListRevision: list.revision,
              hostListEpoch: list.epoch,
              hostListStale: list.epoch !== list.currentEpoch,
            }),
        reads, physicalRequests,
      };
    },
  };

  return client;
}
