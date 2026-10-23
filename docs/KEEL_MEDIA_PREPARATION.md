# Reversible media preparation

Studio, hosted MCP, and workspace MCP all call `@keel/builder/media-preparation`.
This is candidate preparation, not source upload eligibility, storage, publication,
wallet approval, or a promise that every browser can decode a codec.

- `prepareMediaCandidate({bytes, recipe, mediaType?, signal?})` produces a new
  candidate plus source/output integrity, exact byte measurements, recipe, source
  and candidate frame information, verification evidence and readiness warnings.
- `compareMediaFrames({...input, timeMs})` produces original/processed PNG bytes at
  the same requested time, with each frame's actual source timestamp. It never
  compares two independently playing animations.
- `getMediaPreparationCapabilities()` reports available runtime adapters and
  unsupported boundaries. An installed encoder does not prove target-browser support.
- `@keel/builder/media-edit-recipe` is browser-safe. Only explicit recipes are
  accepted. Original retains exact bytes, independent of decoder support.
  Lossy and `noSound` are explicit. Still-image crop/resize/rotation are bounded;
  up to eight ordered duplicate-original layers support position, size, quarter-turn rotation and opacity. Coordinates use the edited canvas; out-of-bounds layers fail instead of implicitly clipping. Still-image compositions are decoded and verified after lossless encoding. Movie/animation geometry and layers remain explicitly unsupported.

## Studio HTTP

Authenticated `GET /api/build-lab/media` returns current capabilities. Authenticated,
same-origin `POST` takes one multipart `file`, JSON `recipe`, `action` (`frame` or
`export`), optional `timeMs`, and optional `projectId`. New uploads are transient
creator-scoped data. An existing project ID must belong to the authenticated creator.

Frame JSON contains `originalFrame` and `processedFrame` as PNG base64,
`sourceFrameTimeMs`/`candidateFrameTimeMs`, source/candidate information,
measurements, integrity, recipe and warnings. Export responds with downloadable
bytes, safe Content-Disposition, SHA-256 and byte-count headers, and encoded JSON
warnings in `X-Keel-Media-Warnings`. It never replaces or persists the original.

Hosted limits: 32 MiB input/export (32 MiB combined comparison PNGs), 30-second
body ingestion, 180-second operation deadline, two active jobs per server process,
one per creator per process. Request cancellation propagates to the pipeline;
slots remain held until cleanup completes. Pipeline decode/pixel/frame limits also
apply. Multi-instance infrastructure should impose matching service-level quotas.

## MCP

Hosted `keel_media_capabilities`, `keel_media_candidate`, `keel_media_compare`
require `drafts:write`. Candidate/compare take `bytesBase64`, explicit `recipe`,
optional `fileName`, `mediaType`, `projectId`, and `timeMs`. No URL fetch, arbitrary
command, external path, remote upload, saved project mutation or publication occurs.
The MCP HTTP body is streamed with a 45 MiB cap before JSON parsing.

Workspace tools are `keel-media-capabilities`, `keel-media-candidate`,
`keel-media-compare`. They take workspace-contained `inputPath`, explicit `recipe`,
optional `mediaType` and `timeMs`. They share the same pipeline and 32 MiB transfer
caps and return candidates as `bytesBase64`. They do not write outputs or touch
source files. Existing `media-optimize`/`media-optimize-apply` workflows remain available.

## Agent-to-Studio re-editing

Keep the original separate from its candidate. Stage the original source and this
private `media-edit.json` control file (or equivalent `metadata.mediaEdits`):

```json
{
  "schema": "keel-studio-media-edits@1",
  "edits": [{
    "sourcePath": "assets/original.png",
    "sourceSha256": "0x<64 lowercase hex digits>",
    "recipe": {
      "schema": "keel-media-edit@1",
      "mode": "lossless",
      "format": "webp",
      "quality": 82,
      "noSound": false
    }
  }]
}
```

`sourceSha256` is the returned `sourceIntegrity.digest`. With no `candidatePath`,
the original stays active. Only after an explicit apply decision, stage the exact
candidate bytes at a distinct path and add `candidatePath` to that edit. Studio
verifies the original hash, retains it for later edits, and excludes the control
file and separately retained source from collector payload when a candidate is active.
Paths must be unique, safe relative staged paths; source-to-candidate chains are
not supported. The workspace candidate tool returns `mediaEdits` populated with
its workspace-relative source path; adjust the path if the staged location changes.

Exact selected-shell/browser decoding, full tokenURI size, selected-chain read/gas
and funding gates remain separate. Original, Raw, viewer off, and explicit custom
shell choices must not be silently changed by a media candidate or recommendation.

## Metadata slot intent planning

Current authority: the [Studio owner requirements](https://github.com/keel-web3/keel-site/blob/master/docs/STUDIO_PUBLICATION_REQUIREMENTS.md)
and [active sprint/failure record](https://github.com/keel-web3/keel-site/blob/master/docs/STUDIO_PUBLICATION_SPRINTS.md).
The browser-safe `@keel/builder/media-slot-plan` and protocol smart-presentation
planner carry explicit source/preview identities and saved choices; their output
is not evidence that a compatible reader or viewer is deployed.

Default to the registered verifier for scripts, animation, video, audio and 3D.
A GIF is animation, not a static image. Inspect actual bytes/motion/execution;
unknown motion cannot take the static cost exception. Only an inspected static
raster that otherwise duplicates image and animation uses the 500,000-byte cost
exception: above it, recommend the compatible image-only route. An advanced
creator may still choose the verifier and save that default.

Collector image and artwork animation have different roles. A script, movie or
model needs its intended verified player/viewer plus a suitable collection-grid
preview. Keep the exact original and selected preview separate from generated
metadata derivatives; preserve all real script/model dependencies. An explicit
supported hosted/IPFS preview or a sufficiently small verified thumbnail does
not change the original artwork's integrity commitment or prove external delivery.

The compatibility targets are 1,750,000 bytes for the encoded image and 2,000,000
bytes for the complete metadata/read presentation, not a 2 MB upload ban. Measure
all actual returned image + animation + embedded hybrid loader/index + metadata
bytes. Offer meaningful image-only or hybrid-only alternatives before supported
IPFS/hosted delivery if the combination is too large. The hybrid program itself
must remain embedded and measured; do not assume its index cannot grow. Preserve
explicitly acknowledged larger nonstandard output where its actual route works.
Never silently reduce quality, drop animation/audio or change delivery.

## Verification status and open work

The [current sprint ledger](https://github.com/keel-web3/keel-site/blob/master/docs/gauntlet/publication-sprints.json)
records actual supported-boundary and release verdicts. The normal source-recovery
constructor distinguishes original creator resources from bounded metadata-only
previews, and reused registered Gzip modules require their exact independent proof.
Neither that source behavior nor media encoder availability proves end-to-end
publication for every MIME accepted by a picker.

Animated WebP/AVIF playback, full-featured 3D, broader audio/model adapters,
automatic video recommendations and the historical sequence/layer player remain
separate acceptance tasks until normal-service and final browser tests pass.
`prepareMediaCandidate` does not implement a general animated-layer scripting
player by itself. Every recommendation must include player/index/decoder/full
presentation cost and complete frame/timing/alpha/audio verification, with an
explicit decision for loss or feature changes. Failed source replacement, apply,
undo/re-edit, refresh and stale-candidate cases must preserve originals.

A saved image-only plan needs a genuine compatible current reader/composer route;
never weaken its guard or supply different metadata to make it appear publishable.
Retired prelaunch formats are not a fallback. UI/API/MCP use the same deterministic
choices, but each requires fresh integrated evidence, exact simulation and an
unsigned wallet handoff before claiming readiness. Ordinary creators do not
select RPC providers; existing wallet/free/managed routing owns that choice.
