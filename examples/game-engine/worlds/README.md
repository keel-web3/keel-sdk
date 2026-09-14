# WORLDS (`examples/game-engine/worlds`)

The engine's world generation (`@keel/game-engine/worldgen`) in pixel art,
through the new ground surface (`@keel/game-engine/terrain`) and the swaying
sprite layer (`@keel/game-engine/bake`). Three modes:

1. **Overworld**: an infinite Minecraft-style world streamed a chunk at a time
   (climate biomes, rivers, lakes, villages, ruins, dungeon entrances). Each
   chunk is generated, scattered and baked in the frame's spare time, visible
   chunks first; pan forever.
2. **Dungeon**: an action-RPG CRAWL (`src/crawl.ts`, `?mode=dungeon`; the old
   baked-light map is `?dungeon=classic`). A close 2:1 isometric camera
   (16 / 24 / 32 / 48 px/m, smooth follow, snapped to whole pixels) over
   keel/worldgen's dressed floor and renderer: walls 2-3 m tall cut away in
   front of the hero, doors that open as he comes (the locked one needs the
   key), flickering torches, braziers, candles, crystals and lava on a light
   map, his own light, fog of war (unexplored dark, explored dimmed),
   `packs/dungeon` props in each act's look, embers, smoke and motes from
   keel/particles, and 30 mobs from `packs/humans` and `packs/animals` that
   wander and chase. **WASD** / arrows walk, **click** walks there (A* on a
   half-metre grid with the body's clearance, doors opened on the way),
   **T** the generator, **N** the act (crypt, cave, forge, ruin; the stairs
   down also go to the next), **G** a new seed, **X** the cutaway (stub /
   dither / off), **L** lights, **F** fog, **R** reveal all, wheel zoom.
3. **Mixed**: one map from several generators -- a noise world, a
   cellular-automaton cave region, a WFC town, keel/level's valley template as
   a stage, a stitched crypt, a desert re-skin, a pinned rock.

```sh
node examples/game-engine/worlds/tools/build.mjs   # bundles, copies to keel-engine/out/worlds/
# http://localhost:4300/out/worlds/worlds.html?size=480x270&k=8
```

Keys: WASD / arrows / drag pan, wheel zoom (2-16 px/m), 1 2 3 mode, **B**
swaps the biome under the cursor (a ragged disc: desert, forest, peaks,
corruption, jungle, badlands, alien), **N** next season (a palette and a look
table: nothing rebakes), **C** drops creep that spreads, **T** / **A** dungeon
generator / act, **G** a new seed, **F** plants, **V** pixel / voxel ground
(pixel is the default), **U** the GPU ground / the CPU bake, **H** the overlay.

The ground is keel/terrain's **GPU ground** by default: each chunk's mesh and
tiles uploaded once (the overworld: as it's generated; every visible chunk the
frame it's needed), the surface painted at the view's scale. A biome swap re-packs
the touched chunks' tiles (2-4 chunks, 5-11 ms here), creep likewise (~5 ms a
step), a season is a palette (0.2 ms). Buildings and plants stand at their
footprint's front edge (keel/terrain `spritePosition`): checked in the WFC town
(`spriteCheck` with `setOnlyThings(true)`), 27-48 building sprites: 6 of 47,685
pixels hidden at 4 px/m, 0 at 8 / 12 / 16 -- at their middle's depth, 19-25 %
sank into the ground. A wheel sweep through every rung (`zoomSweep`), fresh
areas included: the GPU ground 100 % coverage every frame (a frame that must
generate a dozen new chunks is slow -- 0.3-0.9 s on this loaded Mac -- never
empty); the CPU bake (a 2 px/m floor baked for any visible chunk with nothing)
99.78 % minimum. URL: `mode`, `seed`, `k`,
`size=WxH`, `season`, `x`, `z`, `algo`, `layers=all` (every foliage layer at
any zoom), `wind=off`, `ground=cpu`. `globalThis.worlds`: `stats() measure(n) shoot(name)
bakeAll() setMode setAlgo setAct setSeason swapAt dropCreep stepCreep setScale
setCenter setSize setPlants setAllLayers setWind setGround ground()
groundCoverage() zoomSweep(steps, perFrame) spriteCheck() setOnlyThings
setFootprints`.

Sprites (`src/plants.ts`): every plant and structure object is baked INDEXED
once per shape (a few shapes per species off its shape grid, sorted by height:
an old tree takes a big shape); looks come per species, biome (its foliage
profile) and season, so a swap or a season rebuilds a look table, never a
bake. Each 32-tile bucket's instance floats are packed once per scale, season
and atlas; a frame copies the visible buckets in.

Measured (Chrome in the app's Browser pane, 2026-09-14): 1920 x 1080 at 3 px/m
with every layer, 68,808 swaying sprites and 121 ground layers -- 2.2 ms a
frame GPU-finished (2.0 with the wind off, 0.9 ground alone); 54-66k sprites on
another run 1.0-1.4 ms. Chunks generate in ~6 ms and bake in 6-11 ms at 3-4
px/m (74 ms at 16 px/m, sliced). Screenshots: `keel-engine/out/worldgen-*.png`.

The crawl: `globalThis.worlds.crawl` (`stats() setAct setAlgo setSeed
setDensity(d, w, h) setCutaway setFog setLights reveal walkTo setHero roomOf
dressing scene`, `k`), `worlds.step(n, dt)` (frames without
requestAnimationFrame, which a hidden pane stops) and
`await worlds.crawlShots("dungeon")` (every act at 480 x 270 and 1920 x 1080,
the cutaway on / dither / off, lit, ambient only, dark, a hero exploring:
`keel-engine/out/dungeon-*.png`). Measured 2026-09-14 (Apple M4 Max, Chrome):
1920 x 1080 native, cutaway on, a 96 x 72 BSP floor at density 1.6 all
revealed -- 1,223 props, 323 lights, 30 mobs, ~300 particles -- 1.4-1.6 ms a
frame GPU-finished (p95 2.2-2.6) at 24-48 px/m; the per-frame CPU step under
0.1 ms.
