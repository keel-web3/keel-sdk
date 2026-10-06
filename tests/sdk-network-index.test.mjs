import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { buildKeelNetworkIndex, parseKeelNetworkIndex, resolveKeelCreatorTarget, resolveKeelIndexedNetwork, fetchKeelNetworkIndex, KeelNetworkIndexError, KEEL_BUNDLED_NETWORK_INDEX } from '../packages/sdk/dist/network-index.js';
import { discoverKeelNodeNetworks, readKeelNetworkConfiguration, resolveKeelNodeNetworkSelection } from '../packages/sdk/dist/network-node.js';
import { createKeelNodeRpc } from '../packages/sdk/dist/rpc-node.js';
import { resolveKeelRpcConfiguration, createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { verifyKeelIndexedCreator } from '../packages/sdk/dist/network-verification.js';
import { createMcpServer } from '../packages/mcp/dist/server.js';
import { keccak256 } from 'viem';

const snapshot = KEEL_BUNDLED_NETWORK_INDEX;
const clone = () => structuredClone(snapshot);
const response = value => async () => Response.json(value);

test('deployed network catalog derives from actual records, not wallet/faucet support', () => {
  assert.deepEqual(snapshot.networks.map(n => n.chainId), [11155111]);
  assert.equal(snapshot.networks[0].deployments.length, 58);
  const creator = resolveKeelCreatorTarget(snapshot);
  assert.equal(creator.instance, 'creator-inline-20261005');
  assert.equal(creator.deployments.length, 15);
  assert.equal(creator.factory, '0x5828eBA761ab5eA72A349284da5658AD0ECD8416');
  assert.throws(() => resolveKeelIndexedNetwork(snapshot, { chainId: 84532 }), /no indexed deployments/u);
});

test('a newly recorded chain is discovered/configured without changing resolver code', () => {
  const extra = snapshot.networks[0].deployments.filter(d => d.instance === 'creator-inline-20261005').map(d => ({ ...d, chainId: 12345, instance: 'new-creator' }));
  const index = buildKeelNetworkIndex(extra, { defaultChainId: 12345, networks: [{ chainId: 12345, name: 'Another EVM testnet', environment: 'testnet', defaultInstance: 'new-creator', rpcUrls: ['https://new-chain.example/rpc'] }] });
  assert.equal(resolveKeelCreatorTarget(index).chainId, 12345);
  assert.equal(resolveKeelRpcConfiguration({}, {}, {}, index).chainId, 12345);
  assert.deepEqual(resolveKeelRpcConfiguration({}, { KEEL_SEPOLIA_RPC_URL: 'https://wrong-chain.example' }, {}, index).rpcUrls, ['https://new-chain.example/rpc']);
  assert.throws(() => resolveKeelRpcConfiguration({ chainId: 12345 }, {}, {}, snapshot), /no public RPC pool/u);
});

test('index change selects a different creator instance rather than a hardcoded date', () => {
  const index = clone();
  const alternate = index.networks[0].deployments.filter(d => d.instance === 'creator-inline-20261005').map(d => ({ ...d, instance: 'next-creator', address: d.contract === 'KeelHold' ? '0x'+'2'.repeat(40) : d.address }));
  index.networks[0].deployments.push(...alternate); index.networks[0].defaultInstance = 'next-creator';
  assert.equal(resolveKeelCreatorTarget(parseKeelNetworkIndex(index)).store, '0x'+'2'.repeat(40));
  assert.equal(resolveKeelCreatorTarget(parseKeelNetworkIndex(index), { instance: 'creator-inline-20261005' }).store, '0xD820e337692A6Eb7a4878e42ce88CBCFF49B55CF');
});

test('malformed, conflicting, cross-chain and empty deployment indexes are refused', async () => {
  for (const change of [v => v.defaultChainId = 1, v => v.networks.push(v.networks[0]), v => v.networks[0].deployments = [], v => v.networks[0].deployments[0].chainId = 1, v => v.networks[0].defaultInstance = 'missing', v => v.networks[0].deployments.push(v.networks[0].deployments[0]), v => v.networks[0].rpcUrls = ['http://internal.example']]) {
    const value = clone(); change(value); assert.throws(() => parseKeelNetworkIndex(value));
  }
  await assert.rejects(fetchKeelNetworkIndex({ fetchImpl: async () => new Response('not found', { status: 404 }) }), e => e instanceof KeelNetworkIndexError && e.code === 'network.index-unavailable');
  await assert.rejects(fetchKeelNetworkIndex({ fetchImpl: async () => new Response('x'.repeat(1024*1024+1)) }), KeelNetworkIndexError);
  assert.equal((await fetchKeelNetworkIndex({ fetchImpl: response(snapshot) })).defaultChainId, 11155111);
});

test('workspace/public index configuration controls discovery and respects explicit selection', async () => {
  const root = await mkdtemp('/tmp/keel-network-config-');
  try {
    await mkdir(root+'/.keel');
    await writeFile(root+'/.keel/config.json', JSON.stringify({ schema: 'keel-workspace-config@1', chainId: 11155111, instance: 'creator-inline-20261005', indexUrl: 'https://my-index.example/networks.json' }));
    const requested = [];
    const found = await discoverKeelNodeNetworks({ workspace: root, environment: {}, fetchImpl: async url => { requested.push(url); return Response.json(snapshot); } });
    assert.deepEqual(requested, ['https://my-index.example/networks.json']);
    assert.equal(found.source, 'public-index'); assert.equal(found.selection.instance, 'creator-inline-20261005');
    assert.equal((await resolveKeelNodeNetworkSelection({ workspace: root, environment: { KEEL_CHAIN_ID: '777' }, explicit: { chainId: 11155111 } })).chainId, 11155111);
    await assert.rejects(discoverKeelNodeNetworks({ workspace: root, explicit: { chainId: 84532 }, environment: {}, fetchImpl: response(snapshot) }), /no indexed deployments/u);
    await writeFile(root+'/.keel/config.json', JSON.stringify({ chainId: 'not a number', secret: 'do not log' }));
    await assert.rejects(readKeelNetworkConfiguration(root), e => /Invalid/u.test(e.message) && !e.message.includes('do not log'));
    await rm(root+'/.keel/config.json'); await symlink('/etc/hosts', root+'/.keel/config.json');
    await assert.rejects(readKeelNetworkConfiguration(root), /inside the workspace/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Node RPC defaults use the fetched index public pool, with no silent stale fallback', async () => {
  const root = await mkdtemp('/tmp/keel-network-default-'), previous = globalThis.fetch;
  try {
    const index = clone(); index.networks[0].rpcUrls = ['https://index-chosen.example/rpc'];
    globalThis.fetch = response(index);
    const rpc = await createKeelNodeRpc({ workspace: root, environment: { KEEL_NETWORK_INDEX_URL: 'https://unique-index.example/network' } });
    assert.deepEqual(rpc.configuration.rpcUrls, ['https://index-chosen.example/rpc']);
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    await assert.rejects(createKeelNodeRpc({ workspace: root, environment: { KEEL_NETWORK_INDEX_URL: 'https://offline-index.example/network' } }), KeelNetworkIndexError);
    await mkdir(root+'/.keel'); await writeFile(root+'/.keel/config.json', JSON.stringify({ chainId: 12345 }));
    await writeFile(root+'/.keel/rpc.json', JSON.stringify({ chainId: 11155111, rpcUrl: 'https://sepolia-private.example/key' }));
    await assert.rejects(createKeelNodeRpc({ workspace: root, environment: {} })); // cannot reuse Sepolia credentials on another chain
  } finally { globalThis.fetch = previous; await rm(root, { recursive: true, force: true }); }
});

test('creator infrastructure verification authenticates hashes, receipts and bindings', async () => {
  const index = clone(), target = resolveKeelCreatorTarget(index), code = '0x60006000';
  index.networks[0].deployments = target.deployments.map(d => ({ ...d, runtimeCodeHash: keccak256(code), block: '8' }));
  const calls = []; let mismatch = false;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body.method);
    let result;
    if (body.method === 'eth_chainId') result = '0xaa36a7';
    else if (body.method === 'eth_blockNumber') result = '0x10';
    else if (body.method === 'eth_getBlockByNumber') result = { number: '0x10', hash: '0x'+'3'.repeat(64) };
    else if (body.method === 'eth_getCode') result = code;
    else if (body.method === 'eth_getTransactionReceipt') { const d = target.deployments.find(d => d.txHash === body.params[0]); result = { status: '0x1', contractAddress: d.address, transactionHash: mismatch ? '0x'+'0'.repeat(64) : d.txHash, blockNumber: '0x8', blockHash: '0x'+'4'.repeat(64) }; }
    else if (body.method === 'eth_call') result = '0x'+'0'.repeat(24)+(body.params[0].to.toLowerCase() === target.factory.toLowerCase() ? target.renderer : target.store).slice(2);
    else throw new Error('Unexpected/wallet method');
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  const pool = createKeelRpcPool({ rpcUrls: ['https://test-chain.example'], chainId: 11155111, minIntervalMs: 0, fetchImpl });
  const checked = await verifyKeelIndexedCreator(pool, parseKeelNetworkIndex(index));
  assert.equal(checked.contracts.length, 15); assert.equal(checked.writes, 0); assert.equal(checked.status, 'infrastructure-verified-project-gates-required');
  mismatch = true; await assert.rejects(verifyKeelIndexedCreator(pool, parseKeelNetworkIndex(index)), /receipt mismatch/u);
  assert.ok(calls.every(m => !/send|sign/u.test(m)));
});

test('MCP discovery and creator preparation share the index-selected target and report unavailable index', async () => {
  const root = await mkdtemp('/tmp/keel-network-mcp-'), previous = globalThis.fetch;
  try {
    await mkdir(root+'/.keel'); await writeFile(root+'/.keel/config.json', JSON.stringify({ indexUrl: 'https://mcp-index.example/network' }));
    const index = clone(); const modern = index.networks[0].deployments.filter(d => d.instance === 'creator-inline-20261005');
    index.networks[0].deployments = modern.map(d => ({ ...d, instance: 'configured-creator' })); index.networks[0].defaultInstance = 'configured-creator';
    globalThis.fetch = response(index);
    const server = await createMcpServer({ workspaceRoot: root });
    await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'network-test', version: '1' } } });
    const call = (id,name,args={}) => server.handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
    const discovered = (await call(1, 'keel-network-discover')).result.structuredContent;
    assert.equal(discovered.selected.creator.instance, 'configured-creator'); assert.equal(discovered.networks.length, 1);
    await writeFile(root+'/game.html', '<canvas id="game"></canvas>'); await writeFile(root+'/poster.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const prepared = (await call(2, 'keel-creator-inline-prepare', { resources: [{ id: 'game', path: 'game.html', mediaType: 'text/html', role: 'entrypoint' }], posterPath: 'poster.svg', posterMediaType: 'image/svg+xml', out: 'plan.json' })).result;
    assert.equal(prepared.isError, undefined, JSON.stringify(prepared));
    assert.equal(prepared.structuredContent.deployment.instance, 'configured-creator');
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    const failed = (await call(3,'keel-network-discover')).result;
    assert.equal(failed.structuredContent.code, 'network.index-unavailable'); assert.equal(failed.isError, true);
  } finally { globalThis.fetch = previous; await rm(root, { recursive: true, force: true }); }
});
