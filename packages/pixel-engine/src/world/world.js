// The world runtime: everything a game used to wire by hand -- entities that
// move (a src/entity spec, a physics body, an animator), objects that don't
// (src/object instances), rails, water, a camera, input, particles -- held in
// one place and stepped by SYSTEMS in a fixed order on a fixed step:
//
//   input (0) -> control (100) -> physics (200) -> animation (300)
//             -> particles (400) -> camera (500) -> custom (600 unless told)
//
// Settings are layered and lockable (src/world/settings.js, over
// src/scene/config.js): engine -> project -> scene -> seed -> tag -> id ->
// runtime, and a lock at any scope beats everything after it -- the palette
// for a scene, one bench's material, gravity, the camera mode, a species.
//
// Rendering is separate. world.frame() returns what a renderer takes (boxes,
// capsules, particles, view, palette, materials, style) as plain data, so the
// simulation runs headless in Node; world.draw(renderer) hands it to
// src/gpu/pixel-renderer.js.
//
//   const world = createWorld({ seed: "7", width: 128, height: 128, config: { project: {...} }, materials, palettes });
//   world.generate((g) => { g.place("bench", { id: "bench-1", pos: [0, 5, 0], on: "auto" }); g.spawn({ id: "cat-1", kind: "animal" }); });
//   world.system("spin", { order: 650, step(w, dt) { ... } });
//   world.simulate(10); const snap = world.snapshot(); world.restore(snap);
//   world.draw(renderer);   // in a browser

import { createSettings, parseLocks } from "./settings.js";
import { ENGINE_DEFAULTS } from "./defaults.js";
import { RULE_KEYS, resolveRules, targetRules as defaultRules } from "./rules.js";
import { namedStream, worldSeed } from "./streams.js";
import { baseRecipes, createWorldParticles } from "./particles.js";
import { loadCamera, saveCamera } from "./camera-state.js";
import { boxDistance, createCharacter } from "../physics/character.js";
import { animator, entityOf, posed, skinOf } from "../entity/index.js";
import { clearance, createCamera, fillForTarget, frameView, sphereCast, subjectOf } from "../camera/camera.js";
import { createInput } from "../input/input.js";
import { placeObject, settle, worldAabb, worldColliders, worldRails } from "../object/object.js";
import { buildPieceFrom, PIECE_KEYS } from "../object/catalogue.js";
import { rampForTarget } from "../core/palette.js";
import { FX_NAMES } from "../fx/fx.js";

/**
 * What the GPU renderer holds (src/gpu/shaders.js MAX_BOXES, MAX_CAPS,
 * MAX_RAMPS, MAX_MATERIALS -- tests/world.test.mjs checks they agree). Kept
 * here so the simulation never imports GPU code; createWorld({ budget }) overrides.
 */
export const RENDER_BUDGET = Object.freeze({ boxes: 256, capsules: 256, ramps: 256, materials: 255 });

export const SYSTEM_ORDER = Object.freeze({ input: 0, control: 100, physics: 200, animation: 300, particles: 400, camera: 500, custom: 600 });

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const IDLE = Object.freeze({ move: [0, 0], jump: false, hold: false });
// (FNV-1a over a string: a short digest for layouts and snapshots.)
const digest = (text) => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16).padStart(8, "0"); };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// The body fields a snapshot keeps (everything createCharacter's body carries but its step and events).
const bodyFields = (b) => Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== "events" && typeof v !== "function").map(([k, v]) => [k, clone(v)]));

/** The physics tuning an entity gets unless it brings its own: four legs walk and trot, and never wall-run or grind. */
export function tuningFor(spec) {
  if (spec.plan !== "quadruped") return {};
  const sh = spec.body.shoulderH;
  return { runSpeed: Math.min(7, Math.max(1.6, sh * 9)), runAccel: 20, jump: 0, wallMin: 1e9, railSnap: -1, radius: Math.min(0.32, Math.max(0.1, spec.body.bodyR * 1.3)) };
}

/**
 * createWorld(options) -> world
 *   seed            anything (hex bytes32 kept; other text derived)
 *   width, height   the target size (32x32 ... 256x256 or any W x H)
 *   step            the fixed simulation step (1/120 s)
 *   config          { engine, project, scene, runtime, "tag:<t>", "id:<id>", locks }: flat maps
 *                   of settings per scope (engine merges over ENGINE_DEFAULTS); `locks`
 *                   a "scope/key=value;..." string (settings.js parseLocks), applied last
 *   materials       [{ name, ramp, light, pattern, glow }] -- the renderer's 16 slots,
 *                   by index (the GPU shader reads 4 as water and 5 as sky)
 *   palettes        { name: (world, rules) => ({ ramps: { rampName: [[r,g,b], ...] } }) }
 *   rules           (w, h) -> target rules (default: src/world/rules.js targetRules)
 *   input           createInput options, or an input to use
 *   camera          createCamera options (mode, orbit/chase/frame rig options ...)
 *   particles       { max, recipes }
 *   budget          { boxes, capsules, ramps } the renderer holds (RENDER_BUDGET)
 */
export function createWorld({ seed = "1", width = 128, height = 128, step = 1 / 120, config = {}, materials = [], palettes = {}, rules = defaultRules, input = {}, camera = {}, particles = {}, budget = RENDER_BUDGET } = {}) {
  const { boxes: MAX_BOXES, capsules: MAX_CAPS, ramps: MAX_RAMPS, materials: MAX_MATS } = { ...RENDER_BUDGET, ...budget };
  if (materials.length > MAX_MATS) throw new RangeError(`${materials.length} materials: the renderer holds ${MAX_MATS}.`);
  const hexSeed = worldSeed(seed);
  const cfgIn = typeof config === "string" ? { locks: config } : config;
  const settings = createSettings({
    engine: { ...ENGINE_DEFAULTS, ...(cfgIn.engine ?? {}) },
    project: cfgIn.project ?? {},
    scene: cfgIn.scene ?? {},
    runtime: cfgIn.runtime ?? {},
    scopes: Object.fromEntries(Object.entries(cfgIn).filter(([k]) => /^(tag|id):/.test(k))),
  });

  const entities = new Map();
  const objects = new Map();
  const systems = new Map();
  const handlers = new Map();
  const brains = new Map();
  const fxPasses = new Map();
  const rngs = new Map();
  const warned = new Set();
  const boxes = []; // (one array for the whole run: bodies and the camera hold it, so it's refilled in place)
  const rails = [];
  let objectsVersion = 0;
  let boxesKey = "";
  let paletteVersion = 0;
  let registration = 0;
  let acc = 0;
  let cam = null;
  let camBase = null;
  let driver = null;
  let log = null;

  const inputDev = typeof input?.sample === "function" ? input : createInput({ idle: 8, ...input });
  const matIndex = new Map(materials.map((m, i) => [m.name, i]));

  const world = {
    seed: String(seed),
    hexSeed,
    dt: step,
    time: 0,
    steps: 0,
    width,
    height,
    settings,
    entities,
    objects,
    rails,
    boxes,
    materials,
    palettes,
    input: inputDev,
    /** Plain data a system keeps between steps (saved by snapshot). */
    state: {},
    /** This step's intents from the input system: { move, axes, look, jump, hold, sprint, driver, player }. */
    intent: { ...IDLE, look: [0, 0], player: false, driver: "autopilot" },
    /** The entity the input drives (when a player is driving) and the camera follows. */
    player: null,
    focus: null,
    generator: null,
    warnings: [],
    /** Where each generated object came to rest: { id: { support, rests, gap } }. */
    rests: {},
    get camera() { return cam; },
    get boxesVersion() { return boxesKey; },
  };
  settings.useTags((id) => entities.get(id)?.tags ?? objects.get(id)?.tags ?? []);

  const warn = (msg) => { if (!warned.has(msg)) { warned.add(msg); world.warnings.push(msg); } };

  // ------------------------------------------------------------ settings

  Object.assign(world, {
    /** A setting, resolved for a thing (an id or { id, tags }) or the world. */
    get: (key, thing = null, fallback = undefined) => settings.get(key, thing, fallback),
    set: (scope, key, value, opts = {}) => settings.set(scope, key, value, opts),
    lock: (scope, key, value, opts = {}) => settings.lock(scope, key, value, opts),
    unlock: (scope, key) => settings.unlock(scope, key),
    unset: (scope, key, opts = {}) => settings.unset(scope, key, opts),
    /** Who set `path` and who locked it (for a thing or the world), and what the target rules made of "auto". */
    explain(path, thing = null) {
      const ex = settings.explain(path, thing);
      const ruleName = Object.entries(RULE_KEYS).find(([, k]) => k === path)?.[0];
      if (ruleName) {
        const r = world.rules;
        ex.effective = r[ruleName];
        ex.rule = r.from[ruleName] === "auto" ? `auto: targetRules(${world.width}x${world.height}).${ruleName} = ${r[ruleName]}` : `set: ${path}`;
      }
      return ex;
    },
    /** Apply "scope/key=value;..." locks (src/world/settings.js parseLocks). Returns the refusals. */
    applyLocks(text) {
      const out = [];
      for (const l of parseLocks(text)) {
        const r = l.lock ? settings.lock(l.scope, l.key, l.value) : settings.set(l.scope, l.key, l.value);
        if (r.ok === false) out.push(r);
      }
      return out;
    },
  });
  if (cfgIn.locks) world.applyLocks(cfgIn.locks);

  // ------------------------------------------------------------ target rules

  let rulesKey = "";
  let rulesCache = null;
  Object.defineProperty(world, "rules", {
    /** The target rules for this size, with the settings' overrides (see rules.js). */
    get() {
      const key = `${world.width}x${world.height}|${settings.version}`;
      if (key !== rulesKey) { rulesCache = resolveRules(rules(world.width, world.height), (k) => settings.get(k)); rulesKey = key; }
      return rulesCache;
    },
  });
  world.setTarget = (w, h = w) => {
    world.width = Math.max(8, w | 0);
    world.height = Math.max(8, h | 0);
    cam?.setTarget(world.width, world.height);
    return world;
  };

  // ------------------------------------------------------------ streams, events

  /** A seeded stream by name that snapshots save (src/world/streams.js). */
  world.rng = (name) => {
    let S = rngs.get(name);
    if (!S) { S = namedStream(hexSeed, `rng:${name}`); rngs.set(name, S); }
    return S;
  };
  /** Listen for an event ("landed", "jumped", "spawned", "generated", ... or "*"). Returns off(). */
  world.on = (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  };
  world.off = (type, fn) => { handlers.get(type)?.delete(fn); };
  /** Tell the listeners. (Events are synchronous, in the step that raised them.) */
  world.emit = (type, data = {}) => {
    const ev = { type, time: world.time, step: world.steps, ...data };
    for (const fn of handlers.get(type) ?? []) fn(ev, world);
    for (const fn of handlers.get("*") ?? []) fn(ev, world);
    return ev;
  };

  // ------------------------------------------------------------ systems

  /**
   * world.system(name, { order, step(world, dt), enabled, save?, load? }) registers
   * (or replaces) a system; world.system(name) returns it. `enabled` is the
   * default -- the setting system.<name>.enabled, when set, wins (and can be locked).
   */
  world.system = (name, def) => {
    if (def === undefined) return systems.get(name) ?? null;
    if (typeof def.step !== "function") throw new TypeError(`System ${name} needs step(world, dt).`);
    const prev = systems.get(name);
    systems.set(name, { name, order: def.order ?? SYSTEM_ORDER.custom, step: def.step, enabled: def.enabled ?? true, save: def.save, load: def.load, at: prev?.at ?? registration++ });
    return world;
  };
  world.removeSystem = (name) => systems.delete(name);
  /** Is a system on? (Its setting, else its own flag.) */
  world.enabled = (name) => {
    const v = settings.get(`system.${name}.enabled`);
    return typeof v === "boolean" ? v : Boolean(systems.get(name)?.enabled);
  };
  /** Turn a system on or off at a scope (runtime by default); refused under a lock. */
  world.enable = (name, on = true, scope = "runtime") => settings.set(scope, `system.${name}.enabled`, Boolean(on));
  /** The systems in the order they run: [{ name, order, enabled }]. */
  world.systems = () => [...systems.values()].sort((a, b) => a.order - b.order || a.at - b.at).map((s) => ({ name: s.name, order: s.order, enabled: world.enabled(s.name) }));

  /** A brain: (world, entity, dt) -> intent { move: [x, z], jump, hold }. Entities name theirs. */
  world.brain = (name, fn) => { brains.set(name, fn); return world; };
  /**
   * A world fx pass, by name: { frame?(f, world) -> f } changes the renderer's
   * inputs (the sun, the fog, a material's glow), { draw?(renderer, f, world) }
   * runs after it draws. Names in "render.fx" that aren't the world's go to
   * the renderer's own passes (src/fx: glow, fog, vignette, scanlines ...).
   */
  world.fx = (name, pass) => { fxPasses.set(name, typeof pass === "function" ? { frame: pass } : pass); return world; };
  /** Drive the input system with a function (world, dt) -> intent instead of the devices (tests, replays, bots); null gives it back. */
  world.drive = (fn) => { driver = fn; return world; };
  /** Record every step's intent (for replays): world.record() starts, world.record(false) stops and returns the log. */
  world.record = (on = true) => { if (on) { log = []; return world; } const out = log; log = null; return out; };
  /** Replay a recorded log: its intents feed the input system, one a step. */
  world.replay = (list) => { let i = 0; return world.drive(() => list[Math.min(i++, list.length - 1)] ?? IDLE); };

  // ------------------------------------------------------------ objects

  /** Put an object in the world: a definition (src/object defineObject / catalogue) at { id, pos, yaw, scale, tags }. */
  world.place = (def, { id, pos = [0, 0, 0], yaw = 0, scale = 1, tags = [] } = {}) => {
    if (!id) throw new TypeError("world.place needs an id (ids are how settings find things).");
    if (objects.has(id) || entities.has(id)) throw new Error(`Two things are called ${id}.`);
    const inst = placeObject(def, { id, pos, yaw, scale, tags });
    objects.set(id, inst);
    objectsVersion += 1;
    return inst;
  };
  /** Replace an object's instance (moved, settled). */
  world.replaceObject = (inst) => { objects.set(inst.id, inst); objectsVersion += 1; return inst; };
  world.remove = (id) => {
    if (objects.delete(id)) objectsVersion += 1;
    entities.delete(id);
    if (world.player === id) world.player = null;
    if (world.focus === id) world.focus = null;
  };
  /** Rails beyond the objects' own (polylines for the bodies). */
  world.addRail = (line) => { world.extraRails.push(line.map((p) => [...p])); objectsVersion += 1; };
  world.extraRails = [];

  // The physics boxes and rails: every object whose "collide" is on. Refilled in place when anything changes.
  function syncSolids() {
    const key = `${objectsVersion}|${settings.version}`;
    if (key === boxesKey) return;
    boxesKey = key;
    boxes.length = 0;
    rails.length = 0;
    for (const inst of objects.values()) {
      if (settings.get("collide", inst) === false) continue;
      for (const b of worldColliders(inst)) boxes.push({ ...b, mat: 0, id: inst.id });
      rails.push(...worldRails(inst));
    }
    rails.push(...world.extraRails);
  }
  world.syncSolids = syncSolids;

  // ------------------------------------------------------------ entities

  // A thing's material name, through its settings: its main material (the
  // first part's), or mat.<name> for any other.
  function matNameFor(thing, name, primary) {
    if (name === primary) { const m = settings.get("material", thing); if (m) return m; }
    const alias = settings.get(`mat.${name}`, thing);
    return alias ?? name;
  }
  /** A material's renderer index by name (numbers pass through; unknown names warn and use 0). */
  world.mat = (name) => {
    if (typeof name === "number") return name;
    const i = matIndex.get(name);
    if (i === undefined) { warn(`No material "${name}" in the world's table.`); return 0; }
    return i;
  };

  /**
   * world.spawn({ id, kind, tags, seed, species, pins, size, pos, yaw, brain, materials, body, tuning })
   * -> an entity. Its species, pins and size come through the settings first
   * (a lock on "tag:animal"/"species" forces a cat); the rest from its own seed
   * (deriveSeed(world seed, "entity:" + id) unless given), so one entity's
   * lock never moves another's choices.
   *   materials   { role: material name } (fur, furAlt, cloth, clothAlt, accent, dark, blush, hair)
   *   body        false: no physics (moved by its intent, through nothing)
   *   brain       a world.brain name: what drives it when the player isn't
   */
  world.spawn = (o) => {
    const { id } = o;
    if (!id) throw new TypeError("world.spawn needs an id.");
    if (objects.has(id) || entities.has(id)) throw new Error(`Two things are called ${id}.`);
    const tags = [...new Set(o.tags ?? [])].sort();
    const thing = { id, tags };
    const make = { seed: o.seed ?? `${hexSeed}|entity:${id}`, kind: o.kind ?? "animal" };
    // The species is a generated choice like any other: the seed's own pick (entityOf's, from the
    // entity's seed) is PROPOSED, so a lock -- or a tag's or the id's own setting -- wins, and
    // explain() shows what the seed would have chosen under it. (o.species is the caller's pin.)
    const natural = o.species ?? entityOf(make.seed, { kind: make.kind }).species;
    const species = settings.propose("species", natural, thing);
    const pins = { ...(o.pins ?? {}), ...settings.section("pins", thing) };
    const size = settings.get("size", thing) ?? o.size;
    make.species = species;
    if (Object.keys(pins).length) make.pins = pins;
    if (size !== undefined && size !== null) make.size = size;
    let spec;
    try { spec = entityOf(make.seed, make); } catch (e) {
      const ex = settings.explain("species", thing);
      throw new RangeError(`${id}: ${e.message} (species from ${ex.layer ?? "its seed"}${ex.locked ? `, locked at ${ex.lockedAt}` : ""}).`);
    }
    const ent = {
      kind: "entity", id, tags, make, spec,
      anim: animator(spec),
      materials: { ...(o.materials ?? {}) },
      brain: o.brain ?? null,
      mind: clone(o.mind ?? {}),
      intent: { ...IDLE },
      hold: null,
      frozen: false,
      hasBody: o.body !== false,
      tuning: { ...tuningFor(spec), ...(o.tuning ?? {}) },
      body: null,
      bodyKey: "",
      size: sizeOf(spec),
    };
    ent.body = makeBody(ent, o.pos ?? [0, 0, 0], o.yaw ?? 0);
    entities.set(id, ent);
    if (o.player) world.player = id;
    world.emit("spawned", { id });
    return ent;
  };

  // How tall and wide an entity stands (from its idle pose): the camera's subject.
  function sizeOf(spec) {
    const caps = skinOf(spec, posed(spec, "idle"));
    let y1 = 0; let r = 0;
    for (const c of caps) {
      y1 = Math.max(y1, c.a[1] + c.r, c.b[1] + c.r);
      r = Math.max(r, Math.hypot(c.a[0], c.a[2]) + c.r, Math.hypot(c.b[0], c.b[2]) + c.r);
    }
    return { height: y1, radius: Math.min(r, y1 * 0.6) };
  }

  function bodyKeyOf(ent) {
    return JSON.stringify([settings.get("system.physics.gravity", ent), settings.get("system.physics.waterY", ent), settings.get("collide", ent) !== false]);
  }
  function makeBody(ent, pos, yaw, keep = null) {
    ent.bodyKey = bodyKeyOf(ent);
    if (!ent.hasBody) {
      return keep ? { ...clone(keep), events: [] } : { pos: [...pos], vel: [0, 0, 0], facing: yaw, mode: "ground", events: [] };
    }
    const tuning = { ...ent.tuning, gravity: settings.get("system.physics.gravity", ent) };
    const b = createCharacter({ boxes: settings.get("collide", ent) === false ? [] : boxes, rails, waterY: settings.get("system.physics.waterY", ent), spawn: [...pos], tuning });
    b.facing = yaw;
    b.mode = "ground";
    if (keep) for (const [k, v] of Object.entries(keep)) b[k] = clone(v);
    return b;
  }
  /** Move an entity (a teleport: its body keeps its mode, loses its speed). */
  world.teleport = (id, pos, yaw) => {
    const ent = entities.get(id);
    ent.body.pos = [...pos];
    ent.body.vel = [0, 0, 0];
    if (yaw !== undefined) ent.body.facing = yaw;
  };

  // ------------------------------------------------------------ the default systems

  world.system("input", {
    order: SYSTEM_ORDER.input,
    step(w, dt) {
      const it = driver ? driver(w, dt) : inputDev.sample(dt, cam ? cam.yaw : 0);
      w.intent = { move: [0, 0], axes: [0, 0], look: [0, 0], jump: false, hold: false, sprint: false, driver: "player", player: true, ...it };
      if (log) log.push(clone(w.intent));
    },
  });

  world.system("control", {
    order: SYSTEM_ORDER.control,
    step(w, dt) {
      for (const ent of entities.values()) {
        if (settings.get("static", ent) === true) { ent.intent = { ...IDLE }; continue; }
        if (ent.id === w.player && w.intent.player) {
          // (The player takes over: whatever the brain had it holding -- a seat, a pose -- lets go.)
          if (ent.frozen || ent.hold) { ent.frozen = false; ent.hold = null; ent.mind = {}; w.emit("takeover", { id: ent.id }); }
          ent.intent = { move: w.intent.move, jump: w.intent.jump, hold: w.intent.hold };
        }
        else if (ent.brain && brains.has(ent.brain)) ent.intent = { ...IDLE, ...(brains.get(ent.brain)(w, ent, dt) ?? IDLE) };
        else ent.intent = { ...IDLE };
      }
    },
  });

  world.system("physics", {
    order: SYSTEM_ORDER.physics,
    step(w, dt) {
      syncSolids();
      for (const ent of entities.values()) {
        if (ent.frozen || settings.get("static", ent) === true) { ent.body.vel = [0, 0, 0]; continue; }
        if (bodyKeyOf(ent) !== ent.bodyKey) ent.body = makeBody(ent, ent.body.pos, ent.body.facing, bodyFields(ent.body));
        if (!ent.hasBody) {
          // (No physics: it goes where its intent says, at its tuning's speed, through everything.)
          const sp = ent.tuning.runSpeed ?? 3;
          ent.body.vel = [ent.intent.move[0] * sp, 0, ent.intent.move[1] * sp];
          ent.body.pos = [ent.body.pos[0] + ent.body.vel[0] * dt, ent.body.pos[1], ent.body.pos[2] + ent.body.vel[2] * dt];
          if (Math.hypot(ent.body.vel[0], ent.body.vel[2]) > 0.05) ent.body.facing = Math.atan2(ent.body.vel[0], ent.body.vel[2]);
          continue;
        }
        ent.body.step(dt, ent.intent);
        for (const e of ent.body.events) w.emit(e.type, { ...e, id: ent.id });
      }
    },
  });

  world.system("animation", {
    order: SYSTEM_ORDER.animation,
    step(w, dt) {
      for (const ent of entities.values()) {
        const want = ent.hold ? JSON.stringify(ent.hold) : "";
        if (want !== (ent.heldKey ?? "")) {
          if (ent.hold) ent.anim.hold(ent.hold.clip, ent.hold.params ?? {}); else ent.anim.release();
          ent.heldKey = want;
        }
        ent.anim.step(dt, ent.body);
      }
    },
  });

  let parts = null;
  world.system("particles", {
    order: SYSTEM_ORDER.particles,
    step(w, dt) { parts.max = settings.get("system.particles.max") ?? 600; parts.step(dt); },
  });

  world.system("camera", {
    order: SYSTEM_ORDER.camera,
    step(w, dt) {
      const subject = cameraSubject();
      if (!subject) return;
      cam.setMode(cameraMode(), { blend: 0.35 });
      const r = w.rules;
      cam.rigs.chase.opt.distance = camBase.chase * r.arm;
      cam.rigs.orbit.opt.distance = camBase.orbit * r.arm;
      const cw = cameraWorld(subject);
      if (cam.mode === "frame") aimFrame(subject, cw, dt);
      cam.step(dt, subject, cw, w.intent);
      if (r.from.fov !== "auto") cam.fov = r.fov;
    },
  });

  // What the camera must keep out of: the solids -- but not one the subject is
  // IN (sat on a bench: its feet are inside the seat's footprint and the seat
  // rises round it; the camera's arm starts from the subject's middle, and
  // would never leave). A box under its feet (a crate it stands on) stays.
  function cameraWorld(s) {
    const inside = boxes.filter((b) => b.c[1] + b.h[1] > s.pos[1] + 0.05 && b.c[1] - b.h[1] < s.pos[1] + s.height && boxDistance([s.pos[0], b.c[1], s.pos[2]], b).d < 0);
    return inside.length ? { boxes: boxes.filter((b) => !inside.includes(b)) } : { boxes };
  }

  // Frame shots show a FRONT -- but a thing facing a hedge from a step away has
  // no room in front of it, and a small one beside a wall has its middle
  // closer to the wall than the camera arm's radius (the rig's own collision
  // would fold the shot into it). So the world aims frame shots itself: every
  // quarter second it tries the three-quarter view on either side, wider,
  // then square on, and takes the first whose eye has room and sees the
  // subject (its middle, top and sides) -- the rig eases there, uncollided.
  function aimFrame(s, cw, dt) {
    const st = world.state.camera ?? (world.state.camera = { at: 0, index: 0 });
    st.aimIn = (st.aimIn ?? 0) - dt;
    if (st.aimIn > 0 && st.aimFor === st.showing) return;
    st.aimIn = 0.25;
    st.aimFor = st.showing;
    const rig = cam.rigs.frame;
    const base = Math.abs(camera.frame?.turn ?? 0.45) || 0.45;
    const fill = rig.opt.fill ?? fillForTarget(cam.width, cam.height);
    const b = s.bounds;
    const mid = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const marks = [mid, [mid[0], b[4], mid[2]], [b[0], mid[1], mid[2]], [b[3], mid[1], mid[2]], [mid[0], mid[1], b[2]], [mid[0], mid[1], b[5]]];
    const seen = (from, to) => { const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) || 1; return sphereCast(cw, from, to, 0.02) / d >= 0.97; };
    let best = null;
    for (const t of [rig.turn, base, -base, base * 1.8, -base * 1.8, 0]) {
      const v = frameView(s, { turn: t, elevation: rig.opt.elevation, fov: cam.baseFov, aspect: cam.aspect, fill });
      const room = Math.min(1, clearance(cw, v.eye) / rig.opt.radius);
      const score = (room >= 1 ? 1 : room * 0.5) * (marks.filter((p) => seen(v.eye, p)).length / marks.length);
      if (!best || score > best.score + 0.02) best = { t, score };
      if (score >= 0.99) break;
    }
    // (A new subject or a new side is a cut, not a swing: an eased swing can pass through a hedge.)
    if (best.t !== rig.turn || st.cutFor !== st.showing) { rig.eye = null; rig.target = null; st.cutFor = st.showing; }
    rig.turn = best.t;
  }

  function cameraMode() {
    const m = settings.get("system.camera.mode");
    if (!m || m === "auto") return world.intent.player && world.player ? "orbit" : "chase";
    return m;
  }
  // Who the camera watches: in frame mode, each entity in turn; else the focus, the player, or the first.
  function cameraSubject() {
    const mode = cameraMode();
    let id = world.focus ?? world.player ?? entities.keys().next().value;
    if (mode === "frame") {
      const tag = settings.get("system.camera.frameTag");
      const list = [...entities.values()].filter((e) => !tag || e.tags.includes(tag)).map((e) => e.id).sort();
      if (list.length) {
        const cyc = world.state.camera ?? (world.state.camera = { at: 0, index: 0 });
        cyc.at += world.dt;
        if (cyc.at >= (settings.get("system.camera.cycle") ?? 4)) { cyc.at = 0; cyc.index += 1; }
        id = list[cyc.index % list.length];
        world.state.camera.showing = id;
      }
    }
    const ent = entities.get(id);
    if (!ent) return null;
    return subjectFor(ent, mode === "frame");
  }
  /** The camera's subject for an entity: its body, height, radius -- and, for frame shots, its bounds. */
  function subjectFor(ent, withBounds = false) {
    // (At least 0.6 tall to the camera: its arm starts from the subject's middle, and a cat's middle is
    // closer to the ground than the arm's radius -- the arm would never leave it.)
    const s = subjectOf(ent.body, { height: Math.max(0.6, ent.size.height), radius: ent.size.radius });
    if (withBounds) {
      const caps = ent.anim.capsules(roleTable(ent));
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const c of caps) for (const p of [c.a, c.b]) for (let k = 0; k < 3; k += 1) { b[k] = Math.min(b[k], p[k] - c.r); b[k + 3] = Math.max(b[k + 3], p[k] + c.r); }
      s.bounds = b;
    }
    return s;
  }
  world.subjectFor = subjectFor;

  function newCamera() {
    // (Frame shots are aimed by the world -- aimFrame -- so the rig itself doesn't collide, unless asked.)
    cam = createCamera({ mode: "chase", width: world.width, height: world.height, ...camera, frame: { collide: false, ...(camera.frame ?? {}) } });
    camBase = { chase: cam.rigs.chase.opt.distance, orbit: cam.rigs.orbit.opt.distance };
  }

  function resetRuntime() {
    newCamera();
    parts = createWorldParticles({ max: settings.get("system.particles.max") ?? 600, recipes: { ...baseRecipes(), ...(particles.recipes ?? {}) }, stream: () => world.rng("particles") });
    world.particles = parts;
  }
  resetRuntime();

  // ------------------------------------------------------------ stepping

  /** One fixed step through every enabled system, in order. */
  function stepOnce() {
    for (const s of [...systems.values()].sort((a, b) => a.order - b.order || a.at - b.at)) if (world.enabled(s.name)) s.step(world, world.dt);
    world.time += world.dt;
    world.steps += 1;
  }
  /**
   * world.step() runs one fixed step. world.step(dt) adds real time (capped at
   * 0.1 s) and runs as many fixed steps as fit; it returns how many ran.
   */
  world.step = (dt) => {
    if (dt === undefined) { stepOnce(); return 1; }
    acc += Math.min(Math.max(0, dt), 0.1);
    let n = 0;
    while (acc >= world.dt - 1e-12) { stepOnce(); acc -= world.dt; n += 1; }
    return n;
  };
  /** Run `sec` seconds of fixed steps (no drawing). */
  world.simulate = (sec) => { const n = Math.round(sec / world.dt); for (let i = 0; i < n; i += 1) stepOnce(); return world; };

  // ------------------------------------------------------------ generation

  /**
   * world.generate(generator): clear the world and let the generator build it.
   * `generator` is (g, world) => void or { name, build(g, world) }. The seed's
   * earlier choices are forgotten first (locks and every other scope stay),
   * so the same seed and the same locks build the same world.
   */
  world.generate = (generator) => {
    settings.clearSeed();
    entities.clear();
    objects.clear();
    world.extraRails = [];
    objectsVersion += 1;
    rngs.clear();
    world.state = {};
    world.rests = {};
    world.warnings.length = 0;
    warned.clear();
    world.time = 0;
    world.steps = 0;
    world.player = null;
    world.focus = null;
    acc = 0;
    resetRuntime();
    const build = typeof generator === "function" ? generator : generator.build;
    build(makeGen(), world);
    world.generator = generator;
    paletteVersion += 1;
    syncSolids();
    world.emit("generated", { name: generator.name ?? null });
    return world;
  };

  // The generator's toolkit: lockable choices, streams, pieces, placing and settling.
  function makeGen() {
    const pickFor = (key, thing) => namedStream(hexSeed, `choose:${thing == null ? "" : typeof thing === "string" ? thing : thing.id}:${key}`);
    const g = {
      seed: hexSeed,
      world,
      /** A raw stream for layout draws nothing locks (its own name, its own numbers). */
      stream: (label) => namedStream(hexSeed, `gen:${label}`),
      /** A lockable choice among options (weights optional): the seed's pick unless a setting says otherwise. */
      choose(key, options, { thing = null, weights = null } = {}) {
        const S = pickFor(key, thing);
        const rolled = weights ? S.weighted(options.map((o, i) => [o, weights[i]])) : S.pick(options);
        return settings.propose(key, rolled, thing);
      },
      int(key, a, b, { thing = null } = {}) { return settings.propose(key, pickFor(key, thing).int(a, b), thing); },
      between(key, a, b, { thing = null } = {}) { return settings.propose(key, pickFor(key, thing).between(a, b), thing); },
      chance(key, p, { thing = null } = {}) { return settings.propose(key, pickFor(key, thing).chance(p), thing); },
      /**
       * A catalogue piece's definition for a thing: its own stream (so pieces
       * never share draws), its sizes from ctx, then from the thing's
       * "piece.<size>" settings (lock one bench's width).
       */
      piece(key, { id, ctx = {}, tags = [] } = {}) {
        if (!PIECE_KEYS.includes(key)) throw new RangeError(`No piece ${key} (${PIECE_KEYS.join(", ")}).`);
        const thing = { id, tags };
        return buildPieceFrom(key, namedStream(hexSeed, `piece:${id}`), { ...ctx, ...settings.section("piece", thing) });
      },
      /**
       * Place a definition (or a catalogue key) and, with `on`, settle it onto
       * its supports: "auto" (everything placed so far and the ground at y 0),
       * or a list (instances, boxes, numbers for floors). Returns the instance.
       */
      place(defOrKey, { id, pos = [0, 0, 0], yaw = 0, scale = 1, tags = [], ctx = {}, on = null } = {}) {
        const def = typeof defOrKey === "string" ? g.piece(defOrKey, { id, ctx, tags }) : defOrKey;
        let inst = world.place(def, { id, pos, yaw, scale, tags });
        if (on) {
          // ("auto": lifted high, then dropped onto the highest thing under it -- or the ground.)
          const supports = on === "auto" ? [...[...objects.values()].filter((o) => o.id !== id), 0] : on;
          const r = settle(on === "auto" ? placeObject(def, { id, pos: [pos[0], 1e3, pos[2]], yaw, scale, tags }) : inst, supports);
          // (Placed again where it settled: object.js movedObject drops the instance's own tags.)
          inst = world.replaceObject(placeObject(def, { id, pos: r.instance.transform.pos, yaw, scale, tags }));
          world.rests[id] = { support: r.support, rests: r.rests, gap: r.gap };
        }
        return inst;
      },
      /**
       * Would a definition fit at pos/yaw? Its world AABB (grown by `margin`
       * across the ground) against every placed object's, ignoring floors (tag
       * "floor" or "ground") and anything in `ignore`. Give pos[1] the height it
       * will stand at (a lamp's arm clears a bench below it); `flat: true`
       * checks the ground plan only.
       */
      fits(def, { pos = [0, 0, 0], yaw = 0, scale = 1, margin = 0.1, ignore = [], flat = false } = {}) {
        const a = worldAabb(placeObject(def, { id: "_probe", pos, yaw, scale }));
        for (const o of objects.values()) {
          if (ignore.includes(o.id) || o.tags.includes("floor") || o.tags.includes("ground")) continue;
          const b = worldAabb(o);
          const ys = flat || (a[1] < b[4] && a[4] > b[1]);
          if (ys && a[0] - margin < b[3] && a[3] + margin > b[0] && a[2] - margin < b[5] && a[5] + margin > b[2]) return false;
        }
        return true;
      },
      spawn: (o) => world.spawn(o),
      /** Note something the generator couldn't do (4 benches asked, 3 fit): world.warnings. */
      warn,
    };
    return g;
  }

  // ------------------------------------------------------------ the frame

  const roleTable = (ent) => {
    const out = {};
    for (const [role, name] of Object.entries(ent.materials)) out[role] = world.mat(matNameFor(ent, name, null));
    return out;
  };

  let bakeKey = "";
  let bakeCache = null;
  function bakeObjects() {
    const key = `${objectsVersion}|${settings.version}`;
    if (key === bakeKey) return bakeCache;
    const out = { boxes: [], capsules: [] };
    for (const inst of objects.values()) {
      if (settings.get("show", inst) === false) continue;
      const primary = inst.def.parts[0]?.mat;
      const { pos, yaw, scale } = inst.transform;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const W = (p) => [pos[0] + (p[0] * c + p[2] * s) * scale, pos[1] + p[1] * scale, pos[2] + (-p[0] * s + p[2] * c) * scale];
      for (const p of inst.def.parts) {
        if (p.render === false || !p.prim) continue;
        const mat = world.mat(matNameFor(inst, p.mat, primary));
        if (p.prim.type === "box") out.boxes.push({ c: W(p.prim.c), h: p.prim.h.map((v) => v * scale), yaw: yaw + (p.prim.yaw ?? 0), mat, id: inst.id });
        else out.capsules.push({ a: W(p.prim.a), b: W(p.prim.b), r: p.prim.r * scale, mat, id: inst.id });
      }
    }
    bakeKey = key;
    bakeCache = out;
    return out;
  }

  let palKey = "";
  let palCache = null;
  function paletteFor(r) {
    let name = settings.get("render.palette");
    if (!palettes[name]) {
      const first = Object.keys(palettes)[0];
      if (name && name !== "default" && first) warn(`No palette "${name}"; using "${first}".`);
      name = first;
    }
    const key = `${name}|${r.rampLength}|${r.min}|${paletteVersion}`;
    if (key === palKey) return palCache;
    const colours = [];
    const ramps = {};
    const src = name ? palettes[name](world, r).ramps : { grey: [[20, 20, 24], [90, 90, 96], [170, 170, 176], [240, 240, 244]] };
    for (const [rname, list] of Object.entries(src)) {
      let kept = list;
      if (r.from.rampLength === "auto") kept = rampForTarget(list, r.min);
      else if (Number.isFinite(r.rampLength) && r.rampLength < list.length) {
        const n = Math.max(1, r.rampLength | 0);
        kept = n <= 1 ? [list[list.length - 1]] : Array.from({ length: n }, (_, i) => list[Math.round((i * (list.length - 1)) / (n - 1))]);
      }
      ramps[rname] = [colours.length, kept.length];
      colours.push(...kept);
    }
    if (Object.keys(ramps).length > MAX_RAMPS) warn(`Palette "${name}" has ${Object.keys(ramps).length} ramps; the GPU renderer holds ${MAX_RAMPS}.`);
    palKey = key;
    palCache = { name, colours, ramps, key };
    return palCache;
  }
  /** Rebuild the palette next frame (a palette reads entity colours: call after changing them). */
  world.touchPalette = () => { paletteVersion += 1; };

  /**
   * What the renderer takes, as plain data:
   *   { boxes, capsules, particles, view: { eye, target, fov, time, sun, waterY, fogNear, fogFar },
   *     palette: { name, colours, ramps, key }, materials, style: { screen, dither, outline },
   *     fx (every pass's name), passes (the renderer's own src/fx list), target: { width, height },
   *     rules, stats: { boxes, capsules, dropped } }
   * Capsules are budgeted (the renderer holds MAX_CAPS): the objects' first,
   * then entities nearest the camera, the focus first; one that can't have
   * enough to read is left out (stats.dropped says who).
   */
  world.frame = () => {
    const r = world.rules;
    const baked = bakeObjects();
    const view = cam.view();
    const outBoxes = baked.boxes.slice(0, MAX_BOXES);
    const capsules = baked.capsules.slice(0, MAX_CAPS);
    const dropped = { boxes: Math.max(0, baked.boxes.length - MAX_BOXES), entities: [] };
    const focusId = cam.mode === "frame" ? world.state.camera?.showing : world.focus ?? world.player;
    // (The camera in the subject's face hides it -- first person, an arm pulled right in -- but a frame shot is there to show it.)
    const hide = cam.hidesSubject && cam.mode !== "frame";
    const list = [...entities.values()].filter((e) => settings.get("show", e) !== false && !(hide && e.id === focusId));
    const far = (e) => (e.id === focusId ? -1 : Math.hypot(e.body.pos[0] - view.eye[0], e.body.pos[1] - view.eye[1], e.body.pos[2] - view.eye[2]));
    list.sort((a, b) => far(a) - far(b) || (a.id < b.id ? -1 : 1));
    for (let i = 0; i < list.length; i += 1) {
      const left = MAX_CAPS - capsules.length;
      const share = Math.floor(left / (list.length - i));
      const max = Math.min(28, i === 0 ? left : Math.max(share, Math.min(left, 14)));
      if (max < 10) { dropped.entities.push(list[i].id); continue; }
      for (const c of list[i].anim.capsules(roleTable(list[i]), { max })) capsules.push({ ...c, id: list[i].id });
    }
    const passes = fxList();
    let f = {
      boxes: outBoxes,
      capsules,
      particles: world.enabled("particles") ? parts.list(r.particleSize) : [],
      view: { ...view, time: world.time, sun: settings.get("render.sun"), waterY: settings.get("render.waterY"), fogNear: settings.get("render.fog")[0], fogFar: settings.get("render.fog")[1] },
      palette: paletteFor(r),
      materials: materials.map(({ name, ...m }) => m),
      style: { screen: r.screen, dither: r.dither, outline: r.outline },
      fx: passes.map((p) => p.name),
      passes: passes.filter((p) => !fxPasses.has(p.name)),
      target: { width: world.width, height: world.height },
      rules: r,
      stats: { boxes: outBoxes.length, capsules: capsules.length, dropped },
    };
    for (const p of passes) {
      const pass = fxPasses.get(p.name);
      if (pass?.frame) f = pass.frame(f, world, p) ?? f;
    }
    return f;
  };

  /**
   * The fx list: "render.fx" (names, or { name, ...params }), then every
   * "fx.<name>" setting over it -- false drops the pass, true adds it, an
   * object adds it with those params. (So "fx.scanlines" locked false keeps
   * scanlines off whatever a scene lists.) Unknown names warn and are skipped.
   */
  function fxList() {
    const byName = new Map();
    for (const e of settings.get("render.fx") ?? []) {
      const entry = typeof e === "string" ? { name: e } : { ...e };
      byName.set(entry.name, { ...(byName.get(entry.name) ?? {}), ...entry });
    }
    for (const [name, v] of Object.entries(settings.section("fx"))) {
      if (v === false || v === null) byName.delete(name);
      else if (v === true) byName.set(name, byName.get(name) ?? { name });
      else if (typeof v === "object") byName.set(name, { ...(byName.get(name) ?? {}), ...v, name });
    }
    const out = [];
    for (const p of byName.values()) {
      if (fxPasses.has(p.name) || FX_NAMES.includes(p.name)) out.push(p);
      else warn(`No fx pass "${p.name}" (the world's: ${[...fxPasses.keys()].join(", ") || "none"}; the renderer's: ${FX_NAMES.join(", ")}).`);
    }
    return out;
  }
  world.fxList = fxList;

  const drawn = new WeakMap();
  /** Draw a frame with a src/gpu pixel renderer (anything with its setTarget/setPalette/setMaterials/setStyle/setWorld/render; setFx if it has one). */
  world.draw = (renderer) => {
    const f = world.frame();
    const last = drawn.get(renderer) ?? {};
    const now = { palette: f.palette.key, materials: JSON.stringify(f.materials), fx: JSON.stringify(f.passes) };
    if (renderer.width !== f.target.width || renderer.height !== f.target.height) renderer.setTarget(f.target.width, f.target.height);
    if (last.palette !== now.palette) renderer.setPalette(f.palette.colours, f.palette.ramps);
    if (last.palette !== now.palette || last.materials !== now.materials) renderer.setMaterials(f.materials);
    if (renderer.setFx && last.fx !== now.fx) renderer.setFx(f.passes);
    drawn.set(renderer, now);
    renderer.setStyle(f.style);
    renderer.setWorld({ boxes: f.boxes, capsules: f.capsules });
    renderer.render({ ...f.view, particles: f.particles });
    for (const name of f.fx) fxPasses.get(name)?.draw?.(renderer, f, world);
    return f;
  };
  /** Hook the browser's keys, mouse (click the canvas to lock it), pad and touch to the world's input. */
  world.attach = (target = globalThis, opts = {}) => inputDev.attach(target, opts);

  // ------------------------------------------------------------ snapshots

  /** A digest of the objects' ids and placements (what a restore must find to be the same level). */
  world.layout = () => digest([...objects.values()].map((o) => `${o.id}:${o.key}:${o.transform.pos.map(r6).join(",")}:${r6(o.transform.yaw)}:${r6(o.transform.scale)}`).sort().join("|"));

  /**
   * Everything the simulation needs to go on exactly as it would have, as
   * plain JSON: the clock, settings (every scope), streams' cursors, system
   * state, entities (their makes, bodies, minds, intents, holds), particles,
   * the camera, the input's arbiter. Objects are the level: the snapshot
   * carries their layout digest, and restore rebuilds them with the world's
   * generator when they differ. (Animators restart on restore -- their state is
   * src/entity's own -- which changes poses for a moment, never the simulation.)
   */
  world.snapshot = () => clone({
    v: 1,
    seed: world.seed,
    steps: world.steps,
    time: world.time,
    target: [world.width, world.height],
    settings: settings.toJSON(),
    layout: world.layout(),
    state: world.state,
    rngs: Object.fromEntries([...rngs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, S]) => [k, S.cursor])),
    intent: world.intent,
    input: { driver: inputDev.arbiter?.driver ?? null, idleFor: inputDev.arbiter?.idleFor ?? 0 },
    player: world.player,
    focus: world.focus,
    entities: [...entities.values()].map((e) => ({
      id: e.id, tags: e.tags, make: e.make, materials: e.materials, brain: e.brain, mind: e.mind, intent: e.intent,
      hold: e.hold, frozen: e.frozen, hasBody: e.hasBody, tuning: e.tuning, body: bodyFields(e.body),
    })),
    particles: parts.save(),
    camera: saveCamera(cam),
    systems: Object.fromEntries([...systems.values()].filter((s) => s.save).map((s) => [s.name, s.save(world)])),
  });

  /** Put a snapshot back (rebuilding the level with world.generator if its layout differs). */
  world.restore = (snap) => {
    const s = typeof snap === "string" ? JSON.parse(snap) : snap;
    if (s.layout !== world.layout()) {
      if (!world.generator) throw new Error("This snapshot is of another level, and the world has no generator to rebuild it with.");
      settings.load(s.settings);
      world.generate(world.generator);
      if (s.layout !== world.layout()) throw new Error("Rebuilt the level from the snapshot's settings, and it still differs.");
    }
    settings.load(s.settings);
    world.setTarget(s.target[0], s.target[1]);
    entities.clear();
    for (const e of s.entities) {
      const ent = {
        kind: "entity", id: e.id, tags: e.tags, make: e.make, spec: entityOf(e.make.seed, e.make),
        materials: e.materials, brain: e.brain, mind: clone(e.mind), intent: clone(e.intent), hold: clone(e.hold), frozen: e.frozen,
        hasBody: e.hasBody, tuning: e.tuning, body: null, bodyKey: "",
      };
      ent.anim = animator(ent.spec);
      ent.size = sizeOf(ent.spec);
      ent.body = makeBody(ent, e.body.pos, e.body.facing, e.body);
      if (ent.body.events) ent.body.events.length = 0;
      entities.set(e.id, ent);
      ent.anim.step(0, ent.body); // (so it holds a pose before its first step)
    }
    world.steps = s.steps;
    world.time = s.time;
    world.state = clone(s.state);
    rngs.clear();
    for (const [k, cursor] of Object.entries(s.rngs)) rngs.set(k, namedStream(hexSeed, `rng:${k}`, cursor));
    world.intent = clone(s.intent);
    if (inputDev.arbiter && s.input.driver) { inputDev.arbiter.driver = s.input.driver; inputDev.arbiter.idleFor = s.input.idleFor; }
    world.player = s.player;
    world.focus = s.focus;
    acc = 0;
    parts.load(s.particles);
    newCamera();
    cam.setMode(s.camera.cam.mode, { blend: 0 });
    const ent = entities.get(world.focus ?? world.player ?? entities.keys().next().value);
    if (ent) cam.step(0, subjectFor(ent, s.camera.cam.mode === "frame"), { boxes }, { look: [0, 0] });
    loadCamera(cam, s.camera);
    for (const [name, data] of Object.entries(s.systems ?? {})) systems.get(name)?.load?.(world, data);
    syncSolids();
    return world;
  };

  return world;
}
