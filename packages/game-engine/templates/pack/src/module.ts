// __TITLE__'s own pack: what you make in the editor's Builder (characters,
// creatures, wearables, objects) lands in src/assets/ as one TypeScript file
// each, and this pack carries them into the game -- one KEEL module.
import { contentsOf, defineManifest } from "@keel/game-engine";
import { usesBuilder } from "./assets/index.ts";
import { pack, provides } from "./pack.ts";

export const manifest = defineManifest({
  id: "__PACK_ID__", version: "0.1.0", kind: "pack",
  needs: ["keel/runtime@^0.1", ...(usesBuilder ? ["keel/builder@^0.1"] : [])],
  provides, compatible: ["packs/humans@^1", "packs/animals@^1", "packs/cloth@^1"],
  contents: contentsOf(pack), title: "__TITLE__ pack", description: "The things made for __TITLE__ in the KEEL Builder.",
});
