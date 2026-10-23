# Isolated complete-program capacity qualification

Base commit: `e6ad88099fe17485f01d36af6e2599af384cadd6`.
Branch: `codex/creator-sequence-preflight-20261014`.
This directory describes an uncommitted isolated source candidate; the parent
owns preservation, commit and integration. No deployment, wallet transaction or
live provider measurement was performed here.

Source fingerprint:
`6c23d98278adc6ed15adb24f2bce384a67fb9418180b34ab50c6ed2a753060ed`.
`source-fingerprint.json` contains the exact 10 changed source/test/document
identities and 12 fresh local ESM JavaScript/declaration identities. Its source
fingerprint is SHA-256 of compact sorted-key JSON for the sorted source array.
The canonical verification-shell source remains byte-identical to the base.

Qualified checks:

| Command | Result |
| --- | --- |
| `npm run build --prefix packages/sdk` | Exit 0: normal TypeScript emit/declarations and normal package assets |
| `node --test --test-reporter=tap tests/sdk-simulation-capacity-policy.test.mjs tests/sdk-public-simulation-pool.test.mjs tests/sdk-simulation-connection.test.mjs tests/sdk-publication-preflight.test.mjs tests/transaction-gas-policy.test.mjs tests/rpc-publication-simulation.test.mjs tests/sdk-release-wallet-batch.test.mjs` | Exit 0: 180/180 passed, zero failed/skipped/cancelled |
| Built local `packages/sdk/dist/index.js` ESM import and four new/legacy function-export checks | Passed 4/4 |
| `git diff --check` | Exit 0 |

The normal build expands existing sparse checkout inputs for viewer/mint-queue
packaging and uses existing dependency directories through untracked local
symlinks, which are excluded from the source candidate. It does not install dependencies or alter frozen sources, outputs or
aliases. The tests explicitly load this worktree's local `packages/sdk/dist`.

Meaningful cases cover Ethereum/Sepolia identity, unsupported chains, varied
1–256 call measurements, variable bytes/gas, separate request/transaction/block
limits, complete cumulative-capacity fallback, exact dependent-call order,
insufficient approved infrastructure, no extra disclosure, unchanged large
content and strict envelopes, cheap envelope sums above the request budget,
stale/future capability facts, expiry during reused transports, provider recovery,
stale heads/reorgs, typed request-budget exhaustion, specific `-38026` capacity
fallback and terminal nonce/intrinsic/ambiguous client failures.

All provider responses and numeric capacity cases here are synthetic fixtures.
The reported fresh release's raw plan/error/deployed pair remained unavailable.
This evidence does not establish its actual gas, a live endpoint's capacity,
collector browser behavior for that release, a successful mint or deployment.
No supported state-preserving continuation has been established; incompatible
infrastructure fails honestly while preserving the complete program.

Qualification history is recorded in `qualification-history.md`. The positive
final build/test/startup logs are retained separately. No credentials, raw proxy
environment, absolute private checkout paths, archives or generated runtime
outputs are retained in this evidence directory.
