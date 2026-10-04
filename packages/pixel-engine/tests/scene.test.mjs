// src/scene: config layers and locks, entities and bounds, registry determinism.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from 'node:fs';
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConfigLockError, fromJSON, isEntry, layers } from "../src/scene/config.js";
import { createEntity, dirToLocal, dirToWorld, entitySdf, toLocal, toWorld, withTransform } from "../src/scene/entity.js";
import { aabbOf, containsPoint, distance, localAabbOf, nearestPart, normalAt, overlaps, rayAabb, raycast, sphereOf, touching } from "../src/scene/bounds.js";
import { box, mk, sphere } from "../src/scene/kit.js";
import { createRegistry, roleMatches } from "../src/scene/registry.js";
import { createRoll, seedFromToken, stream } from "../src/core/rng.js";

const near = (a, b, eps = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const nearV = (a, b, eps = 1e-9) => a.forEach((v, i) => near(v, b[i], eps, `[${i}]`));

// ---- config ----

const stack = () => layers([
  { name: "engine", values: { "dither.screen": "bayer4", "dither.steps": 5, "palette.scheme": "Nocturne", "particles.enabled": true } },
  { name: "project", values: { "palette.scheme": { value: "Monochrome", lock: true, note: "house style" }, "dither.steps": 6 } },
  { name: "scene", values: { "dither.screen": "halftone", "palette.scheme": "Prism" } },
  { name: "entity", values: {} },
  { name: "part", values: { "dither.screen": "bayer2" } },
]);

test("config: most specific unlocked value wins", () => {
  const cfg = stack();
  assert.equal(cfg.get("dither.screen"), "bayer2");
  assert.equal(cfg.get("dither.steps"), 6);
  assert.equal(cfg.get("particles.enabled"), true);
  assert.equal(cfg.get("nope"), undefined);
  assert.equal(cfg.get("nope", 3), 3);
  assert.equal(cfg.has("nope"), false);
  assert.deepEqual(cfg.names, ["engine", "project", "scene", "entity", "part"]);
});

test("config: a lock pins the value against lower layers", () => {
  const cfg = stack();
  assert.equal(cfg.get("palette.scheme"), "Monochrome"); // (scene says Prism: shadowed)
  assert.equal(cfg.locked("palette.scheme"), true);
  const why = cfg.explain("palette.scheme");
  assert.equal(why.layer, "project");
  assert.equal(why.lockedAt, "project");
  assert.equal(why.locked, true);
  assert.deepEqual(why.chain.map((c) => [c.layer, c.value, c.locked, c.shadowed]), [
    ["engine", "Nocturne", false, false], ["project", "Monochrome", true, false], ["scene", "Prism", false, true],
  ]);
  assert.equal(why.chain[1].note, "house style");
  const free = cfg.explain("dither.screen");
  assert.equal(free.layer, "part");
  assert.equal(free.locked, false);
  assert.equal(free.lockedAt, null);
  assert.equal(cfg.explain("nope").layer, null);
});

test("config: writes below a lock are refused (reported or thrown)", () => {
  const cfg = stack();
  const r = cfg.set("entity", "palette.scheme", "Duotone");
  assert.equal(r.ok, false);
  assert.equal(r.lockedAt, "project");
  assert.equal(r.lockedValue, "Monochrome");
  assert.equal(cfg.get("palette.scheme"), "Monochrome");
  assert.equal(cfg.refusals.length, 1);
  assert.throws(() => cfg.set("part", "palette.scheme", "Duotone", { strict: true }), ConfigLockError);
  // The lock's own layer: refused without force, allowed with it (still locked).
  assert.equal(cfg.set("project", "palette.scheme", "Split").ok, false);
  assert.equal(cfg.set("project", "palette.scheme", "Split", { force: true }).ok, true);
  assert.equal(cfg.get("palette.scheme"), "Split");
  assert.equal(cfg.locked("palette.scheme"), true);
  // Above the lock is free, but cannot beat it.
  assert.equal(cfg.set("engine", "palette.scheme", "Triad").ok, true);
  assert.equal(cfg.get("palette.scheme"), "Split");
  // unset below a lock is refused too.
  assert.equal(cfg.unset("scene", "palette.scheme").ok, false);
});

test("config: generators propose, locks decide", () => {
  const cfg = stack();
  assert.equal(cfg.propose("palette.scheme", "Spectrum"), "Monochrome");
  assert.equal(cfg.propose("dither.screen", "ign"), "ign");
  assert.equal(cfg.propose("unset.key", 4), 4);
});

test("config: lock, unlock, lock by resolved value, and a lock at the top of the chain", () => {
  const cfg = stack();
  assert.equal(cfg.lock("scene", "dither.screen").ok, true); // (locks the resolved "halftone")
  assert.equal(cfg.get("dither.screen"), "halftone"); // (part's bayer2 now shadowed)
  assert.equal(cfg.set("part", "dither.screen", "bayer8").ok, false);
  assert.equal(cfg.unlock("scene", "dither.screen").changed, true);
  assert.equal(cfg.get("dither.screen"), "bayer2");
  assert.equal(cfg.lock("engine", "particles.enabled", false).ok, true);
  assert.equal(cfg.set("scene", "particles.enabled", true).ok, false);
  assert.equal(cfg.get("particles.enabled"), false);
  // Locking under another lock is refused like any write.
  assert.equal(cfg.lock("scene", "palette.scheme", "Prism").ok, false);
  assert.throws(() => cfg.lock("scene", "never.set"), RangeError);
});

test("config: extend adds a more specific layer; sections; JSON round trip is exact", () => {
  const cfg = stack();
  const child = cfg.extend({ name: "fx", values: { "dither.screen": "checker", "palette.scheme": "Prism" } });
  assert.equal(child.get("dither.screen"), "checker");
  assert.equal(child.get("palette.scheme"), "Monochrome");
  assert.equal(cfg.get("dither.screen"), "bayer2");
  assert.deepEqual(cfg.section("dither"), { screen: "bayer2", steps: 6 });
  const json = JSON.stringify(cfg);
  const back = fromJSON(json);
  assert.equal(JSON.stringify(back), json);
  assert.deepEqual(back.resolved(), cfg.resolved());
  assert.deepEqual(back.explain("palette.scheme"), cfg.explain("palette.scheme"));
  // Bare value objects take the default names.
  const bare = layers([{ a: 1 }, { a: { value: 2, lock: true } }, { a: 3 }]);
  assert.deepEqual(bare.names, ["engine", "project", "scene"]);
  assert.equal(bare.get("a"), 2);
  assert.ok(isEntry({ value: 1 }) && !isEntry({ value: 1, other: 2 }) && !isEntry([1]));
  assert.throws(() => layers([{ name: "a", values: {} }, { name: "a", values: {} }]));
  assert.throws(() => cfg.set("scene", "x", () => 1), TypeError);
  assert.throws(() => cfg.set("nowhere", "x", 1), RangeError);
});

// ---- entities and bounds ----

const ballPart = mk(sphere([0, 0.5, 0], 0.5), { name: "ball", mat: "rubber" });
const slab = mk(box([0, 0, 0], [1, 0.1, 0.5], 0), { name: "slab", mat: "stone" });

test("entity: transform round trips and world SDFs", () => {
  const e = createEntity({ id: "a", transform: { pos: [2, 1, -3], yaw: 0.7, scale: 2 }, parts: [ballPart, slab], tags: ["b", "a", "b"] });
  assert.deepEqual(e.tags, ["a", "b"]);
  const r = [0.3, -0.2, 0.9];
  nearV(toLocal(e, toWorld(e, r)), r, 1e-12);
  nearV(dirToLocal(e, dirToWorld(e, [0, 0, 1])), [0, 0, 1], 1e-12);
  // The ball's centre is at local (0,0.5,0): world pos + (0, 1, 0).
  nearV(toWorld(e, [0, 0.5, 0]), [2, 2, -3], 1e-12);
  // A world point 1 unit above the ball's top: local distance 0.5, world 1.
  near(distance(e, [2, 2 + 1 + 1, -3]), 1, 1e-9, "distance");
  near(entitySdf(e)(2, 2, -3), -1, 1e-9, "inside the ball");
  assert.equal(nearestPart(e, [2, 4, -3]).part.name, "ball");
  nearV(normalAt(e, [2, 3.2, -3]), [0, 1, 0], 1e-6);
  assert.throws(() => createEntity({ parts: [] }));
  assert.throws(() => createEntity({ id: 1, parts: [{ name: "x", bounds: [0, 0, 0, 1, 1, 1] }] }));
  assert.throws(() => createEntity({ id: 1, transform: { scale: 0 } }));
});

test("bounds: AABB, sphere, overlaps, ray vs box and raycast", () => {
  const e = createEntity({ id: "e", transform: { pos: [1, 0, 0] }, parts: [ballPart, slab] });
  assert.deepEqual(localAabbOf(e), [-1, -0.1, -0.5, 1, 1, 0.5]);
  assert.deepEqual(aabbOf(e), [0, -0.1, -0.5, 2, 1, 0.5]);
  const turned = withTransform(e, { yaw: Math.PI / 2 });
  const tb = aabbOf(turned);
  nearV(tb, [0.5, -0.1, -1, 1.5, 1, 1], 1e-12);
  const s = sphereOf(e);
  nearV(s.center, [1, 0.45, 0], 1e-12);
  near(s.radius, Math.hypot(2, 1.1, 1) / 2, 1e-12, "radius");
  // Every surface point of the entity is in its AABB and sphere.
  for (let i = 0; i < 200; i += 1) {
    const a = (i / 200) * Math.PI * 2;
    const p = toWorld(turned, [0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0]);
    assert.ok(containsPoint(turned, p));
  }
  const far = createEntity({ id: "f", transform: { pos: [5, 0, 0] }, parts: [ballPart] });
  const close = createEntity({ id: "c", transform: { pos: [2.4, 0, 0] }, parts: [ballPart] });
  assert.equal(overlaps(e, far), false);
  assert.equal(overlaps(e, close), true);
  assert.equal(overlaps(e, far, 2.6), true);
  assert.equal(overlaps([0, 0, 0, 1, 1, 1], [1, 1, 1, 2, 2, 2]), true); // (touching counts)
  // Ray vs AABB.
  assert.deepEqual(rayAabb([-5, 0.5, 0], [1, 0, 0], [0, 0, 0, 1, 1, 1]), [5, 6]);
  assert.equal(rayAabb([-5, 2, 0], [1, 0, 0], [0, 0, 0, 1, 1, 1]), null);
  assert.equal(rayAabb([5, 0.5, 0.5], [1, 0, 0], [0, 0, 0, 1, 1, 1]), null);
  assert.deepEqual(rayAabb([0.5, 0.5, 0.5], [0, 1, 0], [0, 0, 0, 1, 1, 1]), [0, 0.5]);
  // Raycast lands on the ball's top from above.
  const hit = raycast(e, [1, 5, 0], [0, -1, 0]);
  near(hit.t, 4, 1e-3, "hit t");
  assert.equal(raycast(e, [1, 5, 0], [0, 1, 0]), null);
  assert.equal(raycast(e, [1, 5, 0], [0, -1, 0], { far: 3 }), null);
  // Surfaces: the two balls 1.4 apart (radius 0.5 each) do not touch; 0.9 apart they do.
  const b1 = createEntity({ id: 1, parts: [ballPart] });
  const b2 = createEntity({ id: 2, transform: { pos: [1.4, 0, 0] }, parts: [ballPart] });
  const b3 = createEntity({ id: 3, transform: { pos: [0.9, 0, 0] }, parts: [ballPart] });
  assert.equal(touching(b1, b2, { n: 16 }), false);
  assert.equal(touching(b1, b3, { n: 16 }), true);
});

// ---- registry ----

function catalogue() {
  const reg = createRegistry();
  const relic = reg.defineRealm("Relic", { weight: 3 });
  const decor = reg.defineRealm("Decor", { weight: 2 });
  relic
    .add({ key: "lamp", weight: 3, role: "hero", build: (S) => ({ size: S.between(1, 2) }) })
    .add({ key: "coin", weight: 2, role: "small", build: (S) => ({ size: S.between(0.1, 0.2) }) })
    .add({ key: "clock", weight: 1, role: "both", build: (S, ctx) => ({ size: S.between(0.5, 1), tint: ctx.tint ?? null }) })
    .add({ key: "keyboard", weight: 1, role: "peripheral", keyOnly: true, build: (S) => ({ keys: S.int(60, 104) }) });
  decor.add({ key: "vase", weight: 1, build: (S) => ({ size: S.between(0.3, 0.9) }) });
  return reg;
}

test("registry: makeAsset is deterministic and stamps key, realm, seed", () => {
  const a = catalogue();
  const b = catalogue();
  const seen = new Set();
  for (let t = 1; t <= 300; t += 1) {
    const seed = seedFromToken(t);
    const x = a.makeAsset(seed);
    const y = b.makeAsset(seed);
    assert.deepEqual(x, y);
    assert.equal(x.seed, seed);
    assert.ok(["Relic", "Decor"].includes(x.realm));
    seen.add(`${x.realm}/${x.key}`);
    assert.ok(x.key !== "keyboard"); // (key-only builders never come at random)
  }
  assert.deepEqual([...seen].sort(), ["Decor/vase", "Relic/clock", "Relic/coin", "Relic/lamp"]);
  // Roles filter the pool.
  for (let t = 1; t <= 100; t += 1) {
    assert.notEqual(a.makeAsset(seedFromToken(t), { realm: "Relic", role: "hero" }).key, "coin");
    assert.notEqual(a.makeAsset(seedFromToken(t), { realm: "Relic", role: "small" }).key, "lamp");
  }
  // A forced key: its draw still happens, so the build stream is where it would be.
  for (let t = 1; t <= 50; t += 1) {
    const seed = seedFromToken(t);
    const free = a.makeAsset(seed, { realm: "Relic" });
    const forced = a.makeAsset(seed, { realm: "Relic", key: free.key });
    assert.deepEqual(forced, free);
    const kb = a.makeAsset(seed, { realm: "Relic", key: "keyboard" });
    assert.equal(kb.key, "keyboard");
  }
  assert.equal(a.makeAsset(seedFromToken(1), { realm: "Relic", key: "clock", ctx: { tint: 2 } }).tint, 2);
  assert.throws(() => a.makeAsset(seedFromToken(1), { realm: "Nowhere" }));
  assert.throws(() => a.realm("Relic").add({ key: "lamp", build: () => ({}) }));
  assert.ok(roleMatches("both", "hero") && roleMatches(["hero", "small"], "small") && !roleMatches("small", "hero"));
});

test("registry: realm.pick draws exactly like NOCTURNES' kit.js pickBuilder", async (t) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
  if (!existsSync(`${NOCTURNES}/src/kit.js`)) { t.skip('Set NOCTURNES to run this external reference comparison.'); return; }
  const nKit = await import(pathToFileURL(`${NOCTURNES}/src/kit.js`).href);
  const nGenome = await import(pathToFileURL(`${NOCTURNES}/src/genome.js`).href);
  const specs = [["lamp", 3, "hero"], ["coin", 2, "small"], ["clock", 1, "both"], ["bowl", 4, "both"], ["kb", 1, "peripheral"]];
  const list = specs.map(([key, w, role]) => [key, w, (S) => ({ v: S.f() }), role]);
  const realm = createRegistry().defineRealm("R");
  for (const [key, weight, role] of specs) realm.add({ key, weight, role, keyOnly: role === "peripheral", build: (S) => ({ v: S.f() }) });
  let n = 0;
  for (let t = 1; t <= 400; t += 1) {
    for (const role of ["hero", "small"]) {
      const seed = seedFromToken(t);
      const Sn = nGenome.stream(createRoll(seed), 1);
      const Se = stream(createRoll(seed), 1);
      const a = nKit.pickBuilder(Sn, list, role)(Sn);
      const b = realm.pick(Se, role)(Se);
      assert.deepEqual(b, a);
      n += 1;
    }
  }
  assert.equal(n, 800);
});
