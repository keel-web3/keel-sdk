# Proof, approval, and recovery boundaries

**Shared storage and shell policy:** Default payloadStorage is Compact: native bytes stored once, beneficial compatible lossless compression, no generated encoded sibling. Raw preserves supplied bytes and intentional creator formatting. Shell selection is independent. Default to the registered KEEL verification shell; explicit viewer=none preserves creator-owned HTML/direct artifacts without a canonical protection claim. Requirements below for canonical shell records, protected K, and canonical mounting apply to the verification-shell choice. Native-container composers require native storage inventory, decoded source and selected-chain reader proof; their transient return encoding is not another stored copy. Read `docs/KEEL_PAYLOAD_STORAGE.md` and `docs/KEEL_BINARY_RESOURCE_DELIVERY.md`. Persist both choices and reject unsupported readers instead of silently changing storage or presentation.

Use the smallest evidence set that proves the requested claim, and name what it
does not prove.

| Evidence | Proves | Does not prove |
| --- | --- | --- |
| SDK/unit tests | deterministic local functions, schemas, and fail-closed behavior | Solidity behavior, browser rendering, deployment |
| Forge tests | EVM contract behavior in the test environment | public deployment, current RPC state, hosted UI |
| Module build/test/index | source-to-output receipt, vectors, deterministic catalog | chain publication or carrier availability |
| Browser/runtime smoke | actual rendering and console/runtime behavior for that URL/build | onchain receipts unless independently read back |
| Transaction receipt | one transaction was included and succeeded | complete object graph, tokenURI parity, browser playback |
| Contract read-back | addresses, object bytes/digests, tokenURI, state at a block | visual/browser behavior |

Require both receipt and read-back for a publication claim. Require browser
evidence for a viewer/playback claim. For a shared module, require object bytes,
digest/length, graph/library/review registration, and selected-chain binding;
a plan or predicted object ID is insufficient. For the verification-shell
choice or a canonical protection claim, also require the selected-chain
canonical shell record and protected K browser behavior. Explicit viewer=none
creator-owned HTML requires its own exact bytes, store/builder/read-back, and
browser behavior; it does not require or claim canonical protection. Persist
shell choice and Compact/Raw storage independently in the reviewed plan.

## Approval boundary

Before a wallet request, show the exact chain, target contracts, collection
lane, storage/presentation mode, object/module commitments, operation count,
estimated and quoted costs with timestamps, and what the wallet will approve.
Keep setup/publication gas separate from tokenURI/read gas.

MCP and the skill do not sign, submit, claim faucet funds, store private keys,
or treat a plan as approval. Prefer a supported wallet batch only when the
connected wallet advertises it; otherwise explain sequential approvals. Never
report a mint, auction, sale, or upload as complete without receipts and the
appropriate contract read-back.

## Testnet funding

Use `keel-chain-guide` to show human faucet links. The creator opens the page and
claims funds. Recheck wallet network and balance before preparing an approval.

## Recovery

For an existing managed job, match owner, executor, plan digest, chunk count,
operation count, cursor, durable journal, and receipts before retrying. Reconcile
a timed-out transaction before resubmitting, retain failed indexes, and never
repeat confirmed chunks or operations. Missing or conflicting recovery state is
a safe stop, not permission to open a new job or request another approval.

For details about native carriers and experimental storage routes, read
[publication-modes.md](publication-modes.md).
