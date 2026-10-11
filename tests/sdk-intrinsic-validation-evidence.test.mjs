import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { simulateKeelStorageBeforeFunding, keelSimulationTransportFailure, keelSimulationTransportDiagnostic } from '../packages/sdk/dist/publication-preflight.js';
import { resolveKeelTransactionGasPolicy, assertKeelAmsterdamSimulationHeader } from '../packages/sdk/dist/transaction-gas-policy.js';

// Exact authorized public infrastructure transcript; no fabricated successful
// validation response, network request, private artwork or wallet operation.
const archive = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/publicnode-intrinsic-validation-20261011.json.gz', import.meta.url))));
assert.equal(archive.encoding, 'deduplicated-public-hex@1');
function restore(value) {
  if (Array.isArray(value)) return value.map(restore);
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && value.$publicHexSha256) {
      const hex = archive.strings[value.$publicHexSha256];
      assert.equal(createHash('sha256').update(hex).digest('hex'), value.$publicHexSha256);
      return hex;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item)]));
  }
  return value;
}
const recorded = restore(archive.record);

test('real sixteen-call discovery replays exactly and raw strict -38013 remains a terminal blocked validation', async () => {
  const input = structuredClone(recorded.input);
  for (const key of ['blockNumber', 'maximumReadGas', 'maximumTransactionGas']) input[key] = BigInt(input[key]);
  let cursor = 0;
  await assert.rejects(simulateKeelStorageBeforeFunding(input, { request: async request => {
    const actual = recorded.requests[cursor++];
    assert.ok(actual, 'No extra replay or public-read proof is allowed after strict rejection.');
    assert.deepEqual(request, { method: actual.method, params: actual.params });
    if (actual.response.error) throw Object.assign(new Error(actual.response.error.message), { code: actual.response.error.code });
    return structuredClone(actual.response.result);
  } }), error => {
    assert.equal(error.kind, 'configuration-invalid');
    assert.equal(error.diagnostic.rpcCode, -38013);
    assert.equal(error.diagnostic.transactionValidation, 'intrinsic-gas');
    assert.doesNotMatch(error.message, /Retry the same prepared plan|Correct the saved plan/);
    return true;
  });
  assert.equal(cursor, recorded.requests.length);
  assert.equal(recorded.requests.at(-2).params[0].validation, false);
  assert.equal(recorded.requests.at(-2).response.result.length, 16);
  assert.equal(recorded.requests.at(-1).params[0].validation, true);
  assert.equal(recorded.requests.at(-1).params[0].blockStateCalls.length, 16);
});

test('observed five-call failure and six-call success have identical prefix envelopes and pinned block', () => {
  const evidence = recorded.prefixIsolation;
  const five = evidence.rows.find(row => row.count === 5), six = evidence.rows.find(row => row.count === 6);
  assert.deepEqual(five.response.error, { code: -38013, message: 'intrinsic gas too low' });
  assert.equal(six.response.error, undefined);
  assert.deepEqual(five.params, [{ ...six.params[0], blockStateCalls: six.params[0].blockStateCalls.slice(0, 5) }, ...six.params.slice(1)]);
  assert.equal(five.params[1], evidence.snapshot.number);
  assert.equal(six.params[0].validation, true);
  const policy = resolveKeelTransactionGasPolicy({ chainId: 11155111, blockTimestamp: BigInt(evidence.snapshot.timestamp), blockGasLimit: BigInt(evidence.snapshot.gasLimit) });
  let parent = evidence.snapshot;
  for (const [index, block] of six.response.result.entries()) {
    const request = six.params[0].blockStateCalls[index].calls[0], tx = block.transactions[0], result = block.calls[0];
    for (const key of ['from', 'to']) assert.equal(tx[key].toLowerCase(), request[key].toLowerCase());
    for (const key of ['gas', 'nonce', 'value', 'gasPrice']) assert.equal(BigInt(tx[key]), BigInt(request[key]));
    assert.equal(tx.input, request.data);
    assert.equal(result.status, '0x1');
    assert.equal(result.error, undefined);
    assertKeelAmsterdamSimulationHeader(policy, block, { hash: parent.hash, number: BigInt(parent.number), timestamp: BigInt(parent.timestamp), ...(parent.slotNumber ? { slotNumber: BigInt(parent.slotNumber) } : {}) });
    parent = block;
    const bytes = (request.data.length - 2) / 2;
    const floor = BigInt(policy.transactionBaseGas + policy.recipientAccessGas) + BigInt(bytes * policy.nonzeroCalldataFloorGas);
    assert.ok(BigInt(request.gas) > floor);
    assert.ok(BigInt(request.gas) <= policy.maximumTotalGas);
    if (bytes === 69284) { assert.equal(floor, 4449176n); assert.equal(BigInt(request.gas), 113148677n); }
  }
  // This is evidence of inconsistent answers, not permission to accept a prefix
  // or infer a provider cause. The complete sixteen-call strict proof is absent.
  assert.equal(recorded.requests.at(-1).response.result, undefined);
});

test('raw, nested and sanitized intrinsic errors retain bounded non-outage classification without private data', () => {
  for (const error of [
    { code: -38013 },
    { code: -38013, message: 'intrinsic gas too low PRIVATE https://secret.invalid/key', data: 'ARTWORK' },
    { cause: { code: -38013, message: 'PRIVATE' } },
    { code: -32000, message: 'intrinsic gas too low PRIVATE' },
    { code: -38013, simulationFailure: 'transaction-validation' },
  ]) {
    const failure = keelSimulationTransportFailure(error, { method: 'eth_simulateV1' });
    assert.equal(failure.kind, 'configuration-invalid');
    assert.equal(failure.diagnostic.transactionValidation, 'intrinsic-gas');
    assert.equal(keelSimulationTransportDiagnostic(failure).transactionValidation, 'intrinsic-gas');
    assert.doesNotMatch(JSON.stringify(failure), /PRIVATE|ARTWORK|secret.invalid/);
  }
  assert.equal(keelSimulationTransportFailure({ code: -32098 }).kind, 'rpc-unavailable');
  assert.equal(keelSimulationTransportDiagnostic({ diagnostic: { transactionValidation: 'PRIVATE' } }).transactionValidation, undefined);
});
