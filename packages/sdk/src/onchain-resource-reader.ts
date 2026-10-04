/** Canonical outer-shell reader. Never installed in, or delegated to, creator code. */
export interface KeelBinaryIntegrity {
  readonly algorithm: "sha256";
  readonly digest: `0x${string}`;
  readonly byteLength: number;
}
export interface KeelBinaryResource {
  readonly id: string;
  readonly chainId?: number;
  readonly store?: string;
  readonly objectId?: `0x${string}`;
  readonly integrity: KeelBinaryIntegrity;
  readonly onchain?: {
    readonly storeKind?: "keel-hold";
    readonly compression?: "none" | "gzip" | "deflate" | "brotli" | "lzma";
    readonly containerId?: `0x${string}`;
    readonly offset?: number;
    readonly storedIntegrity?: KeelBinaryIntegrity;
    /** Exact decoded member slice of one immutable compressed container. */
    readonly range?: { readonly offset: number; readonly containerIntegrity: KeelBinaryIntegrity };
  };
}
export interface KeelBinaryContainer {
  readonly id: `0x${string}`;
  readonly chainId: number;
  readonly store: string;
  readonly objectId: `0x${string}`;
  readonly compression: "none" | "gzip" | "deflate" | "brotli" | "lzma";
  readonly storedIntegrity: KeelBinaryIntegrity;
  readonly integrity: KeelBinaryIntegrity;
}

const MAX_STORED = 4 * 1024 * 1024;
const MAX_DECODED = 32 * 1024 * 1024;
const MAX_TOTAL_STORED = 16 * 1024 * 1024;
const MAX_REQUESTS = 1024;
const MAX_POINTERS = 1024;
const HEX = /^0x(?:[0-9a-f]{2})*$/iu;
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const HASH = /^0x[0-9a-f]{64}$/iu;
const decoder = new TextDecoder("utf-8", { fatal: true });
const integer = (value: unknown, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new RangeError(`Invalid ${label}.`);
  return value as number;
};
const integrity = (value: KeelBinaryIntegrity | undefined, maximum: number): KeelBinaryIntegrity => {
  if (!value || value.algorithm !== "sha256" || typeof value.digest !== "string" || !HASH.test(value.digest)
      || Object.keys(value).some(key => !["algorithm", "digest", "byteLength"].includes(key))) throw new TypeError("Invalid binary resource commitment.");
  integer(value.byteLength, maximum, "committed byte length");
  return value;
};
const bytesFromHex = (value: string, maximum: number): Uint8Array => {
  if (!HEX.test(value) || value.length > 2 + maximum * 2) throw new Error("Invalid or oversized RPC hex bytes.");
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
};
const word = (bytes: Uint8Array, offset: number): bigint => {
  if (offset < 0 || offset + 32 > bytes.length) throw new Error("Truncated KEEL ABI word.");
  let n = 0n;
  for (let i = offset; i < offset + 32; i++) n = (n << 8n) | BigInt(bytes[i]!);
  return n;
};
const numberWord = (bytes: Uint8Array, offset: number, maximum: number): number => {
  const n = word(bytes, offset);
  if (n > BigInt(maximum)) throw new Error("Oversized KEEL ABI value.");
  return Number(n);
};
const hex = (bytes: Uint8Array) => "0x" + Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");

/** Strict canonical ABI tuple; exported for byte-layout regression tests. */
export function decodeKeelBinaryObjectRecord(result: string, expected: KeelBinaryIntegrity) {
  const bytes = bytesFromHex(result, 1024);
  if (word(bytes, 0) !== 32n || word(bytes, 32 + 9 * 32) !== 320n) throw new Error("Noncanonical KEEL object tuple.");
  const mediaLength = numberWord(bytes, 352, 256);
  const end = 384 + Math.ceil(mediaLength / 32) * 32;
  if (bytes.length !== end || bytes.subarray(384 + mediaLength).some(value => value !== 0)) throw new Error("Invalid KEEL object media padding.");
  if (decoder.decode(bytes.subarray(384, 384 + mediaLength)) !== "application/octet-stream") throw new Error("Invalid KEEL binary object media type.");
  if (bytes.subarray(96, 108).some(value => value !== 0) || word(bytes, 96) === 0n) throw new Error("Invalid KEEL descriptor pointer.");
  const byteLength = numberWord(bytes, 128, MAX_STORED);
  const storedByteLength = numberWord(bytes, 160, MAX_STORED);
  const count = numberWord(bytes, 192, MAX_POINTERS);
  if (word(bytes, 224) !== 0n || word(bytes, 256) !== 0n || word(bytes, 288) !== 1n
      || byteLength !== expected.byteLength || storedByteLength !== expected.byteLength
      || hex(bytes.subarray(32, 64)).toLowerCase() !== expected.digest.toLowerCase()
      || count === 0 || count > storedByteLength) throw new Error("Binary KEEL object record does not match its exact raw commitment.");
  return { count, storedByteLength };
}

/** Exact ABI address array, with bounded allocation and no trailing data. */
export function decodeKeelBinaryPointers(result: string, expectedCount: number): string[] {
  integer(expectedCount, MAX_POINTERS, "pointer count");
  const bytes = bytesFromHex(result, 64 + expectedCount * 32);
  if (word(bytes, 0) !== 32n || word(bytes, 32) !== BigInt(expectedCount) || bytes.length !== 64 + expectedCount * 32) throw new Error("Invalid KEEL pointer array.");
  const resultPointers: string[] = [];
  for (let i = 0; i < expectedCount; i++) {
    const offset = 64 + i * 32;
    if (bytes.subarray(offset, offset + 12).some(value => value !== 0)) throw new Error("Invalid KEEL carrier address padding.");
    const address = hex(bytes.subarray(offset + 12, offset + 32));
    if (/^0x0{40}$/u.test(address)) throw new Error("Zero KEEL carrier address.");
    resultPointers.push(address);
  }
  return resultPointers;
}

export function createKeelOnchainResourceReader(input: {
  readonly chainId: number;
  readonly store: string;
  readonly builder: string;
  readonly storeCodeIntegrity: KeelBinaryIntegrity;
  readonly builderCodeIntegrity: KeelBinaryIntegrity;
  readonly rpcUrls: readonly string[];
  readonly blockHash?: `0x${string}`;
  readonly containers?: readonly KeelBinaryContainer[];
  readonly verify: (bytes: Uint8Array, commitment: KeelBinaryIntegrity, label: string) => Promise<Uint8Array>;
  readonly decompress: (compression: string, bytes: Uint8Array, decodedByteLength: number) => Promise<Uint8Array>;
}) {
  const chainId = integer(input.chainId, Number.MAX_SAFE_INTEGER, "chain ID");
  if (!ADDRESS.test(input.store) || /^0x0{40}$/iu.test(input.store) || !ADDRESS.test(input.builder) || /^0x0{40}$/iu.test(input.builder)) throw new Error("Invalid selected KEEL store/builder binding.");
  const storeCode = integrity(input.storeCodeIntegrity, 24_576), builderCode = integrity(input.builderCodeIntegrity, 24_576);
  if (!storeCode.byteLength || !builderCode.byteLength) throw new Error("Selected KEEL code commitment is empty.");
  if (!chainId || input.rpcUrls.length < 1 || input.rpcUrls.length > 8 || new Set(input.rpcUrls).size !== input.rpcUrls.length) throw new Error("Invalid governed KEEL RPC set.");
  const urls = input.rpcUrls.map(value => {
    const url = new URL(value);
    const local = chainId === 31337 && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) throw new Error("Invalid governed KEEL RPC URL.");
    return url.href;
  });
  if (input.blockHash !== undefined && !HASH.test(input.blockHash)) throw new Error("Invalid selected block hash.");
  const containers = new Map<string, KeelBinaryContainer>();
  if ((input.containers?.length ?? 0) > 128) throw new RangeError("KEEL container table exceeds its bound.");
  for (const value of input.containers ?? []) {
    if (!HASH.test(value.id) || containers.has(value.id.toLowerCase()) || value.chainId !== chainId || value.store.toLowerCase() !== input.store.toLowerCase()
        || !HASH.test(value.objectId) || !["none", "gzip", "deflate", "brotli", "lzma"].includes(value.compression)
        || Object.keys(value).some(key => !["id", "chainId", "store", "objectId", "compression", "storedIntegrity", "integrity"].includes(key))) throw new Error("Invalid or conflicting KEEL container binding.");
    const stored = integrity(value.storedIntegrity, MAX_STORED), decoded = integrity(value.integrity, MAX_DECODED);
    if (!stored.byteLength || !decoded.byteLength) throw new Error("Empty KEEL container commitment.");
    containers.set(value.id.toLowerCase(), Object.freeze({ ...value,
      storedIntegrity: Object.freeze({ ...stored }), integrity: Object.freeze({ ...decoded }) }));
  }
  let checkedTable: Promise<void> | undefined;
  const verifyTable = () => checkedTable ??= (async () => {
    for (const value of containers.values()) {
      // Exact canonical binding JSON, with sorted fields at both object levels.
      const commitment = (i: KeelBinaryIntegrity) => ({ algorithm: i.algorithm, byteLength: i.byteLength, digest: i.digest });
      const bytes = new TextEncoder().encode(JSON.stringify({ chainId: value.chainId, compression: value.compression,
        integrity: commitment(value.integrity), objectId: value.objectId, store: value.store, storedIntegrity: commitment(value.storedIntegrity) }));
      await input.verify(bytes, { algorithm: "sha256", digest: value.id, byteLength: bytes.length }, "Immutable KEEL container binding ID");
    }
  })();
  let requests = 0, storedTotal = 0, decodedTotal = 0;
  const deadline = Date.now() + 120_000;
  const caches = new Map<string, Promise<Uint8Array>>();
  let pinned: Promise<{ blockHash: `0x${string}`; blockNumber: string }> | undefined;
  let initialized: Promise<void> | undefined;
  let selectedBlock: { blockHash: `0x${string}`; blockNumber: string } | undefined;
  const authenticatedEndpoints = new Map<string, Promise<void>>();
  const request = async (url: string, method: string, params: readonly unknown[], maxResultBytes: number): Promise<unknown> => {
      if (++requests > MAX_REQUESTS || Date.now() > deadline) throw new Error("KEEL resource read budget exceeded.");
      const id = requests;
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(url, { method: "POST", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
        if (!response.ok || response.body === null) throw new Error("KEEL chain RPC unavailable.");
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > maxResultBytes * 2 + 1024) throw new Error("KEEL RPC response exceeds its declared bound.");
            chunks.push(value);
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const bytes = new Uint8Array(length); let at = 0;
        for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
        const payload = JSON.parse(decoder.decode(bytes));
        if (payload.jsonrpc !== "2.0" || payload.id !== id || payload.error !== undefined || payload.result === undefined) throw new Error("Invalid KEEL JSON-RPC response.");
        return payload.result;
    } finally { clearTimeout(timer); }
  };
  const authenticate = (url: string) => {
    let pending = authenticatedEndpoints.get(url);
    if (!pending) {
      pending = (async () => {
        const seen = await request(url, "eth_chainId", [], 32);
        if (typeof seen !== "string" || !/^0x[0-9a-f]+$/iu.test(seen) || BigInt(seen) !== BigInt(chainId)) throw new Error("KEEL fallback RPC chain mismatch.");
        const block = await request(url, "eth_getBlockByNumber", [selectedBlock!.blockNumber, false], 32_768) as { hash?: string; number?: string } | null;
        if (!block || block.hash?.toLowerCase() !== selectedBlock!.blockHash.toLowerCase() || block.number?.toLowerCase() !== selectedBlock!.blockNumber.toLowerCase()) throw new Error("KEEL fallback RPC block mismatch.");
      })();
      authenticatedEndpoints.set(url, pending);
    }
    return pending;
  };
  const rpc = async (method: string, params: readonly unknown[], maxResultBytes: number): Promise<unknown> => {
    let lastError: unknown;
    for (const url of urls) {
      try {
        if (selectedBlock) await authenticate(url);
        return await request(url, method, params, maxResultBytes);
      } catch (error) { lastError = error; }
    }
    throw lastError ?? new Error("KEEL RPC set unavailable.");
  };
  const pin = () => pinned ??= (async () => {
    const seen = await rpc("eth_chainId", [], 32);
    if (typeof seen !== "string" || !/^0x[0-9a-f]+$/iu.test(seen) || BigInt(seen) !== BigInt(chainId)) throw new Error("KEEL RPC chain mismatch.");
    const block = await rpc(input.blockHash ? "eth_getBlockByHash" : "eth_getBlockByNumber", [input.blockHash ?? "latest", false], 32_768) as { hash?: string; number?: string } | null;
    if (!block || typeof block.hash !== "string" || !HASH.test(block.hash) || typeof block.number !== "string" || !/^0x[0-9a-f]{1,16}$/iu.test(block.number)
        || (input.blockHash && input.blockHash.toLowerCase() !== block.hash.toLowerCase())) throw new Error("Invalid KEEL pinned block.");
    selectedBlock = { blockHash: block.hash as `0x${string}`, blockNumber: block.number };
    return selectedBlock;
  })();
  const initialize = () => initialized ??= (async () => {
    const snapshot = await pin(), block = { blockHash: snapshot.blockHash, requireCanonical: true };
    for (const [address, commitment] of [[input.store, storeCode], [input.builder, builderCode]] as const) {
      const code = await rpc("eth_getCode", [address, block], commitment.byteLength);
      if (typeof code !== "string") throw new Error("Invalid selected KEEL contract code.");
      await input.verify(bytesFromHex(code, commitment.byteLength), commitment, "Selected KEEL contract code");
    }
    const result = await rpc("eth_call", [{ to: input.builder, data: "0x54c1823e" }, block], 32);
    if (typeof result !== "string" || !/^0x0{24}[0-9a-f]{40}$/iu.test(result)
        || result.slice(-40).toLowerCase() !== input.store.slice(2).toLowerCase()) throw new Error("Selected KEEL builder does not bind this Hold.");
  })();
  const readStored = async (item: KeelBinaryResource, expected: KeelBinaryIntegrity): Promise<Uint8Array> => {
    await initialize();
    const snapshot = await pin();
    const block = { blockHash: snapshot.blockHash, requireCanonical: true };
    const call = async (data: string, maximum: number) => {
      const result = await rpc("eth_call", [{ to: item.store, data }, block], maximum);
      if (typeof result !== "string") throw new Error("Invalid KEEL call result.");
      return result;
    };
    const trueWord = "0x" + "0".repeat(63) + "1";
    const registered = await call(`0x2660fd5c${item.objectId!.slice(2)}${input.builder.slice(2).padStart(64, "0")}`, 32);
    const sealed = await call(`0x0646e2be${item.objectId!.slice(2)}`, 32);
    if (registered.toLowerCase() !== trueWord || sealed.toLowerCase() !== trueWord) throw new Error("KEEL binary object is not permanently registered and sealed.");
    const { count } = decodeKeelBinaryObjectRecord(await call(`0x05144857${item.objectId!.slice(2)}`, 1024), expected);
    const pointers = decodeKeelBinaryPointers(await call(`0x144658f2${item.objectId!.slice(2)}${"0".repeat(64)}${count.toString(16).padStart(64, "0")}`, 64 + 32 * count), count);
    const output = new Uint8Array(expected.byteLength); let offset = 0;
    // Sequential reads bound live buffers; one immutable carrier is at most EIP-170 runtime size.
    for (const pointer of pointers) {
      const result = await rpc("eth_getCode", [pointer, block], 24_576);
      if (typeof result !== "string") throw new Error("Invalid immutable KEEL carrier.");
      const code = bytesFromHex(result, 24_576);
      if (code.length < 2 || code[0] !== 0 || code.length - 1 > output.length - offset) throw new Error("Invalid KEEL carrier size or STOP prefix.");
      output.set(code.subarray(1), offset); offset += code.length - 1;
    }
    if (offset !== output.length) throw new Error("KEEL stored carrier length mismatch.");
    return input.verify(output, expected, `${item.id} stored`);
  };
  const resolve = async (item: KeelBinaryResource): Promise<Uint8Array> => {
    await verifyTable();
    if (item.onchain?.containerId !== undefined) {
      if (item.chainId !== undefined || item.store !== undefined || item.objectId !== undefined
          || Object.keys(item.onchain).some(key => key !== "containerId" && key !== "offset")) throw new Error("Ambiguous KEEL container reference.");
      const container = containers.get(item.onchain.containerId.toLowerCase());
      if (!container) throw new Error("Unknown KEEL container reference.");
      const offset = integer(item.onchain.offset, container.integrity.byteLength, "container member offset");
      item = { ...item, chainId: container.chainId, store: container.store, objectId: container.objectId,
        onchain: { storeKind: "keel-hold", compression: container.compression, storedIntegrity: container.storedIntegrity,
          range: { offset, containerIntegrity: container.integrity } } };
    }
    if (item.chainId !== chainId || typeof item.store !== "string" || item.store.toLowerCase() !== input.store.toLowerCase()
        || typeof item.objectId !== "string" || !HASH.test(item.objectId) || !item.onchain || (item.onchain.storeKind && item.onchain.storeKind !== "keel-hold")) throw new Error("Invalid selected-chain binary binding.");
    if (!["none", "gzip", "deflate", "brotli", "lzma"].includes(item.onchain.compression ?? "")) throw new Error("Unsupported KEEL binary compression.");
    const stored = integrity(item.onchain.storedIntegrity, MAX_STORED), member = integrity(item.integrity, MAX_DECODED);
    if (stored.byteLength === 0 || member.byteLength === 0) throw new Error("Empty KEEL binary resource.");
    const range = item.onchain.range, container = range ? integrity(range.containerIntegrity, MAX_DECODED) : member;
    const start = range ? integer(range.offset, container.byteLength, "container offset") : 0;
    if (member.byteLength > container.byteLength - start) throw new Error("KEEL member exceeds its committed container.");
    const key = [item.store.toLowerCase(), item.objectId.toLowerCase(), stored.digest.toLowerCase(), stored.byteLength, item.onchain.compression, container.digest.toLowerCase(), container.byteLength].join(":");
    let pending = caches.get(key);
    if (!pending) {
      storedTotal += stored.byteLength; decodedTotal += container.byteLength;
      if (storedTotal > MAX_TOTAL_STORED || decodedTotal > MAX_DECODED || caches.size >= 128) throw new Error("KEEL binary graph exceeds its total byte/object budget.");
      pending = (async () => {
        const bytes = await readStored(item, stored);
        return input.verify(await input.decompress(item.onchain!.compression!, bytes, container.byteLength), container, `${item.id} container`);
      })();
      caches.set(key, pending);
    }
    const bytes = await pending;
    return input.verify(new Uint8Array(bytes.subarray(start, start + member.byteLength)), member, item.id);
  };
  return Object.freeze({ resolve, snapshot: async () => Object.freeze({ chainId, ...await pin(), requests, storedBytes: storedTotal, decodedContainerBytes: decodedTotal }) });
}
