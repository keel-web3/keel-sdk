#!/usr/bin/env node
// Read-only: verify the deployment records shipped with the practice contracts.
import { createSepoliaReadClient, reportRpcFailure } from './sepolia-rpc.mjs';
import { keccak256 } from 'viem';
import { builderAbi, keelContracts, SEPOLIA_KEEL } from '../packages/game-engine/chain/contracts.mjs';
import { createSepoliaManifest, verifySepoliaManifest } from './sepolia-manifest.mjs';

export async function checkCreatorSepolia(client) {
  const { KEEL_DEPLOYMENTS } = await import('../packages/sdk/dist/modules.js');
  const rows = KEEL_DEPLOYMENTS.filter(row => row.chainId === 11155111 && row.instance === 'creator-inline-20261005');
  const result = await verifySepoliaManifest(client, createSepoliaManifest(rows));
  if (result.verification.status !== 'checked' || result.modernCreator.status !== 'infrastructure-verified-project-gates-required') throw Error('Modern creator infrastructure failed receipt, runtime or renderer-binding verification.');
  return result;
}

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
    const { client } = await createSepoliaReadClient();
    console.log(JSON.stringify(await checkCreatorSepolia(client), null, 2));
  } catch (error) {
    reportRpcFailure(error, 'Sepolia verification failed. Check chain identity and the shipped deployment records. No transaction was sent.');
    process.exitCode = 1;
  }
}
