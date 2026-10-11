import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const NATIVE_GETH_BINARY_SHA256 = 'fef73b4182183fc50fd343813b3210db75cacc0d933cb781b701bf13a6c9fb8d';
const image = 'ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd';
const helperHashes = {
  'run-isolated-geth.py': '2b65d5bf5a93ea91536aabb1ed6f383853b00417c508fd739d30c0a8adbe607e',
  'ipc-request.py': 'feb605eb2c8a073dc2e023d58f7e2c28302f923df49801d9827b012db788845c',
};
const methods = new Set(['web3_clientVersion', 'eth_chainId', 'net_version', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionCount', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getProof', 'eth_call', 'eth_estimateGas', 'eth_simulateV1', 'debug_traceCall']);
const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Explicit existing reviewed binary+helper bundle; never an automatic provider,
 * download, signer, Docker mutation or public network fallback. */
export function createNativeGethRuntime({ runtimeDirectory, dataDirectory, ipcPath, logPath }) {
  for (const path of [runtimeDirectory, dataDirectory, ipcPath, logPath]) assert.ok(typeof path === 'string' && isAbsolute(path), 'Explicit absolute native runtime/scratch paths required');
  const receipt = JSON.parse(readFileSync(join(runtimeDirectory, 'runtime-receipt.json'), 'utf8'));
  assert.equal(`ethereum/client-go@${receipt.indexDigest}`, image);
  assert.equal(receipt.binarySHA256, NATIVE_GETH_BINARY_SHA256);
  assert.equal(hashFile(join(runtimeDirectory, 'geth')), NATIVE_GETH_BINARY_SHA256);
  for (const [name, sha] of Object.entries(helperHashes)) assert.equal(hashFile(join(runtimeDirectory, name)), sha, `Unreviewed native helper ${name}`);
  const evidence = { executionEngine: 'verified-image-binary-network-namespace-ipc', image,
    binarySHA256: NATIVE_GETH_BINARY_SHA256, helperSHA256: helperHashes, runtimeReceiptSHA256: hashFile(join(runtimeDirectory, 'runtime-receipt.json')), isolation: [] };
  let process, isolationVerified = false, launchError;
  function verifyIsolation(value) {
    assert.equal(value.schema, 'keel-native-geth-isolation@1');
    assert.notEqual(value.parentNetns, value.netns); assert.deepEqual(value.interfaces, ['lo']); assert.deepEqual(value.ipv4Routes, []);
    assert.equal(value.rpc, 'filesystem-ipc'); assert.equal(value.binarySHA256, NATIVE_GETH_BINARY_SHA256);
    assert.equal(readlinkSync(`/proc/${value.pid}/ns/net`), value.netns, 'Running process namespace differs from receipt');
    const interfaces = readFileSync(`/proc/${value.pid}/net/dev`, 'utf8').trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
    assert.deepEqual(interfaces, ['lo']);
    assert.equal(readFileSync(`/proc/${value.pid}/net/route`, 'utf8').trim().split('\n').slice(1).filter(line => line.trim()).length, 0);
    evidence.isolation.push(value); isolationVerified = true;
  }
  function rawRequest(method, params) {
    assert.ok(methods.has(method), 'Unsupported read-only native RPC method');
    assert.ok(isolationVerified && process && process.exitCode === null && process.signalCode === null, 'Native RPC requires a live verified isolated process');
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    return JSON.parse(execFileSync('python3', [join(runtimeDirectory, 'ipc-request.py'), ipcPath], { input: request, encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }));
  }
  function request(method, params) {
    const response = rawRequest(method, params);
    if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
    return response.result;
  }
  async function stop() {
    isolationVerified = false;
    if (!process) return;
    const child = process;
    if (child.exitCode === null && child.signalCode === null) await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Native Geth did not stop within five seconds')); }, 5_000);
      child.once('exit', () => { clearTimeout(timeout); resolve(); }); child.kill('SIGTERM');
    });
    process = undefined;
  }
  function init(genesisPath) {
    assert.ok(!process && isAbsolute(genesisPath), 'Init needs explicit genesis and no running process');
    execFileSync('python3', [join(runtimeDirectory, 'run-isolated-geth.py'), 'init', '--datadir', dataDirectory, '--genesis', genesisPath], { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  async function start(gascap) {
    assert.ok(Number.isSafeInteger(gascap) && gascap > 0 && gascap <= 2_000_000_000, 'Explicit bounded native RPC gas budget required');
    await stop(); launchError = undefined;
    const log = openSync(logPath, 'w', 0o600);
    try { process = spawn('python3', [join(runtimeDirectory, 'run-isolated-geth.py'), 'serve', '--datadir', dataDirectory, '--ipcpath', ipcPath, '--gascap', String(gascap)], { stdio: ['ignore', log, log] }); }
    finally { closeSync(log); }
    process.on('error', error => { launchError = error; });
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (launchError) throw launchError;
        if (process.exitCode !== null || process.signalCode !== null) throw new Error('Native Geth exited before readiness');
        if (!isolationVerified) {
          const line = readFileSync(logPath, 'utf8').split('\n').find(line => line.startsWith('{') && line.includes('keel-native-geth-isolation@1'));
          if (line) verifyIsolation(JSON.parse(line));
        }
        if (isolationVerified) { try { request('eth_chainId', []); return; } catch { /* IPC may not be listening yet. */ } }
        await delay(100);
      }
      throw new Error('Native Geth readiness exceeded ten seconds');
    } catch (error) { await stop(); throw error; }
  }
  return { evidence, init, start, stop, request, rawRequest };
}
