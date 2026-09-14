// The proof of concept's tests/world-garden.test.mjs, ported: 100 seeds lay
// out with nothing overlapping and nothing floating; locks hold without
// moving the rest; the animals and the hero get about; the frame camera shows
// each one's front; four target sizes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf } from "@keel/game-engine/core";
import { restsOn, worldAabb } from "@keel/game-engine/object";
import { gardenWorld } from "../src/garden.ts";

type Bounds = ReturnType<typeof worldAabb>;
// Boxes overlap when they share volume (touching is not overlapping).
const EPS = 1e-6;
const overlap = (a: Bounds, b: Bounds): boolean => a[0] < b[3] - EPS && a[3] > b[0] + EPS && a[1] < b[4] - EPS && a[4] > b[1] + EPS && a[2] < b[5] - EPS && a[5] > b[2] + EPS;

test("100 garden seeds: no two objects overlap, and every object rests on what it stands on", () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const w = gardenWorld({ seed: String(seed), width: 32, height: 32 });
    const objs = [...w.objects.values()];
    assert.ok(objs.length >= 16, `seed ${seed}: ${objs.length} objects`);
    assert.ok(objs.some((o) => String(o.id).startsWith("bench")) && objs.some((o) => String(o.id).startsWith("crate")), `seed ${seed}: benches and crates`);
    // Resting: settled onto a support, and still on it -- the floor under the lawn, the lawn, the plaza, a crate.
    for (const o of objs) {
      const r = w.rests[String(o.id)];
      assert.ok(r && r.rests, `seed ${seed}: ${o.id} rests`);
      const support = r.support === "floor" ? 0 : w.objects.get(String(r.support));
      assert.ok(support !== undefined, `seed ${seed}: ${o.id}'s support ${r.support} exists`);
      assert.ok(restsOn(o, support), `seed ${seed}: ${o.id} on ${r.support}`);
    }
    // Overlaps: every pair but a thing and what it stands on (their faces touch).
    for (let i = 0; i < objs.length; i += 1) {
      for (let k = i + 1; k < objs.length; k += 1) {
        const [a, b] = [objs[i]!, objs[k]!];
        if (w.rests[String(a.id)]!.support === b.id || w.rests[String(b.id)]!.support === a.id) continue;
        if (a.tags.includes("ground") || b.tags.includes("ground")) continue; // (everything stands on the lawn's top face, or on the plaza on it)
        if ((a.id === "plaza" || b.id === "plaza") && [a, b].some((o) => o.tags.includes("bench") || o.tags.includes("lamp"))) continue;
        assert.ok(!overlap(worldAabb(a), worldAabb(b)), `seed ${seed}: ${a.id} overlaps ${b.id}`);
      }
    }
  }
});

test("garden: the animals wander and the hero strolls; nothing is left in the air", () => {
  const w = gardenWorld({ seed: "7", width: 64, height: 64 });
  const start = new Map([...w.entities.values()].map((e) => [e.id, [...e.body.pos]]));
  const states = new Set<string>();
  w.on("*", () => {});
  for (let i = 0; i < 12; i += 1) {
    w.simulate(1);
    for (const e of w.entities.values()) states.add(`${e.id}:${String(e.mind["state"])}`);
  }
  for (const e of w.entities.values()) {
    const s = start.get(e.id)!;
    const moved = Math.hypot(e.body.pos[0] - s[0]!, e.body.pos[2] - s[2]!);
    assert.ok(moved > 0.3, `${e.id} got about (${moved.toFixed(2)} m)`);
    assert.ok(e.body.mode === "ground", `${e.id} is on the ground (${e.body.mode})`);
  }
  assert.ok([...states].some((s) => s.startsWith("hero:sit")), "the hero sat on a bench");
  assert.ok([...states].some((s) => s.startsWith("animal-") && s.endsWith(":sit")), "an animal sat");
});

test("garden locks: species, palette and one bench's material hold; nothing else moves", () => {
  const plain = gardenWorld({ seed: "11" });
  const locks = "tag:animal/species=cat;id:hero/species=frog;id:bench-1/material=paint;scene/render.palette=noir;scene/system.camera.mode=frame";
  const w = gardenWorld({ seed: "11", locks });
  assert.equal(w.layout(), plain.layout(), "the same plaza");
  for (const e of w.entities.values()) if (e.tags.includes("animal")) assert.equal(e.spec.species, "cat");
  assert.equal(w.entities.get("hero")!.spec.species, "frog");
  assert.equal(w.get("material", "bench-1"), "paint");
  assert.equal(w.explain("material", "bench-1").lockedAt, "id:bench-1");
  assert.equal(w.frame().palette.name, "noir");
  // The other benches kept the seed's material; the animals kept their places.
  for (const id of [...w.objects.keys()].filter((k) => k.startsWith("bench-") && k !== "bench-1")) assert.equal(w.get("material", id), plain.get("material", id));
  for (const e of plain.entities.values()) assert.deepEqual(w.entities.get(e.id)!.body.pos, e.body.pos);
  // A lock can't be talked out of it later.
  assert.equal(w.set("runtime", "render.palette", "meadow").ok, false);
  assert.equal(w.set("id:animal-1", "species", "dog").ok, false);
});

test("garden frame mode: the camera goes round the entities, each shown from its front", () => {
  const w = gardenWorld({ seed: "5", width: 96, height: 96, locks: "scene/system.camera.mode=frame;scene/system.camera.cycle=1.5" });
  const seen = new Set<string>();
  for (let i = 0; i < 4 * 12; i += 1) {
    w.simulate(0.125);
    const cam = w.state["camera"] as { showing?: string; at: number } | undefined;
    const id = cam?.showing;
    if (!id || cam.at < 1) continue; // (let the shot settle on its subject)
    seen.add(id);
    const body = w.entities.get(id)!.body;
    const to = [w.camera.eye[0] - body.pos[0], w.camera.eye[2] - body.pos[2]] as const;
    const f = frontOf(body.facing);
    assert.ok(to[0] * f[0] + to[1] * f[2] > 0, `the camera is in front of ${id}`);
  }
  assert.equal(seen.size, w.entities.size, `saw ${[...seen].join(", ")}`);
});

test("garden frames at 32, 64, 128 and 256: the same world, the target rules' style", () => {
  for (const [n, screen] of [[32, 2], [64, 4], [128, 4], [256, 8]] as const) {
    const w = gardenWorld({ seed: "3", width: n, height: n });
    w.simulate(0.5);
    const f = w.frame();
    assert.equal(f.style.screen, screen);
    assert.ok(Object.values(f.palette.ramps).every(([, len]) => len <= f.rules.rampLength));
    assert.ok(f.boxes.length > 20 && f.capsules.length > 30);
    assert.deepEqual(f.stats.dropped.entities, []);
  }
});

test("garden restores exactly: a snapshot mid-stroll draws the same frames as the run that went on", () => {
  const w = gardenWorld({ seed: "9", width: 64, height: 64 });
  w.simulate(4.3);
  const snap = JSON.stringify(w.snapshot());
  w.simulate(1);
  const f = JSON.parse(JSON.stringify(w.frame())) as { palette: { key: string } };
  const g = gardenWorld({ seed: "9", width: 64, height: 64 });
  g.restore(snap);
  g.simulate(1);
  const h = JSON.parse(JSON.stringify(g.frame())) as { palette: { key: string } };
  assert.deepEqual({ ...h, palette: { ...h.palette, key: "" } }, { ...f, palette: { ...f.palette, key: "" } });
});
