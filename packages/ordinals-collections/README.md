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

Transaction builders (`tx`, `mint`, `escrow`) return `{ psbt, tx, prevouts,
paths, fee }`. `psbt` is an unsigned BIP174 v0 Buffer with BIP371 Taproot input
fields, suitable for a wallet; no function connects to a node. `txid` arguments
are internal-order hex, not RPC display txids. Amounts and explicit fees are
integer satoshis. Funding inputs currently support P2TR key paths only; supply
`{txid, vout, value, script, internalKey, root?}`. The caller authenticates those
UTXOs and selects fees, confirmed recipe, window and clean inscription funding.

Use `mintTemplate({recipe, viewer, minter, internalKey?})`, then
`buildCommit({template, inputs, value, changeScript, fee})`. After wallet signing,
pass the complete raw commit to `buildReveal({commit, template, payment,
recipientScript, postage?, price, fee, changeScript})`. `payment` is the escrow
policy with three writer keys, treasury key, CSV block delays and `earlyRefund`.
The reveal puts recipient, escrow payment and marker at outputs 0, 1 and 2;
change follows. Postage defaults to 330 sats. Payment is at least the recipe
price and the 330-sat P2TR dust threshold, including a zero-price recipe.

`buildCancel` uses the commit key path. `bumpRbf(plan, {fee, changeIndex})`
increases the absolute fee by reducing change and protects the commit output
or first three reveal outputs. Replacing a commit changes its txid: rebuild
and sign the reveal against the replacement. `buildCpfp` spends a chosen parent
P2TR output. Wallets must check current relay rates, replacement policy and
ancestor limits; these pure builders cannot guarantee mempool admission.

`buildEscrowSpend({payment, minter, leaf, utxo, outputScript, fee})` selects
`L_t`, `L_m` or `L_e`. Writer ordering matches the recipe, with empty witness
slots for absent writers. Treasury/early paths need exactly two writers plus
the treasury/buyer respectively. `L_e` has no timelock or expiry. Writer
membership/refund authorization remains a separate policy check.

`signTransaction(plan, privateKeys)` is a deterministic test signing/finalization
helper, returning raw transaction bytes. It intentionally leaves absent script
signatures empty so rejection tests can exercise consensus. Production wallets
should sign the PSBT under their own authorization policy.

Run `pnpm install --offline --ignore-workspace --ignore-scripts` in this package
and `pnpm test`. The tests require `/usr/local/bin/bitcoind`; they launch only a
private disconnected regtest with a temporary datadir, loopback RPC on an
allocated non-default port, and clean it up even when assertions fail. No ord
process or public-network RPC is used. The suite refuses to start with under
30 GiB free.
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

Writer-chain validation requires the matching recipe policy and authenticated
control history; it rejects updates when that policy is unavailable. Merge uses
that policy to classify members and refunds, counts distinct authorities listed
in the recipe, and leaves entries without a position pending. `challenge verify`
requires supplied mint history to assess eligibility, as well as full-block
position evidence; omitted paused, late and over-cap entries are accepted as
refund candidates, while before-open reveals remain excluded. These caller-supplied histories still require authentication.

Fee helpers derive mint protection from transaction evidence, including the
recipe ID committed in the envelope and its matching marker. `bumpRbf` recomputes
the current fee from the UTXOs and permits only change after output 2 on a KOC1
reveal; every matching escrow/marker script is protected. Missing, moved or
mismatched markers on inscription spends are refused. `protectedOutputs` in a
returned plan is informational, and dropping it during an unsigned PSBT round
trip does not weaken these checks. Output 0 also stays protected for commits.

`buildCpfp` excludes output 0 for every parent and outputs 0–2 for KOC1 parents,
including stripped parents. `anchorVout`, when supplied, must equal the selected
change/anchor index and cannot override protected outputs. Inputs must still be
known clean funding; these pure helpers do not scan arbitrary Bitcoin history
for unrelated inscriptions or ordinal pointers. Unclassified inscription
transactions are refused rather than assigned a guessed KOC1 change layout.

For `L_t` and `L_e`, the signing helper recognizes the exact 2-of-3 tapscript
suffix and uses the first two available writer keys in script order, independent
of private-key argument order. The third slot stays empty even when all keys are
available. Missing keys still produce empty slots for negative consensus tests.
The regtest matrix also has Core's descriptor wallet sign and finalize an
unsigned builder PSBT via `walletprocesspsbt`/`finalizepsbt`, then broadcasts it.

The browser-only `shell` subpath adds the recursion-backed S1–S9 core, with
`member` / `not member` / `settling` / `invalid` verdicts. It shares the K1
algorithms and has no Node runtime dependencies. See [the shell API and scope](src/shell/README.md).
