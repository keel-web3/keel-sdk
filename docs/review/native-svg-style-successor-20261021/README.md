# SVG-AUDIO-912-001: complete SVG style inspection

SDK source `912bdc15f6bcadf399d9b9a038f0f321ccb10db6` is **not approved**.
Independent review reproduced a closed-media validation bypass: XML text,
CDATA and comments split dependency tokens that the browser combines into one
stylesheet. Per-event checks missed the combined `@import`/`url` tokens.
Independent observation SHA256:
`ee7ff97f98f46cd6e971156ed42d90cc0e3b9035d80609e8273eb6fcb38f0546`.
That report is copied unchanged as `independent-912-observation.json`.

This successor changes only preparation-time SVG style inspection. It joins
complete text and CDATA for each matching style element, ignores XML comments
as DOM text does, and validates the complete stylesheet before admission. Motion
classification uses the same combined string. Element descendants/nested styles
inside a style element are rejected actionably, avoiding scope reset or guesses
about browser descendant CSS semantics. Accumulation is bounded document-wide
by 65536 text/CDATA chunks and 32 MiB characters, in addition to the existing
32 MiB input / 65536 element / 128 depth bounds.

The original XML bytes remain unchanged. There is no CSS dependency flattening,
source stripping, rasterization, alternate renderer, API signature change,
protocol change, deployment, registration or signing. Asset-display 1.5 remains
exactly **6821 bytes**, SHA256
`a00a81a869a5bb589f2156a5ef19ea2fa1f01f7173cff7212e28ccbb9ed5baf0`.

## New strict regressions, added before the fix

The existing inspection test file is preserved byte-for-byte as a prefix; only
13 cases are appended. They cover the reviewer's exact contiguous and split
imports/URLs, XML-comment splits, mixed CDATA/comments/text, self-closing nested
style scope reset, nested style/other element descendants, native split
animation/internal fragments, independent sibling styles and bounded empty
CDATA accumulation. All source arrays are checked unchanged.

Before editing production code, the actual old SDK emission ran those tests:
**30 PASS / 10 FAIL / 0 skips**, retained in `before-fix.stdout.log`. That includes
all old positive/negative controls passing and the newly exposed failures.
After the fix, fresh focused tests across inspection, graph/registered-source
checks, module compatibility, byte identity and canonical graph pass:
**79 PASS / 0 FAIL / 0 skips**, retained in `after-fix-focused.stdout.log`.
Nonincremental SDK TypeScript exits 0 (`sdk-tsc.stdout.log`).

```
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node --test \
  tests/native-media-inspection.test.mjs tests/native-media-graph.test.mjs \
  tests/media-viewer-adapters.test.mjs tests/sdk-media-revision-reuse.test.mjs \
  tests/sdk-inline-viewer-graph.test.mjs
/Users/ravonus/.nvm/versions/node/v22.22.1/bin/node node_modules/typescript/bin/tsc \
  -p packages/sdk/tsconfig.json --incremental false
```

The intended Node binary SHA256 remains
`245e0321af97d3c21dd4e7104457334dfe3c3ba7982d0db75363e354565f8cbb`,
Node 22.22.1 / zlib 1.3.1-e00f703. No fixture, old assertion or tolerance changed.
All 912 full-suite/browser results remain historical; they do not approve this
successor. A fresh full suite and browser preservation run are deferred until
independent review confirms all current parser blockers are resolved and the
source is frozen. The lead owns the separate Site bridge and live gates.
