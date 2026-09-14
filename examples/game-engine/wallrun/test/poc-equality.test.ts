// WALLRUN beside the proof of concept's own projects/wallrun (read only): the
// same course box for box, and the same run to the bit -- the body, the
// driver, the view, the runner's capsules, the particles and the look --
// under the autopilot and with a player dropping in. (The engine packages are
// bit-identical to the proof of concept's, so the game must be too.)

import { test } from "node:test";
import { POC, counter, hasPoc, poc } from "./reference.ts";
import { createSim } from "../src/sim.ts";
import { levelOf } from "../src/level.ts";
import { paletteOf } from "../src/palette.ts";
import { runnerSpecOf } from "../src/sim.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;

test("the course: every seed builds the same boxes, rails, capsules and route as level.js", { skip }, async () => {
  const js = await poc<{ levelOf: typeof levelOf }>("projects/wallrun/level.js");
  const c = counter();
  for (let s = 1; s <= 50; s += 1) {
    const seed = String(s);
    const a = levelOf(seed);
    const b = js.levelOf(seed);
    c.exact("box counts", a.boxes.length, b.boxes.length, `seed ${seed}`);
    a.boxes.forEach((box, i) => c.same("boxes", box, b.boxes[i], `seed ${seed} box ${i}`));
    c.same("rails", a.rails, b.rails, `seed ${seed}`);
    c.same("capsules", a.capsules, b.capsules, `seed ${seed}`);
    c.same("routes", a.route, b.route, `seed ${seed}`);
    c.same("spawn, end, water", [a.spawn, a.end, a.waterY], [b.spawn, b.end, b.waterY], `seed ${seed}`);
  }
  console.log(c.summary("WALLRUN course vs level.js (50 seeds)"));
});

test("the look: palettes and the runner's colours match palette.js", { skip }, async () => {
  const js = await poc<{ paletteOf: typeof paletteOf }>("projects/wallrun/palette.js");
  const c = counter();
  for (let s = 1; s <= 50; s += 1) {
    const seed = String(s);
    c.same("palettes (no wear)", paletteOf(seed), js.paletteOf(seed), `seed ${seed}`);
    const wear = runnerSpecOf(seed).colours;
    c.same("palettes (runner's wear)", paletteOf(seed, wear), js.paletteOf(seed, wear), `seed ${seed}`);
  }
  console.log(c.summary("WALLRUN palettes vs palette.js (50 seeds)"));
});

test("beside the proof of concept's sim, the same run to the bit -- autopilot and player", { skip }, async () => {
  const js = await poc<{ createSim: typeof createSim }>("projects/wallrun/sim.js");
  const c = counter();
  for (const seed of ["1", "2", "5", "13", "77"]) {
    const a = createSim({ seed });
    const b = js.createSim({ seed });
    c.same("looks", a.look, b.look, `seed ${seed}`);
    c.same("runners", a.runner, b.runner, `seed ${seed}`);
    for (let i = 0; i < 16 * 12; i += 1) {
      // (A player drops in and out at seed-fixed times: the arbiter, the orbit and the blends are in it too.)
      if (seed === "5" && i === 40) { a.key("d", true); b.key("d", true); }
      if (seed === "5" && i === 45) { a.input.look(120, -30); b.input.look(120, -30); }
      if (seed === "5" && i === 60) { a.key("d", false); b.key("d", false); }
      a.simulate(1 / 12);
      b.simulate(1 / 12);
      const at = `seed ${seed} at ${i}`;
      c.same("bodies (pos, vel, mode) and drivers", [a.body.pos, a.body.vel, a.body.mode, a.driver], [b.body.pos, b.body.vel, b.body.mode, b.driver], at);
      c.same("views", a.cam.view(), b.cam.view(), at);
      const fa = a.frame();
      const fb = b.frame();
      c.same("frame capsules (level + runner)", fa.capsules, fb.capsules, at);
      c.same("frame particles", fa.particles, fb.particles, at);
      c.same("frame views (time, sun)", fa.view, fb.view, at);
      c.exact("surfaces", a.surface(), b.surface(), at);
    }
    c.same("looks after the run", a.look, b.look, `seed ${seed}`);
  }
  // (A new target size and a reload: the style, the arm and the new seed's look.)
  const a = createSim({ seed: "9", width: 64, height: 64 });
  const b = js.createSim({ seed: "9", width: 64, height: 64 });
  a.setTarget(48, 48); b.setTarget(48, 48);
  a.simulate(2); b.simulate(2);
  a.load("21"); b.load("21");
  a.simulate(3); b.simulate(3);
  c.same("resized and reloaded (look, view, capsules)", [a.look, a.cam.view(), a.frame().capsules], [b.look, b.cam.view(), b.frame().capsules]);
  console.log(c.summary("WALLRUN sim vs sim.js (5 seeds x 192 checkpoints, 16 s)"));
});
