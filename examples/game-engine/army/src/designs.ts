// The army's cast: every character from packs/humans and packs/animals (the
// tiny mouse on four legs sits out: at an army's scale it's a pixel), a body
// shape or three each, dressed from packs/cloth and packs/animals' own
// attributes -- and a population of thousands drawn from them, every unit
// different (populate: a look kept apart from its kind, wearables in shape
// variants with looks of their own). And a few props for the ground (grass,
// stones, flowers), which bake from a single direction the old way (colours
// baked in).
//
// The population is stored as a HYBRID RECORD (bake's recordOf, the bit
// codec's HYBRID_POPULATION): the recipe -- this module and the three packs at
// their exact versions, a seed, a count -- the looks' re-rolls, and one
// explicit part: unit 0's body is a voxel hero from the builder, which still
// wears seeded things fitted to its own sockets and walks with the rest.
// record.ts holds seed 1's record for 20,000 units (a few KB); every smaller
// army is its first units (recordPrefix), so the page reads its population
// from it -- no look pools -- and makes one from the recipe for any other seed.

import { createRoll, deriveSeed, oklch, stream } from "@keel/game-engine/core";
import { pack as animals } from "@keel/game-engine/animals";
import { manifest as animalsManifest } from "@keel/game-engine/animals/module";
import { bootsLeft, bootsRight, pack as cloth } from "@keel/game-engine/cloth";
import { manifest as clothManifest } from "@keel/game-engine/cloth/module";
import { pack as humans } from "@keel/game-engine/humans";
import { manifest as humansManifest } from "@keel/game-engine/humans/module";
import { generate, voxelBody, voxelBodyReader } from "@keel/game-engine/builder";
import type { VoxelBody } from "@keel/game-engine/builder";
import { fromBase64 } from "@keel/game-engine/codec";
import type { HybridRecord } from "@keel/game-engine/codec";
import { dressPopulation, generatorOptions, populateShapes, readRecord, recordOf, recordPrefix, shapesOf } from "@keel/game-engine/bake";
import type {
  BakeMaterial, BakePalette, BakeSource, BakeWorld, CastAttribute, CastEntity, DesignSpec, HybridEnv, IndexedSource, Population, PopulationGenerator, PopulationOptions, PopulationShapes,
} from "@keel/game-engine/bake";
import { manifest } from "./module.ts";
import { ARMY_RECORD } from "./record.ts";

/** Who's in the army: every character, with how many body shapes each gets. */
export function armyCast(): { entities: CastEntity[]; attributes: CastAttribute[] } {
  const entities: CastEntity[] = [
    // (People and anthros carry their packs and accessories as wearables, so their bodies leave them off.)
    ...humans.entities.map((def): CastEntity => ({
      def, pack: "packs/humans", pins: { pack: "none", accessory: "none" }, weight: def.id === "human" ? 3 : 1, shapes: def.id === "human" ? 3 : 1,
      ...(def.id === "human" ? { wear: [{ defs: [bootsLeft, bootsRight], chance: 0.5 }] } : {}),
    })),
    ...animals.entities.filter((d) => d.id !== "mouse").map((def): CastEntity => ({ def, pack: "packs/animals", shapes: 1 })),
  ];
  const attributes: CastAttribute[] = [
    ...cloth.attributes.filter((a) => a.layer !== "body").map((def): CastAttribute => ({ def, weight: def.id === "flag" ? 0.6 : def.id === "cape" ? 0.8 : 1 })),
    ...animals.attributes.map((def): CastAttribute => ({ def })),
  ];
  return { entities, attributes };
}

/** The army as a population generator: this module and the packs it draws from, at their exact versions (what a record names). */
export const ARMY: PopulationGenerator = {
  modules: [`${manifest.id}@${manifest.version}`, `${humansManifest.id}@${humansManifest.version}`, `${animalsManifest.id}@${animalsManifest.version}`, `${clothManifest.id}@${clothManifest.version}`],
  cast: () => ({ ...armyCast(), shapes: 1, wear: [1, 3], variants: 6 }),
};
/** What reading the army's records takes: its generator, and the builder's reader for voxel bodies. */
export const ARMY_ENV: HybridEnv = { generators: [ARMY], parts: [voxelBodyReader()] };

/** The hero: unit 0's body, built from voxels (the builder's two-legged critter at a person's height), rigged onto the humanoid contract. */
export const HERO = 0;
let hero: VoxelBody | null = null;
export const armyHero = (): VoxelBody => (hero ??= voxelBody(generate("critter", "1", { plan: "humanoid", unit: 0.075 }).model));

/** The army's population options: its cast, the seed (derived), `count` units, the voxel hero as unit 0's body (pinned a person: its look is a person's). */
export function armyOptions(seed: string, count: number): PopulationOptions {
  return generatorOptions(ARMY, deriveSeed(seed, "army/population"), count, {
    explicit: new Map([[HERO, { body: armyHero() }]]),
    pins: new Map([[HERO, { body: { entity: "human" } }]]),
  });
}

let stored: HybridRecord | null = null;
/** The stored record (record.ts) cut to `count` units -- or null: another seed, or more units than it holds. */
export function storedRecord(seed: string, count: number): HybridRecord | null {
  if (seed !== ARMY_RECORD.seed || count > ARMY_RECORD.count) return null;
  return recordPrefix(stored ??= readRecord(fromBase64(ARMY_RECORD.bytes)), count);
}

/** The army's record: the stored one when it covers the army, else made from the recipe (the look pools run once). */
export const armyRecord = (seed: string, count: number): HybridRecord => storedRecord(seed, count) ?? recordOf(armyPopulation(seed, count));

/** The army's population: `count` units, every one different, from the cast's few shapes. */
export function armyPopulation(seed: string, count: number): Population {
  return dressPopulation(armyShapes(seed, count));
}

/**
 * The population's shapes and its units' (no looks yet): what the scene and the bake need, fast; dressPopulation() adds
 * the looks -- straight from the record's re-rolls when it came from the stored record, through the look pools otherwise.
 */
export function armyShapes(seed: string, count: number): PopulationShapes {
  const rec = storedRecord(seed, count);
  return rec ? shapesOf(rec, ARMY_ENV) : populateShapes(armyOptions(seed, count));
}

/** Everything the army bakes, by key: its shapes (indexed) and its props (colours baked in) -- what a bake worker draws from. */
export function armySources(seed: string, count: number): { indexed: Map<string, IndexedSource>; plain: Map<string, BakeSource> } {
  const pop = armyShapes(seed, count);
  return {
    indexed: new Map<string, IndexedSource>([...pop.bodies, ...pop.attributes].map((d) => [d.key, d])),
    plain: new Map<string, BakeSource>(propDesigns(seed).map((d) => [d.key, d])),
  };
}

// ---------------------------------------------------------------- props

export interface PropDesign extends DesignSpec, BakeSource {}

// (A ramp dark to light at a hue, as the entity palettes make them.)
const ramp = (n: number, h: number, C: number, L0: number, L1: number): Array<[number, number, number]> =>
  Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return oklch(L0 + (L1 - L0) * k, C * Math.sin(Math.PI * (0.15 + 0.7 * k)), h + 14 * (k - 0.5)); });

/** The ground's colours: its own ramps (grass, stone, petals), and the ground's flat colour (0..1). */
export function groundLook(seed: string): { palette: BakePalette; materials: BakeMaterial[]; ground: [number, number, number] } {
  const S = stream(createRoll(deriveSeed(seed, "army/ground")), 0);
  const grassHue = 120 + S.between(-25, 15);
  const list = { grass: ramp(5, grassHue, 0.09, 0.28, 0.78), stone: ramp(5, 250 + S.between(-30, 30), 0.02, 0.3, 0.85), petal: ramp(4, S.pick([20, 55, 300, 330, 200]), 0.15, 0.5, 0.92), dark: ramp(3, grassHue + 20, 0.04, 0.15, 0.3) };
  const colours: Array<[number, number, number]> = [];
  const ramps: Record<string, [number, number]> = {};
  for (const [name, r] of Object.entries(list)) { ramps[name] = [colours.length, r.length]; colours.push(...r); }
  const g = oklch(0.4, 0.06, grassHue + 8);
  return {
    palette: { colours, ramps },
    materials: [{ ramp: "dark" }, { ramp: "grass", light: 1.2 }, { ramp: "stone" }, { ramp: "petal", light: 1.2 }, { ramp: "dark" }, { ramp: "dark" }],
    ground: [g[0] / 255, g[1] / 255, g[2] / 255],
  };
}

/** A few ground props: tufts of grass, stones, flowers. */
export function propDesigns(seed: string): PropDesign[] {
  const look = groundLook(seed);
  const S = stream(createRoll(deriveSeed(seed, "army/props")), 0);
  const make = (name: string, world: BakeWorld): PropDesign => {
    let height = 0, radius = 0;
    for (const c of world.capsules ?? []) for (const p of [c.a, c.b]) { height = Math.max(height, (p[1] ?? 0) + c.r); radius = Math.max(radius, Math.hypot(p[0] ?? 0, p[2] ?? 0) + c.r); }
    return { key: `examples/army:prop/${name}#${seed}`, clips: [{ name: "still", frames: 1 }], height, radius, symmetric: true, palette: look.palette, materials: look.materials, pose: () => world };
  };
  const tuft = (i: number) => {
    const blades = S.int(3, 5);
    return make(`tuft${i}`, { capsules: Array.from({ length: blades }, (_, b) => { const a = (b / blades) * 6.28 + S.f(); const l = 0.25 + S.f() * 0.25; return { a: [0, 0, 0], b: [Math.sin(a) * l * 0.4, l, Math.cos(a) * l * 0.4], r: 0.035, mat: 1 }; }) });
  };
  const stone = (i: number) => make(`stone${i}`, { capsules: Array.from({ length: S.int(1, 3) }, (_, k) => { const r = 0.12 + S.f() * 0.18; const x = (S.f() - 0.5) * 0.3 * k; const z = (S.f() - 0.5) * 0.3 * k; return { a: [x, r * 0.6, z], b: [x + r * 0.4, r * 0.6, z], r, mat: 2 }; }) });
  const flower = (i: number) => make(`flower${i}`, { capsules: [{ a: [0, 0, 0], b: [0.04, 0.32, 0], r: 0.025, mat: 1 }, { a: [0.04, 0.36, 0], b: [0.04, 0.36, 0], r: 0.07, mat: 3 }, { a: [-0.1, 0, 0.05], b: [-0.14, 0.2, 0.06], r: 0.025, mat: 1 }] });
  return [tuft(0), tuft(1), tuft(2), stone(0), stone(1), flower(0)];
}
