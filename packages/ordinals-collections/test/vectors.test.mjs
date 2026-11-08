import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate } from './evaluate-core.mjs';
import { parseOrdEnvelopes } from '../src/envelope.ts';
import { recipeCheck } from '../src/mint.ts';

for (const file of ['wire', 'escrow', 'escrow-policy', 'mint', 'mint-boundaries', 'recipes', 'numbering-controls-roots', 'commit-auth']) {
  const suite = JSON.parse(readFileSync(new URL(`../spec/vectors/${file}.json`, import.meta.url)));
  test(`${file}: frozen core vectors`, () => {
    for (const c of suite.cases) {
      if (file === 'numbering-controls-roots' && c.id === 'time-end') {
        // The frozen fixture predates R4's unbounded-time cycle correction.
        assert.ok(recipeCheck(c.input.recipe,c.input.refs).includes('metadata'));
        const corrected=structuredClone(c.input);corrected.recipe.metadata.cycle=true;
        assert.deepEqual(evaluate(suite.kind,corrected),c.expected,`${c.id} with required cycle`);
      } else assert.deepEqual(evaluate(suite.kind, c.input), c.expected, c.id);
    }
  });
}
test('ord envelope parser ignores incomplete and non-push envelopes without shifting offsets', () => {
  const parse = hex => parseOrdEnvelopes(Buffer.from(hex, 'hex'));
  assert.equal(parse('0063036f7264').length, 0);
  assert.equal(parse('0063036f72647668').length, 0);
  assert.equal(parse('0063036f7264760063036f726468').length, 1);
  assert.equal(parse('0063036f7264680063036f726468')[1].offset, 1);
  assert.equal(parse('0063036f72645168')[0].pushnum, true);
  assert.throws(() => parse('0063036f72646801'));
});

test('multi-byte odd tags remain valid and absent reference heights fail closed', async () => {
  const { mint, base } = await import('../spec/vectors/generate.mjs');
  const { formCheck, recipeCheck } = await import('../src/mint.ts');
  const candidate = mint(42, 100, 0, { mutate(tx) {
    const witness = tx.inputs[0].witness;
    const script = witness.at(-2);
    witness[witness.length - 2] = script.slice(0, -4) + '0201010101' + '0068';
  } });
  assert.equal(formCheck(candidate).error, undefined);
  const { recipe, refs } = base();
  delete refs[recipe.art.viewer.id].height;
  assert.ok(recipeCheck(recipe, refs).includes('reference'));
});

test('package entry point exposes core functions', async () => {
  const api = await import('@keel/ordinals-collections');
  for (const name of ['parseTx', 'parseOrdEnvelopes', 'formCheck', 'escrow', 'indexState', 'acceptControls', 'merkleRoot', 'permutation'])
    assert.equal(typeof api[name], 'function', name);
});
