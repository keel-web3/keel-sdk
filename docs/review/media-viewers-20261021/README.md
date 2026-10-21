# First native-raster checkpoint — PUB-302

Source base: SDK `7730e3150b7ec6da69913a779273fdb981d7fff3`, branch `codex/media-viewers-20261021`. Only `asset-display.ts`, a scoped byte-profile helper, two new suites/fixtures and additive test classification change runtime/test source. The graph, shell, package exports, Studio, protocol, contracts and frozen Sprint1 snapshots are unchanged. This checkpoint has author evidence; independent review and fresh independent browser validation are required before integration.

## Cause and correction

Asset-display1.2 rendered WebP/AVIF with one `drawImage` into a canvas, so animated sources stopped at a single frame. The pinned old7810-byte module (`9db2505b726d6c0b9821ce2c90df96c4e37b6c1607fe4dd565f883b3531bed8b`) reproduces that failure in actual Chromium. New synthetic encoded WebP has3 frames; AVIF has4 frames. Both contain3 distinct colors and repeat indefinitely. Their old on-screen canvas remains identical at0/160/460/860ms. The replay imports the committed exact old bytes, independently hashes them, decodes every frame with native ImageDecoder, and checks the displayed screenshot remains frozen.

Asset-display1.3 retains the native image when the complete bounded container inspection finds animation or cannot prove a still. Proven static WebP/AVIF keeps the existing canvas, natural dimensions, alpha and right-click PNG export. GIF/PNG/JPEG/video/model branches are unchanged. Original source bytes and entry commitments remain exact. Current renderer source is9648 bytes, SHA256 `4f88f47a332061125a3a6a0133d2a70f5b6d641c4d0c84dd7c0302626f8034dc`. The local byte-profile helper rejects older draw-once profiles for animated/inconclusive WebP/AVIF and keeps the exact1.1 GIF profile usable. It does not establish registration or change routing by caller-declared category/motion.

Complete local canonical HTML grows by2012 bytes with the same entry: WebP168277→170289; AVIF169575→171587. Both contain exactly one renderer and add zero Three/decoder dependencies. These are local HTML measurements, not NFT tokenURI, serialized RPC body, paid quotation or read-limit acceptance. `measure-local-documents.mjs` reproduces them and asserts the entry fragments remain byte-identical.

## Author results and exact scope

Environment: macOS arm64, Node22.22.1, Chrome155.0.8059.85, existing native CDP harness, local loopback only, credential variables omitted. Load8.09 before final compilation/cohort; the required overload threshold was not reached. Owned dependency copies came from the frozen official SDK and only owned links were repaired; no package installation or shared mutation.

| Check | Result | Evidence |
| --- | --- | --- |
| Pinned1.2 original behavior, genuine synthetic animations | REPRODUCED FAIL for both formats; replay itself exits0 because it proves the failure | `evidence/animation-baseline-pinned.json`, `reproduce-baseline.mjs` |
| Complete SDK TypeScript source compilation | PASS, exit0 | `evidence/native-raster-tsc-final.log.gz` |
| Adapter + existing graph + static default + suite classification |41 PASS,0 FAIL,0 SKIP | `evidence/native-raster-unit-final.tap.gz` |
| Actual local canonical shell/native rendering |6 PASS,0 FAIL,0 SKIP | `evidence/native-raster-final.tap.gz`, `evidence/native-webp.json`, `evidence/native-avif.json` |
| Full default SDK/Studio suites, independent QA, actual deployed shell/private artwork | Not run in this checkpoint | Lead-owned gates remain separate |

The browser cases execute the real normal-media constructor and canonical verification shell for animated/still WebP/AVIF; verify the verification stamp, exact original data URL, every exact red/blue/green pixel and complete ordered loop, WebP center alpha96 compositing and opaque AVIF, unchanged static PNG-export canvas/pixels, and no external request or browser exception. Two additional canonical local cases verify full GIF motion with exact retained-catalog byte profile1.1 and proposed1.3. The five browser inputs are independently hashed before and after use against `tests/fixtures/media-viewers/manifest.json`. They are genuine synthetic temporal fixtures, **not the private GIF/Gatorrr incident input**. Catalog1.1 byte-profile execution is not live registration or private-input proof.

Initial new browser harness attempts are retained as RED evidence. The first sampled the child before outer verification finished (`pending` vs `verified`); the second sampled while the shell's existing ready overlay was still visible, failing exact color/stability assertions. The correction waits for the real outer `verified` state and hidden status overlay. The exact RGB/alpha/sequence/still assertions remain strict; no timing tolerance or reference asset changed. An intermediate4-case PASS is retained, followed by6 cases after adding alpha/GIF guards. Independent review must assess these harness corrections.

## Reproduction

From the checkout root with the matching official dependency closure, compile the SDK before running its tests. Each command requires its own exit0; a log file's existence is not a pass.

```sh
node node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json --pretty false
node --test tests/media-viewer-adapters.test.mjs tests/sdk-inline-viewer-graph.test.mjs tests/smart-still-media-default.test.mjs tests/test-suite-classification.test.mjs
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/media-viewer-browser.test.mjs
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node docs/review/media-viewers-20261021/reproduce-baseline.mjs
node docs/review/media-viewers-20261021/measure-local-documents.mjs
```

Set `KEEL_MEDIA_VIEWER_EVIDENCE_DIR` to a new owned directory to save fresh current pixel/timestamp samples, `KEEL_MEDIA_BASELINE_REPORT` to save the baseline replay JSON, and `KEEL_MEDIA_SIZE_REPORT` for the size report. Never overwrite frozen evidence to claim a new result. Both suites are additively classified; no existing test is removed or reclassified. Ordinary browser support uses the existing installed Chromium requirement and never silently skips.

## Chain boundary and next wave

The exact authorized retained catalog is12694 bytes, SHA256 `2d54c8a4ab1e3360fdf702af0113c27739dcddf44abd4e0682f68606005652d7`. Initial Studio search returned401 and was stopped. A separate scratch public readback probe used the existing KeelHold object/slug/code reader and Gzip decompressor to obtain the exact first Three source bytes. Its added `isSealed` assertion then reverted against the retained store because that extra SDK ABI method was not qualified for this deployment. This is a **probe error**, not proof of missing registration or a new prerequisite. Its first incorrect uncompressed-only assertion, corrected Gzip reader invocation and raw revert are retained in `catalog-probe.failed.mjs.txt` and compressed logs. No provider switch, denied-route retry, module absence inference or transaction occurred. Correct deployed ABI/receipt qualification is future work; the source checkpoint does not wait on this optional failed probe.

No1.3 publication or registration has been prepared, approved, signed or submitted. Before using it as a registered collector module, resolve exact existing selected-chain reuse, independently review source and fresh browser execution, then prepare a concrete unsigned shared-module publication/registration packet for owner action if required. Existing1.1 GIF operation must remain usable meanwhile. Audio/SVG admission and complete maintained3D loader integration remain the separately coordinated next wave; this patch does not claim all-media completion. The approved exact typed-closure proposal is preserved in `INTERFACE.md`.

`evidence/manifest.json` records the exact source/test/fixture bytes tested and every captured evidence file. Its source hashes are the binding for author results on this checkpoint; the containing Git commit binds the complete source and evidence together. No production activation or wallet action took place.
