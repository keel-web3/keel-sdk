// src/audio against NOCTURNES' own music: the engine's scoreOf, fed a
// NOCTURNES genome through moodOfNocturnes, must make NOCTURNES' plan byte for
// byte (JSON), and the engine's samples must be NOCTURNES' samples number for
// number. NOCTURNES is imported from its repo (../keel-nocturnes, or
// NOCTURNES=path) and never written to.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scoreOf, streamOf } from "../src/audio/score.js";
import { moodOfNocturnes, themeForItems } from "../src/audio/nocturnes.js";
import { makeSampleData } from "../src/audio/samples.js";

const here = dirname(fileURLToPath(import.meta.url));
const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
const N = (p) => import(pathToFileURL(`${NOCTURNES}/src/${p}`).href);
const [nMusic, nGenome, nRng, nThemes, nSamples] = await Promise.all([N("music.js"), N("genome.js"), N("rng.js"), N("themes.js"), N("samples.js")]);

const counts = {};
const count = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const engine = (g) => { const m = moodOfNocturnes(g); return scoreOf(m, m.seed); };
const same = (k, g, msg) => { assert.equal(JSON.stringify(engine(g)), JSON.stringify(nMusic.scoreOf(g)), msg); count(k); };
const genome = (t) => nGenome.makeGenome(nRng.seedFromToken(t));

test("plans: tokens 1..300, the engine's = NOCTURNES' (JSON, byte for byte)", () => {
  for (let t = 1; t <= 300; t += 1) same("plans tokens 1..300", genome(t), `token ${t}`);
  assert.equal(counts["plans tokens 1..300"], 300);
});

test("plans: rooms without a theme (workstation, floor, the things on the sill) and with no hue", () => {
  for (let t = 1; t <= 60; t += 1) {
    const g = genome(t);
    g.canvas = { ...g.canvas, theme: "Loose" }; // (themeOfScene falls to the setting, then to what's placed)
    same("plans without a theme", g, `token ${t} loose`);
    const h = genome(t);
    h.canvas = { ...h.canvas, theme: undefined };
    h.setting = "Sill";
    same("plans without a theme", h, `token ${t} sill`);
    const p = genome(t);
    p.palette = { ...p.palette, hue: undefined, ramps: undefined, scheme: "Nope" }; // (the hue drawn by the seed; an unknown harmony)
    p.view = { ...p.view, eclipse: t % 3 === 0 };
    same("plans with no hue / eclipse", p, `token ${t} no hue`);
  }
});

test("plans: every pin (recipe.music) the studio can set", () => {
  const C = nMusic.MUSIC_CHOICES;
  let r = 7;
  const rnd = () => { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; };
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  for (let t = 1; t <= 120; t += 1) {
    const music = {};
    if (rnd() < 0.4) music.theme = pick([...C.theme, "Nope"]);
    if (rnd() < 0.4) music.keys = pick(C.keys);
    if (rnd() < 0.4) music.lead = pick(C.lead);
    if (rnd() < 0.4) music.bass = pick(C.bass);
    if (rnd() < 0.4) music.kit = pick(C.kit);
    if (rnd() < 0.4) music.mode = pick(C.mode);
    if (rnd() < 0.4) music.key = String(Math.floor(rnd() * 12));
    if (rnd() < 0.4) music.tempo = pick(C.tempo);
    if (rnd() < 0.1) music.theme = "";
    const g = genome(t);
    g.recipe = { music };
    same("plans with pins", g, `token ${t} ${JSON.stringify(music)}`);
  }
});

test("themeForItems: the engine's copy picks NOCTURNES' theme", () => {
  const realms = [["Desk", "lamp"], ["Relic", "console"], ["Occult", "candles"], ["Still Life", "Mug"], ["Relic", "vinyl"], ["Decor", "vase"], ["Relic", "boombox"], ["Still Life", "Drink"], ["Relic", "phone"], ["Decor", "cat"], ["Nope", "thing"]];
  for (let i = 0; i < 2000; i += 1) {
    const S = streamOf(`items ${i}`);
    const items = Array.from({ length: S.int(0, 5) }, () => { const [realm, key] = S.pick(realms); return { realm, key }; });
    const a = nThemes.themeForItems(items, streamOf(`t ${i}`))?.name ?? null;
    const b = themeForItems(items, streamOf(`t ${i}`));
    assert.equal(b, a, JSON.stringify(items));
    count("themeForItems");
  }
});

test("samples: the engine's instruments = NOCTURNES' (every sample, every value)", () => {
  // (NOCTURNES hands out AudioBuffers; Node has none, so a plain one stands in.)
  globalThis.AudioBuffer ??= class { constructor({ length, sampleRate }) { this.length = length; this.sampleRate = sampleRate; this.data = new Float32Array(length); } copyToChannel(x) { this.data.set(x); } getChannelData() { return this.data; } };
  const rate = 22050;
  const kinds = new Set();
  for (const t of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
    const plan = nMusic.scoreOf(genome(t));
    kinds.add(`${plan.keys}/${plan.lead}/${plan.bass}`);
    const a = nSamples.makeSamples(plan, rate);
    const b = makeSampleData(plan, rate);
    for (const part of ["keys", "lead", "bass", "drums"]) {
      assert.deepEqual(Object.keys(b[part]), Object.keys(a[part]));
      for (const k of Object.keys(a[part])) {
        const x = a[part][k].getChannelData(0);
        const y = b[part][k];
        assert.ok(Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength)), `token ${t} ${part} ${k}`);
        count("samples (arrays identical)");
      }
    }
  }
  assert.ok(kinds.size >= 5, "the tokens cover several instruments");
});

test("summary", () => {
  console.log(`audio equality checks (all identical):\n${Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`);
});
