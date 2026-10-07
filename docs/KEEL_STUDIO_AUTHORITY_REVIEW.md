# Studio execution routes and identity

Studio works without an agent. The normal release route lets the creator edit the saved plan and review exact wallet calls. An agent can prepare that same plan through the existing scoped draft operations. The creator remains the signer of each new transaction.

`plan` and `prepare-review` responses now include an optional `execution` explanation. It is bound to the saved release/revision and, for a wallet review, its operation ID and requested wallet. The SDK rejects a mismatched explanation and reconstructs its source links from the pinned registry. This object describes the route; `authorizesExecution` is always false. Existing signing, live authority, byte-integrity and receipt checks remain authoritative.

## Choose the actual route

| Route | Existing capability | Boundary |
| --- | --- | --- |
| Studio release | Saved owner review with exact collection/sale calls | The current publisher does not substitute a delegated signer. Its agent grant only prepares drafts. |
| Creator-factory direct | Creator-owned collection review | Ordinary `KeelCreatorFactory` creation uses the calling creator. An agent directly calling it creates an agent-owned collection. |
| Creator-authorized factory | `KeelFactory.castDieFor` and portable MCP `wallet-link` | A one-shot creator signature binds the exact agent, chain/factory domain, nonce, expiry and configuration. `wallet-link` prepares typed data with `approval=not-granted` and `chainReady=false`; it does not sign, perform RPC checks, or delegate a full Studio release. |
| Approved publication job | Fixed owner/executor, ordered commitments, targets, cursor, deadline and escrow | Resume the existing bounded job after verifying its live state. Do not create another storage payment. |
| Project authority delegate | Exact target/selector through `KeelAuthority`, zero native value | Verify that the authority controls the target and the specific grant exists. Protected role/ownership/upgrade selectors cannot be delegated through this lane. Zero native value is not an ERC-20 or NFT spending limit. |
| Manager automation | Exact target/selector, active key, policy, validity window, nonce and native-value limits | Live deployment and grant proofs are required. Native-value bounds do not constrain token transfers by themselves. There is no generic configured Studio adapter for this lane yet. |

Source review is pinned to contracts commit `ace3fed7aff1765c7d2ee9bba4d0232246f86ffb`. Repository presence does not establish deployed runtime identity, available grants, an approved wallet, or a supported frontend signing flow.

- [Factory creator authorization](https://github.com/Ravonus/keel-contracts/blob/ace3fed7aff1765c7d2ee9bba4d0232246f86ffb/src/modules/keel-die/KeelFactory.sol)
- [Direct creator factory](https://github.com/Ravonus/keel-contracts/blob/ace3fed7aff1765c7d2ee9bba4d0232246f86ffb/src/modules/keel-die/KeelCreatorFactory.sol)
- [Bounded publication jobs](https://github.com/Ravonus/keel-contracts/blob/ace3fed7aff1765c7d2ee9bba4d0232246f86ffb/src/modules/keel-publication/KeelPublicationJob.sol)
- [Project authority](https://github.com/Ravonus/keel-contracts/blob/ace3fed7aff1765c7d2ee9bba4d0232246f86ffb/src/modules/keel-kernel/KeelAuthority.sol)
- [Manager automation](https://github.com/Ravonus/keel-contracts/blob/ace3fed7aff1765c7d2ee9bba4d0232246f86ffb/src/modules/keel-artifacts/KeelManager.sol)

## Keep identities separate

The review distinguishes the creator account, requested signing account, contract authority, artwork creator, current owner, recipient and fee payer. Unknown identities stay unknown. Neither an agent connection nor a transaction sender proves the artwork's author, current NFT owner or final fee payer. A sponsor/relayer may pay fees, and a mint recipient may differ from every other account.

The onchain registry already distinguishes immutable `artifactCreator` from mutable `artifactOwner`, and its restricted `forgeArtifactFor` publication-job path preserves the creator that approved the plan. Attribution labels are separate from edit or ownership permission. `castDieFor` emits `DieCast` with the creator/admin and a separate `DieCastByAgent` event. Studio's `DieCast` projection reads those explicit event fields rather than transaction sender.

The creator-collection directory's `CreatorCollectionTransferred` projection updates its `creator` field as current control changes. That mutable directory field must not be treated as immutable artistic authorship. Existing gallery fallbacks from owner/registry labels still require the separately tracked provenance correction; this review UI does not claim that all gallery/indexer attribution is already fixed.

## Agent instructions

Use hosted `keel_release_plan_read/edit` and `keel_release_review_prepare`, or portable `keel-studio-draft` operations `plan`, `plan-edit` and `prepare-review`. Read the returned route explanation. Preserve the saved revision and command identity. Return the server-issued review URL; never invent a transaction-import page.

When the creator asks for delegated execution, identify a supported contract path and the exact missing proof or setup. The existing `wallet-link` tool is a review-only preparation primitive, not permission to create credentials or execute a grant. Do not replace an unsupported route with an agent's own wallet. Agent-owned work uses an explicitly configured agent creator account and a distinct attribution context.

No wallet setup, funding, permission grant or transaction was performed by this source change. The current UI shows the available owner-review path and explains why other modes are unavailable or need explicit setup. Actual delegated signing remains a separate, proof-gated integration.
