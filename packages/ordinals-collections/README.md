# KOC1 collection core

Pure, synchronous functions for the frozen `koc1@1` testnet4 rules. Import the
package root or the `tx`, `envelope`, `mint`, `escrow`, `end`, `controls`,
`merkle`, or `perm` subpaths. Node 22.18 or later is required for native
TypeScript stripping. The core was adapted from the frozen K0 executable model;
fixtures are tested against the library independently of the model checker.

`formCheck` authenticates the commit output and checks canonical mint form;
`recipeCheck` checks the recipe and supplied reference bytes. `indexState`
computes membership, refunds, controls and roots from supplied candidates and
heights. Callers must obtain and authenticate chain position, charms, reference
availability, confirmation and best-chain data separately: these functions do
not access a network or establish Bitcoin consensus admission. Synthetic vector
signatures are not consensus validation. Hashes and transaction IDs in the core
are internal-order hex as specified in KOC1 D1. `parseOrdEnvelopes` returns raw
push payloads and ord offsets; canonical KOC1 constraints are stricter and are
applied by `formCheck`.

`verifyPosition` in the `challenge` subpath requires `proof.rawBlock`, the full
raw block hex for the header. It authenticates the header against the supplied
host hash, recomputes the complete non-mutated transaction Merkle tree, binds
`total` and transaction position to that block, and verifies the branch. It
fails closed on any 64-byte stripped transaction because of the leaf/internal
node ambiguity. The caller must independently establish host best-chain and
consensus admission. Branch-only evidence does not establish the count.
