# Independent temporal test setup admission

**APPROVED_TEST_SETUP_ONLY** for the three exact patches below. This is not production source, browser, release or publication approval. The independent check used fixture snapshotSDK`1b094aab54da816fdc37ed397b41396a292ef2e4` in this isolated clone and freshly compiled its own builder only. Read-only dependency bindings and source/runtime hashes are in`environment.json`. No host, provider, native executor or wallet was accessed; no production fix was authored.

## Explicit supported color fixtures

Admit`explicit-color-positive-fixture.patch`, SHA`b0962f67b15dcef58e18ce159e045183a9c75437b1465be30388c3a189ceace2`. The two positive test generators previously emitted RGB movies whose primaries and transfer were explicitly unknown. Their lossless image-conversion assumption lacked an established source color profile. The patch sets BT709 primaries, sRGB transfer, RGB matrix and full range in those synthetic positive generators. It does not change any assertion or production tolerance. The original untagged MP4/MOV generators remain additive negatives requiring native-byte retention for unsupported image conversion.

Independently generated original/tagged MP4 without audio, MP4AAC440, MP4AAC660 and MOV sources retain every decoded RGBA hash, frame timestamp and duration. Both AAC variants retain every decoded float64 PCM byte (length and SHA equal). The encoded file identities change as expected when explicit presentation tags are added; original sources remain retained. Input FFmpeg probe lines demonstrate unknown→explicit tags, rather than assuming them from a filename or encoder. See`color-fixture-identity.json` and`generated/`.

The unchanged original maintained positives freshly produce21P/2F against the conservative fixture snapshot; the corrected positives and seven added semantic/native-retention negatives produce30P/0F. The old RED is retained. AST comparison confirms all106 assertion calls in both maintained files are byte-identical. This admits a supported-positive fixture, not an equivalence claim for arbitrary untagged media.

## Exact retained negative candidates

Admit`reviewer-retained-candidate-setup.patch`, SHA`4818fb3e757ce68ede1cb339c60d0b446509c7edc8ba25deb4fb19c5f8af666e`. The original two independent negatives called shared preparation before their rejection assertions. Corrected shared preparation now rejects those unsafe inputs at that earlier step; freshly running the unchanged first-three driver gives1P/2F before the intended pair assertion.

The setup correction uses the exact already-retained464-byte candidate SHA`15e160de0827a42f62a73490d690561125232cff77877db53148cbc1ece035db`, without changing source generation or any of the five assertions. Original SAR source2918B/SHA`66f1276bd4fdeafa2b3eb370598250b40248bb7ed356829c7bf257635512cab3` and title source2972B/SHA`7c41053e177dd103e6a2a40e4b634a9cdaa48288b3ac3a028d64facffff636a7`, and both candidate files, are byte-identical to independent blocked review`88e4f3026`. The corrected driver freshly passes3/3; separate exact source/shared prepare/compare/native-retention negatives remain present. This preserves the original verifier regression while allowing the now-safer constructor to reject independently.

## Optional native VIDEO test mount

Admit`native-video-driver-extension.patch`, SHA`4979d61dde8240def00ca6d96101ec6472a5c9feae4c9d48b9116d894928453f`, from author test-only commit`4cef175`. The helper previously searched only IMG/AUDIO, so the two new native-video cases could not find their actual VIDEO node. The optional selector leaves the default generated expression byte-identical and makes only the new cases require a real`#keel-asset-display video`. AST checks preserve all14 assertions, verification/seal/context checks and error handling. The existing4P/2F browser RED is retained. This review does not claim a fresh browser PASS; actual final-source canonical playback must be independently rerun.

All125 assertions across the three reviewed fixture/driver comparisons are unchanged. All original failures and reference assets remain preserved. Production source7599371 and its successor still require a separate frozen source review and fresh affected QA. No selected-chain, original Gatorrr/GIF, wallet boundary, PUB402 completion or deployment gate is passed here.
