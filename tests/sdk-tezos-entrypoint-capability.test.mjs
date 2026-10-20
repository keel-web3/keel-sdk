import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_ENTRYPOINT_CAPABILITY_ERRORS,
  KEEL_TEZOS_PROTECTED_ENTRYPOINTS,
  KeelTezosEntrypointCapabilityError,
  buildKeelTezosAutomationEntrypointCall,
  buildKeelTezosGovernanceLambda,
  buildKeelTezosRoleEntrypointCall,
  keelTezosAutomationEntrypointPayload,
  keelTezosEntrypointCapabilityKey,
  keelTezosEntrypointLambdas,
  packKeelTezosEntrypointArgs,
  prepareKeelTezosEntrypointCapability,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
// The golden vector of keel-contracts test/fixtures/parity/entrypoint-capabilities.json, copied so the SDK test stands alone.
const GOLDEN = {
  network: 'NetXdQprcVkpaWU',
  controller: 'KT1Tezooo1zzSmartPyzzSTATiCzzzyfC8eF',
  target: 'KT1Tezooo2zzSmartPyzzSTATiCzzzwqqQ4H',
  entrypoint: 'set_value',
  signer: 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx',
  args: '0x05002a',
  amount: 2,
  nonce: 0,
  deadline: 1200,
  capabilityKey: '0x99361ba6d5ce37ddf232c5c3a9bb2c4684ea49df86a31f35ff5813443f7ed9bb',
  adapter: '0x050200000087037a037a050d0362072f02000000140743036801000000094b45454c5f41524753032702000000000743036e0a0000001601d1371b91c60c441cf7678f644fb63e2a78b0e95100065503620000000a257365745f76616c7565072f020000001607430368010000000b4b45454c5f5441524745540327020000000005710002034d031b034f0342',
  probe: '0x05020000004d03200743036e0a0000001601d1371b91c60c441cf7678f644fb63e2a78b0e95100065503620000000a257365745f76616c7565072f02000000060743035903030200000008032007430359030a',
  signingPayload: '0x0507070a000000236b65656c2e74657a6f732e6175746f6d6174696f6e2e656e747279706f696e742e763107070a0000001601d1371b91c4cf72f705512fdf3eda99ca70af9f480007070a000000047a06a77007070a000000150002298c03ed7d454a101eb7022bc95f7e5f41ac7807070a0000002099361ba6d5ce37ddf232c5c3a9bb2c4684ea49df86a31f35ff5813443f7ed9bb0707000207070a000000200f0db0ce6f057a8835adb6a2c617fd8a136b8028fac90aab7b4766def688ea0c0707000000b012',
};
const capability = { target: GOLDEN.target, entrypoint: GOLDEN.entrypoint, parameterType: 'nat' };
const MANAGER = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';

nodeTest('the key, adapter, probe and signing payload match the SmartPy and Octez golden vector', () => {
  assert.equal(keelTezosEntrypointCapabilityKey(capability), GOLDEN.capabilityKey);
  assert.equal(keelTezosEntrypointCapabilityKey({ ...capability, parameterType: { micheline: { prim: 'nat' } } }), GOLDEN.capabilityKey);
  const lambdas = keelTezosEntrypointLambdas(capability);
  assert.equal(lambdas.adapter, GOLDEN.adapter);
  assert.equal(lambdas.probe, GOLDEN.probe);
  assert.equal(packKeelTezosEntrypointArgs(capability, 42), GOLDEN.args);
  assert.equal(keelTezosAutomationEntrypointPayload({ ...GOLDEN, capabilityKey: GOLDEN.capabilityKey }), GOLDEN.signingPayload);
});

nodeTest('the parameter type is part of the key, and the default entrypoint carries no annotation', () => {
  assert.notEqual(keelTezosEntrypointCapabilityKey({ ...capability, parameterType: 'int' }), GOLDEN.capabilityKey);
  assert.notEqual(keelTezosEntrypointCapabilityKey({ ...capability, entrypoint: 'set_other' }), GOLDEN.capabilityKey);
  const plain = keelTezosEntrypointLambdas({ ...capability, entrypoint: 'default' });
  assert.equal((plain.probe.length - 2) / 2, 69);
  assert.ok(!plain.adapter.includes(Buffer.from('%default').toString('hex')));
});

nodeTest('prepare refuses what the controller refuses before any call is built', () => {
  const base = { ...capability, controller: GOLDEN.controller, manager: MANAGER, minimumTier: 2, maxAmount: 5, enabled: true };
  const refused = (input, code) => assert.throws(() => prepareKeelTezosEntrypointCapability({ ...base, ...input }),
    (error) => error instanceof KeelTezosEntrypointCapabilityError && error.code === code
      && error.evmError === KEEL_TEZOS_ENTRYPOINT_CAPABILITY_ERRORS.configure[code]);
  for (const name of KEEL_TEZOS_PROTECTED_ENTRYPOINTS) refused({ entrypoint: name, parameterType: 'address' }, 'KEEL_CAPABILITY_PROTECTED');
  refused({ target: GOLDEN.controller }, 'KEEL_CONTROLLER_PROTECTED');
  refused({ target: MANAGER, entrypoint: 'unpause', parameterType: 'unit' }, 'KEEL_MANAGER_PROTECTED');
  refused({ target: MANAGER, entrypoint: 'configure_module' }, 'KEEL_MANAGER_PROTECTED');
  refused({ target: GOLDEN.signer }, 'KEEL_TARGET');
  refused({ entrypoint: '' }, 'KEEL_ENTRYPOINT');
  refused({ entrypoint: 'x'.repeat(32) }, 'KEEL_ENTRYPOINT');
  assert.throws(() => prepareKeelTezosEntrypointCapability({ ...base, minimumTier: 4 }), RangeError);
  // A protected name may still be switched off, as EVM lets governance disable any policy.
  assert.equal(prepareKeelTezosEntrypointCapability({ ...base, entrypoint: 'set_administrator', parameterType: 'address', enabled: false })
    .operation.parameters.entrypoint, 'configure_entrypoint_policy');
  assert.equal(prepareKeelTezosEntrypointCapability({ ...base, target: MANAGER, entrypoint: 'pause_systems' }).authorization, 'governance');
});

nodeTest('the policy call is a governance call the manager lambda can carry', () => {
  const prepared = prepareKeelTezosEntrypointCapability({ ...capability, controller: GOLDEN.controller, minimumTier: 2, maxAmount: 5, enabled: true });
  assert.equal(prepared.capabilityKey, GOLDEN.capabilityKey);
  assert.equal(prepared.parameterType, '0x0362');
  assert.equal(prepared.adapter, GOLDEN.adapter);
  assert.deepEqual(prepared.operation.parameters.value, prepared.governanceCall.value);
  assert.deepEqual(prepared.governanceCall.value, { prim: 'Pair', args: [{ string: GOLDEN.target }, { prim: 'Pair', args: [{ string: 'set_value' },
    { prim: 'Pair', args: [{ bytes: '0362' }, { prim: 'Pair', args: [{ int: '2' }, { prim: 'Pair', args: [{ int: '5' }, { prim: 'True' }] }] }] }] }] });
  const { lambda, value } = buildKeelTezosGovernanceLambda([prepared.governanceCall]);
  assert.equal(value, 0n);
  assert.ok(JSON.stringify(lambda).includes('%configure_entrypoint_policy'));
  assert.equal(prepared.signing, 'not-performed');
  assert.equal(prepared.submission, 'not-performed');
});

nodeTest('role and automation calls carry the key, packed arguments and exact amount', () => {
  const role = buildKeelTezosRoleEntrypointCall({ ...capability, controller: GOLDEN.controller, args: 42, amount: 2 });
  assert.equal(role.operation.amount, '2');
  assert.equal(role.operation.parameters.entrypoint, 'execute_role_entrypoint');
  assert.deepEqual(role.operation.parameters.value, { prim: 'Pair', args: [{ bytes: GOLDEN.capabilityKey.slice(2) },
    { prim: 'Pair', args: [{ bytes: GOLDEN.args.slice(2) }, { int: '2' }] }] });
  const automated = buildKeelTezosAutomationEntrypointCall({ controller: GOLDEN.controller, signer: GOLDEN.signer,
    capabilityKey: GOLDEN.capabilityKey, args: GOLDEN.args, amount: 2, deadline: 1200,
    signature: 'edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q' });
  assert.equal(automated.operation.amount, '2');
  assert.equal(automated.operation.parameters.entrypoint, 'execute_automation_entrypoint');
  assert.equal(automated.authorization, 'any-relayer');
  assert.throws(() => packKeelTezosEntrypointArgs({ ...capability, parameterType: { micheline: { prim: 'nat' } } }, 42), TypeError);
  assert.equal(packKeelTezosEntrypointArgs({ ...capability, parameterType: { micheline: { prim: 'nat' } } }, { micheline: { int: '42' } }), GOLDEN.args);
});

nodeTest('the capability map names entrypoint capabilities as adapter-different', () => {
  const row = resolveKeelChainCapability('authority.entrypoint-capabilities', 'tezos');
  assert.equal(row.supported, true);
  assert.equal(row.capability.status, 'adapter-different');
  assert.match(row.capability.tezos.behaviour, /configure_entrypoint_policy/u);
  assert.match(resolveKeelChainCapability('authority.execution-automation', 'tezos').capability.tezos.behaviour, /execute_automation_entrypoint/u);
});

siblingSource('the SDK reproduces the shared fixture golden vector and maps every Tezos refusal', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/entrypoint-capabilities.json', import.meta.url), 'utf8'));
  for (const key of Object.keys(GOLDEN)) assert.deepEqual(fixture.golden[key], GOLDEN[key], key);
  // TARGET_REJECTED is the target's own refusal, which reaches the caller unchanged on both chains.
  for (const step of fixture.steps.filter((entry) => entry.tezos && entry.tezos !== 'TARGET_REJECTED')) {
    const lane = step.op === 'policy' ? 'configure' : 'execute';
    assert.equal(KEEL_TEZOS_ENTRYPOINT_CAPABILITY_ERRORS[lane][step.tezos], step.evm, `${step.label}: ${step.tezos}`);
  }
});
