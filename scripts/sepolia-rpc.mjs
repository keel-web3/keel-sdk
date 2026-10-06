import { createPublicClient, custom } from 'viem';
import { createKeelNodeRpc } from '../packages/sdk/dist/rpc-node.js';
import { findKeelRpcSetupError, KEEL_RPC_PROVIDER_SETUP } from '../packages/sdk/dist/rpc.js';
export async function createSepoliaReadClient(options = {}) {
  const { pool, configuration } = await createKeelNodeRpc({ ...options, explicit: { ...options.explicit, chainId: 11155111 } });
  const client = createPublicClient({ transport: custom({ request: input => pool.request({ ...input,
    requireResult: ['eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash'].includes(input.method) }) }, { retryCount: 0 }) });
  return { client, pool, configuration };
}
export function reportRpcFailure(error, fallback) {
  const setup = findKeelRpcSetupError(error);
  console.error(JSON.stringify(setup ? { code: setup.code, reason: setup.reason, providers: setup.providers,
    retryAfterMs: setup.retryAfterMs, setup: setup.setup, writes: 0 } : { error: fallback, setup: KEEL_RPC_PROVIDER_SETUP, writes: 0 }, null, 2));
}
