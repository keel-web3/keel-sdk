import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/wallrun", version: "0.1.0", kind: "game",
  needs: [
    "keel/runtime@^0.1", "keel/core@^0.1", "keel/physics@^0.1", "keel/camera@^0.1", "keel/input@^0.1",
    "keel/particles@^0.1", "keel/entity@^0.1", "keel/object@^0.1", "keel/render@^0.1", "keel/audio@^0.1",
  ],
  title: "WALLRUN",
  description: "A seeded parkour course over dark water -- wall-runs, a rail, pads, a tunnel -- that runs itself until you play (click to look, W runs where you look, space jumps).",
});
