# Explicit above-target tokenURI reads

2,000,000 decimal bytes is KEEL's normal complete-tokenURI compatibility target. It is not a universal ERC-721 limit or a statement about a provider's capacity. Standard preparation/read/simulation behavior remains unchanged when the new optional fields are omitted.

Above-target work has two distinct stages, both exported from `@keel/protocol`:

1. `KeelTokenURIPreparationBudget` binds an unsigned maximum to `chainId`, `projectId`, source `revision`, `defaultsRevision`, `sourceDigest` and selected `planDigest`. It lets the existing compiler prepare fragments and derive the actual collection/context/complete URI before that URI's digest exists. It grants no simulation proof, wallet approval or provider capability.
2. `KeelExplicitNonstandardReadPolicy` records the complete measured URI length/digest, measurement digest, the same source/plan/revision/defaults/chain identity and actual reader/provider limits. `keelNonstandardReadAcknowledgementKey({identity,limits})` produces the exact canonical warning key. `createKeelExplicitNonstandardReadPolicy` rejects missing/stale acknowledgement, unknown fields, unsafe units and insufficient ABI/JSON response capacity. Changing an acknowledged field requires another acknowledgement.

Policy limits are `maximumTokenUriBytes`, complete serialized `maximumRpcResponseBytes`, and decimal-string `maximumReadGas`. `keelTokenURIRpcResponseBytes` separately counts ABI offset, length and padding, hexadecimal expansion and JSON headroom. `readKeelInlineTokenAudit` additionally bounds a nonstandard response to the known exact expected length's envelope. A user acknowledgement does not increase an actual provider response cap, contract gas limit, decoder memory/work bound or native proof budget.

The policy and budget are snapshotted before the first asynchronous digest or RPC. Full-return boundaries verify exact UTF-8 length, SHA-256 and selected chain. Funding simulation requires both the original unsigned budget and matching exact policy, includes both in its proof fingerprint, still executes the unchanged full program and still compares the complete return. A real revert, stale plan, changed URI, wrong chain or actual capacity limit still fails.

For the creator compiler, pass `publication.preparationReadBudget` before compilation. The resulting journal has no wallet approval. Display its exact measured result, obtain the warning acknowledgement, and call `attachKeelCreatorPublicationReadPolicy(journal,policy)`. This helper accepts only an unfunded journal without receipts, a wallet attempt or unknown submission state. It checks the journal's current project/source/defaults revision, chain, selected plan and complete URI; preserves every execution call; and produces a new fingerprint. The normal `prepareKeelCreatorPublicationWalletStep` must then perform the full simulation before offering its next call. The Studio/API caller remains responsible for authenticated actor/CAS/revision authorization and for deriving commitments from the actual selected plan, not user-supplied URL parameters.

`localTestChainProfile` is an optional pass-through of the existing validated local fixture capability. Its factory-created frozen identity must survive the in-memory compiler/journal path; cloning it into an unregistered object cannot authenticate it. Public-chain behavior is unchanged. Serialized local-fixture observations are not automatically trusted on recovery.

The old decompression, decoded HTML inspection, dictionary/work, legacy-carriage, graph-depth/node and native proof safety bounds remain separate. Explicitly larger metadata/carriage does not authorize a decompression bomb or invent a new storage/reader protocol. Numeric graph-builder ceilings remain unsigned planning bounds and do not establish funding readiness.

## Verification scope

- `tests/nonstandard-read-policy.test.mjs`: default bounds; exact UTF-8/ABI wire accounting; stale identity and unknown-key rejection; mutation snapshot; independent decoder bound; unsigned-budget separation.
- Additive regression in `tests/creator-prepared-compiler.test.mjs`: fresh valid deterministic PNG compilation whose complete URI exceeds 2 MB; measure before acknowledgement; no wallet before acknowledgement; unchanged execution calls; new digest; stale revisions/source/plan and pending wallet rejection; normal full simulation before wallet handoff. Its infrastructure and simulation transport are mocked, so it proves SDK orchestration rather than real-chain publication.
- `tests/nonstandard-read-anvil.test.mjs`: genuine local EVM execution returns the exact valid **2,050,429-byte** raw-percent JSON URI, with a **4,101,030-byte** JSON-RPC response. Standard read rejects; explicit exact policy passes. Both reads use the same target/calldata/gas/block fields. Solidity runtime is **954 bytes**, SHA-256 `0xf646a8ca54a9b733c90e382446750c096e13445e0a424b2af11a4c88da65710e` (consult the generated receipt for authoritative size if the fixture source changes).

The Anvil test explicitly installs its synthetic fixture with local `anvil_setCode`; it does not sign/send a transaction, authenticate a production deployment, establish Sepolia capacity, or test the retained incident artwork. It records the actual compiler/runtime, URI hash, physical read bytes and unchanged call fields when `KEEL_NONSTANDARD_RECEIPT` names a fresh output path. Never relabel this as the original full-program simulation or live Studio proof.

Reproduce from a clean built checkout with the official Node 22 environment:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
node --test tests/nonstandard-read-policy.test.mjs tests/creator-prepared-compiler.test.mjs \
  tests/creator-publication-journal.test.mjs tests/sdk-publication-preflight.test.mjs
KEEL_NONSTANDARD_RECEIPT=/absolute/new/receipt.json \
  node --test tests/nonstandard-read-anvil.test.mjs
```

The test Anvil executable defaults to `/Users/ravonus/.foundry/bin/anvil`; set `KEEL_TEST_ANVIL` to an existing qualified installation elsewhere. No public endpoint or production credentials are used by these tests. Independent review, clean-checkout QA, actual selected-provider capacity, actual SDK program execution and live deployment acceptance remain separate gates.
