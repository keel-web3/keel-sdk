import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { keelSimulationTransportFailure } from '../packages/sdk/dist/publication-preflight.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const wire = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

test('owner-private evidence measures exact UTF-8 wire bytes including changing RPC IDs', async () => {
  const sent = [], observed = [];
  const pool = createKeelRpcPool({ rpcUrls: ['https://fixture.invalid'], chainId: 11155111, minIntervalMs: 0,
    onPrivateResponse: event => observed.push(event), fetchImpl: async (_url, init) => {
      sent.push(init.body);
      const request = JSON.parse(init.body);
      return Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0xaa36a7' : 'fixture' });
    } });
  for (let i = 0; i < 11; i++) await pool.pin(0).request({ method: 'web3_clientVersion', params: ['日本語 🎨', i] });
  assert.equal(sent.length, observed.length);
  for (let i = 0; i < sent.length; i++) {
    assert.equal(observed[i].httpRequestBytes, Buffer.byteLength(sent[i], 'utf8'));
    assert.deepEqual(observed[i].request.params, JSON.parse(sent[i]).params);
  }
  assert.ok(sent.some(body => JSON.parse(body).id === 10));
  assert.ok(sent.at(-1).length < observed.at(-1).httpRequestBytes);
});

test('actual loopback HTTP body admission distinguishes immediately below, at and above each fixture limit', async t => {
  // This is a transport regression with a real HTTP server, not an EVM/provider
  // acceptance proof. Calldata is fixture input, never a production plan change.
  for (const limit of [1024, 2 * 1024 * 1024, 4 * 1024 * 1024]) {
    for (const delta of [-1, 0, 1]) await t.test(`${limit} bytes ${delta < 0 ? 'below' : delta === 0 ? 'at' : 'above'}`, async () => {
      let received, receivedParams, simulationRequests = 0;
      const server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = Buffer.concat(chunks), parsed = JSON.parse(body);
        if (parsed.method === 'eth_chainId') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: '0xaa36a7' })); return; }
        received = body.byteLength; receivedParams = parsed.params; simulationRequests++;
        response.statusCode = received > limit ? 413 : 200;
        response.setHeader('content-type', received > limit ? 'text/plain' : 'application/json');
        response.end(received > limit ? 'Request body size limit reached.' : JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: [] }));
      });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      try {
        const events = [], target = limit + delta;
        const call = { from: `0x${'11'.repeat(20)}`, to: `0x${'22'.repeat(20)}`, data: '0x', gas: '0x100000', value: '0x0' };
        const base = { blockStateCalls: [{ calls: [call] }], validation: false, traceTransfers: false, returnFullTransactions: true };
        const params = [base, '0x2a'];
        // Hex data grows in two-character steps; choose the other canonical
        // positive gas width when one additional JSON byte is needed.
        if ((target - Buffer.byteLength(wire(2, 'eth_simulateV1', params))) % 2) call.gas = '0x1000000';
        call.data = `0x${'00'.repeat((target - Buffer.byteLength(wire(2, 'eth_simulateV1', params))) / 2)}`;
        const pool = createKeelRpcPool({ rpcUrls: [`http://127.0.0.1:${server.address().port}`], allowLoopback: true,
          chainId: 11155111, minIntervalMs: 0, onPrivateResponse: event => events.push(event) });
        const request = pool.pin(0).request({ method: 'eth_simulateV1', params });
        if (delta > 0) await assert.rejects(request, error => {
          const failure = keelSimulationTransportFailure(error);
          assert.equal(failure.kind, 'provider-limit'); assert.equal(failure.diagnostic.httpStatus, 413); return true;
        }); else assert.deepEqual(await request, []);
        assert.equal(received, target);
        assert.equal(simulationRequests, 1);
        assert.deepEqual(receivedParams, params);
        assert.equal(events.find(event => event.request.method === 'eth_simulateV1').httpRequestBytes, target);
      } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
  }
});

test('text/binary compressibility and image-plus-animation preserve each exact payload once in serialized calldata', () => {
  let state = 0xdeadbeef;
  const random = Buffer.from(Array.from({ length: 65536 }, () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state & 255; }));
  const inputs = [Buffer.from('日本語 🎨\n'.repeat(8192)), random, Buffer.alloc(65536, 0), Buffer.from(random.toString('hex'))];
  for (const source of inputs) {
    const compressed = gzipSync(source, { mtime: 0 });
    const stored = compressed.length < source.length ? compressed : source;
    const hex = stored.toString('hex'), base64 = stored.toString('base64');
    assert.equal(Buffer.from(hex, 'hex').equals(stored), true);
    assert.equal(Buffer.from(base64, 'base64').equals(stored), true);
    assert.equal(hex.length, stored.length * 2);
    assert.equal(base64.length, Math.ceil(stored.length / 3) * 4);
    const image = Buffer.from('independent image bytes');
    const calls = [stored, image].map(bytes => ({ data: `0x${bytes.toString('hex')}`, gas: '0x1000000' }));
    const request = { method: 'eth_simulateV1', params: [{ blockStateCalls: calls.map(call => ({ calls: [call] })), validation: false }, '0x2a'] };
    const body = wire(1, request.method, request.params), decoded = JSON.parse(body);
    assert.equal(body.split(hex).length - 1, 1);
    assert.equal(decoded.params[0].blockStateCalls.length, 2);
    assert.equal(sha256(Buffer.from(decoded.params[0].blockStateCalls[0].calls[0].data.slice(2), 'hex')), sha256(stored));
    assert.equal(JSON.stringify(decoded).includes('stateOverrides'), false);
  }
});
