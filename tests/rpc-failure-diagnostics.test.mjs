import test from 'node:test';
import assert from 'node:assert/strict';
const { createKeelRpcPool, KeelRpcSetupError } = await import(process.env.KEEL_TEST_RPC_MODULE ?? '../packages/sdk/dist/rpc.js');

const urls = ['https://first.example/private-path?key=private-key', 'https://second.example'];
const params = [{ blockStateCalls: [{ calls: [{ from: '0x'+'11'.repeat(20), to: '0x'+'22'.repeat(20), data: '0x', gas: '0x100000', value: '0x0' }] }], validation: false, traceTransfers: false, returnFullTransactions: true }, '0x12'];
function fixture(handler, options = {}) {
  const calls = [];
  const pool = createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, ...options, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body });
    if (body.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: body.id, result: '0xaa36a7' });
    return handler({ url, init, body });
  } });
  return { pool, calls };
}
function safe(error) {
  assert.ok(error instanceof KeelRpcSetupError);
  assert.doesNotMatch(JSON.stringify(error), /private-path|private-key|secret-body|remote-secret/u);
  assert.equal(error.cause, undefined);
  return true;
}
const simulate = pool => pool.request({ method: 'eth_simulateV1', params });

test('pinned HTTP status and rate-limit evidence survive exhaustion and cooldown without a retry or private text', async () => {
  for (const [status, reason, transportFailure] of [[503, 'unavailable', 'http-error'], [429, 'rate-limited', 'rate-limited'], [403, 'access-denied', 'http-error']]) {
    const f = fixture(() => new Response('secret-body', { status, headers: { 'retry-after': '20' } }));
    const pinned = f.pool.pin(0);
    const check = error => { safe(error); assert.equal(error.reason, reason); assert.deepEqual(error.diagnostic, { failureReason: reason, transportFailure, httpStatus: status }); return true; };
    await assert.rejects(simulate(pinned), check);
    const count = f.calls.length;
    await assert.rejects(simulate(pinned), check);
    assert.equal(f.calls.length, count);
    assert.equal(f.calls.filter(call => call.url === urls[1]).length, 0);
  }
});

test('only recognized nested network codes are retained; message text never invents a timeout', async () => {
  for (const [code, expected] of [['ECONNRESET', 'connection-reset'], ['ENOTFOUND', 'dns'], ['UND_ERR_SOCKET', 'connection-closed'], ['UND_ERR_CONNECT_TIMEOUT', 'timeout'], ['remote-secret', 'unknown']]) {
    const cause = Object.assign(new Error('remote-secret'), { code }); cause.cause = cause;
    const f = fixture(() => { throw new TypeError('private-key timeout', { cause }); });
    await assert.rejects(simulate(f.pool.pin(0)), error => {
      safe(error); assert.equal(error.diagnostic.transportFailure, expected);
      assert.equal(error.diagnostic.transportCode, code === 'remote-secret' ? undefined : code); return true;
    });
  }
});

test('actual request deadlines and response-body deadlines are retained as timeouts', async () => {
  for (const bodyTimeout of [false, true]) {
    const f = fixture(({ init }) => bodyTimeout
      ? new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true }); } }))
      : new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })),
    { simulationTimeoutMs: 100 });
    await assert.rejects(simulate(f.pool.pin(0)), error => { safe(error); assert.equal(error.diagnostic.transportFailure, 'timeout'); return true; });
  }
});

test('response failures distinguish missing body, byte bound, parse error, stale response id and missing result', async () => {
  const cases = [
    ['missing-body', () => new Response(null), undefined],
    ['response-too-large', () => new Response('x'.repeat(1100)), 1100],
    ['invalid-json', () => new Response('remote-secret'), 13],
    ['invalid-envelope', ({ body }) => Response.json({ jsonrpc: '2.0', id: body.id + 1, result: 'secret-body' })],
    ['missing-result', ({ body }) => Response.json({ jsonrpc: '2.0', id: body.id })],
  ];
  for (const [reason, handler, size] of cases) {
    const f = fixture(handler, { maxResponseBytes: 1024 });
    await assert.rejects(simulate(f.pool.pin(0)), error => {
      safe(error); assert.equal(error.reason, 'invalid-response');
      assert.equal(error.diagnostic.transportFailure, 'invalid-response');
      assert.equal(error.diagnostic.responseFailure, reason);
      assert.equal(error.diagnostic.maximumResponseBytes, 1024);
      if (size !== undefined) assert.equal(error.diagnostic.responseBytes, size);
      return true;
    });
  }
});

test('classified RPC rate limits retain the numeric code, not remote error data', async () => {
  const f = fixture(({ body }) => Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'remote-secret quota', data: 'secret-body' } }));
  await assert.rejects(simulate(f.pool.pin(0)), error => {
    safe(error); assert.deepEqual(error.diagnostic, { failureReason: 'rate-limited', transportFailure: 'rate-limited', rpcCode: -32005 }); return true;
  });
});

test('concurrent pinned requests retain the same observed rate-limit status while waiting in the queue', async () => {
  const f = fixture(() => new Response('secret-body', { status: 429, headers: { 'retry-after': '25' } }));
  const results = await Promise.allSettled([1, 2, 3].map(() => simulate(f.pool.pin(0))));
  for (const result of results) {
    assert.equal(result.status, 'rejected'); safe(result.reason);
    assert.deepEqual(result.reason.diagnostic, { failureReason: 'rate-limited', transportFailure: 'rate-limited', httpStatus: 429 });
  }
  assert.equal(f.calls.filter(call => call.body.method === 'eth_simulateV1').length, 1);
});

test('caller cancellation is preserved and never triggers provider failover', async () => {
  const controller = new AbortController(), reason = new Error('cancelled by caller');
  const f = fixture(({ init }) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); queueMicrotask(() => controller.abort(reason)); }));
  await assert.rejects(f.pool.request({ method: 'eth_simulateV1', params, signal: controller.signal }), error => error === reason);
  assert.equal(f.calls.filter(call => call.url === urls[1]).length, 0);
});

test('ordinary read failover remains bounded and deterministic simulation rejections never rotate', async () => {
  const f = fixture(({ url, body }) => url === urls[0] ? new Response('secret-body', { status: 503 }) : Response.json({ jsonrpc: '2.0', id: body.id, result: '0x12' }));
  assert.equal(await f.pool.request({ method: 'eth_blockNumber' }), '0x12');
  assert.equal(f.calls.filter(call => call.body.method === 'eth_blockNumber').length, 2);
  for (const code of [3, -32601, -32602, -38014]) {
    const f = fixture(({ body }) => Response.json({ jsonrpc: '2.0', id: body.id, error: { code, message: 'remote-secret' } }));
    await assert.rejects(simulate(f.pool), error => { assert.equal(error.code, code); assert.doesNotMatch(error.message, /remote-secret/); return true; });
    assert.equal(f.calls.filter(call => call.url === urls[1]).length, 0);
  }
});

test('a complete multi-megabyte 45-call program reaches the pinned transport unchanged; unknown failure stays unknown', async () => {
  const original = structuredClone(params);
  original[0].blockStateCalls = Array.from({ length: 45 }, (_, index) => ({ calls: [{ ...params[0].blockStateCalls[0].calls[0], data: '0x'+index.toString(16).padStart(2, '0').repeat(42_000) }] }));
  const f = fixture(({ body }) => { assert.deepEqual(body.params, original); throw new Error('remote-secret'); });
  await assert.rejects(f.pool.pin(0).request({ method: 'eth_simulateV1', params: original }), error => {
    safe(error); assert.deepEqual(error.diagnostic, { failureReason: 'unavailable', transportFailure: 'unknown' }); return true;
  });
  assert.equal(f.calls.filter(call => call.body.method === 'eth_simulateV1').length, 1);
  assert.deepEqual(f.calls.at(-1).body.params, original);
});
