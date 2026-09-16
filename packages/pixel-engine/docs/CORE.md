# `src/core` reference

Plain ES modules, no dependencies, no build step. Node >= 22 and browsers.
Import by path:

```js
import { createRoll, stream } from "./src/core/rng.js";
import { makePalette, buildPalette } from "./src/core/palette.js";
```

Everything here except the **Resolution** sections is a copy of a NOCTURNES
module (`~/dev/keel-nocturnes/src/`), proven identical by
`tests/core-equality.test.mjs` (same outputs, bit for bit, for thousands of
seeded inputs). Do not "improve" a copied function: change NOCTURNES' copy
and the engine's together, and only with `npm run guard` green.

| Module | From NOCTURNES | What |
| --- | --- | --- |
| `rng.js` | `rng.js` + `genome.js` (`stream`, `deriveSeed`) | seeds, fixed-slot rolls, float streams |
| `math.js` | `math.js` | scalars, hashes, loop-safe noise, vec3 |
| `sdf.js` | `sdf.js` | signed distance primitives |
| `palette.js` | `palette.js` + `genome.js` (harmonies) | OKLCH, 32-entry palettes, harmony schemes; **new:** `rampForTarget` |
| `dither.js` | `dither.js` + `genome.js` (`screenPair`) | 13 screens (threshold maps), `screenIndex`; **new:** `screenForTarget` |
| `quantize.js` | `render.js` (the quantize step) | shade buffer -> palette indices |
| `gif.js` | `gif.js` | GIF89a encoder, 32 colours, delta frames |

## Concepts

**Determinism.** A seed is `bytes32` (`0x` + 64 hex). A generator never calls
`Math.random`: it reads fixed **slots** of the seed (`roll.at(slot)`) or a
private **stream** hanging off one slot (`stream(roll, slot)`). Adding a new
decision means a NEW slot, so existing seeds never reshuffle.

**Palette.** 32 entries (index 31 is the GIF's transparent). Colours are
never chosen: a **harmony** (scheme + base hue) makes up to four **ramps**
(`key`, `accent`, optional `outside` or `accent2`), each a run of tones from
dark to light built in OKLCH. Layouts in the table:

| Layout | Ramps (base, len) |
| --- | --- |
| one room | key 0..21 (22), accent 22..30 (9) |
| two worlds | outside 0..9 (10), key 10..21 (12), accent 22..30 (9) |
| two inks | key 0..17 (18), accent 18..24 (7), accent2 25..30 (6) |

**Screen.** Light is continuous; it is only ever SHOWN through a screen: a
threshold map `at(x, y) -> 0..1` plus a few tone **steps** on a ramp. A
*layer screen* is `{ id, steps, bias }`. Maps depend only on pixel position,
so a still pixel never changes index (loops don't crawl, GIF deltas stay small).

**Resolution.** Assets are resolution-free; the target size decides how they
are shown. Two helpers encode the rules (details below):
- `screenForTarget(w, h, pref)` - a screen family that reads at that size
  (2x2 / checker at <= 48 px short side, 4x4 / halftone / lines at <= 128,
  8x8 / hatch / weave above) and fewer tone steps on small targets.
- `rampForTarget(ramp, shortSide)` - shorter ramps for tiny targets (foot and
  top kept, even walk between).

---

## rng.js

| Export | Signature | Returns |
| --- | --- | --- |
| `normalizeSeed` | `(value)` | `"0x" + 64 hex`; throws on non-hex / too long |
| `seedFromToken` | `(tokenId, collection = "nocturnes-v0")` | a local gallery seed (FNV-1a) |
| `createRoll` | `(seed)` | a roll (below) |
| `stream` | `(roll, slot)` | a float stream (below) |
| `deriveSeed` | `(seed, label)` | a child seed named by `label` |

**roll** — `seed`, `at(slot)` (16-bit, stable forever; slots 0..15 are the
seed's words, higher slots are hashed), `pick(slot, list)`, `index(slot, n)`,
`range(slot, lo, hi)` (inclusive), `chance(slot, num, den = 100)`,
`weighted(slot, [[value, weight], ...])`, `sub(slot)` -> an integer stream
`{ next, index, pick, range, chance, weighted }`.

**stream** — `f()` in [0,1) (16-bit), `between(a, b)`, `int(a, b)` (inclusive),
`pick(list)`, `chance(p)`, `weighted([[value, weight], ...])`.

```js
const seed = seedFromToken(7, "wallrun");          // "0x9c1f..."
const roll = createRoll(seed);
roll.at(0);                                        // 0..65535, same forever
roll.weighted(3, [["cat", 2], ["fox", 1]]);        // "cat" | "fox"
const S = stream(roll, 1);                         // generators draw from S
S.between(0.2, 0.8); S.int(1, 6); S.pick(["a", "b"]);
const hatSeed = deriveSeed(seed, "hat");           // an independent asset seed
```

## math.js

| Export | Signature | Returns |
| --- | --- | --- |
| `TAU` | | `2 * PI` |
| `clamp` | `(v, a, b)` | v clamped |
| `sat` | `(v)` | clamp to [0,1] |
| `mix` | `(a, b, t)` | lerp |
| `fract` | `(v)` | `v - floor(v)` |
| `smooth` | `(a, b, v)` | smoothstep |
| `tri` | `(v)` | triangle wave in [0,1], peak at 0.5 |
| `hash2` / `hash3` | `(x, y, s = 0)` / `(x, y, z, s = 0)` | [0,1) integer hash of the integer parts |
| `vnoise2` | `(x, y, s = 0)` | value noise [0,1] |
| `wrapNoise2` | `(x, y, period, s = 0)` | value noise that wraps every `period` cells in x |
| `fbm2` | `(x, y, s = 0, octaves = 3)` | fractal noise [0,1] |
| `loopFbm2` | `(x, y, dx, dy, t, s = 0, octaves = 3)` | fbm drifting by (dx,dy) over a loop, same at t=0 and t=1 |
| `v3 add sub scale dot cross len norm` | arrays `[x,y,z]` | vec3 helpers (allocate; keep out of hot loops) |

Loops: anything that moves is a function of `t` in [0,1); periodic terms take
whole cycle counts so the loop closes.

```js
const grain = fbm2(x * 0.1, y * 0.1, 42);
const drift = loopFbm2(x, y, 4, 0, t, 7);    // seamless over t
const wobble = Math.sin(TAU * (t * 2));     // 2 whole cycles per loop
```

## sdf.js

All take scalars (no allocation) and return a signed distance (negative inside).

| Export | Signature |
| --- | --- |
| `sdSphere` | `(x, y, z, r)` |
| `sdBox` | `(x, y, z, bx, by, bz, round = 0)` half-extents |
| `sdTorus` | `(x, y, z, R, r)` ring in the xz-plane |
| `sdCylinder` | `(x, y, z, r, h, round = 0)` along y, half-height h |
| `sdCapsule` | `(x, y, z, ax, ay, az, bx, by, bz, r)` |
| `sdHexPrism` | `(x, y, z, r, h)` along y, apothem r |
| `sdEllipsoid` | `(x, y, z, rx, ry, rz)` (bound, not exact) |
| `smin` | `(a, b, k)` smooth union |
| `sdPolygon` | `(px, py, xs, ys)` 2D closed polygon (Float64Arrays) |
| `profile` | `([[r, y], ...])` -> `{ xs, ys, rmax, ymin, ymax }` |
| `sdLathe` | `(x, y, z, prof, round = 0)` surface of revolution around y |
| `sdPlanes` | `(x, y, z, planes)` convex polyhedron, `planes` Float64Array stride 4 `[nx,ny,nz,d]` |

```js
const vase = profile([[0, 0], [0.3, 0], [0.2, 0.6], [0.25, 0.9], [0, 0.9]]);
const d = Math.min(sdLathe(x, y, z, vase, 0.01), sdSphere(x, y - 1.1, z, 0.1));
```

## palette.js

| Export | Signature | Returns |
| --- | --- | --- |
| `TABLE` / `TRANSPARENT` | | `32` / `31` |
| `oklch` | `(L, C, hueDeg)` | `[r, g, b]` bytes, chroma pulled into gamut |
| `cmax` | `(L, hueDeg)` | the most chroma sRGB holds there (cached) |
| `wrap` | `(h)` | hue in [0,360) |
| `hueName` | `(deg)` | "Cobalt", "Amber", ... |
| `buildPalette` | `(spec)` | `{ colours: [r,g,b][32], ramps: { key: {base,len}, accent, outside?, accent2? } }` |
| `hueCount` | `(spec)` | distinct 30° hue families present |
| `makePalette` | `(S, force = {})` | a palette SPEC `{ scheme, hue, ramps, hues, name, accentName }` from stream S; `force.scheme`, `force.hue` pin them |
| `SCHEMES` / `SCHEME_NAMES` | | `[[name, weight, (S, hue) => ramps], ...]` / names: Monochrome, Nocturne, Duotone, Split, Triad, Two Worlds, Neon Noir, Spectrum, Prism |
| `baseHue` | `(S)` | a weighted base hue (degrees) |
| `ramp` | `(S, hues, extra = {})` | a room ramp spec |
| `accentRamp` | `(S, hue, extra = {})` | an accent ramp spec |
| `rampBudget` | `(shortSide)` | max ramp entries a target shows (`Infinity` = no cut) |
| `rampIndicesForTarget` | `(len, shortSide)` | indices kept, e.g. `(22, 32) -> [0,5,11,16,21]` |
| `rampForTarget` | `(ramp, shortSide)` | colour array -> kept colours; number -> shorter length; ramp spec with `len` -> copy with shorter `len` |
| `RAMP_BUDGET` | | `[[24,4],[32,5],[48,6],[64,8],[96,11],[128,14]]` |

A ramp spec: `{ hues: [deg, ...] (shadow -> light, unwrapped), chroma, lift
(L at the foot), top (L at the top), gamma, shift (pixel-art hue shift, deg),
coolTop? }`. buildPalette adds `len` from the layout.

```js
const S = stream(createRoll(seed), 0);
const spec = makePalette(S, { scheme: "Duotone" });     // spec.name "Cobalt / Violet / Amber"
const pal = buildPalette(spec);
const key = pal.colours.slice(pal.ramps.key.base, pal.ramps.key.base + pal.ramps.key.len);
const tiny = rampForTarget(key, 32);                    // 5 colours: darkest, 3 between, brightest
```

**rampForTarget heuristics.** A tone band must be wide enough to see: at 32 px
a 22-step ramp puts each step in a sliver a pixel wide, which reads as noise.
Budget by short side: <=24: 4, <=32: 5, <=48: 6, <=64: 8, <=96: 11, <=128: 14,
above: unchanged. Kept entries are an even walk that always includes the foot
and the top, so contrast survives and only in-between tones merge.

## dither.js

| Export | Signature | Returns |
| --- | --- | --- |
| `SCREENS` | | `{ id: { name, at(x, y) -> 0..1 } }` for 13 screens |
| `SCREEN_IDS` | | `bayer2 bayer4 bayer8 chunky halftone coarseDot lines diagonal hatch stipple ign checker weave` |
| `screenIndex` | `(light, x, y, screen, rampLen, lums = null)` | ramp index in [0, rampLen) for a layer screen `{ id, steps, bias }`; `lums` (entry lightness) mixes the two tones in light, not lightness |
| `measureScreen` | `(at, T = 24)` | `{ levels, maxBin, period, angle, r, lines }` measured from the map |
| `SCREEN_GEOM` | | `{ id: { period, angle, r, lines } }` |
| `SCREEN_KIND` | | `{ id: [kind, grain 1..3, direction] }` kind: ordered, dot, line, noise, pattern |
| `screenPair` | `(a, b)` | 0 (never together) .. 4 (made for each other) |
| `SCREEN_PAIRS` / `KIND_PAIRS` | | the pairing tables |
| `bandOf` | `(width, height = width)` | `"tiny"` (<= 48) / `"small"` (<= 128) / `"large"` |
| `screenForTarget` | `(width, height = width, preference = "ordered")` | `{ id, steps, bias: 0, family, band }` |
| `TARGET_BANDS` / `TARGET_SCREENS` / `TARGET_STEPS` / `SCREEN_MIN_BAND` | | the tables below |

```js
const screen = { id: "halftone", steps: 5, bias: 1 };
const i = screenIndex(light, x, y, screen, ramp.len);       // index on that ramp
screenPair("halftone", "bayer4");                           // 4
const s = screenForTarget(32, 32, "dot");                   // { id: "bayer2", steps: 3, ... }
```

**screenForTarget heuristics.** A screen's tile must repeat many times across
the target (~12) to read as tone and not as pattern.

| band | short side | ordered | dot | line | noise | pattern | steps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tiny | <= 48 | bayer2 | bayer2 | bayer2 | ign | checker | 3 |
| small | <= 128 | bayer4 | halftone | lines | stipple | bayer4 | 5 |
| large | > 128 | bayer8 | halftone | hatch | stipple | weave | 7 |

`preference` may be a family or a screen id. An id is kept when its smallest
band (`SCREEN_MIN_BAND`: bayer2/checker/ign tiny; bayer4/halftone/lines/
diagonal/stipple small; bayer8/chunky/coarseDot/hatch/weave large) is at or
below the target's band; otherwise its family's pick stands in.

## quantize.js

The last step of the pixel pipeline: a shade buffer to palette indices.

| Export | Signature | Returns |
| --- | --- | --- |
| `makeBuf` | `(width, height)` | `{ w, h, size, L, accent, layer, depth, glass, pane, halo, cyc }` typed arrays |
| `createQuantizer` | `({ width, height, screens, ramps, lums, halo? })` | `quantize(buf, region = null, out = new Uint8Array(w*h), t = 0) -> out` |
| `quantizerFor` | `(paletteSpec, screens, width, height)` | `{ pal, quantize }` in one call |
| `rampsOf` | `(pal)` | `{ key, accent, outside, accent2 }` (missing ones fall back) |
| `lumsOf` | `(colours)` | Float32Array OKLab L per entry |
| `accentCode` | `({ accent, share })` | the ink code for `buf.accent` |
| `BAYER4Q` | | ordered thresholds for partial ink |
| `HALO_SCREEN` | | `{ id: "bayer4", steps: 3, bias: 0 }` (glow halos) |
| `LAYER_KEYS` | | `["outside", "room", "subject", "companion", "fx"]` NOCTURNES' layer order |

Buffer fields read: `L` (light 0..1, may exceed), `accent` (0 none, 1/2 an
accent ramp; bits 2..5 a partial share in sixteenths, ordered by `BAYER4Q`),
`layer` (index into `screens`; layer 0 reads the `outside` ramp, others `key`),
`halo` (1 = wear `HALO_SCREEN`), `cyc` (1 = colour-cycle with `t`). Near-black
(L < 0.035) is forced to the foot. `region` = `[x0, y0, x1, y1]` inclusive,
writing only there (for partial frames into an existing `out`).

```js
const pal = buildPalette(spec);
const screens = [screenForTarget(W, H, "noise"), ...Array(4).fill(screenForTarget(W, H))];
const quantize = createQuantizer({ width: W, height: H, screens, ramps: rampsOf(pal), lums: lumsOf(pal.colours) });
const buf = makeBuf(W, H);
// ... fill buf.L (and accent/layer/halo/cyc) from your shader ...
const pixels = quantize(buf, null, undefined, t);           // Uint8Array of palette indices
```

## gif.js

| Export | Signature | Returns |
| --- | --- | --- |
| `PALETTE_SIZE` / `TRANSPARENT` | | `32` / `31` |
| `encodeGif` | `({ width, height, palette, frames: [{ pixels, delay }], loop = 0, once = false })` | `Uint8Array` GIF89a |
| `encodeGifSteps` | same | a generator yielding after each written frame, returning the same bytes |

One global 32-colour table; frames after the first are delta frames (changed
box only, unchanged pixels transparent); identical neighbours merge into one
longer frame. `delay` is in centiseconds (min 2). `once` drops the loop block.

```js
const bytes = encodeGif({ width: W, height: H, palette: pal.colours, frames: [{ pixels, delay: 8 }] });
```
