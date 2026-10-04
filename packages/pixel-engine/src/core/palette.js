// KEEL Pixel core -- copied from NOCTURNES src/palette.js (tests/core-equality.test.mjs
// proves every export identical to the original). Change NOCTURNES' copy and
// this one together, or not at all.
//
// The colour table: up to three RAMPS, all built in OKLCH.
//
// A piece never chooses colours, it chooses a HARMONY. Every pixel is a
// lightness on one ramp, so whatever the generator draws is already in key --
// the palette cannot clash because nothing in it was not derived from the
// scheme's hues.
//
// Two layouts share the 32-entry GIF table (31 is reserved transparent):
//
//   one room        key 0..21 (22)                     accent 22..30 (9)
//   two worlds      outside 0..9 (10)  key 10..21 (12)  accent 22..30 (9)
//
// A ramp's hue may travel across its lightness (hue stops), which is how a
// single ramp carries two, three or a whole spectrum of hues. Every ramp also
// gets the pixel artist's hue shift: shadows lean cool, highlights lean warm,
// which is most of why a ramp reads as light instead of as paint.

import { clamp, hash2, mix } from "./math.js";

export const TABLE = 32;
export const TRANSPARENT = 31;

function oklabToLinear(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((c) => c >= -0.0005 && c <= 1.0005);
const encode = (c) => {
  const v = clamp(c, 0, 1);
  return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
};

/** OKLCH -> sRGB bytes, pulling chroma in until the colour exists. */
export function oklch(L, C, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  let rgb = oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = C;
    for (let step = 0; step < 18; step += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(h), mid * Math.sin(h)))) lo = mid;
      else hi = mid;
    }
    rgb = oklabToLinear(L, lo * Math.cos(h), lo * Math.sin(h));
  }
  return rgb.map(encode);
}

// How much chroma sRGB can hold at a lightness and hue. A deep blue can be
// vivid, a deep yellow can't; a pale blue can't either. (Cached: a palette
// asks the same few hundred questions.)
const CMAX = new Map();
export function cmax(L, hueDeg) {
  const key = Math.round(L * 400) * 1000 + Math.round(wrap(hueDeg));
  let c = CMAX.get(key);
  if (c !== undefined) return c;
  const h = (Math.round(wrap(hueDeg)) * Math.PI) / 180;
  const l = Math.round(L * 400) / 400;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  let lo = 0;
  let hi = 0.4;
  for (let step = 0; step < 12; step += 1) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklabToLinear(l, mid * ch, mid * sh))) lo = mid;
    else hi = mid;
  }
  CMAX.set(key, lo);
  return lo;
}

const HUE_NAMES = [
  [0, "Rose"], [18, "Crimson"], [38, "Vermilion"], [55, "Ember"], [72, "Amber"],
  [90, "Gold"], [108, "Chartreuse"], [128, "Moss"], [150, "Jade"], [172, "Viridian"],
  [192, "Teal"], [212, "Cyan"], [232, "Azure"], [250, "Cobalt"], [268, "Ultramarine"],
  [285, "Indigo"], [302, "Violet"], [322, "Orchid"], [342, "Magenta"], [360, "Rose"],
];

export const wrap = (h) => ((h % 360) + 360) % 360;

export function hueName(deg) {
  const h = wrap(deg);
  let best = HUE_NAMES[0][1];
  let gap = 999;
  for (const [at, name] of HUE_NAMES) {
    if (Math.abs(at - h) < gap) { gap = Math.abs(at - h); best = name; }
  }
  return best;
}

/** Hue at s along the stops (stops are already unwrapped, so a spectrum can run long). */
function hueAt(stops, s) {
  if (stops.length === 1) return stops[0];
  const x = s * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return mix(stops[i], stops[i + 1], x - i);
}

// Where the hue shift leans. Shadows go toward violet, lights toward a warm
// gold -- or toward a cool cyan, for the blues that keep cold highlights. Each
// anchor has a fixed CUT on the far side of the wheel, and a hue always turns
// the way that doesn't cross it. (The shortest turn to gold flips at 265°,
// right in the middle of the blues: half of them went magenta at the top.)
const SHADOW = [285, 105];
const LIGHT = [85, 305];
const COOL = [195, 15];

// (The chroma the schemes were tuned at: a ramp asking for this much keeps
// the lights' share as it stands; one asking for half gets half.)
const CHROMA_REF = 0.15;
const NEAR_BLACK = 0.08;
const smoothUp = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** Signed turn from h to the anchor, never across the anchor's cut. */
function toward(h, [anchor, cut]) {
  const w = wrap(h - cut);
  return wrap(anchor - cut) - w;
}

/**
 * ramp = { hues:[...], chroma, lift, top, gamma, shift, coolTop, len }
 *   hues     hue stops from shadow to highlight (degrees, unwrapped)
 *   shift    pixel-art hue shift: degrees the ends lean, shadows to violet, lights to gold
 *   coolTop  the lights lean to cyan instead (moonlit blues)
 */
// One tone of a ramp at s (0 foot .. 1 top): lightness, chroma and hue.
// An accent's dim end bridges from the room: over its lowest quarter it
// runs from halfway between the room's colour and its own (at the same
// lightness) to wholly its own, so a glow's faint edge dithers into the
// room instead of cutting a hard contour against it.
function toneAt(r, s) {
  const own = ownTone(r, s);
  if (!r.bridgeTo || s >= 0.25) return own;
  const k = r.bridgeTo;
  const sk = clamp((own[0] - k.lift) / Math.max(1e-6, k.top - k.lift), 0, 1) ** (1 / k.gamma);
  const room = ownTone(k, sk);
  const w = mix(0.5, 1, s / 0.25);
  // (Round the wheel, not across it: halfway from a teal room to an orange
  // accent is a colour, not the grey in the middle.)
  const turn = ((((own[2] - room[2]) % 360) + 540) % 360) - 180;
  return [own[0], mix(room[1], own[1], w), room[2] + turn * w];
}

function ownTone(r, s) {
  const L = mix(r.lift, r.top, s ** r.gamma);
  let H = hueAt(r.hues, s);
  // Each end leans by up to `shift`, spread evenly from the middle out, and
  // never past its anchor; a hue already near its anchor leans half as far.
  const d = toward(H, s < 0.5 ? SHADOW : r.coolTop ? COOL : LIGHT);
  const reach = r.shift * Math.abs(s - 0.5) * 2 * (Math.abs(d) < 30 ? 0.5 : 1);
  H += Math.sign(d) * Math.min(reach, Math.abs(d));
  // Chroma rises through the darks and midtones as the scheme asks (the
  // gamut holds what it can: deep jewel tones), and the lights keep at
  // least a share of what the gamut allows where they are -- so a blue
  // keeps its colour into the highlights instead of washing to grey at
  // the gamut's wall. The ramp's own chroma sets the share, so a soft
  // scheme stays soft.
  const Cs = r.chroma * Math.sin(Math.PI * clamp(s * 0.9 + 0.06, 0, 1) ** 0.85);
  const floor = s < 0.5 ? 0 : 0.6 * smoothUp((s - 0.5) / 0.2) * (r.chroma / CHROMA_REF);
  return [L, Math.min(0.97 * cmax(L, H), Math.max(Cs, floor * cmax(L, H))), H];
}

// The steps a ramp takes must be steps the eye takes: no two entries the
// same colour, no jump bigger than ~0.1 in OKLab (at a 22-entry ramp that's
// a tenth of the way from black to white). A ramp is laid out evenly along
// its s; when that makes a jump, its entries are laid out evenly by what the
// eye sees instead (OKLab distance along the ramp) -- and an accent too short
// for its whole range gives up its dim end (a glow lives at the top).
const MAX_STEP = 0.1;
const MIN_APART = 0.012;
const LAB = (rgb) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(rgb[0]), G = lin(rgb[1]), B = lin(rgb[2]);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const q = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q];
};
const dLab = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function stopsOf(r) {
  const even = Array.from({ length: r.len }, (_, i) => (r.len === 1 ? 0.5 : i / (r.len - 1)));
  if (r.len < 3) return even;
  const labs = even.map((s) => LAB(oklch(...toneAt(r, s))));
  let worst = 0;
  for (let i = 1; i < labs.length; i += 1) worst = Math.max(worst, dLab(labs[i - 1], labs[i]));
  if (worst <= MAX_STEP) return even;
  // Distance along the ramp, sampled finely.
  const K = 96;
  const arc = [0];
  let prev = LAB(oklch(...toneAt(r, 0)));
  for (let k = 1; k <= K; k += 1) { const c = LAB(oklch(...toneAt(r, k / K))); arc.push(arc[k - 1] + dLab(prev, c)); prev = c; }
  const total = arc[K];
  const span = Math.min(total, MAX_STEP * 0.98 * (r.len - 1));
  const from = r.room ? 0 : total - span; // (a room keeps its darks; an accent its top)
  const sAt = (a) => { let k = 1; while (k < K && arc[k] < a) k += 1; return (k - 1 + (a - arc[k - 1]) / Math.max(1e-9, arc[k] - arc[k - 1])) / K; };
  return Array.from({ length: r.len }, (_, i) => sAt(from + (span * i) / (r.len - 1)));
}

function buildRamp(r) {
  const out = [];
  // A room's darks must still read: one near-black at the foot, then a clear
  // step up to the darkest tone that holds colour (L 0.12-0.14 by the ramp's
  // own lift), so a shadow is a colour and not a hole. Only that first step
  // moves: the tones above it stay where they were, or the whole night
  // lifts and goes washed. (Accents start well up their ramp already.)
  const darks = r.room && r.len > 4;
  const Ldark = 0.12 + clamp((r.lift - 0.04) / 0.05, 0, 1) * 0.02;
  let last = 0;
  stopsOf(r).forEach((s, i) => {
    let [L, C, H] = toneAt(r, s);
    if (darks) L = i === 0 ? Math.min(L, NEAR_BLACK) : Math.max(L, i === 1 ? Ldark : last + 0.02);
    last = L;
    out.push(oklch(L, Math.min(C, 0.97 * cmax(L, H)), H));
  });
  return out;
}

/**
 * spec.ramps = { key, accent, outside? } (each a ramp without `len`).
 * Returns the 32 colours and where each ramp lives in the table.
 */
export function buildPalette(spec) {
  const layout = spec.ramps.outside
    ? { outside: [0, 10], key: [10, 12], accent: [22, 9] }
    : spec.ramps.accent2
      ? { key: [0, 18], accent: [18, 7], accent2: [25, 6] }
      : { key: [0, 22], accent: [22, 9] };
  const colours = new Array(TABLE).fill(null);
  const ramps = {};
  for (const [name, [base, len]] of Object.entries(layout)) {
    const bridgeTo = name.startsWith("accent") ? spec.ramps.key : null;
    buildRamp({ ...spec.ramps[name], len, room: name === "key" || name === "outside", bridgeTo }).forEach((c, i) => { colours[base + i] = c; });
    ramps[name] = { base, len };
  }
  // No colour wasted: an accent entry that lands on a colour already in the
  // table (a monochrome room's accent at the key's own lightness) is pushed
  // just far enough away to be a colour of its own.
  const labs = colours.map((c, i) => (i === TRANSPARENT || !c ? null : LAB(c)));
  for (const name of ["accent", "accent2"]) {
    const rp = ramps[name];
    if (!rp) continue;
    for (let i = rp.base; i < rp.base + rp.len; i += 1) {
      for (let tries = 0; tries < 6; tries += 1) {
        let near = -1;
        let nd = Infinity;
        labs.forEach((q, j) => { if (q && j !== i) { const d = dLab(labs[i], q); if (d < nd) { nd = d; near = j; } } });
        if (nd >= MIN_APART) break;
        const away = labs[i].map((v, k) => v - labs[near][k]);
        const len = Math.hypot(...away) || 1;
        const dir = len > 1e-6 ? away.map((v) => v / len) : [1, 0, 0];
        const q = labs[i].map((v, k) => v + dir[k] * (MIN_APART - nd + 0.002));
        colours[i] = oklabToLinear(q[0], q[1], q[2]).map(encode);
        labs[i] = LAB(colours[i]);
      }
    }
  }
  colours[TRANSPARENT] = [0, 0, 0];
  return { colours, ramps };
}

/** Distinct hue families actually present (by 30-degree bins, chroma > 0.04). */
export function hueCount(spec) {
  const bins = new Set();
  for (const r of Object.values(spec.ramps)) {
    if (r.chroma < 0.04) continue;
    const a = r.hues[0];
    const b = r.hues[r.hues.length - 1];
    const steps = Math.max(1, Math.ceil(Math.abs(b - a) / 15));
    for (let i = 0; i <= steps; i += 1) bins.add(Math.floor(wrap(mix(a, b, i / steps)) / 30));
  }
  return bins.size;
}

// ---- Harmonies: from NOCTURNES genome.js (baseHue, ramp, accentRamp, SCHEMES,
// SCHEME_NAMES, makePalette), copied unchanged. `S` is a stream (rng.js).
// Returns a palette SPEC; buildPalette(spec) turns it into the 32 colours.

// Harmonies. Each scheme is a rule for relating hues, tuned so that whatever
// the seed picks inside the rule is appealing: chroma is capped per ramp,
// lightness is monotonic, and every ramp gets the pixel artist's hue shift.
// Rarity is by weight -- a single-hue piece like the reference is the rare
// one, and the full-spectrum ones rarer still.
export const baseHue = (S) => S.weighted([
  [S.between(230, 285), 5], // the blues the reference lives in
  [S.between(285, 340), 3],
  [S.between(150, 230), 3],
  [S.between(0, 60), 2],
  [S.between(60, 150), 1],
]);

export function ramp(S, hues, extra = {}) {
  return {
    hues,
    chroma: S.between(0.11, 0.19),
    lift: S.between(0.04, 0.09),
    top: S.between(0.94, 0.985),
    gamma: S.between(1.0, 1.35),
    shift: S.between(6, 20),
    ...extra,
  };
}
export const accentRamp = (S, hue, extra = {}) => ({
  hues: [hue - 6, hue + 6], chroma: S.between(0.15, 0.23), lift: 0.32, top: 0.96, gamma: 0.9, shift: 4, ...extra,
});

// Night first: the one-hue-and-its-opposite rooms (Nocturne, Two Worlds) are
// about half of everything. (Capping the many-hued schemes' chroma at 0.55 of
// the gamut was tried: it turned their teals grey.)
export const SCHEMES = [
  ["Monochrome", 3, (S, h) => ({
    key: ramp(S, [h - 4, h + 4]),
    accent: accentRamp(S, h + S.between(-10, 10), { chroma: S.between(0.18, 0.25) }),
  })],
  ["Nocturne", 9, (S, h) => ({
    key: ramp(S, [h - 9, h + 9]),
    accent: accentRamp(S, h + 180 + S.between(-35, 35)),
  })],
  ["Duotone", 5, (S, h) => {
    const d = S.pick([-1, 1]) * S.between(45, 85);
    return { key: ramp(S, [h - d / 2, h + d / 2]), accent: accentRamp(S, h + 180 + S.between(-25, 25)) };
  }],
  ["Split", 3, (S, h) => ({
    key: ramp(S, [h - 12, h + 12]),
    accent: accentRamp(S, h + S.pick([-1, 1]) * S.between(125, 155)),
  })],
  ["Triad", 3, (S, h) => {
    const dir = S.pick([-1, 1]);
    return { key: ramp(S, [h, h + dir * 120]), accent: accentRamp(S, h - dir * 120 + S.between(-15, 15)) };
  }],
  ["Two Worlds", 7.5, (S, h) => {
    // The view outside and the room inside live on different ramps: a cold
    // night against a warm room, or the reverse. The accent belongs indoors.
    const inside = h + 180 + S.between(-40, 40);
    return {
      outside: ramp(S, [h - 10, h + 10], { chroma: S.between(0.12, 0.2), top: 0.9 }),
      key: ramp(S, [inside - 12, inside + 12]),
      accent: accentRamp(S, inside + S.pick([-1, 1]) * S.between(25, 60)),
    };
  }],
  ["Neon Noir", 2, (S, h) => ({
    // Near-neutral room, one vivid ink. Contrast by placement, not by volume.
    key: ramp(S, [h - 5, h + 5], { chroma: S.between(0.025, 0.05), shift: 4 }),
    accent: accentRamp(S, h + S.pick([0, 150, 180, 210]), { chroma: 0.3, lift: 0.4 }),
  })],
  ["Spectrum", 1.5, (S, h) => {
    const span = S.pick([-1, 1]) * S.between(150, 220);
    return {
      key: ramp(S, [h, h + span / 3, h + (span * 2) / 3, h + span], { chroma: S.between(0.13, 0.18) }),
      accent: accentRamp(S, h + span / 2 + 180),
    };
  }],
  ["Prism", 0.6, (S, h) => ({
    key: ramp(S, [h, h + 90, h + 180, h + 270, h + 360], { chroma: S.between(0.13, 0.17), shift: 0 }),
    accent: accentRamp(S, h + 45, { chroma: 0.12 }),
  })],
];

export const SCHEME_NAMES = SCHEMES.map(([n]) => n);

export function makePalette(S, force = {}) {
  let hue = baseHue(S);
  let [scheme, , fn] = S.weighted(SCHEMES.map((sc) => [sc, sc[1]]));
  if (force.hue !== undefined) hue = force.hue;
  if (force.scheme) [scheme, , fn] = SCHEMES.find(([n]) => n === force.scheme) ?? [scheme, 0, fn];
  const ramps = fn(S, hue);
  // A second ink for pieces that carry two lights. Never with two worlds:
  // that layout has spent its entries on the view.
  if (!ramps.outside && scheme !== "Monochrome" && S.chance(0.45)) {
    ramps.accent2 = accentRamp(S, ramps.accent.hues[0] + S.pick([-1, 1]) * S.between(70, 140), { chroma: S.between(0.16, 0.26) });
  }
  // An accent is the room's colour turned up: 1.3-1.8 times its chroma (never
  // past the old top of 0.23 -- more went neon), so a soft room gets a soft
  // light and a vivid one a vivid light. (Not a neon noir, whose one ink is
  // the point, nor a prism, whose room is the colour. By a hash of the hue,
  // not a draw: the stream's later rolls stay put.)
  if (scheme !== "Neon Noir" && scheme !== "Prism") {
    for (const a of [ramps.accent, ramps.accent2]) if (a) a.chroma = Math.min(0.23, ramps.key.chroma * (1.3 + 0.5 * hash2(Math.round(a.hues[0] * 64), 2029, 7)));
  }
  // Some blues keep cold highlights, moonlight rather than lamplight. (Decided
  // by a hash of the hue, not a draw: the stream's later rolls stay put.)
  for (const r of [ramps.key, ramps.outside]) {
    const h = r && ((r.hues[0] % 360) + 360) % 360;
    if (r && h >= 200 && h <= 290 && hash2(Math.round(r.hues[0] * 64), 2011, 7) < 0.4) r.coolTop = true;
  }
  const spec = { scheme, hue, ramps };
  const hues = hueCount(spec);
  const names = [];
  if (ramps.outside) names.push(hueName(ramps.outside.hues[0]));
  names.push(hueName(ramps.key.hues[0]));
  const tail = ramps.key.hues[ramps.key.hues.length - 1];
  if (Math.abs(tail - ramps.key.hues[0]) >= 40 && hueName(tail) !== names[names.length - 1]) names.push(hueName(tail));
  const accentName = hueName(ramps.accent.hues[0]);
  const name = scheme === "Prism" ? "Prism" : [...new Set([...names, accentName])].join(" / ");
  return { ...spec, hues, name, accentName };
}

// ---- Resolution (engine, new) ----
//
// A ramp's entries are tones the eye must be able to SEE as steps. At 256 px a
// 22-entry ramp shows as a smooth gradient broken by the screen; at 32 px the
// same ramp has nowhere to put its steps -- a tone band a pixel or two wide is
// noise, not light. Tiny targets therefore get shorter ramps, chosen as an even
// walk over the full ramp that always keeps its foot (darkest) and top
// (brightest), so contrast survives and only the in-between tones merge.
//
//   short side   max entries
//   <= 24        4
//   <= 32        5
//   <= 48        6
//   <= 64        8
//   <= 96        11
//   <= 128       14
//   >  128       unchanged
//
// Deterministic: the result depends only on the ramp and the short side.

export const RAMP_BUDGET = [[24, 4], [32, 5], [48, 6], [64, 8], [96, 11], [128, 14]];

/** How many ramp entries a target with this short side can show (Infinity = no cut). */
export function rampBudget(shortSide) {
  for (const [side, len] of RAMP_BUDGET) if (shortSide <= side) return len;
  return Infinity;
}

/** The indices (into a ramp of `len`) kept at `shortSide`: foot and top always, evenly between. */
export function rampIndicesForTarget(len, shortSide) {
  const keep = Math.min(len, rampBudget(shortSide));
  if (keep >= len) return Array.from({ length: len }, (_, i) => i);
  if (keep <= 1) return [len - 1];
  return Array.from({ length: keep }, (_, i) => Math.round((i * (len - 1)) / (keep - 1)));
}

/**
 * A ramp shortened for a target. `ramp` may be:
 *   - an array of colours ([r,g,b][]): returns the kept colours;
 *   - a number (a ramp length): returns the shortened length;
 *   - a ramp spec object with `len` (buildPalette's ramp shape): returns a
 *     copy with `len` shortened (other fields untouched).
 */
export function rampForTarget(ramp, shortSide) {
  if (typeof ramp === "number") return Math.min(ramp, rampBudget(shortSide));
  if (Array.isArray(ramp)) return rampIndicesForTarget(ramp.length, shortSide).map((i) => ramp[i]);
  if (ramp && typeof ramp === "object" && Number.isFinite(ramp.len)) return { ...ramp, len: Math.min(ramp.len, rampBudget(shortSide)) };
  throw new TypeError("rampForTarget takes a colour array, a length, or a ramp with len.");
}
