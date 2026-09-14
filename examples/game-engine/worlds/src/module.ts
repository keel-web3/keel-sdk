import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/worlds", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/render@^0.1", "keel/bake@^0.1", "keel/object@^0.1", "keel/terrain@^0.1", "keel/level@^0.1", "keel/worldgen@^0.1", "keel/particles@^0.1", "packs/foliage@^1", "packs/buildings@^1", "packs/dungeon@^1", "packs/humans@^1", "packs/animals@^1", "packs/cloth@^1"],
  title: "WORLDS",
  description: "World generation in pixel art: an infinite overworld (climate biomes, rivers, lakes, villages, ruins, dungeon entrances) streamed a chunk at a time, biome swaps, seasons and creep; Diablo-style dungeons by five generators; a mixed map; foliage scattered by rules and swaying in the sprite shader.",
});
