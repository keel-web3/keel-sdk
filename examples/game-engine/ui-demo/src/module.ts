import { defineManifest } from "@keel/game-engine/runtime";

export const manifest = defineManifest({
  id: "examples/ui-demo", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "keel/ui@^0.1"],
  title: "UI DEMO",
  description: "A generated RTS HUD: one generateHud call gives the theme (palette, frames, fonts, icons, motion) and the layout; the seed and culture change everything.",
});
