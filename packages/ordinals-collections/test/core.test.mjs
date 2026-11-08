import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { metadataLeaf, merkleRoot } from '../src/merkle.ts';
import { permutation } from '../src/perm.ts';

const vectors = name => JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`, import.meta.url)));
test('metadata leaves and roots match frozen vectors', () => {
  for (const { input, expected } of vectors('metadata').cases) {
    const leaves = input.messages.map((m, i) => metadataLeaf(i + 1, m));
    assert.deepEqual(leaves.map(x => x.toString('hex')), expected.leaves);
    assert.equal(merkleRoot(leaves).toString('hex'), expected.root);
  }
  assert.deepEqual(merkleRoot([]), Buffer.alloc(32));
  assert.throws(() => metadataLeaf(0, ''));
  assert.throws(() => merkleRoot([Buffer.alloc(31)]));
});
test('blind permutation matches frozen vectors', () => {
  for (const { input, expected } of vectors('permutation').cases) {
    const actual = permutation(Buffer.from(input.recipe, 'hex'), Buffer.from(input.blockhash, 'hex'), input.max);
    assert.equal(actual.seed.toString('hex'), expected.seed);
    assert.deepEqual(actual.perm, expected.perm);
  }
  assert.throws(() => permutation(Buffer.alloc(36), Buffer.alloc(32), 0));
});
