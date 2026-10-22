import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';

// Local injected mocks only. No real provider, credentials or Unix socket use.
const urls = ['https://free.example', 'https://paid.example/DUMMY'];
const address = `0x${'22'.repeat(20)}`, hash = `0x${'11'.repeat(32)}`, header = { number: '0x4', hash };
const proof = { method: 'eth_getProof', params: [address, [], { blockHash: hash, requireCanonical: true }] };
const code = { method: 'eth_getCode', params: [address, '0x4'] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const reply = (q, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
const denied = error => error.reason === 'access-denied' || error.diagnostic?.failureReason === 'access-denied';
function pendingBody(signal, entered) {
  return new ReadableStream({ pull(controller) {
    signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    entered.resolve();
    return new Promise(() => {});
  } }, { highWaterMark: 0 });
}
function fixture(status, method, options = {}) {
  const calls = [], observations = [], entered = deferred(); let first = true;
  const fetchImpl = async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    if (first && q.method === method) {
      first = false;
      return new Response(pendingBody(init.signal, entered), { status });
    }
    return reply(q, q.method === 'eth_chainId' ? '0xaa36a7' : q.method === 'eth_getBlockByNumber' ? header : q.method === 'eth_getProof' ? { proof: 'synthetic' } : '0x');
  };
  const settings = { rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl,
    ...(options.observer === false ? {} : { onPrivateResponse: event => observations.push(event) }) };
  return { calls, observations, entered, fetchImpl, pool: createKeelRpcPool(settings) };
}

for (const status of [401, 403]) for (const method of ['eth_chainId', 'eth_getCode', 'eth_getProof']) {
  test(`HTTP${status} headers during ${method} immediately restrict queued and fresh reads despite caller cancellation`, async () => {
    const f = fixture(status, method), abort = new AbortController(), reason = new DOMException('synthetic caller cancelled', 'AbortError');
    const query = method === 'eth_chainId' ? { method, params: [] } : method === 'eth_getProof' ? proof : code;
    const first = f.pool.pin(0).request({ ...query, signal: abort.signal }), firstRejected = assert.rejects(first, error => error === reason);
    await f.entered.promise;
    const observed = f.pool.status()[0], count = f.calls.length;
    const queuedRejected = assert.rejects(f.pool.pin(0).request(code), denied);
    abort.abort(reason); await firstRejected; await queuedRejected;
    await assert.rejects(f.pool.pin(0).request(code), denied);
    assert.equal(observed.disabled, true, 'restriction must already exist while the denial body is pending');
    assert.equal(observed.reason, 'access-denied'); assert.equal(observed.diagnostic.httpStatus, status);
    assert.equal(f.calls.length, count); assert.ok(f.calls.every(q => q.index === 0));
    assert.equal(f.pool.status()[0].reason, 'access-denied');
  });
}

for (const status of [401, 403]) test(`HTTP${status} remains restricted if private capture itself triggers caller cancellation`, async () => {
  const abort = new AbortController(), reason = new DOMException('capture-time caller cancellation', 'AbortError'), calls = [], observations = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0,
    onPrivateResponse: event => { observations.push(event); if (event.httpStatus === status && event.response?.body === 'DUMMY_DENIAL') abort.abort(reason); },
    fetchImpl: async (url, init) => { const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
      return q.method === 'eth_chainId' ? reply(q, '0xaa36a7') : new Response('DUMMY_DENIAL', { status }); } });
  await assert.rejects(pool.pin(0).request({ ...code, signal: abort.signal }), error => error === reason);
  const count = calls.length; await assert.rejects(pool.pin(0).request(code), denied);
  assert.equal(calls.length, count); assert.equal(pool.status()[0].disabled, true);
  assert.ok(observations.some(event => event.response?.body === 'DUMMY_DENIAL'));
  assert.ok(calls.every(q => q.index === 0));
});

for (const status of [401, 403]) test(`HTTP${status} denied headers remain terminal after an arbitrary body read failure`, async () => {
  const calls = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl: async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    return q.method === 'eth_chainId' ? reply(q, '0xaa36a7') : new Response(new ReadableStream({ start(controller) { controller.error(new Error('DUMMY_BODY_FAILURE')); } }), { status });
  } });
  await assert.rejects(pool.pin(0).request(code), denied);
  const count = calls.length; await assert.rejects(pool.pin(0).request(code), denied);
  assert.equal(calls.length, count); assert.ok(calls.every(q => q.index === 0));
});

for (const status of [401, 403]) test(`HTTP${status} cancellation restriction does not depend on a private observer`, async () => {
  const f = fixture(status, 'eth_getCode', { observer: false }), abort = new AbortController(), reason = new Error('synthetic cancellation');
  const first = f.pool.pin(0).request({ ...code, signal: abort.signal }), rejected = assert.rejects(first, error => error === reason);
  await f.entered.promise; abort.abort(reason); await rejected;
  const count = f.calls.length; await assert.rejects(f.pool.pin(0).request(code), denied);
  assert.equal(f.calls.length, count); assert.equal(f.pool.status()[0].disabled, true);
});

for (const status of [401, 403]) test(`HTTP${status} cancellation cannot revive that source through a new approved proof-reader session`, async () => {
  const f = fixture(status, 'eth_getProof'), abort = new AbortController(), reason = new DOMException('proof caller cancellation', 'AbortError');
  const settings = { rpcUrls: urls, approvedStateRpcUrls: urls, block: { number: 4n, hash }, fetchImpl: f.fetchImpl, minIntervalMs: 0 };
  const first = createApprovedProofStateReader(settings);
  try {
    const pending = first.request({ ...proof, signal: abort.signal }), rejected = assert.rejects(pending, error => error === reason);
    await f.entered.promise; abort.abort(reason); await rejected;
  } finally { first.close(); }
  const count = f.calls.length, next = createApprovedProofStateReader(settings);
  try { await assert.rejects(next.request(proof), denied); assert.equal(f.calls.length, count); assert.ok(f.calls.every(q => q.index === 0)); }
  finally { next.close(); }
});

for (const phase of ['before-dispatch', 'before-headers', 'HTTP200-body']) test(`non-denial cancellation at ${phase} preserves abort identity and a reusable free provider`, async () => {
  const abort = new AbortController(), reason = new DOMException('normal caller cancellation', 'AbortError'), entered = deferred(), calls = [];
  let fail = true;
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl: async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    if (q.method === 'eth_chainId') return reply(q, '0xaa36a7');
    if (fail && phase === 'before-headers') return new Promise((_resolve, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); entered.resolve(); });
    if (fail && phase === 'HTTP200-body') return new Response(pendingBody(init.signal, entered));
    return reply(q, '0x');
  } });
  if (phase === 'before-dispatch') abort.abort(reason);
  const first = pool.pin(0).request({ ...code, signal: abort.signal }), rejected = assert.rejects(first, error => error === reason);
  if (phase !== 'before-dispatch') { await entered.promise; abort.abort(reason); }
  await rejected; assert.equal(pool.status()[0].disabled, false);
  fail = false; assert.equal(await pool.pin(0).request(code), '0x'); assert.ok(calls.every(q => q.index === 0));
});

for (const status of [401, 403]) test(`a read already sharing pending chain verification cannot overwrite observed HTTP${status} denial after cancellation`, async () => {
  const abort = new AbortController(), reason = new DOMException('identity caller cancellation', 'AbortError');
  const dispatched = deferred(), headers = deferred(), body = deferred(), calls = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl: async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    dispatched.resolve(); await headers.promise;
    return new Response(pendingBody(init.signal, body), { status });
  } });
  const first = pool.pin(0).request({ ...code, signal: abort.signal }), firstRejected = assert.rejects(first, error => error === reason);
  await dispatched.promise;
  const queuedRejected = assert.rejects(pool.pin(0).request(code), denied);
  headers.resolve(); await body.promise; const count = calls.length;
  abort.abort(reason); await firstRejected; await queuedRejected;
  await assert.rejects(pool.pin(0).request(code), denied);
  assert.equal(calls.length, count); assert.ok(calls.every(q => q.index === 0 && q.method === 'eth_chainId'));
  assert.equal(pool.status()[0].disabled, true); assert.equal(pool.status()[0].reason, 'access-denied');
  assert.equal(pool.status()[0].diagnostic.httpStatus, status);
});
