// Agent tools for a Game project's sound: the assistant writes music from a
// mood or pins (the engine's composer; stored as the codec's MUSIC_RECIPE or
// SONG), auditions it in the creator's Sound tab (the sandboxed page plays it
// and reports back), assigns it to scenes, levels, races and states, and maps
// the sound effects (palette, events, footstep surfaces, each sound's tuning).
// Additions land live in the Sound tab's doc (the creator sees them, then
// saves); a change that throws work away -- replacing or removing music,
// re-pointing an assignment, a new palette, remapping an event -- goes through
// the existing project-edit review card instead: the project's sound file with
// the change made, which the Sound tab reloads when the creator applies it.
// Nothing here publishes or signs.
import { z } from 'zod';
import { isGameProject } from './game-project.mjs';
import { ASSIGN_KINDS, SOUND_FILE, destructiveSoundOps, soundFileOf, soundId, withSoundFile } from './sound-project.mjs';
import { projectSchema } from '../workspace.mjs';

const uuid = z.string().uuid();
const share = z.number().min(0).max(1);
const moodInput = {
  seed: z.string().min(1).max(64).optional().describe('The seed that writes the song (default "1"): other seeds are other songs in the same mood'),
  band: z.string().max(40).optional().describe('A band preset (keel_game_sound_state lists them) instead of a game mood'),
  energy: share.optional().describe('0 idle/menus ... 1 driving; also the intensity it starts at'), darkness: share.optional().describe('0 day (major, bright) ... 1 deep night (minor, jazzy)'),
  weather: z.array(z.string().max(20)).max(6).optional().describe('Layers under the record: rain, waves, traffic, wind, hush, crickets, car, chimes, shimmer'),
  hue: z.number().min(0).max(360).optional().describe("The key round the circle of fifths (a palette's hue)"),
  tempo: z.number().min(40).max(220).optional().describe('Pin the bpm'), key: z.string().max(3).optional().describe('Pin the key: C ... B'), mode: z.string().max(12).optional().describe('Pin the scale: ionian dorian phrygian lydian mixolydian aeolian harmonic'),
  keys: z.string().max(12).optional(), lead: z.string().max(12).optional(), bass: z.string().max(12).optional(), kit: z.string().max(12).optional(),
  recipe: z.record(z.string(), z.unknown()).optional().describe('A MUSIC_RECIPE in its JSON view ({ from: "game", seed, spec, pins } or { from: "mood", seed, mood, pins }) instead of the fields above'),
};
const target = z.object({ kind: z.enum(ASSIGN_KINDS), name: z.string().trim().min(1).max(80) }).strict();

/** The recipe the fields describe (the codec's JSON view). */
export function recipeOfInput(input) {
  if (input.recipe) return input.recipe;
  const pins = Object.fromEntries(['tempo', 'key', 'mode', 'keys', 'lead', 'bass', 'kit'].filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));
  const base = input.band
    ? { from: 'mood', seed: input.seed ?? '1', mood: { band: input.band, ...(input.energy !== undefined ? { energy: input.energy } : {}), ...(input.hue !== undefined ? { hue: input.hue } : {}) } }
    : { from: 'game', seed: input.seed ?? '1', spec: { energy: input.energy ?? 0.5, darkness: input.darkness ?? 0.6, ...(input.weather?.length ? { weather: input.weather } : {}), ...(input.hue !== undefined ? { hue: input.hue } : {}) } };
  return Object.keys(pins).length ? { ...base, pins } : base;
}

export function registerGameSoundTools({ register, project, canEdit, access, action, hooks, digest, navigate }) {
  const sound = hooks.gameSound;
  if (!sound) return;
  const ready = () => { access(); const status = sound.status(); if (!status.available) throw Error(status.reason); return sound; };

  /** The project and its live sound doc (opened from the saved file if the Sound tab hasn't). */
  async function target_({ projectId }) {
    const p = project(projectId);
    if (!isGameProject(p)) throw Error('Sound belongs to Game projects. Create one from the Game template first.');
    const s = ready();
    if (!s.live(p.id)) await s.open(p.id, soundFileOf(p));
    return { p, s };
  }
  async function show(p) {
    const view = hooks.view?.();
    if (!(view?.page === 'Projects' && view.projectId === p.id && view.tab === 'Sound')) {
      if (navigate) navigate('Hear it in the Sound tab', { page: 'Projects', projectId: p.id, tab: 'Sound' });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  /** Apply sound ops live, or propose them on a review card when they'd throw work away. */
  async function change(input, ops, summary) {
    canEdit();
    const { p, s } = await target_(input);
    const pre = await s.preview(p.id, ops);
    if (!pre.ok) throw Error(`Those sound ops don't check out; nothing was changed. ${pre.errors.slice(0, 6).map((e) => e.message).join(' ')}`);
    const destructive = destructiveSoundOps(pre.ops, s.live(p.id).doc);
    if (destructive.length) {
      const next = projectSchema.parse(withSoundFile(p, pre.content));
      const card = action('project-edit', summary ?? `Sound: ${destructive.map((item) => item.why).join('; ')}`, { projectId: p.id, before: digest(p), previous: p, next });
      return { ...card, destructive, applied: 0, did: pre.did, note: `Nothing changed yet: this replaces or removes sound the project has, so the creator reviews it first. Applying the card saves ${SOUND_FILE} with it (unsaved Sound tab work included) and the Sound tab reloads.` };
    }
    await show(p);
    const r = await s.apply(p.id, pre.ops);
    return { ok: r.ok, did: r.did, unsaved: r.unsaved, hint: 'Applied live in the Sound tab (unsaved): the creator saves it there, or propose that with keel_game_sound_save.' };
  }
  const describe = async (p, s) => { const d = await s.describe(s.live(p.id).doc); return { music: d.music, assign: s.live(p.id).doc.assign, sfx: d.sfx && { settings: d.sfx.settings, sizes: d.sfx.sizes, events: d.sfx.events, surfaces: d.sfx.surfaces }, totals: d.totals, unsaved: s.live(p.id).content !== s.live(p.id).saved }; };

  register('keel_game_sound_state', 'Read a Game project\'s sound: its music (each a MUSIC_RECIPE or SONG: key, scale, bpm, instruments, bars, bytes against the plan\'s JSON), what plays for which scene, level, race or state, the sound effects (palette, event -> sound table, footstep surfaces by material, each sound\'s tuning) and what the composer offers (band presets, instruments, scales, weather, sound names, styles, surfaces).', z.object({ projectId: uuid.optional() }).strict(), async (input) => {
    const { p, s } = await target_(input);
    return { ...await describe(p, s), catalogue: await s.catalogue(), soundTabOpen: s.isOpen(p.id) };
  });

  register('keel_game_music', `Music for a Game project with the engine's composer. action "generate": write a recipe from a mood (energy, darkness, weather, hue) or a band preset, with pins (tempo, key, mode/scale, keys, lead, bass, kit) and a seed -- returns the plan's summary, the recipe and its size as codec bytes against the plan's JSON; variations: n adds that many other seeds. "audition": play it (or a saved music id) in the creator's Sound tab at an intensity (it opens the tab; returns the page's report: audio context state, playing). "add": save it into the project's sound as \`id\` (store "recipe", the tiny MUSIC_RECIPE, or "song", the plan as a SONG) and assign it to targets (${ASSIGN_KINDS.join(', ')}). "assign": assign an existing id. Adding lands live in the Sound tab; replacing music or re-pointing a target goes through a review card.`, z.object({
    projectId: uuid.optional(), action: z.enum(['generate', 'audition', 'add', 'assign']), id: soundId.optional().describe('The music id (add, assign, or audition a saved one)'), title: z.string().max(120).optional(),
    store: z.enum(['recipe', 'song']).default('recipe'), assign: z.array(target).max(32).optional(), intensity: share.optional().describe('Audition intensity (0 idle, 0.5 as composed, 1 driving)'),
    variations: z.number().int().min(0).max(8).default(0), summary: z.string().max(500).optional(), ...moodInput,
  }).strict(), async (input) => {
    const { p, s } = await target_(input);
    const saved = input.id ? s.live(p.id).doc.music.find((m) => m.id === input.id) : null;
    const hasMood = !!input.recipe || ['band', 'energy', 'darkness', 'weather', 'hue', 'tempo', 'key', 'mode', 'keys', 'lead', 'bass', 'kit', 'seed'].some((k) => input[k] !== undefined);
    if (input.action === 'assign') {
      if (!input.id || !input.assign?.length) throw Error('Give the music id and the targets to assign it to.');
      return change(input, input.assign.map((t) => ({ op: 'assign', kind: t.kind, name: t.name, music: input.id })), input.summary);
    }
    if (input.action === 'audition' && saved && !hasMood) {
      await show(p);
      return { auditioned: input.id, report: await s.audition(p.id, { music: input.id, ...(input.intensity !== undefined ? { intensity: input.intensity } : {}) }) };
    }
    const recipe = recipeOfInput(input);
    const made = await s.music({ recipe, store: input.store });
    const out = { recipe: made.recipe, kind: made.kind, summary: made.summary, sizes: made.sizes };
    if (input.variations) out.variations = (await s.variations(recipe, input.variations)).variations.map((v) => ({ seed: v.seed, summary: v.summary, bytes: v.bytes }));
    if (input.action === 'generate') return { ...out, hint: 'Nothing changed. Audition it (action "audition" with the same fields) or add it (action "add" with an id).' };
    if (input.action === 'audition') { canEdit(); await show(p); return { ...out, report: await s.audition(p.id, { plan: made.plan, intensity: input.intensity ?? made.summary.energy, label: `${made.summary.key} ${made.summary.mode} · seed ${made.summary.seed}` }) }; }
    if (!input.id) throw Error('Give the music an id (e.g. theme, boss) to add it.');
    const ops = [{ op: 'music', id: input.id, ...(input.title ? { title: input.title } : {}), kind: made.kind, bytes: made.bytes, recipe: made.recipe }, ...(input.assign ?? []).map((t) => ({ op: 'assign', kind: t.kind, name: t.name, music: input.id }))];
    return { ...out, ...await change(input, ops, input.summary) };
  }, 'edit');

  register('keel_game_sfx', 'Map a Game project\'s sound effects (stored as the codec\'s SFX_SETTINGS): palette (seed, style lofi/clean/chip/soft, shoes sneaker/boot/soft, volume), events (a game or body event -> a sound: step jump land wallStart wallJump railStart railEnd splash skimStart respawn blip select back confirm error hover, loops grind wallrun skim wind), footstep surfaces (a material -> stone/metal/water), tuning per sound (gain 0-2, rate 0.25-4, pan -1..1, jitter 0-1: the +/- spread of its pitch from play to play), removals; audition: a sound name to play in the Sound tab (params: surface, speed). New mappings land live; a new palette over an existing one, remapping an event or a material, or removing one goes through a review card.', z.object({
    projectId: uuid.optional(),
    palette: z.object({ seed: z.string().min(1).max(64).optional(), style: z.enum(['lofi', 'clean', 'chip', 'soft']).optional(), shoe: z.enum(['sneaker', 'boot', 'soft']).optional(), volume: share.optional() }).strict().optional(),
    events: z.array(z.object({ event: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/), sound: z.string().regex(/^[a-zA-Z]{1,32}$/) }).strict()).max(40).optional(),
    surfaces: z.array(z.object({ material: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,39}$/), surface: z.enum(['stone', 'metal', 'water']) }).strict()).max(40).optional(),
    tune: z.array(z.object({ sound: z.string().regex(/^[a-zA-Z]{1,32}$/), gain: z.number().min(0).max(2).optional(), rate: z.number().min(0.25).max(4).optional(), pan: z.number().min(-1).max(1).optional(), jitter: share.optional() }).strict()).max(40).optional(),
    remove: z.object({ events: z.array(z.string().max(40)).max(40).default([]), surfaces: z.array(z.string().max(40)).max(40).default([]), tuning: z.array(z.string().max(32)).max(40).default([]) }).strict().optional(),
    audition: z.string().regex(/^[a-zA-Z]{1,32}$/).optional(), params: z.object({ surface: z.enum(['stone', 'metal', 'water']).optional(), speed: z.number().min(0).max(40).optional() }).strict().optional(),
    summary: z.string().max(500).optional(),
  }).strict(), async (input) => {
    const { p, s } = await target_(input);
    const cat = await s.catalogue();
    const known = new Set([...cat.sounds, ...cat.loops]);
    for (const name of [...(input.events ?? []).map((e) => e.sound), ...(input.tune ?? []).map((t) => t.sound), ...(input.audition ? [input.audition] : [])]) if (!known.has(name)) throw Error(`No sound "${name}" (sounds: ${[...known].join(', ')}).`);
    const ops = [];
    if (input.palette) { const { seed, style, shoe, volume } = input.palette; ops.push({ op: 'palette', ...(seed ? { seed } : {}), ...(style || shoe ? { style: shoe ? { name: style ?? 'lofi', shoe } : style } : {}), ...(volume !== undefined ? { volume } : {}) }); }
    else if (!s.live(p.id).doc.sfx && (input.events || input.surfaces || input.tune)) ops.push({ op: 'palette', seed: 'sfx', style: 'lofi' });
    for (const e of input.events ?? []) ops.push({ op: 'event', event: e.event, sound: e.sound });
    for (const m of input.surfaces ?? []) ops.push({ op: 'surface', material: m.material, surface: m.surface });
    for (const t of input.tune ?? []) ops.push({ op: 'tune', ...t });
    for (const e of input.remove?.events ?? []) ops.push({ op: 'unevent', event: e });
    for (const m of input.remove?.surfaces ?? []) ops.push({ op: 'unsurface', material: m });
    for (const t of input.remove?.tuning ?? []) ops.push({ op: 'untune', sound: t });
    const out = ops.length ? await change(input, ops, input.summary) : { applied: 0 };
    if (input.audition && !out.actionId) { await show(p); out.report = await s.audition(p.id, { sfx: input.audition, params: input.params ?? {} }); }
    const doc = s.live(p.id).doc;
    if (doc.sfx) { const d = await s.sfx(doc.sfx); out.sfx = { settings: d.settings, sizes: d.sizes, events: d.events, surfaces: d.surfaces }; }
    return out;
  }, 'edit');

  register('keel_game_sound_save', `Propose saving the Sound tab's sound (music, assignments, sound effects; unsaved changes included) to the Game project's ${SOUND_FILE}. Creates a review card the creator applies.`, z.object({ projectId: uuid.optional(), summary: z.string().max(500).optional() }).strict(), async (input) => {
    canEdit();
    const { p, s } = await target_(input);
    const { content } = await s.encode(s.live(p.id).doc);
    const next = projectSchema.parse(withSoundFile(p, content));
    return { ...action('project-edit', input.summary ?? `Save the sound (${SOUND_FILE})`, { projectId: p.id, before: digest(p), previous: p, next }), file: SOUND_FILE };
  }, 'edit');
}
