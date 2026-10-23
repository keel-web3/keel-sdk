# Native M4V and truthful QuickTime qualification

Final source: `e946bde7140d4ce1eb04ecac735c7ed216d2bf46` (source `5b873b6` plus its required one-line TypeScript correction), base `0dc7e6f`, branch `codex/native-movie-mime-admission-20261022`. Isolated author checkout: `/private/tmp/keel-native-movie-mime-admission-20261022-01`. Final commands use explicit Node 22.22.1 on macOS arm64. No production, host, chain, wallet, credential or shared source changes occurred. These are author results pending independent approval.

## Outcome and limits

**Native M4V qualifies:** the shared file normalizer now infers `video/x-m4v` for `.m4v` when MIME is absent/generic, preserving explicit declared MIME. The viewer recognizes this exact MIME. The current reader's existing complete ISO video validator checks the original container, known major brand, video track geometry, full sample tables, timing/counts and every media range. These checks apply after original/stored integrity validation for both None and Gzip storage. MIME-only, arbitrary video, text renamed as video, audio-only movie, truncated container and wrong-brand inputs remain rejected. Reader/profile/schema and actual registered JavaScript bytes are unchanged.

**Direct QuickTime remains unsupported:** `.mov` correctly infers `video/quicktime` and preserves its bytes. The actual current Chromium reader playback failed with error 4, `MEDIA_ELEMENT_ERROR: Unable to load URL due to content type`; `canPlayType('video/quicktime')` was empty, while MP4 reported `maybe`. The verifier had authenticated the original bytes. FFprobe identifies H.264/avc1, 32 by 24, SAR 1:1; no script errors or external requests occurred. This was a concrete playback MIME gate, not proof of missing onchain infrastructure. We did not relabel QuickTime or use a typeless playback bypass. The final SDK rejects direct QuickTime with: “Keep the original and prepare a separate MP4 playback derivative; verify it before publishing.” Forged None and Gzip direct QuickTime descriptors also fail closed.

The initial MOV-positive attempt and its failing browser assertions are retained, not converted to success: `browser-01.log`, `browser-diagnostic.log`, `browser-diagnostic/mov-failure.json`, `rejected-mov-native-browser.test.mjs`, and `rejected-mov-admission-source.patch`. The lead explicitly narrowed the release to verified M4V plus truthful QuickTime rejection. Independent review must assess that scope and the new explicit rejection test. The rejected patch is against base 0dc; its three small original fixtures are retained in the final source. Applying it to a separate base checkout recreates the rejected candidate; it is not a release patch.

## Actual inputs and representation

`original-source-identities.json` records exact full-file identities and creation commands. The 1786-byte retained synthetic MP4 (`a421a056…e5561`) was copy-remuxed, without reencoding, into actual 1732-byte QuickTime (`fe333b7d…0d05f`, major brand `qt  `) and 1775-byte M4V (`eb417767…2f719`, major brand `M4V `). All three have identical 880-byte mdat payloads, SHA-256 `8a231f9a9f7ff08ebb57548fac3e924fbc949ebe3bece1c214cb9698cd5cb64d`. They are actual distinct container files, not renamed MP4 fixtures. Production artwork and source projects were not accessed or altered.

The existing registered 6172-byte asset-display 1.1 module (`53957405…97f4`) already dispatches `video/*`; the current revision-5 native Gzip reader preserves the exact MIME in its data URL. This work changes offchain qualification only. Its exact retained prefix/suffix remain 662/83826 bytes, authenticated by the existing fixed profile. New onchain deployment or registration is not required for this alias.

## Before and after evidence

- Baseline `0dc`: new exact file normalization tests **0 PASS / 4 FAIL**, retained in `baseline-mime-gaps.log`. `baseline-three-boundaries.json` separately captures absent extension inference and viewer/None-proof rejection of both exact MIME types.
- Final exact `e946`: fresh normal standard package build **exit 0**, including all maintained packagers (`final-normal-build-corrected.log`). `exact-e946-build-output-manifest.json` inventories 1821 emitted files from this build.
- Final exact `e946`: **145 PASS / 0 FAIL / 0 skipped**, command below and `exact-e946-focused.log`. Covers existing None media/strict roles/proof/audit/recovery, normal Studio-core behavior, Gzip/shared modules, current carriage and media adapters; new M4V original/None/Gzip/brand/spoof/audio-only cases; accurate QuickTime inference and explicit direct rejection.
- Final exact `e946` browser: **2 PASS / 0 FAIL / 0 skipped** (`browser-exact-e946.log`). The unchanged MP4 case and new native M4V case use the retained exact registered revision-5 frames and actual module, reach the verified seal in an opaque sandbox, decode original bytes with exact SHA/data URL/MIME and show different red/blue frames at source times. No external artwork requests or script exceptions. Detail: `browser-exact-e946/mp4.json` and `m4v.json`.

Normal Studio Postgres intake of the M4V fixture, authenticated API/MCP operation, live deployment and wallet handoff were **not run in this author wave**. They must not be inferred from helper, COPY or browser tests. The separate primary normal MP4/None proof fix is already under independent review; this work does not fix or bypass the separately reported normal artifact `chain_id` issue.

## Existing original-preserving conversion path (source inspection only)

The inspected Site source offers the existing `image-quality-preview.tsx` media editor with Original, candidate format, and Keep original controls; server `studio-media-service.ts` delegates export to `prepareMediaCandidate`, and `studio-media-json.ts` explicitly preserves the original and recipe and returns a separate candidate. The builder supports MP4 output. `projectMediaPreviewWarning` already warns unsupported video users to keep the original and compare conversion. This is source inspection of the retained Site checkout, not a fresh UI/API conversion pass. The lead owns any corresponding Site selector message; this branch does not edit Site.

## Reproduce final checks

```sh
PATH=/path/to/node22/bin:$PATH node scripts/build.mjs
node --test tests/registered-native-none.test.mjs tests/studio-core.test.mjs tests/registered-native-gzip.test.mjs tests/registered-shared-module-codec.test.mjs tests/current-publication-carriage.test.mjs tests/media-viewer-adapters.test.mjs
KEEL_CHROME_HEADLESS_SHELL=/absolute/path/to/chrome-headless-shell KEEL_NATIVE_NONE_BROWSER_EVIDENCE=/absolute/evidence/path node --test tests/registered-native-none.browser.test.mjs
```

Browser HTTP fixtures bind only 127.0.0.1. The retained `frozen-3de-node22-browser.log` records an initial sandbox EPERM denial for that bind; the permitted local test retry is separately recorded in `frozen-3de-node22-browser-authorized.log`. No alternate public endpoint or access bypass occurred.

## Corrections retained transparently

The first source commit 5b had a defensive runtime QuickTime comparison outside the typed supported-MIME union; the final clean build caught TS2367 (`final-normal-build.log`). e946 corrects only that typed comparison. Earlier multi-command emit/test invocations did not propagate the TypeScript error; those intermediate logs are retained and are not a passing build claim. Final clean-build exit 0 and fresh final tests supersede them.

The earlier native None evidence README described the shell as Node 22 although its result.json correctly recorded the then-default shell Node 25. This packet adds an explicit fresh Node-22 replay of the unchanged frozen 3de runtime: **179 PASS** plus its **1 PASS** registered MP4 browser (`frozen-3de-node22-*`). No source/runtime was changed in that frozen checkout. Also, the earlier phrase “Gzip is not beneficial” for the retained MP4 was unsupported: measured Gzip is 1144 bytes from 1786 raw, MOV 1103 from 1732, M4V 1123 from 1775. Actual default None is reproduced; this wave makes no claim about why that default was selected and does not change codec selection.
