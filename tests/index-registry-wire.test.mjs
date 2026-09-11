import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAbi, encodeErrorResult, decodeErrorResult, encodeEventTopics, encodeAbiParameters, decodeEventLog, keccak256, toHex } from 'viem';
import { keelIndexAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-hold.generated.js';
import { siblingTest } from './sibling-repository.mjs';
const testWithContracts = siblingTest(test, 'keel-contracts');
const sdk = parseAbi(keelIndexAbi), contract = ABIS.KeelIndex;
const address = '0x1111111111111111111111111111111111111111';
const digest = '0x' + 'ab'.repeat(32);
const normalize = value => JSON.parse(JSON.stringify(value, (key, value) =>
  key === 'internalType' || (key === 'name' && value === '')
    || ((key === 'indexed' || key === 'anonymous') && value === false) ? undefined : value));

testWithContracts('Index SDK includes the complete callable, error and event surface', () => {
  for (const type of ['function', 'error', 'event']) {
    const actual = sdk.filter(item => item.type === type), expected = contract.filter(item => item.type === type);
    assert.equal(actual.length, expected.length);
    for (const item of expected) assert.deepEqual(normalize(actual.find(other => other.name === item.name)), normalize(item), item.name);
  }
  const canonical = JSON.parse(readFileSync(new URL('../../keel-contracts/modules/keel-hold/abi/KeelIndex.json', import.meta.url)));
  assert.deepEqual(contract, canonical);
});

test('every Index error encodes and decodes through the shared SDK', () => {
  for (const error of contract.filter(item => item.type === 'error')) {
    const args = error.inputs.map(input => input.type === 'address' ? address : digest);
    const data = encodeErrorResult({ abi: contract, errorName: error.name, args });
    assert.equal(decodeErrorResult({ abi: sdk, data }).errorName, error.name);
    assert.equal(encodeErrorResult({ abi: sdk, errorName: error.name, args }), data);
  }
});

test('revision publication preserves the original indexed topics and data order', () => {
  const max64 = (1n << 64n) - 1n, max256 = (1n << 256n) - 1n;
  const args = { collection: address, tokenId: max256, tokenSpecific: true, revision: max64,
    parentRevision: max64 - 1n, manifestDigest: digest, manifestURI: 'ipfs://' + 'x'.repeat(2041), policy: 4, activationTime: max64 };
  const topics = encodeEventTopics({ abi: sdk, eventName: 'RevisionPublished', args });
  assert.deepEqual(topics, [keccak256(toHex('RevisionPublished(address,uint256,bool,uint64,uint64,bytes32,string,uint8,uint64)')),
    '0x' + address.slice(2).padStart(64, '0'), toHex(max256, { size: 32 }), toHex(1n, { size: 32 })]);
  const data = encodeAbiParameters([{type:'uint64'}, {type:'uint64'}, {type:'bytes32'}, {type:'string'}, {type:'uint8'}, {type:'uint64'}],
    [args.revision, args.parentRevision, digest, args.manifestURI, 4, max64]);
  assert.deepEqual(decodeEventLog({ abi: sdk, eventName: 'RevisionPublished', data, topics }).args, args);
});

test('permanent freeze events expose collection and exact token scope', () => {
  for (const tokenSpecific of [false, true]) {
    const args = { collection: address, tokenId: 0n, tokenSpecific };
    const topics = encodeEventTopics({ abi: sdk, eventName: 'ScopePermanentlyFrozen', args });
    assert.deepEqual(decodeEventLog({ abi: sdk, data: '0x', topics }).args, args);
  }
});
