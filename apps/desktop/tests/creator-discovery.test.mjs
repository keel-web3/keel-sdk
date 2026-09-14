import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCreatorContracts } from '../src/creator-discovery.mjs';
const creator = '0x1111111111111111111111111111111111111111';
const factory = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const renderer = '0x4444444444444444444444444444444444444444';
const input = { chainId: 11155111, creator, factoryAddress: factory, rpcUrl: '' };
function client(overrides = {}) { return { getChainId: async () => 11155111, getBlockNumber: async () => 42n, getCode: async () => '0x6000', readContract: async ({ functionName, args, blockNumber }) => {
  assert.equal(blockNumber, 42n);
  if (functionName === 'creatorCollectionCount') return 2n;
  if (functionName === 'creatorCollectionIds') return [1n, 2n];
  if (functionName === 'metadataRenderer') return renderer;
  if (functionName === 'collection') return { creator, tokenContract: token, sharedCollectionId: args[0] + 100n, name: `Shared edition ${args[0]}`, standard: 1, deployment: 1, open: true };
  throw new Error(`Unexpected read ${functionName}`);
}, ...overrides }; }
test('discovery preserves two logical collections sharing one token contract', async () => {
  const result = await discoverCreatorContracts(input, client());
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].contract.id, result.records[1].contract.id);
  assert.notEqual(result.records[0].sharedCollectionId, result.records[1].sharedCollectionId);
  assert.equal(result.records[0].contract.source, 'factory-readback');
  assert.equal(result.records[0].contract.authority, 'unverified');
  assert.ok(result.records[0].contract.abi.length > 0);
  assert.equal(result.infrastructure[1].address, renderer);
  assert.equal(result.factoryIdentity, 'code-observed-not-authenticated');
});
test('discovery rejects wrong-chain, unbounded and contradictory directory reads', async () => {
  await assert.rejects(discoverCreatorContracts(input, client({ getChainId: async () => 1 })), /does not match/);
  await assert.rejects(discoverCreatorContracts(input, client({ readContract: async () => 101n })), /at most 100/);
  const base = client();
  await assert.rejects(discoverCreatorContracts(input, client({ readContract: async (args) => args.functionName === 'creatorCollectionIds' ? [1n] : base.readContract(args) })), /disagree/);
  await assert.rejects(discoverCreatorContracts(input, client({ getCode: async () => '0x' })), /no code/);
});
