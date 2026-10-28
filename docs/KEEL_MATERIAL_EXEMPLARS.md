# KEEL material exemplars

How KEEL turns an exact sheet (a material atlas, a tileset, a painted texture)
into generative pixel art that keeps its look. The technique is decided by a
rulebook that reads measured evidence, not by an agent's taste, so every agent
and every author converts the same sheet the same way and can see why.

- Engine: `@keel-engine/materials` (`keel/materials`), carried by the SDK as
  `@keel/game-engine/materials`.
- MCP: `keel-material-guide`, then `keel-material-distill`.
- Format: `.kmx` (`KMX2`), usually tens of KB where the sheet was hundreds.

## The workflow

1. **Guide.** Call `keel-material-guide` with the sheet's PNG. It reports:
   - what kind of art the sheet is;
   - its block and cell grid;
   - each rule that fired, with its `when`, `then` and `why` and the numbers
     that triggered it;
   - the plan those rules make;
   - a guess at what each block depicts (from its colour);
   - the questions for the author.
2. **Ask the author** only what the evidence can't settle:
   - **What each block depicts.** Names in reading order. The guesses are a
     starting point, not an answer.
   - **What the sheet is for:**
     - new cells of the same look every seed (variance 0.5, the default);
     - exactly this sheet (variance 0);
     - new pieces in its style (a `paint` step).
   - **For a painted sheet, the visible size tradeoff:**
     - 16 art pixels a cell: chunkier and smaller;
     - 24: the default;
     - 32: finer.
   - Never ask the author to choose codecs, layers, blends or recipe steps.
     Those are the rulebook's.
3. **Distil.** Call `keel-material-distill` with the names and the author's
   choices. It does four things:
   - writes the `.kmx`;
   - scores fidelity at variance 0 against strict limits;
   - runs the gauntlet over six seeds;
   - writes a preview: sheet | variance 0 | seed 1 | seed 2.
4. **Fix, don't loosen.** If a family fails, the result names the measure and
   the plan change that moves it, given as `overrides` for that family. Apply
   it and distil again. The limits stay where they are.
5. **Ship the exemplar, not the sheet.** At runtime:
   - `paintMaterialAtlas({ exemplar: decodeMaterialExemplar(bytes), seed })`
     builds the atlas;
   - the cell layout is the sheet's: each family is a block of
     `columns × columns` cells;
   - `atlas.rgba` is the full-size texture, and `atlas.art` holds one texel per
     art pixel.
   - Publish the `.kmx` like any other creator asset, Inline by default.

## The rulebook

The rules live in `keel-engine/packages/materials/src/rules.ts`. Each one has
an `id`, `when`, `then` and `why`, and the guide returns all of them. Sheet
rules pick the art resolution and the finish; block rules pick the layers and
the recipe.

| Rule | Evidence | Decision |
| --- | --- | --- |
| `sprite-sheet` | over 5% transparent | exact colour and alpha by mode; no light layer, no dither |
| `pixel-art-source` | rebuilds from a coarse grid (scaled-up pixel art: a knee in the rebuild error) | that grid, by mode; the artist's palette; no dither |
| `painted-source` | no such grid | 24 art pixels a cell (at most the cell's texels ÷ 1.5), by area mean; finished as pixel art: 16–32 colours, a bayer4 dither at 0.35, lone pixels cleaned |
| `separable-light` | painted, and the smooth light varies by over 6% | an albedo palette layer and a light scalar layer (a sample every 4 art pixels), composited by multiply |
| `staggered-plates` | gap rows cut the cell columns, mostly with no gap beside them | `strips`: restack whole plates (bark, planks, brick courses) |
| `framed-cells` | cell rims over 25% darker than the middles, and no plates | `cells`: whole cells move, never quilted through |
| `open-texture` | no frames and no plates | `cells`, then `quilt` 40% along the darkest seam |
| `banded-light` | the rows' light changes over 25% down the block | cells stay in their row (band 0) and plates stay within one row (band 1); colour and light move together |
| `two-hues` | the cells' chroma, less each row's mean, splits over 12 | `lean` 20% of cells to the other hue; the albedo keeps 32 colours or more |

Distilling also applies three fixed rules:

- **Mend the block edges.** A texel near a block's edge whose colour the
  block's inside never uses takes the texel mirrored inward. Painters let a
  neighbour bleed over the line, and moved cells would carry it as a dash.
- **Divide out the stored light.** The albedo is divided by the light it will
  actually be multiplied by: the stored samples, read back bilinearly. A bright
  block's light is lifted until its albedo fits under white.
- **Keep the fewest colours that lose nothing.** The albedo uses the smallest
  palette from its plan that passes the strict fidelity limits with headroom,
  judged on the lit result.

## Layers, blends and the finish

A family has layers (`palette` or `scalar`), a `compose` list and a recipe:

- **Blends.** The compose list starts with `base`; then `multiply`, `screen`,
  `add` and `over`. For a scalar, 128 is ×1.
- **Recipe moves.** `strips`, `cells`, `quilt`, `lean` and `paint`. A move
  applies to every layer unless the step names `layers`, so a cell's
  highlight travels with its leaf. `lean` and `paint` act on one `target`.
- **The finish.** It runs last: the composite is snapped to the finish palette
  through an ordered Bayer dither (`bayer2`/`bayer4`/`bayer8`) at `amount`,
  matched on alpha, and `clean` replaces lone pixels. This is what makes a
  painted source read as pixel art.
- **Variance.** Variance 0 makes no moves, so the exemplar rebuilds exactly.

## The gauntlet

`scoreMaterial` reads both sheets at art resolution, block by block, and
compares:

- the average cell (RMS);
- the colour quantiles;
- edge, fine and coarse contrast (as ratios);
- the spread within cells;
- the spread between cells.

| Measure | Gauntlet (any seed) | Fidelity (variance 0) |
| --- | --- | --- |
| meanCell | ≤ 13 | ≤ 2 |
| palette | ≤ 8 | ≤ 3 |
| edge | 0.9–1.5 | 0.95–1.05 |
| fine | 0.9–1.6 | 0.95–1.05 |
| coarse | 0.9–1.15 | 0.95–1.05 |
| spread | 0.8–1.3 | 0.95–1.05 |
| cellStd | 0.65–1.5 | 0.95–1.05 |

A variant may be crisper than a painted source, never blurrier. A failing
exemplar is not shipped.
