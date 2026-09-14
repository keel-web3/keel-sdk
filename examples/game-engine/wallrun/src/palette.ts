// WALLRUN's palette: ramps in OKLCH, dark to light, each one lightness walk
// with its hue drifting the way paint's does. The seed picks the character's
// colours (jacket, pack) and nudges the world's; the stone, the water and the
// sky keep the reference's mood -- grey tiles, a teal glow, a warm lid of cloud.
// (Its own oklchToRgb and ramp, as the proof of concept's palette.js: the
// colours stay the same to the byte.)

import type { Colours, MaterialTable, Oklch } from "@keel/game-engine/entity";
import type { Material } from "@keel/game-engine/render";
import { streamOf } from "./seed.ts";

export type Rgb = [number, number, number];
export interface Palette {
  colours: Rgb[];
  /** Ramps by name, in material order: [base, length] in colours. */
  ramps: Record<string, [number, number]>;
}

function oklchToRgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); }) as Rgb;
}
/** A ramp: n entries from dark to light, chroma easing off at both ends, the hue turning by `turn`. */
function ramp(n: number, h: number, C: number, L0: number, L1: number, turn = 0): Rgb[] {
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return oklchToRgb(L0 + (L1 - L0) * k, C * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); });
}

/** A ramp around a colour [L, C, hue] (an entity's suggestion): darker below it, lighter above. */
const rampAround = ([L, C, h]: Oklch, n = 5): Rgb[] => ramp(n, h, Math.max(C, 0.02), Math.max(0.12, L - 0.42), Math.min(0.98, L + 0.16), 12);

/** Colours and ramps (in material order) for a seed; `wear` (the runner's colours by role) sets its ramps. */
export function paletteOf(seed: string, wear: Colours | null = null): Palette {
  const S = streamOf(`${seed}|palette`);
  const jacketHue = S.pick([165, 180, 200, 140, 25, 300, 260]);
  const packHue = (jacketHue + S.pick([150, 180, 200])) % 360;
  const furHue = S.pick([80, 60, 30, 250]);
  const list: Record<string, Rgb[]> = {
    stone: ramp(8, 250 + S.between(-20, 20), 0.018, 0.16, 0.86, 10),
    rail: ramp(5, 230, 0.03, 0.3, 0.92),
    dark: ramp(3, 280, 0.02, 0.08, 0.3),
    water: ramp(8, 172 + S.between(-10, 10), 0.13, 0.12, 0.93, -20),
    sky: ramp(6, 45 + S.between(-15, 15), 0.035, 0.08, 0.7, 20),
    fur: ramp(5, furHue, 0.03, 0.55, 0.98),
    jacket: ramp(5, jacketHue, 0.12, 0.3, 0.8, 15),
    pack: ramp(5, packHue, 0.12, 0.28, 0.72, 15),
    blush: ramp(4, 15, 0.1, 0.5, 0.85),
    spark: ramp(5, 40, 0.19, 0.55, 0.97, 60),
    wood: ramp(5, 55 + S.between(-10, 10), 0.07, 0.25, 0.7, 10),
    glow: ramp(4, 70, 0.12, 0.7, 0.98, 20),
  };
  if (wear) {
    list["fur"] = rampAround(wear.fur);
    list["jacket"] = rampAround(wear.cloth);
    list["pack"] = rampAround(wear.accent);
    list["blush"] = rampAround(wear.blush, 4);
    list["furAlt"] = rampAround(wear.furAlt);
    list["clothAlt"] = rampAround(wear.clothAlt);
    list["hair"] = rampAround(wear.hair);
  }
  const colours: Rgb[] = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
  return { colours, ramps };
}

// Materials 0..15 (4 and 5 are the water and the sky, by the shader's contract).
export const MATERIALS: Material[] = [
  { ramp: "stone", light: 1, pattern: 1 }, // 0 walls
  { ramp: "stone", light: 0.9, pattern: 1 }, // 1 floors and platforms
  { ramp: "rail", light: 1, glow: 0.1 }, // 2 rails
  { ramp: "dark", light: 0.8 }, // 3 eyes, soles
  { ramp: "water" }, // 4 water
  { ramp: "sky" }, // 5 sky
  { ramp: "fur", light: 1.1 }, // 6 head, hood
  { ramp: "jacket", light: 1 }, // 7 jacket, sleeves
  { ramp: "pack", light: 1 }, // 8 pack
  { ramp: "blush", light: 1 }, // 9 inner ears, nose
  { ramp: "spark", light: 1, glow: 0.4 }, // 10 sparks
  { ramp: "furAlt", light: 1.1 }, // 11 muzzle, socks, tail tip
  { ramp: "clothAlt", light: 1 }, // 12 trousers
  { ramp: "hair", light: 1 }, // 13 hair
  { ramp: "wood", light: 1 }, // 14 benches, crates
  { ramp: "glow", light: 0.6, glow: 0.5 }, // 15 lamps, lit signs
];
// (The entity's material roles, onto the materials above.)
export const RUNNER_MATERIALS: MaterialTable = { dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9, furAlt: 11, clothAlt: 12, hair: 13 };
