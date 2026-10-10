# Stateful publication simulation capacity

The October 10 operator evidence establishes that the approved PublicNode
HTTPS endpoint retained only 50,000,000 of the requested 200,000,000 gas in
all three public qualification attempts. Private project data was not sent.
Changing WebSocket to HTTPS does not resolve that execution limit. This is
evidence about that endpoint, not all public nodes.

## Three separate limits

1. **Selected-chain transaction rules.** The timestamp and gas limit of the
   pinned canonical block determine the SDK's fork profile. On the observed
   Amsterdam Sepolia block, the total transaction ceiling was 200M, while
   the separate execution ceiling was 16,777,216. Strict native transaction
   validation must enforce both dimensions. An RPC setting cannot raise
   either chain limit.
2. **Gas requested by each call.** Studio currently gives every exact
   storage/release call the selected-chain ceiling during discovery. Thus
   the 200M qualification request comes from the discovery envelope; it is
   not the sum of eight object operations. Discovery measures pre-refund
   `maxUsedGas`, then the SDK derives its existing bounded gas envelopes and
   strictly replays them before any wallet approval. Atomic-wallet programs
   remain one indivisible transaction during validation.
3. **Gas consumed by the whole RPC request.** Geth's `--rpc.gascap` is shared
   across every simulated block in one `eth_simulateV1` request. After each
   transaction, Geth deducts consumed gas and caps subsequent requested
   envelopes to the remainder. A 200M request budget is therefore not
   enough merely because every individual transaction is at most 200M.

For requested envelopes `g[i]` and previously consumed gas `u[i]`, retaining
every envelope requires `C >= max_i(sum(u[j], j < i) + g[i])`. A conservative
bound known before execution is `C >= sum(g[i])` for the complete request.
Compute this for each complete SDK phase, including reader/observation calls,
and retain the largest bound. Do not substitute the quoted fee estimate or
the largest single transaction for this request-wide requirement. The
[Geth RPC documentation](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth)
and [pinned native implementation](https://github.com/ethereum/go-ethereum/blob/v1.17.8/internal/ethapi/simulate.go)
define this behavior. The native regression test demonstrates it directly.

## What the actual saved plan establishes

The authorized Retro measurement contains 85 chunks in 29 saved carrier
batches and eight object operations. Its storage prefix has 34–40 calls,
depending on supported operation grouping. Measured JSON-RPC lower bounds
are approximately 3.86 MB, before release proposal, observations, gas, fee
and nonce fields. This is not an exact failed wire-request capture.
The 425,679,780 executor gas figure is a quote, not measured execution.
At 200M per discovery call, even that prefix has a conservative envelope
sum of 6.8–8.0 billion gas; the final complete request may require more.

Separately, the authorized Gatorrr evidence records a whole atomic program
at 141,779,261 pre-refund gas and a 170,135,114 validated envelope. Its actual
atomic transaction cannot be made compatible with a 50M simulator by
splitting the simulation or merely lowering a discovery ceiling.

## Sequential simulation and the minimal correct path

The SDK already sends one planned transaction per simulated block, in one
stateful request pinned to a canonical block. This carries all intermediate
storage, code, balances and nonces within the native execution engine.
Splitting into independent requests restarts each from canonical state;
the returned simulated block hash is not a persisted continuation handle.
State overrides or mocked receipts would not satisfy the existing proof.
Replaying growing prefixes also retains the same final aggregate requirement.

Use the **maintained public RPC pool and capability-aware swap path**.
`createKeelPublicSepoliaSimulationPool` uses the existing `createKeelRpcPool`
through pinned candidate handles. Pacing, cooldowns, response bounds and
chain checks remain in that shared implementation. The ordinary read pool
must not silently swap providers underneath a simulation qualification.

The old Studio Sepolia branch ignored its supplied primary and the indexed
pool, selecting one singleton PublicNode WebSocket. Its three attempts only
reopened that host. The corrected factory resolves the selected `chains.rpcUrl`
for each new check and adds the maintained index's candidates. Normal RPC
environment configuration replaces defaults, so calling the ordinary Node
resolver with one `KEEL_RPC_URL` would not restore this pool. An explicit
`KEEL_PUBLICATION_SIMULATION_RPC_URL` remains a single-recipient override.
`KEEL_PUBLICATION_SIMULATION_RPC_URLS` supplies a replacement candidate list
through the existing resolver's one-to-six endpoint validation. Configure one
form, not both; candidate configuration is distinct from private-data approval.

For each candidate, qualify public chain/fork/header/fee/nonce/pre-refund
behavior before any private calldata. Require a fresh head (within 180 seconds,
at most 30 seconds ahead of server time), then recheck the exact selected block
hash. Transport cooldowns persist across reviews; Retry does not reset a 429.
Before **each** phase, execute a public empty-call sequence with every requested
gas envelope and the same block count. This catches sequence clamping that a
largest-call cache misses. These cheap calls do **not** establish the actual
project's aggregate execution requirement or full payload-size acceptance.
The exact discovery, strict bounded replay and complete reader/metadata replay
must still pass, with every returned transaction envelope unchanged.

After a provider capacity or transport failure, try each remaining eligible,
approved candidate at most once, replaying the complete unchanged request from
the same canonical block. Never split, continue from a simulated block hash,
lower gas, override state, or retry a contract/transaction-validation failure
to obtain success. A successful candidate stays selected. Cancellation stops
selection, and a fresh review can retry after provider recovery.
Invalid parameters (`-32602`), common `-32000` balance/nonce/intrinsic-gas
rejections and ambiguous simulation RPC rejections remain terminal. Only a
specific supported capability failure (missing method or observed provider
capacity) can make an RPC rejection eligible for another complete replay.
Provider messages remain sanitized; preserve numeric codes and fixed failure
categories rather than replacing validation evidence with an outage.

Public index membership does not authorize disclosure of unpublished calldata.
Studio retains PublicNode as the previously approved private-data recipient;
additional selected/indexed recipients require explicit operator configuration
in `KEEL_PUBLICATION_SIMULATION_APPROVED_RPC_URLS`. Public-only probes may find
compatible candidates first. An unapproved candidate receives no project calls.
No node provisioning or sync is part of this correction.

Run `node scripts/check-public-simulation-pool.mjs --public-only` to record the
indexed candidates' public qualification and a 40-empty-call sequence. Its
output explicitly distinguishes capability evidence from private execution or
publication proof. A network/proxy denial is not evidence of RPC incompatibility.
CI runs public network probes only when explicitly dispatched, not on each PR
update. Respect an observed rate limit before requesting another live probe.
The v2 probe report uses the production selector itself with no approved private
recipient. It records success only after both complete public sequences pass,
including fresh head, linked headers, status, nonce, fees, unchanged envelopes
and pre-refund evidence. It reports the observed empty-call gas separately from
the conservative envelope sum. Large body capacity and private execution
capacity remain explicitly untested even when this public qualification passes.

The completed [CI run 38023296914](https://github.com/keel-web3/keel-sdk/actions/runs/38023296914)
recorded the earlier v1 probe at `2026-10-10T04:14:41.294Z`. All three candidates
reported canonical block `0xb54e55`, hash
`0x27b176d311ee36a6f1f300a6f99772670579429fcce8a8d7e3883ed58560d013`,
and a 199,999,428 gas limit. PublicNode returned 50,000,000 for the requested
199,999,428 envelope and failed before project data. Tenderly entered the pool's
rate-limited state on the first two-call public probe. 1RPC failed the pinned
public-account `eth_getCode` read with `history-unavailable` before simulation.
None reached the 40-call check, so this run establishes neither aggregate
execution capacity nor large body capacity for any candidate. No new probes
were run to extract this evidence. The report artifact is `11659790245`, ZIP
SHA-256 `8ca7cf8cf669b9a42a232276a9f05d579b8650434c0e6c8a95504529052a7064`.

## Reproducible evidence and limits

Run `pnpm verify:publication-native`; see the
[fixture provenance and setup](../tests/fixtures/native-geth-publication/README.md).
The official pinned Geth image runs with Docker networking disabled. Five
unchanged 16M-envelope transactions write disjoint synthetic storage slots
and return successively 100, 200, 300, 400, 500. A 50M RPC budget exhausts
on the fifth. A 500M RPC budget succeeds at the identical synthetic block
and 200M chain ceiling. A 200M budget passes an empty-call envelope probe
but still fails the full SDK discovery program.

The runner also exercises the real SDK's discovery, strict bounded replay,
state-dependent standalone reader assertion and exact tokenURI replay. It
rejects wrong metadata, invalid fees, a configured limit above the selected
chain limit and provider-clamped envelopes. Separate-request nonce/hash
checks prove absence of an RPC continuation. Canonical storage, nonce and
block remain unchanged. Every request is checked to exclude overrides.

These are native engine/SDK tests with synthetic state. They do not exercise
the current production UI, browser wallet, either private release, canonical
receipt reconciliation, or a deployed collection. Earlier UI/service recovery
coverage remains separate. Neither affected release is proven published.

Operator evidence: `Keel-approved-HTTPS-capacity-and-request-bytes-20261010.json`,
Library ID `libfile_f5bab7b274ac8191ace5697f7bc34c1c`; Gatorrr authorized
regression: `tests/fixtures/gatorrr-simulator-cap-20261009.json`.
