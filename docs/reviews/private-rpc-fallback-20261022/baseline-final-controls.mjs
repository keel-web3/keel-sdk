import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApprovedProofStateReader } from 'file:///private/tmp/keel-sdk-integration-20261022-01/native/proof-executor/state-reader.mjs';

// All requests terminate in this injected mock. No public or paid provider is contacted.
const urls = ['https://free.example', 'https://eth-sepolia.g.alchemy.com/v2/DUMMY_TOKEN'];
const hash = `0x${'11'.repeat(32)}`, address = `0x${'22'.repeat(20)}`, slot = `0x${'00'.repeat(32)}`;
const block = { number: 4n, hash }, header = { number: '0x4', hash };
const query = { method: 'eth_getProof', params: [address, [slot], { blockHash: hash, requireCanonical: true }] };
const reply = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }));
const rpcError = (id, code, message, status = 200) => new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), { status });
function fixture(fault, approved = urls) {
  const calls = [], attempts = [];
  const fetchImpl = async (url, init) => {
    const index = urls.indexOf(url), q = JSON.parse(init.body); assert.notEqual(index, -1);
    calls.push({ index, method: q.method, params: q.params });
    if (index === 0) { const response = await fault?.(q); if (response !== undefined) return response; }
    return reply(q.id, q.method === 'eth_chainId' ? '0xaa36a7' : q.method === 'eth_getBlockByNumber' ? header : { proof: 'synthetic' });
  };
  const options = { rpcUrls: urls, approvedStateRpcUrls: approved, block, fetchImpl, minIntervalMs: 0, onAttempt: event => attempts.push(event) };
  return { calls, attempts, options, reader: createApprovedProofStateReader(options) };
}
const proofFault = response => q => q.method === 'eth_getProof' ? response(q) : undefined;
function publicEvidence(f, error) {
  const output = JSON.stringify({ status: f.reader.status(), attempts: f.attempts, error: { message: error?.message, diagnostic: error?.diagnostic } });
  assert.doesNotMatch(output, /DUMMY_TOKEN|alchemy\.com|free\.example|PRIVATE_REMOTE_TEXT/u);
}

for (const status of [401, 403]) for (const body of ['empty', 'rate-limit', 'capability', 'malformed']) {
  test(`HTTP${status} with ${body} body is terminal without a second recipient or warmed retry`, async () => {
    const f = fixture(proofFault(q => body === 'empty' ? new Response('', { status })
      : body === 'malformed' ? new Response('PRIVATE_REMOTE_TEXT{', { status })
      : rpcError(q.id, body === 'rate-limit' ? -32005 : -32601, body === 'rate-limit' ? 'rate limit PRIVATE_REMOTE_TEXT' : 'unsupported PRIVATE_REMOTE_TEXT', status)));
    try {
      let observed;
      await assert.rejects(f.reader.request(query), error => { observed = error; return true; });
      const before = f.calls.length;
      await assert.rejects(f.reader.request(query));
      assert.equal(f.calls.length, before, 'observed denial remains terminal for this reader');
      assert.ok(f.calls.every(q => q.index === 0)); publicEvidence(f, observed);
    } finally { f.reader.close(); }
  });
}

const terminal = [
  ['malformed JSON', q => new Response('PRIVATE_REMOTE_TEXT{')],
  ['stale response identity', q => reply(q.id + 1, '0x')],
  ['missing result', q => new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id }))],
  ['unknown RPC error', q => rpcError(q.id, -32042, 'PRIVATE_REMOTE_TEXT')],
  ['invalid parameters', q => rpcError(q.id, -32602, 'rate limit PRIVATE_REMOTE_TEXT')],
  ['genuine revert', q => rpcError(q.id, 3, 'rate limit PRIVATE_REMOTE_TEXT')],
  ['revert prose with rate-limit wording', q => rpcError(q.id, -32000, 'execution reverted: rate limit PRIVATE_REMOTE_TEXT')],
  ['RPC401 with rate-limit wording', q => rpcError(q.id, 401, 'rate limit PRIVATE_REMOTE_TEXT')],
  ['RPC403 with rate-limit wording', q => rpcError(q.id, 403, 'rate limit PRIVATE_REMOTE_TEXT')],
  ['generic HTTP404', q => new Response('', { status: 404 })],
  ['generic HTTP503', q => new Response('', { status: 503 })],
  ['unknown transport error', () => { throw new Error('PRIVATE_REMOTE_TEXT'); }],
  ['missing pinned proof', q => reply(q.id, null)],
];
for (const [name, response] of terminal) test(`${name} is terminal without another recipient`, async () => {
  const f = fixture(proofFault(response));
  try {
    let observed; await assert.rejects(f.reader.request(query), error => { observed = error; return true; });
    const before = f.calls.length; await assert.rejects(f.reader.request(query));
    assert.equal(f.calls.length, before); assert.ok(f.calls.every(q => q.index === 0)); publicEvidence(f, observed);
  } finally { f.reader.close(); }
});

for (const [name, fault] of [
  ['wrong chain', q => q.method === 'eth_chainId' ? reply(q.id, '0x1') : undefined],
  ['canonical mismatch', q => q.method === 'eth_getBlockByNumber' ? reply(q.id, { ...header, hash: `0x${'ff'.repeat(32)}` }) : undefined],
]) test(`${name} stops before address/key disclosure or another recipient`, async () => {
  const f = fixture(fault);
  try { await assert.rejects(f.reader.request(query)); assert.ok(f.calls.every(q => q.index === 0 && q.method !== 'eth_getProof')); }
  finally { f.reader.close(); }
});

const retryable = [
  ['HTTP429', q => new Response('', { status: 429 })],
  ['explicit RPC rate-limit', q => rpcError(q.id, -32005, 'rate limit PRIVATE_REMOTE_TEXT')],
  ['unsupported method', q => rpcError(q.id, -32601, 'method unsupported PRIVATE_REMOTE_TEXT')],
  ['unsupported capability', q => rpcError(q.id, 4200, 'unsupported PRIVATE_REMOTE_TEXT')],
  ['explicit timeout', () => { throw Object.assign(new Error('PRIVATE_REMOTE_TEXT'), { code: 'ETIMEDOUT' }); }],
  ['HTTP413 body limit', q => new Response('', { status: 413 })],
  ['bounded response limit', q => reply(q.id, 'x'.repeat(2 * 1024 * 1024))],
];
for (const [name, response] of retryable) test(`${name} permits only an approved ordered fallback at the exact block`, async () => {
  const f = fixture(proofFault(response));
  try {
    assert.deepEqual(await f.reader.request(query), { proof: 'synthetic' });
    assert.deepEqual(f.calls.filter(q => q.method === 'eth_getProof').map(q => q.index), [0, 1]);
    assert.ok(f.calls.every(q => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getProof'].includes(q.method)));
    for (const q of f.calls.filter(q => q.method === 'eth_getProof')) assert.deepEqual(q.params, query.params);
    assert.ok(f.calls.filter(q => q.index === 1 && q.method === 'eth_getBlockByNumber').length === 1);
    publicEvidence(f);
  } finally { f.reader.close(); }
});

test('healthy free never selects paid; new reader begins free after the prior cooldown expires', async t => {
  let fail = true, now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = fixture(proofFault(q => fail ? new Response('', { status: 429 }) : undefined));
  try {
    await f.reader.request(query); assert.ok(f.calls.some(q => q.index === 1));
    fail = false; now += 60_001; f.reader.close(); f.calls.length = 0;
    const next = createApprovedProofStateReader(f.options);
    try { await next.request(query); assert.ok(f.calls.length > 0 && f.calls.every(q => q.index === 0)); }
    finally { next.close(); }
  } finally { f.reader.close(); }
});

test('fallback recipient credentials alone grant no state-read disclosure', async () => {
  const f = fixture(proofFault(q => new Response('', { status: 429 })), [urls[0]]);
  try { await assert.rejects(f.reader.request(query)); assert.ok(f.calls.every(q => q.index === 0)); }
  finally { f.reader.close(); }
});
