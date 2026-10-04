import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { PreviewService } from '../src/preview-service.mjs';
import { canonicalPreview } from '../src/preview.mjs';
import { buildKeelInlineShellFragments, buildKeelCreatorOwnedInlineDocument } from '@keel/sdk/inline-viewer-graph';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-shell-choice-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  const store = new WorkspaceStore(databasePath);
  const shell = await buildKeelInlineShellFragments();
  const service = new PreviewService({ workerPath: new URL('../src/preview-worker.mjs', import.meta.url), databasePath, objectDirectory: store.objectDirectory, shell });
  t.after(() => { service.close(); store.close(); return rm(directory, { recursive: true, force: true }); });
  const source = '<!doctype html><html><meta charset="utf-8"><body>Creator π · 100% + &amp; # / =<script>globalThis.creatorShell=true</script></body></html>';
  const initial = newProject('Creator shell fixture');
  const project = { ...initial, runtimeModules: [], objectIds: [], presentation: { ...initial.presentation, payloadStorage: 'raw' }, files: [{ ...initial.files[0], name: 'index.html', type: 'text/html', content: source }] };
  return { store, shell, service, project, source };
}

test('shell switching changes worker cache and plan while creator source bytes stay exact', async t => {
  const { store, shell, service, project, source } = await fixture(t);
  const canonical = await service.preview(project, []);
  const directProject = { ...project, presentation: { ...project.presentation, shell: 'none', payloadStorage: 'raw' } };
  const custom = await service.preview(directProject, []);
  const exact = await buildKeelCreatorOwnedInlineDocument({ source: new TextEncoder().encode(source), payloadStorage: 'raw' });
  assert.match(canonical.html, /verify-corner/);
  assert.equal(canonical.plan.shell, 'registered-canonical-shell');
  assert.equal(custom.html, source);
  assert.equal(custom.byteLength, Buffer.byteLength(source));
  assert.equal(custom.plan.shell, 'creator-owned-shell');
  assert.equal(custom.plan.canonicalProtection, false);
  assert.equal(custom.publicationMeasurement.status, 'measured');
  assert.equal(custom.saver.graphByteLength, exact.graph.fragmentBytes.byteLength);
  assert.equal(custom.uploads.sharedPublicationBytes, 0);
  assert.ok(custom.saver.graphByteLength < canonical.saver.graphByteLength);
  assert.equal(service.cache.size, 2);
  assert.equal((await service.preview(project, [])).html, canonical.html);
  const hybrid = await service.preview({ ...directProject, presentation: { ...directProject.presentation, delivery: 'hybrid' } }, []);
  assert.equal(hybrid.html, source);
  assert.equal(hybrid.plan.mode, 'hybrid');
  assert.equal(hybrid.plan.canonicalProtection, false);
  assert.equal(service.cache.size, 2);
  assert.equal((await canonicalPreview({ store, shell, project: directProject })).html, source);
});

test('dependencies and direct media retain primary source without a fabricated verification graph', async t => {
  const { store, service, project } = await fixture(t);
  const html = '<!doctype html><script src="engine.js"></script><main>Direct dependencies</main>';
  const dependent = { ...project, files: [{ ...project.files[0], content: html }, { id: 'fixture-js', name: 'engine.js', type: 'text/javascript', content: 'globalThis.directEngine=true;' }], presentation: { ...project.presentation, shell: 'none' } };
  const result = await service.preview(dependent, []);
  assert.equal(result.html, html);
  assert.equal(result.publicationMeasurement.status, 'unsupported');
  assert.equal(result.saver, null);
  assert.equal(result.uploads, null);
  assert.equal(result.plan.graphByteLength, undefined);
  assert.equal(result.plan.canonicalProtection, false);
  assert.ok(result.plan.warnings.some(warning => warning.code === 'creator-owned-publication-unsupported'));
  const original = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  const saved = store.importObject(original, 'creator.gif', 'image/gif', store.read().revision);
  const object = saved.state.objects[0];
  const mediaProject = { ...project, objectIds: [object.id], presentation: { ...project.presentation, shell: 'none', entryObjectId: object.id } };
  const media = await service.preview(mediaProject, saved.state.objects);
  assert.equal(media.html, undefined);
  assert.equal(media.byteLength, original.byteLength);
  assert.equal(media.publicationMeasurement.status, 'unsupported');
  assert.equal(media.saver, null);
  assert.equal(media.plan.canonicalProtection, false);
  assert.deepEqual(store.object(object.id), original);
});
