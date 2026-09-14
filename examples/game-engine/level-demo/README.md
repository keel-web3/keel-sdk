# LEVEL DEMO (`examples/level-demo`)

A generated valley through `@keel/game-engine/level` and `@keel/game-engine/terrain` -- terrain heights, cliffs and
ramps, a river and the bridge a road needs over it, roads between three towns, houses along them (baked into the
ground: per-texel depth), foliage by biome -- and **2,000 people and animals** (a population: every character from
the humans and animals packs, dressed from the cloth pack, every one different) walking flow fields between the
towns, standing about, sparring. Seen three ways (`@keel/game-engine/view`):

- **the overview**, a continuous zoom from the whole valley (2 px/m) to one unit filling the picture (128 px/m);
- **possession**: a unit taken from its AI and driven, a chase camera behind it, in perspective;
- **first person** from its eyes.

All of it pixel art on a low-res target (480 x 270 by default) scaled up pixel for pixel.

```sh
node examples/game-engine/level-demo/tools/build.mjs
cp examples/game-engine/level-demo/tools/level.html ../keel-engine/out/level-demo/ && cp examples/game-engine/level-demo/tools/dist/level.js ../keel-engine/out/level-demo/dist/
# http://localhost:4300/out/level-demo/level.html?size=480x270&k=16
```

## Controls

| | |
| --- | --- |
| overview | WASD / arrows / drag pan · **wheel zooms** (continuous, 2..128 px/m) · click selects a unit · **F / Enter / double-click possesses** it · **B the GPU ground / the CPU bake** · T pixel / voxel style (voxel: the CPU bake) · 1-5 unit counts (500 .. 20,000) · G a new level · H the overlay · [ ] pixel size |
| possessed | **WASD / arrows** move (where the camera looks) · **Shift** runs · **Space / left click** strikes (keel/entity's attack) · E uses · **mouse** turns the camera (drag, or click for pointer lock) · **wheel** moves the camera in and out · **V / C** first person · **Esc** gives the unit back |
| gamepad | left stick moves, right stick looks, A strikes, X uses, L3/LT runs, B releases, Y first person |

URL: `seed`, `units`, `k`, `size=WxH`, `px`, `style`, `workers` (0: bake on the main thread), `locks`
(`scene/level.biome=desert;scene/level.template=island`), `ground=cpu` (the CPU bake), `groundArt` (the GPU ground's
largest art scale, default 48; 0: the view's own), `surface=0` (the classic look), `art` / `pdither` (the ground's texels
a metre and dither seen from the ground: 32 / 0.5), `legacy3d=1` (the perspective views as they were: terrain meshes,
3D tree parts, the raymarched sky, the old stream cadence), `trees3d=1`.

`globalThis.levelDemo` (measuring and shooting; rAF stops in a hidden page, so these run frames themselves):
`stats() profile() streams() frameCounts() world3d() mode() camera()` · `setSize setScale zoomTo setCenter setUnits
setStyle` · `possess(u) release() toggleFps() look(dyaw, dpitch) hold(codes) strike() select(u) near(n)` ·
`advance(n, dt) untilCrisp(ms, ground) measure(n) shoot(name) shootScaled(name, s) pause(on) quiet(on) freeze(on)` · `skip3d fx3d` ·
`setGround(gpu|cpu) setGroundArt(k) benchGround(n) showUnits(on) setFootprints(on)` · the checks:
`zoomSweep(steps, perFrame, dt)` (REAL wheel events through every rung and both pitch buckets; each frame's ground
coverage against every chunk on the GPU), `groundCoverage()`, `spriteCheckStrict(max)` (sprite by sprite: pixels the
ground hides, a top at its own level a fault, a cliff / house / higher ground an occluder).

## The ground: GPU by default (2026-09-14)

The overview's ground is keel/terrain's **GPU ground** (`createGpuGround` + `createGpuTerrain`): painted in a fragment
shader at the view's own scale, the whole valley's 16 chunks uploaded in ~23 ms (5.6 MB), 1.1-1.4 ms a 1920 x 1080
frame at every zoom from 2 to 128 px/m; its art no finer than 48 px/m (whole 2 x 2 / 3 x 3 blocks closer in). B switches
to the CPU bake (the reference, a floor of 2 px/m layers for every chunk and both pitch buckets baked when it's chosen).
The same ground is drawn in chase and first person (keel/render's raster hook): texels in texture space, the houses and
the bridge baked in, blob shadows, a pixel-cloud sky and a biome-tinted fog. Trees and props are pixel-art billboards
there (three baked sizes each), not 3D parts.

**The owner's two bugs, checked** (`zoomSweep`, `spriteCheckStrict`; this Mac, load ~29):

| | GPU ground | CPU bake (floor + last layer kept) |
| --- | ---: | ---: |
| wheel sweep 128 -> 2 -> 128, a notch a frame (96 frames), coverage min / frames under 99 % | 100 % / 0 | 99.48 % / 0 |
| three notches a frame (126 / 113 frames) | 100 % / 0 | 99.26 % / 0 |

Sprites (trees, props, units; up to 300 a view): ground-hidden pixels that are FAULTS (a top at the sprite's own level:
its footprint or the ground in front of its base), footprint depth vs the old middle depth -- 4 px/m 7 vs 784, 8: 26 vs
2,187, 16: 139 vs 6,293, 22.6: 15 vs 1,275, 32: 67 vs 1,883, 45: 38 vs 3,976, 64: 119 vs 1,267, 90: 601 vs 5,532, 128: 0
vs 0 (0.02-0.9 % of sprite pixels left: things held or worn reaching forward of a unit's 0.45 m). The houses are baked
into the ground (per-texel depth): they can't sink.

Perspective, the town's crowd (1920 x 1080, the same camera, baking paused / busy): chase 11.5 / 11.2 ms (cpu 7.6, the old
path: 7,465 solids, 502k triangles) -> **6.6-6.9 / 6.7-6.9 ms** (cpu 4.7-4.9: 31k triangles, 2,500-2,700 billboards);
first person 5.4-8.0 -> 6.9-7.3 ms. The final build, back to back on a quieter machine: chase in the crowd 5.6 / 6.6 ms
(`legacy3d=1`: 490k triangles) -> **2.9 / 3.1 ms** (30k triangles, 1,800 billboards, cpu 1.4-1.5). What did it: trees as billboards, no raymarched world under an all-raster picture
(`world: false`), a depth pre-pass so the GPU ground shades each pixel once, at most one sprite-stream re-order a frame
(every 12th while something's missing), the worker's batches every third frame and at most 24 atlas uploads (1.5 ms) a
frame in 3D.

## How it's built

| file | what |
| --- | --- |
| `cast.ts` | the population (like `examples/army`): 16 body shapes, ~540 wearable shapes, a look per unit; every body bakes its gaits and keel/entity's **attack** (`clipsFor: ACTION_BAKE_CLIPS`) |
| `units.ts` | flow-field walkers (walk, run, stand about, spar), one **possessed** unit driven by keel/view's commands through the same ground rules |
| `mobs.ts` | three sprite streams (bake's smart loader) as LOD bands: **far** (pitch 0.72, 8 directions, 2..19 px/m; a unit under 10 px is its body only), **near** (pitch 0.5, 16 directions, 13..128 px/m, every clip, everything worn), **eye** (pitch 0.14, 16 directions: billboards) -- one page array, one bake worker. Bodies may stand in from a bake up to 3x smaller (never missing), trees and props bake no closer than 48 px/m (`maxScale`) |
| `view3d.ts` | the perspective picture on keel/render's raster mode: terrain chunk meshes (keel/view), houses' and the bridge's boxes, trees' parts (their object definitions are 3D), near units posed live and dressed, far units and trees as billboards (from the lane baked nearest the angle each is seen at), dissolved into each other; the dissolve between two whole pictures (the swap) |
| `index.ts` | the page: the zoom and the view modes (keel/view `createZoom` / `createViewModes`), the command stream, the bake pump, input, the measuring API |

**The hybrid, near to far.** Within ~6 m (where a unit's sprite would be over 56 px tall; at most the 12 nearest) units
are **solid**: posed every frame from their clip (the possessed one through keel/entity's animator with the attack laid
over it), wearing their wearables on their sockets (`BodyShape.skeleton` + `placeAttribute`), each part on its own look's
ramp (200 look ramps a frame, allocated as they're needed). Trees are solid within 30 m -- each placed tree's parts made
once and appended whole each frame -- and houses always. Past that, **billboards**: the same sprites the overview draws,
at the scale they show at, hidden by what's in front through `render({ depthOut })`. Between, both, dissolved on a 4x4
screen. Past ~96 m nothing: the fog fx has taken it to the sky's ramp. A tree between the eye and the unit, or right at
the eye, thins out (dithered); the chase camera's arm keeps out of the ground and the houses near the unit.

**Deep zoom.** The zoom eases between rungs and lands on one; the streams bake that rung (debounced) and draw the nearest
baked scale meanwhile. The ground's chunk layers bake up to 32 px/m and are drawn scaled closer in (at 48 a chunk took
3.2 s, at 64 6 s and 24 MB -- keel/terrain's bake, measured below). Past 16 px/m (x 1.12) the pitch drops from 0.72 to
0.5 -- the near bucket, its own bake and its own ground baker, planned ahead as the zoom nears the edge. Past 40 px/m a
tree nearer than the middle of the picture and over its middle band is cut away. Sprites off the picture aren't marked
(a close zoom's ground rectangle holds far more than it shows).

## Measured (2026-09-14, this Mac, Chrome in the app's Browser pane -- a background tab, other agents' work running: numbers vary 20-30% run to run)

Overview, 480 x 270, 2,000 units, each zoom from the rung before (so the first scale of a bucket bakes the most).
"Crisp": every layer on the picture at its baked scale. "Busy": frames while the stream prefetches in the worker (it
shares the GPU); "idle": with baking paused (`quiet`). Memory: texture used / allocated per lane (MB).

| px/m | layers drawn | crisp after | ground ready after | frame busy (median / p95) | frame idle (median / p95, cpu) | memory |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 2 | 6,267 | 1.1 s | 1.0 s | 4.9 / 9.5 ms | 6.9 / 12.1, 6.1 ms | far 4/32 |
| 4 | 2,458 | 0.8 s | 1.1 s | 6.2 / 15 ms | 4.7 / 7.7, 4.0 ms | far 1/32 |
| 8 | 1,885 | 0.4 s | -- | 5.2 / 12.2 ms | 3.7 / 7.2, 2.9 ms | far 2/32 |
| 16 | 1,534 | 1.2 s | 1.5 s | 7.6 / 17.2 ms | 3.2 / 6.3, 2.4 ms | far 6/32 |
| 23 (new pitch) | 1,276 | 2.7 s | 3.0 s | 4.8 / 10.5 ms | 4.1 / 6.9, 3.1 ms | near 33/96 |
| 32 | 835 | 3.0 s | 3.9 s | 5.9 / 39.9 ms | 4.4 / 6.9, 3.5 ms | near 40/144 |
| 45 | 458 | 0.9 s | 0.7 s | 14.7 / 24 ms | 5.0 / 7.9, 4.3 ms | near 45/144 |
| 64 | 220 | 1.1 s | -- | 3.8-14 / 38 ms | 4.8 / 8.0, 4.3 ms | near 19/144 |
| 91 | 132 | 0.5 s | -- | 9.6 / 18.9 ms | 4.8 / 7.5, 4.0 ms | near 31/144 |
| 128 | 84 | 0.3-0.9 s | 0.2 s | 3.8-13 / 19 ms | 3.0 / 6.3, 2.4 ms | near 31/144 |

(At 1920 x 1080: 4 px/m, 8,326 layers, 5.6 / 10.1 ms idle; 64 px/m, 611 layers, 3.8 / 6.7 ms.) The ground's chunk bake
is keel/terrain's, on the main thread in the frame's spare time: 0.3-1.9 s a chunk at 32 px/m (it varies with the
machine's load), 3.2 s at 48, 6 s at 64 -- why the ground stops at 32.

Perspective views (the possessed unit in a crowd; baking paused):

| | picture | frame (median / p95, cpu) | solids | triangles | billboards | solid units |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| chase | 480 x 270 | 5.8-9.2 / 8.4-18 ms, 4.4-6.9 | 3,600-6,300 | 235-430k | 1,200-2,400 | 2-4 |
| first person | 480 x 270 | 7.2 / 11.8 ms, 5.2 | 6,845 | 470k | 295 | 5 |
| chase | 1920 x 1080 | 6.5 / 10.8 ms, 5.0 | 3,823 | 252k | 581 | 4 |
| first person | 1920 x 1080 | 9.5 / 15.3 ms, 5.3 | 5,006 | 331k | 2,137 | 6 |
| the town's crowd (worst seen) | 1920 x 1080 | 10.5 / 25 ms, 8.7 | 8,300 | 580k | 3,700 | 13 |

The dolly and the swap cost what a perspective frame costs (the swap draws both pictures for 0.14 s).

Screenshots (`keel-engine/out/`): `view-overview-*`, `view-zoom-*` (64 and 108 px/m), `view-transition-*` (the dolly
and the swap's dissolve), `view-chase-*` (and a strike), `view-fps-*` -- each at 480 x 270 (`-480`, and `-480x4`: the
same, 4x pixel for pixel) and 1920 x 1080 (`-1080`).
