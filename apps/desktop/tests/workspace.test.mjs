import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { resolveRuntimeReferences, runtimeReferences } from '../src/runtime-library.mjs';

test('a missing pinned runtime does not lock the workspace or silently replace saved code', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const old = { ...newProject('Older layered project'), runtimeModules: [{ ...runtimeReferences('layered')[0], digest: `0x${'a'.repeat(64)}` }] };
    const other = newProject('Other artwork');
    // A pre-update workspace can contain an identity absent from this install.
    store.db.prepare('UPDATE workspace SET body=? WHERE id=1').run(JSON.stringify({ ...store.read().state, projects: [old, other] }));
    store.snapshot = null;
    const loaded = store.read();
    assert.deepEqual(loaded.state.projects[0].runtimeModules, old.runtimeModules);
    assert.throws(() => resolveRuntimeReferences(old.runtimeModules), /pinned identity/);
    const saved = store.save({ ...loaded.state, projects: loaded.state.projects.map(p => ({ ...p, notes: 'Preserved and editable' })) }, loaded.revision);
    assert.deepEqual(saved.state.projects[0].runtimeModules, old.runtimeModules);
    assert.throws(() => store.save({ ...saved.state, projects: [...saved.state.projects, { ...old, id: newProject('New').id }] }, saved.revision), /pinned identity/);
    const repaired = store.save({ ...saved.state, projects: saved.state.projects.map(p => p.id === old.id ? { ...p, runtimeModules: runtimeReferences('layered') } : p) }, saved.revision);
    assert.deepEqual(repaired.state.projects[0].runtimeModules, runtimeReferences('layered'));
    assert.equal(repaired.state.projects[1].notes, 'Preserved and editable');
  } finally { store.close(); }
});
test('workspace survives restart and rejects stale updates without overwriting saved work', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-desktop-store-'));
  let store = new WorkspaceStore(path.join(dir, 'workspace.sqlite'));
  try {
    const first = store.read(); const project = newProject('A remembered world');
    const saved = store.save({ ...first.state, projects: [project] }, first.revision);
    assert.equal(saved.revision, 1);
    assert.throws(() => store.save(first.state, first.revision), /changed/);
    store.close(); store = new WorkspaceStore(path.join(dir, 'workspace.sqlite'));
    assert.equal(store.read().state.projects[0].title, project.title);
    assert.equal(store.read().state.projects[0].files[0].content, project.files[0].content);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('object imports deduplicate by bytes, survive restart, and stale imports roll back', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const saved = store.importObject(Buffer.from('creator bytes'), 'original.txt', 'text/plain', 0);
    const id = saved.state.objects[0].id;
    const again = store.importObject(Buffer.from('creator bytes'), 'renamed.txt', 'text/plain', 1);
    assert.equal(again.state.objects.length, 1);
    assert.equal(store.object(id).toString(), 'creator bytes');
    assert.throws(() => store.importObject(Buffer.from('other bytes'), 'stale.txt', 'text/plain', 1), /changed/);
    assert.equal(store.read().revision, 2);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM blobs').get().count, 1);
  } finally { store.close(); }
});
test('public memory schema rejects credentials as wallet fields and duplicated identities', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const { state } = store.read(); const project = newProject('Unique');
    assert.throws(() => store.save({ ...state, projects: [project, project] }, 0), /Duplicate/);
    assert.throws(() => store.save({ ...state, privateKey: 'secret' }, 0));
    assert.throws(() => store.save({ ...state, wallets: [{ id: project.id, label: 'bad', family: 'ethereum', address: 'a private key or seed phrase' }] }, 0));
    assert.equal(store.read().revision, 0);
  } finally { store.close(); }
});

test('cached snapshots are immutable and observe other writers and rolled-back revisions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-desktop-snapshot-'));
  const database = path.join(directory, 'workspace.sqlite');
  const first = new WorkspaceStore(database);
  const second = new WorkspaceStore(database);
  try {
    const initial = first.read();
    assert.strictEqual(first.read(), initial);
    assert.throws(() => initial.state.projects.push(newProject('Accidental mutation')), TypeError);
    const saved = second.save({ ...initial.state, projects: [newProject('Another writer')] }, 0);
    const observed = first.read();
    assert.equal(observed.revision, saved.revision);
    assert.equal(observed.state.projects[0].title, 'Another writer');
    assert.throws(() => { observed.state.projects[0].files[0].content = 'unsaved'; }, TypeError);
    first.db.exec('BEGIN IMMEDIATE');
    first.save({ ...observed.state, memories: [{ id: observed.state.projects[0].id, title: 'Temporary', content: 'Rolled back' }] }, observed.revision);
    first.db.exec('ROLLBACK');
    assert.equal(first.read().revision, observed.revision);
    assert.equal(first.read().state.memories.length, 0);
    assert.throws(() => first.save(initial.state, initial.revision), /changed/);
  } finally { first.close(); second.close(); await rm(directory, { recursive: true, force: true }); }
});
