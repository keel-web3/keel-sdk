/** Process-local admission for already configured read-only providers. This cache
 * stores availability, never a selected block, project result or proof. */
export interface KeelProviderRequestEvent {
  readonly type: "queued" | "request-start" | "request-complete" | "request-failed" | "retry-wait" | "capability-cache" | "cancelled" | "rpc-response" | "rpc-error";
  readonly providerId: string;
  readonly chainId: number;
  readonly requestId: number;
  readonly method: string;
  readonly elapsedMs: number;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly queuedRequests: number;
  readonly activeRequests: number;
  readonly retryAt?: number;
  readonly retryAfterMs?: number;
  /** Private observer only: the exact original failure, never a public UI field. */
  readonly error?: unknown;
  readonly request?: { readonly method: string; readonly params: readonly unknown[] };
  readonly rawResponse?: unknown;
  readonly httpStatus?: number;
  readonly status?: "available" | "unsupported" | "access-denied" | "cooldown";
}
export type KeelProviderRequestObserver = (event: KeelProviderRequestEvent) => void | Promise<void>;
export interface KeelProviderRequestSchedulerOptions {
  readonly chainId: number;
  readonly maximumConcurrency?: number;
  readonly maximumQueuedRequests?: number;
  readonly minIntervalMs?: number;
  readonly maximumAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maximumRetryDelayMs?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitCooldownMs?: number;
  readonly capabilityMaximumAgeMs?: number;
  /** Injectable entropy for deterministic tests; never changes RPC inputs. */
  readonly random?: () => number;
}
export interface KeelProviderScheduledRequest {
  readonly method: string;
  readonly signal?: AbortSignal;
  /** Monotonic deadline including queue, cooldown, attempts and backoff. */
  readonly deadlineAt?: number;
  readonly observe?: KeelProviderRequestObserver;
  /** Stateful-program callers own whole-operation requalification/replay. The
   * scheduler records shared cooldown but must not retry the physical RPC. */
  readonly retryMode?: "scheduler" | "caller";
  /** A public-only capability report may lower attempts without changing the
   * shared provider policy or weakening another check's rate limits. */
  readonly maximumAttempts?: 1 | 2 | 3;
}
type Failure = { retryable: boolean; retryAfterMs: number; permanent?: "unsupported" | "access-denied"; httpStatus?: number; rpcCode?: number; transportFailure?: string };
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
function classify(error: unknown): Failure {
  const seen = new Set<unknown>();
  for (let value = error, depth = 0; value && depth < 12 && !seen.has(value); depth++) {
    seen.add(value);
    const item = record(value), diagnostic = record(item?.diagnostic);
    const status = item?.status ?? diagnostic?.httpStatus;
    const code = item?.rpcCode ?? diagnostic?.rpcCode ?? item?.code;
    if (status === 401 || status === 403 || code === 401 || code === 403 || item?.reason === "access-denied") return { retryable: false, retryAfterMs: 0, permanent: "access-denied", httpStatus: status === 401 || code === 401 ? 401 : 403 };
    if (code === -32601) return { retryable: false, retryAfterMs: 0, permanent: "unsupported", rpcCode: -32601 };
    const delay = typeof item?.retryAfterMs === "number" && Number.isFinite(item.retryAfterMs) ? Math.max(0, item.retryAfterMs) : 0;
    if (status === 429 || code === 429 || code === -32005 || item?.reason === "rate-limited" || diagnostic?.transportFailure === "rate-limited") return { retryable: true, retryAfterMs: delay, transportFailure: "rate-limited", ...(status === 429 ? { httpStatus: 429 } : {}), ...(code === 429 || code === -32005 ? { rpcCode: code } : {}) };
    if ([502, 503, 504].includes(Number(status))) return { retryable: true, retryAfterMs: delay, httpStatus: Number(status), transportFailure: "http-error" };
    if (["timeout", "connection-reset"].includes(String(diagnostic?.transportFailure))) return { retryable: true, retryAfterMs: delay, transportFailure: String(diagnostic?.transportFailure) };
    value = item?.cause;
  }
  return { retryable: false, retryAfterMs: 0 };
}
function bound(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new TypeError("Provider scheduling configuration exceeds supported bounds.");
  return result;
}
function observe(observer: KeelProviderRequestObserver | undefined, event: KeelProviderRequestEvent): void {
  // Both synchronous throws and asynchronous rejection remain observational.
  try {
    if (!observer) return;
    const snapshot = event.error === undefined ? event : { ...event, error: snapshotKeelProviderPrivateError(event.error) };
    const pending = observer(Object.freeze(snapshot)); if (pending) void Promise.resolve(pending).catch(() => undefined);
  } catch { /* Preserve the RPC result. */ }
}
/** Error structuredClone drops custom own properties such as RPC codes. Copy
 * those descriptors into a detached evidence record without invoking getters. */
export function snapshotKeelProviderPrivateError(error: unknown, depth = 0): unknown {
  if (depth > 12) return { truncated: true, reason: "error-cause-depth" };
  if (!(error instanceof Error)) return structuredClone(error);
  const output: Record<string, unknown> = { name: error.name };
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(error))) {
    if ("value" in descriptor && typeof descriptor.value !== "function") output[key] = key === "cause"
      ? snapshotKeelProviderPrivateError(descriptor.value, depth + 1) : structuredClone(descriptor.value);
  }
  return output;
}
function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancelled = () => { clearTimeout(timer); signal.removeEventListener("abort", cancelled); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancelled); resolve(); }, Math.max(0, ms));
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}
function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener("abort", cancelled); reject(signal.reason); };
    signal.addEventListener("abort", cancelled, { once: true });
    void operation.then(value => { signal.removeEventListener("abort", cancelled); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener("abort", cancelled); reject(signal.aborted ? signal.reason : error); });
    if (signal.aborted) cancelled();
  });
}
const scheduledFailures = new WeakSet<object>();
const deadlineFailures = new WeakSet<object>();
/** Keep retry ownership across fixed-field error wrappers without exposing raw
 * provider errors or adding fields to the public diagnostic. */
export function inheritKeelProviderScheduledFailure(wrapper: object, original: unknown): void {
  if (original !== null && typeof original === "object" && scheduledFailures.has(original)) scheduledFailures.add(wrapper);
  if (original !== null && typeof original === "object" && deadlineFailures.has(original)) deadlineFailures.add(wrapper);
}
export function isKeelProviderScheduledFailure(error: unknown): boolean { return error !== null && typeof error === "object" && scheduledFailures.has(error); }
export function isKeelProviderDeadlineFailure(error: unknown): boolean { return error !== null && typeof error === "object" && deadlineFailures.has(error); }
export class KeelProviderQueueFullError extends Error {
  constructor() { super("The provider's bounded request queue is full. Retry the saved check after active requests finish."); this.name = "KeelProviderQueueFullError"; }
}
/** Fresh structural error for a later caller. Shared availability never retains
 * the originating owner's raw Error, message, request, cause or response. */
export class KeelProviderAvailabilityError extends Error {
  readonly diagnostic: Readonly<Record<string, string | number>>;
  readonly reason?: "access-denied" | "rate-limited";
  readonly code?: number;
  constructor(failure: Failure, readonly retryAfterMs = 0) {
    super(failure.permanent === "unsupported" ? "This provider recently rejected the required method."
      : failure.permanent === "access-denied" ? "This provider recently denied access." : "This provider is cooling down after an observed transient failure.");
    this.name = "KeelProviderAvailabilityError";
    this.diagnostic = Object.freeze({ ...(failure.httpStatus === undefined ? {} : { httpStatus: failure.httpStatus }),
      ...(failure.rpcCode === undefined ? {} : { rpcCode: failure.rpcCode }), ...(failure.transportFailure === undefined ? {} : { transportFailure: failure.transportFailure }) });
    if (failure.permanent === "access-denied") this.reason = "access-denied";
    else if (failure.transportFailure === "rate-limited") this.reason = "rate-limited";
    if (failure.rpcCode !== undefined) this.code = failure.rpcCode;
  }
}
let providerSequence = 0;
export function createKeelProviderRequestScheduler(options: KeelProviderRequestSchedulerOptions) {
  if (!Number.isSafeInteger(options.chainId) || options.chainId < 1) throw new TypeError("Provider scheduling needs the selected chain.");
  const maximumConcurrency = bound(options.maximumConcurrency, 1, 1, 4), maximumQueuedRequests = bound(options.maximumQueuedRequests, 64, 1, 256);
  const minIntervalMs = bound(options.minIntervalMs, 250, 0, 10_000), maximumAttempts = bound(options.maximumAttempts, 3, 1, 3);
  const baseRetryDelayMs = bound(options.baseRetryDelayMs, 500, 1, 30_000), maximumRetryDelayMs = bound(options.maximumRetryDelayMs, 30_000, baseRetryDelayMs, 60_000);
  const threshold = bound(options.circuitFailureThreshold, 3, 1, 10), circuitCooldownMs = bound(options.circuitCooldownMs, 30_000, 1, 300_000);
  const capabilityAge = bound(options.capabilityMaximumAgeMs, 60_000, 1, 300_000);
  const providerId = `provider-${++providerSequence}`, random = options.random ?? Math.random;
  const capabilities = new Map<string, { status: "available" | "unsupported" | "access-denied"; expiresAt: number; failure?: Failure }>();
  const cacheCapability = (key: string, value: { status: "available" | "unsupported" | "access-denied"; expiresAt: number; failure?: Failure }) => {
    if (!capabilities.has(key) && capabilities.size >= 64) {
      const expendable = [...capabilities].find(([, entry]) => entry.expiresAt <= Date.now() || entry.status === "available")?.[0];
      const oldest = expendable ?? capabilities.keys().next().value;
      if (oldest !== undefined) capabilities.delete(oldest);
    }
    capabilities.set(key, value);
  };
  let active = 0, sequence = 0, nextAt = 0, cooldownUntil = 0, failures = 0, lastFailure: Failure | undefined;
  type Waiter = { admit(): void; cancel(): void };
  const queue: Waiter[] = [];
  const flush = () => { while (active < maximumConcurrency && queue.length) { active++; queue.shift()!.admit(); } };
  const acquire = (signal: AbortSignal): Promise<() => void> => {
    signal.throwIfAborted();
    if (queue.length >= maximumQueuedRequests) throw new KeelProviderQueueFullError();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { admit() { signal.removeEventListener("abort", waiter.cancel); let released = false;
        resolve(() => { if (!released) { released = true; active--; flush(); } }); },
      cancel() { const index = queue.indexOf(waiter); if (index >= 0) queue.splice(index, 1); signal.removeEventListener("abort", waiter.cancel); reject(signal.reason); } };
      queue.push(waiter); signal.addEventListener("abort", waiter.cancel, { once: true });
      if (signal.aborted) waiter.cancel(); else flush();
    });
  };
  const cached = (method: string) => {
    for (const key of ["*", method]) { const entry = capabilities.get(key); if (entry && entry.expiresAt > Date.now()) return entry; if (entry) capabilities.delete(key); }
    return undefined;
  };
  return {
    providerId,
    status() { return Object.freeze({ providerId, chainId: options.chainId, activeRequests: active, queuedRequests: queue.length,
      retryAfterMs: Math.max(0, cooldownUntil - Date.now()), cachedMethods: capabilities.size }); },
    /** Invalidate availability after an explicit provider/chain configuration change.
     * Existing requests retain their own cancellation; no proof is ever cached. */
    invalidateCapabilities() { capabilities.clear(); },
    async run<T>(input: KeelProviderScheduledRequest, execute: (signal: AbortSignal, context: { readonly requestId: number; readonly attempt: number }) => Promise<T>): Promise<T> {
      if (typeof input.method !== "string" || !/^[a-z][a-z0-9_]{0,127}$/iu.test(input.method)) throw new TypeError("Provider scheduling needs a bounded RPC method name.");
      const started = performance.now(), deadlineAt = input.deadlineAt ?? started + 120_000;
      if (!Number.isFinite(deadlineAt) || deadlineAt - started > 120_001) throw new TypeError("Provider requests need a deadline within 120 seconds.");
      if (deadlineAt <= started) throw new DOMException("The bounded provider request expired.", "TimeoutError");
      const attempts = input.retryMode === "caller" ? 1 : bound(input.maximumAttempts, maximumAttempts, 1, maximumAttempts);
      const timeout = new AbortController();
      const signal = input.signal ? AbortSignal.any([input.signal, timeout.signal]) : timeout.signal;
      const timer = setTimeout(() => timeout.abort(new DOMException("The bounded provider request expired.", "TimeoutError")), Math.max(0, deadlineAt - started));
      const requestId = ++sequence;
      let attempt = 0;
      const emit = (type: KeelProviderRequestEvent["type"], fields: Partial<KeelProviderRequestEvent> = {}) => observe(input.observe, {
        type, providerId, chainId: options.chainId, requestId, method: input.method, elapsedMs: Math.max(0, performance.now() - started),
        attempt, maximumAttempts: attempts, queuedRequests: queue.length, activeRequests: active, ...fields });
      try {
        signal.throwIfAborted();
        const capability = cached(input.method);
        if (capability && capability.status !== "available") { const error = new KeelProviderAvailabilityError(capability.failure!); emit("capability-cache", { status: capability.status, error }); throw error; }
        for (attempt = 1; attempt <= attempts; attempt++) {
          emit("queued");
          const release = await acquire(signal);
          let physicalOperation: Promise<T> | undefined;
          try {
            // Re-read cooldown after admission: a preceding request may just have
            // reported 429. No queued request may race past that observation.
            for (;;) {
              signal.throwIfAborted();
              const now = Date.now(), wait = Math.max(nextAt, cooldownUntil) - now;
              if (wait <= 0) break;
              emit("retry-wait", { retryAt: now + wait, retryAfterMs: wait, status: "cooldown" });
              if (wait > maximumRetryDelayMs || performance.now() + wait >= deadlineAt) throw lastFailure ? new KeelProviderAvailabilityError(lastFailure, wait) : new DOMException("The provider cooldown exceeds this check's time budget.", "TimeoutError");
              await pause(wait, signal);
            }
            const freshCapability = cached(input.method);
            if (freshCapability && freshCapability.status !== "available") { const error = new KeelProviderAvailabilityError(freshCapability.failure!); emit("capability-cache", { status: freshCapability.status, error }); throw error; }
            nextAt = Date.now() + minIntervalMs;
            emit("request-start");
            try {
              physicalOperation = execute(signal, { requestId, attempt });
              const result = await withAbort(physicalOperation, signal);
              signal.throwIfAborted(); failures = 0;
              cacheCapability(input.method, { status: "available", expiresAt: Date.now() + capabilityAge });
              emit("request-complete", { status: "available" }); return result;
            } catch (error) {
              signal.throwIfAborted();
              const failure = classify(error);
              emit("request-failed", { error });
              if (failure.permanent) {
                cacheCapability(failure.permanent === "access-denied" ? "*" : input.method,
                  { status: failure.permanent, expiresAt: Date.now() + capabilityAge, failure });
                throw error;
              }
              if (!failure.retryable) throw error;
              failures++; lastFailure = failure;
              const entropy = random(), unit = Number.isFinite(entropy) ? Math.max(0, Math.min(1, entropy)) : 1;
              // Equal jitter keeps a positive exponential floor, with a bounded
              // upper limit. A provider's Retry-After is always a lower bound.
              const ceiling = Math.min(maximumRetryDelayMs, baseRetryDelayMs * 2 ** Math.min(16, failures - 1));
              const delay = Math.max(failure.retryAfterMs, Math.ceil(ceiling * (0.5 + unit * 0.5)), failures >= threshold ? circuitCooldownMs : 0);
              cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
              emit("retry-wait", { retryAt: cooldownUntil, retryAfterMs: Math.max(0, cooldownUntil - Date.now()), status: "cooldown", error });
              if (attempt === attempts || delay > maximumRetryDelayMs || performance.now() + delay >= deadlineAt) {
                if (input.retryMode !== "caller" && error !== null && typeof error === "object") scheduledFailures.add(error);
                throw error;
              }
            }
          } finally {
            // A hostile/nonconforming transport may ignore abort. End the
            // caller's wait, but keep its physical slot until it really settles.
            const physicallyFinished = () => { nextAt = Math.max(nextAt, Date.now() + minIntervalMs); release(); };
            if (physicalOperation) void physicalOperation.then(physicallyFinished, physicallyFinished); else release();
          }
        }
        throw new KeelProviderAvailabilityError(lastFailure ?? { retryable: false, retryAfterMs: 0 });
      } catch (error) {
        if (timeout.signal.aborted && error !== null && typeof error === "object") deadlineFailures.add(error);
        if (signal.aborted) emit("cancelled", { error: signal.reason }); throw error;
      }
      finally { clearTimeout(timer); }
    },
  };
}

// Fetch implementations identify a transport configuration without retaining
// credentials in diagnostics. Different chain/provider keys never share facts.
const shared = new WeakMap<object, Map<string, { scheduler: ReturnType<typeof createKeelProviderRequestScheduler>; policy: string; random: () => number }>>();
const productionScope = {};
export function sharedKeelProviderRequestScheduler(providerKey: string, options: KeelProviderRequestSchedulerOptions, scope: object = productionScope) {
  let providers = shared.get(scope);
  if (!providers) { providers = new Map(); shared.set(scope, providers); }
  const key = JSON.stringify([options.chainId, providerKey]);
  const policy = JSON.stringify([options.maximumConcurrency ?? 1, options.maximumQueuedRequests ?? 64, options.minIntervalMs ?? 250,
    options.maximumAttempts ?? 3, options.baseRetryDelayMs ?? 500, options.maximumRetryDelayMs ?? 30_000,
    options.circuitFailureThreshold ?? 3, options.circuitCooldownMs ?? 30_000, options.capabilityMaximumAgeMs ?? 60_000]);
  const random = options.random ?? Math.random;
  let entry = providers.get(key);
  if (entry && (entry.policy !== policy || entry.random !== random)) throw new TypeError("Concurrent checks must use one consistent scheduling policy for this provider and chain.");
  if (!entry) {
    if (providers.size >= 128) throw new RangeError("The process has reached its bounded configured-provider scheduler limit.");
    entry = { scheduler: createKeelProviderRequestScheduler(options), policy, random }; providers.set(key, entry);
  }
  return entry.scheduler;
}
