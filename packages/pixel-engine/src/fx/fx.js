// Post fx for the pixel renderer: a declarative list, resolved for a target
// size, turned into the pixel pass's uniforms. Every pass works ON THE RAMPS
// -- it moves a pixel up or down its palette ramp, or onto another ramp --
// before the dither screen picks the entry, so what comes out is still
// palette entries: pixel art stays pixel art.
//
//   renderer.setFx([
//     { name: "glow", radius: 3 },            // emissive things climb their ramps, with a dithered halo
//     { name: "fog", ramp: "sky", near: 20, far: 80 },
//     { name: "vignette" }, { name: "scanlines" },
//     { name: "cycle", ramps: { water: { speed: 3, from: 0.5 } } },
//   ]);
//   renderer.toggleFx("scanlines", false);
//
// Pure and deterministic: resolveFx(list, target) adapts every pixel-sized
// param to the target (a halo's radius in pixels grows with the picture;
// scanlines only from 96 px; the dither screen from core/dither.js
// screenForTarget), so the same list reads at 32 x 32 and at 256 x 256. The
// world runtime puts the list under config locks by pass name.

import { SCREENS, screenForTarget } from "../core/dither.js";

/** The passes, in the order the pixel pass applies them (each is on when listed, unless `on: false`). */
export const FX_ORDER = ["crt", "grade", "fog", "glow", "rim", "flash", "vignette", "scanlines", "dither", "outline", "cycle"];

// Each pass: its params' defaults, and how they meet a target (W x H, pixels).
// (`ref` sizes are "at 128 px": a param in pixels scales with the short side from there.)
const scalePx = (v, side, min = 1, max = 64) => Math.max(min, Math.min(max, Math.round((v * side) / 128)));
export const GRADE_PRESETS = { day: { shift: 0 }, dusk: { shift: -0.6 }, night: { shift: -1.4 } };

export const FX = {
  // A tube's bend: whole pixels moved outward from the middle, the corners gone to a border entry. (From 64 px.)
  crt: { defaults: { curve: 0.08, border: { ramp: 0, index: 0 }, minSize: 64 }, resolve: (p, side) => (side < p.minSize ? { off: `below ${p.minSize} px` } : { curve: p.curve, border: p.border }) },
  // Colour grading by ramps: each ramp swapped for its graded twin (map: { stone: "stoneNight" }), then shifted along it.
  grade: {
    defaults: { preset: "day", shift: null, map: {} },
    resolve: (p) => ({ shift: p.shift ?? (GRADE_PRESETS[p.preset] ?? GRADE_PRESETS.day).shift, map: { ...p.map } }),
  },
  // Fog by distance: past `near`, pixels go over to the fog ramp -- dithered, by the screen -- all of them by `far`.
  fog: { defaults: { ramp: "sky", near: 25, far: 90, amount: 1, light: 0.3 }, resolve: (p) => ({ ...p }) },
  // Glow: emissive materials (glow >= threshold) climb `self` entries; round them a halo `radius` px (at 128) climbs `halo`.
  glow: {
    defaults: { radius: 3, halo: 2.5, self: 1, threshold: 0.2, tint: false },
    resolve: (p, side) => ({ ...p, radius: scalePx(p.radius, side, 1, 16) }),
  },
  // Rim light: an edge on the light's side (`dir`: "sun" or a screen direction [x, y]) climbs `steps`; `width` px at 128.
  rim: { defaults: { width: 1, steps: 1.5, dir: "sun" }, resolve: (p, side) => ({ ...p, width: scalePx(p.width, side, 1, 4) }) },
  // Hit flash: the struck thing -- by material (`mats`) or id range (`ids: [from, to]`) -- goes up by `amount` (0..1), or onto `ramp`.
  flash: { defaults: { amount: 0, mats: [], ids: null, ramp: null }, resolve: (p) => ({ ...p, amount: Math.max(0, Math.min(1, p.amount)), mats: p.mats.slice(0, 8) }) },
  // Vignette: from `inner` to `outer` (fractions of the half-diagonal), `steps` down the ramps, dithered.
  vignette: { defaults: { inner: 0.55, outer: 1.1, steps: 2 }, resolve: (p) => ({ ...p }) },
  // Scanlines: `dark` rows of every `period` (px at 128) a step down. Only from `minSize` px: below it they are the picture.
  scanlines: {
    defaults: { period: 2, steps: 1, minSize: 96 },
    resolve: (p, side) => {
      if (side < p.minSize) return { off: `below ${p.minSize} px` };
      const period = Math.max(2, scalePx(p.period, side, 2, 16));
      return { period, dark: Math.max(1, Math.floor(period / 2)), steps: p.steps };
    },
  },
  // The dither screen: a core screen id or family ("ordered", "dot", "line", "noise", "pattern"), or "auto"; `amount` 0..1.
  dither: {
    defaults: { screen: "auto", amount: 0.9 },
    resolve: (p, side, W, H) => {
      if (p.screen === "none" || p.amount <= 0) return { screen: "none", amount: 0 };
      const pref = p.screen === "auto" ? "ordered" : p.screen;
      return { screen: screenForTarget(W, H, pref).id, amount: p.amount };
    },
  },
  // The outline: "all" (a thing against anything behind it -- the classic), "outer" (only across `gap` metres:
  // silhouettes, not the parts inside them), "none"; `steps` darker, or in one `color` { ramp, index }.
  outline: {
    defaults: { mode: "all", steps: 3, gap: 1.5, color: null },
    resolve: (p) => (p.mode === "none" ? { off: "mode none" } : { mode: p.mode, steps: p.steps, gap: p.mode === "outer" ? p.gap : 0.56, color: p.color }),
  },
  // Palette cycling: named ramps' upper entries (from `from`, a fraction of the ramp) turn over at `speed` entries a second.
  cycle: {
    defaults: { ramps: {}, speed: 3, from: 0.5 },
    resolve: (p) => {
      const list = Array.isArray(p.ramps) ? Object.fromEntries(p.ramps.map((r) => [r, {}])) : p.ramps;
      return { ramps: Object.fromEntries(Object.entries(list).map(([r, o]) => [r, { speed: o.speed ?? p.speed, from: o.from ?? p.from }])) };
    },
  },
};

export const FX_NAMES = Object.keys(FX);

/** The target's short side (the size every pixel param is measured against). */
const sideOf = (target) => (typeof target === "number" ? target : Math.min(target.width ?? target[0], target.height ?? target[1]));
const dims = (target) => (typeof target === "number" ? [target, target] : [target.width ?? target[0], target.height ?? target[1]]);

/**
 * Resolve a list for a target size: [{ name, on, params, note }] in FX_ORDER,
 * one per named pass (a later entry of a name merges over an earlier one).
 * Passes not listed are absent; a pass the target can't carry is `on: false`
 * with a `note`. Unknown names throw (a typo is not an effect).
 */
export function resolveFx(list = [], target = 128) {
  const [W, H] = dims(target);
  const side = sideOf(target);
  const byName = new Map();
  for (const e of list) {
    if (!e || !FX[e.name]) throw new RangeError(`Unknown fx pass: ${e?.name}`);
    byName.set(e.name, { ...(byName.get(e.name) ?? {}), ...e });
  }
  const out = [];
  for (const name of FX_ORDER) {
    if (!byName.has(name)) continue;
    const { name: _, on = true, ...given } = byName.get(name);
    const def = FX[name];
    const params = { ...def.defaults, ...given };
    if (!on) { out.push({ name, on: false, params, note: "turned off" }); continue; }
    const r = def.resolve(params, side, W, H);
    if (r.off) out.push({ name, on: false, params, note: r.off });
    else out.push({ name, on: true, params: r });
  }
  return out;
}

/** A list with one pass turned on or off (added with its defaults when it wasn't listed). Pure. */
export function toggleFx(list, name, on) {
  if (!FX[name]) throw new RangeError(`Unknown fx pass: ${name}`);
  const has = list.some((e) => e.name === name);
  return has ? list.map((e) => (e.name === name ? { ...e, on } : e)) : [...list, { name, on }];
}

/** Every pass, all on, with its defaults (the sheet's "all fx"). */
export const ALL_FX = () => [
  { name: "grade", preset: "dusk" }, { name: "fog" }, { name: "glow" }, { name: "rim" }, { name: "vignette" },
  { name: "scanlines" }, { name: "dither", screen: "auto" }, { name: "outline", mode: "all" }, { name: "cycle", ramps: ["water"] },
];

/**
 * The pixel pass's uniform values for a resolved list. `look` knows the
 * palette: ramp(name) -> index (-1 unknown), rampOf(index) -> [base, len], and
 * the style's defaults (screen, dither, outline) that apply when a pass isn't
 * listed. Pure: the renderer only copies these into GL.
 *
 * Returns { u: { uniform: value }, ramps: { cycle: [[ramp, fromEntry, speed]], grade: [[ramp, toRamp]] }, screen }.
 */
export function fxUniforms(resolved, look) {
  const on = Object.fromEntries(resolved.filter((p) => p.on).map((p) => [p.name, p.params]));
  const ramp = (r) => (typeof r === "number" ? r : look.ramp(r));
  const entry = (c) => {
    if (c == null) return -1;
    if (typeof c === "number") return c;
    const r = ramp(c.ramp);
    if (r < 0) return -1;
    const [base, len] = look.rampOf(r);
    return base + Math.max(0, Math.min(len - 1, c.index < 0 ? len + c.index : c.index));
  };
  const u = {};
  // Dither: the fx pass, or the style's own.
  const style = look.style ?? { screen: 4, dither: 0.9, outline: 1 };
  let screen = style.screen;
  let dither = style.dither;
  if (on.dither) { screen = on.dither.screen; dither = on.dither.amount; }
  else if (resolved.some((p) => p.name === "dither")) { screen = 0; dither = 0; }
  const bayer = { bayer2: 2, bayer4: 4, bayer8: 8, none: 0 };
  if (typeof screen === "string") {
    if (screen in bayer) { u.uScreen = bayer[screen]; screen = null; }
    else if (SCREENS[screen]) u.uScreen = -1;
    else throw new RangeError(`Unknown screen: ${screen}`);
  } else { u.uScreen = screen | 0; screen = null; }
  u.uDither = dither;
  // Outline: the pass, or the style's (the classic: 3 darker against anything behind).
  const ol = resolved.find((p) => p.name === "outline");
  if (ol) {
    u.uOutline = ol.on ? [1, ol.params.steps, ol.params.gap / look.far] : [0, 3, 0.004];
    u.uOutlineInk = ol.on ? entry(ol.params.color) : -1;
  } else { u.uOutline = [style.outline ? 1 : 0, 3, 0.004]; u.uOutlineInk = -1; }
  const crt = on.crt;
  u.uCrt = crt ? [1, crt.curve, Math.max(0, entry(crt.border)), 0] : [0, 0, 0, 0];
  u.uGrade = on.grade ? [1, on.grade.shift] : [0, 0];
  const fog = on.fog;
  u.uFog = fog ? [ramp(fog.ramp) >= 0 ? 1 : 0, fog.near, fog.far, fog.amount] : [0, 0, 1, 0];
  u.uFogLook = fog ? [Math.max(0, ramp(fog.ramp)), fog.light] : [0, 0];
  const glow = on.glow;
  u.uGlow = glow ? [1, glow.radius, glow.halo, glow.self] : [0, 1, 0, 0];
  u.uGlowK = glow ? [glow.threshold, glow.tint ? 1 : 0] : [1, 0];
  const rim = on.rim;
  u.uRim = rim ? [1, rim.width, rim.steps, 0] : [0, 1, 0, 0];
  u.uRimDir = rim && Array.isArray(rim.dir) ? rim.dir : null; // (null: the renderer aims it at the sun)
  const fl = on.flash;
  const mats = fl ? [...fl.mats, -1, -1, -1, -1, -1, -1, -1, -1].slice(0, 8) : Array(8).fill(-1);
  u.uFlash = fl ? [fl.amount, fl.ramp == null ? -1 : ramp(fl.ramp), fl.ids ? fl.ids[0] : 1, fl.ids ? fl.ids[1] : 0] : [0, -1, 1, 0];
  u.uFlashMats = mats;
  const vig = on.vignette;
  u.uVig = vig ? [1, vig.inner, vig.outer, vig.steps] : [0, 0, 1, 0];
  const sc = on.scanlines;
  u.uScan = sc ? [1, sc.period, sc.dark, sc.steps] : [0, 2, 0, 0];
  const cy = on.cycle;
  const cycle = [];
  if (cy) {
    for (const [name, o] of Object.entries(cy.ramps)) {
      const r = ramp(name);
      if (r < 0) continue;
      const len = look.rampOf(r)[1];
      cycle.push([r, Math.min(len - 1, Math.max(0, Math.round(o.from * len))), o.speed]);
    }
  }
  u.uCycle = cycle.length ? 1 : 0;
  const grade = [];
  if (on.grade) for (const [from, to] of Object.entries(on.grade.map)) { const a = ramp(from); const b = ramp(to); if (a >= 0 && b >= 0) grade.push([a, b]); }
  return { u, ramps: { cycle, grade }, screen };
}

/**
 * A screen's thresholds as a tile of bytes (SCREEN_TILE square), for the pixel
 * pass's screen texture: the core map sampled at every pixel.
 */
export function screenTile(id, tile = 192) {
  const at = SCREENS[id].at;
  const out = new Uint8Array(tile * tile);
  for (let y = 0; y < tile; y += 1) for (let x = 0; x < tile; x += 1) out[y * tile + x] = Math.max(0, Math.min(255, Math.round(at(x, y) * 255)));
  return out;
}
