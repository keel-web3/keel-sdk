// Diagnostic only. Fixed public state; no project input, simulation, or writes.
import assert from 'node:assert/strict';
import { openSync, writeFileSync, closeSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, encodeCapturedHeader, verifyWitness } from './captured-publication-fixture.mjs';

export const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const ACCOUNT = '0xe7f47a76d2887d0a54f7c40dcf7ffcc69e6f22be';
export const SLOT = `0x${'0'.repeat(63)}2`;
export const LIMITS = Object.freeze({ maximumRequests: 5, maximumDurationMs: 60_000,
  perRequestTimeoutMs: 15_000, maximumResponseBytes: 2 * 1024 * 1024,
  maximumTotalResponseBytes: 8 * 1024 * 1024, maximumHeadAgeSeconds: 180, maximumFutureSeconds: 30 });
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const bytes = value => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const fail = (reason, extra = {}) => Object.assign(new Error(reason), { reason, ...extra });
const requireThat = (condition, reason) => { if (!condition) throw fail(reason); };

function validHeader(header) {
  try {
    assert.ok(header && typeof header === 'object' && quantity(header.number));
    // This independently hashes all canonical header fields; the RPC hash is
    // not accepted merely because the provider supplied it alongside a root.
    return encodeCapturedHeader(header);
  } catch { throw fail('invalid-header'); }
}

function validProof(header, proof, code) {
  try {
    assert.equal(proof?.address?.toLowerCase(), ACCOUNT);
    assert.ok(bytes(code) && code !== '0x', 'Expected an existing public factory');
    assert.equal(proof.storageProof?.length, 1);
    const rawKey = proof.storageProof[0].key;
    assert.match(rawKey, /^0x[0-9a-f]{1,64}$/i);
    const key = `0x${rawKey.slice(2).padStart(64, '0').toLowerCase()}`;
    assert.equal(key, SLOT);
    const account = { ...proof, address: ACCOUNT, code,
      storageProof: [{ ...proof.storageProof[0], key }] };
    verifyWitness(header, { accounts: [account] });
    // Slot 2 is a fixed public mapping-root control. Its returned value is
    // authenticated, never filled with or required to equal an assumed zero.
    return account;
  } catch { throw fail('invalid-proof'); }
}

export async function captureFreshProofCapability({ fetchImpl = globalThis.fetch,
  now = () => Date.now(), checkpoint = () => {} } = {}) {
  const started = now();
  const report = { schema: 'keel-fresh-public-proof-capability@1',
    scope: 'One fresh public factory account and raw storage slot; diagnostic only',
    recipient: RPC, chainId: 11155111, account: ACCOUNT, slots: [SLOT],
    startedAt: new Date(started).toISOString(), limits: LIMITS, status: 'capturing',
    requests: [], witness: { accounts: [] }, proofVerified: false, canonicalSnapshotRechecked: false,
    capabilityVerified: false, acceptance: false, gateAccepted: false, projectAcceptance: false,
    fullWitnessComplete: false, transitiveStateComplete: false, projectCalldataSent: false,
    simulations: 0, signing: 'not-performed', submission: 'not-performed', originalPlanChanged: false };
  let totalCaptured = 0, phase = 'chain';
  const expected = [];
  const queue = (method, params) => expected.push({ method, params });
  async function rpc(method, params) {
    const scheduled = expected.shift();
    requireThat(scheduled && scheduled.method === method && JSON.stringify(scheduled.params) === JSON.stringify(params), 'request-scope-invalid');
    requireThat(report.requests.length < LIMITS.maximumRequests, 'request-limit');
    const remaining = LIMITS.maximumDurationMs - (now() - started);
    requireThat(remaining > 0, 'total-timeout');
    const request = { jsonrpc: '2.0', id: report.requests.length + 1, method, params };
    const entry = { request, responseComplete: false };
    report.requests.push(entry); checkpoint(report);
    const controller = new AbortController(), chunks = [];
    let reader, captured = 0, observed = 0, settled = false;
    const captureBytes = () => {
      const raw = Buffer.concat(chunks);
      entry.capturedResponseBytes = captured;
      entry.observedResponseBytes = observed;
      entry.capturedResponseSHA256 = sha256(raw);
      entry.rawResponseBase64 = raw.toString('base64');
    };
    let timer;
    const timedOut = new Promise((_, reject) => { timer = setTimeout(() => {
      settled = true; controller.abort();
      void reader?.cancel().catch(() => {});
      reject(fail(remaining <= LIMITS.perRequestTimeoutMs ? 'total-timeout' : 'request-timeout'));
    }, Math.min(remaining, LIMITS.perRequestTimeoutMs)); });
    try {
      return await Promise.race([timedOut, (async () => {
        const response = await fetchImpl(RPC, { method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
        if (settled) throw fail('request-timeout');
        entry.httpStatus = response.status;
        requireThat(response.redirected === false && !(response.status >= 300 && response.status < 400), 'redirect-rejected');
        requireThat(!response.url || new URL(response.url).href === new URL(RPC).href, 'recipient-changed');
        requireThat(response.body && typeof response.body.getReader === 'function', 'missing-body-stream');
        const length = response.headers?.get('content-length');
        if (length != null) {
          requireThat(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)), 'invalid-content-length');
          entry.declaredResponseBytes = Number(length);
          requireThat(Number(length) <= LIMITS.maximumResponseBytes, 'response-too-large');
        }
        reader = response.body.getReader();
        for (;;) {
          const part = await reader.read();
          if (settled) throw fail('request-timeout');
          requireThat(now() - started <= LIMITS.maximumDurationMs, 'total-timeout');
          if (part.done) break;
          requireThat(part.value instanceof Uint8Array, 'invalid-body-chunk');
          observed += part.value.byteLength;
          const available = Math.min(LIMITS.maximumResponseBytes - captured, LIMITS.maximumTotalResponseBytes - totalCaptured);
          const keep = Math.min(available, part.value.byteLength);
          if (keep > 0) { chunks.push(Buffer.from(part.value.subarray(0, keep))); captured += keep; totalCaptured += keep; }
          requireThat(keep === part.value.byteLength, 'response-too-large');
        }
        entry.responseComplete = true; captureBytes(); checkpoint(report);
        requireThat(response.ok, 'http-error');
        let envelope;
        try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw fail('invalid-json'); }
        requireThat(envelope?.jsonrpc === '2.0' && envelope.id === request.id, 'invalid-rpc-envelope');
        if (Object.hasOwn(envelope, 'error')) {
          throw fail('rpc-error', Number.isSafeInteger(envelope.error?.code) ? { rpcCode: envelope.error.code } : {});
        }
        requireThat(Object.hasOwn(envelope, 'result'), 'missing-result');
        return envelope.result;
      })()]);
    } catch (error) {
      controller.abort(); void reader?.cancel().catch(() => {});
      entry.failure = error.reason ?? 'transport-error';
      throw error;
    } finally {
      settled = true; clearTimeout(timer); captureBytes(); checkpoint(report);
    }
  }
  try {
    queue('eth_chainId', []);
    requireThat(await rpc('eth_chainId', []) === '0xaa36a7', 'wrong-chain');
    phase = 'select-latest'; queue('eth_getBlockByNumber', ['latest', false]);
    const header = await rpc('eth_getBlockByNumber', ['latest', false]);
    const rlp = validHeader(header);
    const seconds = Math.floor(now() / 1000), timestamp = Number(BigInt(header.timestamp));
    requireThat(Number.isSafeInteger(timestamp) && seconds - timestamp <= LIMITS.maximumHeadAgeSeconds && timestamp - seconds <= LIMITS.maximumFutureSeconds, 'head-not-fresh');
    report.canonicalBefore = header; report.headerRlp = rlp;
    report.pin = { number: header.number, hash: header.hash, stateRoot: header.stateRoot, timestamp: header.timestamp };
    phase = 'account-proof'; queue('eth_getProof', [ACCOUNT, [SLOT], header.number]);
    const proof = await rpc('eth_getProof', [ACCOUNT, [SLOT], header.number]);
    phase = 'runtime'; queue('eth_getCode', [ACCOUNT, header.number]);
    const code = await rpc('eth_getCode', [ACCOUNT, header.number]);
    phase = 'local-proof-verification';
    report.witness.accounts.push(validProof(header, proof, code)); report.proofVerified = true;
    phase = 'canonical-recheck'; queue('eth_getBlockByNumber', [header.number, false]);
    const after = await rpc('eth_getBlockByNumber', [header.number, false]);
    report.canonicalAfter = after;
    requireThat(validHeader(after) === rlp, 'canonical-recheck-mismatch');
    requireThat(now() - started <= LIMITS.maximumDurationMs, 'total-timeout');
    report.canonicalSnapshotRechecked = true; report.capabilityVerified = true;
    report.status = 'fresh-public-proof-verified-diagnostic-only';
  } catch (error) {
    report.status = 'blocked'; report.error = { phase, reason: error.reason ?? 'transport-error',
      ...(Number.isSafeInteger(error.rpcCode) ? { rpcCode: error.rpcCode } : {}) };
  }
  report.responseBytes = totalCaptured; report.elapsedMs = now() - started;
  report.finishedAt = new Date(now()).toISOString(); checkpoint(report);
  return report;
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node fresh-proof-capability.bundle.mjs --output /absolute/new-report.json\nFixed approved PublicNode; five public reads maximum. Diagnostic only; no publication acceptance.');
    return 0;
  }
  assert.ok(args.length === 2 && args[0] === '--output' && isAbsolute(args[1]), 'Use --output /absolute/new-report.json');
  // Refuse overwrite before the first read; no input or endpoint override exists.
  const fd = openSync(args[1], 'wx', 0o600);
  try {
    const report = await captureFreshProofCapability(dependencies);
    writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, requests: report.requests.length,
      capabilityVerified: report.capabilityVerified, acceptance: false }));
    return report.capabilityVerified ? 0 : 1;
  } finally { closeSync(fd); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Fresh proof diagnostic refused before completion; existing files are preserved.'); process.exitCode = 1;
  });
}
