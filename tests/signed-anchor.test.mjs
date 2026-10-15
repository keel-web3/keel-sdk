import test from 'node:test';
import assert from 'node:assert/strict';
import {hashTypedData, keccak256, sha256, stringToHex, decodeFunctionData} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {
  buildSignedAnchorTypedData, signedAnchorRequestDigest, prepareSignedAnchorAttestation,
  encodeSignedAnchorSubmission, signedAnchorAdapterAbi,
} from '../packages/sdk/dist/signed-anchor.js';

const h = n => `0x${n.toString(16).padStart(64, '0')}`;
const a = n => `0x${n.toString(16).padStart(40, '0')}`;
const adapter = a(1), registry = a(2), signer = a(3), policy = h(4), anchorId = h(5);
const decodedBytes = stringToHex('observed source content');
const evidence = stringToHex('test source identity and finalized-block observation');

function fixture(overrides = {}) {
  const anchor = {
    status: 1, nonce: 1n, objectId: h(6), artifactRevision: 1n,
    source: {family: 2, network: 0x7a06a770, registry: h(7), objectKey: h(8), revision: 1n, eventDigest: h(9)},
    contentRoot: sha256(decodedBytes), verifierId: h(10), verifierAdapter: adapter,
    contributor: a(11), taskCount: 1, contentByteLength: BigInt((decodedBytes.length - 2) / 2),
    ...overrides.anchor,
  };
  const task = {status: 1, digestKind: 0, expectedDigest: anchor.contentRoot, locator: 'tezos://source/exact/revision', ...overrides.task};
  const calls = [];
  const reader = {
    async getChainId() { return overrides.chain ?? 1; },
    async getBlock() { return {number: 50n, timestamp: 1000n}; },
    async readContract(request) {
      calls.push(request);
      const values = {
        anchorRegistry: registry, signer, policyDigest: policy, validUntil: 3000n, retired: false,
        requestDigest: signedAnchorRequestDigest(registry, policy, anchor, task),
        anchorState: anchor, anchorTask: task,
        anchorVerifier: {retired: false, trustClass: 3, specDigest: policy},
        chainFamily: {retired: false}, ...overrides.reads,
      };
      if (request.functionName === 'attestationDigest') return hashTypedData(buildSignedAnchorTypedData({chainId: 1, adapter, attestation: request.args[0]}));
      assert.ok(request.functionName in values, request.functionName);
      return values[request.functionName];
    },
  };
  let observations = 0;
  return {
    calls, anchor, task, observations: () => observations,
    options: {publicClient: reader, expectedChainId: 1, adapter, expectedSigner: signer,
      expectedPolicyDigest: policy, anchorId, deadline: 2000n,
      async observeSource(request) {
        observations++;
        assert.deepEqual(request, {anchor, task, policyDigest: policy, blockNumber: 50n});
        return overrides.observed ?? {decodedBytes, evidence};
      },
    },
  };
}

test('source observation produces an exact offline approval at one destination block', async () => {
  const f = fixture();
  const prepared = await prepareSignedAnchorAttestation(f.options);
  assert.equal(prepared.attestation.evidenceDigest, keccak256(evidence));
  assert.equal(prepared.digest, hashTypedData(prepared.typedData));
  assert.equal(prepared.evidence, evidence);
  assert.equal(f.observations(), 1);
  assert.ok(f.calls.every(call => call.blockNumber === 50n));
  // Public synthetic test key only; no account configuration or network signing.
  const account = privateKeyToAccount(h(123));
  const signature = await account.signTypedData(prepared.typedData);
  const decoded = decodeFunctionData({abi: signedAnchorAdapterAbi, data: encodeSignedAnchorSubmission(prepared.attestation, signature)});
  assert.equal(decoded.functionName, 'submitAttestation');
  assert.deepEqual(decoded.args, [prepared.attestation, signature]);
});

test('wrong destination or policy fails before invoking the source observer', async () => {
  for (const overrides of [{chain: 2}, {reads: {signer: a(99)}}, {reads: {policyDigest: h(99)}}, {reads: {retired: true}}]) {
    const f = fixture(overrides);
    await assert.rejects(prepareSignedAnchorAttestation(f.options));
    assert.equal(f.observations(), 0);
  }
});

test('expired and overlong approvals are refused before observation', async () => {
  for (const deadline of [999n, 3001n]) {
    const f = fixture();
    await assert.rejects(prepareSignedAnchorAttestation({...f.options, deadline}), /window/);
    assert.equal(f.observations(), 0);
  }
});

test('pending whole-content attestation scope and local bindings are enforced', async () => {
  for (const overrides of [
    {anchor: {status: 2}}, {task: {status: 2}}, {anchor: {verifierAdapter: a(99)}},
    {anchor: {taskCount: 2}}, {task: {digestKind: 1}}, {task: {expectedDigest: h(99)}},
    {reads: {requestDigest: h(99)}}, {reads: {anchorVerifier: {retired: false, trustClass: 4, specDigest: policy}}},
    {reads: {anchorVerifier: {retired: true, trustClass: 3, specDigest: policy}}}, {reads: {chainFamily: {retired: true}}},
  ]) {
    const f = fixture(overrides);
    await assert.rejects(prepareSignedAnchorAttestation(f.options));
    assert.equal(f.observations(), 0);
  }
});

test('source content must have both the committed digest and exact length', async () => {
  for (const observed of [{decodedBytes: stringToHex('different content'), evidence}, {decodedBytes: `${decodedBytes}00`, evidence},
    {decodedBytes: '0x', evidence}, {decodedBytes, evidence: '0x'}, {decodedBytes: '0xzz', evidence}]) {
    const f = fixture({observed});
    await assert.rejects(prepareSignedAnchorAttestation(f.options));
  }
});

test('source observation errors cannot produce an approval', async () => {
  const f = fixture();
  await assert.rejects(prepareSignedAnchorAttestation({...f.options, observeSource: async () => {throw new Error('Source not final');}}), /not final/);
});

test('source coordinates and locator affect the request digest', () => {
  const f = fixture();
  const baseline = signedAnchorRequestDigest(registry, policy, f.anchor, f.task);
  for (const source of [{...f.anchor.source, eventDigest: h(99)}, {...f.anchor.source, network: 1}, {...f.anchor.source, revision: 2n}]) {
    assert.notEqual(signedAnchorRequestDigest(registry, policy, {...f.anchor, source}, f.task), baseline);
  }
  assert.notEqual(signedAnchorRequestDigest(registry, policy, f.anchor, {...f.task, locator: 'tezos://another-source'}), baseline);
});

test('typed signing binds chain, adapter, nonce and evidence', () => {
  const attestation = {nonce: 1n, deadline: 2000n, anchorId, requestDigest: h(12), evidenceDigest: h(13)};
  const options = {chainId: 1, adapter, attestation};
  const baseline = hashTypedData(buildSignedAnchorTypedData(options));
  for (const changed of [{...options, chainId: 2}, {...options, adapter: a(99)},
    {...options, attestation: {...attestation, nonce: 2n}}, {...options, attestation: {...attestation, evidenceDigest: h(99)}}]) {
    assert.notEqual(hashTypedData(buildSignedAnchorTypedData(changed)), baseline);
  }
  for (const nonce of [0n, -1n, 1n << 64n]) assert.throws(() => buildSignedAnchorTypedData({...options, attestation: {...attestation, nonce}}));
  assert.throws(() => buildSignedAnchorTypedData({...options, attestation: {...attestation, evidenceDigest: h(0)}}));
});

test('typed approval matches the Solidity adapter golden vector', () => {
  const attestation = {nonce: 1n, deadline: 2000n, anchorId: h(5), requestDigest: h(12), evidenceDigest: h(13)};
  assert.equal(hashTypedData(buildSignedAnchorTypedData({chainId: 1, adapter: a(0x1234), attestation})),
    '0x0f64850c83269405c95f659edd27edd36a32b11bd12f0f717ea905b430f3c3c2');
});
