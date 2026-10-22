# Edit-list correction — author freeze; independent admission/review pending

The exact independent `TEMPORAL-EDIT-LIST-1` inputs were reproduced in a new isolated checkout before production edits. SDK364a treated `elst` as an opaque technical leaf, allowed duplicate `edts`/`elst`, and could issue conditional equivalence for unsupported or malformed playback instructions. All six variants produced the same 464-byte WebP, SHA256 `15e160de0827a42f62a73490d690561125232cff77877db53148cbc1ece035db`.

## Exact code and scope

- Frozen predecessor `364a536d7cd1ae7b6a2d9a08ddec3b203b7f94f5` was not edited.
- Production changes are only `packages/builder/src/movie-presentation-semantics.ts`: `b8947412338569fc2d073aa75e882949a6e4379d`, then `b5a153547a5d5876f028d7c2678605fda735185d`.
- Executed source/test tree: `f01114d7ee11ef9d389551b6f22cc076c15df697`. The final evidence commit changes no production code or tests.
- Site checkout is sparse, with unchanged HEAD `3a76da90027b8c8e4b0c4b3aee8be0f03091bbe4` / production source b378. Its actual `@keel/builder` points to this corrected SDK; `environment.json` records the physical paths.

The parser validates versions 0/1, exact flags, one supported forward entry, exact entry count/body length, positive segment length, signed media-time bounds and exact fixed-point rate 1.0. Duplicate outer edit containers and lists reject. It parses movie/media clocks and complete `stts` timing with BigInt, checks exact correspondence, rejects unsupported composition offsets, and binds complete movie duration to admitted track durations. Thus matching forged header clocks cannot override the actual sample timeline or add an unmodelled movie tail. Standard upward conversion into the movie clock is integer rescaling, not an added tolerance. Existing decoded RGBA, exact packet times, loops and f64 audio checks remain enabled; no pair-proof interface changed.

The known AVIF infinite-repeat default is explicitly modelled. Flag 1 requires a complete AVIF sequence, actual decoded AV1, an `av01` track, matching primary/track AV1 configurations, exact dimensions/cycle clocks and the known infinite track duration. A brand alone cannot qualify an H264 MP4. Finite/unknown repeat forms, empty/splice/dwell/reverse edits and unsupported composition offsets retain native media. Original mode continues to preserve exact bytes without conversion or semantic admission.

## Baseline and reference integrity

`reviewer-editlist.test.mjs` is unchanged SHA256 `3abdce03893acde8c328fccc3344d80d25d9fabc1dd1ef4e050d06c13d03c98d`. Original input identities are in `reviewer-input-identities.json` (SHA256 `427754dbf534affba8a2395d3354c7bf6845c32467abe461035dcac0c98eec51`) and unchanged bytes in `reviewer-inputs/`.

The unchanged seven-case baseline is **1 PASS / 6 FAIL** (`baseline-reviewer.stdout`). Four cases fail on missing rejection. The final two fail earlier on Buffer-versus-Uint8Array assertion prototypes; they do not themselves prove conversion reached the verifier. `baseline-last-two-direct.json` independently runs those two retained-byte inputs through the actual old SDK and confirms the same 464-byte output and conditional proof. Running the proposed byte-comparison setup correction against the frozen old modules also produces **1 PASS / 6 FAIL**, now all six missing expected rejections (`baseline-corrected-byte-script.stdout`). Baseline artifacts/proofs are retained under `author-baseline-artifacts/`.

| Variant | Source bytes | Source SHA256 |
|---|---:|---|
| Half rate | 2937 | `b2ad0f3b82fe2808a468d1f0e6ac283c869e9fc852483e48f2caf602583109e3` |
| Unsupported version | 2937 | `41bf356340d157a5b731e3ef498e9e9048c37f585913813fb0de1bbd9d958902` |
| Wrong entry count | 2937 | `4182c1002ed7999774e8abaa86b259dfe8e068c307c35b2a0eb13323762fead5` |
| Duplicate elst | 2965 | `f41bb7f4977ab4a34def60d30c170e9afdb385156dd9f6da686089b324f227ed` |
| Unknown MP4 flags | 2937 | `33f37b310127315151ab0593177e2963aab85b245987d8ebea33a830925b9f1b` |
| Duplicate edts | 2973 | `ec083cb7e5c9a53fc65e626b408fd4553d784889874914c30c2eacc970440c21` |

The additional retained movie-tail input was separately observed to get conditional proof at b894 despite declaring a 1200 ms movie and only 600 ms of decoded/track media. `movie-tail-before-fix.json` and its exact MP4 retain that author observation; no browser visual difference is claimed. The final source rejects it and preserves its original bytes.

## Final author results

All tests below freshly ran against source/test tree f01114d. These are local synthetic checks, not hosted Studio, chain, signing or deployment proof. Full commands are in `commands.sh`; every stdout has matching stderr.

| Check | Actual | Evidence |
|---|---|---|
| Existing 54 + reviewer seven + six new grammar/bounds/profile groups | **67 PASS / 0 FAIL / 0 SKIP** | `freeze-sdk.stdout` |
| Actual normal complete-context Site compiler/plans/renderer/SDK selector | **22 PASS / 0 FAIL / 0 SKIP** | `freeze-site.stdout` |
| Actual installed Chromium: canonical temporal playback/audio and native SAR/title preservation | **6 PASS / 0 FAIL / 0 SKIP** | `freeze-browser.stdout`, `browser-results/` |
| Builder TypeScript | Exit 0 | `freeze-builder-tsc.stdout` / stderr |
| Site TypeScript | Exit 0 | `freeze-site-tsc.stdout` / stderr |

Version 0 and 1 identity edit lists both convert the actual complete three-frame movie correctly. Existing AAC/full f64 PCM and variable-timing AVIF cases pass. Raw source bytes, expected rejection assertions, codec quality, temporal assertions and decoder tolerances were not changed.

## Test corrections requiring independent admission

- `reviewer-native-byte-comparison.patch`, SHA256 `87dba055351d75fd9336135c85cf23a5de647ea7077900a580ded187d036ecf1`: two shared expected-native assertion sites wrap the unchanged expected Buffer bytes in `new Uint8Array`. All seven cases, source generators, exact references and expected conversion rejections remain. Corrected script SHA256 `f54c9bea4e9c90a7070287d77c957dc4864d8c7181b2f4fd9ca1bf5d3431fe62`. Original script and RED remain unchanged. This is test setup, not a change to production output types.
- `author-stts-error-phase.patch`, SHA256 `49e292f105412a82beb886544a1eb1f377ab9c10167f378bf467c2bf538e23d5`: a newly authored malformed STTS count-zero case originally demanded the leaf's error text at the API boundary. The pinned decoder rejects the broken header before the leaf runs. The correction keeps the exact malformed bytes and API rejection, expects that actual decoder phase, and adds direct leaf rejection of the exact grammar. Its original **65 PASS / 1 FAIL** is retained in `third-complete-cohort.stdout` and original test text. Additional later coverage only adds cases.

Both corrections were submitted for independent review and are **PENDING**. The 67 author result is not an independent admission or source approval. No assertion was silently removed to green a release.

## Pinned grammar provenance and remaining gates

Exact public upstream files, original copyright/license headers, full-file SHA256, function hashes and physical line spans are under `upstream/` and `grammar-provenance.json`: [FFmpeg 6.0 parser](https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/mov.c), [muxer](https://github.com/FFmpeg/FFmpeg/blob/n6.0/libavformat/movenc.c). The saved muxer explicitly defines AVIF repeat flag and infinite-duration output. Runtime executable/package versions and SHA256 are in `environment.json`.

Independent test-correction admission, independent production source review and fresh affected QA remain required. Root integration/deployment, actual user submissions and whole-cost adoption/persistence remain open. No Site production source, provider, registry, reader, shell, wallet, chain or production host was changed in this wave. Public upstream source downloads were the only external requests; no private artwork was uploaded. The previously frozen checkouts remain available for independent review.
