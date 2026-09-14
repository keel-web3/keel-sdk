import { test } from "node:test";
import assert from "node:assert/strict";
import { lookDistance } from "@keel/game-engine/core";
import { bakeCost, planBake } from "@keel/game-engine/bake";
import { createArmy } from "../src/army.ts";
import { armyCast, armyPopulation, propDesigns } from "../src/designs.ts";

const kinds = [{ speeds: [0, 1.4, 4, 6] as const, radius: 0.3 }, { speeds: [0, 1, 3, 8] as const, radius: 0.5 }];

test("the sim is deterministic from its seed, stays on the map, and walks by distance", () => {
  const run = (seed: string) => { const a = createArmy(seed, kinds, 3000, 190); for (let i = 0; i < 120; i += 1) a.step(1 / 30); return a; };
  const a = run("7"), b = run("7"), c = run("8");
  assert.deepEqual(a.x, b.x); assert.deepEqual(a.z, b.z); assert.deepEqual(a.yaw, b.yaw); assert.deepEqual(a.dist, b.dist);
  assert.notDeepEqual(a.x, c.x);
  for (let i = 0; i < a.n; i += 1) assert.ok(a.x[i]! >= 0 && a.x[i]! <= 190 && a.z[i]! >= 0 && a.z[i]! <= 190);
  let moved = 0;
  for (let i = 0; i < a.n; i += 1) if (a.dist[i]! > 0.5) moved += 1;
  assert.ok(moved > a.n * 0.5, `${moved} moved`);
  assert.equal(a.grid.size, a.n);
  // A unit's kind can be given (the army gives each its body shape).
  const given = createArmy("7", kinds, 100, 50, (i) => i % 2);
  for (let i = 0; i < 100; i += 1) assert.equal(given.design[i], i % 2);
});

test("the cast: every character, every wearable but the boots (they're baked into bodies), and props that bake once", () => {
  const { entities, attributes } = armyCast();
  assert.equal(entities.length, 14);
  assert.ok(attributes.some((a) => a.def.id === "flag") && attributes.some((a) => a.def.id === "cape") && attributes.some((a) => a.def.id === "horned-helmet"));
  assert.ok(!attributes.some((a) => a.def.layer === "body"));
  const props = propDesigns("1");
  assert.equal(planBake(props, { directions: 8, pixelsPerMetre: 24 }).perDesign.get(props[0]!.key), 1, "a prop bakes one sprite");
});

// The big test: ten thousand units, every one its own character.
test("10,000 units: every signature distinct, every unit visibly apart from its kind, from a few dozen shapes", () => {
  const t0 = performance.now();
  const pop = armyPopulation("1", 10000);
  const ms = performance.now() - t0;
  const units = pop.units;
  assert.equal(units.length, 10000);
  const signatures = new Set(units.map((u) => u.signature));
  assert.equal(signatures.size, 10000, "every unit's full signature (body shape + coverage + look + wearable shapes and looks) is its own");
  // Visibly different: two units of one character in one coverage are at least the look threshold apart.
  const groups = new Map<string, typeof units[number][]>();
  for (const u of units) { const g = `${u.entity}|${JSON.stringify(Object.entries(u.coverage).sort())}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(u); }
  let pairs = 0, closest = Infinity;
  for (const us of groups.values()) for (let i = 0; i < us.length; i += 1) for (let j = i + 1; j < us.length; j += 1) { const d = lookDistance(us[i]!.look, us[j]!.look); if (d < closest) closest = d; pairs += 1; }
  assert.ok(closest >= 0.08, `closest pair ${closest}`);
  assert.equal(pop.stats.failures, 0);
  // What made them: a few body shapes, some hundreds of wearable shapes -- and what baking them costs.
  const bodies = new Set(units.map((u) => u.body)).size;
  const wearShapes = new Set(units.flatMap((u) => u.wears.map((w) => w.shape))).size;
  const looks = new Set(units.flatMap((u) => [u.look.signature, ...u.wears.map((w) => w.look.signature)])).size;
  const cost = bakeCost(pop);
  assert.ok(bodies <= 20 && wearShapes < 1000, `${bodies} bodies, ${wearShapes} wearable shapes`);
  assert.ok(cost.layered * 50 < cost.combined, JSON.stringify(cost));
  // Every character is in it, and every wearable.
  assert.equal(new Set(units.map((u) => u.entity)).size, 14);
  assert.equal(new Set(units.flatMap((u) => u.wears.map((w) => pop.attributes[w.shape]!.attribute))).size, 13, "every wearable is worn");
  console.log(`  10,000 units in ${ms.toFixed(0)} ms: ${signatures.size} distinct signatures; ${bodies} body shapes, ${wearShapes} wearable shapes, ${looks} distinct looks; `
    + `closest same-kind pair ${closest.toFixed(3)} over ${pairs} pairs (${pop.stats.rerolls} re-rolls, ${pop.stats.failures} failures)\n`
    + `  bake: layered ${cost.layered} sprites (${cost.bodies} body + ${cost.attributes} wearable) vs ${cost.combined} combined (${cost.combos} body+wear combos) vs ${cost.perUnit} one design a unit`);
});

// The streaming loader leans on these: the page draws the scene from the shapes before the looks are painted, and a
// bake worker builds the designs again from the seed -- key for key the page's.
test("the population's shapes first, the looks after, are exactly the population; a bake worker's designs are the page's", async () => {
  const { armyShapes, armySources } = await import("../src/designs.ts");
  const { dressPopulation } = await import("@keel/game-engine/bake");
  const whole = armyPopulation("3", 1500);
  const shapes = armyShapes("3", 1500);
  const dressed = dressPopulation(shapes);
  assert.deepEqual(dressed.units.map((u) => u.signature), whole.units.map((u) => u.signature));
  assert.deepEqual(shapes.bodies.map((b) => b.key), whole.bodies.map((b) => b.key));
  assert.deepEqual(shapes.attributes.map((a) => a.key), whole.attributes.map((a) => a.key));
  // Who wears what is known before the looks: the same shapes, in socket order once sorted.
  shapes.units.forEach((u, i) => assert.deepEqual(u.wears.map((w) => w.shape).sort(), whole.units[i]!.wears.map((w) => w.shape).sort()));
  const src = armySources("3", 1500);
  assert.deepEqual([...src.indexed.keys()], [...whole.bodies, ...whole.attributes].map((d) => d.key));
  assert.deepEqual([...src.plain.keys()], propDesigns("3").map((d) => d.key));
});

// The population as it's stored: a hybrid record (recipe + re-rolls + the voxel hero's body) that makes the same
// units as the recipe's batch -- and record.ts is that record for seed 1 (regenerate it with tools/record.ts).
test("the stored record is current, a few KB, and every smaller army is its first units; unit 0 is a voxel hero", async () => {
  const { populate, populationOf, recordBytes, recordOf, unitOf } = await import("@keel/game-engine/bake");
  const { ARMY_ENV, ARMY_RECORD, armyHero, armyOptions, storedRecord } = { ...(await import("../src/designs.ts")), ...(await import("../src/record.ts")) };
  const full = storedRecord("1", ARMY_RECORD.count)!;
  const bytes = recordBytes(full);
  assert.ok(bytes.length < 23 * 1024, `${bytes.length} B: under KEEL's 23 KB slug`);
  const batch = populate(armyOptions("1", 3000));
  assert.deepEqual(recordOf(batch), storedRecord("1", 3000), "record.ts is out of date: node examples/game-engine/army/tools/record.ts");
  const read = armyPopulation("1", 3000);
  read.units.forEach((u, i) => assert.equal(u.signature, batch.units[i]!.signature, `unit ${i}`));
  for (const i of [0, 1, 2999]) assert.equal(unitOf(bytes, i, ARMY_ENV).signature, batch.units[i]!.signature);
  assert.equal(storedRecord("2", 3000), null);
  assert.equal(populationOf(storedRecord("1", 500)!, ARMY_ENV).units.length, 500);
  // The hero: its body is the builder's voxels; it wears seeded things on its own sockets; it walks.
  const hero = armyHero();
  const u0 = read.units[0]!, body = read.bodies[u0.body]!;
  assert.ok(body.key.startsWith("explicit:") && body.spec.plan === "humanoid");
  assert.equal(read.entities[u0.entity]!.def.id, "human", "pinned: a person's look");
  assert.deepEqual(Object.keys(body.sockets).sort(), Object.keys(hero.sockets).sort());
  assert.ok(u0.wears.length >= 1 && u0.wears.every((w) => hero.sockets[read.attributes[w.shape]!.socket]));
  assert.ok(body.clip("walk").speed > 0);
});
