// KEEL Pixel core -- copied from NOCTURNES src/dither.js (tests/core-equality.test.mjs
// proves every export identical to the original). Change NOCTURNES' copy and
// this one together, or not at all.
//
// Screens. The piece is drawn in continuous light and only ever SHOWN through
// a screen: a threshold map plus a small number of tone steps on the ramp.
//
// Few steps is the point. A layer quantised to 5 steps of a 22-step ramp has
// most of its tone living in the pattern between two steps, which is where the
// look comes from. Different layers can wear different screens -- halftone
// dots outside the window, a Bayer matrix on the glass, hatching on the sill --
// and they still agree because they sample the same ramp.
//
// Every map is a pure function of the pixel position (never of time or of
// neighbouring error), so a pixel whose light does not change never changes
// index. That keeps the loop from crawling and the GIF deltas small.

import { fract, tri } from "./math.js";

const BAYER2 = [0, 2, 3, 1];
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER8 = (() => {
  const out = new Array(64);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const q = BAYER4[(y & 3) * 4 + (x & 3)];
      const b = BAYER2[(y >> 2) * 2 + (x >> 2)];
      out[y * 8 + x] = q * 4 + b;
    }
  }
  return out;
})();


// A screen's shape says WHERE the ink goes first; its tone needs every level
// equally often, or a gradient jumps in bands (a line screen made of three
// values has three tones, whatever the light does). So each shaped screen is
// ranked once over its own tile: the cells in the order its shape fills them,
// ties split the way a Bayer matrix would (or, for a line, along the line),
// each cell's threshold its rank.
function equalize(shape, w, h, tie = (x, y) => BAYER8[(y & 7) * 8 + (x & 7)]) {
  const cells = [];
  // (Shape values rounded: two dots of one lattice are the same dot, and a
  // last-digit difference in a cosine mustn't rank one's cells ahead of the other's.)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) cells.push([Math.round(shape(x, y) * 1e6), tie(x, y), y * w + x]);
  cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const table = new Float32Array(w * h);
  cells.forEach(([, , k], rank) => { table[k] = (rank + 0.5) / cells.length; });
  return (x, y) => table[(((y % h) + h) % h) * w + (((x % w) + w) % w)];
}

// A line screen fills a line before it starts the next: first a dash every
// eight pixels along it, then every four, every two, then the line is whole
// (then the line beside it thickens it). Scattered like a Bayer matrix, the
// same levels read as speckle. (Each line starts half a stride on from the
// last, or the first dashes stack into columns.)
const along = (x) => [0, 4, 2, 6, 1, 5, 3, 7][x & 7];

// A clustered-dot screen on a lattice of dots (basis vectors a and b), the
// way print does it: each dot grows round from its centre until the dots
// touch, then the holes between them close. The lattice's angle is the
// screen's angle -- the newspaper's 45°, where the coarse dot sits square to
// the frame, so the two never share a grid. Ties grow opposite sides of a dot together, so a
// dot is round at every size, not a dash. The tile is the lattice's own
// repeat along x and y.
function dotScreen([ax, ay], [bx, by], w, h) {
  const det = ax * by - ay * bx;
  const coords = (x, y) => [(x * by - y * bx) / det, (y * ax - x * ay) / det];
  const shape = (x, y) => {
    const [u, v] = coords(x, y);
    return -(Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * v));
  };
  const tie = (x, y) => {
    const [u, v] = coords(x, y);
    const [i, j] = [Math.round(u), Math.round(v)];
    const dx = x - (i * ax + j * bx);
    const dy = y - (i * ay + j * by);
    const oct = Math.floor((((Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) + 1e-9) & 7;
    return [0, 4, 2, 6, 1, 5, 3, 7][oct];
  };
  return equalize(shape, w, h, tie);
}

// Blue noise: a 64x64 void-and-cluster tile (sigma 1.5, on a torus, so it
// repeats without a seam), made once by tools/bluenoise.mjs. Grain with no
// clumps and no lattice: a stipple that reads as fine sand, not specks.
const BLUE_NOISE = (() => {
  const s = atob("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");
  const t = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) t[i] = s.charCodeAt(i);
  return t;
})();

export const SCREENS = {
  bayer2: { name: "Bayer 2", at: (x, y) => (BAYER2[(y & 1) * 2 + (x & 1)] + 0.5) / 4 },
  bayer4: { name: "Bayer 4", at: (x, y) => (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 },
  bayer8: { name: "Bayer 8", at: (x, y) => (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 },
  chunky: { name: "Chunky", at: (x, y) => (BAYER4[((y >> 1) & 3) * 4 + ((x >> 1) & 3)] + 0.5) / 16 },
  // (As fine as the old screen: a dot every 18 pixels, now truly at 45°.)
  halftone: { name: "Halftone", at: dotScreen([3, 3], [3, -3], 6, 6) },
  // (The coarse dot keeps its nine flat levels for now: equalized, at 26.6°
  // or square, its dots read as blotches to every critic. The owner's call.)
  coarseDot: { name: "Coarse Dot", at: (x, y) => (Math.cos(((x + y) / 6) * Math.PI) * Math.cos(((x - y) / 6) * Math.PI) + 1) * 0.5 },
  // (Line screen, crosshatch, checker and weave keep their few flat levels
  // for now: equalized, a night sky's gradient turns to dashes, hatching lies
  // across the objects and a checker becomes a lattice of specks -- and blind
  // critics preferred the flat fills every time. The owner's call.)
  lines: { name: "Line Screen", at: (x, y) => tri(y / 3 + 0.5) * 0.9 + (BAYER2[(y & 1) * 2 + (x & 1)] / 4) * 0.1 },
  diagonal: { name: "Diagonal", at: equalize((x, y) => [3, 1, 0, 2][(x + y) & 3], 8, 8, (x, y) => along(x + 4 * ((x + y) >> 2))) },
  hatch: { name: "Crosshatch", at: (x, y) => (tri((x + y) / 4) + tri((x - y) / 4)) * 0.5 },
  stipple: { name: "Stipple", at: (x, y) => (BLUE_NOISE[(y & 63) * 64 + (x & 63)] + 0.5) / 256 },
  ign: { name: "Interleaved", at: (x, y) => fract(52.9829189 * fract(0.06711056 * x + 0.00583715 * y)) },
  checker: { name: "Checker", at: (x, y) => (((x + y) & 1) ? 0.3 : 0.7) },
  weave: { name: "Weave", at: (x, y) => ((((x >> 1) + (y >> 1)) & 1) ? tri(x / 4) : tri(y / 4)) * 0.94 + 0.03 },
};

export const SCREEN_IDS = Object.keys(SCREENS);

/**
 * What a screen really is, measured from its map rather than taken from its
 * label (the gate measures with this too): how many tone levels, how full its
 * fullest sixteenth is, its shortest repeat (period and angle: the lattice),
 * and the ways it runs smoothest -- its lines, for a line screen (0 =
 * horizontal, 45/135 = the diagonals, 90 = vertical).
 */
export function measureScreen(at, T = 24) {
  const vals = [];
  for (let y = 0; y < T; y += 1) for (let x = 0; x < T; x += 1) vals.push(at(x, y));
  const levels = new Set(vals.map((v) => v.toFixed(4))).size;
  const bins = new Array(16).fill(0);
  for (const v of vals) bins[Math.min(15, Math.floor(v * 16))] += 1;
  const maxBin = Math.max(...bins) / vals.length;
  const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
  const varr = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length || 1;
  const corr = (dx, dy) => {
    let acc = 0;
    let n = 0;
    for (let y = 0; y < T - 8; y += 1) for (let x = 8; x < T - 8; x += 1) { acc += (at(x, y) - mean) * (at(x + dx, y + dy) - mean); n += 1; }
    return acc / n / varr;
  };
  // (The shortest shift that matches as well as the best, within a hair: two
  // dots of one lattice get neighbouring ranks, so they match at 0.99, not 1.)
  const shifts = [];
  for (let dy = 0; dy <= 8; dy += 1) for (let dx = -8; dx <= 8; dx += 1) if (dy > 0 || dx > 0) shifts.push({ r: corr(dx, dy), dx, dy });
  const rMax = Math.max(...shifts.map((s) => s.r));
  const best = shifts.filter((s) => s.r > rMax - 0.02).sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))[0];
  const angle = ((Math.atan2(best.dy, best.dx) * 180) / Math.PI + 180) % 180;
  const unit = [[0, 1, 0], [45, 1, 1], [90, 0, 1], [135, -1, 1]].map(([a, dx, dy]) => [a, corr(dx, dy)]);
  const top = Math.max(...unit.map(([, r]) => r));
  return {
    levels, maxBin, period: +Math.hypot(best.dx, best.dy).toFixed(2), angle: +angle.toFixed(1), r: +best.r.toFixed(2),
    // (Every direction within a hair of the smoothest counts: a crosshatch runs both diagonals.)
    lines: unit.filter(([, r]) => r > top - 0.02).map(([a]) => a),
  };
}

/** Every screen's measured period and angle, for pairing them (genome.js screenPair). */
export const SCREEN_GEOM = Object.fromEntries(SCREEN_IDS.map((id) => {
  const m = measureScreen(SCREENS[id].at);
  return [id, { period: m.period, angle: m.angle, r: m.r, lines: m.lines }];
}));

/**
 * A layer screen is { id, steps, bias }. Returns a ramp index in [0, rampLen).
 * `bias` shifts where the steps sit on the ramp so two layers with the same
 * step count still land on different entries.
 */
export function screenIndex(light, x, y, screen, rampLen, lums = null) {
  const steps = screen.steps;
  const v = (light < 0 ? 0 : light > 1 ? 1 : light) * (steps - 1);
  const base = Math.floor(v);
  const threshold = SCREENS[screen.id].at(x, y);
  const entry = (q) => { const at = Math.round((q / (steps - 1)) * (rampLen - 1 - screen.bias)) + (q > 0 ? screen.bias : 0); return at < 0 ? 0 : at >= rampLen ? rampLen - 1 : at; };
  let f = v - base;
  // Mixed in light, not in lightness: a pixel pattern of two tones is seen
  // as the average of their LIGHT (lightness cubed, near enough), so the
  // share of the brighter tone is what makes that average match the tone
  // wanted -- in lightness, the mid-tones between two steps came out milky.
  if (lums && f > 0 && base < steps - 1) {
    const L0 = lums[entry(base)];
    const L1 = lums[entry(base + 1)];
    if (L1 > L0 + 1e-6) { const Lt = L0 + f * (L1 - L0); f = (Lt ** 3 - L0 ** 3) / (L1 ** 3 - L0 ** 3); }
  }
  return entry(base + (f > threshold ? 1 : 0));
}

// ---- Pairing: from NOCTURNES genome.js (SCREEN_KIND, SCREEN_PAIRS, KIND_PAIRS,
// screenPair), copied unchanged. Which screens sit well together in one picture.
//
// id: [kind, grain (1 fine .. 3 coarse), direction] -- the direction as the
// map really runs (dither.js measures it; the gate holds the two together):
// "grid" an axis lattice, "diag" a 45° lattice, "tilt" a lattice at 26.6°,
// "h"/"d"/"x" lines across, diagonal, crossed, "ign" structured noise (never
// random, never quite repeating), "none" noise.
export const SCREEN_KIND = {
  bayer2: ["ordered", 1, "grid"], bayer4: ["ordered", 1, "grid"], bayer8: ["ordered", 1, "grid"], chunky: ["ordered", 3, "grid"],
  halftone: ["dot", 2, "diag"], coarseDot: ["dot", 3, "grid"],
  lines: ["line", 2, "h"], diagonal: ["line", 2, "d"], hatch: ["line", 2, "x"],
  stipple: ["noise", 1, "none"], ign: ["noise", 1, "ign"],
  checker: ["pattern", 3, "diag"], weave: ["pattern", 3, "grid"],
};
// Pairs that are better than their kinds say (or worse).
export const SCREEN_PAIRS = {
  "halftone+bayer4": 4, "halftone+bayer8": 3, "coarseDot+bayer8": 4, "coarseDot+bayer4": 3, "hatch+stipple": 4, "lines+halftone": 4,
  "diagonal+ign": 3, "chunky+bayer8": 3, "chunky+bayer4": 2, "hatch+bayer8": 3, "weave+bayer8": 2, "checker+stipple": 0, "halftone+coarseDot": 1,
};
export const KIND_PAIRS = {
  "ordered+ordered": 1, "ordered+dot": 3, "ordered+line": 2, "ordered+noise": 2, "ordered+pattern": 1,
  "dot+dot": 1, "dot+line": 3, "dot+noise": 2, "dot+pattern": 1,
  "line+line": 0, "line+noise": 2, "line+pattern": 0,
  "noise+noise": 0, "noise+pattern": 1, "pattern+pattern": 0,
};
/** How well two screens sit in one picture: 0 (never) .. 4 (made for each other). */
export function screenPair(a, b) {
  if (a === b) return 0;
  const hit = SCREEN_PAIRS[`${a}+${b}`] ?? SCREEN_PAIRS[`${b}+${a}`];
  if (hit !== undefined) return hit;
  const [ka, ga] = SCREEN_KIND[a];
  const [kb, gb] = SCREEN_KIND[b];
  if (ga === 3 && gb === 3) return 0; // two coarse screens fight
  return KIND_PAIRS[`${ka}+${kb}`] ?? KIND_PAIRS[`${kb}+${ka}`] ?? 1;
}

// ---- Resolution (engine, new) ----
//
// A screen needs room. Its tile has to repeat many times across the target
// before it reads as tone rather than as a pattern: an 8x8 Bayer on a 32 px
// sprite is four tiles wide -- the matrix IS the picture. So each target falls
// in a BAND by its short side, and each screen has the smallest band it reads
// in (its tile, ~12 repeats across the short side):
//
//   band    short side   ordered   dot        line       noise     pattern   steps
//   tiny    <= 48        bayer2    bayer2     bayer2     ign       checker   3
//   small   <= 128       bayer4    halftone   lines      stipple   bayer4    5
//   large   >  128       bayer8    halftone   hatch      stipple   weave     7
//
// `preference` is a family ("ordered" | "dot" | "line" | "noise" | "pattern")
// or a screen id. An id is kept when it reads at the target's band; otherwise
// its family's pick for the band stands in. Steps are the tone steps a layer
// screen gets (dither.js screenIndex): fewer on tiny targets, where a step
// must cover several pixels to be seen. Deterministic, no state.

export const TARGET_BANDS = [["tiny", 48], ["small", 128], ["large", Infinity]];

export const TARGET_SCREENS = {
  ordered: { tiny: "bayer2", small: "bayer4", large: "bayer8" },
  dot: { tiny: "bayer2", small: "halftone", large: "halftone" },
  line: { tiny: "bayer2", small: "lines", large: "hatch" },
  noise: { tiny: "ign", small: "stipple", large: "stipple" },
  pattern: { tiny: "checker", small: "bayer4", large: "weave" },
};

export const TARGET_STEPS = { tiny: 3, small: 5, large: 7 };

/** The smallest band each screen reads in (its tile against the short side). */
export const SCREEN_MIN_BAND = {
  bayer2: "tiny", checker: "tiny", ign: "tiny",
  bayer4: "small", halftone: "small", lines: "small", diagonal: "small", stipple: "small",
  bayer8: "large", chunky: "large", coarseDot: "large", hatch: "large", weave: "large",
};

const BAND_ORDER = { tiny: 0, small: 1, large: 2 };

/** The band ("tiny" | "small" | "large") of a W x H target. */
export function bandOf(width, height = width) {
  const side = Math.min(width, height);
  for (const [band, max] of TARGET_BANDS) if (side <= max) return band;
  return "large";
}

/**
 * The screen for a target: { id, steps, bias, family, band }, a layer screen
 * ready for screenIndex. `preference` (default "ordered") is a family or a
 * screen id; see the table above.
 */
export function screenForTarget(width, height = width, preference = "ordered") {
  const band = bandOf(width, height);
  let family;
  let id;
  if (SCREENS[preference]) {
    family = SCREEN_KIND[preference][0];
    id = BAND_ORDER[SCREEN_MIN_BAND[preference]] <= BAND_ORDER[band] ? preference : TARGET_SCREENS[family][band];
  } else if (TARGET_SCREENS[preference]) {
    family = preference;
    id = TARGET_SCREENS[family][band];
  } else {
    throw new RangeError(`Unknown screen or family: ${preference}`);
  }
  return { id, steps: TARGET_STEPS[band], bias: 0, family, band };
}
