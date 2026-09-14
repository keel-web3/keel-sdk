import test from 'node:test';
import assert from 'node:assert/strict';
import { injectKeelModuleGlobals } from '../packages/builder/dist/module-globals.js';
import { declareGlobals, getGlobals } from '../packages/sdk/dist/module/globals.js';

test('compiler assigns the item path and respects import aliases and local shadowing', () => {
  const output = injectKeelModuleGlobals(`import { declareGlobals as share } from '@keel/sdk/module';
export const state = share({ count: 0 });
function local(share) { return share({ count: 1 }); }
`, 'items/star/script.ts');
  assert.match(output, /share\(\{ count: 0 \}, undefined, "items\/star\/script.ts"\)/);
  assert.match(output, /return share\(\{ count: 1 \}\)/);
});

test('ordinary imports and unrelated functions are unchanged', () => {
  const source = 'import { declareGlobals } from "other"; declareGlobals({});';
  assert.equal(injectKeelModuleGlobals(source, 'a.ts'), source);
});

test('compiler refuses caller-supplied hidden paths', () => {
  assert.throws(() => injectKeelModuleGlobals('import { declareGlobals } from "@keel/sdk/module"; declareGlobals({}, "x", "spoof");', 'a.ts'));
});

test('shared APIs retain identity, custom names and collision protection', () => {
  const values = { snapshot: () => 42 };
  assert.equal(declareGlobals(values, 'test/thumbnail'), values);
  assert.equal(getGlobals('test/thumbnail').snapshot(), 42);
  assert.throws(() => declareGlobals({}, 'test/thumbnail'), /already declared/);
  assert.throws(() => getGlobals('test/missing'), /not declared/);
  assert.throws(() => declareGlobals({}), /source path/);
  const hostile = declareGlobals({ safe: true }, '__proto__');
  assert.equal(getGlobals('__proto__'), hostile);
  assert.equal({}.safe, undefined);
});

test('creator build injects the namespace into the shipped module', async () => {
  const { mkdtemp, mkdir, writeFile, readFile, symlink, rm } = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const { fileURLToPath } = await import('node:url');
  const { buildCreatorProject } = await import('../packages/builder/dist/creator-module.js');
  const root = await mkdtemp(path.join(os.tmpdir(), 'keel-global-creator-'));
  try {
    await mkdir(path.join(root, 'node_modules/@keel'), { recursive: true });
    await symlink(fileURLToPath(new URL('../packages/sdk', import.meta.url)), path.join(root, 'node_modules/@keel/sdk'), 'dir');
    await writeFile(path.join(root, 'art.ts'), `import { declareGlobals, defineModule, defineDocument } from '@keel/sdk/module';
const state = declareGlobals({ frame: 42 });
export default defineModule('stars', { target: '@keel/eth/sepolia', extends: [], document: defineDocument({ title: 'Stars', render({ root }) { root.textContent = String(state.frame); } }) });`);
    const outputDirectory = path.join(root, 'dist');
    const plan = await buildCreatorProject({ root, outputDirectory, surfaces: [{ name: 'stars', entry: 'art.ts', isolation: 'sandbox' }] });
    const scripts = await Promise.all(plan.nodes.filter(node => node.mediaType === 'text/javascript').map(node => readFile(path.join(outputDirectory, node.file), 'utf8')));
    assert.match(scripts.join('\n'), /declareGlobals\(\{ frame: 42 \}, (?:void 0|undefined), "art.ts"\)/);
    assert.doesNotMatch(scripts.join('\n'), /from ["']@keel/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
