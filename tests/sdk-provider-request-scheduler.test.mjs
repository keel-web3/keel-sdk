import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { getEventListeners } from 'node:events';
const modulePath = process.env.KEEL_TEST_PROVIDER_SCHEDULER_MODULE;
const { createKeelProviderRequestScheduler: create, sharedKeelProviderRequestScheduler: shared, KeelProviderQueueFullError } = await import(modulePath ? pathToFileURL(modulePath).href : '../packages/sdk/dist/provider-request-scheduler.js');
const settings = { chainId: 11155111, minIntervalMs: 0, baseRetryDelayMs: 4, maximumRetryDelayMs: 100, circuitFailureThreshold: 3, circuitCooldownMs: 12, random: () => 0 };
const failure = (status, retryAfterMs = 0) => Object.assign(new Error(`private provider failure ${status}`), { diagnostic: { httpStatus: status }, retryAfterMs });
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('shared admission is keyed by exact provider, chain and transport configuration', () => {
  const transport = {}, another = {};
  const first = shared('https://already-approved.example/PRIVATE', settings, transport);
  assert.equal(first, shared('https://already-approved.example/PRIVATE', settings, transport));
  assert.notEqual(first, shared('https://already-approved.example/PRIVATE', { ...settings, chainId: 1 }, transport));
  assert.notEqual(first, shared('https://another-approved.example', settings, transport));
  assert.notEqual(first, shared('https://already-approved.example/PRIVATE', settings, another));
  assert.throws(() => shared('https://already-approved.example/PRIVATE', { ...settings, minIntervalMs: 10 }, transport), /consistent scheduling policy/);
  assert.throws(() => shared('https://already-approved.example/PRIVATE', { ...settings, maximumConcurrency: 2 }, transport), /consistent scheduling policy/);
  assert.doesNotMatch(JSON.stringify(first.status()), /PRIVATE|https:/);
});

test('a 429 storm respects one physical slot, bounded attempts, shared cooldown and original errors', async () => {
  const scheduler = create(settings), original = failure(429, 3);
  let active = 0, peak = 0, calls = 0;
  const execute = async () => { active++; peak = Math.max(peak, active); calls++; await tick(); active--; throw original; };
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => scheduler.run({ method: 'eth_simulateV1' }, execute)));
  assert.equal(peak, 1); assert.equal(calls, 24);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected' && outcome.reason === original));
  assert.equal(scheduler.status().activeRequests, 0); assert.equal(scheduler.status().queuedRequests, 0);
});

test('Retry-After is a lower bound and exponential jitter stays within explicit bounds', async () => {
  const events = [], timestamps = [], scheduler = create({ ...settings, baseRetryDelayMs: 20, random: () => 1, circuitFailureThreshold: 10 });
  const original = failure(429, 27);
  const result = await scheduler.run({ method: 'eth_getBlockByNumber', observe: event => events.push(event) }, async () => {
    timestamps.push(performance.now()); if (timestamps.length < 3) throw original; return 'complete';
  });
  assert.equal(result, 'complete'); assert.ok(timestamps[1] - timestamps[0] >= 25);
  assert.ok(timestamps[2] - timestamps[1] >= 38);
  const delays = events.filter(event => event.type === 'retry-wait' && event.error).map(event => event.retryAfterMs);
  assert.ok(delays[0] >= 26 && delays[0] <= 27); assert.ok(delays[1] >= 39 && delays[1] <= 40);
  assert.equal(events.filter(event => event.type === 'request-start').length, 3);
});

test('long Retry-After opens cooldown but never sleeps beyond the bounded request budget', async () => {
  const scheduler = create(settings), original = failure(429, 60_000);
  let calls = 0;
  await assert.rejects(scheduler.run({ method: 'eth_getCode' }, async () => { calls++; throw original; }), error => error === original);
  await assert.rejects(scheduler.run({ method: 'eth_getCode' }, async () => { calls++; return 'unexpected'; }), error => error !== original && error.diagnostic.httpStatus === 429);
  assert.equal(calls, 1); assert.ok(scheduler.status().retryAfterMs > 59_000);
});

test('queued cancellation removes only its waiter and preserves the caller reason', async () => {
  const scheduler = create(settings), firstGate = gate(), controller = new AbortController(), reason = new Error('owner cancelled');
  const first = scheduler.run({ method: 'eth_getCode' }, () => firstGate.promise);
  await tick(); let executed = false;
  const second = scheduler.run({ method: 'eth_getCode', signal: controller.signal }, async () => { executed = true; });
  await tick(); assert.equal(scheduler.status().queuedRequests, 1);
  controller.abort(reason); await assert.rejects(second, error => error === reason);
  assert.equal(scheduler.status().queuedRequests, 0); assert.equal(executed, false);
  firstGate.resolve('done'); assert.equal(await first, 'done');
});

test('ignoring transport abort cannot release a physical slot early or return late success', async () => {
  const scheduler = create(settings), firstGate = gate(), controller = new AbortController(), reason = new Error('disconnect');
  const first = scheduler.run({ method: 'eth_getCode', signal: controller.signal }, () => firstGate.promise);
  await tick(); controller.abort(reason); await assert.rejects(first, error => error === reason);
  assert.equal(scheduler.status().activeRequests, 1);
  let secondStarted = false;
  const second = scheduler.run({ method: 'eth_getCode' }, async () => { secondStarted = true; return 'second'; });
  await tick(); assert.equal(secondStarted, false);
  firstGate.resolve('late discarded'); assert.equal(await second, 'second');
});

test('403 caches provider-wide denial; unsupported methods cache only their exact method', async () => {
  for (const [original, methodScope] of [[failure(403), false], [Object.assign(new Error('private unsupported'), { code: -32601 }), true]]) {
    const scheduler = create(settings); let calls = 0;
    await assert.rejects(scheduler.run({ method: 'eth_simulateV1' }, async () => { calls++; throw original; }), error => error === original);
    await assert.rejects(scheduler.run({ method: 'eth_simulateV1' }, async () => { calls++; }), error => error !== original && error.name === 'KeelProviderAvailabilityError');
    if (methodScope) assert.equal(await scheduler.run({ method: 'eth_getCode' }, async () => { calls++; return '0x'; }), '0x');
    else await assert.rejects(scheduler.run({ method: 'eth_getCode' }, async () => { calls++; }), error => error !== original && error.name === 'KeelProviderAvailabilityError');
    assert.equal(calls, methodScope ? 2 : 1);
    scheduler.invalidateCapabilities();
    assert.equal(await scheduler.run({ method: 'eth_simulateV1' }, async () => { calls++; return 'fresh'; }), 'fresh');
  }
});

test('shared negative facts never forward another owner raw error, cause or response', async () => {
  for (const original of [Object.assign(failure(403), { message: 'OWNER_A_PRIVATE_PAYLOAD', cause: { data: 'OWNER_A_PRIVATE_PAYLOAD' } }),
    Object.assign(new Error('OWNER_A_PRIVATE_PAYLOAD'), { code: -32601 }), Object.assign(failure(429, 60_000), { message: 'OWNER_A_PRIVATE_PAYLOAD' })]) {
    const scheduler = create(settings), ownerA = [], ownerB = [];
    await assert.rejects(scheduler.run({ method: 'eth_simulateV1', observe: event => ownerA.push(event) }, async () => { throw original; }), error => error === original);
    await assert.rejects(scheduler.run({ method: 'eth_simulateV1', observe: event => ownerB.push(event) }, async () => 'should not execute'), error => {
      assert.notEqual(error, original); assert.doesNotMatch(JSON.stringify(error), /OWNER_A/); assert.doesNotMatch(error.message, /OWNER_A/); assert.equal(error.cause, undefined); return true;
    });
    assert.ok(ownerA.some(event => event.error?.message === original.message));
    assert.ok(ownerB.every(event => event.error !== original));
    assert.doesNotMatch(JSON.stringify(ownerB), /OWNER_A/);
  }
});

test('private observer mutation cannot change the original error or retry classification', async () => {
  const scheduler = create(settings), original = Object.assign(new Error('exact private execution failure'), { code: 3, diagnostic: { rpcCode: 3 } });
  let calls = 0;
  await assert.rejects(scheduler.run({ method: 'eth_simulateV1', observe(event) {
    if (event.error) { event.error.code = 429; event.error.diagnostic.rpcCode = 429; event.error.message = 'mutated'; }
  } }, async () => { calls++; throw original; }), error => error === original && error.code === 3 && error.message === 'exact private execution failure');
  assert.equal(calls, 1); assert.equal(original.diagnostic.rpcCode, 3);
});

test('negative capability facts expire and deterministic execution errors never retry', async () => {
  const scheduler = create({ ...settings, capabilityMaximumAgeMs: 10 });
  const unsupported = Object.assign(new Error('unsupported'), { code: -32601 });
  await assert.rejects(scheduler.run({ method: 'eth_simulateV1' }, async () => { throw unsupported; }));
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(await scheduler.run({ method: 'eth_simulateV1' }, async () => 'fresh'), 'fresh');
  for (const code of [3, -32602, -38013, -38014, -38026]) {
    let calls = 0; const original = Object.assign(new Error('private execution evidence'), { code });
    await assert.rejects(scheduler.run({ method: 'eth_simulateV1' }, async () => { calls++; throw original; }), error => error === original);
    assert.equal(calls, 1);
  }
});

test('stateful operation retry ownership records cooldown but does not multiply physical attempts', async () => {
  const scheduler = create(settings), original = failure(503), events = []; let calls = 0;
  await assert.rejects(scheduler.run({ method: 'eth_simulateV1', retryMode: 'caller', observe: event => events.push(event) }, async () => { calls++; throw original; }), error => error === original);
  assert.equal(calls, 1); assert.ok(events.some(event => event.type === 'retry-wait' && event.retryAfterMs > 0));
});

test('circuit cooldown is shared with queued calls and queue capacity is explicit', async () => {
  const scheduler = create({ ...settings, maximumQueuedRequests: 1 }), blocked = gate();
  const first = scheduler.run({ method: 'eth_getCode' }, () => blocked.promise);
  await tick(); const second = scheduler.run({ method: 'eth_getCode' }, async () => 'second');
  await tick(); await assert.rejects(scheduler.run({ method: 'eth_getCode' }, async () => 'third'), KeelProviderQueueFullError);
  blocked.resolve('first'); await first; await second;
  const circuit = create({ ...settings, circuitFailureThreshold: 1, circuitCooldownMs: 30 }), original = failure(503), times = [];
  assert.equal(await circuit.run({ method: 'eth_getCode' }, async () => { times.push(performance.now()); if (times.length === 1) throw original; return 'recovered'; }), 'recovered');
  assert.ok(times[1] - times[0] >= 28);
});

test('observer failures cannot change results and events expose truthful active waits without endpoint strings', async () => {
  const scheduler = create(settings), events = [];
  assert.equal(await scheduler.run({ method: 'eth_getCode', observe(event) { events.push(event); return Promise.reject(new Error('observer failed')); } }, async () => '0x'), '0x');
  assert.deepEqual(events.map(event => event.type), ['queued', 'request-start', 'request-complete']);
  assert.ok(events.every(event => event.elapsedMs >= 0 && event.providerId.startsWith('provider-') && event.chainId === 11155111));
  assert.equal(events[1].activeRequests, 1); assert.equal(events[1].attempt, 1);
  assert.doesNotMatch(JSON.stringify(events), /https?:|PRIVATE|params|calldata/);
});

test('deadlines include queue waits and refuse already-expired work', async () => {
  const scheduler = create(settings), blocked = gate();
  const first = scheduler.run({ method: 'eth_getCode' }, () => blocked.promise);
  await tick(); let executed = false;
  await assert.rejects(scheduler.run({ method: 'eth_getCode', deadlineAt: performance.now() + 10 }, async () => { executed = true; }), error => error.name === 'TimeoutError');
  assert.equal(executed, false); assert.equal(scheduler.status().queuedRequests, 0);
  blocked.resolve(); await first;
  await assert.rejects(scheduler.run({ method: 'eth_getCode', deadlineAt: performance.now() - 1 }, async () => { executed = true; }), error => error.name === 'TimeoutError');
  assert.equal(executed, false);
});

test('an explicit HTTP503 request-byte capacity refusal never retries or creates shared outage cooldown', async () => {
  const scheduler=create(settings), events=[];
  const original=Object.assign(new Error('fixed capacity refusal'),{diagnostic:{httpStatus:503,gasCapacityScope:'request-bytes'}});
  let calls=0;
  await assert.rejects(scheduler.run({method:'eth_simulateV1',observe:event=>events.push(event)},async()=>{calls++;throw original;}),error=>error===original);
  assert.equal(calls,1);assert.equal(scheduler.status().retryAfterMs,0);
  assert.equal(events.filter(event=>event.type==='retry-wait').length,0);
  assert.equal(await scheduler.run({method:'eth_getCode'},async()=>{calls++;return '0x6000';}),'0x6000');
  assert.equal(calls,2);
});

test('a long physical read consumes the start interval without adding a second pause after completion', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const scheduler = create({ ...settings, minIntervalMs: 250, maximumRetryDelayMs: 5_000 }), held = gate(), starts = [];
  let active = 0, peak = 0;
  const first = scheduler.run({ method: 'eth_getLogs' }, async () => {
    starts.push(Date.now()); active++; peak = Math.max(peak, active);
    await held.promise; active--; return 'first';
  });
  await tick();
  const second = scheduler.run({ method: 'eth_getLogs' }, async () => {
    starts.push(Date.now()); active++; peak = Math.max(peak, active); active--; return 'second';
  });
  await tick();
  t.mock.timers.tick(500); await tick();
  assert.deepEqual(starts, [10_000]);
  assert.equal(scheduler.status().activeRequests, 1);
  held.resolve(); assert.equal(await first, 'first'); await tick();
  assert.deepEqual(starts, [10_000, 10_500]);
  assert.ok(starts[1] - starts[0] >= 250);
  assert.equal(await second, 'second'); assert.equal(peak, 1);
  assert.equal(scheduler.status().activeRequests, 0); assert.equal(scheduler.status().queuedRequests, 0);
});

test('short physical reads still wait for the exact shared minimum start interval', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const scheduler = create({ ...settings, minIntervalMs: 250, maximumRetryDelayMs: 5_000 }), starts = [];
  await scheduler.run({ method: 'eth_getCode' }, async () => { starts.push(Date.now()); return 'first'; });
  const second = scheduler.run({ method: 'eth_getCode' }, async () => { starts.push(Date.now()); return 'second'; });
  await tick();
  t.mock.timers.tick(249); await tick(); assert.deepEqual(starts, [10_000]);
  t.mock.timers.tick(1); await tick();
  assert.equal(await second, 'second'); assert.deepEqual(starts, [10_000, 10_250]);
});

test('an aborted physical read holds its slot through settlement without an additional completion pause or listener leak', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const scheduler = create({ ...settings, minIntervalMs: 250, maximumRetryDelayMs: 5_000 }), held = gate(), controller = new AbortController();
  const reason = new Error('bounded history cancelled'), starts = [], signals = [];
  const first = scheduler.run({ method: 'eth_getLogs', signal: controller.signal }, signal => {
    signals.push(signal); starts.push(Date.now()); return held.promise;
  });
  const firstRejected = assert.rejects(first, error => error === reason);
  await tick(); controller.abort(reason); await firstRejected;
  const second = scheduler.run({ method: 'eth_getLogs' }, async signal => {
    signals.push(signal); starts.push(Date.now()); return 'second';
  });
  await tick(); t.mock.timers.tick(500); await tick();
  assert.deepEqual(starts, [10_000]); assert.equal(scheduler.status().activeRequests, 1);
  held.resolve('late result discarded'); await tick();
  assert.deepEqual(starts, [10_000, 10_500]); assert.equal(await second, 'second');
  assert.equal(scheduler.status().activeRequests, 0);
  for (const signal of signals) assert.equal(getEventListeners(signal, 'abort').length, 0);
});

test('queued work never dispatches after either access-denial status at nonzero pacing', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  for (const status of [401, 403]) {
    const scheduler = create({ ...settings, minIntervalMs: 250, maximumRetryDelayMs: 5_000 }), original = failure(status), held = gate();
    let calls = 0, physicalSignal;
    const first = scheduler.run({ method: 'eth_getLogs' }, async signal => {
      physicalSignal = signal; calls++; await held.promise; throw original;
    });
    const firstRejected = assert.rejects(first, error => error === original);
    await tick();
    const second = scheduler.run({ method: 'eth_getCode' }, async () => { calls++; return 'must not dispatch'; });
    const secondRejected = assert.rejects(second, error => error.reason === 'access-denied' && error.diagnostic.httpStatus === status);
    await tick(); held.resolve(); await firstRejected;
    t.mock.timers.tick(250); await tick(); await secondRejected;
    assert.equal(calls, 1); assert.equal(scheduler.status().activeRequests, 0); assert.equal(scheduler.status().queuedRequests, 0);
    assert.equal(getEventListeners(physicalSignal, 'abort').length, 0);
  }
});

test('a queued request deadline removes admission and cannot dispatch after the physical owner settles', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const scheduler = create({ ...settings, minIntervalMs: 250, maximumRetryDelayMs: 5_000 }), held = gate();
  let calls = 0, physicalSignal;
  const first = scheduler.run({ method: 'eth_getLogs' }, signal => { physicalSignal = signal; calls++; return held.promise; });
  await tick();
  const second = scheduler.run({ method: 'eth_getCode', deadlineAt: performance.now() + 50 }, async () => { calls++; return 'must not dispatch'; });
  const secondRejected = assert.rejects(second, error => error.name === 'TimeoutError');
  await tick(); assert.equal(scheduler.status().queuedRequests, 1);
  t.mock.timers.tick(51); await tick(); await secondRejected;
  assert.equal(scheduler.status().queuedRequests, 0); assert.equal(calls, 1);
  held.resolve('first'); assert.equal(await first, 'first'); await tick();
  t.mock.timers.tick(500); await tick();
  assert.equal(calls, 1); assert.equal(scheduler.status().activeRequests, 0);
  assert.equal(getEventListeners(physicalSignal, 'abort').length, 0);
});
