# Local acceptance regressions

These suites exercise actual maintained SDK, builder, Studio-core and MCP APIs using synthetic public fixtures. They make no live RPC, wallet, hosted Studio, database or third-party upload request. They are registered in `scripts/test-suites.mjs` under the deterministic test boundary.

After the normal workspace dependency installation/build:

    pnpm build
    KEEL_REQUIRE_MEDIA_FIXTURES=1 node --test tests/acceptance-boundary-properties.test.mjs tests/acceptance-media-fixture-parity.test.mjs tests/acceptance-mcp-route-guards.test.mjs

`pnpm test` includes these suites through the canonical classification. Explicit media acceptance gates should set `KEEL_REQUIRE_MEDIA_FIXTURES=1`: missing pinned Sharp or reviewed bundled FFmpeg then fails instead of turning unavailable conversion into a pass. In an optional local environment the media suite reports the precise dependency/capability skip. It never substitutes a system FFmpeg binary.

## Coverage

- Atomic release proof boundaries: 1–8 calls, neighboring invalid counts, exact single-call mutations, unknown/non-reverted receipt states
- Deterministic supply policy and media recipe quality/dimension/layer boundaries
- Twenty real or valid generated format fixtures through Original-mode SDK/MCP parity and exact Raw/Compact reconstruction
- Five edited output formats through complete frame/timing/pixel verification and per-result output hashes; separately encoded WebM containers need not be byte-identical
- Corrupt/truncated/unsupported editing rejection without losing original source bytes
- Explicit shell-off preservation and complete-tokenURI evidence size boundaries
- Every relevant runtime-advertised MCP tool's malformed operation is rejected before external I/O, plus an unavailable creator route that cannot request signing/submission

The tiny TTF is an original geometric fixture, not a copy of a third-party font. `tests/fixtures/acceptance-media/create-font.py` regenerates its checked-in Base64 JSON with fonttools 4.61.1; Python/fonttools are not normal test dependencies. PNG/video/audio assets are generated locally with the repository's pinned adapters. The empty WASM module is valid. GLB/glTF are minimal valid scenes.

## Limits

Original mode explicitly does not establish decode/render readiness. WAV and TTF are representative families, not every audio/font codec. These suites do not prove browser decoder behavior, authenticated UI routes, hosted release publication, collector sale/payment/access controllers, Tezos contract execution, or selected-chain gas. Anvil contract fixtures belong to the adjacent contracts repository and retain their own provenance, compile and fork gates; they must not be counted as public SDK unit coverage.
