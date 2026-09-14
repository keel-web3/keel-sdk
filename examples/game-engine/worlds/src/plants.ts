// The sprites a world draws: its plants (packs/foliage) and its structures'
// things (packs/buildings), baked INDEXED -- a shape once, painted by any
// number of looks at draw time -- so a season or a biome swap changes looks
// (a look table rebuilt) and never re-bakes a shape.
//
// Each species (a pack object with a rule's pins) gets a few shapes off its
// shape grid, sorted by height: an old tree takes a big shape, a young one a
// small one. Looks come per species, per biome (its foliage profile: dry on
// the savanna, fungal in the dark forest, ash in the blight) and per season.

import { createRoll, deriveSeed, stream } from "@keel/game-engine/core";
import { bakeDesignOf, lookFor, placeContent, shapeGrid } from "@keel/game-engine/object";
import type { BuiltObject, ContentPack, StyledBakeDesign } from "@keel/game-engine/object";
import { createLookTable, paintRoles, planBake, renderIndexedSprites } from "@keel/game-engine/bake";
import type { IndexedBakeRenderer, LookTable, SpriteCache, SpriteJob } from "@keel/game-engine/bake";
import { pack as foliage } from "@keel/game-engine/foliage";
import { pack as buildings } from "@keel/game-engine/buildings";
import { foliageProfile } from "@keel/game-engine/worldgen";

export const PACKS: readonly ContentPack[] = [foliage, buildings];

export interface Shape { readonly built: BuiltObject; readonly design: StyledBakeDesign; readonly height: number }
export interface Species {
  readonly index: number;
  readonly key: string;
  readonly pack: ContentPack;
  readonly object: string;
  /** Shapes, shortest first. */
  readonly shapes: readonly Shape[];
  readonly foliage: boolean;
}

/** Where a shape's sprite is on the atlas, and the scale it was baked at. */
export interface SpriteRect { x: number; y: number; w: number; h: number; ax: number; ay: number; page: number; k: number }

export interface Catalogue {
  /** A species by pack, object and pins (built the first time it's asked for). */
  species(pack: string, object: string, pins?: Readonly<Record<string, string | number | boolean>>): Species | null;
  readonly list: readonly Species[];
  /** Bake every shape (what isn't cached) at a scale: the atlas pages and each shape's rect. */
  bake(px: IndexedBakeRenderer, cache: SpriteCache, k: number, pitch: number, maxSize: number): { pages: ReturnType<SpriteCache["atlas"]>["pages"]; rects: Map<string, SpriteRect>; ms: number; sprites: number };
  /** The look table for a season; `lookOf(species, biomeId, variant)` indexes it. */
  looks(season: string): { table: LookTable; lookOf(s: Species, biome: string, variant: number): number };
}

const SHAPES = (obj: string): number => (obj === "grass" || obj === "flowers" || obj === "reeds" ? 5 : 4);

export function createCatalogue(): Catalogue {
  const list: Species[] = [];
  const byKey = new Map<string, Species | null>();
  return {
    list,
    species(packId, object, pins = {}) {
      const key = `${packId}/${object}${Object.keys(pins).length ? `|${JSON.stringify(pins)}` : ""}`;
      if (byKey.has(key)) return byKey.get(key)!;
      const pack = PACKS.find((p) => p.id === packId);
      const def = pack?.get(object);
      if (!pack || !def) { byKey.set(key, null); return null; }
      const shapes: Shape[] = [];
      for (let n = 0; n < SHAPES(object); n += 1) {
        try {
          const grid = shapeGrid(def, stream(createRoll(deriveSeed(key, n)), 0), { steps: 2 });
          const placed = placeContent(PACKS, { pack: packId, id: object, seed: `${key}#${n}`, style: "pixel", pins: { ...grid, ...pins } });
          const design = bakeDesignOf(placed.built);
          if (shapes.some((s) => s.design.key === design.key)) continue;
          shapes.push({ built: placed.built, design, height: design.height });
        } catch { /* (a pin the object can't take: that shape is skipped) */ }
      }
      if (!shapes.length) { byKey.set(key, null); return null; }
      shapes.sort((a, b) => a.height - b.height);
      const s: Species = { index: list.length, key, pack, object, shapes, foliage: packId === foliage.id };
      list.push(s);
      byKey.set(key, s);
      return s;
    },
    bake(px, cache, k, pitch, maxSize) {
      const t0 = performance.now();
      const designs = list.flatMap((s) => s.shapes.map((sh) => sh.design));
      const plan = planBake(designs as never, { directions: 1, pixelsPerMetre: k, pitch, style: "worlds.indexed" });
      const sources = new Map(designs.map((d) => [d.key, d]));
      const todo = cache.missing(plan.sprites);
      // (Depth sprites: a height per texel -- each texel at the depth of the point it shows, keel/bake depth.ts.)
      if (todo.length) cache.add(renderIndexedSprites(px, todo, sources as never, { heights: true }).baked);
      const atlas = cache.atlas(plan.sprites.map((j) => j.key), { size: maxSize });
      const rects = new Map<string, SpriteRect>();
      for (const j of plan.sprites as readonly SpriteJob[]) {
        const r = atlas.sprites.get(j.key);
        if (r) rects.set(j.design, { x: r.x, y: r.y, w: r.w, h: r.h, ax: r.ax, ay: r.ay, page: r.page, k });
      }
      return { pages: atlas.pages, rects, ms: performance.now() - t0, sprites: todo.length };
    },
    looks(season) {
      const table = createLookTable({ rampLength: 5 });
      const cache = new Map<string, number>();
      return {
        table,
        lookOf(s, biome, variant) {
          const profileId = s.foliage ? foliageProfile(biome, season) : undefined;
          const key = `${s.index}|${profileId ?? "-"}|${variant}`;
          let at = cache.get(key);
          if (at !== undefined) return at;
          const def = s.pack.get(s.object)!;
          const profile = profileId ? s.pack.profile(profileId) : (def.look.profiles?.[0] ? s.pack.profile(def.look.profiles[0]) : undefined);
          const look = lookFor(s.shapes[0]!.built, `${s.key}~${variant}`, profile ? { profile } : {});
          at = table.add(paintRoles(look));
          cache.set(key, at);
          return at;
        },
      };
    },
  };
}
