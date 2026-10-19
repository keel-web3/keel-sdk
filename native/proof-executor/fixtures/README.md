# Canonical beacon-root witness closure

`sepolia-beacon-deletion-20261019.json` contains only public Ethereum Sepolia
chain data from canonical block 11948749
(`0xba9aff4bb893ca2894304cb807e5e45d324f1033998dcc8fdf0d6dfe8de6ed45`).
It preserves the canonical header fields and two original EIP-1186 responses
from the existing approved EthPandaOps reader. No creator source, publication
program, credentials, or state override is included. The original full failed
program remains private and is not replaced by this fixture.

Deleting nonzero beacon-root slot 16278 (`0x3f96`) collapses a trie branch. Its
storage proof authenticates the sibling hash but omits the sibling's encoded
node, which Geth needs to perform that collapse. The original failure was
missing node `0x9ae713275b38c0a22280058ec62e7fdc3f2380524a2698be533c3f5a270948be`,
owner `0x37d65eaa92c6bc4c13a5ec45527f0c18ea8932588728769ec7aecfe6d9f32e42`,
nibble path `06 05 00 06 0a`. A proof for slot 1836 (`0x72c`) at the exact same
canonical block supplies that exact node. Both account/storage proofs and the
account's canonical `BeaconRootsCode` hash are verified by the tests.

The completion hook lives below Geth's real `StateTrie`, at its `NodeReader`
boundary. It retrieves the missing node before the original trie operation
receives an error. It never replays an EVM call, retries a state mutation,
resets StateDB, changes calldata, supplies replacement code, or changes gas
accounting. The original account/storage root remains the proof authority even
when the live trie has already accumulated in-memory writes. Finite preimage
matching is only a lookup aid: the canonical EIP-4788 domain contains 8191
timestamp slots and 8191 root slots; a missing path may match at most 8 keys,
and a request may attempt at most 32 additional proofs, including failures.
Existing cumulative wire read/response/wall and witness byte limits still
apply. Unknown owners/code/path/domain, repeated nodes and no progress fail
closed. A provider denial or timeout is retained and issues no further read.

Reproduce offline with the pinned upstream Geth checkout prepared by
`scripts/build-proof-executor.mjs` (Geth commit
`a579077007b98217c3e253a66e4b452ca0c32b96`, Go 1.25.8), copying this SDK's
existing overlay files into that isolated checkout:

```sh
KEEL_PUBLIC_PROOF_FIXTURE=/absolute/sdk/tests/fixtures/sepolia-public-proof-20261010.json \
GOTOOLCHAIN=go1.25.8 go test -count=1 -race -v ./internal/keelfork
```

`TestActualBeaconDeletionBaselineAndAuthenticatedClosure` first reproduces the
exact original missing hash/owner/path on the original unwrapped Geth database.
It then compares the completed deletion with a separate genuine Geth StateDB
preloaded with both fully verified original proofs. The resulting state root,
deleted value, untouched sibling and copied trie must agree, with exactly one
additional proof. Other tests cover wrong owner/code/root/path/slot/value/hash,
invalid proof, candidate/proof/witness exhaustion, cancellation, deadline,
401/403, repeated hash cycles, and non-missing/database-error passthrough.
Existing fixture assertions are unchanged.

These are offline witness/deletion tests. They do not establish a complete live
publication, EVM gas/output differential, wallet handoff, deployed identity, or
historical browser rendering. Those remain separate fresh qualification gates
for the exact reviewed source and artifact.
