// The Level tab's data and procedures: the level file and its ops (pure), then
// against a real engine checkout (skipped without one): a recipe through the
// codec and back, ops applied and undone tile for tile, a lock region that
// survives a regenerate, save and load (the edits replayed to the same level),
// variations as pixel-art thumbnails, an RTS map's fairness, a dungeon's room
// graph, a tileset from a PNG atlas, the codec inspector reading level records,
// and the assistant's tools (live ops, review cards, save).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { newTemplateProject, WorkspaceStore, projectSchema } from '../src/workspace.mjs';
import { findGameEngineRoot } from '../src/game-engine/game-engine-service.mjs';
import { GameLevelService, LEVEL_PREVIEW_HEADERS } from '../src/game-engine/level-service.mjs';
import { GameCodecService } from '../src/game-engine/codec-service.mjs';
import { LEVEL_FILE_FORMAT, LEVEL_PRESETS, destructiveLevelOps, discTiles, fromBase64url, levelFileName, levelFileOf, levelNameOf, lineTiles, pathThrough, projectLevels, readLevelFile, toBase64url, validateEditorOps, withLevelFile, writeLevelFile } from '../src/game-engine/level-project.mjs';
import { decodePng, encodePng } from '../src/game-engine/level-png.mjs';
import { levelSummary } from '../src/game-engine/agent-level-tools.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { AgentService } from '../src/agent-service.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '../src/game-engine/level-worker.mjs');
const found = findGameEngineRoot([path.resolve(here, '../../../../keel-engine')]);
const engineTest = found.root ? test : test.skip;
/** A snapshot's tile arrays (the preview's buffer: height, water, deck as Int16, then type, flags, dir, biome, light). */
function tilesOf(snap) {
  const buf = gunzipSync(Buffer.from(snap.tiles, 'base64'));
  const n = snap.w * snap.d;
  return { buf, height: new Int16Array(buf.buffer, buf.byteOffset, n), type: buf.subarray(n * 6, n * 7), biome: buf.subarray(n * 9, n * 10), at: (i, j) => j * snap.w + i };
}
const SMALL = (seed = 'lv-1') => ({ ...LEVEL_PRESETS.island.recipe(seed), width: 64, depth: 48 });

test('the level file, its ops and the destructive ones (pure)', () => {
  const bytes = Uint8Array.from([0xb1, 1, 2, 3, 250, 251, 252]);
  assert.deepEqual(fromBase64url(toBase64url(bytes)), bytes);
  const content = writeLevelFile({ name: 'valley', players: 2, recipe: 'sQECAw', level: 'sQEC', edits: [{ op: 'paint', type: 'sand', at: [3, 4], radius: 2 }, { op: 'lockRegion', id: 'lock-0', rect: [0, 0, 8, 8] }] });
  const file = readLevelFile(content);
  assert.equal(file.format, LEVEL_FILE_FORMAT); assert.equal(file.edits.length, 2); assert.equal(file.tileset, null);
  assert.match(content, /\n  \{"op":"paint"/, 'one op a line');
  assert.throws(() => readLevelFile('{"format":"x"}'), /not a keel-game-level@1/);
  const project = newTemplateProject('World game', 'game');
  const saved = withLevelFile(project, 'valley', content);
  assert.equal(projectSchema.parse(saved).files.at(-1).name, 'levels/valley.level');
  assert.equal(levelFileOf(saved, 'valley'), content); assert.equal(levelNameOf('levels/valley.level'), 'valley'); assert.equal(levelNameOf('levels/Bad Name.level'), null);
  assert.deepEqual(projectLevels(saved).map((l) => l.name), ['valley']);
  assert.equal(withLevelFile(saved, 'valley', content).files.length, saved.files.length, 'saving again replaces the file');
  // Ops: the editor's own checked fully, the engine's by name (their fields in the worker), unknown ones refused.
  const ok = validateEditorOps([{ op: 'brush', mode: 'raise', at: [3, 3], radius: 2 }, { op: 'biome', biome: 'desert', path: [[1, 1], [4, 4]] }, { op: 'place', pack: 'packs/buildings', object: 'tower', pos: [1, 0, 1] }, { op: 'stage', stage: { id: 'crypt', use: 'dungeon@1', params: { algorithm: 'bsp' }, mask: { kind: 'rect', rect: [0, 0, 40, 30] } } }, { op: 'undo' }]);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors)); assert.equal(ok.ops[4].steps, 1, 'defaults filled');
  const bad = validateEditorOps([{ op: 'brush', mode: 'raise' }, { op: 'nope' }, { op: 'size', width: 10, depth: 0 }, { op: 'stage', stage: { id: 'X', use: 'moon@1' } }]);
  assert.equal(bad.errors.length, 4); assert.match(bad.errors[0].message, /op 0 \(brush\)/); assert.match(bad.errors[1].message, /isn't a level op/);
  // Adding is never destructive; removing, unlocking, draining, and regenerating under hand edits are.
  assert.deepEqual(destructiveLevelOps([{ op: 'paint', type: 'sand', at: [1, 1] }, { op: 'seed', seed: 'x' }], { edits: 0 }), []);
  assert.deepEqual(destructiveLevelOps([{ op: 'remove', id: 'tower-0' }, { op: 'unlockRegion', id: 'lock-0' }, { op: 'drain', rect: [0, 0, 4, 4] }, { op: 'seed', seed: 'x' }, { op: 'paint', type: 'sand', at: [1, 1] }], { edits: 3 }).map((d) => d.op), ['remove', 'unlockRegion', 'drain', 'seed']);
  // Brushes and paths.
  assert.equal(discTiles([5, 5], 2).length, 13); assert.equal(discTiles([0, 0], 2, 10, 10).length, 6, 'clipped');
  const line = lineTiles([0, 0], [3, 2]);
  assert.equal(line.length, 6); assert.ok(line.every((t, n) => !n || Math.abs(t[0] - line[n - 1][0]) + Math.abs(t[1] - line[n - 1][1]) === 1), '4-connected');
  assert.deepEqual(pathThrough([[0, 0], [2, 0], [2, 1]]), [[0, 0], [1, 0], [2, 0], [2, 1]]);
  assert.match(LEVEL_PREVIEW_HEADERS['content-security-policy'], /connect-src 'none'.*sandbox allow-scripts/);
  // PNG in and out.
  const rgba = new Uint8Array(3 * 2 * 4).map((_, n) => (n * 37) & 255);
  assert.deepEqual(decodePng(encodePng(3, 2, rgba)).rgba, rgba);
});

engineTest('a recipe through the codec and back; ops applied and undone tile for tile', async () => {
  const level = new GameLevelService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const opened = await level.open(P, 'isle', { recipe: SMALL(), players: 0, editor: true });
    assert.equal(opened.how, 'opened'); assert.deepEqual(opened.state.size, [64, 48]); assert.equal(opened.unsaved, true);
    assert.equal(opened.snapshot.kind, 'finite'); assert.equal(opened.snapshot.w, 64);
    // The recipe as its codec record: the same recipe back, far smaller than its JSON.
    const enc = await level.encode(P);
    const back = await level.decode(enc.content);
    assert.deepEqual(back.recipe, opened.state.recipe);
    assert.equal(fromBase64url(readLevelFile(enc.content).recipe)[0], 0xb1, 'a codec document, id header');
    assert.ok(enc.sizes.recipe.bytes < enc.sizes.recipe.json / 2, `recipe ${enc.sizes.recipe.bytes} B against ${enc.sizes.recipe.json} B of JSON`);
    assert.ok(enc.sizes.level.bytes < enc.sizes.level.json / 8, `level ${enc.sizes.level.bytes} B against ${enc.sizes.level.json} B of JSON`);
    // Ops: each lands (the snapshot changes), undo puts every tile back, redo makes it again.
    const before = tilesOf(opened.snapshot);
    const waiting = level.wait(P, opened.seq, 5000);
    const r = await level.apply(P, [{ op: 'brush', mode: 'raise', at: [20, 20], radius: 3, amount: 2 }, { op: 'paint', type: 'sand', at: [40, 20], radius: 2 }, { op: 'biome', biome: 'corruption', at: [30, 30], radius: 4 }, { op: 'place', pack: 'packs/buildings', object: 'tower', pos: [21, 2, 21] }, { op: 'river', path: [[10, 5], [12, 20]], width: 2 }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.equal(r.applied, 5);
    assert.equal((await waiting).seq > opened.seq, true, 'whoever waits sees it');
    const after = tilesOf(r.snapshot);
    assert.equal(after.height[after.at(20, 20)], before.height[before.at(20, 20)] + 2);
    assert.notEqual(Buffer.compare(before.buf, after.buf), 0);
    assert.equal(r.state.counts.things, opened.state.counts.things + 1); assert.equal(r.state.history.undo, 5);
    const undone = await level.apply(P, [{ op: 'undo', steps: 5 }]);
    assert.equal(Buffer.compare(tilesOf(undone.snapshot).buf, before.buf), 0, 'five undos: every tile, biome and light as it was');
    assert.equal(undone.state.counts.things, opened.state.counts.things);
    const redone = await level.apply(P, [{ op: 'redo', steps: 5 }]);
    assert.equal(Buffer.compare(tilesOf(redone.snapshot).buf, after.buf), 0, 'redo makes it again');
    // A stroke undoes as one step; a failing op stops the batch and names itself.
    await level.apply(P, [{ op: 'brush', mode: 'lower', at: [50, 40], radius: 1, stroke: 's1' }, { op: 'brush', mode: 'lower', at: [52, 40], radius: 1, stroke: 's1' }]);
    const one = await level.apply(P, [{ op: 'undo' }]);
    assert.equal(one.state.history.undo, 5, 'both dabs of the stroke undone');
    const failed = await level.apply(P, [{ op: 'paint', type: 'sand', at: [1, 1] }, { op: 'paint', type: 'unobtainium', at: [2, 2] }]);
    assert.equal(failed.ok, false); assert.equal(failed.applied, 1); assert.match(failed.errors[0].message, /op 1 \(paint\)/);
    const inf = await level.apply(P, [{ op: 'size', width: 0, depth: 0 }]);
    assert.equal(inf.snapshot.kind, 'infinite'); assert.equal(inf.state.finite, false, 'an infinite world');
    const refused = await level.apply(P, [{ op: 'paint', type: 'sand', at: [1, 1] }]);
    assert.match(refused.errors[0].message, /infinite world/);
    assert.equal((await level.apply(P, [{ op: 'biome', biome: 'desert', at: [3, 3], radius: 5 }])).snapshot.edits.at(-1).biome, 'desert', 'biome paint reaches the stream');
  } finally { level.close(); }
});

engineTest('a lock region survives a regenerate; hand edits replay; save and load give the same level', async () => {
  const level = new GameLevelService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const opened = await level.open(P, 'locked', { recipe: SMALL('lock-a'), players: 0 });
    const r = await level.apply(P, [{ op: 'paint', type: 'snow', rect: [4, 4, 14, 12] }, { op: 'lockRegion', id: 'lock-0', rect: [2, 2, 18, 16] }, { op: 'paint', type: 'lava', rect: [40, 30, 44, 34] }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const kept = tilesOf(r.snapshot);
    const reseeded = await level.apply(P, [{ op: 'seed', seed: 'lock-b' }]);
    assert.equal(reseeded.ok, true, JSON.stringify(reseeded.errors)); assert.match(reseeded.did[0], /kept lock region lock-0/);
    const now = tilesOf(reseeded.snapshot);
    let inside = 0, outside = 0;
    for (let j = 0; j < 48; j += 1) for (let i = 0; i < 64; i += 1) {
      const k = j * 64 + i, same = kept.height[k] === now.height[k] && kept.type[k] === now.type[k] && kept.biome[k] === now.biome[k];
      if (i >= 2 && j >= 2 && i < 18 && j < 16) { assert.ok(same, `locked tile ${i},${j} kept`); inside += 1; } else if (!same) outside += 1;
    }
    assert.equal(inside, 16 * 14); assert.ok(outside > 200, `the rest regenerated (${outside} tiles differ)`);
    const lava = now.type[now.at(41, 31)];
    assert.equal(reseeded.snapshot.types[lava], 'lava', 'the hand edit outside the lock replayed over the new ground');
    // Undo the regenerate: exactly the level before it.
    const undone = await level.apply(P, [{ op: 'undo' }]);
    assert.equal(Buffer.compare(tilesOf(undone.snapshot).buf, kept.buf), 0); assert.equal(undone.state.recipe.seed, 'lock-a');
    // Save and load: the file's edits replay to the same LEVEL, every edit undoable again.
    const { content } = await level.encode(P);
    const file = readLevelFile(content);
    assert.equal(file.edits.length, 3); assert.ok(file.level.length > 100);
    level.saved(P, 'locked', content);
    assert.equal(level.live(P).dirty, false);
    const Q = crypto.randomUUID();
    const loaded = await level.open(Q, 'locked', { content });
    assert.equal(Buffer.compare(tilesOf(loaded.snapshot).buf, kept.buf), 0, 'loaded: the same tiles');
    assert.equal(loaded.state.history.undo, 3); assert.equal(loaded.state.note, '');
    assert.equal((await level.encode(Q)).content, content, 'and it saves to the same bytes');
    // A saved level its recipe no longer makes (here: an edit dropped from the file) opens as saved, its history frozen.
    const tampered = writeLevelFile({ ...file, edits: file.edits.slice(0, 2) });
    const R = crypto.randomUUID();
    const as = await level.open(R, 'locked', { content: tampered });
    assert.match(as.state.note, /opened as saved/); assert.equal(as.state.history.frozen, 2); assert.equal(as.state.history.undo, 0);
    assert.equal(tilesOf(as.snapshot).type[now.at(41, 31)], kept.type[kept.at(41, 31)], 'the saved tiles (lava included)');
  } finally { level.close(); }
});

engineTest('variations, an RTS map\'s fairness, a dungeon\'s room graph, a tileset from a PNG atlas', async () => {
  const level = new GameLevelService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const v = await level.variations(SMALL('strip'), 0, 3);
    assert.equal(v.variations.length, 3); assert.deepEqual(v.variations.map((x) => x.seed), ['strip.1', 'strip.2', 'strip.3']);
    for (const x of v.variations) { assert.match(x.url, /^data:image\/png;base64,/); const png = decodePng(Buffer.from(x.url.split(',')[1], 'base64')); assert.ok(png.width > 60 && png.height > 20); }
    assert.notEqual(v.variations[0].url, v.variations[1].url, 'each seed its own map');
    const inf = await level.variations(LEVEL_PRESETS.overworld.recipe('w'), 0, 1);
    assert.equal(inf.variations[0].infinite, true);
    // An RTS arena: two spawns, resources, fairness measured.
    const arena = await level.open(P, 'arena', { preset: 'arena' });
    assert.equal(arena.state.players, 2); assert.equal(arena.state.spawns.length, 2); assert.ok(arena.state.resources.length >= 8);
    assert.equal(typeof arena.state.fairness.pass, 'boolean'); assert.equal(arena.state.fairness.players.length, 2);
    // A dungeon floor: rooms, a graph, start / key / boss / exit, the gate.
    const crypt = await level.open(P, 'crypt', { preset: 'dungeon' });
    const d = crypt.state.dungeons[0];
    assert.equal(d.algorithm, 'rooms'); assert.ok(d.rooms.length >= 6 && d.edges.length >= d.rooms.length - 1, `${d.rooms.length} rooms, ${d.edges.length} links`);
    for (const k of ['start', 'key', 'boss', 'exit']) assert.ok(Array.isArray(d[k]), k);
    assert.ok(d.edges.some((e) => e.locked), 'the boss behind a locked door'); assert.equal(d.check.pass, true, d.check.problems.join('; '));
    for (const kind of ['start', 'boss', 'exit']) assert.ok(d.rooms.some((r) => r.kind === kind), kind);
    const bsp = await level.apply(P, [{ op: 'stage', stage: { id: 'floor', use: 'dungeon@1', params: { algorithm: 'bsp', rooms: 8 } } }]);
    assert.equal(bsp.state.dungeons[0].algorithm, 'bsp');
    // A tileset: a blob-47 atlas (8 x 6 tiles of 8 px), cut, its rules as codec bytes, a demo patch baked with it.
    const T = 8, W = 8 * T, H = 6 * T, rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) { const o = (y * W + x) * 4, idx = Math.floor(y / T) * 8 + Math.floor(x / T), edge = x % T === 0 || y % T === 0; rgba[o] = edge ? 40 : 90 + (idx % 5) * 20; rgba[o + 1] = edge ? 60 : 140; rgba[o + 2] = edge ? 30 : 60; rgba[o + 3] = 255; }
    const ts = await level.tileset(encodePng(W, H, rgba), { id: 'meadow', layout: 'blob47', tile: T, materials: [{ type: 'grass', at: [0, 0] }] });
    assert.deepEqual(ts.materials, ['grass']); assert.ok(ts.colours >= 5); assert.match(ts.demo, /^data:image\/png/);
    assert.equal(fromBase64url(ts.rulesBytes)[0], 0xb1); assert.equal(fromBase64url(ts.rgba).length, W * H * 4);
    await assert.rejects(() => level.tileset(encodePng(W, H, rgba), { id: 'x', layout: 'blob47', tile: T, materials: [{ type: 'grass', at: [3, 3] }] }), /outside/);
    // Set on the level, saved in its file.
    await level.setTileset(P, { objectId: 'a'.repeat(64), rules: ts.rulesBytes });
    const file = readLevelFile((await level.encode(P)).content);
    assert.equal(file.tileset.objectId, 'a'.repeat(64)); assert.equal(level.live(P).state.tileset.rules.layout, 'blob47');
    // The page: the engine's ground baker, sprites and every content pack in one sandboxed document.
    const html = await level.page();
    assert.match(html, /^<!doctype html>/); assert.ok(html.includes('levelPreview') && html.length > 200_000);
  } finally { level.close(); }
});

engineTest('the codec inspector reads a level file\'s records by name', async () => {
  const level = new GameLevelService({ workerPath, root: found.root });
  const codec = new GameCodecService({ workerPath: path.join(here, '../src/game-engine/codec-worker.mjs'), root: found.root });
  const P = crypto.randomUUID();
  try {
    await level.open(P, 'small', { recipe: SMALL('insp'), players: 0 });
    const file = readLevelFile((await level.encode(P)).content);
    const recipe = await codec.explainBytes(fromBase64url(file.recipe));
    assert.equal(`${recipe.schema.name}@${recipe.schema.version}`.startsWith('keel/worldgen/recipe'), true); assert.equal(recipe.check, null);
    const lv = await codec.explainBytes(fromBase64url(file.level));
    assert.equal(lv.schema.name, 'keel/level'); assert.equal(lv.check, null);
    assert.ok(lv.sizes.bytes < lv.sizes.json / 8);
  } finally { level.close(); codec.close(); }
});

engineTest('agent tools generate, stream ops live, send destructive changes through a review card, and save', async () => {
  const workspace = new WorkspaceStore(':memory:');
  const project = newTemplateProject('World game', 'game');
  workspace.save({ ...workspace.read().state, projects: [project] }, 0);
  const level = new GameLevelService({ workerPath, root: found.root });
  level.paceMs = 5;
  const navigations = [];
  const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Projects' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); }, gameLevel: level };
  try {
    const chats = new AgentStore(workspace.db); const chat = chats.create({ projectId: project.id }); const run = chats.begin(chat.id, 'Make a map', null);
    const tools = createAgentTools({ workspace, chats, chat, run, hooks, signal: new AbortController().signal, emit: (event) => { if (event.type === 'navigate') navigations.push(event.action.payload); } });
    const call = async (name, input) => JSON.parse(await tools.find((tool) => tool.name === name).invoke(input));
    for (const name of ['keel_game_level_state', 'keel_game_level_generate', 'keel_game_level_ops', 'keel_game_level_save']) assert.ok(tools.some((tool) => tool.name === name), name);
    await assert.rejects(() => tools.find((t) => t.name === 'keel_game_level_state').invoke({}), /no level yet/);
    const made = await call('keel_game_level_generate', { name: 'isle', recipe: SMALL('agent'), players: 0 });
    assert.equal(made.created, true); assert.deepEqual(made.level.size, [64, 48]);
    assert.deepEqual(navigations[0], { page: 'Projects', projectId: project.id, tab: 'Level' });
    const state = await call('keel_game_level_state', {});
    assert.equal(state.level.name, 'isle'); assert.ok(state.offers.packs.some((p) => p.id === 'packs/buildings')); assert.match(state.ops, /lockRegion/);
    // Ops stream in (several batches: the tab sees each), live.
    let seen = 0; const seq0 = level.live(project.id).seq;
    const watcher = (async () => { let after = seq0; for (;;) { const v = await level.wait(project.id, after, 3000); if (v.idle) break; after = v.seq; seen += 1; } })();
    const ops = [...Array.from({ length: 10 }, (_, n) => ({ op: 'paint', type: 'sand', at: [5 + n * 4, 10], radius: 1.5 })), { op: 'spawn', player: 0, at: [10, 40] }, { op: 'spawn', player: 1, at: [54, 8] }, { op: 'resource', kind: 'mass', at: [12, 38] }, { op: 'place', pack: 'packs/buildings', object: 'tower', pos: [65, 1, 21] }];
    const applied = await call('keel_game_level_ops', { ops });
    assert.equal(applied.ok, true, JSON.stringify(applied.errors)); assert.equal(applied.applied, 14);
    await watcher;
    assert.ok(seen >= 3, `the tab saw the ops land in batches (${seen})`);
    assert.equal(applied.level.spawns.length, 2); assert.equal(typeof applied.level.fairness.pass, 'boolean');
    // Removing a thing is a card; nothing changes until the creator applies it.
    const tower = applied.level.things.find((t) => t.object === 'tower');
    const card = await call('keel_game_level_ops', { ops: [{ op: 'remove', id: tower.id }] });
    assert.equal(card.status, 'awaiting-creator'); assert.match(card.destructive[0].why, /removes tower/);
    assert.ok(level.live(project.id).state.things.some((t) => t.id === tower.id), 'still there before the card');
    // Regenerating under hand edits is a card too.
    const regen = await call('keel_game_level_generate', { seed: 'agent-2' });
    assert.equal(regen.status, 'awaiting-creator'); assert.match(regen.destructive[0].why, /regenerates the ground under 14 hand edits/);
    await new AgentService({ workspace, hooks }).apply(card.actionId);
    const savedFile = readLevelFile(levelFileOf(workspace.read().state.projects[0], 'isle'));
    assert.equal(savedFile.edits.length, 15, 'the card saved the level with the removal (unsaved work folded in)'); assert.equal(savedFile.edits.at(-1).op, 'remove');
    assert.equal((await level.open(project.id, 'isle', { content: levelFileOf(workspace.read().state.projects[0], 'isle') })).how, 'reloaded');
    const save = await call('keel_game_level_save', {});
    assert.equal(save.status, 'awaiting-creator'); assert.equal(save.file, levelFileName('isle')); assert.ok(save.sizes.level.bytes > 0);
    assert.equal(levelSummary(level.view(level.live(project.id))).file, 'levels/isle.level');
  } finally { level.close(); workspace.close(); }
});
