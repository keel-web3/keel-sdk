import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi } from 'viem';
import { keelObjectRegistryAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';

const browser = parseAbi(keelObjectRegistryAbi);
const generated = ABIS.KeelArtifactRegistry;
// Parameter names are conveniences; selectors, tuple shapes, event indexing and
// mutability are the actual wire contract. Check nested tuples recursively.
const parameter = input => ({
  type: input.type,
  ...(input.indexed === undefined ? {} : { indexed: input.indexed }),
  ...(input.components === undefined ? {} : { components: input.components.map(parameter) }),
});
const wire = entry => ({
  type: entry.type, name: entry.name,
  inputs: entry.inputs.map(input => parameter(entry.type === 'event' ? { indexed: false, ...input } : input)),
  ...(entry.type === 'event' ? { anonymous: entry.anonymous ?? false } : {
    stateMutability: entry.stateMutability, outputs: entry.outputs.map(parameter),
  }),
});

test('every browser artifact function and event matches the compiled wire shape', () => {
  for (const entry of browser) {
    const compiled = generated.find(candidate => candidate.type === entry.type && candidate.name === entry.name);
    assert.ok(compiled, `${entry.type} ${entry.name} is in the compiler ABI`);
    assert.deepEqual(wire(entry), wire(compiled), entry.name);
  }
});

test('direct fee settlement has no obsolete accrual or claim API', () => {
  for (const name of ['protocolFeesAccrued', 'claimProtocolFees', 'ProtocolFeesClaimed', 'objectRevision', 'ObjectWelded']) {
    assert.ok(!browser.some(entry => entry.name === name), name);
    assert.ok(!generated.some(entry => entry.name === name), name);
  }
  for (const name of ['artifactRevision', 'ArtifactForged']) {
    assert.ok(browser.some(entry => entry.name === name), name);
  }
});
