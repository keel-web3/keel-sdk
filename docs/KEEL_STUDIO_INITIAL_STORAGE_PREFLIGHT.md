# Initial storage compatibility review

The candidate first-storage gate runs at Studio's existing managed-publication
approval boundary. Browser review, hosted `keel_storage_review`, and portable
`keel-studio-draft` with `operation: "storage-review"` use the same owner-scoped
service. The agent supplies a project ID, never a private key or a caller-provided
"verified" flag. `drafts:write` is required because preparing the deterministic
job can save its unsigned plan. The tool returns the existing Studio review URL.

Finish and confirm the shared release plan before requesting funding review.
For an explicitly storage-only project, persist `mode: "art-only"` with the
selected chain. Its proof covers the exact manifest/object creation and funding
calls; it explicitly does not claim collector metadata readiness. Missing or
ambiguous intent is a question to resolve, not permission to invent a release.

## What is checked

The service prepares the exact future storage object IDs and collection calls
without creating a publish operation. It checks source commitments, active draft
and artifact revisions, access requirements, the configured contracts, full
metadata bytes and the exact funding calldata/value. It uses a pinned chain block
and `eth_simulateV1` without state, code, balance or block-limit overrides.

A preliminary zero-fee public-call pass measures pre-refund `maxUsedGas` for each
exact proposed transaction without overriding balances or submitting anything.
Providers that omit this evidence are unsupported. Refunded `gasUsed` cannot
substitute for the amount needed to execute. The shared five-percent margin,
bounded by the selected transaction cap, becomes the validated gas limit.
The next simulation validates those bounded transactions, including explicit fee
envelopes derived from the pinned block and shared executor policy.
Geth zero-fee defaults are never relied on for transaction validation. A separate
replay uses public-call semantics, an ephemeral mint context and the future
collection's `tokenURI(1)` to compare the entire ABI return byte for byte. The
ephemeral mint is never included in the owner transaction list and never creates
a token onchain. It verifies metadata, not a buyer's future eligibility or payment.
Read gas and transaction gas are separate limits. The block hash and current
saved revisions are rechecked before evidence is returned.

Evidence expires after two minutes and binds the project revision, manifest,
release configuration, selected chain, reader code, ordered calls and funding
value. The managed journal persists each exact executor call's validated gas limit
alongside its anchored batch grouping. Resume keeps those limits, and an estimate
that exceeds them blocks before sending. The owner funding call also uses its
validated gas limit; a changed bound returns to cost review. The wallet action requests fresh preparation and checks it against the
owner's last cost review. A changed fingerprint returns to review. Missing,
expired, mismatched or failed evidence cannot open a new funding request.

An already submitted approval or funded job follows its existing receipt/cursor
recovery path. It must not be funded again to obtain a newer preflight record.

## Recovery and alternatives

Retain the returned safe diagnostic kind. An unsupported RPC simulation, provider
cap or outage is unverified evidence; it is not proof of oversized artwork. A
contract revert and a byte-integrity mismatch need their actual cause resolved.
An insufficient-balance result is a funding requirement, not a size diagnosis.
Do not transform these errors into a successful check or silently change delivery.

For a measured Inline incompatibility, review an explicitly selected supported
Hybrid route using the same stored artwork. Hybrid still requires its exact
metadata simulation and its documented viewer/network dependency. IPFS is only an
option when a supported pinning/CID workflow is actually available. Never silently
pin, republish or charge for another stored copy.

For already stored releases, use `keel_release_diagnose` or portable draft
`diagnose`; preserve project/release IDs and all confirmed receipts. An owner or
their granted agent can retry permitted read checks and revise the shared draft.
Escalate only a genuinely unavailable capability or code defect, with its safe
diagnostic, rather than defaulting to a central administrator.

## Candidate limits and verification

This source is not a deployment or a claim that the incident release recovered.
The implemented simulation adapter targets new collections on Ethereum/Sepolia,
with Inline, Hybrid or explicitly storage-only intent. Existing/custom collection
metadata profiles, multiple active release selection, durable simulation caching,
and full provider integration remain unfinished. Unknown profiles block before
new funding. A first-token result is not a proof of every generative or reactive
future token state.

Focused tests execute the production release assembler, funding boundary and
wallet action with mocked RPC/database dependencies. Local Solidity tests execute
the committed Raw reader and KEEL721 against synthetic data. A real local RPC regression exercises a low-balance
account and storage-clear refunds: full-cap fee reservation fails, while bounded
pre-refund gas succeeds without changing the chain, nonce or stored state. Full repository
build/typecheck, real database transactions, browser accessibility and a live
configured-provider run remain required before release. Do not replace them with
the focused tests or with the planning API's confirmation flag.

Simulation semantics: https://geth.ethereum.org/docs/interacting-with-geth/rpc/ns-eth#eth-simulate-v1


## Exact standalone-reader parity and endpoint ceilings

The pre-payment public replay also executes the same fragment-validity and exact
standalone builder envelope that Forge will require after storage. A dynamic
collection envelope can differ from that standalone envelope, so a passing
collection tokenURI alone cannot stand in for this check. Both ABI results must
match exactly; the standalone read also retains Forge's collection gas margin.
The margin is reserved inside the actual execution allowance, including after an
explicit provider-cap reduction. Low reported consumption alone is insufficient
because nested EIP-150 forwarding can require more initial gas than it consumes.
The final collection call is one complete EVM execution: its gas budget includes
all nested reader, descriptor and carrier calls, rather than a separate allowance
for each nested call.

`keel-inline-read-policy@1` binds the inherited KEEL product ceilings of 60,000,000
read gas and 2,000,000 UTF-8 tokenURI bytes. These are not independently verified
RPC-provider capacities. The actual selected block and a lower configured read
budget remain authoritative; full ABI output adds its 64-byte header and rounded
32-byte payload padding, and JSON-RPC hex/transport overhead is separate. Exact
ABI bytes and digest are retained in the report as size/hash evidence, not stored
as another artwork object.

An explicitly reported smaller positive provider gas ceiling permits a bounded
retry of the same ephemeral replay at that smaller read request limit. It never
raises a ceiling, overrides chain state, modifies validated transaction gas,
changes payload bytes or selects another delivery mode. Reverts, OOG, ambiguous
provider failures and unknown response limits never become passing evidence.
Reports retain requested/effective limits, explicit-cap retry attempts, selected
block/runtime identity, per-reader calldata/return hashes, ABI lengths and gas.
The funding journal retains that report for audit; it never authorizes skipping a
fresh unsigned-funding check. Original report and paid-object receipts survive
concurrent or resumed paid-job requests.

Hosted and portable MCP storage-review tools use this same authoritative server
boundary. Generic `publish-plan`, `ethereum-encode` and `wallet-request-prepare`
remain unsigned review descriptors, not live simulation or permission to submit.
This guarantee does not intercept unrelated raw-wallet tools or third-party
publishers. This patch is prevention and evidence retention, not a historical
root-cause finding or proof that an already paid release recovered.
