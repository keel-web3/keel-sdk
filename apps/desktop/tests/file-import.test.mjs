import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { WorkspaceStore } from '../src/workspace.mjs';
import { planKeelAssetPresentation } from '@keel/sdk/presentation';

test('any file type, including a GIF over the old limit, retains exact original bytes and measured compression', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-import-gif-'));
  const store = new WorkspaceStore(path.join(directory, 'workspace.sqlite'));
  try {
    const bytes = Buffer.concat([Buffer.from('GIF89a'), randomBytes(2_000_000)]);
    const source = path.join(directory, 'artist.gif'); await writeFile(source, bytes);
    const saved = await store.importFile(source, 0); const object = saved.state.objects[0];
    assert.equal(object.type, 'image/gif'); assert.equal(object.id, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(store.object(object.id), bytes); assert.deepEqual(await readFile(source), bytes);
    const compressed = await readFile(path.join(store.objectDirectory, `${object.id}.gz`));
    assert.equal(object.compressedByteLength, compressed.length); assert.deepEqual(gunzipSync(compressed), bytes);
    assert.equal(planKeelAssetPresentation({ originalByteLength: bytes.length, compressedByteLength: compressed.length }).mode, 'hybrid');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM blobs').get().n, 0);
    await assert.rejects(store.importFile(source, 0), /changed/);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('streaming import accepts unknown files above 16 MB and empty files, and preserves them across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'keel-import-large-'));
  let store = new WorkspaceStore(path.join(directory, 'workspace.sqlite'));
  try {
    const bytes = Buffer.alloc(17 * 1024 * 1024, 97);
    const source = path.join(directory, 'world.unknown'); await writeFile(source, bytes);
    const saved = await store.importFile(source, 0); const object = saved.state.objects[0];
    assert.equal(object.type, 'application/octet-stream'); assert.equal(object.byteLength, bytes.length);
    assert.equal(planKeelAssetPresentation({ originalByteLength: object.byteLength, compressedByteLength: object.compressedByteLength }).mode, 'inline');
    const empty = path.join(directory, 'empty.bin'); await writeFile(empty, '');
    await store.importFile(empty, saved.revision);
    store.close(); store = new WorkspaceStore(path.join(directory, 'workspace.sqlite'));
    assert.deepEqual(store.object(object.id), bytes); assert.equal(store.read().state.objects.at(-1).byteLength, 0);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});
