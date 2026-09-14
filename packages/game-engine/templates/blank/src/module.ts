import { defineManifest } from "@keel/game-engine";

export const manifest = defineManifest({
  id: "__GAME_ID__", version: "0.1.0", kind: "game",
  needs: ["keel/runtime@^0.1", "__PACK_ID__@^0.1"],
  title: "__TITLE__",
  description: "A blank KEEL game: a pixel canvas, a walker you move with the arrow keys, and the things in your own pack.",
});
