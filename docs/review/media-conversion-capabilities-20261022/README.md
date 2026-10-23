# Conditional server media conversion — scoped author freeze

Production471b26a572531ccd56e926bdb8fd682ce2f4ab4e; separate independently admitted test correctiond46961461df319e26d4c947030fddf06337ed7f7; base0dc7e6f342b228515b1eecf783c9fd3629802eef. Independent source approval remains OPEN. No source/container/fidelity guard, MIME routing, asset-display, reader, None/audit, UI layout/control, provider, storage/adoption or wallet changes.

The server advertised WebM candidate conversion even though the current complete movie verifier admits ISO profiles and cannot verify WebM's container metadata/presentation semantics. The fix removes only WebM from advertised candidate outputs and refuses edited WebM with an actionable TypeError BEFORE Sharp/FFmpeg probing/encoding. Native Original exports and saved WebM recipe parsing remain unchanged; no implicit format substitution occurs. The advertised remaining formats are explicitly conditional on complete decoder/container/color/timing/audio admission, not universal lossless or publication promises. SDK, real portable MCP and the existing Site capability consumer use the same list; the latter hides the unavailable format and explains a retained WebM recipe without modifying it.

## Exact retained references and test admission

Retained MOV1927B SHAea3b962dc878b4514ae1798fa10c90a10bac04d3f96459eccfec1d8ce8a4e736 has unspecified color. Its WebP/AVIF lossless conversion correctly refuses; no color guard was weakened or reference replaced. Retained actual encoded WebM1489B SHA6013f6fd732009e925ecdeb7db2f784e7c7faa64c569efce3bcf7c3b5ca54015 remains valid for exact Original SDK/MCP export; it gains no conversion-equivalence proof.

The old33-case acceptance suite was untouched during product validation: candidate-original-expectations.stdout records61P3F combined (old30P3F + independent3P + new5P + qualified23P). Original testSHA18f79dc8df2bfa9381ed50d80869171b587c91d7ae2b013cb0fe1feca7662ffe and original fixtures/generators remain retained.

Independent QA explicitly ADMITTED TEST_EXPECTATION_ONLY patch27bf586a67b4f84241faa07716bfdb7f5fac79558b0982dc2b4d768874afbae2, receipt00db88442b0568e4553c629f333d090db0d95cec7fe042e186f5409a2b0f2c85. Only after admission was its exact single1874-byte insertion applied (separate commitd469). All33 cases and all generators/references/other assertions remain; inverse insertion removal reproduces the original byte-for-byte (expectation-equivalence.json). The three invalid positives now assert typed/actionable SDK+MCP refusal and exact Original SDK/MCP/filesystem retention. MP4/MOV positives retain all original assertions. Independent baseline on old0dc with the proposed correction was32P1F (WebM capability defect still failed); the independent receipt records this, so corrected expectations did not manufacture product success.

## Fresh checks

- Own candidate normal `node scripts/build.mjs` exits0, generating declared outputs in this stage; no borrowed mutable runtime outputs. Initial sparse source-closure misses and an own wrong-named WebM fixture setup failure are retained separately. The intended new-test assertions/expected6013 hash were unchanged; the correct exact reviewed1489B file was copied instead of the1349B native fixture. No old acceptance reference was modified.
- Final67 PASS /0 FAIL: admitted acceptance33, unchanged independent db78 three cases, new capability five cases, existing qualified actual-pair/media-preparation23, classification three. No skips.
- New early-refusal cases prove ZERO subprocess launches for both lossless/lossy WebM, immutable source and saved recipe, exact native Original MOV/WebM export and real portable MCP parity.
- Builder TypeScript noEmit exits0.
- Read-only actual Site consumer from source230c8cff0e2075042cc0784c03beece7ddf14900, leafa2123692965524c365d209f851dbc0a727bb5ce1e05dcc690e55376ee030f489: actual candidate SDK response excludes WebM for movie/audio/still contexts; existing saved-recipe reason says unavailable/original retained, and Original remains eligible. This is the real local consumer function, not a browser/HTTP/deployed UI claim (site-capability-consumer.json).

Commands from this SDK with pinned Node22.22.1:

```
PATH=<Node22 bin>:$PATH node scripts/build.mjs
node --test --test-concurrency=1 tests/acceptance-media-fixture-parity.test.mjs reviewer-acceptance-media-capability.test.mjs tests/media-conversion-capabilities.test.mjs tests/actual-media-pair.test.mjs tests/media-preparation.test.mjs tests/test-suite-classification.test.mjs
node node_modules/typescript/bin/tsc -p packages/builder/tsconfig.json --noEmit
node ../evidence/site-capability-consumer.mjs
```

The unchanged independent db78 script and its exact retained MOV source must be copied to the same SDK-root/sibling-evidence paths when reproducing, as its original frozen fixture URL is intentionally unchanged. Own new maintained tests use tracked self-contained fixtures. No actual artwork, credential, production service, on-chain state, wallet signature or paid request was touched. Root's Gatorrr/GIF/live gates remain separate.
