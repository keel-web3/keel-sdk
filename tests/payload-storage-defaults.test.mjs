import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { KEEL_DEFAULT_PAYLOAD_STORAGE, resolveKeelPayloadStorage, resolveKeelPayloadCompression, createIntegrity } from '../packages/protocol/dist/index.js';
import { createUploadPlan, createRecursiveUploadPlan, decompressBytes } from '../packages/builder/dist/index.js';
import { prepareStudioArtifact } from '../packages/studio-core/dist/index.js';
import { stageKeelStudioProject } from '../packages/sdk/dist/studio-upload.js';
import { buildKeelInlineLocalDocument, buildKeelInlineShellFragments } from '../packages/sdk/dist/inline-viewer-graph.js';
import { createMcpServer } from '../packages/mcp/dist/index.js';

const input = Uint8Array.from({ length: 32_768 }, (_, i) => i % 7 === 0 ? 255 : i % 31);
const initialize = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'payload-storage-regression', version: '1' } };

test('one shared default and explicit Raw reject stale/invalid overrides', () => {
  assert.equal(KEEL_DEFAULT_PAYLOAD_STORAGE, 'compact');
  assert.equal(resolveKeelPayloadStorage(), 'compact');
  assert.equal(resolveKeelPayloadStorage('raw'), 'raw');
  assert.equal(resolveKeelPayloadCompression('raw', 'auto'), 'none');
  assert.throws(() => resolveKeelPayloadCompression('raw', 'gzip'), /Raw payload storage/);
  assert.throws(() => resolveKeelPayloadStorage('base64'), /compact or raw/);
});

test('flat and recursive plans store native bytes once; Raw is byte-identical', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-storage-plans-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, create] of [['flat', createUploadPlan], ['recursive', createRecursiveUploadPlan]]) {
    for (const mode of [undefined, 'compact', 'raw']) {
      const out = path.join(dir, name, String(mode));
      const plan = await create(input, { objectName: 'native', mediaType: 'application/octet-stream', outputDirectory: out, ...(mode ? { payloadStorage: mode } : {}) });
      const leaves = plan.objects ? plan.objects.filter(o => o.kind === 'leaf') : [plan];
      const reconstructed = [];
      for (const leaf of leaves) {
        const stored = Buffer.concat(await Promise.all(leaf.chunks.map(chunk => readFile(path.join(out, chunk.file)))));
        assert.equal(stored.byteLength, leaf.storedByteLength);
        reconstructed.push(await decompressBytes(leaf.compression, stored));
        if (mode === 'raw') { assert.equal(leaf.compression, 'none'); assert.equal(stored.byteLength, leaf.integrity.byteLength); }
        else assert.ok(stored.byteLength < leaf.integrity.byteLength);
      }
      assert.deepEqual(new Uint8Array(Buffer.concat(reconstructed)), input);
    }
  }
  const entropy = randomBytes(4096);
  const plan = await createUploadPlan(entropy, { objectName: 'entropy', mediaType: 'application/octet-stream', outputDirectory: path.join(dir, 'entropy') });
  assert.equal(plan.compression, 'none');
  assert.equal(plan.storedByteLength, entropy.length);
});

test('Studio-core records the effective mode and preserves supplied binary/UTF-8', async () => {
  const options = { id: 'storage-fixture', name: 'Native fixture', createdAt: '2026-10-03T00:00:00.000Z', assets: [
    { id: 'entry', fileName: 'index.html', mediaType: 'text/html', role: 'entrypoint', entrypoint: true, bytes: new TextEncoder().encode('<main>Original</main>') },
    { id: 'data', fileName: 'data.bin', mediaType: 'application/octet-stream', role: 'data', bytes: input },
  ] };
  const compact = await prepareStudioArtifact(options);
  const raw = await prepareStudioArtifact({ ...options, payloadStorage: 'raw', extensions: { 'keel:payload-storage': { mode: 'compact' } } });
  assert.equal(compact.manifest.extensions['keel:payload-storage'].mode, 'compact');
  assert.equal(raw.manifest.extensions['keel:payload-storage'].mode, 'raw');
  assert.ok(compact.resources.find(r => r.resource.id === 'data').storedBytes.byteLength < input.byteLength);
  assert.deepEqual(raw.resources.find(r => r.resource.id === 'data').storedBytes, input);
  assert.equal(raw.resources.find(r => r.resource.id === 'data').compression, 'none');
  assert.equal(raw.resources.find(r => r.resource.id === 'entry').compression, 'none');
});

test('SDK handoff carries storage and shell choices independently', async () => {
  for (const viewer of [undefined, 'none']) for (const mode of [undefined, 'raw']) {
    let body;
    await stageKeelStudioProject({ studioUrl: 'https://studio.example', agentToken: 'x'.repeat(48), title: 'Storage fixture', description: '', storageStrategy: 'onchain',
      ...(mode ? { payloadStorage: mode } : {}), ...(viewer ? { viewer } : {}), files: [{ path: 'index.html', bytes: new TextEncoder().encode('<main>Exact</main>'), mediaType: 'text/html', role: 'entrypoint', format: 'asset' }],
      fetchImplementation: async (_url, init) => { body = init.body; return Response.json({ schema: 'keel-studio-project-handoff@1', id: 'handoff-1', handoffUrl: 'https://studio.example/studio/projects/new?handoff=fixture', expiresAt: '2026-10-04T00:00:00.000Z', fileCount: 1, totalBytes: 18, wallet: { signing: 'not-performed', submission: 'not-performed' } }); },
    });
    const metadata = JSON.parse(body.get('metadata'));
    assert.equal(metadata.payloadStorage, mode ?? 'compact');
    assert.equal(metadata.viewer, viewer ?? 'keel-verification-shell');
    if (viewer === 'none') assert.equal(metadata.publicationIntent, undefined);
    else assert.equal(metadata.publicationIntent.viewer.required, true);
  }
});

test('Inline local slots honor Raw, no-growth Compact, and parent Raw precedence', async () => {
  const shell = await buildKeelInlineShellFragments();
  const base = { shell, modules: [], entry: { id: 'entry', mediaType: 'text/html', source: new TextEncoder().encode('<main>Fixture</main>') } };
  const asset = { id: 'data', mediaType: 'application/octet-stream', source: input };
  const slot = doc => JSON.parse(new TextDecoder().decode(doc.parts.find(p => p.role === 'asset').bytes).slice(1)).embedded;
  const compact = slot(await buildKeelInlineLocalDocument({ ...base, assets: [asset] }));
  const raw = slot(await buildKeelInlineLocalDocument({ ...base, payloadStorage: 'raw', assets: [asset] }));
  assert.equal(compact.compression, 'gzip');
  assert.ok(compact.storedIntegrity.byteLength < input.length);
  assert.equal(raw.compression, 'none');
  assert.deepEqual(new Uint8Array(Buffer.from(raw.storedBase64, 'base64')), input);
  const tiny = slot(await buildKeelInlineLocalDocument({ ...base, assets: [{ ...asset, source: new Uint8Array([0, 255, 1]) }] }));
  assert.equal(tiny.compression, 'none');
  await assert.rejects(buildKeelInlineLocalDocument({ ...base, payloadStorage: 'raw', assets: [{ ...asset, payloadStorage: 'compact' }] }), /cannot override Raw/);
  await assert.rejects(buildKeelInlineLocalDocument({ ...base, payloadStorage: 'raw', assets: [{ ...asset, compression: 'gzip' }] }), /Raw payload storage/);
});

test('MCP handshake, tool schemas, and native upload planning share the real default', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-storage-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'native.bin'), input);
  const server = await createMcpServer({ workspaceRoot: dir });
  const init = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initialize });
  assert.match(init.result.instructions, /payloadStorage is compact/);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  for (const name of ['upload-plan', 'cost', 'keel-inline-prepare', 'keel-studio-stage-project']) {
    assert.equal(listed.result.tools.find(t => t.name === name).inputSchema.properties.payloadStorage.default, 'compact');
  }
  let id = 3;
  for (const mode of [undefined, 'raw']) {
    const result = await server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'upload-plan', arguments: { input: 'native.bin', objectName: 'native', mediaType: 'application/octet-stream', ...(mode ? { payloadStorage: mode } : {}) } } });
    assert.equal(result.result.isError, undefined, JSON.stringify(result));
    const value = result.result.structuredContent;
    assert.equal(value.payloadStorage, mode ?? 'compact');
    assert.equal(value.storageEncoding, 'native-bytes');
    if (mode === 'raw') { assert.equal(value.plan.compression, 'none'); assert.equal(value.plan.storedByteLength, input.length); }
    else assert.ok(value.plan.storedByteLength < input.length);
  }
});
