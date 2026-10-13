import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { createMcpServer } = await import('../packages/mcp/dist/index.js');
const root = await mkdtemp(path.join(os.tmpdir(), 'keel-route-guards-')), server = await createMcpServer({ workspaceRoot: root });
await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'keel-guard-fixtures', version: '1' } } });
const advertised = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
const tools = advertised.result.tools.filter(tool => /^(keel-(inline|studio|media|creator|tezos)|publish-plan)/.test(tool.name));
let id = 2, requests = 0;
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => {
    requests++;
    throw new Error('External request is forbidden in local acceptance guard test');
};
test.after(async () => {
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
});
for (const tool of tools)
    test(`MCP ${tool.name}: malformed explicit operation fails before external request`, async () => {
        requests = 0;
        const result = await server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool.name, arguments: { __unsupportedAcceptanceField: true, operation: '__invalid_acceptance_operation__', studioUrl: 'not-a-url' } } });
        assert.ok(result.error || result.result?.isError === true, JSON.stringify(result));
        assert.equal(requests, 0, 'Malformed input must not start external I/O');
    });
test('creator collection MCP unavailable-instance route is blocked with no signing or submission', async () => {
    requests = 0;
    const result = await server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: 'keel-creator-collection-prepare', arguments: { chainId: 11155111, creator: '0x1111111111111111111111111111111111111111', instance: 'acceptance-missing-instance', creatorNonce: '0', operation: { kind: 'dedicated-erc721', config: { name: 'One of One', symbol: 'ONE', maxSupply: 1, metadataDigest: '0x' + 'a'.repeat(64) } } } } });
    assert.equal(result.error, undefined);
    assert.notEqual(result.result?.isError, true, result.result?.content?.[0]?.text);
    const p = result.result.structuredContent;
    assert.equal(p.status, 'blocked');
    assert.equal(p.walletApproval, 'not-requested');
    assert.equal(p.signing, 'not-performed');
    assert.equal(p.submission, 'not-performed');
    assert.equal(requests, 0);
});
