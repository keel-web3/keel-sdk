import { KEEL_MANAGED_SHELL_RUNTIME } from "./managed-shell-runtime.js";
import { assertKeelRpcUrl, KEEL_DEFAULT_RPC_HOSTS } from "@keel/protocol";
import { getAddress, type Address, type Hex } from "viem";
import { createKeelRpcReadManifest, keelRpcManifestReadConcurrency, KEEL_DEFAULT_RPC_READ_CONCURRENCY, type KeelRpcReadManifest } from "./rpc-read-manifest.js";
import type { KeelEffectiveBuildDefaults } from "./studio-project-defaults.js";

/** A small Hybrid bridge that reads native KEEL chunks and mounts the existing
 * committed canonical shell. It contains no replacement shell or offchain art. */
export function buildKeelManagedShellLoader(input: {
  chainId: number; store: Address; objectId: Hex; digest: Hex;
  /** Compatibility shorthand. Prefer the selected network's governed pool. */
  rpcUrl?: string;
  rpcUrls?: readonly string[];
  rpcHosts?: readonly string[];
  /** Exact snapshot selected by the caller. Remote updates require verifyKeelRpcReadManifest first. */
  rpcManifest?: KeelRpcReadManifest;
  /** Resolve from a fresh authoritative profile; explicit per-build concurrency still wins. */
  buildDefaults?: KeelEffectiveBuildDefaults;
  maxConcurrentReads?: number;
}): string {
  if (input.rpcUrl !== undefined && input.rpcUrls !== undefined) throw new Error("Choose rpcUrl or rpcUrls, not both");
  if (input.rpcManifest !== undefined && (input.rpcUrl !== undefined || input.rpcUrls !== undefined || input.rpcHosts !== undefined)) throw new Error("Choose an RPC manifest or explicit endpoints/hosts, not both");
  const supplied = input.rpcManifest;
  const manifest = supplied === undefined ? undefined : createKeelRpcReadManifest({ chainId: supplied.chainId, revision: supplied.revision, rpcUrls: supplied.rpcUrls, endpoints: supplied.endpoints,
    ...(supplied.policySource === "bundled" ? {} : { hostList: supplied.hostList }) });
  if (manifest !== undefined && manifest.chainId !== input.chainId) throw new Error("Hybrid manifest is for another chain");
  const selected = manifest?.rpcUrls ?? input.rpcUrls ?? (input.rpcUrl === undefined ? [] : [input.rpcUrl]);
  if (selected.length < 1 || selected.length > 8) throw new Error("Hybrid KEEL needs one to eight governed RPC endpoints");
  const hosts = [...(manifest?.hostList.hosts ?? input.rpcHosts ?? KEEL_DEFAULT_RPC_HOSTS)];
  if (hosts.length < 1 || hosts.length > 32) throw new Error("Invalid Hybrid KEEL RPC host policy");
  const rpcUrls = selected.map(value => {
    assertKeelRpcUrl(value, hosts);
    const url = new URL(value);
    if (url.hash) throw new Error("Invalid Hybrid KEEL RPC URL");
    return url.toString();
  });
  if (new Set(rpcUrls).size !== rpcUrls.length) throw new Error("Duplicate Hybrid KEEL RPC endpoint");
  const requestedMaxConcurrentReads = input.maxConcurrentReads ?? Number(input.buildDefaults?.values.rpcMaxConcurrentReads ?? KEEL_DEFAULT_RPC_READ_CONCURRENCY);
  const maxConcurrentReads = manifest === undefined ? requestedMaxConcurrentReads : keelRpcManifestReadConcurrency(manifest, requestedMaxConcurrentReads);
  if (!Number.isSafeInteger(maxConcurrentReads) || maxConcurrentReads < 1 || maxConcurrentReads > 64) throw new Error("Invalid Hybrid KEEL read concurrency");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0
    || !/^0x[0-9a-f]{64}$/i.test(input.objectId) || !/^0x[0-9a-f]{64}$/i.test(input.digest)) throw new Error("Invalid Hybrid KEEL reference");
  const configuration = { chainId: input.chainId, store: getAddress(input.store), objectId: input.objectId,
    digest: input.digest, rpcUrls, rpcHosts: hosts, maxConcurrentReads,
    ...(manifest === undefined ? {} : { requestedMaxConcurrentReads, rpcManifestRevision: manifest.revision, rpcHostListRevision: manifest.hostList.revision,
      rpcHostListEpoch: manifest.hostList.epoch, rpcHostListCurrentEpoch: manifest.hostList.currentEpoch }) };
  const literal = (v: unknown) => JSON.stringify(v).replaceAll("<", "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loading artwork</title></head><body><p id="keel-loader-status">Loading onchain artwork…</p><script>globalThis.__KEEL_MANAGED_SHELL__=${literal(configuration)};${KEEL_MANAGED_SHELL_RUNTIME.replaceAll("</script", "<\\/script")}</script></body></html>`;
}

/** Recognize only the complete maintained loader under the bundled host policy.
 * In-band host lists/revisions are configuration, never governance evidence. */
export function isKeelGovernedManagedShellLoader(document: string): boolean {
  const marker = "<script>globalThis.__KEEL_MANAGED_SHELL__=";
  const start = document.indexOf(marker);
  const runtime = `;${KEEL_MANAGED_SHELL_RUNTIME.replaceAll("</script", "<\\/script")}</script></body></html>`;
  if (start < 0 || !document.endsWith(runtime)) return false;
  try {
    const value = JSON.parse(document.slice(start + marker.length, -runtime.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const baseKeys = ["chainId", "store", "objectId", "digest", "rpcUrls", "rpcHosts", "maxConcurrentReads"];
    const manifestKeys = ["requestedMaxConcurrentReads", "rpcManifestRevision", "rpcHostListRevision", "rpcHostListEpoch", "rpcHostListCurrentEpoch"];
    const hasManifest = manifestKeys.some(key => Object.hasOwn(value, key));
    const keys = hasManifest ? [...baseKeys, ...manifestKeys] : baseKeys;
    if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return false;
    if (!Array.isArray(value.rpcHosts) || value.rpcHosts.length < 1 || new Set(value.rpcHosts).size !== value.rpcHosts.length
      || value.rpcHosts.some((host: unknown) => typeof host !== "string" || !KEEL_DEFAULT_RPC_HOSTS.includes(host))) return false;
    if (!Array.isArray(value.rpcUrls) || value.rpcUrls.some((endpoint: unknown) => {
      if (typeof endpoint !== "string") return true;
      assertKeelRpcUrl(endpoint, KEEL_DEFAULT_RPC_HOSTS);
      return false;
    })) return false;
    const plain = buildKeelManagedShellLoader({chainId: value.chainId, store: value.store, objectId: value.objectId, digest: value.digest,
      rpcUrls: value.rpcUrls, rpcHosts: value.rpcHosts, maxConcurrentReads: value.maxConcurrentReads});
    let expected = plain;
    if (hasManifest) {
      if (manifestKeys.some(key => !Number.isSafeInteger(value[key]) || value[key] < (key === "requestedMaxConcurrentReads" ? 1 : 0))
        || value.requestedMaxConcurrentReads > 64 || value.maxConcurrentReads > value.requestedMaxConcurrentReads) return false;
      // Revisions are retained data, not authenticated governance claims. The
      // endpoints above must independently satisfy the bundled host policy.
      const base = JSON.parse(plain.slice(plain.indexOf(marker) + marker.length, -runtime.length));
      for (const key of manifestKeys) base[key] = value[key];
      expected = plain.slice(0, plain.indexOf(marker) + marker.length) + JSON.stringify(base).replaceAll("<", "\\u003c") + runtime;
    }
    return document === expected;
  } catch { return false; }
}
