/** Bounded public reads at an already captured pin. A seed is not a complete
 * sequential state witness. This module neither discovers nor simulates calls. */
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { encodeCapturedHeader, normalizeAssemblyCapture, REQUIRED_CASES, sha256, stable, validateCase, verifyWitness } from './captured-publication-fixture.mjs';

export const CAPTURED_STATE_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
export const CAPTURED_STATE_LIMITS = Object.freeze({ maximumAccounts: 64, maximumSlots: 1024,
  maximumSlotsPerAccount: 256, maximumRequests: 131, maximumRequestBytes: 32 * 1024,
  maximumDurationMs: 120_000, perRequestTimeoutMs: 15_000, maximumResponseBytes: 4 * 1024 * 1024,
  maximumTotalResponseBytes: 32 * 1024 * 1024, maximumPinAgeSeconds: 180, maximumFutureSeconds: 30 });
// A separate, explicitly reviewed whole inventory. Each network page retains
// the original limits above; these bounds never enlarge one RPC/read page.
export const CAPTURED_STATE_INVENTORY_LIMITS = Object.freeze({ maximumAccounts: 256,
  maximumSlots: 4096, maximumSlotsPerAccount: 256, maximumPages: 8,
  maximumRequests: 536, maximumDurationMs: 120_000,
  maximumTotalResponseBytes: 64 * 1024 * 1024 });
const digest = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const bytes = value => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const failure = (reason, fields = {}) => Object.assign(new Error(reason), { reason, ...fields });
const requireThat = (condition, reason) => { if (!condition) throw failure(reason); };
const publicReasons = new Set(['invalid-binding', 'pin-not-recent', 'invalid-clock', 'invalid-header', 'canonical-pin-mismatch',
  'invalid-proof', 'runtime-expectation-mismatch', 'request-scope-invalid', 'request-limit', 'request-too-large',
  'total-timeout', 'request-timeout', 'redirect-rejected', 'recipient-changed', 'missing-body-stream',
  'invalid-content-length', 'response-too-large', 'invalid-body-chunk', 'http-error', 'invalid-json',
  'invalid-rpc-envelope', 'rpc-error', 'missing-result', 'wrong-chain', 'checkpoint-failed', 'cancelled']);
const safeReason = error => publicReasons.has(error?.reason) ? error.reason : 'transport-error';

export function normalizeWitnessSlot(value) {
  assert.match(value ?? '', /^0x[0-9a-f]{1,64}$/i, 'Storage slot must be at most 32 bytes');
  return `0x${value.slice(2).toLowerCase().padStart(64, '0')}`;
}
function boundedAccounts(accounts, limits = CAPTURED_STATE_LIMITS) {
  assert.ok(Array.isArray(accounts) && accounts.length > 0 && accounts.length <= limits.maximumAccounts);
  const addresses = new Set(); let slots = 0;
  const result = accounts.map(account => {
    assert.ok(address(account?.address), 'Invalid requested account');
    const normalized = account.address.toLowerCase();
    assert.ok(!addresses.has(normalized), 'Duplicate requested account'); addresses.add(normalized);
    assert.ok(Array.isArray(account.slots) && account.slots.length <= limits.maximumSlotsPerAccount);
    const keys = account.slots.map(normalizeWitnessSlot);
    assert.equal(new Set(keys).size, keys.length, 'Duplicate requested slot'); slots += keys.length;
    if (account.expectedCodeHash !== undefined) assert.ok(digest(account.expectedCodeHash), 'Invalid expected code hash');
    return { address: normalized, slots: keys,
      ...(account.expectedCodeHash === undefined ? {} : { expectedCodeHash: account.expectedCodeHash.toLowerCase() }) };
  });
  assert.ok(slots <= limits.maximumSlots, 'Total slot bound exceeded');
  return result;
}
function bindingOf(seed, accounts = boundedAccounts(seed.accounts)) {
  return { captureObjectSHA256: seed.captureObjectSHA256, captureSHA256: seed.captureSHA256,
    seedObjectSHA256: sha256(stable(seed)), accountInventorySHA256: sha256(stable(accounts)),
    completeInputSHA256: seed.completeInputSHA256, sourceFingerprint: seed.sourceFingerprint,
    pin: structuredClone(seed.pin), headerRlp: seed.headerRlp };
}

/** Independent binding check: an edited seed cannot repoint an old capture.
 * All calldata stays local. Exact file bytes are mandatory when the seed binds
 * a file hash; object-only callers must explicitly retain captureSHA256:null. */
function validateSeed({ capture: raw, seed, captureBytes }, limits) {
  try {
    const capture = normalizeAssemblyCapture(raw);
    const id = Object.keys(REQUIRED_CASES).find(key => REQUIRED_CASES[key].artifactId === capture.identity.artifactId);
    validateCase(id, capture, raw.completeExpectedTokenURI);
    assert.equal(seed?.schema, 'keel-private-fresh-retro-seeds@1');
    assert.equal(seed.captureObjectSHA256, sha256(stable(raw)), 'Capture object changed');
    assert.equal(seed.completeInputSHA256, capture.completeInputSHA256);
    assert.equal(seed.sourceFingerprint, sha256(stable({ identity: capture.identity, source: capture.source,
      completeInputSHA256: capture.completeInputSHA256 })), 'Source fingerprint changed');
    assert.ok(seed.captureSHA256 === null || /^[0-9a-f]{64}$/.test(seed.captureSHA256));
    if (seed.captureSHA256 !== null) {
      assert.ok(captureBytes instanceof Uint8Array, 'Exact bound capture file bytes required');
      assert.equal(sha256(captureBytes), seed.captureSHA256);
      assert.equal(stable(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(captureBytes))), stable(raw));
    }
    const header = structuredClone(capture.header), headerRlp = encodeCapturedHeader(header);
    assert.equal(seed.headerRlp, headerRlp);
    assert.deepEqual(seed.pin, { number: header.number, hash: header.hash, stateRoot: header.stateRoot, timestamp: header.timestamp });
    const accounts = boundedAccounts(seed.accounts, limits);
    return { header, headerRlp, binding: bindingOf(seed, accounts), accounts };
  } catch { throw failure('invalid-binding'); }
}
export const validateCapturedStateSeed = input => validateSeed(input, CAPTURED_STATE_LIMITS);
export const validateCapturedStateInventorySeed = input => validateSeed(input, CAPTURED_STATE_INVENTORY_LIMITS);

/** Pure future handoff for native missing-read requests. Validates a bounded
 * explicit batch against the SAME seed binding; does not merge, collect, mark
 * it complete, or permit automatic network expansion. */
export function validateAdditionalWitnessRequests(seed, request) {
  assert.equal(request?.schema, 'keel-native-additional-witness-request@1');
  assert.equal(request.executeAutomatically, false);
  const binding = bindingOf(seed, boundedAccounts(seed.accounts, CAPTURED_STATE_INVENTORY_LIMITS));
  assert.deepEqual(request.binding, binding, 'Additional request changed the original pin/source');
  assert.match(request.nativeRequestSHA256 ?? '', /^[0-9a-f]{64}$/, 'Native request evidence digest required');
  return { binding, nativeRequestSHA256: request.nativeRequestSHA256,
    accounts: boundedAccounts(request.accounts), executeAutomatically: false, fullWitnessComplete: false };
}

export function verifyCapturedAccountProof(header, requested, proof, code) {
  try {
    assert.ok(proof && typeof proof === 'object' && !Array.isArray(proof));
    assert.equal(proof.address?.toLowerCase(), requested.address);
    assert.ok(bytes(code)); assert.ok(Array.isArray(proof.storageProof));
    const keys = proof.storageProof.map(slot => normalizeWitnessSlot(slot.key));
    assert.equal(new Set(keys).size, keys.length, 'Duplicate returned slot');
    assert.deepEqual([...keys].sort(), [...requested.slots].sort(), 'Returned slot set differs from request');
    const account = { address: requested.address, code, codeHash: proof.codeHash, storageHash: proof.storageHash,
      balance: proof.balance, nonce: proof.nonce, accountProof: proof.accountProof,
      storageProof: proof.storageProof.map((slot, index) => ({ key: keys[index], value: slot.value, proof: slot.proof })) };
    verifyWitness(header, { accounts: [account] });
    if (requested.expectedCodeHash !== undefined && keccak256(code) !== requested.expectedCodeHash)
      throw failure('runtime-expectation-mismatch');
    return account;
  } catch (error) { throw failure(error.reason === 'runtime-expectation-mismatch' ? error.reason : 'invalid-proof'); }
}

/** No ambient configuration, RPC override, retries, latest-head selection or
 * signing entrypoint. Injected fetch/clock are for offline qualification. */
export async function collectCapturedStateWitness(input, { fetchImpl = globalThis.fetch,
  now = () => Date.now(), checkpoint, signal, budget } = {}) {
  const started = now();
  const limits = { ...CAPTURED_STATE_LIMITS };
  for (const key of ['maximumDurationMs', 'maximumTotalResponseBytes']) if (budget?.[key] !== undefined) {
    requireThat(Number.isSafeInteger(budget[key]) && budget[key] > 0 && budget[key] <= limits[key], 'request-scope-invalid');
    limits[key] = budget[key];
  }
  const report = { schema: 'keel-captured-state-seed-witness@1', recipient: CAPTURED_STATE_RPC, chainId: 11155111,
    startedAt: new Date(started).toISOString(), limits, status: 'capturing', requests: [],
    witness: { accounts: [] }, seedComplete: false, canonicalSnapshotRechecked: false, fullWitnessComplete: false,
    transitiveStateComplete: false, acceptance: false, gateAccepted: false, projectAcceptance: false,
    projectCalldataSent: false, simulations: 0, signing: 'not-performed', submission: 'not-performed', originalPlanChanged: false };
  let phase = 'input-binding', totalCaptured = 0, scope, lastClock = started;
  const tick = () => {
    const value = now();
    requireThat(Number.isSafeInteger(value) && value >= lastClock, 'invalid-clock'); lastClock = value;
    return value;
  };
  const checkTime = () => {
    requireThat(!signal?.aborted, 'cancelled');
    const current = tick(); requireThat(current - started < limits.maximumDurationMs, 'total-timeout');
    const timestamp = BigInt(scope.header.timestamp), seconds = BigInt(Math.floor(current / 1000));
    requireThat(seconds - timestamp <= BigInt(CAPTURED_STATE_LIMITS.maximumPinAgeSeconds)
      && timestamp - seconds <= BigInt(CAPTURED_STATE_LIMITS.maximumFutureSeconds), 'pin-not-recent');
    return current;
  };
  const notify = () => { if (!checkpoint) return; try { checkpoint(structuredClone(report)); } catch { throw failure('checkpoint-failed'); } };
  const requests = [];
  async function rpc(method, params) {
    requireThat(stable(requests.shift()) === stable({ method, params }), 'request-scope-invalid');
    requireThat(report.requests.length < CAPTURED_STATE_LIMITS.maximumRequests, 'request-limit');
    const remaining = limits.maximumDurationMs - (checkTime() - started);
    const request = { jsonrpc: '2.0', id: report.requests.length + 1, method, params }, body = JSON.stringify(request);
    requireThat(Buffer.byteLength(body) <= CAPTURED_STATE_LIMITS.maximumRequestBytes, 'request-too-large');
    const entry = { request, requestBytes: Buffer.byteLength(body), requestSHA256: sha256(body), rawRequest: body, responseComplete: false };
    report.requests.push(entry); notify();
    const controller = new AbortController(), chunks = [];
    let reader, captured = 0, observed = 0, settled = false, timer, onAbort;
    const captureBytes = () => {
      const raw = Buffer.concat(chunks);
      Object.assign(entry, { capturedResponseBytes: captured, observedResponseBytes: observed,
        capturedResponseSHA256: sha256(raw), rawResponseBase64: raw.toString('base64') });
    };
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
      settled = true; controller.abort(); void reader?.cancel().catch(() => {});
      reject(failure(remaining <= CAPTURED_STATE_LIMITS.perRequestTimeoutMs ? 'total-timeout' : 'request-timeout'));
    }, Math.min(remaining, CAPTURED_STATE_LIMITS.perRequestTimeoutMs)); });
    const cancelled = new Promise((_, reject) => {
      onAbort = () => { settled = true; controller.abort(); void reader?.cancel().catch(() => {}); reject(failure('cancelled')); };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    try {
      return await Promise.race([timeout, cancelled, (async () => {
        const response = await fetchImpl(CAPTURED_STATE_RPC, { method: 'POST', redirect: 'error', credentials: 'omit',
          headers: { 'content-type': 'application/json' }, body, signal: controller.signal });
        if (settled) throw failure('request-timeout');
        entry.httpStatus = response.status;
        requireThat(response.redirected === false && !(response.status >= 300 && response.status < 400), 'redirect-rejected');
        requireThat(!response.url || response.url === CAPTURED_STATE_RPC || response.url === `${CAPTURED_STATE_RPC}/`, 'recipient-changed');
        requireThat(response.body && typeof response.body.getReader === 'function', 'missing-body-stream');
        const length = response.headers?.get('content-length');
        if (length != null) {
          requireThat(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)), 'invalid-content-length');
          entry.declaredResponseBytes = Number(length);
          requireThat(Number(length) <= Math.min(CAPTURED_STATE_LIMITS.maximumResponseBytes,
            limits.maximumTotalResponseBytes - totalCaptured), 'response-too-large');
        }
        reader = response.body.getReader();
        for (;;) {
          const part = await reader.read();
          if (settled) throw failure('request-timeout');
          checkTime(); if (part.done) break;
          requireThat(part.value instanceof Uint8Array, 'invalid-body-chunk');
          observed += part.value.byteLength;
          const available = Math.min(CAPTURED_STATE_LIMITS.maximumResponseBytes - captured,
            limits.maximumTotalResponseBytes - totalCaptured);
          const keep = Math.min(available, part.value.byteLength);
          if (keep > 0) { chunks.push(Buffer.from(part.value.subarray(0, keep))); captured += keep; totalCaptured += keep; }
          requireThat(keep === part.value.byteLength, 'response-too-large');
        }
        entry.responseComplete = true; captureBytes(); notify();
        requireThat(response.ok, 'http-error');
        let envelope;
        try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { throw failure('invalid-json'); }
        requireThat(envelope && !Array.isArray(envelope) && envelope.jsonrpc === '2.0' && envelope.id === request.id, 'invalid-rpc-envelope');
        requireThat(!(Object.hasOwn(envelope, 'result') && Object.hasOwn(envelope, 'error')), 'invalid-rpc-envelope');
        if (Object.hasOwn(envelope, 'error')) throw failure('rpc-error', Number.isSafeInteger(envelope.error?.code) ? { rpcCode: envelope.error.code } : {});
        requireThat(Object.hasOwn(envelope, 'result'), 'missing-result');
        return envelope.result;
      })()]);
    } catch (error) {
      controller.abort(); void reader?.cancel().catch(() => {}); entry.failure = safeReason(error); throw error;
    } finally { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); captureBytes(); notify(); }
  }
  const checkHeader = header => {
    let rlp;
    try { rlp = encodeCapturedHeader(header); } catch { throw failure('invalid-header'); }
    requireThat(rlp === scope.headerRlp, 'canonical-pin-mismatch');
  };
  try {
    scope = validateCapturedStateSeed(input); checkTime();
    report.binding = scope.binding; report.headerRlp = scope.headerRlp;
    report.requestedAccounts = scope.accounts; report.requestedSlots = scope.accounts.reduce((sum, item) => sum + item.slots.length, 0);
    requests.push({ method: 'eth_chainId', params: [] }, { method: 'eth_getBlockByNumber', params: [scope.header.number, false] });
    for (const item of scope.accounts) requests.push({ method: 'eth_getProof', params: [item.address, item.slots, scope.header.number] },
      { method: 'eth_getCode', params: [item.address, scope.header.number] });
    requests.push({ method: 'eth_getBlockByNumber', params: [scope.header.number, false] });
    phase = 'chain'; requireThat(await rpc('eth_chainId', []) === '0xaa36a7', 'wrong-chain');
    phase = 'canonical-before'; report.canonicalBefore = await rpc('eth_getBlockByNumber', [scope.header.number, false]); checkHeader(report.canonicalBefore);
    for (const item of scope.accounts) {
      phase = 'account-proof'; const proof = await rpc('eth_getProof', [item.address, item.slots, scope.header.number]);
      phase = 'runtime'; const code = await rpc('eth_getCode', [item.address, scope.header.number]);
      phase = 'local-proof-verification'; report.witness.accounts.push(verifyCapturedAccountProof(scope.header, item, proof, code)); notify();
    }
    phase = 'canonical-recheck'; report.canonicalAfter = await rpc('eth_getBlockByNumber', [scope.header.number, false]); checkHeader(report.canonicalAfter);
    checkTime(); verifyWitness(scope.header, report.witness); checkTime();
    report.canonicalSnapshotRechecked = true; report.seedComplete = true;
    report.status = 'seed-verified-full-witness-incomplete';
  } catch (error) {
    report.status = 'blocked'; report.error = { phase, reason: safeReason(error),
      ...(Number.isSafeInteger(error.rpcCode) ? { rpcCode: error.rpcCode } : {}) };
  }
  try { tick(); } catch { report.status = 'blocked'; report.seedComplete = false; report.error = { phase: 'clock', reason: 'invalid-clock' }; }
  report.provedAccounts = report.witness.accounts.length;
  report.provedSlots = report.witness.accounts.reduce((sum, account) => sum + account.storageProof.length, 0);
  report.responseBytes = totalCaptured; report.elapsedMs = lastClock - started;
  report.finishedAt = new Date(lastClock).toISOString();
  // Checkpoint failure cannot turn an incomplete or unrecorded run into success.
  try { notify(); } catch { report.status = 'blocked'; report.seedComplete = false; report.error = { phase: 'checkpoint', reason: 'checkpoint-failed' }; }
  return report;
}
