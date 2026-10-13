import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinnedKeelSepoliaSimulationTransport, assertKeelSimulationEnvelopes } from '../packages/sdk/dist/simulation-connection.js';

const gas = '0xbebc200';
const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const program = { method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ gas, data: '0x1234' }] }], validation: true }, '0x12'] };
const snapshot = { number: '0x12', hash: hash(99), timestamp: '0x6ac79200', gasLimit: gas, baseFeePerGas: '0xf', slotNumber: '0xa' };

function socket(change = {}) {
  const requests = [];
  let closed = 0, blockReads = 0, probes = 0;
  return {
    requests, get closed() { return closed; }, socket: { readyState: 1 },
    close() { closed++; this.socket.readyState = 3; },
    async requestAsync({ body }) {
      requests.push(body);
      if (body.method === 'web3_clientVersion') return { result: change.version ?? 'reth/v2.7.0-3d592ec/test' };
      if (body.method === 'eth_chainId') return { result: change.chain ?? '0xaa36a7' };
      if (body.method === 'eth_getBlockByNumber') {
        const block = { ...snapshot, ...change.snapshot };
        return { result: ++blockReads > 1 && change.reorganized ? { ...block, hash: hash(100) } : block };
      }
      if (body.method === 'eth_getTransactionCount') return { result: change.nonce ?? '0x0' };
      if (body.method === 'eth_getBalance') return { result: change.balance ?? `0x${'f'.repeat(64)}` };
      if (body.method === 'eth_getCode') return { result: change.code ?? '0x' };
      if (body.method === 'eth_simulateV1') {
        const payload = body.params[0];
        const isProgram = payload.blockStateCalls[0].calls[0].data === '0x1234';
        const negative = !isProgram && payload.blockStateCalls.length === 1 && BigInt(payload.blockStateCalls[0].calls[0].nonce) === BigInt(change.nonce ?? '0x0') + 1n;
        if (negative && !change.ignoreNonce) return { error: change.negativeError ?? { code: -38011, message: 'nonce too high' } };
        if (!isProgram && change.probeError) return { error: change.probeError };
        if (!isProgram) probes++;
        const result = payload.blockStateCalls.map((b, index) => ({
          number: `0x${(BigInt(snapshot.number) + BigInt(index + 1)).toString(16)}`,
          timestamp: `0x${(BigInt(snapshot.timestamp) + BigInt(12 * (index + 1))).toString(16)}`,
          hash: hash(index + 1), parentHash: index ? hash(index) : snapshot.hash,
          blockAccessListHash: hash(index + 10), slotNumber: `0x${(11 + index).toString(16)}`,
          transactions: b.calls.map(c => ({ ...c, gas: isProgram ? change.programCap ?? c.gas : index ? c.gas : change.cap ?? c.gas })),
          calls: b.calls.map(() => ({ status: isProgram && change.revert ? '0x0' : '0x1', gasUsed: '0x2ee0', maxUsedGas: '0x2ee0', returnData: '0x' })),
        }));
        if (!isProgram && change.mutate && (!change.pass || probes === change.pass)) change.mutate(result, body);
        return { result };
      }
      throw new Error('Unexpected method');
    },
  };
}
const simulationRequests = node => node.requests.filter(r => r.method === 'eth_simulateV1');
const hasProgram = node => simulationRequests(node).some(r => r.params[0].blockStateCalls[0].calls[0].data === '0x1234');

async function rejectedQualification(change, kind = 'unsupported-simulation') {
  const node = socket(change); let connections = 0;
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return node; });
  await assert.rejects(transport.request(program), error => error.kind === kind);
  // Failure is cached: no fresh socket, public probe or project attempt on retry.
  const requests = node.requests.length;
  await assert.rejects(transport.request(program), error => error.kind === kind);
  assert.equal(connections, 1); assert.equal(node.requests.length, requests);
  assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
  await transport.close();
  return node;
}

test('qualifies capabilities on one retained socket without admitting or rejecting by client brand', async () => {
  for (const version of ['reth/v2.7.0-3d592ec/test', 'Geth/v1.17.7-stable/test', 'unknown-client']) {
    const node = socket({ version }); let connections = 0;
    const t = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return node; });
    assert.equal(t.qualifiedProbeGas, undefined);
    await t.request(program);
    assert.equal(t.qualifiedProbeGas, 100_000n);
    assert.equal(connections, 1);
    assert.ok(node.requests.every(r => r.method !== 'web3_clientVersion'));
    assert.deepEqual(simulationRequests(node).map(r => r.params[0].validation), [false, true, true, true]);
    assert.deepEqual(simulationRequests(node).at(-1).params, [{ ...program.params[0], returnFullTransactions: true }, '0x12']);
    await t.close(); assert.equal(node.closed, 1);
  }
});

test('qualification contains only public empty calls without any state or block overrides', async () => {
  const node = socket(); const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await t.request(program);
  for (const r of simulationRequests(node).slice(0, 3)) {
    assert.equal(r.params[1], snapshot.number);
    assert.equal(r.params[0].returnFullTransactions, true);
    assert.equal(r.params[0].traceTransfers, false);
    for (const b of r.params[0].blockStateCalls) {
      assert.deepEqual(Object.keys(b), ['calls']);
      for (const c of b.calls) {
      assert.equal(c.data, '0x'); assert.equal(c.value, '0x0');
      assert.equal(c.from, '0x0000000000000000000000000000000000000000');
      assert.equal(c.to, c.from);
      }
    }
  }
  assert.equal(simulationRequests(node).at(-1).params[0].blockStateCalls[0].stateOverrides, undefined);
  assert.equal(program.params[0].returnFullTransactions, undefined);
  assert.equal(node.requests.at(-2).method, 'eth_getBlockByNumber');
  assert.deepEqual(node.requests.at(-2).params, [snapshot.number, false]);
  await t.close();
});

test('a clamped public control is rejected once before project data', async () => {
  await rejectedQualification({ cap: '0x5208' }, 'provider-limit');
});

test('a client name and success status cannot replace exact full gas, nonce and fee envelopes', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].transactions; },
    r => { r[0].transactions = [hash(1)]; },
    r => { r[0].transactions[0].gas = '0xbebc201'; },
    r => { r[1].transactions[0].gas = '0x05208'; },
    r => { delete r[0].transactions[0].nonce; },
    r => { r[1].transactions[0].nonce = '0x2'; },
    r => { delete r[0].transactions[0].gasPrice; },
    r => { r[1].transactions[0].gasPrice = '0x0'; },
  ]) await rejectedQualification({ version: 'Geth/v1.17.7', pass, mutate });
});

test('both qualification modes require linked current-fork headers for every block', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].blockAccessListHash; },
    r => { r[0].parentHash = hash(5); },
    r => { r[1].parentHash = snapshot.hash; },
    r => { r[1].number = r[0].number; },
    r => { r[1].timestamp = r[0].timestamp; },
    r => { r[1].slotNumber = r[0].slotNumber; },
    r => { r[0].hash = '0x'; },
  ]) await rejectedQualification({ pass, mutate });
});

test('both qualification modes require valid pre-refund gas and success evidence', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].calls[0].maxUsedGas; },
    r => { r[1].calls[0].maxUsedGas = '0x1'; },
    r => { r[0].calls[0].maxUsedGas = '0xbebc201'; },
    r => { r[0].calls[0].gasUsed = '0x0'; },
    r => { r[1].calls[0].status = '0x0'; },
    r => { r[0].calls[0].error = { code: 3 }; },
    r => { r[0].calls[0].returnData = '0x01'; },
    r => { r[1].calls = []; },
  ]) await rejectedQualification({ pass, mutate });
});

test('validation:true success must be corroborated by nonce-too-high rejection', async () => {
  await rejectedQualification({ ignoreNonce: true });
  for (const negativeError of [{ code: -32601 }, { code: -38013 }, { code: 403, message: 'private-url' }])
    await rejectedQualification({ negativeError }, negativeError.code === -32601 ? 'unsupported-simulation' : 'rpc-unavailable');
});

test('wrong chain, invalid snapshot, reorg and missing method fail closed with no reconnect', async () => {
  await rejectedQualification({ chain: '0x1' }, 'wrong-chain');
  for (const snapshot of [{ hash: '0x' }, { timestamp: undefined }, { gasLimit: '0x0' }, { baseFeePerGas: undefined }])
    await rejectedQualification({ snapshot });
  await rejectedQualification({ reorganized: true }, 'chain-reorganized');
  await rejectedQualification({ probeError: { code: -32601, message: 'private-url' } });
});

test('unknown provider errors expose only the failed public capability stage', async () => {
  const node = socket({ probeError: { code: 403, message: 'https://private-secret/' } });
  const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await assert.rejects(t.request(program), error => error.kind === 'rpc-unavailable' && error.diagnostic.stage === 'read-capacity' && !error.message.includes('private-secret'));
  assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
});

test('silent clamping of an actual program is provider-limit and never replays', async () => {
  const node = socket({ programCap: '0x2faf080', revert: true }); let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return node; });
  await assert.rejects(t.request(program), e => e.kind === 'provider-limit' && e.diagnostic.providerGasCap === '50000000');
  assert.equal(count, 1); assert.equal(simulationRequests(node).length, 4);
  await t.close();
});

test('an actual program revert stays a revert and closed sockets never implicitly reconnect', async () => {
  const node = socket({ revert: true }); let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return node; });
  assert.equal((await t.request(program))[0].calls[0].status, '0x0');
  node.socket.readyState = 3;
  for (let i = 0; i < 2; i++) await assert.rejects(t.request(program), e => e.kind === 'rpc-unavailable');
  assert.equal(count, 1); assert.equal(simulationRequests(node).length, 4);
  await t.close();
});

test('explicit close prevents new selection and close during selection does not leak a socket', async () => {
  let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return socket(); });
  await t.close();
  await assert.rejects(t.request(program), e => e.kind === 'rpc-unavailable');
  assert.equal(count, 0);
  let resolve; const node = socket();
  const pending = createPinnedKeelSepoliaSimulationTransport(() => new Promise(r => { resolve = r; }));
  const request = pending.request(program);
  const closing = pending.close(); resolve(node);
  await assert.rejects(request, e => e.kind === 'rpc-unavailable');
  await closing; assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
});

test('missing or enlarged envelopes are unavailable evidence', () => {
  assert.throws(() => assertKeelSimulationEnvelopes(program, [{ calls: [] }]), e => e.kind === 'unsupported-simulation');
  assert.throws(() => assertKeelSimulationEnvelopes(program, [{ transactions: [{ gas: '0xbebc201' }] }]), e => e.kind === 'unsupported-simulation');
});

test('public account state must qualify without funding or synthetic overrides', async () => {
  for (const change of [{ nonce: '0x00' }, { nonce: '0xffffffffffffffff' }, { balance: '0x0' }, { code: '0x6000' }])
    await rejectedQualification(change);
});

test('public qualification uses observed nonzero nonce and records only its modest probe ceiling', async () => {
  const node = socket({ nonce: '0x7' }); const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await t.request(program);
  const probes = simulationRequests(node).slice(0, 3);
  assert.deepEqual(probes.map(r => r.params[0].blockStateCalls[0].calls[0].nonce), ['0x7', '0x7', '0x8']);
  assert.deepEqual(probes.slice(0, 2).map(r => r.params[0].blockStateCalls[0].calls[0].gas), ['0x186a0', '0x186a0']);
  assert.equal(t.qualifiedProbeGas, 100_000n);
  assert.equal(simulationRequests(node).at(-1).params[0].blockStateCalls[0].calls[0].gas, gas);
  await t.close(); assert.equal(t.qualifiedProbeGas, undefined);
});
