import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { PreviewService } from '../src/preview-service.mjs';
import { canonicalPreview } from '../src/preview.mjs';

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-preview-worker-'));
  const databasePath = path.join(directory, 'workspace.sqlite');
  const store = new WorkspaceStore(databasePath);
  const shell = JSON.parse(await readFile(new URL('../dist/canonical-shell.json', import.meta.url), 'utf8'));
  for (const part of ['prefix', 'suffix']) shell[part].bytes = Buffer.from(shell[part].bytes, 'base64');
  const service = new PreviewService({ workerPath: new URL('../src/preview-worker.mjs', import.meta.url), databasePath, objectDirectory: store.objectDirectory, shell, ...options });
  return { store, service, shell, close: async () => { service.close(); store.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('worker preserves the canonical graph and shares builds across unrelated edits and delivery choices', async () => {
  const fixtureValue = await fixture();
  const { store, service, shell } = fixtureValue;
  try {
    const project = newProject('Worker preview');
    const first = service.preview(project, []);
    const same = service.preview({ ...project, notes: 'A note', targetNetworkId: project.id }, []);
    assert.equal(service.pending.size, 1);
    const [result, reused] = await Promise.all([first, same]);
    const direct = await canonicalPreview({ store, project, shell });
    assert.equal(result.html, direct.html);
    assert.equal(reused.html, result.html);
    assert.equal(result.published, false);
    assert.equal(result.saver.carriage, "raw-percent");
    assert.equal(result.saver.completeDocumentBase64Layers, 0);
    assert.equal(result.plan.graphByteLength, result.saver.graphByteLength);
    assert.ok(result.saver.creatorPublicationBytes < result.saver.graphByteLength);
    assert.equal(service.cache.size, 1);
    const hybrid = await service.preview({ ...project, presentation: { shell: 'none', delivery: 'hybrid' } }, []);
    assert.equal(hybrid.html, result.html);
    assert.equal(hybrid.plan.mode, 'hybrid');
    assert.equal(service.cache.size, 1);
    const changed = { ...project, files: [{ ...project.files[0], content: '<!doctype html><h1>A changed work</h1>' }] };
    assert.notEqual((await service.preview(changed, [])).html, result.html);
    assert.equal(service.cache.size, 2);
  } finally { await fixtureValue.close(); }
});

test('a failed integrity check is retried after original bytes are restored', async () => {
  const fixtureValue = await fixture();
  const { store, service } = fixtureValue;
  try {
    const original = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const state = store.importObject(original, 'original.gif', 'image/gif', 0);
    const object = state.state.objects[0];
    const project = { ...newProject('Restored original'), objectIds: [object.id], presentation: { shell: 'canonical', delivery: 'auto', entryObjectId: object.id } };
    store.db.prepare('UPDATE blobs SET bytes=? WHERE id=?').run(Buffer.from('corrupted'), object.id);
    await assert.rejects(service.preview(project, state.state.objects), /digest/);
    assert.equal(service.cache.size, 0);
    assert.equal(service.pending.size, 0);
    store.db.prepare('UPDATE blobs SET bytes=? WHERE id=?').run(original, object.id);
    const result = await service.preview(project, state.state.objects);
    assert.equal(result.plan.originalByteLength, original.length);
    assert.match(result.html, /verify-seal/);
  } finally { await fixtureValue.close(); }
});

test('preview queue, cache bytes, failure recovery and shutdown stay bounded', async () => {
  const fixtureValue = await fixture({ maxBytes: 1, maxPending: 1 });
  const { service } = fixtureValue;
  try {
    const project = newProject('Bounded');
    const pending = service.preview(project, []);
    const other = { ...project, files: [{ ...project.files[0], content: '<h1>Another preview</h1>' }] };
    await assert.rejects(service.preview(other, []), /Other previews/);
    await pending;
    assert.equal(service.cache.size, 0);
    assert.equal(service.cacheBytes, 0);
    const interrupted = service.preview(other, []);
    const failed = assert.rejects(interrupted, /stopped/);
    await service.worker.terminate();
    await failed;
    assert.equal(service.pending.size, 0);
    assert.ok((await service.preview(other, [])).html);
    const closing = service.preview(project, []);
    const closed = assert.rejects(closing, /closed/);
    service.close();
    await closed;
    await assert.rejects(service.preview(project, []), /closed/);
  } finally { await fixtureValue.close(); }
});
test('layer changes reach the worker and invalidate the canonical preview cache',async()=>{
 const {newLayeredArt,defaultPlacement}=await import('@keel/sdk/layered-art');const {runtimeReferences}=await import('../src/runtime-library.mjs');const fixtureValue=await fixture({runtimeDirectory:path.resolve(new URL('../dist/runtime-modules',import.meta.url).pathname)});const {store,service}=fixtureValue;
 try{const bytes=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');const saved=store.importObject(bytes,'layer.gif','image/gif',0),id=saved.state.objects[0].id;const layered={...newLayeredArt(),attributes:[{id:'a',name:'A',items:[{id:'i',name:'I',weight:1,variants:[{id:'v',name:'V',objectId:id,weight:1}],placements:[defaultPlacement()],rules:[],usage:{scope:'public',renderer:'',license:'CC0',tags:[]}}]}]};const project={...newProject('Layers'),files:[],objectIds:[id],runtimeModules:runtimeReferences('layered'),layered};const first=await service.preview(project,saved.state.objects);const second=await service.preview({...project,layered:{...layered,seed:'changed'}},saved.state.objects);assert.notEqual(first.html,second.html);assert.equal(service.cache.size,2);assert.equal(first.published,false);
 }finally{await fixtureValue.close();}
});
