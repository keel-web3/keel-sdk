# `src/entity` reference

Things that move: people, anthro animals (an animal's head, ears, tail and
snout on a person's body -- the WALLRUN runner) and animals on four legs. A
seed makes a **spec**; the spec's **rig** is posed by **clips** (or an
**animator** driven by a physics body); a **skin** turns the posed skeleton
into capsules for the renderer; **front.js** says which way the thing faces.
Plain ES modules, no dependencies, deterministic from the seed.

```js
import { entityOf, animator, posed, skinOf, frontOfEntity } from "../src/entity/index.js";
```

| Module | What |
| --- | --- |
| `species.js` | `entityOf(seed, { kind, species, pins, size })` -> spec; the catalogue (`SPECIES`, `CHOICES`) |
| `rig.js` | bone trees (`humanoidRig`, `quadrupedRig`), `poseSkeleton` (FK + two-bone IK), rotation helpers |
| `clips.js` | procedural clips (`HUMANOID_CLIPS`, `QUADRUPED_CLIPS`), `GAITS`, `blendPoses`, `animator`, `posed` |
| `skin.js` | `skinOf(spec, skeleton, materials)` -> `[{ a, b, r, mat, part, role }]` (at most 28) |
| `front.js` | `frontOfEntity(spec | skeleton | capsules, { yaw })`, `featurePoints(capsules)` |

## The frame (read this first)

One convention for everything (`src/core/frame.js`):

```
own frame:  +z FRONT (face, eyes, nose, toes)   +x RIGHT (its own right hand)   +y UP
yaw:        front(yaw) = [sin yaw, 0, cos yaw]   right(yaw) = [cos yaw, 0, -sin yaw]
            yaw = atan2(dx, dz): "facing along (dx, dz)"; yaw 0 faces +z
```

- Every rest offset in a rig is written in the entity's own frame, so `[0, 0, 1]`
  is ahead and `[1, 0, 0]` is its right. **L is its own left (-x), R its right (+x).**
- A physics body's `facing` IS the yaw (`src/physics/character.js` sets
  `facing = atan2(vel.x, vel.z)`), so the entity runs where it's going with no conversion.
- Seen from behind, its right hand is on the screen's right; from the front, on the left.
- Pose rotation signs (right-handed about the bone's own axis): `rx > 0` tips an
  upright bone forward, swings a hanging bone back, tips a forward bone down
  (and so LIFTS one pointing back, like a tail); `ry > 0` turns toward its right, like a yaw; `rz > 0` swings a
  hanging bone toward its right.

Fronts are tested, not assumed: `tests/entity.test.mjs` checks 200 seeds x 3
kinds x 16 yaws that eyes, nose and toes are on `frontOf(yaw)`'s side of the
body and the right hand on `rightOf(yaw)`'s, and that `frontOfEntity` reads the
same front back off the capsules. Every clip is checked the same way at 4 yaws.

## Make a character from a seed

```js
const spec = entityOf("42", { kind: "anthro" });     // "humanoid" | "anthro" | "animal"
spec.species;       // "fox"
spec.plan;          // "humanoid" (two legs) | "quadruped"
spec.body;          // world-unit proportions: H, hipH, headR, torsoR, thigh, shin, ... (or shoulderH, bodyLen, ...)
spec.features;      // ears { shape, len, w, spread }, snout, tail { shape, len }, eyes, coat, hair, antlers
spec.outfit;        // top, hood, pants, shoes, pack, accessory
spec.colours;       // OKLCH [L, C, hue] suggestions per role: fur furAlt cloth clothAlt accent hair dark blush
spec.choices;       // every choice made (the seed's, or pinned)
spec.front;         // { dir: [0,0,1], right: [1,0,0], up: [0,1,0] } -- the declared front
```

Sizes: a person is about 1.7 tall, an anthro about 1 (the runner), an animal
its species' shoulder height (cat 0.25, dog 0.5, deer 0.95 ...). `size` sets it
exactly: total height on two legs, shoulder height on four.

```js
entityOf("42", { kind: "anthro", size: 1.05 });      // fits WALLRUN's 1.1-tall collision body
```

### Pin choices (the lock idea)

Any choice can be pinned; unpinned ones come from the seed. Each choice draws
from its **own** stream (`choiceStream(seed, name)`), so pinning one never
reshuffles another. A choice may *read* another (a hood needs a jacket or
hoodie; ears come in the species' shapes) -- `CHOICES[i].reads`, and
`readsOf(name)` for the full list -- and only those can change when you pin.

```js
entityOf("42", { kind: "anthro", species: "cat", pins: { top: "jacket", pack: "round", hood: false } });
entityOf("42", { kind: "animal", species: "bunny" });  // "bunny"/"rabbit" work on either body
```

Choices: `kind species height head legs arms girth ears earSize snout tail eyes
coat hair top hood pants shoes pack accessory antlers stride furColour
outfitColour hairColour`. Numeric proportions are multipliers around 1, so a
tall seed stays tall when you pin its species. Unknown names throw a
`TypeError`; values outside the options (a frog on four legs) a `RangeError`.

| kind | species |
| --- | --- |
| humanoid | human |
| anthro | cat fox bunny bear mouse frog dog |
| animal | cat dog fox bear rabbit mouse deer |

## Drive it from a physics body

```js
const anim = animator(spec);                 // { fade } optional (seconds, default 0.14)
// every physics step (or every frame):
anim.step(dt, body);                         // body: { pos, vel, facing, mode, wall, wallGap? }
const capsules = anim.capsules({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 });
renderer.setWorld({ boxes, capsules: [...level.capsules, ...capsules] });
```

- `body.pos` is the point between the feet (the physics body's bottom), `facing`
  its yaw, `mode` one of `ground air wall grind skim sink` (`src/physics/character.js`).
- `body.wall` is the wall's normal (from the wall to the body); the runner tilts
  off it, feet toward the wall, head away, whichever side it's on. `body.wallGap`
  (optional) is how far `pos` is from the wall -- give it and the feet go onto it.
- The gait phase runs on **distance travelled** (from `pos` between steps, or
  pass `anim.step(dt, body, { dist })`), so a planted foot stays exactly where it
  was put in the world. Tested: no stance foot moves more than 1e-6 of a leg in
  steady walks, runs, trots and gallops.
- What it plays: two legs -- `idle turn walk run jump fall land wallRun grind
  skim`; four legs -- `idle walk trot gallop leap`. Walk-into-run (and walk-trot-
  gallop) is ONE gait whose duty, stride and footfall timing slide with speed,
  so there's no crossfade between a foot in stance and the same foot in swing.
  Mode changes crossfade (per-clip fade lengths: a landing is quick, lying down slow).
- `anim.hold("sit", { seat: 0 })` plays a clip whatever the body does, until
  `anim.release()` (sit, lie, a pose for a cutscene).
- `anim.state` -> `{ clip, phase, time, dist, layers }`; `anim.pose`; `anim.skeleton()`.

## One clip at one moment (sheets, thumbnails, tests)

```js
const skel = posed(spec, "run", { phase: 0.2, t: 1.5, yaw: 0.6, pos: [0, 0, 0], params: { speed: 8 } });
const caps = skinOf(spec, skel);
```

Clip params: `speed` (run lean and duty; the move gait), `wall` (+1 wall on its
left, -1 on its right), `wallGap`, `turn` (rad/s, + to its right), `seat`
(sit: a height, or 0 for the floor; the default is `seatOf(spec)`, the seat its
legs fit), `landT` (in the phase arg: seconds since landing, 0..`LAND_TIME`).

| two legs | four legs |
| --- | --- |
| `idle` breathing, looking about | `idle` breathing, tail sway, looking about |
| `walk` `run` `move` (walk->run by speed) | `walk` `trot` `gallop` `bound` `move` (by speed) |
| `jump` knee tucked, arms up; `fall` legs reaching, arms out | `leap` fores ahead, hinds stretched |
| `land` squash on planted feet, springing back | `sit` haunches down, fores straight, tail round |
| `wallRun` the run tilted off the wall; `grind` crouched, arms out; `skim` low, arms back | `lie` belly down, paws ahead |
| `sit` (chair or floor), `turn` stepping on the spot | |

Footfalls (`GAITS`): walk HL FL HR FR (lateral sequence); trot diagonal pairs;
transverse gallop HL HR FL FR; bound hinds together, then fores (rabbits and
mice use it for both trot and gallop). The tests read them off the posed paws.

## Capsules and parts

`skinOf(spec, skeleton, materials)` -> `[{ a, b, r, mat, part, role }]`, world
space, at most 28 (the renderer holds 64 in a whole scene, rails included; the
least important -- inner ears first -- go when a look runs over).

- **part** names the feature: `head eye.L eye.R nose snout ear.L ear.R hand.R
  foot.L hips chest pack hood tail tail.tip ...` (four legs: `body chest neck
  paw.FL upper.HR lower.FR antler.L collar ...`). A `foot.*`/`paw.*` capsule
  runs heel (`a`) to toe (`b`).
- **role** is what the material plays: `fur` (fur or skin), `furAlt` (muzzle,
  socks, tail tip), `cloth`, `clothAlt` (trousers), `accent` (pack, scarf,
  cap), `dark` (eyes, shoes), `blush` (inner ears, pink noses), `hair`. The
  caller's table maps roles to material numbers; a missing role falls back
  (`furAlt -> fur`, `clothAlt -> dark`, `hair -> dark`, `accent -> cloth`,
  `blush -> fur`, `cloth -> fur`). The default table is WALLRUN's:
  `{ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 }`.
- `featurePoints(caps)` -> `{ part: centre, "toe.L": ..., "heel.L": ..., face, centre }`.
- `lowestY(caps)`, `partsOf(caps, "eye.")`.

## Fronts

```js
frontOfEntity(spec);                  // declared: { yaw: 0, dir: [0,0,1], confidence: 1, why }
frontOfEntity(skeleton);              // declared: the skeleton's heading
frontOfEntity(capsules, { yaw });     // SEEN, from the parts, checked against the yaw you meant
// -> { yaw, dir, confidence, why, cues, agrees, error }
```

The seen front weighs five cues: the face (eyes, nose, snout) ahead of the
body, the face on the front of the head, the eyes' left-to-right (front = right
x up), toes ahead of heels, the right hand on the right. `confidence` is how
well they agree (1 = all the same way); `why` names them and any that DISAGREE.
A model turned backwards reads ~180 degrees off; a mirrored one (left and right
swapped) splits the cues and says so. Use it in a game's own tests: pose your
entity, skin it, and assert `frontOfEntity(caps, { yaw: body.facing }).agrees`.

## Adding a species

1. `species.js`: add it to `SPECIES[kind]` with a weight, and a `LOOK` entry
   (ear shapes from `EARS`, snout length in head radii, tail `[shape, length]`,
   coats, fur colours). For four legs add a `QUAD` entry (shoulder height and
   body proportions in shoulder heights); for anthro an `ANTHRO_H` height.
2. New ear shape: add it to `EARS` and its lean to `ears()` in `skin.js`.
3. Run `node --test tests/entity*.test.mjs`: the front, ground, length,
   capsule-count and gait tests sweep every species automatically.
4. Look at it: `npm run serve`, open `/tools/entity-sheet.html`, set seeds and
   kinds, switch views (front/back 3/4, side,
   top). The red floor bar is the declared front; the corner tag is
   `frontOfEntity`'s reading. "save PNG" writes `out/entity-sheet-<view>.png`.

## Adding a clip

A clip is a pure function `(spec, t, phase, params) -> pose` in
`HUMANOID_CLIPS` or `QUADRUPED_CLIPS`:

```js
wave(spec, t) {
  const p = HUMANOID_CLIPS.idle(spec, t);                  // start from something that stands
  p.rot["upperArm.R"] = [-2.6, 0, 0.3];                    // right arm up (a hanging bone swings forward with -rx)
  p.rot["forearm.R"] = [-0.4 + 0.4 * Math.sin(t * 9), 0, 0];
  return p;
},
```

- A pose: `{ root: { yaw, pitch, roll, off, shift }, rot: { bone: [rx, ry, rz] },
  ik: { "leg.L": { at, w, pitch, yaw, pole }, ... }, ears, cycle }`. IK targets
  are in the ROOT frame (the body's ground point and heading, after root pitch
  and roll), so a planted foot is `[x, ankleH, z]`. `root.off` moves the top bone
  (bob, crouch); `root.shift` moves everything.
- Chains: two legs `leg.L leg.R arm.L arm.R`; four legs `leg.FL leg.FR leg.HL leg.HR`.
- A moving clip sets `cycle` (how far one gait cycle carries the body) so the
  animator can turn distance into phase; use `footCycle(q, duty, s, lift)` for feet.
- Wire it into the animator's `pick()` if a body mode should play it; otherwise
  it's reachable by `anim.hold(name)` and `posed(spec, name)`.
- The tests loop over every clip in the tables: new clips are checked for NaN,
  bone lengths, fronts and the capsule budget without adding a test.

## Tests

`tests/entity.test.mjs` and `tests/entity-clips.test.mjs` (17 tests, about a
second): rotation signs against frame.js; IK lengths; fronts at 200 seeds x 3
kinds x 16 yaws; soles on the ground in standing clips; every clip at every
kind for NaN, bone lengths, fronts and the budget; determinism; pins; species;
materials; front detection catching a turned and a mirrored model; quadruped
footfall order; biped double support, flight and arm swing; no foot slide under
the animator; mode following, crossfades without pops (against the entity's own
steady-gait motion); phase continuity; the wall side; hold/release; landing squash.
