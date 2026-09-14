import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { WorkspaceStore, newProject, projectSchema } from '../src/workspace.mjs';
import { runtimeReferences } from '../src/runtime-library.mjs';
import { loadRuntimeModules, directRuntimeImports } from '../src/runtime-files.mjs';
import { canonicalPreview } from '../src/preview.mjs';
import { PreviewService } from '../src/preview-service.mjs';

const runtimeDirectory = fileURLToPath(new URL('../dist/runtime-modules', import.meta.url));
async function shell() {
  const value = JSON.parse(await readFile(new URL('../dist/canonical-shell.json', import.meta.url), 'utf8'));
  for (const name of ['prefix', 'suffix']) value[name].bytes = Buffer.from(value[name].bytes, 'base64');
  return value;
}

test('projects persist only pinned library references and reject incomplete or changed identities', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const p = newProject('Shared Three', 'three');
    store.save({ ...store.read().state, projects: [p] }, 0);
    assert.deepEqual(store.read().state.projects[0].runtimeModules, runtimeReferences('three'));
    assert.equal(p.files.length, 1);
    assert.ok(JSON.stringify(p).length < 2500);
    assert.throws(() => projectSchema.parse({ ...p, runtimeModules: p.runtimeModules.slice(0, 1) }), /needs three-r180-core/);
    assert.throws(() => projectSchema.parse({ ...p, runtimeModules: p.runtimeModules.map(ref => ({ ...ref, digest: `0x${'0'.repeat(64)}` })) }), /pinned identity/);
    const { runtimeModules, ...legacy } = p;
    assert.deepEqual(projectSchema.parse(legacy).runtimeModules, []);
  } finally { store.close(); }
});

test('installed libraries verify their bytes and reject a corrupted installation', async () => {
  const refs = runtimeReferences('three');
  const modules = await loadRuntimeModules(refs, runtimeDirectory);
  assert.equal(modules.length, 2);
  assert.equal(modules[0].id, 'three-r180-core');
  assert.match(modules[1].bytes.toString(), /from"\.\/three.core.min.js"/);
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-library-corrupt-'));
  try {
    await Promise.all(modules.map(module => writeFile(path.join(directory, `${module.id}.js`), module.id === refs[0].id ? Buffer.from('changed') : module.bytes)));
    await assert.rejects(loadRuntimeModules(refs, directory), /failed its byte check/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new uploads count artist JavaScript and exclude shared libraries while reads retain the complete graph', async () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const p = newProject('Small scene', 'three');
    p.files[0].content = '<!doctype html><script type="module">import "./scene.js";</script>';
    p.files.push({ id: randomUUID(), name: 'scene.js', type: 'text/javascript', content: 'import * as THREE from "three"; document.body.textContent = new THREE.Vector3(1,2,3).length();' });
    const result = await canonicalPreview({ store, project: p, shell: await shell(), runtimeDirectory });
    assert.equal(result.uploads.creatorByteLength, p.files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0));
    assert.equal(result.uploads.sharedOriginalByteLength, 720032);
    assert.ok(result.uploads.creatorPublicationBytes > 600, 'Both entry and scene fragments are charged');
    assert.ok(result.uploads.creatorPublicationBytes < 5000);
    assert.ok(result.saver.graphByteLength > 200000, 'Full reader still reconstructs Three and the shell');
    assert.equal(result.plan.originalByteLength, result.uploads.creatorByteLength + 720032);
    assert.equal(result.published, false);
    assert.equal(result.uploads.reuseStatus, 'selected-network-verification-required');
  } finally { store.close(); }
});

test('preview cache includes runtime links and direct display resolves the same declared library', async () => {
  const store = new WorkspaceStore(':memory:');
  const service = new PreviewService({ workerPath: new URL('../src/preview-worker.mjs', import.meta.url), databasePath: ':memory:', objectDirectory: '', shell: await shell(), runtimeDirectory });
  try {
    const p = newProject('Link later');
    const before = await service.preview(p, []);
    const linked = { ...p, runtimeModules: runtimeReferences('three') };
    const after = await service.preview(linked, []);
    assert.notEqual(before.html, after.html);
    assert.equal(service.cache.size, 2);
    assert.equal(after.uploads.modules.length, 2);
    const origin = `keel-preview://${p.id}`;
    const html = directRuntimeImports('<!doctype html><html><head><script type="module">import "three";</script></head></html>', linked.runtimeModules, origin);
    assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
    assert.match(html, /three.module.min.js/);
    assert.ok(!html.includes('https://'));
  } finally { service.close(); store.close(); }
});
