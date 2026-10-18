import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  harnessTreeDigest,
  prepareKeelTezosHarnessTreeAction,
  resolveKeelChainCapability,
  unpackHarnessChildren,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const NETWORK = 'NetXdQprcVkpaWU';
const CREATOR = 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx';
const REGISTRY = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const TREE = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const COLLECTION = 'KT1JBHJtcMZ2fFuVtLEKa7hnLc6h2FzTyFyk';
const HARNESS = `0x${'ab'.repeat(32)}`;
const DIGEST = `0x${'11'.repeat(32)}`;
const T1 = [{ key: 1, revision: 1 }, { key: 2, revision: 1 }];
const prepare = (action, overrides = {}) => prepareKeelTezosHarnessTreeAction({ network: NETWORK, sender: CREATOR, harnessRegistry: REGISTRY, treeRegistry: TREE, action, ...overrides });

nodeTest('tree calls route to the piece that holds them, with EVM payload words', () => {
  const forged = prepare({ kind: 'forge', salt: '0x747265652d31', collection: COLLECTION, editPolicy: 0, forkPolicy: 1, children: T1, manifestDigest: DIGEST, entropySetDigest: DIGEST });
  assert.equal(forged.contract, 'KeelHarnessTreeRegistry');
  assert.equal(forged.operation.destination, TREE);
  assert.equal(forged.operation.parameters.entrypoint, 'forge_harness_tree');
  assert.equal(forged.treeDigest, '0xaf3c157af65142cf4a2f8cde2e5c6d24530e78cf8ec7c2c94d556f5ff65b398d');
  assert.equal(forged.childCount, 2);
  const flat = JSON.stringify(forged.operation.parameters.value);
  assert.ok(flat.includes('"158456325046975419265092419585"'), flat);
  assert.equal(forged.signing, 'not-performed');
  assert.equal(forged.submission, 'not-performed');
  assert.deepEqual(forged.readback.map(({ contract, name, destination }) => [contract, name, destination]), [
    ['KeelHarnessRegistry', 'predict_harness_id', REGISTRY], ['KeelHarnessTreeRegistry', 'harness_tree', TREE],
    ['KeelHarnessRegistry', 'harness_revision_commitment', REGISTRY]]);

  const forgedFor = prepare({ kind: 'forge', creator: CREATOR, salt: '0x01', collection: COLLECTION, editPolicy: 0, forkPolicy: 1, children: T1, manifestDigest: DIGEST, entropySetDigest: DIGEST });
  assert.equal(forgedFor.operation.parameters.entrypoint, 'forge_harness_tree_for');
  assert.equal(forgedFor.operation.parameters.value.args[0].string, CREATOR);

  const cases = [
    [{ kind: 'bind' }, 'KeelHarnessRegistry', 'bind_tree_registry'],
    [{ kind: 'register-keys', harnessIds: [HARNESS] }, 'KeelHarnessTreeRegistry', 'register_harness_keys'],
    [{ kind: 'set-limits', maxDepth: 2, maxObjects: 7 }, 'KeelHarnessTreeRegistry', 'set_tree_limits'],
    [{ kind: 'append', harnessId: HARNESS, expectedParent: 1, children: [{ key: 2, revision: 1 }], manifestDigest: DIGEST, entropySetDigest: DIGEST }, 'KeelHarnessTreeRegistry', 'append_harness_tree'],
    [{ kind: 'fork', harnessId: HARNESS, tokenId: 1, baseRevision: 1, expectedForkParent: 0, children: [{ key: 1, revision: 2 }, { key: 2, revision: 1 }], manifestDigest: DIGEST }, 'KeelHarnessTreeRegistry', 'fork_harness_tree_for_token'],
    [{ kind: 'append-selections', harnessId: HARNESS, expectedParent: 1, revisions: [2, 1, 1], manifestDigest: DIGEST, entropySetDigest: DIGEST }, 'KeelHarnessRegistry', 'append_harness_selections'],
  ];
  for (const [action, contract, entrypoint] of cases) {
    const prepared = prepare(action);
    assert.equal(prepared.contract, contract, action.kind);
    assert.equal(prepared.operation.parameters.entrypoint, entrypoint, action.kind);
    assert.equal(prepared.operation.destination, contract === 'KeelHarnessRegistry' ? REGISTRY : TREE, action.kind);
  }
  assert.deepEqual(prepare(cases[0][0]).operation.parameters.value, { string: TREE });
  assert.equal(prepare(cases[1][0]).readback[0].name, 'harness_key_of');
});

nodeTest('payloads EVM would refuse are refused before they are built', () => {
  const forge = (children) => () => prepare({ kind: 'forge', salt: '0x01', collection: COLLECTION, editPolicy: 0, forkPolicy: 1, children, manifestDigest: DIGEST, entropySetDigest: DIGEST });
  assert.throws(forge([]), /1\.\.128/u);
  assert.throws(forge(Array.from({ length: 129 }, () => ({ key: 1, revision: 1 }))), /1\.\.128/u);
  assert.throws(forge([{ key: 0, revision: 1 }]), /positive/u);
  assert.throws(forge([{ key: 1, revision: 0 }]), /positive/u);
  assert.throws(forge([{ key: 2 ** 32, revision: 1 }]), /exceeds/u);
  assert.throws(() => prepare({ kind: 'set-limits', maxDepth: 1, maxObjects: 1 }), /at least 2/u);
  assert.throws(() => prepare({ kind: 'set-limits', maxDepth: 2, maxObjects: 0 }), /positive/u);
  assert.throws(() => prepare({ kind: 'register-keys', harnessIds: [] }), /1\.\.128/u);
  assert.throws(() => prepare({ kind: 'register-keys', harnessIds: ['0x01'] }), /32-byte/u);
  assert.throws(() => prepare({ kind: 'bind' }, { treeRegistry: REGISTRY }), /must differ/u);
  assert.throws(() => prepare({ kind: 'bind' }, { treeRegistry: CREATOR }), /KT1/u);
  assert.throws(() => prepare({ kind: 'unknown' }), /Unknown/u);
  assert.throws(() => prepare({ kind: 'bind', seedPhrase: 'x' }), /signer material/u);
});

nodeTest('the capability map shows harness trees as adapter-different with no user-visible difference', () => {
  const tezos = resolveKeelChainCapability('storage.harness-tree', 'tezos');
  assert.equal(tezos.supported, true);
  assert.equal(tezos.capability.status, 'adapter-different');
  assert.equal(tezos.capability.userVisibleDifference, false);
  assert.deepEqual(tezos.adapter.contracts, ['KeelHarnessRegistry', 'KeelHarnessTreeRegistry']);
  assert.equal(resolveKeelChainCapability('storage.harness', 'tezos').capability.open, undefined);
});

siblingSource('every shared tree vector has the digest the SDK computes', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/harness-trees.json', import.meta.url), 'utf8'));
  let checked = 0;
  for (const step of fixture.steps) {
    if (!step.digest || !step.count) continue;
    const children = unpackHarnessChildren(step.count, step.words.map(BigInt));
    assert.equal(harnessTreeDigest(children), step.digest, step.label);
    checked += 1;
  }
  assert.ok(checked >= 10, `checked ${checked}`);
});
