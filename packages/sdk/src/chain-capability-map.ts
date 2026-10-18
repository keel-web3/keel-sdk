/**
 * One Studio/SDK capability, its EVM adapter and its Tezos adapter.
 *
 * Owner rule: both chains behave as close to one another as possible, and for
 * Studio or the user it works the same. `userVisibleDifference` should be
 * `false`. Where a chain cannot do something, `resolveKeelChainCapability`
 * returns the closest secure supported behaviour with a typed explanation
 * instead of approximating the missing one.
 *
 * This is a review map of contract source, not a deployment or readiness claim.
 */

import type { StudioChainFamily } from "./studio-capabilities.js";

/** The same chain families Studio capability documents list. */
export type KeelChainFamily = StudioChainFamily;

/**
 * - `parity`: the same contract behaviour on both chains.
 * - `adapter-different`: one Studio call; each chain uses its own mechanism.
 * - `partial`: both chains have it, with a known open difference (see `open`).
 * - `evm-only` / `tezos-only`: the other chain returns `closest`.
 */
export type KeelChainCapabilityStatus = "parity" | "adapter-different" | "partial" | "evm-only" | "tezos-only";

export interface KeelChainAdapter {
  /** Contracts (EVM Solidity or native SmartPy class names) that implement it. */
  readonly contracts: readonly string[];
  readonly behaviour: string;
}

export interface KeelChainClosestBehaviour {
  readonly behaviour: string;
  readonly reason: string;
}

export interface KeelChainCapability {
  readonly id: string;
  readonly area: "collection" | "mint" | "storage" | "market" | "stake-ip" | "authority" | "identity" | "anchors" | "presentation";
  /** The one Studio/SDK operation a creator or collector uses on either chain. */
  readonly studioCall: string;
  readonly status: KeelChainCapabilityStatus;
  readonly evm: KeelChainAdapter | null;
  readonly tezos: KeelChainAdapter | null;
  /** `false` when Studio and the user see the same behaviour. Otherwise what they see differently. */
  readonly userVisibleDifference: false | string;
  /** For `evm-only` / `tezos-only`: what the other chain does instead. */
  readonly closest?: KeelChainClosestBehaviour;
  /** Open review items that keep this from full parity. */
  readonly open?: string;
  /** A product rule the owner still has to choose. */
  readonly ownerDecision?: string;
}

const evm = (contracts: readonly string[], behaviour: string): KeelChainAdapter => ({ contracts, behaviour });
const tez = evm;

export const KEEL_CHAIN_CAPABILITIES: readonly KeelChainCapability[] = Object.freeze([
  // ── Collections and metadata ─────────────────────────────────────────────
  {
    id: "collection.create",
    area: "collection",
    studioCall: "Create collection",
    status: "adapter-different",
    evm: evm(["KeelCreatorFactory", "KeelCreator721A", "KeelCreator721"], "Factory clone owned by the creator."),
    tezos: tez(["KeelCollectionFA2"], "The creator's wallet originates one FA2 collection; KeelIndex registers it."),
    userVisibleDifference: false,
  },
  {
    id: "collection.token-metadata.creator-rewrite",
    area: "collection",
    studioCall: "Rewrite token metadata (creator)",
    status: "adapter-different",
    evm: evm(
      ["KEEL721", "KeelIndex", "KeelArtifactRegistry", "KeelArtifactTokenRenderer"],
      "KEEL721: PRESENTATION_ROLE rewrites any unfrozen token. Creator route: bindings are write-once; the creator appends artifact or Index revisions.",
    ),
    tezos: tez(["KeelCollectionFA2", "KeelIndex"], "Administrators rewrite token_info and the compatibility JSON of any unfrozen token."),
    userVisibleDifference: false,
  },
  {
    id: "collection.token-metadata.holder-editing",
    area: "collection",
    studioCall: "Allow holders to edit their token metadata",
    status: "parity",
    evm: evm(["KEEL721"], "setTokenOwnerCanEdit (DEFAULT_ADMIN_ROLE). Default off; approved operators never edit. The creator route has no holder editing."),
    tezos: tez(["KeelCollectionFA2"], "set_token_owner_can_edit (administrator). Default off; NFT operators never edit."),
    userVisibleDifference: false,
    open: "Owner decision: the creator is the default editor. KEEL721 collections deployed before this change keep their stored setting (on) until the creator calls setTokenOwnerCanEdit(false); new deployments and managed proxies start off.",
  },
  {
    id: "collection.token-metadata.freeze",
    area: "collection",
    studioCall: "Freeze token metadata",
    status: "parity",
    evm: evm(["KEEL721"], "freezePresentation by PRESENTATION_ROLE, or by the holder only while setTokenOwnerCanEdit is on; irreversible."),
    tezos: tez(["KeelCollectionFA2"], "freeze_token_metadata by an administrator, or by the holder only while token_owner_can_edit is on; irreversible."),
    userVisibleDifference: false,
  },
  {
    id: "collection.token-metadata.field-permissions",
    area: "collection",
    studioCall: "Grant field-level metadata edit permissions",
    status: "partial",
    evm: evm(["KEEL721"], "PRESENTATION_ROLE grants whole-token presentation edits to any account or contract without making it an administrator; there is no per-field or per-token scope."),
    tezos: tez(["KeelCollectionFA2"], "Only administrators edit and freeze; holders only when token_owner_can_edit is enabled. A trait writer does not need to be an administrator: the creator signs the rewrite in the triggering call's own operation group."),
    userVisibleDifference: false,
    open: "Field-level edit permissions (permission gates and creator-defined editable fields with onchain validation, on both chains) are owned by the keel-field-permissions work, stacked on this branch, including any grant that lets a holder freeze. Until then the creator is the only default editor and freezer.",
  },
  {
    id: "collection.token-metadata.live-state",
    area: "collection",
    studioCall: "Show changing token state (metadata state)",
    status: "partial",
    evm: evm(["KEEL721", "KeelIndex"], "tokenURI is computed when read, so the token and every marketplace see current state with no metadata write."),
    tezos: tez(
      ["KeelCollectionFA2"],
      "The token's HTML reads state live (tezos-live-state: frozen snapshot, then public RPC reads). Listing-visible traits are rewritten by the creator in the triggering call's own atomic operation group (prepareKeelTezosStateRewrite). token_owner_can_edit stays off and the triggering contract is never an FA2 administrator.",
    ),
    userVisibleDifference: "Marketplace traits on Tezos change when the creator's group carries the rewrite; a change triggered by another account shows live in the HTML and reaches listed traits at the creator's next rewrite.",
    open: "Indexers read stored token_metadata and never evaluate a view, so a state change that the creator does not sign leaves listed traits behind until the creator's next batch. Scoped trait writers (a holder, wallet or contract granted named fields) belong to collection.token-metadata.field-permissions.",
  },
  {
    id: "collection.contract-metadata",
    area: "collection",
    studioCall: "Update collection metadata",
    status: "adapter-different",
    evm: evm(["KeelArtifactTokenRenderer", "KeelArtifactRegistry"], "contractURI from a write-once artifact binding; content changes by artifact revision."),
    tezos: tez(["KeelCollectionFA2"], "set_contract_metadata / freeze_contract_metadata (administrator) on TZIP-16 entries."),
    userVisibleDifference: false,
  },
  {
    id: "collection.default-presentation",
    area: "collection",
    studioCall: "Set or freeze the collection presentation",
    status: "parity",
    evm: evm(["KEEL721", "Keel721Presentation"], "Default presentation, then a one-way freeze."),
    tezos: tez(["KeelCollectionFA2"], "set_default_presentation, then freeze_default_presentation."),
    userVisibleDifference: false,
  },
  {
    id: "collection.index-revisions",
    area: "collection",
    studioCall: "Publish or activate a presentation revision",
    status: "parity",
    evm: evm(["KeelIndex"], "Collection-default and token-override revisions; activation and freeze."),
    tezos: tez(["KeelIndex"], "Same revision model and precedence."),
    userVisibleDifference: false,
  },
  {
    id: "collection.royalties",
    area: "collection",
    studioCall: "Set royalties",
    status: "adapter-different",
    evm: evm(["KeelCreator721A", "KEEL721", "KeelShared1155"], "ERC-2981 default royalty; KEEL721 administrators can change it."),
    tezos: tez(["KeelCollectionFA2"], "Administrator-set default royalty reported by royalty_info, with matching TZIP-21 royalties in token metadata."),
    userVisibleDifference: false,
  },
  {
    id: "collection.editions",
    area: "collection",
    studioCall: "Create an edition item",
    status: "evm-only",
    evm: evm(["KeelCreator1155", "KeelCreatorFactory"], "ERC-1155 capped edition items."),
    tezos: null,
    userVisibleDifference: "Tezos collections issue numbered one-of-one tokens instead of one fungible edition ID.",
    closest: {
      behaviour: "Strike the edition size as distinct FA2 tokens with the same metadata, each counted against max_supply.",
      reason: "KeelCollectionFA2 is a single-asset NFT ledger; a native multi-asset edition contract is not implemented.",
    },
  },
  {
    id: "collection.shared-items",
    area: "collection",
    studioCall: "Create items in a shared collection",
    status: "evm-only",
    evm: evm(["KeelShared1155"], "Many creators share one ERC-1155 host with per-creator ranges."),
    tezos: null,
    userVisibleDifference: "Each Tezos creator originates their own collection.",
    closest: { behaviour: "One KeelCollectionFA2 per creator, registered in KeelIndex.", reason: "No native shared-range host is implemented." },
  },
  {
    id: "collection.seeded-mint",
    area: "collection",
    studioCall: "Mint with a per-token seed",
    status: "adapter-different",
    evm: evm(["KeelCreatorSeeded721A", "KeelMintSeeded721A"], "Per-token bytes32 seed committed at mint, revealed immediately or by a provider."),
    tezos: tez(["KeelSeededCollectionFA2", "KeelSeedRegistry"], "Same profile, batches, Shared/Derived token seeds, provider settlement, lock and FullSeed cache. The batch commitment uses level and timestamp in place of prevrandao; the SDK stages configure_seed_profile right after origination."),
    // Seeds are random on both chains, so a chain-local commitment input is not a visible difference;
    // the derivation from a batch seed is byte-identical (test/fixtures/parity/seeded-collection.json).
    userVisibleDifference: false,
  },
  {
    id: "collection.seed-future-block",
    area: "collection",
    studioCall: "Reveal a seed from future block hashes",
    status: "evm-only",
    evm: evm(["KeelCreatorSeeded721A", "KeelSeedBlockArchive"], "The batch waits for the hashes of target and target + 1."),
    tezos: null,
    userVisibleDifference: "Tezos refuses a profile with futureBlockDelay > 0.",
    closest: {
      behaviour: "A provider profile: any contract with batch_entropy and fulfill_seed_batch settles the batch.",
      reason: "Michelson cannot read block hashes, so FUTURE_BLOCK_SEED_UNAVAILABLE is returned.",
    },
  },
  {
    id: "collection.seed-chainlink-vrf",
    area: "collection",
    studioCall: "Buy, request or deliver Chainlink VRF randomness",
    status: "evm-only",
    evm: evm(["KeelSeedVrfAdapter"], "Prepaid credits, coordinator requests and delivery to the collection."),
    tezos: null,
    userVisibleDifference: "Tezos has no Chainlink VRF adapter or credits.",
    closest: {
      behaviour: "Provider mode: the provider contract calls fulfill_seed_batch, or anyone reveals once batch_entropy is ready.",
      reason: "Chainlink VRF is not deployed on Tezos.",
    },
  },
  {
    id: "collection.transfer",
    area: "collection",
    studioCall: "Transfer or approve",
    status: "adapter-different",
    evm: evm(["KEEL721", "KeelCreator721A"], "ERC-721 transfer and approvals."),
    tezos: tez(["KeelCollectionFA2", "KeelNFTLedger"], "FA2 transfer and update_operators, with owner_of and get_total_balance views."),
    userVisibleDifference: false,
  },
  // ── Minting ──────────────────────────────────────────────────────────────
  {
    id: "mint.direct",
    area: "mint",
    studioCall: "Mint (creator)",
    status: "parity",
    evm: evm(["KeelMintRouteRegistry", "KeelCreator721A"], "Reserved or unreserved issuance against supply."),
    tezos: tez(["KeelCollectionFA2"], "strike (reserved) or strike_unreserved; shared 23-operation reservation trace."),
    userVisibleDifference: false,
  },
  {
    id: "mint.staged-drop",
    area: "mint",
    studioCall: "Run a staged drop",
    status: "parity",
    evm: evm(["OneMintController", "OpenOneMintController"], "Public, allowlist, Merkle and claim stages."),
    tezos: tez(["OneMintController"], "The same stage kinds, priced in tez, with the same target identity refusals."),
    userVisibleDifference: false,
    open: "OpenOneMintController (profile as provenance, not permission) has no native counterpart.",
  },
  {
    id: "mint.campaign",
    area: "mint",
    studioCall: "Run a gated mint campaign",
    status: "adapter-different",
    evm: evm(["KeelMintGate"], "Public, Merkle, token-gated or signed campaigns with EIP-712 approvals."),
    tezos: tez(["KeelMintGate"], "The same campaign kinds with Michelson-packed signed approvals."),
    userVisibleDifference: false,
  },
  {
    id: "mint.target-identity",
    area: "mint",
    studioCall: "Check that a drop or campaign targets a KEEL collection",
    status: "adapter-different",
    evm: evm(["KeelMintRouteRegistry", "OneMintController", "KeelMintGate"], "A registered route vouches for the target; codeless, unrouted and hook-mismatched targets are refused."),
    tezos: tez(["OneMintController", "KeelMintGate"], "The controllers probe the target's typed FA2, strike and capacity surface; the same refusals in the same order."),
    userVisibleDifference: false,
  },
  {
    id: "mint.batch-checkout",
    area: "mint",
    studioCall: "Check out several mints at once",
    status: "adapter-different",
    evm: evm(["OneMintController", "KeelOneMintBatch"], "batchMint in one transaction."),
    tezos: tez(["OneMintController"], "One operation group of mint calls, applied atomically after one wallet approval."),
    userVisibleDifference: false,
  },
  {
    id: "mint.payment-token",
    area: "mint",
    studioCall: "Price a mint in a token",
    status: "evm-only",
    evm: evm(["OneMintController", "KeelMintGate"], "ERC-20 payment stages and campaigns."),
    tezos: tez(["OneMintController", "KeelMintGate"], "Refused with UNSUPPORTED_PAYMENT_TOKEN."),
    userVisibleDifference: "Tezos prices are in tez.",
    closest: { behaviour: "Price the stage in tez.", reason: "No native FA1.2/FA2 payment adapter; token payments are refused rather than treated as tez." },
  },
  {
    id: "mint.coupons",
    area: "mint",
    studioCall: "Offer coupons",
    status: "evm-only",
    evm: evm(["OneMintController", "KeelOneMintBatch", "KeelNftCouponClaims"], "Signed and NFT-holder coupons with one-use claims."),
    tezos: null,
    userVisibleDifference: "No coupons on Tezos.",
    closest: { behaviour: "A separate Merkle allowlist stage at the discounted price.", reason: "Native coupon claims are not implemented." },
  },
  {
    id: "mint.queue",
    area: "mint",
    studioCall: "Run a queue or lottery",
    status: "evm-only",
    evm: evm(["KeelMintQueue", "KeelQueueLotteryEngine", "KeelQueueAccess"], "Admission queue, priority, bypass and lottery turns."),
    tezos: null,
    userVisibleDifference: "No queue on Tezos.",
    closest: { behaviour: "A staged drop with an allowlist stage before the public stage.", reason: "The queue system has no native implementation." },
  },
  {
    id: "mint.releases",
    area: "mint",
    studioCall: "Name a release and promise its supply",
    status: "evm-only",
    evm: evm(["KeelMintRouteRegistry", "KeelMintReleases"], "Named releases with supply promises over shared routes."),
    tezos: tez(["KeelCollectionFA2"], "Per-minter reserved capacity on the collection."),
    userVisibleDifference: "Tezos shows reserved capacity, not a named release.",
    closest: { behaviour: "reserve_capacity for the release's minter.", reason: "The release router is not implemented natively; the reservation core is at parity." },
  },
  {
    id: "mint.platform-fee",
    area: "mint",
    studioCall: "Platform fee on mint",
    status: "parity",
    evm: evm(["KeelMintGate", "OneMintController"], "Platform recipient and basis points."),
    tezos: tez(["KeelMintGate"], "set_platform_configuration with recipient and basis points."),
    userVisibleDifference: false,
  },
  {
    id: "mint.rewards",
    area: "mint",
    studioCall: "Run a reward claim",
    status: "evm-only",
    evm: evm(["KeelRewardClaims", "KeelMintRewardEntropy"], "Benefit campaigns with claims, redemption and draws."),
    tezos: tez(["OneMintController"], "claim_mint stages only."),
    userVisibleDifference: "Tezos supports claim-to-mint only.",
    closest: { behaviour: "A claim stage in a staged drop.", reason: "Reward campaigns and draws are not implemented natively." },
  },
  {
    id: "mint.auction",
    area: "mint",
    studioCall: "Sell by auction",
    status: "evm-only",
    evm: evm(["FrayAuctionIssuer"], "FRAY auction outcomes minted as unique tokens or editions."),
    tezos: null,
    userVisibleDifference: "No auctions on Tezos.",
    closest: { behaviour: "List on the KEEL market and accept funded bids.", reason: "No native auction issuer is implemented." },
  },
  {
    id: "mint.cross-chain",
    area: "mint",
    studioCall: "Mint from a token on another chain",
    status: "adapter-different",
    evm: evm(["KeelCrossChainMintBridge"], "The holder requests; a fixed forwarder reports once the anchor is verified."),
    tezos: tez(["KeelCrossChainMintAttestor"], "A threshold of registered attestors confirms the request. As on EVM, the exact revision must be held on this chain, the source token is the replay key, each route names its target, and the lock freezes the report source."),
    userVisibleDifference: false,
    open: "The trust models differ (forwarder workflow vs attestor threshold); CROSS_CHAIN_MINT_RULES.md discloses both. Tezos has no shared mint-route registry.",
  },
  // ── Storage and publication ──────────────────────────────────────────────
  {
    id: "storage.hold",
    area: "storage",
    studioCall: "Store artwork on chain",
    status: "adapter-different",
    evm: evm(["KeelHold"], "Immutable slugs in Ingot contracts, welded and sealed. The object ID hashes the whole descriptor; a repeat weld returns the same object."),
    tezos: tez(["KeelHold", "KeelHoldOnchFS"], "Immutable slugs and OnchFS files/directories. The OnchFS object ID is sha256(PACK(descriptor)) (predict_object_id), so it commits every field; a repeat weld is a no-op."),
    userVisibleDifference: false,
  },
  {
    id: "storage.publication-job",
    area: "storage",
    studioCall: "Resume a publication",
    status: "evm-only",
    evm: evm(["KeelPublicationJob", "KeelCarrierBatcher"], "Escrowed, resumable on-chain job."),
    tezos: null,
    userVisibleDifference: false,
    closest: {
      behaviour: "Reviewed operation groups that the SDK journal resumes; each write is idempotent by content.",
      reason: "No native escrowed job contract; the SDK carries resumption.",
    },
  },
  {
    id: "storage.artifacts",
    area: "storage",
    studioCall: "Forge or revise an artifact",
    status: "parity",
    evm: evm(["KeelArtifactRegistry"], "Owned append-only revisions with edit policies."),
    tezos: tez(["KeelArtifactRegistry"], "Same policies, including real collection ownership."),
    userVisibleDifference: false,
  },
  {
    id: "storage.checkpoint-identity",
    area: "storage",
    studioCall: "Publish an immutable checkpoint",
    status: "adapter-different",
    evm: evm(["KeelHold"], "Objects are written through a fee-paid weld intent keyed by payer, object and executor, so no other account can claim the intent."),
    tezos: tez(["KeelImmutableCheckpointRegistry"], "The object ID binds the owner: sha256(PACK(owner, identity)), read with predict_object_id. Another account cannot pre-claim it; two owners of the same bytes hold independent objects."),
    userVisibleDifference: false,
  },
  {
    id: "storage.harness",
    area: "storage",
    studioCall: "Compose a harness or token fork",
    status: "parity",
    evm: evm(["KeelHarnessRegistry"], "Exact-version harness trees and token forks."),
    tezos: tez(["KeelHarnessRegistry"], "Flat harnesses, token forks, selection reuse and seed context under EVM's edit and fork policy codes."),
    userVisibleDifference: false,
  },
  {
    id: "storage.harness-tree",
    area: "storage",
    studioCall: "Compose a harness tree",
    status: "adapter-different",
    evm: evm(["KeelHarnessRegistry"], "Compact uint32 keys, branch revisions of packed child words, governed depth and object limits, token tree forks."),
    tezos: tez(["KeelHarnessRegistry", "KeelHarnessTreeRegistry"], "The same payloads, refusals and tree digests; keys, limits and children live on a bound tree registry that writes each revision through the harness registry. The SDK routes each call and reads keys back with harness_key_of."),
    userVisibleDifference: false,
  },
  {
    id: "storage.fidelity-links",
    area: "storage",
    studioCall: "Reveal external renditions",
    status: "parity",
    evm: evm(["KeelLinkRegistry"], "Committed 1..3 fidelity links."),
    tezos: tez(["KeelLinkRegistry"], "The same enum codes, commitment and refusals, checked by shared vectors; link_uri and link_for_presentation keep the canonical-shell rule for mutable locators."),
    userVisibleDifference: false,
  },
  // ── Presentation ─────────────────────────────────────────────────────────
  {
    id: "presentation.inline-token",
    area: "presentation",
    studioCall: "Publish an Inline token",
    status: "adapter-different",
    evm: evm(["KeelRawTokenURIBuilder", "KeelRawInlineShellRegistry"], "Raw-percent tokenURI wrapped by the canonical shell."),
    tezos: tez(["KeelCollectionFA2", "KeelHarnessBuilder", "KeelSleeve"], "TZIP-21 token_info with artifactUri/displayUri; the canonical shell from the harness builder."),
    userVisibleDifference: false,
  },
  {
    id: "presentation.canonical-shell",
    area: "presentation",
    studioCall: "Reuse the canonical shell",
    status: "parity",
    evm: evm(["KeelHarnessBuilder", "KeelRawInlineShellRegistry"], "Platform shell revisions, creator shells and freezes."),
    tezos: tez(["KeelHarnessBuilder"], "The same registration, revision and freeze rules."),
    userVisibleDifference: false,
  },
  {
    id: "presentation.dynamic-state",
    area: "presentation",
    studioCall: "Update dynamic token state",
    status: "parity",
    evm: evm(["KeelPresentationStateRegistry"], "Policy-governed state revisions with an optional staking lock."),
    tezos: tez(["KeelPresentationStateRegistry"], "Same policies, integrated with native staking."),
    userVisibleDifference: false,
  },
  {
    id: "presentation.visual-state-ledger",
    area: "presentation",
    studioCall: "Record visual state receipts",
    status: "evm-only",
    evm: evm(["KeelVisualStateLedger"], "Coordinator-recorded active visual digests."),
    tezos: null,
    userVisibleDifference: false,
    closest: { behaviour: "Presentation state revisions in KeelPresentationStateRegistry.", reason: "No native visual-state ledger." },
  },
  {
    id: "presentation.metadata-refresh",
    area: "presentation",
    studioCall: "Tell marketplaces metadata changed",
    status: "adapter-different",
    evm: evm(["KeelMetadataRelay", "KEEL721"], "ERC-4906 MetadataUpdate events."),
    tezos: tez(["KeelCollectionFA2"], "Indexers observe token_metadata big-map updates."),
    userVisibleDifference: false,
  },
  {
    id: "presentation.web3-url",
    area: "presentation",
    studioCall: "Serve a web3:// URL",
    status: "evm-only",
    evm: evm(["KeelWeb3ResourceAdapter"], "ERC-5219/ERC-6944 resolver."),
    tezos: null,
    userVisibleDifference: false,
    closest: { behaviour: "tezos-storage: TZIP-16 URIs and OnchFS paths.", reason: "web3:// is an Ethereum URL standard." },
  },
  // ── Market ───────────────────────────────────────────────────────────────
  {
    id: "market.trade",
    area: "market",
    studioCall: "List, buy or bid",
    status: "parity",
    evm: evm(["KeelMarket"], "Fixed-price and escrowed listings and funded bids, paid in ETH."),
    tezos: tez(["KeelMarket"], "The same listing, escrow and bid lifecycle, paid in tez, with delivery verified."),
    userVisibleDifference: false,
  },
  {
    id: "market.royalties",
    area: "market",
    studioCall: "Pay royalties on a sale",
    status: "parity",
    evm: evm(["KeelMarket"], "Looks up ERC-2981; the seller must match the computed split, stored with the listing."),
    tezos: tez(["KeelMarket"], "Reads the collection's royalty_info view; the seller must match the computed split, stored with the listing."),
    userVisibleDifference: false,
  },
  // ── Staking and IP ───────────────────────────────────────────────────────
  {
    id: "stake.objects",
    area: "stake-ip",
    studioCall: "Stake into an object",
    status: "partial",
    evm: evm(["KeelStakeObjectManager"], "Escrow staking against host NFTs, lockups, freeze, STAKING pause."),
    tezos: tez(["KeelStakeObjectManager"], "Escrow staking with verified delivery, lockups, freeze and the shared STAKING pause."),
    userVisibleDifference: false,
    open: "Per-object staked collections.",
  },
  {
    id: "stake.token-bound-account",
    area: "stake-ip",
    studioCall: "Give a token its own account",
    status: "evm-only",
    evm: evm(["KeelStakeObjectManager", "KeelIPActionExecutor"], "Optional ERC-6551 account bound to the host NFT."),
    tezos: tez(["KeelIPBackpackFA2"], "KEEL IP items custodied as FA2 tokens for the host token; the current host owner withdraws them (withdraw_from_backpack) and a holder deposits them (deposit_to_backpack)."),
    userVisibleDifference: "A Tezos backpack holds KEEL IP items only; it cannot hold tez or other tokens or make calls, as an ERC-6551 account can.",
    closest: {
      behaviour: "KeelIPBackpackFA2 custodies items for the host token. Control follows the host token: its current owner withdraws an item to any address, where it is a transferable FA2 token, and a holder can deposit it into any host token's backpack.",
      reason: "Tezos has no token-bound account standard, so the backpack contract is the custodian instead of an account the host owns.",
    },
  },
  {
    id: "ip.policies",
    area: "stake-ip",
    studioCall: "License or gate an artwork",
    status: "parity",
    evm: evm(["KeelIPControl", "KeelIPActionExecutor", "KeelIPWrapped721"], "Licenses, policies, gates, downloads and remints."),
    tezos: tez(["KeelIPControl", "KeelIPLicenseRegistry", "KeelIPTokenGate", "KeelIPActionExecutor", "KeelIPWrappedFA2"], "The same policies, gates and actions."),
    userVisibleDifference: false,
  },
  // ── Authority ────────────────────────────────────────────────────────────
  {
    id: "authority.governance",
    area: "authority",
    studioCall: "Govern the platform",
    status: "adapter-different",
    evm: evm(["KeelAuthority", "KeelManager", "KeelManagerProxy"], "Quorum execution with proxy recovery."),
    tezos: tez(["KeelManager"], "Governor quorum with delayed rotation and callback isolation."),
    userVisibleDifference: false,
  },
  {
    id: "authority.pause",
    area: "authority",
    studioCall: "Emergency pause",
    status: "partial",
    evm: evm(["KeelManager", "KeelLocalPause"], "Shared pause bits checked by every module."),
    tezos: tez(["KeelManager", "KeelAccessController"], "EVM's bits, masks and revision in KeelManager; admins stop through the access controller and governance resumes. Artifact publication, harness writes and staking check it."),
    userVisibleDifference: false,
    open: "Hold, market, mint, collection, treasury and IP modules still use their per-contract pauses.",
  },
  {
    id: "authority.access-groups",
    area: "authority",
    studioCall: "Delegate a role",
    status: "adapter-different",
    evm: evm(["KeelAccessGroups"], "Group approval and role lanes."),
    tezos: tez(["KeelAccessController"], "Roles, policies and exact capabilities with callback isolation."),
    userVisibleDifference: false,
  },
  {
    id: "authority.signatures",
    area: "authority",
    studioCall: "Approve a signed action",
    status: "parity",
    evm: evm(["KeelManager"], "Signature keys, grants and automation keys."),
    tezos: tez(["KeelSignatureAuthority"], "30-day keys, grants and automation keys."),
    userVisibleDifference: false,
  },
  {
    id: "authority.fee-treasury",
    area: "authority",
    studioCall: "Collect platform fees",
    status: "adapter-different",
    evm: evm(["KeelFeeTreasury"], "One treasury collects and pays out fees."),
    tezos: tez(["KeelArtifactRegistry", "KeelMintGate"], "Each contract pays or holds fees for its configured recipient."),
    userVisibleDifference: false,
  },
  {
    id: "authority.managed-upgrade",
    area: "authority",
    studioCall: "Repair or replace a module",
    status: "adapter-different",
    evm: evm(["KeelManagedModule", "KeelManagedModuleDeployer"], "Governed upgradeable wrappers."),
    tezos: tez(["KeelManager"], "Immutable contracts; governors register the replacement with configure_module."),
    userVisibleDifference: false,
  },
  // ── Identity and verification ────────────────────────────────────────────
  {
    id: "identity.creator-profile",
    area: "identity",
    studioCall: "Creator profile",
    status: "parity",
    evm: evm(["KeelCreatorProfileRegistry", "KeelAttributionRegistry", "KeelCreatorCommitmentRegistry"], "Profiles, credits and commitments."),
    tezos: tez(["KeelCreatorProfileRegistry", "KeelAttributionRegistry", "KeelCreatorCommitmentRegistry"], "Same."),
    userVisibleDifference: false,
  },
  {
    id: "identity.verification",
    area: "identity",
    studioCall: "Verify or replicate a collection",
    status: "partial",
    evm: evm(["KeelCollectionVerificationRegistry", "KeelCollectionAttestationRegistry", "KeelCommunityReplicationRegistry"], "Receipts read the collection's hook or audited adapter; anyone seals the observation with the block hash, checked by blockhash(). Replication revisions live in KeelArtifactRegistry."),
    tezos: tez(
      ["KeelCollectionVerificationRegistry", "KeelCollectionVerificationInspector", "KeelCollectionAttestationRegistry", "KeelCommunityReplicationRegistry", "KeelReplicationWorkRegistry"],
      "Receipts read the hook's keel_verification_state view or the adapter's inspect view, through a stateless inspector the registry pins at origination; every registry call stays on the registry. Only an auditor seals the observation. Replication is two contracts: campaigns, lineages and admission, and contributor work (slugs, carriers, stats), bound once by the deployer (keelTezosSplitBindings); resolveKeelTezosCall routes each call. Replication revisions are kept locally under the same rules: a creator-bound first revision, then in-order appends by editors until frozen.",
    ),
    userVisibleDifference: "On Tezos an auditor seals each observation, because Michelson cannot read a past block hash; on EVM anyone can.",
    open: "Sealing an observation is auditor-only on Tezos. Opening it to anyone needs an onchain check of a past block hash, which Michelson does not provide. Replication campaigns follow EVM's rules for currency, admission, carrier policy authority, lease expiry and refusal order, and all three registries originate in the Octez mockup.",
  },
  {
    id: "identity.graph",
    area: "identity",
    studioCall: "Publish a library, plugin or module",
    status: "partial",
    evm: evm(["KeelGraphRegistry", "KeelLibraryRegistry", "KeelPluginRegistry", "KeelModuleReviewRegistry"], "Manifests, libraries and reviews. Only purchaseAccess takes payment. A token gate probes balanceOf(address), and a failed probe counts as zero."),
    tezos: tez(
      ["KeelGraphRegistry", "KeelLibraryRegistry", "KeelLibraryAccessRegistry", "KeelPluginRegistry", "KeelModuleReviewRegistry"],
      "Manifests, libraries and reviews. The library is two contracts: assets and policies, and acquisitions; resolveKeelTezosCall routes each library call. Only purchase_access takes tez. A token gate names an FA2 token ID and reads the TZIP-12 get_balance(owner, token_id) -> nat view; publication refuses a token whose view does not answer, and a later missing view counts as zero. The proof views check ordinary access first, as on EVM.",
    ),
    userVisibleDifference: "A Tezos token gate names one FA2 token ID, because FA2 balances are per token; an EVM gate reads balanceOf(account) across the contract. A gate token without the FA2 view is refused at publication (GATE_TOKEN_VIEW).",
    open: "A Tezos token gate covers one FA2 token ID. Gating on any token of an FA2 contract needs a view that FA2 does not standardise.",
  },
  // ── Anchors and proofs ───────────────────────────────────────────────────
  {
    id: "anchors.signed",
    area: "anchors",
    studioCall: "Anchor content with a signed approval",
    status: "parity",
    evm: evm(["KeelSignedAnchorVerifier"], "Fixed-key approvals into the anchor registry."),
    tezos: tez(["KeelSignedAnchorVerifier", "KeelAnchorReceiptRegistry"], "Fixed-key approvals into native receipts."),
    userVisibleDifference: false,
  },
  {
    id: "anchors.bitcoin",
    area: "anchors",
    studioCall: "Anchor to Bitcoin",
    status: "adapter-different",
    evm: evm(["KeelZkAnchorVerifier"], "ZK-proven header chains; content completes an attested anchor request after the local bytes are hashed."),
    tezos: tez(["KeelBtcHeaderChain", "KeelAnchorReceiptRegistry"], "Checks the headers natively under the same work, median-time, confirmation and freshness rules; content is reported as a native receipt after the local bytes are hashed."),
    userVisibleDifference: false,
  },
  {
    id: "anchors.zk-and-l2",
    area: "anchors",
    studioCall: "Accept a ZK or L2 proof",
    status: "evm-only",
    evm: evm(["KeelSp1GatewayProofVerifier", "KeelZkVerifyProofVerifier", "KeelL2AnchorVerifier", "KeelIpfsCidVerifier"], "SP1, zkVerify, OP/Arbitrum and IPFS CID verifiers."),
    tezos: null,
    userVisibleDifference: false,
    closest: {
      behaviour: "A signed approval into the native receipt registry; a later proof adapter adds its own receipt.",
      reason: "SP1 Groth16 needs BN254 pairing, which Tezos lacks; the zkVerify, L2 and IPFS CID verifiers have no native port. No native proof circuit is claimed.",
    },
  },
  {
    id: "anchors.ethereum-on-tezos",
    area: "anchors",
    studioCall: "Prove Ethereum state on Tezos",
    status: "tezos-only",
    evm: null,
    tezos: tez(["KeelEthLightClient", "KeelEthStateProof", "KeelEthAttachmentRegistry"], "Light-client-checked Ethereum state attachments."),
    userVisibleDifference: false,
    closest: { behaviour: "Ethereum reads its own state directly.", reason: "Not needed on Ethereum." },
  },
]);

export type KeelChainCapabilityResolution =
  | { readonly supported: true; readonly capability: KeelChainCapability; readonly adapter: KeelChainAdapter }
  | {
      readonly supported: false;
      readonly code: "KEEL_CHAIN_CAPABILITY_UNSUPPORTED";
      readonly capability: KeelChainCapability;
      readonly family: KeelChainFamily;
      readonly closest: KeelChainClosestBehaviour;
    };

/** Returns the adapter for `family`, or the closest secure supported behaviour and why. */
export function resolveKeelChainCapability(id: string, family: KeelChainFamily): KeelChainCapabilityResolution {
  const capability = KEEL_CHAIN_CAPABILITIES.find((entry) => entry.id === id);
  if (capability === undefined) throw new RangeError(`Unknown KEEL chain capability ${id}.`);
  if (family !== "ethereum" && family !== "tezos") throw new RangeError(`Unknown chain family ${String(family)}.`);
  const unsupported = (family === "ethereum" && capability.status === "tezos-only") || (family === "tezos" && capability.status === "evm-only");
  const adapter = family === "ethereum" ? capability.evm : capability.tezos;
  if (!unsupported && adapter !== null) return { supported: true, capability, adapter };
  return { supported: false, code: "KEEL_CHAIN_CAPABILITY_UNSUPPORTED", capability, family, closest: capability.closest! };
}

/** Thrown when a Studio call names a capability the selected chain cannot run. */
export class KeelChainCapabilityError extends Error {
  readonly code = "KEEL_CHAIN_CAPABILITY_UNSUPPORTED" as const;
  readonly capability: string;
  readonly family: KeelChainFamily;
  readonly closest: KeelChainClosestBehaviour;

  constructor(capability: string, family: KeelChainFamily, closest: KeelChainClosestBehaviour) {
    super(`${capability} is not available on ${family}. Closest: ${closest.behaviour} (${closest.reason})`);
    this.name = "KeelChainCapabilityError";
    this.capability = capability;
    this.family = family;
    this.closest = closest;
  }
}

/** Throws KeelChainCapabilityError unless `family` supports the capability; returns its adapter. */
export function assertKeelChainCapability(id: string, family: KeelChainFamily): KeelChainAdapter {
  const resolution = resolveKeelChainCapability(id, family);
  if (!resolution.supported) throw new KeelChainCapabilityError(id, family, resolution.closest);
  return resolution.adapter;
}

/** Counts for reports: how many capabilities sit at each status. */
export function summarizeKeelChainCapabilities(): Readonly<Record<KeelChainCapabilityStatus, number>> {
  const counts: Record<KeelChainCapabilityStatus, number> = { parity: 0, "adapter-different": 0, partial: 0, "evm-only": 0, "tezos-only": 0 };
  for (const entry of KEEL_CHAIN_CAPABILITIES) counts[entry.status] += 1;
  return counts;
}
