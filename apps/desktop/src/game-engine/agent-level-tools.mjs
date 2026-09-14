// Agent tools for a Game project's levels: the assistant reads the open level
// (its recipe, stages, spawns, resources, fairness, dungeons, history),
// generates one from a preset or a recipe, and edits it with level ops --
// streamed into the creator's Level tab a few at a time, so the map changes
// while they watch -- then proposes saving it. Additions land live (unsaved,
// every one undoable in the tab); a change that throws work away (removing
// things, unlocking a region, draining water, regenerating under hand edits)
// goes through the existing project-edit review card instead: the project's
// level file with the change made (tried on a copy), which the Level tab
// reloads when the creator applies it. Nothing here publishes or signs.
import { z } from 'zod';
import { isGameProject } from './game-project.mjs';
import { LEVEL_OP_NAMES, LEVEL_PRESETS, MAX_PLAYERS, STAGE_PARAMS, destructiveLevelOps, levelFileName, levelFileOf, levelName, levelOpInput, projectLevels, recipeSchema, withLevelFile } from './level-project.mjs';
import { projectSchema } from '../workspace.mjs';

const uuid = z.string().uuid();
const presets = Object.keys(LEVEL_PRESETS);
const OPS_DOC = `Level ops (JSON). Engine ops: height {rect:[i0,j0,i1,j1], add|set}; paint {type, rect | at+radius}; ramp {at, dir?(0 n,1 e,2 s,3 w; found when left out), width?}; unramp {at}; water {at, level}; drain {rect}; road {path:[[i,j]...], kind?: road|path}; bridge {from, to}; place {pack, object, pos:[x,y,z] metres (tile i is x=(i+0.5)*tileSize), yaw?, scale?, pins?, tier?, layer?, id?}; move {id, pos?, yaw?, scale?}; remove {id}; spawn {player, at, natural?}; resource {kind: mass|crystal|flux|fertile|wreck, at, amount?}; marker {id, kind, pos}; region {id, kind, rect}; scatter {id, rect, rules}; set/lock/unlock {scope, key, value?}; style {style: pixel|voxel, scope?}. Editor ops: brush {mode: raise|lower|flatten|set, at | path, radius, amount?, level?}; biome {biome, at | path, radius}; river {path, width?, depth?}; lockRegion {id, rect} (a regenerate keeps its tiles); unlockRegion {id}. Recipe ops (the ground regenerates, hand edits replay): recipe {recipe, players?}; seed {seed}; stage {stage:{id, use, params?, mask?, seed?}, at?}; unstage {id}; moveStage {id, to}; size {width, depth} (0 x 0 infinite); players {players}; act {act}; pin {pin:{rect, height?, type?, water?, biome?}}; unpin {index}; locks {locks}. History: undo {steps?}, redo {steps?}. Any edit op may carry stroke (an id): a stroke undoes as one step.`;

/** What the assistant reads of a level (compact: the lists capped). */
export function levelSummary(view) {
  const s = view.state;
  return {
    name: view.name, file: levelFileName(view.name), unsaved: view.unsaved, finite: s.finite, size: s.size, players: s.players, recipe: s.recipe, genMs: s.genMs,
    counts: s.counts, history: s.history, spawns: s.spawns, resources: s.resources.slice(0, 40), locks: s.locks, markers: s.markers.slice(0, 30).map((m) => ({ id: m.id, kind: m.kind, pos: m.pos })), things: s.things.slice(-40),
    fairness: s.fairness && { pass: s.fairness.pass, connected: s.fairness.connected, worst: s.fairness.worst },
    dungeons: s.dungeons.map((d) => ({ stage: d.stage, algorithm: d.algorithm, theme: d.theme, rect: d.rect, rooms: d.rooms.length, edges: d.edges.length, start: d.start, key: d.key, boss: d.boss, exit: d.exit, pass: d.check.pass, problems: d.check.problems })),
    skipped: s.skipped, note: s.note || undefined, tileset: s.tileset ? { objectId: s.tileset.objectId, layout: s.tileset.rules.layout } : null,
  };
}

export function registerGameLevelTools({ register, project, canEdit, access, action, hooks, digest, navigate }) {
  const level = hooks.gameLevel;
  if (!level) return;
  const ready = () => { access(); const status = level.status(); if (!status.available) throw Error(status.reason); return level; };

  /** The project and its open level (opened from its file when the Level tab hasn't). */
  async function target({ projectId, name }, { create = false } = {}) {
    const p = project(projectId);
    if (!isGameProject(p)) throw Error('Levels belong to Game projects. Create one from the Game template first.');
    const svc = ready();
    const live = svc.live(p.id);
    const files = projectLevels(p);
    if (live && (!name || live.name === name)) return { p, svc, view: svc.view(live) };
    const pick = name ?? files[0]?.name;
    if (pick && files.some((f) => f.name === pick)) return { p, svc, view: await svc.open(p.id, pick, { content: levelFileOf(p, pick) }) };
    if (create) return { p, svc, view: null, name: pick ?? 'level-1' };
    throw Error(`This project has no level${name ? ` ${name}` : ''} yet: make one with keel_game_level_generate (a preset: ${presets.join(', ')}; or a recipe).`);
  }
  async function show(p) {
    const view = hooks.view?.();
    if (!(view?.page === 'Projects' && view.projectId === p.id && view.tab === 'Level')) {
      if (navigate) navigate('Watch it in the Level tab', { page: 'Projects', projectId: p.id, tab: 'Level' });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  /** Ops applied live (streamed), or proposed on a review card when they'd throw work away. */
  async function change(p, svc, view, ops, summary) {
    canEdit();
    const destructive = destructiveLevelOps(ops, { edits: view.state.counts.edits ?? 0 });
    if (destructive.length) {
      const dry = await svc.dryRun(p.id, ops);
      if (!dry.ok) throw Error(`Those level ops don't check out; nothing was changed. ${dry.errors.slice(0, 4).map((e) => e.message).join(' ')}`);
      const next = projectSchema.parse(withLevelFile(p, view.name, dry.content));
      const card = action('project-edit', summary ?? `Level ${view.name}: ${destructive.map((d) => d.why).join('; ')}`, { projectId: p.id, before: digest(p), previous: p, next });
      return { ...card, destructive, applied: 0, did: dry.did, skipped: dry.skipped, note: `Nothing changed yet: this ${destructive.map((d) => d.why).join('; ')}, so the creator reviews it first. Applying the card saves ${levelFileName(view.name)} with it (unsaved Level tab work included) and the Level tab reloads.` };
    }
    await show(p);
    const r = await svc.apply(p.id, ops, { stream: true });
    if (!r.ok) return { ok: false, applied: r.applied, did: r.did, errors: r.errors, level: levelSummary(r), hint: 'The ops before the failing one were applied (each undoable); fix the failing op and send the rest.' };
    return { ok: true, applied: r.applied, did: r.did, level: levelSummary(r), hint: 'Applied live in the Level tab (unsaved): the creator saves it there, or propose that with keel_game_level_save.' };
  }

  register('keel_game_level_state', `Read a Game project's level (levels/<name>.level): its recipe (the generator pipeline: stages ${Object.keys(STAGE_PARAMS).join(', ')} with params, masks, pins and lock text), size (0 x 0 is an infinite world), players, counts, spawns, resources, lock regions, markers, placed things, multiplayer fairness, each dungeon's rooms and fairness gate, undo history, and what the engine offers (stage params, biomes, terrain types, pack objects, dungeon generators and themes, acts, presets). Also the level ops reference.`, z.object({ projectId: uuid.optional(), name: levelName.optional() }).strict(), async (input) => {
    const { p, svc, view } = await target(input);
    const cat = await svc.catalogue();
    return {
      level: levelSummary(view), levels: projectLevels(p).map((l) => l.name), levelTabOpen: svc.isOpen(p.id),
      offers: { presets: Object.fromEntries(Object.entries(LEVEL_PRESETS).map(([id, x]) => [id, x.title])), stages: STAGE_PARAMS, biomes: cat.biomes.map((b) => b.id), types: cat.types, acts: cat.acts, algorithms: cat.algorithms, themes: cat.themes, packs: cat.packs.map((pk) => ({ id: pk.id, objects: pk.objects.map((o) => o.id) })), resourceKinds: cat.resourceKinds },
      ops: OPS_DOC,
    };
  });

  register('keel_game_level_generate', `Generate a Game project's level from a preset (${presets.map((id) => `${id}: ${LEVEL_PRESETS[id].title}`).join('; ')}) or a recipe (keel/worldgen: { seed, width, depth (0 x 0 infinite), act?, stages: [{ id, use: "overworld@1" | "biome@1" | "dungeon@1" | "cave@1" | "town@1" | "level@1" | "foliage@1", params?, mask?: { kind: all|rect{rect}|circle{at,r,feather?}|noise|biome|height }, seed? }], pins?, locks? }), with a seed, size and players (spawns, resources and fairness for an RTS map). A new level opens live in the Level tab (unsaved). Regenerating a level that has hand edits goes through a review card (they replay over the new ground; the card says which no longer fit).`, z.object({
    projectId: uuid.optional(), name: levelName.optional().describe('The level (default: the open one, or level-1 for a new one)'), preset: z.enum(presets).optional(), recipe: recipeSchema.optional(),
    seed: z.string().min(1).max(64).optional(), width: z.number().int().min(0).max(512).optional(), depth: z.number().int().min(0).max(512).optional(), players: z.number().int().min(0).max(MAX_PLAYERS).optional(), summary: z.string().max(500).optional(),
  }).strict(), async (input) => {
    canEdit();
    const t = await target(input, { create: true });
    const { p, svc } = t;
    const base = input.recipe ?? (input.preset ? LEVEL_PRESETS[input.preset].recipe() : t.view ? t.view.state.recipe : LEVEL_PRESETS.mixed.recipe());
    const recipe = { ...base, ...(input.seed ? { seed: input.seed } : {}), ...(input.width !== undefined ? { width: input.width } : {}), ...(input.depth !== undefined ? { depth: input.depth } : {}) };
    const players = input.players ?? (input.preset ? LEVEL_PRESETS[input.preset].players : t.view?.state.players ?? 0);
    if (!t.view || (input.name && t.view.name !== input.name)) {
      await show(p);
      const view = await svc.open(p.id, input.name ?? t.name ?? 'level-1', { recipe, players });
      return { created: true, level: levelSummary(view), hint: `A new level ${view.name}, live in the Level tab (unsaved). Paint and place with keel_game_level_ops; propose saving with keel_game_level_save.` };
    }
    return change(p, svc, t.view, [{ op: 'recipe', recipe, players }], input.summary);
  }, 'edit');

  register('keel_game_level_ops', `Edit the open level with level ops, streamed into the creator's Level tab a few at a time (they watch the map change). ${OPS_DOC} Applied in order; the first failing op stops the rest. Removing things, unlocking a region, draining water, or a recipe op on a level with hand edits goes through a review card.`, z.object({ projectId: uuid.optional(), name: levelName.optional(), ops: z.array(levelOpInput).min(1).max(400).describe(`Ops: ${LEVEL_OP_NAMES.join(', ')}`), summary: z.string().max(500).optional() }).strict(), async (input) => {
    const { p, svc, view } = await target(input);
    return change(p, svc, view, input.ops, input.summary);
  }, 'edit');

  register('keel_game_level_save', 'Propose saving the open level (recipe, level and hand edits as codec records; unsaved changes included) to the Game project\'s levels/<name>.level. Creates a review card the creator applies.', z.object({ projectId: uuid.optional(), name: levelName.optional(), summary: z.string().max(500).optional() }).strict(), async (input) => {
    canEdit();
    const { p, svc, view } = await target(input);
    const { content, sizes } = await svc.encode(p.id);
    const next = projectSchema.parse(withLevelFile(p, view.name, content));
    return { ...action('project-edit', input.summary ?? `Save the level (${levelFileName(view.name)})`, { projectId: p.id, before: digest(p), previous: p, next }), file: levelFileName(view.name), sizes };
  }, 'edit');
}
