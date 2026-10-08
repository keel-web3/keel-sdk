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
