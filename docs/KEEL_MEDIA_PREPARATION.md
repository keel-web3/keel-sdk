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

`@keel/builder/media-slot-plan` supplies the browser-safe `planKeelMediaSlots`
planner. Original images/GIF default to the image slot with no shell; uploaded
WebP/AVIF default to animation_url with the KEEL shell. Explicitly selected
encoded candidates go to animation_url, and thumbnails are separate resources.
Global, collection, exact-media and combined-media/collection defaults select
independent onchain/IPFS/hosted delivery. Explicit slot choices always win.
Both-slot duplication is never automatic; `assertKeelMediaSlotReadFit` requires
evidence for the exact plan and the complete metadata response, not source size.

Integration status: original image/GIF intent now flows through Studio preparation,
form/API ingress, agent handoff, account-scoped recovery and persisted manifest
extensions. No-shell image preparation retains one exact native image and omits
HTML/automatic thumbnails. SDK staging and CLI use the same format defaults.
Explicit image delivery is saved independently; it does not trigger an external
upload or claim the external delivery is ready.

The selected legacy collection cannot publish image-only metadata simply by
omitting its harness: its actual runtime fills animation_url with manifestURI.
Both pre-storage release simulation and final release review therefore reject
this saved plan before new funding. A registered collection/presentation route
with genuine image-only metadata, native original-image reading, appropriate
creator authority and exact complete-read evidence must be selected first.
Do not weaken this check, copy native images into a second encoded payload, or
silently replace the plan with HTML. Module-based route capability matching is
still under investigation. The generic current artifact renderer requires HTML
and only PNG/JPEG/WebP posters; source availability is not deployment evidence.
Independent animation-slot publication is not yet wired into the legacy route.
