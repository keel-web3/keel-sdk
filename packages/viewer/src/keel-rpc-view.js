/**
 * The Keel RPC module, in the form a sealed on-chain document can carry.
 *
 * `@keel/protocol`'s `keel-rpc` is the same idea for everything that runs off
 * chain — the SDK, the MCP server, a build script, a host. A viewer document
 * stored in KeelHold cannot import a package: it is one bundled file, every
 * byte of it costs about 225 gas forever, and it has to run inside whatever
 * sandbox a marketplace puts it in. So this is the small twin, deliberately
 * dependency-free, deliberately the same shape:
 *
 *     const chain = createKeelChain({ rpc, keelHold, hosts });
 *     const artwork = await chain.haulObject(assetObjectId);
 *
 * A script that reads an object writes the same line here as it would in Node.
 * The JSON-RPC envelope, the endpoint failover, and the ABI decoding are the
 * module's problem, not the artwork's.
 *
 * ## Two things this deliberately does not do
 *
 * It does not pretend the read is free of hosts. `disclosure()` names the
 * endpoint that answered so the panel can show it. Hiding the plumbing from
 * whoever writes a viewer is ergonomics; hiding it from whoever is deciding
 * whether to trust the token is a lie, and a viewer that says "nothing is
 * fetched" while holding a socket open is worse than one that admits it.
 *
 * It does not become a second opinion on which hosts are acceptable.
 * `remoteUrlAllowed` in `@keel/protocol` is the authority on that, and
 * `rpcHostAllowed` below is a byte-for-byte mirror of its rules for the one
 * case that cannot import it. `tests/keel-rpc-policy.test.mjs` runs both
 * over the same vector table, so the mirror cannot drift without the gate
 * failing.
 */

/** `KeelHold.haulObject(bytes32)`. */
export const KEEL_READ_OBJECT_SELECTOR = "0xed12d693";

/**
 * The governed host list as it stood when this document was sealed. A document
 * is immutable, so this is a snapshot, not a live read — `revision` and `epoch`
 * are stamped alongside it precisely so a reader can tell how old the snapshot
 * is and go compare it against `KeelManager.rpcHostList` themselves.
 */
export const KEEL_VIEW_RPC_HOSTS = [
  "publicnode.com",
  "rpc.thirdweb.com",
  "rpc.ankr.com",
  "cloudflare-eth.com",
  "base.org",
  "g.alchemy.com",
  "infura.io",
  "quiknode.pro",
  "drpc.org",
];

/** Mirror of `remoteUrlAllowed(url, hosts, false)`. See the header note. */
export function rpcHostAllowed(url, hosts) {
  if (!hosts || hosts.length === 0) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.protocol !== "https:") return false;
  // Private, loopback, link-local, and carrier-grade-NAT hosts: a sealed
  // document must never be usable to probe the reader's own network. A faithful
  // port of `isPrivateNetworkHost`, including the parts that look redundant —
  // the 0-255 octet bound matters, because without it a malformed literal like
  // "999.1.1.1" is refused here and allowed there, and a mirror that disagrees
  // anywhere is a mirror nobody can reason about.
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  const parts = host.split(".");
  const octets = parts.length === 4 && parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part))
    ? parts.map(Number)
    : null;
  const privateV4 = (values) => {
    if (values === null || values.some((value) => value < 0 || value > 255)) return false;
    const [a, b] = values;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168))
      || (a === 198 && (b === 18 || b === 19));
  };
  if (privateV4(octets)) return false;
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return false;
    if (host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) return false;
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      const values = mapped[1].split(".").map(Number);
      if (privateV4(values.every((value) => Number.isInteger(value)) ? values : null)) return false;
    }
  }
  return hosts.some((entry) => {
    if (entry.startsWith("https://") || entry.startsWith("http://")) {
      let allowed;
      try {
        allowed = new URL(entry);
      } catch {
        return false;
      }
      const prefix = allowed.pathname.endsWith("/") ? allowed.pathname : `${allowed.pathname}/`;
      return parsed.origin === allowed.origin
        && (parsed.pathname === allowed.pathname || parsed.pathname.startsWith(prefix));
    }
    return parsed.hostname === entry || parsed.hostname.endsWith(`.${entry}`);
  });
}

/** Origins only: an endpoint URL routinely carries an API key in its path. */
export function redactEndpoint(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" && parsed.search === "" ? parsed.origin : `${parsed.origin}/…`;
  } catch {
    return "unreadable endpoint";
  }
}

/**
 * A chain the document can read, with the transport underneath.
 *
 * @param rpc         one endpoint, or several to fail over between
 * @param keelHold  the store `haulObject` reads from
 * @param hosts       the governed list; endpoints outside it are dropped, not
 *                    used and reported afterwards
 * @param expectedChainId optional positive safe integer; every endpoint must
 *                    prove this identity before it can serve artwork reads
 * @param timeoutMs   deadline for each HTTP request, including its JSON body
 */
export function createKeelChain({ rpc, keelHold, hosts = KEEL_VIEW_RPC_HOSTS, listRevision = 0, listEpoch = 0, fetchImpl, expectedChainId, timeoutMs = 8000, signal, maxConcurrentReads = 4, maxRetries = 0, retryDelayMs = 250, maxResponseBytes = 32 * 1024 * 1024, maxCacheBytes = 32 * 1024 * 1024 }) {
  if (expectedChainId !== undefined && (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1)) {
    throw new TypeError("expectedChainId must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError("timeoutMs must be an integer between 1 and 30000");
  }
  for (const [name, value, maximum] of [["maxConcurrentReads", maxConcurrentReads, 64], ["maxRetries", maxRetries, 3], ["retryDelayMs", retryDelayMs, 5000], ["maxResponseBytes", maxResponseBytes, Number.MAX_SAFE_INTEGER], ["maxCacheBytes", maxCacheBytes, Number.MAX_SAFE_INTEGER]]) {
    if (!Number.isSafeInteger(value) || value < (name === "maxRetries" || name === "maxCacheBytes" ? 0 : 1) || value > maximum) throw new TypeError(`Invalid ${name}`);
  }
  const candidates = (Array.isArray(rpc) ? rpc : [rpc]).filter((url) => typeof url === "string" && url.length > 0);
  const endpoints = candidates.filter((url) => rpcHostAllowed(url, hosts));
  const rejected = candidates.filter((url) => !rpcHostAllowed(url, hosts));
  const request = fetchImpl ?? ((...args) => fetch(...args));
  const identities = new Map();
  let servedBy = null;
  let reads = 0;
  let nextId = 0;
  let pinnedBlock = null;
  let pinning = null;

  const validBlock = (block) => block !== null && typeof block === "object" && !Array.isArray(block)
    && typeof block.number === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(block.number)
    && typeof block.hash === "string" && /^0x[0-9a-f]{64}$/iu.test(block.hash);

  let terminalError = null, active = 0, abandoned = 0, head = null, tail = null, cachedBytes = 0;
  const controllers = new Set(), pendingCancellations = new Set(), cooldown = new Map(), cache = new Map(), inflight = new Map();
  let cacheGeneration = 0;
  const fault = (endpoint, code, terminal = false, extra = {}) => Object.assign(new Error(`RPC request ${code === "timeout" ? "timed out" : "failed"} (${redactEndpoint(endpoint)})`), { code, terminal, ...extra });
  function drain() {
    while (head && (terminalError || signal?.aborted || active < maxConcurrentReads || abandoned && active >= maxConcurrentReads)) {
      const item = head; head = item.next; if (!head) tail = null;
      if (terminalError || signal?.aborted || abandoned && active >= maxConcurrentReads) { item.reject(terminalError ?? signal?.reason ?? Object.assign(new Error("RPC timed-out physical window is still occupied; resume after it settles."), { code: "timeout", noFallback: true })); continue; }
      active++; let released = false;
      item.resolve(() => { if (!released) { released = true; active--; drain(); } });
    }
  }
  function acquire() {
    if (terminalError || signal?.aborted) return Promise.reject(terminalError ?? signal.reason ?? new Error("RPC cancelled"));
    if (abandoned && active >= maxConcurrentReads) return Promise.reject(Object.assign(new Error("RPC timed-out physical window is still occupied; resume after it settles."), { code: "timeout", noFallback: true }));
    if (active < maxConcurrentReads && !head) { active++; let released = false; return () => { if (!released) { released = true; active--; drain(); } }; }
    return new Promise((resolve, reject) => { const item = { resolve, reject, next: null }; if (tail) tail.next = item; else head = item; tail = item; drain(); });
  }
  function cancelPending(reason) {
    for (const cancel of pendingCancellations) cancel(reason);
    for (const controller of controllers) controller.abort(reason);
    while (head) { const item = head; head = item.next; item.reject(reason); } tail = null;
  }
  const abort = () => { cancelPending(signal?.reason ?? new Error("RPC cancelled")); drain(); };
  signal?.addEventListener("abort", abort, { once: true });
  const stop = error => { terminalError = error; cancelPending(error); drain(); return error; };
  function semanticFailure(value) {
    const work = [[value, 0]]; let examined = 0;
    while (work.length && examined++ < 32) {
      const [node, depth] = work.pop(); if (!node || typeof node !== "object" || depth > 6) continue;
      const message = typeof node.message === "string" ? node.message.slice(0, 2048) : "";
      if (node.code === 3 || /\bexecution reverted\b/iu.test(message)) return "execution-reverted";
      if ([401, 403].includes(node.status) || [401, 403].includes(node.httpStatus) || /^(?:unauthori[sz]ed|forbidden|access denied)\b/iu.test(message)) return "access-denied";
      for (const key of ["cause", "error", "data"]) { const child = node[key]; if (Array.isArray(child)) for (const entry of child.slice(0, 8)) work.push([entry, depth + 1]); else if (child && typeof child === "object") work.push([child, depth + 1]); }
    }
    return null;
  }
  function httpErrorFailure(text, contentType, id) {
    const sample = text.trim();
    if (/json/iu.test(contentType) || /^[\[{]/u.test(sample)) {
      let body; try { body = JSON.parse(sample); } catch { return "unclassified-http-error"; }
      const semantic = semanticFailure(body); if (semantic) return semantic;
      if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== id) return "unclassified-http-error";
      if (!Object.hasOwn(body, "error") && Object.hasOwn(body, "result")) return null;
      const error = body.error;
      if (error && typeof error === "object" && !Array.isArray(error) && [-32005, 429].includes(error.code)
        && Object.keys(error).every(key => ["code", "message", "data"].includes(key))
        && (error.data === undefined || error.data === null || typeof error.data !== "object")) return null;
      return "unclassified-http-error";
    }
    if (/\b(?:unauthori[sz]ed|forbidden|access denied)\b/iu.test(sample)) return "access-denied";
    if (/\b(?:revert(?:ed|ing)?|execution failed)\b/iu.test(sample)) return "execution-reverted";
    return null; // Complete bounded plain-text HTTP transport failure.
  }
  async function pause(ms) {
    if (signal?.aborted) throw signal.reason;
    await new Promise((resolve, reject) => { const onAbort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms); signal?.addEventListener("abort", onAbort, { once: true }); });
  }
  async function sendOnce(endpoint, method, params) {
    const lease = acquire(), release = typeof lease === "function" ? lease : await lease;
    if (terminalError || signal?.aborted) { release(); throw terminalError ?? signal.reason; }
    const controller = new AbortController(), id = ++nextId; controllers.add(controller);
    let timer, timedOut = false, physicallySettled = false, abandonedLease = false, cancel, errorBodyPending = false;
    const markAbandoned = () => { if (!physicallySettled && !abandonedLease) { abandonedLease = true; abandoned++; } };
    const cancelled = new Promise((_, reject) => { cancel = reason => { markAbandoned(); reject(reason?.terminal ? reason : Object.assign(new Error("RPC client request cancelled"), { code: "cancelled", noFallback: true })); }; pendingCancellations.add(cancel); });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; markAbandoned(); controller.abort(); drain(); reject(errorBodyPending ? stop(fault(endpoint, "unclassified-http-error", true)) : fault(endpoint, "timeout", false, { noFallback: active >= maxConcurrentReads })); }, timeoutMs); });
    // Release the physical slot only when fetch AND the response body settle.
    // An injected transport ignoring abort cannot create unbounded hidden reads.
    const physical = (async () => {
      const response = await request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", signal: controller.signal });
      if ([401, 403].includes(response?.status)) throw stop(fault(endpoint, "access-denied", true));
      if (response?.ok !== true || response.redirected) {
        if (response?.ok !== true) {
        errorBodyPending = true;
        if (response.body?.getReader) {
          const reader = response.body.getReader(); let bytes = 0, sample = "";
          try { const decoder = new TextDecoder("utf-8", { fatal: true }); for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 65536) throw stop(fault(endpoint, "unclassified-http-error", true)); sample += decoder.decode(next.value, { stream: true }); } sample += decoder.decode();
            const reason = httpErrorFailure(sample, response.headers?.get?.("content-type") ?? "", id); if (reason) throw stop(fault(endpoint, reason, true));
            errorBodyPending = false;
          } catch (error) { if (error?.terminal) throw error; throw stop(fault(endpoint, "unclassified-http-error", true)); } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } else {
          const reason = response.body === null ? httpErrorFailure("", response.headers?.get?.("content-type") ?? "", id) : "unclassified-http-error";
          if (reason) throw stop(fault(endpoint, reason, true));
          errorBodyPending = false;
        }
        }
        const text = response?.headers?.get?.("retry-after");
        const retryAfterMs = text && /^\d+(?:\.\d+)?$/u.test(text) ? Number(text) * 1000 : text ? Math.max(0, Date.parse(text) - Date.now()) : 0;
        if (response?.status === 429 && Number.isFinite(retryAfterMs)) cooldown.set(endpoint, Date.now() + retryAfterMs);
        await response?.body?.cancel?.().catch(() => {});
        throw fault(endpoint, "http", false, { retryable: [429, 502, 503, 504].includes(response?.status), retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : 0 });
      }
      let body;
      if (response.body?.getReader) {
        const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true }), chunks = []; let bytes = 0;
        try { for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > maxResponseBytes) throw fault(endpoint, "response-too-large", false, { noFallback: true }); chunks.push(decoder.decode(next.value, { stream: true })); } chunks.push(decoder.decode()); body = JSON.parse(chunks.join("")); }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else { body = await response.json(); if (new TextEncoder().encode(JSON.stringify(body)).length > maxResponseBytes) throw fault(endpoint, "response-too-large", false, { noFallback: true }); }
      const semantic = semanticFailure(body?.error);
      if (semantic) throw stop(fault(endpoint, semantic, true));
      if (body === null || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || body.id !== id || "error" in body
        || (method === "eth_getBlockByNumber" ? !validBlock(body.result) : typeof body.result !== "string")
        || (["eth_call", "eth_getCode"].includes(method) && !/^0x(?:[0-9a-f]{2})*$/iu.test(body.result))) throw fault(endpoint, "invalid-response");
      return body.result;
    })();
    const settled = () => { physicallySettled = true; if (abandonedLease) abandoned--; release(); };
    void physical.then(settled, settled);
    try { return await Promise.race([deadline, physical, cancelled]); }
    catch (error) { controller.abort(); if (signal?.aborted) throw signal.reason; const semantic = semanticFailure(error); if (semantic) throw stop(fault(endpoint, semantic, true)); if (errorBodyPending && !error?.terminal) throw stop(fault(endpoint, "unclassified-http-error", true)); if (error?.terminal || error?.code) throw error; throw fault(endpoint, timedOut ? "timeout" : "transport"); }
    finally { clearTimeout(timer); controllers.delete(controller); pendingCancellations.delete(cancel); }
  }
  async function send(endpoint, method, params) {
    for (let attempt = 0; ; attempt++) {
      if (terminalError) throw terminalError;
      const remaining = (cooldown.get(endpoint) ?? 0) - Date.now();
      if (remaining > 5000) throw fault(endpoint, "rate-limited", false, { noFallback: true, retryAfterMs: remaining });
      if (remaining > 0) await pause(remaining);
      try { return await sendOnce(endpoint, method, params); }
      catch (error) {
        if (error?.terminal || error?.noFallback || signal?.aborted || attempt >= maxRetries || !(error?.retryable || error?.code === "timeout" || error?.code === "transport")) throw error;
        const delay = Math.max(error.retryAfterMs ?? 0, retryDelayMs * 2 ** attempt);
        if (delay > 5000) throw Object.assign(error, { noFallback: true });
        await pause(delay);
      }
    }
  }

  async function checkChain(endpoint, force) {
    let state = identities.get(endpoint);
    if (!state) {
      state = { chainId: null, checking: null, wrongChain: false, blockHash: null, checkingBlock: null, wrongBlock: false };
      identities.set(endpoint, state);
    }
    const wrongNetwork = () => new Error(`Wrong artwork network (${redactEndpoint(endpoint)})`);
    if (state.wrongChain) throw wrongNetwork();
    if (state.checking) return state.checking;
    if (!force && state.chainId !== null) return state.chainId;
    if (!state.checking) {
      // A native chunk fan-out shares one check for this exact endpoint.
      state.checking = (async () => {
        const result = await send(endpoint, "eth_chainId", []);
        if (!/^0x[0-9a-f]+$/iu.test(result)) throw new Error(`Invalid RPC chain identity (${redactEndpoint(endpoint)})`);
        if (BigInt(result) !== BigInt(expectedChainId)) {
          state.wrongChain = true;
          throw wrongNetwork();
        }
        state.chainId = result;
        return result;
      })().finally(() => { state.checking = null; });
    }
    return state.checking;
  }

  async function checkBlock(endpoint) {
    const state = identities.get(endpoint);
    const wrongBlock = () => new Error(`Wrong artwork block (${redactEndpoint(endpoint)})`);
    if (state.wrongBlock) throw wrongBlock();
    if (state.blockHash === pinnedBlock.hash) return;
    if (!state.checkingBlock) {
      state.checkingBlock = (async () => {
        const block = await send(endpoint, "eth_getBlockByNumber", [pinnedBlock.number, false]);
        if (BigInt(block.number) !== BigInt(pinnedBlock.number) || block.hash.toLowerCase() !== pinnedBlock.hash) {
          state.wrongBlock = true;
          throw wrongBlock();
        }
        state.blockHash = pinnedBlock.hash;
      })().finally(() => { state.checkingBlock = null; });
    }
    await state.checkingBlock;
  }

  async function pinBlock() {
    if (expectedChainId === undefined) throw new TypeError("pinBlock requires expectedChainId");
    if (pinnedBlock) return pinnedBlock;
    if (!pinning) {
      pinning = (async () => {
        const block = await rpcCall("eth_getBlockByNumber", ["latest", false]);
        pinnedBlock = Object.freeze({ number: block.number, hash: block.hash.toLowerCase() });
        return pinnedBlock;
      })().finally(() => { pinning = null; });
    }
    return pinning;
  }

  async function rpcCallUncached(method, params) {
    if (terminalError || signal?.aborted) throw terminalError ?? signal.reason;
    const pinnedRead = pinnedBlock !== null && (method === "eth_call" || method === "eth_getCode");
    // EIP-1898 binds the read itself to the verified hash, even if the provider
    // reorganizes after its header check. Unsupported nodes fail over; never
    // silently downgrade a pinned read to a numeric block or latest.
    if (pinnedRead) params = [params[0], { blockHash: pinnedBlock.hash, requireCanonical: true }, ...params.slice(2)];
    let last = null;
    for (const endpoint of endpoints) {
      try {
        const chainId = expectedChainId === undefined ? null : await checkChain(endpoint, method === "eth_chainId");
        if (pinnedRead) await checkBlock(endpoint);
        const result = chainId !== null && method === "eth_chainId" ? chainId : await send(endpoint, method, params);
        servedBy = endpoint;
        reads += 1;
        return result;
      } catch (error) {
        // A provider that failed must prove its network again before reuse.
        const state = identities.get(endpoint);
        if (state) { state.chainId = null; state.blockHash = null; }
        last = error;
        if (error?.terminal || error?.noFallback || signal?.aborted) throw error;
      }
    }
    throw last ?? new Error("no permitted RPC endpoint");
  }

  function rpcCall(method, params = []) {
    if (terminalError || signal?.aborted) return Promise.reject(terminalError ?? signal.reason);
    // Bind the key and physical operation to one immutable JSON snapshot before
    // chain qualification, queueing, deduplication or any other async boundary.
    try { params = JSON.parse(JSON.stringify(params)); if (!Array.isArray(params)) throw new TypeError(); }
    catch { return Promise.reject(new TypeError("RPC parameters must be a JSON-serializable array.")); }
    const pinnedRead = pinnedBlock && ["eth_call", "eth_getCode"].includes(method);
    if (pinnedRead) params = [params[0], { blockHash: pinnedBlock.hash, requireCanonical: true }, ...params.slice(2)];
    const key = pinnedRead ? JSON.stringify([expectedChainId, pinnedBlock.hash, method, params]) : null;
    if (!key || maxCacheBytes === 0) return rpcCallUncached(method, params);
    if (cache.has(key)) { const entry = cache.get(key); cache.delete(key); cache.set(key, entry); return Promise.resolve(entry.value); }
    if (inflight.has(key)) return inflight.get(key);
    const generation = cacheGeneration;
    const pending = rpcCallUncached(method, params).then(value => {
      const bytes = value.length * 2 + key.length * 2 + 128;
      if (generation === cacheGeneration && bytes <= maxCacheBytes) { while (cachedBytes + bytes > maxCacheBytes && cache.size) { const first = cache.keys().next().value; cachedBytes -= cache.get(first).bytes; cache.delete(first); } cache.set(key, { value, bytes }); cachedBytes += bytes; }
      return value;
    }).finally(() => inflight.delete(key));
    inflight.set(key, pending); return pending;
  }

  return {
    get endpointCount() {
      return endpoints.length;
    },

    /** Drop unverified transport replies after an integrity failure; verified object resume cache is separate. */
    clearReadCache() { cache.clear(); cachedBytes = 0; cacheGeneration++; },
    /** Explicit all-client cancellation. Use an exclusive client per work/owner. */
    cancelPending(reason = new Error("RPC client cancelled")) { cancelPending(reason); },

    /** Shared transport for bounded native chunk reads and chain checks. */
    request: rpcCall,

    /** Await before artwork reads; requires matching headers and EIP-1898 reads. */
    pinBlock,

    /** An arbitrary read, shaped like the contract call it is. */
    call(to, data, blockTag = "latest") {
      return rpcCall("eth_call", [{ to, data }, blockTag]);
    },

    /**
     * The bytes of one Keel object. This is the whole reason a hybrid
     * document is small: the artwork stays a referenced object on chain instead
     * of a quarter-megabyte of base64 inside every `animation_url`.
     */
    async haulObject(objectId, store = keelHold) {
      const id = String(objectId).replace(/^0x/, "").padStart(64, "0");
      const result = await this.call(store, `${KEEL_READ_OBJECT_SELECTOR}${id}`);
      const hex = result.slice(2);
      const length = parseInt(hex.slice(64, 128), 16);
      if (!Number.isFinite(length)) throw new Error("object length is unreadable");
      const body = hex.slice(128, 128 + length * 2);
      if (body.length !== length * 2) throw new Error("object is shorter than it claims");
      return Uint8Array.from(body.match(/../g) || [], (byte) => parseInt(byte, 16));
    },

    /** What the panel shows about how these bytes were obtained. */
    disclosure() {
      return {
        endpoints: endpoints.map(redactEndpoint),
        rejected: rejected.map(redactEndpoint),
        servedBy: servedBy === null ? null : redactEndpoint(servedBy),
        listRevision,
        listEpoch,
        reads,
        activeRequests: active, physicalRequests: nextId, cachedBytes,
        ...(pinnedBlock === null ? {} : { pinnedBlock }),
      };
    },
  };
}
