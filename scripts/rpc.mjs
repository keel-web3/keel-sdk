#!/usr/bin/env node
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { createKeelNodeRpc, readKeelRpcConfiguration } from '../packages/sdk/dist/rpc-node.js';
import { resolveKeelRpcConfiguration, KEEL_RPC_PROVIDER_SETUP } from '../packages/sdk/dist/rpc.js';
import { reportRpcFailure } from './sepolia-rpc.mjs';

const args = process.argv.slice(2), mode = args.shift();
let workspace = process.cwd(), fromEnv = false, receipt;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) workspace = resolve(args[++i]);
  else if (args[i] === '--from-env') fromEnv = true;
  else if (args[i] === '--receipt' && /^0x[0-9a-f]{64}$/iu.test(args[i + 1] ?? '')) receipt = args[++i];
  else throw new Error('Usage: pnpm rpc:check|rpc:configure [--workspace directory] [--receipt hash] [--from-env]');
}
try {
  if (mode === 'check') {
    const { pool, configuration } = await createKeelNodeRpc({ workspace });
    const chainId = Number(BigInt(await pool.request({ method: 'eth_chainId' })));
    const head = await pool.request({ method: 'eth_blockNumber' });
    if (typeof head !== 'string' || !/^0x[0-9a-f]+$/iu.test(head)) throw new Error('Invalid RPC head.');
    if (receipt) {
      const value = await pool.request({ method: 'eth_getTransactionReceipt', params: [receipt], requireResult: true });
      if (value?.transactionHash?.toLowerCase() !== receipt.toLowerCase() || !/^0x[0-9a-f]{64}$/iu.test(value?.blockHash ?? '')) throw new Error('Invalid RPC receipt identity.');
    }
    console.log(JSON.stringify({ status: 'checked', chainId, blockNumber: BigInt(head).toString(), source: configuration.source,
      providers: pool.status(), historicalReceipt: receipt ? 'readable-identity-checked' : 'not-checked', writes: 0 }, null, 2));
  } else if (mode === 'configure') {
    let rpcUrls;
    if (fromEnv) {
      const resolved = resolveKeelRpcConfiguration({}, process.env);
      if (resolved.source !== 'environment') throw new Error('Set KEEL_SEPOLIA_RPC_URL or KEEL_SEPOLIA_RPC_URLS locally first.');
      rpcUrls = resolved.rpcUrls;
    } else {
      if (!process.stdin.isTTY) throw new Error('Use an interactive terminal, or --from-env with a locally set KEEL_SEPOLIA_RPC_URL.');
      console.log('Create an Ethereum Sepolia endpoint with Alchemy, Infura or QuickNode. Use chain 11155111 and permit this machine to read contracts/receipts.');
      for (const provider of KEEL_RPC_PROVIDER_SETUP.providers) console.log(`${provider.name}: ${provider.documentation}`);
      // Typed provider keys never echo into terminal/session logs.
      const hidden = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      const rl = createInterface({ input: process.stdin, output: hidden, terminal: true, historySize: 0 });
      process.stdout.write('Paste HTTPS RPC URL (input hidden; comma-separated URLs allowed): ');
      try { const value = await new Promise(resolve => rl.question('', resolve)); rpcUrls = String(value).split(',').map(s => s.trim()); }
      finally { rl.close(); console.log(); }
    }
    const prior = await readKeelRpcConfiguration(workspace);
    const { rpcUrl: _old, ...settings } = prior;
    const config = { ...settings, schema: 'keel-rpc-config@1', chainId: 11155111, rpcUrls };
    resolveKeelRpcConfiguration({}, {}, config);
    const root = await realpath(workspace), directory = resolve(root, '.keel');
    await mkdir(directory, { recursive: true });
    const actual = await realpath(directory), local = relative(root, actual);
    if (local === '..' || local.startsWith('../') || isAbsolute(local)) throw new Error('Private RPC config must stay inside the selected workspace.');
    const target = resolve(actual, 'rpc.json'), temp = resolve(actual, `.rpc-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
    const ignore = resolve(root, '.gitignore');
    let previous = ''; try { previous = await readFile(ignore, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!previous.split(/\r?\n/u).includes('/.keel/rpc.json')) await writeFile(ignore, previous + (previous && !previous.endsWith('\n') ? '\n' : '') + '/.keel/rpc.json\n');
    console.log(`Saved private RPC settings to ${target} (0600). Run pnpm rpc:check${workspace === process.cwd() ? '' : ' --workspace ' + JSON.stringify(workspace)}. Environment overrides still take precedence.`);
  } else throw new Error('Choose check or configure.');
} catch (error) {
  reportRpcFailure(error, 'RPC check/configuration failed. Check local settings or run interactive pnpm rpc:configure. No transaction was sent.');
  process.exitCode = 1;
}
