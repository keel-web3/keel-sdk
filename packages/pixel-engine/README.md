# KEEL Pixel

A pixel-art engine for generative KEEL pieces and games: seeded assets built
from SDF parts, OKLCH palettes, dither screens, and a pixel pipeline that
renders any asset at any target size.

Start with **[docs/ENGINE.md](docs/ENGINE.md)** — the rules, the layout and the
roadmap. Then the references:

- [docs/CORE.md](docs/CORE.md) — `src/core`: rng, math, sdf, palette, dither, quantize, gif
- [docs/SCENE.md](docs/SCENE.md) — `src/scene`: entities, bounds, config layers and locks, registry
- [docs/ENTITY.md](docs/ENTITY.md) — `src/entity`: things that move — humanoid and animal rigs, clips, skins
- [docs/OBJECT.md](docs/OBJECT.md) — `src/object`: things that don't move — pieces, colliders, sockets, resting; and front detection (`src/scene/front.js`)
- [docs/AUDIO.md](docs/AUDIO.md) — `src/audio`: generative lo-fi records from a mood and a seed (NOCTURNES' engine, plan-for-plan), live intensity, seeded game SFX off body events, KEEL audio
- [docs/CAPTURE.md](docs/CAPTURE.md) — `src/capture`: optional stills, video (WebM, full colour, crisp), and GIF export — never required by a game
- [docs/CAMERA.md](docs/CAMERA.md) — `src/camera` and `src/input`: orbit (pointer lock, W is forward), chase, first person, frame, rails

**The frame convention** (`src/core/frame.js`, tested in `tests/frame.test.mjs`): +z is a thing's front, +x its right hand, +y up; `yaw = atan2(dx, dz)`. Every system uses it; NOCTURNES yaws come in through `fromNocturnesYaw`.

```sh
npm test        # unit tests + equality against NOCTURNES' own modules
npm run guard   # NOCTURNES' 226 fingerprints must be unchanged
```

Node >= 22, no dependencies, no build step. NOCTURNES is read from
`../keel-nocturnes` (or `NOCTURNES=path`).

## Inside the KEEL SDK

This source is included as `packages/pixel-engine`. From the SDK root, run
`pnpm pixel:test` or `pnpm pixel:serve`. The current modular engine used by the
visual editor is exposed through `packages/game-engine` and installed by
`pnpm setup:friend`. External NOCTURNES comparisons skip when the reference
checkout is absent; set `NOCTURNES` to run them.
