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

The experimental `keel-ordinals` CLI accepts JSON evidence files. `vectors --check`
checks the frozen vectors. `recipe check` evaluates supplied reference bytes and
positions. `index compute` scans a testnet4 source selected by `source` (`rpc`,
`esplora`, `recursion`) using `KOC1_SOURCE_URL`, with at most two concurrent
requests. Specify `cacheDir` to cache verified raw blocks by hash. To replay the
exact captured range without any network calls, set `offline: true` and use the
same `cacheDir`, `from`, and `to`. Offline replay verifies blocks and links but
cannot establish the current best chain or detect a later reorganization. A
completed online scan checks the selected tip again before writing its range.

`index compute` requires candidate commit transactions and charms and reports
`verified: false`: caller-supplied references, controls and charms have not been
authenticated by the scanner. Missing candidate evidence aborts. `token verify`
checks the supplied index root, own mint form and position, preceding entries,
and depth but reports pending until the source, complete index, charms and burn
state are authenticated. `challenge verify` can prove an invalid recipient or
marker from a raw transaction and bound Merkle branch, and can check omissions,
coordinates and ordering; insufficient invalidity evidence remains pending.
Do not use these paths for publication or a verified collector verdict. The merged
K1-T01 core and this trust-sensitive layer both require independent review.

Position proofs require the complete raw block to authenticate transaction count,
position and the non-mutated Merkle tree; branch-only proofs are insufficient.
