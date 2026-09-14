import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/army", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/render@^0.1", "keel/entity@^0.1", "keel/bake@^0.1", "keel/codec@^0.1", "keel/builder@^0.1", "packs/humans@^1", "packs/animals@^1", "packs/cloth@^1"],
  title: "ARMY", description: "Thousands of units, every one a different character: a few dozen shapes baked once as indexed sprites, every unit's look painted at draw time, wearables as their own layers; instanced sprites at 120 fps. The population is stored as a hybrid record (recipe, re-rolls, a voxel hero's body) of a few KB.",
});
