import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toRlp } from 'viem';
import { GETH_IMAGE, REQUIRED_CASES, sha256, revive, encodeCapturedHeader, normalizeAssemblyCapture, verifyHeaderCommitment, verifyTrieProof, verifyWitness, witnessMissingReads, validateManifest, validateCase, validateNativeBudget, validateWire, loadBoundFile, summarizeSimulation } from '../scripts/lib/captured-publication-fixture.mjs';

const owner = `0x${'11'.repeat(20)}`, target = `0x${'22'.repeat(20)}`;
const hash = `0x${'ab'.repeat(32)}`, emptyTrie = keccak256('0x80');
const leaf = (key, value) => toRlp([`0x20${key.slice(2)}`, value]);
function provedAccount({ code = '0x600000', value = '0x2a' } = {}) {
  const slot = `0x${'00'.repeat(31)}01`;
  const storageNode = leaf(keccak256(slot), toRlp(value));
  const storageHash = keccak256(storageNode), codeHash = keccak256(code);
  const node = leaf(keccak256(owner), toRlp(['0x', '0x01', storageHash, codeHash]));
  return { header: { stateRoot: keccak256(node) }, witness: { accounts: [{ address: owner, code, codeHash, balance: '0x1', nonce: '0x0', storageHash,
    accountProof: [node], storageProof: [{ key: slot, value, proof: [storageNode] }] }] }, slot };
}
function capturedRetro() {
  const call = { from: owner, to: target, data: '0x12345678', value: '0x0', gas: '0x2625a00' };
  const header = { number: '0x2a', hash, stateRoot: hash, timestamp: '0x6acc0140', gasLimit: '0xbebc200', baseFeePerGas: '0x1', miner: owner, mixHash: hash };
  const headerRlp = toRlp([hash, hash, owner, hash, hash, hash, '0x', '0x', '0x2a', '0x0bebc200', '0x', '0x6acc0140', '0x', hash, '0x0000000000000000', '0x01']);
  header.hash = keccak256(headerRlp);
  return { schema: 'keel-original-publication-capture@1', completeOriginalProgram: true, identity: REQUIRED_CASES['retro-45'],
    header, headerRlp,
    wireRequest: { method: 'eth_simulateV1', params: [{ blockStateCalls: Array.from({ length: 45 }, () => ({ calls: [{ ...call }] })), validation: false, traceTransfers: false, returnFullTransactions: true }, '0x2a'] },
    exactSimulationInput: { chainId: 11155111, blockNumber: 42n, preparationCalls: Array.from({ length: 45 }, () => ({ ...call })),
      expectedTokenURI: 'data:application/json,{"name":"binding-test-only"}', reader: target, readerRuntimeCodeHash: hash, metadataCall: { ...call } } };
}

test('all three actual incident identities are mandatory; a prefix or duplicate cannot replace another case', () => {
  const manifest = { schema: 'keel-native-original-program-gate@1', gethImage: GETH_IMAGE,
    cases: Object.keys(REQUIRED_CASES).map(id => ({ id, capture: {}, expectedURI: {}, snapshot: { mode: 'proof-reconstruction' }, rpcGasCap: 50_000_000 })) };
  assert.equal(validateManifest(manifest), manifest);
  for (const cases of [manifest.cases.slice(1), [...manifest.cases, manifest.cases[0]], [manifest.cases[0], manifest.cases[0], manifest.cases[2]]])
    assert.throws(() => validateManifest({ ...manifest, cases }), /mandatory/);
  assert.throws(() => validateManifest({ ...manifest, gethImage: 'unreviewed' }), /client/);
});

test('canonical RLP hash binds state root and execution header fields together', () => {
  const capture = capturedRetro();
  assert.doesNotThrow(() => verifyHeaderCommitment(capture.header, capture.headerRlp));
  assert.throws(() => verifyHeaderCommitment({ ...capture.header, stateRoot: `0x${'cd'.repeat(32)}` }, capture.headerRlp), /state root/);
  assert.throws(() => verifyHeaderCommitment({ ...capture.header, timestamp: '0x1' }, capture.headerRlp), /timestamp/);
  assert.throws(() => verifyHeaderCommitment(capture.header, capture.headerRlp.slice(0, -2) + '02'), /hash/);
});

test('original 45-call identity, numbered pin, payload and complete output are independently bound', () => {
  const capture = capturedRetro();
  assert.equal(validateCase('retro-45', capture, capture.exactSimulationInput.expectedTokenURI).calls.length, 45);
  const mutations = [
    value => value.wireRequest.params[0].blockStateCalls.splice(9),
    value => value.identity = { ...value.identity, releaseRevision: 4 },
    value => value.wireRequest.params[1] = 'latest',
    value => value.wireRequest.params[0].blockStateCalls[8].calls[0].data = '0xdead',
    value => value.completeOriginalProgram = false,
    value => value.exactSimulationInput.expectedTokenURI += 'truncated-substitute',
  ];
  for (const mutate of mutations) { const modified = structuredClone(capture); mutate(modified); assert.throws(() => validateCase('retro-45', modified, capture.exactSimulationInput.expectedTokenURI)); }
});

test('state overrides, block overrides and signing fields fail before a native request', () => {
  const capture = capturedRetro();
  for (const key of ['stateOverrides', 'blockOverrides']) {
    const request = structuredClone(capture.wireRequest); request.params[0].blockStateCalls[0][key] = {};
    assert.throws(() => validateWire(request, 45, '0x2a'));
  }
  const request = structuredClone(capture.wireRequest); request.params[0].blockStateCalls[0].calls[0].privateKey = 'forbidden';
  assert.throws(() => validateWire(request, 45, '0x2a'), /Unexpected/);
});

test('the preserved nine-call diagnostic can never qualify as the original owned fourteen-call program', () => {
  const request = capturedRetro().wireRequest;
  request.params[0].blockStateCalls = request.params[0].blockStateCalls.slice(0, 9);
  assert.throws(() => validateWire(request, REQUIRED_CASES['owned-14'].calls, '0x2a'), /Incomplete original program/);
});

test('proof-backed runtime, account nonce/balance and storage reject single-byte alterations', () => {
  const { header, witness, slot } = provedAccount();
  const result = verifyWitness(header, witness);
  assert.equal(result.alloc[owner.slice(2)].storage[slot], `0x${'0'.repeat(62)}2a`);
  for (const mutate of [
    w => w.accounts[0].code = '0x600100',
    w => w.accounts[0].nonce = '0x1',
    w => w.accounts[0].balance = '0x2',
    w => w.accounts[0].storageProof[0].value = '0x2b',
    w => w.accounts[0].accountProof = [],
    w => w.accounts[0].storageProof[0].proof = [],
  ]) { const modified = structuredClone(witness); mutate(modified); assert.throws(() => verifyWitness(header, modified)); }
  assert.throws(() => verifyWitness({ stateRoot: hash }, witness), /Missing/);
});

test('proved absence is distinct from an unproved zero default', () => {
  const account = { address: owner, code: '0x', codeHash: keccak256('0x'), storageHash: emptyTrie, balance: '0x0', nonce: '0x0', accountProof: [], storageProof: [] };
  const proved = verifyWitness({ stateRoot: emptyTrie }, { accounts: [account] });
  assert.deepEqual(witnessMissingReads({ [owner]: { balance: '0x0', storage: {} } }, proved.inventory), []);
  assert.equal(witnessMissingReads({ [target]: { storage: {} } }, proved.inventory)[0].reason, 'unproven-account');
  assert.equal(witnessMissingReads({ [owner]: { storage: { '0x01': `0x${'00'.repeat(32)}` } } }, proved.inventory)[0].reason, 'unproven-storage');
});

test('secure trie verification supports branch absence and embedded terminal nodes', () => {
  const key = `0x${'1'.repeat(63)}2`;
  const branch = Array.from({ length: 17 }, () => '0x');
  branch[2] = ['0x20', '0x05']; branch[3] = ['0x20', '0x06'];
  const rootNode = toRlp([`0x1${'1'.repeat(63)}`, branch]);
  const root = keccak256(rootNode);
  assert.equal(verifyTrieProof(root, key, [rootNode]), '0x05');
  assert.equal(verifyTrieProof(root, `${key.slice(0, -1)}4`, [rootNode]), null);
  assert.throws(() => verifyTrieProof(hash, key, [rootNode]), /Missing/);
});

test('private file binding rejects changed size, hash, traversal and symlink reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'keel-fixture-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'capture.json'), '{}');
  const ref = { path: 'capture.json', bytes: 2, sha256: sha256('{}') };
  assert.equal((await loadBoundFile(root, ref)).toString(), '{}');
  await assert.rejects(loadBoundFile(root, { ...ref, bytes: 3 }), /count/);
  await assert.rejects(loadBoundFile(root, { ...ref, sha256: '0'.repeat(64) }), /SHA256/);
  await assert.rejects(loadBoundFile(root, { ...ref, path: '../outside' }), /within/);
  await symlink(join(root, 'capture.json'), join(root, 'link.json'));
  await assert.rejects(loadBoundFile(root, { ...ref, path: 'link.json' }), /symlink/);
});

test('raw returned gas and pre-refund metrics stay distinct, including empty revert output', () => {
  const request = capturedRetro().wireRequest;
  const response = { result: Array.from({ length: 45 }, () => ({ transactions: [{ gas: '0x2572dd6' }], calls: [{ status: '0x0', gasUsed: '0xf8171f', maxUsedGas: '0xf8171f', error: { code: 3, message: 'execution reverted', data: '0x' }, returnData: '0x' }] })) };
  const result = summarizeSimulation(request, response);
  assert.equal(result.calls[8].requestedGas, '0x2625a00'); assert.equal(result.calls[8].returnedGas, '0x2572dd6');
  assert.deepEqual(result.calls[8].rawError, response.result[8].calls[0].error);
  assert.equal(result.calls[8].returnData, '0x');
  assert.deepEqual(summarizeSimulation(request, { error: { code: -32601, message: 'unsupported' } }), { rpcError: { code: -32601, message: 'unsupported' }, calls: [] });
});

test('capture bigint revival requires the exact one-key diagnostic representation', () => {
  assert.equal(JSON.parse('{"$keelDiagnosticBigInt":"42"}', revive), 42n);
  assert.deepEqual(JSON.parse('{"$keelDiagnosticBigInt":"42","x":1}', revive), { $keelDiagnosticBigInt: '42', x: 1 });
});

function sourceAssemblyCapture() {
  const capture = capturedRetro();
  const header = { ...capture.header, parentHash: hash, sha3Uncles: hash, transactionsRoot: hash, receiptsRoot: hash,
    logsBloom: `0x${'00'.repeat(256)}`, difficulty: '0x0', gasUsed: '0x0', extraData: '0x', nonce: '0x0000000000000000',
    withdrawalsRoot: hash, blobGasUsed: '0x0', excessBlobGas: '0x0', parentBeaconBlockRoot: hash, requestsHash: hash,
    blockAccessListHash: `0x${'cd'.repeat(32)}`, slotNumber: '0x7' };
  const fields = [hash, hash, owner, hash, hash, hash, header.logsBloom, '0x', '0x2a', '0x0bebc200', '0x', '0x6acc0140', '0x', hash, header.nonce,
    '0x01', hash, '0x', '0x', hash, hash, header.blockAccessListHash, '0x07'];
  header.hash = keccak256(toRlp(fields));
  const input = { ...capture.exactSimulationInput, observationCalls: [{ ...capture.exactSimulationInput.metadataCall }] };
  const rawInput = JSON.parse(JSON.stringify(input, (_, item) => typeof item === 'bigint' ? { $keelDiagnosticBigInt: item.toString() } : item));
  return { schema: 'keel-private-full-plan-diagnostic@1', status: 'exact-input-captured-no-simulation', assemblyOnly: true,
    databaseReadOnlyVerified: true, approval: false, signing: 'not-performed', submission: 'not-performed', expectedCaptureHalt: true,
    scope: { ...capture.identity, blockNumber: header.number, blockHash: header.hash }, canonicalBefore: header, canonicalAfterAssembly: structuredClone(header),
    exactSimulationInput: rawInput, completeInputSHA256: sha256(JSON.stringify(rawInput)), preparationCallCount: 45, completeUnallocatedCallCount: 47,
    completeExpectedTokenURI: input.expectedTokenURI, completeTokenURIBytes: Buffer.byteLength(input.expectedTokenURI),
    completeTokenURIKeccak256: keccak256(`0x${Buffer.from(input.expectedTokenURI).toString('hex')}`) };
}

test('current source-only capture binds 45 preparation plus observation and complete metadata without inventing historical wire', () => {
  const raw = sourceAssemblyCapture();
  const normalized = normalizeAssemblyCapture(raw);
  assert.equal(normalized.completeUnallocatedCallCount, 47);
  assert.equal(normalized.wireRequest, null);
  assert.equal(normalized.historicalWireAvailable, false);
  assert.equal(normalized.simulationPerformedByCapture, false);
  assert.equal(validateCase('retro-45', normalized, raw.completeExpectedTokenURI).calls.length, 45);
  const mutations = [value => value.completeUnallocatedCallCount = 45, value => value.exactSimulationInput.preparationCalls[0].data = '0xdead',
    value => value.canonicalAfterAssembly.timestamp = '0x1', value => value.approval = true, value => value.completeTokenURIBytes--];
  for (const mutate of mutations) { const changed = structuredClone(raw); mutate(changed); assert.throws(() => normalizeAssemblyCapture(changed)); }
});

test('Amsterdam canonical header binds block access-list hash before slot number and rejects missing optional fields', () => {
  const raw = sourceAssemblyCapture();
  assert.doesNotThrow(() => encodeCapturedHeader(raw.canonicalBefore));
  const altered = { ...raw.canonicalBefore, slotNumber: '0x8' };
  assert.throws(() => encodeCapturedHeader(altered), /hash mismatch/);
  const missing = { ...raw.canonicalBefore }; delete missing.requestsHash;
  assert.throws(() => encodeCapturedHeader(missing), /optional field gap/);
});


test('full-program local budget can exceed two billion without changing captured per-call gas, and remains bounded by canonical blocks', () => {
  const normalized = normalizeAssemblyCapture(sourceAssemblyCapture());
  const before = structuredClone(normalized.exactSimulationInput.preparationCalls);
  const budget = validateNativeBudget(normalized.exactSimulationInput, normalized.header, 3_000_000_000);
  assert.equal(budget.completeCallCount, 47);
  assert.equal(budget.maximumLocalProgramBudget, '9400000000');
  assert.deepEqual(normalized.exactSimulationInput.preparationCalls, before);
  assert.throws(() => validateNativeBudget(normalized.exactSimulationInput, normalized.header, 9_400_000_001), /exceeds/);
  for (const value of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateNativeBudget(normalized.exactSimulationInput, normalized.header, value), /safe positive/);
});
