import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, encodeErrorResult, decodeErrorResult, encodeEventTopics, encodeAbiParameters, decodeEventLog } from 'viem';
import { keelLinkRegistryAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';

const consumer = parseAbi(keelLinkRegistryAbi);
const contract = ABIS.KeelLinkRegistry;

test('every registry custom error decodes through the consumer ABI', () => {
  const errors = contract.filter(entry => entry.type === 'error');
  assert.equal(errors.length, 19);
  for (const error of errors) {
    const data = encodeErrorResult({ abi: contract, errorName: error.name });
    assert.equal(decodeErrorResult({ abi: consumer, data }).errorName, error.name);
  }
});

test('shared registry events retain indexed fields and all consumer data', () => {
  const values = {
    shellId: `0x${'11'.repeat(32)}`, builder: `0x${'22'.repeat(20)}`,
    objectId: `0x${'33'.repeat(32)}`, artifactRevision: (1n << 64n) - 1n,
    linkSetDigest: `0x${'44'.repeat(32)}`, count: 3, fidelity: 2,
    linkId: `0x${'55'.repeat(32)}`, scheme: 3, digestAlgorithm: 1, compression: 3,
    uriDigest: `0x${'66'.repeat(32)}`, mediaTypeDigest: `0x${'77'.repeat(32)}`,
    decodedDigest: `0x${'88'.repeat(32)}`, provenanceDigest: `0x${'99'.repeat(32)}`,
    byteLength: (1n << 64n) - 1n, publisher: `0x${'12'.repeat(20)}`, revealer: `0x${'34'.repeat(20)}`,
  };
  const events = contract.filter(entry => entry.type === 'event');
  assert.equal(events.length, 3);
  for (const event of events) {
    const sdkEvent = consumer.find(entry => entry.type === 'event' && entry.name === event.name);
    assert.ok(sdkEvent, event.name);
    assert.deepEqual(sdkEvent.inputs.map(({ type, indexed }) => ({ type, indexed: Boolean(indexed) })),
      event.inputs.map(({ type, indexed }) => ({ type, indexed: Boolean(indexed) })));
    const args = Object.fromEntries(event.inputs.map(p => [p.name, values[p.name]]));
    const topics = encodeEventTopics({ abi: contract, eventName: event.name, args });
    const fields = event.inputs.filter(p => !p.indexed);
    const data = encodeAbiParameters(fields, fields.map(p => args[p.name]));
    const decoded = decodeEventLog({ abi: consumer, topics, data, strict: true });
    assert.equal(decoded.eventName, event.name);
    for (const [index, field] of event.inputs.entries()) {
      assert.equal(decoded.args[sdkEvent.inputs[index].name], args[field.name], `${event.name}.${field.name}`);
    }
  }
});
