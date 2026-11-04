# Wallet and inscriber references

Read-only survey, 2026-11-04. These are design inputs, not tested implementations.

## Wallets and authentication

The contract audit `docs/ordinals-plan/wallet-audit-2026-11-03.md` reviews Ravonus/terminus branch `development_new` and fun-art. Extract the fun-art adapters and PSBT review as S4 directs. Keep separate ordinals and payment roles, including an explicit shared-address case. Use a server nonce and strict BIP-322 proof of both roles. Reject Terminus's fixed-message login and payment-only proof: the audit identifies replay and unproven ordinals addresses in `src/utilities/handleSign.ts` and `src/app/(payload)/api/terminus/verifyAddress/route.ts`. Treat its connector list and per-script branching as references, not safe transaction code. Per-input signing, explicit sighash and post-sign byte verification are required; its audited whole-PSBT signing and missing return comparison do not meet those requirements. Classify payment outputs using our reader; size thresholds are not protection.

## Terminus and TerminusMaximus

- [Ravonus/terminus](https://github.com/Ravonus/terminus), main `0fe52f2f621383e7708a450aec3969c290593caf`: `src/app/(frontend)/inscribe/types.ts` defines separate recursion, wallet and metadata options. Keep these as distinct concepts; the settings type does not establish working inscription or metadata semantics. Audit findings above concern a different branch and are not asserted to describe this main revision.
- [Term-Ord/TerminusMaximus](https://github.com/Term-Ord/TerminusMaximus), main `e05939d7caa1fd2788af5fb5a9869554d322888a`: `scripts/inscribe-build.js` explicitly chunks buffers and includes CBOR metadata encoding. Use these as questions for envelope and metadata test vectors, not as a proven compatible encoder. `sdk/src/inscribe/Envelope.ts` instead pushes the whole body while its comment claims automatic chunking; do not rely on that claim. `sdk/src/recursion/RecursionResolver.ts` resolves remote IDs through an indexer and local paths through a reader. This is useful lookup context, but is not the required typed parent/child version selection, failure handling, or canonical verification shell. Keep the roadmap's existing recursion reader and shell.

## Lifo and TheWizardsOfOrd

The account `lifofifo` exposes only a Moby fork; the relevant public account is [lifofifoX](https://github.com/lifofifoX). Its [micro-ordinals](https://github.com/lifofifoX/micro-ordinals) fork is at `24d495ab4632231dd4db7b093b8b3682f5f255b3`. `src/index.ts` splits pushes into chunks, maps metadata to CBOR and parses inscription tags; `src/cbor.ts` implements CBOR. Use these as test-vector references for chunk boundaries and metadata, not as proof that its output matches KEEL's envelope. `src/cli.ts` builds a reveal with `p2tr_ord_reveal`, signs with a private key and says batch inscriptions are unsupported. Reject its local private-key signing and single-inscription CLI as the Studio wallet flow; retain explicit review and wallet signing.

Its [scure-btc-signer](https://github.com/lifofifoX/scure-btc-signer) fork is at `fd75aef5e19ea0a174d23bbe683970b3dc41b768`. `src/psbt.ts` defines unsigned transaction, per-input sighash and tapleaf fields and validates tapleaf versions. Use its PSBT field handling as a comparison for tests; these definitions alone do not establish post-sign transaction integrity or wallet authorization. Keep the audited fun-art review and exact returned-byte checks.

[TheWizardsOfOrd/Elements](https://github.com/TheWizardsOfOrd/Elements) at `8462c9ab37a70cc9bc8b8c7b622eba7ed569e8bf`, `boilerplate/threejs/standalone/inscription.html`, imports Three.js from a fixed `/content/` inscription. This is an example of content recursion, not version selection or file verification. Keep KEEL's typed parent/child reader, fallback and canonical shell. The organization also has `ord` and `ford` repositories; no public node or ord client is needed for this route. `lifofifoX/TheWizardsOfOrd` returned HTTP 404; the organization is separate.

## Older machine

Read-only inspection on yuna-mbp found `~/Documents/CoolS` at Git HEAD `0a6a39856ef016ead6838eb85073ab8ae9b1983d`, with a dirty worktree; HEAD alone does not identify its current source bytes. `src/tooling/chainTui.ts` imports transaction selection and inscription tooling, and `src/tooling/inscribeBuild.ts` uses bitcoinjs PSBTs, wallet-store resolution, and an inscription-output check with an explicit unknown result. Preserve the fail-closed distinction between unknown and safe, but do not copy the wallet store, TUI or transaction builder without a full safety audit. The older code is unfinished and was not executed. `~/Documents/wildflower` was present but did not identify a Git revision; the specifically requested older wildflower/terminus TUI identity remains unconfirmed.

Current dirty-source SHA-256: `src/tooling/chainTui.ts` = `02caeb1895300ec0e3aadf78af20de836e43b27f797b59d51b97fc9075cf09f9`; `src/tooling/inscribeBuild.ts` = `2bfd3e7d40d700e20d3b579e89207683e1233fe2910ddce17842505054ce3fcc`. These hashes identify the inspected files, not the full worktree.
