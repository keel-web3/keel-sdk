// The demo's worlds, as recipes (keel/worldgen pipelines): what a game would
// store -- a few hundred bytes each -- and regenerate tile for tile.

import { defineRecipe } from "@keel/game-engine/worldgen";
import type { DungeonAlgorithm, WorldRecipe } from "@keel/game-engine/worldgen";

/** An infinite Minecraft-style overworld: climate biomes, rivers, lakes, villages, ruins and dungeon entrances. */
export const overworldRecipe = (seed: string, act: string | null = null): WorldRecipe => defineRecipe({
  seed, width: 0, depth: 0, act,
  stages: [
    { id: "ground", use: "overworld@1", params: { scale: 0.45, land: 0.12 } },
    { id: "plants", use: "foliage@1", params: { density: 1 } },
  ],
});

/** A Diablo-style dungeon floor: one generator, the act's tile theme. */
export const dungeonRecipe = (seed: string, algorithm: DungeonAlgorithm, act = "act1"): WorldRecipe => defineRecipe({
  seed, width: 84, depth: 60, act,
  stages: [{ id: "floor", use: "dungeon@1", params: { algorithm, rooms: 12 } }],
});

/**
 * A mixed map: a noise world with a cellular-automaton cave region carved into
 * it, a wave-function-collapse town, keel/level's valley template as a stage,
 * a dungeon reached from the surface, a re-skinned desert corner -- and a pin
 * the stages can't touch.
 */
export const mixedRecipe = (seed: string): WorldRecipe => defineRecipe({
  seed, width: 192, depth: 144,
  stages: [
    { id: "ground", use: "overworld@1", params: { land: 0.75, scale: 0.3, biomes: ["plains", "forest", "birch-forest", "river", "beach", "ocean", "alpine", "mountains", "dark-forest"] } },
    { id: "vale", use: "level@1", params: { template: "valley", biome: "temperate", towns: 2, worldBiome: "plains" }, mask: { kind: "rect", rect: [100, 72, 188, 140], feather: 4 } },
    { id: "caves", use: "cave@1", params: { floor: "gravel", wall: "rock", biome: "mountains" }, mask: { kind: "circle", at: [40, 104], r: 26, feather: 4 } },
    { id: "town", use: "town@1", mask: { kind: "rect", rect: [120, 12, 174, 54] } },
    { id: "crypt", use: "dungeon@1", params: { algorithm: "rooms", rooms: 9 }, mask: { kind: "rect", rect: [8, 8, 84, 62] } },
    { id: "dunes", use: "biome@1", params: { biome: "desert" }, mask: { kind: "circle", at: [104, 60], r: 20, feather: 3 } },
  ],
  pins: [{ rect: [94, 96, 100, 102], height: 6, type: "rock" }],
});
