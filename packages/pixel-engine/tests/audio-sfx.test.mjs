// Sound effects in Node: the palette is seeded (the same seed, the same
// sounds; another seed, other sounds), every sound is finite and sounds and
// never clips, the loops go round with no seam, the params stay in range, and
// a real physics body's events turn into the right sounds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOP_NAMES, SFX_NAMES, STYLE_NAMES, SURFACES, bodySfx, paramsFor, sfxSamples, sfxStyle } from "../src/audio/sfx.js";
import { measureLoop } from "../src/audio/wav.js";
import { createCharacter } from "../src/physics/character.js";

const RATE = 22050;
const fp = (x) => { let h = 2166136261; for (let i = 0; i < x.length; i += 13) h = Math.imul(h ^ Math.round(x[i] * 32767), 16777619); return h >>> 0; };

test("palette: seeded, pinnable, every style", () => {
  assert.deepEqual(sfxStyle("wallrun"), sfxStyle("wallrun"));
  assert.notDeepEqual(sfxStyle("wallrun"), sfxStyle("wallrun2"));
  const shoes = new Set();
  for (let i = 0; i < 60; i += 1) shoes.add(sfxStyle(`s${i}`).shoe);
  assert.equal(shoes.size, 3);
  for (const name of STYLE_NAMES) assert.equal(sfxStyle("x", name).name, name);
  const pinned = sfxStyle("x", { name: "chip", shoe: "boot", pitch: 1 });
  assert.equal(pinned.shoe, "boot"); assert.equal(pinned.pitch, 1); assert.equal(pinned.wave, "square");
});

test("sounds: every one finite, heard, under full scale; the loops seamless", () => {
  for (const [seed, style] of [["wallrun", "lofi"], ["7", "chip"], ["b", "soft"], ["c", "clean"]]) {
    const d = sfxSamples(sfxStyle(seed, style), RATE);
    for (const s of SURFACES) assert.equal(d[`step_${s}`].length, 4, "four footfalls a surface, played in turn");
    const oneShots = ["jump", "land", "land_hard", "wallStart", "wallJump", "railStart", "railEnd", "splash", "skimStart", "respawn", "blip", "hover", "select", "back", "confirm", "error"];
    for (const k of [...SURFACES.map((s) => `step_${s}`), ...oneShots]) {
      for (const x of d[k]) {
        const m = measureLoop([x], RATE);
        assert.equal(m.nan, 0, `${seed} ${k}`);
        assert.ok(m.peak > 0.3 && m.peak <= 0.91, `${seed} ${k} peak ${m.peak}`);
        assert.ok(m.rmsDb > -40, `${seed} ${k} ${m.rmsDb} dB`);
        assert.ok(m.seconds <= 1, `${seed} ${k} is short`);
      }
    }
    for (const k of LOOP_NAMES) {
      const m = measureLoop([d[k]], RATE);
      assert.equal(m.nan, 0);
      assert.ok(m.rmsDb > -35 && m.peak <= 0.71, `${seed} ${k} ${m.rmsDb} dB peak ${m.peak}`);
      assert.ok(m.seamless, `${seed} ${k} wraps with a step of ${m.wrapStep} (the loop's own p99 ${m.stepP99})`);
      assert.ok(m.edgeDiffDb < 6, `${seed} ${k} head and tail alike (${m.headDb} / ${m.tailDb})`);
    }
  }
});

test("sounds: deterministic per seed, different between seeds", () => {
  const a = sfxSamples(sfxStyle("one"), RATE);
  const b = sfxSamples(sfxStyle("one"), RATE);
  const c = sfxSamples(sfxStyle("two"), RATE);
  for (const k of Object.keys(a)) {
    const [x, y, z] = [a[k], b[k], c[k]].map((v) => (Array.isArray(v) ? v[0] : v));
    assert.equal(fp(x), fp(y), `${k} the same twice`);
    assert.notEqual(fp(x), fp(z), `${k} differs between seeds`);
  }
  // (The four footfalls on one surface differ from each other.)
  assert.equal(new Set(a.step_stone.map(fp)).size, 4);
});

test("params: every sound's rate, gain, pan and cutoff stay in range for any input", () => {
  const st = sfxStyle("p");
  const inputs = [{}, { speed: -5 }, { speed: 0 }, { speed: 3 }, { speed: 9.5 }, { speed: 14 }, { speed: 40 }, { speed: 1e9 }, { speed: NaN }, { gain: 3, pan: -9 }, { gain: -1, pan: 9 }, { rate: 100 }, { rate: 0 }, { surface: "metal" }, { surface: "lava" }];
  for (const name of [...SFX_NAMES, ...LOOP_NAMES, "nope"]) {
    for (const p of inputs) {
      const q = paramsFor(name, p, st);
      for (const k of ["rate", "gain", "pan", "cutoff"]) assert.ok(Number.isFinite(q[k]), `${name} ${k} ${JSON.stringify(p)}`);
      assert.ok(q.rate >= 0.25 && q.rate <= 4 && q.gain >= 0 && q.gain <= 2 && q.pan >= -1 && q.pan <= 1 && q.cutoff >= 100 && q.cutoff <= 20000, `${name} ${JSON.stringify(q)}`);
    }
  }
  assert.equal(paramsFor("step", { surface: "lava" }, st).key, "step_stone");
  assert.equal(paramsFor("land", { speed: 4 }, st).key, "land");
  assert.equal(paramsFor("land", { speed: 12 }, st).key, "land_hard");
  // Harder landings are louder and lower; faster grinds higher and louder; wind rises with speed.
  assert.ok(paramsFor("land", { speed: 12 }, st).gain > paramsFor("land", { speed: 3 }, st).gain);
  assert.ok(paramsFor("land", { speed: 12 }, st).rate < paramsFor("land", { speed: 3 }, st).rate);
  assert.ok(paramsFor("grind", { speed: 13 }, st).rate > paramsFor("grind", { speed: 5 }, st).rate);
  assert.ok(paramsFor("wind", { speed: 18 }, st).gain > paramsFor("wind", { speed: 4 }, st).gain);
  assert.equal(paramsFor("wind", { speed: 1 }, st).gain, 0);
});

/** A stand-in for createSfx: it only writes down what it was asked to play. */
function recorder() {
  const log = [];
  const loops = {};
  return {
    log, loops,
    play(name, p) { log.push([name, p]); return {}; },
    loop(name, p) { const h = { sets: [p], stopped: false, set(q) { h.sets.push(q); }, stop() { h.stopped = true; } }; (loops[name] ??= []).push(h); return h; },
  };
}

test("bodySfx: a real body (src/physics/character.js) runs, jumps, lands, wall-runs, skims and sinks", () => {
  // A floor over water, a wall to run on, a rail over the water.
  const boxes = [{ c: [0, -1.5, -14], h: [3, 1.5, 26], mat: 1 }, { c: [2.2, 2, 6], h: [0.25, 4, 8], mat: 0 }];
  const rails = [[[0, 1.4, 14], [0, 1.2, 30]]];
  const body = createCharacter({ boxes, rails, waterY: -0.4, spawn: [0, 0.2, -38] });
  const rec = recorder();
  const feet = bodySfx(rec, { surfaceOf: (b) => (b.pos[2] > 0 ? "metal" : "stone") });
  const seen = new Set();
  const dt = 1 / 120;
  const run = (sec, input) => { for (let i = 0; i < sec / dt; i += 1) { body.step(dt, input(i * dt)); for (const e of body.events) seen.add(e.type); feet.update(body, dt); } };
  run(0.5, () => ({ move: [0, 0] })); // (drop onto the floor)
  run(3.5, () => ({ move: [0, 1] })); // (run: ~30 m)
  run(0.6, (t) => ({ move: [0, 1], jump: t < 0.02, hold: true })); // (a jump, and down again)
  run(4, (t) => ({ move: [0.25, 1], jump: t > 0.35 && t < 0.37, hold: true })); // (up the room, off the end, over the water)
  run(3, () => ({ move: [0, 0] })); // (and whatever comes of it)
  const names = rec.log.map(([n]) => n);
  const steps = rec.log.filter(([n]) => n === "step");
  assert.ok(steps.length >= 9 && steps.length <= 16, `footsteps while running: a stride of ~3 m at a full run (${steps.length})`);
  assert.ok(steps.some(([, p]) => p.surface === "stone") && steps.every(([, p]) => SURFACES.includes(p.surface)));
  assert.ok(names.includes("jump") && names.includes("land"), `jump and land (${[...new Set(names)]})`);
  const land = rec.log.find(([n]) => n === "land")[1];
  assert.ok(land.speed > 0);
  // Every event the body raised that has a sound, sounded.
  const want = { jumped: "jump", landed: "land", wallStart: "wallStart", wallJump: "wallJump", railStart: "railStart", railEnd: "railEnd", skimStart: "skimStart", splashIn: "splash", respawn: "respawn" };
  for (const [e, s] of Object.entries(want)) if (seen.has(e)) assert.ok(names.includes(s), `${e} -> ${s}`);
  // Loops: the wind always; grinding / wall-running / skimming held only while the body does it.
  assert.ok(rec.loops.wind?.length === 1 && !rec.loops.wind[0].stopped);
  if (seen.has("grinding")) assert.ok(rec.loops.grind?.length >= 1);
  if (seen.has("wallRunning")) assert.ok(rec.loops.wallrun?.length >= 1);
  for (const k of ["grind", "wallrun", "skim"]) for (const h of rec.loops[k] ?? []) assert.ok(h.stopped || ({ grind: "grind", wallrun: "wall", skim: "skim" })[k] === body.mode, `${k} let go`);
  feet.stop();
  assert.ok(rec.loops.wind[0].stopped);
  console.log(`body events: ${[...seen].sort().join(", ")}\nsounds: ${[...new Set(names)].sort().join(", ")}; loops: ${Object.keys(rec.loops).join(", ")}`);
});

test("bodySfx: each event, scripted", () => {
  const rec = recorder();
  const feet = bodySfx(rec, { wind: false });
  const body = (mode, events, vel = [0, 0, 8]) => ({ mode, events, vel, pos: [0, 0, 0] });
  feet.update(body("air", [{ type: "jumped" }]), 0.01);
  feet.update(body("ground", [{ type: "landed", speed: 11 }]), 0.01);
  feet.update(body("grind", [{ type: "railStart" }, { type: "grinding" }], [0, 0, 12]), 0.01);
  feet.update(body("grind", [{ type: "grinding" }], [0, 0, 13]), 0.01);
  feet.update(body("air", [{ type: "railEnd" }]), 0.01);
  feet.update(body("wall", [{ type: "wallStart" }]), 0.01);
  feet.update(body("air", [{ type: "wallJump" }]), 0.01);
  feet.update(body("skim", [{ type: "skimStart" }]), 0.01);
  feet.update(body("sink", [{ type: "splashIn" }]), 0.01);
  feet.update(body("air", [{ type: "respawn" }]), 0.01);
  assert.deepEqual(rec.log.map(([n]) => n), ["jump", "land", "railStart", "railEnd", "wallStart", "wallJump", "skimStart", "splash", "respawn"]);
  assert.equal(rec.log[1][1].speed, 11);
  assert.equal(rec.loops.grind.length, 1);
  assert.equal(rec.loops.grind[0].sets.at(-1).speed, 13);
  assert.ok(rec.loops.grind[0].stopped && rec.loops.wallrun[0].stopped && rec.loops.skim[0].stopped);
  assert.equal(rec.loops.wind, undefined);
});
