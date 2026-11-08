import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexRoot } from '../src/index/root.mjs';

const vectors = JSON.parse(readFileSync(new URL('../spec/vectors/writers.json', import.meta.url)));
test('writer genesis commitment reproduces the frozen vector', () => {
  const update = vectors.cases[0].input.writers[0].updates[0];
  const result = indexRoot({ recipe: update.r, height: update.h, blockhash: update.hash, members: update.new, refunds: [] });
  assert.equal(result.indexRoot, update.root);
  assert.equal(result.count, update.count);
  assert.equal(result.over, update.over);
});
test('rejects duplicates and unordered entries', () => {
  const update = vectors.cases[0].input.writers[0].updates[0];
  const args = { recipe: update.r, height: update.h, blockhash: update.hash, members: update.new, refunds: [] };
  assert.throws(() => indexRoot({ ...args, members: [args.members[0], args.members[0]] }));
  assert.throws(() => indexRoot({ ...args, members: [...args.members].reverse() }));
});
