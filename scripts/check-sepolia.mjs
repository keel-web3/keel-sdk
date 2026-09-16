#!/usr/bin/env node
// Read-only: verify the deployment records shipped with the practice contracts.
import { createPublicClient, http, keccak256 } from 'viem';
import { builderAbi, keelContracts, SEPOLIA_KEEL } from '../packages/game-engine/chain/contracts.mjs';

export async function checkSepolia(client, record = keelContracts()) {
  if (await client.getChainId() !== 11155111) throw Error('Expected Sepolia (11155111); refusing another chain.');
  const blockNumber = await client.getBlockNumber();
  const checked = [];
  for (const name of ['KeelHold', 'KeelRawTokenURIBuilder']) {
    const entry = record.contracts[name];
    const address = SEPOLIA_KEEL[name];
    if (entry.sepolia.toLowerCase() !== address.toLowerCase() || entry.deploymentTransaction !== SEPOLIA_KEEL.deployments[name]) throw Error(`${name}: deployment record mismatch.`);
    const code = await client.getCode({ address, blockNumber });
    if (!code || code === '0x' || keccak256(code) !== entry.runtimeCodeHash) throw Error(`${name}: runtime code differs from the shipped Sepolia record.`);
    const receipt = await client.getTransactionReceipt({ hash: entry.deploymentTransaction });
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== address.toLowerCase() || receipt.blockNumber > blockNumber) throw Error(`${name}: deployment receipt does not match.`);
    checked.push({ name, address, runtimeCodeHash: entry.runtimeCodeHash, transactionHash: entry.deploymentTransaction });
  }
  const hold = await client.readContract({ address: SEPOLIA_KEEL.KeelRawTokenURIBuilder, abi: builderAbi, functionName: 'keelHold', blockNumber });
  if (hold.toLowerCase() !== SEPOLIA_KEEL.KeelHold.toLowerCase()) throw Error('Builder is bound to another storage contract.');
  return { chainId: 11155111, blockNumber: String(blockNumber), contracts: checked, writes: 0, scope: 'Infrastructure identity only; module, shell and artwork publication still require their own receipts and read-back.' };
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL((await import('node:path')).resolve(process.argv[1])).href) {
  try {
    const rpc = process.env.KEEL_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
    const client = createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) });
    console.log(JSON.stringify(await checkSepolia(client), null, 2));
  } catch {
    // RPC URLs can contain credentials; don't print transport request details.
    console.error('Sepolia verification failed. Check KEEL_SEPOLIA_RPC_URL, chain identity, and the shipped deployment records. No transaction was sent.');
    process.exitCode = 1;
  }
}
