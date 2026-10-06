import { createKeelRpcFetch, createKeelRpcPool, resolveKeelRpcConfiguration, type KeelRpcConfiguration, type KeelRpcPool, type ResolvedKeelRpcConfiguration } from '@keel/sdk/rpc';
import { readKeelRpcConfiguration } from '@keel/sdk/rpc-node';
import type { ToolContext, ToolDefinition, Workspace } from './types.js';

// Keep cooldowns and request pacing across tools; reload settings when the local config changes.
const caches = new WeakMap<Workspace, Map<string, { configuration: ResolvedKeelRpcConfiguration; pool: KeelRpcPool }>>();
export async function mcpRpc(context: ToolContext, explicit: KeelRpcConfiguration = {}, discoverExplicitChain = false) {
  const configuration = resolveKeelRpcConfiguration(explicit, process.env, await readKeelRpcConfiguration(context.workspace.root));
  const chainId = discoverExplicitChain && explicit.rpcUrl !== undefined && explicit.chainId === undefined ? undefined : configuration.chainId;
  const key = JSON.stringify([configuration, chainId ?? 'discover']);
  let cache = caches.get(context.workspace);
  if (!cache) { cache = new Map(); caches.set(context.workspace, cache); }
  let entry = cache.get(key);
  if (!entry) {
    if (cache.size >= 8) cache.clear();
    entry = { configuration, pool: createKeelRpcPool({ rpcUrls: configuration.rpcUrls, timeoutMs: configuration.timeoutMs, minIntervalMs: configuration.minIntervalMs, maxResponseBytes: configuration.maxResponseBytes, ...(chainId === undefined ? {} : { chainId }), allowLoopback: configuration.source === 'explicit' }) };
    cache.set(key, entry);
  }
  return { ...entry, rpcUrl: configuration.rpcUrls[0]!, fetchImpl: createKeelRpcFetch(entry.pool) };
}

export const RPC_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: { name: 'keel-rpc-check',
    description: 'Check read-only RPC access, chain identity and head using public Sepolia defaults, private workspace .keel/rpc.json or environment overrides. Fail over on provider errors/rate limits with pacing and cooldowns. Optional receiptHash checks required historical access. Exhaustion returns rpc.setup-required with instructions to help the user configure Alchemy, Infura or QuickNode locally. No wallet keys, signing or submission.',
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
