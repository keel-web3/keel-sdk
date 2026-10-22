# Native SVG/audio successor (author evidence; independent approval pending)

Base: SDK `b0a78fd50797a9af82be282f0d1103fe49ff0dc8`, isolated branch
`codex/native-svg-audio-20261021`. No Site, deployed service, active catalog,
reader, shell frame, artwork, database, permission or wallet was changed.

## Actual baseline

`baseline.json` and `baseline.mjs` preserve the actual base SDK rejection of
valid static SVG (102 bytes, SHA256 a3e279c57f01648e753ce85eb3735aabc5f8aecb8b8ba208170a0d7a169e955a)
and PCM WAV (16044 bytes, SHA256 edfdbd36a8301a85c984026c4d27d31f5c86a83dce18b90cbe6c490067cb6c6d).
Both the kind selector and normal-media constructor rejected their MIME types.
These generated representative files are not the Gatorrr or GIF incident inputs.

## Production behavior and scope

* Asset-display 1.5.0: exact decoded source **6821 bytes**, SHA256
  **a00a81a869a5bb589f2156a5ef19ea2fa1f01f7173cff7212e28ccbb9ed5baf0**.
  Prior 1.4 is exactly 5056 bytes/16a440e2b29572c3d45e3d9c31f7c444a867be5c5ac251fecfedaddcb1261dfb.
  The 1765-byte increase adds native audio controls and exact committed cover
  presentation. It adds no audio/Three/network library to GIFs. Existing raster,
  WebP/AVIF animation and separate complete-model loader behavior remain intact.
* SVG uses pinned saxes 6.0.0 for complete well-formed UTF-8 XML parsing, followed
  by bounded passive-native-image qualification. SMIL/CSS motion stays native.
  Source is never stripped, rewritten into HTML, rasterized or relabeled still.
  Script/events/interactive/foreign content, unsupported namespaces/dependencies,
  DTD/entities and ambiguous escaped dependency CSS are rejected with an
  actionable error and the original bytes unchanged. This is a conservative
  native image profile, not a complete SVG document execution engine.
* Audio admits structurally complete PCM/float WAV, Layer III MP3, Opus/Vorbis
  Ogg, FLAC, ADTS AAC and nonfragmented one-track AAC M4A. Container inspection
  explicitly returns `browserDecode:'required'`: it is not a claim that codec
  samples decoded, played, were registered or were published. Unsupported codecs,
  empty metadata-only headers, truncated/invalid containers and mismatched MIME
  fail before preparation. Browser decode and gesture playback are separate gates.
* The existing shell recognizes direct image/video, not raw audio. Audio therefore
  uses the existing verified derived-HTML pattern, exact original audio as one
  creator asset, at most one exact cover, and a small deterministic HTML entry.
  Registered normal-media composition reconstructs that exact entry from verified
  source slots and rejects changed metadata/scripts/commitments. It snapshots
  the proposed document and reuse fragments before asynchronous verification.
* Compact native publication uses the authenticated existing revision-5 Gzip
  recipe. The source is stored once; generated HTML and cover are distinct
  resources, not duplicate encoded audio copies. No compatibility allowance was
  added. Explicit Raw stays uncompressed for local preparation; its binary None
  publication remains rejected by the existing fresh-carriage guard. A caller
  must report that unsupported boundary rather than silently change Raw to Gzip.

## Site integration contract (lead owns the separate bridge)

The SDK APIs are stable:

```
import {inspectKeelNativeMedia} from '@keel/sdk/native-media-inspection';
import {qualifyKeelNativeMediaViewer} from '@keel/sdk/media-viewer-adapters';

inspectKeelNativeMedia({mediaType, source: exactOriginalBytes});
qualifyKeelNativeMediaViewer({moduleId, version, digest, byteLength,
  mediaType, source: exactOriginalBytes});
```

The first returns `kind`, canonical MIME, `byteLength`, `execution:'static'`,
`motion:'still'|'animated'` for passive SVG or `'unknown'` for audio, and
`browserDecode:'required'`. Executable SVG rejects before it can be treated as a
passive image. The second authenticates the exact 1.5 module byte profile and
uses the same inspector. Neither result is selected-chain registration proof.
The normal-media constructor/local SVG path/audio derived constructor already
invoke these source checks; they are not unused declarations.

`studio-creator-asset-inspection.ts` must consume this byte-authored inspection
for inferred SVG/audio instead of trusting MIME/classification defaults.
`studio-creator-media-selection.ts` must dispatch these kinds to the new
qualifier, identify the exact main audio plus separate image poster, and retain
all actual creator dependencies. Catalog admission must authenticate same-chain
1.5 module bytes and receipts. No Site integration or live support is claimed
by this SDK-only change.

## Regression/reference change ledger

No old assertion, motion reference asset, tolerance or failing case was removed.
Three preexisting tests refer to the current renderer. Their current-version
expectations change from 1.4/5056/16a440… to 1.5/6821/a00a81…:

1. `media-viewer-adapters.test.mjs`: current version updated; 1.5 added to the
   existing no-Three raster compatibility loop, all old versions retained.
2. `sdk-media-revision-reuse.test.mjs`: exact current digest/size/version updated;
   explicit unchanged 1.4 identity added alongside unchanged 1.2/1.1 guards.
3. `media-viewer-browser.test.mjs`: 1.5 added to actual GIF browser loop; exact
   prior 1.4 bytes now come from the new immutable `asset-display-1.4.0.js`
   fixture copied from base SDK emission. Old input GIF and all pixel/loop
   assertions stay byte-identical.

The explicit suite map adds two new deterministic inspection/graph files and
one actual-browser file. No former test classification changed. All changes
require independent review before gate credit.

## Reproduction commands

Use the established NVM Node 22.22.1, zlib `1.3.1-e00f703`, binary SHA256
`245e0321af97d3c21dd4e7104457334dfe3c3ba7982d0db75363e354565f8cbb`,
and installed Chromium (author used Chromium headless shell 1234).
Homebrew Node has the same version label but a different zlib and does not
produce the fixed baseline gzip snapshots; its raw failing run is retained. Run `uptime` first and offload if the shared Mac load exceeds 40.

```
export PATH=/Users/ravonus/.nvm/versions/node/v22.22.1/bin:/opt/homebrew/bin:$PATH
node scripts/build.mjs
node --test tests/native-media-inspection.test.mjs tests/native-media-graph.test.mjs
KEEL_CHROME_HEADLESS_SHELL=<installed-binary> node --test tests/native-media-browser.test.mjs
KEEL_CHROME_HEADLESS_SHELL=<installed-binary> node --test tests/media-viewer-browser.test.mjs tests/model-viewer-browser.test.mjs
node scripts/test.mjs
```

Fixture identities and exact conversion commands are committed in
`tests/fixtures/native-media/manifest.json`. Codec tool versions/container stream IDs can vary on regeneration; the
committed identity manifest is the reference and must not be replaced to fix a
failure. No decoder or reference asset was
replaced to obtain a pass. Source-byte equality, full graph return, current
reader proof, strict negatives, actual canonical seal, SVG displayed pixels,
all native audio sample decode/RMS/frequency, cover pixels, no autoplay,
actual native-play clicks and advancing time are asserted separately.

Detailed author raw evidence is retained in
`/private/tmp/keel-native-svg-audio-evidence-20261021`. Initial graph RED correctly
hit the fresh encoded-source guard before using the actual native recipe;
its guard was not weakened. Initial browser run was 8 PASS/1 FAIL: WAV native
play time did not advance above .1s in 1500ms, despite decode passing. The
unchanged WAV repeat passed, and the complete unchanged repeat was 9 PASS.
This transient remains disclosed for independent QA; no threshold was changed.
An added forged executable-SVG declaration regression was RED before its new
registered-composition source reinspection, and is retained in raw evidence.

## Release prerequisites

No 1.5 module is registered or deployed by this work. Prepare its exact source
through the existing Hold manager/shared-module governance, review an unsigned
transaction packet, obtain mandatory owner signatures, read back exact bytes
and selected-chain registration, update the authenticated catalog, and then
run the separate actual Studio/UI/API publication tests. Local/browser proof
cannot satisfy those release gates. This work does not claim that either
original Gatorrr or GIF publication is fixed or deployed.

The first full maintained author run used the wrong Homebrew zlib and omitted
isolated app-local dependency aliases/socket permission. It is retained as
`full-maintained.stdout.log` (2613 PASS/74 FAIL/11 cancelled/85 skipped), not
counted as a pass. The exact existing b0 decoder and Vite aliases plus the
intended NVM binary are used for the corrected full run. No production source
or existing assertions were changed to address these environmental failures.
A browser invocation accidentally overlapped clean-build dist deletion and
failed module imports; its raw `browser-build-order-import-failure.stdout.log`
is retained. The later sequential browser run passed all 22 actual tests.

Unsigned exact source/fragment export (no connection or transaction):

```
node docs/review/native-svg-audio-20261021/export-module.mjs <new-output-directory>
```

## Frozen source and fresh author results

Exact source `912bdc15f6bcadf399d9b9a038f0f321ccb10db6`:

* Full clean NVM build: PASS.
* Fresh entire maintained test list: **2700 PASS, 0 FAIL, 0 cancelled, 85 skipped**,
  120.017 seconds. No existing assertion/reference/tolerance changed.
* Fresh postfreeze canonical browser preservation: **22 PASS, 0 FAIL, 0 skipped**,
  31.892 seconds. Includes all new media, old animation and complete 3D cases.
* SDK nonincremental TypeScript: exit 0.

The 87→85 skip difference from b0 is explained by two unchanged local-Anvil
read tests executing when its existing binary is on PATH. No new skips were
introduced. The first corrected NVM full run was 2699 PASS/1 FAIL because the
isolated SDK package lacked its package-local workspace aliases in the installed
copy test; aliases were corrected, all original assertions remained, and the
entire unchanged maintained test list was rerun.

`author-results.json` binds the exact source, runtime binary, counts, commands'
raw output hashes, prior REDs and module identity. `author-evidence/` contains
the complete passing test/browser outputs and actual SVG/audio/model results.
These are implementer results. Independent approval and live release gates are
still pending; source remains frozen while that review proceeds.
