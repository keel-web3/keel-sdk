// The KEEL engine's world generation and levels, off the editor's main thread:
// a project's level as a live SESSION -- a generator pipeline (keel/worldgen's
// recipe: overworld, dungeons, caves, towns, keel/level's templates, re-skins,
// masks, pins, locks) run into a keel/level Level, then the creator's hand
// edits as level ops (the engine's own, and the editor's brushes, biome paint,
// rivers and lock regions), every one undoable; a recipe change regenerates
// the ground, replays the hand edits over it, and puts back what lock regions
// hold. What the preview draws goes out as SNAPSHOTS (the tile arrays gzipped,
// the things and markers as JSON); saves are the codec's own records (LEVEL,
// keel/worldgen/recipe, keel/worldgen/tileset) against their JSON. Also:
// seeded variations as real pixel-art thumbnails (the terrain's CPU baker and
// compositor), fairness for multiplayer maps, the room graph of every dungeon
// stage, tilesets imported from a PNG atlas, and the preview page -- bundled
// once per engine checkout with every content pack it has. Like the other
// game-engine workers, Node runs the engine's TypeScript directly and only
// trusted main-process requests arrive here.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ENGINE_LEVEL_OPS, MAX_EDITS, STAGE_PARAMS, discTiles, fromBase64url, isFinite_, levelOpInput, opKind, pathThrough, readLevelFile, recipeOf, toBase64url, validateEditorOps, writeLevelFile } from './level-project.mjs';
import { decodePng, pngDataUrl } from './level-png.mjs';

const root = workerData.root;
const src = (name) => pathToFileURL(join(root, 'packages', name, 'src', 'index.ts')).href;
let loaded;
/** The engine parts a level needs, and every content pack in the checkout (packs/*: the ones that export a ContentPack). */
async function engine() {
  if (loaded) return loaded;
  const [worldgen, level, terrain, codec] = await Promise.all(['worldgen', 'level', 'terrain', 'codec'].map((n) => import(src(n))));
  const packs = [];
  const packDir = join(root, 'packs');
  for (const name of existsSync(packDir) ? readdirSync(packDir).sort() : []) {
    const file = join(packDir, name, 'src', 'index.ts');
    if (!existsSync(file)) continue;
    try { const m = await import(pathToFileURL(file).href); if (m.pack && Array.isArray(m.pack.objects) && typeof m.pack.get === 'function') packs.push({ dir: name, file, pack: m.pack }); } catch { /* A pack that doesn't load (or isn't content) isn't offered. */ }
  }
  loaded = { worldgen, level, terrain, codec, packs, table: worldgen.createBiomeTable() };
  return loaded;
}

const clean = (value) => JSON.parse(JSON.stringify(value ?? null));
const gz = (bytes) => gzipSync(bytes, { level: 9 }).byteLength;
const utf8 = (text) => Buffer.byteLength(text, 'utf8');
/** Codec bytes against the JSON they stand for. */
const sizes = (bytes, json) => { const text = typeof json === 'string' ? json : JSON.stringify(json); return { bytes: bytes.byteLength, gzip: gz(bytes), json: utf8(text), jsonGz: gz(Buffer.from(text)) }; };
const wrapYaw = (y) => { const w = Math.atan2(Math.sin(y), Math.cos(y)); return w <= -Math.PI ? Math.PI : w; };

async function catalogue() {
  const E = await engine();
  const W = E.worldgen;
  return {
    stages: W.stageKinds().map((use) => ({ use, local: W.stageOf(use)?.local ?? false, describe: W.stageOf(use)?.describe ?? '', params: STAGE_PARAMS[use] ?? [] })),
    biomes: E.table.list.map((b) => ({ id: b.id, kind: b.kind ?? 'land', tags: [...(b.tags ?? [])] })),
    acts: W.DEFAULT_ACTS.map((a) => ({ id: a.id, name: a.name, theme: a.theme, biomes: [...a.biomes] })),
    types: E.terrain.terrainTypes().list.map((t) => t.name),
    algorithms: [...W.DUNGEON_ALGORITHMS], themes: Object.keys(W.THEMES), templates: E.level.TEMPLATES ? [...E.level.TEMPLATES] : [],
    rooms: W.ROOM_TEMPLATES.map((r) => ({ id: r.id, roles: [...r.roles], rows: [...r.rows], weight: r.weight ?? 1 })),
    packs: E.packs.map(({ pack }) => ({ id: pack.id, version: pack.version, objects: pack.objects.map((o) => ({ id: o.id, title: o.title ?? null, tags: [...(o.tags ?? [])], tier: o.tier ?? null, choices: clean(o.choices ?? {}) })) })),
    resourceKinds: ['mass', 'crystal', 'flux', 'fertile', 'wreck'],
    opReference: E.level.levelOpReference(),
  };
}

// ---------------------------------------------------------------- recipes

async function checkRecipe(r) {
  const E = await engine();
  const W = E.worldgen;
  let recipe;
  try { recipe = W.defineRecipe(recipeOf(clean(r))); } catch (error) { throw Error(`That recipe doesn't check out: ${error.message}`); }
  for (const s of recipe.stages) if (!W.stageOf(s.use)) throw Error(`Stage ${s.id}: no stage kind "${s.use}" (${W.stageKinds().join(', ')}).`);
  if (recipe.act && !W.DEFAULT_ACTS.some((a) => a.id === recipe.act)) throw Error(`No act "${recipe.act}" (${W.DEFAULT_ACTS.map((a) => a.id).join(', ')}).`);
  for (const p of recipe.pins ?? []) if (p.biome && !E.table.has(p.biome)) throw Error(`A pin names no biome "${p.biome}".`);
  // (The codec is the judge of the rest: a recipe that doesn't pack isn't one.)
  try { W.decodeRecipe(W.encodeRecipe(recipe)); } catch (error) { throw Error(`That recipe doesn't pack as keel/worldgen/recipe: ${error.message}`); }
  return recipe;
}

// ---------------------------------------------------------------- sessions

const sessions = new Map();
function sessionOf(key) { const s = sessions.get(key); if (!s) throw Error(`No open level ${key}.`); return s; }
const finiteLevel = (s) => { if (!s.level) throw Error('An infinite world is edited through its recipe and biome paint: give it a size (the size op) to paint tiles, place things or save a level.'); return s.level; };

/** Generate the base: the recipe into a level (finite) and the biome and light layers the ground wears. */
function generate(s) {
  const E = loaded, t0 = performance.now();
  s.gen += 1; s.painter = null; s.cache = {};
  if (!isFinite_(s.recipe)) { s.level = null; s.biome = null; s.light = null; s.meta = {}; s.genMs = 0; return; }
  const { level, map } = E.worldgen.generateWorldLevel(s.recipe, { players: s.players });
  // (Generated props turn a full circle -- [0, 2 pi) -- where the level codec's yaw is [-pi, pi]: the same turn, wrapped.)
  for (const [id, th] of level.things) if (th.yaw > Math.PI || th.yaw < -Math.PI) level.things.set(id, { ...th, yaw: wrapYaw(th.yaw) });
  level.name = s.name;
  s.level = level; s.biome = map.biome.slice(); s.light = map.light.slice(); s.meta = { ...map.meta };
  s.genMs = Math.round(performance.now() - t0);
}

function newSession(key, name, recipe, players) {
  return { key, name, recipe, players, done: [], undone: [], gen: 0, version: 0, level: null, biome: null, light: null, meta: {}, skipped: [], frozen: 0, did: [], note: '', tileset: null, painter: null, cache: {}, genMs: 0 };
}

/** Undo patches: the tiles (and biome rows, water list) an editor-applied op overwrote. */
function readPatch(s, rect) {
  const t = s.level.terrain;
  const i0 = Math.max(0, rect[0]), j0 = Math.max(0, rect[1]), i1 = Math.min(t.width, rect[2]), j1 = Math.min(t.depth, rect[3]);
  if (i1 <= i0 || j1 <= j0) return null;
  const biome = new Uint8Array((i1 - i0) * (j1 - j0));
  for (let j = j0; j < j1; j += 1) biome.set(s.biome.subarray(j * t.width + i0, j * t.width + i1), (j - j0) * (i1 - i0));
  return { rect: [i0, j0, i1, j1], terrain: t.read(i0, j0, i1 - i0, j1 - j0), biome, water: s.level.water.slice() };
}
function restorePatch(s, p) {
  if (!p) return;
  const t = s.level.terrain, [i0, j0, i1, j1] = p.rect;
  t.write(p.terrain);
  for (let j = j0; j < j1; j += 1) s.biome.set(p.biome.subarray((j - j0) * (i1 - i0), (j - j0 + 1) * (i1 - i0)), j * t.width + i0);
  s.level.water = p.water.slice();
}

/** A tile the ramp can rise from: the direction toward the neighbour one step up (the one behind level). */
function rampDir(t, at) {
  for (let d = 0; d < 4; d += 1) if (loaded.terrain.canRamp(t, at[0], at[1], d)) return d;
  throw Error(`No ramp fits at ${at[0]},${at[1]}: a ramp needs the tile on one side one step up and the tile opposite level with it.`);
}

/** Apply engine ops in turn; on a failure the ones before it are taken back and the error names the op. */
function engineSeq(level, ops) {
  let n = 0;
  for (const op of ops) {
    const r = loaded.level.applyLevelOp(level, op);
    if (!r.ok) { if (n) loaded.level.applyLevelOp(level, { op: 'undo', steps: n }); throw Error(`${op.op}: ${r.error.message}`); }
    n += 1;
  }
  return n;
}
/** Disc brushes along a stroke as rows of tiles: [[i0, j, i1 + 1, j + 1], ...]. */
function rowsOf(tiles) {
  const rows = new Map();
  for (const [i, j] of tiles) { if (!rows.has(j)) rows.set(j, new Set()); rows.get(j).add(i); }
  const out = [];
  for (const [j, set] of [...rows].sort((a, b) => a[0] - b[0])) {
    const xs = [...set].sort((a, b) => a - b);
    let a = xs[0], b = xs[0];
    for (const x of xs.slice(1)) { if (x === b + 1) { b = x; continue; } out.push([a, j, b + 1, j + 1]); a = b = x; }
    out.push([a, j, b + 1, j + 1]);
  }
  return out;
}
const strokeTiles = (centres, radius, w, d) => { const seen = new Map(); for (const c of centres) for (const t of discTiles(c, radius, w, d)) seen.set(`${t[0]},${t[1]}`, t); return [...seen.values()]; };

/** One edit op on the level: { steps (engine ops it applied), patch (what an editor-applied op overwrote), did }. */
function applyEdit(s, op) {
  const E = loaded;
  const { stroke: _stroke, ...o } = op;
  if (!s.level) {
    if (o.op === 'biome') { if (!E.table.has(o.biome)) throw Error(`No biome "${o.biome}".`); return { steps: 0, patch: null, did: `painted ${o.biome} (the world's overlay)` }; }
    finiteLevel(s);
  }
  const L = s.level, t = L.terrain;
  switch (o.op) {
    case 'brush': {
      const tiles = strokeTiles(o.path ?? [o.at], o.radius ?? 2, t.width, t.depth);
      if (!tiles.length) throw Error('That brush is off the map.');
      const centre = (o.path ?? [o.at])[0];
      const inside = t.inside(centre[0], centre[1]) ? centre : tiles[0];
      const level = o.level ?? t.height[t.index(inside[0], inside[1])];
      const field = o.mode === 'raise' ? { add: o.amount ?? 1 } : o.mode === 'lower' ? { add: -(o.amount ?? 1) } : { set: level };
      const steps = engineSeq(L, rowsOf(tiles).map((rect) => ({ op: 'height', rect, ...field })));
      return { steps, patch: null, did: `${o.mode === 'raise' ? 'raised' : o.mode === 'lower' ? 'lowered' : `set to ${level}`} ${tiles.length} tiles` };
    }
    case 'biome': {
      if (!E.table.has(o.biome)) throw Error(`No biome "${o.biome}" (${E.table.list.map((b) => b.id).join(', ')}).`);
      const tiles = strokeTiles(o.path ?? [o.at], o.radius ?? 4, t.width, t.depth);
      if (!tiles.length) throw Error('That biome brush is off the map.');
      const xs = tiles.map((p) => p[0]), zs = tiles.map((p) => p[1]);
      const patch = readPatch(s, [Math.min(...xs), Math.min(...zs), Math.max(...xs) + 1, Math.max(...zs) + 1]);
      s.painter ??= E.worldgen.createBiomePainter({ terrain: t, biome: s.biome, table: E.table, seed: s.recipe.seed });
      s.painter.paint(tiles.map(([i, j]) => j * t.width + i), o.biome);
      return { steps: 0, patch, did: `painted ${o.biome} over ${tiles.length} tiles` };
    }
    case 'river': {
      const path = pathThrough(o.path);
      for (const [i, j] of path) if (!t.inside(i, j)) throw Error(`The river's tile ${i},${j} is off the map.`);
      const w = o.width ?? 2, xs = path.map((p) => p[0]), zs = path.map((p) => p[1]);
      const patch = readPatch(s, [Math.min(...xs) - w, Math.min(...zs) - w, Math.max(...xs) + w + 1, Math.max(...zs) + w + 1]);
      const levels = E.terrain.carveRiver(t, path, { width: w, depth: o.depth ?? 1 });
      const id = o.id ?? `river-${L.water.length}`;
      L.water = [...L.water.filter((x) => x.id !== id), { id, kind: 'river', level: levels[levels.length - 1], at: null, path }];
      L.changed({ kind: 'water', chunks: [], ids: [id] });
      return { steps: 0, patch, did: `carved river ${id} (${path.length} tiles, water ${levels[0]} to ${levels[levels.length - 1]})` };
    }
    case 'lockRegion': return { steps: engineSeq(L, [{ op: 'region', id: o.id, kind: 'lock', rect: o.rect, tags: ['lock'] }]), patch: null, did: `locked region ${o.id} [${o.rect}]` };
    case 'unlockRegion': {
      if (!L.regions.some((r) => r.id === o.id && r.kind === 'lock')) throw Error(`No lock region ${o.id} (${L.regions.filter((r) => r.kind === 'lock').map((r) => r.id).join(', ') || 'none'}).`);
      return { steps: engineSeq(L, [{ op: 'remove', id: o.id }]), patch: null, did: `unlocked region ${o.id}` };
    }
    default: {
      if (!ENGINE_LEVEL_OPS.includes(o.op)) throw Error(`"${o.op}" isn't a level op.`);
      const x = { ...o };
      if (x.op === 'ramp' && x.dir === undefined) x.dir = rampDir(t, x.at);
      if ((x.op === 'place' || x.op === 'move') && typeof x.yaw === 'number') x.yaw = wrapYaw(x.yaw);
      if (x.op === 'place' && x.id === undefined) { let n = 0; while (L.things.has(`${x.object}-${n}`)) n += 1; x.id = `${x.object}-${n}`; }
      const v = E.level.validateLevelOps([x]);
      if (!v.ok) throw Error(v.errors.map((e) => `${e.field ? `${e.field}: ` : ''}${e.message}`).join('; '));
      engineSeq(L, [x]);
      return { steps: 1, patch: null, did: describeOp(x) };
    }
  }
}
function describeOp(o) {
  switch (o.op) {
    case 'height': return `${o.add !== undefined ? `raised ${o.add > 0 ? '+' : ''}${o.add}` : `set ${o.set}`} [${o.rect}]`;
    case 'paint': return `painted ${o.type} ${o.rect ? `[${o.rect}]` : `at ${o.at} r${o.radius ?? 1}`}`;
    case 'place': return `placed ${o.id} (${o.pack}/${o.object})`;
    case 'spawn': return `player ${o.player} spawns at ${o.at}`;
    case 'resource': return `${o.kind} at ${o.at}`;
    case 'road': return `${o.kind ?? 'road'} of ${o.path.length} tiles`;
    case 'water': return `water to ${o.level} at ${o.at}`;
    default: return `${o.op}${o.id ? ` ${o.id}` : o.at ? ` at ${o.at}` : ''}`;
  }
}

/** Put back what each lock region held in the level before a regenerate: tiles, biome and light, things, markers, spawns and resources in it. */
function restoreLocks(s, prev) {
  if (!prev?.level || !s.level) return [];
  const A = prev.level, B = s.level, ta = A.terrain, tb = B.terrain, out = [];
  for (const r of B.regions) {
    if (r.kind !== 'lock' || !A.regions.some((x) => x.id === r.id && x.kind === 'lock')) continue;
    const i0 = Math.max(0, r.rect[0]), j0 = Math.max(0, r.rect[1]), i1 = Math.min(ta.width, tb.width, r.rect[2]), j1 = Math.min(ta.depth, tb.depth, r.rect[3]);
    if (i1 <= i0 || j1 <= j0) continue;
    tb.write(ta.read(i0, j0, i1 - i0, j1 - j0));
    for (let j = j0; j < j1; j += 1) { s.biome.set(prev.biome.subarray(j * ta.width + i0, j * ta.width + i1), j * tb.width + i0); s.light.set(prev.light.subarray(j * ta.width + i0, j * ta.width + i1), j * tb.width + i0); }
    const inTile = (i, j) => i >= i0 && j >= j0 && i < i1 && j < j1;
    const inPos = (p) => inTile(Math.floor(p[0] / tb.tileSize), Math.floor(p[2] / tb.tileSize));
    for (const th of [...B.things.values()]) if (inPos(th.pos)) B.things.delete(th.id);
    for (const th of A.things.values()) if (inPos(th.pos)) B.things.set(th.id, th);
    B.markers = [...B.markers.filter((m) => !inPos(m.pos)), ...A.markers.filter((m) => inPos(m.pos))];
    B.resources = [...B.resources.filter((x) => !inTile(...x.at)), ...A.resources.filter((x) => inTile(...x.at))];
    B.spawns = [...B.spawns.filter((x) => !inTile(...x.at)), ...A.spawns.filter((x) => inTile(...x.at) && !B.spawns.some((y) => y.player === x.player && !inTile(...y.at)))].sort((a, b) => a.player - b.player);
    out.push(r.id);
  }
  return out;
}

/** New ground for the recipe; the hand edits replayed over it (those that no longer fit are dropped and named); lock regions put back. */
function regenerate(s, prev) {
  generate(s);
  const skipped = [];
  const kept = [];
  for (const e of s.done) {
    if (e.kind !== 'edit') { kept.push(e); continue; }
    try { const r = applyEdit(s, e.op); e.steps = r.steps; e.patch = r.patch; kept.push(e); } catch (error) { skipped.push({ op: e.op.op, why: String(error.message).slice(0, 300) }); }
  }
  s.done = kept; s.frozen = 0;
  s.skipped = skipped;
  s.restored = restoreLocks(s, prev);
}
const stateOf = (s) => ({ recipe: s.recipe, players: s.players, level: s.level, biome: s.biome, light: s.light, meta: s.meta, gen: s.gen });
const swapState = (s, st) => { Object.assign(s, { recipe: st.recipe, players: st.players, level: st.level, biome: st.biome, light: st.light, meta: st.meta, gen: st.gen + 0 }); s.painter = null; s.cache = {}; };

/** A recipe op: the recipe it makes (checked), the ground regenerated; the entry keeps the level it replaced (undo swaps it back exactly). */
async function applyRecipeOp(s, o) {
  let recipe = clean(s.recipe), players = s.players;
  const stages = recipe.stages;
  const at = (id) => { const i = stages.findIndex((x) => x.id === id); if (i < 0) throw Error(`No stage ${id} (${stages.map((x) => x.id).join(', ')}).`); return i; };
  switch (o.op) {
    case 'recipe': recipe = o.recipe; if (o.players !== undefined) players = o.players; break;
    case 'seed': recipe.seed = o.seed; break;
    case 'stage': { const i = stages.findIndex((x) => x.id === o.stage.id); if (i >= 0) stages.splice(i, 1); stages.splice(Math.min(o.at ?? (i >= 0 ? i : stages.length), stages.length), 0, o.stage); break; }
    case 'unstage': { stages.splice(at(o.id), 1); if (!stages.length) throw Error('A recipe needs at least one stage.'); break; }
    case 'moveStage': { const [st] = stages.splice(at(o.id), 1); stages.splice(Math.min(o.to, stages.length), 0, st); break; }
    case 'size': recipe.width = o.width; recipe.depth = o.depth; break;
    case 'players': players = o.players; break;
    case 'act': recipe.act = o.act; break;
    case 'pin': recipe.pins = [...(recipe.pins ?? []), o.pin]; break;
    case 'unpin': { if (!(recipe.pins ?? [])[o.index]) throw Error(`No pin ${o.index}.`); recipe.pins = recipe.pins.filter((_, n) => n !== o.index); break; }
    case 'locks': recipe.locks = o.locks; break;
    default: throw Error(`"${o.op}" isn't a recipe op.`);
  }
  recipe = await checkRecipe(recipe);
  if (players > 0 && !isFinite_(recipe)) throw Error('Players need a finite map: give it a size first.');
  const before = stateOf(s);
  s.recipe = recipe; s.players = players;
  try { regenerate(s, before); } catch (error) { swapState(s, before); throw Error(`Regenerating failed, nothing changed: ${error.message}`); }
  const what = o.op === 'recipe' ? 'a new recipe' : o.op === 'stage' ? `stage ${o.stage.id} (${o.stage.use})` : o.op === 'unstage' ? `no stage ${o.id}` : o.op === 'seed' ? `seed ${o.seed}` : o.op === 'size' ? `${o.width} x ${o.depth}` : o.op === 'players' ? `${o.players} players` : o.op;
  return { other: before, did: `regenerated: ${what}${s.skipped.length ? `; ${s.skipped.length} hand edit${s.skipped.length === 1 ? '' : 's'} no longer fit` : ''}${s.restored?.length ? `; kept lock region${s.restored.length === 1 ? '' : 's'} ${s.restored.join(', ')}` : ''}` };
}

function undoOne(s) {
  if (s.done.length <= s.frozen) throw Error(s.frozen ? 'The edits before this session opened the saved level; they can\'t be undone here (a regenerate makes them undoable again).' : 'Nothing to undo.');
  const e = s.done.pop();
  if (e.kind === 'recipe') { const now = stateOf(s); swapState(s, e.other); e.other = now; }
  else { if (e.patch) restorePatch(s, e.patch); if (e.steps) { const r = loaded.level.applyLevelOp(s.level, { op: 'undo', steps: e.steps }); if (!r.ok) throw Error(`undo: ${r.error.message}`); } }
  s.undone.push(e);
  return e;
}
function redoOne(s) {
  const e = s.undone.pop();
  if (!e) throw Error('Nothing to redo.');
  if (e.kind === 'recipe') { const now = stateOf(s); swapState(s, e.other); e.other = now; }
  else { try { const r = applyEdit(s, e.op); e.steps = r.steps; e.patch = r.patch; } catch (error) { throw Error(`redo ${e.op.op}: ${error.message}`); } }
  s.done.push(e);
  return e;
}
/** Undo or redo a step: a stroke (ops sharing a stroke id) is one step. */
function history(s, name, steps) {
  const did = [];
  for (let k = 0; k < steps; k += 1) {
    const stack = name === 'undo' ? s.done : s.undone;
    const top = stack[stack.length - 1];
    if (!top) { if (!k) throw Error(`Nothing to ${name}.`); break; }
    const group = top.op.stroke;
    do { const e = name === 'undo' ? undoOne(s) : redoOne(s); did.push(`${name === 'undo' ? 'undid' : 'redid'} ${e.op.op}`); }
    while (group && (name === 'undo' ? s.done : s.undone).at(-1)?.op.stroke === group && (name === 'redo' || s.done.length > s.frozen));
  }
  return did;
}

/** Apply ops in order; stops at the first that fails (the ones before it stay applied, each undoable). */
async function applyOps(s, ops) {
  const checked = validateEditorOps(ops);
  if (!checked.ok) return { ok: false, applied: 0, errors: checked.errors, did: [] };
  const did = [];
  let applied = 0;
  for (const [index, op] of checked.ops.entries()) {
    try {
      const kind = opKind(op);
      if (kind === 'history') did.push(...history(s, op.op, op.steps ?? 1));
      else if (kind === 'recipe') { const r = await applyRecipeOp(s, op); s.done.push({ kind: 'recipe', op, other: r.other }); s.undone = []; did.push(r.did); }
      else {
        if (s.done.filter((e) => e.kind === 'edit').length >= MAX_EDITS) throw Error(`A level keeps at most ${MAX_EDITS} hand edits.`);
        const r = applyEdit(s, op);
        s.done.push({ kind: 'edit', op, steps: r.steps, patch: r.patch }); s.undone = [];
        did.push(r.did);
      }
      applied += 1; s.version += 1;
    } catch (error) {
      s.did = did;
      return { ok: false, applied, errors: [{ index, op: op.op, message: `op ${index} (${op.op}): ${String(error.message).slice(0, 500)}` }], did };
    }
  }
  s.did = did;
  return { ok: true, applied, errors: [], did };
}

// ---------------------------------------------------------------- what the editor sees

/** The dungeons in the recipe, re-run from their stage's seed and bounds: rooms, the room graph, start / key / boss / exit, the fairness gate. */
function dungeonsOf(s) {
  if (s.cache.dungeons) return s.cache.dungeons;
  const W = loaded.worldgen, out = [];
  if (isFinite_(s.recipe)) for (const st of s.recipe.stages) {
    if (st.use !== 'dungeon@1') continue;
    const [a, b, c, d] = W.maskBounds(st.mask, [0, 0, s.recipe.width, s.recipe.depth]);
    const w = c - a, h = d - b;
    if (w < 12 || h < 12) continue;
    const p = st.params ?? {};
    const algorithm = typeof p.algorithm === 'string' ? p.algorithm : String(s.meta[`${st.id}.algorithm`] ?? 'rooms');
    const rooms = typeof p.rooms === 'number' ? p.rooms : 10;
    const D = W.generateDungeon(st.seed ?? `${s.recipe.seed}/${st.id}`, w, h, { algorithm, rooms });
    const act = s.recipe.act ? W.DEFAULT_ACTS.find((x) => x.id === s.recipe.act) : null;
    const theme = typeof p.theme === 'string' && p.theme ? p.theme : act?.theme ?? 'crypt';
    // The room graph: rooms joined when open non-room cells (corridors, doors) run between them; an edge through a locked door is locked.
    const owner = new Int16Array(w * h).fill(-1);
    D.rooms.forEach((r, n) => { for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) if (D.cells[y * w + x] !== W.CELL.WALL) owner[y * w + x] = n; });
    const edges = new Map();
    const open = (k) => D.cells[k] !== W.CELL.WALL && D.cells[k] !== W.CELL.PIT;
    D.rooms.forEach((r, n) => {
      const seen = new Uint8Array(w * h); const queue = [];
      for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) { const k = y * w + x; if (owner[k] === n) { seen[k] = 1; queue.push([k, false]); } }
      while (queue.length) {
        const [k, locked] = queue.shift();
        const x = k % w, y = (k - x) / w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (seen[q] || !open(q)) continue;
          seen[q] = 1;
          const lk = locked || D.cells[q] === W.CELL.LOCKED;
          if (owner[q] >= 0 && owner[q] !== n) { const key = n < owner[q] ? `${n}-${owner[q]}` : `${owner[q]}-${n}`; edges.set(key, (edges.get(key) ?? false) || lk); continue; }
          if (owner[q] < 0) queue.push([q, lk]);
        }
      }
    });
    const check = W.checkDungeon(D, { minPath: Math.min(12, Math.floor((w + h) / 8)) });
    const at = (p) => (p ? [p[0] + a, p[1] + b] : null);
    out.push({
      stage: st.id, algorithm: D.algorithm, theme, rect: [a, b, c, d], attempt: D.stats.attempt ?? 0,
      rooms: D.rooms.map((r) => ({ id: r.id, x: r.x + a, y: r.y + b, w: r.w, h: r.h, kind: r.kind, template: r.template })),
      edges: [...edges].map(([key, locked]) => { const [x, y] = key.split('-').map(Number); return { from: x, to: y, locked }; }),
      start: at(D.start), exit: at(D.exit), key: at(D.key), boss: at(D.boss),
      check: { pass: check.pass, problems: [...check.problems], startToExit: check.startToExit, startToKey: check.startToKey, open: check.open },
    });
  }
  s.cache.dungeons = out;
  return out;
}

function fairnessOf(s) {
  if (!s.level || s.level.spawns.length < 2) return null;
  if (s.cache.fair?.version === s.version) return s.cache.fair.value;
  const f = loaded.level.fairness(s.level);
  const value = { pass: f.pass, connected: f.connected, tolerance: f.tolerance, worst: { metric: f.worst.metric, spread: Number.isFinite(f.worst.spread) ? f.worst.spread : null }, spread: Object.fromEntries(Object.entries(f.spread).map(([k, v]) => [k, Number.isFinite(v) ? v : null])), players: f.players.map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' && !Number.isFinite(v) ? null : v]))) };
  s.cache.fair = { version: s.version, value };
  return value;
}

/** The session as the tab and the assistant read it. */
function view(s) {
  const L = s.level;
  const edits = s.done.filter((e) => e.kind === 'edit');
  return {
    name: s.name, gen: s.gen, version: s.version, recipe: s.recipe, players: s.players, finite: !!L, size: L ? [L.terrain.width, L.terrain.depth] : [0, 0], genMs: s.genMs,
    counts: L ? { things: L.things.size, spawns: L.spawns.length, resources: L.resources.length, markers: L.markers.length, regions: L.regions.length, locks: L.regions.filter((r) => r.kind === 'lock').length, roads: L.roads.length, water: L.water.length, scatter: L.scatter.length, edits: edits.length } : { edits: edits.length },
    spawns: L ? clean(L.spawns) : [], resources: L ? clean(L.resources) : [], locks: L ? clean(L.regions.filter((r) => r.kind === 'lock')) : [],
    markers: L ? clean(L.markers.filter((m) => !['door', 'light'].includes(m.kind)).slice(0, 200)) : [],
    things: L ? [...L.things.values()].slice(0, 400).map((t) => ({ id: t.id, pack: t.pack, object: t.object, pos: t.pos.map((v) => Math.round(v * 100) / 100), tier: t.tier })) : [],
    history: { undo: s.done.length - s.frozen, redo: s.undone.length, frozen: s.frozen },
    skipped: s.skipped, did: s.did, note: s.note, tileset: s.tileset ? { objectId: s.tileset.objectId, rules: clean(loaded.worldgen.decodeTileset(fromBase64url(s.tileset.rules))) } : null,
    fairness: fairnessOf(s), dungeons: dungeonsOf(s),
  };
}

/** What the preview draws: the tile arrays (gzipped, one buffer) and the things and markers; an infinite world's recipe and its biome paint. */
function snapshotOf(s) {
  const L = s.level;
  const base = { key: `${s.key}#${s.gen}.${s.version}`, gen: s.gen, version: s.version, seed: s.recipe.seed, recipe: s.recipe };
  if (!L) return { ...base, kind: 'infinite', edits: s.done.filter((e) => e.kind === 'edit' && e.op.op === 'biome').map((e) => e.op) };
  const t = L.terrain, n = t.width * t.depth;
  const buf = Buffer.alloc(n * 11);
  // (Int16 arrays first, so every view over the buffer is aligned.)
  Buffer.from(t.height.buffer, t.height.byteOffset, n * 2).copy(buf, 0);
  Buffer.from(t.water.buffer, t.water.byteOffset, n * 2).copy(buf, n * 2);
  Buffer.from(t.deck.buffer, t.deck.byteOffset, n * 2).copy(buf, n * 4);
  for (const [arr, at] of [[t.type, 6], [t.flags, 7], [t.dir, 8], [s.biome, 9], [s.light, 10]]) Buffer.from(arr.buffer, arr.byteOffset, n).copy(buf, n * at);
  return {
    ...base, kind: 'finite', w: t.width, d: t.depth, tileSize: t.tileSize, stepHeight: t.stepHeight, chunk: t.chunk, types: t.types.list.map((x) => x.name),
    tiles: gzipSync(buf, { level: 1 }).toString('base64'), lit: s.light.some((v) => v !== 255),
    things: [...L.things.values()].map((th) => ({ id: th.id, pack: th.pack, object: th.object, pins: th.pins, pos: th.pos, yaw: th.yaw, scale: th.scale, tier: th.tier, layer: th.layer, footprint: th.footprint })),
    spawns: L.spawns, resources: L.resources, markers: L.markers.filter((m) => m.kind !== 'light'), regions: L.regions, roads: L.roads.map((r) => ({ id: r.id, kind: r.kind })), water: L.water.map((x) => ({ id: x.id, kind: x.kind, level: x.level })),
    dungeons: dungeonsOf(s),
  };
}

// ---------------------------------------------------------------- pictures: the terrain's CPU baker and compositor

/** A level's ground as a pixel-art picture (the real bake: the surface, biomes, light), at most `maxW` pixels wide. */
function groundPicture(terrain, biome, light, { maxW = 240, style = { name: 'pixel', screen: 4, dither: 0.9, outline: 2 } } = {}) {
  const E = loaded, T = E.terrain;
  const k = Math.max(0.35, Math.min(3, maxW / (terrain.width * terrain.tileSize)));
  const view = { yaw: 0, pitch: 0.6, pixelsPerMetre: k };
  const { surface, palette } = E.worldgen.worldSurface({ w: terrain.width, d: terrain.depth, biome, light }, E.table);
  const auto = T.autoTile(terrain);
  const layers = [];
  for (let c = 0; c < terrain.chunksX * terrain.chunksZ; c += 1) layers.push(T.bakeChunk({ terrain, auto, chunk: c, view, palette, style, surface, seed: 1 }));
  const gx = Math.min(...layers.map((l) => l.gx0)), gy = Math.min(...layers.map((l) => l.gy0));
  const width = Math.max(...layers.map((l) => l.gx0 + l.w)) - gx, height = Math.max(...layers.map((l) => l.gy0 + l.h)) - gy;
  const { rgba } = T.composeGround(layers, palette, { width, height, gx, gy, clear: [12, 13, 20] });
  return { width, height, rgba, k };
}
async function thumbOf({ recipe, players, maxW = 220 }) {
  const E = await engine();
  const r = await checkRecipe(recipe);
  if (!isFinite_(r)) {
    // An infinite world: a window round its origin.
    const stream = E.worldgen.createWorldStream(r);
    const L = stream.block(-48, -36, 96, 72);
    const t = E.worldgen.toTerrain(L, { chunk: 32 });
    const pic = groundPicture(t, L.biome, L.light, { maxW });
    return { url: pngDataUrl(pic.width, pic.height, pic.rgba), width: pic.width, height: pic.height, infinite: true };
  }
  const t0 = performance.now();
  const { level, map } = E.worldgen.generateWorldLevel(r, { players });
  const genMs = performance.now() - t0;
  const pic = groundPicture(level.terrain, map.biome, map.light, { maxW });
  let fair = null;
  if (level.spawns.length >= 2) { const f = E.level.fairness(level); fair = { pass: f.pass, connected: f.connected, worst: { metric: f.worst.metric, spread: Number.isFinite(f.worst.spread) ? f.worst.spread : null } }; }
  return { url: pngDataUrl(pic.width, pic.height, pic.rgba), width: pic.width, height: pic.height, genMs: Math.round(genMs), things: level.things.size, spawns: level.spawns.length, fair, dungeon: map.regions.filter((x) => x.kind === 'dungeon').length };
}

/** The same recipe through other seeds: the strip of variations (thumbnails, fairness for multiplayer maps). */
async function variations({ recipe, players = 0, count = 6, maxW = 200 }) {
  const base = String(recipe?.seed ?? '1');
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const seed = `${base}.${i}`;
    try { out.push({ seed, ...await thumbOf({ recipe: { ...recipe, seed }, players, maxW }) }); } catch (error) { out.push({ seed, error: String(error.message).slice(0, 300) }); }
  }
  return { base, variations: out };
}

// ---------------------------------------------------------------- open, save, load

/** Open a session: from a saved file (recipe, players, edits replayed; the saved level wins when it differs), or a fresh recipe. */
async function open({ key, name, content = '', recipe, players = 0 }) {
  const E = await engine();
  let file = null;
  if (content) file = readLevelFile(content);
  const rec = await checkRecipe(file ? E.worldgen.decodeRecipe(fromBase64url(file.recipe)) : recipe);
  const s = newSession(key, name, rec, file ? file.players : players);
  s.tileset = file?.tileset ?? null;
  generate(s);
  const skipped = [];
  for (const op of file?.edits ?? []) {
    const parsed = levelOpInput.safeParse(op);
    if (!parsed.success) { skipped.push({ op: String(op?.op), why: 'not an op' }); continue; }
    try { const r = applyEdit(s, op); s.done.push({ kind: 'edit', op, steps: r.steps, patch: r.patch }); } catch (error) { skipped.push({ op: op.op, why: String(error.message).slice(0, 300) }); }
  }
  s.skipped = skipped;
  if (file?.level && s.level) {
    const saved = fromBase64url(file.level);
    const now = E.level.encodeLevel(s.level.toDocument());
    if (Buffer.compare(Buffer.from(saved), Buffer.from(now)) !== 0) {
      const back = E.level.levelOf(E.level.decodeLevel(saved));
      if (back.terrain.width === s.level.terrain.width && back.terrain.depth === s.level.terrain.depth) {
        s.level = back; s.frozen = s.done.length; s.painter = null;
        s.note = 'The saved level differs from what its recipe and edits make with this engine: it opened as saved. Its earlier edits can\'t be undone until a regenerate.';
      }
    }
  }
  sessions.set(key, s);
  return { state: view(s), snapshot: snapshotOf(s) };
}

/** The session as its file (codec records, base64url) and the sizes of each record against its JSON. */
async function encode({ key }) {
  const E = await engine();
  const s = sessionOf(key);
  const recipeBytes = E.worldgen.encodeRecipe(s.recipe);
  const doc = s.level ? s.level.toDocument() : null;
  const levelBytes = doc ? E.level.encodeLevel(doc) : null;
  const edits = s.done.filter((e) => e.kind === 'edit').map((e) => e.op);
  const content = writeLevelFile({ name: s.name, players: s.players, recipe: toBase64url(recipeBytes), level: levelBytes ? toBase64url(levelBytes) : null, edits, tileset: s.tileset });
  const out = { content, sizes: { recipe: sizes(recipeBytes, s.recipe), level: levelBytes ? sizes(levelBytes, doc) : null, file: utf8(content), edits: utf8(JSON.stringify(edits)), tileset: s.tileset ? fromBase64url(s.tileset.rules).length : 0 } };
  return out;
}

async function decode({ content }) {
  const E = await engine();
  const file = readLevelFile(content);
  const recipe = E.worldgen.decodeRecipe(fromBase64url(file.recipe));
  const level = file.level ? E.level.decodeLevel(fromBase64url(file.level)) : null;
  return { name: file.name, players: file.players, recipe: clean(recipe), edits: file.edits, level: level ? { width: level.terrain.width, depth: level.terrain.depth, things: level.things.length, spawns: level.spawns.length, meta: clean(level.meta) } : null, tileset: file.tileset };
}

/** Try ops on a copy of a session (the live one untouched): what they did and the file they'd save. */
async function dryRun({ key, ops }) {
  const s = sessionOf(key);
  const { content } = await encode({ key });
  const tmp = `${key}~dry`;
  try {
    await open({ key: tmp, name: s.name, content });
    const t = sessions.get(tmp);
    if (s.tileset) t.tileset = s.tileset;
    const r = await applyOps(t, ops);
    if (!r.ok) return { ok: false, errors: r.errors, did: r.did };
    return { ok: true, did: r.did, skipped: t.skipped, content: (await encode({ key: tmp })).content };
  } finally { sessions.delete(tmp); }
}

async function apply({ key, ops, snapshot = true }) {
  await engine();
  const s = sessionOf(key);
  const r = await applyOps(s, ops);
  return { ...r, state: view(s), ...(snapshot ? { snapshot: snapshotOf(s) } : {}) };
}
async function state({ key, snapshot = false, thumb = false }) {
  await engine();
  const s = sessionOf(key);
  const out = { state: view(s), ...(snapshot ? { snapshot: snapshotOf(s) } : {}) };
  if (thumb && s.level) { const pic = groundPicture(s.level.terrain, s.biome, s.light, { maxW: 360 }); out.thumb = pngDataUrl(pic.width, pic.height, pic.rgba); }
  return out;
}
async function close({ key }) { return { closed: sessions.delete(key) }; }
async function setTileset({ key, tileset }) { const s = sessionOf(key); s.tileset = tileset; s.version += 1; return { state: view(s) }; }

// ---------------------------------------------------------------- tilesets

/** A PNG atlas and its rules through the engine's importer: the tileset's colours and materials, the rules as codec bytes, the atlas as RGBA for the preview, and a demo patch baked with it. */
async function tileset({ bytes, rules }) {
  const E = await engine();
  const img = decodePng(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  let ts;
  try { ts = E.terrain.importTileset(img, rules); } catch (error) { throw Error(`That tileset doesn't cut: ${error.message}`); }
  const types = E.terrain.terrainTypes();
  for (const m of rules.materials) if (!types.has(m.type)) throw Error(`The tileset names no terrain type "${m.type}" (${types.list.map((x) => x.name).join(', ')}).`);
  const rulesBytes = E.worldgen.encodeTileset(rules);
  // A demo patch: grass with a blob of each material (every edge and corner case the autotile answers), baked with the tileset's style.
  const t = E.terrain.createTerrain({ width: 18, depth: 14, tileSize: 2, stepHeight: 1, chunk: 32, types });
  // (On a ground none of its materials are, so every edge and corner of each blob shows.)
  const base = ['dirt', 'sand', 'rock', 'snow'].find((n) => !rules.materials.some((m) => m.type === n));
  for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width; i += 1) t.setType(i, j, base);
  rules.materials.forEach((m, n) => {
    const cx = 4 + (n % 3) * 5, cy = 4 + Math.floor(n / 3) * 5;
    for (const [i, j] of discTiles([cx, cy], 2.6, t.width, t.depth)) if ((i + j * 3 + n) % 11 !== 0) t.setType(i, j, m.type);
    t.setType(cx + 3, cy, m.type); t.setType(cx, cy + 3, m.type);
  });
  const palette = E.terrain.tilesetPalette(E.terrain.groundPalette(types), ts);
  const auto = E.terrain.autoTile(t);
  const layer = E.terrain.bakeChunk({ terrain: t, auto, chunk: 0, view: { yaw: 0, pitch: 1.2, pixelsPerMetre: ts.tile / 2 }, palette, style: E.terrain.tilesetStyle(ts, t), seed: 1 });
  const { rgba } = E.terrain.composeGround([layer], palette, { width: layer.w, height: layer.h, gx: layer.gx0, gy: layer.gy0, clear: [12, 13, 20] });
  return { width: img.width, height: img.height, rgba: toBase64url(img.rgba), colours: ts.colours.length, materials: ts.materials, rules: clean(rules), rulesBytes: toBase64url(rulesBytes), sizes: sizes(rulesBytes, rules), demo: pngDataUrl(layer.w, layer.h, rgba) };
}

// ---------------------------------------------------------------- the preview page

let page;
/** The page: level-preview.mjs bundled with the engine's sources and every content pack the checkout has. */
async function preview() {
  if (page) return page;
  const E = await engine();
  const here = dirname(new URL(import.meta.url).pathname);
  const entry = [join(here, 'level-preview.mjs'), join(workerData.sourceDir ?? '', 'level-preview.mjs')].find((file) => file && existsSync(file));
  if (!entry) throw new Error('The level preview script is missing from this build of the editor.');
  let esbuild;
  for (const from of [import.meta.url, pathToFileURL(join(root, 'package.json')).href]) { try { esbuild = createRequire(from)('esbuild'); break; } catch { /* Try the engine's own. */ } }
  if (!esbuild) throw new Error('The level preview is bundled with esbuild, which this editor build could not find (a development feature, like the engine itself).');
  const groups = ['packages', 'packs', 'ai', 'systems'];
  const plugin = { name: 'keel-engine-source', setup(b) {
    b.onResolve({ filter: /^@keel-engine\/[\w-]+(\/[\w-]+)?$/ }, (a) => {
      const [name, sub] = a.path.slice('@keel-engine/'.length).split('/');
      for (const g of groups) { const file = join(root, g, name, 'src', `${sub ?? 'index'}.ts`); if (existsSync(file)) return { path: file }; }
      return undefined;
    });
  } };
  const packs = E.packs.map((p) => p.file);
  const contents = `${packs.map((file, n) => `import * as P${n} from ${JSON.stringify(file)};`).join('\n')}\nimport { start } from ${JSON.stringify(entry)};\nstart([${packs.map((_, n) => `P${n}.pack`).join(', ')}]);\n`;
  const out = await esbuild.build({ stdin: { contents, resolveDir: here, loader: 'js' }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false, logLevel: 'silent', plugins: [plugin], legalComments: 'none' });
  const script = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const css = 'html,body{margin:0;height:100%;background:#0b0c12;color:#cfd3e6;font:11px ui-monospace,Menlo,monospace;overflow:hidden}canvas{position:absolute;left:0;top:0}#view{image-rendering:pixelated}#overlay{pointer-events:none}#status{position:absolute;left:8px;bottom:6px;right:8px;color:#9aa0bb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;text-shadow:0 1px 0 #000}#note{position:absolute;left:8px;top:6px;color:#6f7590;pointer-events:none;text-shadow:0 1px 0 #000}';
  page = `<!doctype html><meta charset="utf-8"><title>KEEL level preview</title><style>${css}</style><canvas id="view"></canvas><canvas id="overlay"></canvas><div id="note"></div><div id="status"></div><script>${script}</script>`;
  return page;
}

const operations = { catalogue, open, apply, state, encode, decode, dryRun, close, variations, thumb: thumbOf, tileset, setTileset, preview };
parentPort.on('message', async ({ id, op, input }) => {
  try {
    const run = operations[op];
    if (!run) throw new Error(`Unknown level operation ${op}.`);
    parentPort.postMessage({ id, result: await run(input ?? {}) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error).slice(0, 4000) });
  }
});
