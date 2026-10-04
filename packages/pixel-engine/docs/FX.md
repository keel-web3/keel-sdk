# `src/fx` and `src/gpu` reference

The realtime pixel renderer (`src/gpu`) and its post fx (`src/fx`), for agents
building games on the engine. WebGL2, plain ES modules, no dependencies. See
every pass at every size in `tools/fx-sheet.html` (`npm run serve`, then
http://localhost:4200/tools/fx-sheet.html).

| Module | What |
| --- | --- |
| `src/gpu/pixel-renderer.js` | `createPixelRenderer(canvas, { width, height })`: the world drawn at a target size, quantized to a palette, dithered, outlined, fx'd |
| `src/gpu/shaders.js` | the GLSL (`WORLD_FS`, `POINTS_VS/FS`, `PIXEL_FS`) and the limits (`MAX_*`) |
| `src/fx/fx.js` | `FX`, `FX_ORDER`, `resolveFx`, `toggleFx`, `fxUniforms`, `ALL_FX`, `screenTile`, `GRADE_PRESETS` — pure, no GL |

## The pipeline

1. **World pass** (at the target size): raymarch boxes, wedges and capsules,
   the water plane, the sky; light, shadow, patterns. Writes two buffers:
   `lightness, ramp, material, id` and `glow, facing`. Particles go into the
   same buffers as points, depth-tested.
2. **Pixel pass** (at the target size): each pixel's lightness becomes a
   position on its ramp; **the fx move it** — up or down the ramp, or onto
   another ramp; then the dither screen picks an entry. So every fx comes out
   dithered in palette entries: **palette-true** — always; there is no
   full-colour path (quantizing to palette ramps through a screen is the model). The outline and palette
   cycling act on the chosen entry. The canvas is W × H; CSS scales it up
   (`image-rendering: pixelated`).

## Renderer API

```js
import { createPixelRenderer } from "../src/gpu/pixel-renderer.js";

const px = createPixelRenderer(canvas, { width: 128, height: 128 });
px.setPalette(colours, ramps);        // [[r,g,b], ...] 0-255; { name: [base, length] } in ramp order
px.setMaterials([{ ramp: "stone", light: 1, pattern: 1 }, ...]);
px.setStyle({ screen: 4, dither: 0.9, outline: 1 });
px.setWorld({ boxes, wedges, capsules });        // returns { boxes, wedges, capsules, dropped }
px.setFx([{ name: "glow" }, { name: "vignette" }]);
px.render({ eye, target, fov, time, sun, waterY, fogNear, fogFar, particles });
px.setTarget(256, 256);                           // re-resolves the fx for the new size
```

| Call | Notes |
| --- | --- |
| `setPalette(colours, ramps)` | up to **65,536 colours** (a texture 1024 wide, as many rows as needed) and **256 ramps** of any length (a 64-entry ramp is fine). Throws past the limits. |
| `ramp(name)` | a ramp's index |
| `palette` | the colours as set (what a palette-true frame's pixels must all be) |
| `setMaterials(list)` | up to **255 materials**: `{ ramp, light = 1, pattern = 0 (1 checker), glow = 0 }`. `glow` adds lightness and marks the material emissive for the glow fx. Material **4 lights the water, 5 the sky**; 255 is the particles'. |
| `setStyle({ screen, dither, outline })` | `screen` 0 / 2 / 4 / 8 (Bayer) or any core screen id (`"stipple"`, `"halftone"`, ...); `dither` 0..1; `outline` on/off (the classic: 3 entries darker against anything 0.56 m behind). |
| `setWorld({ boxes, wedges, capsules })` | boxes `{c, h, yaw, mat}`; wedges `{c, h, yaw, lo, mat}` (or boxes with `kind: "wedge"`); capsules `{a, b, r, mat}`. Past a limit the rest are dropped and counted in `dropped`. |
| `setFx(list)` / `toggleFx(name, on)` / `fx` / `fxResolved` | the fx list (below); `fxResolved` is the list as resolved for the current target |
| `render({...})` | `particles: [{ p, size, light, ramp, glow }]` (`glow` 0..1 makes a speck emissive for the glow fx) |
| `read()` / `offPalette(pixels?)` | the frame's RGBA (bottom row first); how many pixels aren't palette entries |
| `limits` / `gpuMs` | the limits below plus the GPU's own; the last GPU frame time where `EXT_disjoint_timer_query_webgl2` exists (unreliable on ANGLE/Metal: see Performance) |

### Limits (a full game shouldn't meet them)

| What | Limit | Where it lives |
| --- | --- | --- |
| colours | 65,536 (1024 × 64 rows; raise `MAX_COLOURS` freely up to the GPU's texture size) | palette texture |
| ramps | 256 (8-bit in the data buffer) | ramp texture, 256 × 2 RGBA32F |
| materials | 255 (+ the particles') | material texture, 256 × 1 RGBA32F |
| boxes / wedges / capsules | 256 / 128 / 256 | three std140 uniform blocks, each ≤ 16 KB (WebGL2's baseline block size) |
| plain uniforms | under 60 vec4 per fragment shader | far inside WebGL2's baseline 224 (`tests/gpu.test.mjs` checks) |
| fx | one of each pass; flash: 8 materials + an id range | pixel-pass uniforms |
| ids | 250 things tell apart for the outline (boxes `i`, capsules `100 + i`, wedges `200 + i`, mod 250); 253 particles, 254 water, 255 sky | data buffer alpha |

Nothing in `src/gpu` or `src/fx` assumes a GIF, 32 colours or a 256-entry
table. The cost of the march grows with the solids in view: hundreds of
solids work but march slower (every step visits every solid); a game with
thousands wants culling (a grid or BVH) before the march — not built yet.

## The fx list

`[{ name, on = true, ...params }]`, applied in `FX_ORDER`:
`crt, grade, fog, glow, rim, flash, vignette, scanlines, dither, outline, cycle`.
A later entry of the same name merges over an earlier one. Unknown names throw.

| Pass | Params (defaults) | What it does (all palette-true) | Target rule |
| --- | --- | --- | --- |
| `crt` | `curve 0.08, border {ramp, index}, minSize 64` | bends the picture (whole pixels moved, none invented); corners to the border entry | off below 64 px |
| `grade` | `preset "day" \| "dusk" \| "night"`, `shift` (entries; presets 0 / −0.6 / −1.4), `map { ramp: gradedRamp }` | colour grading by swapping ramps for their graded twins, then shifting along them | — |
| `fog` | `ramp "sky", near 25, far 90 (m), amount 1, light 0.3` | past `near`, pixels go over to the fog ramp — the screen decides which, so the edge is dithered | — (world units) |
| `glow` | `radius 3 (px at 128), halo 2.5, self 1, threshold 0.2, tint false` | emissive pixels (material `glow` ≥ threshold, or particle `glow`) climb `self` entries; round them a halo climbs `halo` entries of what's there (or, `tint`, wears the glow's ramp) — dithered | radius × side/128, 1..16 px |
| `rim` | `width 1 (px at 128), steps 1.5, dir "sun" \| [x, y]` | a thing's silhouette on the light's side climbs its ramp | width × side/128, 1..4 px |
| `flash` | `amount 0..1, mats [≤ 8], ids [from, to], ramp null` | the struck thing goes up its ramp toward the top (or onto `ramp`) | — |
| `vignette` | `inner 0.55, outer 1.1, steps 2` | corners step down their ramps, dithered | — (fractions) |
| `scanlines` | `period 2 (px at 128), steps 1, minSize 96` | every period, half its rows a step down | off below 96 px; period × side/128 |
| `dither` | `screen "auto" \| family \| id \| "none", amount 0.9` | the screen: `auto` = ordered; families `ordered dot line noise pattern`; any of the 13 core screens (`stipple` is blue noise, `halftone`, `lines`, `hatch`, ...) | `screenForTarget(W, H, pref)` (core/dither.js): e.g. bayer2 ≤ 48, bayer4 ≤ 128, bayer8 above |
| `outline` | `mode "all" \| "outer" \| "none", steps 3, gap 1.5 (m, outer), color null \| {ramp, index}` | `all`: a thing against anything behind it (the classic); `outer`: only across a depth gap — silhouettes, not the parts inside; `color`: one ink instead of darker entries | 1 px at every size (the engine's rule) |
| `cycle` | `ramps { name: { speed, from } }` or `[names]`, `speed 3 (entries/s), from 0.5 (of the ramp)` | palette cycling: a ramp's upper entries turn over — water shimmer, neon | — |

Without a list, the style's screen, dither and outline apply as before —
WALLRUN's frames are **pixel-identical** to the renderer before fx existed
(checked frame by frame, 48 frames at 32–256).

```js
// Dusk over water, a lamp glowing, a struck enemy.
px.setFx([
  { name: "grade", preset: "dusk", map: { water: "waterDusk" } },
  { name: "fog", ramp: "sky", near: 20, far: 70 },
  { name: "glow", radius: 3, tint: true },
  { name: "cycle", ramps: { water: { speed: 3, from: 0.5 } } },
  { name: "vignette" }, { name: "scanlines" },
  { name: "flash", amount: hit, mats: [ENEMY_MAT] },
]);
px.toggleFx("scanlines", false);   // (a config lock can hold any pass on or off by name)
```

### `resolveFx(list, target)` (pure)

`target` is a number (square) or `{ width, height }`; pixel params are measured
against the short side, "at 128 px". Returns `[{ name, on, params, note? }]`;
a pass the target can't carry is `on: false` with a `note` (`"below 96 px"`).
`fxUniforms(resolved, { ramp, rampOf, style, far })` turns that into the pixel
pass's uniform values (also pure; `tests/fx.test.mjs`). The world runtime puts
passes under config locks by name and hands the resolved list to `setFx`.

## Resolution-free rules (audit of every pixel-sized constant in `src/gpu`)

| Constant | Where | Rule |
| --- | --- | --- |
| particle size | `POINTS_VS` | `size × 6 × H/128 / z`, min 1 px: the same size in the world at any target |
| tile pattern fade | `WORLD_FS` `tilePx`, `patternK` | a tile under ~3 px fades rather than aliasing; small targets quieten every pattern (28 → 96 px) |
| glow halo radius | fx `glow` | scales with the short side; tap count grows with it |
| rim width | fx `rim` | scales (1 px to 191, 2 at 256) |
| scanline period | fx `scanlines` | scales; off below 96 px |
| crt | fx `crt` | curvature is a fraction of the frame; off below 64 px |
| vignette | fx `vignette` | fractions of the frame |
| dither screen | style / fx `dither` | the project picks (WALLRUN: `screenFor`), or `dither: auto` → `screenForTarget` |
| outline width | `PIXEL_FS` | **1 px at every size — deliberately** (the engine's rule: the outline is the pixel art's line) |
| outline / rim depth gap | `PIXEL_FS` | in metres (0.56 m / `gap`), not pixels: the same edges at every size |
| march epsilon, normal step, shadow steps | `WORLD_FS` | world units (and relative to distance): the geometry is the same at every size; they are not pixel sizes |
| screen tile 192 | `SCREEN_TILE` | a texture's repeat (every core screen divides it), not a picture size; screens anchor bottom-left (GL's origin) |
| minimum target 8 px | `setTarget` | a floor, not a scale |
| default style `screen: 4` | renderer | the one unscaled default: pass a style (or the `dither` fx with `auto`) to fit the target |

## Performance

`tools/fx-sheet.html` → "measure ms/frame" (GPU median via the timer query
where it exists, and the round trip: draw + a 1-pixel read). On the M-series
Mac this was built on, with WALLRUN's course (43 boxes, 43 capsules), old and
new renderer interleaved in one tab, round trip per frame:

| | old renderer | this renderer, no fx | all fx (`ALL_FX`) |
| --- | --- | --- | --- |
| 128² | 3.4–3.8 ms | 3.6–4.3 ms | ≈ +0.5–1.5 ms |
| 256² | ~4.1–4.7 ms | ~4.1–5.4 ms | within noise of no fx |

(The round trip includes the pipeline flush, so it's an upper bound; later
runs on the same machine under other agents' GPU load read 10–50 ms for both
renderers alike, and the timer query on ANGLE/Metal read 40–70 ms — not to be
trusted there. Re-measure in a fronted tab on a quiet machine.) The fx cost is
the pixel pass: glow's halo taps (≤ 48 per non-glowing pixel) are the dearest;
every other pass is a few ALU ops or one fetch.

## Palette-true, checked

Every cell of the fx sheet (20 rows × 32 / 64 / 128 / 256) reports
`offPalette()`: 0 in every cell at every size. PNGs: `out/fx-sheet/<pass>-<size>.png` and
`out/fx-sheet/sheet.png`.
