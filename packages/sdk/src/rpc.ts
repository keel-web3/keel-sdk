/** Read-only preparation/verification RPC. Collector host governance stays separate. */
import { keccak256 } from "viem";
import { normalizeKeelRpcEndpointCapability, type KeelRpcEndpointCapability } from "./rpc-read-manifest.js";
export type { KeelRpcEndpointCapability, KeelRpcMethodCapability } from "./rpc-read-manifest.js";
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
  readonly endpoints?: readonly KeelRpcEndpointCapability[];
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
  readonly endpoints?: readonly KeelRpcEndpointCapability[];
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
  const normalizedUrls = [...new Set(urls.map(u => normalizeKeelRpcUrl(u, source === "explicit")))];
  const selectedEvidence = explicit.endpoints ?? (source === "workspace-config" ? file.endpoints : undefined);
  if (selectedEvidence !== undefined && (!Array.isArray(selectedEvidence) || selectedEvidence.length > normalizedUrls.length)) throw new TypeError("Invalid selected RPC capability evidence.");
  const endpoints = selectedEvidence?.map(value => normalizeKeelRpcEndpointCapability(value, chainId));
  if (endpoints && (new Set(endpoints.map(value => value.url)).size !== endpoints.length || endpoints.some(value => !normalizedUrls.includes(normalizeKeelRpcUrl(value.url, source === "explicit"))))) throw new TypeError("RPC capabilities must belong to the selected endpoints.");
  return Object.freeze({ chainId, source, rpcUrls: Object.freeze(normalizedUrls),
    ...(endpoints === undefined ? {} : { endpoints: Object.freeze(endpoints) }),
    timeoutMs: bound(explicit.timeoutMs ?? file.timeoutMs, 8000, 100, 30000),
    minIntervalMs: bound(explicit.minIntervalMs ?? file.minIntervalMs, 250, 0, 10000),
    maxResponseBytes: bound(explicit.maxResponseBytes ?? file.maxResponseBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024) });
}

export type FailureReason = "rate-limited" | "unavailable" | "wrong-chain" | "access-denied" | "history-unavailable" | "invalid-response" | "method-unavailable" | "gas-capacity" | "response-capacity" | "pin-mismatch" | "deadline-exceeded";
export class KeelRpcSetupError extends Error {
  readonly code = "rpc.setup-required";
  readonly setup = KEEL_RPC_PROVIDER_SETUP;
  readonly diagnosis: "unknown" | undefined;
  constructor(readonly reason: FailureReason, readonly providers: readonly KeelRpcProviderStatus[], readonly retryAfterMs = 0, readonly method?: string) {
    super(`RPC verification unavailable (${reason}). No eligible configured endpoint completed this bounded read.${retryAfterMs > 0 ? " Respect the reported cooldown before retrying." : " Check method support, selected-chain evidence and configured endpoint capabilities."} Additional authorized endpoints can be configured with pnpm rpc:configure. No wallet key is needed.`);
    this.name = "KeelRpcSetupError";
    this.diagnosis = method?.startsWith("debug_trace") ? "unknown" : undefined;
  }
}
export class KeelRpcResponseError extends Error {
  readonly code: number;
  method?: string;
  providers?: readonly KeelRpcProviderStatus[];
  diagnosis?: "unknown";
  constructor(readonly rpcCode: number, readonly data?: string, readonly providerGasCap?: bigint) {
    super(providerGasCap === undefined ? rpcCode === 3 ? "RPC execution reverted." : "RPC rejected this read request." : `RPC gas cap: ${providerGasCap}`);
    this.code = rpcCode;
    this.name = "KeelRpcResponseError";
    // Keep thrown evidence JSON-safe while retaining bigint capacity internally.
    Object.defineProperty(this, "providerGasCap", { value: providerGasCap, enumerable: false });
  }
}
class ProviderFailure extends Error {
  constructor(readonly reason: FailureReason, readonly retryAfterMs = 0, readonly alreadyCooling = false) { super(reason); }
}
export interface KeelRpcMethodStatus {
  readonly method: string;
  readonly supported: boolean | "unknown";
  readonly maxGas?: string;
  readonly maxResponseBytes: number;
  readonly retryAfterMs: number;
  readonly reason?: FailureReason;
}
export interface KeelRpcProviderStatus {
  readonly endpoint: string;
  readonly checkedChainId?: number;
  readonly reason?: FailureReason;
  readonly retryAfterMs: number;
  readonly disabled: boolean;
  readonly methods?: readonly KeelRpcMethodStatus[];
  readonly method?: string;
  readonly supported?: boolean | "unknown";
  readonly maxGas?: string;
  readonly maxResponseBytes?: number;
}
export interface KeelRpcReadPin {
  readonly blockNumber: `0x${string}`;
  readonly blockHash: `0x${string}`;
  readonly runtimes?: readonly { readonly address: `0x${string}`; readonly codeHash: `0x${string}` }[];
}
export interface KeelRpcRequest {
  readonly method: string;
  readonly params?: readonly unknown[];
  readonly requireResult?: boolean;
  readonly requiredGas?: bigint;
  readonly requiredResponseBytes?: number;
  readonly pin?: KeelRpcReadPin;
  readonly signal?: AbortSignal;
}
export interface KeelRpcPool {
  request(input: KeelRpcRequest): Promise<unknown>;
  status(method?: string): readonly KeelRpcProviderStatus[];
}
export interface KeelRpcPoolOptions {
  readonly rpcUrls: readonly string[];
  /** Omit only for discovery on explicitly supplied endpoints. First identity is pinned. */
  readonly chainId?: number;
  readonly timeoutMs?: number;
  readonly minIntervalMs?: number;
  readonly maxResponseBytes?: number;
  readonly allowLoopback?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly endpoints?: readonly KeelRpcEndpointCapability[];
  readonly maxAttempts?: number;
  readonly deadlineMs?: number;
  /** Deterministic clocks/jitter for tests; production uses Date.now/Math.random. */
  readonly now?: () => number;
  readonly random?: () => number;
}
const READ_METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_getBalance", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_call", "eth_simulateV1", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getLogs", "eth_getStorageAt", "eth_getProof", "net_version", "web3_clientVersion", "debug_traceCall", "debug_traceTransaction"]);
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
export function createKeelRpcPool(options: KeelRpcPoolOptions): KeelRpcPool {
  if (!Array.isArray(options.rpcUrls) || options.rpcUrls.length < 1 || options.rpcUrls.length > 8) throw new TypeError("RPC pool requires one to eight endpoints.");
  if (options.chainId !== undefined && (!Number.isSafeInteger(options.chainId) || options.chainId < 1)) throw new TypeError("RPC pool requires a positive expected chain ID.");
  const timeoutMs = bound(options.timeoutMs, 8000, 100, 30000);
  const deadlineMs = bound(options.deadlineMs, 30000, 100, 60000);
  const maxAttempts = bound(options.maxAttempts, options.rpcUrls.length, 1, 8);
  const minIntervalMs = bound(options.minIntervalMs, 250, 0, 10000);
  const maxBytes = bound(options.maxResponseBytes, 16 * 1024 * 1024, 1024, 64 * 1024 * 1024);
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const urls = [...new Set(options.rpcUrls.map(url => normalizeKeelRpcUrl(url, options.allowLoopback)))];
  if (options.endpoints && (!Array.isArray(options.endpoints) || options.endpoints.length > urls.length || options.chainId === undefined)) throw new TypeError("RPC capabilities require the selected chain and endpoints.");
  const records = (options.endpoints ?? []).map(record => normalizeKeelRpcEndpointCapability(record, options.chainId!));
  const seen = new Set<string>();
  for (const record of records) {
    const url = normalizeKeelRpcUrl(record.url, options.allowLoopback);
    if (!urls.includes(url) || seen.has(url)) throw new TypeError("RPC capability endpoint is duplicate or not selected.");
    seen.add(url);
  }
  type MethodState = { cooldown: number; failures: number; unsupported: boolean; observedSupport?: boolean; maxGas?: bigint; reason?: FailureReason };
  const states = urls.map(url => {
    const record = records.find(value => normalizeKeelRpcUrl(value.url, options.allowLoopback) === url);
    return { url, record, disabled: false, nextAt: 0, chainId: undefined as number | undefined, checkedAt: 0,
      reason: undefined as FailureReason | undefined, tail: Promise.resolve(), methods: new Map<string, MethodState>(),
      // Same-origin URLs conservatively share limits. Explicit groups join mirrors on different hosts.
      quota: record?.quotaGroup ?? new URL(url).origin, auth: record?.authorizationScope ?? new URL(url).origin };
  });
  type State = typeof states[number];
  const quotas = new Map<string, number>(), denied = new Set<string>();
  const methodState = (state: State, method: string): MethodState => {
    let value = state.methods.get(method);
    if (!value) { value = { cooldown: 0, failures: 0, unsupported: false }; state.methods.set(method, value); }
    return value;
  };
  const fresh = (state: State) => state.record && state.record.observedAtMs <= now() && state.record.validUntilMs > now() ? state.record : undefined;
  const limits = (state: State, method: string) => {
    const record = fresh(state), declared = record?.methods?.find(value => value.method === method), learned = state.methods.get(method);
    const knownGas = [declared?.maxGas, method === "eth_call" ? record?.maxCallGas : undefined].filter((value): value is number => value !== undefined).map(BigInt);
    if (learned?.maxGas !== undefined) knownGas.push(learned.maxGas);
    return { supported: learned?.unsupported ? false : learned?.observedSupport ?? declared?.supported,
      maxGas: knownGas.length ? knownGas.reduce((a, b) => a < b ? a : b) : undefined,
      maxResponseBytes: Math.min(maxBytes, record?.maxResponseBytes ?? maxBytes, declared?.maxResponseBytes ?? maxBytes),
      // Requests are deliberately serial per endpoint, within every declared concurrency ceiling.
      minIntervalMs: Math.max(minIntervalMs, declared?.minIntervalMs ?? 0) };
  };
  const methodEvidence = (state: State, method: string): KeelRpcMethodStatus => {
    const health = state.methods.get(method), cap = limits(state, method);
    return { method, supported: cap.supported ?? "unknown", maxResponseBytes: cap.maxResponseBytes,
      retryAfterMs: Math.max(0, (quotas.get(state.quota) ?? 0) - now(), (health?.cooldown ?? 0) - now()),
      ...(cap.maxGas === undefined ? {} : { maxGas: cap.maxGas.toString() }), ...(health?.reason === undefined ? {} : { reason: health.reason }) };
  };
  const status = (method?: string): readonly KeelRpcProviderStatus[] => states.map(state => {
    const health = method === undefined ? undefined : state.methods.get(method), cap = method === undefined ? undefined : limits(state, method);
    const reason = denied.has(state.auth) ? "access-denied" : state.reason ?? health?.reason;
    return { endpoint: redactRpcUrl(state.url), ...(state.chainId === undefined ? {} : { checkedChainId: state.chainId }),
      ...(reason === undefined ? {} : { reason }), disabled: state.disabled || denied.has(state.auth),
      retryAfterMs: Math.max(0, (quotas.get(state.quota) ?? 0) - now(), (health?.cooldown ?? 0) - now()),
      ...(method === undefined ? { methods: [...new Set([...state.methods.keys(), ...(fresh(state)?.methods?.map(value => value.method) ?? [])])].map(name => methodEvidence(state, name)) } : { method, supported: cap?.supported ?? "unknown", maxResponseBytes: cap!.maxResponseBytes,
        ...(cap?.maxGas === undefined ? {} : { maxGas: cap.maxGas.toString() }) }) };
  });
  const jitter = (failures: number) => Math.round(Math.min(30_000, 1000 * 2 ** Math.min(5, failures)) * (0.75 + Math.max(0, Math.min(1, random())) * 0.25));
  const fetcher = options.fetchImpl ?? fetch;
  let expectedChain = options.chainId, cursor = 0, id = 0;
  async function send(state: State, method: string, params: readonly unknown[], signal: AbortSignal): Promise<unknown> {
    const prior = state.tail; let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    state.tail = prior.then(() => turn);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const health = methodState(state, method);
    try {
      await abortable(prior, signal);
      signal.throwIfAborted();
      if (state.disabled || denied.has(state.auth)) throw new ProviderFailure(state.reason ?? "access-denied");
      const cooldown = Math.max(quotas.get(state.quota) ?? 0, health.cooldown);
      if (cooldown > now()) throw new ProviderFailure(health.reason ?? "rate-limited", cooldown - now(), true);
      if (state.nextAt > now()) await pause(state.nextAt - now(), signal);
      // A sibling sharing the quota may have failed while this request was queued.
      if ((quotas.get(state.quota) ?? 0) > now()) throw new ProviderFailure("rate-limited", (quotas.get(state.quota) ?? 0) - now(), true);
      if (denied.has(state.auth)) throw new ProviderFailure("access-denied");
      const cap = limits(state, method);
      if (cap.supported === false) throw new KeelRpcResponseError(-32601);
      state.nextAt = now() + cap.minIntervalMs;
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const combined = AbortSignal.any([controller.signal, signal]);
      const requestId = ++id;
      let response: Response;
      try { response = await abortable(fetcher(state.url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }), redirect: "error", signal: combined }), combined); }
      catch { signal.throwIfAborted(); throw new ProviderFailure("unavailable"); }
      const header = response.headers.get("retry-after");
      const rawDelay = header === null ? 0 : /^\d+(?:\.\d+)?$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - now();
      // Retain long server cooldowns as evidence; never sleep through them or retry early.
      const delay = Number.isFinite(rawDelay) ? Math.min(Number.MAX_SAFE_INTEGER - now(), Math.max(0, rawDelay)) : 0;
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new ProviderFailure(response.status === 429 ? "rate-limited" : [401, 403].includes(response.status) ? "access-denied" : "unavailable", delay);
      }
      if (!response.body) throw new ProviderFailure("invalid-response");
      const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const value = await abortable(reader.read(), combined); if (value.done) break; size += value.value.byteLength;
          if (size > cap.maxResponseBytes) throw new ProviderFailure("response-capacity"); parts.push(value.value); }
      } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      let body: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
      try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new ProviderFailure("invalid-response"); }
      if (body === null || typeof body !== "object" || body.jsonrpc !== "2.0" || body.id !== requestId) throw new ProviderFailure("invalid-response");
      if (body.error !== undefined) {
        const code = typeof body.error?.code === "number" ? body.error.code : -32603;
        const message = typeof body.error?.message === "string" ? body.error.message : "";
        if ([401, 403].includes(code) || /(?:invalid|missing|expired|revoked|disabled) (?:api.?key|token)|(?:api.?key|token).{0,20}(?:invalid|expired|revoked|required|not found)|unauthorized|authentication|access denied|forbidden/iu.test(message)) throw new ProviderFailure("access-denied");
        // Numeric gas capacity must not be mistaken for quota exhaustion (-32005 is overloaded).
        const match = /(?:gas cap|maximum allowed gas|gas limit too high[^\n]*?cap)\s*[:=(]\s*(0x[\da-f]+|\d+)/iu.exec(message)?.[1];
        if (match && match.length <= 20 && BigInt(match) > 0n) throw new KeelRpcResponseError(code, undefined, BigInt(match));
        if (code === -32601 || /method (?:not found|not supported|unsupported)|unsupported method|(?:debug|trace).*not (?:available|enabled)/iu.test(message)) throw new KeelRpcResponseError(-32601);
        if (code === 429 || code === -32005 || /rate.?limit|too many requests|quota|compute units|usage.?limit/iu.test(message)) throw new ProviderFailure("rate-limited", delay);
        if (/missing trie|historical|pruned|state.*unavailable|header not found/iu.test(message)) throw new ProviderFailure("history-unavailable");
        if (code === 3 || /execution reverted/iu.test(message)) throw new KeelRpcResponseError(3, typeof body.error.data === "string" && /^0x[0-9a-f]*$/iu.test(body.error.data) && body.error.data.length <= 131_074 ? body.error.data : undefined);
        if (code === -32602 || code === -38014) throw new KeelRpcResponseError(code);
        throw new ProviderFailure("unavailable");
      }
      if (!Object.hasOwn(body, "result")) throw new ProviderFailure("invalid-response");
      health.failures = 0; health.observedSupport = true; delete health.reason;
      return body.result;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof KeelRpcResponseError) {
        if (error.rpcCode === -32601) { health.unsupported = true; health.reason = "method-unavailable"; }
        if (error.providerGasCap !== undefined) { health.maxGas = health.maxGas === undefined || error.providerGasCap < health.maxGas ? error.providerGasCap : health.maxGas; health.reason = "gas-capacity"; }
        throw error;
      }
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unavailable");
      if (!failure.alreadyCooling) {
        health.reason = failure.reason;
        if (failure.reason === "access-denied") denied.add(state.auth);
        else if (failure.reason === "rate-limited") quotas.set(state.quota, Math.max(quotas.get(state.quota) ?? 0, now() + Math.max(failure.retryAfterMs, jitter(health.failures++))));
        else if (failure.reason !== "history-unavailable") health.cooldown = now() + Math.max(failure.retryAfterMs, jitter(health.failures++));
      }
      throw failure;
    } finally { if (timer !== undefined) clearTimeout(timer); release(); }
  }
  async function checkChain(state: State, signal: AbortSignal, force = false): Promise<void> {
    if (!force && state.chainId !== undefined && now() - state.checkedAt < 60000) return;
    const result = await send(state, "eth_chainId", [], signal);
    if (typeof result !== "string" || !/^0x[0-9a-f]+$/iu.test(result)) throw new ProviderFailure("invalid-response");
    const chain = Number(BigInt(result));
    if (!Number.isSafeInteger(chain) || chain < 1) throw new ProviderFailure("invalid-response");
    state.chainId = chain; expectedChain ??= chain;
    if (chain !== expectedChain) { state.disabled = true; state.reason = "wrong-chain"; throw new ProviderFailure("wrong-chain"); }
    state.checkedAt = now();
  }
  async function checkPin(state: State, pin: KeelRpcReadPin, signal: AbortSignal, runtime: boolean): Promise<void> {
    const block = await send(state, "eth_getBlockByNumber", [pin.blockNumber, false], signal) as { number?: unknown; hash?: unknown } | null;
    if (block?.number !== pin.blockNumber || typeof block.hash !== "string" || block.hash.toLowerCase() !== pin.blockHash.toLowerCase()) throw new ProviderFailure("pin-mismatch");
    if (runtime) for (const expected of pin.runtimes ?? []) {
      const code = await send(state, "eth_getCode", [expected.address, pin.blockNumber], signal);
      if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(code) || keccak256(code as `0x${string}`).toLowerCase() !== expected.codeHash.toLowerCase()) throw new ProviderFailure("pin-mismatch");
    }
  }
  return { status, async request(input) {
    if (!READ_METHODS.has(input.method)) throw new TypeError("RPC pool supports read-only methods; wallet/signing/submission methods are refused.");
    let params = input.params ?? [];
    const simulation = input.method === "eth_simulateV1";
    if (!Array.isArray(params) || JSON.stringify(params).length > (simulation ? 32 * 1024 * 1024 : 512 * 1024)) throw new TypeError("RPC parameters must be a bounded array.");
    if (simulation) validateSimulation(params);
    if (input.method.startsWith("debug_trace")) params = boundedTrace(input.method, params);
    if (input.pin) params = pinnedParams(input.method, params, input.pin);
    const requiredGas = requestGas(input.method, params, input.requiredGas);
    if (input.requiredResponseBytes !== undefined) bound(input.requiredResponseBytes, 0, 0, 64 * 1024 * 1024);
    input.signal?.throwIfAborted();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("RPC read deadline exceeded.")), deadlineMs);
    const signal = input.signal === undefined ? controller.signal : AbortSignal.any([input.signal, controller.signal]);
    let last: FailureReason = "unavailable", missing = false, lastResponse: KeelRpcResponseError | undefined;
    const start = cursor;
    try {
      let attempts = 0;
      for (let i = 0; i < states.length && attempts < maxAttempts; i++) {
        const index = (start + i) % states.length, state = states[index]!, health = methodState(state, input.method), cap = limits(state, input.method);
        if (state.disabled || denied.has(state.auth)) { last = state.reason ?? "access-denied"; continue; }
        if ((quotas.get(state.quota) ?? 0) > now() || health.cooldown > now()) { last = health.reason ?? "rate-limited"; continue; }
        if (cap.supported === false) { health.reason = "method-unavailable"; last = "method-unavailable"; lastResponse = new KeelRpcResponseError(-32601); continue; }
        if (requiredGas !== undefined && cap.maxGas !== undefined && requiredGas > cap.maxGas) { health.reason = "gas-capacity"; last = "gas-capacity"; lastResponse = new KeelRpcResponseError(-32000, undefined, cap.maxGas); continue; }
        if (input.requiredResponseBytes !== undefined && input.requiredResponseBytes > cap.maxResponseBytes) { health.reason = "response-capacity"; last = "response-capacity"; continue; }
        attempts++;
        try {
          await checkChain(state, signal, input.method === "eth_chainId" || input.pin !== undefined);
          if (input.pin) {
            await checkPin(state, input.pin, signal, true);
            if (["debug_traceTransaction", "eth_getTransactionByHash"].includes(input.method)) {
              const receipt = await send(state, "eth_getTransactionReceipt", [params[0]], signal) as { blockNumber?: unknown; blockHash?: unknown; transactionHash?: unknown } | null;
              if (!receipt || receipt.blockNumber !== input.pin.blockNumber || typeof receipt.blockHash !== "string"
                || receipt.blockHash.toLowerCase() !== input.pin.blockHash.toLowerCase()
                || typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== String(params[0]).toLowerCase()) throw new ProviderFailure("pin-mismatch");
            }
          }
          const value = input.method === "eth_chainId" ? `0x${state.chainId!.toString(16)}` : await send(state, input.method, params, signal);
          if (input.pin) {
            await checkPin(state, input.pin, signal, false);
            if (input.method === "eth_getTransactionReceipt") {
              const receipt = value as { blockNumber?: unknown; blockHash?: unknown } | null;
              if (!receipt || receipt.blockNumber !== input.pin.blockNumber || typeof receipt.blockHash !== "string" || receipt.blockHash.toLowerCase() !== input.pin.blockHash.toLowerCase()) throw new ProviderFailure("pin-mismatch");
            }
          }
          if (value === null && (input.requireResult || input.method.startsWith("debug_trace") || ["eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getBlockByHash", "eth_getBlockByNumber"].includes(input.method))) {
            missing = true; health.reason = "history-unavailable"; last = "history-unavailable"; continue;
          }
          cursor = index;
          return value;
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof KeelRpcResponseError) {
            if (error.rpcCode !== -32601 && error.providerGasCap === undefined) throw error;
            lastResponse = error; last = error.rpcCode === -32601 ? "method-unavailable" : "gas-capacity"; continue;
          }
          const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unavailable");
          last = failure.reason;
          if (last === "access-denied") throw new KeelRpcSetupError(last, status(input.method), 0, input.method);
          if (last === "pin-mismatch") health.reason = last;
        }
      }
      if (missing && !input.requireResult && !input.method.startsWith("debug_trace")) return null;
      if (lastResponse && ["method-unavailable", "gas-capacity"].includes(last)) {
        lastResponse.method = input.method; lastResponse.providers = status(input.method);
        if (input.method.startsWith("debug_trace")) lastResponse.diagnosis = "unknown";
        throw lastResponse;
      }
      const evidence = status(input.method), cooling = evidence.map(value => value.retryAfterMs).filter(value => value > 0);
      throw new KeelRpcSetupError(missing ? "history-unavailable" : last, evidence, cooling.length ? Math.min(...cooling) : 0, input.method);
    } catch (error) {
      input.signal?.throwIfAborted();
      if (controller.signal.aborted) throw new KeelRpcSetupError("deadline-exceeded", status(input.method), 0, input.method);
      throw error;
    } finally { clearTimeout(timer); }
  } };
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function requestGas(method: string, params: readonly unknown[], supplied?: bigint): bigint | undefined {
  if (supplied !== undefined && (typeof supplied !== "bigint" || supplied < 0n)) throw new TypeError("Invalid required read gas.");
  const calls = method === "eth_simulateV1" ? ((params[0] as { blockStateCalls: { calls: unknown[] }[] }).blockStateCalls.flatMap(value => value.calls)) : [params[0]];
  let gas = supplied;
  for (const value of calls) if (value && typeof value === "object" && "gas" in value && value.gas !== undefined) {
    if (typeof value.gas !== "string" || !/^0x[0-9a-f]{1,32}$/iu.test(value.gas)) throw new TypeError("Invalid read gas quantity.");
    const amount = BigInt(value.gas); gas = gas === undefined || amount > gas ? amount : gas;
  }
  return gas;
}
function validateSimulation(params: readonly unknown[]): void {
  const payload = params[0] as { blockStateCalls?: unknown; validation?: unknown; traceTransfers?: unknown; returnFullTransactions?: unknown } | undefined;
  if (params.length !== 2 || !payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some(key => !["blockStateCalls", "validation", "traceTransfers", "returnFullTransactions"].includes(key))
    || typeof payload.validation !== "boolean" || payload.traceTransfers !== false || payload.returnFullTransactions !== false
    || !Array.isArray(payload.blockStateCalls) || payload.blockStateCalls.length < 1 || payload.blockStateCalls.length > 256
    || payload.blockStateCalls.some(block => !block || typeof block !== "object" || Array.isArray(block)
      || Object.keys(block).some(key => key !== "calls") || !Array.isArray((block as { calls?: unknown }).calls)
      || (block as { calls: unknown[] }).calls.length !== 1)
    || typeof params[1] !== "string" || !/^(?:latest|0x[0-9a-f]+)$/iu.test(params[1])) throw new TypeError("Publication simulation requires bounded exact call blocks without state, balance or code overrides.");
}
function boundedTrace(method: string, params: readonly unknown[]): readonly unknown[] {
  const transaction = method === "debug_traceTransaction", index = transaction ? 1 : 2;
  if (params.length < index || params.length > index + 1 || transaction && (typeof params[0] !== "string" || !/^0x[0-9a-f]{64}$/iu.test(params[0]))) throw new TypeError("Invalid read-only trace request.");
  const options = params[index] as Record<string, unknown> | undefined;
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(key => !["tracer", "timeout", "tracerConfig"].includes(key))
    || options.tracerConfig !== undefined && (!options.tracerConfig || typeof options.tracerConfig !== "object" || Array.isArray(options.tracerConfig)
      || Object.keys(options.tracerConfig).some(key => !["onlyTopCall", "withLog"].includes(key))
      || (options.tracerConfig as Record<string, unknown>).onlyTopCall !== false
      || (options.tracerConfig as Record<string, unknown>).withLog !== false)
    || options.tracer !== undefined && options.tracer !== "callTracer"
    || options.timeout !== undefined && !/^[1-5]s$/u.test(String(options.timeout)))) throw new TypeError("Trace reads require the bounded built-in call tracer.");
  return [...params.slice(0, index), { tracer: "callTracer", timeout: "5s", ...options }];
}
function pinnedParams(method: string, params: readonly unknown[], pin: KeelRpcReadPin): readonly unknown[] {
  if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(pin.blockNumber) || !/^0x[0-9a-f]{64}$/iu.test(pin.blockHash)
    || pin.runtimes !== undefined && (!Array.isArray(pin.runtimes) || pin.runtimes.length > 8 || pin.runtimes.some(value => !/^0x[0-9a-f]{40}$/iu.test(value.address) || !/^0x[0-9a-f]{64}$/iu.test(value.codeHash)))) throw new TypeError("Invalid selected block/runtime pin.");
  const indices: Record<string, number> = { eth_call: 1, eth_estimateGas: 1, eth_simulateV1: 1, debug_traceCall: 1, eth_getCode: 1, eth_getBalance: 1, eth_getTransactionCount: 1, eth_getStorageAt: 2, eth_getProof: 2, eth_getBlockByNumber: 0 };
  if (["debug_traceTransaction", "eth_getTransactionReceipt", "eth_getTransactionByHash"].includes(method)) {
    if (params.length !== (method === "debug_traceTransaction" ? 2 : 1) || typeof params[0] !== "string" || !/^0x[0-9a-f]{64}$/iu.test(params[0])) throw new TypeError("Invalid pinned transaction identity.");
    return params;
  }
  const index = indices[method];
  if (index === undefined) throw new TypeError("This read method does not support block pinning.");
  const result = [...params], block = result[index];
  if (block !== undefined && block !== "latest" && block !== pin.blockNumber) throw new TypeError("RPC request conflicts with the selected block pin.");
  result[index] = pin.blockNumber;
  return result;
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
