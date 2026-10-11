# Captured original publication programs: local native gate

`scripts/verify-captured-publication-programs.mjs` is a separate gate beside the existing synthetic native Geth suite. It does not replace the shared SDK pool, the production release assembler, or live selected-provider acceptance. It consumes private captured evidence; it never fetches project state or sends a public RPC request.

All three original cases are mandatory exactly once: `retro-45`, `owned-14`, `paid-6-atomic`. Missing files, missing proofs, partial programs, different saved revisions, altered original calldata, malformed full URI, unproved state and failed native execution block the gate. The historical owned nine-call diagnostic is useful evidence but cannot become the fourteen-call fixture.

No actual-case success has been established merely by adding this runner. The associated unit tests exercise binding/proof validation with clearly synthetic test data. They are not three successful original publication executions.

## Commands

After building the SDK and installing the already reviewed pinned native Geth image:

```sh
node tests/sdk-captured-publication-fixture.test.mjs
node scripts/verify-captured-publication-programs.mjs \
  --manifest /private/keel-capture/manifest.json \
  --evidence /private/keel-capture/native-result.json
```

`--validate-only` checks private file commitments, identities, header and state proofs without launching Geth. Its result explicitly says `validationOnly:true`, `gateAccepted:false`; it must not be used as an acceptance command. Normal mode exits nonzero unless every required case qualifies. The runner never pulls an image, signs, mines, submits transactions or connects to an external provider. It copies canonical datadirs into its own temporary directory and removes only its own container/directory. Raw evidence is private, mode 0600; console output contains only scope and case statuses.

An already qualified extracted static Geth bundle is supported explicitly for **proof-reconstruction diagnostics** when Docker storage is unavailable:

```sh
node scripts/verify-captured-publication-programs.mjs \
  --manifest /private/keel-capture/manifest.json \
  --evidence /private/keel-capture/native-result.json \
  --runtime-directory /private/qualified-native-geth
```

The shared `scripts/lib/native-geth-runtime.mjs` binds the binary and helper SHA256 values to the pinned image receipt, starts a fresh network namespace with only loopback and no routes, independently inspects the running namespace, and uses a read-only filesystem IPC allowlist. It verifies isolation before any IPC request. It downloads nothing. This adapter rejects canonical-datadir mode because its reviewed IPC allowlist does not expose the administrative chain-configuration read used by canonical mode. Diagnostic reconstruction records its exact genesis digest/configuration; it does not substitute that for canonical state.

The small JSON schema is `scripts/fixtures/captured-publication-manifest.schema.json`. The executable validator in `scripts/lib/captured-publication-fixture.mjs` performs stronger semantic and cryptographic checks. Keep private files outside the checkout and never commit full creator inputs or URI bodies.

## Manifest and references

The top-level object has `schema:"keel-native-original-program-gate@1"`, the exact `gethImage` from the JSON schema, and `cases`. Each case contains:

```text
id: retro-45 | owned-14 | paid-6-atomic
capture:     { path, bytes, sha256 }
expectedURI: { path, bytes, sha256 }
rpcGasCap:   explicit local diagnostic/native RPC process budget
snapshot:
  mode: canonical-datadir | proof-reconstruction
  witness: { path, bytes, sha256 }
  datadir: { path, files: [{ path, bytes, sha256 }, ...] }  # canonical mode only
```

Paths are relative to the private manifest directory. Traversal, symlinks, omitted files, changed byte counts and SHA256 mismatch fail. A datadir may contain only its exactly inventoried `geth/chaindata/` regular files, including ancient files underneath that directory; no keystore/config files are copied. Source snapshots should already be consistent exports, never a live writable database.

`rpcGasCap` is a clearly recorded **local Geth process budget**, not a proposed transaction envelope and not claimed external provider capacity. It must be a positive safe integer no larger than the complete call count times the captured canonical block gas limit. It may exceed two billion aggregate gas for a many-block program; every original transaction/block gas envelope stays unchanged. When historical wire exists, that original request is replayed with unchanged call objects/gas. A source-only capture has no historical-wire replay; the SDK generates its current requests from the exact captured unallocated input. The SDK then runs its normal discovery, strict replay, reader and full metadata checks; the harness does not clip or replace transaction gas. No per-request state or block overrides are allowed.

## Capture object

Each bound capture JSON may use this explicit normalized form, or the deployed capture-only helper form described below:

```text
schema: keel-original-publication-capture@1
completeOriginalProgram: true
identity:
  artifactId, releaseId, releaseRevision
  # retain artifact revision, plan digest and original source receipt as evidence too
header:
  number, hash, stateRoot, timestamp, gasLimit, baseFeePerGas, miner, mixHash
headerRlp: complete exact canonical RLP header
wireRequest:
  method: eth_simulateV1
  params: [
    { blockStateCalls:[{calls:[exactOriginalCall]}, ...],
      validation: true|false, traceTransfers:false, returnFullTransactions:true },
    exactNumberedCanonicalBlockTag
  ]
exactSimulationInput:
  complete unallocated SDK KeelPublicationSimulationInput, including full expectedTokenURI
```

This is a normalization format for authorized captured evidence, not authority to invent missing fields. The Studio capture-only helper currently returns `exactSimulationInput` using one-key bigint wrappers: `{"$keelDiagnosticBigInt":"123"}`. The loader revives only that exact representation. Preserve it verbatim in the normalized input; do not convert gas/policy integers to floating point. The helper input alone is not a historical wire capture. The loader also accepts `keel-private-full-plan-diagnostic@1` directly, verifies the exact compact input SHA256, read-only capture flags, unchanged before/after canonical header, preparation and complete-call counts, and complete URI bytes/Keccak. It normalizes that input with `wireRequest:null`, `historicalWireAvailable:false` and `simulationPerformedByCapture:false`. A current SDK replay from this exact source input is possible once canonical state evidence exists; historical failure reproduction remains explicitly unestablished without the old request/response.

For actual Retro, this helper contains 45 preparation calls and 47 complete unallocated calls: the observation and complete metadata read are additional calls. Its 3025-byte expected URI is retained in full. Forty-five preparation calls must not be presented as the complete proof program. Obtain/retain the original complete wire request separately where available and bind its file SHA; do not label an allocated current replay as a recovered historical request.

When wire exists, the validator binds every preparation call field except the allocation-stage gas difference between the original wire and unallocated SDK input. Both gas values remain separately retained and unchanged. Required original transaction counts are 45, 14 and one atomic outer call respectively. The paid outer call is decoded as exactly six atomic external calls, bound to known original calldata Keccak and the full 655,134-byte tokenURI Keccak. The owned ninth call binds the actual original factory address and calldata Keccak. Replacing original contract/program bytes requires a separately reviewed migration design, not editing these original commitments.

The RLP hash must equal the captured canonical block hash, and its state root, number, gas limit, timestamp, base fee, beneficiary and randomness must match the supplied header. Merely repeating an operator-provided `stateRoot` beside an unrelated block hash is insufficient.

## Proof-backed witness

The witness is `{accounts:[...]}`. Each account uses the EIP-1186 fields with canonical hex quantities and code added:

```text
address: 20-byte address
nonce, balance: canonical hex quantities
code: exact runtime (0x is allowed only when its proof binds empty code)
codeHash, storageHash: bytes32
accountProof: RLP trie nodes from eth_getProof at the same captured block
storageProof: [{ key: 32-byte slot, value: canonical hex quantity, proof:[RLP trie nodes] }]
```

The validator authenticates account nonce/balance/storage root/code hash against the header state root, authenticates runtime bytes against code hash, and authenticates each slot against the account storage root. It handles proved absence and embedded trie nodes. It does not infer that an omitted slot or account is zero. Every address directly mentioned by original preparation, observation, reader and metadata calls needs a proof, including absent future collection addresses. Runtime dependencies and inner calls need proofs too.

Capture every account and slot read by the full program, not only obvious contract addresses. For owned creation this includes the factory, its deployer and creation carriers, Index, owner, executor, publication job/Hold, router/manager, future collection's actual prior balance/nonce/code, and registered shell/reader dependencies. The factory's creation collision uses nonce/code; prefunding also affects state-creation charging. The exact deployed runtime determines which storage slots matter. Never invent an empty collection balance or normalize it away.

Proof reconstruction also requires the protocol system-account addresses present in the existing pinned native fixture. Their code/state must come from the same canonical proofs; the runner does not insert fresh synthetic system state or add fake funding.

## State modes and current limits

**Canonical datadir mode** copies a preserved native Geth state database, opens it with pinned Geth under Docker `--network none`, verifies chain/fork configuration, checks exact canonical block hash/stateRoot/header, and checks every committed code/nonce/balance/slot through the native RPC before execution. The original numbered request is sent unchanged. The SDK's complete original preflight must pass, including exact full URI and original transaction count; the canonical base is rechecked after execution. This can qualify local regression. It still grants no live provider, wallet or canonical publication acceptance.

**Proof reconstruction mode** assembles a local genesis only from proved accounts/slots, retaining captured timestamp/gas/base fee/beneficiary/randomness and the reviewed fork schedule. It explicitly maps the canonical block number/hash to local genesis zero/hash and records that mapping. Original transaction objects are byte-equivalent; only the base block reference changes. `NUMBER`, `BLOCKHASH`, history and untraced access equivalence are not silently assumed.

The runner invokes native `prestateTracer` and `callTracer` for the exact first original transaction. For paid atomic publication this traces all six inner calls in the original outer transaction at base state. For sequential Retro/owned it covers only the first transaction: `debug_traceCall` cannot access state created by a preceding `eth_simulateV1` response. It records that limitation explicitly. Missing proved accounts/slots discovered by the tracer block immediately, including reads of unproved zero values. Raw trace failures are retained.

Reconstruction mode currently **cannot qualify the complete gate**, even if the native simulation succeeds. Full sequential and appended-reader prestate access coverage plus header-dependent equivalence still require supported instrumentation/state evidence. A first-call or standalone factory trace cannot establish those properties. It exits nonzero rather than presenting an incomplete witness as an actual-plan acceptance result. This limitation is deliberate and must remain visible until implemented and tested.

## Evidence produced

Private output includes source commit, image identity, captured request/file commitments, native fork configuration, canonical and local header identities, original wire response, every SDK-generated simulation request/response, complete return bytes, per-call requested gas / returned transaction gas / used gas / pre-refund maxUsedGas / status / raw error / returnData, and available inner/prestate trace. A raw empty revert remains empty; no cause is inferred solely from a gas ceiling. The output keeps transport failure, execution failure and unavailable evidence separate.

The three required original plans remain independently necessary. A fixed owned factory does not waive Retro transport diagnosis or the paid program's known external strict-capacity blocker. Standalone full-reader gas is separate from publication write gas.

## CI insertion after actual fixtures are available

Keep the existing synthetic native step in SDK Friend setup. Add this original-program gate after it using the approved private fixture channel. Add the same bound gate after SDK build and before Site image creation/retention. Do not expose private fixture data to public/fork workflows. Missing fixture data must fail the required private qualification rather than skip. Workflow files and package commands are intentionally unchanged in this implementation task while the original captures/state evidence are incomplete.
