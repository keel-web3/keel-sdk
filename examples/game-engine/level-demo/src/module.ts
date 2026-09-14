import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/level-demo", version: "0.1.0", kind: "game",
  needs: [
    "keel/runtime@^0.1", "keel/core@^0.1", "keel/render@^0.1", "keel/bake@^0.1", "keel/object@^0.1", "keel/world@^0.1", "keel/terrain@^0.1", "keel/level@^0.1", "keel/builder@^0.1",
    "keel/entity@^0.1", "keel/camera@^0.1", "keel/view@^0.1",
    "packs/foliage@^1", "packs/buildings@^1", "packs/humans@^1", "packs/animals@^1", "packs/cloth@^1",
  ],
  title: "LEVEL DEMO",
  description: "A generated valley: heights, cliffs and ramps, a river with a bridge, roads, foliage and houses; the ground baked per chunk; a population of people and animals walking flow fields -- a continuous deep zoom from the whole map to one unit, possessing a unit with a chase camera, and first person, all pixel art.",
});
