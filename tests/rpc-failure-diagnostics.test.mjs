import test from 'node:test';
import assert from 'node:assert/strict';
const { createKeelRpcPool, KeelRpcSetupError } = await import(process.env.KEEL_TEST_RPC_MODULE ?? '../packages/sdk/dist/rpc.js');

const { keelSimulationTransportFailure } = await import('../packages/sdk/dist/publication-preflight.js');

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

test('owner-private evidence retains bounded invalidUTF8/JSON bytes before public normalization', async () => {
  const events = [], bytes = new Uint8Array([0x7b, 0x22, 0x80, 0x22, 0x3a]);
  const p = createKeelRpcPool({ rpcUrls: [urls[0]], chainId: 11155111, minIntervalMs: 0, onPrivateResponse: event => events.push(event), fetchImpl: async (_url, init) => {
    const request = JSON.parse(init.body);
    return request.method === 'eth_chainId' ? Response.json({ jsonrpc: '2.0', id: request.id, result: '0xaa36a7' }) : new Response(bytes);
  } });
  await assert.rejects(p.pin(0).request({ method: 'eth_getCode', params: ['0x'+'11'.repeat(20), '0x12'] }), error => safe(error) && error.diagnostic.responseFailure === 'invalid-json');
  const event = events.find(item => item.response?.responseFailure === 'invalid-json');
  assert.ok(event); assert.deepEqual(event.response.bodyBytes, bytes); assert.equal(event.response.responseBytes, bytes.byteLength);
  assert.equal(event.httpStatus, 200); assert.equal(event.request.method, 'eth_getCode');
  assert.doesNotMatch(JSON.stringify(events), /private-path|private-key|https:/);
});

test('private network error snapshots retain custom fields but cannot mutate the original', async () => {
  const original = Object.assign(new Error('owner-private transport text'), { code: 'ECONNRESET', cause: { detail: 'owner-private detail' } });
  const events = [];
  const p = createKeelRpcPool({ rpcUrls: [urls[0]], chainId: 11155111, minIntervalMs: 0, onPrivateResponse(event) {
    events.push(event); if (event.error) { event.error.code = 'MUTATED'; event.error.cause.detail = 'MUTATED'; }
  }, fetchImpl: async () => { throw original; } });
  await assert.rejects(p.pin(0).request({ method: 'eth_getCode', params: [] }), error => safe(error) && error.diagnostic.transportFailure === 'connection-reset');
  assert.equal(original.code, 'ECONNRESET'); assert.equal(original.cause.detail, 'owner-private detail');
  assert.ok(events.some(event => event.error?.message === 'owner-private transport text'));
});

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
    safe(error); assert.deepEqual(error.diagnostic, { failureReason: 'rate-limited', transportFailure: 'rate-limited', httpStatus: 200, rpcCode: -32005 }); return true;
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


test('bounded explicit HTTP body-size evidence is actionable capacity without an invented RPC code', async () => {
  const messages = [
    'Synthetic request body size limit reached.',
    'Provider response: request body too large',
    '<html><title>Request Entity Too Large</title></html>',
    JSON.stringify({ message: 'request body exceeds the maximum allowed size', private: 'remote-secret' }),
    JSON.stringify({ error: { message: 'Payload too large', private: 'remote-secret' } }),
  ];
  for (const text of messages) {
    const f = fixture(() => new Response(text, { status: 503 }));
    await assert.rejects(simulate(f.pool.pin(0)), error => {
      const failure = keelSimulationTransportFailure(error);
      assert.equal(failure.kind, 'provider-limit');
      assert.equal(failure.diagnostic.httpStatus, 503);
      assert.equal(failure.diagnostic.gasCapacityScope, 'request-bytes');
      assert.equal(failure.diagnostic.rpcCode, undefined);
      assert.match(failure.message, /body is too large.*compatible approved provider.*saved plan and receipts/);
      assert.doesNotMatch(JSON.stringify(failure), /remote-secret|private-key|private-path/);
      return true;
    });
    assert.equal(f.calls.length, 2);
  }
});

test('generic, malformed, reflected, stale and oversized HTTP bodies never invent request-size evidence', async () => {
  const cases = [
    () => new Response('Service temporarily unavailable', { status: 503 }),
    () => new Response('Request body size limit not reached. Response body too large.', { status: 503 }),
    () => new Response('{"message":"request body too large"', { status: 503 }),
    () => new Response('request body too large', { status: 503, headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify({ reflectedRequest: { message: 'request body too large' } }), { status: 503 }),
    () => new Response(JSON.stringify([{ message: 'request body too large' }]), { status: 503 }),
    ({body}) => Response.json({ jsonrpc:'2.0', id:body.id+1, error:{code:-32000,message:'request body too large'} }, {status:503}),
    () => new Response(new Uint8Array([...Buffer.from('request body too large'), 0x80]), {status:503}),
    () => new Response('request body too large'+' '.repeat(16*1024), {status:503}),
    () => new Response(' '.repeat(16*1024)+'request body too large', {status:503}),
  ];
  for (const handler of cases) for (const observe of [false, true]) {
    const privateEvents=[];
    const f = fixture(handler, observe ? { onPrivateResponse:event=>privateEvents.push(event) } : {});
    await assert.rejects(simulate(f.pool.pin(0)), error => {
      const failure = keelSimulationTransportFailure(error);
      assert.equal(failure.kind, 'rpc-unavailable');
      assert.equal(failure.diagnostic.httpStatus, 503);
      assert.equal(failure.diagnostic.gasCapacityScope, undefined);
      return safe(error);
    });
  }
});

test('HTTP JSON-RPC execution and validation evidence outranks body-size wording', async () => {
  for (const [code,kind] of [[3,'execution-reverted'],[-32602,'configuration-invalid'],[-38011,'rpc-unavailable'],[-38013,'configuration-invalid']]) {
    const f = fixture(({body}) => Response.json({ jsonrpc:'2.0', id:body.id, error:{code,message:'request body too large remote-secret'} }, {status:503}));
    await assert.rejects(simulate(f.pool.pin(0)), error => {
      const failure = keelSimulationTransportFailure(error);
      assert.equal(failure.kind,kind); assert.equal(failure.diagnostic.rpcCode,code);
      assert.equal(failure.diagnostic.httpStatus,503); assert.equal(failure.diagnostic.gasCapacityScope,undefined);
      assert.doesNotMatch(JSON.stringify(failure),/remote-secret/); return true;
    });
  }
  for (const status of [200,503]) for (const code of [-32000,-32603,-38026]) {
    const f=fixture(({body})=>Response.json({jsonrpc:'2.0',id:body.id,error:{code,message:'request body too large'}},{status}));
    await assert.rejects(simulate(f.pool.pin(0)), error=>{
      const failure=keelSimulationTransportFailure(error);
      assert.equal(failure.kind,'provider-limit'); assert.equal(failure.diagnostic.gasCapacityScope,'request-bytes');
      assert.equal(failure.diagnostic.rpcCode,code); assert.equal(failure.diagnostic.httpStatus,status); return true;
    });
  }
});

test('aborted or timed-out HTTP error-body reads do not establish request capacity', async () => {
  for (const cancel of [false,true]) {
    const controller=new AbortController(); let started;
    const entered=new Promise(resolve=>{started=resolve;});
    const f=fixture(({init})=>new Response(new ReadableStream({start(stream){
      stream.enqueue(Buffer.from('request body too large'));
      init.signal.addEventListener('abort',()=>stream.error(init.signal.reason),{once:true}); started();
    }}),{status:503}),{simulationTimeoutMs:100});
    const run=f.pool.pin(0).request({method:'eth_simulateV1',params,signal:controller.signal});
    const check=assert.rejects(run,error=>{
      if(cancel) return error===controller.signal.reason;
      const failure=keelSimulationTransportFailure(error);
      assert.equal(failure.kind,'rpc-unavailable'); assert.equal(failure.diagnostic.transportFailure,'timeout');
      assert.equal(failure.diagnostic.gasCapacityScope,undefined); return true;
    });
    await entered; if(cancel)controller.abort(new Error('local test cancellation')); await check;
  }
});

test('response-payload and negated request-size wording never establish outgoing body capacity', async () => {
  for (const text of ['Response payload too large', 'Response: payload too large', 'Result: payload too large', 'The response entity is too big', 'Not a request body too large error', 'No request body size limit reached']) {
    const f=fixture(()=>new Response(text,{status:503}));
    await assert.rejects(simulate(f.pool.pin(0)),error=>{
      const failure=keelSimulationTransportFailure(error);
      assert.equal(failure.kind,'rpc-unavailable');assert.equal(failure.diagnostic.gasCapacityScope,undefined);return true;
    });
  }
});

test('complete capacity-detail envelope bound applies equally to HTTP200 and HTTP503 RPC errors', async () => {
  for(const status of [200,503]) {
    const f=fixture(({body})=>Response.json({jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'request body too large'},padding:'x'.repeat(16*1024)},{status}));
    await assert.rejects(simulate(f.pool.pin(0)),error=>{
      const failure=keelSimulationTransportFailure(error);assert.notEqual(failure.kind,'provider-limit');
      assert.equal(failure.diagnostic.gasCapacityScope,undefined);return true;
    });
  }
});

test('complete HTTP capacity details accept exactly16KiB and reject one additional byte independently of private capture', async () => {
  for(const observe of [false,true]) for(const extra of [0,1]) {
    const text='request body too large'.padEnd(16*1024+extra,' ');
    const f=fixture(()=>new Response(text,{status:503}),observe?{onPrivateResponse:()=>{}}:{});
    await assert.rejects(simulate(f.pool.pin(0)),error=>{
      const failure=keelSimulationTransportFailure(error);
      assert.equal(failure.kind,extra?'rpc-unavailable':'provider-limit');
      assert.equal(failure.diagnostic.gasCapacityScope,extra?undefined:'request-bytes');return true;
    });
  }
});

test('HTTP error parsing preserves the lowest signed32-bit observed RPC code without inventing another code', async () => {
  const f=fixture(({body})=>Response.json({jsonrpc:'2.0',id:body.id,error:{code:-2147483648,message:'request body too large'}},{status:503}));
  await assert.rejects(simulate(f.pool.pin(0)),error=>{
    const failure=keelSimulationTransportFailure(error);
    assert.equal(failure.diagnostic.rpcCode,-2147483648);assert.equal(failure.diagnostic.gasCapacityScope,undefined);
    assert.notEqual(failure.kind,'provider-limit');return true;
  });
});
