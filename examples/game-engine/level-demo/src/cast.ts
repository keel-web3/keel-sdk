// The valley's people and animals: every character from packs/humans and
// packs/animals (the mouse sits out -- at a valley's scale it's a pixel),
// dressed from packs/cloth and the animals' own attributes, as a POPULATION
// the way examples/army makes its army: a few body shapes per character, a
// few hundred wearable shapes, and every unit its own look painted at draw
// time -- so two thousand walkers are two thousand different characters for
// the cost of a few dozen bakes. Every body also bakes keel/entity's attack
// (ACTION_BAKE_CLIPS): what a unit does when it's told to strike, from the
// whole-map view down to a close zoom.

import { deriveSeed } from "@keel/game-engine/core";
import { pack as animals } from "@keel/game-engine/animals";
import { manifest as animalsManifest } from "@keel/game-engine/animals/module";
import { bootsLeft, bootsRight, pack as cloth } from "@keel/game-engine/cloth";
import { manifest as clothManifest } from "@keel/game-engine/cloth/module";
import { pack as humans } from "@keel/game-engine/humans";
import { manifest as humansManifest } from "@keel/game-engine/humans/module";
import { ACTION_BAKE_CLIPS, dressPopulation, generatorOptions, populateShapes } from "@keel/game-engine/bake";
import type { CastAttribute, CastEntity, Population, PopulationGenerator, PopulationShapes } from "@keel/game-engine/bake";
import { manifest } from "./module.ts";

/** Who lives in the valley: people (most), anthros, and animals; with what they may wear. */
export function valleyCast(): { entities: CastEntity[]; attributes: CastAttribute[] } {
  const entities: CastEntity[] = [
    ...humans.entities.map((def): CastEntity => ({
      def, pack: "packs/humans", pins: { pack: "none", accessory: "none" }, weight: def.id === "human" ? 5 : 1, shapes: def.id === "human" ? 3 : 1,
      ...(def.id === "human" ? { wear: [{ defs: [bootsLeft, bootsRight], chance: 0.5 }] } : {}),
    })),
    ...animals.entities.filter((d) => d.id !== "mouse").map((def): CastEntity => ({ def, pack: "packs/animals", shapes: 1, weight: 0.5 })),
  ];
  const attributes: CastAttribute[] = [
    ...cloth.attributes.filter((a) => a.layer !== "body").map((def): CastAttribute => ({ def, weight: def.id === "flag" ? 0.4 : def.id === "cape" ? 0.8 : 1 })),
    ...animals.attributes.map((def): CastAttribute => ({ def })),
  ];
  return { entities, attributes };
}

/** The valley's population generator: this module and the packs it draws from, at their exact versions. */
export const VALLEY: PopulationGenerator = {
  modules: [`${manifest.id}@${manifest.version}`, `${humansManifest.id}@${humansManifest.version}`, `${animalsManifest.id}@${animalsManifest.version}`, `${clothManifest.id}@${clothManifest.version}`],
  cast: () => ({ ...valleyCast(), shapes: 1, wear: [1, 3], variants: 5, clipsFor: ACTION_BAKE_CLIPS }),
};

/** The population's shapes (what the scene and the bake need; the looks come after). */
export const valleyShapes = (seed: string, count: number): PopulationShapes => populateShapes(generatorOptions(VALLEY, deriveSeed(seed, "valley/population"), count));
/** The whole population: shapes and every unit's look. */
export const valleyPopulation = (seed: string, count: number): Population => dressPopulation(valleyShapes(seed, count));
