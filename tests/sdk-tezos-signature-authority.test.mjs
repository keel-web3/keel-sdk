import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_CONTRACT_SIGNATURE_DOMAIN,
  KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS,
  KEEL_TEZOS_SIGNATURE_AUTHORITY_ERRORS,
  buildKeelTezosGovernorEnvelope,
  buildKeelTezosRoleEntrypointCall,
  buildKeelTezosSignatureApprovalCall,
  buildKeelTezosSignatureValidation,
  keelTezosContractSignaturePayload,
  keelTezosEntrypointLambdas,
  keelTezosKeyHashOfPublicKey,
  keelTezosSignatureApprovalArgs,
  keelTezosSignatureApprovalCapability,
  prepareKeelTezosEntrypointCapability,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
// The golden vector of keel-contracts test/fixtures/parity/signature-authority.json, copied so the SDK test stands alone.
const GOLDEN = {
  manager: 'KT1TezoooozzSmartPyzzSTATiCzzzwwBFA1',
  network: 'NetXjD3HPJJjmcd',
  digest: `0x${'ab'.repeat(32)}`,
  deadline: 1800000000,
  epoch: 1,
  payload: '0x0507070a000000206b65656c2e74657a6f732e636f6e74726163742d7369676e61747572652e763107070a0000001601d1371b91fdbd07c8855659c84652230be0eaecd50007070a000000049caecab907070a00000020abababababababababababababababababababababababababababababababab07070080c8ceb40d0001',
};
const KEYS = [
  'edpkuBknW28nW72KG6RoHtYW7p12T6GKc7nAbwYX5m8Wd9sDVC9yav',
  'edpktzNbDAUjUk697W7gYg2CRuBQjyPxbEg8dLccYYwKSKvkPvjtV9',
  'edpkuTXkJDGcFd5nh6VvMz8phXxU3Bi7h6hqgywNFi1vZTfQNnS1RV',
];
const SIGNATURE = 'edsigtXomBKi5CTRf5cjATJWSyaRvhfYNHqSUGrn4SdbYRcGwQrUGjzEfQDTuqHhuA8b2d8NarZjz8TRf65WkpQmo423BtomS8Q';
const AUTHORITY = 'KT1Tezooo2zzSmartPyzzSTATiCzzzwqqQ4H';
const CONTROLLER = 'KT1Tezooo1zzSmartPyzzSTATiCzzzyfC8eF';
const D1 = `0x${'d1'.repeat(32)}`;
const ZERO = `0x${'00'.repeat(32)}`;

nodeTest('the contract-signature payload matches the SmartPy and Octez golden vector', () => {
  assert.equal(keelTezosContractSignaturePayload(GOLDEN), GOLDEN.payload);
  assert.ok(GOLDEN.payload.includes(Buffer.from(KEEL_TEZOS_CONTRACT_SIGNATURE_DOMAIN).toString('hex')));
  // Every field is bound: another manager, chain, digest, deadline or epoch changes the bytes.
  for (const change of [{ manager: AUTHORITY }, { network: 'NetXdQprcVkpaWU' }, { digest: D1 }, { deadline: 1800000001 }, { epoch: 2 }]) {
    assert.notEqual(keelTezosContractSignaturePayload({ ...GOLDEN, ...change }), GOLDEN.payload, JSON.stringify(change));
  }
  assert.throws(() => keelTezosContractSignaturePayload({ ...GOLDEN, manager: 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx' }), /KT1/u);
  assert.throws(() => keelTezosContractSignaturePayload({ ...GOLDEN, digest: '0x01' }), /32 bytes/u);
});

nodeTest('the governor envelope sorts signatures by key hash and refuses a repeated governor', () => {
  const signatures = [2, 0, 1].map((index) => ({ publicKey: KEYS[index], signature: SIGNATURE }));
  const envelope = buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures });
  assert.equal(envelope.args[0].int, '2000');
  assert.equal(envelope.args[1].args[0].int, '1');
  const order = envelope.args[1].args[1].map((item) => keelTezosKeyHashOfPublicKey(item.args[0].string));
  // tz1 hashes of one length sort as Base58 text sorts, which is their byte order.
  assert.deepEqual(order, KEYS.map((key) => keelTezosKeyHashOfPublicKey(key)).sort());
  assert.equal(new Set(order).size, 3);
  // Same order whatever order the caller supplied.
  const again = buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures: [...signatures].reverse() });
  assert.deepEqual(again, envelope);
  assert.throws(() => buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures: [signatures[0], signatures[0]] }), /once/u);
  assert.throws(() => buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures: [] }), /1\.\.32/u);
  assert.throws(() => buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures: [{ publicKey: KEYS[0], signature: '0x00' }] }), /signature/u);
});

nodeTest('the validation is the is_valid_signature view call, with or without an envelope', () => {
  const stored = buildKeelTezosSignatureValidation({ authority: AUTHORITY, digest: D1 });
  assert.deepEqual(stored, { contract: AUTHORITY, view: 'is_valid_signature', argument: { prim: 'Pair', args: [{ bytes: 'd1'.repeat(32) }, { prim: 'None' }] }, returns: 'bool' });
  const envelope = buildKeelTezosGovernorEnvelope({ deadline: 2000, epoch: 1, signatures: [{ publicKey: KEYS[0], signature: SIGNATURE }] });
  const signed = buildKeelTezosSignatureValidation({ authority: AUTHORITY, digest: D1, envelope });
  assert.deepEqual(signed.argument.args[1], { prim: 'Some', args: [envelope] });
});

nodeTest('approve and revoke keep EVM InvalidApproval bounds before any call is built', () => {
  const approve = buildKeelTezosSignatureApprovalCall({ kind: 'approve', authority: AUTHORITY, digest: D1, validUntil: 1000 + KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS, now: 1000 });
  assert.equal(approve.entrypoint, 'approve_signature');
  assert.deepEqual(approve.value, { prim: 'Pair', args: [{ bytes: 'd1'.repeat(32) }, { int: String(1000 + KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS) }] });
  assert.deepEqual(buildKeelTezosSignatureApprovalCall({ kind: 'revoke', authority: AUTHORITY, digest: D1 }).value, { bytes: 'd1'.repeat(32) });
  const refused = (input) => assert.throws(() => buildKeelTezosSignatureApprovalCall({ kind: 'approve', authority: AUTHORITY, digest: D1, now: 1000, ...input }), /InvalidApproval/u);
  refused({ digest: ZERO, validUntil: 2000 });
  refused({ validUntil: 1000 });
  refused({ validUntil: 1001 + KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS });
  assert.equal(KEEL_TEZOS_SIGNATURE_AUTHORITY_ERRORS.KEEL_APPROVAL_DURATION, 'InvalidApproval');
  assert.equal(KEEL_TEZOS_SIGNATURE_AUTHORITY_ERRORS.KEEL_MANAGER_ONLY, 'UnauthorizedSelfCall');
});

nodeTest('a delegated approval is an entrypoint capability on the authority, as EVM names approveSignature in a policy', () => {
  const capability = keelTezosSignatureApprovalCapability(AUTHORITY, 'approve');
  assert.deepEqual(capability.parameterType, { micheline: { prim: 'pair', args: [{ prim: 'bytes' }, { prim: 'timestamp' }] } });
  // The probe the controller writes carries the binary type the Octez replay configures: pair bytes timestamp.
  assert.ok(keelTezosEntrypointLambdas(capability).probe.includes('07650369036b'));
  assert.ok(keelTezosEntrypointLambdas(keelTezosSignatureApprovalCapability(AUTHORITY, 'revoke')).probe.includes('0369'));
  const policy = prepareKeelTezosEntrypointCapability({ ...capability, controller: CONTROLLER, minimumTier: 2, maxAmount: 0, enabled: true });
  assert.equal(policy.governanceCall.entrypoint, 'configure_entrypoint_policy');
  const args = keelTezosSignatureApprovalArgs({ kind: 'approve', authority: AUTHORITY, digest: D1, validUntil: 4600, now: 1000 });
  const role = buildKeelTezosRoleEntrypointCall({ ...capability, controller: CONTROLLER, args, amount: 0 });
  assert.equal(role.operation.parameters.entrypoint, 'execute_role_entrypoint');
  assert.equal(role.capabilityKey, policy.capabilityKey);
  assert.throws(() => keelTezosSignatureApprovalArgs({ kind: 'approve', authority: AUTHORITY, digest: ZERO, validUntil: 4600, now: 1000 }), /InvalidApproval/u);
  assert.throws(() => keelTezosSignatureApprovalCapability(AUTHORITY, 'pause'), /approve/u);
});

nodeTest('the capability map names the Tezos envelope path and its differences', () => {
  const row = resolveKeelChainCapability('authority.contract-signatures', 'tezos');
  assert.equal(row.supported, true);
  assert.equal(row.capability.status, 'adapter-different');
  assert.match(row.capability.tezos.behaviour, /is_valid_signature/u);
  assert.match(row.capability.evm.behaviour, /isValidSignature/u);
});

siblingSource('the SDK reproduces the shared fixture golden vector and maps every Tezos refusal', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/signature-authority.json', import.meta.url), 'utf8'));
  const golden = fixture.golden;
  assert.equal(keelTezosContractSignaturePayload(golden), golden.payload);
  assert.deepEqual({ ...GOLDEN }, { manager: golden.manager, network: golden.network, digest: golden.digest, deadline: golden.deadline, epoch: golden.epoch, payload: golden.payload });
  for (const step of fixture.steps.filter((item) => item.tezos)) {
    assert.equal(KEEL_TEZOS_SIGNATURE_AUTHORITY_ERRORS[step.tezos], step.evm, step.label);
  }
});
