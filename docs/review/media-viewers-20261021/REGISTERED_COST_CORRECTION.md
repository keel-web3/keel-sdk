# Registered model composition cost correction

This narrow successor to SDK `ae03a3e46c192f498c919c16aac14ebe1ac0db6c` resolves the independent S3 accounting finding. It does not integrate or register S3. The prior independent receipt remains preserved: SHA256 `28cdf67ad40fb2a0191991b5a115815d3c780ae429457b4e25be000bf222f561`.

The registered helper correctly copied authenticated published module bytes, allowing the same exact decoded source to have different compatible lossless storage. Its returned `modelPresentation.byteCounts.completeHTML` incorrectly retained the local Gzip document's size. Reusing the exact same core module as registered None produced630140 actual HTML bytes while reporting364274: an undercount of265866 bytes. The old common graph's HTML, percent-carriage, proof and publication counters already reflected the actual return; the extra model presentation counter was stale.

The correction derives that counter from `graph.htmlBytes.byteLength` after exact registered assembly. Original-source, generated-source and shared decoded-source counts retain their intended decoded-byte meaning. Every per-resource stored/descriptor count and every raw HTML, escaped HTML, percent-carried graph and creator-publication count is checked against the final authenticated parts. Exact published bytes remain unchanged; no recompression, guard, fixture, tolerance, module source or shell change is used as a workaround.

| Synthetic exact-readback input | Old local HTML count | Correct returned HTML | Escaped HTML | Raw-percent graph | Creator publication |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core module Gzip |364274|364274|382806|401338|4105|
| Same exact core source, registered None |364274|630140|704046|777952|4105|

Both inputs retain the same original GLB4112 bytes/SHA256 `6c836f043d3d7ba771fc13a1498a4cc1ad872c8297f8a15c7b912a1a8c0157d2`, five exact decoded module sources, generated presentation identity, selected chain/store/reader/block, two current-reader authentications and seven exact registry/object reads. Synthetic callbacks prove the helper's invariants; they are not live selected-chain registration evidence.

The regression prepares real final1/1 metadata with the actual None-module graph, then checks complete UTF-8 tokenURI outputs of1,999,999,2,000,000 and2,000,001 bytes. The existing presentation planner consumes the complete measured return, and the unchanged default read-identity guard rejects the above-target return without explicit nonstandard review. No expanded test or production budget is supplied. Preparing bytes remains distinct from permission to simulate, sign or publish.

## Fresh author results

Environment: macOS arm64, Node22.22.1, Chrome155.0.8059.85, existing copied dependency closure, local loopback, whitelisted environment without production credentials. Load4.74 before final browser work. The CDP1000ms ceiling and all references/assertions remain unchanged.

| Check | Result | Evidence under `registered-cost-evidence/` |
| --- | --- | --- |
| Added None/Gzip cost regression before correction |1 PASS,1 FAIL,0 SKIP; exact364274≠630140 failure | `model-registered-cost-red.tap.gz` |
| Complete SDK TypeScript |PASS exit0 | `model-registered-cost-tsc-final.log.gz` |
| Full affected deterministic cohort, including three additive declarations |67 PASS,0 FAIL,0 SKIP | `model-registered-cost-freeze-focused.tap.gz` |
| Native raster actual canonical browser |7 PASS,0 FAIL,0 SKIP | `model-registered-cost-raster-browser.tap.gz` |
| Complete model actual canonical browser |4 PASS,0 FAIL,0 SKIP | `model-registered-cost-browser.tap.gz` |

The initial compile used a generic optional integrity-length type; its error is retained. The final implementation measures the actual typed byte array. Existing source/render bytes did not change, and the full11-case browser matrix was freshly rerun. The original reviewer probe/receipt and all author RED/PASS evidence remain retained; no previous result was overwritten to claim a pass.

Reproduce from the exact successor with matching frozen dependency closure:

```sh
node node_modules/typescript/bin/tsc -p packages/sdk/tsconfig.json --pretty false
node --test tests/model-viewer-graph.test.mjs tests/sdk-inline-viewer-graph.test.mjs tests/media-viewer-adapters.test.mjs tests/smart-still-media-default.test.mjs tests/test-suite-classification.test.mjs tests/registered-native-gzip.test.mjs
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/media-viewer-browser.test.mjs
CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test tests/model-viewer-browser.test.mjs
```

`registered-cost-source-binding.json` records the two changed source/test files and verifies every other previously bound source/fixture remains byte-identical to ae03. The containing commit binds those bytes and the evidence manifest. Fresh independent successor review remains required. Full default SDK QA, selected-chain module registration, Studio integration, SVG/audio completion, private artwork/live publication and deployment are not established by this source-only correction. SVG/audio WIP remains separately preserved and unexported.
