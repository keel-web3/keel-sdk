import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_MANAGER_RECOVERY_SCOPE,
  KEEL_TEZOS_RECOVERY_ACCEPTANCE_DOMAIN,
  KEEL_TEZOS_RECOVERY_ACTION_DOMAIN,
  KEEL_TEZOS_RECOVERY_ERRORS,
  KEEL_TEZOS_RECOVERY_MAX_MEMBERS,
  KEEL_TEZOS_RECOVERY_NO_GROUP,
  KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY,
  KeelChainCapabilityError,
  KeelTezosRecoverySignerError,
  KeelTezosRecoveryUpgradeError,
  buildKeelTezosBindRecoveryGroups,
  buildKeelTezosManagerConfigureBackup,
  buildKeelTezosManagerPause,
  buildKeelTezosManagerRecovery,
  buildKeelTezosManagerUnpause,
  buildKeelTezosRecoveryCreateGroup,
  buildKeelTezosRecoveryRotateGroup,
  buildKeelTezosRecoveryUpgrade,
  keelTezosManagerRecoveryActionHash,
  keelTezosRecoveryAcceptancePayload,
  keelTezosRecoveryActionPayload,
  keelTezosRecoveryBindingHash,
  keelTezosRecoveryBoundActionHash,
  keelTezosRecoveryDigest,
  keelTezosRecoveryGroupId,
  keelTezosRecoveryKeyHash,
  keelTezosRecoveryRosterHash,
  resolveKeelChainCapability,
  sortKeelTezosRecoveryKeys,
} from '../packages/sdk/dist/index.js';
import { keccak256, stringToHex } from 'viem';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const MANAGER = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const CONTROLLER = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const REGISTRY = 'KT1TezoooozzSmartPyzzSTATiCzzzwwBFA1';
// Octez's public sandbox bootstrap keys; no secret key is involved.
const KEYS = [
  { publicKey: 'edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav', address: 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx' },
  { publicKey: 'edpktzNbDAUjUk697W7gYg2CRuBQjyPxbEg8dLccYYwKSKvkPvjtV9', address: 'tz1gjaF81ZRRvdzjobyfVNsAeSC6PScjfQwN' },
  { publicKey: 'edpkuTXkJDGcFd5nh6VvMz8phXxU3Bi7h6hqgywNFi1vZTfQNnS1RV', address: 'tz1faswCTDciRzE4oJ9jn2Vm2dvjeyA9fUzU' },
];
const SIGNATURE = 'edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q';
const signed = (index) => ({ publicKey: KEYS[index].publicKey, signature: SIGNATURE });
const SALT = `0x${'00'.repeat(31)}01`;

nodeTest('the recovery scope is EVM KeelManagerProxy.RECOVERY_SCOPE and the errors name EVM errors', () => {
  assert.equal(KEEL_TEZOS_MANAGER_RECOVERY_SCOPE, keccak256(stringToHex('keel.recovery.manager')));
  assert.equal(KEEL_TEZOS_RECOVERY_NO_GROUP, `0x${'00'.repeat(32)}`);
  assert.equal(KEEL_TEZOS_RECOVERY_MAX_MEMBERS, 32);
  assert.equal(KEEL_TEZOS_RECOVERY_ERRORS.KEEL_RECOVERY_SIGNATURES, 'InvalidRecoverySignatures');
  assert.equal(KEEL_TEZOS_RECOVERY_ERRORS.KEEL_MANAGER_PAUSED, 'ManagerIsPaused');
});

nodeTest('KT1 contracts cannot hold recovery keys and get the typed signer error', () => {
  assert.throws(() => keelTezosRecoveryKeyHash(MANAGER), (error) => error instanceof KeelTezosRecoverySignerError
    && error.code === 'KEEL_TEZOS_RECOVERY_SIGNER' && error.signer === MANAGER);
  assert.throws(() => sortKeelTezosRecoveryKeys([KEYS[0].address, MANAGER]), KeelTezosRecoverySignerError);
  assert.equal(keelTezosRecoveryKeyHash(KEYS[0].address), KEYS[0].address);
});

nodeTest('rosters follow EVM: one key or three to 32, sorted, never repeated', () => {
  const sorted = sortKeelTezosRecoveryKeys(KEYS.map((key) => key.address).reverse(), { forbidTwo: true });
  assert.deepEqual([...sorted].sort(), KEYS.map((key) => key.address).sort());
  assert.deepEqual(sortKeelTezosRecoveryKeys(sorted), sorted, 'sorting is stable');
  assert.throws(() => sortKeelTezosRecoveryKeys(sorted.slice(0, 2), { forbidTwo: true }), /never two/u);
  assert.throws(() => sortKeelTezosRecoveryKeys([sorted[0], sorted[0]]), /repeat/u);
  assert.throws(() => sortKeelTezosRecoveryKeys(sorted.slice(0, 2), { minimum: 3 }), /3 to/u);
  assert.throws(() => sortKeelTezosRecoveryKeys([]), /1 to 32/u);
});

nodeTest('the upgrade-with-backup path is EVM-only and throws the typed capability error', () => {
  const upgrade = resolveKeelChainCapability(KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY, 'tezos');
  assert.equal(upgrade.supported, false);
  assert.match(upgrade.closest.behaviour, /recover/iu);
  assert.equal(resolveKeelChainCapability(KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY, 'ethereum').supported, true);
  assert.equal(resolveKeelChainCapability('authority.recovery', 'tezos').supported, true);
  assert.throws(() => buildKeelTezosRecoveryUpgrade(), (error) => error instanceof KeelTezosRecoveryUpgradeError
    && error instanceof KeelChainCapabilityError && error.code === 'KEEL_CHAIN_CAPABILITY_UNSUPPORTED');
});

nodeTest('builders send the same calls a Studio user makes on EVM, unsigned', () => {
  const create = buildKeelTezosRecoveryCreateGroup({ registry: REGISTRY, salt: SALT, members: [KEYS[0].address], verifyKeys: true,
    deadline: 100000, acceptances: [signed(0)] });
  assert.equal(create.operation.parameters.entrypoint, 'create_group');
  assert.equal(create.signing, 'not-performed');
  assert.equal(create.submission, 'not-performed');
  assert.equal(create.rosterHash, keelTezosRecoveryRosterHash([KEYS[0].address], true));
  assert.throws(() => buildKeelTezosRecoveryCreateGroup({ registry: REGISTRY, salt: SALT, members: [KEYS[0].address], verifyKeys: true, deadline: 1 }),
    /Every member must accept/u);
  assert.throws(() => buildKeelTezosRecoveryCreateGroup({ registry: REGISTRY, salt: SALT, members: [KEYS[0].address], verifyKeys: false, deadline: 1,
    acceptances: [signed(0)] }), /only sent with verifyKeys/u);
  assert.throws(() => buildKeelTezosRecoveryCreateGroup({ registry: REGISTRY, salt: '0x01', members: [KEYS[0].address], verifyKeys: false, deadline: 1 }),
    /32 bytes/u);

  const rotate = buildKeelTezosRecoveryRotateGroup({ registry: REGISTRY, groupId: keelTezosRecoveryGroupId({ creator: KEYS[0].address, salt: SALT }),
    members: KEYS.map((key) => key.address), verifyKeys: true, deadline: 100000, approvals: [signed(0)], acceptances: [signed(2), signed(1), signed(0)] });
  assert.equal(rotate.operation.parameters.entrypoint, 'rotate_group');
  assert.equal(rotate.authorization, 'any-relayer');

  const first = buildKeelTezosManagerConfigureBackup({ manager: MANAGER, nextGroup: KEEL_TEZOS_RECOVERY_NO_GROUP.replace(/00$/u, '01'), expectedRevision: 0,
    deadline: 100000, incomingApprovals: [signed(0)], enrolled: false });
  assert.equal(first.authorization, 'governance');
  assert.equal(first.actionHash, keelTezosRecoveryBindingHash(KEEL_TEZOS_RECOVERY_NO_GROUP.replace(/00$/u, '01'), 0));
  assert.equal(buildKeelTezosManagerConfigureBackup({ manager: MANAGER, nextGroup: KEEL_TEZOS_RECOVERY_NO_GROUP, expectedRevision: 1, deadline: 1,
    currentApprovals: [signed(0)], enrolled: true }).authorization, 'any-relayer');

  const recovery = buildKeelTezosManagerRecovery({ manager: MANAGER, governors: KEYS.map((key) => key.address), deadline: 100000,
    approvals: [signed(0)], acceptances: [signed(0), signed(1), signed(2)] });
  assert.equal(recovery.operation.parameters.entrypoint, 'recover_governors');
  assert.equal(recovery.actionHash, keelTezosManagerRecoveryActionHash(KEYS.map((key) => key.address)));
  assert.equal(recovery.scope, KEEL_TEZOS_MANAGER_RECOVERY_SCOPE);
  assert.throws(() => buildKeelTezosManagerRecovery({ manager: MANAGER, governors: KEYS.map((key) => key.address), deadline: 1,
    approvals: [signed(0)], acceptances: [signed(0), signed(1)] }), /Every incoming governor must accept/u);
  assert.throws(() => buildKeelTezosManagerRecovery({ manager: MANAGER, governors: KEYS.slice(0, 2).map((key) => key.address), deadline: 1,
    approvals: [signed(0)], acceptances: [signed(0), signed(1)] }), /3 to 32/u);

  assert.deepEqual(buildKeelTezosManagerPause({ controller: CONTROLLER }).operation,
    { kind: 'transaction', amount: '0', destination: CONTROLLER, parameters: { entrypoint: 'pause_manager', value: { prim: 'Unit' } } });
  assert.equal(buildKeelTezosManagerPause({ controller: CONTROLLER }).authorization, 'admin');
  assert.equal(buildKeelTezosManagerUnpause({ manager: MANAGER }).authorization, 'governance');
  assert.deepEqual(buildKeelTezosBindRecoveryGroups({ manager: MANAGER, registry: REGISTRY }).operation.parameters,
    { entrypoint: 'bind_recovery_groups', value: { string: REGISTRY } });
  assert.throws(() => buildKeelTezosBindRecoveryGroups({ manager: MANAGER, registry: KEYS[0].address }), /KT1/u);
});

siblingSource('the SDK reproduces the golden recovery vector SmartPy and Octez checked', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/manager-recovery.json', import.meta.url), 'utf8'));
  const golden = fixture.golden;
  const { network, registry, manager } = golden;
  assert.equal(keelTezosRecoveryGroupId({ creator: golden.creator, salt: golden.salt }), golden.groupId);
  assert.equal(keelTezosRecoveryRosterHash(golden.members, golden.verifyKeys), golden.rosterHash);
  assert.equal(keelTezosRecoveryBindingHash(golden.groupId, 0), golden.bindingHash);
  assert.deepEqual(sortKeelTezosRecoveryKeys(golden.governors, { minimum: 3 }), golden.governors);
  assert.equal(keelTezosManagerRecoveryActionHash(golden.governors), golden.managerActionHash);
  assert.equal(keelTezosRecoveryBoundActionHash(golden.bindingRevision, golden.managerActionHash), golden.boundActionHash);
  const actionPayload = keelTezosRecoveryActionPayload({ network, registry, groupId: golden.groupId, resource: manager,
    scope: KEEL_TEZOS_MANAGER_RECOVERY_SCOPE, actionHash: golden.boundActionHash, nonce: 0, revision: 0, deadline: golden.deadline });
  assert.equal(actionPayload, golden.actionPayload);
  assert.equal(keelTezosRecoveryDigest(actionPayload), golden.digest);
  assert.equal(keelTezosRecoveryActionPayload({ network, registry, groupId: golden.groupId, resource: registry, scope: golden.groupId,
    actionHash: golden.rosterHash, nonce: 0, revision: 0, deadline: golden.deadline }), golden.rosterPayload);
  assert.equal(keelTezosRecoveryAcceptancePayload({ network, registry, digest: golden.digest, signer: golden.creator }), golden.acceptancePayload);

  for (const step of fixture.steps) {
    if (step.tezos) assert.equal(KEEL_TEZOS_RECOVERY_ERRORS[step.tezos], step.evm, step.label);
    else assert.equal(step.evm, '', step.label);
  }
});

siblingSource('the SDK constants are the ones the native contracts compile', () => {
  const read = (name) => readFileSync(new URL(`../../keel-contracts/src/modules/keel-artifacts/tezos/${name}`, import.meta.url), 'utf8');
  const manager = read('keel_manager.py');
  const registry = read('keel_recovery_groups.py');
  assert.match(manager, new RegExp(`RECOVERY_SCOPE = sp\\.bytes\\("${KEEL_TEZOS_MANAGER_RECOVERY_SCOPE}"\\)`, 'u'));
  assert.ok(registry.includes(`sp.bytes("${stringToHex(KEEL_TEZOS_RECOVERY_ACTION_DOMAIN)}")`));
  assert.ok(registry.includes(`sp.bytes("${stringToHex(KEEL_TEZOS_RECOVERY_ACCEPTANCE_DOMAIN)}")`));
  assert.match(registry, new RegExp(`MAX_MEMBERS = ${KEEL_TEZOS_RECOVERY_MAX_MEMBERS}\\b`, 'u'));
  for (const error of Object.keys(KEEL_TEZOS_RECOVERY_ERRORS)) {
    assert.ok([manager, registry, read('keel_access_controller.py'), read('keel_signature_authority.py')].some((text) => text.includes(`"${error}"`)), error);
  }
});
