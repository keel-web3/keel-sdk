import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpServer } from '../packages/mcp/dist/index.js';
import { buildKeelCreatorOwnedInlineDocument } from '../packages/sdk/dist/inline-viewer-graph.js';

const initialize = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'shell-choice-test', version: '1' } };
const html = '<!doctype html><html><meta charset="utf-8"><style>body{color:#fc3}</style><main>Own π shell</main><script>globalThis.ready=true</script></html>';
const source = new TextEncoder().encode(html);

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'keel-shell-choice-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'index.html'), source);
  const server = await createMcpServer({ workspaceRoot: dir });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initialize });
  let id = 2;
  return { dir, server, call: args => server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'keel-inline-prepare', arguments: { entry: 'index.html', ...args } } }) };
}

test('MCP discovery presents shell choice separately from the shared storage default', async t => {
  const { server } = await fixture(t);
  const listed = await server.handle({ jsonrpc: '2.0', id: 30, method: 'tools/list' });
  const tool = listed.result.tools.find(tool => tool.name === 'keel-inline-prepare');
  assert.equal(tool.inputSchema.properties.viewer.default, 'keel-verification-shell');
  assert.deepEqual(tool.inputSchema.properties.viewer.enum, ['keel-verification-shell', 'none']);
  assert.equal(tool.inputSchema.properties.payloadStorage.default, 'compact');
  assert.match(tool.description, /creator-owned/);
  assert.match(tool.description, /independent/);
  const resource = await server.handle({ jsonrpc: '2.0', id: 31, method: 'resources/read', params: { uri: 'keel://mcp/publication-modes' } });
  const modes = JSON.parse(resource.result.contents[0].text);
  assert.deepEqual(modes.staging.viewerChoices, ['keel-verification-shell', 'none']);
  assert.match(modes.staging.viewerNone, /creator-owned/);
  assert.match(modes.staging.creatorHtml, /creator-owned/);
});

test('MCP creator-owned preparation has one exact carriage and zero canonical shell bytes in either storage mode', async t => {
  const { call } = await fixture(t);
  for (const payloadStorage of [undefined, 'raw']) {
    const response = await call({ viewer: 'none', ...(payloadStorage ? { payloadStorage } : {}) });
    assert.equal(response.result.isError, undefined, JSON.stringify(response));
    const result = response.result.structuredContent;
    const { graph } = await buildKeelCreatorOwnedInlineDocument({ source, payloadStorage });
    assert.equal(result.viewer, 'none');
    assert.equal(result.payloadStorage, payloadStorage ?? 'compact');
    assert.equal(result.canonicalProtection, false);
    assert.equal(result.presentationPolicy, 'raw-artifact');
    assert.deepEqual(result.shell, { prefixBytes: 0, suffixBytes: 0 });
    assert.equal(result.storage.sharedBytes, 0);
    assert.equal(result.storage.creatorSourceBytes, source.byteLength);
    assert.equal(result.tokenURIBytes, graph.fragmentBytes.byteLength);
    assert.deepEqual(result.fragmentIntegrity, graph.fragmentIntegrity);
    assert.equal(result.storage.completeDocumentBase64Layers, 0);
  }
});

test('MCP keeps the default verification shell and rejects incompatible creator-owned declarations', async t => {
  const { call } = await fixture(t);
  const response = await call({ entryMediaType: 'text/html', repositoryRoot: fileURLToPath(new URL('..', import.meta.url)) });
  assert.equal(response.result.isError, undefined, JSON.stringify(response));
  assert.equal(response.result.structuredContent.viewer, 'keel-verification-shell');
  assert.equal(response.result.structuredContent.canonicalProtection, true);
  assert.ok(response.result.structuredContent.shell.prefixBytes > 0);
  for (const candidate of [
    { viewer: 'none', presentationPolicy: 'collector-inline' },
    { viewer: 'none', assets: [{ assetId: 'dependency', path: 'index.html', mediaType: 'text/html' }] },
    { viewer: 'none', entryMediaType: 'text/javascript' },
    { viewer: 'unknown' },
  ]) {
    const rejected = await call(candidate);
    assert.equal(rejected.result.isError, true, JSON.stringify(rejected));
    assert.match(rejected.result.content[0].text, /creator-owned|self-contained|viewer/i);
  }
});
