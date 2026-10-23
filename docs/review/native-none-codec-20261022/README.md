# Current registered reader: exact native None media

Source fix `cd55bf43b8dd7cdec855bb07b8cba5a8cefa3425`, source/test-classification
candidate `49219d69e737ce6f7af45ccbf7a2d9ca2afcf61b`, SDK base
`edaa7446c2cfcec6eee27ca13d3f0cc4718822f7`. Only production changes are
`registered-native-gzip.ts` and its private helper `registered-native-none.ts`.
No builder/media, reader frame, contract, binding, provider, Studio, project,
credential or deployment changes. No signatures or transactions.

## Actual failure and cause

Independent QA reproduced the unchanged normal PG17 test90a280 on Siteb010308
with both SDKedaa and the independently reviewed movie successor. The actual
offending descriptor was `artwork.mp4`, role `entrypoint`,1786B, SHA-256
`a421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561`.
It carried `compression:none`, canonical `storedBase64` and a stored commitment
identical to the original. The shared actual registered asset-display1.1 source
was6172B, SHA-256
`53957405312b1fe3b187a5c49b13d13a08fd6e960953c815c6e49b53637d97f4`, Gzip.
The actual normal document was91205B. All observed public reads returned200,
with no denial. No artifact, plan or wallet operation was created.

QA's diagnostic source, retained by the lead separately, is
`/private/tmp/keel-independent-temporal-normal-pg-20261022-02/evidence/role-diagnostic-shape-pg/native-gzip-original-throw.json`.
It identifies `inspectDocument:109 → createKeelRegisteredNativeGzipProof →
registeredNativeGzipForPublishedGraph → canonicalRoot → createArtifact`.

The immutable registered revision5 reader already decodes either UTF-8
`storedText` or Base64 binary, checks the stored SHA/length, applies None as
identity (or native Gzip), then checks the original SHA/length. Its actual code
routes video entries through the verified asset-display module. The offchain
proof inspector alone restricted binary None to five image types, contradicting
the existing SDK slot builder and actual reader. This was an offchain
qualification defect, not a missing contract or RPC denial.

The retained profile is unchanged: Sepolia11155111, registry63a / readerFbbb /
Hold0a4 / revision5. Prefix662B, SHA-256d9fb62…29f31; suffix83826B,
SHA-25630b18d…711b7; metadata303B. Tests verify the complete existing hashes from
the untouched receipt-backed fixture before composition. No regenerated frame
or replacement reader is accepted. The broader RAW7879 revision and Hybrid host
list are separate and are not prerequisites here.

## Smallest current-protocol correction

The existing proof now admits canonical binary None only after source-type and
role checks. MP4 walks complete bounded ISO boxes, actual video handlers, visual
sample geometry, timing/sample/chunk tables and every sample range inside media
data. WebM walks bounded EBML, exact document type, video tracks/geometry and
referenced media blocks. Existing SDK native-audio and complete-model inspectors
handle audio and models; there is no SDK-to-builder dependency or new package.

GLB and octet-stream None assets are deferred until every source's original and
stored commitments have passed. The existing complete model inspector then
validates one exact model graph, canonical/unambiguous IDs and relative paths,
all required resources and exact referenced buffer IDs. An unused or missing
buffer, ambiguous alias, path escape, external dependency, module or script MIME
cannot use this allowance. The model count/resource/byte bounds remain finite.

Text/JavaScript encoded None stays rejected. Existing image validation remains.
The generic fresh-carriage guard, canonical Base64 roundtrip, exact original and
stored hashes/lengths, exact immutable binding/frame, Gzip-only compressed
resource allowance and mandatory genuine Gzip member remain. Whole-HTML Base64,
Brotli substitution, invented reader profiles and encoded source siblings are
not authorized. The allowance does not claim container inspection proves codec
decode or playback; the browser check is separate.

Normal Raw/None video still includes the actual selected shared Gzip module and
therefore uses this current proof. An entirely-None shared-module catalog has no
genuine Gzip member and remains outside this exact recipe. The current model
compiler independently chooses Gzip for nonraster binary on this binding; its
selection logic was not changed. Fragmented MP4 and unknown-size WebM clusters
are not newly qualified as None by this bounded complete-file checker. These
limits are not permission to bypass an error or silently select another route.

## Reproduction and author results

Node22.22.1 on the owned isolated worktree. The initial1,735 SDK output leaves
were copied and hash-verified from the frozen edaa build manifest
`a3c99b194910aed2a22236075819b4ef9e9ea72f70d5975f6fa0f12beebfe651`.
Only the normal SDK TypeScript emit was rerun for the change. This is not a fresh
complete SDK package/release build; the lead owns that separate gate.

The baseline `baseline-exact-edaa-02.log` reproduces the exact1786-byte default
None MP4 rejection with the actual asset-display1.1 Gzip and exact revision5
frames:0 PASS /1 FAIL, `Native Gzip cannot admit another encoded None body.`

```sh
node packages/sdk/node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json
node --test tests/registered-native-none.test.mjs tests/registered-native-gzip.test.mjs tests/registered-shared-module-codec.test.mjs tests/native-gzip-store-case.test.mjs tests/model-viewer-graph.test.mjs tests/explicit-external-preview.test.mjs tests/current-publication-carriage.test.mjs
node packages/sdk/node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json --noEmit
KEEL_CHROME_HEADLESS_SHELL='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/registered-native-none.browser.test.mjs
```

Frozen492 author results: **93 focused PASS,0 FAIL/skip/cancel;1 actual browser
PASS; TypeScript PASS, exit0; classification0 issues**. Exact command/log/source
hashes are recorded in `result.json` and the evidence manifest. The classified
tests are `registered-native-none.test.mjs` (deterministic) and
`registered-native-none.browser.test.mjs` (browser).

The actual local Chrome check uses the unchanged retained revision5 frame,
default-None original MP4 and actual registered1.1 module bytes. It verifies the
opaque sandbox, verifier, exact1786-byte original SHA and data URL, native32×24
decode,0.56-second duration, and source-time pixel change red→blue. There are no
observed artwork external requests or script errors. This local document is
91189B because its test descriptor aliases differ from the91205B real normal
compiler result; it is not mislabeled as the exact normal-service document.

Original failures remain. The first authored fixture omitted the module's
required canonical render phase and failed earlier; the corrected fixture uses
the actual canonical phase/weight, without changing the source bytes. One
negative initially edited `vide` in x264 metadata instead of the `hdlr` handler;
it now asserts and edits the actual handler field. The missing-buffer negative
found a real deferred-validation hole: a None JSON model must trigger closure
validation even when the buffer itself is missing. Production was corrected,
and the unchanged negative passed. No assertion or reference asset was weakened.

The source remains **awaiting independent review and the unchanged clean PG17
normal-service rerun on the integrated SDK candidate**. No independent, deployed,
wallet-handoff or artwork-publication acceptance is claimed by these author
receipts. No cleanup, signing, credentials or external chain actions are needed
to rerun these local tests.
