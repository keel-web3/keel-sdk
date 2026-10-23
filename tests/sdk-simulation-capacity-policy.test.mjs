import test from 'node:test';
import assert from 'node:assert/strict';
import { keelSimulationChainDefaults, snapshotKeelSimulationProviderLimits, measureKeelSimulationProgram,
  measureKeelSimulationExecution, keelSimulationProviderCapacityFailure } from '../packages/sdk/dist/simulation-capacity-policy.js';
import { keelSimulationTransportDiagnostic, keelSimulationTransportFailure } from '../packages/sdk/dist/publication-preflight.js';

const hex = n => `0x${BigInt(n).toString(16)}`;
const request = (envelopes, sizes = envelopes.map(() => 2)) => ({ method: 'eth_simulateV1', params: [{
  blockStateCalls: envelopes.map((gas, i) => ({ calls: [{ gas: hex(gas), data: `0x${'ab'.repeat(sizes[i])}` }] })),
  validation: true, traceTransfers: false, returnFullTransactions: true,
}, '0x12'] });
const response = (input, usage, maximum = usage) => input.params[0].blockStateCalls.map((block, i) => ({
  transactions: block.calls, calls: [{ status: '0x1', returnData: '0x', gasUsed: hex(usage[i]), maxUsedGas: hex(maximum[i]) }],
}));

test('network defaults never invent a provider gas cap or a fork policy for an unregistered chain', () => {
  for (const chain of [1, 11155111]) assert.deepEqual(keelSimulationChainDefaults(chain), { maximumBlocks: 256 });
  for (const chain of [0, 8453, 17000, NaN, Infinity, '1']) assert.throws(() => keelSimulationChainDefaults(chain), /explicitly registered/);
  assert.equal(Object.isFrozen(keelSimulationChainDefaults(1)), true);
});

test('exact program measurements vary with counts, bytes and gas without a thirty-call threshold', () => {
  for (const count of [1, 2, 7, 29, 30, 31, 65, 256]) {
    const gas = Array.from({ length: count }, (_, i) => 50000n + BigInt(i) * 123n);
    const sizes = gas.map((_, i) => i * 7 + 1), input = request(gas, sizes), before = structuredClone(input);
    const measured = measureKeelSimulationProgram(input);
    assert.equal(measured.callCount, count); assert.equal(measured.blockCount, count);
    assert.equal(measured.calldataBytes, sizes.reduce((a, b) => a + b, 0));
    assert.equal(measured.requestPayloadBytes, Buffer.byteLength(JSON.stringify(input)));
    assert.equal(measured.requestedEnvelopeGas, gas.reduce((a, b) => a + b, 0n));
    assert.equal(measured.largestTransactionGas, gas.at(-1)); assert.equal(measured.largestBlockEnvelopeGas, gas.at(-1));
    assert.deepEqual(input, before); assert.equal(Object.isFrozen(measured), true);
  }
});

test('block, transaction and request measurements remain separate with multiple calls in a block', () => {
  const input = request([3000000n, 2000000n]);
  input.params[0].blockStateCalls[0].calls.push({ gas: hex(4000000), data: '0x00' });
  const measured = measureKeelSimulationProgram(input);
  assert.equal(measured.callCount, 3); assert.equal(measured.largestTransactionGas, 4000000n);
  assert.equal(measured.largestBlockEnvelopeGas, 7000000n); assert.equal(measured.requestedEnvelopeGas, 9000000n);
  assert.equal(keelSimulationProviderCapacityFailure(measured, { transactionGasCap: 4500000n }), undefined);
  assert.equal(keelSimulationProviderCapacityFailure(measured, { blockGasCap: 6000000n }), undefined);
  assert.equal(keelSimulationProviderCapacityFailure(measured, { blockGasCap: 3500000n }).diagnostic.gasCapacityScope, 'block');
});

test('Geth cumulative budget uses prior gasUsed plus each exact envelope, not envelope sum or maxUsedGas sum', () => {
  const input = request(Array(30).fill(4450000n));
  const measured = measureKeelSimulationProgram(input);
  assert.equal(measured.requestedEnvelopeGas, 133500000n);
  assert.equal(keelSimulationProviderCapacityFailure(measured, { requestGasCap: 50000000n }), undefined);
  const execution = measureKeelSimulationExecution(input, response(input, Array(30).fill(2000000n), Array(30).fill(2200000n)));
  assert.deepEqual(execution, { gasUsed: 60000000n, maxUsedGas: 66000000n, requiredRequestGas: 62450000n, requiredBlockGas: 4450000n });
  const failure = keelSimulationProviderCapacityFailure(measured, { requestGasCap: 50000000n }, execution);
  assert.equal(failure.kind, 'provider-limit'); assert.equal(failure.diagnostic.gasCapacityScope, 'request');
  assert.equal(failure.diagnostic.requestedGasLimit, '62450000');
  assert.equal(keelSimulationProviderCapacityFailure(measured, { requestGasCap: 100000000n }, execution), undefined);
  const cheap = measureKeelSimulationExecution(input, response(input, Array(30).fill(21000n)));
  assert.equal(keelSimulationProviderCapacityFailure(measured, { requestGasCap: 50000000n }, cheap), undefined);
});

test('failed, clamped, incomplete and unmeasured responses cannot become execution measurements', () => {
  const input = request([100000n, 200000n]), result = response(input, [21000n, 30000n]);
  for (const edit of [
    r => r.pop(), r => r[1].calls[0].status = '0x0', r => r[1].calls[0].error = {},
    r => delete r[1].calls[0].maxUsedGas, r => r[1].calls[0].maxUsedGas = hex(29999),
    r => r[1].calls[0].maxUsedGas = hex(200001), r => r[1].transactions[0].gas = hex(199999),
  ]) {
    const changed = structuredClone(result); edit(changed);
    assert.equal(measureKeelSimulationExecution(input, changed), undefined);
  }
});

test('provider limits snapshot independent dimensions and reject unbounded or ambiguous input', () => {
  const input = { requestGasCap: 50000000n, transactionGasCap: 4000000n, blockGasCap: 10000000n, maximumRequestBytes: 123456, maximumBlocks: 200 };
  const copy = snapshotKeelSimulationProviderLimits(input); input.requestGasCap = 1n;
  assert.equal(copy.requestGasCap, 50000000n); assert.equal(Object.isFrozen(copy), true);
  for (const limits of [null, [], { cap: 50000000n }, { requestGasCap: 0n }, { requestGasCap: 2n ** 64n }, { transactionGasCap: 1 }, { maximumBlocks: 257 }, { maximumRequestBytes: Infinity }])
    assert.throws(() => snapshotKeelSimulationProviderLimits(limits));
});

test('sanitized exhaustion diagnostics identify request scope without turning remaining gas into a fresh cap', () => {
  const failure = keelSimulationTransportFailure({ code: -32000, message: 'SECRET URL payload RPC gas cap exhausted: need 100000, remaining 12000' });
  assert.equal(failure.kind, 'provider-limit'); assert.equal(failure.diagnostic.gasCapacityScope, 'request');
  assert.equal(failure.diagnostic.requestedRequestGas, '100000'); assert.equal(failure.diagnostic.remainingRequestGas, '12000');
  assert.equal(failure.diagnostic.providerGasCap, undefined);
  assert.doesNotMatch(JSON.stringify(keelSimulationTransportDiagnostic(failure)), /SECRET|URL|payload/);
  const unknown = keelSimulationTransportFailure({ code: -32000, message: 'gas cap: 50000000' });
  assert.equal(unknown.diagnostic.providerGasCap, '50000000'); assert.equal(unknown.diagnostic.gasCapacityScope, undefined);
});

test('actual selected-fork intrinsic lower bound excludes only a measured whole-request cap, never an envelope sum',async()=>{
  const { measureKeelSimulationIntrinsicGas }=await import('../packages/sdk/dist/simulation-capacity-policy.js');
  const {resolveKeelTransactionGasPolicy,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP}=await import('../packages/sdk/dist/transaction-gas-policy.js');
  const selected=resolveKeelTransactionGasPolicy({chainId:11155111,blockTimestamp:KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP,blockGasLimit:200_000_000n});
  const input={method:'eth_simulateV1',params:[{blockStateCalls:Array.from({length:45},()=>({calls:[{from:`0x${'11'.repeat(20)}`,to:`0x${'22'.repeat(20)}`,data:`0x${'00'.repeat(20_000)}`,value:'0x0',gas:'0x2faf080'}]}))},'0x1']};
  const metric=measureKeelSimulationProgram(input), floor=measureKeelSimulationIntrinsicGas(input,selected);
  assert.equal(floor.intrinsicProgramGas,58_275_000n);assert.equal(floor.calldataFloorGas,57_600_000n);
  assert.equal(floor.largestIntrinsicCallGas,1_295_000n);
  const failure=keelSimulationProviderCapacityFailure(metric,{requestGasCap:50_000_000n},undefined,floor);
  assert.equal(failure.kind,'provider-limit');assert.equal(failure.diagnostic.gasCapacityScope,'request');assert.equal(failure.diagnostic.minimumProgramGas,'58275000');
  assert.equal(keelSimulationProviderCapacityFailure(metric,{transactionGasCap:50_000_000n},undefined,floor),undefined,'Per-transaction cap cannot be treated as a whole-request cap');
  assert.equal(keelSimulationProviderCapacityFailure(metric,{requestGasCap:60_000_000n},undefined,floor),undefined,'A large requested-envelope sum is not an exclusion');
  const cheap={method:'eth_simulateV1',params:[{blockStateCalls:[{calls:[{from:`0x${'11'.repeat(20)}`,to:`0x${'11'.repeat(20)}`,data:'0x',value:'0x0',gas:'0x5208'}]}]},'0x1']};
  assert.equal(measureKeelSimulationIntrinsicGas(cheap,selected).intrinsicProgramGas,12_000n,'Do not substitute21000 public-probe allocation for actual fork intrinsic gas');
  const pre=resolveKeelTransactionGasPolicy({chainId:11155111,blockTimestamp:KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP-1n,blockGasLimit:200_000_000n});
  assert.equal(measureKeelSimulationIntrinsicGas(input,pre).intrinsicProgramGas,9_945_000n,'Use pinned fork, not wall-clock Amsterdam pricing');
});
