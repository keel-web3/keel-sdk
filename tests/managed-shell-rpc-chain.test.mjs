import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKeelChain } from '../packages/viewer/src/keel-rpc-view.js';

// Every request is mocked. No public RPC or provider credentials are used.
const urls = ['https://one.example/v2/PRIVATE_KEY?token=SECRET', 'https://two.example/rpc', 'https://three.example/rpc'];
const hosts = ['one.example', 'two.example', 'three.example'];
const chainId = 11155111;
const chainHex = '0xaa36a7';
const block = { number: '0x123', hash: `0x${'ab'.repeat(32)}` };
const blockSelector = { blockHash: block.hash, requireCanonical: true };
const store = `0x${'11'.repeat(20)}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const json = (request, result) => Response.json({ jsonrpc: '2.0', id: request.id, result });
function fixture(handler, options = {}) {
  const calls = [];
  const chain = createKeelChain({
    rpc: urls, hosts, keelHold: store, expectedChainId: chainId,
    ...options,
    fetchImpl: async (url, init) => {
      const request = JSON.parse(init.body);
      calls.push({ url, init, ...request });
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      const result = await handler(url, request, init);
      return result instanceof Response || result?.json ? result : json(request, result);
    },
  });
  return { chain, calls };
}
const methods = (calls, url) => calls.filter(call => call.url === url).map(call => call.method);

test('legacy clients retain one-read behavior and optional explicit block tags', async () => {
  const { chain, calls } = fixture(() => '0x6000', { expectedChainId: undefined });
  assert.equal(await chain.call(store, '0x1234'), '0x6000');
  assert.equal(await chain.call(store, '0x1234', '0x42'), '0x6000');
  assert.deepEqual(calls.map(call => call.method), ['eth_call', 'eth_call']);
  assert.deepEqual(calls.map(call => call.params[1]), ['latest', '0x42']);
  await assert.rejects(chain.pinBlock(), /requires expectedChainId/u);
  assert.equal(chain.disclosure().reads, 2);
  assert.equal(chain.disclosure().servedBy, 'https://one.example/…');
});

test('concurrent artwork reads share one endpoint chain check before reading', async () => {
  const gate = deferred();
  const { chain, calls } = fixture((_url, request) => request.method === 'eth_chainId' ? gate.promise : '0x6000');
  const reads = [chain.call(store, '0x01'), chain.request('eth_getCode', [store, 'latest']), chain.call(store, '0x02')];
  assert.deepEqual(methods(calls, urls[0]), ['eth_chainId']);
  gate.resolve(chainHex);
  assert.deepEqual(await Promise.all(reads), ['0x6000', '0x6000', '0x6000']);
  assert.deepEqual(methods(calls, urls[0]), ['eth_chainId', 'eth_call', 'eth_getCode', 'eth_call']);
  assert.equal(chain.disclosure().reads, 3);
  assert.equal(new Set(calls.map(call => call.id)).size, calls.length);
});

test('failover never reads a wrong-chain provider after an earlier endpoint passed identity', async () => {
  const { chain, calls } = fixture((url, request) => {
    if (request.method === 'eth_chainId') return url === urls[1] ? '0x1' : chainHex;
    if (url === urls[0]) throw new Error(`offline ${urls[0]}`);
    return '0x6000';
  });
  assert.equal(await chain.request('eth_chainId', []), chainHex);
  assert.equal(await chain.call(store, '0x1234'), '0x6000');
  assert.deepEqual(methods(calls, urls[1]), ['eth_chainId']);
  assert.deepEqual(methods(calls, urls[2]), ['eth_chainId', 'eth_call']);
  assert.equal(await chain.call(store, '0x1234'), '0x6000');
  assert.deepEqual(methods(calls, urls[1]), ['eth_chainId']);
  assert.equal(chain.disclosure().servedBy, 'https://three.example/…');
});

test('concurrent wrong-chain failure shares the fallback identity check', async () => {
  const gate = deferred();
  const { chain, calls } = fixture((url, request) => request.method === 'eth_chainId' ? url === urls[0] ? gate.promise : chainHex : '0x6000');
  const results = Promise.all([chain.call(store, '0x'), chain.call(store, '0x'), chain.request('eth_getCode', [store, 'latest'])]);
  assert.deepEqual(methods(calls, urls[0]), ['eth_chainId']);
  gate.resolve('0x1');
  assert.deepEqual(await results, ['0x6000', '0x6000', '0x6000']);
  assert.deepEqual(methods(calls, urls[0]), ['eth_chainId']);
  assert.deepEqual(methods(calls, urls[1]), ['eth_chainId', 'eth_call', 'eth_call', 'eth_getCode']);
});

test('explicit identity checks are fresh and transient read failures invalidate prior identity', async () => {
  let network = chainHex;
  const { chain, calls } = fixture((_url, request) => {
    if (request.method === 'eth_chainId') return network;
    throw new Error('PRIVATE_KEY unavailable');
  }, { rpc: urls[0] });
  await assert.rejects(chain.call(store, '0x'), /RPC request failed/u);
  network = '0x1';
  await assert.rejects(chain.call(store, '0x'), /Wrong artwork network/u);
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
  const fresh = fixture(() => network, { rpc: urls[0] });
  network = chainHex;
  assert.equal(await fresh.chain.request('eth_chainId', []), chainHex);
  network = '0x1';
  await assert.rejects(fresh.chain.request('eth_chainId', []), /Wrong artwork network/u);
  assert.equal(fresh.calls.length, 2);
});

test('malformed chain identities cannot authorize a contract read', async () => {
  for (const identity of ['', '11155111', '0x', '0xINVALID', '0x0']) {
    const { chain, calls } = fixture(() => identity, { rpc: urls[0] });
    await assert.rejects(chain.call(store, '0x'));
    assert.deepEqual(calls.map(call => call.method), ['eth_chainId']);
  }
});

test('concurrent reads wait for an explicit identity recheck instead of using cached trust', async () => {
  const changed = deferred();
  let checks = 0;
  const { chain, calls } = fixture((_url, request) => request.method === 'eth_chainId' ? ++checks === 1 ? chainHex : changed.promise : '0x6000', { rpc: urls[0] });
  await chain.call(store, '0x');
  const checking = chain.request('eth_chainId', []);
  const reading = chain.call(store, '0x');
  const failures = Promise.all([assert.rejects(checking, /Wrong artwork network/u), assert.rejects(reading, /Wrong artwork network/u)]);
  changed.resolve('0x1');
  await failures;
  assert.deepEqual(calls.map(call => call.method), ['eth_chainId', 'eth_call', 'eth_chainId']);
});

test('malformed contract/code byte strings are rejected before ABI consumers see them', async () => {
  for (const malformed of ['SECRET', '0x1', '0xgg', '']) {
    const { chain } = fixture((_url, request) => request.method === 'eth_chainId' ? chainHex : malformed, { rpc: urls[0] });
    await assert.rejects(chain.call(store, '0x'), /RPC request failed/u);
    await assert.rejects(chain.request('eth_getCode', [store, 'latest']), /RPC request failed/u);
  }
});

test('HTTP failures, redirects, malformed JSON and invalid JSON-RPC envelopes fail over safely', async () => {
  const invalid = [
    request => Response.json({ jsonrpc: '2.0', id: request.id, result: chainHex }, { status: 429 }),
    () => new Response('PRIVATE_KEY', { status: 503 }),
    request => ({ ok: true, redirected: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: chainHex }) }),
    () => new Response('{PRIVATE_KEY'),
    () => Response.json(null),
    () => Response.json([]),
    request => Response.json({ jsonrpc: '1.0', id: request.id, result: chainHex }),
    request => Response.json({ jsonrpc: '2.0', id: request.id + 1, result: chainHex }),
    request => Response.json({ jsonrpc: '2.0', id: request.id }),
    request => Response.json({ jsonrpc: '2.0', id: request.id, result: 11155111 }),
    request => Response.json({ jsonrpc: '2.0', id: request.id, result: chainHex, error: null }),
    request => Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'PRIVATE_KEY SECRET' } }),
  ];
  for (const response of invalid) {
    const { chain, calls } = fixture((url, request) => url === urls[0] ? response(request) : request.method === 'eth_chainId' ? chainHex : '0x6000');
    assert.equal(await chain.call(store, '0x'), '0x6000');
    assert.deepEqual(methods(calls, urls[0]), ['eth_chainId']);
    assert.deepEqual(methods(calls, urls[1]), ['eth_chainId', 'eth_call']);
  }
});

test('timeouts cover stalled fetch and JSON bodies, abort requests and ignore late identity results', async t => {
  for (const stalledBody of [false, true]) {
    await t.test(stalledBody ? 'stalled JSON body' : 'stalled fetch', async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const late = deferred();
      const started = deferred();
      const { chain, calls } = fixture((url, request) => {
        if (url !== urls[0]) return request.method === 'eth_chainId' ? chainHex : '0x6000';
        started.resolve();
        return stalledBody ? { ok: true, json: () => late.promise } : late.promise;
      }, { timeoutMs: 25 });
      const pending = chain.call(store, '0x');
      await started.promise;
      t.mock.timers.tick(25);
      assert.equal(await pending, '0x6000');
      assert.equal(calls[0].init.signal.aborted, true);
      assert.equal(chain.disclosure().reads, 1);
      late.resolve(stalledBody ? { jsonrpc: '2.0', id: calls[0].id, result: chainHex } : chainHex);
      await Promise.resolve();
      assert.deepEqual(methods(calls, urls[0]), ['eth_chainId']);
      assert.equal(chain.disclosure().servedBy, 'https://two.example/…');
    });
  }
});

test('exhaustion and disclosure never expose provider keys or error bodies', async t => {
  for (const response of [() => { throw new Error(`PRIVATE_KEY SECRET ${urls[0]}`); }, () => new Response('PRIVATE_KEY SECRET', { status: 401 }), () => new Response('{PRIVATE_KEY SECRET')]) {
    const { chain } = fixture(response, { rpc: [urls[0], 'https://denied.example/PRIVATE_KEY?token=SECRET'] });
    await assert.rejects(chain.call(store, '0x'), error => {
      assert.doesNotMatch(String(error.stack) + JSON.stringify(error), /PRIVATE_KEY|SECRET|token=/u);
      assert.match(error.message, /https:\/\/one\.example\/…/u);
      return true;
    });
    assert.doesNotMatch(JSON.stringify(chain.disclosure()), /PRIVATE_KEY|SECRET|token=/u);
    assert.equal(chain.disclosure().servedBy, null);
    assert.equal(chain.disclosure().reads, 0);
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { chain } = fixture(() => new Promise(() => {}), { rpc: urls[0], timeoutMs: 25 });
  const failed = assert.rejects(chain.call(store, '0x'), /RPC request timed out \(https:\/\/one\.example\/…\)/u);
  t.mock.timers.tick(25);
  await failed;
});

test('a stalled artwork request fails over only after the fallback proves chain and block', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = deferred();
  const { chain, calls } = fixture((url, request) => {
    if (request.method === 'eth_chainId') return chainHex;
    if (request.method === 'eth_getBlockByNumber') return block;
    if (url === urls[0]) { started.resolve(); return new Promise(() => {}); }
    return '0x6000';
  }, { timeoutMs: 25 });
  await chain.pinBlock();
  const pending = chain.call(store, '0x');
  await started.promise;
  t.mock.timers.tick(25);
  assert.equal(await pending, '0x6000');
  assert.deepEqual(methods(calls, urls[1]), ['eth_chainId', 'eth_getBlockByNumber', 'eth_call']);
  assert.equal(calls.find(call => call.url === urls[0] && call.method === 'eth_call').init.signal.aborted, true);
});

test('pinBlock shares one immutable header and concurrent reads share its endpoint check', async () => {
  const gate = deferred();
  let headerRequests = 0;
  const { chain, calls } = fixture((_url, request) => {
    if (request.method === 'eth_chainId') return chainHex;
    if (request.method === 'eth_getBlockByNumber') return ++headerRequests === 1 ? block : gate.promise;
    return '0x6000';
  });
  const pins = await Promise.all([chain.pinBlock(), chain.pinBlock()]);
  assert.strictEqual(pins[0], pins[1]);
  assert.deepEqual(pins[0], block);
  assert.ok(Object.isFrozen(pins[0]));
  const reads = [chain.call(store, '0x'), chain.request('eth_getCode', [store, 'latest']), chain.call(store, '0x', '0x999')];
  // Yield until the shared header check has started; no timers or network.
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(headerRequests, 2);
  assert.equal(calls.some(call => ['eth_call', 'eth_getCode'].includes(call.method)), false);
  gate.resolve(block);
  assert.deepEqual(await Promise.all(reads), ['0x6000', '0x6000', '0x6000']);
  for (const call of calls.filter(call => ['eth_call', 'eth_getCode'].includes(call.method))) assert.deepEqual(call.params[1], blockSelector);
  assert.deepEqual(chain.disclosure().pinnedBlock, block);
});

test('pinned failover verifies chain and matching block number/hash before every new provider', async () => {
  const { chain, calls } = fixture((url, request) => {
    if (request.method === 'eth_chainId') return chainHex;
    if (request.method === 'eth_getBlockByNumber') return url === urls[1] ? { ...block, hash: `0x${'cd'.repeat(32)}` } : block;
    if (url === urls[0]) throw new Error('primary offline');
    return '0x6000';
  });
  await chain.pinBlock();
  assert.equal(await chain.call(store, '0x'), '0x6000');
  assert.deepEqual(methods(calls, urls[1]), ['eth_chainId', 'eth_getBlockByNumber']);
  assert.deepEqual(methods(calls, urls[2]), ['eth_chainId', 'eth_getBlockByNumber', 'eth_call']);
  for (const call of calls.filter(call => call.method === 'eth_getBlockByNumber')) {
    assert.deepEqual(call.params, [call.url === urls[0] && call === calls[1] ? 'latest' : block.number, false]);
  }
  for (const call of calls.filter(call => call.method === 'eth_call')) assert.deepEqual(call.params[1], blockSelector);
});

test('incompatible EIP-1898 providers fail over without numeric or latest downgrade', async () => {
  for (const method of ['eth_call', 'eth_getCode']) {
    const { chain, calls } = fixture((url, request) => {
      if (request.method === 'eth_chainId') return chainHex;
      if (request.method === 'eth_getBlockByNumber') return block;
      assert.deepEqual(request.params[1], blockSelector);
      return url === urls[0] ? Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'EIP-1898 not supported PRIVATE_KEY' } }) : '0x6000';
    });
    await chain.pinBlock();
    assert.equal(await chain.request(method, [method === 'eth_call' ? { to: store, data: '0x' } : store, 'latest']), '0x6000');
    assert.deepEqual(methods(calls, urls[1]), ['eth_chainId', 'eth_getBlockByNumber', method]);
    assert.equal(calls.filter(call => call.url === urls[0] && call.method === method).length, 1);
  }
  const { chain, calls } = fixture((_url, request) => {
    if (request.method === 'eth_chainId') return chainHex;
    if (request.method === 'eth_getBlockByNumber') return block;
    return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message: 'PRIVATE_KEY' } });
  });
  await chain.pinBlock();
  await assert.rejects(chain.call(store, '0x'), error => /RPC request failed/u.test(error.message) && !/PRIVATE_KEY/u.test(error.message));
  assert.equal(calls.filter(call => call.method === 'eth_call').length, 3);
  for (const call of calls.filter(call => call.method === 'eth_call')) assert.deepEqual(call.params[1], blockSelector);
});

test('missing, malformed or mismatched pinned headers fail closed without artwork reads', async () => {
  const invalid = [null, {}, { ...block, hash: '0x1234' }, { ...block, number: 'latest' }, { ...block, number: '0x124' }, { ...block, hash: `0x${'cd'.repeat(32)}` }];
  for (const header of invalid) {
    const { chain, calls } = fixture((_url, request) => request.method === 'eth_chainId' ? chainHex : request.params[0] === 'latest' ? block : header, { rpc: urls[0] });
    await chain.pinBlock();
    await assert.rejects(chain.call(store, '0x'));
    assert.equal(calls.some(call => call.method === 'eth_call'), false);
  }
});

test('invalid transport options and denied hosts fail before requests', async () => {
  for (const expectedChainId of [null, 0, -1, 1.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => fixture(() => chainHex, { expectedChainId }), /expectedChainId/u);
  }
  for (const timeoutMs of [null, 0, -1, 1.5, NaN, Infinity, '25', 30001]) {
    assert.throws(() => fixture(() => chainHex, { timeoutMs }), /timeoutMs/u);
  }
  const { chain, calls } = fixture(() => chainHex, { hosts: [] });
  await assert.rejects(chain.call(store, '0x'), /no permitted RPC endpoint/u);
  assert.equal(calls.length, 0);
});

test('managed runtime opts into endpoint identity/block pinning and retains root integrity gates', async () => {
  const source = await readFile(new URL('../packages/sdk/scripts/managed-shell-runtime.mjs', import.meta.url), 'utf8');
  assert.match(source, /expectedChainId:c\.chainId/u);
  assert.match(source, /listRevision:c\.rpcHostListRevision\?\?0,listEpoch:c\.rpcHostListEpoch\?\?0/u);
  assert.ok(source.indexOf('await chain.pinBlock()') < source.indexOf('const read=createKeelHoldObjectReader'));
  assert.match(source, /crypto\.subtle\.digest\('SHA-256',bytes\)/u);
  assert.match(source, /actual!==c\.digest\.toLowerCase\(\)/u);
  assert.match(source, /if\(!html\.includes\('verify-corner'\)\)/u);
  assert.match(source, /if\(!context\|\|typeof context\.json!=='string'\)/u);
});
