# `src/world` — the world runtime

For agents building projects and games on the engine. The world runtime holds
everything a game used to wire by hand — things that move, things that
don't, the camera, input, particles — steps it all on a fixed clock in a fixed
order, and puts **every setting under layers and locks**, so you (or the
owner, or a URL) can pin the palette for a scene, make one bench always oak,
switch particles off, or force a cat, and the seed fills in everything else
**without reshuffling**.

It runs headless in Node (tests, bots, replays) and draws through
`src/gpu/pixel-renderer.js` in a browser. Plain ES modules, no dependencies.

| Module | What |
| --- | --- |
| `src/world/world.js` | `createWorld`: entities, objects, systems, the loop, generation, `frame()` / `draw()`, snapshots, events |
| `src/world/settings.js` | scopes over `src/scene/config.js`: engine → project → scene → seed → tag → id → runtime; `parseLocks` / `formatLocks` |
| `src/world/rules.js` | `targetRules(w, h)`: what 32×32 or 256×256 wants from every system, in one place |
| `src/world/defaults.js` | `ENGINE_DEFAULTS`: every setting the runtime reads |
| `src/world/streams.js` | seeded streams (core/rng.js's numbers) whose cursor a snapshot can save |
| `src/world/particles.js` | src/particles' recipes in a pool a snapshot can save |
| `src/world/camera-state.js` | save / load a src/camera camera |

Try it: `npm run serve`, then http://localhost:4200/projects/garden/ (the
demo: a seeded plaza, animals, a hero you drive, a lock panel with
`explain()`), and http://localhost:4200/projects/garden/minimal.html (the
40-line game at the end of this page).

**The frame convention** is `src/core/frame.js` and nothing else: +z is a
thing's front, +x its right, +y up, `yaw = atan2(dx, dz)`. Build objects
facing +z; a physics body's `facing` is its yaw; W moves where the camera looks.

---

## The loop

```js
import { createWorld } from "../../src/world/world.js";

const world = createWorld({ seed: "7", width: 128, height: 128, config, materials, palettes });
world.generate(myGenerator);              // build the level and its cast (seeded, lock-aware)
world.step();                             // one fixed step (1/120 s)
world.step(realDt);                       // add real time: runs as many fixed steps as fit (capped at 0.1 s)
world.simulate(10);                       // ten seconds of fixed steps, no drawing
world.frame();                            // what a renderer takes, as plain data
world.draw(renderer);                     // hand it to a src/gpu pixel renderer
```

Every fixed step runs the enabled **systems** in order:

| order | system | does |
| --- | --- | --- |
| 0 | `input` | samples the input device (or `world.drive(fn)`) into `world.intent` — camera-relative: `{ move, axes, look, jump, hold, sprint, driver, player }` |
| 100 | `control` | each entity's intent: the player's (`world.player`, while a player drives), else its **brain**'s, else idle; `static` entities get nothing |
| 200 | `physics` | each body steps against the objects' colliders (src/physics); its events (`landed`, `jumped`, `wallStart` ...) go out on the bus with the entity's `id` |
| 300 | `animation` | each animator steps with its body (src/entity); `ent.hold = { clip, params }` holds a clip (sit, lie) |
| 400 | `particles` | the pool moves and fades |
| 500 | `camera` | the camera steps after its subject (mode from the settings; frame shots aimed so the front is seen) |
| 600 | custom | your systems (any `order`; ties run in registration order) |

```js
world.system("spin", { order: 650, step(w, dt) { /* ... */ } });   // add (or replace) a system
world.system("physics");                                             // get one
world.enable("particles", false);                                    // writes system.particles.enabled at the runtime scope
world.systems();                                                     // [{ name, order, enabled }] in run order
```

A system's `enabled` is a default; the setting `system.<name>.enabled` wins,
and can be **locked** (`world.lock("scene", "system.particles.enabled", false)`
— then `world.enable("particles", true)` is refused).

Keep a system's state in `world.state` (plain JSON, saved by snapshots) or on
the entity (`ent.mind`). Use `world.rng(name)` for randomness — never
`Math.random`, never the wall clock.

### Events

```js
const off = world.on("landed", (e, w) => w.particles.emit("dust", e.at, { count: 4 }));
world.on("*", (e) => log(e.type, e.id));           // everything
world.emit("collected", { id: "crate-3" });        // your own
```

Built in: every physics body event (`landed`, `jumped`, `wallJump`,
`wallStart`, `wallRunning`, `wallEnd`, `railStart`, `grinding`, `railEnd`,
`skimStart`, `skimming`, `splashIn`, `respawn`) with `id` and `at`;
`spawned`, `generated`, `takeover` (the player took an entity from its brain).
Events are synchronous, in the step that raised them.

---

## Things that move, things that don't

```js
// Objects: src/object definitions (the catalogue's or your own defineObject), by id.
world.place(def, { id: "desk-1", pos: [2, 0, 1], yaw: 0.5, tags: ["furniture"] });
// Entities: a src/entity spec from its own seed (deriveSeed(world seed, "entity:" + id)),
// a physics body, an animator, a brain.
world.spawn({
  id: "cat-1", kind: "animal", tags: ["animal"], pos: [0, 1, 0], yaw: 0,
  brain: "wander",                       // world.brain("wander", (world, ent, dt) => ({ move: [x, z], jump, hold }))
  materials: { fur: "ginger", dark: "dark", blush: "paint" },   // role -> material name
  // player: true  (the input drives it)   body: false (no physics)   tuning: { runSpeed: 3 }  (src/physics TUNING)
});
world.teleport("cat-1", [4, 1, 0], Math.PI);
world.remove("desk-1");
```

An entity record: `{ id, tags, spec, anim, body, brain, mind, intent, hold, frozen, size }`.
`ent.frozen = true` skips its physics (sat on a bench); `ent.hold` plays a clip;
`ent.mind` is its brain's memory (saved by snapshots). Four-legged entities get
a walking tuning by default (`tuningFor(spec)`: no jumps, no wall-runs, no rails).

Every id is unique across objects and entities — **ids are how settings find
things**, so generators name things predictably (`bench-1`, `animal-2`).

---

## Settings: layers and locks

Every value the runtime reads is a setting, resolved through **scopes**:

```
world key:   engine -> project -> scene -> seed -> runtime
thing key:   engine -> project -> scene -> seed -> seed:<id> -> tag:<t>... -> id:<id> -> runtime
```

- **The most specific scope that sets a key wins** — unless a scope **locks**
  it: then the first lock (least specific) wins over every later scope,
  generators included. A later write under a lock is *refused* (and recorded).
- **engine** is `ENGINE_DEFAULTS`; **project** and **scene** are yours;
  **tag:bench** reaches every thing tagged bench; **id:bench-1** one thing;
  **runtime** is the live layer (a panel, a console).
- **seed** and **seed:<id>** hold what generation chose. They sit under every
  scope that names things, so a tag's or an id's own setting beats a roll,
  and a lock anywhere beats it.

```js
const world = createWorld({
  config: {
    project: { "render.palette": "meadow", "mat.wood": "oak" },
    scene: { "render.fx": ["glow", "vignette"] },
    "tag:hedge": { material: "hedge" },
    "id:bench-1": { material: { value: "oak", lock: true, note: "the owner's bench" } },
    locks: "tag:animal/species=cat;scene/render.dither.screen=4",       // applied last
  },
});
world.set("scene", "render.palette", "dusk");            // { ok: true }
world.lock("project", "render.palette", "meadow");       // now the scene's dusk is shadowed
world.set("runtime", "render.palette", "noir");          // { ok: false, lockedAt: "project", ... }
world.lock("project", "render.palette", "moss", { force: true });   // a lock's own scope may change it
world.unlock("project", "render.palette");
world.get("material", "bench-1");                        // resolved for a thing (id or { id, tags })
world.explain("material", "bench-1");
// { key: "material", value: "oak", layer: "id:bench-1", locked: true, lockedAt: "id:bench-1",
//   chain: [ { layer: "engine", value: null, locked: false, shadowed: false },
//            { layer: "seed:bench-1", value: "teak", locked: false, shadowed: false },   <- what the seed chose
//            { layer: "id:bench-1", value: "oak", locked: true, note: "the owner's bench", shadowed: false } ] }
world.explain("render.dither.screen").rule;              // "auto: targetRules(128x128).screen = 4"
```

`explain(key, thing)` names who set the winning value (`layer`) and who locked
it (`lockedAt`), lists every scope that sets it (`shadowed` marks what a lock
overrides), and for a target-rule key adds `effective` and `rule`
(`"auto: targetRules(32x32).screen = 2"`).

**Locks as text** (URLs, panels, files): `scope/key=value;scope/key=value`.
Values are JSON when they parse (`4`, `false`, `["fog"]`), else strings; a `~`
before the value sets without locking. `parseLocks(text)` / `formatLocks(list)` /
`world.applyLocks(text)` (returns the refusals). The garden keeps its panel in
the URL this way: `?lock=scene/render.palette=dusk;id:bench-1/material=oak`.

### Recipes

```js
// Lock the palette for this scene.
world.lock("scene", "render.palette", "dusk");
// This bench is always oak (whatever the seed rolls, whatever a scene says).
world.lock("id:bench-1", "material", "oak");
// Every bench is oak unless one says otherwise (not locked: an id can still differ).
world.set("tag:bench", "material", "oak");
// Disable particles (and keep them off: nothing later can turn them on).
world.lock("scene", "system.particles.enabled", false);
// Force a cat -- every animal, or one.
world.lock("tag:animal", "species", "cat");
world.lock("id:animal-2", "species", "cat");            // then world.generate(gen) again
// Lock gravity; lock the camera mode.
world.lock("project", "system.physics.gravity", 18);   // bodies are rebuilt with it, keeping their state
world.lock("scene", "system.camera.mode", "frame");
// A tag of things with their own gravity.
world.set("tag:balloon", "system.physics.gravity", 2);
// Hide one crate; make one wall not solid.
world.set("id:crate-2", "show", false);
world.set("id:wall-3", "collide", false);
// Lock one piece's size (read by g.piece as ctx): this bench is 2.4 wide.
world.lock("id:bench-1", "piece.w", 2.4);
// The target rules, overridden or pinned: coarse dither at every size.
world.lock("project", "render.dither.screen", 2);
// Scanlines never, whatever a scene's fx list says.
world.lock("project", "fx.scanlines", false);
```

### What you can set (the keys)

| key | scope | value |
| --- | --- | --- |
| **Items** (what generation must use) | | |
| `species` | an entity (tag / id / scene) | a src/entity species (`cat`, `fox`, `deer` ... valid for its kind) |
| `pins.<choice>` | an entity | any src/entity choice (`pins.top = "jacket"`, `pins.hood = false`) |
| `size` | an entity | its world size |
| `piece.<size>` | an object | a catalogue ctx size (`piece.w`, `piece.h`, `piece.lip` ...) |
| anything your generator `choose`s | world or thing | e.g. `benches`, `animals`, `material` on a bench, `crates.corner` |
| **Filters** (the picture) | | |
| `render.palette` | world | a palette name from `createWorld({ palettes })` |
| `render.dither.screen` | world | `"auto"` (target rules), `0`, `2`, `4`, `8` |
| `render.dither.strength` | world | `"auto"` or 0..1 |
| `render.outline` | world | `"auto"`, `0`, `1` |
| `render.rampLength` | world | `"auto"` (palette.js rampBudget), a number, `"full"` |
| `render.fx` | world | a list of passes: names or `{ name, ...params }` — the world's own (`world.fx`) and the renderer's (src/fx: `glow`, `fog`, `vignette`, `scanlines`, `grade`, `rim`, `crt`, `cycle`, `outline`, `dither`, `flash`) |
| `fx.<name>` | world | `false` drops a pass, `true` adds it, `{ params }` adds it with them (lock one to keep it off/on) |
| `render.sun`, `render.waterY`, `render.fog` | world | `[x, y, z]`, a height, `[near, far]` |
| **Systems** | | |
| `system.<name>.enabled` | world | `true` / `false` (any system, yours too) |
| `system.physics.gravity`, `system.physics.waterY` | world or thing | numbers (per thing: that body) |
| `system.camera.mode` | world | `"auto"` (orbit while a player drives, chase otherwise), `orbit`, `chase`, `first`, `frame`, `rail`, `fixed` |
| `system.camera.fov`, `system.camera.arm` | world | `"auto"` or a number (fov in radians; arm a scale on the rigs' distances) |
| `system.camera.cycle`, `system.camera.frameTag` | world | seconds per subject in frame mode; which tag it shows (null: all entities) |
| `system.particles.max`, `system.particles.size` | world | pool size; `"auto"` or a size scale |
| **Per thing** | | |
| `show` | object / entity | drawn at all |
| `collide` | object / entity | its colliders count / its body collides |
| `static` | entity | never moves (no control, no physics; it still breathes) |
| `material` | object | its main material (the first part's) by name |
| `mat.<name>` | world or thing | what a part's material name means (`mat.wood = "oak"`) — also on entities' role tables |

Settings are plain JSON; `world.settings.toJSON()` / `.load()` round-trip them
(snapshots carry them).

---

## Generation that respects locks

```js
world.generate((g, world) => {
  const n = g.int("benches", 2, 4);                              // lockable count ("benches")
  const S = g.stream("layout");                                  // raw draws nothing locks
  for (let i = 1; i <= n; i += 1) {
    const id = `bench-${i}`;
    const def = g.piece("bench", { id, tags: ["bench"] });       // its own stream + the thing's piece.* settings
    const pos = [S.between(-5, 5), 0.3, S.between(-5, 5)];
    if (!g.fits(def, { pos, margin: 0.2 })) continue;            // AABB against what's placed (floors ignored)
    g.place(def, { id, tags: ["bench"], pos, on: "auto" });      // settled onto what's under it (src/object settle)
    g.choose("material", ["oak", "teak", "paint"], { thing: { id, tags: ["bench"] }, weights: [3, 2, 1] });
  }
  g.spawn({ id: "cat-1", kind: "animal", tags: ["animal"], pos: [0, 1, 0], brain: "wander" });
});
```

- `g.choose / int / between / chance (key, ..., { thing })` **always draw**,
  each from its own stream named by the key (and the thing), then go through
  `propose`: a lock (or a tag's / id's own setting) hands back its value, else
  the roll is kept and written to the seed scope — which is what `explain`
  shows. So locking one choice never moves another, and `explain` can tell
  you what the seed would have picked under a lock.
- `g.piece(key, { id, ctx })` builds a catalogue piece from its own stream
  (`piece:<id>`), sizes from `ctx`, then from the thing's `piece.*` settings.
- `g.place(defOrKey, { id, pos, yaw, tags, ctx, on })` — `on: "auto"` drops it
  onto the highest thing under it (or the ground at y 0); `on: [supports]`
  settles onto those. `world.rests[id]` says what it rests on.
- `g.fits(def, { pos, yaw, margin, ignore, flat })` — give `pos[1]` the height
  it will stand at (a lamp's arm clears a bench under it); `flat: true` checks
  the ground plan only.
- `g.spawn(...)` is `world.spawn`: an entity's species is proposed like any
  choice (the seed's own pick, unless a setting says otherwise).
- `g.warn(msg)` notes what couldn't be done (`world.warnings`): a count that
  asks for more than fits, say.

`world.generate(gen)` clears the world (entities, objects, state, streams,
the clock, the seed scopes — **not** the other scopes) and runs the generator,
so the same seed and the same locks always build the same world. Change a
lock on an item, generate again, and only that item changes (tested:
`tests/world.test.mjs`, `tests/world-garden.test.mjs`).

---

## One asset, any target size

`targetRules(w, h)` (`src/world/rules.js`) is the one place that says what a
W×H picture wants; `world.rules` is it with the settings applied (`from`
names which rule a setting overrode).

| rule | 32 | 64 | 128 | 256 | |
| --- | --- | --- | --- | --- | --- |
| `screen` (dither) | 2 | 4 | 4 | 8 | 2 at ≤ 48 px, 4 at ≤ 128, 8 above |
| `screenId` / `steps` / `band` | bayer2 / 3 / tiny | bayer4 / 5 / small | bayer4 / 5 / small | bayer8 / 7 / large | core/dither.js `screenForTarget`, `bandOf` |
| `dither` | 0.9 | 0.9 | 0.9 | 0.9 | how far the screen reaches |
| `fov` | 0.76 | 0.93 | 1.15 | 1.15 | `1.15 · clamp((min/128)^0.3, 0.6, 1)` (camera's `fovForTarget`) |
| `arm` | 0.55 | 0.73 | 1 | 1 | camera distance `· clamp((min/128)^0.45, 0.55, 1)` |
| `particleSize` | 1.62 | 1.27 | 1 | 1 | `clamp((min/128)^-0.35, 1, 1.8)`: specks stay a pixel |
| `rampLength` | 5 | 8 | 14 | ∞ | core/palette.js `rampBudget` — ramps shortened evenly, foot and top kept |
| `outline` | 1 | 1 | 1 | 1 | |
| `pattern` | 0.36 | 0.70 | 1 | 1 | checker strength (the GPU shader has its own curve) |

`world.setTarget(w, h)` changes the size at runtime (the camera, fov, arm,
ramps and screen follow; `draw` resizes the renderer). Override a rule with
its key (`render.dither.screen`, `system.camera.fov` ... any value but
`"auto"`), lock it to pin it, or pass `createWorld({ rules })` to replace the
function. See `out/garden-hero-sizes.png`: the same garden at 32, 64, 128, 256.

---

## Rendering

`world.frame()` →

```
{ boxes, capsules,                       // the objects' boxes/capsules (materials resolved per thing) + entities' capsules
  particles,                             // sizes scaled by the target rules
  view: { eye, target, fov, time, sun, waterY, fogNear, fogFar },
  palette: { name, colours, ramps, key },// ramps shortened for the target
  materials,                             // the renderer's slots
  style: { screen, dither, outline },    // from the target rules / settings
  fx, passes,                            // every pass name; the renderer's own src/fx list
  target: { width, height }, rules, stats: { boxes, capsules, dropped } }
```

- **Materials** are `createWorld({ materials: [{ name, ramp, light, pattern, glow, full, dither }] })`,
  by index — the GPU shader reads **4 as the water and 5 as the sky**. Things
  name materials (`"wood"`, `"oak"`); `mat.<name>` settings and a thing's
  `material` decide which slot they draw with.
- **Palettes** are `createWorld({ palettes: { name: (world, rules) => ({ ramps: { rampName: [[r,g,b], ...] } }) } })`;
  `render.palette` picks one. A palette may read the world (the garden's
  follows its hero's and animals' spec colours); call `world.touchPalette()`
  if those change outside `generate`.
- **Budgets**: `RENDER_BUDGET` is what the GPU renderer holds (256 boxes, 256
  capsules, 256 ramps, 255 materials; a test checks it matches
  `src/gpu/shaders.js`). Entities' capsules go nearest-the-camera first, the
  focus first; `stats.dropped` names anything left out.
- **fx**: a world pass (`world.fx("dusk", (f, world, params) => ({ ...f, view: { ...f.view, sun } }))`)
  changes the renderer's inputs; `{ draw(renderer, f, world) }` runs after it
  draws. Any other name in `render.fx` goes to the renderer's src/fx list
  (`renderer.setFx`). Unknown names warn (`world.warnings`) and are skipped.
- `world.draw(renderer)` sets only what changed (palette, materials, fx),
  then style, world and render. `world.attach(window, { canvas })` hooks the
  browser's input (click the canvas to lock the mouse).

**The camera** follows `world.focus ?? world.player ?? the first entity`.
`frame` mode cycles every entity (or `system.camera.frameTag`'s) each
`system.camera.cycle` seconds and shows its **front**: the world tries the
three-quarter view each side, wider, then square on, and cuts to the first
whose eye has room and sees the subject — so a cat by a hedge is still seen
face-on. `world.state.camera.showing` is who.

---

## Headless testing

Everything but `draw` and `attach` runs in Node. The pattern:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { gardenWorld } from "../projects/garden/garden.js";

test("my game runs 10 s the same twice", () => {
  const run = () => {
    const w = gardenWorld({ seed: "3" });
    w.drive((world) => ({ move: [0, 1], jump: world.steps % 240 === 0, hold: true }));   // a scripted player
    w.simulate(10);
    return JSON.stringify(w.snapshot());
  };
  assert.equal(run(), run());
});
```

- `world.drive(fn)` replaces the input device with `(world, dt) => intent`
  (it counts as the player unless it says `player: false`); `world.drive(null)` gives it back.
- `world.input.key("w", true)` presses a key on the real input core (no DOM).
- `world.record()` … `world.record(false)` returns every step's intent;
  `world.replay(log)` feeds them back: the run repeats exactly.
- `world.snapshot()` is plain JSON: the clock, every settings scope, stream
  cursors, `world.state`, entities (their makes, bodies, minds, intents,
  holds), particles, the camera. `world.restore(snap)` puts it back — into
  this world or a fresh one of the same level (it regenerates with
  `world.generator` from the snapshot's settings when the layout differs) —
  and the run goes on bit for bit. Two things restart on restore: animators
  (src/entity keeps their state private: poses settle in a few frames; the
  simulation never reads them) and a camera blend in progress.
- Useful checks: `world.layout()` (a digest of the level), `world.rests`,
  `world.warnings`, `settings.refusals`, `world.frame().stats`.

`npm test` runs `tests/world.test.mjs` (settings, locks, explain, generation,
systems, determinism, snapshots, replays, target rules) and
`tests/world-garden.test.mjs` (100 seeds with nothing overlapping and nothing
floating, brains, locks, frame shots, four target sizes) in about a second.

---

## A minimal game (40 lines)

`projects/garden/minimal.html` — run into the crates to collect them:

```html
<!doctype html><meta charset="utf-8"><title>CRATES</title>
<style>body{margin:0;background:#000;color:#ddd;font:12px monospace}canvas{width:min(100vw,90vh);image-rendering:pixelated}</style>
<canvas id="c"></canvas><div id="score"></div>
<script type="module">
import { createWorld } from "../../src/world/world.js";
import { createPixelRenderer } from "../../src/gpu/pixel-renderer.js";
import { oklch } from "../../src/core/palette.js";

const ramp = (hue, chroma) => [0.2, 0.4, 0.6, 0.8, 0.95].map((L) => oklch(L, chroma, hue));
const names = ["floor", "metal", "wall", "dark", "water", "sky", "fur", "cloth"]; // (4 is the water, 5 the sky)
const world = createWorld({
  seed: new URLSearchParams(location.search).get("seed") ?? "1", width: 96, height: 96,
  config: { project: { "mat.wood": "wall", "mat.paint": "cloth", "render.waterY": -1, "system.physics.waterY": -1 } },
  materials: names.map((name) => ({ name, ramp: name, pattern: name === "floor" ? 1 : 0 })),
  palettes: { day: () => ({ ramps: Object.fromEntries(names.map((n, i) => [n, ramp([90, 240, 40, 280, 210, 220, 60, 200][i], n === "dark" ? 0.02 : 0.1)])) }) },
});
let score = 0;
world.generate((g) => {
  g.place("pad", { id: "floor", tags: ["floor"], ctx: { w: 14, d: 14, h: 0.3, lip: false }, on: [0] });
  const S = g.stream("crates");
  for (let i = 1; i <= g.int("crates", 4, 7); i += 1) {
    const def = g.piece("crate", { id: `crate-${i}` });
    const pos = [S.between(-6, 6), 0.3, S.between(-6, 6)];
    if (Math.hypot(pos[0], pos[2]) > 1.5 && g.fits(def, { pos })) g.place(def, { id: `crate-${i}`, tags: ["crate"], pos, on: "auto" });
  }
  g.spawn({ id: "me", kind: "anthro", pos: [0, 1, 0], player: true, materials: { fur: "fur", cloth: "cloth", dark: "dark" } });
});
// A system of our own: walk into a crate and it's collected.
world.system("collect", { order: 650, step(w) {
  const p = w.entities.get("me").body.pos;
  for (const o of w.objects.values()) {
    if (o.tags.includes("crate") && Math.hypot(o.transform.pos[0] - p[0], o.transform.pos[2] - p[2]) < 1.1) { w.remove(o.id); score += 1; w.emit("collected", { at: [...p] }); }
  }
} });
world.on("collected", (e, w) => w.particles.emit("dust", e.at, { count: 14, spread: 2 }));
const canvas = document.getElementById("c");
const px = createPixelRenderer(canvas, { width: 96, height: 96 });
world.attach(window, { canvas }); // (click to look with the mouse; WASD runs where the camera looks)
let last = performance.now();
requestAnimationFrame(function loop(now) {
  requestAnimationFrame(loop);
  world.step((now - last) / 1000); last = now;
  world.draw(px);
  document.getElementById("score").textContent = `crates ${score} · click, then WASD`;
});
</script>
```

Add `?seed=9` for another layout; lock the crate count from a console with
`world.lock("scene", "crates", 7)` then `world.generate(world.generator)`.

---

## The garden (`projects/garden/`)

The second project on the runtime, and the reference for a bigger one:

| File | What |
| --- | --- |
| `garden.js` | `gardenWorld({ seed, width, height, locks, scene })`; the generator (lawn, plaza, hedges, lamps, benches, sign, crates, bushes, a hero, 2-3 animals — every choice proposed); brains `wander` (idle / walk / sit) and `stroll` (to a bench, sit on it, get up); fx passes `dusk`, `mist`, `lantern`; a petal system |
| `palette.js` | 19 materials, four palettes (`meadow`, `dusk`, `moss`, `noir`) whose character ramps follow the specs' colours |
| `index.html` | the page: the lock panel (palette, dither, fx, camera mode, particles, animals' and the hero's species, one object's material and visibility), the URL (`?seed=&px=&lock=`), `explain()` for each, `snap(name)` → `out/<name>.png`, `advance(sec)` |
| `minimal.html` | the 40-line game above |

## Known limits

- Animators restart on `restore` (their state is private to src/entity).
- A camera blend in progress (and the fov kick) is not saved (camera.js keeps them in a closure).
- Per-object dither screens: the GPU renderer has one screen per picture; per-thing style is by material (`full`, `dither: false`, `pattern`, `glow`).
- `g.fits` is box against box: good for props, conservative for L-shapes (a lamp's arm).
