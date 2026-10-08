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
export function createKeelChain({ rpc, keelHold, hosts = KEEL_VIEW_RPC_HOSTS, listRevision = 0, listEpoch = 0, fetchImpl, expectedChainId, timeoutMs = 8000 }) {
  if (expectedChainId !== undefined && (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1)) {
    throw new TypeError("expectedChainId must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new TypeError("timeoutMs must be an integer between 1 and 30000");
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

  async function send(endpoint, method, params) {
    const controller = new AbortController();
    const id = ++nextId;
    let timedOut = false;
    let timer;
    // Race the complete request, not only fetch: a body or injected transport
    // may stall without observing AbortSignal. Late results never become reads.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("RPC timeout"));
        controller.abort();
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await request(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
          redirect: "error",
          signal: controller.signal,
        });
        if (response?.ok !== true || response.redirected) throw new Error("RPC HTTP failure");
        const body = await response.json();
        if (body === null || typeof body !== "object" || Array.isArray(body)
          || body.jsonrpc !== "2.0" || body.id !== id || "error" in body
          || (method === "eth_getBlockByNumber" ? !validBlock(body.result) : typeof body.result !== "string")
          || (["eth_call", "eth_getCode"].includes(method) && !/^0x(?:[0-9a-f]{2})*$/iu.test(body.result))) {
          throw new Error("RPC invalid response");
        }
        return body.result;
      })()]);
    } catch {
      // Fetch/JSON/provider error text can contain API keys or the entire URL.
      controller.abort();
      throw new Error(`RPC request ${timedOut ? "timed out" : "failed"} (${redactEndpoint(endpoint)})`);
    } finally {
      clearTimeout(timer);
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

  async function rpcCall(method, params) {
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
      }
    }
    throw last ?? new Error("no permitted RPC endpoint");
  }

  return {
    get endpointCount() {
      return endpoints.length;
    },

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
        ...(pinnedBlock === null ? {} : { pinnedBlock }),
      };
    },
  };
}
