import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const operatorEvidence = JSON.parse(readFileSync(new URL('./fixtures/public-rpc-fork/operator-20261010.json', import.meta.url), 'utf8'));
import { createKeelRpcPool, createKeelRpcFetch, KeelRpcSetupError, resolveKeelRpcConfiguration, normalizeKeelRpcUrl } from '../packages/sdk/dist/rpc.js';
import { readKeelRpcConfiguration } from '../packages/sdk/dist/rpc-node.js';
import { createMcpServer } from '../packages/mcp/dist/server.js';

const urls = ['https://first.example/v2/private-key?token=hidden', 'https://second.example/rpc'];
const chain = '0xaa36a7';
function fixture(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, ...body });
    const answer = await handler(url, body, calls);
    return answer instanceof Response ? answer : Response.json({ jsonrpc: '2.0', id: body.id, result: answer });
  };
  return { calls, fetchImpl };
}
const pool = (f, options = {}) => createKeelRpcPool({ rpcUrls: urls, chainId: 11155111, minIntervalMs: 0, fetchImpl: f.fetchImpl, ...options });

test('HTTP 429 rotates, honors Retry-After across calls, and redacts keyed paths', async () => {
  const f = fixture((url, body) => url === urls[0] ? new Response('throttled private-key', { status: 429, headers: { 'retry-after': '30' } }) : body.method === 'eth_chainId' ? chain : '0x100');
  const p = pool(f);
  assert.equal(await p.request({ method: 'eth_blockNumber' }), '0x100');
  assert.equal(await p.request({ method: 'eth_blockNumber' }), '0x100');
  assert.equal(f.calls.filter(c => c.url === urls[0]).length, 1);
  assert.ok(p.status()[0].retryAfterMs > 29000);
  assert.doesNotMatch(JSON.stringify(p.status()), /private-key|token=hidden/u);
});

test('JSON rate limit and exhaustion return actionable setup without provider messages/secrets', async () => {
  const f = fixture((_url, body) => Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'private-key rate limit' } }));
  const p = pool(f);
  await assert.rejects(p.request({ method: 'eth_getCode', params: ['0x123', 'latest'] }), e => {
    assert.ok(e instanceof KeelRpcSetupError); assert.equal(e.reason, 'rate-limited');
    assert.equal(e.setup.action, 'ask-user-to-configure-rpc'); assert.equal(e.setup.providers[0].name, 'Alchemy');
    assert.doesNotMatch(JSON.stringify(e), /private-key|token=hidden/u); return true;
  });
  const length = f.calls.length;
  await assert.rejects(p.request({ method: 'eth_blockNumber' }), KeelRpcSetupError);
  assert.equal(f.calls.length, length);
});

test('wrong-chain provider is disabled before contract reads and fallback identity is pinned', async () => {
  const f = fixture((url, body) => body.method === 'eth_chainId' ? url === urls[0] ? '0x1' : chain : '0x6000');
  const p = pool(f);
  assert.equal(await p.request({ method: 'eth_getCode', params: ['0x123', 'latest'] }), '0x6000');
  assert.deepEqual(f.calls.filter(c => c.url === urls[0]).map(c => c.method), ['eth_chainId']);
  assert.equal(p.status()[0].disabled, true); assert.equal(p.status()[0].reason, 'wrong-chain');
});

test('known old receipt falls back on null; pending null stays valid but cannot satisfy required evidence', async () => {
  const receipt = { transactionHash: '0x'+'1'.repeat(64) };
  const f = fixture((url, body) => body.method === 'eth_chainId' ? chain : url === urls[0] ? null : receipt);
  assert.deepEqual(await pool(f).request({ method: 'eth_getTransactionReceipt', params: [receipt.transactionHash], requireResult: true }), receipt);
  const empty = fixture((_url, body) => body.method === 'eth_chainId' ? chain : null), p = pool(empty);
  assert.equal(await p.request({ method: 'eth_getTransactionReceipt', params: [receipt.transactionHash] }), null);
  await assert.rejects(p.request({ method: 'eth_getTransactionReceipt', params: [receipt.transactionHash], requireResult: true }), e => e instanceof KeelRpcSetupError && e.reason === 'history-unavailable');
});

test('deterministic revert does not rotate and adapter preserves probe error; wallet calls are refused', async () => {
  const f = fixture((_url, body) => body.method === 'eth_chainId' ? chain : Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted private-key', data: '0x1234' } })), p = pool(f);
  const fetcher = createKeelRpcFetch(p);
  const response = await fetcher(urls[0], { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'eth_call', params: [] }) });
  const error = (await response.json()).error; assert.equal(error.code, 3); assert.equal(error.data, '0x1234'); assert.doesNotMatch(error.message, /private-key/u);
  assert.equal(f.calls.some(c => c.url === urls[1]), false);
  for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'anvil_mine']) await assert.rejects(p.request({ method }), /read-only/u);
});

test('individual paced requests replace provider-incompatible JSON-RPC batches', async () => {
  const times = [];
  const f = fixture((_url, body) => { times.push(Date.now()); return body.method === 'eth_chainId' ? chain : '0x100'; });
  const adapter = createKeelRpcFetch(pool(f, { minIntervalMs: 20 }));
  const result = await adapter(urls[0], { method: 'POST', body: JSON.stringify([1,2,3].map(id => ({ jsonrpc: '2.0', id, method: 'eth_blockNumber', params: [] }))) });
  assert.deepEqual((await result.json()).map(r => r.id), [1,2,3]);
  assert.ok(times.slice(1).every((t,i) => t-times[i] >= 15));
  assert.ok(f.calls.every(c => typeof c.method === 'string'));
});

test('invalid/oversized responses fail over; caller cancellation never contacts another provider', async () => {
  const f = fixture((url, body) => url === urls[0] ? new Response('x'.repeat(1100)) : body.method === 'eth_chainId' ? chain : '0x100');
  assert.equal(await pool(f, { maxResponseBytes: 1024 }).request({ method: 'eth_blockNumber' }), '0x100');
  const controller = new AbortController(); controller.abort(new Error('cancelled by caller'));
  const before = f.calls.length;
  await assert.rejects(pool(f).request({ method: 'eth_blockNumber', signal: controller.signal }), /cancelled/u);
  assert.equal(f.calls.length, before);
});

test('private configuration precedence, keyed HTTPS paths, validation and bounded file loading', async () => {
  const file = { rpcUrls: ['https://file.example/v2/key'], minIntervalMs: 500 };
  assert.equal(resolveKeelRpcConfiguration({}, {}, file).source, 'workspace-config');
  assert.deepEqual(resolveKeelRpcConfiguration({}, { KEEL_SEPOLIA_RPC_URLS: urls.join(',') }, file).rpcUrls, urls);
  assert.equal(resolveKeelRpcConfiguration({ rpcUrl: 'https://explicit.example/path' }, { KEEL_PUBLIC_RPC_URL: urls[0] }, file).source, 'explicit');
  assert.match(normalizeKeelRpcUrl('https://eth-sepolia.g.alchemy.com/v2/test-key'), /\/v2\/test-key/u);
  for (const url of ['https://user:secret@example.com', 'http://remote.example', 'https://127.0.0.1', 'https://example.com/#secret']) assert.throws(() => normalizeKeelRpcUrl(url), /RPC URL/u);
  const root = await mkdtemp('/tmp/keel-rpc-config-');
  try {
    assert.deepEqual(await readKeelRpcConfiguration(root), {});
    await mkdir(root+'/.keel'); await writeFile(root+'/.keel/rpc.json', JSON.stringify({ schema: 'keel-rpc-config@1', ...file }));
    assert.deepEqual((await readKeelRpcConfiguration(root)).rpcUrls, file.rpcUrls);
    await writeFile(root+'/.keel/rpc.json', JSON.stringify({ rpcUrl: urls[0], invalid: 'private-key' }));
    await assert.rejects(readKeelRpcConfiguration(root), e => !e.message.includes('private-key') && /Invalid local RPC config/u.test(e.message));
    const result = spawnSync(process.execPath, ['scripts/rpc.mjs', 'configure', '--from-env', '--chain-id', '11155111', '--workspace', root], { cwd: new URL('..', import.meta.url), env: { ...process.env, KEEL_SEPOLIA_RPC_URL: urls[0] }, encoding: 'utf8' });
    // Existing invalid config is preserved until corrected.
    assert.equal(result.status, 1);
    await rm(root+'/.keel/rpc.json');
    const configured = spawnSync(process.execPath, ['scripts/rpc.mjs', 'configure', '--from-env', '--chain-id', '11155111', '--workspace', root], { cwd: new URL('..', import.meta.url), env: { ...process.env, KEEL_SEPOLIA_RPC_URL: urls[0] }, encoding: 'utf8' });
    assert.equal(configured.status, 0, configured.stderr); assert.doesNotMatch(configured.stdout+configured.stderr, /private-key|token=hidden/u);
    assert.equal((await stat(root+'/.keel/rpc.json')).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('MCP loads workspace providers and returns redacted structured setup instructions on exhaustion', async () => {
  const root = await mkdtemp('/tmp/keel-rpc-mcp-'), previous = globalThis.fetch;
  try {
    await mkdir(root+'/.keel'); await writeFile(root+'/.keel/rpc.json', JSON.stringify({ rpcUrls: urls, minIntervalMs: 0 }));
    const f = fixture((_url, body) => body.method === 'eth_chainId' ? chain : '0x100'); globalThis.fetch = f.fetchImpl;
    const server = await createMcpServer({ workspaceRoot: root });
    const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'rpc-test', version: '1' } } });
    assert.match(init.result.instructions, /rpc.setup-required/u);
    const call = (id,name,args={}) => server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const success = (await call(2,'keel-rpc-check')).result.structuredContent;
    assert.equal(success.chainId, 11155111); assert.equal(success.source, 'workspace-config');
    assert.equal(f.calls[0].url, urls[0]); assert.doesNotMatch(JSON.stringify(success), /private-key|token=hidden/u);
    const endpoints = (await call(3,'keel-endpoint-config')).result.structuredContent;
    assert.doesNotMatch(JSON.stringify(endpoints), /private-key|token=hidden/u);
    // Force a different configured pool, so an old cached transport cannot hide the failure.
    await writeFile(root+'/.keel/rpc.json', JSON.stringify({ rpcUrls: ['https://failed.example/secret-api-key'], minIntervalMs: 0 }));
    globalThis.fetch = async () => new Response('secret-api-key failed', { status: 429, headers: { 'retry-after': '20' } });
    const failed = (await call(4,'keel-rpc-check')).result;
    assert.equal(failed.isError, true); assert.equal(failed.structuredContent.code, 'rpc.setup-required');
    assert.equal(failed.structuredContent.setup.action, 'ask-user-to-configure-rpc');
    assert.ok(failed.structuredContent.retryAfterMs > 19000); assert.doesNotMatch(JSON.stringify(failed), /secret-api-key/u);
  } finally { globalThis.fetch = previous; await rm(root, { recursive: true, force: true }); }
});

test('JSON 429 honors Retry-After and concurrent reads cannot escape cooldown', async () => {
  const f = fixture((_url, body) => body.method === 'eth_chainId' ? chain : Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 429, message: 'rate limit' } }, { headers: { 'retry-after': '25' } }));
  const p = pool(f, { rpcUrls: [urls[0]], minIntervalMs: 10 });
  const results = await Promise.allSettled([1,2,3].map(() => p.request({ method: 'eth_blockNumber' })));
  assert.ok(results.every(r => r.status === 'rejected' && r.reason instanceof KeelRpcSetupError));
  assert.equal(f.calls.filter(c => c.method === 'eth_blockNumber').length, 1);
  assert.ok(p.status()[0].retryAfterMs > 24000);
});

test('timeout fails over and preserves an exact keyed provider path including its trailing slash', async () => {
  const f = fixture(async (url, body) => {
    if (url === urls[0]) throw new Error('network timeout private-key');
    return body.method === 'eth_chainId' ? chain : '0x100';
  });
  assert.equal(await pool(f).request({ method: 'eth_blockNumber' }), '0x100');
  assert.equal(normalizeKeelRpcUrl('https://rpc.example/key/'), 'https://rpc.example/key/');
});

test('an explicit chain-ID recheck is fresh and fails if the provider changes networks', async () => {
  let seen = chain;
  const f = fixture(() => seen), p = pool(f, { rpcUrls: [urls[0]] });
  assert.equal(await p.request({ method: 'eth_chainId' }), chain);
  seen = '0x1';
  await assert.rejects(p.request({ method: 'eth_chainId' }), e => e instanceof KeelRpcSetupError && e.reason === 'wrong-chain');
  assert.equal(f.calls.length, 2);
});

test('operator 429/-32005 and chain-ID 403 diagnostics survive wrappers, cooldown and disabled-provider retries', async () => {
  const { keelSimulationTransportDiagnostic } = await import('../packages/sdk/dist/publication-preflight.js');
  for (const status of [operatorEvidence.tenderly.httpStatus, operatorEvidence.oneRpc.httpStatus]) {
    const f = fixture((_url, body) => body.method === 'eth_chainId' && status === 429 ? chain
      : status === 429 ? Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'SECRET rate limit', data: { url: urls[0] } } }, { status })
      : new Response('<html>SECRET access restriction</html>', { status }));
    const p = pool(f, { rpcUrls: [urls[0]] });
    const request = { method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ to: `0x${'00'.repeat(20)}`, data: '0x' }] }], validation: false, traceTransfers: false, returnFullTransactions: true }, '0x1'] };
    for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(p.request(request), error => {
      assert.ok(error instanceof KeelRpcSetupError);
      const diagnostic = keelSimulationTransportDiagnostic(new Error('wrapper SECRET', { cause: error }));
      assert.equal(diagnostic.httpStatus, status);
      assert.equal(diagnostic.transportFailure, status === 429 ? 'rate-limited' : 'access-denied');
      assert.equal(diagnostic.rpcCode, status === 429 ? -32005 : undefined);
      assert.equal(diagnostic.causeClass, 'KeelRpcSetupError');
      assert.doesNotMatch(JSON.stringify({ diagnostic, status: p.status() }), /SECRET|private-key|token=hidden/);
      return true;
    });
    assert.equal(f.calls.length, status === 429 ? 2 : 1, 'no request is retried after rate/access restriction');
    assert.equal(p.status()[0].disabled, status === 403);
  }
});

test('non-OK diagnostics retain only bounded correlated integer codes, never an HTML or oversized error body', async () => {
  const bodies = [
    id => ({ jsonrpc: '2.0', id, error: { code: -32005, data: 'SECRET' } }),
    id => ({ jsonrpc: '2.0', id: id + 1, error: { code: -32005 } }),
    id => ({ jsonrpc: '2.0', id, error: { code: '-32005' } }),
    id => ({ jsonrpc: '2.0', id, error: { code: 2 ** 40 } }),
    id => ({ jsonrpc: '2.0', id, error: { code: -32005, data: 'SECRET'.repeat(3000) } }),
  ];
  for (const [index, body] of bodies.entries()) {
    const f = fixture((_url, request) => Response.json(body(request.id), { status: 429 }));
    await assert.rejects(pool(f, { rpcUrls: [urls[0]] }).request({ method: 'eth_chainId' }), error => {
      assert.equal(error.diagnostic.httpStatus, 429);
      assert.equal(error.diagnostic.rpcCode, index === 0 ? -32005 : undefined);
      assert.doesNotMatch(JSON.stringify(error), /SECRET/); return true;
    });
  }
});

test('HTTP-200 RPC rate/access errors retain their observed status and code', async () => {
  for (const code of [-32005, 429, 401, 403]) {
    const f = fixture((_url, request) => Response.json({ jsonrpc: '2.0', id: request.id, error: { code, message: 'SECRET' } }));
    await assert.rejects(pool(f, { rpcUrls: [urls[0]] }).request({ method: 'eth_chainId' }), error => {
      assert.deepEqual(error.diagnostic, { httpStatus: 200, rpcCode: code, transportFailure: code === -32005 || code === 429 ? 'rate-limited' : 'access-denied' }); return true;
    });
  }
});

test('concurrent reads stop at the first access restriction after chain identity was cached', async () => {
  const f = fixture((_url, request) => request.method === 'eth_chainId' ? chain : new Response('SECRET', { status: 403 }));
  const p = pool(f, { rpcUrls: [urls[0]] });
  await p.request({ method: 'eth_chainId' });
  const results = await Promise.allSettled([p.request({ method: 'eth_blockNumber' }), p.request({ method: 'eth_blockNumber' })]);
  assert.ok(results.every(r => r.status === 'rejected' && r.reason.diagnostic.httpStatus === 403));
  assert.equal(f.calls.filter(c => c.method === 'eth_blockNumber').length, 1);
});
