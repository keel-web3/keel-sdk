# Native raster feasibility worker

This local study consumes the original Token Gators token-to-layer manifest. It does not publish, sign transactions, sample replacement tokens, or change the live editor workspace.

The worker prepares shared PNG regions and full-width strips, selects a dataset-wide layout, writes binary storage pieces and token maps, and independently decodes every reconstructed PNG. Compositing is currently scoped to the recovered Gators' opaque first layer and normal source-over RGBA layers. Other authoring blend modes and transparent bases need the general compositor; this executable is not yet a packaged editor feature.

Preparation and a reproducible sample:

```sh
python3 apps/desktop/scripts/prepare-full-raster-gators.py
cargo build --release --offline --manifest-path apps/desktop/native/raster-study/Cargo.toml
KEEL_NATIVE_SAMPLE=1 apps/desktop/native/raster-study/target/release/keel-raster-study
```

Omit `KEEL_NATIVE_SAMPLE` to process all 4,000 original tokens. Four worker threads are the default; `KEEL_NATIVE_THREADS=1` supports deterministic comparison. Catalog IDs are canonicalized after parallel analysis. The validated one-thread and four-thread sample runs produced identical catalogs and all 128 identical token maps.

The subsequent lossless packaging passes are:

```sh
node --max-old-space-size=8192 apps/desktop/scripts/repack-single-idat.mjs
KEEL_RASTER_REPORT_ROOT=apps/desktop/artifacts/gator-raster-study/full-1080/native-4000/single-idat KEEL_MAP_UNIT_REFS=4 node apps/desktop/scripts/compact-raster-maps.mjs
```

These preserve the DEFLATE stream, remove repeated IDAT wrappers, share instruction sequences, and encode repeated carrier addresses in common tables. Physical carrier boundaries can split logical PNG fragments. A carrier boundary is not a limit on an artwork or library.

Measurements and read-back evidence live under `apps/desktop/artifacts/gator-raster-study/full-1080`. The preferred 250 MB target is not achieved by the current full-collection result. Binary storage size, source archives, EVM registry state, read gas, and public marketplace compatibility are distinct checks. No public-chain or production-readiness claim follows from this local worker.

## Direct-copy packaging

After the single-IDAT pass, the current smaller read-oriented format is produced by:

```sh
node --max-old-space-size=8192 apps/desktop/scripts/compile-raster-copy-runs.mjs
node --max-old-space-size=8192 apps/desktop/scripts/pack-raster-copy-runs.mjs
```

These coalesce adjacent ranges and encode repeat counts, then pack instructions into six bytes (eight for explicit repeats). The full-collection result including used source PNGs is 433,613,734 bytes, excluding NFT metadata, collection bytecode and EVM registry state. Read evidence is separate.

## Source-layer alpha map experiment

```sh
cargo test --offline --manifest-path apps/desktop/native/raster-study/Cargo.toml
KEEL_NATIVE_LAYER_MAP=1 KEEL_NATIVE_SAMPLE=1 apps/desktop/native/raster-study/target/release/keel-raster-study
```

This opt-in experiment classifies each source layer once into exact alpha runs, traverses the selected stack top-down to exclude hidden contributors, and blends remaining pixels in the original bottom-up order. Alpha 1 and 254 remain translucent; no thresholding occurs. The original compositor is retained as an equality oracle. Candidate scanline boundaries follow contributor transitions instead of only a fixed grid. It writes to a separate `-layer-map` output, leaving the established full-collection package intact. `layer-map-analysis.json` counts offline maps, not additional published resources. Selection still needs actual compressed-byte/map and gas evaluation; more precise boundaries are not an automatic size improvement.

`KEEL_NATIVE_RGB=1 KEEL_NATIVE_SAMPLE=1` separately tests RGB output for opaque finished images, retaining exact RGBA source composition. Keep experiments separate for comparable measurements.

`KEEL_NATIVE_NO_UP=1` tests removing the previous-scanline PNG predictor dependency in region candidates. Combined with RGB and layer maps on the 128-token sample, the selector rejected those regions and fell back to full strips: 50,799,273 bytes before later packaging, versus 50,516,235 for the earlier RGB hybrid. The setting remains opt-in and is not an improvement for this sample.

`KEEL_NATIVE_SAMPLE=1 KEEL_NATIVE_DEPENDENCIES_ONLY=1` runs a separate bidirectional source dependency study after a release build. It builds 16 × 16 active/opaque pixel masks in parallel, excludes hidden contributions top-down, and records bottom-up prefixes and top-down suffixes. Original compositing order and integer rounding are preserved. All 128 source composites are checked against the original compositor; partial edge tiles and repeated layers also have a focused regression test. The output is `full-1080/layer-dependencies-128.json`. Counts describe offline reuse opportunities, not compressed-byte savings or gas proof. This fixture requires opaque bases and normal source-over blending.
