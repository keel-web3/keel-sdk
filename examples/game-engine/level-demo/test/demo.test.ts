import { test } from "node:test";
import assert from "node:assert/strict";
import { cliffFaces, autoTile, bakeChunk } from "@keel/game-engine/terrain";
import { groundExtrasOf, levelInstances, placeholderContent } from "@keel/game-engine/level";
import { demoLevel, demoPalette } from "../src/index.ts";
import { objectDesign } from "../src/designs.ts";
import { valleyPopulation } from "../src/cast.ts";
import { GAIT, createUnits } from "../src/units.ts";
import { ACT, commandOf } from "@keel/game-engine/view";

test("the demo's valley: heights, cliffs and ramps, a river and its bridge, roads, houses, foliage", () => {
  const level = demoLevel("valley-3");
  const t = level.terrain;
  assert.equal(level.meta["template"], "valley");
  assert.ok(level.water.some((w) => w.kind === "river"), "a river");
  assert.ok([...level.things.values()].some((th) => th.layer === "bridges"), "a bridge over it");
  assert.ok([...level.things.values()].filter((th) => th.layer === "buildings").length >= 3, "houses");
  assert.ok(level.roads.length >= 2, "roads");
  assert.ok((level.meta["ramps"] as number) > 10, "ramps");
  assert.ok(cliffFaces(t).length > 100, "cliffs");
  const inst = levelInstances(level, placeholderContent());
  assert.deepEqual(inst.missing, []);
  assert.ok(inst.sprites.length > 3000, `${inst.sprites.length} plants`);
});

test("every object the demo draws becomes a bake design; the ground bakes with the houses and the bridge in it", () => {
  const level = demoLevel("valley-3");
  const pal = demoPalette(level);
  const inst = levelInstances(level, placeholderContent());
  const defs = new Map(inst.sprites.map((s) => [s.def.key, s.def]));
  for (const def of defs.values()) {
    const d = objectDesign(def, pal);
    const w = d.pose("still", 0);
    assert.ok((w.boxes?.length ?? 0) + (w.capsules?.length ?? 0) > 0, def.key);
    assert.ok(d.height > 0 && d.radius > 0);
  }
  // The units: a population -- people, anthros and animals, dressed, every one different, each body with an attack.
  const pop = valleyPopulation("valley-3", 300);
  assert.equal(new Set(pop.units.map((u) => u.signature)).size, 300);
  assert.ok(pop.bodies.length >= 10, `${pop.bodies.length} body shapes`);
  assert.ok(pop.bodies.every((b) => b.clips.some((c) => c.name === "attack")), "every body bakes keel/entity's attack");
  assert.ok(pop.units.filter((u) => u.wears.length > 0).length > 250, "nearly everyone wears something");
  assert.ok((pop.bodies[0]!.pose("attack", 4).capsules?.length ?? 0) > 8);
  // A chunk with a house in it bakes it in (its roof's ramp shows up in the layer).
  const ge = groundExtrasOf(inst);
  const withHouse = [...inst.ground.keys()][0]!;
  const roof = pal.ramps["roof"]!;
  const L = bakeChunk({ terrain: level.terrain, auto: autoTile(level.terrain), chunk: withHouse, view: { yaw: 0, pitch: 0.6, pixelsPerMetre: 4 }, palette: pal, style: { name: "pixel" }, extras: ge.extras(withHouse) });
  let roofTexels = 0;
  for (let o = 0; o < L.w * L.h; o += 1) { const code = (L.data[o * 4]! | (L.data[o * 4 + 1]! << 8)) - 1; if (code >= roof[0] && code < roof[0] + roof[1]) roofTexels += 1; }
  assert.ok(roofTexels > 20, `${roofTexels} roof texels`);
});

test("units walk the flow fields: deterministic, never off a cliff, and they arrive", () => {
  const level = demoLevel("valley-3");
  const grid = level.pathGrid();
  const goals = [...level.things.values()].filter((th) => th.layer === "buildings").map((th) => level.terrain.tileAt(th.pos[0], th.pos[2]));
  const a = createUnits("u", level.terrain, grid, goals, 400, 3);
  const b = createUnits("u", level.terrain, grid, goals, 400, 3);
  const goal0 = Uint16Array.from(a.goal);
  for (let s = 0; s < 400; s += 1) { a.step(1 / 20); b.step(1 / 20); }
  assert.deepEqual(a.x, b.x);
  assert.deepEqual(a.z, b.z);
  const ts = level.terrain.tileSize;
  for (let u = 0; u < a.n; u += 1) assert.ok(grid.passable(Math.floor(a.x[u]! / ts), Math.floor(a.z[u]! / ts)), `unit ${u} on walkable ground`);
  let arrived = 0;
  for (let u = 0; u < a.n; u += 1) if (a.goal[u] !== goal0[u]) arrived += 1;
  assert.ok(arrived > a.n / 4, `${arrived} of ${a.n} reached a goal and went on`);
  assert.ok(a.fields.size <= goals.length);
});

test("a possessed unit is driven by commands through the same ground rules -- the same commands, the same run -- and goes back to its AI", () => {
  const level = demoLevel("valley-3");
  const grid = level.pathGrid();
  const goals = [...level.things.values()].filter((th) => th.layer === "buildings").map((th) => level.terrain.tileAt(th.pos[0], th.pos[2]));
  const run = () => {
    const u = createUnits("p", level.terrain, grid, goals, 60, 1);
    u.possess(5);
    const trail: number[] = [];
    for (let tick = 0; tick < 300; tick += 1) {
      const a = tick * 0.03;
      const act = tick % 80 === 0 ? ACT.attack : tick % 120 < 40 ? ACT.run : 0;
      u.step(1 / 20, [commandOf(tick, 5, [Math.sin(a), Math.cos(a)], a, act)]);
      trail.push(u.x[5]!, u.z[5]!, u.yaw[5]!, u.gait[5]!);
    }
    return { u, trail };
  };
  const a = run(), b = run();
  assert.deepEqual(a.trail, b.trail);
  const ts = level.terrain.tileSize;
  for (let i = 0; i < a.trail.length; i += 4) assert.ok(grid.passable(Math.floor(a.trail[i]! / ts), Math.floor(a.trail[i + 1]! / ts)), "never off walkable ground");
  assert.ok(a.trail.some((_, i) => i % 4 === 3 && a.trail[i] === GAIT.attack), "it struck");
  assert.ok(a.u.dist[5]! > 20, `it went ${a.u.dist[5]!.toFixed(1)} m`);
  a.u.release();
  assert.equal(a.u.possessed, -1);
  const x0 = a.u.x[5]!, z0 = a.u.z[5]!;
  for (let s = 0; s < 60; s += 1) a.u.step(1 / 20);
  assert.ok(Math.hypot(a.u.x[5]! - x0, a.u.z[5]! - z0) > 0.5 || a.u.gait[5] !== GAIT.walk, "back on its flow field");
});
