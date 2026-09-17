# KEEL game engine examples

Projects made with the KEEL pixel-art game engine, the way a creator makes
them: each reaches the engine only through the SDK (`@keel/game-engine`), and
each builds into KEEL modules and a KEEL document with `keel-game`.

| example | what it shows |
| --- | --- |
| `hello/` | the smallest pack (two blobs, a party hat) and a game that finds every pack providing `body/blob` and puts a hat that fits on each |
| `zoo/` | the engine's standard packs composed by contract: animals herding and wandering (`ai/herd`, `ai/wander` bound to `body/quadruped`), humans in cloth that fits them |
| `garden/` | the world runtime: a seeded plaza of object pieces, wandering animals, a drivable anthro (click to look, W forward), frame shots of each one's front, and a panel that locks species, palette, dither, fx and single objects, with `explain()` |
| `wallrun/` | a parkour course over dark water that runs itself until you play: wall-runs, a rail grind, pad hops, a tunnel; generative lo-fi and sound effects through keel-audio |
| `army/` | 10,000 unique generated characters (bodies × wearables × looks) baked once and painted per unit; a loading screen, then smart streaming: visible first, heroes (main tier) complete, zoom levels ahead of you (4..128 px/m) — 120 fps at 1920×1080 (B: bake overlay). The population is stored as a hybrid record (`src/record.ts`, 6.4 KB for 20,000 units: recipe, look re-rolls, and unit 0's voxel-built hero body that still wears seeded wearables and walks; `tools/record.ts` rewrites it) |
| `ui-demo/` | the generative UI: one `generateHud({ seed, culture })` call gives a whole themed RTS HUD (palette, frames, fonts, icons, layout); click, hotkeys, Tab and arrows work; only what changes is redrawn |
| `level-demo/` | a generated world: terrain heights, cliffs and ramps, rivers and lakes with a bridge, roads, the foliage and buildings packs (pixel or voxel style), 2,000 unique people and animals on flow fields — ground baked in chunks through the streaming cache; **view modes** (keel/view): a continuous deep zoom 2..128 px/m, possess a unit (F) for a perspective chase camera and first person (V), all pixel art |

Set up once (links the engine the SDK carries, and this folder to it):

```sh
node packages/game-engine/scripts/link-engine.mjs
```

Then, in an example:

```sh
cd examples/game-engine/hello
node ../../../packages/game-engine/src/cli.ts modules
node ../../../packages/game-engine/src/cli.ts document examples/hello   # -> out/documents/examples/hello/index.html
```

Every example is ordinary TypeScript: a `src/module.ts` manifest (what it is,
what it needs, what it provides) and a `src/index.ts`. Packs define entities
and attributes one file each; games export `main(host)` and, when they need to
find what's loaded, `setup(ctx)`.

TypeScript is the default, not a requirement. The same files work as plain
JavaScript (`src/module.js`, `src/index.js`, or a mix of `.ts` and `.js`).
The build discovers, links and verifies them the same way, so an existing JS
game can be ported onto the engine without being converted to TypeScript.
