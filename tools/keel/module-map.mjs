/**
 * Authoritative Keel module map.
 *
 * A module is an independently releasable on-chain system: its own contracts,
 * its own test suite, its own per-chain deployment record, and its own entry in
 * the SDK's module registry. Modules form a DAG — `deps` lists the modules a
 * module is allowed to import from. The boundary checker (`keel check`) fails on
 * any import that crosses a boundary not declared here.
 *
 * Assignment rule: a shared file lives in the module of its sole consumer; when
 * consumers span modules it moves down into the lowest module they all depend on.
 *
 * `kind` separates reusable protocol infrastructure ("module") from the concrete
 * products built on it ("app"). Apps consume modules exactly as an outside
 * integrator would; a module may never depend on an app, and the checker enforces
 * that. Only modules ship as their own repositories.
 *
 * `group` labels the module's role. Each module still ships as its own repository;
 * the group is the topic those repositories are tagged and browsed by:
 *   core        the object/storage/graph substrate everything else builds on
 *   render      turning stored bytes into something a browser can load
 *   token       collections, minting, and creator identity
 *   assets      things a token owns or is composed from
 *   provenance  proving where content came from and who may use it
 *   market      trading
 *   apps        concrete products built on the stack
 */
export const MODULES = [
  {
    id: "keel-kernel",
    kind: "module",
    group: "core",
    title: "Kernel",
    summary: "Admin/access primitives and encoding helpers every other module is allowed to import.",
    deps: [],
    devDeps: ["keel-artifacts", "keel-die"],
    contracts: ["SafeAdminAccessControl.sol","libraries/JsonEscape.sol","libraries/KeelCodeIdentity.sol","libraries/KeelUriEscape.sol","KeelFeeTreasury.sol","libraries/KeelPlatformFees.sol","libraries/KeelGovernance.sol","KeelAccessGroups.sol","KeelLocalPause.sol","libraries/KeelPause.sol","libraries/KeelTokenURIEnvelope.sol","libraries/KeelMintSeeded.sol","libraries/KeelMintSeededBatches.sol","interfaces/IKeelMintSeededBatchErrors.sol","interfaces/IKeelMintSeededErrors.sol","interfaces/IKeelMintSeededData.sol","interfaces/IKeelVrfV2Plus.sol","interfaces/IKeelGovernanceErrors.sol","interfaces/IKeelPlatformFeeErrors.sol","interfaces/IKeelFeeTreasuryErrors.sol","interfaces/IKeelFeeTreasuryEvents.sol","interfaces/IKeelAccessGroupErrors.sol","interfaces/IKeelAccessGroupEvents.sol","KeelRecoveryGroups.sol","interfaces/IKeelRecoveryErrors.sol","interfaces/IKeelMetadataRelay.sol","libraries/KeelMetadataSubscriptions.sol"],
  },
  {
    id: "keel-codecs",
    kind: "module",
    group: "core",
    title: "Codecs",
    summary: "Pure, stateless decoders: RLP, Merkle-Patricia, block headers, IPFS CIDs, base32/58, BLS12-381.",
    deps: [],
    devDeps: [],
    contracts: ["libraries/KeelRlp.sol","libraries/KeelBlockHeader.sol","libraries/KeelMerklePatricia.sol","libraries/KeelEthAccount.sol","libraries/KeelOpOutputRoot.sol","libraries/KeelIpfsCid.sol","libraries/KeelDagPb.sol","libraries/KeelBase32.sol","libraries/KeelBase58.sol","libraries/Bls12381.sol"],
  },
  {
    id: "keel-hold",
    kind: "module",
    group: "core",
    title: "Storage",
    summary: "Immutable content-addressed chunk storage and the artifact registry that activates revisions.",
    deps: ["keel-kernel"],
    devDeps: ["keel-harness", "keel-die", "keel-artifacts"],
    contracts: ["KeelHold.sol","Ingot.sol","KeelIndex.sol","interfaces/IKeelHold.sol","interfaces/IKeelHoldLimits.sol","interfaces/IKeelHoldSeal.sol","libraries/KeelSealValidation.sol","libraries/KeelCastDispatch.sol","interfaces/IKeelIndex.sol","interfaces/IKeelHoldHarness.sol","interfaces/IKeelHoldEvents.sol","libraries/KeelHoldMetadata.sol","interfaces/IKeelHoldErrors.sol","interfaces/IKeelIndexErrors.sol","interfaces/IKeelIndexEvents.sol","interfaces/IKeelIndexMetadataReceiver.sol"],
  },
  {
    id: "keel-artifacts",
    kind: "module",
    group: "core",
    title: "Object model",
    summary: "The Keel object graph: objects, viewers, links, seeds, and the manager that fronts them.",
    deps: ["keel-hold", "keel-kernel"],
    devDeps: ["keel-die"],
    contracts: ["KeelArtifactRegistry.sol","KeelManager.sol","KeelManagerProxy.sol","KeelHarnessRegistry.sol","KeelLinkRegistry.sol","KeelSeedRegistry.sol","interfaces/IKeelMintSeedSource.sol","interfaces/IKeelSeedRegistryErrors.sol","interfaces/IKeelSeedRegistryEvents.sol","interfaces/IKeelArtifactRegistry.sol","interfaces/IKeelManager.sol","interfaces/IKeelArtifactRevisionPolicy.sol","interfaces/IKeelHarnessRegistry.sol","interfaces/IKeelHarnessRegistryErrors.sol","interfaces/IKeelHarnessRegistryEvents.sol","KeelManagerRecovery.sol","KeelManagerRpcPolicy.sol","interfaces/IKeelManagerErrors.sol","interfaces/IKeelManagerEvents.sol","interfaces/IKeelManagerRecoveryErrors.sol","interfaces/IKeelManagerRecoveryEvents.sol","interfaces/IKeelManagerRpcErrors.sol","interfaces/IKeelManagerRpcEvents.sol","interfaces/IKeelManagerTypes.sol","libraries/KeelManagerGovernorState.sol","KeelLinkURIBuilder.sol","interfaces/IKeelLinkURIBuilder.sol","interfaces/IKeelLinkURIBuilderErrors.sol","interfaces/IKeelLinkRegistryErrors.sol","interfaces/IKeelLinkRegistryEvents.sol"],
  },
  {
    id: "keel-graph",
    kind: "module",
    group: "core",
    title: "Graph trust lattice",
    summary: "Graph/plugin/library/module registries — the on-chain trust lattice the runtime re-derives against.",
    deps: [],
    devDeps: ["keel-market"],
    contracts: ["KeelGraphRegistry.sol","KeelPluginRegistry.sol","KeelModuleReviewRegistry.sol","KeelLibraryRegistry.sol","KeelAssetTagRegistry.sol","interfaces/IKeelGraphRegistry.sol","interfaces/IKeelContractPlugin.sol"],
  },
  {
    id: "keel-harness",
    kind: "module",
    group: "render",
    title: "On-chain HTML builder",
    summary: "Assembles viewer HTML from chunk-stored resources entirely on chain.",
    deps: ["keel-hold", "keel-kernel"],
    devDeps: ["keel-die"],
    contracts: ["KeelHarnessBuilder.sol","KeelPercentTokenURIBuilder.sol","interfaces/IKeelHarnessBuilder.sol","interfaces/IKeelPercentTokenURIBuilder.sol","libraries/KeelHarnessContextDispatch.sol","libraries/KeelPreEncodedTokenURI.sol","libraries/KeelPreparedTokenURI.sol","KeelObjectURIBuilder.sol","KeelRawTokenURIBuilder.sol","interfaces/IKeelObjectURIBuilder.sol","interfaces/IKeelRawTokenURIBuilder.sol","KeelSVGRenderer.sol","interfaces/IKeelSVGRenderer.sol"],
  },
  {
    id: "keel-presentation",
    kind: "module",
    group: "core",
    title: "Presentation state",
    summary: "Presentation/visual state ledgers that record what a token currently renders as.",
    deps: [],
    devDeps: ["keel-artifacts", "keel-hold"],
    contracts: ["KeelPresentationStateRegistry.sol","KeelVisualStateLedger.sol","interfaces/IKeelPresentationRegistry.sol","interfaces/IKeelImmutableObjectSource.sol","interfaces/IKeelPresentationStateErrors.sol","interfaces/IKeelPresentationStateEvents.sol","interfaces/IKeelStakingAdapter.sol","interfaces/IKeelVisualStateLedgerErrors.sol","interfaces/IKeelVisualStateLedgerEvents.sol"],
  },
  {
    id: "keel-die",
    kind: "module",
    group: "token",
    title: "Token base",
    summary: "Compact creator-owned ERC-721/ERC-1155 collections, a shared multi-creator ERC-1155, renderer boundaries, and factories that organize them.",
    deps: ["keel-kernel", "keel-harness", "keel-presentation", "keel-artifacts", "keel-hold", "keel-codecs"],
    devDeps: ["keel-mint-access"],
    contracts: ["KEEL721.sol","KeelMintSeeded721.sol","KeelMintSeeded721A.sol","KEEL721Deployer.sol","KeelFactory.sol","KeelFactorySepolia.sol","KeelCreator721.sol","KeelCreator721A.sol","KeelCreatorSeeded721A.sol","KeelSeedBlockArchive.sol","KeelSeedVrfAdapter.sol","interfaces/IKeelSeedVrf.sol","interfaces/IKeelSeedVrfErrors.sol","interfaces/IKeelSeedVrfEvents.sol","interfaces/IKeelCreatorSeedErrors.sol","interfaces/IKeelCreatorSeedEvents.sol","KeelCreator1155.sol","interfaces/IKeelCreatorLifecycleEvents.sol","interfaces/IKeelCreatorItemErrors.sol","interfaces/IKeelItemCapacityEvents.sol","interfaces/IKeelCreator1155Events.sol","KeelShared1155.sol","interfaces/IKeelItemBatchMintTarget.sol","interfaces/IKeelMintBatchErrors.sol","interfaces/IKeelShared1155Errors.sol","interfaces/IKeelShared1155Events.sol","KeelCreatorFactory.sol","interfaces/IKeelCreatorFactoryErrors.sol","interfaces/IKeelCreatorFactoryEvents.sol","KeelArtifactTokenRenderer.sol","interfaces/IKeelMintable.sol","interfaces/IKeelMintDataSource.sol","interfaces/IKeelMintCapacity.sol","interfaces/IKeelCampaignAuthorizer.sol","interfaces/IKeelItemMintTarget.sol","interfaces/IKeelTokenRenderer.sol","interfaces/IKeelCreatorDirectory.sol","KeelRawPrepared721.sol","KeelRouted721.sol","Keel721Presentation.sol","interfaces/IKeel721Errors.sol","interfaces/IKeel721Events.sol","interfaces/IKeelCreatorCollectionErrors.sol","interfaces/IKeelCreatorCollectionEvents.sol","interfaces/IKeelMintTargetErrors.sol","interfaces/IKeelStrikeCapacityEvents.sol","interfaces/IKeel721PresentationEvents.sol","interfaces/IKeelDeferredCollectionResolver.sol","interfaces/IKeelDeferredMintSetup.sol","interfaces/IKeelMetadataEvents.sol","interfaces/IKeelMetadataReceiver.sol","libraries/Keel721MetadataFormatting.sol","libraries/KeelSeedBlockEntropy.sol"],
  },
  {
    id: "keel-creator-identity",
    kind: "module",
    group: "token",
    title: "Creator identity",
    summary: "Creator profiles, commitments, and attribution records.",
    deps: ["keel-artifacts", "keel-kernel"],
    devDeps: ["keel-hold"],
    contracts: ["KeelCreatorProfileRegistry.sol","KeelCreatorCommitmentRegistry.sol","KeelAttributionRegistry.sol","interfaces/IKeelCreatorProfileRegistry.sol"],
  },
  {
    id: "keel-mint-access",
    kind: "module",
    group: "token",
    title: "Mint access",
    summary: "Shared mint routes, OneMint admission queues, verifiable queue/reward entropy, and community or achievement reward claims.",
    deps: ["keel-kernel", "keel-die", "keel-creator-identity", "keel-hold"],
    devDeps: [],
    contracts: ["KeelMintQueue.sol","QueuePriorityHeap.sol","KeelQueueAccess.sol","KeelRewardClaims.sol","KeelMintRewardEntropy.sol","FrayAuctionIssuer.sol","KeelMintGate.sol","KeelMintRouteRegistry.sol","interfaces/IKeelMintBatchRouteRegistry.sol","interfaces/IKeelMintRouteErrors.sol","interfaces/IKeelMintRouteEvents.sol","OneMintCore.sol","KeelOneMintBatch.sol","interfaces/IKeelOneMintBatch.sol","OneMintController.sol","OpenOneMintController.sol","interfaces/IKeelAccessGate.sol","interfaces/IKeelMintAdapter.sol","interfaces/IKeelMintHook.sol","interfaces/IKeelMintRouteRegistry.sol","interfaces/IKeelOneMintErrors.sol","interfaces/IKeelMintGateErrors.sol","interfaces/IKeelMintGateEvents.sol","libraries/KeelMintPricing.sol","libraries/KeelNftCouponClaims.sol","interfaces/IKeelMintPricingErrors.sol","interfaces/IKeelMintCoupons.sol","interfaces/IKeelOneMintEvents.sol","KeelMintReleases.sol","KeelMintReleaseInspector.sol","libraries/KeelReleasePolicy.sol","interfaces/IKeelReleaseErrors.sol","interfaces/IKeelReleaseEvents.sol","KeelQueueDemand.sol","KeelQueuePriority.sol","KeelQueueReadAdapter.sol","interfaces/IKeelQueueLifecycle.sol","KeelQueueLotteryEngine.sol","KeelQueueLotteryPool.sol","interfaces/IKeelLotteryQueueState.sol","interfaces/IKeelQueueEntropyRecovery.sol","interfaces/IKeelAchievementEligibility.sol","interfaces/IKeelAuctionIssuer.sol","interfaces/IKeelAuctionIssuerErrors.sol","interfaces/IKeelAuctionIssuerEvents.sol","interfaces/IKeelAuctionPublication.sol","interfaces/IKeelAuctionReleaseRouter.sol","interfaces/IKeelDeferredAuctionIssuer.sol","interfaces/IKeelMintQueueErrors.sol","interfaces/IKeelMintQueueEvents.sol","interfaces/IKeelMintRewardEntropyErrors.sol","interfaces/IKeelMintRewardEntropyEvents.sol","interfaces/IKeelQueueAccessErrors.sol","interfaces/IKeelQueueAccessEvents.sol","interfaces/IKeelQueueDemandErrors.sol","interfaces/IKeelQueueDemandEvents.sol","interfaces/IKeelQueueLotteryEngineErrors.sol","interfaces/IKeelQueueLotteryPoolErrors.sol","interfaces/IKeelQueuePeriod.sol","interfaces/IKeelQueuePriorityErrors.sol","interfaces/IKeelQueueReadAdapterErrors.sol","interfaces/IKeelRewardClaimsErrors.sol","interfaces/IKeelRewardClaimsEvents.sol","interfaces/IKeelRewardReceiver.sol","interfaces/IKeelUniqueTarget.sol"],
  },
  {
    id: "keel-market",
    kind: "module",
    group: "market",
    title: "Market",
    summary: "The Keel marketplace plugin contract.",
    deps: ["keel-graph", "keel-kernel"],
    devDeps: [],
    contracts: ["KeelMarket.sol"],
  },
  {
    id: "keel-anchors",
    kind: "module",
    group: "provenance",
    title: "Anchors",
    summary: "Cross-chain and off-chain anchoring: portable commitments, permissionless L2 state proofs, and zk verification backends.",
    deps: ["keel-kernel", "keel-codecs", "keel-artifacts", "keel-graph", "keel-hold"],
    devDeps: ["keel-crucible"],
    contracts: ["KeelProofUpgradeController.sol","KeelAttestedAnchorRegistry.sol","KeelPortableAnchorRegistry.sol","KeelAnchorReplicationBridge.sol","KeelL2AnchorVerifier.sol","KeelL2StateVerifier.sol","KeelSettlementRegistry.sol","KeelZkAnchorVerifier.sol","KeelZkVerifyProofBackend.sol","KeelZkVerifyProofVerifier.sol","KeelSp1GatewayProofBackend.sol","KeelSp1GatewayProofVerifier.sol","KeelIpfsCidVerifier.sol","KeelNodeRegistry.sol","interfaces/IKeelAnchorProofBackend.sol","interfaces/IKeelAnchorProofVerifier.sol","interfaces/IKeelAnchoredChainQueries.sol","interfaces/IKeelSettlementSource.sol","vendor/sp1/ISP1Verifier.sol","vendor/sp1/v5.0.0/Groth16Verifier.sol","vendor/sp1/v5.0.0/SP1VerifierGroth16.sol"],
  },
  {
    id: "keel-crucible",
    kind: "module",
    group: "provenance",
    title: "Collection verification",
    summary: "Collection attestation, community replication, and preservation bounties.",
    deps: ["keel-kernel", "keel-hold", "keel-artifacts"],
    devDeps: [],
    contracts: ["KeelCollectionVerificationRegistry.sol","KeelCollectionVerificationHookBase.sol","KeelCollectionAttestationRegistry.sol","KeelCommunityReplicationRegistry.sol","interfaces/IKeelCollectionVerificationHook.sol","interfaces/IKeelCollectionVerificationAdapter.sol","interfaces/ICommunityHold.sol"],
  },
  {
    id: "keel-ip-control",
    kind: "module",
    group: "provenance",
    title: "IP control",
    summary: "On-chain IP rights control, wrapped-721 custody, and the executor that acts on granted rights.",
    deps: ["keel-hold", "keel-artifacts", "keel-kernel"],
    devDeps: [],
    contracts: ["KeelIPControl.sol","KeelIPActionExecutor.sol","KeelIPWrapped721.sol","interfaces/IKeelIPControl.sol","interfaces/IKeelIPMintTarget.sol"],
  },
  {
    id: "keel-sleeve",
    kind: "module",
    group: "core",
    title: "Metadata resolver",
    summary: "Token JSON resolution for collections that delegate metadata assembly.",
    deps: ["keel-kernel", "keel-hold"],
    devDeps: ["keel-die"],
    contracts: ["KeelSleeve.sol","interfaces/IKeelTokenJSONResolver.sol","KeelStoredTokenJSON.sol","KeelTokenMatrix.sol","interfaces/IKeelMatrixHold.sol","interfaces/IKeelTokenMatrixErrors.sol","interfaces/IKeelTokenMatrixEvents.sol","KeelMetadataRelay.sol","interfaces/IKeelMetadataRelayErrors.sol","interfaces/IKeelMetadataRelayEvents.sol","interfaces/IKeelSleeveErrors.sol","interfaces/IKeelStoredTokenJSONErrors.sol","interfaces/IKeelStoredTokenJSONEvents.sol"],
  },
  {
    id: "keel-web3-url",
    kind: "module",
    group: "render",
    title: "web3:// adapter",
    summary: "ERC-5219/7617 resource adapter exposing Keel content over web3:// URLs, plus its demos.",
    deps: ["keel-hold"],
    devDeps: [],
    contracts: ["KeelWeb3ResourceAdapter.sol","interfaces/IDecentralizedApp.sol","interfaces/IERC7572.sol"],
  },
  {
    id: "keel-cross-chain-mint",
    kind: "module",
    group: "token",
    title: "Optional cross-chain mint bridge",
    summary: "Optional attested cross-chain mint requests; not required for storage, publication, or local minting.",
    deps: ["keel-kernel", "keel-mint-access"],
    devDeps: ["keel-die", "keel-anchors", "keel-artifacts", "keel-hold"],
    contracts: ["KeelCrossChainMintBridge.sol"],
  },
  {
    id: "keel-publication",
    kind: "module",
    group: "core",
    title: "Publication",
    summary: "Optional upload batching and resumable publication jobs, including the explicitly selected history-inscription mode.",
    deps: ["keel-hold"],
    devDeps: ["keel-artifacts"],
    contracts: ["KeelCarrierBatcher.sol","KeelHistoryPublicationJob.sol","KeelPublicationJob.sol"],
  },
  {
    id: "keel-stake",
    kind: "module",
    group: "assets",
    title: "Stake objects",
    summary: "Configurable ERC-721 staking custody, frozen terms, and optional token-bound accounts.",
    deps: ["keel-artifacts", "keel-kernel"],
    devDeps: [],
    contracts: ["KeelStakeObjectManager.sol","interfaces/IKeelStakeObjectErrors.sol","interfaces/IKeelStakeObjectEvents.sol","interfaces/IKeelTokenBoundAccountRegistry.sol"],
  },
  {
    id: "keel-canvas",
    external: true, // sources live in their own repository since the 2026-08-22 split
    kind: "app",
    group: "apps",
    title: "Canvas",
    summary: "Shared canvas renderer/splitter/composer surface that both CoolS and LINE collections render through.",
    deps: ["keel-kernel", "keel-die", "keel-artifacts"],
    devDeps: ["line"],
    contracts: ["CoolSCanvas721.sol", "CoolSCanvasRenderer.sol", "CoolSCanvasSplitter.sol", "CoolSCanvasMintController.sol", "CoolSComposer.sol", "interfaces/ICoolSCanvasRenderer.sol", "interfaces/ICoolSCanvasSplitter.sol", "interfaces/ICoolSCanvasView.sol", "interfaces/ILINE721.sol", "interfaces/ILINEThumbnailSource.sol", "libraries/CoolSCanvasStorage.sol"],
  },
  {
    id: "cool-s",
    external: true, // sources live in their own repository since the 2026-08-22 split
    kind: "app",
    group: "apps",
    title: "CoolS",
    summary: "The CoolS collection: generative mint hook, metadata renderer, release resolver, novelty ledger, visual registry.",
    deps: ["keel-kernel", "keel-die", "keel-presentation"],
    devDeps: ["keel-creator-identity", "keel-harness", "keel-mint-access", "keel-artifacts", "keel-hold"],
    contracts: ["CoolS721.sol", "CoolSMetadataRendererV1.sol", "CoolSNoveltyLedgerV1.sol", "CoolSReleaseResolverV1.sol", "CoolSTargetTableV1.sol", "CoolSVisualRegistryV1.sol", "CoolSLocalVRFCoordinator.sol", "KeelGenerativeMintHookBase.sol", "interfaces/ICoolSReleaseResolverV1.sol", "libraries/CoolSVisualStateCodecV1.sol"],
  },
  {
    id: "line",
    external: true, // sources live in their own repository since the 2026-08-22 split
    kind: "app",
    group: "apps",
    title: "LINE",
    summary: "The LINE collection and its on-chain thumbnail renderer.",
    deps: ["keel-die", "keel-canvas", "keel-artifacts"],
    devDeps: [],
    contracts: ["LINE721.sol", "LINEThumbnail.sol", "LINEThumbnailRenderer.sol"],
  },
  {
    id: "vault-runner",
    external: true, // sources live in their own repository since the 2026-08-22 split
    kind: "app",
    group: "apps",
    title: "Vault Runner",
    summary: "The Vault Runner game system: characters, packs, items, arcade/achievement registries, run settlement, map auctions.",
    deps: ["keel-kernel", "keel-die", "keel-artifacts", "keel-hold", "keel-crucible", "keel-harness"],
    devDeps: [],
    contracts: ["VaultCharacter721.sol", "VaultCharacterMetadataRenderer.sol", "VaultCharacterRegistry.sol", "VaultCharacterPackV2.sol", "VaultCharacterStarterPack.sol", "VaultItem1155.sol", "VaultGameCard.sol", "VaultArcadeRegistry.sol", "VaultAchievementRegistry.sol", "VaultMapAuction.sol", "VaultRunLeaderboard.sol", "VaultRunLootExtraction.sol", "VaultRunSignatureAuthority.sol", "VaultSpriteAssetRegistry.sol", "interfaces/IVaultRunSource.sol", "interfaces/IVaultHardcoreRunSource.sol", "interfaces/IVaultRunSignatureAuthority.sol"],
  },
];

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

/** Directory tier a unit lives under: "modules" or "apps". */
export const TIER_OF = new Map(MODULES.map((m) => [m.id, m.kind === "app" ? "apps" : "modules"]));
export const isApp = (id) => TIER_OF.get(id) === "apps";

/** Import prefix a unit is addressed by from elsewhere in the tree. */
export const PREFIX_OF = new Map(MODULES.map((m) => [m.id, m.kind === "app" ? "@app" : "@keel"]));

/** module id that owns a given src-relative path, or undefined. */
export const OWNER_OF = new Map();
for (const m of MODULES) for (const c of m.contracts) OWNER_OF.set(c, m.id);
