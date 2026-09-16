// src/core against NOCTURNES' own modules: every copied export must return
// results IDENTICAL to the original for many seeded inputs. NOCTURNES is
// imported from its repo (../keel-nocturnes, or NOCTURNES=path) and never
// written to.
//
// The quantize step lives inside NOCTURNES' createRenderer closure, so it is
// reached two ways, both without touching a NOCTURNES file:
//   1. its own source text, cut out of render.js and evaluated with the same
//      closure variables -- run on random shade buffers;
//   2. render.js loaded again from a data: URL with one line added that
//      copies each shade buffer just before NOCTURNES quantizes it -- so the
//      engine quantizes the REAL buffers and must match the real frames.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
const NS = (p) => pathToFileURL(`${NOCTURNES}/src/${p}`).href;
const N = (p) => import(NS(p));
const E = (p) => import(new URL(`../src/core/${p}`, import.meta.url).href);

const [nRng, eRng, nMath, eMath, nSdf, eSdf, nPal, ePal, nDith, eDith, nGif, eGif, eQ, nGenome, nRender] = await Promise.all([
  N("rng.js"), E("rng.js"), N("math.js"), E("math.js"), N("sdf.js"), E("sdf.js"), N("palette.js"), E("palette.js"),
  N("dither.js"), E("dither.js"), N("gif.js"), E("gif.js"), E("quantize.js"), N("genome.js"), N("render.js"),
]);

// A local generator for test inputs (not under test): mulberry32.
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const counts = {};
const count = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const same = (k, a, b, msg) => { assert.deepEqual(a, b, msg); count(k); };
// (Bit-exact numbers: deepEqual treats -0 and 0 as different and NaN as equal, as Object.is does.)
const exact = (k, a, b, msg) => { if (!Object.is(a, b)) assert.fail(`${msg}: ${a} !== ${b}`); count(k); };

const SEEDS = Array.from({ length: 200 }, (_, i) => nRng.seedFromToken(i + 1));

test("rng: seeds, rolls, sub-streams and float streams over 10k draws", () => {
  for (let t = 0; t < 1000; t += 1) same("rng", eRng.seedFromToken(t), nRng.seedFromToken(t), `seedFromToken ${t}`);
  for (const col of ["nocturnes-v0", "wallrun", "x"]) same("rng", eRng.seedFromToken(7, col), nRng.seedFromToken(7, col));
  for (const s of ["0x1", "abc", "0xDEADbeef", "f".repeat(64)]) same("rng", eRng.normalizeSeed(s), nRng.normalizeSeed(s));
  assert.throws(() => eRng.normalizeSeed("xyz"));
  for (const seed of SEEDS.slice(0, 40)) {
    const a = nRng.createRoll(seed);
    const b = eRng.createRoll(seed);
    same("rng", b.seed, a.seed);
    for (let slot = 0; slot < 300; slot += 1) {
      exact("rng", b.at(slot), a.at(slot), `at ${slot}`);
      same("rng", b.pick(slot, ["a", "b", "c", "d", "e"]), a.pick(slot, ["a", "b", "c", "d", "e"]));
      same("rng", b.range(slot, -5, 17), a.range(slot, -5, 17));
      same("rng", b.chance(slot, 33), a.chance(slot, 33));
      same("rng", b.weighted(slot, [["x", 3], ["y", 1], ["z", 5]]), a.weighted(slot, [["x", 3], ["y", 1], ["z", 5]]));
    }
  }
  // 10k-draw streams: raw sub-streams, and the float streams generators use.
  for (const seed of SEEDS.slice(0, 12)) {
    for (const slot of [0, 1, 7, 15, 300]) {
      const a = nRng.createRoll(seed).sub(slot);
      const b = eRng.createRoll(seed).sub(slot);
      for (let i = 0; i < 10000; i += 1) exact("rng stream draws", b.next(), a.next(), `sub ${slot} draw ${i}`);
      const fa = nGenome.stream(nRng.createRoll(seed), slot);
      const fb = eRng.stream(eRng.createRoll(seed), slot);
      for (let i = 0; i < 10000; i += 1) {
        const op = i % 6;
        if (op === 0) exact("rng stream draws", fb.f(), fa.f());
        else if (op === 1) exact("rng stream draws", fb.between(-2, 3), fa.between(-2, 3));
        else if (op === 2) exact("rng stream draws", fb.int(0, 9), fa.int(0, 9));
        else if (op === 3) same("rng stream draws", fb.pick(["p", "q", "r"]), fa.pick(["p", "q", "r"]));
        else if (op === 4) same("rng stream draws", fb.chance(0.3), fa.chance(0.3));
        else same("rng stream draws", fb.weighted([[1, 2], [2, 0.5], [3, 7]]), fa.weighted([[1, 2], [2, 0.5], [3, 7]]));
      }
    }
  }
  for (const seed of SEEDS.slice(0, 50)) for (const label of ["a", "sky", "object 3"]) same("rng", eRng.deriveSeed(seed, label), nGenome.deriveSeed(seed, label));
});

test("math: scalars, hashes and loop-safe noise at random points", () => {
  const r = rand(11);
  for (const k of ["TAU"]) exact("math", eMath[k], nMath[k]);
  for (let i = 0; i < 20000; i += 1) {
    const x = (r() - 0.5) * 200;
    const y = (r() - 0.5) * 200;
    const z = (r() - 0.5) * 200;
    const s = Math.floor(r() * 1000);
    const t = r();
    exact("math", eMath.clamp(x, -3, 7), nMath.clamp(x, -3, 7));
    exact("math", eMath.sat(x / 50), nMath.sat(x / 50));
    exact("math", eMath.mix(x, y, t), nMath.mix(x, y, t));
    exact("math", eMath.fract(x), nMath.fract(x));
    exact("math", eMath.smooth(-1, 2, x / 40), nMath.smooth(-1, 2, x / 40));
    exact("math", eMath.tri(x), nMath.tri(x));
    exact("math", eMath.hash2(x, y, s), nMath.hash2(x, y, s));
    exact("math", eMath.hash3(x, y, z, s), nMath.hash3(x, y, z, s));
    exact("math", eMath.vnoise2(x, y, s), nMath.vnoise2(x, y, s));
    exact("math", eMath.wrapNoise2(x, y, 7, s), nMath.wrapNoise2(x, y, 7, s));
    exact("math", eMath.fbm2(x, y, s, 1 + (s % 5)), nMath.fbm2(x, y, s, 1 + (s % 5)));
    exact("math", eMath.loopFbm2(x, y, 3, -2, t, s), nMath.loopFbm2(x, y, 3, -2, t, s));
    const a = [x, y, z];
    const b = [y, z, x];
    same("math", eMath.add(a, b), nMath.add(a, b));
    same("math", eMath.sub(a, b), nMath.sub(a, b));
    same("math", eMath.scale(a, t), nMath.scale(a, t));
    exact("math", eMath.dot(a, b), nMath.dot(a, b));
    same("math", eMath.cross(a, b), nMath.cross(a, b));
    exact("math", eMath.len(a), nMath.len(a));
    same("math", eMath.norm(a), nMath.norm(a));
    same("math", eMath.v3(x, y, z), nMath.v3(x, y, z));
  }
});

test("sdf: every primitive at random points", () => {
  const r = rand(23);
  const profA = [[0, 0], [0.3, 0], [0.35, 0.1], [0.2, 0.5], [0.25, 0.8], [0, 0.85]];
  const pa = nSdf.profile(profA);
  const pb = eSdf.profile(profA);
  same("sdf", [...pb.xs, ...pb.ys, pb.rmax, pb.ymin, pb.ymax], [...pa.xs, ...pa.ys, pa.rmax, pa.ymin, pa.ymax]);
  const planes = Float64Array.from([1, 0, 0, 0.3, -1, 0, 0, 0.3, 0, 1, 0, 0.4, 0, -1, 0, 0.1, 0, 0, 1, 0.2, 0, 0, -1, 0.2, 0.577, 0.577, 0.577, 0.4]);
  for (let i = 0; i < 20000; i += 1) {
    const [x, y, z] = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1];
    const [p, q, s] = [0.05 + r() * 0.5, 0.05 + r() * 0.5, 0.05 + r() * 0.5];
    const rd = r() * 0.04;
    exact("sdf", eSdf.sdSphere(x, y, z, p), nSdf.sdSphere(x, y, z, p));
    exact("sdf", eSdf.sdBox(x, y, z, p, q, s, rd), nSdf.sdBox(x, y, z, p, q, s, rd));
    exact("sdf", eSdf.sdTorus(x, y, z, p, q / 3), nSdf.sdTorus(x, y, z, p, q / 3));
    exact("sdf", eSdf.sdCylinder(x, y, z, p, q, rd), nSdf.sdCylinder(x, y, z, p, q, rd));
    exact("sdf", eSdf.sdCapsule(x, y, z, -p, 0, q, s, p, -q, rd + 0.05), nSdf.sdCapsule(x, y, z, -p, 0, q, s, p, -q, rd + 0.05));
    exact("sdf", eSdf.sdHexPrism(x, y, z, p, q), nSdf.sdHexPrism(x, y, z, p, q));
    exact("sdf", eSdf.sdEllipsoid(x, y, z, p, q, s), nSdf.sdEllipsoid(x, y, z, p, q, s));
    exact("sdf", eSdf.smin(x, y, p), nSdf.smin(x, y, p));
    exact("sdf", eSdf.sdPolygon(x, y, pb.xs, pb.ys), nSdf.sdPolygon(x, y, pa.xs, pa.ys));
    exact("sdf", eSdf.sdLathe(x, y, z, pb, rd), nSdf.sdLathe(x, y, z, pa, rd));
    exact("sdf", eSdf.sdPlanes(x, y, z, planes), nSdf.sdPlanes(x, y, z, planes));
  }
});

// Palette colours and ramp layout compared whole.
const palKey = (p) => JSON.stringify({ c: p.colours, r: p.ramps });

test("palette: OKLCH, harmonies (makePalette) and buildPalette for 200 seeds", () => {
  const r = rand(5);
  for (let i = 0; i < 5000; i += 1) {
    const L = r();
    const C = r() * 0.35;
    const h = r() * 720 - 180;
    same("palette oklch/cmax", ePal.oklch(L, C, h), nPal.oklch(L, C, h));
    exact("palette oklch/cmax", ePal.cmax(L, h), nPal.cmax(L, h));
    same("palette oklch/cmax", ePal.hueName(h), nPal.hueName(h));
    exact("palette oklch/cmax", ePal.wrap(h), nPal.wrap(h));
  }
  exact("palette", ePal.TABLE, nPal.TABLE);
  exact("palette", ePal.TRANSPARENT, nPal.TRANSPARENT);
  same("palette", ePal.SCHEME_NAMES, nGenome.SCHEME_NAMES);
  for (const seed of SEEDS) {
    // The seed's harmony, drawn the way a genome draws it (slot 0), and forced to every scheme.
    const specs = [
      [nGenome.makePalette(nGenome.stream(nRng.createRoll(seed), 0)), ePal.makePalette(eRng.stream(eRng.createRoll(seed), 0))],
    ];
    const name = nGenome.SCHEME_NAMES[nRng.createRoll(seed).at(3) % nGenome.SCHEME_NAMES.length];
    const force = { scheme: name, hue: nRng.createRoll(seed).at(4) % 360 };
    specs.push([nGenome.makePalette(nGenome.stream(nRng.createRoll(seed), 9), force), ePal.makePalette(eRng.stream(eRng.createRoll(seed), 9), force)]);
    for (const [a, b] of specs) {
      same("palette specs (200 seeds x 2)", JSON.stringify(b), JSON.stringify(a));
      exact("palette", ePal.hueCount(b), nPal.hueCount(a));
      same("palette builds (colours exact)", palKey(ePal.buildPalette(b)), palKey(nPal.buildPalette(a)));
    }
  }
  // What real genomes carry (themes and studio forces included).
  for (let t = 1; t <= 40; t += 1) {
    const g = nGenome.makeGenome(nRng.seedFromToken(t));
    same("palette builds (colours exact)", palKey(ePal.buildPalette(g.palette)), palKey(nPal.buildPalette(g.palette)));
  }
});

test("dither: every screen's threshold map, geometry, screenIndex and pairing", () => {
  same("dither", eDith.SCREEN_IDS, nDith.SCREEN_IDS);
  same("dither", eDith.SCREEN_GEOM, nDith.SCREEN_GEOM);
  for (const id of nDith.SCREEN_IDS) {
    same("dither", eDith.SCREENS[id].name, nDith.SCREENS[id].name);
    for (let y = -20; y < 84; y += 1) for (let x = -20; x < 84; x += 1) exact(`dither threshold cells`, eDith.SCREENS[id].at(x, y), nDith.SCREENS[id].at(x, y), `${id} at ${x},${y}`);
    same("dither", eDith.measureScreen(eDith.SCREENS[id].at, 20), nDith.measureScreen(nDith.SCREENS[id].at, 20));
  }
  const r = rand(77);
  const lums = Float32Array.from({ length: 22 }, (_, i) => (i / 21) ** 1.1);
  for (let i = 0; i < 60000; i += 1) {
    const id = nDith.SCREEN_IDS[i % nDith.SCREEN_IDS.length];
    const screen = { id, steps: 2 + Math.floor(r() * 8), bias: Math.floor(r() * 3) };
    const light = r() * 1.3 - 0.15;
    const x = Math.floor(r() * 256);
    const y = Math.floor(r() * 256);
    const len = 3 + Math.floor(r() * 20);
    exact("dither screenIndex", eDith.screenIndex(light, x, y, screen, len), nDith.screenIndex(light, x, y, screen, len));
    exact("dither screenIndex", eDith.screenIndex(light, x, y, screen, len, lums.subarray(0, len)), nDith.screenIndex(light, x, y, screen, len, lums.subarray(0, len)));
  }
  for (const a of nDith.SCREEN_IDS) for (const b of nDith.SCREEN_IDS) exact("dither screenPair", eDith.screenPair(a, b), nGenome.screenPair(a, b));
});

// ---- quantize ----

const renderSrc = readFileSync(`${NOCTURNES}/src/render.js`, "utf8");

/** The text of the function starting at `header` in `src` (brace-matched). */
function cutFunction(src, header) {
  const at = src.indexOf(header);
  assert.ok(at >= 0, `render.js has no "${header}"`);
  let depth = 0;
  for (let i = src.indexOf("{", at + header.length - 1); i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error("unbalanced");
}

// NOCTURNES' own quantize, BAYER4Q and accentCode, from its source text.
const bayerLine = renderSrc.match(/^const BAYER4Q = .*;$/mu)[0];
const nAccentCode = new Function(`${bayerLine}\n${cutFunction(renderSrc, "function accentCode(s) {")}\nreturn accentCode;`)();
const nBayer4q = new Function(`${bayerLine}\nreturn BAYER4Q;`)();
const haloLine = renderSrc.match(/^const HALO_SCREEN = .*;$/mu)[0];
const nHalo = new Function(`${haloLine}\nreturn HALO_SCREEN;`)();
const nLayerKeys = new Function(`${renderSrc.match(/^const LAYER_KEYS = .*;$/mu)[0]}\nreturn LAYER_KEYS;`)();
const quantizeText = cutFunction(renderSrc, "function quantize(buf, region = null, out = new Uint8Array(n), t = 0) {");
const nQuantizeFactory = new Function("width", "height", "n", "screens", "ramps", "lums", "screenIndex", "TAU", `${bayerLine}\n${haloLine}\n${quantizeText}\nreturn quantize;`);
const nLumsText = renderSrc.match(/const lums = (Float32Array\.from\(pal\.colours, \(c\) => \{[\s\S]*?\n {2}\}\));/u)[1];
const nLumsOf = new Function("pal", `return ${nLumsText};`);

test("quantize: constants and helpers match render.js", () => {
  same("quantize", eQ.BAYER4Q, nBayer4q);
  same("quantize", eQ.HALO_SCREEN, nHalo);
  same("quantize", eQ.LAYER_KEYS, nLayerKeys);
  for (const accent of [0, 1, 2, true, false, 3]) for (const share of [undefined, 0, 0.01, 0.2, 0.5, 0.96, 0.97, 1]) exact("quantize", eQ.accentCode({ accent, share }), nAccentCode({ accent, share }));
  for (const seed of SEEDS.slice(0, 60)) {
    const pal = nPal.buildPalette(nGenome.makePalette(nGenome.stream(nRng.createRoll(seed), 0)));
    same("quantize lums", [...eQ.lumsOf(pal.colours)], [...nLumsOf(pal)]);
  }
});

function randomBuf(r, width, height, layers = 5) {
  const buf = eQ.makeBuf(width, height);
  for (let k = 0; k < width * height; k += 1) {
    buf.L[k] = r() < 0.05 ? r() * 0.05 : r() * 1.4 - 0.1;
    const inked = r();
    buf.accent[k] = inked < 0.6 ? 0 : inked < 0.75 ? 1 : inked < 0.85 ? 2 : (1 + Math.floor(r() * 2)) | ((1 + Math.floor(r() * 15)) << 2);
    buf.layer[k] = Math.floor(r() * layers);
    buf.halo[k] = r() < 0.1 ? 1 : 0;
    buf.cyc[k] = r() < 0.1 ? 1 : 0;
  }
  return buf;
}

test("quantize: random shade buffers through NOCTURNES' quantize source and the engine's", () => {
  const r = rand(99);
  for (let i = 0; i < 120; i += 1) {
    const seed = SEEDS[i];
    const S = nGenome.stream(nRng.createRoll(seed), 7);
    const spec = nGenome.makePalette(nGenome.stream(nRng.createRoll(seed), 0));
    const pal = nPal.buildPalette(spec);
    const screens = nLayerKeys.map(() => ({ id: S.pick(nDith.SCREEN_IDS), steps: S.int(3, 8), bias: S.int(0, 2) }));
    const ramps = eQ.rampsOf(pal);
    const lums = eQ.lumsOf(pal.colours);
    const [width, height] = [[32, 32], [48, 36], [64, 48], [40, 40]][i % 4];
    const nq = nQuantizeFactory(width, height, width * height, screens, ramps, lums, nDith.screenIndex, nMath.TAU);
    const eq = eQ.createQuantizer({ width, height, screens, ramps, lums });
    const buf = randomBuf(r, width, height);
    const t = r();
    same("quantize random buffers", eq(buf, null, undefined, t), nq(buf, null, undefined, t));
    // A region into an existing frame, as a click frame does it.
    const base = Uint8Array.from({ length: width * height }, () => Math.floor(r() * 31));
    const region = [3, 2, width - 5, height - 7];
    same("quantize random buffers", eq(buf, region, base.slice(), t), nq(buf, region, base.slice(), t));
  }
});

// NOCTURNES' render.js again, from a data: URL, with one line added that
// copies each shade buffer before it is quantized. (Its imports point at the
// same NOCTURNES files, so it shares their state.)
const CAPTURE_AT = "      frames.push({ pixels: quantize(buf, null, undefined, t), delay: g.delay });";
async function capturingRenderer() {
  assert.equal(renderSrc.split(CAPTURE_AT).length, 2, "render.js's loop quantize line moved: update the capture hook");
  const src = renderSrc
    .replace(/from "\.\/([a-z]+\.js)";/gu, (_, f) => `from ${JSON.stringify(NS(f))};`)
    .replace(CAPTURE_AT, `      globalThis.__KEEL_CAPTURE?.push({ L: buf.L.slice(), accent: buf.accent.slice(), layer: buf.layer.slice(), halo: buf.halo.slice(), cyc: buf.cyc.slice(), t });\n${CAPTURE_AT}`);
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

const W = 64;
const H = 48;
const REAL_TOKENS = [1, 2, 7, 26, 36, 69];
const realFrames = [];

test("quantize: REAL NOCTURNES shade buffers -> the engine's quantize = NOCTURNES' frames", async () => {
  const cap = await capturingRenderer();
  for (const token of REAL_TOKENS) {
    const g = nGenome.makeGenome(nRng.seedFromToken(token));
    g.viewSize = { width: W, height: H };
    globalThis.__KEEL_CAPTURE = [];
    const real = cap.renderGenome(g, { width: W, height: H });
    const bufs = globalThis.__KEEL_CAPTURE;
    globalThis.__KEEL_CAPTURE = undefined;
    // The hook changes nothing: the same frames as NOCTURNES' own render.js.
    const g2 = nGenome.makeGenome(nRng.seedFromToken(token));
    g2.viewSize = { width: W, height: H };
    const plain = nRender.renderGenome(g2, { width: W, height: H });
    assert.equal(real.frames.length, plain.frames.length);
    real.frames.forEach((f, i) => assert.deepEqual(f.pixels, plain.frames[i].pixels));
    assert.equal(bufs.length, real.frames.length);
    // The engine, from the genome alone: its palette, its screens, its quantizer.
    const pal = ePal.buildPalette(g.palette);
    same("quantize real palettes", pal.colours, real.palette);
    const screens = eQ.LAYER_KEYS.map((k) => g.screens.layers[k]);
    const quantize = eQ.createQuantizer({ width: W, height: H, screens, ramps: eQ.rampsOf(pal), lums: eQ.lumsOf(pal.colours) });
    bufs.forEach((b, i) => same("quantize real frames", quantize(b, null, undefined, b.t), real.frames[i].pixels, `token ${token} frame ${i}`));
    realFrames.push(real);
  }
});

test("gif: bytes for rendered loops and random frames", () => {
  assert.ok(realFrames.length, "needs the real frames from the quantize test");
  exact("gif", eGif.PALETTE_SIZE, nGif.PALETTE_SIZE);
  exact("gif", eGif.TRANSPARENT, nGif.TRANSPARENT);
  for (const real of realFrames) {
    const spec = { width: real.width, height: real.height, palette: real.palette, frames: real.frames };
    same("gif rendered loops", eGif.encodeGif(spec), nGif.encodeGif(spec));
    same("gif rendered loops", eGif.encodeGif({ ...spec, once: true, loop: 3 }), nGif.encodeGif({ ...spec, once: true, loop: 3 }));
    const steps = [...(function* () { const it = eGif.encodeGifSteps(spec); let s = it.next(); while (!s.done) { yield s.value; s = it.next(); } return s.value; })()];
    const it = nGif.encodeGifSteps(spec);
    let s = it.next();
    const nSteps = [];
    while (!s.done) { nSteps.push(s.value); s = it.next(); }
    same("gif", steps, nSteps);
  }
  const r = rand(4242);
  for (let i = 0; i < 60; i += 1) {
    const width = 1 + Math.floor(r() * 90);
    const height = 1 + Math.floor(r() * 70);
    const palette = Array.from({ length: 1 + Math.floor(r() * 32) }, () => [0, 0, 0].map(() => Math.floor(r() * 256)));
    const frames = [];
    let prev = Uint8Array.from({ length: width * height }, () => Math.floor(r() * 31));
    for (let f = 0; f < 1 + Math.floor(r() * 6); f += 1) {
      const px = prev.slice();
      const mode = r();
      if (mode < 0.3) for (let k = 0; k < 1 + r() * 30; k += 1) px[Math.floor(r() * px.length)] = Math.floor(r() * 31);
      else if (mode < 0.6) px.fill(Math.floor(r() * 31));
      else if (mode < 0.8) for (let k = 0; k < px.length; k += 1) px[k] = Math.floor(r() * 31);
      frames.push({ pixels: px, delay: Math.floor(r() * 12) });
      prev = px;
    }
    const spec = { width, height, palette, frames, loop: Math.floor(r() * 4) };
    same("gif random frames", eGif.encodeGif(spec), nGif.encodeGif(spec));
  }
  // Long runs that reset the LZW table (4096 codes).
  const big = Uint8Array.from({ length: 256 * 256 }, () => Math.floor(r() * 31));
  same("gif random frames", eGif.encodeGif({ width: 256, height: 256, palette: [[1, 2, 3]], frames: [{ pixels: big, delay: 5 }] }), nGif.encodeGif({ width: 256, height: 256, palette: [[1, 2, 3]], frames: [{ pixels: big, delay: 5 }] }));
});

test("summary", () => {
  const lines = Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`);
  console.log(`core equality checks (all identical):\n${lines.join("\n")}`);
});
