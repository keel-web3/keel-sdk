import { createKeelRpcFetch, createKeelRpcPool, type KeelRpcConfiguration, type KeelRpcPool, type ResolvedKeelRpcConfiguration } from '@keel/sdk/rpc';
import { createKeelNodeRpc } from '@keel/sdk/rpc-node';
import { discoverKeelNodeNetworks } from '@keel/sdk/network-node';
import { resolveKeelCreatorTarget, type KeelNetworkSelection, type KeelNetworkIndex } from '@keel/sdk/network-index';
import { verifyKeelIndexedCreator } from '@keel/sdk/network-verification';
import { redactRpcUrl } from '@keel/protocol';
import type { ToolContext, ToolDefinition, Workspace } from './types.js';

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

const discoverySchema = { type: 'object', additionalProperties: false, properties: {
  chainId: { type: 'integer', minimum: 1 }, instance: { type: 'string', minLength: 1, maxLength: 256 },
  indexUrl: { type: 'string', minLength: 1, maxLength: 2048 },
} } as const;
function selectionInput(value: unknown): KeelNetworkSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Supply a network selection object.');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['chainId', 'instance', 'indexUrl'].includes(k)) || v.chainId !== undefined && (!Number.isSafeInteger(v.chainId) || Number(v.chainId) < 1)
    || v.instance !== undefined && (typeof v.instance !== 'string' || !v.instance.length || v.instance.length > 256) || v.indexUrl !== undefined && typeof v.indexUrl !== 'string') throw new TypeError('Invalid network selection.');
  return v as KeelNetworkSelection;
}
export const RPC_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: { name: 'keel-network-discover', inputSchema: discoverySchema,
    description: 'Discover where KEEL is actually deployed from its configured public deployment index. Resolve selected chain and active creator instance using explicit input, .keel/config.json and environment configuration. Returns recorded contracts, public RPC pools and missing verification gates. Wallet/faucet network catalogs are not deployment evidence. Metadata only; no wallet or signing.' },
  async run(context, value) {
    const found = await discoverKeelNodeNetworks({ workspace: context.workspace.root, explicit: selectionInput(value), refresh: true });
    let creator: ReturnType<typeof resolveKeelCreatorTarget> | null = null;
    try { creator = resolveKeelCreatorTarget(found.index, found.selection); } catch { /* Legacy instances remain discoverable. */ }
    return { schema: 'keel-network-discovery@1', source: found.source, indexUrl: redactRpcUrl(found.indexUrl),
      selected: { chainId: found.network.chainId, name: found.network.name, instance: found.selection.instance ?? found.network.defaultInstance ?? null, creator },
      networks: found.index.networks.map(n => ({ ...n, rpcUrls: n.rpcUrls.map(u => redactRpcUrl(u)) })),
      verification: 'recorded-not-live-verified', nextTool: 'keel-network-check', signing: 'not-performed', submission: 'not-performed' };
  },
}, {
  descriptor: { name: 'keel-network-check', inputSchema: discoverySchema,
    description: 'Read-only verification of the index/config-selected creator instance: chain identity, recorded deployment receipts, runtime hashes and factory/renderer and COPY/storage bindings. RPC defaults come from that network in the public index. Artwork, shell, full tokenURI, browser and mint evidence remain separate gates. No signing or submission.' },
  async run(context, value) {
    const found = await discoverKeelNodeNetworks({ workspace: context.workspace.root, explicit: selectionInput(value) });
    const rpc = await mcpRpc(context, { chainId: found.network.chainId }, false, found.index);
    return verifyKeelIndexedCreator(rpc.pool, found.index, found.selection);
  },
}, {
  descriptor: { name: 'keel-rpc-check',
    description: 'Check read-only RPC access, chain identity and head using the index/config-selected network public RPC pool, private workspace .keel/rpc.json or environment overrides. Fail over on provider errors/rate limits with pacing and cooldowns. Optional receiptHash checks required historical access. Exhaustion returns rpc.setup-required with instructions to help the user configure Alchemy, Infura or QuickNode for the selected chain. No wallet keys, signing or submission.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      rpcUrl: { type: 'string', minLength: 1, maxLength: 2048 }, chainId: { type: 'integer', minimum: 1 },
      receiptHash: { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
    } },
  },
  async run(context, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('RPC check needs an object.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(k => !['rpcUrl', 'chainId', 'receiptHash'].includes(k))
        || input.rpcUrl !== undefined && typeof input.rpcUrl !== 'string'
        || input.chainId !== undefined && typeof input.chainId !== 'number'
        || input.receiptHash !== undefined && (typeof input.receiptHash !== 'string' || !/^0x[0-9a-f]{64}$/iu.test(input.receiptHash))) throw new TypeError('Invalid RPC check fields.');
    const rpc = await mcpRpc(context, input as KeelRpcConfiguration);
    const chainId = await rpc.pool.request({ method: 'eth_chainId' });
    const block = await rpc.pool.request({ method: 'eth_blockNumber' });
    if (typeof block !== 'string' || !/^0x[0-9a-f]+$/iu.test(block)) throw new Error('RPC returned an invalid head block.');
    if (input.receiptHash !== undefined) {
      const receipt = await rpc.pool.request({ method: 'eth_getTransactionReceipt', params: [input.receiptHash], requireResult: true }) as Record<string, unknown>;
      if (receipt.transactionHash?.toString().toLowerCase() !== (input.receiptHash as string).toLowerCase() || typeof receipt.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/iu.test(receipt.blockHash)) throw new Error('RPC returned an invalid receipt identity.');
    }
    return { schema: 'keel-rpc-check@1', status: 'checked', source: rpc.configuration.source,
      chainId: Number(BigInt(chainId as string)), blockNumber: BigInt(block).toString(),
      historicalReceipt: input.receiptHash === undefined ? 'not-checked' : 'readable-identity-checked',
      providers: rpc.pool.status(), signing: 'not-performed', submission: 'not-performed' };
  },
}];
