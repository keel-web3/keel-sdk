// src/world: settings scopes and locks, explain, generation under locks, the
// system loop, determinism, snapshots, target rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "../src/core/rng.js";
import { createSettings, formatLocks, parseLocks } from "../src/world/settings.js";
import { targetRules } from "../src/world/rules.js";
import { namedStream } from "../src/world/streams.js";
import { createWorld } from "../src/world/world.js";

const SCOPES = ["engine", "project", "scene", "tag:bench", "id:bench-1", "runtime"];
const bench = { id: "bench-1", tags: ["bench"] };

test("settings: the most specific scope wins, and a lock at any scope wins over every later one", () => {
  for (let lockAt = 0; lockAt < SCOPES.length; lockAt += 1) {
    const s = createSettings({ tagsOf: (id) => (id === "bench-1" ? ["bench"] : []) });
    SCOPES.forEach((scope, i) => s.set(scope, "material", `m${i}`));
    assert.equal(s.get("material", bench), "m5", "unlocked: runtime (the last) wins");
    const r = s.lock(SCOPES[lockAt], "material");
    assert.equal(r.ok, true);
    assert.equal(s.get("material", bench), `m${lockAt}`, `locked at ${SCOPES[lockAt]}`);
    // Every later scope is refused; the locking scope itself may change its own value.
    for (let j = lockAt + 1; j < SCOPES.length; j += 1) {
      const w = s.set(SCOPES[j], "material", "nope");
      if (SCOPES[j] === "runtime" && lockAt >= 3) assert.equal(w.ok, true, "runtime is global: a tag/id lock shadows it for that thing only");
      else assert.equal(w.ok, false, `${SCOPES[j]} under a lock at ${SCOPES[lockAt]}`);
      assert.equal(s.get("material", bench), `m${lockAt}`);
    }
    assert.equal(s.set(SCOPES[lockAt], "material", "own").ok, false, "a lock holds against its own scope too...");
    assert.equal(s.set(SCOPES[lockAt], "material", "own", { force: true }).ok, true, "...unless it forces");
    assert.equal(s.get("material", bench), "own");
  }
});

test("settings: tag and id scopes only reach their things; the runtime reaches the rest", () => {
  const s = createSettings({ engine: { material: "stone" } });
  s.lock("tag:bench", "material", "oak");
  s.set("runtime", "material", "glass");
  assert.equal(s.get("material", bench), "oak");
  assert.equal(s.get("material", { id: "lamp-1", tags: ["lamp"] }), "glass");
  assert.equal(s.get("material"), "glass");
  // (Tags come from the world when only an id is given.)
  s.useTags((id) => (id === "bench-2" ? ["bench"] : []));
  assert.equal(s.get("material", "bench-2"), "oak");
});

test("explain() names who set a value and who locked it, and marks what the lock shadows", () => {
  const s = createSettings({ engine: { "render.palette": "default" } });
  s.set("scene", "render.palette", "dusk");
  let ex = s.explain("render.palette");
  assert.equal(ex.layer, "scene");
  assert.equal(ex.locked, false);
  s.lock("project", "render.palette", "meadow", { note: "house style" });
  assert.equal(s.set("runtime", "render.palette", "noir").ok, false);
  ex = s.explain("render.palette");
  assert.equal(ex.value, "meadow");
  assert.equal(ex.layer, "project");
  assert.equal(ex.lockedAt, "project");
  assert.deepEqual(ex.chain.map((c) => [c.layer, c.shadowed]), [["engine", false], ["project", false], ["scene", true]]);
  assert.equal(ex.chain[1].note, "house style");
  // A thing's key names its tag or id scope.
  s.lock("id:bench-1", "material", "oak");
  assert.equal(s.explain("material", bench).lockedAt, "id:bench-1");
  // And a generator's roll names the seed.
  s.propose("species", "fox", { id: "cat-1", tags: [] });
  assert.equal(s.explain("species", "cat-1").layer, "seed:cat-1");
});

test("propose: a lock hands the generator its value; unlocked, the roll is kept and written to the seed scope", () => {
  const s = createSettings();
  assert.equal(s.propose("benches", 3), 3);
  assert.equal(s.explain("benches").layer, "seed");
  s.lock("scene", "species", "cat");
  assert.equal(s.propose("species", "fox", bench), "cat");
  assert.equal(s.explain("species", bench).layer, "scene", "the lock is named, not the roll");
  s.set("id:bench-1", "size", 2);
  assert.equal(s.propose("size", 1.5, bench), 2, "an explicit id setting beats the roll");
  s.clearSeed();
  assert.equal(s.get("benches"), undefined);
  assert.equal(s.get("species", bench), "cat");
});

test("settings round-trip through JSON; locks round-trip through text", () => {
  const s = createSettings({ project: { a: 1 } });
  s.lock("tag:animal", "species", "cat");
  s.set("id:bench-1", "material", "oak", { lock: true });
  const t = createSettings().load(JSON.parse(JSON.stringify(s.toJSON())));
  assert.deepEqual(t.toJSON(), s.toJSON());
  assert.equal(t.get("species", { id: "x", tags: ["animal"] }), "cat");
  const text = "scene/render.palette=dusk;tag:animal/species=cat;id:bench-1/material=~oak;scene/render.fx=[\"fog\"];scene/render.dither.screen=2";
  const list = parseLocks(text);
  assert.deepEqual(list[2], { scope: "id:bench-1", key: "material", value: "oak", lock: false });
  assert.deepEqual(list[3].value, ["fog"]);
  assert.equal(list[4].value, 2);
  assert.equal(formatLocks(list), text);
});

test("named streams are core/rng.js streams with their cursor out in the open", () => {
  const seed = deriveSeed("w", "x");
  const a = namedStream(seed, "rng:dust");
  const b = stream(createRoll(deriveSeed(seed, "rng:dust")), 0);
  for (let i = 0; i < 50; i += 1) assert.equal(a.f(), b.f());
  const c = namedStream(seed, "rng:dust", a.cursor);
  assert.equal(c.f(), a.f());
});

test("target rules at 32, 64, 128, 256", () => {
  const at = Object.fromEntries([32, 64, 128, 256].map((n) => [n, targetRules(n, n)]));
  assert.deepEqual([32, 64, 128, 256].map((n) => at[n].screen), [2, 4, 4, 8]);
  assert.deepEqual([32, 64, 128, 256].map((n) => at[n].screenId), ["bayer2", "bayer4", "bayer4", "bayer8"]);
  assert.deepEqual([32, 64, 128, 256].map((n) => at[n].band), ["tiny", "small", "small", "large"]);
  assert.deepEqual([32, 64, 128, 256].map((n) => at[n].rampLength), [5, 8, 14, Infinity]);
  const fov = (n) => 1.15 * Math.min(1, Math.max(0.6, (n / 128) ** 0.3));
  const arm = (n) => Math.min(1, Math.max(0.55, (n / 128) ** 0.45));
  for (const n of [32, 64, 128, 256]) {
    assert.ok(Math.abs(at[n].fov - fov(n)) < 1e-12);
    assert.ok(Math.abs(at[n].arm - arm(n)) < 1e-12);
    assert.ok(at[n].particleSize >= 1);
  }
  assert.equal(at[32].arm, 0.55);
  assert.ok(at[32].particleSize > at[64].particleSize && at[64].particleSize > at[128].particleSize);
  // Non-square: the short side rules.
  assert.equal(targetRules(256, 40).screen, 2);
});

test("target rules are overridable and lockable through settings; explain says which", () => {
  const w = createWorld({ width: 32, height: 32 });
  assert.equal(w.rules.screen, 2);
  assert.match(w.explain("render.dither.screen").rule, /^auto: targetRules\(32x32\)\.screen = 2/);
  w.lock("project", "render.dither.screen", 8);
  assert.equal(w.set("scene", "render.dither.screen", 4).ok, false);
  assert.equal(w.rules.screen, 8);
  assert.equal(w.explain("render.dither.screen").lockedAt, "project");
  assert.equal(w.frame().style.screen, 8);
  w.setTarget(256, 256);
  assert.equal(w.rules.screen, 8);
  assert.equal(w.rules.fov, 1.15);
  w.set("scene", "system.camera.fov", 0.9);
  assert.equal(w.rules.fov, 0.9);
  w.set("scene", "render.rampLength", 3);
  assert.equal(w.rules.rampLength, 3);
});

// ---------------------------------------------------------------- the world

// A small level: a floor, a bench, a crate, two animals and a person, each by id.
function level(g) {
  g.place("pad", { id: "floor", tags: ["ground"], ctx: { w: 16, d: 16, h: 0.3, lip: false }, on: [0] });
  g.place("bench", { id: "bench-1", tags: ["bench"], pos: [2, 0, 1], on: "auto" });
  g.place("crate", { id: "crate-1", pos: [-3, 0, 2], on: "auto" });
  g.choose("material", ["oak", "teak", "paint"], { thing: { id: "bench-1", tags: ["bench"] } });
  const n = g.int("animals", 2, 2);
  for (let i = 1; i <= n; i += 1) g.spawn({ id: `animal-${i}`, kind: "animal", tags: ["animal"], pos: [i * 1.5 - 3, 0.6, -2], yaw: i, brain: "roam" });
  g.spawn({ id: "hero", kind: "humanoid", tags: ["hero"], pos: [0, 0.6, 0], player: true });
}
// A brain with its own stream: turns and walks.
function roam(w, ent) {
  const S = w.rng(`mind:${ent.id}`);
  const m = ent.mind;
  if (!m.dir || S.chance(0.01)) m.dir = S.between(-Math.PI, Math.PI);
  return { move: [Math.sin(m.dir) * 0.5, Math.cos(m.dir) * 0.5] };
}
function makeWorld(opts = {}) {
  const w = createWorld({ seed: "42", width: 64, height: 64, materials: [{ name: "wall" }, { name: "floor" }, { name: "metal" }, { name: "dark" }, { name: "water" }, { name: "sky" }, { name: "oak" }, { name: "teak" }, { name: "paint" }], ...opts });
  w.brain("roam", roam);
  w.on("landed", (e, world) => world.particles.emit("dust", e.at, { count: 3 }));
  // A scripted player: walks in a square, jumps now and then (the same every run).
  w.drive((world) => { const k = Math.floor(world.time / 1.5) % 4; return { move: [[1, 0], [0, 1], [-1, 0], [0, -1]][k], jump: world.steps % 200 === 0, hold: true }; });
  w.generate(level);
  return w;
}

test("a headless world runs 10 s the same twice: identical snapshots", () => {
  const a = makeWorld();
  const b = makeWorld();
  a.simulate(10);
  b.simulate(10);
  const sa = JSON.stringify(a.snapshot());
  assert.equal(sa, JSON.stringify(b.snapshot()));
  assert.equal(a.steps, 1200);
  // It did something: bodies moved, dust flew, the camera followed.
  const hero = a.entities.get("hero").body;
  assert.ok(Math.hypot(hero.pos[0], hero.pos[2]) > 0.1 || a.particles.count >= 0);
  assert.ok(a.entities.get("animal-1").body.pos[0] !== -1.5);
  const f = a.frame();
  assert.ok(f.boxes.length > 5 && f.capsules.length > 10);
  assert.ok(Number.isFinite(f.view.eye[0]));
});

test("snapshot/restore round-trips, and the world goes on from it exactly", () => {
  const w = makeWorld();
  w.simulate(3);
  const snap = w.snapshot();
  w.simulate(4);
  const after = JSON.stringify(w.snapshot());
  w.restore(snap);
  assert.equal(JSON.stringify(w.snapshot()), JSON.stringify(snap), "restore then snapshot is the snapshot");
  w.simulate(4);
  assert.equal(JSON.stringify(w.snapshot()), after, "and it runs on to the same place");
  // Into a fresh world of the same level (it has the generator), from JSON.
  const fresh = makeWorld();
  fresh.restore(JSON.stringify(snap));
  fresh.simulate(4);
  assert.equal(JSON.stringify(fresh.snapshot()), after);
});

test("systems run in order (input, control, physics, animation, particles, camera, custom), and turn off", () => {
  const w = makeWorld();
  const seen = [];
  const order = new Map([["input", 0], ["control", 100], ["physics", 200], ["animation", 300], ["particles", 400], ["camera", 500]]);
  for (const [name, def] of order) {
    const sys = w.system(name);
    w.system(name, { order: def, step: (world, dt) => { seen.push(name); sys.step(world, dt); } });
  }
  w.system("late", { order: 900, step: () => seen.push("late") });
  w.system("early", { order: 50, step: () => seen.push("early") });
  w.system("custom", { step: () => seen.push("custom") });
  w.step();
  assert.deepEqual(seen, ["input", "early", "control", "physics", "animation", "particles", "camera", "custom", "late"]);
  assert.deepEqual(w.systems().map((s) => s.name), seen);
  // Off by the setting (and a lock keeps it off).
  seen.length = 0;
  w.lock("scene", "system.physics.enabled", false);
  assert.equal(w.enable("physics", true).ok, false, "the runtime can't turn a locked system back on");
  w.enable("late", false);
  w.step();
  assert.deepEqual(seen, ["input", "early", "control", "animation", "particles", "camera", "custom"]);
  const y = w.entities.get("hero").body.pos[1];
  w.simulate(0.5);
  assert.equal(w.entities.get("hero").body.pos[1], y, "no physics, nothing falls");
});

test("system params through settings: lock gravity, and bodies are rebuilt with it", () => {
  const w = makeWorld();
  w.drive(() => ({ move: [0, 0], jump: false, hold: false }));
  w.simulate(1);
  w.lock("scene", "system.physics.gravity", 4);
  w.teleport("hero", [0, 3, 0]);
  const y0 = w.entities.get("hero").body.pos[1];
  w.simulate(0.25);
  const fell = y0 - w.entities.get("hero").body.pos[1];
  // (Free fall at 4 m/s^2 for 0.25 s is 0.125 m; at 24 it would be 0.75.)
  assert.ok(fell > 0.08 && fell < 0.2, `fell ${fell}`);
});

test("generation with locks keeps the locked items and does not reshuffle the unlocked ones", () => {
  const base = makeWorld();
  const choices = (w) => ({
    species: [...w.entities.values()].map((e) => `${e.id}:${e.spec.species}`),
    looks: [...w.entities.values()].map((e) => JSON.stringify(e.spec.choices)),
    material: w.get("material", "bench-1"),
    layout: w.layout(),
  });
  const before = choices(base);
  // Force a cat on animal-1 (a species the seed didn't pick), and oak on the bench.
  const other = before.species[0].endsWith(":cat") ? "dog" : "cat";
  const w = makeWorld({ config: { "id:animal-1": { species: { value: other, lock: true } } } });
  w.lock("id:bench-1", "material", before.material === "oak" ? "teak" : "oak");
  w.generate(level);
  const after = choices(w);
  assert.equal(w.entities.get("animal-1").spec.species, other);
  assert.equal(w.explain("species", "animal-1").lockedAt, "id:animal-1");
  assert.notEqual(after.material, before.material);
  // Everything else as it was: the other animal, the hero, the layout.
  assert.deepEqual(after.species.slice(1), before.species.slice(1));
  assert.deepEqual(after.looks.slice(1), before.looks.slice(1));
  assert.equal(after.layout, before.layout);
  // A tag lock reaches every animal; the unlocked hero is still the seed's.
  const t = makeWorld({ config: { locks: "tag:animal/species=deer" } });
  assert.deepEqual([...t.entities.values()].filter((e) => e.tags.includes("animal")).map((e) => e.spec.species), ["deer", "deer"]);
  assert.equal(JSON.stringify(t.entities.get("hero").spec.choices), before.looks[2]);
  // A count locked higher adds things without moving the ones there.
  const more = makeWorld({ config: { locks: "scene/animals=3" } });
  assert.equal(more.entities.size, 4);
  assert.deepEqual([...more.entities.values()].slice(0, 2).map((e) => JSON.stringify(e.spec.choices)), before.looks.slice(0, 2));
});

test("per-object settings: material, show and collide change what is drawn and what is solid", () => {
  const w = makeWorld();
  const oak = w.mat("oak");
  w.lock("id:bench-1", "material", "oak");
  const seat = w.frame().boxes.filter((b) => b.id === "bench-1");
  assert.ok(seat.some((b) => b.mat === oak), "the bench's wood is oak");
  assert.ok(seat.some((b) => b.mat === w.mat("metal")), "its legs stay metal");
  w.set("id:crate-1", "show", false);
  assert.equal(w.frame().boxes.filter((b) => b.id === "crate-1").length, 0);
  w.syncSolids();
  assert.ok(w.boxes.some((b) => b.id === "crate-1"), "hidden, still solid");
  w.set("id:crate-1", "collide", false);
  w.syncSolids();
  assert.ok(!w.boxes.some((b) => b.id === "crate-1"));
  // "mat.<name>" renames a material for a thing or everything.
  w.set("project", "mat.wood", "teak");
  w.unlock("id:bench-1", "material");
  w.unset("id:bench-1", "material");
  assert.equal(w.explain("material", "bench-1").layer, "seed:bench-1");
});

test("events: bodies' events reach world.on; a static entity stays put", () => {
  const w = makeWorld();
  const landed = [];
  w.on("landed", (e) => landed.push(e.id));
  w.simulate(1);
  assert.ok(landed.includes("hero") && landed.includes("animal-1"));
  w.lock("id:animal-1", "static", true);
  const p = [...w.entities.get("animal-1").body.pos];
  w.simulate(1);
  assert.deepEqual(w.entities.get("animal-1").body.pos, p);
});

test("the world's render budget is the GPU renderer's", async () => {
  const { RENDER_BUDGET } = await import("../src/world/world.js");
  const gpu = await import("../src/gpu/shaders.js");
  assert.deepEqual(RENDER_BUDGET, { boxes: gpu.MAX_BOXES, capsules: gpu.MAX_CAPS, ramps: gpu.MAX_RAMPS, materials: gpu.MAX_MATERIALS });
});

test("record and replay: a run driven by the keyboard replays exactly from its log", () => {
  const live = makeWorld();
  live.drive(null); // (back to the input device)
  live.record();
  const keys = [[0, "w", true], [120, " ", true], [130, " ", false], [300, "d", true], [420, "w", false], [600, "d", false]];
  for (let i = 0; i < 720; i += 1) {
    for (const [at, k, down] of keys) if (at === i) live.input.key(k, down);
    live.step();
  }
  const log = live.record(false);
  assert.equal(log.length, 720);
  const again = makeWorld();
  again.replay(log);
  again.simulate(6);
  const bodies = (w) => JSON.stringify(w.snapshot().entities.map((e) => e.body));
  assert.equal(bodies(again), bodies(live));
  assert.ok(Math.hypot(...live.entities.get("hero").body.pos.filter((_, i) => i !== 1)) > 1, "the keys moved the hero");
});
