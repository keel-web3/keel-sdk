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
