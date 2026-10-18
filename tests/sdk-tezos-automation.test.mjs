import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_AUTOMATION_DOMAIN,
  KEEL_TEZOS_AUTOMATION_ERRORS,
  KEEL_TEZOS_MODULES,
  KeelTezosAutomationSignerError,
  buildKeelTezosAutomationCapabilityAction,
  buildKeelTezosAutomationExecution,
  buildKeelTezosAutomationKeyActions,
  buildKeelTezosAutomationPolicyAction,
  decodeKeelTezosAutomationKeyState,
  keelTezosAutomationSigner,
  keelTezosAutomationSigningPayload,
  keelTezosCapabilityKey,
  keelTezosKeyHashOfPublicKey,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const contracts = (path) => readFileSync(new URL(`../../keel-contracts/${path}`, import.meta.url), 'utf8');
const NETWORK = 'NetXdQprcVkpaWU';
const CONTROLLER = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const AUTHORITY = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const PUBLIC_KEY = 'edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav';
const SIGNER = 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx';
const CALL = { target: AUTHORITY, payload: '0x05002a', amount: 2 };

siblingSource('the signing payload and capability key match the SmartPy-verified golden vector', () => {
  const { golden } = JSON.parse(contracts('test/fixtures/parity/execution-automation.json'));
  const call = { target: golden.target, payload: golden.payload, amount: golden.amount };
  assert.equal(keelTezosCapabilityKey(call), golden.capabilityKey);
  assert.equal(keelTezosAutomationSigningPayload({ network: golden.network, controller: golden.controller, signer: golden.signer,
    call, nonce: golden.nonce, deadline: golden.deadline }), golden.signingPayload);
});

siblingSource('every shared Tezos refusal maps to the EVM error of the same step', () => {
  const fixture = JSON.parse(contracts('test/fixtures/parity/execution-automation.json'));
  let checked = 0;
  for (const step of fixture.steps) {
    if (!step.tezos || step.difference || step.tezos === 'TARGET_REJECTED') continue;
    const lane = step.op === 'execute' ? 'execute' : 'configure';
    assert.equal(KEEL_TEZOS_AUTOMATION_ERRORS[lane][step.tezos], step.evm, step.label);
    checked += 1;
  }
  assert.ok(checked >= 15, `checked ${checked}`);
  const differences = fixture.steps.filter((step) => step.difference);
  assert.deepEqual(differences.map((step) => [step.difference, step.evm, step.tezos]), [['capability-scope', '', 'KEEL_POLICY']]);
});

nodeTest('the payload binds controller, chain, signer, nonce, deadline, amount and payload', () => {
  const base = { network: NETWORK, controller: CONTROLLER, signer: SIGNER, call: CALL, nonce: 3, deadline: 1200 };
  const payload = keelTezosAutomationSigningPayload(base);
  assert.ok(payload.startsWith('0x05'));
  assert.ok(payload.includes(Buffer.from(KEEL_TEZOS_AUTOMATION_DOMAIN).toString('hex')));
  const variants = [
    { controller: AUTHORITY }, { network: 'NetXnHfVqm9iesp' }, { signer: 'tz1gjaF81ZRRvdzjobyfVNsAeSC6PScjfQwN' },
    { nonce: 4 }, { deadline: 1201 }, { call: { ...CALL, amount: 3 } }, { call: { ...CALL, payload: '0x050007' } },
    { call: { ...CALL, target: CONTROLLER } },
  ];
  for (const variant of variants) assert.notEqual(keelTezosAutomationSigningPayload({ ...base, ...variant }), payload, JSON.stringify(variant));
  // The capability excludes the amount, as the controller's capability_key_of does.
  assert.equal(keelTezosCapabilityKey({ ...CALL, amount: 9 }), keelTezosCapabilityKey(CALL));
  assert.notEqual(keelTezosCapabilityKey({ ...CALL, payload: '0x050007' }), keelTezosCapabilityKey(CALL));
});

nodeTest('only implicit-account keys sign; a KT1 gets a typed error', () => {
  assert.equal(keelTezosKeyHashOfPublicKey(PUBLIC_KEY), SIGNER);
  assert.equal(keelTezosAutomationSigner(SIGNER), SIGNER);
  const typed = (error) => error instanceof KeelTezosAutomationSignerError && error.code === 'KEEL_TEZOS_AUTOMATION_SIGNER';
  assert.throws(() => keelTezosAutomationSigner(CONTROLLER), typed);
  assert.throws(() => keelTezosAutomationSigningPayload({ network: NETWORK, controller: CONTROLLER, signer: AUTHORITY, call: CALL, nonce: 0, deadline: 1 }), typed);
  assert.throws(() => buildKeelTezosAutomationCapabilityAction({ controller: CONTROLLER, signer: AUTHORITY, call: CALL, validAfter: 0, validUntil: 10, maxAmount: 0, enabled: true }), typed);
  assert.throws(() => keelTezosKeyHashOfPublicKey(CONTROLLER), typed);
});

nodeTest('governance actions and the relayer transaction use the controller entrypoint layouts', () => {
  const key = buildKeelTezosAutomationKeyActions({ controller: CONTROLLER, signatureAuthority: AUTHORITY, publicKey: PUBLIC_KEY, validUntil: 87400, enabled: true });
  assert.equal(key.signer, SIGNER);
  assert.deepEqual(key.actions.map((action) => [action.operation.destination, action.operation.parameters.entrypoint, action.authorization]),
    [[CONTROLLER, 'configure_automation_key', 'governance'], [AUTHORITY, 'configure_automation_key', 'governance']]);
  assert.deepEqual(key.actions[0].operation.parameters.value,
    { prim: 'Pair', args: [{ string: PUBLIC_KEY }, { prim: 'Pair', args: [{ int: '87400' }, { prim: 'True' }] }] });
  const revoke = buildKeelTezosAutomationKeyActions({ controller: CONTROLLER, publicKey: PUBLIC_KEY, validUntil: 87400, enabled: false });
  assert.deepEqual(revoke.actions[0].operation.parameters.value.args[1], { prim: 'Pair', args: [{ int: '0' }, { prim: 'False' }] });

  const policy = buildKeelTezosAutomationPolicyAction({ controller: CONTROLLER, call: CALL, maxAmount: 5, enabled: true });
  assert.equal(policy.operation.parameters.entrypoint, 'configure_policy');
  assert.deepEqual(policy.operation.parameters.value.args[1].args[0], { int: '1' });

  const grant = buildKeelTezosAutomationCapabilityAction({ controller: CONTROLLER, signer: SIGNER, call: CALL, validAfter: 1000, validUntil: 4600, maxAmount: 3, enabled: true });
  assert.equal(grant.capabilityKey, keelTezosCapabilityKey(CALL));
  assert.deepEqual(grant.operation.parameters.value, { prim: 'Pair', args: [{ string: SIGNER }, { prim: 'Pair', args: [{ bytes: grant.capabilityKey.slice(2) },
    { prim: 'Pair', args: [{ int: '1000' }, { prim: 'Pair', args: [{ int: '4600' }, { prim: 'Pair', args: [{ int: '3' }, { prim: 'True' }] }] }] }] }] });
  assert.throws(() => buildKeelTezosAutomationCapabilityAction({ controller: CONTROLLER, signer: SIGNER, call: CALL, validAfter: 4600, validUntil: 4600, maxAmount: 3, enabled: true }), RangeError);
  assert.throws(() => buildKeelTezosAutomationCapabilityAction({ controller: CONTROLLER, signer: SIGNER, call: CALL, validAfter: 0, validUntil: 2_592_001, maxAmount: 3, enabled: true }), RangeError);

  const signature = 'edsigtaLvXR5xFtiGkKFegQXhWnxxsBYPCk4DJvYU8hb5xSdxQjppPgdtE77E6CXQrm9obabM7ycWNNVAq1r65RzKo7yMSD4yAz';
  const execution = buildKeelTezosAutomationExecution({ controller: CONTROLLER, signer: SIGNER, call: CALL, deadline: 1200, signature });
  assert.equal(execution.authorization, 'any-relayer');
  assert.equal(execution.operation.amount, '2');
  assert.equal(execution.operation.parameters.entrypoint, 'execute_automation');
  assert.deepEqual(execution.operation.parameters.value, { prim: 'Pair', args: [{ string: SIGNER }, { prim: 'Pair', args: [
    { prim: 'Pair', args: [{ string: AUTHORITY }, { prim: 'Pair', args: [{ bytes: '05002a' }, { int: '2' }] }] },
    { prim: 'Pair', args: [{ int: '1200' }, { string: signature }] }] }] });
  assert.throws(() => buildKeelTezosAutomationExecution({ controller: CONTROLLER, signer: SIGNER, call: CALL, deadline: 1200, signature: 'nope' }), TypeError);
});

nodeTest('the key state reads back in EVM automationKeyState shape', () => {
  assert.deepEqual(decodeKeelTezosAutomationKeyState({ prim: 'Pair', args: [{ prim: 'Some', args: [{ int: '87400' }] }, { prim: 'Pair', args: [{ int: '3' }, { int: '1' }] }] }),
    { validUntil: 87400n, nonce: 3n, generation: 1n });
  assert.deepEqual(decodeKeelTezosAutomationKeyState({ prim: 'Pair', args: [{ prim: 'None' }, { prim: 'Pair', args: [{ int: '11' }, { int: '3' }] }] }),
    { validUntil: 0n, nonce: 11n, generation: 3n });
  assert.deepEqual(decodeKeelTezosAutomationKeyState({ prim: 'Pair', args: [{ prim: 'Some', args: [{ string: '1970-01-02T00:16:40Z' }] }, { prim: 'Pair', args: [{ int: '0' }, { int: '1' }] }] }),
    { validUntil: 87400n, nonce: 0n, generation: 1n });
  assert.throws(() => decodeKeelTezosAutomationKeyState({ int: '1' }), TypeError);
});

nodeTest('the catalogue and capability map name the controller automation entrypoints', () => {
  const module = KEEL_TEZOS_MODULES.find((entry) => entry.entrypoints?.KeelAccessController);
  assert.ok(module, 'KeelAccessController in the catalogue');
  for (const name of ['configure_automation_key', 'configure_automation_capability', 'execute_automation']) {
    assert.ok(module.entrypoints.KeelAccessController.includes(name), name);
  }
  const resolution = resolveKeelChainCapability('authority.execution-automation', 'tezos');
  assert.equal(resolution.supported, true);
  assert.deepEqual(resolution.adapter.contracts, ['KeelAccessController']);
});
