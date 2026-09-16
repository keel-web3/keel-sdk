# Objects and fronts

`src/object/` holds things that don't move -- props and level pieces -- and
`src/scene/front.js` works out which way anything faces. Plain ES modules, no
dependencies. Everything uses the one frame (`src/core/frame.js`):

```
own frame:  +z FRONT   +x RIGHT   +y UP        pivot: the middle of the base
yaw:        front(yaw) = [sin yaw, 0, cos yaw]  yaw = atan2(dx, dz); yaw 0 faces +z
```

Build an object facing +z in its own frame, and every system -- renderer,
physics, sockets, front detection -- agrees on where its front is at any yaw.

| Module | What |
| --- | --- |
| `src/object/object.js` | `defineObject`, `placeObject`, colliders, sockets, `settle` / `restsOn`, `bakeForRenderer` / `bakeForPhysics` |
| `src/object/prims.js` | boxes and capsules as parts (`boxPart`, `capsulePart`, `toPart`) that remember their primitive |
| `src/object/catalogue.js` | seeded level pieces and props: pillar, wall, pad, ramp, stairs, rail, arch, tunnel, crate, bench, sign, lampPost |
| `src/scene/front.js` | `detectFront`: declared fronts checked, features, use cases, geometry |
| `tools/front-audit.mjs` | read-only audit of NOCTURNES' fronts -> `out/front-audit.md` |

---

## Define an object

```js
import { defineObject } from "./src/object/object.js";

const desk = defineObject({
  key: "desk",
  front: "+z",                         // a yaw, a direction [x,y,z], "+z" / "-z" / "+x" / "-x", or null
  tags: ["prop", "furniture"],
  parts: [
    { box: { c: [0, 0.72, 0], h: [0.6, 0.03, 0.35] }, name: "top", mat: "wood" },
    { box: { c: [0.55, 0.345, 0.3], h: [0.03, 0.345, 0.03] }, name: "leg", mat: "wood" },
    { capsule: { a: [-0.5, 0.75, -0.2], b: [-0.5, 1.2, -0.2], r: 0.02 }, name: "pole", mat: "metal" },
    { box: { c: [0.1, 0.6, 0.36], h: [0.3, 0.05, 0.01] }, name: "drawer", mat: "wood", collide: false },
    // any scene/kit.js part works too: mk(sphere(...), { name: "knob" }), lathePart({...}), { sdf, bounds }
  ],
  sockets: { seat: { kind: "seat", pos: [0, 0.45, 0.6], yaw: Math.PI } },
  rest: "base",                        // "base" (stands on its lowest point), "hang", "float"
});
```

A part is any of:

| Spelling | Becomes |
| --- | --- |
| `{ box: { c, h, yaw }, name, mat, ... }` | a box part (`prim: { type: "box" }`); `yaw` turns it about y, frame.js sense |
| `{ capsule: { a, b, r }, name, mat, ... }` | a capsule part (`prim: { type: "capsule" }`) |
| `{ c, h, yaw?, name? }` / `{ a, b, r, name? }` | the renderer's own box / capsule records |
| `{ shape: { f, b }, name, mat }` | a `scene/kit.js` shape |
| `{ sdf, bounds, name, mat, ... }` | a part as it is (kit `part`, `mk`, `lathePart`, NOCTURNES parts) |

Part flags: `collide: false` (no collider), `collide: "bounds"` (an SDF part
collides as its bounds), `render: false` (not baked for the renderer),
`role` / `feature` (extra words for front detection), `feature: false` (never a feature).

The definition carries `parts`, `front` (a yaw, or null), `show`, `tags`,
`colliders`, `sockets`, `rest`, `rails`, `bounds` (local AABB) and `meta`.

**`front` vs `show`.** `front` is where the thing looks (a screen, a face, a
seat). `show` is the side to turn to a viewer when that is not the front -- a
piggy bank three-quarters on, a stapler side-on. It defaults to `front`.
NOCTURNES' `facing: true` means "+z is the side to show", which is usually,
not always, the front (see the audit).

## Place it

```js
import { placeObject, worldAabb, footprint, worldColliders, socketOf, yawToShow } from "./src/object/object.js";

const d = placeObject(desk, { pos: [4, 0, -3], yaw: Math.PI / 2, scale: 1 });
worldAabb(d);            // [x0,y0,z0,x1,y1,z1]
footprint(d);            // { corners: [[x,z] x4] (the local box, turned), rect: [x0,z0,x1,z1] }
placeObject(desk, { pos, yaw: yawToShow(desk, pos, cameraEye) });   // its show side to the camera
```

An instance is a `scene/entity.js` entity (`transform`, `parts`, `tags`,
`components.object.key`) plus `def` and `key`, so every `scene/bounds.js`
function works on it (`aabbOf`, `distance`, `raycast`, `touching`...). Objects
stand upright: position, yaw and a uniform scale.

## Colliders, rails and the renderer

```js
import { bakeForPhysics, bakeForRenderer } from "./src/object/object.js";
import { createCharacter } from "./src/physics/character.js";

const { boxes, rails } = bakeForPhysics(instances, { mats });
const body = createCharacter({ boxes, rails, spawn, waterY });
px.setWorld(bakeForRenderer(instances, { mats }));      // { boxes, capsules, skipped }
```

- A box part's collider IS its box; a capsule part's is a box along it (upright
  or level; otherwise its AABB, flagged `approx`); an SDF part collides only with
  `collide: "bounds"`. Give `colliders` to `defineObject` to override.
- World colliders are `{ c, h, yaw, mat }`: the instance's yaw adds to the
  box's (both frame.js yaws), so `boxDistance` in physics and the GPU shader see
  exactly the parts (`tests/object.test.mjs` checks physics distance == the parts' SDF).
- `mats` maps material names to the renderer's indices; numbers pass through.
- SDF parts the renderer can't draw come back in `skipped` (or as their bounds
  with `bounds: true`).
- Rails (`rails: [[ [x,y,z], ... ]]` in the own frame) come out in the world
  for `createCharacter({ rails })`.

Physics and the GPU renderer only have boxes turned about y and capsules: a
slope is its steps (the catalogue's ramp is thin slabs; stairs are blocks).

## Sockets

Named points in the object's own frame, returned in the world by the instance:

| kind | what | fields |
| --- | --- | --- |
| `top` | a surface to put things on | `pos` (middle of the top), `yaw`, `extent` [hx, hz] |
| `seat` | where hips go | `pos`, `yaw` (the way a sitter faces) |
| `grab` | a hand hold | `pos`, `yaw` |
| `view` | where to stand to look at it | `pos`, `yaw` (looking back at it) |
| `spawn`, `hang`, `anchor` | your own | `pos`, `yaw?`, `normal?`, `extent?`, `meta?` |

`defineObject` adds a `top` (the biggest box top nothing sits on; `topsOf`
lists them all) and a `view` (in front of the show side) when not given.

```js
socketOf(inst, "seat");      // { name, kind, pos (world), yaw (world), dir, extent (scaled), normal (world) }
worldSockets(inst);          // every socket, by name
socketsOfKind(inst, "top");
onSocket(inst, "top", p);    // is a world point on that top (inside its extent, at its height)?
```

## Resting: nothing floats

```js
import { settle, restsOn } from "./src/object/object.js";

const r = settle(crate, [pad, otherCrate, 0 /* a floor at y = 0 */]);
r.instance;   // moved straight down (or up, if sunk within stepUp) onto the highest support under it
r.gap;        // how far above that support it was (negative: sunk); null when nothing is under it
r.support;    // the support's id / "floor"
r.rests;      // false when nothing held it (and rest is "base")
restsOn(r.instance, pad);    // true
```

Supports are instances (their colliders), boxes `{ c, h, yaw }`, numbers or
`{ y }` (floors). The underside is sampled from the parts that reach the
object's lowest point (exact for boxes and capsules, marched for SDFs); a
support must cover `minCover` (0.25) of it. Options: `stepUp` (0.05),
`maxDrop`, `minCover`.

## The catalogue

```js
import { buildPiece, buildPieceFrom, pieceStream, PIECE_KEYS, registerCatalogue } from "./src/object/catalogue.js";

const wall = buildPiece("wall", seed, { length: 16, h: 10, sink: 1.5 });   // seed: bytes32 hex
const S = pieceStream(seed);                                              // a level's own stream
const pad = buildPieceFrom("pad", S, { w: 6, d: 6 });
registerCatalogue(registry);                                              // as the realm "Objects"
```

`ctx` sizes override the draws, but every draw still happens, so a size you
give never moves a later roll. `sink` pushes solids below the pivot (WALLRUN's
walls and pads stand 1.5 into the water).

| key | front (+z) | sockets | notes |
| --- | --- | --- | --- |
| pillar | by convention | `face`, `top` | |
| wall | one broad face | `runFront`, `runBack` (yaw: running +x), `top` | length along x |
| pad | by convention | `top` (extent), `spawn` | optional front lip |
| ramp | the foot you walk up from | `foot` (facing up it), `top` | rises toward -z, in slabs |
| stairs | the foot | `foot`, `top` | |
| rail | the way it's ridden | `start`, `end` (tangent yaws) | `rails: [line]`; bars don't collide |
| arch | the mouth you go in by | `entry`, `exit` | |
| tunnel | the entry mouth | `entry`, `exit`, `runLeft`, `runRight` | optional floor |
| crate | its label | `grabLeft`, `grabRight`, `top` | |
| bench | where you sit facing | `seat`, `seatLeft`, `seatRight` | backrest behind (75%) |
| sign | the display side | `face` | posts and stand behind |
| lampPost | where its head reaches | `light` (normal down) | |

**WALLRUN's course from pieces** (`tests/object.test.mjs` rebuilds
`projects/wallrun/level.js` exactly this way, box for box and the rail point
for point):

| level.js | piece |
| --- | --- |
| `floor(x0, x1, z0, z1, y)` | `pad { w, d, h, lip: false }` at the box's base |
| `wall(...)`, `pillar(...)`, the tunnel roof | `pillar { w, d, h }` at the box's base, the box's yaw (or `wall` turned a quarter: its length is x) |
| the rail | `rail { length, bend, rise, y: 1.15, segments: 12 }` at `[0, 0, z + 1.5]` (shape "ease" = its sin^2) |

Every piece's declared front is checked against its parts by the tests
(`agrees` is never false; for crate, sign, lamp post and a bench with a back it is true).

---

## Front detection

```js
import { detectFront } from "./src/scene/front.js";

const f = detectFront(thing, opts);
f.yaw, f.dir          // the front (world, when the thing has a transform; else its own frame)
f.confidence          // 0..1
f.declared, f.agrees  // a declared front, and whether the evidence agrees (true / false / null: can't tell)
f.symmetric           // a ball, a vase, a plain table: nothing tells a front
f.symmetry            // "round" | "mirror" | null
f.axisYaw             // the front lies along +-this (square to the long side)
f.detected            // { yaw, dir, confidence } from the evidence alone
f.local               // { yaw, dir, detectedYaw } in the thing's own frame
f.layers              // { features, useCase, geometry }: each { yaw, strength, ... }
f.why                 // plain-English lines: what each layer saw
```

`thing` is an object definition or instance, an entity with parts, an array of
parts, or raw solids `{ boxes: [{ c, h, yaw, name }], capsules: [{ a, b, r, name }] }`
in world space. A declared front comes from `opts.front`, `thing.front`,
`thing.def.front`, `thing.components.front`, or NOCTURNES' `facing: true` (= +z).

### The layers

1. **Declared** -- wins, but is checked: `agrees: false` and a `DISAGREES`
   line in `why` when the evidence points elsewhere (confidence drops to 0.5).
2. **Features** -- parts whose names say "front" or "back" (`FEATURES`): a
   face, eyes, a nose, a mouth, a screen, a display, a lens, a cone, a
   speaker grille, dials, knobs, buttons, keys, a door, a drawer, a photo; and
   behind: a backrest, a back, a tail, a hinge, a cable. Three measures:
   which way their visible surfaces face (normals where rays hit them, from a
   ring of views and from above -- keys and face buttons face UP and say little
   about the front), which views see them most, and where they sit off the
   body. A part's own declared normal (`normal: [x,y,z]`, or a NOCTURNES
   screen's `screen.ax x screen.ay` turned by its `rot`) counts most.
3. **Use cases** (`USE_CASES`) -- a seat faces out from its backrest; a
   screen away from its stand; a picture away from the leg it leans on;
   shelves away from their back; a lamp where its head reaches.
4. **Geometry** -- for unnamed things: round a ring of 24 views, which side is
   recessed (a chair's seat, an opening), busier with edges and part changes,
   a broad flat face, and which side the mass leans away from. It never makes
   a confident answer on its own (x0.6), and symmetric things come back
   `symmetric: true` with confidence <= 0.15 instead of a made-up yaw.

Layers combine as weighted vectors: confidence is how much they agree times
how strong they are. Everything is measured in the thing's own frame and
turned by its transform, so rotating the thing rotates the answer exactly; raw
world-space solids are measured where they are, with the ring laid along
their principal axis, so they turn with it too (to within a few degrees).

### Extend the vocabulary

```js
import { defineFeature, defineUseCase } from "./src/scene/front.js";

defineFeature("porthole", { side: "front", weight: 1 });
defineFeature("exhaust", { side: "back", weight: 0.8 });
defineUseCase({ why: "a cannon fires away from its breech", from: ["breech"], to: ["muzzle"] });

detectFront(ship, { features: { porthole: { side: "front", weight: 1 } } });   // for one call only
```

Names are split on spaces, dashes and camelCase, lower-cased, and plurals
fall back to the singular (`leftEye` -> eye, `Knobs` -> knob). Screen
materials (`mat: "screen"` / `"lcd"`) count as screens. Give a part
`role: "door"` when its name says nothing, or `feature: false` to keep a name
out ("face" on a controller's face buttons).

### Cost

A few milliseconds for a catalogue piece, 5-20 ms for a NOCTURNES object
(24 x 144 rays plus a top view). Reuse the evidence across placements of the
same parts: `detectFront(inst, { evidence: frontEvidence(def.parts) })`.

### Checking a scene

```js
import { frontOffFrom } from "./src/scene/front.js";
frontOffFrom(inst.transform.pos, detectFront(inst).yaw, cameraEye);   // 0 = full on, PI = its back
```

NOCTURNES yaws turn the other way (its `front(yaw) = [-sin, 0, cos]`): bring
them in with `fromNocturnesYaw` (`core/frame.js`). And note NOCTURNES' own
builders turn parts with `present({ yaw })` -- the kit rotation, the engine's
sense -- so a NOCTURNES object's built-in turn and its instance yaw add with
opposite signs. `tools/front-audit.mjs` measures what that does.

## The NOCTURNES audit

```sh
node tools/front-audit.mjs [--seeds 3] [--genomes 240] [--pairs 40]   # ~10-15 s -> out/front-audit.md
```

Read-only: it imports NOCTURNES' builders and genomes and measures them. It
reports (1) objects whose features are not on +z, (2) whether arranged rooms
show the camera the fronts they meant to, and (3) whether a chair turned to a
TV really faces it.
