import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKeelModuleTypes } from '../packages/builder/dist/module-types.js';
import { createKeelBuildRecipe } from '../packages/builder/dist/build-recipe.js';

test('IDE declarations reproduce and remain bound to the runtime recipe', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'keel-types-'));
  try {
    await writeFile(path.join(root, 'index.ts'), 'export const thumbnail = { snapshot(label = "hero"): string { return label; } }; export default thumbnail;');
    const { recipe } = await createKeelBuildRecipe({ root, entry: 'index.ts' });
    const first = await createKeelModuleTypes(root, recipe);
    const second = await createKeelModuleTypes(root, recipe);
    assert.deepEqual(first, second);
    assert.match(first.files['index.d.ts'], /snapshot\(label\?: string\): string/);
    assert.deepEqual(first.output, recipe.output.integrity);
    assert.equal(first.sources[0].path, 'index.ts');
    await writeFile(path.join(root, 'index.ts'), 'export const changed = true;');
    await assert.rejects(() => createKeelModuleTypes(root, recipe), /differs from runtime recipe/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
