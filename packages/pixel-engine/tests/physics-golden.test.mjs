// The character body pinned: recorded input sequences through fixed worlds of
// boxes, a rail and water, fingerprinted step by step (position, velocity,
// mode and events, to the last bit). Written BEFORE the body learnt wedges, so
// a boxes-only world is proven to behave exactly as it did. If one of these
// moves, the body's feel moved -- WALLRUN's autopilot and every project's
// tuning with it. (Re-pin only on purpose, with the reason in the commit.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCharacter } from "../src/physics/character.js";

const DT = 1 / 120;
const slab = (x0, x1, z0, z1, y = 0.35, mat = 1) => ({ c: [(x0 + x1) / 2, y - 1.5, (z0 + z1) / 2], h: [(x1 - x0) / 2, 1.5, (z1 - z0) / 2], mat });
const wall = (x, z0, z1, top = 9, thick = 0.5, yaw = 0) => ({ c: [x, (top - 3) / 2, (z0 + z1) / 2], h: [thick / 2, (top + 3) / 2, (z1 - z0) / 2], yaw, mat: 0 });

// A little course: a start pad, a walled corridor over water, a pad, a rail over water, a pad with a turned wall, hops.
export const COURSE = (() => {
  const boxes = [slab(-4, 4, -6, 15), wall(-3, 15, 33), wall(3, 15, 33), slab(-4, 4, 33, 40)];
  const rail = [];
  for (let k = 0; k <= 10; k += 1) rail.push([Math.sin((Math.PI * k) / 10) ** 2 * 1.5, 1.1 + 0.3 * Math.sin((Math.PI * k) / 10), 41.5 + k * 1.6]);
  boxes.push(slab(-4, 4, 59, 68), { c: [1.5, 1.5, 64], h: [1.6, 3, 0.3], yaw: 0.4, mat: 0 });
  boxes.push(slab(-1.5, 1.5, 70.5, 73, 0.6), slab(-0.5, 2.5, 75.5, 78, 0.9), slab(-4, 4, 80.5, 90));
  return { boxes, rails: [rail], waterY: 0, spawn: [0, 0.45, -4] };
})();

// Every step, to the bit: position, velocity, mode, events.
export function trace(world, drive, steps, tuning) {
  const body = createCharacter({ ...world, tuning });
  const h = createHash("sha256");
  const buf = new Float64Array(7);
  const modes = {};
  const events = {};
  for (let i = 0; i < steps; i += 1) {
    body.step(DT, drive(body, i));
    buf.set([...body.pos, ...body.vel, body.facing]);
    h.update(Buffer.from(buf.buffer));
    h.update(body.mode);
    for (const e of body.events) { h.update(e.type); events[e.type] = (events[e.type] ?? 0) + 1; }
    modes[body.mode] = (modes[body.mode] ?? 0) + 1;
  }
  return { hash: h.digest("hex").slice(0, 24), modes, events, body };
}

// A closed-loop pilot: its inputs are a pure function of the body's state, so the run is one recorded sequence.
export function coursePilot(body, i) {
  const [x, , z] = body.pos;
  let move = [0, 1];
  let jump = false;
  if (z > 11 && z < 15) move = [-0.55, 1]; // (angle at the left wall)
  if (z > 13.2 && z < 14 && body.mode === "ground") jump = true;
  if (body.mode === "wall" && body.wallTime > 0.5 && x < 0) jump = true; // (kick across)
  if (body.mode === "wall" && body.wallTime > 0.55 && x > 0) jump = true;
  if (z > 15 && z < 33 && body.mode === "air") move = [Math.sign(body.vel[0]) * 0.8, 1]; // (on across, the way the kick went)
  if (z > 36 && z < 40 && body.mode === "ground") { move = [-x * 0.6, 1]; jump = z > 39.2; }
  if (z > 40 && z < 58 && body.mode === "air") move = [-x * 0.6, 1];
  if (z > 66.5 && z < 68 && body.mode === "ground") jump = true;
  if (z > 72 && z < 73 && body.mode === "ground") jump = true;
  if (z > 77 && z < 78 && body.mode === "ground") jump = true;
  if (z > 86) move = [0, 0];
  return { move, jump, hold: !(i % 97 < 6) };
}

// An open-loop sequence: seeded (an LCG), the stick wandering, jumps tapped and held.
export function wanderInputs(seed) {
  let s = seed >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
  let a = r() * Math.PI * 2;
  let hold = 0;
  return () => {
    a += (r() - 0.5) * 0.35;
    const jump = r() < 0.02;
    if (jump) hold = Math.floor(r() * 40);
    hold = Math.max(0, hold - 1);
    return { move: r() < 0.05 ? [0, 0] : [Math.sin(a), Math.cos(a)], jump, hold: hold > 0 };
  };
}
// A yard of turned boxes (every yaw), steps and a trench of water.
export const YARD = (() => {
  const boxes = [slab(-12, 12, -12, 12, 0)];
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2;
    boxes.push({ c: [Math.sin(a) * 8, 1, Math.cos(a) * 8], h: [0.4 + (k % 3) * 0.3, 1 + (k % 4), 1.2], yaw: a + 0.3 * k, mat: 0 });
  }
  boxes.push({ c: [2, 0.25, 2], h: [1, 0.25, 1], yaw: 0.7 }, { c: [2, 0.6, 2], h: [0.6, 0.6, 0.6], yaw: 1.1 });
  boxes.push(slab(-3, 3, 14, 20, 0), { c: [0, -0.2, 13], h: [12, 0.1, 1], mat: 1 });
  return { boxes, rails: [[[-6, 1.3, -5], [-2, 1.6, -5], [3, 1.4, -4]]], waterY: -0.6, spawn: [0, 0.6, 0] };
})();

// Pinned before wedges existed (2026-09-13). The coverage the course must still show is asserted too.
// One re-pin, on purpose: yard2 was fbeaf5aa86f15cf86c689f2f until the wall-run stopped wrapping round a
// wall's end (step 417: the old body ended a run and at once caught the same wall round its corner;
// tests/physics.test.mjs "never wraps round a thin wall's end" is that rule). WALLRUN's 200 seeds ran
// to the bit the same before and after.
const PINS = {
  course: "0c3e439720e333960674580a",
  yard1: "add14accf73f1181cdd00ecd",
  yard2: "3289a9b11f19199fad2d6fe8",
  yard3: "0bc197782ded99aecbcc2ebc",
  skim: "5bf9036cf92fe1f7a408477b",
};

test("golden: the course run is the recorded one, to the bit", () => {
  const r = trace(COURSE, coursePilot, 120 * 16);
  for (const m of ["ground", "air", "wall", "grind"]) assert.ok(r.modes[m] > 0, `the run visits ${m}: ${JSON.stringify(r.modes)}`);
  for (const e of ["jumped", "wallStart", "wallJump", "railStart", "railEnd", "landed"]) assert.ok(r.events[e] > 0, `the run has ${e}: ${JSON.stringify(r.events)}`);
  assert.equal(r.hash, PINS.course, JSON.stringify({ modes: r.modes, events: r.events, pos: r.body.pos }));
});

for (const seed of [1, 2, 3]) {
  test(`golden: wandering the yard (seed ${seed}) is the recorded walk, to the bit`, () => {
    const next = wanderInputs(seed);
    const r = trace(YARD, () => next(), 120 * 20);
    assert.equal(r.hash, PINS[`yard${seed}`], JSON.stringify({ modes: r.modes, events: r.events, pos: r.body.pos }));
  });
}

test("golden: a skim and a sink are the recorded ones", () => {
  // Fast off a pad over open water: it skims, slows, sinks, respawns.
  const world = { boxes: [slab(-3, 3, -3, 6, 0.4)], rails: [], waterY: 0, spawn: [0, 0.5, -2] };
  const r = trace(world, (b, i) => ({ move: [0, i < 300 ? 1 : 0], jump: false, hold: false }), 120 * 8);
  for (const e of ["skimStart", "splashIn", "respawn"]) assert.ok(r.events[e] > 0, `${e}: ${JSON.stringify(r.events)}`);
  assert.equal(r.hash, PINS.skim, JSON.stringify({ modes: r.modes, events: r.events }));
});
