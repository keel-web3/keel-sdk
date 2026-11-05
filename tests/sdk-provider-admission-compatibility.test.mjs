import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeelRpcPool, KeelRpcQueueTimeoutError } from '../packages/sdk/dist/rpc.js';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';
import { createKeelConfiguredReadAccessDenialHandler, createKeelConfiguredReadRateLimitHandler, keelConfiguredReadProviderStatus } from '../packages/sdk/dist/public-simulation-pool.js';

const url = 'https://admission.example', alternate = 'https://alternate.example';
const chain = '0xaa36a7', hash = `0x${'ab'.repeat(32)}`, address = `0x${'cd'.repeat(20)}`;
const reply = (request, result) => Response.json({ jsonrpc: '2.0', id: request.id, result });
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const request = signal => ({ method: 'eth_getCode', params: [address, 'latest'], ...(signal ? { signal } : {}) });

test('host admission wraps chain and ordinary physical reads with exact identity and dispatch ordering', async () => {
  const response = gate(), started = gate(), events = [], signal = new AbortController().signal;
  const pool = createKeelRpcPool({ rpcUrls: [`${url}/`], chainId: 11155111, minIntervalMs: 0,
    providerAdmission: async (provider, methods, operation, actualSignal) => {
      assert.equal(provider, url); assert.equal(actualSignal, signal); assert.equal(methods.length, 1);
      const method = methods[0]; events.push(`admit:${method}`);
      const value = await operation({ beforeDispatch: async () => { events.push(`before:${method}`); }, afterDispatch: () => { events.push(`after:${method}`); } });
      events.push(`done:${method}`); return value;
    },
    fetchImpl: async (provider, init) => {
      assert.equal(provider, url); const q = JSON.parse(init.body); events.push(`fetch:${q.method}`);
      if (q.method === 'eth_getCode') { started.resolve(); await response.promise; }
      return reply(q, q.method === 'eth_chainId' ? chain : '0x6000');
    },
  });
  const pending = pool.request(request(signal)); await started.promise; await tick();
  assert.deepEqual(events.slice(-4), ['admit:eth_getCode', 'before:eth_getCode', 'fetch:eth_getCode', 'after:eth_getCode']);
  assert.deepEqual(events.slice(0, 5), ['admit:eth_chainId', 'before:eth_chainId', 'fetch:eth_chainId', 'after:eth_chainId', 'done:eth_chainId']);
  response.resolve(); assert.equal(await pending, '0x6000'); assert.equal(events.at(-1), 'done:eth_getCode');
});

for (const boundary of ['callback', 'marker']) for (const form of ['reason', 'numeric', 'cause']) test(`host ${boundary} ${form} denial remains terminal without contacting an alternate recipient`, async () => {
  const calls = [], admissions = [];
  const denied = form === 'reason' ? Object.assign(new Error('private authorization denial'), { reason: 'access-denied' })
    : form === 'numeric' ? Object.assign(new Error('private authorization denial'), { status: 403 })
      : new Error('private authorization denial', { cause: { diagnostic: { rpcCode: 401 } } });
  const pool = createKeelRpcPool({ rpcUrls: [url, alternate], chainId: 11155111, minIntervalMs: 0,
    providerAdmission: async (provider, methods, operation) => {
      admissions.push({ provider, methods });
      if (boundary === 'callback') throw denied;
      return operation({ beforeDispatch: async () => { throw denied; }, afterDispatch: () => assert.fail('denied marker cannot dispatch') });
    },
    fetchImpl: async (provider, init) => { calls.push(provider); return reply(JSON.parse(init.body), chain); },
  });
  await assert.rejects(pool.request(request()), error => error.reason === 'access-denied');
  await assert.rejects(pool.request(request()), error => error.reason === 'access-denied');
  assert.deepEqual(calls, []); assert.equal(admissions.length, 1); assert.equal(admissions[0].provider, url);
  assert.doesNotMatch(JSON.stringify(pool.status().map(state => state.diagnostic)), /private authorization denial|https:/u);
});

test('shared host cooldown dispatches nothing, keeps the provider enabled, and recovers after expiry', async t => {
  let now = Date.now(), blocked = true, calls = 0;
  t.mock.method(Date, 'now', () => now);
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, minIntervalMs: 0,
    providerAdmission: async (_provider, _methods, operation) => {
      if (blocked) throw Object.assign(new Error('host cooldown'), { name: 'SharedProviderCooldownError', reason: 'rate-limited', retryAfterMs: 2000 });
      return operation();
    },
    fetchImpl: async (_provider, init) => { calls++; const q = JSON.parse(init.body); return reply(q, q.method === 'eth_chainId' ? chain : '0x6000'); },
  });
  await assert.rejects(pool.request(request()), error => error.reason === 'rate-limited');
  assert.equal(calls, 0); assert.equal(pool.status()[0].disabled, false); assert.ok(pool.status()[0].retryAfterMs >= 2000);
  blocked = false; now += 2001; assert.equal(await pool.request(request()), '0x6000'); assert.equal(calls, 2);
});

test('cancelled and timed-out local waiters never enter host admission or fetch', async () => {
  const held = gate(), started = gate(), admissions = [], calls = [];
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, minIntervalMs: 0, maximumQueueWaitMs: 25,
    providerAdmission: async (_provider, methods, operation) => { admissions.push(methods[0]); return operation(); },
    fetchImpl: async (_provider, init) => { const q = JSON.parse(init.body); calls.push(q.method); if (q.method === 'eth_getCode') { started.resolve(); await held.promise; } return reply(q, q.method === 'eth_chainId' ? chain : '0x6000'); },
  });
  await pool.request({ method: 'eth_chainId' });
  const active = pool.request(request()); await started.promise;
  const abort = new AbortController(), queued = pool.request(request(abort.signal)), cancelled = assert.rejects(queued);
  await tick(); abort.abort(); await cancelled;
  await assert.rejects(pool.request(request()), KeelRpcQueueTimeoutError);
  assert.deepEqual(admissions, ['eth_chainId', 'eth_getCode']); assert.deepEqual(calls, admissions);
  held.resolve(); assert.equal(await active, '0x6000'); assert.equal(pool.status()[0].disabled, false);
});

test('caller cancellation while a marker waits prevents dispatch after it resolves', async () => {
  const held = gate(), entered = gate(), abort = new AbortController(); let calls = 0, dispatched = 0;
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, minIntervalMs: 0,
    providerAdmission: async (_provider, _methods, operation) => operation({ beforeDispatch: async () => { entered.resolve(); await held.promise; }, afterDispatch: () => { dispatched++; } }),
    fetchImpl: async (_provider, init) => { calls++; return reply(JSON.parse(init.body), chain); },
  });
  const pending = pool.request(request(abort.signal)), rejected = assert.rejects(pending);
  await entered.promise; abort.abort(); held.resolve(); await rejected;
  assert.equal(calls, 0); assert.equal(dispatched, 0);
});

test('expired RPC timer prevents dispatch when a delayed marker eventually resolves', async () => {
  let calls = 0, dispatched = 0;
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, minIntervalMs: 0, timeoutMs: 100,
    providerAdmission: async (_provider, _methods, operation) => operation({ beforeDispatch: async () => { await new Promise(resolve => setTimeout(resolve, 130)); }, afterDispatch: () => { dispatched++; } }),
    fetchImpl: async (_provider, init) => { calls++; return reply(JSON.parse(init.body), chain); },
  });
  await assert.rejects(pool.request(request()), error => error.reason === 'unavailable' && error.diagnostic.transportFailure === 'timeout');
  assert.equal(calls, 0); assert.equal(dispatched, 0); assert.equal(pool.status()[0].disabled, false);
});

for (const kind of ['http', 'rpc']) test(`${kind} denial survives private-observer cancellation under host admission`, async () => {
  const abort = new AbortController(); let calls = 0;
  const pool = createKeelRpcPool({ rpcUrls: [url], chainId: 11155111, minIntervalMs: 0,
    providerAdmission: async (_provider, _methods, operation) => operation(),
    onPrivateResponse: event => { if (event.request.method === 'eth_getCode') abort.abort(); },
    fetchImpl: async (_provider, init) => { calls++; const q = JSON.parse(init.body); if (q.method === 'eth_chainId') return reply(q, chain); return kind === 'http' ? new Response('denied', { status: 403 }) : Response.json({ jsonrpc: '2.0', id: q.id, error: { code: 403, message: 'denied' } }); },
  });
  await assert.rejects(pool.request(request(abort.signal))); const before = calls;
  await assert.rejects(pool.request(request()), error => error.reason === 'access-denied');
  assert.equal(calls, before); assert.equal(pool.status()[0].disabled, true); assert.equal(pool.status()[0].reason, 'access-denied');
});

test('configured-recipient status retains numeric denial together with cooldown without exposing evidence', () => {
  const identity = { chainId: 11155111, rpcUrl: 'https://status.example/private-key', configuredRecipient: true, fetchImpl: async () => assert.fail('status is local only') };
  createKeelConfiguredReadRateLimitHandler(identity)(3000);
  createKeelConfiguredReadAccessDenialHandler(identity)(403);
  const status = keelConfiguredReadProviderStatus(identity);
  assert.equal(status.accessDeniedStatus, 403); assert.ok(status.retryAfterMs > 0);
  assert.doesNotMatch(JSON.stringify(status), /https:|private-key|requestBody|responseBody/u);
});

test('proof reads use host admission and keep different injected transports isolated', async () => {
  const admitted = [], fetched = [[], []];
  const admission = async (provider, methods, operation, signal) => { admitted.push({ provider, methods, signal }); return operation(); };
  const readers = [0, 1].map(index => createApprovedProofStateReader({ rpcUrls: [url, alternate], approvedStateRpcUrls: [url], block: { number: 4n, hash }, minIntervalMs: 0, providerAdmission: admission,
    fetchImpl: async (provider, init) => { const q = JSON.parse(init.body); fetched[index].push(q.method); assert.equal(provider, url); return reply(q, q.method === 'eth_chainId' ? chain : q.method === 'eth_getBlockByNumber' ? { number: '0x4', hash } : index ? '0x6001' : '0x6000'); },
  }));
  try {
    const input = { method: 'eth_getCode', params: [address, { blockHash: hash, requireCanonical: true }] };
    assert.equal(await readers[0].request(input), '0x6000'); assert.equal(await readers[1].request(input), '0x6001');
    for (const methods of fetched) assert.deepEqual(methods, ['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode']);
    assert.equal(admitted.length, 6); assert.ok(admitted.every(item => item.provider === url && item.methods.length === 1 && item.signal instanceof AbortSignal));
  } finally { for (const reader of readers) reader.close(); }
});
