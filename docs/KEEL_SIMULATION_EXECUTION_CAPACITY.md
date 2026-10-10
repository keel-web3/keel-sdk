# Stateful publication simulation capacity

The October 10 operator evidence establishes that the approved PublicNode
HTTPS endpoint retained only 50,000,000 of the requested 200,000,000 gas in
all three public qualification attempts. Private project data was not sent.
Changing WebSocket to HTTPS does not resolve that execution limit.

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

Use an **owned, synced, fork-compatible Sepolia execution node** for the
unchanged complete requests. Studio already supports
`KEEL_PUBLICATION_SIMULATION_RPC_URL`, validates its chain and exact pinned
block hash, and passes results through the same SDK proof gates. This route
does not require changing transaction grouping, reducing actual gas,
weakening the proof, or duplicating paid storage.

Before enabling that existing setting:

- Confirm an owned canonical Sepolia execution node and its consensus/sync
  infrastructure exist. The checked Studio runtime/Compose definitions
  contain the app, Postgres and an RPC proxy, not Geth or Reth. Host-level
  inventory outside those definitions remains an operator check.
- Use a client version that implements the selected fork and reports full
  transaction envelopes, linked block headers/BAL evidence, and pre-refund
  `maxUsedGas`. Native Geth v1.17.8 passes the synthetic SDK regression.
  This does not prove any currently hosted node is suitable or synced.
- Set a finite RPC request budget covering the complete admitted program
  as above. Set the HTTP body limit from actual final serialized requests
  with room for the envelope, and a bounded execution timeout verified with
  that program. The existing runtime RPC proxy has a 512 KiB body limit
  and does not allow `eth_simulateV1`; use the dedicated server-side route.
- Keep the node private to the server, bound concurrency and resource use,
  and keep signing/submission outside the simulation interface. Approve any
  new hosting expenditure or private-data recipient before provisioning or
  transmission. No additional third-party provider is part of this design.
- Qualify the exact selected block and full workload. A successful 200M
  empty call is necessary for that discovery envelope but insufficient for
  aggregate capacity. Run all three existing phases and recheck canonical
  block/revision identity. Errors leave the prepared plan recoverable and
  must never produce an approval proof.

If no owned synced node exists, provisioning and syncing one is the remaining
infrastructure dependency. A local dev chain or a fork tool with altered
limits cannot replace canonical-state validation. Do not send the private
plan to another provider as an automatic fallback.

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

The optional `KEEL_NATIVE_FORK_COMPARISON=1` test also runs official Anvil
v1.8.5 against the local synthetic Geth fork with zero generated accounts,
mining disabled, and no block/gas overrides. It reproduces that release's
hard-coded 50M `SIMULATE_GAS_CAP`: the original fork hash and 200M block limit
remain intact, but a 200M request envelope is reduced to 50M and the SDK
rejects the full plan. See the [pinned source](https://github.com/foundry-rs/foundry/blob/v1.8.5/crates/anvil/src/eth/backend/mem/mod.rs).
Amsterdam support alone does not qualify this stock fork executor. A modified
executor would need maintained capacity controls and additional canonical-state
and native execution conformance before being considered a production option.

## Prepared owned-node adapter

`@keel/sdk/owned-simulation-transport` provides the opt-in Geth v1.17.8 profile.
It snapshots the caller's configuration and requests, computes exact fixed-ID
JSON-RPC wire bytes, and admits each entire program against a finite configured
gas/body budget. The gas sum is conservative; no quote is treated as execution
evidence. `node scripts/size-publication-simulation.mjs <local-file>` reports
the same metrics offline for up to three exact SDK request phases, without
printing or transmitting their contents.

Before project execution it requires canonical Sepolia genesis, a reviewed
client build, completed sync, a fresh head and the independently selected block.
Existing strict public behavior qualification and complete SDK proof remain
mandatory. It has no fallback recipient, disallows redirects, bounds response
allocation, allows only read/simulation methods, and limits active simulations
per endpoint per process. The Studio owned-mode configuration requires its URL
and both explicit capacity settings; partial settings fail closed. The inert
deployment template lives in `keel-site/apps/studio/ops/owned-simulator`.

Operator evidence: `Keel-approved-HTTPS-capacity-and-request-bytes-20261010.json`,
Library ID `libfile_f5bab7b274ac8191ace5697f7bc34c1c`; Gatorrr authorized
regression: `tests/fixtures/gatorrr-simulator-cap-20261009.json`.
