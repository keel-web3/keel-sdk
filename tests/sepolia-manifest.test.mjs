import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefaultKeelHoldTarget, resolveModuleTarget } from '../packages/sdk/dist/modules.js';

test('adding the REDLINE reference preserves the configured public planning store and generic ambiguity checks', () => {
  assert.equal(resolveDefaultKeelHoldTarget(11155111).address.toLowerCase(), '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267');
  assert.throws(() => resolveModuleTarget({ module: 'keel-hold', contract: 'KeelHold', chainId: 11155111 }), /pass instance/);
  assert.equal(resolveModuleTarget({ module: 'keel-hold', contract: 'KeelHold', chainId: 11155111, instance: 'redline-reference-20261004' }).address.toLowerCase(), '0xd820e337692a6eb7a4878e42ce88cbcff49b55cf');
});
import { createSepoliaManifest, verifySepoliaManifest } from '../scripts/sepolia-manifest.mjs';
import { keccak256 } from 'viem';

const hold = '0x1111111111111111111111111111111111111111';
const builder = '0x2222222222222222222222222222222222222222';
const factory = '0x3333333333333333333333333333333333333333';
const renderer = '0x4444444444444444444444444444444444444444';
const row = (contract, address, module = 'keel-die') => ({ module, contract, address, instance: 'test', chainId: 11155111, txHash: `0x${address.slice(2)}${'0'.repeat(24)}`, block: '1', runtimeCodeHash: keccak256('0x1234') });
const records = [row('KeelHold', hold, 'keel-hold'), row('KeelRawTokenURIBuilder', builder, 'keel-harness'), row('KeelCreatorFactory', factory), row('KeelArtifactTokenRenderer', renderer)];
const client = {
  getChainId: async () => 11155111,
  getBlockNumber: async () => 5n,
  getBlock: async () => ({ hash: `0x${'a'.repeat(64)}` }),
  getCode: async () => '0x1234',
  getTransactionReceipt: async ({ hash }) => ({ status: 'success', contractAddress: records.find(entry => entry.txHash === hash).address, blockNumber: 1n, blockHash: `0x${'b'.repeat(64)}` }),
  readContract: async ({ functionName }) => functionName === 'metadataRenderer' ? renderer : hold,
};

test('older factories and other chains never stand in for the modern Sepolia creator pair', () => {
  const result = createSepoliaManifest([row('KeelFactory', factory), { ...row('KeelCreatorFactory', factory), chainId: 1 }]);
  assert.deepEqual(result.modernCreator.missing, ['KeelCreatorFactory', 'KeelArtifactTokenRenderer']);
  assert.equal(result.modernCreator.publicationReady, false);
  assert.equal(result.contracts.length, 1);
});
test('exact receipts, code and renderer binding still require the project publication gates', async () => {
  const result = await verifySepoliaManifest(client, createSepoliaManifest(records));
  assert.equal(result.verification.status, 'checked');
  assert.equal(result.modernCreator.status, 'infrastructure-verified-project-gates-required');
  assert.equal(result.modernCreator.publicationReady, false);
  assert.equal(result.bindings[0].status, 'verified');
  assert.equal(result.writes, 0);
});
test('wrong chain, stale runtime, wrong receipts and renderer mismatch fail closed', async () => {
  const manifest = createSepoliaManifest(records);
  await assert.rejects(verifySepoliaManifest({ ...client, getChainId: async () => 1 }, manifest), /Expected Ethereum Sepolia/);
  for (const override of [
    { getCode: async () => '0x9999' },
    { getTransactionReceipt: async () => ({ status: 'reverted' }) },
    { getTransactionReceipt: async () => ({ status: 'success', contractAddress: factory, blockNumber: 2n }) },
  ]) assert.equal((await verifySepoliaManifest({ ...client, ...override }, manifest)).verification.status, 'partial');
  const mismatch = await verifySepoliaManifest({ ...client, readContract: async () => hold }, manifest);
  assert.equal(mismatch.modernCreator.status, 'renderer-binding-or-identity-mismatch');
});
test('ambiguous modern pairs remain unresolved and RPC failures do not leak provider credentials', async () => {
  const ambiguous = createSepoliaManifest([...records, { ...records[2], instance: 'second' }]);
  assert.equal(ambiguous.modernCreator.status, 'ambiguous-deployment-records');
  const result = await verifySepoliaManifest({ ...client, getCode: async () => { throw new Error('https://private-rpc.example/secret-token'); } }, createSepoliaManifest(records));
  assert.equal(result.contracts[0].verification.reason, 'rpc-read-failed');
  assert.ok(!JSON.stringify(result).includes('secret-token'));
});
