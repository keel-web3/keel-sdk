// The Sound tab's data and procedures: the sound file and its ops (pure), then
// against a real engine checkout (skipped without one): music recipes and
// songs through the codec and back, seeded variations, sfx settings with an
// event map saved and loaded, the live doc (ops, waiting, destructive batches
// as review cards), auditions reported back, and the assistant's tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newTemplateProject, WorkspaceStore, projectSchema } from '../src/workspace.mjs';
import { findGameEngineRoot } from '../src/game-engine/game-engine-service.mjs';
import { GameSoundService, SOUND_PREVIEW_HEADERS } from '../src/game-engine/sound-service.mjs';
import { BODY_EVENTS, SOUND_FILE, SOUND_FORMAT, applySoundOps, destructiveSoundOps, emptySoundDoc, fileOfDoc, fromBase64url, readSoundFile, soundFileOf, toBase64url, validateSoundOps, withSoundFile, writeSoundFile } from '../src/game-engine/sound-project.mjs';
import { recipeOfInput } from '../src/game-engine/agent-sound-tools.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { AgentService } from '../src/agent-service.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, '../src/game-engine/sound-worker.mjs');
const found = findGameEngineRoot([path.resolve(here, '../../../../keel-engine')]);
const engineTest = found.root ? test : test.skip;
const RECIPE = { from: 'game', seed: '7', spec: { energy: 0.7, darkness: 0.6, weather: ['rain'] }, pins: { keys: 'wurli', mode: 'dorian', key: 'F#', tempo: 88 } };
const SFX = { seed: 'wallrun', style: { name: 'lofi', shoe: 'boot' }, volume: 0.8, body: { wind: true, gain: 1, surfaces: { rail: 'metal', puddle: 'water' }, events: { ledgeGrab: 'wallStart' } }, sounds: { step: { gain: 0.9, jitter: 0.08 } } };

test('the sound file, its ops and the destructive ones (pure)', () => {
  const bytes = Uint8Array.from([0xb1, 1, 2, 3, 250, 251, 252]);
  assert.deepEqual(fromBase64url(toBase64url(bytes)), bytes);
  assert.deepEqual(fromBase64url('sQECA_r7_A'), bytes, 'base64url, no padding');
  const empty = emptySoundDoc();
  const music = { op: 'music', id: 'theme', kind: 'recipe', bytes: 'sQECAw', recipe: RECIPE };
  const r = applySoundOps(empty, [music, { op: 'assign', kind: 'scene', name: 'menu', music: 'theme' }, { op: 'palette', seed: 'x', style: 'chip' }, { op: 'event', event: 'ledgeGrab', sound: 'wallStart' }, { op: 'surface', material: 'rail', surface: 'metal' }, { op: 'tune', sound: 'step', jitter: 0.1 }]);
  assert.deepEqual(empty, emptySoundDoc(), 'the doc given is untouched');
  assert.equal(r.did.length, 6); assert.match(r.did[0], /added music theme/);
  assert.deepEqual(r.doc.assign, [{ kind: 'scene', name: 'menu', music: 'theme' }]);
  assert.deepEqual(r.doc.sfx.body.events, { ledgeGrab: 'wallStart' }); assert.deepEqual(r.doc.sfx.sounds, { step: { jitter: 0.1 } });
  assert.throws(() => applySoundOps(r.doc, [{ op: 'assign', kind: 'level', name: '1', music: 'nope' }]), /No music nope/);
  assert.throws(() => applySoundOps(r.doc, [{ op: 'unevent', event: 'jumped' }]), /plays jump, built in/);
  // Adding is never destructive; replacing, re-pointing, a new palette, remapping and removing are.
  assert.deepEqual(destructiveSoundOps([{ ...music, id: 'boss' }, { op: 'assign', kind: 'level', name: '2', music: 'theme' }, { op: 'event', event: 'dash', sound: 'jump' }, { op: 'palette', volume: 0.5 }], r.doc), []);
  assert.deepEqual(destructiveSoundOps([{ ...music, bytes: 'sQEC' }, { op: 'assign', kind: 'scene', name: 'menu', music: 'boss' }, { op: 'palette', seed: 'y' }, { op: 'event', event: 'ledgeGrab', sound: 'jump' }, { op: 'surface', material: 'rail', surface: 'stone' }, { op: 'unmusic', id: 'theme' }, { op: 'nosfx' }], r.doc).map((d) => d.op), ['music', 'assign', 'palette', 'event', 'surface', 'unmusic', 'nosfx']);
  assert.equal(validateSoundOps([{ op: 'asign' }]).ok, false);
  assert.match(validateSoundOps([{ op: 'assign', kind: 'room', name: 'x', music: 'theme' }]).errors[0].message, /op 0 \(assign\): kind/);
  // The file: bytes only (no JSON views), assignments as they are.
  const content = writeSoundFile(fileOfDoc(r.doc, 'sQUA'));
  const file = readSoundFile(content);
  assert.equal(file.format, SOUND_FORMAT); assert.deepEqual(file.music, [{ id: 'theme', kind: 'recipe', bytes: 'sQECAw' }]); assert.equal(file.sfx, 'sQUA');
  assert.throws(() => readSoundFile('{"format":"nope"}'), /not a keel-game-sound@1/);
  const project = newTemplateProject('Loud game', 'game');
  const saved = withSoundFile(project, content);
  assert.equal(projectSchema.parse(saved).files[0].name, SOUND_FILE); assert.equal(soundFileOf(saved), content);
  assert.equal(withSoundFile(saved, content).files.length, 1, 'saving again replaces the file');
  assert.equal(BODY_EVENTS.landed, 'land');
  assert.match(SOUND_PREVIEW_HEADERS['content-security-policy'], /connect-src 'none'.*sandbox allow-scripts/);
  assert.deepEqual(recipeOfInput({ energy: 0.8, tempo: 90, key: 'A' }), { from: 'game', seed: '1', spec: { energy: 0.8, darkness: 0.6 }, pins: { tempo: 90, key: 'A' } });
  assert.deepEqual(recipeOfInput({ band: 'Nightcap', seed: '3' }), { from: 'mood', seed: '3', mood: { band: 'Nightcap' } });
});

engineTest('music through the codec: a recipe round trip, a song, variations, and sizes', async () => {
  const sound = new GameSoundService({ workerPath, root: found.root });
  try {
    const made = await sound.music({ recipe: RECIPE });
    assert.equal(made.kind, 'recipe'); assert.deepEqual(made.recipe, RECIPE, 'the JSON view is the recipe as written');
    assert.equal(fromBase64url(made.bytes)[0], 0xb1, 'a codec document, id header');
    assert.equal(made.summary.bpm, 88); assert.equal(made.summary.key, 'F#'); assert.equal(made.summary.mode, 'dorian'); assert.equal(made.summary.keys, 'wurli');
    assert.ok(made.sizes.bytes < 64 && made.sizes.json > 2000, `${made.sizes.bytes} bytes against ${made.sizes.json} of JSON`);
    // Back from the bytes: the same recipe, the same plan.
    const back = await sound.music({ bytes: made.bytes });
    assert.deepEqual(back.recipe, RECIPE); assert.deepEqual(back.plan, made.plan);
    // As a song: the plan itself, JSON-equal, bigger than the recipe.
    const song = await sound.music({ recipe: RECIPE, store: 'song' });
    assert.equal(song.kind, 'song'); assert.equal(song.recipe, undefined); assert.deepEqual(song.plan, made.plan); assert.ok(song.sizes.bytes > made.sizes.bytes);
    assert.deepEqual((await sound.music({ bytes: song.bytes })).plan, made.plan);
    // A band preset; bad recipes name the field.
    const cat = await sound.catalogue();
    assert.ok(cat.bands.length > 4 && cat.choices.keys.includes('wurli') && cat.sounds.includes('step') && cat.surfaces.includes('metal'));
    assert.equal((await sound.music({ recipe: { from: 'mood', seed: 'b', mood: { band: cat.bands[0] } } })).kind, 'recipe');
    await assert.rejects(() => sound.music({ recipe: { from: 'game', seed: '1', spec: { energy: 'high' } } }), /energy/);
    await assert.rejects(() => sound.music({ bytes: toBase64url(Uint8Array.from([0xb1, 1, 2, 3, 4, 5])) }), /aren't music/);
    const v = await sound.variations(RECIPE, 4);
    assert.equal(v.variations.length, 4); assert.ok(v.variations.every((item) => item.summary.bpm === 88 && item.summary.keys === 'wurli'), 'pins stay');
    assert.ok(new Set(v.variations.map((item) => JSON.stringify(item.summary))).size === 4, 'each seed its own song');
  } finally { sound.close(); }
});

engineTest('sfx settings and the event map through the codec; the live doc, saved and loaded', async () => {
  const sound = new GameSoundService({ workerPath, root: found.root });
  const P = crypto.randomUUID();
  try {
    const fx = await sound.sfx(SFX);
    assert.deepEqual(fx.settings, SFX); assert.ok(fx.sizes.bytes < fx.sizes.json / 2, `${fx.sizes.bytes} B against ${fx.sizes.json} B of JSON`);
    assert.equal(fx.events.ledgeGrab, 'wallStart'); assert.equal(fx.events.landed, 'land');
    assert.equal(fx.sounds.step.variants, 4, 'four takes of a step'); assert.equal(fx.sounds.step.jitter, 0.08); assert.equal(fx.sounds.jump.jitter, 0.035, 'untuned: the default spread');
    await assert.rejects(() => sound.sfx({ seed: 'a', sounds: { step: { gain: 'loud' } } }), /sounds\.step\.gain|gain/);
    // The live doc: opened empty, ops land, whoever waits sees them.
    const opened = await sound.open(P, '', { editor: true });
    assert.equal(opened.how, 'opened'); assert.equal(opened.unsaved, false); assert.ok(sound.isOpen(P));
    const waiting = sound.wait(P, opened.seq, 5000);
    const r = await sound.apply(P, [{ op: 'music', id: 'theme', recipe: RECIPE }, { op: 'assign', kind: 'race', name: 'final-lap', music: 'theme' }, { op: 'palette', seed: 'wallrun', style: { name: 'lofi', shoe: 'boot' } }, { op: 'event', event: 'ledgeGrab', sound: 'wallStart' }, { op: 'surface', material: 'rail', surface: 'metal' }, { op: 'tune', sound: 'step', gain: 0.9, jitter: 0.08 }]);
    assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.equal(r.unsaved, true);
    const seen = await waiting;
    assert.equal(seen.seq, r.seq); assert.equal(seen.doc.music[0].recipe.seed, '7');
    const bad = await sound.apply(P, [{ op: 'event', event: 'x', sound: 'jump' }, { op: 'assign', kind: 'scene', name: 'a', music: 'missing' }]);
    assert.equal(bad.ok, false); assert.match(bad.errors[0].message, /No music missing/);
    assert.equal(sound.live(P).doc.sfx.body.events.x, undefined, 'a failing batch changes nothing');
    // Saved: the file holds codec bytes only; loaded back, the same doc.
    const content = sound.live(P).content;
    const file = readSoundFile(content);
    assert.equal(file.music[0].kind, 'recipe'); assert.equal(file.sfx[0], 's', 'SFX_SETTINGS bytes (0xB1 header)');
    assert.equal(content.includes('wallStart'), false, 'no JSON view in the file');
    sound.saved(P, content);
    assert.equal(sound.live(P).content === sound.live(P).saved, true);
    const { doc } = await sound.decode(content);
    assert.deepEqual(doc.sfx.body.events, { ledgeGrab: 'wallStart' }); assert.deepEqual(doc.sfx.body.surfaces, { rail: 'metal' }); assert.deepEqual(doc.sfx.sounds.step, { gain: 0.9, jitter: 0.08 });
    assert.deepEqual(doc, sound.live(P).doc);
    assert.equal((await sound.open(P, content)).how, 'unchanged');
    const d = await sound.describe(doc);
    assert.ok(d.totals.records < d.totals.recordsJson / 20, `records ${d.totals.records} B against ${d.totals.recordsJson} B of JSON`);
    // An audition: the tab's page reports; without one it says so.
    const heard = sound.audition(P, { music: 'theme', intensity: 0.3 }, 3000);
    const asked = sound.live(P).audition;
    assert.equal(asked.music, 'theme');
    sound.report(asked.id, { context: 'running', playing: true });
    assert.deepEqual(await heard, { id: asked.id, reported: true, context: 'running', playing: true });
    assert.equal((await sound.audition(P, { sfx: 'jump' }, 50)).reported, false);
    // The page: Tone, keel-audio and the engine's audio in one sandboxed document.
    const html = await sound.page();
    assert.match(html, /^<!doctype html>/); assert.ok(html.includes('soundPreview') && html.length > 200_000);
  } finally { sound.close(); }
});

engineTest('agent tools write, audition and assign music, map sfx, and send destructive changes through a review card', async () => {
  const workspace = new WorkspaceStore(':memory:');
  const project = newTemplateProject('Loud game', 'game');
  workspace.save({ ...workspace.read().state, projects: [project] }, 0);
  const sound = new GameSoundService({ workerPath, root: found.root });
  const navigations = [];
  const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Projects' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('Tests do not use credentials.'); }, gameSound: sound };
  try {
    const chats = new AgentStore(workspace.db); const chat = chats.create({ projectId: project.id }); const run = chats.begin(chat.id, 'Score my game', null);
    const tools = createAgentTools({ workspace, chats, chat, run, hooks, signal: new AbortController().signal, emit: (event) => { if (event.type === 'navigate') navigations.push(event.action.payload); } });
    const call = async (name, input) => JSON.parse(await tools.find((tool) => tool.name === name).invoke(input));
    for (const name of ['keel_game_sound_state', 'keel_game_music', 'keel_game_sfx', 'keel_game_sound_save']) assert.ok(tools.some((tool) => tool.name === name), name);
    const first = await call('keel_game_sound_state', {});
    assert.deepEqual(first.music, []); assert.ok(first.catalogue.bands.length);
    const gen = await call('keel_game_music', { action: 'generate', energy: 0.9, darkness: 0.2, tempo: 92, keys: 'organ', variations: 2 });
    assert.equal(gen.summary.bpm, 92); assert.equal(gen.variations.length, 2); assert.match(gen.hint, /Nothing changed/);
    assert.equal(sound.live(project.id).doc.music.length, 0);
    // Adding and assigning: live, the Sound tab is shown.
    const added = await call('keel_game_music', { action: 'add', id: 'race', title: 'Race theme', energy: 0.9, tempo: 92, assign: [{ kind: 'race', name: 'final-lap' }, { kind: 'state', name: 'boost' }] });
    assert.equal(added.ok, true); assert.equal(added.unsaved, true); assert.deepEqual(navigations[0], { page: 'Projects', projectId: project.id, tab: 'Sound' });
    assert.deepEqual(sound.live(project.id).doc.assign.map((a) => `${a.kind}:${a.name}`), ['race:final-lap', 'state:boost']);
    // An audition: the tab reports back (played here by a stand-in page).
    const standIn = setInterval(() => { const a = sound.live(project.id).audition; if (a) { clearInterval(standIn); sound.report(a.id, { context: 'running', playing: true, plays: 1 }); } }, 25);
    const heard = await call('keel_game_music', { action: 'audition', id: 'race', intensity: 0.8 });
    assert.equal(heard.report.playing, true);
    // Sfx: new mappings land live; remapping one is a card.
    const fx = await call('keel_game_sfx', { palette: { seed: 'kart', style: 'chip' }, events: [{ event: 'boostStart', sound: 'railStart' }], surfaces: [{ material: 'dirt', surface: 'stone' }], tune: [{ sound: 'land', jitter: 0.1 }] });
    assert.equal(fx.ok, true); assert.equal(fx.sfx.events.boostStart, 'railStart'); assert.equal(fx.sfx.surfaces.dirt, 'stone');
    await assert.rejects(() => tools.find((tool) => tool.name === 'keel_game_sfx').invoke({ events: [{ event: 'x', sound: 'boing' }] }), /No sound "boing"/);
    const remap = await call('keel_game_sfx', { events: [{ event: 'boostStart', sound: 'jump' }] });
    assert.equal(remap.status, 'awaiting-creator'); assert.match(remap.destructive[0].why, /remaps boostStart/);
    assert.equal(sound.live(project.id).doc.sfx.body.events.boostStart, 'railStart', 'nothing changed before the card');
    // Replacing music is a card too; applied, the project's file has it (unsaved work folded in).
    const replace = await call('keel_game_music', { action: 'add', id: 'race', energy: 0.2, darkness: 0.9 });
    assert.equal(replace.status, 'awaiting-creator'); assert.match(replace.destructive[0].why, /replaces the music race/);
    await new AgentService({ workspace, hooks }).apply(replace.actionId);
    const saved = soundFileOf(workspace.read().state.projects[0]);
    const { doc } = await sound.decode(saved);
    assert.equal(doc.music[0].recipe.spec.energy, 0.2); assert.equal(doc.sfx.body.events.boostStart, 'railStart'); assert.equal(doc.assign.length, 2);
    // (The Sound tab reopens from the saved file: a different file reloads the doc.)
    assert.equal((await sound.open(project.id, saved)).how, 'reloaded');
    const save = await call('keel_game_sound_save', {});
    assert.equal(save.status, 'awaiting-creator'); assert.equal(save.file, SOUND_FILE);
  } finally { sound.close(); workspace.close(); }
});
