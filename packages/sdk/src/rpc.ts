/** Read-only preparation/verification RPC. Collector host governance stays separate. */
import { redactRpcUrl, remoteUrlAllowed } from "@keel/protocol";
import { KEEL_BUNDLED_NETWORK_INDEX, KEEL_NETWORK_CONFIGURATION, type KeelNetworkIndex } from './network-index.js';

/** Compatibility export. Network selection/defaults live in networks.config.json and the index. */
export const KEEL_SEPOLIA_PUBLIC_RPC_URLS: readonly string[] = KEEL_BUNDLED_NETWORK_INDEX.networks.find(n => n.chainId === KEEL_NETWORK_CONFIGURATION.legacySepoliaChainId)!.rpcUrls.map(u => normalizeKeelRpcUrl(u));
export const KEEL_RPC_PROVIDER_SETUP = Object.freeze({
  action: "ask-user-to-configure-rpc" as const,
  configFile: ".keel/rpc.json",
  configureCommand: "pnpm rpc:configure",
  checkCommand: "pnpm rpc:check",
  instructions: "Ask which RPC provider the user prefers. Help create an app for the index/config-selected chain and save its HTTPS RPC URL locally with pnpm rpc:configure, then check chain identity and required receipt/history reads. Never ask for wallet keys or a seed phrase, and keep RPC API keys out of chat, logs, Git and artwork.",
  providers: Object.freeze([
    { name: "Alchemy", documentation: "https://www.alchemy.com/docs/reference/ethereum-api-quickstart" },
    { name: "Infura", documentation: "https://docs.infura.io/get-started/infura/" },
    { name: "QuickNode", documentation: "https://www.quicknode.com/docs/ethereum" },
  ]),
});

export interface KeelRpcConfiguration {
  readonly chainId?: number;
  readonly rpcUrl?: string;
  readonly rpcUrls?: readonly string[];
  readonly timeoutMs?: number;
  readonly minIntervalMs?: number;
  readonly maxResponseBytes?: number;
}
export interface KeelRpcEnvironment {
  readonly KEEL_CHAIN_ID?: string;
  readonly KEEL_RPC_URL?: string;
  readonly KEEL_RPC_URLS?: string;
  readonly KEEL_SEPOLIA_RPC_URL?: string;
  readonly KEEL_SEPOLIA_RPC_URLS?: string;
  readonly KEEL_PUBLIC_RPC_URL?: string;
  readonly KEEL_PUBLIC_RPC_URLS?: string;
}
export interface ResolvedKeelRpcConfiguration {
  readonly chainId: number;
  readonly rpcUrls: readonly string[];
  readonly source: "explicit" | "environment" | "workspace-config" | "public-default";
  readonly timeoutMs: number;
  readonly minIntervalMs: number;
  readonly maxResponseBytes: number;
}

export function normalizeKeelRpcUrl(value: string, allowLoopback = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("RPC URL must be a valid HTTPS endpoint."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (value.length > 2048 || url.username || url.password || url.hash
      || !(url.protocol === "https:" || allowLoopback && loopback && url.protocol === "http:")
      || !remoteUrlAllowed(url.href, [], allowLoopback && loopback)) {
    throw new TypeError("RPC URL must be HTTPS, or explicitly selected loopback HTTP, without userinfo or a fragment.");
  }
  return url.pathname === "/" && !url.search ? url.origin : url.href;
}
function bound(value: number | undefined, fallback: number, min: number, max: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new TypeError("RPC timing/size configuration is outside its supported bounds.");
  return result;
}
export function resolveKeelRpcConfiguration(
  explicit: KeelRpcConfiguration = {}, environment: KeelRpcEnvironment = {}, file: KeelRpcConfiguration = {},
  index: KeelNetworkIndex = KEEL_BUNDLED_NETWORK_INDEX,
): ResolvedKeelRpcConfiguration {
  if (explicit.rpcUrl !== undefined && explicit.rpcUrls !== undefined || file.rpcUrl !== undefined && file.rpcUrls !== undefined) throw new TypeError("Choose rpcUrl or rpcUrls, not both.");
  const chainId = explicit.chainId ?? (environment.KEEL_CHAIN_ID === undefined ? undefined : Number(environment.KEEL_CHAIN_ID)) ?? file.chainId ?? index.defaultChainId;
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("RPC chainId must be a positive safe integer.");
  const env = environment.KEEL_RPC_URLS ?? environment.KEEL_RPC_URL ?? environment.KEEL_PUBLIC_RPC_URLS ?? environment.KEEL_PUBLIC_RPC_URL
    ?? (chainId === KEEL_NETWORK_CONFIGURATION.legacySepoliaChainId ? environment.KEEL_SEPOLIA_RPC_URLS ?? environment.KEEL_SEPOLIA_RPC_URL : undefined);
  const selected = explicit.rpcUrls ?? (explicit.rpcUrl === undefined ? undefined : [explicit.rpcUrl]);
  const configured = file.chainId === undefined || file.chainId === chainId ? file.rpcUrls ?? (file.rpcUrl === undefined ? undefined : [file.rpcUrl]) : undefined;
  const source = selected ? "explicit" : env !== undefined ? "environment" : configured ? "workspace-config" : "public-default";
  const indexed = index.networks.find(n => n.chainId === chainId)?.rpcUrls;
  if (source === "public-default" && !indexed?.length) throw new TypeError("Configure RPC URLs for the selected chain; the KEEL index has no public RPC pool for it.");
  const urls = selected ?? (env === undefined ? undefined : env.split(",").map(s => s.trim())) ?? configured ?? indexed!;
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 6 || urls.some(u => typeof u !== "string" || !u)) throw new TypeError("Configure one to six RPC URLs.");
  return Object.freeze({ chainId, source, rpcUrls: Object.freeze([...new Set(urls.map(u => normalizeKeelRpcUrl(u, source === "explicit")))]),
    timeoutMs: bound(explicit.timeoutMs ?? file.timeoutMs, 8000, 100, 30000),
    minIntervalMs: bound(explicit.minIntervalMs ?? file.minIntervalMs, 250, 0, 10000),
    maxResponseBytes: bound(explicit.maxResponseBytes ?? file.maxResponseBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024) });
}

type FailureReason = "rate-limited" | "unavailable" | "wrong-chain" | "access-denied" | "history-unavailable" | "invalid-response";
export class KeelRpcSetupError extends Error {
  readonly code = "rpc.setup-required";
  readonly setup = KEEL_RPC_PROVIDER_SETUP;
  constructor(readonly reason: FailureReason, readonly providers: readonly KeelRpcProviderStatus[], readonly retryAfterMs = 0) {
    super(`RPC verification unavailable (${reason}). Public/configured endpoints were exhausted. Run pnpm rpc:configure and pnpm rpc:check; ask the user to choose a provider for the selected chain, such as Alchemy, Infura or QuickNode. No wallet key is needed.`);
    this.name = "KeelRpcSetupError";
  }
}
export class KeelRpcResponseError extends Error {
  readonly code: number;
  constructor(readonly rpcCode: number, readonly data?: string, providerGasCap?: bigint, readonly status?: number) {
    super(status === 413 ? "RPC request body too large." : providerGasCap === undefined ? rpcCode === 3 ? "RPC execution reverted." : "RPC rejected this read request." : `RPC gas cap: ${providerGasCap}`);
    this.code = rpcCode;
    this.name = "KeelRpcResponseError";
  }
}
class ProviderFailure extends Error {
  constructor(readonly reason: FailureReason, readonly retryAfterMs = 0) { super(reason); }
}
export interface KeelRpcProviderStatus {
  readonly endpoint: string;
  readonly checkedChainId?: number;
  readonly reason?: FailureReason;
  readonly retryAfterMs: number;
  readonly disabled: boolean;
}
export interface KeelRpcRequest {
  readonly method: string;
  readonly params?: readonly unknown[];
  readonly requireResult?: boolean;
  readonly signal?: AbortSignal;
}
export interface KeelRpcPool {
  request(input: KeelRpcRequest): Promise<unknown>;
  status(): readonly KeelRpcProviderStatus[];
  /** Retain this pool's pacing, identity and cooldown state without per-call failover.
   * Publication must qualify a candidate before sending it a complete program. */
  pin(providerIndex: number): Pick<KeelRpcPool, "request" | "status">;
}
export interface KeelRpcPoolOptions {
  readonly rpcUrls: readonly string[];
  /** Omit only for discovery on explicitly supplied endpoints. First identity is pinned. */
  readonly chainId?: number;
  readonly timeoutMs?: number;
  /** Complete publication simulations can take longer than ordinary reads. */
  readonly simulationTimeoutMs?: number;
  readonly minIntervalMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowLoopback?: boolean;
  readonly fetchImpl?: typeof fetch;
}
const READ_METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_getBalance", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_call", "eth_simulateV1", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs", "eth_getStorageAt", "eth_getProof", "net_version", "web3_clientVersion"]);
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export function createKeelRpcPool(options: KeelRpcPoolOptions): KeelRpcPool {
  if (!Array.isArray(options.rpcUrls) || options.rpcUrls.length < 1 || options.rpcUrls.length > 6) throw new TypeError("RPC pool requires one to six endpoints.");
  if (options.chainId !== undefined && (!Number.isSafeInteger(options.chainId) || options.chainId < 1)) throw new TypeError("RPC pool requires a positive expected chain ID.");
  const timeoutMs = bound(options.timeoutMs, 8000, 100, 30000);
  const simulationTimeoutMs = bound(options.simulationTimeoutMs, timeoutMs, 100, 90000);
  const minIntervalMs = bound(options.minIntervalMs, 250, 0, 10000);
  const maxBytes = bound(options.maxResponseBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024);
  const states = [...new Set(options.rpcUrls.map(url => normalizeKeelRpcUrl(url, options.allowLoopback)))].map(url => ({
    url, disabled: false, cooldown: 0, nextAt: 0, failures: 0, chainId: undefined as number | undefined,
    checkedAt: 0, checking: undefined as Promise<void> | undefined, reason: undefined as FailureReason | undefined, tail: Promise.resolve(),
  }));
  const fetcher = options.fetchImpl ?? fetch;
  let expectedChain = options.chainId, cursor = 0, id = 0;
  const status = (): readonly KeelRpcProviderStatus[] => states.map(s => ({ endpoint: redactRpcUrl(s.url),
    ...(s.chainId === undefined ? {} : { checkedChainId: s.chainId }), ...(s.reason === undefined ? {} : { reason: s.reason }),
    retryAfterMs: Math.max(0, s.cooldown - Date.now()), disabled: s.disabled }));
  async function send(state: typeof states[number], method: string, params: readonly unknown[], signal?: AbortSignal): Promise<unknown> {
    const prior = state.tail; let release!: () => void;
    state.tail = new Promise<void>(r => { release = r; });
    await prior;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      signal?.throwIfAborted();
      if (state.disabled) throw new ProviderFailure(state.reason ?? "unavailable");
      if (state.cooldown > Date.now()) throw new ProviderFailure("rate-limited", state.cooldown - Date.now());
      if (state.nextAt > Date.now()) await pause(state.nextAt - Date.now(), signal);
      if (state.cooldown > Date.now()) throw new ProviderFailure("rate-limited", state.cooldown - Date.now());
      state.nextAt = Date.now() + minIntervalMs;
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), method === "eth_simulateV1" ? simulationTimeoutMs : timeoutMs);
      const requestId = ++id;
      let response: Response;
      try { response = await fetcher(state.url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
        redirect: "error", signal: signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]) }); }
      catch { signal?.throwIfAborted(); throw new ProviderFailure("unavailable"); }
      const header = response.headers.get("retry-after");
      const rawDelay = header === null ? 0 : /^\d+(?:\.\d+)?$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      const delay = Number.isFinite(rawDelay) ? Math.max(0, rawDelay) : 0;
      if (!response.ok) {
        await response.body?.cancel();
        if (method === "eth_simulateV1" && response.status === 413) throw new KeelRpcResponseError(-32000, undefined, undefined, 413);
        throw new ProviderFailure(response.status === 429 ? "rate-limited" : [401, 403].includes(response.status) ? "access-denied" : "unavailable", delay);
      }
      if (!response.body) throw new ProviderFailure("invalid-response");
      const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const v = await reader.read(); if (v.done) break; size += v.value.byteLength;
        if (size > maxBytes) throw new ProviderFailure("invalid-response"); parts.push(v.value); }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      let body: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ProviderFailure("invalid-response"); }
      if (body === null || typeof body !== "object" || body.jsonrpc !== "2.0" || body.id !== requestId) throw new ProviderFailure("invalid-response");
      if (body.error !== undefined) {
        const code = typeof body.error?.code === "number" ? body.error.code : -32603;
        const message = typeof body.error?.message === "string" ? body.error.message : "";
        if (code === 429 || code === -32005 || /rate.?limit|too many requests|quota|compute units|usage.?limit/iu.test(message)) throw new ProviderFailure("rate-limited", delay);
        if (/missing trie|historical|pruned|state.*unavailable|header not found/iu.test(message)) throw new ProviderFailure("history-unavailable");
        if (code === 3 || /execution reverted/iu.test(message)) throw new KeelRpcResponseError(3, typeof body.error.data === "string" && /^0x[0-9a-f]*$/iu.test(body.error.data) ? body.error.data : undefined);
        if ([401, 403].includes(code) || /api.?key|unauthorized|authentication|access denied/iu.test(message)) throw new ProviderFailure("access-denied");
        if (method === "eth_simulateV1") {
          // Preserve typed failure evidence while never exposing a provider URL,
          // key, request body, or arbitrary remote error message.
          const cap = /(?:gas cap|maximum allowed gas|gas limit too high[^\n]*?cap)\s*[:=(]\s*(0x[\da-f]+|\d+)/iu.exec(message)?.[1];
          if (cap && cap.length <= 20 && BigInt(cap) > 0n) throw new KeelRpcResponseError(code, undefined, BigInt(cap));
          // Simulation validation errors are execution evidence, not transport
          // outages. In particular qualification must observe nonce-too-high.
          if (code === -32601 || code <= -38000 && code >= -38099) throw new KeelRpcResponseError(code);
        }
        if (code === -32602) throw new KeelRpcResponseError(code);
        throw new ProviderFailure("unavailable");
      }
      if (!Object.hasOwn(body, "result")) throw new ProviderFailure("invalid-response");
      return body.result;
    } catch (error) {
      signal?.throwIfAborted();
      // Set cooldown before releasing the queue so concurrent reads cannot race a 429.
      if (error instanceof ProviderFailure && error.reason === "rate-limited") {
        state.reason = error.reason;
        state.cooldown = Math.max(state.cooldown, Date.now() + Math.max(error.retryAfterMs, Math.min(30000, 1000 * 2 ** Math.min(5, state.failures))));
      }
      if (error instanceof KeelRpcResponseError || error instanceof ProviderFailure) throw error;
      throw new ProviderFailure("unavailable");
    } finally { if (timer !== undefined) clearTimeout(timer); release(); }
  }
  async function checkChain(state: typeof states[number], signal?: AbortSignal, force = false): Promise<void> {
    if (!force && state.chainId !== undefined && Date.now() - state.checkedAt < 60000) return;
    if (state.checking === undefined) {
      state.checking = (async () => {
        const result = await send(state, "eth_chainId", [], signal);
        if (typeof result !== "string" || !/^0x[0-9a-f]+$/iu.test(result)) throw new ProviderFailure("invalid-response");
        const seen = Number(BigInt(result));
        if (!Number.isSafeInteger(seen) || seen < 1) throw new ProviderFailure("invalid-response");
        state.chainId = seen;
        expectedChain ??= seen;
        if (seen !== expectedChain) { state.disabled = true; throw new ProviderFailure("wrong-chain"); }
        state.checkedAt = Date.now();
      })().finally(() => { state.checking = undefined; });
    }
    await state.checking;
  }
  const request = async (input: KeelRpcRequest, pinnedIndex?: number): Promise<unknown> => {
    if (!READ_METHODS.has(input.method)) throw new TypeError("RPC pool supports read-only methods; wallet/signing/submission methods are refused.");
    const params = input.params ?? [];
    const simulation = input.method === "eth_simulateV1";
    if (!Array.isArray(params) || JSON.stringify(params).length > (simulation ? 32 * 1024 * 1024 : 512 * 1024)) throw new TypeError("RPC parameters must be a bounded array.");
    if (simulation) {
      const payload = params[0] as { blockStateCalls?: unknown; validation?: unknown; traceTransfers?: unknown; returnFullTransactions?: unknown } | undefined;
      if (params.length !== 2 || !payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).some(key => !["blockStateCalls", "validation", "traceTransfers", "returnFullTransactions"].includes(key))
        || typeof payload.validation !== "boolean" || payload.traceTransfers !== false || typeof payload.returnFullTransactions !== "boolean"
        || !Array.isArray(payload.blockStateCalls) || payload.blockStateCalls.length < 1 || payload.blockStateCalls.length > 256
        || payload.blockStateCalls.some(block => !block || typeof block !== "object" || Array.isArray(block)
          || Object.keys(block).some(key => key !== "calls") || !Array.isArray((block as { calls?: unknown }).calls)
          || (block as { calls: unknown[] }).calls.length !== 1)
        || typeof params[1] !== "string" || !/^(?:latest|0x[0-9a-f]+)$/iu.test(params[1])) {
        throw new TypeError("Publication simulation requires bounded exact call blocks without state, balance or code overrides.");
      }
    }
    input.signal?.throwIfAborted();
    let last: FailureReason = "unavailable", missing = false;
    const start = pinnedIndex ?? cursor;
    for (let i = 0; i < (pinnedIndex === undefined ? states.length : 1); i++) {
      const index = (start + i) % states.length, state = states[index]!;
      if (state.disabled || state.cooldown > Date.now()) { last = state.reason ?? "rate-limited"; continue; }
      try {
        await checkChain(state, input.signal, input.method === "eth_chainId");
        const value = input.method === "eth_chainId" ? `0x${state.chainId!.toString(16)}` : await send(state, input.method, params, input.signal);
        if (value === null && (input.requireResult || ["eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByHash", "eth_getBlockByNumber"].includes(input.method))) {
          missing = true; state.reason = "history-unavailable"; last = "history-unavailable"; continue;
        }
        cursor = index; state.failures = 0; state.reason = undefined;
        return value;
      } catch (error) {
        input.signal?.throwIfAborted();
        if (error instanceof KeelRpcResponseError) throw error;
        const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unavailable");
        last = failure.reason; state.reason = last;
        if (["wrong-chain", "access-denied"].includes(last)) state.disabled = true;
        if (last !== "history-unavailable") state.cooldown = Date.now() + Math.max(failure.retryAfterMs, Math.min(30000, 1000 * 2 ** Math.min(5, state.failures++)));
      }
    }
    if (missing && !input.requireResult) return null; // Pending/not-found is valid, never publication proof.
    const cooling = states.filter(s => !s.disabled).map(s => Math.max(0, s.cooldown - Date.now())).filter(ms => ms > 0);
    throw new KeelRpcSetupError(missing ? "history-unavailable" : last, status(), cooling.length ? Math.min(...cooling) : 0);
  };
  return { status, request, pin(providerIndex) {
    if (!Number.isInteger(providerIndex) || providerIndex < 0 || providerIndex >= states.length) throw new RangeError("Invalid configured RPC provider index.");
    return { request: input => request(input, providerIndex), status: () => [status()[providerIndex]!] };
  } };
}

/** Adapt SDK readers; de-batch locally because public providers need individual requests. */
export function createKeelRpcFetch(pool: KeelRpcPool): typeof fetch {
  return (async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== "POST" || typeof init.body !== "string") throw new TypeError("RPC adapter accepts JSON-RPC POST reads only.");
    const parsed: unknown = JSON.parse(init.body);
    const batched = Array.isArray(parsed), bodies = batched ? parsed : [parsed];
    if (bodies.length < 1 || bodies.length > 256) throw new TypeError("RPC batch must contain one to 256 reads.");
    const responses = [];
    for (const value of bodies) {
      if (value === null || typeof value !== "object") throw new TypeError("Invalid RPC request.");
      const body = value as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };
      if (body.jsonrpc !== "2.0" || typeof body.method !== "string") throw new TypeError("Invalid RPC request.");
      try {
        const result = await pool.request({ method: body.method, requireResult: ["eth_getBlockByNumber", "eth_getBlockByHash"].includes(body.method), ...(body.params === undefined ? {} : { params: body.params }), ...(init.signal == null ? {} : { signal: init.signal }) });
        responses.push({ jsonrpc: "2.0", id: body.id, result });
      } catch (error) {
        if (!(error instanceof KeelRpcResponseError)) throw error;
        responses.push({ jsonrpc: "2.0", id: body.id, error: { code: error.rpcCode, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } });
      }
    }
    return new Response(JSON.stringify(batched ? responses : responses[0]), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

/** Find setup failures wrapped by a chain client without exposing its request/URL. */
export function findKeelRpcSetupError(error: unknown): KeelRpcSetupError | undefined {
  for (let depth = 0; depth < 12 && error && typeof error === "object"; depth++) {
    if (error instanceof KeelRpcSetupError) return error;
    error = (error as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Browser-safe default reader transport; explicit endpoints retain custom-chain discovery. */
export function keelRpcReaderTransport(rpcUrl?: string, chainId?: number, index: KeelNetworkIndex = KEEL_BUNDLED_NETWORK_INDEX): { rpcUrl: string; fetchImpl: typeof fetch } {
  const urls = rpcUrl === undefined ? resolveKeelRpcConfiguration(chainId === undefined ? {} : { chainId }, {}, {}, index).rpcUrls : [normalizeKeelRpcUrl(rpcUrl, true)];
  const expectedChain = chainId ?? (rpcUrl === undefined ? index.defaultChainId : undefined);
  const pool = createKeelRpcPool({ rpcUrls: urls, ...(expectedChain === undefined ? {} : { chainId: expectedChain }), allowLoopback: rpcUrl !== undefined });
  return { rpcUrl: urls[0]!, fetchImpl: createKeelRpcFetch(pool) };
}
