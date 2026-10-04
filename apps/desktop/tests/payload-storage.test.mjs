import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore, newProject, projectSchema } from '../src/workspace.mjs';
import { canonicalPreview } from '../src/preview.mjs';
import { PreviewService } from '../src/preview-service.mjs';
import { GameEngineService } from '../src/game-engine/game-engine-service.mjs';

test('editor persists Compact default and explicit Raw across workspace reopen', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-mode-workspace-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = path.join(dir, 'workspace.sqlite');
  const project = newProject('Raw fixture');
  assert.equal(project.presentation.payloadStorage, 'compact');
  const raw = projectSchema.parse({ ...project, presentation: { ...project.presentation, payloadStorage: 'raw' } });
  let store = new WorkspaceStore(database);
  store.save({ ...store.read().state, projects: [raw] }, store.read().revision);
  store.close();
  store = new WorkspaceStore(database);
  assert.equal(store.read().state.projects.find(p => p.id === project.id).presentation.payloadStorage, 'raw');
  store.close();
  assert.throws(() => projectSchema.parse({ ...project, presentation: { ...project.presentation, payloadStorage: 'encoded' } }));
});

test('editor mode changes actual binary slot and measurements, then invalidates preview cache', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-mode-preview-'));
  const database = path.join(dir, 'workspace.sqlite');
  const store = new WorkspaceStore(database);
  const shell = JSON.parse(await readFile(new URL('../dist/canonical-shell.json', import.meta.url), 'utf8'));
  for (const side of ['prefix', 'suffix']) shell[side].bytes = Buffer.from(shell[side].bytes, 'base64');
  const service = new PreviewService({ workerPath: new URL('../src/preview-worker.mjs', import.meta.url), databasePath: database, objectDirectory: store.objectDirectory, shell });
  t.after(async () => { service.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const binary = Buffer.alloc(8192, 0xff);
  const saved = store.importObject(binary, 'fixture.bin', 'application/octet-stream', store.read().revision);
  const project = { ...newProject('Binary fixture'), objectIds: [saved.state.objects[0].id] };
  const compact = await service.preview(project, saved.state.objects);
  const rawProject = { ...project, presentation: { ...project.presentation, payloadStorage: 'raw' } };
  const raw = await service.preview(rawProject, saved.state.objects);
  assert.equal(compact.payloadStorage, 'compact');
  assert.equal(raw.payloadStorage, 'raw');
  assert.notEqual(raw.html, compact.html);
  assert.ok(compact.uploads.creatorCompressedByteLength < raw.uploads.creatorCompressedByteLength);
  assert.equal(service.cache.size, 2);
  assert.equal((await canonicalPreview({ store, project: rawProject, shell })).html, raw.html);
  assert.equal((await service.preview(project, saved.state.objects)).html, compact.html);
});

test('game build cache forwards effective storage choice without mixing modes', async () => {
  const service = new GameEngineService({ workerPath: '/unused', root: '/unused' });
  const calls = [];
  service.current = async () => 'fixed-fixture';
  service.call = async (op, value) => { calls.push({ op, value }); return { html: new Uint8Array([1]), payloadStorage: value.payloadStorage }; };
  await service.build('fixtures/hello');
  await service.build('fixtures/hello', { payloadStorage: 'raw' });
  await service.build('fixtures/hello');
  assert.deepEqual(calls.map(c => c.value.payloadStorage), ['compact', 'raw']);
  assert.equal(service.cache.size, 2);
  service.close();
});

test('game preview and measurement never replace an explicitly chosen creator shell with the engine verification shell', async () => {
  const service = new GameEngineService({ workerPath: '/unused', root: '/unused' });
  let builds = 0;
  service.build = async () => { builds++; throw Error('Unexpected verification build'); };
  const project = { game: { id: 'fixtures/hello' }, presentation: { shell: 'none', payloadStorage: 'raw' } };
  await assert.rejects(service.document(project), /creator-owned.*compatible.*reader/i);
  await assert.rejects(service.presentation(project), /creator-owned.*compatible.*reader/i);
  assert.equal(builds, 0);
  service.close();
});
