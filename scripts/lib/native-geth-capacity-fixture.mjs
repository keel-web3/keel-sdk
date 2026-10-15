import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { toHex } from 'viem';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantity = value => {
  assert.ok(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(value), 'Native qualification omitted a canonical quantity');
  return BigInt(value);
};

/** Test recipe only: independently corroborate this controlled process's exact
 * --rpc.gascap with public empty calls. Never infer a whole-request limit from
 * a later project envelope. This emits infrastructure facts, no program proof. */
export async function measureNativeFixtureRequestCapacity({ rpc, configuredGasCap, block, account, gasPrice }) {
  assert.equal(typeof configuredGasCap, 'bigint');
  assert.ok(configuredGasCap > 24_000n && configuredGasCap < quantity(block.gasLimit));
  assert.ok(/^0x[0-9a-f]{40}$/iu.test(account));
  const selected = structuredClone(block), blockTag = selected.number;
  const chain = await rpc('eth_chainId', []);
  assert.equal(quantity(chain), 11155111n);
  const version = await rpc('web3_clientVersion', []);
  assert.match(version, /^Geth\/v1\.17\.8-/u);
  assert.equal((await rpc('eth_getBlockByNumber', [blockTag, false])).hash, selected.hash);
  const nonce = quantity(await rpc('eth_getTransactionCount', [account, blockTag]));
  const call = index => ({ from: account, to: account, data: '0x', value: '0x0', nonce: toHex(nonce + BigInt(index)),
    gas: toHex(configuredGasCap + 1n), gasPrice });
  const request = count => [{ blockStateCalls: Array.from({ length: count }, (_, index) => ({ calls: [call(index)] })),
    validation: true, traceTransfers: false, returnFullTransactions: true }, blockTag];
  const singleRequest = request(1), sequenceRequest = request(2);
  const single = await rpc('eth_simulateV1', singleRequest);
  const sequence = await rpc('eth_simulateV1', sequenceRequest);
  for (const [expectedRequest, result] of [[singleRequest, single], [sequenceRequest, sequence]]) {
    assert.ok(Array.isArray(result) && result.length === expectedRequest[0].blockStateCalls.length, 'Native qualification omitted a public call');
    let consumed = 0n;
    for (const [index, item] of result.entries()) {
      assert.equal(item.calls?.length, 1); assert.equal(item.transactions?.length, 1);
      const output = item.calls[0], transaction = item.transactions[0], expected = call(index);
      assert.equal(output.status, '0x1'); assert.equal(output.error, undefined); assert.equal(output.returnData, '0x');
      assert.equal(transaction.from.toLowerCase(), account.toLowerCase()); assert.equal(transaction.to.toLowerCase(), account.toLowerCase());
      assert.equal(transaction.input, '0x'); assert.equal(quantity(transaction.value), 0n);
      assert.equal(quantity(transaction.nonce), nonce + BigInt(index)); assert.equal(quantity(transaction.gasPrice), quantity(gasPrice));
      // The FIRST envelope independently equals the declared cap. Later values
      // only corroborate Geth's subtraction of actual prior usage, never define it.
      assert.equal(quantity(transaction.gas), configuredGasCap - consumed, 'Configured request cap was not corroborated by the public native envelopes');
      const used = quantity(output.gasUsed), maximum = quantity(output.maxUsedGas);
      assert.ok(used > 0n && maximum >= used && maximum <= quantity(transaction.gas));
      consumed += used;
      assert.ok(consumed < configuredGasCap);
      assert.equal(expected.data, '0x');
    }
  }
  const invalidNonce = request(1);
  invalidNonce[0].blockStateCalls[0].calls[0].nonce = toHex(nonce + 1n);
  await assert.rejects(async () => rpc('eth_simulateV1', invalidNonce), error => error?.code === -38011,
    'Measured capacity requires actual native strict nonce rejection');
  assert.equal(quantity(await rpc('eth_getTransactionCount', [account, blockTag])), nonce);
  assert.equal((await rpc('eth_getBlockByNumber', [blockTag, false])).hash, selected.hash);
  const measuredAt = new Date(Date.now()).toISOString();
  return Object.freeze({ measuredAt, requestGasCap: configuredGasCap,
    evidence: Object.freeze({ schema: 'keel-native-fixture-request-capacity@1', chainId: 11155111, blockNumber: blockTag,
      blockHash: selected.hash, clientVersion: version, configuredRequestGasCap: configuredGasCap.toString(),
      firstObservedEnvelope: quantity(single[0].transactions[0].gas).toString(),
      secondObservedRemainder: quantity(sequence[1].transactions[0].gas).toString(),
      strictNonceError: -38011, measuredAt, publicOnly: true, programProof: false,
      source: 'controlled-process-flag-corroborated-by-first-envelope-and-public-sequence',
      qualificationSha256: hash({ singleRequest, single, sequenceRequest, sequence, invalidNonce }) }) });
}
