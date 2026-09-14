import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEventLog, encodeAbiParameters, encodeEventTopics } from 'viem';
import { ABIS } from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
import { ABIS as SEED_ABIS } from '../packages/sdk/dist/abis/keel-die.generated.js';
import { ABI_CONTRACTS } from '../packages/sdk/dist/abis.generated.js';

test('queue catalog exposes the live engine and pool without the unused lottery', () => {
  assert.equal(ABIS.KeelQueueLottery, undefined);
  assert.equal(ABI_CONTRACTS['keel-mint-access'].includes('KeelQueueLottery'), false);
  for (const name of ['KeelMintQueue', 'KeelQueueLotteryEngine', 'KeelQueueLotteryPool', 'KeelQueueDemand', 'KeelQueuePriority', 'KeelQueueReadAdapter']) {
    assert.ok(Array.isArray(ABIS[name]), name);
    assert.ok(ABI_CONTRACTS['keel-mint-access'].includes(name), name);
  }
});

test('Demand Configured preserves named values in the reordered event', () => {
  const abi = ABIS.KeelQueueDemand;
  const event = abi.find(item => item.type === 'event' && item.name === 'Configured');
  assert.deepEqual(event.inputs.map(input => input.name), ['bps', 'minimum', 'drainOverride', 'fixedThreshold']);
  const topics = encodeEventTopics({ abi, eventName: 'Configured' });
  const data = encodeAbiParameters(event.inputs, [250, 17n, 29n, 83n]);
  const log = decodeEventLog({ abi, topics, data, strict: true });
  assert.deepEqual(log.args, { bps: 250, minimum: 17n, drainOverride: 29n, fixedThreshold: 83n });
});

test('entropy worker dependencies are present in the packaged bindings', () => {
  for (const [abi, names] of [
    [ABIS.KeelMintRewardEntropy, ['requested', 'deliveries', 'request', 'deliver', 'seedProvider', 'blockArchive']],
    [ABIS.KeelRewardClaims, ['draws', 'entropySource']],
    [SEED_ABIS.KeelSeedVrfAdapter, ['requests', 'request', 'batchEntropy']],
    [SEED_ABIS.KeelSeedBlockArchive, ['hashOf']],
  ]) {
    for (const name of names) assert.ok(abi.some(item => item.type === 'function' && item.name === name), name);
  }
});
