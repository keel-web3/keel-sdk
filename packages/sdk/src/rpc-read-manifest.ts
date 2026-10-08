import { assertKeelRpcUrl, keelRpcHostList, keelRpcHostListDigest, keelRpcHostListStale, KEEL_DEFAULT_RPC_HOSTS, redactRpcUrl, type KeelRpcHostList } from "@keel/protocol";

export const KEEL_DEFAULT_RPC_READ_CONCURRENCY = 4;

/** Advisory read evidence. These are eth_call/response limits, never transaction gas limits. */
export interface KeelRpcEndpointCapability {
  readonly url: string;
  readonly chainId: number;
  readonly basis: "measured" | "declared";
  readonly observedAtMs: number;
  readonly validUntilMs: number;
  readonly source: string;
  /** A measurement must identify the chain actually checked and its sample count. */
  readonly observedChainId?: number;
  readonly samples?: number;
  readonly latencyMs?: readonly [number, number];
  /** Aggregate response throughput, not per concurrent request. */
  readonly bytesPerSecond?: readonly [number, number];
  readonly maxCallGas?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrentReads?: number;
}
export interface KeelRpcReadManifest {
  readonly schema: "keel-rpc-read-manifest@1";
  readonly revision: number;
  readonly chainId: number;
  readonly policySource: "bundled" | "host-snapshot";
  readonly hostList: KeelRpcHostList;
  readonly rpcUrls: readonly string[];
  readonly endpoints: readonly KeelRpcEndpointCapability[];
}
const integer = (value: number, label: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`Invalid ${label}.`);
  return value;
};
function range(value: readonly [number, number] | undefined, label: string): readonly [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError(`Invalid ${label}.`);
  integer(value[0], label); integer(value[1], label);
  if (value[1] < value[0]) throw new TypeError(`Invalid ${label} order.`);
  return Object.freeze([value[0], value[1]]);
}
/** Construct data only. A host snapshot is NOT proof that governance approved these capability claims. */
export function createKeelRpcReadManifest(input: {
  readonly chainId: number;
  readonly rpcUrls: readonly string[];
  readonly revision?: number;
  readonly hostList?: KeelRpcHostList;
  readonly endpoints?: readonly KeelRpcEndpointCapability[];
}): KeelRpcReadManifest {
  const chainId = integer(input.chainId, "RPC chain");
  const revision = integer(input.revision ?? 0, "manifest revision", 0);
  const hostList = keelRpcHostList(input.hostList ?? { hosts: KEEL_DEFAULT_RPC_HOSTS });
  if (!Array.isArray(input.rpcUrls) || input.rpcUrls.length < 1 || input.rpcUrls.length > 8) throw new TypeError("Select one to eight governed RPC endpoints.");
  const rpcUrls = input.rpcUrls.map(value => {
    if (typeof value !== "string" || value.length > 2048) throw new TypeError("Invalid RPC URL.");
    assertKeelRpcUrl(value, hostList.hosts);
    const url = new URL(value);
    if (url.hash) throw new TypeError("RPC URL fragments are unsupported.");
    return url.href;
  });
  if (new Set(rpcUrls).size !== rpcUrls.length) throw new TypeError("Duplicate RPC endpoint.");
  if (input.endpoints !== undefined && (!Array.isArray(input.endpoints) || input.endpoints.length > rpcUrls.length)) throw new TypeError("Invalid RPC capability records.");
  const seen = new Set<string>();
  const endpoints = (input.endpoints ?? []).map(value => {
    const url = new URL(value.url).href;
    if (!rpcUrls.includes(url) || seen.has(url) || value.chainId !== chainId || !["measured", "declared"].includes(value.basis)) throw new TypeError("Invalid, duplicate or cross-chain RPC capability record.");
    seen.add(url);
    integer(value.observedAtMs, "capability timestamp", 0);
    integer(value.validUntilMs, "capability expiration", value.observedAtMs + 1);
    if (typeof value.source !== "string" || value.source.length < 1 || value.source.length > 512 || /[\u0000-\u001f\u007f]/u.test(value.source)) throw new TypeError("Capability evidence needs a bounded source label.");
    if (value.basis === "measured" && (value.observedChainId !== chainId || value.samples === undefined)) throw new TypeError("Measured capability evidence needs the verified chain and sample count.");
    if (value.observedChainId !== undefined && value.observedChainId !== chainId) throw new TypeError("Capability evidence is for another chain.");
    if (value.samples !== undefined) integer(value.samples, "sample count");
    for (const key of ["maxCallGas", "maxResponseBytes", "maxConcurrentReads"] as const) if (value[key] !== undefined) integer(value[key], key, 1, key === "maxConcurrentReads" ? 64 : Number.MAX_SAFE_INTEGER);
    const latencyMs = range(value.latencyMs, "latency range"), bytesPerSecond = range(value.bytesPerSecond, "throughput range");
    return Object.freeze({ url, chainId, basis: value.basis, observedAtMs: value.observedAtMs, validUntilMs: value.validUntilMs, source: value.source,
      ...(value.observedChainId === undefined ? {} : { observedChainId: value.observedChainId }), ...(value.samples === undefined ? {} : { samples: value.samples }),
      ...(latencyMs ? { latencyMs } : {}), ...(bytesPerSecond ? { bytesPerSecond } : {}),
      ...(value.maxCallGas === undefined ? {} : { maxCallGas: value.maxCallGas }), ...(value.maxResponseBytes === undefined ? {} : { maxResponseBytes: value.maxResponseBytes }),
      ...(value.maxConcurrentReads === undefined ? {} : { maxConcurrentReads: value.maxConcurrentReads }) });
  });
  return Object.freeze({ schema: "keel-rpc-read-manifest@1", revision, chainId, policySource: input.hostList === undefined ? "bundled" : "host-snapshot", hostList,
    rpcUrls: Object.freeze(rpcUrls), endpoints: Object.freeze(endpoints) });
}

/** Authenticate an update against a trusted out-of-band commitment and host-list read.
 * The current contracts govern hosts only; this function does not invent a manifest registry.
 * Fetching/probing is deliberately left to the existing caller's allowlisted transport.
 */
export async function verifyKeelRpcReadManifest(bytes: Uint8Array, expected: {
  readonly digest: string; readonly revision: number; readonly chainId: number; readonly hostList: KeelRpcHostList;
}): Promise<KeelRpcReadManifest> {
  if (bytes.byteLength > 65_536 || !/^0x[0-9a-f]{64}$/iu.test(expected.digest)) throw new TypeError("Invalid RPC manifest commitment.");
  const digest = `0x${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)), value => value.toString(16).padStart(2, "0")).join("")}`;
  if (digest !== expected.digest.toLowerCase()) throw new Error("RPC manifest integrity mismatch.");
  const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as KeelRpcReadManifest;
  if (raw?.schema !== "keel-rpc-read-manifest@1" || raw.chainId !== expected.chainId || raw.revision !== expected.revision || raw.policySource !== "host-snapshot") throw new Error("RPC manifest chain, revision or authority mismatch.");
  const policy = keelRpcHostList(expected.hostList);
  const policyDigest = await keelRpcHostListDigest(policy.hosts, policy.revision, policy.epoch);
  if (policy.digest?.toLowerCase() !== policyDigest || raw.hostList?.digest?.toLowerCase() !== policyDigest
    || raw.hostList.revision !== policy.revision || raw.hostList.epoch !== policy.epoch
    || JSON.stringify(raw.hostList.hosts) !== JSON.stringify(policy.hosts)) throw new Error("RPC manifest host authority mismatch.");
  return createKeelRpcReadManifest({ chainId: raw.chainId, revision: raw.revision, rpcUrls: raw.rpcUrls, endpoints: raw.endpoints, hostList: policy });
}

export interface KeelHybridReadEstimate {
  readonly status: "estimated" | "unavailable";
  readonly lowMs?: number;
  readonly highMs?: number;
  readonly readCount: number;
  readonly wireBytes: number;
  readonly byteBasis: "prepared-native" | "source-provisional";
  readonly policyStatus: "bundled" | "current-snapshot" | "stale-snapshot";
  readonly endpoints: readonly {
    readonly endpoint: string; readonly evidence: "measured" | "declared" | "stale" | "unknown";
    readonly eligible: boolean; readonly maxConcurrentReads: number; readonly maxCallGas?: number; readonly maxResponseBytes?: number; readonly reasons: readonly string[];
    readonly observedAtMs?: number; readonly validUntilMs?: number;
  }[];
  readonly assumptions: readonly string[];
}

/** One global carrier bound is conservative for every endpoint in the failover pool. */
export function keelRpcManifestReadConcurrency(manifest: KeelRpcReadManifest, requested = KEEL_DEFAULT_RPC_READ_CONCURRENCY, nowMs = Date.now()): number {
  integer(requested, "read concurrency", 1, 64); integer(nowMs, "current timestamp", 0);
  return Math.min(requested, ...manifest.endpoints.filter(record => record.observedAtMs <= nowMs && record.validUntilMs > nowMs)
    .map(record => record.maxConcurrentReads ?? requested));
}

/** Same bounded leaf concurrency and serial graph traversal as createKeelHoldObjectReader.
 * A model is always an estimate, even when some of its inputs were measured.
 */
export function estimateKeelHybridRead(input: {
  readonly manifest: KeelRpcReadManifest;
  readonly resources: readonly { readonly storedBytes: number; readonly chunkCount?: number }[];
  readonly maxConcurrentReads?: number;
  readonly nowMs?: number;
  readonly byteBasis?: "prepared-native" | "source-provisional";
}): KeelHybridReadEstimate {
  const supplied = input.manifest;
  const manifest = createKeelRpcReadManifest({ chainId: supplied.chainId, revision: supplied.revision, rpcUrls: supplied.rpcUrls, endpoints: supplied.endpoints,
    ...(supplied.policySource === "bundled" ? {} : { hostList: supplied.hostList }) });
  const concurrency = integer(input.maxConcurrentReads ?? KEEL_DEFAULT_RPC_READ_CONCURRENCY, "read concurrency", 1, 64);
  const now = integer(input.nowMs ?? Date.now(), "current timestamp", 0);
  if (!Array.isArray(input.resources) || input.resources.length < 1 || input.resources.length > 4096) throw new TypeError("Provide a bounded native-object inventory.");
  const resources = input.resources.map(item => {
    const storedBytes = integer(item.storedBytes, "stored bytes", 0, 256 * 1024 * 1024);
    const chunkCount = integer(item.chunkCount ?? Math.ceil(storedBytes / 23_000), "chunk count", storedBytes ? 1 : 0, 1_000_000);
    return { storedBytes, chunkCount, pages: Math.ceil(chunkCount / 128) };
  });
  const storedBytes = resources.reduce((sum, value) => sum + value.storedBytes, 0);
  integer(storedBytes, "total stored bytes", 0, 256 * 1024 * 1024);
  // Includes one root composite and chain + pinned-block bootstrap. No assumed pool speedup:
  // endpoints are failover alternatives, not simultaneous independent bandwidth lanes.
  const rootPages = Math.ceil(resources.length / 128);
  const bootstrap = 3, metadataReads = 1 + rootPages + resources.reduce((sum, item) => sum + 1 + item.pages, 0);
  const chunks = resources.reduce((sum, item) => sum + item.chunkCount, 0);
  const readCount = bootstrap + metadataReads + chunks;
  const pointerPages = resources.reduce((sum, item) => sum + item.pages, 0);
  const wireBytes = storedBytes * 2 + chunks * 256 + (1 + resources.length) * 2048
    + (rootPages + pointerPages) * 256 + (resources.length + chunks) * 64;
  const largestResponse = Math.max(2048, 256 + Math.min(resources.length, 128) * 64,
    ...resources.flatMap(item => [Math.min(item.storedBytes, 23_000) * 2 + 512, 256 + Math.min(item.chunkCount, 128) * 64]));
  const poolConcurrency = keelRpcManifestReadConcurrency(manifest, concurrency, now);
  const ranges: [number, number][] = [];
  const endpoints = manifest.rpcUrls.map(url => {
    const record = manifest.endpoints.find(item => item.url === url);
    const fresh = record !== undefined && record.observedAtMs <= now && record.validUntilMs > now;
    const evidence: KeelHybridReadEstimate["endpoints"][number]["evidence"] = record === undefined ? "unknown" : fresh ? record.basis : "stale";
    const capability = fresh ? record : undefined;
    const maxConcurrentReads = poolConcurrency;
    const reasons: string[] = [];
    if (!capability?.latencyMs || !capability?.bytesPerSecond) reasons.push("Missing fresh speed evidence: model assumes 250–1,500 ms per request wave and 125 KB–2 MB/s aggregate response throughput.");
    if (evidence === "stale") reasons.push("Expired or future-dated evidence is ignored.");
    if (capability?.maxCallGas === undefined) reasons.push("eth_call gas capacity is unknown; transaction gas policy does not answer it.");
    if (capability?.maxResponseBytes === undefined) reasons.push("Response-size capacity is unknown.");
    const eligible = capability?.maxResponseBytes === undefined || capability.maxResponseBytes >= largestResponse;
    if (!eligible) reasons.push("Reported response cap is below the modeled largest native-carrier response.");
    const waves = bootstrap + metadataReads + resources.reduce((sum, item) => sum + Math.ceil(item.chunkCount / maxConcurrentReads), 0);
    const latency = capability?.latencyMs ?? [250, 1500], throughput = capability?.bytesPerSecond ?? [125_000, 2_000_000];
    if (eligible) ranges.push([Math.ceil(waves * latency[0]! + 1000 * wireBytes / throughput[1]!), Math.ceil(waves * latency[1]! + 1000 * wireBytes / throughput[0]!)]);
    return { endpoint: redactRpcUrl(url), evidence, eligible, maxConcurrentReads,
      ...(record === undefined ? {} : { observedAtMs: record.observedAtMs, validUntilMs: record.validUntilMs }),
      ...(capability?.maxCallGas === undefined ? {} : { maxCallGas: capability.maxCallGas }),
      ...(capability?.maxResponseBytes === undefined ? {} : { maxResponseBytes: capability.maxResponseBytes }), reasons };
  });
  return { status: ranges.length ? "estimated" : "unavailable", ...(ranges.length ? { lowMs: Math.min(...ranges.map(item => item[0])), highMs: Math.max(...ranges.map(item => item[1])) } : {}),
    readCount, wireBytes, byteBasis: input.byteBasis ?? "source-provisional",
    policyStatus: supplied.policySource === "bundled" ? "bundled" : keelRpcHostListStale(manifest.hostList) ? "stale-snapshot" : "current-snapshot", endpoints,
    assumptions: ["Estimated RPC transport time only; not a benchmark or a loading guarantee.", "Uses serial object traversal, bounded parallel carrier reads and hex JSON response bytes; endpoint pools provide failover, not multiplied bandwidth.",
      "Models one composite root with 128-ID pages, 2 KiB object metadata allowances and 23,000-byte native carriers. Extra graph depth or larger metadata needs a prepared inventory.",
      "Excludes tokenURI acquisition, unavailable shell/module bytes, descriptor fallback, retries, rate-limit waits, decompression, integrity hashing and browser rendering.",
      "Local sandbox rendering does not exercise public RPC transport. IPFS and hosted-content references are separate delivery dependencies.",
      ...(input.byteBasis === "prepared-native" ? [] : ["Source-file sizes are provisional; preparation must supply the actual compressed native-object inventory."])] };
}
