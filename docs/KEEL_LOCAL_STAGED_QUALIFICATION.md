# Local staged publication qualification

The experimental local transport retains authenticated native state between the
original simulated blocks. Each SDK discovery, strict transaction check and full
metadata replay starts a fresh session from the same canonical base. An atomic
wallet transaction stays one native stage, including all of its inner calls.

This qualification uses synthetic state only. It does not activate a production
transport, publish a collection, sign, submit transactions, contact a provider or
qualify an actual project. The new module has no public barrel export or Studio
factory activation. Actual projects still require complete same-pin state and
history witnesses and all existing SDK acceptance checks.

## Reproduce in a cloud Linux environment

Use Node 22 or newer and the repository's pinned dependencies. First build the
[native engine](../scripts/native/canonical-state-engine/README.md) from its exact
archives and verified module cache. Its build receipt binds the maintained
source manifest and binary. Namespace isolation must be available: native
processes run under `unshare -Urn`, and their running binary, network namespace,
interfaces and absence of routes are verified before a command is sent.

```sh
node scripts/build-local-staged-fixtures.mjs \
  --native-build /absolute/verified-native-build \
  --module-cache /absolute/verified-go-module-cache \
  --build-cache /absolute/cloud-build-cache \
  --output /absolute/new-synthetic-fixture-directory

node scripts/verify-local-staged-publication.mjs \
  --native-build /absolute/verified-native-build \
  --fixtures /absolute/new-synthetic-fixture-directory \
  --output /absolute/new-qualification-directory
```

Both commands require new output directories and explicit paths. They do not
download dependencies or overwrite retained evidence. `--help` performs no
native execution. The fixture builder compiles the maintained `StateSequence`
and test-only `SyntheticAtomicExecutor` using pinned local solc, then invokes the
offline native exporter to regenerate the synthetic state root, header, account
proofs, storage proofs and exact code. The atomic fixture adds a synthetic
23-byte EIP-7702 delegation; it never substitutes a real owner's state.

The qualification entrypoint hashes every fixture, native build receipt,
source manifest, runtime source, SDK bundle and process client. It bundles the
new source adapter together with the unchanged publication validator, then
requires all SDK session controls and actual native process controls before
running the integration scenarios. Missing dependencies, unavailable namespace
isolation, omitted native inputs or a skipped prerequisite fail the command.
The optional actual factory proof import test in the separate native build is
reported by that build receipt; it is not a full project witness or acceptance.

## Required native integration scenarios

1. Forty-five stateful writes followed by a read and complete tokenURI check,
   including a fresh strict replay of the transaction sequence.
2. A separate synthetic workload with aggregate execution above 50M while each
   stage stays within a 50M stage budget. Original per-call gas envelopes are
   compared byte-for-byte with returned transaction envelopes.
3. Full metadata byte mismatch is rejected after actual native execution.
4. A deliberately lost committed-stage reply retries the exact cached command
   without executing the stage again.
5. A changed canonical pin discards a completed native result.
6. Cancellation discards partial state and confirms process exit.
7. A new session after cancellation starts from the original base and succeeds.
8. Six inner EIP-7702 calls run inside one outer transaction, with complete read
   and metadata verification. Atomic discovery and strict replay both validate
   transactions; neither splits the outer call.
9. A real inner-call revert causes SDK rejection of the atomic transaction.
10. A separate diagnostic sequence observes storage after that failed outer
    transaction **in the same session**. Prior inner writes are reverted while
    normal outer transaction nonce and gas semantics are preserved. This raw
    observation is not an accepted publication proof.

The receipt records requested and returned gas, execution/max-used gas, exact
program and response digests, stage/checkpoint bindings, full metadata digest,
strict flags, process isolation/exit evidence and explicit
`actualRetroAcceptance: false` / `actualPaidAcceptance: false`. Complete native
wire responses remain in the chosen private output directory. No actual creator
capture or private metadata belongs in this source tree.


## Explicit disposable Osaka profile

The optional `createKeelLocalTestChainGasProfile` API accepts trusted development/test configuration and observations from an HTTP loopback Anvil **1.8.5**, chain **31337**, **Osaka**, without a remote fork. Verify `eth_chainId`, `web3_clientVersion`, `anvil_nodeInfo`, and block zero through the maintained recipient. The factory checks the hardfork, chain, genesis identity, and matching reported block gas limits. Pass the resulting immutable profile explicitly to selected-block planning and funding simulation; there is no global registration or unknown-chain fallback. Copied/unverified profile objects are rejected. Production applications must reject local profile configuration before querying the node; Studio does this for its actual runtime mode, configured chain, matching server/wallet RPC and loopback app origin.

The profile uses a conservative total/execution envelope of 16,777,216 gas, capped by the actual block. The measured fixture has a 200,000,000 block limit; EOA estimates were 21,000 base, 21,320 for 32 zero bytes and 22,280 for 32 nonzero bytes (the 10/40 EIP7623 floor). Anvil's simulator **and transaction pool** accepted a gas limit of 16,777,217, so this fixture does not qualify public-chain fork-limit enforcement. SDK planning and simulation and Studio executor/approval boundaries enforce the narrower bound themselves. Keep all fixture receipts and synthetic pricing labeled separately from a project publication and real network qualification.
