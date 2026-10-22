import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';

// Injected local mocks only; no real RPC or credential is used.
const urls = ['https://free.example', 'https://paid.example/DUMMY'];
const address = `0x${'22'.repeat(20)}`, hash = `0x${'11'.repeat(32)}`, header = { number: '0x4', hash };
const codeRead = { method: 'eth_getCode', params: [address, '0x4'] };
const proof = { method: 'eth_getProof', params: [address, [], { blockHash: hash, requireCanonical: true }] };
const reply = (q, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }));
const denied = error => error.reason === 'access-denied' || error.diagnostic?.failureReason === 'access-denied';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const denialCode of [401, 403]) for (const method of ['eth_chainId', 'eth_getCode', 'eth_getProof']) {
  test(`complete RPC${denialCode} during ${method} remains restricted for queued and fresh requests after capture cancellation`, async () => {
    const abort = new AbortController(), reason = new DOMException('synthetic capture cancellation', 'AbortError'), calls = [], observations = [];
    let first = true, queued;
    const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0,
      onPrivateResponse: event => {
        observations.push(event);
        if (event.response?.error?.code === denialCode) {
          queued = assert.rejects(pool.pin(0).request(codeRead), denied);
          abort.abort(reason);
        }
      }, fetchImpl: async (url, init) => {
        const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
        if (first && q.method === method) { first = false; return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: denialCode, message: 'DUMMY access denied' } })); }
        return reply(q, q.method === 'eth_chainId' ? '0xaa36a7' : q.method === 'eth_getProof' ? { proof: 'synthetic' } : '0x');
      } });
    const query = method === 'eth_chainId' ? { method, params: [] } : method === 'eth_getProof' ? proof : codeRead;
    await assert.rejects(pool.pin(0).request({ ...query, signal: abort.signal }), error => error === reason);
    assert.ok(queued); await queued;
    const count = calls.length; await assert.rejects(pool.pin(0).request(codeRead), denied);
    assert.equal(calls.length, count); assert.ok(calls.every(q => q.index === 0));
    assert.equal(pool.status()[0].disabled, true); assert.equal(pool.status()[0].reason, 'access-denied');
    assert.equal(pool.status()[0].diagnostic.rpcCode, denialCode); assert.equal(pool.status()[0].diagnostic.httpStatus, 200);
    assert.ok(observations.some(event => event.response?.error?.code === denialCode && event.response.error.message === 'DUMMY access denied'));
  });
}

for (const denialCode of [401, 403]) test(`complete RPC${denialCode} at body-close cancellation fences queued and new proof-reader sessions without a private observer`, async () => {
  const abort = new AbortController(), reason = new DOMException('synthetic body-close cancellation', 'AbortError'), calls = [];
  const completeBody = deferred(), finishBody = deferred(); let first = true;
  const fetchImpl = async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    if (first && q.method === 'eth_getProof') {
      first = false; let chunk = true;
      const data = new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: denialCode, message: 'DUMMY access denied' } }));
      return new Response(new ReadableStream({ async pull(controller) {
        if (chunk) { chunk = false; controller.enqueue(data); return; }
        completeBody.resolve(); await finishBody.promise; controller.close(); abort.abort(reason);
      } }, { highWaterMark: 0 }));
    }
    return reply(q, q.method === 'eth_chainId' ? '0xaa36a7' : q.method === 'eth_getBlockByNumber' ? header : { proof: 'synthetic' });
  };
  const settings = { rpcUrls: urls, approvedStateRpcUrls: urls, block: { number: 4n, hash }, fetchImpl, minIntervalMs: 0 };
  const reader = createApprovedProofStateReader(settings);
  try {
    const pending = reader.request({ ...proof, signal: abort.signal }), cancelled = assert.rejects(pending, error => error === reason);
    await completeBody.promise;
    const queued = assert.rejects(reader.request(proof), denied), count = calls.length;
    finishBody.resolve(); await cancelled; await queued;
    assert.equal(calls.length, count); assert.equal(reader.status()[0].disabled, true); assert.equal(reader.status()[0].reason, 'access-denied');
  } finally { reader.close(); }
  const next = createApprovedProofStateReader(settings), count = calls.length;
  try { await assert.rejects(next.request(proof), denied); assert.equal(calls.length, count); assert.ok(calls.every(q => q.index === 0)); }
  finally { next.close(); }
});

for (const denialCode of [401, 403]) test(`uncorrelated RPC${denialCode} body cannot establish a denial when its observer cancels`, async () => {
  const abort = new AbortController(), reason = new DOMException('synthetic stale-response cancellation', 'AbortError'), calls = []; let first = true;
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0,
    onPrivateResponse: event => { if (event.response?.error?.code === denialCode) abort.abort(reason); },
    fetchImpl: async (url, init) => {
      const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
      if (first && q.method === 'eth_getCode') { first = false; return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id + 1, error: { code: denialCode, message: 'DUMMY access denied' } })); }
      return reply(q, q.method === 'eth_chainId' ? '0xaa36a7' : '0x');
    } });
  await assert.rejects(pool.pin(0).request({ ...codeRead, signal: abort.signal }), error => error === reason);
  assert.equal(pool.status()[0].disabled, false); assert.equal(await pool.pin(0).request(codeRead), '0x');
  assert.ok(calls.every(q => q.index === 0));
});

for (const revertCode of [3, -32000]) test(`genuine revert RPC${revertCode} with authorization wording remains reusable after capture cancellation`, async () => {
  const abort = new AbortController(), reason = new DOMException('synthetic revert-capture cancellation', 'AbortError'), calls = []; let first = true;
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0,
    onPrivateResponse: event => { if (event.response?.error) abort.abort(reason); },
    fetchImpl: async (url, init) => {
      const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
      if (first && q.method === 'eth_getCode') { first = false; return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: revertCode, message: 'execution reverted: unauthorized' } })); }
      return reply(q, q.method === 'eth_chainId' ? '0xaa36a7' : '0x');
    } });
  await assert.rejects(pool.pin(0).request({ ...codeRead, signal: abort.signal }), error => error === reason);
  assert.equal(pool.status()[0].disabled, false); assert.equal(await pool.pin(0).request(codeRead), '0x'); assert.ok(calls.every(q => q.index === 0));
});
