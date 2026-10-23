# Native Original YUV preview correction

Source `4fa47717d9e9fac48cc6c9f925540f190e478564`, base `8d9e23ee4e3f99cf9cf7cf18cd6dc593257021c9`. Author checks only; independent approval and production are separate.

The unchanged Studio MP4 (1,828 bytes, SHA-256 `41bc415d0a2a142ee23db0de0089fb7d1675cc6718516a15da3f306bffb13193`) failed Original backend preview because a strict RGB conversion guard also guarded native inspection. After that boundary, ordinary AVC B-frame CTTS and its edit offset required a bounded native-only presentation mapping. Original export was already byte exact and remains so.

Only two private builder leaves change. Native inspection admits progressive 8-bit planar YUV420/422/444, with either the retained untagged native profile or exactly matching BT709 color metadata/range. It refuses unsupported depth, HDR, ICC, field order and unknown color/side-data semantics. Complete STTS/CTTS counts must fit existing frame bounds; sorted PTS must be unique and contiguous, and edit/media/movie clocks must correspond exactly. The parser’s full timeline is checked against every actual decoded frame PTS and muxed packet PTS/duration using integer arithmetic. Reordered variable-duration tracks remain unsupported. Strict fidelity RGB/color/edit restrictions still apply to conversion and actual-pair verification. No lossless/conversion authority is granted by an Original frame preview.

The retained MP4 returns ten frames at 0…360 ms, 40 ms each; a request at150 ms returns the120 ms PNG16×16. Exact Original bytes/MIME remain unchanged. Normal SDK build exits0; builder TSC0; deterministic classification has zero issues; affected SDK/MCP88P0F; new focused7P0F; actual Site service3P0F. Actual portable MCP comparison/export of the retained source plus strict conversion refusals pass (`exact-mcp.stdout`).

The two **unchanged** actual Site browser cases both pass: checked SDK fallback and401/sign-in resumption. File SHA is `c47e0cd2daab8879b0ee2acb4defb9c7d038a2f8d21a9ced6a0a100cac91d51f`, identical to independent QA’s file. Wallet transport/authentication in this existing harness is synthetic; editor, store, original File, checked SDK decoder, frame response and downloaded exact Original are real. It is not authenticated production proof.

Retained REDs: baseline first3 tests2P1F; initial own builder typing errors; sandbox browser0P2F due Chromium Mach-port denial; first affected run87P1F due one omitted tracked fixture in sparse checkout. The unchanged affected run after materializing that exact fixture is88P0F. Full isolated Site TSC exits2; raw `site-tsc.stdout` retains missing sibling/generated setup diagnostics and is **not** a pass.

## Reproduce

Use official Node22.22.1 first in PATH. Run `node scripts/build.mjs`, then `node --test --test-concurrency=1 tests/native-yuv-preview.test.mjs`. The complete affected command is recorded in `commands.json`. Standard build outputs are distinguished from four existing test-generated MCP scaffolds in the output manifest; do not package those scaffolds as build output.

For Site `0345f43d337e4863ebee3ce3b2bd3e0d30d4a9c0`, point only its owned @keel aliases at this SDK’s freshly built packages. In `apps/studio`, run `CHROMIUM_PATH=<installed Chromium> node --import tsx --test --test-concurrency=1 --test-name-pattern='browser codec rejection|expired private media session' tests/integration/media-local-preview.browser.test.ts`. The original sandbox launch was retained; the successful run used ordinary approved local browser escalation. No remote provider, wallet, signing, production host or activation was used.

Pinned grammar/pixel provenance: [FFmpeg n6.0 pixel-format definitions](https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavutil/pixfmt.h), [MOV CTTS/edit/color demuxer](https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/mov.c). YUV sample conversion here is preview-only; it does not equate YUV-to-RGBA with lossless carrier conversion. No new storage protocol or output format is introduced.
