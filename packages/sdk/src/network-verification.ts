/** Authenticate one selected deployment instance. Index presence alone is not proof. */
import { keccak256, encodeFunctionData, decodeFunctionResult, parseAbi, type Hex } from 'viem';
import { resolveKeelCreatorTarget, type KeelNetworkIndex, type KeelNetworkSelection } from './network-index.js';
import type { KeelRpcPool } from './rpc.js';
const abi = parseAbi(['function metadataRenderer() view returns (address)', 'function keelHold() view returns (address)']);
const equal = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
export async function verifyKeelIndexedCreator(pool: KeelRpcPool, index: KeelNetworkIndex, selection: KeelNetworkSelection = {}) {
  const target = resolveKeelCreatorTarget(index, selection);
  const observedChain = await pool.request({ method: 'eth_chainId' });
  if (typeof observedChain !== 'string' || Number(BigInt(observedChain)) !== target.chainId) throw new Error('Selected-chain identity mismatch.');
  const blockNumber = await pool.request({ method: 'eth_blockNumber' });
  if (typeof blockNumber !== 'string' || !/^0x[0-9a-f]+$/iu.test(blockNumber)) throw new Error('Invalid selected-chain head.');
  const block = await pool.request({ method: 'eth_getBlockByNumber', params: [blockNumber, false], requireResult: true }) as Record<string, unknown>;
  if (!block || block.number !== blockNumber || !/^0x[0-9a-f]{64}$/iu.test(String(block.hash))) throw new Error('Selected-chain head identity mismatch.');
  const contracts = [];
  for (const entry of target.deployments) {
    if (!entry.runtimeCodeHash || !entry.txHash || entry.block === null) throw new Error(`Missing runtime/receipt commitments for ${entry.contract}.`);
    const code = await pool.request({ method: 'eth_getCode', params: [entry.address, blockNumber] });
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/iu.test(code) || keccak256(code as Hex).toLowerCase() !== entry.runtimeCodeHash.toLowerCase()) throw new Error(`Runtime mismatch for ${entry.contract}.`);
    const receipt = await pool.request({ method: 'eth_getTransactionReceipt', params: [entry.txHash], requireResult: true }) as Record<string, unknown>;
    if (!receipt || receipt.status !== '0x1' || !equal(receipt.transactionHash, entry.txHash) || !equal(receipt.contractAddress, entry.address)
      || typeof receipt.blockNumber !== 'string' || !/^0x[0-9a-f]+$/iu.test(receipt.blockNumber) || BigInt(receipt.blockNumber) !== BigInt(entry.block)
      || BigInt(receipt.blockNumber) > BigInt(blockNumber) || !/^0x[0-9a-f]{64}$/iu.test(String(receipt.blockHash))) throw new Error(`Deployment receipt mismatch for ${entry.contract}.`);
    contracts.push({ ...entry, verification: 'receipt-and-runtime-verified', deploymentBlockHash: receipt.blockHash });
  }
  const read = async (address: Hex, functionName: 'metadataRenderer' | 'keelHold') => {
    const result = await pool.request({ method: 'eth_call', params: [{ to: address, data: encodeFunctionData({ abi, functionName }) }, blockNumber] });
    if (typeof result !== 'string') throw new Error('Invalid deployment binding result.');
    return decodeFunctionResult({ abi, functionName, data: result as Hex });
  };
  if (!equal(await read(target.factory, 'metadataRenderer'), target.renderer)) throw new Error('Creator factory/renderer binding mismatch.');
  const builders = target.deployments.filter(d => d.contract === 'KeelRawTokenURIBuilder');
  if (builders.length !== 1 || !equal(await read(builders[0]!.address, 'keelHold'), target.store)) throw new Error('Creator COPY/storage binding mismatch.');
  return { schema: 'keel-network-check@1', status: 'infrastructure-verified-project-gates-required', chainId: target.chainId,
    instance: target.instance, factory: target.factory, renderer: target.renderer, store: target.store, mintRoutes: target.mintRoutes,
    blockNumber: BigInt(blockNumber).toString(), blockHash: block.hash, contracts, providers: pool.status(),
    requiredGates: ['registered-shell-and-reader', 'exact-module-and-resource-readback', 'complete-tokenURI-and-call-gas', 'offline-browser', 'creator-wallet-approval', 'mint-receipt-and-tokenURI-readback'],
    checkedAt: new Date().toISOString(), signing: 'not-performed', submission: 'not-performed', writes: 0 };
}
