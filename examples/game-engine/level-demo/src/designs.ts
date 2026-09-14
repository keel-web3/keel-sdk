// What the demo bakes as sprites from the level: every object definition it
// resolved (trees, bushes, rocks, the bridge: the content packs', placeholders
// for the rest). One palette for all of it -- the ground's, so a tree's leaf is
// the same green family as the grass under it. (The units are a population:
// cast.ts.)

import { bakeForRenderer, placeObject } from "@keel/game-engine/object";
import type { ObjectDef } from "@keel/game-engine/object";
import type { BakeMaterial, BakePalette, BakeSource, BakeWorld, DesignSpec } from "@keel/game-engine/bake";
import type { GroundPalette } from "@keel/game-engine/terrain";

/** Material names -> the object bake's material indices (4 and 5 are the baker's water and sky). */
export const MATS: readonly string[] = ["leaf", "wood", "stone", "pine", "-water", "-sky", "crystal", "petal", "plaster", "roof", "glass", "deck", "metal", "dark", "team0", "team1", "skin"];
export const MAT_INDEX: Readonly<Record<string, number>> = Object.fromEntries(MATS.map((m, i) => [m, i]));

/** The extra ramps the objects want beyond the ground's own (groundPalette's `materials`). */
export const OBJECT_RAMPS = {
  pine: { L: [0.2, 0.62], C: 0.1, h: 165 },
  petal: { L: [0.45, 0.92], C: 0.16, h: 340 },
  team0: { L: [0.3, 0.8], C: 0.18, h: 25 },
  team1: { L: [0.3, 0.82], C: 0.14, h: 250 },
  skin: { L: [0.45, 0.88], C: 0.07, h: 60 },
} as const;

/** The object bake's palette and materials, from the ground palette. */
export function objectLook(pal: GroundPalette): { palette: BakePalette; materials: BakeMaterial[] } {
  const materials: BakeMaterial[] = MATS.map((m) => ({ ramp: m.startsWith("-") ? "dark" : pal.ramps[m] ? m : "stone", light: m === "crystal" ? 1.15 : 1, ...(m === "crystal" ? { glow: 0.2 } : {}) }));
  return { palette: { colours: pal.colours, ramps: pal.ramps }, materials };
}

export type Design = DesignSpec & BakeSource;

/**
 * What an object bakes under: a styled object's own bake key (pack/id@style~geometry), so an oak in voxel
 * style and each differently shaped oak get their own sprites; plain definitions go by their key.
 */
export const bakeKeyOf = (def: ObjectDef<Record<string, unknown>>): string => {
  const styled = (def.meta as { styled?: { key?: unknown } } | undefined)?.styled;
  return typeof styled?.key === "string" ? styled.key : def.key;
};

/** An object definition as a bake design: one still frame, the same from every side (a tree), at the origin. */
export function objectDesign(def: ObjectDef<Record<string, unknown>>, pal: GroundPalette, look = objectLook(pal)): Design {
  const inst = placeObject(def, { pos: [0, 0, 0] });
  const baked = bakeForRenderer([inst], { mats: MAT_INDEX, bounds: true });
  const world: BakeWorld = { boxes: baked.boxes, capsules: baked.capsules };
  const b = def.bounds;
  return {
    key: `level-demo:${bakeKeyOf(def)}`, clips: [{ name: "still", frames: 1 }], height: Math.max(0.2, b[4]), radius: Math.max(0.2, Math.abs(b[0]), Math.abs(b[3]), Math.abs(b[2]), Math.abs(b[5])),
    symmetric: true, palette: look.palette, materials: look.materials, pose: () => world,
  };
}
