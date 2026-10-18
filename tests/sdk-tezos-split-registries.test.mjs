import test from 'node:test';
import assert from 'node:assert/strict';
import { isKeelTezosSplit, keelTezosPiecesOf, resolveKeelTezosCall } from '../packages/sdk/dist/index.js';

// Every call each contract had on Tezos before it was split, from the catalogue
// generated at that time. Studio keeps making these calls by name.
const BEFORE_SPLIT = {
  KeelLibraryRegistry: {
    entrypoints: ['accept_controller', 'activate_policy', 'begin_controller_transfer', 'claim_allowlist_access', 'close_asset',
      'freeze_asset', 'index_asset', 'promote_minimum_tier', 'publish_policy', 'purchase_access', 'resolve_access_request',
      'submit_access_request', 'withdraw'],
    views: ['access_request', 'active_policy', 'allowlist_claimed', 'allowlist_leaf', 'asset', 'credit_of', 'entitlement',
      'grant_count', 'grant_record', 'has_access', 'has_access_at_policy', 'has_access_with_proof',
      'has_access_with_proof_at_policy', 'policy', 'policy_commitment', 'predict_asset_id', 'total_credit_liability'],
  },
  KeelCollectionVerificationRegistry: {
    entrypoints: ['observe_token_uri', 'record_approved', 'record_content_only', 'register_adapter_identity',
      'register_collection_identity', 'register_portable_anchor', 'revoke', 'seal_observation', 'set_policy'],
    views: ['approved_evidence_root', 'inspect_current', 'last_receipt', 'latest_receipt', 'policy', 'policy_id',
      'presentation_content_digest', 'receipt', 'receipt_current'],
  },
};

test('every call Studio made before a split still resolves, with the same kind', () => {
  for (const [contract, surface] of Object.entries(BEFORE_SPLIT)) {
    assert.ok(isKeelTezosSplit(contract), contract);
    const pieces = keelTezosPiecesOf(contract);
    for (const [kind, names] of [['entrypoint', surface.entrypoints], ['view', surface.views]]) {
      for (const name of names) {
        const target = resolveKeelTezosCall(contract, name);
        assert.equal(target.kind, kind, `${contract}.${name}`);
        assert.equal(target.name, name);
        assert.ok(pieces.includes(target.contract), `${contract}.${name} -> ${target.contract}`);
      }
    }
  }
});

test('the library split puts acquisitions on the access registry', () => {
  assert.deepEqual(keelTezosPiecesOf('KeelLibraryRegistry'), ['KeelLibraryRegistry', 'KeelLibraryAccessRegistry']);
  for (const name of ['purchase_access', 'claim_allowlist_access', 'submit_access_request', 'resolve_access_request', 'withdraw',
    'has_access', 'has_access_with_proof', 'entitlement', 'credit_of']) {
    assert.equal(resolveKeelTezosCall('KeelLibraryRegistry', name).contract, 'KeelLibraryAccessRegistry', name);
  }
  for (const name of ['index_asset', 'publish_policy', 'activate_policy', 'close_asset', 'asset', 'policy', 'active_policy', 'predict_asset_id']) {
    assert.equal(resolveKeelTezosCall('KeelLibraryRegistry', name).contract, 'KeelLibraryRegistry', name);
  }
});

test('the verification registry keeps every call; the inspector is originated first', () => {
  assert.deepEqual(keelTezosPiecesOf('KeelCollectionVerificationRegistry'),
    ['KeelCollectionVerificationInspector', 'KeelCollectionVerificationRegistry']);
  for (const name of [...BEFORE_SPLIT.KeelCollectionVerificationRegistry.entrypoints, ...BEFORE_SPLIT.KeelCollectionVerificationRegistry.views]) {
    assert.equal(resolveKeelTezosCall('KeelCollectionVerificationRegistry', name).contract, 'KeelCollectionVerificationRegistry', name);
  }
});

test('an unsplit contract is its own single piece, and unknown calls fail closed', () => {
  assert.equal(isKeelTezosSplit('KeelGraphRegistry'), false);
  assert.deepEqual(keelTezosPiecesOf('KeelGraphRegistry'), ['KeelGraphRegistry']);
  assert.deepEqual(resolveKeelTezosCall('KeelGraphRegistry', 'create_graph'), { contract: 'KeelGraphRegistry', kind: 'entrypoint', name: 'create_graph' });
  assert.throws(() => resolveKeelTezosCall('KeelLibraryRegistry', 'purchaseAccess'), /no catalogued Tezos entrypoint or view/u);
  assert.throws(() => keelTezosPiecesOf('KeelNoSuchRegistry'), /not a catalogued Tezos KEEL deployable/u);
});
