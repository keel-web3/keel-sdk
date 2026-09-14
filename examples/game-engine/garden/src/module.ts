import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/garden", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "keel/core@^0.1", "keel/object@^0.1", "keel/world@^0.1", "keel/render@^0.1", "keel/input@^0.1"],
  title: "GARDEN",
  description: "A seeded plaza on the world runtime: animals wander and sit, an anthro you can drive (click, then WASD), frame shots, and a locks panel with explain().",
});
