import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import { KeelForkPolicy, KeelHarnessEditPolicy } from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const names = (enumeration) => Object.keys(enumeration).filter((key) => Number.isNaN(Number(key)))
  .sort((a, b) => enumeration[a] - enumeration[b]);
const contracts = (path) => readFileSync(new URL(`../../keel-contracts/${path}`, import.meta.url), 'utf8');

nodeTest('one set of harness policy codes serves both chains', () => {
  // EVM KeelHarnessRegistry: "Ordinals are fixed." Tezos uses the same numbers since Batch 34.
  assert.deepEqual(names(KeelHarnessEditPolicy), ['Creator', 'Immutable']);
  assert.deepEqual(names(KeelForkPolicy), ['Disabled', 'TokenOwner']);
});

siblingSource('the SDK codes match both registries and the shared vectors', () => {
  const evm = contracts('src/modules/keel-artifacts/KeelHarnessRegistry.sol');
  assert.match(evm, /enum HarnessEditPolicy\s*\{\s*Creator,\s*Immutable\s*\}/);
  const tezos = contracts('src/modules/keel-artifacts/tezos/keel_harness_registry.py');
  for (const indent of ['', '    ']) {
    assert.ok(tezos.includes(`\n${indent}CREATOR = ${KeelHarnessEditPolicy.Creator}\n${indent}IMMUTABLE = ${KeelHarnessEditPolicy.Immutable}\n`), `Tezos constants at indent ${indent.length}`);
  }
  const fixture = JSON.parse(contracts('test/fixtures/parity/harness-policies.json'));
  assert.deepEqual(fixture.codes.editPolicy, names(KeelHarnessEditPolicy));
  assert.deepEqual(fixture.codes.forkPolicy, names(KeelForkPolicy));
});
