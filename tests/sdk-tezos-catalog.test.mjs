import test from 'node:test';
import assert from 'node:assert/strict';
import { KEEL_TEZOS_MODULES } from '../packages/sdk/dist/index.js';

test('native discovery includes governed inherited implementations', () => {
  const anchors = KEEL_TEZOS_MODULES.find(module => module.id === 'keel-anchors');
  assert.ok(anchors.deployable.includes('KeelGovernedEthAttachmentRegistry'));
  assert.ok(anchors.deployable.includes('KeelEthAttachmentRegistry'));
});

test('native NFT ledger is reusable source without an origination target', () => {
  const die = KEEL_TEZOS_MODULES.find(module => module.id === 'keel-die');
  assert.ok(die.contracts.includes('keel_fa2_nft.py'));
  assert.ok(die.shared.includes('KeelNFTLedger'));
  assert.equal(die.deployable.includes('KeelNFTLedger'), false);
  assert.ok(die.deployable.includes('KeelCollectionFA2'));
  const ip = KEEL_TEZOS_MODULES.find(module => module.id === 'keel-ip-control');
  assert.ok(ip.deployable.includes('KeelIPWrappedFA2'));
});
