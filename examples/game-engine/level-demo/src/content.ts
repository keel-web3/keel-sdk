// The level's content from the real packs: the foliage and buildings packs
// build what a generated level asks for, in the style it asks for, with
// placeholders only for what no pack knows. A level names things generically
// ("tree", "tuft", "boulder", "house"); this maps those names onto the packs'
// own objects and pins, and turns a level's reference into a placed content
// record the packs build.
//
// Two things a big world needs from it: keel/builder loaded (it registers the
// voxel style -- without it a voxel request falls back to pixel), and plants
// drawn from a few shapes per species (each off the shape grid, picked per
// plant by its seed), so thousands of trees bake a few dozen sprites, not one
// each.

import { chainContent, placeholderContent } from "@keel/game-engine/level";
import type { ContentResolver } from "@keel/game-engine/level";
import { placeContent, shapeGrid } from "@keel/game-engine/object";
import { createRoll, deriveSeed, stream } from "@keel/game-engine/core";
import "@keel/game-engine/builder"; // (registers the voxel style)
import type { ContentPack, ObjectDef } from "@keel/game-engine/object";
import { pack as foliage } from "@keel/game-engine/foliage";
import { pack as buildings } from "@keel/game-engine/buildings";

const PACKS: readonly ContentPack[] = [foliage, buildings];

// (A level's generic names -> the packs' objects, with a size where the name implies one.)
const ALIASES: Readonly<Record<string, { readonly pack: string; readonly id: string; readonly scale?: number }>> = {
  tree: { pack: foliage.id, id: "oak" },
  tuft: { pack: foliage.id, id: "grass" },
  boulder: { pack: foliage.id, id: "rock", scale: 1.8 },
  house: { pack: buildings.id, id: "cottage" },
  hut: { pack: buildings.id, id: "cottage" },
  barn: { pack: buildings.id, id: "workshop" },
  shrine: { pack: buildings.id, id: "tower" },
};
// (What a village's houses are drawn from: the buildings pack has ramps, fences and docks too.)
const HOUSES = ["cottage", "tower", "hall", "workshop", "shop"];
// (Plants come by the thousand: SHAPES shapes per species off a 3-step grid. Buildings are few: every one its own.)
const GRID_PACKS = new Set([foliage.id]);
const GRID_STEPS = 3;
const SHAPES = 12;

/** A resolver over the real packs: the pack builds it, or null (and a placeholder steps in). */
export function packsContent(): ContentResolver {
  const shapes = new Map<string, ReadonlyArray<Record<string, unknown>>>();
  const shapesOf = (def: Parameters<typeof shapeGrid>[0], key: string) => {
    let list = shapes.get(key);
    if (!list) {
      list = Array.from({ length: SHAPES }, (_, i) => shapeGrid(def, stream(createRoll(deriveSeed(key, i)), 0), { steps: GRID_STEPS }));
      shapes.set(key, list);
    }
    return list;
  };
  const find = (pack: string, id: string) => PACKS.find((p) => p.id === pack)?.get(id) ? { pack, id } : null;
  return {
    resolve(ref) {
      const alias = ALIASES[ref.object];
      const target = find(ref.pack, ref.object) ?? (alias ? find(alias.pack, alias.id) : null);
      if (!target) return null;
      try {
        const def = PACKS.find((p) => p.id === target.pack)!.get(target.id)!;
        // (A level's pins name the asset's own choices when they match; a pin the asset doesn't know is left out.)
        const pins = Object.fromEntries(Object.entries(ref.pins).filter(([k]) => k in def.choices));
        const grid = GRID_PACKS.has(target.pack) ? shapesOf(def, `${target.pack}/${target.id}`)[createRoll(deriveSeed(String(ref.seed), "shape")).index(0, SHAPES)]! : {};
        const placed = placeContent(PACKS, {
          pack: target.pack, id: target.id, seed: ref.seed, style: ref.style,
          pins: { ...grid, ...pins },
          ...(alias?.scale ? { scale: alias.scale } : {}),
        });
        return placed.instance.def as ObjectDef<Record<string, unknown>>;
      } catch {
        return null; // (the packs can't build this reference: the placeholder draws it)
      }
    },
    list(pack) {
      if (pack === buildings.id) return HOUSES.concat("bridge");
      return PACKS.find((p) => p.id === pack)?.objects.map((o) => o.id) ?? [];
    },
  };
}

/** The level's content: the real packs first, placeholders for anything they don't know. */
export const levelContent = (): ContentResolver => chainContent(packsContent(), placeholderContent());
