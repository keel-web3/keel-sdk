// GARDEN beside the proof of concept's projects/garden/garden.js: the same
// plazas (100 seeds, object for object), the same casts, the same locks, and
// the same run -- bodies, minds, particles and every frame -- to the bit.
// One difference, on purpose (the world's README "Differences"): the camera's
// subject is an entity's real height, so frame shots of the animals under
// 0.6 m (the proof of concept held every subject to 0.6 m) are aimed from
// other places; the simulation doesn't read the camera, and stays the same.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame, World } from "@keel/game-engine/world";
import { gardenWorld } from "../src/garden.ts";
import type { GardenOptions } from "../src/garden.ts";
import { POC, counter, hasPoc, poc } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
type Garden = (o: GardenOptions) => World;
const pocGarden = hasPoc ? (await poc<{ gardenWorld: Garden }>("projects/garden/garden.js")).gardenWorld : null;

// What the proof of concept's v1 snapshots and these v2 ones share.
function shared(w: World): Record<string, unknown> {
  const s = JSON.parse(JSON.stringify(w.snapshot())) as Record<string, unknown> & { entities: Record<string, unknown>[] };
  const { v: _v, camera: _camera, ...rest } = s;
  return { ...rest, entities: s.entities.map(({ anim: _anim, heldKey: _held, ...e }) => e) };
}
const frameOf = (w: World): Frame => JSON.parse(JSON.stringify(w.frame())) as Frame;
const objectsOf = (w: World) => [...w.objects.values()].map((o) => [o.id, o.key, o.tags, o.transform, o.def.parts.length, o.def.meta]);

test("100 garden seeds: the same plaza, object for object, and the same cast", { skip }, () => {
  const c = counter();
  for (let seed = 1; seed <= 100; seed += 1) {
    const a = gardenWorld({ seed: String(seed), width: 32, height: 32 });
    const b = pocGarden!({ seed: String(seed), width: 32, height: 32 });
    c.same("layout", a.layout(), b.layout(), `seed ${seed}`);
    c.same("objects", objectsOf(a), objectsOf(b), `seed ${seed}`);
    c.same("rests", a.rests, b.rests);
    c.same("settings", a.settings.toJSON(), b.settings.toJSON());
    c.same("warnings", a.warnings, b.warnings);
    c.same("cast", [...a.entities.values()].map((e) => [e.id, e.make, e.spec.choices, e.size, e.tuning]), [...b.entities.values()].map((e) => [e.id, e.make, e.spec.choices, e.size, e.tuning]));
    c.same("frame", frameOf(a), frameOf(b));
  }
  console.log(c.summary("garden layouts (100 seeds)"));
});

test("the garden runs 12 s as the proof of concept's does: state and frames, to the bit", { skip }, () => {
  const c = counter();
  const runs: GardenOptions[] = [
    { seed: "1" }, { seed: "7", width: 64, height: 64 }, { seed: "11", locks: "tag:animal/species=cat;id:hero/species=frog;id:bench-1/material=paint;scene/render.palette=noir" },
    { seed: "3", width: 32, height: 32, scene: { "render.fx": ["dusk", "mist", "lantern", "glow"] } }, { seed: "21", locks: "scene/system.particles.enabled=false;scene/system.camera.mode=chase" },
  ];
  for (const o of runs) {
    const a = gardenWorld(o);
    const b = pocGarden!(o);
    for (let i = 0; i < 48; i += 1) {
      a.simulate(0.25);
      b.simulate(0.25);
      c.same("state (v1 fields)", shared(a), shared(b), `${JSON.stringify(o)} at ${i}`);
      c.same("frame", frameOf(a), frameOf(b), `${JSON.stringify(o)} frame at ${i}`);
    }
  }
  console.log(c.summary("garden runs (5 x 48 checkpoints)"));
});

test("frame shots are the proof of concept's, view for view (they fit the subject's bounds, not its height)", { skip }, () => {
  const c = counter();
  for (const seed of ["5", "8", "13"]) {
    const o: GardenOptions = { seed, width: 96, height: 96, locks: "scene/system.camera.mode=frame;scene/system.camera.cycle=1.5" };
    const a = gardenWorld(o);
    const b = pocGarden!(o);
    for (let i = 0; i < 80; i += 1) {
      a.simulate(0.125);
      b.simulate(0.125);
      c.same("state (v1 fields)", shared(a), shared(b));
      c.same("frame", frameOf(a), frameOf(b), `seed ${seed} at ${i}`);
    }
  }
  console.log(c.summary("garden frame shots (3 x 80)"));
});

test("difference: following a small animal, the camera takes its real height; the simulation is the same", { skip }, () => {
  const o: GardenOptions = { seed: "8", width: 96, height: 96, locks: "scene/system.camera.mode=chase" };
  const a = gardenWorld(o);
  const b = pocGarden!(o);
  const small = [...a.entities.values()].find((e) => e.size.height < 0.6)!;
  assert.ok(small, "seed 8 has an animal under 0.6 m");
  a.focus = small.id;
  b.focus = small.id;
  let differ = 0;
  for (let i = 0; i < 40; i += 1) {
    a.simulate(0.125);
    b.simulate(0.125);
    assert.deepEqual(shared(a), shared(b), `the simulation at ${i}`);
    if (JSON.stringify(a.camera.view()) !== JSON.stringify(b.camera.view())) differ += 1;
  }
  assert.ok(differ > 0, `the views differ (${differ} of 40)`);
  console.log(`small-subject views that differ from the proof of concept: ${differ} of 40`);
});
