import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { projectInputsScript, selectionModuleId, selectionSettingsManifest, withProjectInputs } from '../src/module-settings.mjs';

const inputs = [
  { key: 'color', label: 'Glow color', type: 'color', required: false, swatches: ['#7c83ff', '#ff7a59'], clamp: { saturation: [35, 100] }, default: '#7c83ff' },
  { key: 'rings', label: 'Rings', type: 'number', required: false, min: 1, max: 24, step: 1, default: 8 },
  { key: 'revealOn', label: 'Reveal on', type: 'date', required: false, placement: 'advanced' },
];
const reference = (projectId, settings) => ({
  id: randomUUID(), projectId, studioUrl: 'http://127.0.0.1:3000', name: 'glow-field', observedAt: new Date().toISOString(), evidence: 'catalog-metadata-only',
  metadata: { source: 'verified-modules', entry: { id: 'glow-field', summary: 'Glow rings', inputs: { protocol: 'keel-module-inputs@1', fields: inputs } } },
  ...(settings === undefined ? {} : { settings }),
});

test('saved Studio references expose their declared settings and module id', () => {
  const selection = reference(randomUUID());
  assert.equal(selectionModuleId(selection), 'glow-field');
  assert.equal(selectionSettingsManifest(selection)?.fields.length, 3);
  assert.equal(selectionSettingsManifest({ metadata: { entry: { id: 'plain' } } }), undefined);
  assert.equal(selectionSettingsManifest({ metadata: { entry: { inputs: [{ key: 'x' }] } } }), undefined);
});

test('the workspace saves valid settings and refuses values outside the rules', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const project = newProject('Glow study');
    const saved = store.save({ ...store.read().state, projects: [project], moduleSelections: [reference(project.id, { rings: 12, revealOn: '2026-10-01' })] }, 0);
    assert.deepEqual(saved.state.moduleSelections[0].settings, { rings: 12, revealOn: '2026-10-01' });
    assert.throws(() => store.save({ ...saved.state, moduleSelections: [reference(project.id, { rings: 99 })] }, saved.revision), /glow-field: Rings/);
    assert.throws(() => store.save({ ...saved.state, moduleSelections: [reference(project.id, { color: '#808080' })] }, saved.revision), /Glow color/);
    assert.throws(() => store.save({ ...saved.state, moduleSelections: [{ ...reference(project.id, { a: 1 }), metadata: {} }] }, saved.revision), /no settings/);
  } finally { store.close(); }
});

test('previews publish chosen settings, with defaults, before any creator script', () => {
  const project = randomUUID();
  const script = projectInputsScript([reference(project, { rings: 3 }), reference(randomUUID(), { rings: 20 })], project);
  const html = withProjectInputs('<!doctype html><html><head><script>window.seen = globalThis.KEEL_INPUTS["glow-field"]</script></head><body></body></html>', script);
  assert.ok(html.indexOf('data-keel-module-inputs') < html.indexOf('window.seen'));
  const context = vm.createContext({});
  vm.runInContext(script, context);
  assert.deepEqual({ ...vm.runInContext('KEEL_INPUTS["glow-field"]', context) }, { color: '#7c83ff', rings: 3 });
  assert.equal(projectInputsScript([reference(project, { rings: 99 })], project), '');
  assert.equal(withProjectInputs('<p>x</p>', ''), '<p>x</p>');
});
