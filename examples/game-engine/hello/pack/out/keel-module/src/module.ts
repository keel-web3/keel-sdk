import { contentsOf, defineManifest } from "@keel/game-engine";
import { pack } from "./pack.ts";

export const manifest = defineManifest({
  id: "examples/hello-pack", version: "0.1.0", kind: "pack",
  needs: ["keel/runtime@^0.1"], provides: ["body/blob@1.0.0"],
  contents: contentsOf(pack), title: "Hello pack", description: "Two blobs and a party hat: the smallest pack.",
});
