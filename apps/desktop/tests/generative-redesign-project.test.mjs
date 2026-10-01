import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { generativeAssetRecipe, withGenerativeAsset } from '../src/game-engine/generative-redesign-project.mjs';
import { readBuildFile } from '../src/game-engine/builder-project.mjs';

const objectId = 'a'.repeat(64);
const candidate = (patch = {}) => ({
  runtimeVersion: 'keel-generative-runtime@1.0.0', requestId: 'af451b85-c568-4dc5-ad34-5b8fca5f6b49', artifactId: 'b'.repeat(64),
  program: { format: 'keel-generative-program@1', id: 'fox', title: 'Moon fox', ops: [{ op: 'box', from: [0, 0, 0], to: [2, 3, 2], role: 'primary' }] },
  seed: 'moon-1', ops: [{ op: 'new', name: 'fox' }, { op: 'box', from: [0, 0, 0], to: [2, 3, 2], role: 'primary' }],
  source: { objectId, name: 'fox.glb', descriptor: { privateDescriptor: 'not stored in recipe' } },
  settings: { provider: 'codex', model: 'configured-model', mode: 'theme', theme: 'moon explorer', guidance: 'Keep the ears',
    style: { kind: 'dither', pixelSize: 3, toneLevels: 6, screen: 'bayer8' } },
  validation: { ok: true, errors: [] }, playback: { glbBase64: 'not stored' }, providerRawOutput: 'not stored', ...patch,
});
const project = () => ({ id: 'project', title: 'Fox world', files: [
  { id: 'original', name: 'assets/source.glb', type: 'model/gltf-binary', content: 'ORIGINAL FILE BYTES' },
  { id: 'existing-build', name: 'builds/main.build.json', type: 'application/json', content: '{"original":"build"}' },
], objectIds: ['c'.repeat(64)], metadata: { retained: true } });

test('accept adds exactly the recipe, resolved build, trusted loader and selected source reference', () => {
  const before = project(), snapshot = structuredClone(before), made = candidate();
  const result = withGenerativeAsset(before, made);
  assert.deepEqual(before, snapshot, 'source project is not mutated');
  assert.deepEqual(result.files.slice(0, 2), snapshot.files, 'existing source and live build retain every byte');
  assert.equal(result.files.length, 5);
  assert.deepEqual(result.objectIds, ['c'.repeat(64), objectId]);
  assert.equal(result.metadata, before.metadata);
  const recipeFile = result.files.find(file => file.name.endsWith('.generative.json'));
  const recipe = JSON.parse(recipeFile.content);
  assert.deepEqual(recipe, {
    format: 'keel-generative-asset@1', program: made.program, seed: made.seed,
    source: { objectId, name: 'fox.glb' }, settings: made.settings, engineRuntime: '@keel-engine/builder/generative', engineRuntimeVersion: 'keel-generative-runtime@1.0.0',
  });
  assert.doesNotMatch(recipeFile.content, /privateDescriptor|providerRawOutput|glbBase64/);
  const build = result.files.find(file => /builds\/redesign-.*\.build\.json$/.test(file.name));
  assert.deepEqual(readBuildFile(build.content).ops, made.ops);
  const loader = result.files.find(file => file.name.endsWith('.generative.mjs'));
  assert.match(loader.content, /import \{ buildGenerativeProgram, GENERATIVE_RUNTIME_VERSION \} from '@keel-engine\/builder\/generative'/);
  assert.match(loader.content, /export const style = recipe.settings.style/);
  assert.match(loader.content, /return \{ ...result, style \}/);
  assert.doesNotMatch(loader.content, /eval\(|new Function|providerRawOutput|moon explorer/);
});

test('identical acceptance is idempotent, even after JSON transport and different request ID', () => {
  const first = withGenerativeAsset(project(), candidate());
  const second = withGenerativeAsset(first, JSON.parse(JSON.stringify(candidate({ requestId: 'another-request' }))));
  assert.equal(second, first);
  assert.deepEqual(second.files.map(file => file.id), first.files.map(file => file.id));
  assert.equal(second.objectIds.filter(id => id === objectId).length, 1);
});

test('hash or filename collisions never overwrite an existing file', () => {
  const first = withGenerativeAsset(project(), candidate());
  const revised = candidate({ seed: 'moon-2' }); // deliberately collides on server artifactId
  const result = withGenerativeAsset(first, revised);
  assert.deepEqual(result.files.slice(0, first.files.length), first.files);
  assert.equal(result.files.length, first.files.length + 3);
  assert.match(result.files.at(-1).name, /-1\.build\.json$/);
  assert.equal(withGenerativeAsset(result, revised), result);
});

test('a conflicting recipe, loader or build independently allocates a new asset', () => {
  const initial = project(), expected = withGenerativeAsset(initial, candidate());
  for (const collision of expected.files.slice(initial.files.length)) {
    const unrelated = { id: 'user-file', name: collision.name, type: collision.type, content: 'user-authored content' };
    const before = { ...initial, files: [...initial.files, unrelated] };
    const result = withGenerativeAsset(before, candidate());
    assert.equal(result.files.find(file => file.id === 'user-file'), unrelated);
    assert.equal(result.files.length, before.files.length + 3);
    assert.match(result.files.at(-1).name, /-1\.build\.json$/);
  }
});

test('a partial exact attachment adds only the missing files without replacing IDs', () => {
  const initial = project(), complete = withGenerativeAsset(initial, candidate());
  const partial = { ...initial, files: [...initial.files, complete.files[2]] };
  const result = withGenerativeAsset(partial, candidate());
  assert.equal(result.files[2], partial.files[2]);
  assert.deepEqual(result.files.map(file => file.name).sort(), complete.files.map(file => file.name).sort());
});

test('malicious program IDs cannot escape assets/builds and program text never becomes loader code', () => {
  const made = candidate();
  made.program.id = '../../BAD </script> ' + 'x'.repeat(1000);
  made.program.title = '"; throw Error("injected"); //';
  const result = withGenerativeAsset(project(), made);
  for (const file of result.files.slice(2)) assert.match(file.name, /^(assets|builds)\/redesign-[a-z0-9-]+\.(generative\.(json|mjs)|build\.json)$/);
  const build = result.files.find(file => file.name.startsWith('builds/redesign-'));
  assert.ok(readBuildFile(build.content).name.length <= 63);
  assert.doesNotMatch(result.files.find(file => file.name.endsWith('.generative.mjs')).content, /injected/);
});

test('unvalidated, empty or incomplete candidates cannot attach', () => {
  for (const patch of [
    { validation: { ok: false, errors: [] } }, { validation: { ok: true, errors: [{ message: 'bad op' }] } },
    { program: { format: 'javascript', id: 'evil' } }, { ops: [] }, { seed: '' },
    { source: { objectId: '../../source', name: 'source.glb' } }, { settings: null },
  ]) assert.throws(() => withGenerativeAsset(project(), candidate(patch)), /Preview and validate/);
  assert.throws(() => withGenerativeAsset(project(), candidate({ settings: { ...candidate().settings, theme: ' ' } })), /reviewed authoring settings/);
});

test('Original mode is persisted distinctly from Original visual style and supports no model override', () => {
  const made = candidate();
  made.settings = { ...made.settings, mode: 'original', theme: '', model: undefined, style: { ...made.settings.style, kind: 'original' } };
  const recipe = generativeAssetRecipe(made);
  assert.equal(recipe.settings.mode, 'original'); assert.equal(recipe.settings.style.kind, 'original');
  assert.equal(Object.hasOwn(recipe.settings, 'model'), false);
});

test('recipe takes an independent data snapshot', () => {
  const made = candidate(), recipe = generativeAssetRecipe(made);
  made.program.ops[0].role = 'changed'; made.settings.style.kind = 'voxel';
  assert.equal(recipe.program.ops[0].role, 'primary'); assert.equal(recipe.settings.style.kind, 'dither');
});

test('trusted loader reuses program and seed, exposes saved style, and fails closed', () => {
  const result = withGenerativeAsset(project(), candidate());
  const recipe = JSON.parse(result.files.find(file => file.name.endsWith('.generative.json')).content);
  const loader = result.files.find(file => file.name.endsWith('.generative.mjs')).content;
  const calls = [], context = { recipe, GENERATIVE_RUNTIME_VERSION: recipe.engineRuntimeVersion, buildGenerativeProgram(program, seed) { calls.push({ program, seed }); return seed === 'invalid' ? { ok: false, errors: ['bad seed'] } : { ok: true, program, seed, built: { native: true } }; } };
  vm.createContext(context);
  // Strip only fixed module declarations to exercise the generated wrapper in
  // isolation, without needing a provider or a sibling engine checkout.
  vm.runInContext(loader.replace(/^import .*\n/gm, '').replace(/^export \{ recipe \};\n/m, '').replace(/^export default build;\n/m, '').replace(/^export /gm, ''), context);
  const built = context.build();
  assert.equal(calls[0].program, recipe.program); assert.equal(calls[0].seed, recipe.seed);
  assert.equal(built.style, recipe.settings.style);
  assert.equal(context.build('different').seed, 'different');
  assert.throws(() => context.build('invalid'), /Generative recipe validation failed/);
  context.GENERATIVE_RUNTIME_VERSION = 'keel-generative-runtime@2.0.0';
  assert.throws(() => context.build(), /Generative runtime version mismatch/);
});
