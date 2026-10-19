# RPC specialist: explicit nonstandard reads and Hybrid runtime

Production source under review: `606479dff9d26e9af011001182e0dd91dab65f7c`.
Policy checkpoint: `554e56fa688437f0bd7e865db83052c4366ecf9c`.
Independent fixture correction: `bd440e5bb8a680fdf1d7ea5046026ce57c514dcc`.
Runtime checkpoint: `7f632510055d47be39b73194377fb5471f169827`.
The final two-line helper correction is `606479d`: optional window lifecycle
registration and preservation of the existing visual loading status. It changes
no test assertion, asset, calldata, limit, codec, or registry record.

These are implementer results. Independent integrated QA, independent release
review, browser integration, production identity, and the original real
publication are separate gates. No wallet signature, broadcast, or spend
occurred in this wave. Original full-program execution was not repeated.

## Environment and reproduction

macOS arm64; official NVM Node v22.22.1 (zlib 1.3.1-e00f703), pnpm 10.15.0,
Anvil 1.7.1. The test receipt records the exact Solidity compiler. Install frozen
dependencies normally; this checkout used `pnpm install --frozen-lockfile
--ignore-scripts` then restored its own qualified ffmpeg-static binary, SHA-256
`a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`.
Do not substitute a different Node/zlib runtime for compressed golden tests.
Neighbor identities and package hashes are in `environment.json`.

```sh
export PATH=/Users/ravonus/.nvm/versions/node/v22.22.1/bin:/Users/ravonus/.foundry/bin:/opt/homebrew/bin:$PATH
pnpm build
pnpm test
node --test tests/managed-shell-loader.test.mjs tests/nonstandard-read-policy.test.mjs tests/creator-prepared-compiler.test.mjs tests/creator-publication-journal.test.mjs tests/sdk-publication-preflight.test.mjs tests/governed-rpc-boundaries.test.mjs tests/keel-rpc-policy.test.mjs tests/hybrid-runtime-boundaries.test.mjs tests/managed-shell-rpc-chain.test.mjs tests/hybrid-chunk-resume.test.mjs tests/viewer-chunk-store-cancellation.test.mjs tests/copy-publication-enforcement.test.mjs tests/sdk-inline-viewer-graph.test.mjs tests/sdk-inline-existing-object-reuse.test.mjs tests/inline-payload-carriage.test.mjs
KEEL_NONSTANDARD_RECEIPT=/tmp/NEW-UNUSED-local-read.json node --test tests/nonstandard-read-anvil.test.mjs
node docs/reviews/studio-publication-20261019/nonstandard-read/compare-runtime-artifacts.mjs OLD_3D_CHECKOUT NEW_606_CHECKOUT /tmp/NEW-UNUSED-artifacts.json
```

The Anvil test is explicitly classified LOCAL_EVM and not silently added to the
ordinary unit gate. The four new policy/runtime unit files are deterministic.
All existing classification entries and assertions remain unchanged.

## Evidence ledger

| Evidence | Input / expected result | Actual scope |
| --- | --- | --- |
| `baseline-browser-red.log` | Synthetic old browser transport; denial/revert terminal, bounded window, retry/cache, cancel | Baseline new boundary cases fail against old behavior; original incident not tested |
| `baseline-governed-red.log` | Old `3d382e9` SDK transport bundled unchanged; denial/revert and fanout | Baseline fails; module override selects only the old implementation |
| `baseline-chunk-red.log` | Old `3d382e9` chunk reader bundled unchanged; terminal fallback and verified resume | Baseline fails; old object bytes/commitments unchanged |
| `fixture-baseline-red.log` | Integrated `18b23c5` after independent media classifier; intended decoder-limit assertion | Invalid fake PNG failed earlier than intended; one-line valid PNG approved independently as `bd440e5`; HTML size and exact assertion retained |
| `runtime-7f-full-red.log` | Exact `7f632510` complete ordinary suite | 2,443 PASS, 2 FAIL, 6 SKIP; two unchanged managed-loader VM cases expose new window-event/progress assumptions |
| `runtime-final-focused.log` | Exact `606479df` affected tests including unchanged managed-loader VM cases | See complete TAP totals; no mocks are presented as live browser evidence |
| `runtime-final-full.log` | Exact `606479df` full ordinary suite | See complete TAP totals and explicitly retained skips |
| `local-anvil-read.json` / `.log` | Exact `606479df`; valid URI 2,050,429 UTF-8 bytes returned by real local EVM | Default rejects; exact policy succeeds; HTTP response 4,101,030 bytes; same target/calldata/gas/block in both reads |
| `runtime-artifacts.json` | Frozen `3d382e9` versus `606479df`, same synthetic config and installed build inputs | Exact fragment/bridge hashes, full HTML and double-percent metadata sizes |

For the baseline chunk/SDK tests, bundle `git show 3d382e9:packages/viewer/src/chunk-store.ts`
or `git show 3d382e9:packages/protocol/src/keel-rpc.ts` with the same esbuild
dependencies, then set `KEEL_TEST_CHUNK_READER` or `KEEL_TEST_GOVERNED_READER` to
the resulting absolute module path. Browser baseline uses the unchanged test
against the old checkout's `packages/viewer/src/keel-rpc-view.js`. Captured logs
retain the baseline failures. New tests include more cases than the first
captured browser baseline; none of the original assertions was weakened.

## Interpretation and remaining gates

The policy binds source, project, revision, defaults, selected matrix plan,
measurement, chain, complete URI SHA-256/UTF-8 byte count, read gas and physical
RPC response ceiling. The unsigned preparation budget cannot authorize funding.
The compiler regression covers prepare/measure/explicit acknowledgment/attach/
full simulation/wallet equivalence with mocked infrastructure; the separate
Anvil regression proves an actual large EVM response, explicitly initialized
with local `anvil_setCode`. It is not a creation receipt, canonical fork,
production provider qualification, real wallet handoff, or the original asset.

The complete URI compatibility target remains 2,000,000 bytes by default;
explicitly bounded larger reads do not disable independent memory/decode,
chain/gas, full-simulation, or exact signing-equivalence requirements. ABI
offset/length/padding, hex expansion and JSON envelope are counted separately.

Both ordinary and selected URI81 prefix/suffix generator outputs and the exact
251,050-byte immutable published-reader asset remain byte-identical. The new
managed bridge and complete loader bytes change: a newly prepared Hybrid plan
must measure and bind them. Already published embedded runtime does not change
when this SDK is installed. This comparison proves generated byte identity for
the recorded inputs; existing onchain registry receipts and historical browser
read-back remain separate evidence.

Document/pagehide cancellation is terminal for that loader instance. Transient
failure resumes verified progress at the same immutable pin. Canceling one
independent chunk traversal cannot poison another. The existing loading text
and controls remain intact; progress is exposed as read-only data. Missing
window events in a VM do not disable per-request deadlines or aborts.

The original submission, latest matrix encoded-animation correction, actual
Studio acknowledgment/CAS path, Hybrid browser behavior, full production
publication/signing boundary, and historical authenticated rendering must still
be validated on the final integrated candidate. No result here closes those
gates. File hashes in `manifest.json` protect these receipts, not release approval.
