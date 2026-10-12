# Publication witness seeds

`scripts/lib/fresh-publication-witness-seeds.mjs` exports
`deriveFreshRetroSeeds(capture, { witness?, captureBytes? })`. It is an offline
diagnostic for the complete source-assembled Retro-shaped 45-preparation /
47-call program. It requires the normal SDK ABI build and performs no network,
database, wallet or journal operations. It does not prepare an approval.

The input must be a complete capture from one numbered block, including its
full RLP-compatible header and the read evidence used by assembly. Its current
job ID, factory creator nonce and predicted collection must be derived again
when a new capture is assembled. Replacing an old capture's block tag does not
make an old job ID or predicted collection valid at a new block.

The builder checks exact matched public runtime hashes before applying these
layouts: PublicationJob `1f46225e…`, Hold `077e7511…`, factory `94e68d15…`, and
deployer `ee29fee5…`. It derives job mappings and arrays from the pinned
`nextJobId`, exact opening arrays and all subsequent job-ID calls. Hold slug
and object pointer slots follow the complete original payload and weld calls.
Factory prediction binds the actual configuration and creator nonce; when
deployer and creation-carrier bytes are present it independently recomputes
the CREATE2 address and checks the creation-code commitment.

A Hold nonce is usable for CREATE target derivation only after its account
proof authenticates against the captured header's state root. The emitted
target range is a conditional superset: existing slug/object reuse can avoid
creation, and none of those target accounts is presumed absent. Missing nonce,
runtime, descriptor, nested object, system-account or ancestor evidence remains
an explicit unresolved dependency. Changed runtimes fail rather than inheriting
an old layout. Every additional account and storage access must pass native
sparse-state witness validation.

The output binds the complete source-input digest, source fingerprint, parsed
capture digest, optional exact capture-byte digest, full header and requested
account/slot inventory. It is accepted by `validateCapturedStateSeed` in
`scripts/lib/captured-state-witness.mjs`; that collector separately enforces
freshness, canonical rechecks, fixed recipients and bounded read-only requests.
Neither a syntactically valid seed nor a complete initial seed response proves
the complete native program. The builder always reports `closure.complete:false`,
`currentFreshnessEstablished:false` and `approvalReady:false`.

The original collector retains its 64-account / 1,024-slot page bounds. A
proved Hold nonce can yield more than 64 conditional creation targets. Use the
explicit [complete-inventory workflow](KEEL_STATE_WITNESS_INVENTORY.md) to bind
and partition that whole inventory without dropping accounts. Its independent
merge revalidates every raw response and proof, rejects missing/duplicate pages,
and enforces one total time/byte budget. Complete inventory coverage remains
different from native access closure; the latter is not inferred from a seed.

Default tests generate synthetic headers, source inputs and account proofs.
`tests/fixtures/publication-witness-layout-runtimes.json` contains only public
contract bytecode. It contains no creator payload, URI, transaction, balance,
nonce, storage value or private capture. Tests do not present this code fixture
as a canonical or fresh chain read. The original private incident programs are
tested separately with explicit input paths and exact byte commitments.

The local process adapter is `scripts/lib/native-session-process.mjs`. Callers
must provide reviewed binary and immutable witness-file SHA256 values. It
checks the running binary again after launch, verifies a distinct network
namespace with only loopback and no routes, supports only session protocol
commands, and requires confirmed process exit within bounded cleanup. Native
controls in `scripts/native/native-session-process.test.mjs` require explicit
binary, input and synthetic-program paths; missing prerequisites fail the gate.
The normal deterministic suite tests pre-spawn guards without pretending a
native binary ran. See `KEEL_STATEFUL_PUBLICATION_SIMULATION.md` for the shared
SDK validation and state-continuity boundary.
