# Wallet and inscriber references

Read-only survey, 2026-11-04. These are design inputs, not tested implementations.

## Wallets and authentication

The contract audit `docs/ordinals-plan/wallet-audit-2026-11-03.md` reviews Ravonus/terminus branch `development_new` and fun-art. Extract the fun-art adapters and PSBT review as S4 directs. Keep separate ordinals and payment roles, including an explicit shared-address case. Use a server nonce and strict BIP-322 proof of both roles. Reject Terminus's fixed-message login and payment-only proof: the audit identifies replay and unproven ordinals addresses in `src/utilities/handleSign.ts` and `src/app/(payload)/api/terminus/verifyAddress/route.ts`. Treat its connector list and per-script branching as references, not safe transaction code. Per-input signing, explicit sighash and post-sign byte verification are required; its audited whole-PSBT signing and missing return comparison do not meet those requirements. Classify payment outputs using our reader; size thresholds are not protection.

## Terminus and TerminusMaximus

- [Ravonus/terminus](https://github.com/Ravonus/terminus), main `0fe52f2f621383e7708a450aec3969c290593caf`: `src/app/(frontend)/inscribe/types.ts` defines separate recursion, wallet and metadata options. Keep these as distinct concepts; the settings type does not establish working inscription or metadata semantics. Audit findings above concern a different branch and are not asserted to describe this main revision.
- [Term-Ord/TerminusMaximus](https://github.com/Term-Ord/TerminusMaximus), main `e05939d7caa1fd2788af5fb5a9869554d322888a`: `scripts/inscribe-build.js` explicitly chunks buffers and includes CBOR metadata encoding. Use these as questions for envelope and metadata test vectors, not as a proven compatible encoder. `sdk/src/inscribe/Envelope.ts` instead pushes the whole body while its comment claims automatic chunking; do not rely on that claim. `sdk/src/recursion/RecursionResolver.ts` resolves remote IDs through an indexer and local paths through a reader. This is useful lookup context, but is not the required typed parent/child version selection, failure handling, or canonical verification shell. Keep the roadmap's existing recursion reader and shell.

## Lifo

[ Removed reference ambiguity: GitHub user lifofifo ](https://github.com/lifofifo) returned one public repository via `gh api users/lifofifo/repos --paginate`: `lifofifo/moby`, master `8b29ba59ccdd4de45fa25137ec5d5a3845f5f5cc`. Its tree is a Docker/Moby source tree; the relevant PSBT/inscriber repository was not identified. No reuse decision about Lifo's PSBT or inscription code is possible from this result. The account or repository needs identification before that part of rule 15 is complete.

## Older machine

Read-only inspection on yuna-mbp found `~/Documents/CoolS` at Git HEAD `0a6a39856ef016ead6838eb85073ab8ae9b1983d`, with a dirty worktree; HEAD alone does not identify its current source bytes. `src/tooling/chainTui.ts` imports transaction selection and inscription tooling, and `src/tooling/inscribeBuild.ts` uses bitcoinjs PSBTs, wallet-store resolution, and an inscription-output check with an explicit unknown result. Preserve the fail-closed distinction between unknown and safe, but do not copy the wallet store, TUI or transaction builder without a full safety audit. The older code is unfinished and was not executed. `~/Documents/wildflower` was present but did not identify a Git revision; the specifically requested older wildflower/terminus TUI identity remains unconfirmed.
