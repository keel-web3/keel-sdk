# KEEL Pixel — the engine

A pixel-art engine for generative KEEL pieces and games. Its first project is
NOCTURNES (`~/dev/keel-nocturnes`, generative night still lifes as looping GIFs);
its second is WALLRUN (`projects/wallrun`, a third-person movement platformer
with a generative character). Both draw from the same parts: seeded assets built
from SDF primitives, OKLCH palettes, dither screens, and a pixel pipeline that
renders any asset at any target size — 32×32, 128×128, 256×256 or any W×H.

## Rules

1. **NOCTURNES never changes because of the engine.** `npm run guard` re-makes
   226 fingerprints of it (genomes, rendered loops of 23 seeds and every
   showcase recipe, click frames, the rooms clicks leave, GIF bytes, music
   plans) and fails on any difference. Engine code is extracted from NOCTURNES
   as copies proven equal; NOCTURNES only ever switches to an engine module
   after the guard passes with it. Recapture (`npm run guard:capture`) only when
   NOCTURNES itself is meant to change.
2. **Deterministic from a seed.** Same seed, same asset, same frame, same bar
   of music — on every machine. Seeded streams use exact integer arithmetic.
3. **Assets are resolution-free.** An asset is parts in world units; the pixel
   size is the renderer's choice. Dithering, palette depth, outline and detail
   culling adapt to the target so one asset reads at 32×32 and at 256×256.
4. **Everything is layered and lockable.** Settings resolve engine → project →
   scene → entity → part. Any value can be locked at its layer so generators and
   lower layers cannot change it (lock a project's palette scheme, one object's
   dither screen, a particle system off).
5. **Systems are opt-in.** A project uses what it needs: render (offline CPU or
   realtime GPU), particles, fx, physics, input, camera, audio, loop/take (GIF),
   states (things that change for good).
6. **Onchain and small.** No fetches at runtime; assets, samples and music are
   made in code. KeelHold stores code compressed — budgets are measured gzipped.

## Layout

| Path | What |
| --- | --- |
| `src/core/` | seeded streams (`rng`), `math`, OKLCH `palette` and harmonies, `dither` screens, `quantize`, `gif` encoder, `sdf` primitives, `noise` |
| `src/scene/` | `entity` (transform, parts, bounds, tags, components), `bounds` (AABB, sphere, SDF colliders), `config` (layers and locks), `registry` (asset catalogues and builders), `front` (front detection) |
| `src/core/frame.js` | THE frame convention: +z front, +x right, +y up, `yaw = atan2(dx, dz)`; camera basis; view-relative movement; the NOCTURNES yaw adapter |
| `src/entity/` | things that move: humanoid and animal (quadruped) rigs, seeded species with pins, skins as capsules with feature tags, procedural clips and the animator |
| `src/object/` | things that don't move: seeded pieces (pillar, wall, pad, ramp, stairs, rail, arch, tunnel, crate, bench, sign, lamp post), colliders, sockets, settling, baking for the renderer and physics |
| `src/camera/`, `src/input/` | camera rigs (orbit with pointer lock, chase, first, frame, rail/fixed) with collision and blends; keyboard/mouse/gamepad/touch to intents; the autopilot/player arbiter |
| `src/cpu/` | offline renderer: trace once, shade per frame, loops and GIF takes (the NOCTURNES renderer, generalised) |
| `src/gpu/` | realtime renderer (WebGL2): an entity set compiled to one SDF shader, rendered at the target size, lit, quantized to the palette and dithered in the shader, outlined, scaled up nearest |
| `src/physics/` | collision against AABB / OBB / capsule / SDF, a kinematic character controller (run, jump, wall-run, rail grind, water skim), rails as splines |
| `src/particles/` | pooled emitters (dust, sparks, splashes, sparkles, smoke) drawn as pixels in the same palette |
| `src/fx/` | post passes: bloom, fog, glow, outline, vignette, scanlines, chromatic shift |
| `src/audio/` | procedural samples and the generative lo-fi engine (from NOCTURNES), on Tone + keel-audio |
| `guard/` | the NOCTURNES fingerprints |
| `projects/` | projects built on the engine (WALLRUN) |
| `docs/` | this file, `AGENTS.md` (how to build a project or a game), per-system references |

## The pixel pipeline (both renderers)

1. **Scene** → entities with parts (SDF primitive + material + slot) in world units.
2. **Frame** → a camera and a target size W×H. The target sets the *detail
   budget*: parts whose projected size is under a pixel are culled or merged by
   importance; outline width stays one pixel; small targets get shorter ramps.
3. **Shade** → light (key, fill, rim, emissive parts as lights), shadows, fog.
4. **Quantize** → each pixel to the palette: the OKLCH ramps (key, accent,
   outside), with the dither screen breaking the step between two entries.
   Screens can differ per layer (sky, room, subject, fx) and per entity.
5. **Present** → nearest-neighbour upscale to the display; or frames into a GIF.

## Roadmap

| Phase | Deliverable | Gate | State (2026-09-13) |
| --- | --- | --- | --- |
| 0 | repo, docs, NOCTURNES guard | guard 226/226 | done — golden stamped with NOCTURNES' VERSION (v31) |
| 1 | `src/core` extracted with equality tests against NOCTURNES' own modules | tests + guard | done — `frame.js` added (the one convention); `gif.js` takes palettes past 32 colours, byte-identical at 32 |
| 2 | `src/scene`: entities, bounds, config layers and locks, registry, front detection | unit tests | done |
| 3 | `src/gpu`: realtime SDF pixel renderer at any target, palette + dither in shader | 60 fps at 128² on a laptop; same palette/screen as core | done (≈2 ms/frame at 128²); fx passes and wedges in progress |
| 4 | `src/physics`: character controller, colliders, rails, water | movement tests (jump arc, wall-run, grind) | controller done; its own test suite in progress (WALLRUN's 200-course test guards it meanwhile) |
| 5 | `src/particles`, `src/fx` | visual sheet per target size | particles done (size scales with target); fx in progress |
| 6 | generative characters and objects: `src/entity` (humanoid, anthro, animal; clips; pins), `src/object` (pieces, sockets, settling) | sheets at 32/64/128/256 | done — `tools/entity-sheet.html` |
| 7 | WALLRUN: the reference video's movement and level, seeded character and level, KEEL module | playable; recorded clip | done — headless `sim.js`, course from object pieces, 200/200 autopilot courses (`tests/wallrun.test.mjs`), `npm run build:keel wallrun` (65.6 KB stored), clip via `record()` |
| — | `src/camera`, `src/input` | tests | done — orbit with pointer lock (W forward), chase, first, frame, rail |
| — | `src/world`: the runtime — systems, locks and layers per scene / object / system, target rules | tests + a second project | in progress (`projects/garden`) |
| — | `src/audio`: generative lo-fi and SFX from NOCTURNES' engine | equality with NOCTURNES' plans | in progress |
| 8 | `docs/AGENTS.md`, API references, skill | an agent builds a small project from the docs alone | next, once the runtime settles |
| — | NOCTURNES imports engine modules (one at a time) | guard after each |
