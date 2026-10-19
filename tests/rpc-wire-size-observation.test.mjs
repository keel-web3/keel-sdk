import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';

function fixture(failure) {
  const sent = [], observations = [];
  const pool = createKeelRpcPool({ rpcUrls: ['https://wire-size.example/rpc'], chainId: 11155111,
    minIntervalMs: 0, onPrivateResponse: event => observations.push(event),
    fetchImpl: async (_url, init) => {
      const text = init.body, body = JSON.parse(text); sent.push({ text, body });
      if (body.method !== 'eth_chainId' && failure === 'network') throw new Error('synthetic connection failure');
      if (body.method !== 'eth_chainId' && failure === 'body-limit') return new Response('Request body size limit reached.', { status: 503 });
      return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0xaa36a7' : '0x' });
    } });
  return { sent, observations, pool };
}

test('private evidence measures the dispatched UTF-8 body including the actual multi-digit RPC id', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) await f.pool.request({ method: 'eth_call', params: [{ data: '0x1234', fixtureLabel: '雪 🐟' }, 'latest'] });
  assert.equal(f.observations.length, f.sent.length);
  assert.ok(f.sent.some(({ body }) => body.id >= 10));
  for (const [index, event] of f.observations.entries()) {
    const sent = f.sent[index];
    assert.equal(event.requestWireBytes, Buffer.byteLength(sent.text, 'utf8'));
    assert.equal(event.requestWireBytes - Buffer.byteLength(JSON.stringify(event.request), 'utf8'),
      Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: sent.body.id })) - 1);
    assert.deepEqual(event.request, { method: sent.body.method, params: sent.body.params });
    assert.equal(Object.hasOwn(event, 'endpoint'), false);
    assert.equal(Object.hasOwn(event, 'headers'), false);
  }
});

for (const failure of ['body-limit', 'network']) test(`failed ${failure} requests retain the exact body size without retrying or mutating the program`, async () => {
  const f = fixture(failure);
  const request = { method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ data: `0x${'ab'.repeat(65536)}` }] }], validation: false, traceTransfers: false, returnFullTransactions: true }, '0x12'] };
  const before = structuredClone(request);
  await assert.rejects(f.pool.pin(0).request(request));
  const sent = f.sent.filter(({ body }) => body.method === request.method);
  const events = f.observations.filter(event => event.request.method === request.method);
  assert.equal(sent.length, 1); assert.equal(events.length, 1);
  assert.equal(events[0].requestWireBytes, Buffer.byteLength(sent[0].text));
  assert.deepEqual(sent[0].body.params, before.params); assert.deepEqual(request, before);
});

test('invalid serialization does not invent dispatched-byte evidence', async () => {
  const f = fixture();
  await assert.rejects(f.pool.pin(0).request({ method: 'eth_call', params: [1n] }));
  assert.equal(f.sent.length, 0); assert.equal(f.observations.length, 0);
});
