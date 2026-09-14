# Link 2 KEEL conversion preparation

Status: source preservation and lossless local packaging complete for the downloaded fixture. **MP4 integration is not implemented. Nothing has been staged, published, or minted.**

The existing MP4 encoder was not found in the local SDK, keel-modules, broader development source search, or the default live MCP library. Its module name/path and actual interface are required before integration. No replacement encoder, invented module binding, or custom KEEL shell has been supplied.

## Source and scope

Ethereum contract: `0xac7e693f337739b195a5eef321aa62921d314085`.

A live `tokenURI(1)` read points to `https://arweave.net/UK27GMsiEN22CgkcPpoatAh7ttwGesNU5b5MM849ZFY/index.html?id=1`. This differs from the older package linked on the artist's website. `current/` preserves the token-linked code; `original/` retains the initial website-linked capture for comparison. Neither player has been edited.

The current player includes gateway retry/nearest-neighbour recovery and revised shape metadata for editions 6 and 9. The recovered embedded manifest disagrees with the served HTML, main JS, and manifest itself. Those discrepancies remain recorded; current code is pinned to exact token-linked downloads rather than mislabeled as matching that embedded manifest. Recovered photograph files are checked against its image hashes.

All **6,526 original frames** are downloaded and independently SHA-256 verified across all 22 editions and three alternate sequences: 3,263 at standard resolution and 3,263 at 4,600 pixels. Total photograph bytes: **6,688,198,629**. Zero missing files and zero digest mismatches. `evidence/all-scenes-verification.json` records per-sequence completeness and missing paths; run `scripts/verify-all-scenes.mjs` for a fresh inventory.

The token-linked player code remains unchanged. Missing frames caused the earlier scene-3 loading errors and nearest-neighbour substitutions; all 95 scene-3 playback frames now match the manifest. Source downloads use the artist-linked Arweave gateway when arweave.net is rate-limited, accepting only exact matching photograph hashes. Local preview serves the recovered files from disk.

## Measured compression

28 test frames: one playback frame from each of 25 base/alternate sequences and three high-resolution photographs.

| Format | Total sample bytes | Exact decoded RGBA |
| --- | ---: | --- |
| Original files | 9,101,689 | Reference |
| Lossless WebP | 35,749,246 | Yes, all 28 |
| Lossless AVIF, RGB identity/4:4:4 | 41,941,529 | Yes, all 28 |

Every candidate was larger, so no artwork image was replaced. Pixel equality is measured using Sharp's sRGB RGBA8 decode; it is not a blanket claim about every browser's decoder. Original JPEG metadata remains in the original bytes.

The MCP default optimizer was tested without applying its output. Its quality-82 WebP reduced one frame from 113,406 to 94,002 bytes but changed 1,479,682 decoded channels (maximum delta 48). It was rejected because the user requires unchanged pixels.

Gzip is selected only when it is smaller and byte-for-byte decompression succeeds. Across the 247 downloaded current resources:

- Original: **234,410,717 bytes**.
- Stored: **218,105,333 bytes**.
- Saved: **16,305,384 bytes (6.9559%)**.
- Complete edition-1 photographs alone: **85,251,109 → 79,071,744 bytes**.

Brotli was measured separately during the source audit but not selected without a verified decoder binding. Savings are local byte measurements, not a gas quote or estimate for the entire collection.

## SDK and MCP

The repository MCP self-test passed. MCP engine, project-plan, project-decisions, project-intake, endpoint configuration, Studio capabilities, library search, source analysis, and dry-run media optimization were called. Evidence is saved under `evidence/mcp-*.json`.

The default Studio reports Sepolia (`11155111`); this is separate from the original NFT's Ethereum mainnet identity. No chain transaction was requested. Local preparation uses `@keel/protocol` integrity generation and the SDK's `planKeelAssetPresentation` with automatic mode. Measured bytes select **Hybrid**, raw-percent carriage, and the registered canonical shell. Preparation does not manufacture a shell or claim a published module binding.

`prepared/inventory.json` is a local inventory of individually compressed resources, source hashes, missing scope, and readiness blockers. It is **not** a complete Studio graph or a release-ready manifest. `prepared/objects/` contains actual stored candidates with independent stored and reconstructed digests.

## Verification

`verify-local.mjs` independently re-reads every stored object, verifies its hash/length, decompresses it, verifies the reconstructed hash/length, and compares all bytes with the current source file. All 247 passed.

The current token-linked edition-1 player was checked in the Codex browser at 1280 × 720. Its information panel showed 30 FPS. Pause held the frame; ArrowRight stepped 14 → 13 and selected direction -1; ArrowUp changed zoom 1.2 → 1.3. No captured warning/error logs occurred. This proves the preserved local player fixture, not a KEEL-shell runtime or MP4 download. Fullscreen, high-resolution browser playback, still-download, mobile interaction, all editions, export, and final canonical-shell behavior have not been accepted.

## Resume

From `/Users/ravonus/dev/keel-sdk`:

```sh
node examples/link2-conversion/scripts/prepare-local.mjs
node examples/link2-conversion/scripts/verify-local.mjs
node examples/link2-conversion/scripts/preview.mjs
```

The preview prints an available loopback URL and serves only `current/`; no external fallback or publication occurs. Large photographic inputs, generated candidates, and compressed objects are retained locally but ignored by Git.

Once the encoder is supplied:

1. Resolve its real API, source, version, license, exact bytes and selected-chain binding through SDK/MCP.
2. Add a narrow loading-phase integration to a separate creator-code copy, leaving the captured source untouched. Encode the complete photographic sequence at the original timing before reporting MP4 readiness. Never export substituted or missing frames as an exact original.
3. Keep interactive playback and its existing controls. Add right-click Save MP4 backed by the prepared bytes; verify direction/settings changes cannot save stale output.
4. Decode and compare the MP4's frames, dimensions, frame count and timing. Do not claim lossless export merely because the source assets are lossless.
5. Finish the chosen publication asset scope, resolve the source-manifest discrepancies, then verify the canonical shell and exact reusable module binding before Studio staging. Wallet publication remains a separate reviewed step.
