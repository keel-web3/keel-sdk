import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStore, newProject } from '../src/workspace.mjs';
import { exportWorkspace, inspectArchive, mergeArchive } from '../src/workspace-exchange.mjs';
import { ConversationStore } from '../src/conversations.mjs';

test('portable exports retain source and object bytes, add project copies, and omit credential tables', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    store.db.exec("CREATE TABLE credentials (secret TEXT); INSERT INTO credentials VALUES ('never-export-this');");
    const withObject = store.importObject(Buffer.from('original object'), 'source.txt', 'text/plain', 0);
    const project = { ...newProject('My work'), objectIds: [withObject.state.objects[0].id] };
    store.save({ ...withObject.state, projects: [project] }, withObject.revision);
    const output = exportWorkspace(store); assert.ok(!output.includes('never-export-this'));
    const archive = inspectArchive(output);
    const imported = mergeArchive(store, archive, 2);
    assert.equal(imported.state.projects.length, 2);
    assert.notEqual(imported.state.projects[0].id, imported.state.projects[1].id);
    assert.equal(imported.state.projects[1].files[0].content, project.files[0].content);
    assert.equal(imported.state.objects.length, 1);
    assert.equal(store.object(project.objectIds[0]).toString(), 'original object');
    assert.throws(() => mergeArchive(store, archive, 2), /changed/);
    const corrupted = JSON.parse(output); corrupted.blobs[0].base64 = Buffer.from('corrupted').toString('base64');
    assert.throws(() => inspectArchive(JSON.stringify(corrupted)), /identity/);
    const missing = JSON.parse(output); missing.blobs = [];
    assert.throws(() => inspectArchive(JSON.stringify(missing)), /missing/);
  } finally { store.close(); }
});
test('project imports reject ambiguous file paths and missing object references', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    const project = newProject('Test');
    assert.throws(() => store.save({ ...store.read().state, projects: [{ ...project, files: [project.files[0], project.files[0]] }] }, 0), /unique/);
    assert.throws(() => store.save({ ...store.read().state, projects: [{ ...project, files: [{ ...project.files[0], name: '../escape.html' }] }] }, 0), /traversal/);
    assert.throws(() => store.save({ ...store.read().state, projects: [{ ...project, objectIds: ['a'.repeat(64)] }] }, 0), /unavailable object/);
  } finally { store.close(); }
});
test('conversations preserve provider/project boundaries and interrupted requests are not replayed', () => {
  const store = new WorkspaceStore(':memory:');
  try {
    let chat = new ConversationStore(store.db);
    const first = chat.begin('codex', undefined, 'Remember blue skies', false);
    assert.throws(() => chat.begin('codex', undefined, 'duplicate', false), /running/);
    chat.finish(first, { text: 'Blue skies remembered.' }, null);
    assert.match(chat.context('codex:workspace'), /Blue skies remembered/);
    assert.equal(chat.context('claude:workspace'), '');
    const second = chat.begin('codex', undefined, 'An unfinished message', true);
    chat = new ConversationStore(store.db);
    assert.equal(chat.list('codex:workspace').find((turn) => turn.id === second.id).status, 'interrupted');
    assert.ok(!chat.context('codex:workspace').includes('unfinished'));
    assert.equal(chat.list('codex:workspace').length, 2);
  } finally { store.close(); }
});
