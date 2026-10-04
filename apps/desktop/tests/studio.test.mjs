import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectStudio, searchStudio, studioUrl } from '../src/studio.mjs';

export const capabilities = { schema: 'keel-studio-capabilities@2', generatedAt: '2026-09-07T00:00:00.000Z', chainId: 11155111, staging: { endpoint: '/api/agent/staging', transport: 'multipart-form-data', authentication: 'bearer', maxSourceBytes: 1000000, maximumRetentionSeconds: 3600, resumable: false, oneUseHandoff: false }, wallet: { signing: false, submission: false }, publication: { readiness: 'requires-project-verification', canonicalShellRequired: true } };
test('Studio capability and shared MCP discovery work through real bounded HTTP reads', async () => {
  let moduleFailure = false;
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, undefined);
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/.well-known/')) response.end(JSON.stringify(capabilities));
    else if (request.url.startsWith('/api/library')) response.end(JSON.stringify({ assets: [{ name: 'Shared palette', chainId: 11155111, assetId: '0x123', license: 'test license' }] }));
    else if (moduleFailure) { response.statusCode = 503; response.end('unavailable'); }
    else response.end(JSON.stringify({ modules: [{ name: 'Shared palette helpers', version: '1.0.0' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await inspectStudio(base)).capabilities.chainId, 11155111);
    const found = await searchStudio(base, 'palette');
    assert.equal(found.status, 'ok'); assert.equal(found.library[0].name, 'Shared palette');
    assert.equal(found.reuse.status, 'needs-selection');
    moduleFailure = true;
    const partial = await searchStudio(base, 'palette');
    assert.equal(partial.status, 'partial'); assert.equal(partial.reuse.status, 'incomplete-search');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test('Studio connection rejects unsafe origins and oversized capability documents', async () => {
  assert.throws(() => studioUrl('https://example.com/private?token=secret'), /origin/);
  assert.throws(() => studioUrl('http://example.com'), /HTTPS/);
  assert.throws(() => studioUrl('https://user:secret@example.com'), /HTTPS/);
  await assert.rejects(inspectStudio('https://example.com', async () => new Response(' '.repeat(512001))), /too large/);
});
