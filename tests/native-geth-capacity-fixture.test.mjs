import assert from 'node:assert/strict';
import test from 'node:test';
import { measureNativeFixtureRequestCapacity } from '../scripts/lib/native-geth-capacity-fixture.mjs';

const account = '0x' + '11'.repeat(20);
const block = { number: '0x0', hash: '0x' + 'ab'.repeat(32), gasLimit: '0xbebc200' };
const configuredGasCap = 50_000_000n;
const hex = number => '0x' + BigInt(number).toString(16);
// Deterministic unit model only. The CI recipe separately requires actual
// responses from the pinned, network-isolated Geth and never uses this model.
function fixture(fault = {}) {
  const requests = []; let reads = 0;
  const rpc = async (method, params) => {
    requests.push({ method, params: structuredClone(params) });
    if (method === 'eth_chainId') return fault.chain ?? '0xaa36a7';
    if (method === 'web3_clientVersion') return fault.version ?? 'Geth/v1.17.8-stable-a5790770/linux-amd64/go1.24';
    if (method === 'eth_getBlockByNumber') return { ...block, ...(fault.changedBlock && ++reads > 1 ? { hash: '0x' + 'cd'.repeat(32) } : {}) };
    if (method === 'eth_getTransactionCount') return fault.changedNonce && requests.filter(item => item.method === method).length > 1 ? '0x1' : '0x0';
    assert.equal(method, 'eth_simulateV1');
    assert.equal(params[1], '0x0'); assert.equal(params[0].validation, true);
    assert.equal(params[0].returnFullTransactions, true); assert.equal(params[0].traceTransfers, false);
    let remaining = fault.actualCap ?? configuredGasCap;
    const result = params[0].blockStateCalls.map(({ calls }, index) => {
      assert.equal(calls.length, 1); const call = calls[0];
      assert.equal(call.data, '0x'); assert.equal(call.to, account); assert.equal(call.from, account); assert.equal(call.value, '0x0');
      if (!fault.ignoreNonce && BigInt(call.nonce) !== BigInt(index)) throw Object.assign(new Error('nonce too high'), { code: fault.nonceCode ?? -38011 });
      const available = BigInt(call.gas) < remaining ? BigInt(call.gas) : remaining;
      remaining -= 12_000n;
      return { transactions: [{ ...call, input: call.data, gas: hex(available) }], calls: [{ status: '0x1', gasUsed: '0x2ee0', maxUsedGas: '0x2ee0', returnData: '0x' }] };
    });
    fault.change?.(result, params);
    return result;
  };
  return { rpc, requests };
}
const measure = value => measureNativeFixtureRequestCapacity({ rpc: value.rpc, configuredGasCap, block, account, gasPrice: '0x30' });

test('controlled native recipe requires first-envelope and complete public-sequence evidence before emitting a capacity fact', async () => {
  const value = fixture(), result = await measure(value);
  assert.equal(result.requestGasCap, 50_000_000n);
  assert.equal(result.evidence.firstObservedEnvelope, '50000000');
  assert.equal(result.evidence.secondObservedRemainder, '49988000');
  assert.equal(result.evidence.strictNonceError, -38011);
  assert.equal(result.evidence.publicOnly, true); assert.equal(result.evidence.programProof, false);
  assert.equal(result.evidence.blockHash, block.hash);
  assert.match(result.evidence.qualificationSha256, /^[0-9a-f]{64}$/);
  const simulations = value.requests.filter(item => item.method === 'eth_simulateV1');
  assert.deepEqual(simulations.map(item => item.params[0].blockStateCalls.length), [1, 2, 1]);
  assert.ok(simulations.every(item => item.params[0].blockStateCalls.every(block => block.calls[0].data === '0x' && block.calls[0].gas === hex(50_000_001n))));
});

test('configured cap, a first envelope and a later remainder cannot substitute for one another', async () => {
  for (const fault of [
    { actualCap: 49_764_217n },
    { change: blocks => { blocks[0].transactions[0].gas = hex(49_764_217n); } },
    { change: blocks => { if (blocks.length > 1) blocks[1].transactions[0].gas = hex(49_764_217n); } },
    { change: blocks => { if (blocks.length > 1) blocks[1].transactions[0].gas = hex(50_000_000n); } },
  ]) await assert.rejects(measure(fixture(fault)));
});

test('failed, incomplete or changed public qualification never yields measured capacity', async () => {
  const changes = [
    blocks => { blocks[0].calls[0].status = '0x0'; },
    blocks => { blocks[0].calls[0].returnData = '0xab'; },
    blocks => { delete blocks[0].calls[0].maxUsedGas; },
    blocks => { blocks[0].transactions[0].gasPrice = '0x31'; },
    blocks => { blocks[0].transactions[0].nonce = '0x2'; },
    blocks => { blocks[0].transactions[0].value = '0x1'; },
    blocks => { if (blocks.length > 1) blocks.pop(); },
  ];
  for (const change of changes) await assert.rejects(measure(fixture({ change })));
  for (const fault of [{ chain: '0x1' }, { version: 'UnqualifiedClient/v1' }, { changedBlock: true },
    { changedNonce: true }, { ignoreNonce: true }, { nonceCode: -32000 }]) await assert.rejects(measure(fixture(fault)));
});
