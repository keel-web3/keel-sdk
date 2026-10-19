import {
  KEEL_HOLD_DESCRIPTOR_MAGIC,
  KEEL_HOLD_DESCRIPTOR_VERSION,
  KEEL_HOLD_DESCRIPTOR_HEADER_BYTES,
  concatBytes,
  toBufferSource,
  verifyIntegrity,
  type Compression,
  type DigestAlgorithm,
  type Hex,
} from "@keel/protocol";
import type { OnchainObjectRequest, ResolverAdapters } from "./types.js";

export interface KeelHoldObjectRecord {
  readonly digest: Hex;
  readonly descriptorPointer?: Hex;
  readonly byteLength: bigint | number;
  readonly storedByteLength: bigint | number;
  readonly chunkCount: bigint | number;
  readonly compression: bigint | number;
  readonly composite: boolean;
}

export interface KeelHoldReadClient {
  getObject(request: OnchainObjectRequest, signal: AbortSignal): Promise<KeelHoldObjectRecord>;
  getObjectSlugPointers(
    request: OnchainObjectRequest & { readonly offset: number; readonly limit: number },
    signal: AbortSignal,
  ): Promise<readonly Hex[]>;
  getObjectPartIds(
    request: OnchainObjectRequest & { readonly offset: number; readonly limit: number },
    signal: AbortSignal,
  ): Promise<readonly Hex[]>;
  getCode(
    request: { readonly chainId: number; readonly address: Hex },
    signal: AbortSignal,
  ): Promise<Uint8Array>;
}

export interface RecursiveChunkReaderOptions {
  readonly pageSize?: number;
  /** Persistent verified resume cache is available only at this exact pinned block. */
  readonly cacheBlockHash?: Hex;
  readonly maxCacheBytes?: number;
  readonly onProgress?: (progress: { readonly completedObjects: number; readonly decodedBytes: number; readonly cacheBytes: number }) => void;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxDecodedBytes?: number;
  readonly maxStoredBytes?: number;
  readonly maxConcurrentReads?: number;
  readonly digestAlgorithm?: Exclude<DigestAlgorithm, "none">;
  /**
   * Verify each KeelHold record's decoded digest while walking the object
   * graph. Disable this only when a higher-level descriptor supplies the
   * algorithm and the caller verifies the fully assembled root bytes. Older
   * KeelHold records commit digest bytes but do not store the algorithm, so
   * mixed or non-SHA graphs cannot be verified record-by-record.
   */
  readonly verifyObjectDigests?: boolean;
  readonly customDigest?: ResolverAdapters["customDigest"];
  readonly decompress?: ResolverAdapters["decompress"];
}

interface ReadContext {
  readonly signal: AbortSignal;
  readonly fail: (reason: unknown) => void;
  readonly wait: <T>(read: () => T | Promise<T>) => Promise<T>;
  readonly client: KeelHoldReadClient;
  readonly options: Required<
    Pick<RecursiveChunkReaderOptions, "pageSize" | "maxDepth" | "maxNodes" | "maxDecodedBytes" | "maxStoredBytes" | "maxConcurrentReads">
  > &
    Omit<
      RecursiveChunkReaderOptions,
      "pageSize" | "maxDepth" | "maxNodes" | "maxDecodedBytes" | "maxStoredBytes" | "maxConcurrentReads"
    >;
  readonly report: () => void;
  readonly cache: Map<string, Uint8Array>;
  readonly recall: (request: OnchainObjectRequest, record: KeelHoldObjectRecord) => Uint8Array | undefined;
  readonly remember: (request: OnchainObjectRequest, record: KeelHoldObjectRecord, bytes: Uint8Array) => void;
  readonly active: Set<string>;
  nodes: number;
  decodedBytes: number;
}

/** Share cancellation across all adapters with one listener per traversal. */
function createReadAbortGate(signal: AbortSignal) {
  const controller = new AbortController();
  let onAbort!: () => void, rejectAbort!: (reason: unknown) => void;
  const fail = (reason: unknown) => { if (!controller.signal.aborted) { controller.abort(reason); rejectAbort(reason); } };
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
    onAbort = () => fail(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return {
    signal: controller.signal, fail,
    async wait<T>(read: () => T | Promise<T>): Promise<T> {
      const result = await Promise.race([aborted, Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read();
      })]);
      controller.signal.throwIfAborted();
      return result;
    },
    dispose(): void { signal.removeEventListener("abort", onAbort); },
  };
}

function safeNumber(value: bigint | number, label: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new RangeError(`${label} exceeds safe client limits.`);
  return normalized;
}

function compressionFromCode(value: bigint | number): Compression {
  const code = safeNumber(value, "compression");
  switch (code) {
    case 0:
      return "none";
    case 1:
      return "gzip";
    case 2:
      return "deflate";
    case 3:
      return "brotli";
    default:
      throw new TypeError(`Unknown KeelHold compression code ${code}.`);
  }
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
  signal: AbortSignal,
  wait: ReadContext["wait"],
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new Error("KeelHold read aborted.");
      const result = await wait(() => reader.read());
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) throw new RangeError(`Decompressed object exceeds ${maximum} bytes.`);
      chunks.push(result.value);
    }
  } finally {
    if (signal.aborted) void reader.cancel(signal.reason).catch(() => undefined);
    reader.releaseLock();
  }
  return concatBytes(chunks);
}

async function defaultDecompress(
  compression: Exclude<Compression, "none">,
  bytes: Uint8Array,
  maximum: number,
  signal: AbortSignal,
  wait: ReadContext["wait"],
): Promise<Uint8Array> {
  if (compression === "brotli") throw new Error("Brotli requires a decompress adapter.");
  if (typeof globalThis.DecompressionStream !== "function") throw new Error("DecompressionStream is unavailable.");
  const stream = new Blob([toBufferSource(bytes)]).stream().pipeThrough(new DecompressionStream(compression));
  return readStreamWithLimit(stream, maximum, signal, wait);
}

async function decompress(
  compression: Compression,
  bytes: Uint8Array,
  options: RecursiveChunkReaderOptions,
  maximum: number,
  signal: AbortSignal,
  wait: ReadContext["wait"],
): Promise<Uint8Array> {
  if (compression === "none") return bytes;
  return wait(() => options.decompress?.(compression, bytes) ?? defaultDecompress(compression, bytes, maximum, signal, wait));
}

function objectKey(request: OnchainObjectRequest): string {
  return `${request.chainId}:${request.store.toLowerCase()}:${request.objectId.toLowerCase()}`;
}

function readBigEndian(bytes: Uint8Array, offset: number, length: number): bigint {
  let value = 0n;
  for (let index = offset; index < offset + length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("Truncated KeelHold descriptor.");
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function bytesHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function descriptorReferences(
  context: ReadContext,
  request: OnchainObjectRequest,
  record: KeelHoldObjectRecord,
): Promise<readonly Hex[]> {
  const pointer = record.descriptorPointer;
  if (pointer === undefined) throw new Error("KeelHold does not expose descriptor fallback data.");
  const code = await context.wait(() => context.client.getCode({ chainId: request.chainId, address: pointer }, context.signal));
  if (code.byteLength < KEEL_HOLD_DESCRIPTOR_HEADER_BYTES + 1 || code[0] !== 0) throw new Error(`Invalid KeelHold descriptor bytecode at ${pointer}.`);
  const descriptor = code.subarray(1);
  const magic = bytesHex(descriptor.subarray(0, 4));
  if (magic !== KEEL_HOLD_DESCRIPTOR_MAGIC || descriptor[4] !== KEEL_HOLD_DESCRIPTOR_VERSION) {
    throw new Error(`Unsupported KeelHold descriptor format at ${pointer}.`);
  }
  const composite = descriptor[5] === 1;
  const count = safeNumber(record.chunkCount, "object child count");
  if ((descriptor[5] !== 0 && descriptor[5] !== 1)
    || descriptor[7] !== 0
    || descriptor[6] === undefined || descriptor[6] > 3
    || (composite && descriptor[6] !== 0)
    || composite !== record.composite
    || descriptor[6] !== safeNumber(record.compression, "compression")
    || readBigEndian(descriptor, 8, 4) !== BigInt(count)
    || readBigEndian(descriptor, 12, 8) !== BigInt(safeNumber(record.byteLength, "object byteLength"))
    || readBigEndian(descriptor, 20, 8) !== BigInt(safeNumber(record.storedByteLength, "object storedByteLength"))
    || bytesHex(descriptor.subarray(28, 60)).toLowerCase() !== record.digest.toLowerCase()) {
    throw new Error(`KeelHold descriptor metadata mismatch at ${pointer}.`);
  }
  const mediaLength = descriptor[92];
  if (mediaLength === undefined) throw new Error(`Truncated KeelHold descriptor at ${pointer}.`);
  const width = composite ? 32 : 20;
  const referencesOffset = KEEL_HOLD_DESCRIPTOR_HEADER_BYTES + mediaLength;
  if (descriptor.byteLength !== referencesOffset + (count * width)) {
    throw new Error(`KeelHold descriptor length mismatch at ${pointer}.`);
  }
  return Array.from({ length: count }, (_, index) => (
    bytesHex(descriptor.subarray(referencesOffset + (index * width), referencesOffset + ((index + 1) * width)))
  ));
}

async function pageIds(
  context: ReadContext,
  request: OnchainObjectRequest,
  count: number,
  record: KeelHoldObjectRecord,
): Promise<readonly Hex[]> {
  try {
    const result: Hex[] = [];
    for (let offset = 0; offset < count; offset += context.options.pageSize) {
      if (context.signal.aborted) throw context.signal.reason;
      const limit = Math.min(context.options.pageSize, count - offset);
      const pageRequest = { ...request, offset, limit };
      const page = await context.wait(() => context.client.getObjectPartIds(pageRequest, context.signal));
      if (page.length === 0 && limit !== 0) throw new Error(`KeelHold returned an empty page at offset ${offset}.`);
      result.push(...page);
    }
    if (result.length !== count) throw new Error(`KeelHold returned ${result.length} IDs; expected ${count}.`);
    return result;
  } catch (error) {
    context.signal.throwIfAborted();
    if (terminalReadError(error)) throw error;
    if (record.descriptorPointer === undefined) throw error;
    return descriptorReferences(context, request, record);
  }
}

async function pagePointers(
  context: ReadContext,
  request: OnchainObjectRequest,
  count: number,
  record: KeelHoldObjectRecord,
): Promise<readonly Hex[]> {
  try {
    const result: Hex[] = [];
    for (let offset = 0; offset < count; offset += context.options.pageSize) {
      if (context.signal.aborted) throw context.signal.reason;
      const limit = Math.min(context.options.pageSize, count - offset);
      const page = await context.wait(() => context.client.getObjectSlugPointers({ ...request, offset, limit }, context.signal));
      if (page.length === 0 && limit !== 0) throw new Error(`KeelHold returned an empty pointer page at offset ${offset}.`);
      result.push(...page);
    }
    if (result.length !== count) throw new Error(`KeelHold returned ${result.length} pointers; expected ${count}.`);
    return result;
  } catch (error) {
    context.signal.throwIfAborted();
    if (terminalReadError(error)) throw error;
    if (record.descriptorPointer === undefined) throw error;
    return descriptorReferences(context, request, record);
  }
}

async function readCarriers(
  context: ReadContext,
  request: OnchainObjectRequest,
  pointers: readonly Hex[],
): Promise<readonly Uint8Array[]> {
  const result = new Array<Uint8Array>(pointers.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    try { for (;;) {
      const index = next++;
      if (index >= pointers.length) return;
      if (context.signal.aborted) throw context.signal.reason;
      const pointer = pointers[index];
      if (pointer === undefined) throw new Error(`Missing KeelHold carrier pointer ${index}.`);
      const code = await context.wait(() => context.client.getCode({ chainId: request.chainId, address: pointer }, context.signal));
      if (code.byteLength <= 1 || code[0] !== 0) throw new Error(`Invalid immutable carrier bytecode at ${pointer}.`);
      result[index] = code.slice(1);
    } } catch (error) { context.fail(error); throw error; }
  };
  const workers = Math.min(context.options.maxConcurrentReads, Math.max(1, pointers.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return result;
}

/** Read adapters may wrap HTTP/RPC errors; denial and genuine revert must not
 * become a descriptor fallback or an alternate execution path. */
function terminalReadError(error: unknown): boolean {
  const queue: unknown[] = [error];
  for (let count = 0; queue.length && count < 32; count++) {
    const value = queue.shift(); if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) { queue.push(...value.slice(0, 8)); continue; }
    const e = value as { terminal?: unknown; code?: unknown; status?: unknown; httpStatus?: unknown; cause?: unknown; error?: unknown; message?: unknown };
    if (e.terminal === true || e.code === 3 || e.code === "rpc.execution-reverted" || e.code === "transport.access-denied" || e.status === 401 || e.status === 403 || e.httpStatus === 401 || e.httpStatus === 403) return true;
    if (typeof e.message === "string" && /\bexecution reverted\b/iu.test(e.message.slice(0, 2048))) return true;
    if (e.cause) queue.push(e.cause); if (e.error) queue.push(e.error);
  }
  return false;
}

/** Explicit DFS frames keep traversal state independent of the JS call stack.
 * Only completed, digest-verified nodes enter the optional pinned resume cache. */
async function haulObject(context: ReadContext, request: OnchainObjectRequest, depth: number): Promise<Uint8Array> {
  interface Frame { request: OnchainObjectRequest; depth: number; key: string; record?: KeelHoldObjectRecord; expectedBytes?: number; storedBytes?: number; children?: readonly Hex[]; next: number; parts: Uint8Array[]; }
  const stack: Frame[] = [{ request, depth, key: objectKey(request), next: 0, parts: [] }];
  for (;;) {
    context.signal.throwIfAborted();
    const frame = stack[stack.length - 1]!;
    let decoded: Uint8Array | undefined;
    if (!frame.record) {
      if (frame.depth > context.options.maxDepth) throw new RangeError(`KeelHold recursion exceeds ${context.options.maxDepth}.`);
      if (++context.nodes > context.options.maxNodes) throw new RangeError(`KeelHold node count exceeds ${context.options.maxNodes}.`);
      if (context.active.has(frame.key)) throw new Error(`KeelHold object cycle at ${frame.request.objectId}.`);
      context.active.add(frame.key);
      const record = await context.wait(() => context.client.getObject(frame.request, context.signal));
      frame.record = record;
      frame.expectedBytes = safeNumber(record.byteLength, "object byteLength");
      frame.storedBytes = safeNumber(record.storedByteLength, "object storedByteLength");
      const count = safeNumber(record.chunkCount, "object child count");
      if (frame.expectedBytes > context.options.maxDecodedBytes) throw new RangeError(`KeelHold object exceeds decoded-byte limit ${context.options.maxDecodedBytes}.`);
      if (frame.storedBytes > context.options.maxStoredBytes) throw new RangeError(`KeelHold object exceeds stored-byte limit ${context.options.maxStoredBytes}.`);
      decoded = context.recall(frame.request, record);
      if (!decoded && record.composite) frame.children = await pageIds(context, frame.request, count, record);
      else if (!decoded) {
        const pointers = await pagePointers(context, frame.request, count, record);
        const chunks = await readCarriers(context, frame.request, pointers);
        const stored = concatBytes(chunks);
        if (stored.byteLength !== frame.storedBytes) throw new Error(`Stored length mismatch for ${frame.request.objectId}.`);
        decoded = await decompress(compressionFromCode(record.compression), stored, context.options, frame.expectedBytes, context.signal, context.wait);
      }
    }
    if (!decoded && frame.children && frame.next < frame.children.length) {
      const child = frame.children[frame.next++]!;
      const childRequest = { chainId: frame.request.chainId, store: frame.request.store, objectId: child };
      const key = objectKey(childRequest);
      if (context.active.has(key)) throw new Error(`KeelHold object cycle at ${child}.`);
      const cached = context.cache.get(key);
      if (cached) frame.parts.push(cached);
      else stack.push({ request: childRequest, depth: frame.depth + 1, key, next: 0, parts: [] });
      continue;
    }
    decoded ??= concatBytes(frame.parts);
    if (decoded.byteLength !== frame.expectedBytes) throw new Error(`Decoded length mismatch for ${frame.request.objectId}.`);
    if (context.decodedBytes + decoded.byteLength > context.options.maxDecodedBytes) throw new RangeError(`KeelHold traversal exceeds ${context.options.maxDecodedBytes} decoded bytes.`);
    if (context.options.verifyObjectDigests ?? true) {
      const bytes = decoded;
      const verified = await context.wait(() => verifyIntegrity(bytes, { algorithm: context.options.digestAlgorithm ?? "sha256", digest: frame.record!.digest, byteLength: frame.expectedBytes! }, context.options.customDigest));
      if (!verified) throw new Error(`Object digest mismatch for ${frame.request.objectId}.`);
      context.remember(frame.request, frame.record!, decoded);
    }
    context.decodedBytes += decoded.byteLength;
    context.cache.set(frame.key, decoded); context.active.delete(frame.key); stack.pop();
    context.report();
    if (!stack.length) return decoded;
    stack[stack.length - 1]!.parts.push(decoded);
  }
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${label} must be a non-negative safe integer.`);
  return value;
}

export function createKeelHoldObjectReader(
  client: KeelHoldReadClient,
  options: RecursiveChunkReaderOptions = {},
): NonNullable<ResolverAdapters["readOnchainObject"]> {
  options = { ...options };
  const pageSize = positiveInteger(options.pageSize ?? 128, "pageSize");
  if (pageSize > 1_024) throw new RangeError("pageSize cannot exceed 1024.");
  const maxDepth = nonNegativeInteger(options.maxDepth ?? 32, "maxDepth");
  const maxNodes = positiveInteger(options.maxNodes ?? 4_096, "maxNodes");
  const maxDecodedBytes = positiveInteger(options.maxDecodedBytes ?? 256 * 1024 * 1024, "maxDecodedBytes");
  const maxStoredBytes = positiveInteger(options.maxStoredBytes ?? 256 * 1024 * 1024, "maxStoredBytes");
  const maxConcurrentReads = positiveInteger(options.maxConcurrentReads ?? 12, "maxConcurrentReads");
  if (maxConcurrentReads > 64) throw new RangeError("maxConcurrentReads cannot exceed 64.");

  if (options.cacheBlockHash !== undefined && !/^0x[0-9a-f]{64}$/iu.test(options.cacheBlockHash)) throw new TypeError("Resume cache requires an exact pinned block hash.");
  const maxCacheBytes = nonNegativeInteger(options.maxCacheBytes ?? Math.min(maxDecodedBytes, 32 * 1024 * 1024), "maxCacheBytes");
  if (maxCacheBytes > maxDecodedBytes) throw new RangeError("Resume cache cannot exceed the decoded-byte budget.");
  const verifiedCache = new Map<string, Uint8Array>(); let cacheBytes = 0;
  const cacheKey = (request: OnchainObjectRequest, record: KeelHoldObjectRecord) => `${options.cacheBlockHash}:${objectKey(request)}:${record.digest.toLowerCase()}:${record.byteLength}:${record.storedByteLength}:${record.chunkCount}:${record.compression}:${record.composite}`;
  const recall = (request: OnchainObjectRequest, record: KeelHoldObjectRecord) => {
    if (options.cacheBlockHash === undefined) return undefined;
    const key = cacheKey(request, record), bytes = verifiedCache.get(key);
    if (bytes) { verifiedCache.delete(key); verifiedCache.set(key, bytes); return bytes.slice(); }
    return undefined;
  };
  const remember = (request: OnchainObjectRequest, record: KeelHoldObjectRecord, bytes: Uint8Array) => {
    if (options.cacheBlockHash === undefined || !maxCacheBytes) return;
    const key = cacheKey(request, record), cost = bytes.byteLength + key.length * 2 + 128;
    if (cost <= maxCacheBytes && !verifiedCache.has(key)) {
      while (cacheBytes + cost > maxCacheBytes && verifiedCache.size) { const first = verifiedCache.keys().next().value!; cacheBytes -= verifiedCache.get(first)!.byteLength + first.length * 2 + 128; verifiedCache.delete(first); }
      verifiedCache.set(key, bytes.slice()); cacheBytes += cost;
    }
  };
  return async (request, signal) => {
    signal.throwIfAborted();
    const gate = createReadAbortGate(signal);
    const context: ReadContext = {
      signal: gate.signal, fail: gate.fail,
      wait: gate.wait,
      client,
      options: {
        pageSize,
        maxDepth,
        maxNodes,
        maxDecodedBytes,
        maxStoredBytes,
        maxConcurrentReads,
        ...(options.digestAlgorithm === undefined ? {} : { digestAlgorithm: options.digestAlgorithm }),
        ...(options.verifyObjectDigests === undefined ? {} : { verifyObjectDigests: options.verifyObjectDigests }),
        ...(options.customDigest === undefined ? {} : { customDigest: options.customDigest }),
        ...(options.decompress === undefined ? {} : { decompress: options.decompress }),
      },
      report: () => { try { options.onProgress?.({ completedObjects: context.cache.size, decodedBytes: context.decodedBytes, cacheBytes }); } catch { /* Observers cannot change proof or flow. */ } },
      recall, remember,
      cache: new Map(),
      active: new Set(),
      nodes: 0,
      decodedBytes: 0,
    };
    try {
      const result = await gate.wait(() => haulObject(context, request, 0));
      try { options.onProgress?.({ completedObjects: context.cache.size, decodedBytes: context.decodedBytes, cacheBytes }); } catch { /* Observers do not change verified bytes. */ }
      return result;
    } catch (error) { gate.fail(error); throw error; } finally {
      gate.dispose();
    }
  };
}
