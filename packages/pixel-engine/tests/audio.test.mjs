// The score, the moods and the instruments, in Node: plans are plain data
// (deterministic, NaN-free, different from seed to seed), intensity is plain
// numbers, and the instruments are Float32Arrays that sound (and never clip).

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BANDS, CHOICES, WEATHER_KINDS, moodFor, scoreOf } from "../src/audio/score.js";
import { moodOfNocturnes } from "../src/audio/nocturnes.js";
import { intensityMix, voice } from "../src/audio/player.js";
import { makeSampleData } from "../src/audio/samples.js";
import { encodeWav, measureLoop } from "../src/audio/wav.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
const N = (p) => import(pathToFileURL(`${NOCTURNES}/src/${p}`).href);
const [nGenome, nRng] = await Promise.all([N("genome.js"), N("rng.js")]);

/** Every number in a plan is finite. */
function finite(x, path = "plan") {
  if (typeof x === "number") assert.ok(Number.isFinite(x), `${path} is ${x}`);
  else if (Array.isArray(x)) x.forEach((v, i) => finite(v, `${path}[${i}]`));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) finite(v, `${path}.${k}`);
}
const combo = (p) => [p.keys, p.lead, p.bass, p.kit].join("|");
const WALLRUN = { name: "Night Water", energy: 0.65, darkness: 0.7, weather: ["waves", "wind"] };

test("determinism: the same mood and seed make the same plan; another seed another", () => {
  for (const spec of [{}, WALLRUN, { energy: 0, darkness: 0 }, { energy: 1, darkness: 1, weather: ["rain"] }]) {
    const mood = moodFor(spec);
    for (let i = 0; i < 20; i += 1) {
      assert.equal(JSON.stringify(scoreOf(mood, `s${i}`)), JSON.stringify(scoreOf(moodFor(spec), `s${i}`)));
      assert.notEqual(JSON.stringify(scoreOf(mood, `s${i}`)), JSON.stringify(scoreOf(mood, `s${i + 1}`)));
    }
  }
  // (A named band on its own, no mood: a NOCTURNES theme's band for a game.)
  assert.equal(JSON.stringify(scoreOf({ band: "Nightcap" }, 7)), JSON.stringify(scoreOf({ band: "Nightcap" }, 7)));
  assert.equal(scoreOf({ band: "Nightcap" }, 7).theme, "Nightcap");
});

test("plans are whole: finite numbers, a loop of 32-40 bars, every bar a chord, lo-fi tempo", () => {
  const moods = [moodFor(WALLRUN), moodFor({ energy: 0.1 }), moodFor({ energy: 1, darkness: 0.95 }), ...Object.keys(BANDS).map((band) => ({ band }))];
  for (const mood of moods) {
    for (let i = 0; i < 25; i += 1) {
      const p = scoreOf(mood, `whole ${i}`);
      finite(p);
      assert.ok([32, 36, 40].includes(p.loopBars));
      assert.equal(p.bars.length, p.loopBars);
      assert.ok(p.bpm >= 60 && p.bpm <= 98, `bpm ${p.bpm}`);
      assert.ok(Math.abs(p.loopSec - p.loopBars * p.barSec) < 1e-9);
      assert.ok(p.room[0] === "vinyl", "the record's crackle is always there");
      for (const b of p.bars) for (const m of voice(p, b.chord, null)) assert.ok(m >= 40 && m <= 84);
    }
  }
});

test("diversity: NOCTURNES tokens 1..200 through the engine, and games from their seeds", () => {
  const report = [];
  const nocturnes = Array.from({ length: 200 }, (_, i) => { const m = moodOfNocturnes(nGenome.makeGenome(nRng.seedFromToken(i + 1))); return scoreOf(m, m.seed); });
  const tally = (plans) => ({ combos: new Set(plans.map(combo)).size, distinct: new Set(plans.map((p) => JSON.stringify(p))).size, keys: new Set(plans.map((p) => `${p.tonic}${p.mode}`)).size, tempi: new Set(plans.map((p) => Math.round(p.bpm))).size });
  const n = tally(nocturnes);
  report.push(`NOCTURNES 1..200: ${n.combos} instrument combos, ${n.distinct}/200 distinct plans, ${n.keys} key+mode, ${n.tempi} tempi`);
  assert.equal(n.combos, 122); // (NOCTURNES' own count)
  assert.equal(n.distinct, 200);
  for (const [name, spec] of Object.entries({ wallrun: WALLRUN, idle: { energy: 0.1, darkness: 0.3 }, driving: { energy: 1, darkness: 0.9, weather: ["rain"] } })) {
    const mood = moodFor(spec);
    const plans = Array.from({ length: 200 }, (_, i) => scoreOf(mood, `${name} ${i}`));
    const t = tally(plans);
    report.push(`${name} (200 seeds): ${t.combos} combos, ${t.distinct}/200 distinct, ${t.keys} key+mode, ${t.tempi} tempi`);
    assert.ok(t.combos >= 100, `${name}: ${t.combos} combos`);
    assert.equal(t.distinct, 200);
    assert.ok(t.keys >= 12, `${name}: ${t.keys} keys`);
  }
  console.log(report.join("\n"));
});

test("moods: energy and darkness move the band the way they say", () => {
  const avg = (spec, f) => { const m = moodFor(spec); let s = 0; for (let i = 0; i < 150; i += 1) s += f(scoreOf(m, `m${i}`)); return s / 150; };
  assert.ok(avg({ energy: 1 }, (p) => p.bpm) > avg({ energy: 0 }, (p) => p.bpm) + 10, "driving is faster");
  assert.ok(avg({ energy: 1 }, (p) => (p.kit === "boombap" ? 1 : 0)) > avg({ energy: 0 }, (p) => (p.kit === "boombap" ? 1 : 0)) + 0.2, "driving is boom-bap");
  assert.ok(avg({ energy: 0 }, (p) => (["brushed", "soft"].includes(p.kit) ? 1 : 0)) > 0.4, "idle is brushed and soft");
  assert.ok(avg({ darkness: 1 }, (p) => (p.family === "minor" ? 1 : 0)) > 0.9, "night is minor");
  assert.ok(avg({ darkness: 0 }, (p) => (p.family === "major" ? 1 : 0)) > 0.9, "day is major");
  assert.ok(avg({ darkness: 1 }, (p) => p.mix.cutoff) < avg({ darkness: 0 }, (p) => p.mix.cutoff), "night is darker");
  const m = moodFor({ weather: ["waves", "nope", "wind"], room: ["fan", "x"] });
  assert.deepEqual(m.weather, ["waves", "wind"]);
  assert.deepEqual(m.room, ["fan"]);
  for (const w of WEATHER_KINDS) assert.deepEqual(scoreOf(moodFor({ weather: [w] }), 1).weather, [w]);
  for (const x of [-1, 0, 0.5, 1, 2, NaN, "x"]) finite(moodFor({ energy: x, darkness: x }), `moodFor(${x})`);
});

test("pins: any choice fixed, the seed decides the rest", () => {
  const mood = moodFor(WALLRUN);
  for (let i = 0; i < 40; i += 1) {
    const S = `pin ${i}`;
    const pins = { keys: CHOICES.keys[i % 7], lead: CHOICES.lead[i % 8], bass: CHOICES.bass[i % 4], kit: CHOICES.kit[i % 6], mode: CHOICES.mode[i % 7], key: CHOICES.key[i % 12], tempo: 70 + i };
    const p = scoreOf(mood, S, { pins });
    assert.equal(p.keys, pins.keys); assert.equal(p.lead, pins.lead); assert.equal(p.bass, pins.bass); assert.equal(p.kit, pins.kit);
    assert.equal(p.mode, pins.mode); assert.equal(p.tonic, i % 12); assert.equal(p.bpm, 70 + i);
    assert.equal(scoreOf(mood, S, { pins: { key: String(i % 12) } }).tonic, i % 12);
    const b = scoreOf(mood, S, { pins: { band: "Retro Den" } });
    assert.equal(b.theme, "Retro Den"); assert.equal(b.mode === "dorian" || b.mode === "harmonic", true);
    finite(p);
  }
  // (A tempo pinned on the mood itself: moodFor({ tempo: 84 }).)
  assert.equal(scoreOf(moodFor({ tempo: 84 }), 3).bpm, 84);
  const [lo, hi] = [72, 76];
  for (let i = 0; i < 30; i += 1) { const bpm = scoreOf(moodFor({ tempo: [lo, hi] }), i).bpm; assert.ok(bpm >= lo && bpm <= hi); }
});

test("intensity: layers in and out by plain numbers; 0.5 is the plan as composed", () => {
  const mid = intensityMix(0.5);
  assert.deepEqual([mid.keys, mid.drums, mid.bass, mid.lead, mid.lift, mid.rate], [1, 1, 1, 1, 0, 1]);
  assert.ok(mid.focus >= 20000, "open by the middle");
  const idle = intensityMix(0);
  assert.ok(idle.drums < 0.4 && idle.lead === 0 && idle.focus < 1000 && idle.rate < 1);
  const full = intensityMix(1);
  assert.ok(full.lift === 1 && full.rate > 1 && full.rate <= 1.1);
  assert.equal(intensityMix(1, { tempo: 0 }).rate, 1);
  let prev = null;
  for (let x = -0.5; x <= 1.5; x += 0.01) {
    const m = intensityMix(x);
    for (const k of ["keys", "drums", "bass", "lead", "focus", "lift", "rate"]) {
      assert.ok(Number.isFinite(m[k]), `${k} at ${x}`);
      if (prev) assert.ok(m[k] >= prev[k] - 1e-12, `${k} never falls as intensity rises`);
    }
    for (const k of ["keys", "drums", "bass", "lead", "lift"]) assert.ok(m[k] >= 0 && m[k] <= 1);
    prev = m;
  }
  finite(intensityMix(NaN));
});

test("instruments: every sample sounds, never clips, no NaN; different seeds make different instruments", () => {
  const rate = 22050;
  const seen = new Set();
  for (const [i, spec] of [WALLRUN, { energy: 0.1 }, { energy: 1, darkness: 1 }].entries()) {
    const p = scoreOf(moodFor(spec), `inst ${i}`);
    const s = makeSampleData(p, rate);
    for (const part of ["keys", "lead", "bass", "drums"]) {
      for (const [k, x] of Object.entries(s[part])) {
        const m = measureLoop([x], rate);
        assert.equal(m.nan, 0, `${part} ${k}`);
        assert.ok(m.peak > 0.5 && m.peak <= 0.91, `${part} ${k} peak ${m.peak}`);
        assert.ok(m.rmsDb > -45, `${part} ${k} is ${m.rmsDb} dB`);
      }
    }
    seen.add(s.drums.kick.slice(0, 2000).join(","));
  }
  assert.equal(seen.size, 3, "every seed's kick is its own");
});

test("wav: a loop encodes to a WAV and measures", () => {
  const rate = 8000;
  const x = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / rate)); // (100 whole cycles: seamless)
  const bytes = encodeWav([x, x], rate);
  assert.equal(bytes.length, 44 + rate * 4);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  const m = measureLoop([x, x], rate);
  assert.ok(m.seamless && Math.abs(m.rmsDb - -9) < 0.2 && m.edgeDiffDb < 0.5);
  const cut = x.slice(0, rate - 20); // (a cycle broken off: a click at the wrap)
  assert.equal(measureLoop([cut], rate).seamless, false);
});
