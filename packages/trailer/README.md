# keel-trailer — KEEL + After Effects, for agents

Private package **@keel/trailer**, carried by the existing KEEL SDK/MCP server.
A validated beat timeline drives isolated capture adapters, pixel composition,
ffmpeg delivery encodes, posters and structured verification. No signing,
uploading, Git push or publishing is part of this package.

## Agent quickstart

Run from a private SDK checkout. Node 22+, Python 3.11+, ffmpeg/ffprobe with
libx264, FFV1 and loudnorm are required.

    pnpm install --frozen-lockfile
    python3 -m venv packages/trailer/.venv
    packages/trailer/.venv/bin/python -m pip install -r packages/trailer/requirements.txt
    export TRAILER_PYTHON="$PWD/packages/trailer/.venv/bin/python"
    pnpm --filter @keel/trailer exec playwright install chromium
    pnpm build
    node packages/mcp/dist/cli.js --workspace /absolute/path/to/creator/project

For an MCP client, point its existing KEEL connection at that built CLI and set
TRAILER_PYTHON in the connection environment. The nine tools register in
packages/mcp/src/tools.ts; there is no second MCP server. The shared launcher
~/.keel/bin/keel-mcp still runs its separate stable checkout. This local branch
does not replace that installation.

Use only the trailered project's own music, fonts, ROMs and artwork. No music,
fonts or stock assets are fetched by the planner or renderer.

1. Call **trailer-plan** with a brief and source inventory. It returns a valid
   scaffold with editable shots, audio and three output targets. The brief is
   creative direction; planning is a deterministic scaffold, with no model call.
2. Capture needed footage with **trailer-capture**. Inspect its marks, frame
   reads and element rectangles. Captures remain native resolution and FFV1.
3. Call **trailer-beats** for the project's music. Inspect the detected grid and
   attacks, or pin the actual beat period/downbeat. Copy the returned tempo
   into the timeline and set tempo.audioSource.
4. Place shots and SFX in beats; set source seconds, frame ramp keys and holds.
   Copy frame numbers from capture metadata. Supply a project font for cards.
5. Call **trailer-render** with preview:true. Inspect
   result.verification, then **trailer-stills** at meaningful seconds.
6. Iterate the timeline JSON. Render without preview for size-targeted delivery.
   **trailer-verify** can independently remeasure saved outputs.

All media paths must resolve within the selected workspace. File timelines
resolve their paths relative to the timeline file; inline JSON resolves them
relative to the workspace. Output paths resolve relative to the workspace.
Choose a workspace containing the project and its capture directory.

## Tools and schemas

Exact schemas: [schemas/tools.json](schemas/tools.json),
[schemas/timeline-v1.json](schemas/timeline-v1.json),
[schemas/capture.json](schemas/capture.json).
TypeScript interfaces: [src/index.d.ts](src/index.d.ts).

| Tool | Request | Structured result |
| --- | --- | --- |
| trailer-snapshot | mediaPath **or** timeline/timelinePath; frames **or** times; named views/crops/scales, pixelData | exact decoded/replayed PNGs, sheet, viewer, source/PNG/RGB hashes, RGB statistics and optional raw RGB buffers |
| trailer-clip | mediaPath, startFrame, endFrame; crop, scale, includeAudio | lossless FFV1/PCM interval, playable H.264/AAC preview, viewer, hashes and verified frame count |
| trailer-inspect | snapshot **or** snapshotPath; views, queries, output dimensions | exact saved JSON, geometry/topology/graph/grid statistics, projections, CSV/DOT, paginated JSON pointers and offline inspector |
| trailer-plan | brief, sources; optional bpm, durationBeats, targets, font | timeline, planning notes |
| trailer-capture | capture, outDir | artifacts, SHA-256, frame count/rate, marks; web rects/state; GB memory reads, ROM hashes and link exchange count |
| trailer-beats | audioPath; optional bpm/beatSeconds/firstDownbeat/beats, outPath | tempo, onsets, PCM attacks, confidence, source hash and limitations |
| trailer-render | timeline **or** timelinePath, outDir; preview, targets, remote | output files/hashes, lossless RGB hashes, posters, audio adjustment measurements, toolchain and verification |
| trailer-verify | timeline **or** timelinePath, renderDir; attackToleranceMs, loudnessTolerance | logical/encoded attack reports, cut frame quantization, measured LUFS/true peak, bytes/caps, dimensions, hash checks, stills sheet, passed |
| trailer-stills | timeline **or** timelinePath, outDir, times in seconds; targets, remote | frame/time/path/hash per still and a contact sheet |

CLI uses the same schemas and implementation:

    node packages/trailer/src/cli.mjs plan --json plan-request.json
    node packages/trailer/src/cli.mjs capture --json capture-request.json
    node packages/trailer/src/cli.mjs beats music.wav --bpm 128 --out beats.json
    node packages/trailer/src/cli.mjs validate timeline.json
    node packages/trailer/src/cli.mjs render timeline.json --out out --preview
    node packages/trailer/src/cli.mjs render timeline.json --out stills --stills 1,7.5,24
    node packages/trailer/src/cli.mjs render timeline.json --out out
    node packages/trailer/src/cli.mjs verify timeline.json --out out
    node packages/trailer/src/cli.mjs tools

Commands return JSON on stdout; progress and diagnostics go to stderr. Invalid
fields, unresolved sources, overlapping/gapped shots and invalid timing fail
with structured errors. Verification failures return explicit passed:false.

## Timeline v1

tempo.bpm or beatSeconds gives a constant beat period. firstDownbeat is an
absolute offset in the music. An explicit increasing tempo.beats array gives
absolute music times for beats 0,1,2,…; fractional beats interpolate and the
last interval extrapolates. Explicit beats take precedence over a constant
tempo. A tempo with only audioSource is resolved by detection before rendering.
A bed using tempo.audioSource defaults its source in to that grid's first beat.

Shots are consecutive and start at beat zero. in/out are **source seconds**.
speed is a constant multiplier; speed:0 holds. holdFrame pins a source frame.
ramp is an increasing list of {beat, frame} in **local shot beats**; equal
successive frame values hold, descending frame values reverse. A ramp must
span 0..shot.beats. rampVariants selects a different frame mapping for a target,
useful for native portrait/square web takes.

Visual shot kinds are video, image, pair and card. pair places two sources side
by side or vertically according to the target. The CRUCIBLE reference adds
opening/end through its explicit style profile. Sources can provide native
variants for each target.

Pixel art uses integer scaling and nearest-neighbour raster operations;
oversized art needs an explicit crop or larger target. Generic footage can
contain/cover. Target crops use source pixels; safeArea uses output pixels.
Text uses a supplied font at native fontSize and an integer scale, without
antialiasing, with optional typing and deterministic flicker. Text wraps inside
the safe area or fails when its declared scale cannot fit.

Transitions: cut, dither, scanline-tear, glitch, match-cut and flash.
Durations use local beats; pixelScale sets whole output-pixel blocks. Generic
dither uses the KEEL core BAYER4/BAYER2 expansion. The reference retains v3's
existing material ordering for exact visual parity. Match-cut sourceRect and
targetRect are output-canvas coordinates; rectSelector uses exported web
geometry and requires capture at matching framing. Cropping/scaling a captured
page requires supplying the transformed rectangle explicitly. zoomStartBeat
starts the nearest-neighbour dive inside the outgoing shot.

Audio layers refer to original local audio sources and declare role bed/sfx/
riser, placement in beats, source in/out, gain, fades in seconds and beat-based
duck envelopes. Risers are supplied project audio, with fades/placement;
the package does not synthesize or license a replacement. fadeOutAt can pin a
fade's ending time independently of the mix tail, preserving the v3 envelope.

Targets declare dimensions/aspect, crop, safe area, maxBytes, loudness,
truePeak and posterBeat. Posters come from actual lossless rendered frames.
Preview skips two-pass size targeting and uses a fast draft encode at the
declared resolution; composition still renders all requested frames.

## Capture adapters

Web requests support url, cinematicFlag (e.g. cinematic=1), width/height/fps,
frames, a UTC epoch, a seed, a bounded readySelector/attribute condition,
frame-scripted click/scroll/mark steps, stateAttributes and rectSelectors.
The clock is installed and **paused before navigation**. It advances only at
frame boundaries; scrolling can ease from fromX/fromY through endFrame.
No project page styles or UI are rewritten.

    {
      "capture": {
        "adapter": "web",
        "url": "http://localhost:3000",
        "cinematicFlag": "cinematic=1",
        "width": 1920, "height": 1080, "fps": 30, "frames": 360,
        "readySelector": "canvas.package-canvas",
        "readyAttribute": "data-scene-status", "readyValue": "ready",
        "stateAttributes": ["data-cinematic", "data-boot-phase"],
        "rectSelectors": ["canvas.package-canvas"]
      },
      "outDir": "captures/opening"
    }

Game Boy pins PyBoy 2.7.0 and 59.7275 fps, blank isolated saves, RGB frames and
48 kHz audio retimed against emulated frame boundaries. Events are press,
release, write and mark at exact frame numbers. Reads name numeric addresses
or standard .sym/.noi symbols, including banks and optional guest-side reads.

Two-ROM capture requires guestRom plus link.host/link.guest:
{bank, readHook, currentByte}. readHook is the address immediately after the
ROM's serial ISR reads SB; currentByte points to its armed outgoing byte.
The adapter exchanges actual bytes and raises the guest serial interrupt,
stepping host then guest each frame, as the project's tested bridge does.
It is ROM-specific, and is not a universal cycle-accurate cable emulation.
No arbitrary workspace Python module is imported by the MCP adapter.

Video/image adapters copy and hash existing local inputs. Their capture output
can be used as an ordinary timeline source.

Add adapters without touching composition via registerCaptureAdapter(name,
adapter, optionsSchema). A registered adapter receives capture/options, the
output directory and worker context, and returns JSON artifacts. Its options
are validated against its own schema; the standard capture schema gains the
adapter name. New emulators can export the same native video/metadata shape.

## Determinism and verification

The renderer fixes RNG seed, uses a single encoder thread, strips wall-clock
metadata and records toolchain/input hashes. Repeated tiny renders are tested
for identical MP4 and lossless RGB hashes. Exact hashes are scoped to the same
Python/numpy/Pillow, ffmpeg/libx264 versions, architecture and capture bytes.
Recapturing a live website additionally depends on its assets, browser and GPU;
a paused clock does not freeze an external deployment.

Stills replay from frame zero, retaining transition/RNG state, and are tested
against decoded lossless frames. H.264/AAC are lossy delivery formats.

Every logical cut is tested against a 1 ms PCM envelope attack, with a minimum
1.5x jump over the preceding 30..5 ms. Verification separately reports the cut
frame and its quantization offset, and attacks in the delivered AAC at that
frame. Encoded attack tolerance is explicitly one frame plus the requested
logical tolerance; 30 fps cannot represent every fractional beat exactly.

[ffmpeg loudnorm](https://www.ffmpeg.org/ffmpeg-filters.html#loudnorm) uses a measured two-pass EBU R128 filter. AAC delivery is measured
again; its peak ceiling is adjusted when encoding introduces overshoot, while
copying already encoded video. Final verification measures the actual MP4,
rather than assuming the WAV's peak/loudness carries through compression.
Size budgets are decimal bytes. A missing bed/silent track cannot pass an
attack check merely because its declared tempo is valid.

## Visual and code inspection

Use both views of the same artifact:

- **trailer-snapshot** reads an existing image/video or replays a timeline. Give
  exact frame numbers or time requests, and named crops at integer scales.
  It writes PNGs, a contact sheet and an offline frame/region browser. With
  pixelData:true it also writes RGB24 buffers: rowStride, byte count and SHA-256
  make the pixels directly accessible to code. Source files are untouched.
- **trailer-clip** takes a startFrame/endFrame interval (end exclusive) and an
  optional crop/scale. The FFV1/PCM result retains exact pixels and source audio
  samples; a separate H.264/AAC preview and HTML player make it easy to view.
  Odd dimensions pad one pixel on the preview; the lossless clip stays exact.
- **trailer-inspect** takes exported system data. It saves the complete snapshot,
  front/top/side/isometric wireframes, graph views with actual path samples,
  channel grids, topology/statistics and CSV/DOT exports. Its offline viewer
  lets you rotate a mesh, click a vertex/node, hover a grid cell and query the
  underlying values by JSON pointer. Views are diagnostic projections of the
  supplied data, not a substitute for the canonical engine material renderer.

Requests use the same CLI and MCP JSON schemas:

```json
{
  "mediaPath": "trailer.mp4",
  "frames": [226, 451, 704],
  "views": [
    {"id": "full"},
    {"id": "detail", "crop": {"x": 400, "y": 36, "width": 1120, "height": 1008}, "scale": 1}
  ],
  "pixelData": true,
  "outDir": "inspection/frames"
}
```

    node packages/trailer/src/cli.mjs snapshot --json snapshot-request.json
    node packages/trailer/src/cli.mjs clip --json clip-request.json
    node packages/trailer/src/cli.mjs inspect --json inspection-request.json

Inspection snapshot schema: [schemas/inspection.json](schemas/inspection.json).
Its meshes have flattened xyz positions, triangle indices and per-vertex
attribute arrays. Graphs have stable node/edge IDs, positions and optional
polyline points. Grids have width/height and exact row-major channel arrays.
state and metadata retain explicitly exported JSON data, including provenance.
Dangling graph links, invalid indices, incomplete grids, non-finite values and
cycles fail validation. Indexed boundaries are reported without welding
coincident vertices, so they do not establish whether a geometric solid is
watertight. Default large mesh views sample at most 20,000 triangles; raw arrays
and CSV retain every supplied triangle. Select views explicitly for large
systems rather than generating more than 64 default views.

**The code API works in Node and in project browser bundles:**

```ts
import { createInspectionProbe } from '@keel/trailer/probe';
const inspection = createInspectionProbe();
inspection.register('vehicle', 'mesh', () => existingLookMesh);
inspection.register('roads', 'graph', () => existingRoadGraph);
inspection.register('terrain', 'grid', () => existingTerrain);
inspection.register('simulation', 'state', () => ({ tick, seed, position }));
const snapshot = inspection.snapshot({ frame: tick, seconds: tick / fps });
// Persist snapshot as JSON, or expose this explicit browser capture hook:
window.__KEEL_INSPECTION__ = inspection;
```

These adapters copy canonical LookMesh, RoadGraph and Terrain buffers; they
retain normals/attrs/bodies/facade, road polylines/adjacency and grid channels/
units/version. They read existing objects synchronously, so code and visual
views share one frame. No parallel regenerated scene is introduced. Readers
must export data; functions/GPU-private state cannot be recovered from pixels.
To inspect another system, register its mesh/graph/grid/state readers or supply
a snapshot matching the schema. Unregister a reader with the returned function.

For a live web capture, add inspectionFrames:[0,30,60] and optionally
probeGlobal:"__KEEL_INSPECTION__" to trailer-capture. The paused clock records a
validated inspection JSON beside that exact screenshot frame. Existing page
controls and visual design remain intact. The page must expose the probe.

For code queries, supply e.g.
queries:[{pointer:"/meshes/0/positions",start:300,count:30}] to trailer-inspect,
or call queryInspection(snapshot, query). Results paginate large arrays while
the snapshot preserves the complete data. CSV exports include vertex/triangle
IDs and one matrix per grid channel; graph DOT retains IDs and direction.

Frame indices select exact decoded frames. Time requests use the average-FPS
grid and report actual decoded PTS; use frame numbers for variable-rate sources.
Clip extraction currently requires constant frame rate. Media inspection is
RGB24; it does not export alpha/depth/GPU buffers implicitly. The offline
viewer is an inspection artifact, not a replacement project UI or scene editor.

A runnable canonical-engine example is in
[examples/inspection/README.md](examples/inspection/README.md). Private captures,
reports and raw pixels remain ignored artifacts. These tools support
remote:"yuna-mbp" and the same automatic busy-Mac offload/cleanup.

## Busy-Mac offload

Capture/render/stills/inspection operations check the 1-minute load. Render/stills,
snapshots, clips and data inspections automatically use
the user-owned yuna-mbp when load exceeds 40; remote:"yuna-mbp" or
--remote yuna-mbp selects it explicitly. Capture stops with OFFLOAD_REQUIRED:
its browser/ROM runtime must be arranged on the helper machine.

The helper checks free space and runtime availability, transfers only validated
inputs over SSH/rsync into a random private ~/work job, renders there, copies
results back and removes both remote/local job scratch. It never pushes Git
or publishes assets. Paths in returned artifacts, reports and offline viewers are rebased locally.

The Sonoma helper cannot use current Homebrew runtime bottles. The included
scripts/bootstrap-yuna.sh builds a minimal ffmpeg/x264 and installs uv-managed
Python under ~/.local/share/keel-trailer-runtime. Source build scratch is
removed and downloaded source hashes are recorded. This deliberate runtime
installation is retained; all per-render media/checkouts are removed.

## CRUCIBLE.EXE v3 reference

[examples/crucible/timeline.json](examples/crucible/timeline.json) carries the
complete 24-shot edit: cinematic opening/dive, combines, link, boss drop and
end card. It is **74 beats at 127.9875 BPM**, 34.690887782 seconds, with the
original frame ramps, half-beat stutters, SFX and pixel-font framing.

Materialize the original captures and project font into the workspace:

    "$TRAILER_PYTHON" packages/trailer/examples/crucible/prepare.py \
      --captures /absolute/path/to/original/v3 \
      --project /absolute/path/to/crucible-site \
      --out packages/trailer/artifacts/crucible
    node packages/trailer/src/cli.mjs render \
      packages/trailer/examples/crucible/timeline.json \
      --out packages/trailer/artifacts/crucible/render

prepare.py preserves inputs, records their hashes, extracts the project's
effects losslessly, and resolves the original marks per native aspect take.
The materialized timeline also works independently beside its captures. The
project-specific capture recipes are retained as reference authoring sources;
the old render.sh is historical and refers to the original prototype editor.
The general renderer uses the validated timeline, not those scripts.

The reference's separate compositor preserves its existing design and exact
pixels; edit decisions and audio placement live in JSON. Reference geometry
retains the original three target dimensions. Use generic shots for other
layouts rather than treating the reference as a universal UI theme.

Full-frame RGB parity, cut timing and delivery measurements are recorded in
[examples/crucible/validation.json](examples/crucible/validation.json). All 3,120
lossless RGB frames match v3 across the three targets. The delivery files measure
-14.05 LUFS and -1.68 dBTP, with all 23 logical cuts and delivered AAC attacks
passing. Each stays below its 14,500,000-byte cap. The 74-beat duration is floored
to 1,040 frames (34.666667 seconds) to preserve v3's original frame policy.
The video pixels match; audio is re-normalized to meet the delivery true-peak
ceiling after AAC encoding. The MP4 files are not byte copies of the originals.

[validation.json](validation.json) records the focused suite, MCP build and
private 4-second yuna render smoke test with independent local verification.
A full reference render on yuna has not been run. Captures/renders are large ignored local
artifacts, not committed package assets.

## Tests and remaining limits

    uptime
    TRAILER_TEST_ROM=/absolute/path/to/project.gbc \
      node --test packages/trailer/test/*.test.mjs

Tests cover exact cropped RGB/PCM clips, same-frame live probes, offline viewer
interactions and JSON data/topology checks, plus schema and timing math, synthetic tempo/silence/declared grids,
the existing MCP dispatch, actual web capture, real-ROM memory/input capture,
two-ROM serial byte exchange, a tiny all-target production render, identical
hashes on repeat, still-frame equality, attack failures and path confinement.
The two ROM-dependent checks skip unless TRAILER_TEST_ROM is supplied.
Build MCP normally before its integration test; Chromium must be installed.

This is a private v1, not an arbitrary After Effects project importer. Tempo
detection can choose half/double time; inspect the grid. There is no semantic
shot-selection model, automatic object tracking, universal emulator cable,
physical cartridge capture, multi-machine bit-for-bit codec guarantee, GUI
editor or public release. NES/native adapters remain extension points. The
CRUCIBLE game-specific capture recipes still need their ROM symbols/catalogue
and engine tools; they are not a generic gameplay bot.
