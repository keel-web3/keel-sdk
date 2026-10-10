# Simulator capacity recovery

The authorized Gatorrr incident evidence records a requested 200,000,000-gas envelope returned as 50,000,000 by `eth_simulateV1`. The guard correctly rejected that response. A subsequent operator process completed the same saved operation at a fresh block, with a 170,135,114-gas validated wallet budget and 141,779,261 pre-refund gas used. It did not publish or sign. The application retains a module-level WebSocket, so success from a separate process did not resolve its retained connection.

The pinned Sepolia transport now handles only this concrete response-integrity failure automatically. It performs at most three connection selections per request, using the existing `wss://ethereum-sepolia-rpc.publicnode.com` endpoint. A known program qualifies its required envelope with public empty calls, bounded by the observed chain policy; ordinary reads use the existing modest control. The exact project response must independently preserve every requested envelope. Small plans can still use providers whose lower cap accommodates their request.

On a confirmed clamp, the unchanged ephemeral simulation can be retried after public qualification and an exact numbered-block hash check. The request is copied before awaiting any I/O, preserving calldata, nonce, fee fields, gas, ordering and flags even if a caller mutates its input. No new provider, state override, signing, submission, new operation or storage payment is introduced. Concurrent readers share qualification; retired sockets close after their current readers finish. Replacement waits for that close, because viem otherwise returns its endpoint-cached socket again. Explicit close prevents a late result from returning as proof.

Missing/enlarged envelopes, wrong-chain or fork evidence, changed snapshots, genuine EVM reverts and symbolic snapshot tags cannot produce an automatic project replay. Exhausted capacity remains a `provider-limit` error with the observed gas cap and attempt count. A subsequent saved-plan read may try again. Full strict transaction validation, pre-refund measurement, selected-chain limits, canonical snapshot checks and byte-exact complete metadata verification remain mandatory.

A separate reproducible defect cached an initial `rpc-unavailable` qualification failure forever: later checks reused the rejected promise without trying a connection. Such failures and disconnected retained sockets now retire that selection and fail the current check. A new saved-plan check performs full qualification at the same endpoint. This does not replay an uncertain request or relax unsupported-evidence failures. The owner's separately observed viewer `rpc-unavailable` incident is not attributed to this defect without its runtime trace.

The owner's runtime trace confirmed that unknown RPC causes were discarded by the generic classifier. Diagnostics now retain an allowlisted method/phase, bounded numeric RPC code/HTTP status, known error class, transport-code category, cause depth and socket state before classification. Messages, stacks, URLs, params, response data and identities are never copied. The Studio initial-storage boundary emits one sanitized diagnostic event per failed check. This closes an observability gap; it does not identify the existing production failure's cause. The regression with a synthetic unknown RPC code fails on the previous classifier and passes here; cyclic causes and credential/artwork-shaped strings are covered.

`tests/fixtures/gatorrr-simulator-cap-20261009.json` records the supplied IDs and numeric evidence with provenance. Socket responses and short metadata used by tests are synthetic, not production artwork or proof of deployment. Coverage includes initial capacity rejection, retained low-cap connection then eligible replacement, three-attempt exhaustion and fresh retry, concurrency/close, request mutation, small plans and lower block limits, changed snapshot refusal, and full atomic preflight that still rejects wrong metadata, nonce, missing measurement or genuine execution failure.

Run after `node scripts/build.mjs`:

```sh
node --test tests/sdk-simulation-connection.test.mjs tests/sdk-publication-preflight.test.mjs tests/transaction-gas-policy.test.mjs tests/sdk-release-wallet-batch.test.mjs tests/rpc-publication-simulation.test.mjs
```

Point `KEEL_TEST_SIMULATION_CONNECTION_MODULE` at a built deployed d23fe3c `simulation-connection.js` and select `--test-name-pattern='retained low-cap connection'` to reproduce the former failure. The same test passes on this source.

The cloud's public-only live smoke check could not establish a WebSocket connection (qualification stage `connection`). No project calldata was sent. Operator validation still must use the candidate runtime's retained application process and the existing operation, with full simulation and unchanged paid storage. A passing public probe alone is not publication proof.
