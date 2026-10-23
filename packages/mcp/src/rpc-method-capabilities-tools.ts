/** Explicit alternate adapter; not registered in the default MCP tool set. */
import { createKeelRpcFetch, createKeelRpcPool, type KeelRpcConfiguration, type KeelRpcPool, type ResolvedKeelRpcConfiguration } from '@keel/sdk/rpc-method-capabilities';
import { createKeelNodeRpc } from '@keel/sdk/rpc-method-capabilities-node';
import type { KeelNetworkIndex } from "@keel/sdk/network-index";
import type { ToolContext, Workspace } from "./types.js";
// Keep cooldowns and request pacing across tools; reload settings when the local config changes.
const caches = new WeakMap<Workspace, Map<string, { configuration: ResolvedKeelRpcConfiguration; pool: KeelRpcPool }>>();
export async function mcpRpc(context: ToolContext, explicit: KeelRpcConfiguration = {}, discoverExplicitChain = false, index?: KeelNetworkIndex) {
  const resolved = await createKeelNodeRpc({ workspace: context.workspace.root, explicit, ...(index ? { index } : {}) });
  const configuration = resolved.configuration;
  const chainId = discoverExplicitChain && explicit.rpcUrl !== undefined && explicit.chainId === undefined ? undefined : configuration.chainId;
  const key = JSON.stringify([configuration, chainId ?? 'discover']);
  let cache = caches.get(context.workspace);
  if (!cache) { cache = new Map(); caches.set(context.workspace, cache); }
  let entry = cache.get(key);
  if (!entry) {
    if (cache.size >= 8) cache.clear();
    entry = { configuration, pool: chainId === undefined ? createKeelRpcPool({ rpcUrls: configuration.rpcUrls, timeoutMs: configuration.timeoutMs, minIntervalMs: configuration.minIntervalMs, maxResponseBytes: configuration.maxResponseBytes, allowLoopback: true }) : resolved.pool };
    cache.set(key, entry);
  }
  return { ...entry, rpcUrl: configuration.rpcUrls[0]!, fetchImpl: createKeelRpcFetch(entry.pool) };
}

