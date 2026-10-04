# `src/physics` reference

The character body: kinematic, stepped at a fixed rate (WALLRUN: 120 Hz),
colliding with the same solids the renderer draws. Plain ES module, no
dependencies, no DOM; deterministic to the bit (same inputs, same run, on
every machine).

| Module | What |
| --- | --- |
| `src/physics/character.js` | `createCharacter`, `TUNING`, `boxDistance`, `wedgeDistance`, `solidDistance`, `wedgeSection`, `slopeOf`, `nearestOnRail` |

Tests: `tests/physics.test.mjs` (every move, one rule at a time) and
`tests/physics-golden.test.mjs` (recorded input sequences fingerprinted step
by step — the body's feel, pinned).

## The convention

`src/core/frame.js`, as everywhere: +y up; a solid's own frame +z front, +x
right; `yaw` turns it about +y, world → local `x' = c·x − s·z, z' = s·x + c·z`
(`c = cos yaw, s = sin yaw`). A box's local +z face looks along `frontOf(yaw)`.

## Solids

```js
{ c: [x, y, z], h: [hx, hy, hz], yaw = 0, mat }             // a box (half extents), turned about y
{ kind: "wedge", c, h, yaw, lo = 0, mat }                     // a wedge: a ramp (see below)
{ a: [x, y, z], b: [x, y, z], r, mat }                        // a capsule (renderer only; rails collide as rails)
```

**A wedge** is a box whose top slopes: its foot at local **+z** (height `lo × 2hy`,
0 by default: a knife edge), rising to full height at local **−z**. So its slope
looks along `frontOf(yaw)` — the side you walk up from is its front, as the
object catalogue's ramps face (`src/object/catalogue.js`: "+z the foot"). Its
slope is `slopeOf(w) = atan(2hy(1 − lo) / 2hz)`. The high end is a vertical face
looking back; the two sides are vertical faces.

`wedgeDistance(p, w)` → `{ d, n }` is exact inside and out (a convex polygon's
distance in the (z, y) section, combined with the x slab); the GPU's `sdWedge`
(`src/gpu/shaders.js`) is the same solid line for line (`tests/gpu.test.mjs`
checks them against each other). `solidDistance(p, s)` dispatches on `kind`.

## `createCharacter`

```js
import { createCharacter, TUNING } from "../src/physics/character.js";

const body = createCharacter({ boxes, wedges, rails, waterY, spawn, tuning });
body.step(1 / 120, { move: [x, z], jump: pressedThisStep, hold: jumpHeld });
body.pos, body.vel, body.mode, body.facing, body.events, body.slope, body.checkpoint
```

- `boxes` — solids. A box given with `kind: "wedge"` is taken as a wedge (so
  one list can feed both physics and `renderer.setWorld`).
- `wedges` — ramps (optional; `[]` by default).
- `rails` — polylines `[[x, y, z], ...]`.
- `waterY` — the water plane's height.
- `move` is a horizontal world direction (length ≤ 1): use
  `moveFromView(cam.yaw, forward, strafe)` (core/frame.js). `jump` is the press
  (an edge), `hold` whether it's held (for variable jump height).

**Modes**: `ground air wall grind skim sink`. **Events** (this step only):
`landed {speed}`, `jumped`, `wallStart {n}`, `wallRunning {n}`, `wallEnd`,
`wallJump {n}`, `railStart`, `grinding {tan}`, `railEnd`, `skimStart`,
`skimming`, `splashIn`, `respawn`; each carries `at` (the position).

### The rules (and what the tests hold them to)

| Move | Rule | Tuning |
| --- | --- | --- |
| jump | rises `jump² / 2g` (1.54 m) held; let go early and the rise has 2.4 g against it (0.64 m tapped); a running jump carries run speed × `2 jump / g` (6.8 m) | `jump 8.6`, `gravity 24`, `runSpeed 9.5` |
| coyote time | a jump just after running off an edge still counts | `coyote 0.1` s |
| jump buffer | a jump pressed just before landing fires on landing | `buffer 0.12` s |
| wall-run | in the air, faster than `wallMin`, going along a wall (not into it), on a wall that rises past the head, **on one of its faces** (not round an edge or an end): light gravity, speed kept along the face, a little pull into it; it ends after `wallTime`, when slow, or when the face runs out — **it never wraps round a wall's end**; a floor's edge (top below the head) is a step, not a wall; a wedge is never a wall | `wallMin 4.5`, `wallGravity 0.16`, `wallTime 1.35` |
| wall kick | jump on a wall: `wallKick` off the face and `wallUp` up | `wallKick 7.5`, `wallUp 7.4` |
| rail | falling onto a rail (within `railSnap` of it) catches it, pushed on by `railPush` but **never past `railMax`**; downhill speeds it, uphill slows it, it settles toward `railCruise`; it leaves at the end with a little lift, or on a jump. A rail's very end never catches a body going off it | `railSnap 0.45`, `railLift 0.28`, `railPush 3`, `railCruise 11`, `railMax 14` |
| water | at or below `waterY`: faster than `skimMin` it skims (drag `skimDrag`), slower it sinks; a skim that drags below `0.9 × skimMin` sinks | `skimMin 6.5`, `skimDrag 1.4` |
| respawn | a sinking body comes back at its checkpoint (where it last stood, +0.2 m) after `respawn` s | `respawn 0.9` |
| slopes (wedges) | up to `slopeMax` the body stands on a wedge — pushed out straight up, its velocity kept along the slope (it runs up and down at run speed, and never creeps down while stood); steeper, it's pushed out along the normal and slides. Over a crest either way (off a ramp's top onto a floor, or off a floor onto a ramp) it keeps its feet: it steps down onto ground within `stepDown` | `slopeMax 42`°, `stepDown 0.3` m |
| falling | never faster than `maxFall` (30 m/s = radius × 120 Hz, so no slab, however thin, is fallen through) | `maxFall 30` |
| collision | three spheres (feet, middle, head: radius 0.26 at 0.26 / 0.56 / 0.86 m) pushed out of every solid; only the into-the-wall part of the velocity is taken. At 120 Hz nothing moving under 31 m/s passes through anything (tested at 16 yaws with walls 2 cm thick, at run speed and at `railMax + wallKick`) | `radius 0.26` |

`tuning` overrides any of `TUNING` for one body.

**Boxes-only worlds step exactly as before wedges existed.** Wedge code runs
only when there are wedges; `tests/physics-golden.test.mjs` pins four runs to
the bit (one re-pinned on purpose when the wall-run stopped wrapping round
wall ends — the commit note is in the test). WALLRUN's autopilot: 200/200
seeds, the same trajectories to the bit before and after.

## Examples

```js
// A ramp up onto a ledge: foot toward +z at yaw 0, so turned by PI it climbs toward +z (foot at z = 1, top at z = 6).
const floor = { c: [0, -1, 0], h: [20, 1, 20] };
const ledge = { c: [0, 0.8, 8], h: [2, 0.8, 2] };
const ramp = { kind: "wedge", c: [0, 0.8, 3.5], h: [2, 0.8, 2.5], yaw: Math.PI };   // 17.7°
const body = createCharacter({ boxes: [floor, ledge, ramp], rails: [], waterY: -5, spawn: [0, 0.1, 0] });
for (let i = 0; i < 240 && body.pos[2] < 9; i += 1) body.step(1 / 120, { move: [0, 1], jump: false, hold: false });
// body.pos = [0, 1.6, 9.04], mode "ground": on the ledge, on its feet all the way up.

// Same world to the renderer:
renderer.setWorld({ boxes: [floor, ledge, ramp], capsules });   // the wedge is drawn as a wedge
```

## Limits and what isn't here

- Solids turn about y only (no pitch/roll); a slope is a wedge.
- Wedges are not wall-run surfaces (their sides vary in height); make a wall a box.
- `src/camera` collides its arm with `boxDistance` over `world.boxes` only — a
  wedge isn't in its world yet (see the report: the camera should use
  `solidDistance` over boxes and wedges).
- The object catalogue's ramps are still stairs of slabs; baking a ramp piece
  as one wedge is the object module's call (`prim: { type: "wedge", ... }`).
