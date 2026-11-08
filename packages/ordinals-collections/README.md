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
checks the frozen vectors. `recipe check` evaluates supplied reference bytes.
`index compute` scans a testnet4 source selected by `source` (`rpc`, `esplora`,
`recursion`) using `KOC1_SOURCE_URL`, from the recipe opening height or earlier
through `to`. It requires candidate commit transactions and charms and reports
`verified: false`: caller-supplied references, controls and charms have not been
authenticated by the scanner. Missing candidate evidence aborts. It does not yet
establish completeness of authority children or discover all recipe dependencies.
`token verify` reports pending, and `challenge verify` cannot yet establish invalid
challenges from independent evidence. Do not use this CLI for publication or a
verified collector verdict. The merged K1-T01 core and this trust-sensitive layer
both require independent review.
