# Complete-program simulation capacity

`createKeelPublicSimulationPool` takes the selected `chainId` alongside the
existing configured `rpcUrls`, explicit `approvedProjectRpcUrls`, selected block
and read transport. Ethereum (1) and Sepolia (11155111) have reviewed transaction
profiles. Other chains fail explicitly before networking. The legacy
`createKeelPublicSepoliaSimulationPool` retains its Sepolia contract.

Every candidate retains the full ordered program at the selected numbered block.
The pool checks a fresh head, chain identity, exact selected block, public
complete-sequence probes and unchanged project replay. It does not split a
dependent program, reuse a successful ephemeral prefix, change bytes, reduce
strict measured gas, increase a gas budget, sign or submit a transaction.

## Measured infrastructure facts

Optional `providerCapabilities` contains `KeelMeasuredSimulationProviderCapability`
records: `{ chainId, rpcUrl, measuredAt, limits }`. `measuredAt` is an actual UTC
ISO observation time, such as `2026-10-14T19:00:00.123Z`, not epoch seconds.
The URL must already be configured, and the chain must match. These records
cannot add a recipient or authorize disclosure to one.

`limits` may contain:

| Field | Type | Dimension |
| --- | --- | --- |
| `requestGasCap` | positive bounded `bigint` | Whole simulation request, across blocks |
| `transactionGasCap` | positive bounded `bigint` | Individual transaction |
| `blockGasCap` | positive bounded `bigint` | Individual simulated block |
| `maximumRequestBytes` | positive bounded `number` | Exact method/params JSON bytes |
| `maximumBlocks` | positive bounded `number` | Blocks in one simulation request |

These are measured provider capabilities, not content limits or protocol
overrides. No universal 50M RPC cap is assumed. Profiles are copied before any
await and expire after at most 300,000 milliseconds. `capabilityMaximumAgeMs`
may lower that bound, including zero. Future and noncanonical dates fail.
Expired facts are ignored at each phase; fresh public qualification and the
unchanged replay decide whether the provider now works. Observed capacity-cache
entries expire under the same bound.

Among already-approved configured candidates with current measured request caps,
the pool prefers more request headroom. Other candidates retain their slots.
An incompatible measured transaction/byte/block limit excludes that backend for
the current request, preserving the plan for approved fallback. Capacity facts
never grant a passing proof. A deterministic transaction-validation error or
contract revert still stops without searching for a backend that passes it.

## Measure the exact program

`measureKeelSimulationProgram` records actual call/block counts, calldata bytes,
exact method/params JSON bytes, the sum of requested envelopes, the largest
transaction envelope and the largest block-envelope sum. These are request
measurements, not execution measurements. There is no special 30-call threshold.

Geth maintains one RPC gas budget across all simulated blocks. It deducts
`gasUsed` after each call and limits a subsequent envelope to what remains.
Separate blocks do not reset that budget. Therefore an envelope sum exceeding a
request cap does not alone show that the program cannot fit. For an exact replay,
the budget must cover the greatest **previous gasUsed + current exact envelope**.
An analogous per-block measurement resets only the block usage counter.

`measureKeelSimulationExecution` derives those request/block requirements and
separate `gasUsed`/`maxUsedGas` totals only from a complete response with successful
calls, exact returned envelopes and bounded pre-refund measurements. It returns
no measurement for failed, clamped or incomplete output. These response metrics
remain distinct from publication proof: header linkage, exact returns, reader
identity, state commitments, fees, nonce and strict replay still have to verify.

`onMeasurement` receives frozen numeric/string records. `requested-envelopes`
records the input; `simulation-response` adds `candidateIndex`, `measuredGasUsed`,
`measuredMaxUsedGas`, `requiredRequestGas` and `requiredBlockGas`. It contains no
URL, private calldata, credentials or arbitrary provider text. Callback results
and exceptions cannot change proof behavior.

## Capacity exhaustion

A later returned envelope remainder is evidence about that sequence, not a
permanent per-transaction cap. It does not disable a different smaller program.
An explicit Geth request-budget exhaustion retains only typed bounded need and
remaining quantities. The remainder is never presented as the original cap.
The raw RPC boundary keeps this evidence without forwarding provider text.
Geth's `-38026` client-limit code permits fallback only with independently typed
request-capacity evidence or a body-limit response. An arbitrary `-38026`, and
transaction-validation codes such as `-38011` or `-38013`, remain terminal.

Fallback qualifies another explicitly approved configured provider and replays
the complete request unchanged. If no compatible validator is available, the
pool returns an actionable sanitized infrastructure failure. It preserves all
source/upload/write capacity, content, storage mode and strict gas envelopes.
Without an explicit authenticated native capability, no state-preserving
continuation is selected. The default remains the unchanged approved-provider
program or a refusal.

The current reported fresh release's raw plan, provider error and deployed pair
were unavailable during this work. All numerical regression cases are synthetic;
none reproduce or measure that release, verify a mint, or establish live provider
capacity.

References: [Geth RPC documentation](https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth-simulatev1)
the [Geth simulator implementation](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/simulate.go)
and [Geth error definitions](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/errors.go).


## Explicit authenticated local-session composition

`authenticatedLocalSession` is an optional reviewed capability on
`createKeelPublicSimulationPool`, containing `{ stateRoot, createClient,
witnessResolution, onSession? }`. It is restricted to Sepolia and the pool's
exact selected block number/hash and existing read transport. A caller must
supply both witness `prepare`/`resolve` callbacks and a reviewed native client;
there is no environment switch or automatic executable/download/recipient.

Only typed capacity exhaustion from an already-approved configured provider can
activate it. Unapproved providers, ambiguous client-limit errors, genuine
transaction/revert failures, metadata mismatch and cancellation cannot activate
native replay. Existing approved alternatives are attempted first. After the
first successful full native response, subsequent discovery/strict/full-return
phases start fresh native sessions from the same canonical pin. No successful
public prefix, simulated state, independent-block result or partial receipt is
carried into those new sessions. An atomic wallet outer call remains one stage.
The pool's original bounded deadline covers provider qualification plus native
replay; cancellation closes both resources. Existing SDK validators still check
the entire response, strict transaction bounds, exact returns and complete URI.

The capability is not enabled by Studio's current production factory or packaged
by the existing app image. Protocol fixtures qualify composition only. Actual
acceptance requires the hash-bound `keel-sparse` executable, network-isolated
process wrapper, a fresh exact original program/header and complete authenticated
state/code/ancestor witness. The maintained resolver and process wrapper are
`scripts/lib/native-witness-resolver.mjs` and
`scripts/lib/native-session-process.mjs`; the reproducible engine source/build is
`scripts/native/canonical-state-engine`. Neither a seed proof nor synthetic
responses qualify a creator's complete program. See
[the local-session boundary](KEEL_STATEFUL_PUBLICATION_SIMULATION.md) and the
`verify-local-staged-publication.mjs` / `verify-native-witness-resolution.mjs`
mechanism runners. No new provider approval is granted by this capability.


## Bounded latency and verified lower bounds

A fresh measured `requestGasCap` can exclude an impossible backend before public
sequence qualification or project disclosure: the SDK reads the exact numbered
header through the existing reader and computes the selected-fork transaction
and calldata intrinsic floor. It compares the sum of those actual minima to the
verified **whole-request** cap. It does not use requested-envelope sums or the
public probe's conservative21000 allocation, and it never converts a later
returned envelope remainder into a whole-request cap. Expired profiles and
transaction-only caps do not authorize this exclusion.

The120-second limit covers each pool request's provider qualification, original
RPC replay and any native fallback together. Each later SDK phase has its own
pool request; an uninstrumented108-second whole review does not reveal the
remaining budget in one request. If most of a request deadline was already used,
local verification can still time out and fail closed. This change does not grant
extra time, assume native witness collection is fast, or turn an unfinished
native run into success. Fresh already-approved provider capacity facts can avoid
wasting that bounded time on a mathematically impossible backend.
