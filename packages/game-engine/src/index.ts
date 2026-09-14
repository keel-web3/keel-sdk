// @keel/game-engine: the KEEL pixel-art game engine, carried by the SDK.
//
// A creator's project -- a pack, a game, a map, an AI -- imports what it needs
// from here: the authoring API below, and any engine part by name
// (`@keel/game-engine/entity`, `@keel/game-engine/render`, the standard packs
// `@keel/game-engine/pack-animals`...). Building turns the project's modules
// into KEEL modules (classic scripts that define themselves on KEEL_ENGINE)
// and a game into the KEEL document the chain assembles. This entry is the
// authoring API -- in a built module it IS the engine's keel/runtime (a lookup
// on the page, never a copy); building lives in `@keel/game-engine/build` (Node).
//
//   import { defineManifest, defineEntity, defineAttribute, definePack, fits } from "@keel/game-engine";
//   // build: keel-game document mygames/blob-party   (or buildGame from "@keel/game-engine/build")

export {
  contentsOf, createEngine, defineAttribute, defineEntity, defineManifest, definePack, fits, pageEngine, satisfies, splitRef,
} from "@keel-engine/runtime";
export type {
  AnyAttributeDef, AnyEntityDef, AttributeDef, AttributeTarget, Choice, EntityDef, Engine, FitResult, ModuleContext, ModuleKind,
  ModuleManifest, PackDef, Pins, Placed, Resolution, Socket, Stream,
} from "@keel-engine/runtime";
