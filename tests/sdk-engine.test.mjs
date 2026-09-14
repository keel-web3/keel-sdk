import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { KEEL_ENGINE_CATALOG, planKeelProject } from '../packages/sdk/dist/engine.js';
import { KEEL_LIBRARY_NATIVE_ACCESS_MODES } from '../packages/sdk/dist/library-publication-plan.js';
import { createMcpServer } from '../packages/mcp/dist/server.js';

test('engine preserves explicit choices, asks at most three at once and never grants publication authority', () => {
  const input = { outcome: 'release', runtime: 'three', family: 'ethereum', chainId: 84532, storage: 'native', collection: 'existing' };
  const plan = planKeelProject(input);
  assert.deepEqual(plan.intent, input);
  assert.ok(plan.nextQuestions.length <= 3);
  assert.ok(plan.questions.some((q) => q.field === 'collectionAddress'));
  assert.ok(!plan.questions.some((q) => ['family', 'storage', 'runtime', 'chainId'].includes(q.field)));
  assert.equal(plan.authority.publicationReady, false);
  assert.equal(plan.authority.approvalRequiredNow, false);
  assert.equal(plan.modules.publicationStatus, 'unverified');
});
test('local exploration needs no chain, collection, storage or economic choices', () => {
  const result = planKeelProject({ outcome: 'explore', runtime: 'html' });
  assert.equal(result.status, 'planned');
  assert.deepEqual(result.questions, []);
  assert.equal(result.authority.publicationReady, false);
});
test('mint routes retain different authority and unsupported OneMint stages fail closed', () => {
  assert.throws(() => planKeelProject({ outcome: 'release', mintSystem: 'one-mint', stages: ['auction'] }), /Invalid stages/);
  assert.throws(() => planKeelProject({ outcome: 'release', mintSystem: 'mint-gate', stages: ['public'] }), /require one-mint/);
  assert.equal(planKeelProject({ outcome: 'release', mintSystem: 'one-mint', access: ['erc721'] }).status, 'blocked');
  const fray = planKeelProject({ outcome: 'release', mintSystem: 'fray-auction', family: 'tezos', network: 'shadownet', runtime: 'p5', storage: 'native' });
  assert.equal(fray.nextTools[0], 'fray-auction-intake');
  assert.ok(!fray.nextTools.includes('keel-studio-project-intake'));
});
test('Tezos releases default to the KEEL FA2/OnchFS lane and measured presentation planner', () => {
  const plan = planKeelProject({ outcome: 'release', runtime: 'html', family: 'tezos', network: 'NetXsqzbfFenSTS', releaseType: 'one-of-one', mintSystem: 'admin-mint' });
  assert.equal(plan.status, 'planned');
  assert.equal(plan.intent.storage, 'native');
  assert.equal(plan.intent.collection, 'tezos-fa2');
  assert.equal(plan.defaults.adapter, 'keel-tezos-standard-fa2-onchfs');
  assert.equal(plan.defaults.presentation, 'auto-inline-then-hybrid-rpc');
  assert.deepEqual(plan.modules.required, ['keel-hold-onchfs', 'keel-index', 'keel-harness-builder', 'keel-collection-fa2', 'keel-sleeve']);
  assert.ok(plan.nextTools.includes('keel-tezos-standard-route-plan'));
  assert.ok(plan.nextTools.includes('keel-tezos-publication-prepare'));
  assert.ok(!plan.nextTools.includes('upload-plan'));
  assert.deepEqual(plan.blockers, []);
});
test('collection limits and gate combinations cannot contradict their intent', () => {
  for (const input of [
    { outcome: 'release', releaseType: 'one-of-one', supply: '3' },
    { outcome: 'release', releaseType: 'open-edition', supply: '100' },
    { outcome: 'storage-only', mintSystem: 'admin-mint' },
    { family: 'tezos', chainId: 1 },
    { outcome: 'release', access: ['public', 'erc721'] },
    { privateKey: 'no' },
  ]) assert.throws(() => planKeelProject(input));
  const plan = planKeelProject({ outcome: 'release', mintSystem: 'mint-gate', access: ['erc721', 'allowlist'] });
  assert.ok(plan.questions.some((q) => q.field === 'gateLogic'));
  assert.deepEqual(KEEL_ENGINE_CATALOG.access.libraryPolicy, KEEL_LIBRARY_NATIVE_ACCESS_MODES);
});
test('engine subpath bundles for the browser without Node shims', async () => {
  const result = await build({ stdin: { contents: 'export { planKeelProject } from "@keel/sdk/engine"', resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'esm', metafile: true });
  assert.ok(!Object.keys(result.metafile.inputs).some((file) => /node:|esbuild\/lib/.test(file)));
});
test('modern MCP clients negotiate supported legacy version and receive the same planner as the SDK', async () => {
  const server = await createMcpServer();
  const initialized = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'desktop-test', version: '1', title: 'Desktop test' } } });
  assert.equal(initialized.result.protocolVersion, '2024-11-05');
  const intent = { outcome: 'explore', runtime: 'html' };
  const response = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'keel-project-decisions', arguments: intent } });
  assert.deepEqual(response.result.structuredContent, planKeelProject(intent));
  const resource = await server.handle({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'keel://mcp/engine' } });
  assert.deepEqual(JSON.parse(resource.result.contents[0].text), KEEL_ENGINE_CATALOG);
  const route = await server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'keel-tezos-standard-route-plan', arguments: {
    network: 'NetXsqzbfFenSTS', originalAssetByteLength: 15665832, compressedAssetByteLength: 1968333, completeInlineByteLength: 2704242, builderConfigured: true,
  } } });
  assert.equal(route.result.structuredContent.presentation.mode, 'hybrid');
  assert.equal(route.result.structuredContent.storage.immutableBytesRemainOnchain, true);
});
