# Recorded strict validation rejection

The authorized operator bundle `libfile_53db8d71a0008191bb4ef29523703274`
records live Sepolia PublicNode execution by deployed SDK `d4c5b2a` and Site
`4c970d4`. It contains an optional shell migration proposal: ten casts, five
welds and one keeper registration, preserving all five object commitments and
488,274 bytes. Discovery succeeded for all sixteen calls with exact reflected
envelopes, fork headers and five required weld IDs. Fee-bearing strict
validation returned `-38013`, `intrinsic gas too low`. There is no complete
storage-only proof, collector proof, approved quote or transaction receipt.

## Established SDK defect

The raw transport preserves the RPC code and message, but does not add the
RPC pool's `simulationFailure` marker. The classifier consequently called this
`rpc-unavailable`, suggesting an outage retry. Geth explicitly assigns
`-38013` to intrinsic transaction validation in its
[RPC error mapping](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/errors.go).
Both bare/nested codes and the recognized message now produce the existing
terminal `configuration-invalid` category with bounded
`transactionValidation: intrinsic-gas` diagnostics. The message does not
assert the saved plan is wrong or name a failing call. Unknown errors remain
unknown. No gas, nonce, fee, calldata, snapshot, provider or validation rule
changes; the exact complete strict proof remains mandatory.

This category already blocks automatic connection replacement and candidate
rotation. Studio's storage preflight also treats it as non-retryable. An
operator can investigate and start a new reviewed check; this error alone
cannot authorize a different transport, altered program or approval.

## What the recorded provider answers prove

At block `0xb56643`, hash
`0x6e8e576e66330f1c36cd3e14d381386e15ede79211de5043e6b412e4cd6cafc4`,
the five-call strict request fails. The six-call strict request contains the
identical first five envelopes and pinned block, and returns all six successful
calls with unchanged sender, target, calldata, value, gas, nonce and fees.
Its linked Amsterdam headers pass the SDK assertions. Four calls also pass;
seven fail. A faulty fifth call is therefore not established.

The 69,284-byte cast envelope is 113,148,677 gas. For this zero-value external
call the configured Amsterdam floor is `12000 + 3000 + 64 * 69284 = 4449176`.
Every recorded successful-prefix input is above its floor and within the
selected total cap. The [64/64 floor](https://eips.ethereum.org/EIPS/eip-7976)
uses the [decomposed intrinsic base](https://eips.ethereum.org/EIPS/eip-2780);
the older 40-gas nonzero-byte floor must not be substituted. This does not
weaken strict execution-dimension or state-gas validation.

One possible implementation mechanism is visible in
[Geth's simulator](https://github.com/ethereum/go-ethereum/blob/master/internal/ethapi/simulate.go):
`sanitizeCall` can cap gas to a cross-block RPC budget before transaction
validation; a top-level validation error can then omit reflected envelopes.
This explains why an error alone cannot prove the caller supplied too little
gas. It does **not** identify the operator's backend/version, prove this
mechanism caused the incident, or reconcile the inconsistent prefix answers.
Do not retry or route around this rejection based on that hypothesis.

## Reproduction and coverage

The compressed public fixture contains the original SDK input, its final five
RPC exchanges and the complete four/five/six/seven-call isolation records.
Repeated public hex strings are losslessly deduplicated by SHA-256; the test
authenticates and restores them before comparing every SDK request exactly.
No fake successful sixteen-call validation response is added.

After the maintained SDK build:

```sh
node --test tests/sdk-intrinsic-validation-evidence.test.mjs
```

The recorded replay reaches the original strict failure, now terminal, without
an extra simulation or metadata read. Additional regressions verify raw/nested/
sanitized error parity and privacy; nonce-negative qualification still rejects
intrinsic errors; a qualified connection is not replaced or retried; a second
candidate receives no project request. SDK TypeScript and 129 focused SDK,
transport, capacity, routing and preflight tests pass. The fixture is an
offline replay of real observations, not fresh live provider qualification.

Cloud access to the approved PublicNode endpoint still fails at the CONNECT
proxy with HTTP 403 before JSON-RPC. The operator has demonstrated live access.
The next diagnostic needs exact repeated full strict requests on a retained
approved connection, with response envelope/header evidence and backend
identity where available. Keep every failure alongside successes; a prefix
success or one unqualified full result must not become a funding proof.

The registered-shell visual gate is a separate Site regression. Removing that
gate preserves existing presentation; this simulation proposal alone does
not establish a need to upload new shell bytes or replace a contract. No
wallet signature, transaction, provider addition or private-data permission
is introduced here.
