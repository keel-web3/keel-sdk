import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const sha = value => createHash('sha256').update(value).digest('hex');
const MAX_COMMAND = 2 * 8 * 1024 * 1024 + 4096, MAX_RESPONSE = 128 * 1024 * 1024;

/** One fresh private witness file per replay, removed only after confirmed
 * process exit. Failure preserves it for diagnosis; no shared source is edited. */
export function createCanonicalNativeProcessFactory({ binaryPath, binarySHA256, timeoutMs = 60_000, onProcess } = {}) {
  return async input => {
    const directory = mkdtempSync(join(tmpdir(), 'keel-native-witness-'));
    const inputPath = join(directory, 'canonical-witness.json'), bytes = JSON.stringify(input);
    writeFileSync(inputPath, bytes, { flag: 'wx', mode: 0o600 });
    const client = await createNativeProcessClient({ binaryPath, binarySHA256, inputPath, inputSHA256: sha(bytes), timeoutMs });
    try { onProcess?.(client.evidence); } catch (error) { await client.close(); rmSync(directory, { recursive: true }); throw error; }
    let closing;
    return { evidence: client.evidence, request: (...args) => client.request(...args), close: () => closing ??= (async () => {
      await client.close(); assert.equal(client.evidence.exitConfirmed, true);
      rmSync(directory, { recursive: true });
    })() };
  };
}

/** Network-isolated native diagnostic process, not an RPC provider. A reviewed native
 * build/hash and immutable witness file are required explicitly by the caller. */
export async function createNativeProcessClient({ binaryPath, binarySHA256, inputPath, inputSHA256, timeoutMs = 60_000 }) {
  for (const path of [binaryPath, inputPath]) {
    assert.ok(isAbsolute(path)); assert.ok(lstatSync(path).isFile(), 'Regular non-symlink private input/binary required');
  }
  assert.match(binarySHA256, /^[0-9a-f]{64}$/); assert.match(inputSHA256, /^[0-9a-f]{64}$/);
  assert.equal(sha(readFileSync(binaryPath)), binarySHA256, 'Native executable differs from reviewed build');
  assert.ok(lstatSync(inputPath).size <= 256 * 1024 * 1024);
  assert.equal(sha(readFileSync(inputPath)), inputSHA256, 'Canonical witness input changed');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
  const executable = realpathSync(binaryPath), parentNetns = readlinkSync('/proc/self/ns/net');
  const child = spawn('/usr/bin/unshare', ['-Urn', executable, '--input', realpathSync(inputPath)], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' },
  });
  const evidence = { schema: 'keel-private-native-stage-process@1', binarySHA256, inputSHA256,
    executable, pid: child.pid, requests: [], isolated: false, networkRequests: 0, signing: false, submission: false };
  let closed = false, closePromise, pending, buffer = Buffer.alloc(0), stderr = Buffer.alloc(0), failed;
  const rejectPending = error => { if (pending) { const item = pending; pending = undefined; item.cleanup(); item.reject(error); } };
  const fail = error => { failed ??= error; rejectPending(error); };
  const kill = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); };
  child.on('error', error => fail(error));
  child.on('exit', (code, signal) => { if (!closed || pending) fail(Object.assign(new Error('Local native session exited before completion'), { code: 'LOCAL_PROCESS_EXIT', exitCode: code, signal })); });
  child.stderr.on('data', chunk => { stderr = Buffer.concat([stderr, chunk]); if (stderr.length > 1024 * 1024) { fail(new Error('Native diagnostic stderr bound exceeded')); kill(); } });
  child.stdout.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_RESPONSE) { fail(new Error('Native response bound exceeded')); kill(); return; }
    for (;;) {
      const newline = buffer.indexOf(10); if (newline === -1) return;
      const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
      if (!pending) { fail(new Error('Unexpected unsolicited native response')); kill(); return; }
      const item = pending; pending = undefined; item.cleanup();
      try {
        const response = JSON.parse(line);
        assert.equal(response.id, item.id, 'Native response identity differs');
        assert.equal(!!response.result === !!response.error, false, 'Native result/error envelope invalid');
        evidence.requests.push({ id: item.id, type: item.type, commandSHA256: item.commandSHA256, responseSHA256: sha(line), responseBytes: line.length });
        item.resolve(response);
      } catch (error) { item.reject(error); fail(error); kill(); return; }
    }
  });
  const close = () => {
    if (closePromise) return closePromise;
    closed = true; rejectPending(Object.assign(new Error('Local native session closed'), { code: 'LOCAL_SESSION_CLOSED' }));
    child.stdin.destroy(); kill();
    closePromise = (async () => {
      const waitExit = ms => new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
        const onExit = () => { clearTimeout(timer); resolve(true); };
        const timer = setTimeout(() => { child.removeListener('exit', onExit); resolve(false); }, ms);
        child.once('exit', onExit);
      });
      if (!await waitExit(2_000)) { child.kill('SIGKILL'); if (!await waitExit(2_000)) throw new Error('Native session cleanup failed: process exit unconfirmed'); }
      evidence.closed = true; evidence.exitConfirmed = true; evidence.stderrSHA256 = sha(stderr); evidence.stderrBytes = stderr.length;
    })();
    return closePromise;
  };
  const closeLater = () => { void close().catch(error => { failed ??= error; evidence.cleanupFailed = true; }); };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed) throw failed;
      try {
        const netns = readlinkSync(`/proc/${child.pid}/ns/net`), runningExe = readlinkSync(`/proc/${child.pid}/exe`);
        if (netns !== parentNetns && runningExe === executable) {
          const interfaces = readFileSync(`/proc/${child.pid}/net/dev`, 'utf8').trim().split('\n').slice(2).map(line => line.split(':')[0].trim());
          const routes = readFileSync(`/proc/${child.pid}/net/route`, 'utf8').trim().split('\n').slice(1).filter(Boolean);
          assert.deepEqual(interfaces, ['lo']); assert.deepEqual(routes, []);
          assert.equal(sha(readFileSync(`/proc/${child.pid}/exe`)), binarySHA256, 'Running native binary changed');
          evidence.isolated = true; evidence.parentNetns = parentNetns; evidence.netns = netns; evidence.interfaces = interfaces; evidence.routes = routes; break;
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(20);
    }
    assert.equal(evidence.isolated, true, 'Native session did not enter verified network isolation');
  } catch (error) { await close(); throw error; }
  return { evidence, close, request(command, { signal } = {}) {
    if (closed || failed) return Promise.reject(failed ?? new Error('Local native session is closed'));
    if (pending) return Promise.reject(new Error('Only one bounded native request may be pending'));
    if (signal?.aborted) { closeLater(); return Promise.reject(new Error('Local native request cancelled')); }
    const data = JSON.stringify(command);
    if (Buffer.byteLength(data) > MAX_COMMAND || !['begin', 'stage', 'finish', 'status', 'abort'].includes(command.type)) return Promise.reject(new Error('Unsupported or oversized private native command'));
    return new Promise((resolve, reject) => {
      const onAbort = () => { fail(Object.assign(new Error('Local native request cancelled'), { code: 'LOCAL_SESSION_CLOSED' })); closeLater(); };
      const timer = setTimeout(() => { fail(Object.assign(new Error('Local native request deadline exceeded'), { code: 'LOCAL_REQUEST_TIMEOUT' })); closeLater(); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
      pending = { resolve, reject, cleanup, id: command.id, type: command.type, commandSHA256: sha(data) };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdin.write(data + '\n', error => { if (error) { fail(error); closeLater(); } });
    });
  } };
}
