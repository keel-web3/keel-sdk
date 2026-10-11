import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fromRlp, toRlp, keccak256, decodeFunctionData, decodeAbiParameters, parseAbi } from 'viem';

export const GETH_IMAGE = 'ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd';
export const REQUIRED_CASES = Object.freeze({
  'retro-45': { artifactId: '83a98652-7160-4c6c-a9bd-c81cfb672fa5', releaseId: '5441d924-7b50-4376-94e0-a0b1023fff7a', releaseRevision: 7, calls: 45 },
  'owned-14': { artifactId: 'c1a66a2a-c5a5-4ef0-b8ff-174b329ce5e4', releaseId: '9e000310-5823-43a1-ba5f-5690841154cd', releaseRevision: 3, calls: 14 },
  'paid-6-atomic': { artifactId: '150485a1-78b5-425f-a0b7-093d4409fed5', releaseId: 'dcd04c0e-a875-4b62-93c5-b7c325a0d789', releaseRevision: 34, calls: 1 },
});
const emptyTrie = keccak256('0x80');
const emptyCode = keccak256('0x');
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const stable = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? { $keelDiagnosticBigInt: item.toString() } : item && !Array.isArray(item) && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const revive = (_, value) => value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$keelDiagnosticBigInt === 'string' && /^(0|[1-9][0-9]*)$/.test(value.$keelDiagnosticBigInt) ? BigInt(value.$keelDiagnosticBigInt) : value;
const bytes = value => typeof value === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const digest = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
const lower = value => value.toLowerCase();

/** Order from pinned Geth core/types/block.go; Amsterdam adds BAL hash, then
 * slot number. The resulting hash must match the captured header, not a guess. */
export function encodeCapturedHeader(header) {
  const scalar = value => {
    assert.ok(quantity(value), 'Canonical header scalar missing');
    const hex = BigInt(value).toString(16);
    return hex === '0' ? '0x' : `0x${hex.padStart(Math.ceil(hex.length / 2) * 2, '0')}`;
  };
  const fields = [header.parentHash, header.sha3Uncles, header.miner, header.stateRoot, header.transactionsRoot, header.receiptsRoot,
    header.logsBloom, scalar(header.difficulty), scalar(header.number), scalar(header.gasLimit), scalar(header.gasUsed), scalar(header.timestamp), header.extraData, header.mixHash, header.nonce];
  const optional = [['baseFeePerGas', true], ['withdrawalsRoot'], ['blobGasUsed', true], ['excessBlobGas', true], ['parentBeaconBlockRoot'], ['requestsHash'], ['blockAccessListHash'], ['slotNumber', true]];
  let ended = false;
  for (const [key, numeric] of optional) {
    if (header[key] === undefined || header[key] === null) { ended = true; continue; }
    assert.ok(!ended, 'Canonical header optional field gap');
    fields.push(numeric ? scalar(header[key]) : header[key]);
  }
  assert.ok(fields.every(bytes), 'Incomplete canonical header bytes');
  const encoded = toRlp(fields);
  verifyHeaderCommitment(header, encoded);
  return encoded;
}

/** The capture-only deployed Studio helper emits source input, not allocated
 * historical wire. Preserve that evidence boundary while validating its real
 * shape and bigint representation. Never synthesize a captured RPC request. */
export function normalizeAssemblyCapture(raw) {
  assert.equal(raw.schema, 'keel-private-full-plan-diagnostic@1');
  assert.equal(raw.status, 'exact-input-captured-no-simulation');
  assert.equal(raw.assemblyOnly, true); assert.equal(raw.databaseReadOnlyVerified, true);
  assert.equal(raw.approval, false); assert.equal(raw.signing, 'not-performed'); assert.equal(raw.submission, 'not-performed');
  assert.equal(raw.expectedCaptureHalt, true);
  assert.equal(sha256(JSON.stringify(raw.exactSimulationInput)), raw.completeInputSHA256, 'Exact source input digest mismatch');
  assert.equal(stable(raw.canonicalBefore), stable(raw.canonicalAfterAssembly), 'Canonical assembly snapshot changed');
  assert.equal(raw.scope.blockHash, raw.canonicalBefore.hash);
  assert.equal(BigInt(raw.scope.blockNumber), BigInt(raw.canonicalBefore.number));
  const input = JSON.parse(JSON.stringify(raw.exactSimulationInput), revive);
  assert.equal(input.preparationCalls.length, raw.preparationCallCount);
  const completeCount = input.preparationCalls.length + (input.requiredReaderCalls?.length ?? 0) + (input.observationCalls?.length ?? 0) + 1;
  assert.equal(raw.completeUnallocatedCallCount, completeCount, 'Complete unallocated reader/observation count mismatch');
  assert.equal(input.expectedTokenURI, raw.completeExpectedTokenURI);
  assert.equal(Buffer.byteLength(input.expectedTokenURI), raw.completeTokenURIBytes);
  assert.equal(keccak256(`0x${Buffer.from(input.expectedTokenURI).toString('hex')}`), raw.completeTokenURIKeccak256);
  return { schema: 'keel-original-publication-capture@1', completeOriginalProgram: true,
    captureKind: 'source-assembled-unallocated-input', identity: raw.scope, source: raw.source,
    header: raw.canonicalBefore, headerRlp: encodeCapturedHeader(raw.canonicalBefore), wireRequest: null,
    exactSimulationInput: input, completeUnallocatedCallCount: completeCount,
    completeInputSHA256: raw.completeInputSHA256, sourceCaptureDiagnosticId: raw.diagnosticId,
    historicalWireAvailable: false, simulationPerformedByCapture: false };
}

export function verifyHeaderCommitment(header, headerRlp) {
  assert.ok(bytes(headerRlp) && digest(header.hash), 'Canonical RLP header commitment required');
  assert.equal(keccak256(headerRlp), lower(header.hash), 'Canonical header hash mismatch');
  const fields = fromRlp(headerRlp, 'hex');
  assert.ok(Array.isArray(fields) && fields.length >= 16 && fields.length <= 32, 'Unsupported canonical header layout');
  assert.equal(lower(fields[3]), lower(header.stateRoot), 'Header state root mismatch');
  for (const [name, index] of [['number', 8], ['gasLimit', 9], ['timestamp', 11], ['baseFeePerGas', 15]])
    assert.equal(BigInt(fields[index] === '0x' ? '0x0' : fields[index]), BigInt(header[name]), `Header ${name} mismatch`);
  assert.equal(lower(fields[2]), lower(header.miner ?? header.coinbase), 'Header beneficiary mismatch');
  assert.equal(lower(fields[13]), lower(header.mixHash), 'Header randomness mismatch');
}

export async function confinedPath(root, path) {
  assert.equal(typeof path, 'string', 'Private fixture path is required');
  assert.ok(path && !isAbsolute(path) && !path.split(/[\\/]/).includes('..'), 'Fixture path must stay within its private directory');
  const base = await realpath(root), candidate = resolve(base, path);
  assert.ok(!relative(base, candidate).startsWith('..'), 'Fixture path escaped');
  // Reject links rather than following them to a file that might contain secrets.
  let cursor = base;
  for (const part of relative(base, candidate).split('/')) {
    cursor = resolve(cursor, part);
    assert.ok(!(await lstat(cursor)).isSymbolicLink(), 'Fixture symlink is forbidden');
  }
  return candidate;
}

export async function loadBoundFile(root, ref, maximumBytes = 32 * 1024 * 1024) {
  assert.ok(ref && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= maximumBytes, 'Invalid fixture byte bound');
  assert.match(ref.sha256 ?? '', /^[0-9a-f]{64}$/, 'Fixture SHA256 required');
  const file = await confinedPath(root, ref.path), info = await lstat(file);
  assert.ok(info.isFile(), 'Fixture must be a regular file');
  assert.equal(info.size, ref.bytes, 'Fixture byte count mismatch');
  const content = await readFile(file);
  assert.equal(sha256(content), ref.sha256, 'Fixture SHA256 mismatch');
  return content;
}

/** Verify a secure-trie key against an EIP-1186 proof, including proved absence.
 * Keys passed here are already hashed. Embedded nodes stay embedded; no network.
 */
export function verifyTrieProof(root, key, proof) {
  assert.ok(digest(root) && digest(key) && Array.isArray(proof) && proof.length <= 128, 'Invalid trie proof');
  assert.ok(proof.every(bytes), 'Invalid proof node');
  if (lower(root) === emptyTrie && proof.length === 0) return null;
  const nodes = new Map(proof.map(node => [keccak256(node), lower(node)]));
  const nibbles = key.slice(2).toLowerCase().split('').map(x => Number.parseInt(x, 16));
  let reference = lower(root), depth = 0;
  for (let count = 0; count < 128; count++) {
    if (reference === '0x') return null;
    const encoded = reference.length === 66 ? nodes.get(reference) : reference;
    assert.ok(encoded, 'Missing authenticated trie node');
    if (reference.length === 66) assert.equal(keccak256(encoded), reference, 'Trie node hash mismatch');
    const node = fromRlp(encoded, 'hex');
    assert.ok(Array.isArray(node), 'Trie node is not a list');
    const ref = child => Array.isArray(child) ? toRlp(child) : child;
    if (node.length === 17) {
      if (depth === nibbles.length) return node[16] === '0x' ? null : node[16];
      reference = ref(node[nibbles[depth++]]);
      assert.ok(bytes(reference), 'Invalid branch reference');
      continue;
    }
    assert.equal(node.length, 2, 'Invalid trie node arity');
    assert.ok(bytes(node[0]) && node[0].length >= 4, 'Invalid compact trie path');
    const compact = node[0].slice(2).split('').map(x => Number.parseInt(x, 16));
    const flag = compact[0];
    assert.ok(flag <= 3 && ((flag & 1) || compact[1] === 0), 'Invalid compact trie flag');
    const path = compact.slice(flag & 1 ? 1 : 2);
    if (path.some((item, index) => nibbles[depth + index] !== item)) return null;
    depth += path.length;
    if (flag & 2) return depth === nibbles.length ? node[1] : null;
    assert.ok(path.length > 0, 'Empty extension path');
    reference = ref(node[1]);
  }
  throw new Error('Trie proof exceeds traversal bound');
}

export function verifyWitness(header, witness) {
  assert.ok(digest(header.stateRoot), 'Canonical state root required');
  assert.ok(Array.isArray(witness.accounts) && witness.accounts.length > 0, 'Proof-backed accounts required');
  const alloc = {}, inventory = new Map();
  for (const account of witness.accounts) {
    assert.ok(address(account.address), 'Invalid witness account');
    const key = lower(account.address);
    assert.ok(!inventory.has(key), 'Duplicate witness account');
    assert.ok(bytes(account.code) && digest(account.codeHash) && digest(account.storageHash), 'Runtime commitments required');
    assert.ok(quantity(account.balance) && quantity(account.nonce), 'Balance and nonce required');
    assert.equal(keccak256(account.code), lower(account.codeHash), 'Runtime hash mismatch');
    const encoded = verifyTrieProof(header.stateRoot, keccak256(account.address), account.accountProof);
    if (encoded === null) {
      assert.equal(BigInt(account.nonce), 0n); assert.equal(BigInt(account.balance), 0n);
      assert.equal(lower(account.codeHash), emptyCode); assert.equal(lower(account.storageHash), emptyTrie);
    } else {
      const state = fromRlp(encoded, 'hex');
      assert.ok(Array.isArray(state) && state.length === 4, 'Invalid proved account');
      assert.equal(BigInt(state[0] === '0x' ? '0x0' : state[0]), BigInt(account.nonce));
      assert.equal(BigInt(state[1] === '0x' ? '0x0' : state[1]), BigInt(account.balance));
      assert.equal(lower(state[2]), lower(account.storageHash)); assert.equal(lower(state[3]), lower(account.codeHash));
    }
    const storage = {}, slots = new Set();
    assert.ok(Array.isArray(account.storageProof), 'Explicit storage proof list required');
    for (const slot of account.storageProof) {
      assert.ok(digest(slot.key) && quantity(slot.value), 'Storage key/value required');
      const slotKey = lower(slot.key); assert.ok(!slots.has(slotKey), 'Duplicate storage slot'); slots.add(slotKey);
      const value = verifyTrieProof(account.storageHash, keccak256(slotKey), slot.proof);
      const decoded = value === null ? '0x' : fromRlp(value, 'hex');
      assert.equal(typeof decoded, 'string', 'Invalid stored scalar');
      assert.equal(BigInt(decoded === '0x' ? '0x0' : decoded), BigInt(slot.value), 'Proved storage value mismatch');
      storage[slotKey] = `0x${BigInt(slot.value).toString(16).padStart(64, '0')}`;
    }
    alloc[key.slice(2)] = { balance: account.balance, nonce: account.nonce, code: account.code, storage };
    inventory.set(key, { account, slots });
  }
  return { alloc, inventory };
}

export function witnessMissingReads(prestate, inventory) {
  assert.ok(prestate && typeof prestate === 'object' && !Array.isArray(prestate), 'Invalid prestate trace');
  const missing = [];
  for (const [account, state] of Object.entries(prestate)) {
    assert.ok(address(account) && state && typeof state === 'object', 'Invalid prestate account');
    const proved = inventory.get(lower(account));
    if (!proved) { missing.push({ address: lower(account), reason: 'unproven-account' }); continue; }
    for (const slot of Object.keys(state.storage ?? {})) {
      const normalized = `0x${slot.slice(2).padStart(64, '0')}`.toLowerCase();
      if (!proved.slots.has(normalized)) missing.push({ address: lower(account), slot: normalized, reason: 'unproven-storage' });
    }
  }
  return missing;
}

export function validateCall(call) {
  assert.ok(call && typeof call === 'object' && address(call.from) && address(call.to) && bytes(call.data), 'Exact unsigned call required');
  assert.ok(quantity(call.value) && quantity(call.gas) && BigInt(call.gas) > 0n, 'Exact value/gas required');
  assert.ok(Object.keys(call).every(key => ['from', 'to', 'data', 'value', 'gas', 'nonce', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas'].includes(key)), 'Unexpected call field or signing/override data');
  for (const key of ['nonce', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) if (call[key] !== undefined) assert.ok(quantity(call[key]), `Invalid ${key}`);
}

export function validateWire(request, expectedCount, blockNumber) {
  assert.equal(request?.method, 'eth_simulateV1', 'Only captured simulation requests are accepted');
  assert.ok(Array.isArray(request.params) && request.params.length === 2 && request.params[1] === blockNumber, 'Captured numbered block must match canonical pin');
  const program = request.params[0];
  assert.deepEqual(Object.keys(program).sort(), ['blockStateCalls', 'returnFullTransactions', 'traceTransfers', 'validation']);
  assert.equal(program.returnFullTransactions, true); assert.equal(program.traceTransfers, false); assert.equal(typeof program.validation, 'boolean');
  assert.ok(Array.isArray(program.blockStateCalls) && program.blockStateCalls.length === expectedCount, 'Incomplete original program (prefixes cannot qualify)');
  const calls = program.blockStateCalls.map(block => {
    assert.deepEqual(Object.keys(block), ['calls'], 'State/block overrides are forbidden');
    assert.ok(Array.isArray(block.calls) && block.calls.length === 1, 'Exactly one original transaction per block required');
    validateCall(block.calls[0]); return block.calls[0];
  });
  return calls;
}

export function validateCase(id, capture, expectedURI) {
  const expected = REQUIRED_CASES[id]; assert.ok(expected, 'Unknown incident case');
  assert.equal(capture.schema, 'keel-original-publication-capture@1');
  assert.equal(capture.completeOriginalProgram, true, 'Partial captures are diagnostic only');
  for (const key of ['artifactId', 'releaseId', 'releaseRevision']) assert.equal(capture.identity[key], expected[key], `Wrong ${id} ${key}`);
  const header = capture.header;
  assert.ok(quantity(header.number) && digest(header.hash) && digest(header.stateRoot), 'Pinned canonical header required');
  for (const field of ['timestamp', 'gasLimit', 'baseFeePerGas']) assert.ok(quantity(header[field]), `Missing canonical ${field}`);
  verifyHeaderCommitment(header, capture.headerRlp);
  const input = capture.exactSimulationInput;
  assert.equal(input.chainId, 11155111); assert.equal(input.blockNumber, BigInt(header.number));
  assert.ok(Array.isArray(input.preparationCalls) && input.preparationCalls.length === expected.calls, 'Complete SDK preparation calls required');
  assert.ok(capture.wireRequest || capture.captureKind === 'source-assembled-unallocated-input', 'Original captured request or source-assembled input required');
  const calls = capture.wireRequest ? validateWire(capture.wireRequest, expected.calls, header.number) : input.preparationCalls;
  // An allocated discovery request may differ in gas only from the unallocated input.
  // Bind every other transaction field; preserve both original envelopes verbatim.
  calls.forEach((call, index) => {
    validateCall(input.preparationCalls[index]);
    const withoutGas = ({ gas, ...rest }) => rest;
    assert.equal(stable(withoutGas(call)), stable(withoutGas(input.preparationCalls[index])), 'Wire/input original program differs');
  });
  assert.equal(input.expectedTokenURI, expectedURI, 'Complete expected URI changed');
  assert.ok(expectedURI.length > 0 && Buffer.byteLength(expectedURI) <= 2_000_000, 'Full URI required');
  assert.ok(digest(input.readerRuntimeCodeHash) && address(input.reader), 'Reader commitment required');
  validateCall(input.metadataCall);
  for (const item of input.requiredReaderCalls ?? []) { validateCall(item.call); assert.ok(bytes(item.expectedReturn)); }
  for (const call of input.observationCalls ?? []) validateCall(call);
  if (id === 'paid-6-atomic') {
    assert.equal(input.transactionContext, 'atomic-wallet'); assert.equal(input.discoveryGasPolicy, undefined, 'Atomic program cannot use storage discovery allocation');
    assert.equal(lower(calls[0].from), lower(calls[0].to), 'Paid atomic sender/delegate changed');
    const decoded = decodeFunctionData({ abi: parseAbi(['function execute(bytes32 mode,bytes executionCalldata)']), data: calls[0].data });
    assert.equal(decoded.args[0], `0x01${'00'.repeat(31)}`);
    const [batch] = decodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'target', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'callData', type: 'bytes' }] }], decoded.args[1]);
    assert.equal(batch.length, 6, 'Original paid batch must contain all six calls');
    assert.equal(keccak256(calls[0].data), '0x54badc0149766e2b480f385e2a7aba37a7111aa4eb92e7fc08291e302a9cd9f9', 'Original paid atomic calldata changed');
    assert.equal(Buffer.byteLength(expectedURI), 655134, 'Original paid complete URI length changed');
    assert.equal(keccak256(`0x${Buffer.from(expectedURI).toString('hex')}`), '0x4fb4b1fe94136ed46e71d696cc8e5161bddd3655580f078df22593e6edffff8e', 'Original paid complete URI digest changed');
  }
  if (id === 'owned-14') {
    assert.equal(lower(calls[8].to), '0xe7f47a76d2887d0a54f7c40dcf7ffcc69e6f22be', 'Original owned factory target changed');
    assert.equal(keccak256(calls[8].data), '0x436e37ab0fb516791788c09e414359de620db18975711f7f397be2bb3f7d7911', 'Original owned factory calldata changed');
  }
  return { calls, input, header };
}

/** Local process budget may exceed a single transaction/block budget when a
 * complete multi-block program is replayed. It never replaces any call gas. */
export function validateNativeBudget(input, header, budget) {
  assert.ok(Number.isSafeInteger(budget) && budget > 0, 'Explicit safe positive local RPC budget required');
  const count = input.preparationCalls.length + (input.requiredReaderCalls?.length ?? 0) + (input.observationCalls?.length ?? 0) + 1;
  const maximum = BigInt(count) * BigInt(header.gasLimit);
  assert.ok(BigInt(budget) <= maximum, 'Local RPC budget exceeds complete call count times captured block gas limit');
  return { completeCallCount: count, canonicalPerBlockGasLimit: header.gasLimit, maximumLocalProgramBudget: maximum.toString(), declaredLocalProgramBudget: budget };
}

export function validateManifest(manifest) {
  assert.equal(manifest.schema, 'keel-native-original-program-gate@1');
  assert.equal(manifest.gethImage, GETH_IMAGE, 'Unreviewed native client');
  assert.ok(Array.isArray(manifest.cases));
  assert.deepEqual(manifest.cases.map(item => item.id).sort(), Object.keys(REQUIRED_CASES).sort(), 'All three original cases are mandatory exactly once');
  for (const item of manifest.cases) {
    assert.ok(item.capture && item.expectedURI && item.snapshot, 'Complete private evidence references required');
    assert.ok(['canonical-datadir', 'proof-reconstruction'].includes(item.snapshot.mode), 'Explicit native state mode required');
    assert.ok(Number.isSafeInteger(item.rpcGasCap) && item.rpcGasCap > 0, 'Explicit local RPC budget required');
  }
  return manifest;
}

export function summarizeSimulation(request, response) {
  const calls = request.params[0].blockStateCalls.flatMap(block => block.calls);
  if (response.error) return { rpcError: response.error, calls: [] };
  assert.ok(Array.isArray(response.result), 'Malformed native response');
  return { calls: calls.map((call, index) => {
    const block = response.result[index], result = block?.calls?.[0], tx = block?.transactions?.[0];
    return { callIndex: index, target: call.to, selector: call.data.slice(0, 10), requestedGas: call.gas,
      returnedGas: tx?.gas ?? null, gasUsed: result?.gasUsed ?? null, maxUsedGas: result?.maxUsedGas ?? null,
      status: result?.status ?? null, rawError: result?.error ?? null, returnData: result?.returnData ?? null };
  }) };
}
