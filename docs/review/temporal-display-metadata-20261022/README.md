# Temporal presentation-semantics correction — author freeze, source review pending

The exact independent SAR and creator-title failures were reproduced before editing: `baseline-402-reviewer.stdout` is 1 PASS / 2 FAIL. The common 464-byte WebP had the same decoded raster but changed the movie's displayed shape or discarded its title. A separate fresh run against root SDK848, `author-baseline-shared-848.stdout`, is 0 PASS / 6 FAIL across ordinary candidate/comparison APIs for SAR, title and APNG. These are local synthetic inputs, not Gatorrr or live publication evidence.

## Frozen code and ownership

- Behavior correction commits: `d2ec00da1f2e3e482aad2a8efbc5ecfda3dc05ff`, then `75993716f998ff900c14b862552dc0adcdab7a03`.
- Test/fixture checkpoint: `1b094aab` (full identity in Git), new native browser tests `4180b9cceae65de05d0cdffa69d7b0d45f3728bb`, test driver `4cef175f2a7b9c18cb1470006a65835c56f35bf1`.
- Final executed SDK test tree: `4cef175f2a7b9c18cb1470006a65835c56f35bf1`. This final evidence commit only adds receipts and corrects a grammar-reference comment; runtime behavior remains 7599371.
- Site physical validation checkout: `/private/tmp/keel-temporal-display-guard-20261022-01/keel-site`, HEAD `3a76da90027b8c8e4b0c4b3aee8be0f03091bbe4`, production source `b378750a81fd396fa3f8ac1fbc72227151dbd75f`. No Site source was edited in this wave. Its real `@keel/builder` resolves to this corrected SDK; see `environment.json`.
- Production ownership is only `media-preparation.ts`, `media-pair-verification.ts`, and new `movie-presentation-semantics.ts`. Previously frozen SDK402/52584 and Siteb378/3a76 directories were not changed.

Shared movie decoding now checks presentation semantics before returning a lossless claim. A bounded closed ISO grammar rejects unsupported SAR/DAR, matrices, track dimensions, aperture, rotation, layering, enabled state, playback rate/gain, creator/language/time metadata, color and unknown semantic boxes. Technical encoder/muxer bookkeeping is a closed allowlist. Actual-pair proofs also bind known sRGB versus unspecified RGB semantics. Unknown movie color cannot silently become the image default. The normal Original/native path bypasses conversion and preserves arbitrary bytes.

For an admitted Sharp sRGB RGBA source, or an actually declared and admitted movie sRGB profile, FFmpeg receives explicit `-color_primaries bt709 -color_trc iec61966-2-1 -colorspace rgb -color_range pc`. This carries established semantics into encoded output; it does not classify an unspecified movie as sRGB. All existing full RGBA, exact packet timing, loop/container, bounded decoding, cancellation and f64 PCM comparisons remain enabled. Unsupported conversions retain native input; this is optimization unavailability, not a requirement that the creator alter a profile to upload.

The source layout references were checked against the official [FFmpeg 6.0 MOV parser](https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/mov.c), [6.1.1 parser](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/libavformat/mov.c), and [AVIF 1.2 properties](https://aomediacodec.github.io/av1-avif/v1.2.0.html). The exact allowed Darwin binary reports FFmpeg **6.0**, not 6.1.1; its SHA and complete runtime versions are recorded in `environment.json`.

## Exact inputs

| Input | Bytes | SHA256 |
|---|---:|---|
| Retained SAR 2:1 MP4 | 2918 | `66f1276bd4fdeafa2b3eb370598250b40248bb7ed356829c7bf257635512cab3` |
| Retained creator-title MP4 | 2972 | `7c41053e177dd103e6a2a40e4b634a9cdaa48288b3ac3a028d64facffff636a7` |
| Each retained bad WebP candidate | 464 | `15e160de0827a42f62a73490d690561125232cff77877db53148cbc1ece035db` |

All are unchanged under `reviewer-inputs/`. Exact independent test originals are retained. `original-test-fixtures/*.original-source.txt` are byte-exact Git52584 originals; they have a non-test suffix so routine discovery cannot accidentally run known-invalid positive setup. Copy them to `tests/reviewer-original-{actual-media-pair,media-preparation}.test.mjs` to reproduce `original-positive-fixtures-on-correction.stdout` (21 PASS / 2 FAIL), then remove only those temporary copies. Those failures are the intended refusal of unspecified movie-to-image conversion.

## Results, exact scope and commands

Node: `/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node` (22.22.1). Full commands are in `commands.sh`. Every final receipt has its matching stderr. No SKIP or tolerance changes were used.

| Check | Actual | Evidence |
|---|---|---|
| Final SDK/codec/container/semantics + retained pair + unchanged shared SDK/MCP | **54 PASS, 0 FAIL, 0 SKIP** on 4cef | `final-4cef-sdk-cohort.stdout` |
| Actual normal complete-context compiler/plans/final renderer/selector, unchanged Site | **22 PASS, 0 FAIL, 0 SKIP** on Site3a76/SDK4cef | `final-4cef-site-cohort.stdout` |
| Installed Chromium, current canonical temporal playback/audio + exact retained native movies | **6 PASS, 0 FAIL, 0 SKIP** on 4cef | `final-browser-video-driver.stdout`, `browser-results/` |
| Builder TypeScript | Exit 0, behavior759 | `final-builder-tsc.stdout` / stderr |
| Site TypeScript | Exit 0, Site3a76 + behavior759/test418 | `final-site-tsc-418.stdout` / stderr |

The 54 cases comprise the existing 34, seven new semantics groups, three retained-candidate negative cases and ten unchanged shared SDK/MCP cases. The latter still have `848` in their original test names; the final receipt executes them against the corrected physical builder. The fixture/driver corrections received independent TEST_SETUP_ONLY admission below; this is not production source approval.

The new native browser checks use the actual current registered-shell source and asset-display runtime, authenticate the verification state/seal, assert original bytes through SHA256, and assert VIDEO display dimensions. SAR is **64×24**; title is **32×24**; object-fit is `contain`. Both have zero console errors, failed requests or external requests. This is local browser proof, not selected-chain registration, hosted UI, signing or deployment proof.

The full-context synthetic measured input is now 1786 bytes / SHA `0xa421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561` because the established color tags are now carried. In the same actual canonical context the 188-byte WebP changes complete UTF-8 tokenURI **136065 → 134700 bytes**, and distinct new document/preview plus physical manifest **5064 → 3727 bytes**. The receipt reports the complete current graph, not asset bytes alone. Owner/database/catalog adapters are explicitly local fixtures; no persistence, onchain simulation or gas-cost claim is made.

## Test admission and retained RED

- `reviewer-retained-candidate-setup.patch` SHA `4818fb3e757ce68ede1cb339c60d0b446509c7edc8ba25deb4fb19c5f8af666e`: replace only generation of the two already bad candidates with exact retained 464-byte candidates. Original source generators, title-absence checks and pair rejection assertions stay unchanged. Shared preparation must now reject before it could generate bad output.
- `explicit-color-positive-fixture.patch` SHA `b0962f67b15dcef58e18ce159e045183a9c75437b1465be30388c3a189ceace2`: two positive generator lines explicitly declare sRGB/RGB/full; every existing assertion remains. Original untagged generators are additive native-retention negatives in the new semantics suite.
- `native-video-driver-extension.patch` SHA `4979d61dde8240def00ca6d96101ec6472a5c9feae4c9d48b9116d894928453f`: optional exact VIDEO mount selector only for the new tests; old IMG/AUDIO default, verified shell/seal and zero external/error assertions remain. `final-browser-six.stdout` retains the original 4 PASS / 2 FAIL driver omission before this extension.

Independent TEST_SETUP_ONLY admission: `e0df35527178e686e681c306fba53b6fc1317a7e` at `/private/tmp/keel-independent-temporal-fixtures-20261022-01/keel-sdk`, admission SHA `1c449e866a4798d124440ab88346100f79dbf9eafcdd8a6ce02a61e35199e291`. The reviewer independently verified all three exact patches, four original/tagged families' RGBA/timing/full f64 PCM, original SAR/title hashes, all 125 existing affected assertions and the original browser-helper default. The reviewer did not claim a fresh browser PASS or source approval. Source review/approval is a separate gate.

All original and author-iteration REDs remain, including 402's 1P2F,848's 0P6F, intermediate 30P4F/33P1F, old-positive 21P2F, and the new-video driver 4P2F. Early new-test Uint8Array/Buffer assertion-type mismatch and language-parser bug are retained as author iteration receipts, not approval evidence.

## Open gates

No production source in this wave is independently approved yet. RootSDK848 is not changed by this checkout. Required next steps are independent source/adversarial review and fresh clean-checkout QA of the exact integrated candidate. Whole-cost persistence/adoption remains OPEN; the accepted interface is the root's `lead-temporal-adoption-interface/README.md`. No adoption hook, host operation, external private upload, contract deployment, wallet signature or production activation occurred here.
