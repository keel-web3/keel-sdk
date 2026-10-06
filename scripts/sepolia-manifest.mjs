#!/usr/bin/env node
// Deployment discovery and optional public-chain verification. Never signs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http, keccak256, parseAbi } from 'viem';

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_MANIFEST_PROTOCOL = 'keel-sepolia-deployment-manifest@1';
const modernContracts = ['KeelCreatorFactory', 'KeelArtifactTokenRenderer'];
const addressEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const readerAbi = parseAbi(['function keelHold() view returns (address)', 'function metadataRenderer() view returns (address)']);

export function createSepoliaManifest(deployments) {
  const contracts = deployments.filter(row => row.chainId === SEPOLIA_CHAIN_ID).map(row => ({ ...row }));
  const missing = modernContracts.filter(name => !contracts.some(row => row.module === 'keel-die' && row.contract === name));
  const ambiguous = modernContracts.filter(name => contracts.filter(row => row.module === 'keel-die' && row.contract === name).length > 1);
  return {
    protocol: SEPOLIA_MANIFEST_PROTOCOL,
    chainId: SEPOLIA_CHAIN_ID,
    contracts,
    modernCreator: {
      status: missing.length ? 'missing-deployment-records' : ambiguous.length ? 'ambiguous-deployment-records' : 'requires-live-verification',
      missing,
      ambiguous,
      publicationReady: false,
      note: 'KeelFactory and KeelCreatorFactory are different contracts. Never substitute the older factory for the modern creator route.',
    },
    verification: { status: 'not-checked' },
    projectGates: ['registered-shell-and-reader', 'exact-module-and-resource-readback', 'complete-tokenURI-and-call-gas', 'offline-browser', 'creator-wallet-approval', 'mint-receipt-and-tokenURI-readback'],
    writes: 0,
  };
}

export async function verifySepoliaManifest(client, manifest) {
  if (manifest.chainId !== SEPOLIA_CHAIN_ID || await client.getChainId() !== SEPOLIA_CHAIN_ID) throw new Error('Expected Ethereum Sepolia (11155111).');
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const contracts = [];
  for (const entry of manifest.contracts) {
    const result = { ...entry };
    try {
      const code = await client.getCode({ address: entry.address, blockNumber });
      if (!code || code === '0x') throw new Error('missing-runtime');
      result.observedRuntimeCodeHash = keccak256(code);
      if (entry.runtimeCodeHash && entry.runtimeCodeHash !== result.observedRuntimeCodeHash) throw new Error('runtime-mismatch');
      if (!entry.txHash) throw new Error('missing-receipt-record');
      const receipt = await client.getTransactionReceipt({ hash: entry.txHash });
      if (receipt.status !== 'success' || !addressEqual(receipt.contractAddress, entry.address) || receipt.blockNumber > blockNumber || (entry.block !== null && receipt.blockNumber !== BigInt(entry.block))) throw new Error('receipt-mismatch');
      result.verification = { status: 'receipt-and-runtime-verified', deploymentBlock: String(receipt.blockNumber), deploymentBlockHash: receipt.blockHash };
    } catch (error) {
      // Provider errors may include authenticated URLs. Only emit our own codes.
      const codes = ['missing-runtime', 'runtime-mismatch', 'missing-receipt-record', 'receipt-mismatch'];
      result.verification = { status: 'not-verified', reason: codes.includes(error.message) ? error.message : 'rpc-read-failed' };
    }
    contracts.push(result);
  }
  const bindings = [];
  const holds = contracts.filter(row => row.contract === 'KeelHold' && row.verification.status === 'receipt-and-runtime-verified');
  for (const builder of contracts.filter(row => row.contract === 'KeelRawTokenURIBuilder')) {
    try {
      const hold = await client.readContract({ address: builder.address, abi: readerAbi, functionName: 'keelHold', blockNumber });
      bindings.push({ builder: builder.address, hold, status: holds.some(row => addressEqual(row.address, hold)) ? 'verified' : 'unrecorded-or-unverified-hold' });
    } catch { bindings.push({ builder: builder.address, status: 'rpc-read-failed' }); }
  }
  const modernCreator = { ...manifest.modernCreator };
  if (!modernCreator.missing.length && !modernCreator.ambiguous.length) {
    const factory = contracts.find(row => row.module === 'keel-die' && row.contract === modernContracts[0]);
    const renderer = contracts.find(row => row.module === 'keel-die' && row.contract === modernContracts[1]);
    try {
      const bound = await client.readContract({ address: factory.address, abi: readerAbi, functionName: 'metadataRenderer', blockNumber });
      modernCreator.status = addressEqual(bound, renderer.address) && [factory, renderer].every(row => row.verification.status === 'receipt-and-runtime-verified') ? 'infrastructure-verified-project-gates-required' : 'renderer-binding-or-identity-mismatch';
      modernCreator.factory = factory.address;
      modernCreator.renderer = renderer.address;
    } catch { modernCreator.status = 'renderer-binding-unverified'; }
  }
  return { ...manifest, contracts, modernCreator, bindings, verification: { status: contracts.length > 0 && contracts.every(row => row.verification.status === 'receipt-and-runtime-verified') && bindings.every(row => row.status === 'verified') ? 'checked' : 'partial', blockNumber: String(blockNumber), blockHash: block.hash, checkedAt: new Date().toISOString(), scope: 'Recorded infrastructure only. Runtime presence does not authenticate an ABI or prove project publication readiness.' } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--verify' && !arg.startsWith('--output='))) throw new Error('Usage: node scripts/sepolia-manifest.mjs [--verify] [--output=path]');
  const { KEEL_DEPLOYMENTS } = await import('../packages/sdk/dist/modules.js');
  let manifest = createSepoliaManifest(KEEL_DEPLOYMENTS);
  if (args.includes('--verify')) {
    const rpc = process.env.KEEL_SEPOLIA_RPC_URL ?? 'https://rpc.keel-test.149-28-255-65.sslip.io';
    manifest = await verifySepoliaManifest(createPublicClient({ transport: http(rpc, { timeout: 20_000, retryCount: 1 }) }), manifest);
  }
  try {
    const creator = JSON.parse(await readFile(resolve(import.meta.dirname, '../deployments/creator-inline-20261005/manifest.json'), 'utf8'));
    const instance = manifest.contracts.filter(row => row.instance === 'creator-inline-20261005');
    if (creator.chainId !== SEPOLIA_CHAIN_ID || !instance.some(row => row.contract === 'KeelCreatorFactory' && addressEqual(row.address, creator.factory)) || !instance.some(row => row.contract === 'KeelArtifactTokenRenderer' && addressEqual(row.address, creator.renderer))) throw new Error('Creator proof does not match recorded infrastructure.');
    manifest.creatorPreparedInline = { ...creator, evidence: 'recorded-live-mint-and-browser-proof; each new game requires its own project gates' };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
  if (output) { const file = resolve(output); await mkdir(dirname(file), { recursive: true }); await writeFile(file, json); console.log(`${manifest.contracts.length} Sepolia records -> ${file}; modern creator: ${manifest.modernCreator.status}`); }
  else process.stdout.write(json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Sepolia manifest failed. Build the SDK, check the selected RPC and retry. No transaction was sent.'); process.exitCode = 1; });
}
