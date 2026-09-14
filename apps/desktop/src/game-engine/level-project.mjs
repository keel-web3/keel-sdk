// A Game project's levels, shared by main, the renderer and the tests (no Node,
// no engine code). A level lives in one file, levels/<name>.level: a JSON
// envelope around the engine's packed records -- the generator pipeline as a
// keel/worldgen/recipe document, the level itself (terrain, things, spawns,
// resources, markers, regions, settings) as a keel/level document, both
// base64url, so the codec inspector and a game read the same bytes -- plus the
// hand edits as the ops that made them (what a regenerate replays over new
// ground) and an imported tileset's rules.
//
// The Level tab edits a live session (in the level worker) through LEVEL OPS:
// the engine's own level ops (height, paint, ramp, water, road, place, spawn,
// resource, marker, region, ...), the editor's brushes that expand into them,
// biome paint and rivers, lock regions, and recipe ops (seed, stages, size,
// players) that regenerate the ground and replay the hand edits over it --
// every one undoable. Ops that throw work away are named here, so the
// assistant sends them through a review card first.
import { z } from 'zod';

export const LEVEL_FILE_FORMAT = 'keel-game-level@1';
export const LEVEL_DIR = 'levels/';
/** The frame the level preview is served from (sandboxed like every keel-preview frame). */
export const LEVEL_PREVIEW_HOST = 'game-level';
export const LEVEL_PREVIEW_URL = `keel-preview://${LEVEL_PREVIEW_HOST}/index.html`;
export const LEVEL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const levelName = z.string().regex(LEVEL_NAME, 'Use a level name like valley or crypt-1.');
export const levelFileName = (name) => `${LEVEL_DIR}${name}.level`;
const LEVEL_FILE = /^levels\/([a-z0-9][a-z0-9-]{0,62})\.level$/;
/** The level a file name holds, or null. */
export const levelNameOf = (file) => LEVEL_FILE.exec(String(file ?? ''))?.[1] ?? null;
const b64url = z.string().max(6_000_000).regex(/^[A-Za-z0-9_-]*$/, 'Codec bytes as base64url.');
/** Largest map the editor makes (tiles a side): the level codec takes 8191, a live editor far less. */
export const MAX_LEVEL_SIDE = 512;
export const MAX_PLAYERS = 8;
export const MAX_EDITS = 20000;

// ---------------------------------------------------------------- the engine's vocabulary (names only)

export const STAGE_KINDS = ['overworld@1', 'biome@1', 'dungeon@1', 'cave@1', 'town@1', 'level@1', 'foliage@1'];
export const DUNGEON_ALGORITHMS = ['rooms', 'bsp', 'cave', 'drunkard', 'wfc'];
export const DUNGEON_THEMES = ['crypt', 'tomb', 'ice', 'hell'];
export const LEVEL_TEMPLATES = ['island', 'valley', 'highlands', 'archipelago'];
export const LEVEL_BIOMES = ['temperate', 'desert', 'tundra', 'volcanic', 'alien'];
export const RESOURCE_KINDS = ['mass', 'crystal', 'flux', 'fertile', 'wreck'];
export const TILESET_LAYOUTS = ['blob47', 'wang16', 'rpgmaker-a2'];
export const SEASONS = ['summer', 'autumn', 'winter', 'spring'];
export const MASK_KINDS = ['all', 'rect', 'circle', 'noise', 'biome', 'height'];
/** The engine's level ops the editor passes straight through (keel/level LEVEL_OPS, undo/redo aside: the editor owns history). */
export const ENGINE_LEVEL_OPS = ['height', 'paint', 'ramp', 'unramp', 'water', 'drain', 'road', 'bridge', 'place', 'move', 'remove', 'scatter', 'spawn', 'resource', 'marker', 'region', 'set', 'lock', 'unlock', 'style'];
/** The editor's own edit ops (expanded by the worker into engine ops, or applied to the tiles with their undo patch). */
export const EDITOR_EDIT_OPS = ['brush', 'biome', 'river', 'lockRegion', 'unlockRegion'];
/** Ops that change the recipe: the ground regenerates, hand edits replay over it, lock regions keep their tiles. */
export const RECIPE_OPS = ['recipe', 'seed', 'stage', 'unstage', 'moveStage', 'size', 'players', 'act', 'pin', 'unpin', 'locks'];
export const HISTORY_OPS = ['undo', 'redo'];
export const LEVEL_OP_NAMES = [...ENGINE_LEVEL_OPS, ...EDITOR_EDIT_OPS, ...RECIPE_OPS, ...HISTORY_OPS];

/**
 * What each stage kind's params are (the UI's fields, the assistant's reference). `kind`: num, int, bool,
 * enum (values), biome (a biome id), biomes (several), type (a terrain type). Params may also be rolls
 * ({ int: [a, b] }, { between: [a, b] }, { pick: [...] }) the recipe's lock text can pin.
 */
export const STAGE_PARAMS = {
  'overworld@1': [
    { name: 'scale', kind: 'num', min: 0.05, max: 4, step: 0.05, default: 1, doc: 'climate feature size (1: continents thousands of tiles across)' },
    { name: 'land', kind: 'num', min: -1, max: 1.5, step: 0.05, default: 0.05, doc: '+ more land, - more sea' },
    { name: 'relief', kind: 'num', min: 0, max: 3, step: 0.05, default: 1, doc: 'the height of mountains' },
    { name: 'rivers', kind: 'num', min: 0, max: 3, step: 0.1, default: 1, doc: 'river density (0 none)' },
    { name: 'lakes', kind: 'num', min: 0, max: 3, step: 0.1, default: 1, doc: 'lake chance (0 none)' },
    { name: 'structures', kind: 'bool', default: true, doc: 'villages, ruins, dungeon entrances' },
    { name: 'caves', kind: 'bool', default: true, doc: 'the underground cave layer' },
    { name: 'ores', kind: 'bool', default: true, doc: 'ore veins' },
    { name: 'only', kind: 'biome', default: '', doc: 'one biome everywhere on land' },
    { name: 'biomes', kind: 'biomes', default: [], doc: 'only these biomes (else the act\'s)' },
  ],
  'biome@1': [{ name: 'biome', kind: 'biome', default: 'desert', doc: 're-skin the mask to this biome, keeping its shape' }],
  'dungeon@1': [
    { name: 'algorithm', kind: 'enum', values: DUNGEON_ALGORITHMS, default: 'rooms', doc: 'stitched rooms (graph grammar), BSP, cellular caves, drunkard walks, wave function collapse' },
    { name: 'rooms', kind: 'int', min: 3, max: 30, default: 10, doc: 'rooms the rooms/bsp generators aim for' },
    { name: 'theme', kind: 'enum', values: DUNGEON_THEMES, default: '', doc: 'tile theme (default: the act\'s)' },
    { name: 'level', kind: 'int', min: -8, max: 8, default: 0, doc: 'floor height (steps)' },
  ],
  'cave@1': [
    { name: 'fill', kind: 'num', min: 0.3, max: 0.6, step: 0.01, default: 0.46, doc: 'initial rock share (the 4-5 automaton)' },
    { name: 'floor', kind: 'type', default: 'gravel', doc: 'floor material' },
    { name: 'wall', kind: 'type', default: 'rock', doc: 'wall material' },
    { name: 'biome', kind: 'biome', default: 'mountains', doc: 'the biome whose ramps it wears' },
    { name: 'ambient', kind: 'int', min: 0, max: 255, default: 255, doc: 'light away from torches' },
  ],
  'town@1': [
    { name: 'budget', kind: 'int', min: 50, max: 2000, default: 200, doc: 'the WFC solver\'s time budget (ms)' },
    { name: 'road', kind: 'enum', values: ['path', 'road'], default: 'path', doc: 'street material' },
  ],
  'level@1': [
    { name: 'template', kind: 'enum', values: LEVEL_TEMPLATES, default: 'valley', doc: 'keel/level\'s template' },
    { name: 'biome', kind: 'enum', values: LEVEL_BIOMES, default: 'temperate', doc: 'its level biome' },
    { name: 'towns', kind: 'int', min: 0, max: 4, default: 1, doc: 'towns' },
    { name: 'worldBiome', kind: 'biome', default: 'plains', doc: 'the world biome its tiles wear' },
    { name: 'lift', kind: 'int', min: 0, max: 8, default: 1, doc: 'steps it is lifted' },
  ],
  'foliage@1': [{ name: 'density', kind: 'num', min: 0, max: 2, step: 0.05, default: 1, doc: 'foliage density' }],
};

// ---------------------------------------------------------------- recipes

/** A recipe with the engine's defaults (the codec's JSON view of keel/worldgen/recipe). */
export const recipeOf = (r) => ({ format: 'keel-worldgen', version: 1, chunk: 32, tileSize: 2, stepHeight: 1, act: null, pins: [], locks: '', ...r });

/** Starting points: what the "New level" picker and the assistant offer. */
export const LEVEL_PRESETS = {
  overworld: { title: 'Overworld (infinite)', players: 0, recipe: (seed = 'world-1') => recipeOf({ seed, width: 0, depth: 0, stages: [{ id: 'ground', use: 'overworld@1', params: { scale: 0.45, land: 0.12 } }, { id: 'plants', use: 'foliage@1', params: { density: 1 } }] }) },
  island: { title: 'Island map', players: 0, recipe: (seed = 'isle-1') => recipeOf({ seed, width: 128, depth: 96, stages: [{ id: 'ground', use: 'overworld@1', params: { scale: 0.3, land: 0.35, biomes: ['plains', 'forest', 'beach', 'ocean', 'river', 'birch-forest', 'mountains'] } }] }) },
  mixed: { title: 'Mixed map', players: 0, recipe: (seed = 'mixed-1') => recipeOf({ seed, width: 160, depth: 120, stages: [
    { id: 'ground', use: 'overworld@1', params: { land: 0.75, scale: 0.3, biomes: ['plains', 'forest', 'birch-forest', 'river', 'beach', 'ocean', 'alpine', 'mountains', 'dark-forest'] } },
    { id: 'caves', use: 'cave@1', params: { floor: 'gravel', wall: 'rock', biome: 'mountains' }, mask: { kind: 'circle', at: [34, 88], r: 22, feather: 4 } },
    { id: 'town', use: 'town@1', mask: { kind: 'rect', rect: [100, 10, 150, 48] } },
    { id: 'crypt', use: 'dungeon@1', params: { algorithm: 'rooms', rooms: 8 }, mask: { kind: 'rect', rect: [6, 6, 70, 52] } },
    { id: 'dunes', use: 'biome@1', params: { biome: 'desert' }, mask: { kind: 'circle', at: [104, 84], r: 18, feather: 3 } },
  ] }) },
  dungeon: { title: 'Dungeon floor', players: 0, recipe: (seed = 'crypt-1') => recipeOf({ seed, width: 84, depth: 60, act: 'act1', stages: [{ id: 'floor', use: 'dungeon@1', params: { algorithm: 'rooms', rooms: 12 } }] }) },
  arena: { title: 'RTS arena (2 players)', players: 2, recipe: (seed = 'b') => recipeOf({ seed, width: 112, depth: 112, stages: [{ id: 'ground', use: 'overworld@1', params: { land: 1.2, scale: 0.6, relief: 0.05, rivers: 0, lakes: 0, structures: false, biomes: ['plains', 'forest'] } }] }) },
};
export const PRESET_NAMES = Object.keys(LEVEL_PRESETS);
export const isFinite_ = (recipe) => (recipe?.width ?? 0) > 0 && (recipe?.depth ?? 0) > 0;

// ---------------------------------------------------------------- ops

const tile = z.tuple([z.number().int().min(-100000).max(100000), z.number().int().min(-100000).max(100000)]);
const rect = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()]).refine((r) => r[2] > r[0] && r[3] > r[1], 'A rect is [i0, j0, i1, j1) with i1 > i0 and j1 > j0.');
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,79}$/, 'An id: letters, digits and _ . : # -');
const stroke = z.string().max(40).optional();
const points = z.array(tile).min(1).max(4000);
const paramValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(80), z.number(), z.boolean()])).max(64), z.object({ int: z.tuple([z.number(), z.number()]) }).strict(), z.object({ between: z.tuple([z.number(), z.number()]) }).strict(), z.object({ pick: z.array(z.union([z.string().max(80), z.number(), z.boolean()])).min(1).max(64) }).strict()]);
const maskSchema = z.lazy(() => z.union([
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('rect'), rect, feather: z.number().min(0).max(64).optional() }).strict(),
  z.object({ kind: z.literal('circle'), at: tile, r: z.number().min(1).max(4096), feather: z.number().min(0).max(64).optional() }).strict(),
  z.object({ kind: z.literal('noise'), freq: z.number().min(0.001).max(1), threshold: z.number().min(0).max(1), seed: z.string().max(64).optional() }).strict(),
  z.object({ kind: z.literal('biome'), biomes: z.array(z.string().max(40)).min(1).max(64) }).strict(),
  z.object({ kind: z.literal('height'), min: z.number().int().optional(), max: z.number().int().optional() }).strict(),
  z.object({ kind: z.literal('not'), mask: maskSchema }).strict(),
  z.object({ kind: z.enum(['and', 'or']), masks: z.array(maskSchema).min(1).max(8) }).strict(),
]));
export const stageSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'A stage id like ground or crypt-2.'), use: z.enum(STAGE_KINDS), seed: z.string().max(64).optional(), params: z.record(z.string().max(40), paramValue).optional(), mask: maskSchema.optional() }).strict();
const pinSchema = z.object({ rect, height: z.number().int().min(-1000).max(1000).optional(), type: z.string().max(40).optional(), water: z.number().int().min(-1000).max(1000).nullable().optional(), biome: z.string().max(40).optional() }).strict();
const side = z.number().int().min(0).max(MAX_LEVEL_SIDE);
export const recipeSchema = z.object({
  format: z.literal('keel-worldgen').default('keel-worldgen'), version: z.literal(1).default(1), seed: z.string().min(1).max(64), width: side, depth: side,
  chunk: z.number().int().min(8).max(128).optional(), tileSize: z.number().min(0.25).max(16).optional(), stepHeight: z.number().min(0.1).max(8).optional(),
  act: z.string().max(40).nullable().optional(), stages: z.array(stageSchema).min(1).max(32), pins: z.array(pinSchema).max(256).optional(), locks: z.string().max(4000).optional(),
}).strict().refine((r) => (r.width > 0) === (r.depth > 0), 'A recipe is finite (width and depth) or infinite (0 x 0).').refine((r) => new Set(r.stages.map((s) => s.id)).size === r.stages.length, 'Stage ids must be unique.');

/** The editor's op shapes (engine ops are checked field by field by keel/level's validateLevelOps in the worker). */
export const editorOpSchemas = {
  brush: z.object({ op: z.literal('brush'), mode: z.enum(['raise', 'lower', 'flatten', 'set']), at: tile.optional(), path: points.optional(), radius: z.number().min(0).max(32).default(2), amount: z.number().int().min(1).max(16).optional(), level: z.number().int().min(-1000).max(1000).optional(), stroke }).strict().refine((o) => !!o.at !== !!o.path, 'A brush dab (at) or a stroke (path).'),
  biome: z.object({ op: z.literal('biome'), biome: z.string().min(1).max(40), at: tile.optional(), path: points.optional(), radius: z.number().min(0).max(48).default(4), stroke }).strict().refine((o) => !!o.at !== !!o.path, 'A dab (at) or a stroke (path).'),
  river: z.object({ op: z.literal('river'), path: z.array(tile).min(2).max(4000), width: z.number().int().min(1).max(8).default(2), depth: z.number().int().min(1).max(6).default(1), id: id.optional(), stroke }).strict(),
  lockRegion: z.object({ op: z.literal('lockRegion'), id, rect, stroke }).strict(),
  unlockRegion: z.object({ op: z.literal('unlockRegion'), id, stroke }).strict(),
  recipe: z.object({ op: z.literal('recipe'), recipe: recipeSchema, players: z.number().int().min(0).max(MAX_PLAYERS).optional() }).strict(),
  seed: z.object({ op: z.literal('seed'), seed: z.string().min(1).max(64) }).strict(),
  stage: z.object({ op: z.literal('stage'), stage: stageSchema, at: z.number().int().min(0).max(31).optional() }).strict(),
  unstage: z.object({ op: z.literal('unstage'), id: z.string().max(40) }).strict(),
  moveStage: z.object({ op: z.literal('moveStage'), id: z.string().max(40), to: z.number().int().min(0).max(31) }).strict(),
  size: z.object({ op: z.literal('size'), width: side, depth: side }).strict().refine((o) => (o.width > 0) === (o.depth > 0), 'Finite (width and depth) or infinite (0 x 0).'),
  players: z.object({ op: z.literal('players'), players: z.number().int().min(0).max(MAX_PLAYERS) }).strict(),
  act: z.object({ op: z.literal('act'), act: z.string().max(40).nullable() }).strict(),
  pin: z.object({ op: z.literal('pin'), pin: pinSchema }).strict(),
  unpin: z.object({ op: z.literal('unpin'), index: z.number().int().min(0).max(255) }).strict(),
  locks: z.object({ op: z.literal('locks'), locks: z.string().max(4000) }).strict(),
  undo: z.object({ op: z.literal('undo'), steps: z.number().int().min(1).max(500).default(1) }).strict(),
  redo: z.object({ op: z.literal('redo'), steps: z.number().int().min(1).max(500).default(1) }).strict(),
};
const engineOp = z.object({ op: z.enum(ENGINE_LEVEL_OPS), stroke }).passthrough();
/** One op as the tab and the assistant send it (engine ops pass through here; the worker checks their fields). */
export const levelOpInput = z.object({ op: z.string().max(40) }).passthrough();
export const levelOpsInput = z.array(levelOpInput).min(1).max(2000);

/** Check ops' shapes (the editor's own fully; the engine's by name, their fields in the worker): the parsed ops, or errors naming the op. */
export function validateEditorOps(ops) {
  const errors = [], out = [];
  ops.forEach((op, index) => {
    const name = op?.op;
    const schema = editorOpSchemas[name] ?? (ENGINE_LEVEL_OPS.includes(name) ? engineOp : null);
    if (!schema) { errors.push({ index, op: String(name), message: `op ${index}: "${name}" isn't a level op (${LEVEL_OP_NAMES.join(', ')}).` }); return; }
    const r = schema.safeParse(op);
    if (!r.success) { errors.push({ index, op: name, message: `op ${index} (${name}): ${r.error.issues.map((i) => `${i.path.join('.') || 'op'} ${i.message}`).join('; ')}` }); return; }
    out.push(r.data);
  });
  return { ok: !errors.length, errors, ops: out };
}
export const opKind = (op) => (RECIPE_OPS.includes(op?.op) ? 'recipe' : HISTORY_OPS.includes(op?.op) ? 'history' : 'edit');

/** A disc of tiles (a brush), clipped to [0, w) x [0, d) when a size is given. */
export function discTiles([ci, cj], radius, w = Infinity, d = Infinity) {
  const out = [];
  const r = Math.max(0, radius), R = Math.ceil(r);
  for (let j = cj - R; j <= cj + R; j += 1) for (let i = ci - R; i <= ci + R; i += 1) {
    if (i < 0 || j < 0 || i >= w || j >= d) continue;
    if (Math.hypot(i - ci, j - cj) <= r + 0.001) out.push([i, j]);
  }
  return out;
}
/** A 4-connected line of tiles from a to b (roads and rivers need neighbours that share an edge). */
export function lineTiles(a, b) {
  const out = [[a[0], a[1]]];
  let [i, j] = a;
  const di = Math.sign(b[0] - a[0]), dj = Math.sign(b[1] - a[1]);
  const nx = Math.abs(b[0] - a[0]), ny = Math.abs(b[1] - a[1]);
  let ix = 0, iy = 0;
  while (ix < nx || iy < ny) {
    if ((0.5 + ix) / nx < (0.5 + iy) / ny || iy >= ny) { i += di; ix += 1; } else { j += dj; iy += 1; }
    out.push([i, j]);
  }
  return out;
}
/** A path through points, 4-connected, no tile twice in a row. */
export function pathThrough(pointsList) {
  const out = [];
  for (let n = 0; n < pointsList.length; n += 1) {
    const seg = n === 0 ? [pointsList[0]] : lineTiles(pointsList[n - 1], pointsList[n]).slice(1);
    for (const t of seg) { const last = out[out.length - 1]; if (!last || last[0] !== t[0] || last[1] !== t[1]) out.push([t[0], t[1]]); }
  }
  return out;
}

/**
 * Ops that throw work away (the assistant proposes them on a review card): removing a thing or a list
 * entry, unlocking a region (the next regenerate may replace what it kept), draining water, and any recipe
 * change once the level has hand edits (the ground under them regenerates; edits that no longer fit drop).
 * `state`: { edits: hand edits in the level, finite }.
 */
export function destructiveLevelOps(ops, state = { edits: 0 }) {
  const out = [];
  ops.forEach((op, index) => {
    const why = op.op === 'remove' ? `removes ${op.id}`
      : op.op === 'unlockRegion' ? `unlocks region ${op.id} (the next regenerate may replace what it kept)`
      : op.op === 'drain' ? `drains the water from [${op.rect}]`
      : opKind(op) === 'recipe' && state.edits > 0 ? `regenerates the ground under ${state.edits} hand edit${state.edits === 1 ? '' : 's'} (${op.op})`
      : '';
    if (why) out.push({ index, op: op.op, why });
  });
  return out;
}

// ---------------------------------------------------------------- the file

const fileSchema = z.object({
  format: z.literal(LEVEL_FILE_FORMAT), name: levelName, players: z.number().int().min(0).max(MAX_PLAYERS),
  recipe: b64url.min(4), level: b64url.nullable(), edits: z.array(levelOpInput).max(MAX_EDITS),
  tileset: z.object({ objectId: z.string().regex(/^[a-f0-9]{64}$/), rules: b64url.min(4) }).strict().nullable(),
}).strict();
export function writeLevelFile(file) {
  const value = fileSchema.parse({ format: LEVEL_FILE_FORMAT, name: file.name, players: file.players ?? 0, recipe: file.recipe, level: file.level ?? null, edits: file.edits ?? [], tileset: file.tileset ?? null });
  // (One op a line: a diff of two saves reads like the edits it holds.)
  const edits = value.edits.length ? `[\n  ${value.edits.map((op) => JSON.stringify(op)).join(',\n  ')}\n ]` : '[]';
  return `{\n "format": ${JSON.stringify(value.format)},\n "name": ${JSON.stringify(value.name)},\n "players": ${value.players},\n "recipe": ${JSON.stringify(value.recipe)},\n "level": ${JSON.stringify(value.level)},\n "tileset": ${JSON.stringify(value.tileset)},\n "edits": ${edits}\n}\n`;
}
export function readLevelFile(content) {
  let value;
  try { value = JSON.parse(content); } catch { throw Error('This level file is not JSON.'); }
  if (value?.format !== LEVEL_FILE_FORMAT) throw Error(`This file is not a ${LEVEL_FILE_FORMAT} level.`);
  return fileSchema.parse(value);
}
/** The project's levels: [{ name, file, content }]. */
export const projectLevels = (project) => (project?.files ?? []).map((f) => ({ name: levelNameOf(f.name), file: f.name, content: f.content })).filter((f) => f.name).sort((a, b) => a.name.localeCompare(b.name));
export const levelFileOf = (project, name) => project?.files?.find((f) => f.name === levelFileName(name))?.content ?? '';
/** The project with a level file saved (added or replaced). */
export function withLevelFile(project, name, content) {
  readLevelFile(content);
  const fileName = levelFileName(name);
  const existing = project.files.find((f) => f.name === fileName);
  return { ...project, files: existing ? project.files.map((f) => f.id === existing.id ? { ...f, type: 'application/json', content } : f) : [...project.files, { id: globalThis.crypto.randomUUID(), name: fileName, type: 'application/json', content }] };
}

/** base64url <-> bytes (no Node: the renderer uses these too). */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function toBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const k = Math.min(3, bytes.length - i) + 1;
    for (let j = 0; j < k; j += 1) out += B64[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}
export function fromBase64url(text) {
  const clean = String(text).replace(/\s+/g, '').replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    const chunk = clean.slice(i, i + 4);
    for (let j = 0; j < 4; j += 1) { const c = j < chunk.length ? B64.indexOf(chunk[j]) : 0; if (c < 0) throw Error(`Not base64url: "${chunk[j]}".`); n = (n << 6) | c; }
    for (let j = 0; j < chunk.length - 1; j += 1) out[o++] = (n >> (16 - 8 * j)) & 255;
  }
  return out.subarray(0, o);
}
