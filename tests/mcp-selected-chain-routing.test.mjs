import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createMcpServer } from '../packages/mcp/dist/server.js';
import { KEEL_BUNDLED_NETWORK_INDEX, buildKeelNetworkIndex } from '../packages/sdk/dist/network-index.js';
import { validateKeelStudioAgentReleaseDraft } from '../packages/sdk/dist/studio-agent-drafts.js';

const chainId = 84532, releaseId = '11111111-1111-4111-8111-111111111111', operationId = '22222222-2222-4222-8222-222222222222';
const draft = { artifactId: null, chainId, title: 'Chain routing fixture', description: '', story: '', releaseType: 'one-of-one', accessMode: 'public', supply: '1', priceEth: '0', maxPerTransaction: 1, maxPerWallet: 1, startsAt: null, endsAt: null, networkLabel: 'Display label only', payoutAddress: null, page: {} };
const init = { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'selected-chain-fixture', version: '1' } };

test('MCP explicit chain shares discovery, preparation and bounded RPC fallback without Sepolia leakage', async () => {
  const root = await mkdtemp('/tmp/keel-mcp-chain-'), previous = globalThis.fetch, calls = [];
  // Synthetic index records: these are routing fixtures, never deployment proof.
  const records = KEEL_BUNDLED_NETWORK_INDEX.networks[0].deployments.filter(d => d.instance === 'creator-inline-20261005').map(d => ({ ...d, chainId, instance: 'fixture-creator' }));
  const index = buildKeelNetworkIndex(records, { defaultChainId: chainId, networks: [{ chainId, name: 'Fixture L2 testnet', environment: 'testnet', defaultInstance: 'fixture-creator', rpcUrls: ['https://wrong.example/rpc', 'https://chosen.example/rpc'] }] });
  try {
    await mkdir(root+'/.keel'); await writeFile(root+'/.keel/config.json', JSON.stringify({ chainId: 11155111, indexUrl: 'https://routing-index.example/network' }));
    await writeFile(root+'/.keel/rpc.json', JSON.stringify({ chainId: 11155111, rpcUrls: ['https://old-sepolia.example/private-key'], minIntervalMs: 0 }));
    globalThis.fetch = async (url, request) => {
      if (String(url) === 'https://routing-index.example/network') return Response.json(index);
      const body = JSON.parse(request.body); calls.push({ url: String(url), method: body.method });
      assert.ok(!/send|sign/u.test(body.method));
      const result = body.method === 'eth_chainId' ? String(url).includes('wrong.') ? '0x1' : '0x14a34' : body.method === 'eth_blockNumber' ? '0x123' : '0x'+'0'.repeat(63)+'7';
      return Response.json({ jsonrpc: '2.0', id: body.id, result });
    };
    const server = await createMcpServer({ workspaceRoot: root, pluginConfig: false }); await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: init });
    let id = 0;
    const call = async (name, args) => { const r = (await server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })).result; assert.equal(r.isError, undefined, JSON.stringify(r)); return r.structuredContent; };
    const endpoints = await call('keel-endpoint-config', { chainId });
    assert.equal(endpoints.chainId, chainId); assert.deepEqual(endpoints.publicRpcUrls, ['https://wrong.example/…', 'https://chosen.example/…']);
    const found = await call('keel-network-discover', { chainId }); assert.equal(found.selected.creator.chainId, chainId); assert.equal(found.verification, 'recorded-not-live-verified');
    const checked = await call('keel-rpc-check', { chainId }); assert.equal(checked.chainId, chainId);
    const data = await call('keel-onchain-data-prepare', { chainId, reads: [{ name: 'supply', address: '0x'+'1'.repeat(40), signature: 'totalSupply()', returns: ['uint256'] }] });
    assert.equal(data.chainId, chainId); assert.equal(data.values.supply, 7);
    await writeFile(root+'/work.html', '<p>Fixture artwork</p>'); await writeFile(root+'/poster.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const prepared = await call('keel-creator-inline-prepare', { chainId, resources: [{ id: 'work', path: 'work.html', mediaType: 'text/html', role: 'entrypoint' }], posterPath: 'poster.svg', posterMediaType: 'image/svg+xml', out: 'plan.json' });
    assert.equal(prepared.chainId, chainId); assert.equal(prepared.deployment.instance, 'fixture-creator'); assert.equal(prepared.status, 'review-only'); assert.equal(prepared.completeTokenURIBytes, null);
    assert.ok(prepared.requiredGates.length > 0); assert.ok(calls.every(c => !c.url.includes('old-sepolia')));
    assert.deepEqual(calls.filter(c => c.url.includes('wrong.')).map(c => c.method), ['eth_chainId']);
  } finally { globalThis.fetch = previous; await rm(root, { recursive: true, force: true }); }
});

test('MCP create, update, review and pending diagnostics preserve exact chain and revision without local RPC replay', async () => {
  const previous = { fetch: globalThis.fetch, token: process.env.KEEL_STUDIO_AGENT_TOKEN, origin: process.env.KEEL_STUDIO_URL, rpc: process.env.KEEL_RPC_URL };
  const requests = [], wallet = '0x'+'1'.repeat(40);
  process.env.KEEL_STUDIO_URL = 'https://studio.example'; process.env.KEEL_STUDIO_AGENT_TOKEN = `keel_agent_${'z'.repeat(48)}`; process.env.KEEL_RPC_URL = 'https://private-provider.example/local-key';
  globalThis.fetch = async (url, request) => {
    assert.ok(String(url).startsWith('https://studio.example/api/agent/')); requests.push({ url: String(url), body: request.body && JSON.parse(request.body) });
    if (String(url).endsWith('/review')) return Response.json({ schema: 'keel-release-wallet-review@1', releaseId, revision: 2, wallet, preparation: { operationId, chainId, calls: [{ kind: 'fixture-call', to: wallet, data: '0x00', value: '0' }] }, signing: 'not-performed', submission: 'not-performed' });
    if (String(url).includes('/diagnostics')) return Response.json({ schema: 'keel-release-diagnostics@1', releaseId, chainId, revision: 2, status: 'resume-saved-operation', message: 'Await the existing receipt', actions: ['await-receipt'], storageEvidence: [{ resourceId: 'paid-10', status: 'complete', chainId, transactionHashes: [] }], signing: 'not-performed', submission: 'not-performed', uploadedBytes: 0, changed: false });
    return Response.json({ ...draft, id: releaseId, revision: request.method === 'PATCH' ? 2 : 1, status: 'draft', slug: 'fixture' });
  };
  try {
    const server = await createMcpServer({ pluginConfig: false }); await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: init }); let id = 0;
    const call = async args => { const r = (await server.handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'keel-studio-draft', arguments: args } })).result; assert.equal(r.isError, undefined, JSON.stringify(r)); return r.structuredContent; };
    assert.equal((await call({ operation: 'create', draft })).chainId, chainId); assert.equal(requests[0].body.chainId, chainId);
    assert.equal((await call({ operation: 'update', releaseId, draft, expectedRevision: 1 })).revision, 2); assert.equal(requests[1].body.draft.chainId, chainId);
    const review = await call({ operation: 'prepare-review', releaseId, expectedRevision: 2 }); assert.equal(review.preparation.chainId, chainId);
    const status = await call({ operation: 'diagnose', releaseId }); assert.equal(status.chainId, chainId); assert.equal(status.status, 'resume-saved-operation'); assert.equal(status.storageEvidence[0].resourceId, 'paid-10');
    assert.equal(requests.length, 4); assert.ok(!JSON.stringify(requests).includes('local-key'));
    for (const chainId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER+1, '84532']) assert.throws(() => validateKeelStudioAgentReleaseDraft({ ...draft, chainId }), /chainId/u);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [['KEEL_STUDIO_AGENT_TOKEN', previous.token], ['KEEL_STUDIO_URL', previous.origin], ['KEEL_RPC_URL', previous.rpc]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
