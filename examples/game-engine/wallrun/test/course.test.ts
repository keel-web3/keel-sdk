// WALLRUN, headless: the autopilot runs every course cleanly -- two wall-runs,
// the rail, every pad, the tunnel, never in the water -- and the same seed
// plays the same way twice. (The game is its own gate for the engine's physics,
// camera and entities: a change that breaks the run shows up here.)
// The proof of concept's tests/wallrun.test.mjs, on the TypeScript sim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSim } from "../src/sim.ts";

const SEEDS = Number(process.env["WALLRUN_SEEDS"] ?? 200);

function run(seed: number): { walls: number; grinds: number; sinks: number; done: boolean; maxZ: number; end: number } {
  const sim = createSim({ seed: String(seed) });
  const end = sim.level.end;
  let walls = 0;
  let grinds = 0;
  let sinks = 0;
  let prev = "";
  let maxZ = -Infinity;
  for (let i = 0; i < 90; i += 1) {
    sim.simulate(0.2);
    const m = sim.body.mode;
    if (m === "wall" && prev !== "wall") walls += 1;
    if (m === "grind" && prev !== "grind") grinds += 1;
    if (m === "sink" && prev !== "sink") sinks += 1;
    prev = m;
    if (sim.body.pos[2] < maxZ - 20) break; // (back at the start: the course is done)
    maxZ = Math.max(maxZ, sim.body.pos[2]);
  }
  return { walls, grinds, sinks, done: maxZ > end - 5, maxZ, end };
}

test(`the autopilot runs ${SEEDS} courses cleanly`, () => {
  const bad: string[] = [];
  for (let s = 1; s <= SEEDS; s += 1) {
    const r = run(s);
    if (r.walls < 2 || r.grinds < 1 || r.sinks > 0 || !r.done) bad.push(`${s}: walls ${r.walls} grinds ${r.grinds} sinks ${r.sinks} z ${r.maxZ.toFixed(0)}/${r.end.toFixed(0)}`);
  }
  assert.deepEqual(bad, [], `${bad.length} courses went wrong:\n${bad.join("\n")}`);
});

test("the same seed plays the same way", () => {
  const a = createSim({ seed: "77" });
  const b = createSim({ seed: "77" });
  a.simulate(9);
  b.simulate(9);
  assert.deepEqual(a.body.pos, b.body.pos);
  assert.deepEqual(a.frame().capsules, b.frame().capsules);
  assert.deepEqual(a.cam.view(), b.cam.view());
});

test("the player takes over with W, the view steers the run, and idling hands it back", () => {
  const sim = createSim({ seed: "3" });
  sim.simulate(0.5);
  sim.key("Meta", true); sim.simulate(0.2); sim.key("Meta", false);
  assert.equal(sim.driver, "autopilot", "a modifier doesn't take control");
  sim.key("w", true);
  sim.simulate(0.05);
  assert.equal(sim.driver, "player");
  assert.equal(sim.cam.mode, "orbit");
  sim.input.look(400, 0);
  sim.simulate(0.6);
  const v = sim.body.vel;
  assert.ok(Math.abs(Math.atan2(v[0], v[2]) - sim.cam.yaw) < 0.05, "W runs where the view looks");
  sim.key("w", false);
  sim.simulate(8.2);
  assert.equal(sim.driver, "autopilot");
  assert.equal(sim.cam.mode, "chase");
});
