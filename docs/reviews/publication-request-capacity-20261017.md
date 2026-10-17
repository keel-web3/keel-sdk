# Publication request capacity repair

The production public simulation pool previously discarded explicit body-size
rejection text on HTTP 503 and retried the same complete oversized program as a
transient outage. A synthetic 45-call request of 1,057,498 serialized wire bytes
reproduced two identical attempts and `rpc-unavailable`. The corrected path
returns `provider-limit` with `gasCapacityScope: request-bytes` after one attempt.
These are synthetic boundaries, not a measured live provider limit.

Capacity classification requires a complete valid UTF-8 error envelope of at
most 16,384 bytes. Supported plain/HTML or JSON error descriptions must explicitly
reject the outgoing request body. Response-payload wording, negation, malformed
JSON, stale RPC IDs, reflected fields, truncated bodies, and oversized envelopes
do not establish that evidence. HTTP 200 JSON-RPC error envelopes obey the same
bound. Explicit contract and transaction-validation codes take precedence.

Public errors contain fixed messages and bounded diagnostic fields. Raw provider
messages and request bodies remain available only to the existing explicitly
private observer. Plain HTTP failures do not acquire a fabricated RPC code.

An explicit request-byte refusal does not retry the same recipient or establish
shared provider-outage cooldown. Fallback requires an already approved recipient,
fresh public qualification, the original pinned snapshot, and the complete exact
ordered program. No call, nonce, gas envelope or calldata is dropped, split or
replaced. Generic 503s, observed timeouts and resets retain bounded transient
recovery. Cancellation and fallback share the original whole-request deadline.

Validation:

```sh
pnpm --filter @keel/sdk build
node --test tests/rpc-failure-diagnostics.test.mjs tests/rpc-publication-simulation.test.mjs tests/sdk-rpc.test.mjs tests/sdk-publication-preflight.test.mjs tests/sdk-public-simulation-pool.test.mjs tests/sdk-provider-request-scheduler.test.mjs
```

Recorded focused result:200 passed, zero failed and zero skipped.

The suite includes 200 small-call success, the fixed 45-call byte boundary,
approved-only unchanged-program fallback, negative error bodies with and without
private capture, exact 16KiB detail bounds, cancellation and deadlines.

This repair does not establish a provider's exact byte cap or prove that a live
saved publication fits it. A real failing plan still requires its matching
private diagnostic, exact complete program, compatible approved capacity,
selected-chain regressions and website browser acceptance before release.
