// The KEEL builder in the editor: build files and destructive batches (pure),
// then against a real engine checkout (skipped without one): a small voxel
// build through ops with its preview frames, undo/redo mirrored exactly, a
// character, variants and clips, the pack-file export loaded back, an import
// of an engine sample replayed into a build, a recycled worker reopening a
// build, and the assistant's tools (live ops, a review card for destructive
// batches, import, save).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newTemplateProject, WorkspaceStore, projectSchema } from '../src/workspace.mjs';
import { findGameEngineRoot } from '../src/game-engine/game-engine-service.mjs';
import { GameBuilderService, BUILDER_PREVIEW_HEADERS } from '../src/game-engine/builder-service.mjs';
import { BUILD_FORMAT, buildFileName, builderKey, destructiveOps, importable, opsHash, packFileName, projectBuilds, readBuildFile, sameOps, withBuildFile, withPackFiles, writeBuildFile } from '../src/game-engine/builder-project.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { AgentService } from '../src/agent-service.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '../src/game-engine/builder-worker.mjs');
const found = findGameEngineRoot([path.resolve(here, '../../../../keel-engine')]);
const engineTest = found.root ? test : test.skip;
const HUT = [
  { op: 'new', name: 'hut', unit: 0.12 }, { op: 'symmetry', mode: 'x' },
  { op: 'box', from: [0, 0, -4], to: [5, 6, 4], role: 'primary', hollow: true },
  { op: 'box', from: [0, 7, -5], to: [6, 7, 5], role: 'secondary' }, { op: 'box', from: [0, 8, -4], to: [4, 8, 4], role: 'secondary' },
  { op: 'symmetry', mode: 'none' }, { op: 'box', from: [-1, 0, 4], to: [0, 3, 4], role: 'dark' },
  { op: 'group', name: 'door', from: [-1, 0, 4], to: [0, 3, 4] }, { op: 'animate', group: 'door', motion: 'hinge' },
  { op: 'box', from: [3, 3, 5], to: [3, 4, 5], role: 'glow' }, { op: 'target', as: 'object', id: 'hut' },
];

test('a build is its op list, saved as a project file; destructive batches are named', () => {
  const project = newTemplateProject('Voxel yard', 'game');
  const saved = withBuildFile(project, 'main', HUT);
  assert.equal(projectSchema.parse(saved).files.length, 1);
  assert.equal(saved.files[0].name, buildFileName('main')); assert.equal(saved.files[0].type, 'application/json');
  assert.deepEqual(readBuildFile(saved.files[0].content), { name: 'main', ops: HUT });
  assert.equal(JSON.parse(writeBuildFile('main', [])).format, BUILD_FORMAT);
  const again = withBuildFile(saved, 'main', HUT.slice(0, 3));
  assert.equal(again.files.length, 1, 'saving again replaces the file'); assert.equal(again.files[0].id, saved.files[0].id);
  assert.deepEqual(projectBuilds(again).map(b => [b.name, b.ops.length]), [['main', 3]]);
  const broken = { ...again, files: [...again.files, { id: crypto.randomUUID(), name: 'builds/bad.build.json', type: 'application/json', content: '{"nope":1}' }] };
  assert.match(projectBuilds(broken).find(b => b.name === 'bad').error, /not a keel-game-build@1/);
  assert.throws(() => withBuildFile(project, 'Bad Name', []), /build name/);
  const packed = withPackFiles(saved, [{ name: packFileName('War Banner'), content: 'export default 1;\n' }]);
  assert.equal(packed.files[1].name, 'packs/war-banner.ts'); assert.equal(packed.files[1].type, 'text/typescript');
  assert.equal(opsHash(HUT), opsHash(JSON.parse(JSON.stringify(HUT)))); assert.notEqual(opsHash(HUT), opsHash(HUT.slice(1)));
  assert.ok(sameOps(HUT, structuredClone(HUT)) && !sameOps(HUT, HUT.slice(1)));
  assert.equal(builderKey('p', 'main'), 'p/main');
  assert.ok(importable('Knight.GLB') && importable('crate.obj') && importable('robot.vox') && !importable('photo.png'));
  // (An empty build loses nothing; one with work loses what these ops throw away.)
  assert.deepEqual(destructiveOps(HUT, { model: { count: 0 }, history: { total: 0 } }), []);
  const work = { model: { count: 12 }, history: { total: 3 } };
  assert.deepEqual(destructiveOps([{ op: 'box', from: [0, 0, 0], to: [1, 1, 1], role: 'primary' }, { op: 'erase', from: [0, 0, 0], to: [1, 1, 1] }, { op: 'undo' }], work), []);
  assert.deepEqual(destructiveOps([{ op: 'generate', kind: 'tree', seed: '2' }, { op: 'erase' }, { op: 'undo', steps: 4 }, { op: 'character', kind: 'anthro' }], work).map(d => d.op), ['generate', 'erase', 'undo', 'character']);
  assert.match(BUILDER_PREVIEW_HEADERS['content-security-policy'], /connect-src 'none'.*sandbox allow-scripts/);
});

engineTest('a voxel build through ops: live frames, per-op results, undo and redo mirrored, variants, clips, the pack file loaded back', async () => {
  const builder = new GameBuilderService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const opened = await builder.open(P, 'main', [], { editor: true });
    assert.equal(opened.how, 'opened'); assert.equal(opened.state.model.count, 0); assert.equal(builder.openBuildOf(P), 'main');
    // Frames while it streams: the latest waits for whoever asks next.
    const seen = [];
    const watching = (async () => { let after = 0; for (;;) { const next = await builder.frame(P, 'main', after, 3000); if (!next.frame) return; after = next.seq; seen.push(next.frame); } })();
    const long = [...HUT, ...Array.from({ length: 40 }, (_, i) => ({ op: 'set', at: [-8 + (i % 16), i < 16 ? 0 : 1, -8], role: 'trim' }))];
    const r = await builder.apply(P, 'main', long);
    assert.equal(r.ok, true); assert.equal(r.applied, long.length);
    assert.equal(r.results[2].did, '476 voxels changed', 'a mirrored hollow box');
    assert.match(r.results[7].did, /^group door: 8 voxels/);
    assert.equal(r.state.target.as, 'object'); assert.deepEqual(r.state.groups.map(g => g.name), ['door']);
    await watching;
    assert.ok(seen.length >= 3, `the build drew in steps (${seen.length} frames)`);
    assert.ok(seen.some(f => /^op \d+\/\d+ /.test(f.label) && f.done < f.total), 'progress frames during the stream');
    const last = seen.at(-1);
    assert.equal(last.voxels, r.state.model.count); assert.ok(last.boxes.length > 4 && last.boxes.length <= 256);
    assert.ok(last.look.materials.length > 6 && last.look.ramps.primary, 'the frame carries its look');
    // A bad op: nothing applied, the error names the op and suggests the fix.
    const bad = await builder.apply(P, 'main', [{ op: 'boxx', from: [0, 0, 0] }]);
    assert.equal(bad.ok, false); assert.equal(bad.applied, 0); assert.match(bad.errors[0].message, /did you mean "box"/);
    // A failing op mid-list: those before it stay (each undoable).
    const mid = await builder.apply(P, 'main', [{ op: 'set', at: [0, 12, 0], role: 'accent' }, { op: 'animate', group: 'doorr', motion: 'spin' }, { op: 'set', at: [0, 13, 0], role: 'accent' }]);
    assert.equal(mid.ok, false); assert.equal(mid.applied, 1); assert.match(mid.errors[0].message, /did you mean "door"/);
    // Undo and redo: the op list the editor saves is the history the builder holds.
    const before = builder.log(P, 'main').length;
    await builder.apply(P, 'main', [{ op: 'undo' }, { op: 'undo' }, { op: 'redo' }]);
    assert.equal(builder.log(P, 'main').length, before - 1);
    const state = await builder.state(P, 'main', { log: true });
    assert.deepEqual(state.ops, builder.log(P, 'main')); assert.equal(state.opsHash, opsHash(state.ops)); assert.equal(state.history.undone, 1);
    assert.equal(builder.saved(P, 'main', state.ops), true); assert.equal(builder.saved(P, 'main', HUT), false);
    // Reopening from the saved ops keeps what's open; saved ops that extend it stream in.
    assert.equal((await builder.open(P, 'main', state.ops)).how, 'unchanged');
    const extended = await builder.open(P, 'main', [...state.ops, { op: 'set', at: [0, 14, 0], role: 'glow' }]);
    assert.equal(extended.how, 'extended'); assert.equal(extended.state.history.total, state.ops.length + 1);
    assert.equal((await builder.open(P, 'main', state.ops)).how, 'kept-unsaved');
    // A recycled worker (the engine's sources changed) reopens the build from its log.
    const count = extended.state.model.count;
    builder.recycle();
    assert.equal((await builder.state(P, 'main')).model.count, count);
    // Variants need rules; the door's hinge is a clip; the pack file loads back as the same object.
    assert.match((await builder.variants(P, 'main', 2)).note, /No variation rules/);
    await builder.apply(P, 'main', [{ op: 'vary', group: 'door', y: [0.7, 1.3], anchor: 'bottom' }, { op: 'vary', size: [0.8, 1.2] }]);
    const variants = await builder.variants(P, 'main', 4);
    assert.equal(variants.rules, 2); assert.equal(variants.variants.length, 4); assert.ok(variants.variants.every(v => v.boxes.length && v.look));
    const clip = await builder.poses(P, 'main');
    assert.equal(clip.kind, 'object'); assert.equal(clip.clip, 'idle'); assert.equal(clip.frames.length, 8, 'the hinge baked in eight frames');
    assert.notDeepEqual(clip.frames[0].boxes, clip.frames[3].boxes, 'the door moved');
    const pack = await builder.exportPack(P, 'main');
    assert.equal(pack.kind, 'object'); assert.equal(pack.id, 'hut'); assert.match(pack.code, /objectFromVoxels\(VOXELS/);
    const back = await builder.loadPack(pack.code);
    assert.equal(back.kind, 'object'); assert.equal(back.id, 'hut'); assert.ok(back.parts > 0 && back.colliders > 0);
    assert.equal(back.meta.voxels, (await builder.state(P, 'main')).model.count, 'the same voxels came back');
    // Rigged: a generated critter, a joint moved by an op, the overlay's joints in voxels and preview metres.
    const rigged = await builder.apply(P, 'main', [{ op: 'generate', kind: 'critter', seed: '3', plan: 'quadruped' }, { op: 'rig', as: 'quadruped' }]);
    const head = rigged.frame.rig.bones.find(b => b.name === 'head');
    assert.equal(rigged.frame.rig.editable, true); assert.equal(rigged.state.rig.plan, 'quadruped');
    const moved = await builder.apply(P, 'main', [{ op: 'joint', bone: 'head', at: [head.vox[0], head.vox[1] + 2, head.vox[2]] }]);
    assert.equal(moved.frame.rig.bones.find(b => b.name === 'head').vox[1], head.vox[1] + 2);
    const entity = await builder.exportPack(P, 'main');
    assert.equal(entity.kind, 'entity'); assert.equal((await builder.loadPack(entity.code)).body, 'body/quadruped@1.0.0');
    assert.equal((await builder.poses(P, 'main', 'walk')).frames.length, 8);
  } finally { builder.close(); }
});

engineTest('a character through ops, and a worn voxel group exported as its own attribute', async () => {
  const builder = new GameBuilderService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    await builder.open(P, 'fox', []);
    const r = await builder.apply(P, 'fox', [
      { op: 'character', kind: 'anthro', species: 'fox', seed: '7' }, { op: 'pin', choice: 'ears', value: 'tall' }, { op: 'proportion', name: 'headR', scale: 1.2 },
      { op: 'part', id: 'horn.L', shape: 'capsule', on: 'head', a: [-0.22, -0.1, 0.05], b: [-0.4, 0.7, -0.1], r: 0.09, role: 'dark' }, { op: 'wear', attribute: 'top-hat' },
    ]);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.frame.kind, 'character'); assert.ok(r.frame.capsules.length > 10);
    const c = r.state.character;
    assert.equal(c.species, 'fox'); assert.equal(c.pins.ears, 'tall'); assert.deepEqual(c.parts.map(p => p.id), ['horn.L']); assert.deepEqual(c.wear.map(w => w.attribute), ['top-hat']);
    assert.ok(c.choices.find(ch => ch.name === 'ears').options.includes('tall')); assert.ok(c.sockets.includes('head')); assert.ok('headR' in c.proportions);
    assert.equal(r.frame.rig.editable, false); assert.ok(r.frame.rig.bones.length > 10);
    assert.equal((await builder.poses(P, 'fox', 'run')).kind, 'character');
    const variants = await builder.variants(P, 'fox', 3);
    assert.equal(variants.mode, 'character'); assert.equal(new Set(variants.variants.map(v => v.seed)).size, 3);
    const pack = await builder.exportPack(P, 'fox');
    assert.equal(pack.kind, 'character'); assert.match(pack.code, /characterEntity\(/);
    // Voxels with a group worn on the head: the body exports, and the hat as its own attribute file.
    const worn = await builder.apply(P, 'fox', [{ op: 'new', name: 'guard', unit: 0.0625 }, { op: 'symmetry', mode: 'x' }, { op: 'box', from: [0, 0, -2], to: [3, 11, 1], role: 'secondary' }, { op: 'box', from: [0, 12, -2], to: [3, 23, 1], role: 'primary' }, { op: 'box', from: [4, 12, -2], to: [7, 23, 1], role: 'primary' }, { op: 'box', from: [0, 24, -4], to: [3, 31, 3], role: 'skin' }, { op: 'box', from: [0, 32, -4], to: [4, 34, 4], role: 'dark' }, { op: 'symmetry', mode: 'none' }, { op: 'group', name: 'helmet', from: [-5, 32, -4], to: [4, 34, 4] }, { op: 'attach', group: 'helmet', socket: 'head' }, { op: 'rig', as: 'humanoid' }]);
    assert.equal(worn.ok, true, JSON.stringify(worn.errors));
    const both = await builder.exportPack(P, 'fox');
    assert.equal(both.kind, 'entity'); assert.deepEqual(both.attributes.map(a => [a.group, a.slot]), [['helmet', 'head']]);
    const hat = await builder.loadPack(both.attributes[0].code);
    assert.equal(hat.kind, 'attribute'); assert.equal(hat.slot, 'head');
  } finally { builder.close(); }
});

engineTest('an import: views, the proposal, and its op list replayed into a build', async () => {
  const builder = new GameBuilderService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const sample = await builder.sample('robot');
    const r = await builder.importFile({ bytes: sample.bytes, name: 'robot', voxels: 32 });
    assert.deepEqual(r.views.map(v => v.id), ['source', 'voxels', 'parts', 'split']);
    for (const v of r.views) { assert.match(v.url, /^data:image\/png;base64,/); assert.ok(v.url.length < 60_000, `${v.id} is a deflated PNG`); }
    assert.equal(r.proposal.kind, 'creature'); assert.ok(r.proposal.attributes.some(a => a.slot === 'head'), 'the antenna is worn on the head');
    assert.ok(r.stats.parts >= 2 && r.ops.length > 10); assert.deepEqual(Object.keys(r.hues).sort(), r.proposal.parts.map(p => p.id).sort());
    await builder.open(P, 'robot', []);
    const replay = await builder.apply(P, 'robot', r.ops);
    assert.equal(replay.ok, true, JSON.stringify(replay.errors)); assert.equal(replay.state.model.count, r.stats.voxels);
    assert.ok(replay.state.groups.some(g => g.attached?.socket === 'head'), 'the worn part is attached');
    // Adjust with builder ops: make it body, then wear it again elsewhere.
    const part = replay.state.groups.find(g => g.attached).name;
    assert.equal((await builder.apply(P, 'robot', [{ op: 'detach', group: part }])).state.groups.find(g => g.name === part).attached, null);
    // From a workspace file (the content-addressed store), as the Import panel and the assistant read it.
    const store = new WorkspaceStore(':memory:');
    const next = store.importObject(Buffer.from(sample.bytes), 'robot.vox', 'application/octet-stream', 0);
    const object = next.state.objects[0];
    const { importBytes } = await import('../src/game-engine/builder-project.mjs');
    const file = await importBytes(store, object.id);
    assert.equal(file.name, 'robot'); assert.equal(file.bytes.byteLength, sample.bytes.byteLength);
    await assert.rejects(() => importBytes(store, 'f'.repeat(64)), /Import this file into KEEL first/);
    store.close();
    // The preview document: the engine's renderer and baker bundled into one sandboxed page.
    const html = await builder.preview();
    assert.match(html, /^<!doctype html>/); assert.ok(html.includes('builderPreview') && html.length > 50_000);
  } finally { builder.close(); }
});

engineTest('agent tools draw live, send destructive batches through a review card, import and save', async () => {
  const workspace = new WorkspaceStore(':memory:');
  const project = newTemplateProject('Voxel yard', 'game');
  workspace.save({ ...workspace.read().state, projects: [project] }, 0);
  const builder = new GameBuilderService({ workerPath, root: found.root });
  const navigations = [];
  const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Projects' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); }, gameBuilder: builder };
  try {
    const chats = new AgentStore(workspace.db); const chat = chats.create({ projectId: project.id }); const run = chats.begin(chat.id, 'Build me a hut', null);
    const tools = createAgentTools({ workspace, chats, chat, run, hooks, signal: new AbortController().signal, emit: (event) => { if (event.type === 'navigate') navigations.push(event.action.payload); } });
    const call = async (name, input) => JSON.parse(await tools.find(tool => tool.name === name).invoke(input));
    for (const name of ['keel_game_build_state', 'keel_game_build_ops', 'keel_game_generate', 'keel_game_import', 'keel_game_build_save']) assert.ok(tools.some(tool => tool.name === name), name);
    const first = await call('keel_game_build_state', { reference: true });
    assert.equal(first.build, 'main'); assert.equal(first.model.count, 0); assert.match(first.opReference, /\| `box` \|/);
    // An empty build: a generated banner draws at once (and the editor is asked to show it).
    const banner = await call('keel_game_generate', { kind: 'banner', seed: '4', then: [{ op: 'animate', group: 'cloth', motion: 'wave', hz: 0.5 }] });
    assert.equal(banner.ok, true); assert.equal(banner.applied, 2); assert.ok(banner.state.model.count > 0);
    assert.deepEqual(navigations[0], { page: 'Projects', projectId: project.id, tab: 'Builder' });
    const ops = await call('keel_game_build_ops', { ops: [{ op: 'box', from: [4, 0, -1], to: [5, 2, 0], role: 'accent' }] });
    assert.equal(ops.ok, true); assert.match(ops.results[0], /voxels changed/);
    await assert.rejects(() => tools.find(tool => tool.name === 'keel_game_build_ops').invoke({ ops: [{ op: 'sphere', center: [0, 0, 0] }] }), /"radius" is required.*nothing was applied|nothing was applied.*"radius" is required/s);
    // Now it has work: generating over it is a review card, and nothing changes until the creator applies it.
    const logBefore = builder.log(project.id, 'main').length;
    const card = await call('keel_game_generate', { kind: 'critter', seed: '9', plan: 'quadruped' });
    assert.equal(card.status, 'awaiting-creator'); assert.equal(card.applied, 0); assert.match(card.destructive[0].why, /replaces the build/);
    assert.equal(builder.log(project.id, 'main').length, logBefore); assert.equal(workspace.read().state.projects[0].files.length, 0);
    await new AgentService({ workspace, hooks }).apply(card.actionId);
    const saved = projectBuilds(workspace.read().state.projects[0])[0];
    assert.equal(saved.ops.length, logBefore + 1); assert.equal(saved.ops.at(-1).op, 'generate');
    // (The Builder then opens the saved ops: they extend what's open, so only the generate streams in.)
    const synced = await builder.open(project.id, 'main', saved.ops);
    assert.equal(synced.how, 'extended'); assert.match(synced.state.history.recent[0].did, /^generated critter-9/);
    // An import from the workspace's files: the build has work, so it's a card too.
    const sample = await builder.sample('robot');
    const imported = workspace.importObject(Buffer.from(sample.bytes), 'robot.vox', 'application/octet-stream', workspace.read().revision);
    const robot = await call('keel_game_import', { objectId: imported.state.objects[0].id, voxels: 28 });
    assert.equal(robot.kind, 'creature'); assert.ok(robot.worn.some(w => w.slot === 'head')); assert.equal(robot.opened.status, 'awaiting-creator');
    // Save: the build file and its pack file, on a card.
    const save = await call('keel_game_build_save', {});
    assert.equal(save.status, 'awaiting-creator'); assert.deepEqual(save.files, ['builds/main.build.json', 'packs/critter-9.ts']);
    await new AgentService({ workspace, hooks }).apply(save.actionId);
    const files = workspace.read().state.projects[0].files.map(f => f.name).sort();
    assert.deepEqual(files, ['builds/main.build.json', 'packs/critter-9.ts']);
  } finally { builder.close(); workspace.close(); }
});

engineTest('follow-ups: frames carry the counts the stat cards show, a variant used as ops, the pixel look by default', async () => {
  const builder = new GameBuilderService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    await builder.open(P, 'main', [], { editor: true });
    // Every frame -- progress ones too -- says how many ops and voxels the build has now (the state lags a stream).
    const seen = [];
    const watching = (async () => { let after = 0; for (;;) { const next = await builder.frame(P, 'main', after, 3000); if (!next.frame) return; after = next.seq; seen.push(next.frame); } })();
    const r = await builder.apply(P, 'main', [...HUT, ...Array.from({ length: 30 }, (_, i) => ({ op: 'set', at: [-8 + (i % 15), i < 15 ? 0 : 1, -9], role: 'trim' }))]);
    await watching;
    assert.ok(seen.every((f) => f.history && Number.isInteger(f.history.total)), 'every frame has the history count');
    const totals = seen.map((f) => f.history.total);
    assert.ok(totals.some((n) => n > 1 && n < r.state.history.total), `mid-stream counts (${totals.join(',')})`);
    assert.equal(seen.at(-1).history.total, r.state.history.total); assert.equal(seen.at(-1).voxels, r.state.model.count); assert.equal(seen.at(-1).target.id, 'hut');
    // A voxel variant as ops: the build becomes it, and one undo of that many ops takes it back.
    await builder.apply(P, 'main', [{ op: 'vary', group: 'door', y: [0.6, 1.4], anchor: 'bottom' }, { op: 'vary', size: [0.8, 1.2] }]);
    const variants = await builder.variants(P, 'main', 6);
    const before = await builder.state(P, 'main');
    const made = await builder.variantOps(P, 'main', 2);
    assert.equal(made.mode, 'voxels'); assert.ok(made.ops.length > 0); assert.deepEqual(made.picked, variants.variants[2].picked);
    assert.deepEqual(destructiveOps(made.ops, before), [], 'a voxel variant loses nothing');
    const used = await builder.apply(P, 'main', made.ops);
    assert.equal(used.ok, true, JSON.stringify(used.errors)); assert.equal(used.state.model.count, variants.variants[2].voxels, 'the build is the variant');
    assert.equal(used.state.model.symmetry.mode, before.model.symmetry.mode, 'symmetry as it was');
    const back = await builder.apply(P, 'main', [{ op: 'undo', steps: used.applied }]);
    assert.equal(back.state.model.count, before.model.count);
    // The pack file: the pixel look by default (capsules for long boxes), the voxel look on request; both load.
    const pixel = await builder.exportPack(P, 'main');
    assert.equal(pixel.look, 'pixel'); assert.match(pixel.code, /^\/\/ Look: pixel/); assert.match(pixel.code, /smooth: \{\s*capsules: true/);
    const voxel = await builder.exportPack(P, 'main', { look: 'voxel' });
    assert.equal(voxel.look, 'voxel'); assert.doesNotMatch(voxel.code, /capsules: true/);
    assert.equal((await builder.loadPack(pixel.code)).id, 'hut'); assert.equal((await builder.loadPack(voxel.code)).id, 'hut');
    // A character variant: the same design with the variant's seed (pins, proportions, parts and wear kept).
    await builder.apply(P, 'main', [{ op: 'character', kind: 'anthro', species: 'fox', seed: '7' }, { op: 'pin', choice: 'ears', value: 'tall' }, { op: 'proportion', name: 'headR', scale: 1.2 }, { op: 'part', id: 'horn.L', shape: 'capsule', on: 'head', a: [-0.22, -0.1, 0.05], b: [-0.4, 0.7, -0.1], r: 0.09, role: 'dark' }, { op: 'wear', attribute: 'top-hat' }]);
    const cv = await builder.variants(P, 'main', 6);
    const cops = await builder.variantOps(P, 'main', 4);
    assert.equal(cops.mode, 'character'); assert.equal(cops.seed, cv.variants[4].seed);
    assert.deepEqual(destructiveOps(cops.ops, await builder.state(P, 'main')).map((d) => d.op), ['character'], 'starting the character over is reviewed first');
    const c = (await builder.apply(P, 'main', cops.ops)).state.character;
    assert.equal(c.seed, cv.variants[4].seed); assert.equal(c.pins.ears, 'tall'); assert.deepEqual(c.parts.map((p) => p.id), ['horn.L']); assert.deepEqual(c.wear.map((w) => w.attribute), ['top-hat']);
    assert.equal(c.species, cv.variants[4].picked.species);
  } finally { builder.close(); }
});
