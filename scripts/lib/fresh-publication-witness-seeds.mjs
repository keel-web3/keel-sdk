import assert from 'node:assert/strict';
import { decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, concatHex, getContractAddress, keccak256, parseAbi, toHex } from 'viem';
import { normalizeAssemblyCapture, validateCase, verifyWitness, stable, sha256 } from './captured-publication-fixture.mjs';
import { keelPublicationJobAbi, keelHoldAbi, keelFactoryAbi } from '../../packages/sdk/dist/abi.js';

const jobAbi = parseAbi(keelPublicationJobAbi), holdAbi = parseAbi(keelHoldAbi), factoryAbi = parseAbi(keelFactoryAbi);
const slot = value => toHex(value, { size: 32 });
const mapping = (key, type, base) => keccak256(encodeAbiParameters([{ type }, { type: 'uint256' }], [key, BigInt(base)]));
const profiles = Object.freeze({
  job: '0x1f46225e14a86ab523633e622270c93944fb46ee9c652cfc955fea8dff2f98fd',
  hold: '0x077e7511ef8deb6d2c1d56041ee230a1f6ffac4b861bf264c37346835653e0e5',
  factory: '0x94e68d15c76da5116dc8df155e7498518f822668f375624d66af18479c25d432',
  deployer: '0xee29fee5f3e88d897ea5caed165ee465bd8112b31a1124a899494e1bef12bac6',
});
// These immutable identities are bound by exact matched runtime hashes, not by
// another block's mutable state. An unsupported runtime fails rather than using
// this layout. Dependent code/storage still requires proofs at the input pin.
const matchedFactoryDeployer = '0x74476ea0dc3d74e6a5fcd9544018ccd253e3f6cf';
const matchedJobHold = '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267';

export function deriveFreshRetroSeeds(raw, { witness, captureBytes } = {}) {
  if (captureBytes !== undefined) assert.equal(stable(JSON.parse(captureBytes)), stable(raw), 'Supplied capture bytes differ from parsed source');
  const capture = normalizeAssemblyCapture(raw), { input, calls, header } = validateCase('retro-45', capture, raw.completeExpectedTokenURI);
  const all = [...calls, ...(input.requiredReaderCalls ?? []).map(item => item.call), ...input.observationCalls, input.metadataCall];
  assert.equal(all.length, 47);
  const accounts = new Map(), pending = [], proofInventory = witness?.accounts?.length ? verifyWitness(header, witness).inventory : new Map();
  const ensure = (address, reason, expectedRuntime) => {
    address = address.toLowerCase();
    assert.match(address, /^0x[0-9a-f]{40}$/);
    const item = accounts.get(address) ?? { address, reasons: [], slots: new Set(), expectedRuntime: null };
    item.reasons.push(reason);
    if (expectedRuntime) { assert.ok(!item.expectedRuntime || item.expectedRuntime === expectedRuntime); item.expectedRuntime = expectedRuntime; }
    accounts.set(address, item); return item;
  };
  const codeAt = address => {
    const proved = proofInventory.get(address.toLowerCase());
    if (proved) return proved.account.code;
    const results = raw.readEvidence.filter(item => item.request.method === 'eth_getCode'
      && item.request.params[0].toLowerCase() === address.toLowerCase()
      && item.request.params[1] === header.number).map(item => JSON.parse(item.rawResponse).result).filter(value => typeof value === 'string');
    if (!results.length) return undefined;
    assert.ok(results.every(value => value.toLowerCase() === results[0].toLowerCase()), 'Conflicting same-pin runtimes');
    return results[0];
  };
  const runtime = (address, expected, name, mandatory = false) => {
    ensure(address, `${name} matched-runtime layout`, expected);
    const code = codeAt(address);
    if (code === undefined) { assert.ok(!mandatory, `${name} runtime absent from same-pin capture`); pending.push({ kind: 'runtime', address, expectedRuntime: expected }); return undefined; }
    assert.equal(keccak256(code), expected, `${name} runtime changed; source layout cannot be reused`);
    return code;
  };
  const readResult = (address, data, name) => {
    const results = raw.readEvidence.filter(item => item.request.method === 'eth_call'
      && item.request.params[0].to?.toLowerCase() === address.toLowerCase()
      && item.request.params[0].data.toLowerCase() === data.toLowerCase()
      && item.request.params[1] === header.number).map(item => JSON.parse(item.rawResponse).result).filter(value => typeof value === 'string');
    assert.ok(results.length, `Missing same-pin ${name} read; do not reuse an old value`);
    assert.ok(results.every(value => value.toLowerCase() === results[0].toLowerCase()), `Conflicting ${name} reads`);
    return results[0];
  };
  all.forEach((call, index) => { ensure(call.from, `call${index} sender`); ensure(call.to, `call${index} recipient`); });
  ensure(header.miner, 'canonical block beneficiary');
  const job = calls[0].to.toLowerCase(), owner = calls[0].from.toLowerCase();
  runtime(job, profiles.job, 'PublicationJob', true);
  const opening = decodeFunctionData({ abi: jobAbi, data: calls[0].data }); assert.equal(opening.functionName, 'openJob');
  const nextJobId = BigInt(readResult(job, encodeFunctionData({ abi: jobAbi, functionName: 'nextJobId' }), 'nextJobId'));
  assert.ok(nextJobId > 0n);
  assert.equal(input.assertions.find(item => item.callIndex === 0)?.returnData.toLowerCase(), slot(nextJobId).toLowerCase(), 'openJob assertion differs from freshly derived nextJobId');
  const jobItem = accounts.get(job); jobItem.slots.add(slot(0n));
  const jobBase = BigInt(mapping(nextJobId, 'uint256', 1));
  for (let i = 0n; i < 7n; i++) jobItem.slots.add(slot(jobBase + i));
  for (const [base, values] of [[2, opening.args[3]], [3, opening.args[4]], [4, opening.args[5]]]) {
    const array = mapping(nextJobId, 'uint256', base); jobItem.slots.add(array);
    const start = BigInt(keccak256(array)); values.forEach((_, i) => jobItem.slots.add(slot(start + BigInt(i))));
  }
  assert.ok(opening.args[5].map(address => address.toLowerCase()).includes(matchedJobHold), 'Job Hold/allowed target identity differs');
  const hold = matchedJobHold; runtime(hold, profiles.hold, 'Hold');
  const holdItem = accounts.get(hold), chunks = new Map(), welds = [];
  let factoryIndex = -1;
  for (const [index, call] of calls.entries()) {
    if (call.to.toLowerCase() !== job) { if (call.data.startsWith('0x6864160e')) { assert.equal(factoryIndex, -1); factoryIndex = index; } continue; }
    if (index === 0) continue;
    const decoded = decodeFunctionData({ abi: jobAbi, data: call.data });
    assert.equal(decoded.args[0], nextJobId, `Call${index} contains a stale job ID`);
    if (decoded.functionName === 'executeCarrier') for (const bytes of decoded.args[1]) chunks.set(keccak256(bytes), { bytes: (bytes.length - 2) / 2 });
    else if (decoded.functionName === 'executeOperation') {
      assert.equal(decoded.args[1].toLowerCase(), hold, 'Unsupported operation target needs its own runtime layout');
      const operation = decodeFunctionData({ abi: holdAbi, data: decoded.args[3] });
      assert.ok(['weldObject', 'weldComposite'].includes(operation.functionName)); welds.push({ index, operation });
    }
  }
  assert.ok(factoryIndex >= 0, 'Complete exact factory call missing');
  for (const digest of chunks.keys()) holdItem.slots.add(mapping(digest, 'bytes32', 0));
  const objects = new Map(), unresolvedObjects = new Set();
  for (const { index, operation } of welds) {
    const composite = operation.functionName === 'weldComposite', [ids, digest, byteLength] = operation.args;
    let storedLength = 0n, complete = true;
    for (const id of ids) {
      const item = composite ? objects.get(id) : chunks.get(id);
      if (!item) { complete = false; if (composite) { unresolvedObjects.add(id); holdItem.slots.add(mapping(id, 'bytes32', 1)); } else holdItem.slots.add(mapping(id, 'bytes32', 0)); }
      else storedLength += BigInt(item.bytes);
    }
    if (!complete) { pending.push({ kind: 'referenced-object-or-slug', stageIndex: index, ids, reason: 'Need proved pointed runtime and complete descriptor metadata to derive this output ID' }); continue; }
    const mediaType = operation.args[composite ? 3 : 4];
    const values = [composite ? '0x01' : '0x00', keccak256(concatHex(ids)), digest, byteLength, storedLength,
      ...(composite ? [] : [operation.args[3]]), keccak256(toHex(mediaType))];
    const types = ['bytes1', 'bytes32', 'bytes32', 'uint64', 'uint64', ...(composite ? [] : ['uint8']), 'bytes32'];
    const id = keccak256(encodeAbiParameters(types.map(type => ({ type })), values));
    objects.set(id, { bytes: storedLength }); holdItem.slots.add(mapping(id, 'bytes32', 1));
  }
  const factory = calls[factoryIndex].to.toLowerCase(); runtime(factory, profiles.factory, 'Factory', true);
  const config = decodeFunctionData({ abi: factoryAbi, data: calls[factoryIndex].data }).args[0];
  const creator = calls[factoryIndex].from.toLowerCase();
  const creatorNonce = BigInt(readResult(factory, encodeFunctionData({ abi: factoryAbi, functionName: 'creatorNonces', args: [creator] }), 'factory creator nonce'));
  accounts.get(factory).slots.add(mapping(creator, 'address', 2));
  const predictedBytes = readResult(factory, encodeFunctionData({ abi: factoryAbi, functionName: 'predictDieAddress', args: [config, creator, creatorNonce] }), 'factory prediction');
  const predicted = decodeFunctionResult({ abi: factoryAbi, functionName: 'predictDieAddress', data: predictedBytes }).toLowerCase();
  ensure(predicted, 'future CREATE2 collection: prove prior nonce/code/balance; absence and prefunding must not be assumed');
  assert.ok(calls.slice(factoryIndex + 1).some(call => call.to.toLowerCase() === predicted), 'Factory prediction does not match downstream program');
  for (const address of [config.mintManager, config.keelIndex]) ensure(address, 'exact CollectionConfig dependency');
  const deployerCode = runtime(matchedFactoryDeployer, profiles.deployer, 'Factory deployer');
  let computedFactoryTarget = null;
  if (deployerCode) {
    const bytes = Buffer.from(deployerCode.slice(2), 'hex'), word = offset => '0x' + bytes.subarray(offset, offset + 32).toString('hex');
    const parts = [{ address: '0x' + word(1093).slice(-40), length: Number(BigInt(word(941))) }, { address: '0x' + word(1130).slice(-40), length: Number(BigInt(word(981))) }];
    const partCodes = parts.map(part => { ensure(part.address, 'factory creation-code immutable carrier'); return codeAt(part.address); });
    if (partCodes.every(code => code !== undefined)) {
      partCodes.forEach((code, index) => assert.equal((code.length - 2) / 2, parts[index].length, 'Creation carrier length differs'));
      const creation = concatHex(partCodes); assert.equal(keccak256(creation), word(84), 'Creation-code bytes differ from matched deployer commitment');
      const constructor = encodeAbiParameters(['string', 'string', 'address', 'address', 'address', 'address', 'uint96', 'uint256'].map(type => ({ type })),
        [config.name, config.symbol, config.admin, config.mintManager, config.keelIndex, config.royaltyReceiver, config.royaltyBps, config.maxSupply]);
      const salt = keccak256(encodeAbiParameters(['address', 'uint256', 'string', 'string'].map(type => ({ type })), [creator, creatorNonce, config.name, config.symbol]));
      const scopedSalt = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [factory, salt]));
      computedFactoryTarget = getContractAddress({ opcode: 'CREATE2', from: matchedFactoryDeployer, salt: scopedSalt, bytecode: concatHex([creation, constructor]) }).toLowerCase();
      assert.equal(computedFactoryTarget, predicted, 'CREATE2 recomputation differs from fresh program');
    } else pending.push({ kind: 'creation-code-parts', addresses: parts.map(part => part.address), expectedLengths: parts.map(part => part.length) });
  }
  const holdAccount = proofInventory.get(hold), possibleHoldCreateTargets = [];
  const maxHoldCreates = chunks.size + welds.length;
  assert.ok(maxHoldCreates <= 1024, 'Explicit CREATE seed bound exceeded');
  if (holdAccount) {
    assert.equal(keccak256(holdAccount.account.code), profiles.hold);
    const nonce = BigInt(holdAccount.account.nonce);
    for (let offset = 0; offset < maxHoldCreates; offset++) {
      const address = getContractAddress({ from: hold, nonce: nonce + BigInt(offset) }).toLowerCase();
      possibleHoldCreateTargets.push({ address, creatorNonce: (nonce + BigInt(offset)).toString(), conditional: true });
      ensure(address, 'possible Hold CREATE target: exact nonce-based superset; actual creation/reuse unknown until proved pointer slots and execution');
    }
  } else pending.push({ kind: 'hold-nonce-proof', address: hold, maximumPossibleCreates: maxHoldCreates, reason: 'No zero/default nonce; CREATE target range cannot yet be computed' });
  for (const item of accounts.values()) {
    const proved = proofInventory.get(item.address);
    if (proved && item.expectedRuntime) assert.equal(keccak256(proved.account.code), item.expectedRuntime);
    // Every nonzero proved pointer is another account/code dependency, not a
    // synthetic code carrier. This queue expands after each bounded read batch.
    if (item.address === hold && proved) for (const key of item.slots) {
      const proof = proved.account.storageProof.find(value => value.key.toLowerCase() === key.toLowerCase());
      if (proof && BigInt(proof.value) !== 0n) ensure('0x' + BigInt(proof.value).toString(16).padStart(40, '0'), 'proved Hold pointer target; descriptor/carrier code and recursive dependencies required');
    }
  }
  return {
    schema: 'keel-private-fresh-retro-seeds@1', networkRequests: 0, executeAutomatically: false,
    pin: { number: header.number, hash: header.hash, stateRoot: header.stateRoot, timestamp: header.timestamp }, headerRlp: capture.headerRlp,
    completeInputSHA256: raw.completeInputSHA256, scope: raw.scope,
    captureSHA256: captureBytes === undefined ? null : sha256(captureBytes), captureObjectSHA256: sha256(stable(raw)),
    sourceFingerprint: sha256(stable({ identity: capture.identity, source: capture.source, completeInputSHA256: raw.completeInputSHA256 })),
    capturedTimeOnly: true, currentFreshnessEstablished: false, noProductionMutation: true, approvalReady: false,
    program: { preparationCalls: calls.length, completeCalls: all.length, fullURIBytes: raw.completeTokenURIBytes, fullURIKeccak256: raw.completeTokenURIKeccak256,
      nextJobId: nextJobId.toString(), deadline: opening.args[2].toString(), expiredAtPin: opening.args[2] <= BigInt(header.timestamp), chunks: chunks.size, weldOperations: welds.length },
    factory: { address: factory, creator, creatorNonce: creatorNonce.toString(), plannedTarget: predicted, computedTarget: computedFactoryTarget },
    possibleHoldCreateTargets,
    accounts: [...accounts.values()].map(item => ({ address: item.address, reasons: [...new Set(item.reasons)], ...(item.expectedRuntime ? { expectedCodeHash: item.expectedRuntime } : {}),
      runtimeValidatedAtPin: codeAt(item.address) !== undefined && (!item.expectedRuntime || keccak256(codeAt(item.address)) === item.expectedRuntime),
      canonicalAccountProofValidated: proofInventory.has(item.address), slots: [...item.slots],
      proofRequest: { method: 'eth_getProof', params: [item.address, [...item.slots], header.number] },
      runtimeRequest: { method: 'eth_getCode', params: [item.address, header.number] } })),
    pendingDerivations: pending,
    closure: { complete: false, reason: 'Initial deterministic seed only. Native sparse engine must discover/reject every additional unproved account, slot, ancestor and protocol-system dependency.' },
    sourceLayoutProfiles: profiles,
  };
}
