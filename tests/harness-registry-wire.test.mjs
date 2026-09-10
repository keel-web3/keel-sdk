import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, encodeErrorResult, decodeErrorResult, encodeEventTopics, encodeAbiParameters, decodeEventLog, encodeFunctionResult, decodeFunctionResult } from 'viem';
import { keelHarnessRegistryAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';

const sdk = parseAbi(keelHarnessRegistryAbi);
const contract = ABIS.KeelHarnessRegistry;
const word = byte => `0x${byte.repeat(32)}`;
const address = byte => `0x${byte.repeat(20)}`;
const normalize = value => JSON.parse(JSON.stringify(value, (key, value) => key === 'internalType' || (key === 'name' && value === '') || (key === 'indexed' && value === false) ? undefined : value));

test('Harness SDK exposes the complete compiled function and error surface', () => {
  for (const type of ['function', 'error']) {
    const actual = sdk.filter(e => e.type === type);
    const expected = contract.filter(e => e.type === type);
    assert.equal(actual.length, expected.length);
    for (const item of expected) {
      const match = actual.find(e => e.name === item.name);
      assert.deepEqual(normalize(match), normalize(item), item.name);
    }
  }
  const errors = contract.filter(e => e.type === 'error');
  assert.equal(errors.length, 23);
  for (const error of errors) {
    const data = encodeErrorResult({ abi: contract, errorName: error.name });
    assert.equal(decodeErrorResult({ abi: sdk, data }).errorName, error.name);
  }
});

test('all Harness events preserve indexed identities and decode every field', () => {
  const max = (1n << 64n) - 1n;
  const values = {
    harnessId: word('11'), creator: address('22'), collection: address('33'), publisher: address('44'),
    key: 0xffffffff, control: (1n << 104n) - 1n, editPolicy: 1, forkPolicy: 0, revision: max, parentRevision: max - 1n, forkRevision: max - 2n,
    baseHarnessRevision: max - 3n, keelIndexRevision: max - 4n, tokenId: (1n << 256n) - 1n,
    slotsDigest: word('55'), seedSetDigest: word('66'), manifestDigest: word('77'), selectionDigest: word('88'),
  };
  const events = contract.filter(e => e.type === 'event');
  assert.equal(events.length, 9);
  for (const event of events) {
    const match = sdk.find(e => e.type === 'event' && e.name === event.name);
    assert.deepEqual(normalize(match.inputs), normalize(event.inputs), event.name);
    const args = Object.fromEntries(event.inputs.map(p => [p.name, values[p.name]]));
    const topics = encodeEventTopics({ abi: contract, eventName: event.name, args });
    const fields = event.inputs.filter(p => !p.indexed);
    const data = encodeAbiParameters(fields, fields.map(p => args[p.name]));
    const decoded = decodeEventLog({ abi: sdk, topics, data, strict: true });
    assert.equal(decoded.eventName, event.name);
    assert.deepEqual(decoded.args, args);
  }
});

test('EffectiveHarness decodes distinct revision counters and dynamic arrays in their new order', () => {
  const result = {
    forkRevision: 3n, harnessRevision: 9n, keelIndexRevision: (1n << 64n) - 1n,
    manifestDigest: word('11'), selectionDigest: word('22'),
    selectedObjectRevisions: [1n, (1n << 64n) - 1n], slotObjectIds: [word('33'), word('44')],
  };
  const output = contract.find(e => e.name === 'effectiveHarness').outputs[0];
  assert.deepEqual(output.components.map(p => p.name), Object.keys(result));
  const data = encodeFunctionResult({ abi: contract, functionName: 'effectiveHarness', result });
  assert.deepEqual(decodeFunctionResult({ abi: sdk, functionName: 'effectiveHarness', data }), result);
});

test('HarnessRevision retains full-width counters beside the packed direct list source', () => {
  const result={exists:true,createdAt:(1n<<64n)-1n,parentRevision:(1n<<64n)-2n,treeMetadata:(1n<<80n)-1n,slotSourceRevision:Number((1n<<40n)-1n),slotsDigest:word('11'),seedSetDigest:word('22'),manifestDigest:word('33'),publisher:address('44')};
  const data=encodeFunctionResult({abi:contract,functionName:'harnessRevision',result});
  assert.deepEqual(decodeFunctionResult({abi:sdk,functionName:'harnessRevision',data}),result);
});
