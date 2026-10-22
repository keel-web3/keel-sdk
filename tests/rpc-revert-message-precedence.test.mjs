import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeelRpcPool, KeelRpcResponseError, KeelRpcSetupError } from '../packages/sdk/dist/rpc.js';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';

// Every fetch is injected and resolves locally; endpoints and error text are synthetic.
const urls = ['https://free.example', 'https://paid.example/DUMMY'];
const address = `0x${'22'.repeat(20)}`, hash = `0x${'11'.repeat(32)}`;
const common = ['unauthorized', 'authentication required', 'rate limit', 'request body size limit reached'];
const extra = ['api key missing', 'access denied', 'historical state unavailable', 'quota exceeded', 'RPC gas cap: 42', 'nonce too high', 'insufficient funds'];
const call = { from: address, to: address, data: '0x', gas: '0x5208' };
const query = method => ({ method, params: method === 'eth_call' ? [call, '0x4']
  : [{ blockStateCalls: [{ calls: [call] }], validation: true, traceTransfers: false, returnFullTransactions: false }, '0x4'] });
function fixture(method, status, phrase) {
  const calls = [], observations = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0,
    onPrivateResponse: event => observations.push(event),
    fetchImpl: async (url, init) => {
      const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method, params: q.params });
      const error = q.method === method;
      return new Response(JSON.stringify(error ? { jsonrpc: '2.0', id: q.id,
        error: { code: -32000, message: `execution reverted: ${phrase}`, data: '0xdead' } }
        : { jsonrpc: '2.0', id: q.id, result: q.method === 'eth_chainId' ? '0xaa36a7' : '0x' }), { status: error ? status : 200 });
    } });
  return { pool, calls, observations };
}

for (const method of ['eth_call', 'eth_simulateV1']) {
  for (const status of [200, 413, 429, 503]) for (const phrase of status === 200 ? [...common, ...extra] : common) {
    test(`${method} HTTP${status} contract revert containing ${phrase} keeps the typed revert and usable original provider`, async () => {
      const f = fixture(method, status, phrase), exact = query(method);
      await assert.rejects(f.pool.request(exact), error => {
        assert.ok(error instanceof KeelRpcResponseError); assert.equal(error.code, 3); assert.equal(error.data, '0xdead');
        return true;
      });
      assert.deepEqual(f.calls.filter(q => q.method === method), [{ index: 0, method, params: exact.params }]);
      assert.ok(f.calls.every(q => q.index === 0)); assert.equal(f.pool.status()[0].disabled, false);
      assert.equal(f.pool.status()[0].reason, undefined);
      assert.equal(await f.pool.request({ method: 'eth_getCode', params: [address, '0x4'] }), '0x');
      assert.ok(f.calls.every(q => q.index === 0));
    });
  }
  for (const status of [401, 403]) for (const phrase of common) {
    test(`${method} actual HTTP${status} remains denial despite contract-revert ${phrase} prose`, async () => {
      const f = fixture(method, status, phrase);
      await assert.rejects(f.pool.pin(0).request(query(method)), error => error instanceof KeelRpcSetupError && error.reason === 'access-denied');
      assert.ok(f.calls.every(q => q.index === 0)); assert.equal(f.pool.status()[0].disabled, true);
      assert.ok(f.observations.some(event => event.httpStatus === status && event.response?.body?.includes(`execution reverted: ${phrase}`)),
        'existing bounded owner-private denial observation is preserved');
    });
  }
}

for (const phrase of common) test(`pinned proof revert ${phrase} is terminal without paid fallback and leaves a new free reader usable`, async () => {
  const calls = [], header = { number: '0x4', hash }, anchor = { blockHash: hash, requireCanonical: true };
  let revert = true;
  const fetchImpl = async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method, params: q.params });
    const failed = revert && q.method === 'eth_getProof';
    return new Response(JSON.stringify(failed ? { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: `execution reverted: ${phrase}` } }
      : { jsonrpc: '2.0', id: q.id, result: q.method === 'eth_chainId' ? '0xaa36a7' : q.method === 'eth_getBlockByNumber' ? header : { proof: 'synthetic' } }));
  };
  const options = { rpcUrls: urls, approvedStateRpcUrls: urls, block: { number: 4n, hash }, fetchImpl, minIntervalMs: 0 };
  const request = { method: 'eth_getProof', params: [address, [], anchor] }, reader = createApprovedProofStateReader(options);
  try {
    await assert.rejects(reader.request(request), error => error.kind === 'execution-reverted');
    const count = calls.length; await assert.rejects(reader.request(request), error => error.kind === 'execution-reverted');
    assert.equal(calls.length, count, 'terminal reader cannot make a second request');
    assert.ok(calls.every(q => q.index === 0)); assert.equal(reader.status()[0].disabled, false);
  } finally { reader.close(); }
  revert = false;
  const fresh = createApprovedProofStateReader(options);
  try { assert.deepEqual(await fresh.request(request), { proof: 'synthetic' }); assert.ok(calls.every(q => q.index === 0)); }
  finally { fresh.close(); }
});

for (const status of [401, 403]) for (const body of ['slow', 'oversized', 'malformed']) {
  test(`observed HTTP${status} wins even when its ${body} denial body fails bounded reading`, async () => {
    const calls = [], observations = [];
    const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, timeoutMs: 100,
      onPrivateResponse: event => observations.push(event),
      fetchImpl: async (url, init) => {
        const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
        if (q.method === 'eth_chainId') return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: '0xaa36a7' }));
        const responseBody = body === 'slow' ? new ReadableStream({ start(controller) {
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
        } }) : body === 'oversized' ? 'x'.repeat(16 * 1024 + 1) : '{malformed';
        return new Response(responseBody, { status });
      } });
    await assert.rejects(pool.pin(0).request({ method: 'eth_getProof', params: [address, [], { blockHash: hash, requireCanonical: true }] }),
      error => error instanceof KeelRpcSetupError && error.reason === 'access-denied' && error.diagnostic.httpStatus === status);
    const count = calls.length;
    await assert.rejects(pool.pin(0).request({ method: 'eth_getCode', params: [address, '0x4'] }), error => error.reason === 'access-denied');
    assert.equal(calls.length, count); assert.ok(calls.every(q => q.index === 0));
    assert.equal(pool.status()[0].disabled, true); assert.equal(pool.status()[0].reason, 'access-denied');
    assert.ok(observations.some(event => event.httpStatus === status));
  });
}

for (const code of [401, 403]) test(`explicit RPC${code} denial remains terminal despite execution-reverted prose`, async () => {
  const calls = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl: async (url, init) => {
    const q = JSON.parse(init.body); calls.push({ index: urls.indexOf(url), method: q.method });
    return new Response(JSON.stringify(q.method === 'eth_chainId' ? { jsonrpc: '2.0', id: q.id, result: '0xaa36a7' }
      : { jsonrpc: '2.0', id: q.id, error: { code, message: 'execution reverted: unauthorized' } }));
  } });
  await assert.rejects(pool.pin(0).request({ method: 'eth_getCode', params: [address, '0x4'] }),
    error => error instanceof KeelRpcSetupError && error.reason === 'access-denied');
  assert.equal(pool.status()[0].disabled, true); assert.ok(calls.every(q => q.index === 0));
});
