// GARDEN's colours: four palettes (pick one, or lock one, with the setting
// "render.palette"), each a set of OKLCH ramps, dark to light, their hue
// drifting the way paint's does. The hero's and the animals' ramps follow
// their own colours (src/entity spec.colours), so the seed dresses them.
//
// Materials are the renderer's slots by index (4 is the water and 5 the sky,
// by the GPU shader's contract); the catalogue's names ("wood", "trim") are
// pointed at them by the project's settings (mat.wood = "oak"). Each animal
// gets its own fur material (critter-1 ...), so a cat and a fox differ.

import { oklch } from "../../src/core/palette.js";

/** A ramp: n entries from dark to light, chroma easing off at both ends, the hue turning by `turn`. */
function ramp(n, h, C, L0, L1, turn = 0) {
  return Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return oklch(L0 + (L1 - L0) * k, C * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + turn * (k - 0.5)); });
}
/** A ramp around a colour [L, C, hue] (an entity's suggestion): darker below it, lighter above. */
const around = ([L, C, h], n = 6, shift = 0) => ramp(n, h + shift, Math.max(C, 0.02), Math.max(0.12, L - 0.42), Math.min(0.97, L + 0.16), 14);

export const MATERIALS = [
  { name: "wall", ramp: "stone", light: 1, pattern: 1 }, //     0 stone: pillars, low walls
  { name: "floor", ramp: "paving", light: 0.95, pattern: 1 }, // 1 the plaza's paving
  { name: "metal", ramp: "metal", light: 1 }, //                2 legs, posts, bands
  { name: "dark", ramp: "dark", light: 0.8 }, //                3 eyes, shoes
  { name: "water", ramp: "water" }, //                          4 (the shader's water)
  { name: "sky", ramp: "sky" }, //                              5 (the shader's sky)
  { name: "oak", ramp: "oak", light: 1 }, //                    6
  { name: "teak", ramp: "teak", light: 1 }, //                  7
  { name: "grass", ramp: "grass", light: 0.95 }, //             8 the lawn
  { name: "glow", ramp: "glow", light: 1, glow: 0.45 }, //      9 bulbs, lit screens
  { name: "paint", ramp: "paint", light: 1 }, //                10 labels, trim, painted benches
  { name: "fur", ramp: "fur", light: 1.1 }, //                  11 the hero
  { name: "cloth", ramp: "cloth", light: 1 }, //                12
  { name: "accent", ramp: "accent", light: 1 }, //              13 pack, trousers, collars
  { name: "hedge", ramp: "grass", light: 0.72 }, //             14 hedges and bushes
  ...[1, 2, 3, 4].map((i) => ({ name: `critter-${i}`, ramp: `critter${i}`, light: 1.1 })), // 15-18 the animals
];

/** The hero's and the animals' material roles, by material name. */
export const HERO_MATERIALS = { dark: "dark", fur: "fur", furAlt: "fur", cloth: "cloth", clothAlt: "accent", accent: "accent", blush: "paint", hair: "dark" };
/** Animal `i`'s (1-based) material roles: its own fur. */
export const animalMaterials = (i) => ({ dark: "dark", fur: `critter-${((i - 1) % 4) + 1}`, blush: "paint", cloth: "accent", accent: "accent", hair: "dark" });

// The colours the hero and the animals suggest (their specs), or a default.
function wearOf(world) {
  const hero = world.entities.get("hero")?.spec.colours;
  const pet = (i) => world.entities.get(`animal-${i}`)?.spec.colours.fur ?? [0.65, 0.1, 55 + i * 40];
  return {
    fur: hero?.fur ?? [0.7, 0.08, 60], cloth: hero?.cloth ?? [0.55, 0.12, 200], accent: hero?.accent ?? [0.6, 0.14, 30],
    critters: [1, 2, 3, 4].map(pet),
  };
}

// Each palette: the world's mood as hues and lightness ranges; the characters' ramps ride along.
function build(mood) {
  return (world) => {
    const w = wearOf(world);
    const k = mood.chroma ?? 1;
    return {
      ramps: {
        stone: ramp(7, mood.stone, 0.02 * k, 0.2, 0.86, 10),
        paving: ramp(7, mood.paving, 0.035 * k, 0.28, 0.9, 12),
        metal: ramp(5, 240, 0.02, 0.2, 0.85),
        dark: ramp(3, 280, 0.02, 0.08, 0.3),
        water: ramp(7, mood.water, 0.1 * k, mood.waterL[0], mood.waterL[1], -20),
        sky: ramp(6, mood.sky, 0.06 * k, mood.skyL[0], mood.skyL[1], 25),
        oak: ramp(6, 62, 0.09 * k, 0.3, 0.84, 10),
        teak: ramp(6, 38, 0.1 * k, 0.24, 0.72, 14),
        grass: ramp(7, mood.grass, 0.13 * k, mood.grassL[0], mood.grassL[1], 25),
        glow: ramp(5, mood.glow, 0.15, 0.6, 0.98, 30),
        paint: ramp(6, mood.paint, 0.15 * k, 0.3, 0.85, 15),
        fur: around(w.fur),
        cloth: around(w.cloth),
        accent: around(w.accent),
        ...Object.fromEntries(w.critters.map((c, i) => [`critter${i + 1}`, around(c)])),
        petal: ramp(4, mood.petal, 0.12, 0.62, 0.95, 20),
      },
    };
  };
}

export const PALETTES = {
  meadow: build({ stone: 80, paving: 70, water: 205, waterL: [0.2, 0.85], sky: 225, skyL: [0.45, 0.95], grass: 135, grassL: [0.25, 0.82], glow: 85, paint: 12, petal: 345 }),
  dusk: build({ stone: 300, paving: 40, water: 260, waterL: [0.12, 0.7], sky: 25, skyL: [0.2, 0.82], grass: 150, grassL: [0.16, 0.66], glow: 60, paint: 330, petal: 50, chroma: 0.9 }),
  moss: build({ stone: 150, paving: 140, water: 170, waterL: [0.15, 0.75], sky: 160, skyL: [0.3, 0.9], grass: 140, grassL: [0.2, 0.8], glow: 120, paint: 130, petal: 110, chroma: 0.7 }),
  noir: build({ stone: 260, paving: 255, water: 250, waterL: [0.08, 0.5], sky: 265, skyL: [0.06, 0.4], grass: 200, grassL: [0.1, 0.5], glow: 330, paint: 330, petal: 330, chroma: 0.45 }),
};
