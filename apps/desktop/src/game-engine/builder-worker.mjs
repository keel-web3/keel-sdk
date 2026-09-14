// The KEEL builder, off the editor's main thread: builds (voxel models and
// capsule-and-rig characters) as the engine's own sessions, driven by the
// builder's op list one op at a time -- each op's change event updates the
// engine's live preview (only the chunks a stroke touched are re-meshed) and
// a few ops make one preview frame, posted to main while the list streams, so
// whoever is watching sees it draw. Also: seeded variants, clips posed for the
// timeline and the baker, pack-file export, the 3D import (source -> voxels ->
// parts -> body / worn, with its op list), and the sandboxed preview page (the
// engine's pixel renderer and baker, bundled once per engine checkout).
// Like the game engine's worker, Node runs the engine's TypeScript directly and
// only trusted main-process requests arrive here.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { opsHash } from './builder-ops-hash.mjs';

const root = workerData.root;
const src = (group, name) => pathToFileURL(join(root, group, name, 'src', 'index.ts')).href;
let loaded;
async function engine() {
  if (!loaded) {
    const [builder, importer, entity, core, keel] = await Promise.all(['builder', 'import', 'entity', 'core', 'keel'].map((name) => import(src('packages', name))));
    loaded = { builder, importer, entity, core, keel, registry: null };
  }
  return loaded;
}

/** What a character may wear: every installed pack's attributes (their packs' `pack` exports), as the session's registry. */
async function registry() {
  const e = await engine();
  if (e.registry) return e.registry;
  const out = [];
  try {
    const workspace = await e.keel.readWorkspace(root, { projects: [] });
    for (const mod of workspace.filter((m) => m.manifest.kind === 'pack')) {
      for (const file of ['module.ts', 'index.ts']) {
        const path = join(mod.dir, 'src', file);
        if (!existsSync(path)) continue;
        try {
          const exported = await import(pathToFileURL(path).href);
          for (const def of exported.pack?.attributes ?? []) if (typeof def?.build === 'function' && !out.some((item) => item.id === def.id)) out.push(def);
          if (exported.pack) break;
        } catch { /* A pack that doesn't load offers nothing to wear. */ }
      }
    }
  } catch { /* Without the workspace a character wears only what the build makes. */ }
  e.registry = out;
  return out;
}

// ---------------------------------------------------------------- sessions

const sessions = new Map();
const round = (value) => Math.round(value * 1e4) / 1e4;
const r3 = (v) => [round(v[0]), round(v[1]), round(v[2])];
const clean = (value) => JSON.parse(JSON.stringify(value ?? null));
const effective = (entry) => entry.session.history.map((item) => item.op);
const post = (message) => parentPort.postMessage(message);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newEntry(key) {
  const { builder } = await engine();
  const session = builder.createSession(undefined, { attributes: await registry() });
  const entry = { key, session, live: builder.livePreview(session), rigCache: null, frame: 0 };
  sessions.set(key, entry);
  return entry;
}
function entryOf(key) {
  const entry = sessions.get(key);
  if (!entry) throw Object.assign(new Error(`No open build ${key}. Open it in the Builder first.`), { code: 'NO_BUILD' });
  return entry;
}

/** The rig overlay: joints where the preview draws them (model metres about its pivot) and in voxel coordinates, with their parents. */
async function rigOf(entry) {
  const { builder, entity } = await engine();
  const s = entry.session;
  try {
    if (s.design) {
      const spec = builder.characterSpec(s.design);
      const joints = entity.restJoints(spec.rig);
      return { kind: 'character', plan: spec.plan, editable: false, bones: spec.rig.bones.map((b) => ({ name: b.name, parent: b.parent, at: r3(joints[b.name]) })) };
    }
    if (!s.rig) return null;
    const body = builder.bodyOf(s);
    if (!body.count) return null;
    const rig = builder.autoRig(body, s.rig);
    const joints = entity.restJoints(rig.spec.rig);
    const O = rig.analysis.origin, u = body.unit, pv = s.editor.model.pivot();
    return {
      kind: 'voxels', plan: rig.plan, editable: true, missing: [...rig.missing], sockets: Object.keys(rig.sockets),
      bones: rig.spec.rig.bones.map((b) => {
        const p = joints[b.name];
        const vox = [p[0] / u + O[0], p[1] / u + O[1], p[2] / u + O[2]];
        return { name: b.name, parent: b.parent, vox: vox.map((v) => Math.round(v * 2) / 2), at: r3([(vox[0] - pv[0]) * u, (vox[1] - pv[1]) * u, (vox[2] - pv[2]) * u]) };
      }),
    };
  } catch (error) { return { kind: 'error', error: String(error?.message ?? error).slice(0, 300), bones: [] }; }
}

function lookOf(look) { return { colours: look.palette.colours, ramps: look.palette.ramps, materials: look.materials }; }
function solidsOf(solids) {
  return {
    boxes: solids.boxes.map((b) => ({ c: r3(b.c), h: r3(b.h), yaw: round(b.yaw ?? 0), mat: b.mat ?? 0, ...(b.kind ? { kind: b.kind, lo: b.lo ?? 0 } : {}) })),
    capsules: (solids.capsules ?? []).map((c) => ({ a: r3(c.a), b: r3(c.b), r: round(c.r), mat: c.mat ?? 0 })),
    wedges: (solids.wedges ?? []).map((w) => ({ c: r3(w.c), h: r3(w.h), yaw: round(w.yaw ?? 0), lo: w.lo ?? 0, mat: w.mat ?? 0 })),
  };
}

/** One preview frame: what to draw now, the look, where the voxels are, the rig. */
function frameOf(entry, extra = {}) {
  const s = entry.session;
  const { solids, look } = entry.live.solids();
  const m = s.editor.model;
  entry.frame += 1;
  return {
    key: entry.key, n: entry.frame, kind: s.design ? 'character' : 'voxels', ...solidsOf(solids), look: lookOf(look),
    unit: m.unit, pivot: s.design ? [0, 0, 0] : [...m.pivot()], voxels: m.count, rig: entry.rigCache,
    // (What the stat cards read as ops stream: the frame is always the build as it is now, the state lags a stream.)
    history: { total: s.history.length, undone: s.undone.length }, target: clean(s.target), roles: m.roles.length, ...extra,
  };
}

/** What the build is now: plain JSON for the editor and the agent. */
async function stateOf(entry, { log = false } = {}) {
  const { builder, entity } = await engine();
  const s = entry.session;
  const m = s.editor.model;
  const b = m.bounds();
  const groups = [...m.groups.keys()].map((name) => ({ name, cells: 0, attached: s.attachments[name] ? clean(s.attachments[name]) : null }));
  if (groups.length) { const at = new Map(groups.map((g) => [g.name, g])); m.forEach((x, y, z) => { const g = m.groupAt(x, y, z); if (g) at.get(g).cells += 1; }); }
  const history = s.history;
  let character = null;
  if (s.design) {
    const d = s.design;
    const spec = builder.characterSpec(d);
    const made = spec.choices;
    character = {
      kind: d.kind, species: spec.species, seed: d.seed, size: d.size ?? null, plan: spec.plan, contract: entity.contractOf(spec).ref,
      pins: clean(d.pins), body: clean(d.body), parts: clean(d.parts), wear: clean(d.wear),
      proportions: Object.fromEntries(builder.proportionNames(d.kind).map((name) => [name, round(spec.body[name] ?? 0)])),
      choices: builder.choiceNames().map((name) => { let options; try { options = entity.optionsOf(name, made); } catch { options = undefined; } const range = entity.CHOICES.find((c) => c.name === name)?.range; return { name, ...(options ? { options: clean(options) } : {}), ...(range ? { range: [...range] } : {}), value: clean(made[name] ?? null) }; }),
      sockets: Object.keys(entity.socketsOf(spec)),
      bones: spec.rig.bones.map((bone) => bone.name),
    };
  }
  return {
    key: entry.key, mode: s.design ? 'character' : 'voxels',
    model: { name: m.name, unit: m.unit, count: m.count, roles: [...m.roles], bounds: b ? { min: [...b.min], max: [...b.max] } : null, pivot: [...m.pivot()], symmetry: clean(s.editor.symmetry) },
    groups, target: clean(s.target), colours: clean(s.colours), animation: clean(s.animation), variation: clean(s.variation),
    rig: entry.rigCache, character,
    attributes: [...s.attributes.values()].map((a) => ({ id: a.id, slot: a.slot, ...(a.title ? { title: a.title } : {}) })),
    history: { total: history.length, undone: s.undone.length, recent: history.slice(-40).map((item) => ({ seq: item.event.seq, op: item.op.op, did: item.event.did })).reverse() },
    opsHash: opsHash(effective(entry)),
    ...(log ? { ops: clean(effective(entry)) } : {}),
    catalogue: { kinds: [...entity.KINDS], species: Object.fromEntries(Object.entries(entity.SPECIES).map(([k, list]) => [k, list.map(([name]) => name)])), generators: [...builder.GENERATOR_KINDS], roles: [...builder.ROLES], motions: [...builder.MOTION_KINDS] },
  };
}

/**
 * Apply ops one at a time. Every `per` ops (and at the end) one preview frame
 * is posted as progress, then a short pause so the drawing is seen; a failing
 * op stops the list -- the ops before it stay applied, each undoable.
 */
async function stream(entry, ops, { id, pace = true, label = '' }) {
  const { builder } = await engine();
  const per = Math.min(24, Math.max(1, Math.ceil(ops.length / 90)));
  const results = [];
  let reset = false, stopped = null;
  for (let i = 0; i < ops.length; i += 1) {
    const r = builder.applyOp(entry.session, ops[i], i);
    if (!r.ok) { stopped = { index: i, op: ops[i].op, message: r.error.message }; results.push({ index: i, op: ops[i].op, ok: false, error: r.error.message }); break; }
    entry.live.apply(r.event);
    if (r.event.rebuild === 'all' && ['model', 'character'].includes(r.event.kind)) reset = true;
    if (['rig', 'model', 'character', 'proportion', 'undo', 'redo', 'attach', 'group'].includes(r.event.kind) || r.event.of) entry.rigStale = true;
    results.push({ index: i, op: r.event.op, ok: true, did: r.event.did, kind: r.event.kind });
    if (pace && id !== undefined && ((i + 1) % per === 0) && i < ops.length - 1) {
      post({ id, progress: frameOf(entry, { label: `${label}op ${i + 1}/${ops.length} ${r.event.op} — ${r.event.did}`, done: i + 1, total: ops.length, reset }) });
      reset = false;
      await pause(28);
    }
  }
  if (entry.rigStale || entry.rigCache === null) { entry.rigCache = await rigOf(entry); entry.rigStale = false; }
  const last = results.at(-1);
  const frame = frameOf(entry, { label: last ? `${label}${stopped ? `stopped at op ${stopped.index + 1}: ${stopped.message}` : `op ${results.length}/${ops.length} ${last.op} — ${last.did}`}` : `${label}nothing to do`, done: results.filter((item) => item.ok).length, total: ops.length, reset });
  return { results, stopped, frame };
}

async function validate({ ops }) {
  const { builder } = await engine();
  const v = builder.validateOps(ops);
  return { ok: v.ok, errors: v.errors };
}

/** Open a build from its saved op list, or keep the one already open: saved ops that extend it stream in; unsaved work on top of them is kept. */
async function open({ key, ops = [], pace = false, reset = false }, id) {
  let entry = sessions.get(key);
  const v = await validate({ ops: ops.length ? ops : [{ op: 'new' }] });
  if (!v.ok) throw new Error(`The saved build doesn't check out: ${v.errors.slice(0, 3).map((e) => e.message).join(' ')}`);
  let replay = ops, how = 'opened';
  if (entry && !reset) {
    const live = effective(entry);
    const same = (a, b, n) => JSON.stringify(a.slice(0, n)) === JSON.stringify(b.slice(0, n));
    if (live.length === ops.length && same(live, ops, ops.length)) { replay = []; how = 'unchanged'; }
    else if (ops.length > live.length && same(live, ops, live.length)) { replay = ops.slice(live.length); how = 'extended'; }
    else if (live.length > ops.length && same(live, ops, ops.length)) { replay = []; how = 'kept-unsaved'; }
    else { entry = null; how = 'reloaded'; }
  }
  if (!entry || reset) entry = await newEntry(key);
  const run = await stream(entry, replay, { id, pace, label: how === 'extended' ? 'saved: ' : '' });
  if (run.stopped) throw new Error(`The saved build stopped at op ${run.stopped.index + 1}: ${run.stopped.message}`);
  return { how, state: await stateOf(entry), frame: { ...run.frame, reset: true } };
}

async function apply({ key, ops, pace = true, label = '' }, id) {
  const entry = entryOf(key);
  const v = await validate({ ops });
  if (!v.ok) return { ok: false, applied: 0, errors: v.errors, results: [], state: await stateOf(entry) };
  const run = await stream(entry, ops, { id, pace, label });
  return { ok: !run.stopped, applied: run.results.filter((item) => item.ok).length, errors: run.stopped ? [run.stopped] : [], results: run.results, frame: run.frame, state: await stateOf(entry) };
}

async function state({ key, log = false }) { const entry = entryOf(key); if (entry.rigCache === null) entry.rigCache = await rigOf(entry); return stateOf(entry, { log }); }
async function frame({ key }) { const entry = entryOf(key); if (entry.rigCache === null) entry.rigCache = await rigOf(entry); return frameOf(entry, { label: 'current build', reset: true }); }
async function close({ key }) { return { closed: sessions.delete(key) }; }

/** The builder's op table (the reference an assistant reads), and the JSON schema of one op. */
async function reference() {
  const { builder } = await engine();
  return { reference: builder.opReference(), schema: builder.opSchema(), generators: [...builder.GENERATOR_KINDS] };
}

// ---------------------------------------------------------------- variants, clips, export

const heightOf = (s) => Math.max(0.1, ...s.boxes.map((b) => b.c[1] + b.h[1]), ...(s.capsules ?? []).map((c) => Math.max(c.a[1], c.b[1]) + c.r));

/** Seeded variants: a voxel build through its variation rules, a character through other seeds with the same pins, parts and wear. */
async function variants({ key, count = 6, seed = 'variants' }) {
  const { builder, entity } = await engine();
  const s = entryOf(key).session;
  const out = [];
  if (s.design) {
    for (let i = 0; i < count; i += 1) {
      const d = builder.characterDesign({ ...s.design, seed: `${s.design.seed}.${seed}.${i + 1}` });
      const spec = builder.characterSpec(d);
      const look = builder.characterLook(spec);
      const solids = builder.characterSolids(d, entity.posed(spec, 'idle', { t: 0.4 }), look, s.attributes, spec);
      out.push({ seed: d.seed, picked: { species: spec.species }, ...solidsOf(solids), look: lookOf(look), height: round(heightOf(solids)) });
    }
    return { mode: 'character', rules: 0, variants: out };
  }
  const m = s.editor.model;
  if (!m.count) return { mode: 'voxels', rules: 0, variants: [], note: 'Draw something first.' };
  const rules = { ...(Object.keys(s.variation.scale).length ? { scale: s.variation.scale } : {}), ...(Object.keys(s.variation.optional).length ? { optional: s.variation.optional } : {}), ...(Object.keys(s.variation.pick).length ? { pick: s.variation.pick } : {}), ...(s.variation.size ? { size: s.variation.size } : {}) };
  const n = Object.keys(rules).length;
  const look = builder.builderLook(s.colours, { extra: [...m.roles] });
  for (const v of builder.variantsOf(m, rules, count, seed)) {
    const solids = builder.renderSolids(v.model, look);
    out.push({ picked: clean(v.picked), ...solidsOf(solids), look: lookOf(look), height: round(heightOf(solids)), voxels: v.model.count });
  }
  return { mode: 'voxels', rules: n, variants: out, ...(n ? {} : { note: 'No variation rules yet: every seed is the same. Add one with a vary op (scale a group, make one optional, pick one of several, vary the size).' }) };
}

/** A clip posed frame by frame (the baker's pose(clip, frame)): the timeline scrubs these, the bake preview bakes them. */
async function poses({ key, clip, pack = 'keel/builder' }) {
  const { builder } = await engine();
  const s = entryOf(key).session;
  if (!s.design && !s.editor.model.count) throw new Error('Draw something first: an empty build has nothing to pose.');
  const built = builder.buildSession(s, { pack });
  const d = built.design;
  if (!d) throw new Error(`A${built.kind === 'attribute' ? 'n attribute' : ` ${built.kind}`} has no clips of its own: target it as an object or an entity to animate and bake it.`);
  const name = clip && d.clips.some((c) => c.name === clip) ? clip : d.clips[0].name;
  const info = d.clips.find((c) => c.name === name);
  const frames = [];
  for (let f = 0; f < Math.min(info.frames, 16); f += 1) frames.push(solidsOf(d.pose(name, f)));
  return { kind: built.kind, key: d.key, clips: clean(d.clips), clip: name, info: clean(d.clip ? d.clip(name) : info), height: round(d.height), radius: round(d.radius), look: { colours: d.palette.colours, ramps: d.palette.ramps, materials: d.materials }, frames };
}

/**
 * The build as the builder's pack file (one TypeScript file, one thing), and a file for each worn group's attribute.
 * `look`: "pixel" (the default) exports the pixel look -- long boxes as capsules, the pixel style's primitives, so
 * the sprites a game bakes from it read as pixel art -- unless the build's target chose its own; "voxel" is the
 * blocky export as the builder writes it.
 */
async function exportPack({ key, pack = 'keel/builder', look = 'pixel' }) {
  const { builder } = await engine();
  const s = entryOf(key).session;
  if (!s.design && !s.editor.model.count) throw new Error('Draw something first: an empty build exports nothing.');
  const built = builder.buildSession(s, { pack });
  const asset = builder.assetOf(s);
  let code = built.code;
  if (look === 'pixel' && !s.design && typeof builder.exportPackFile === 'function') {
    const smooth = { capsules: true };
    const a = asset.kind === 'object' ? { ...asset, object: { ...asset.object, smooth: asset.object?.smooth ?? smooth } }
      : asset.kind === 'attribute' ? { ...asset, attribute: { ...asset.attribute, smooth: asset.attribute?.smooth ?? smooth } } : asset;
    code = `// Look: pixel (the KEEL editor's default export)${asset.kind === 'entity' ? '' : ' -- long boxes as capsules'}; the baked pixel sprites are what a game shows.\n${builder.exportPackFile(a)}`;
  }
  return { kind: built.kind, id: asset.id, look: s.design ? 'character' : look, code, stats: clean(built.stats), attributes: (built.attributes ?? []).map((w) => ({ group: w.group, slot: w.slot, id: w.attribute.id, code: w.code })) };
}

const PART_FIELDS = ['id', 'shape', 'on', 'role', 'units', 'a', 'b', 'r', 'c', 'h', 'yaw', 'lo'];
/**
 * A variant (the Variants strip's seed `index`) as the ops that make the open build into it -- so "Use this
 * variant" lands in the history like any other ops. A character: the design again with the variant's seed (its
 * pins, proportions, parts, wear and target kept). Voxels: the cells the variation rules changed (rows of
 * set/box ops, symmetry off meanwhile), the groups whose regions moved, and the unit when the size rule changed it.
 */
async function variantOps({ key, index, seed = 'variants', count = 6 }) {
  const { builder } = await engine();
  const s = entryOf(key).session;
  const ops = [];
  if (s.design) {
    const d = builder.characterDesign({ ...s.design, seed: `${s.design.seed}.${seed}.${index + 1}` });
    ops.push({ op: 'character', kind: d.kind, ...(d.species ? { species: d.species } : {}), seed: d.seed, ...(d.size !== undefined ? { size: d.size } : {}), ...(s.target?.id ? { id: s.target.id } : {}) });
    for (const [choice, value] of Object.entries(d.pins)) ops.push({ op: 'pin', choice, value: clean(value) });
    for (const [name, p] of Object.entries(d.body)) ops.push({ op: 'proportion', name, ...(p.value !== undefined ? { value: p.value } : { scale: p.scale }) });
    for (const part of d.parts) ops.push({ op: 'part', ...Object.fromEntries(PART_FIELDS.filter((k) => part[k] !== undefined).map((k) => [k, clean(part[k])])) });
    for (const w of d.wear) ops.push({ op: 'wear', attribute: w.attribute, ...(Object.keys(w.pins ?? {}).length ? { pins: clean(w.pins) } : {}) });
    if (s.target?.title || s.target?.tags) ops.push({ op: 'target', as: 'entity', ...(s.target.id ? { id: s.target.id } : {}), ...(s.target.title ? { title: s.target.title } : {}), ...(s.target.tags ? { tags: clean(s.target.tags) } : {}) });
    return { mode: 'character', seed: d.seed, ops };
  }
  const m = s.editor.model;
  const rules = { ...(Object.keys(s.variation.scale).length ? { scale: s.variation.scale } : {}), ...(Object.keys(s.variation.optional).length ? { optional: s.variation.optional } : {}), ...(Object.keys(s.variation.pick).length ? { pick: s.variation.pick } : {}), ...(s.variation.size ? { size: s.variation.size } : {}) };
  if (!Object.keys(rules).length) throw new Error('No variation rules yet: every seed is the same build.');
  const list = builder.variantsOf(m, rules, Math.max(count, index + 1), seed);
  const v = list[index]?.model;
  if (!v) throw new Error(`No variant ${index + 1}.`);
  const sym = s.editor.symmetry;
  if (sym && sym.mode !== 'none') ops.push({ op: 'symmetry', mode: 'none' });
  if (v.unit !== m.unit) ops.push({ op: 'unit', metres: v.unit });
  // (Every cell either model has, with the role it should end up as; then rows along x of the same change.)
  const want = new Map();
  const at = (x, y, z) => `${x},${y},${z}`;
  m.forEach((x, y, z) => { const r = v.roleAt(x, y, z); if (r !== m.roleAt(x, y, z)) want.set(at(x, y, z), [x, y, z, r]); });
  v.forEach((x, y, z) => { const r = v.roleAt(x, y, z); if (r !== m.roleAt(x, y, z)) want.set(at(x, y, z), [x, y, z, r]); });
  const cells = [...want.values()].sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]);
  for (let i = 0; i < cells.length;) {
    const [x, y, z, role] = cells[i];
    let j = i + 1;
    while (j < cells.length && cells[j][1] === y && cells[j][2] === z && cells[j][3] === role && cells[j][0] === cells[j - 1][0] + 1) j += 1;
    ops.push(j - i === 1 ? { op: 'set', at: [x, y, z], role } : { op: 'box', from: [x, y, z], to: [cells[j - 1][0], y, z], role });
    i = j;
  }
  for (const [name, regions] of v.groups) {
    if (JSON.stringify(regions) === JSON.stringify(m.groups.get(name) ?? null) || !regions.length) continue;
    regions.forEach((g, k) => ops.push({ op: 'group', name, from: [...g.min], to: [...g.max], ...(k === 0 ? { replace: true } : {}) }));
  }
  if (sym && sym.mode !== 'none') ops.push({ op: 'symmetry', mode: sym.mode, ...(sym.center ? { center: clean(sym.center) } : {}) });
  return { mode: 'voxels', picked: clean(list[index].picked), cells: cells.length, voxels: v.count, ops };
}

/** Load an exported pack file back (imports pointed at this engine checkout) and say what it defines: the round trip. */
async function loadPack({ code }) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-builder-pack-'));
  try {
    const file = join(dir, 'asset.ts');
    await writeFile(file, String(code).replace(/from "@keel-engine\/([\w-]+)"/g, (_all, name) => `from ${JSON.stringify(src('packages', name))}`));
    const mod = await import(`${pathToFileURL(file).href}?${Date.now()}`);
    const def = mod.default;
    if (!def) throw new Error('The pack file has no default export.');
    const parts = def.parts ?? def.meta?.builder?.parts;
    return { id: def.id ?? def.key ?? null, ...(def.slot ? { slot: def.slot, kind: 'attribute' } : def.body ? { body: def.body, kind: 'entity' } : { kind: 'object' }), parts: Array.isArray(def.parts) ? def.parts.length : null, colliders: Array.isArray(def.colliders) ? def.colliders.length : null, sockets: def.sockets && typeof def.sockets === 'object' && !Array.isArray(def.sockets) ? Object.keys(def.sockets).length : null, meta: clean(def.meta?.builder ? { voxels: def.meta.builder.voxels ?? def.meta.builder.count ?? null } : null), hasParts: !!parts };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- import

const BG = [22, 24, 34];
const HUES = [[230, 90, 80], [90, 170, 240], [120, 210, 110], [240, 190, 70], [190, 120, 230], [80, 210, 200], [240, 140, 190], [170, 170, 90], [120, 130, 240], [250, 120, 40], [110, 230, 170], [200, 90, 150]];
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function camFor(height, yaw = 0.62, across = 0) {
  const h = Math.max(0.2, height, across * 1.1);
  const dist = h * 1.85 + 0.12;
  return { eye: [Math.sin(yaw) * dist, h * 0.45 + dist * 0.42, Math.cos(yaw) * dist], target: [0, h * 0.45, 0], fov: 0.8 };
}
function picture(size) { const data = new Uint8Array(size * size * 4); for (let i = 0; i < size * size; i += 1) data.set([...BG, 255], i * 4); return { width: size, height: size, data }; }

/** Voxels ray-cast through the dense grid (the import tool page's view): a colour per cell, faces lit by their normal. */
function castVoxels(core, m, colourOf, size, cam) {
  const img = picture(size);
  const d = m.dense();
  const [sx, sy, sz] = d.size;
  const u = m.unit, pv = m.pivot();
  const B = core.cameraBasis(cam.eye, cam.target);
  const tan = Math.tan(cam.fov / 2);
  const light = norm([0.5, 0.85, 0.4]);
  const cells = new Map();
  const col = (x, y, z) => { const k = x + sx * (y + sy * z); if (cells.has(k)) return cells.get(k); const c = d.data[k] ? colourOf(x + d.min[0], y + d.min[1], z + d.min[2]) : null; cells.set(k, c); return c; };
  const o = [cam.eye[0] / u + pv[0] - d.min[0], cam.eye[1] / u + pv[1] - d.min[1], cam.eye[2] / u + pv[2] - d.min[2]];
  for (let py = 0; py < size; py += 1) for (let px = 0; px < size; px += 1) {
    const a = ((px + 0.5) / size * 2 - 1) * tan, b = (1 - (py + 0.5) / size * 2) * tan;
    const dir = norm([B.forward[0] + B.right[0] * a + B.up[0] * b, B.forward[1] + B.right[1] * a + B.up[1] * b, B.forward[2] + B.right[2] * a + B.up[2] * b]);
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(dir[k]) < 1e-12) { if (o[k] < 0 || o[k] > d.size[k]) t0 = Infinity; continue; }
      let ta = (0 - o[k]) / dir[k], tb = (d.size[k] - o[k]) / dir[k];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (!(t0 < t1)) continue;
    const p = [o[0] + dir[0] * (t0 + 1e-6), o[1] + dir[1] * (t0 + 1e-6), o[2] + dir[2] * (t0 + 1e-6)];
    let x = Math.min(sx - 1, Math.max(0, Math.floor(p[0]))), y = Math.min(sy - 1, Math.max(0, Math.floor(p[1]))), z = Math.min(sz - 1, Math.max(0, Math.floor(p[2])));
    const step = [Math.sign(dir[0]), Math.sign(dir[1]), Math.sign(dir[2])];
    const tMax = [0, 1, 2].map((k) => { const cell = [x, y, z][k]; const next = step[k] > 0 ? cell + 1 : cell; return Math.abs(dir[k]) < 1e-12 ? Infinity : (next - p[k]) / dir[k]; });
    const tDelta = [0, 1, 2].map((k) => (Math.abs(dir[k]) < 1e-12 ? Infinity : Math.abs(1 / dir[k])));
    let face = [0, 1, 2].reduce((best, k) => { const ta = Math.abs(dir[k]) < 1e-12 ? -Infinity : (((dir[k] > 0 ? 0 : d.size[k]) - o[k]) / dir[k]); return Math.abs(ta - t0) < 1e-6 ? k : best; }, 1);
    for (let n = 0; n < sx + sy + sz + 4; n += 1) {
      const c = col(x, y, z);
      if (c) {
        const nrm = [0, 0, 0]; nrm[face] = -step[face];
        const k = 0.45 + 0.55 * Math.max(0, dot(nrm, light));
        img.data.set([c[0] * k, c[1] * k, c[2] * k, 255], (py * size + px) * 4);
        break;
      }
      const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      if (k === 0) x += step[0]; else if (k === 1) y += step[1]; else z += step[2];
      tMax[k] += tDelta[k]; face = k;
      if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) break;
    }
  }
  return img;
}

/** The source triangles rasterised (a z-buffer, flat light), coloured by material, vertex colour and texture. */
function rasterSource(core, importer, r, size, cam) {
  if (r.scene.voxels) return castVoxels(core, r.model, (x, y, z) => srgbOf(importer, r, x, y, z), size, cam);
  const img = picture(size);
  const zb = new Float32Array(size * size).fill(Infinity);
  const soup = importer.soupOf(r.scene, { scale: r.grid.scale / r.scene.metres });
  const u = r.grid.unit, pv = r.model.pivot();
  const toModel = (i) => [0, 1, 2].map((k) => (((soup.positions[i * 3 + k] - r.grid.origin[k]) / u - r.offset[k] - pv[k]) * u));
  const B = core.cameraBasis(cam.eye, cam.target);
  const tan = Math.tan(cam.fov / 2);
  const light = norm([0.5, 0.85, 0.4]);
  const project = (p) => { const q = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]]; const zc = dot(q, B.forward); return [((dot(q, B.right) / zc / tan) + 1) * size / 2, (1 - dot(q, B.up) / zc / tan) * size / 2, zc]; };
  for (let t = 0; t < soup.count; t += 1) {
    const P = [toModel(t * 3), toModel(t * 3 + 1), toModel(t * 3 + 2)];
    const n = norm(cross([P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]], [P[2][0] - P[0][0], P[2][1] - P[0][1], P[2][2] - P[0][2]]));
    const mat = soup.material[t];
    const m = mat >= 0 ? r.scene.materials[mat] : undefined;
    let c = m ? [m.colour[0], m.colour[1], m.colour[2]] : [0.7, 0.7, 0.7];
    const vc = [0, 1, 2].map((k) => (soup.colours[t * 12 + k] + soup.colours[t * 12 + 4 + k] + soup.colours[t * 12 + 8 + k]) / 3);
    c = [c[0] * vc[0], c[1] * vc[1], c[2] * vc[2]];
    if (m?.texture) {
      const tu = (soup.uvs[t * 6] + soup.uvs[t * 6 + 2] + soup.uvs[t * 6 + 4]) / 3, tv = (soup.uvs[t * 6 + 1] + soup.uvs[t * 6 + 3] + soup.uvs[t * 6 + 5]) / 3;
      const tx = importer.sampleTexture(r.scene, m.texture.texture, tu, tv);
      c = [c[0] * tx[0], c[1] * tx[1], c[2] * tx[2]];
    }
    const k = 0.45 + 0.55 * Math.abs(dot(n, light));
    const rgb = [importer.linearToSrgb(c[0] * k) * 255, importer.linearToSrgb(c[1] * k) * 255, importer.linearToSrgb(c[2] * k) * 255];
    const s = P.map(project);
    if (s.some((q) => q[2] <= 0.01)) continue;
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const qx = x + 0.5, qy = y + 0.5;
      const w0 = ((s[1][0] - qx) * (s[2][1] - qy) - (s[2][0] - qx) * (s[1][1] - qy)) / area;
      const w1 = ((s[2][0] - qx) * (s[0][1] - qy) - (s[0][0] - qx) * (s[2][1] - qy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const zz = w0 * s[0][2] + w1 * s[1][2] + w2 * s[2][2];
      const i = y * size + x;
      if (zz >= zb[i]) continue;
      zb[i] = zz;
      img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
  }
  return img;
}
function srgbOf(importer, r, x, y, z) {
  const g = r.grid;
  const i = x + r.offset[0] + g.size[0] * (y + g.size[1] * (z + r.offset[2]));
  return [importer.linearToSrgb(g.colour[i * 3]) * 255, importer.linearToSrgb(g.colour[i * 3 + 1]) * 255, importer.linearToSrgb(g.colour[i * 3 + 2]) * 255];
}

/** An RGBA picture as a PNG, deflated by Node's zlib (the import's own encoder stores it raw). */
function pngOf(importer, { width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  const chunk = (type, body) => { const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(importer.crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0); return Buffer.concat([head, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Import a 3D file: the proposal, the op list that replays it, and the four views (source -> voxels -> parts -> body / worn). */
async function importFile({ bytes, name, voxels = 48, as = 'auto', size = 176 }) {
  const { importer, core } = await engine();
  const t0 = performance.now();
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = importer.importModel(input, { name, voxels, ...(as !== 'auto' ? { as } : {}) });
  const ms = Math.round(performance.now() - t0);
  const b = r.model.bounds();
  const across = b ? Math.max(b.max[0] - b.min[0] + 1, b.max[2] - b.min[2] + 1) * r.model.unit : 1;
  const cam = camFor(b ? (b.max[1] - b.min[1] + 1) * r.model.unit : 1, 0.62, across);
  const partIndex = new Map(r.proposal.parts.map((p, i) => [p.id, i]));
  const kindOf = new Map(r.proposal.parts.map((p) => [p.id, p.kind]));
  const png = (img) => `data:image/png;base64,${pngOf(importer, img).toString('base64')}`;
  const views = [
    { id: 'source', label: `${r.scene.format} source`, url: png(rasterSource(core, importer, r, size, cam)) },
    { id: 'voxels', label: `${r.model.count.toLocaleString()} voxels`, url: png(castVoxels(core, r.model, (x, y, z) => srgbOf(importer, r, x, y, z), size, cam)) },
    { id: 'parts', label: `${r.proposal.parts.length} parts`, url: png(castVoxels(core, r.model, (x, y, z) => { const g = r.model.groupAt(x, y, z); return g ? HUES[(partIndex.get(g) ?? 0) % HUES.length] : [90, 90, 90]; }, size, cam)) },
    { id: 'split', label: r.attributes.length ? `body / worn: ${r.attributes.map((a) => a.slot).join(' ')}` : `${r.proposal.kind}: all body`, url: png(castVoxels(core, r.model, (x, y, z) => { const g = r.model.groupAt(x, y, z); if (g && kindOf.get(g) === 'attribute') return HUES[(partIndex.get(g) ?? 0) % HUES.length]; const c = srgbOf(importer, r, x, y, z); const l = (c[0] + c[1] + c[2]) / 3; return [l * 0.55 + 40, l * 0.55 + 40, l * 0.55 + 48]; }, size, cam)) },
  ];
  const hues = Object.fromEntries(r.proposal.parts.map((p, i) => [p.id, HUES[i % HUES.length]]));
  return { name, ms, timings: clean(r.timings), proposal: clean(r.proposal), ops: clean(r.ops), hues, views, stats: { voxels: r.model.count, grid: [...r.grid.size], parts: r.proposal.parts.length, attributes: r.attributes.length, ops: r.ops.length, fitted: { prims: r.fitted.prims.length, iou: r.fitted.iou } } };
}

/** An engine sample (written in code by the import package): what the tests and the empty Import panel try. */
async function sample({ name = 'robot' }) {
  const { importer } = await engine();
  const s = importer.SAMPLES().find((item) => item.name === name);
  if (!s) throw new Error(`No sample ${name} (samples: ${importer.SAMPLES().map((item) => item.name).join(', ')}).`);
  const bytes = s.bytes ?? new TextEncoder().encode(s.text);
  return { name: s.name, format: s.format, bytes: new Uint8Array(bytes), options: clean(s.options ?? {}) };
}

// ---------------------------------------------------------------- the preview page

let page;
/** The preview document: builder-preview.mjs bundled with the engine's pixel renderer and baker (resolved to this checkout's source). */
async function preview() {
  if (page) return page;
  const entry = [join(dirname(new URL(import.meta.url).pathname), 'builder-preview.mjs'), join(workerData.sourceDir ?? '', 'builder-preview.mjs')].find((file) => file && existsSync(file));
  if (!entry) throw new Error('The builder preview script is missing from this build of the editor.');
  let esbuild;
  for (const from of [import.meta.url, pathToFileURL(join(root, 'package.json')).href]) { try { esbuild = createRequire(from)('esbuild'); break; } catch { /* Try the engine's own. */ } }
  if (!esbuild) throw new Error('The builder preview is bundled with esbuild, which this editor build could not find (a development feature, like the engine itself).');
  const plugin = { name: 'keel-engine-source', setup(b) { b.onResolve({ filter: /^@keel-engine\/[\w-]+$/ }, (a) => { const file = join(root, 'packages', a.path.slice('@keel-engine/'.length), 'src', 'index.ts'); return existsSync(file) ? { path: file } : undefined; }); } };
  const out = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, write: false, logLevel: 'silent', plugins: [plugin], legalComments: 'none' });
  const js = out.outputFiles[0].text.replaceAll('</script', '<\\/script');
  const css = 'html,body{margin:0;height:100%;background:#101018;overflow:hidden;color:#cfd3e6;font:11px ui-monospace,Menlo,monospace}#stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}#view,#overlay{position:absolute;image-rendering:pixelated}#overlay{pointer-events:none}#label{position:absolute;left:8px;bottom:6px;right:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#9aa0bb;pointer-events:none}#stats{position:absolute;right:8px;top:6px;color:#6f7590;pointer-events:none}';
  page = `<!doctype html><meta charset="utf-8"><title>KEEL builder preview</title><style>${css}</style><div id="stage"><canvas id="view"></canvas><canvas id="overlay"></canvas></div><div id="stats"></div><div id="label"></div><script>${js}</script>`;
  return page;
}

const operations = { open, apply, state, frame, close, validate, reference, variants, variantOps, poses, exportPack, loadPack, importFile, sample, preview };
parentPort.on('message', async ({ id, op, input }) => {
  try {
    const run = operations[op];
    if (!run) throw new Error(`Unknown builder operation ${op}.`);
    parentPort.postMessage({ id, result: await run(input ?? {}, id) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error).slice(0, 4000), ...(error?.code ? { code: error.code } : {}) });
  }
});
