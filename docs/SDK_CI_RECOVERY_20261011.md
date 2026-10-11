# SDK assurance failures and recovery, October 11

The module workflow for capacity commit `58b7335bc629b15bf6d7a3873f44c6867ac638b2`
(run 38160085733) completed 1749 tests: 1676 passed, five failed and 68 skipped.
None of the five failures was introduced by the capacity correction.

| Exact failed test | Cause and baseline evidence | Correction and release impact |
| --- | --- | --- |
| `animated GIF retains all frames and their delays, comparison selects same source instant` | The module workflow installed packages with pnpm but did not install the pinned ffmpeg-static binary. The failure occurs when converting the GIF to a movie. The unchanged workflow has the same omission. | Install the already declared ffmpeg-static 5.3.0 adapter before the suite. Keep frame, duration and decoded pixel assertions. A production image must independently prove its installed adapter; the existing image build already performs that check. |
| `MOV input is decoded by capability and exports MP4/MOV without changing source` | The exact binary path returned by ffmpeg-static is absent, producing ENOENT. | Same installation correction. Keep actual MOV generation, all export formats and source preservation checks. |
| `wrapInVerificationShell returns a self-contained document and a review-only plan` | The assertion forbids any HTTP URL string, including maintained proof UI gallery/explorer anchors. It reproduces on an independently built unchanged base `e6165b204be7630c038224c1e98cfebc2b34dd2c`. | Assert a fully embedded committed resource graph without external/onchain locators or RPC endpoints. A required Chromium gate renders the actual wrapper, intercepts all HTTP requests, checks zero external requests and rejects a tampered digest before mounting. A blocked external image is a negative control for the observer. No external request is transmitted. |
| `default embedded canonical shell bytes are retained for native and LZMA` | Golden hashes predate source commit `afc54e0908f1fc43a7387b18573c7d166381ca94` (October 5), which introduced the maintained loading UI and changed the chrome/runtime. The same mismatch reproduces on independently built base e6165b2. | Retain exact SHA-256 comparisons with build goldens independently reproduced on that base. These are maintained builder byte snapshots, not onchain registration receipts. Existing registered-shell identity, historical byte reuse and selected-chain checks remain separate and unchanged. |
| `wrapInVerificationShell wraps an art entry in the canonical shell with a review-only plan` | Its `VERIFYING KEEL GRAPH` marker predates the same loading update. The failure reproduces on base e6165b2. | Assert the current accessible boot status, loading-copy element and opening text. Preserve all complete HTML integrity, reproducible-source receipt and unsigned review-plan checks. |

The independently rebuilt base produced these build goldens (hex SHA-256):

- Prefix, both profiles, 15108 bytes: `4a5405a5794aa91206ef4cebebee127d8917735d4d33546a0bbf8c6bead9a58e`.
- Native suffix, 143710 bytes: `71e27b6cc8c5b5620d6428512ed8d55605f136dc7bed51367b3359f2113d99ef`.
- LZMA suffix, 157646 bytes: `adf88d8bc3ed95545a1acf6f91c884ef5b5197a309b3905edb9877237eaec1c4`.

This correction changes test and CI instructions, not shell implementation,
contracts, publication calldata or stored content. It does not authorize a
registered-shell migration. A rebuilt image must identify its exact new SDK
and Site source pair, pass the broader SDK workflow and the image's own checks,
and preserve the preceding verified image. No live project simulation,
deployment, signing or publication is established by these tests.
