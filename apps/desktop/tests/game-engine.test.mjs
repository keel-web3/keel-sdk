// The KEEL game engine in the editor: the Game template and project field, the
// preview's token context and permission rule, the worker against a real
// engine checkout (skipped when there isn't one), and the agent tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newTemplateProject, WorkspaceStore, projectSchema } from '../src/workspace.mjs';
import { artworkReady, artworkIssue, CREATION_TEMPLATES } from '../src/creation-workflow.mjs';
import { workspaceOperations } from '../src/workspace-service.mjs';
import { isGameProject, withGame } from '../src/game-engine/game-project.mjs';
import { GameEngineService, findGameEngineRoot, gameSeed, gameContextTail, allowGamePermission } from '../src/game-engine/game-engine-service.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { AgentService } from '../src/agent-service.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// (The SDK's game-engine examples: projects built with the engine, outside it.)
const EXAMPLES = path.resolve(here, '../../../examples/game-engine');
const workerPath = path.join(here, '../src/game-engine/game-engine-worker.mjs');
const found = findGameEngineRoot([path.resolve(here, '../../../../keel-engine')]);
const engineTest = found.root ? test : test.skip;

test('the Game template makes an html edition that waits for a game module', () => {
  const template = CREATION_TEMPLATES.find(item => item.id === 'game');
  assert.equal(template.runtime, 'html');
  const project = newTemplateProject('Untitled game', 'game');
  assert.equal(project.creation.template, 'game'); assert.equal(project.intent.runtime, 'html');
  assert.equal(project.intent.releaseType, 'limited-edition'); assert.equal(project.intent.collection, 'erc1155'); assert.equal(project.intent.supply, '25');
  assert.equal(project.presentation.shell, 'canonical'); assert.deepEqual(project.files, []); assert.equal(project.game, undefined);
  assert.ok(isGameProject(project)); assert.equal(artworkReady(project), false); assert.match(artworkIssue(project), /Choose the game/);
  const chosen = withGame(project, { id: 'examples/hello' });
  assert.deepEqual(chosen.game, { id: 'examples/hello' }); assert.equal(artworkReady(chosen), true); assert.equal(artworkIssue(chosen), '');
  assert.deepEqual(withGame(chosen, { seed: '7', pixels: 3 }).game, { id: 'examples/hello', seed: '7', pixels: 3 });
  assert.deepEqual(withGame(withGame(chosen, { seed: '7' }), { seed: '' }).game, { id: 'examples/hello' });
  assert.equal('game' in withGame(chosen, { id: '' }), false);
  assert.equal(isGameProject(newTemplateProject('Untitled image', 'image')), false);
});

test('project.game is strict and round-trips through the workspace store and service', async () => {
  const store = new WorkspaceStore(':memory:');
  const project = withGame(newTemplateProject('Blob party', 'game'), { id: 'examples/hello', seed: 'hello world', pixels: 4 });
  store.save({ ...store.read().state, projects: [project] }, 0);
  assert.deepEqual(store.read().state.projects[0].game, { id: 'examples/hello', seed: 'hello world', pixels: 4 });
  assert.throws(() => projectSchema.parse({ ...project, game: { id: 'examples/hello', extra: true } }));
  assert.throws(() => projectSchema.parse({ ...project, game: { id: 'Hello' } }));
  assert.throws(() => projectSchema.parse({ ...project, game: { id: 'examples/hello', pixels: 0 } }));
  const run = workspaceOperations(store);
  const updated = await run('projects.update', { projectId: project.id, revision: store.read().revision, patch: { game: { id: 'games/other', seed: '2' } } });
  assert.deepEqual(updated.project.game, { id: 'games/other', seed: '2' });
  store.close();
});

test('the preview token context and the narrow permission rule', () => {
  assert.equal(gameSeed(''), undefined);
  assert.equal(gameSeed('7'), `0x${'0'.repeat(63)}7`);
  assert.equal(gameSeed(`0x${'AB'.repeat(32)}`), `0x${'ab'.repeat(32)}`);
  assert.match(gameSeed('any text'), /^0x[0-9a-f]{64}$/);
  assert.equal(gameContextTail({ id: 'examples/hello' }), '');
  const tail = gameContextTail({ id: 'examples/hello', seed: '7', pixels: 3 });
  assert.match(tail, /__KEEL_CONTEXT__/); assert.ok(tail.includes(gameSeed('7'))); assert.ok(tail.includes('"pixels":3'));
  assert.ok(!gameContextTail({ id: 'examples/hello', seed: '</script><script>alert(1)' }).includes('</script><script>alert'));
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: 'keel-preview://00000000-0000-4000-8000-000000000001/index.html' }), true);
  assert.equal(allowGamePermission('fullscreen', { requestingUrl: 'keel-preview://00000000-0000-4000-8000-000000000001/index.html' }), true);
  assert.equal(allowGamePermission('media', { requestingUrl: 'keel-preview://00000000-0000-4000-8000-000000000001/index.html' }), false);
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: 'keel-asset://abc/view' }), false);
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: 'keel-editor://app/index.html' }), false);
  assert.equal(allowGamePermission('pointerLock', {}), false);
  const frames = (...urls) => urls.reduceRight((parent, url) => ({ url, parent }), null);
  const editor = 'keel-editor://app/index.html', preview = 'keel-preview://00000000-0000-4000-8000-000000000001/index.html';
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: editor }, { focusedFrame: frames('about:srcdoc', preview, editor) }), true, 'the shell\'s child frame inside the preview');
  assert.equal(allowGamePermission('fullscreen', { requestingUrl: editor }, { focusedFrame: frames(preview, editor) }), true);
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: editor }, { focusedFrame: frames('about:srcdoc', 'keel-asset://abc/view', editor) }), false);
  assert.equal(allowGamePermission('pointerLock', { requestingUrl: editor }, { focusedFrame: frames(editor) }), false);
  assert.equal(allowGamePermission('geolocation', { requestingUrl: editor }, { focusedFrame: frames(preview, editor) }), false);
});

test('without an engine checkout every request says how to connect one', async () => {
  const service = new GameEngineService({ workerPath, root: null, searched: ['/nowhere/keel-engine'] });
  assert.equal(service.status().available, false); assert.match(service.status().reason, /KEEL_GAME_ENGINE_ROOT/);
  await assert.rejects(() => service.modules(), /KEEL_GAME_ENGINE_ROOT/);
  service.close();
});

engineTest('the worker reads the engine, resolves, fits and builds examples/hello', async () => {
  const service = new GameEngineService({ workerPath, root: found.root, projects: [EXAMPLES] });
  try {
    const { modules } = await service.modules();
    assert.ok(modules.some(item => item.id === 'examples/hello' && item.kind === 'game'));
    const pack = modules.find(item => item.id === 'examples/hello-pack');
    assert.deepEqual(pack.pack.entities.map(item => item.id), ['blob', 'tall-blob']);
    assert.equal(pack.pack.entities[0].body, 'body/blob@1.0.0'); assert.equal(pack.pack.entities[0].sockets[0].name, 'head');
    assert.deepEqual(pack.pack.attributes.map(item => [item.id, item.slot]), [['party-hat', 'head']]);
    assert.equal(pack.pack.attributes[0].targets[0].body, 'body/blob@^1');

    const graph = await service.graph('examples/hello');
    assert.equal(graph.ok, true); assert.deepEqual(graph.order, ['keel/runtime', 'examples/hello-pack', 'examples/hello']);
    assert.ok(graph.edges.some(edge => edge.from === 'examples/hello' && edge.need.startsWith('contract:body/blob') && edge.to.includes('examples/hello-pack')));
    await assert.rejects(() => service.graph('games/nope'), /No module games\/nope/);

    const report = await service.report('examples/hello');
    assert.deepEqual(report.modules.map(item => item.id), graph.order);
    for (const item of report.modules) { assert.ok(item.bytes > 0); assert.ok(item.stored > 0 && item.stored <= item.bytes + 64); }
    assert.ok(report.uploads.creatorPublicationBytes > 0 && report.saver.graphByteLength > report.uploads.creatorPublicationBytes);

    const project = { id: 'p', game: { id: 'examples/hello', seed: '7' }, presentation: { delivery: 'auto' } };
    const html = (await service.document(project)).toString('utf8');
    for (const id of graph.order) assert.ok(html.includes(id), `document carries ${id}`);
    assert.ok(html.endsWith(gameContextTail(project.game)));
    assert.equal((await service.document({ game: { id: 'examples/hello' } })).byteLength, report.byteLength);
    const presentation = await service.presentation(project);
    assert.equal(presentation.plan.graphByteLength, report.saver.graphByteLength); assert.equal(presentation.published, false);

    assert.deepEqual(await service.fit({ pack: 'examples/hello-pack', id: 'party-hat' }, { pack: 'examples/hello-pack', id: 'blob' }).then(({ ok, why }) => ({ ok, why })), { ok: true, why: 'both from examples/hello-pack.' });
    await assert.rejects(() => service.fit({ pack: 'examples/hello-pack', id: 'nope' }, { pack: 'examples/hello-pack', id: 'blob' }), /no attribute nope/);
    const hats = await service.find({ query: 'a hat that fits a blob' });
    assert.deepEqual(hats.results.map(item => item.id), ['party-hat']); assert.ok(hats.results[0].fits.every(item => item.ok));
    // (The engine's standard packs carry dogs and hats now: a hat for a dog is found, and it fits.)
    const dogHats = await service.find({ query: 'a hat that fits a dog' });
    assert.ok(dogHats.results.length > 0, 'hats for a dog'); assert.ok(dogHats.results.every(item => item.fits.some(fit => fit.ok)));
  } finally { service.close(); }
});

engineTest('agent tools find, check and propose a game through a review card', async () => {
  const workspace = new WorkspaceStore(':memory:');
  const project = newTemplateProject('Blob party', 'game');
  workspace.save({ ...workspace.read().state, projects: [project] }, 0);
  const game = new GameEngineService({ workerPath, root: found.root, projects: [EXAMPLES] });
  const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Projects' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); }, game };
  try {
    const chats = new AgentStore(workspace.db); const chat = chats.create({ projectId: project.id }); const run = chats.begin(chat.id, 'Make my game', null);
    const tools = createAgentTools({ workspace, chats, chat, run, hooks, signal: new AbortController().signal, emit: () => {} });
    const call = async (name, input) => JSON.parse(await tools.find(tool => tool.name === name).invoke(input));
    for (const name of ['keel_game_modules', 'keel_game_find_asset', 'keel_game_check_fit', 'keel_game_graph', 'keel_game_build', 'keel_game_select']) assert.ok(tools.some(tool => tool.name === name), name);
    const games = await call('keel_game_modules', { kind: 'game' });
    assert.ok(games.modules.map(item => item.id).includes('examples/hello'), 'the SDK example is a game it can build');
    const heads = await call('keel_game_modules', { slot: 'head' });
    const withHeads = heads.modules.map(item => item.id);
    assert.ok(withHeads.includes('examples/hello-pack'), 'the example pack has a head attribute');
    assert.deepEqual(heads.modules.find(item => item.id === 'examples/hello-pack').pack.entities, []);
    assert.equal((await call('keel_game_find_asset', { query: 'a hat that fits a blob' })).results[0].id, 'party-hat');
    assert.equal((await call('keel_game_check_fit', { attribute: { pack: 'examples/hello-pack', id: 'party-hat' }, entity: { pack: 'examples/hello-pack', id: 'tall-blob' } })).ok, true);
    assert.equal((await call('keel_game_graph', { gameId: 'examples/hello' })).ok, true);
    const size = await call('keel_game_build', { gameId: 'examples/hello' });
    assert.equal(size.published, false); assert.ok(size.documentBytes > 0);
    const proposed = await call('keel_game_select', { gameId: 'examples/hello', seed: '7' });
    assert.equal(proposed.status, 'awaiting-creator');
    assert.equal(workspace.read().state.projects[0].game, undefined, 'Nothing changes before the creator applies the card');
    await assert.rejects(() => tools.find(tool => tool.name === 'keel_game_select').invoke({ gameId: 'examples/hello-pack' }), /pack module/);
    await new AgentService({ workspace, hooks }).apply(proposed.actionId);
    assert.deepEqual(workspace.read().state.projects[0].game, { id: 'examples/hello', seed: '7' });
  } finally { game.close(); workspace.close(); }
});
