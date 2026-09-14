import { defineManifest } from "@keel/game-engine/runtime";

// (It needs contracts, not particular packs: any pack of quadrupeds, of two-legged characters, of wearables, and any
// animal AI will do -- the registry brings every provider, and fits() decides who wears what.)
export const manifest = defineManifest({
  id: "examples/zoo",
  version: "0.1.0",
  kind: "game",
  needs: [
    "keel/runtime@^0.1", "keel/core@^0.1", "keel/entity@^0.1",
    "contract:body/quadruped@^1", "contract:body/humanoid@^1", "contract:ai/animal@^1", "contract:attributes/wearable@^1",
  ],
  title: "Zoo",
  description: "Animals herding and wandering under the engine's AI modules, people dressed in whatever wearables fit them: packs, wearables and behaviour composed by contract in one KEEL document.",
});
