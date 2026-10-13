#!/usr/bin/env node
// Normal, chain-independent discovery/check workflow. Never signs or submits.
import { writeFile } from 'node:fs/promises';
import { discoverKeelNodeNetworks } from '../packages/sdk/dist/network-node.js';
import { buildKeelNetworkIndex, resolveKeelCreatorTarget } from '../packages/sdk/dist/network-index.js';
import { createKeelNodeRpc } from '../packages/sdk/dist/rpc-node.js';
import { verifyKeelIndexedCreator } from '../packages/sdk/dist/network-verification.js';
import { redactRpcUrl } from '../packages/protocol/dist/index.js';
import { reportRpcFailure } from './sepolia-rpc.mjs';

const args = process.argv.slice(2), mode = args.shift(), explicit = {};
let workspace = process.cwd(), output;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i+1]) workspace = args[++i];
  else if (args[i] === '--chain-id' && /^\d+$/u.test(args[i+1] ?? '')) explicit.chainId = Number(args[++i]);
  else if (args[i] === '--instance' && args[i+1]) explicit.instance = args[++i];
  else if (args[i] === '--index-url' && args[i+1]) explicit.indexUrl = args[++i];
  else if (args[i] === '--output' && args[i+1]) output = args[++i];
  else throw new Error('Usage: pnpm network:discover|network:check [--workspace directory] [--chain-id id] [--instance name] [--index-url url]; pnpm network:index --output file');
}
try {
  let result;
  if (mode === 'export') result = buildKeelNetworkIndex();
  else if (mode === 'discover' || mode === 'check') {
    const found = await discoverKeelNodeNetworks({ workspace, explicit, refresh: true });
    if (mode === 'check') {
      const { pool } = await createKeelNodeRpc({ workspace, explicit: { chainId: found.network.chainId }, index: found.index });
      result = await verifyKeelIndexedCreator(pool, found.index, found.selection);
    } else result = { source: found.source, indexUrl: redactRpcUrl(found.indexUrl), selected: found.selection,
      creator: (() => { try { return resolveKeelCreatorTarget(found.index, found.selection); } catch { return null; } })(),
      networks: found.index.networks.map(n => ({ ...n, rpcUrls: n.rpcUrls.map(u => redactRpcUrl(u)) })), verification: 'recorded-not-live-verified', writes: 0 };
  } else throw new Error('Choose discover, check or export.');
  const json = JSON.stringify(result, null, 2)+'\n';
  if (output) await writeFile(output, json); else process.stdout.write(json);
} catch (error) {
  reportRpcFailure(error, error?.code === 'network.index-unavailable' ? error.message : 'Network discovery/verification failed. Check .keel/config.json and the index-selected chain/instance; no transaction was sent.');
  process.exitCode = 1;
}
