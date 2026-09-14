// .keel/modules/thumbnail-capture/8f48f68b345b05f28bec0efc0a94103b97d1249ac35a286f8aa3f7b5125cee18/index.js
function t() {
  let t2 = globalThis.__KEEL_THUMBNAIL__;
  if ("keel-thumbnail-capture@1" !== t2?.protocol) throw new Error("This artwork is not running in a thumbnail-aware Keel viewer.");
  return t2;
}
function a(a2 = "hero") {
  t().init(a2);
}
function n(a2 = "hero") {
  t().ready(a2);
}
function e(a2 = "hero") {
  t().stop(a2);
}
function i(a2, n2 = "hero") {
  t().after(a2, n2);
}
async function r(t2, n2 = {}) {
  a(n2.label);
  let e2 = await t2();
  return i(n2.delayMs ?? 0, n2.label), e2;
}
var o = Object.freeze({ init: a, snapshot: n, ready: n, stop: e, after: i, afterInit: r });
var l = o;

// .keel/uploads/solar-example-v2/index.js
var names = ["KEEL_solarDates"];
for (const name of names) {
  if (Object.hasOwn(globalThis, name)) throw new Error("Global already occupied: " + name);
}
var script = document.createElement("script");
script.textContent = "// Unverified upload used to demonstrate discovery and inferred argument types.\n// This fixture does not contain an astronomical dataset.\nfunction KEEL_solarDates(year = new Date().getUTCFullYear(), options = { includeLunar: false }) {\n  return { year, includeLunar: options.includeLunar, dates: [] };\n}\n";
document.head.append(script);
for (const name of names) {
  if (!Object.hasOwn(globalThis, name)) throw new Error("Observed global was not initialized: " + name);
}
var KEEL_solarDates2 = globalThis["KEEL_solarDates"];

// keel-auto-imports:keel:auto-imports
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailInit") && globalThis["KEEL_thumbnail_thumbnailInit"] !== a) throw new Error("Global already occupied: KEEL_thumbnail_thumbnailInit");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailInit")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnailInit", { value: a, enumerable: true });
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailReady") && globalThis["KEEL_thumbnail_thumbnailReady"] !== n) throw new Error("Global already occupied: KEEL_thumbnail_thumbnailReady");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailReady")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnailReady", { value: n, enumerable: true });
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailStop") && globalThis["KEEL_thumbnail_thumbnailStop"] !== e) throw new Error("Global already occupied: KEEL_thumbnail_thumbnailStop");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailStop")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnailStop", { value: e, enumerable: true });
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailAfter") && globalThis["KEEL_thumbnail_thumbnailAfter"] !== i) throw new Error("Global already occupied: KEEL_thumbnail_thumbnailAfter");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailAfter")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnailAfter", { value: i, enumerable: true });
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailAfterInit") && globalThis["KEEL_thumbnail_thumbnailAfterInit"] !== r) throw new Error("Global already occupied: KEEL_thumbnail_thumbnailAfterInit");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnailAfterInit")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnailAfterInit", { value: r, enumerable: true });
var thumbnail = o;
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnail") && globalThis["KEEL_thumbnail_thumbnail"] !== o) throw new Error("Global already occupied: KEEL_thumbnail_thumbnail");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnail")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnail", { value: o, enumerable: true });
if (Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnail") && globalThis["KEEL_thumbnail_thumbnail"] !== l) throw new Error("Global already occupied: KEEL_thumbnail_thumbnail");
if (!Object.hasOwn(globalThis, "KEEL_thumbnail_thumbnail")) Object.defineProperty(globalThis, "KEEL_thumbnail_thumbnail", { value: l, enumerable: true });
var solarDates = KEEL_solarDates2;
if (Object.hasOwn(globalThis, "KEEL_solarDates") && globalThis["KEEL_solarDates"] !== KEEL_solarDates2) throw new Error("Global already occupied: KEEL_solarDates");
if (!Object.hasOwn(globalThis, "KEEL_solarDates")) Object.defineProperty(globalThis, "KEEL_solarDates", { value: KEEL_solarDates2, enumerable: true });

// ../../packages/sdk/dist/modules.generated.js
var KEEL_MODULES = [
  {
    "id": "keel-kernel",
    "kind": "module",
    "title": "Kernel",
    "group": "core",
    "visibility": "private",
    "summary": "Admin/access primitives and encoding helpers every other module is allowed to import.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-kernel",
    "deps": [],
    "contracts": [
      "SafeAdminAccessControl.sol",
      "libraries/JsonEscape.sol",
      "libraries/KeelCodeIdentity.sol",
      "libraries/KeelCollectionFreezeValidation.sol",
      "libraries/KeelUriEscape.sol",
      "KeelFeeTreasury.sol",
      "libraries/KeelPlatformFees.sol",
      "libraries/KeelGovernance.sol",
      "KeelAccessGroups.sol",
      "KeelLocalPause.sol",
      "libraries/KeelPause.sol",
      "libraries/KeelTokenURIEnvelope.sol",
      "libraries/KeelMintSeeded.sol",
      "libraries/KeelMintSeededBatches.sol",
      "interfaces/IKeelMintSeededBatchErrors.sol",
      "interfaces/IKeelMintSeededErrors.sol",
      "interfaces/IKeelMintSeededData.sol",
      "interfaces/IKeelVrfV2Plus.sol",
      "interfaces/IKeelGovernanceErrors.sol",
      "interfaces/IKeelPlatformFeeErrors.sol",
      "interfaces/IKeelFeeTreasuryErrors.sol",
      "interfaces/IKeelFeeTreasuryEvents.sol",
      "interfaces/IKeelAccessGroupErrors.sol",
      "interfaces/IKeelAccessGroupEvents.sol",
      "KeelRecoveryGroups.sol",
      "interfaces/IKeelRecoveryErrors.sol"
    ],
    "deployable": [
      "KeelFeeTreasury",
      "KeelAccessGroups",
      "KeelRecoveryGroups"
    ]
  },
  {
    "id": "keel-codecs",
    "kind": "module",
    "title": "Codecs",
    "group": "core",
    "visibility": "private",
    "summary": "Pure, stateless decoders: RLP, Merkle-Patricia, block headers, IPFS CIDs, base32/58, BLS12-381.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-codecs",
    "deps": [],
    "contracts": [
      "libraries/KeelRlp.sol",
      "libraries/KeelBlockHeader.sol",
      "libraries/KeelMerklePatricia.sol",
      "libraries/KeelEthAccount.sol",
      "libraries/KeelOpOutputRoot.sol",
      "libraries/KeelIpfsCid.sol",
      "libraries/KeelDagPb.sol",
      "libraries/KeelBase32.sol",
      "libraries/KeelBase58.sol",
      "libraries/Bls12381.sol"
    ],
    "deployable": []
  },
  {
    "id": "keel-hold",
    "kind": "module",
    "title": "Storage",
    "group": "core",
    "visibility": "private",
    "summary": "Immutable content-addressed chunk storage and the artifact registry that activates revisions.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-hold",
    "deps": [
      "keel-kernel"
    ],
    "contracts": [
      "KeelHold.sol",
      "Ingot.sol",
      "KeelIndex.sol",
      "interfaces/IKeelHold.sol",
      "interfaces/IKeelHoldLimits.sol",
      "interfaces/IKeelHoldSeal.sol",
      "libraries/KeelSealValidation.sol",
      "libraries/KeelCastDispatch.sol",
      "interfaces/IKeelIndex.sol",
      "interfaces/IKeelHoldHarness.sol",
      "interfaces/IKeelHoldEvents.sol",
      "libraries/KeelHoldMetadata.sol",
      "interfaces/IKeelHoldErrors.sol",
      "interfaces/IKeelIndexErrors.sol",
      "interfaces/IKeelIndexEvents.sol"
    ],
    "deployable": [
      "Ingot",
      "KeelHold",
      "KeelIndex"
    ]
  },
  {
    "id": "keel-artifacts",
    "kind": "module",
    "title": "Object model",
    "group": "core",
    "visibility": "private",
    "summary": "The Keel object graph: objects, viewers, links, seeds, and the manager that fronts them.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-artifacts",
    "deps": [
      "keel-hold",
      "keel-kernel"
    ],
    "contracts": [
      "KeelArtifactRegistry.sol",
      "KeelManager.sol",
      "KeelManagerProxy.sol",
      "KeelHarnessRegistry.sol",
      "KeelLinkRegistry.sol",
      "KeelSeedRegistry.sol",
      "interfaces/IKeelMintSeedSource.sol",
      "interfaces/IKeelSeedRegistryErrors.sol",
      "interfaces/IKeelSeedRegistryEvents.sol",
      "interfaces/IKeelArtifactRegistry.sol",
      "interfaces/IKeelManager.sol",
      "interfaces/IKeelArtifactRevisionPolicy.sol",
      "interfaces/IKeelHarnessRegistry.sol",
      "interfaces/IKeelHarnessRegistryErrors.sol",
      "interfaces/IKeelHarnessRegistryEvents.sol",
      "KeelManagerRecovery.sol",
      "KeelManagerRpcPolicy.sol",
      "interfaces/IKeelManagerErrors.sol",
      "interfaces/IKeelManagerEvents.sol",
      "interfaces/IKeelManagerRecoveryErrors.sol",
      "interfaces/IKeelManagerRecoveryEvents.sol",
      "interfaces/IKeelManagerRpcErrors.sol",
      "interfaces/IKeelManagerRpcEvents.sol",
      "interfaces/IKeelManagerTypes.sol",
      "libraries/KeelManagerGovernorState.sol",
      "KeelLinkURIBuilder.sol",
      "interfaces/IKeelLinkURIBuilder.sol",
      "interfaces/IKeelLinkURIBuilderErrors.sol",
      "interfaces/IKeelLinkRegistryErrors.sol",
      "interfaces/IKeelLinkRegistryEvents.sol"
    ],
    "deployable": [
      "KeelArtifactRegistry",
      "KeelHarnessRegistry",
      "KeelLinkRegistry",
      "KeelManager",
      "KeelManagerProxy",
      "KeelSeedRegistry",
      "KeelManagerRecovery",
      "KeelManagerRpcPolicy",
      "KeelLinkURIBuilder"
    ]
  },
  {
    "id": "keel-graph",
    "kind": "module",
    "title": "Graph trust lattice",
    "group": "core",
    "visibility": "private",
    "summary": "Graph/plugin/library/module registries \u2014 the on-chain trust lattice the runtime re-derives against.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-graph",
    "deps": [],
    "contracts": [
      "KeelGraphRegistry.sol",
      "KeelPluginRegistry.sol",
      "KeelModuleReviewRegistry.sol",
      "KeelLibraryRegistry.sol",
      "KeelAssetTagRegistry.sol",
      "interfaces/IKeelGraphRegistry.sol",
      "interfaces/IKeelContractPlugin.sol"
    ],
    "deployable": [
      "KeelAssetTagRegistry",
      "KeelGraphRegistry",
      "KeelLibraryRegistry",
      "KeelModuleReviewRegistry",
      "KeelPluginRegistry"
    ]
  },
  {
    "id": "keel-harness",
    "kind": "module",
    "title": "On-chain HTML builder",
    "group": "render",
    "visibility": "private",
    "summary": "Assembles viewer HTML from chunk-stored resources entirely on chain.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-harness",
    "deps": [
      "keel-hold",
      "keel-kernel"
    ],
    "contracts": [
      "KeelHarnessBuilder.sol",
      "KeelPercentTokenURIBuilder.sol",
      "interfaces/IKeelHarnessBuilder.sol",
      "interfaces/IKeelPercentTokenURIBuilder.sol",
      "libraries/KeelHarnessContextDispatch.sol",
      "libraries/KeelPreEncodedTokenURI.sol",
      "libraries/KeelPreparedTokenURI.sol",
      "KeelObjectURIBuilder.sol",
      "KeelRawTokenURIBuilder.sol",
      "interfaces/IKeelObjectURIBuilder.sol",
      "interfaces/IKeelRawTokenURIBuilder.sol"
    ],
    "deployable": [
      "KeelHarnessBuilder",
      "KeelPercentTokenURIBuilder",
      "KeelObjectURIBuilder",
      "KeelRawTokenURIBuilder"
    ]
  },
  {
    "id": "keel-presentation",
    "kind": "module",
    "title": "Presentation state",
    "group": "core",
    "visibility": "private",
    "summary": "Presentation/visual state ledgers that record what a token currently renders as.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-presentation",
    "deps": [],
    "contracts": [
      "KeelPresentationStateRegistry.sol",
      "KeelVisualStateLedger.sol",
      "interfaces/IKeelPresentationRegistry.sol"
    ],
    "deployable": [
      "KeelPresentationStateRegistry",
      "KeelVisualStateLedger"
    ]
  },
  {
    "id": "keel-die",
    "kind": "module",
    "title": "Token base",
    "group": "token",
    "visibility": "private",
    "summary": "Compact creator-owned ERC-721/ERC-1155 collections, a shared multi-creator ERC-1155, renderer boundaries, and factories that organize them.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-die",
    "deps": [
      "keel-kernel",
      "keel-harness",
      "keel-presentation",
      "keel-artifacts",
      "keel-hold",
      "keel-codecs"
    ],
    "contracts": [
      "KEEL721.sol",
      "KeelMintSeeded721.sol",
      "KeelMintSeeded721A.sol",
      "KEEL721Deployer.sol",
      "KeelFactory.sol",
      "KeelFactorySepolia.sol",
      "KeelCreator721.sol",
      "KeelCreator721A.sol",
      "KeelCreatorSeeded721A.sol",
      "KeelSeedBlockArchive.sol",
      "KeelSeedVrfAdapter.sol",
      "interfaces/IKeelSeedVrf.sol",
      "interfaces/IKeelSeedVrfErrors.sol",
      "interfaces/IKeelSeedVrfEvents.sol",
      "interfaces/IKeelCreatorSeedErrors.sol",
      "interfaces/IKeelCreatorSeedEvents.sol",
      "KeelCreator1155.sol",
      "interfaces/IKeelCreatorLifecycleEvents.sol",
      "interfaces/IKeelCreatorItemErrors.sol",
      "interfaces/IKeelItemCapacityEvents.sol",
      "interfaces/IKeelCreator1155Events.sol",
      "KeelShared1155.sol",
      "interfaces/IKeelItemBatchMintTarget.sol",
      "interfaces/IKeelMintBatchErrors.sol",
      "interfaces/IKeelShared1155Errors.sol",
      "interfaces/IKeelShared1155Events.sol",
      "KeelCreatorFactory.sol",
      "interfaces/IKeelCreatorFactoryErrors.sol",
      "interfaces/IKeelCreatorFactoryEvents.sol",
      "KeelArtifactTokenRenderer.sol",
      "interfaces/IKeelMintable.sol",
      "interfaces/IKeelMintDataSource.sol",
      "interfaces/IKeelMintCapacity.sol",
      "interfaces/IKeelCampaignAuthorizer.sol",
      "interfaces/IKeelItemMintTarget.sol",
      "interfaces/IKeelTokenRenderer.sol",
      "interfaces/IKeelCreatorDirectory.sol",
      "KeelRawPrepared721.sol",
      "Keel721Presentation.sol",
      "interfaces/IKeel721Errors.sol",
      "interfaces/IKeel721Events.sol",
      "interfaces/IKeelCreatorCollectionErrors.sol",
      "interfaces/IKeelCreatorCollectionEvents.sol",
      "interfaces/IKeelMintTargetErrors.sol",
      "interfaces/IKeelStrikeCapacityEvents.sol",
      "interfaces/IKeel721PresentationEvents.sol",
      "KeelRouted721.sol",
      "libraries/KeelSeedBlockEntropy.sol",
      "interfaces/IKeelDeferredCollectionResolver.sol",
      "interfaces/IKeelDeferredMintSetup.sol"
    ],
    "deployable": [
      "KEEL721",
      "KEEL721Deployer",
      "KeelArtifactTokenRenderer",
      "KeelCreator1155",
      "KeelCreator721",
      "KeelCreator721A",
      "KeelCreatorSeeded721A",
      "KeelSeedBlockArchive",
      "KeelSeedVrfAdapter",
      "KeelCreatorFactory",
      "KeelFactory",
      "KeelFactorySepolia",
      "KeelShared1155",
      "KeelRawPrepared721",
      "Keel721Presentation",
      "KeelRouted721"
    ]
  },
  {
    "id": "keel-creator-identity",
    "kind": "module",
    "title": "Creator identity",
    "group": "token",
    "visibility": "private",
    "summary": "Creator profiles, commitments, and attribution records.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-creator-identity",
    "deps": [
      "keel-artifacts",
      "keel-kernel"
    ],
    "contracts": [
      "KeelCreatorProfileRegistry.sol",
      "KeelCreatorCommitmentRegistry.sol",
      "KeelAttributionRegistry.sol",
      "interfaces/IKeelCreatorProfileRegistry.sol"
    ],
    "deployable": [
      "KeelAttributionRegistry",
      "KeelCreatorCommitmentRegistry",
      "KeelCreatorProfileRegistry"
    ]
  },
  {
    "id": "keel-mint-access",
    "kind": "module",
    "title": "Mint access",
    "group": "token",
    "visibility": "private",
    "summary": "Shared mint routes, OneMint admission queues, verifiable queue/reward entropy, and community or achievement reward claims.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-mint-access",
    "deps": [
      "keel-kernel",
      "keel-die",
      "keel-creator-identity",
      "keel-hold"
    ],
    "contracts": [
      "KeelMintQueue.sol",
      "QueuePriorityHeap.sol",
      "KeelQueueAccess.sol",
      "KeelRewardClaims.sol",
      "KeelMintRewardEntropy.sol",
      "FrayAuctionIssuer.sol",
      "KeelMintGate.sol",
      "KeelMintRouteRegistry.sol",
      "interfaces/IKeelMintBatchRouteRegistry.sol",
      "interfaces/IKeelMintRouteErrors.sol",
      "interfaces/IKeelMintRouteEvents.sol",
      "OneMintCore.sol",
      "KeelOneMintBatch.sol",
      "interfaces/IKeelOneMintBatch.sol",
      "OneMintController.sol",
      "OpenOneMintController.sol",
      "interfaces/IKeelAccessGate.sol",
      "interfaces/IKeelMintAdapter.sol",
      "interfaces/IKeelMintHook.sol",
      "interfaces/IKeelMintRouteRegistry.sol",
      "interfaces/IKeelOneMintErrors.sol",
      "interfaces/IKeelMintGateErrors.sol",
      "interfaces/IKeelMintGateEvents.sol",
      "libraries/KeelMintPricing.sol",
      "libraries/KeelNftCouponClaims.sol",
      "interfaces/IKeelMintPricingErrors.sol",
      "interfaces/IKeelMintCoupons.sol",
      "interfaces/IKeelOneMintEvents.sol",
      "KeelMintReleases.sol",
      "KeelMintReleaseInspector.sol",
      "libraries/KeelReleasePolicy.sol",
      "interfaces/IKeelReleaseErrors.sol",
      "interfaces/IKeelReleaseEvents.sol",
      "KeelQueueDemand.sol",
      "KeelQueuePriority.sol",
      "KeelQueueReadAdapter.sol",
      "interfaces/IKeelQueueLifecycle.sol",
      "KeelQueueLotteryEngine.sol",
      "KeelQueueLotteryPool.sol",
      "interfaces/IKeelLotteryQueueState.sol",
      "interfaces/IKeelQueueEntropyRecovery.sol",
      "interfaces/IKeelMintRewardEntropyErrors.sol",
      "interfaces/IKeelMintRewardEntropyEvents.sol",
      "interfaces/IKeelQueueAccessErrors.sol",
      "interfaces/IKeelQueueAccessEvents.sol",
      "interfaces/IKeelQueueLotteryEngineErrors.sol",
      "interfaces/IKeelQueueLotteryPoolErrors.sol",
      "interfaces/IKeelQueueDemandErrors.sol",
      "interfaces/IKeelQueuePriorityErrors.sol",
      "interfaces/IKeelQueueReadAdapterErrors.sol",
      "interfaces/IKeelQueueDemandEvents.sol",
      "interfaces/IKeelQueuePeriod.sol",
      "interfaces/IKeelMintQueueErrors.sol",
      "interfaces/IKeelMintQueueEvents.sol",
      "interfaces/IKeelAuctionIssuer.sol",
      "interfaces/IKeelAuctionIssuerErrors.sol",
      "interfaces/IKeelAuctionIssuerEvents.sol",
      "interfaces/IKeelAuctionReleaseRouter.sol",
      "interfaces/IKeelUniqueTarget.sol",
      "interfaces/IKeelDeferredAuctionIssuer.sol",
      "interfaces/IKeelAuctionPublication.sol"
    ],
    "deployable": [
      "FrayAuctionIssuer",
      "KeelMintGate",
      "KeelMintRouteRegistry",
      "KeelOneMintBatch",
      "OneMintController",
      "OpenOneMintController",
      "KeelMintQueue",
      "KeelRewardClaims",
      "KeelMintRewardEntropy",
      "KeelQueueAccess",
      "KeelQueueDemand",
      "KeelQueuePriority",
      "KeelQueueReadAdapter",
      "KeelQueueLotteryEngine",
      "KeelQueueLotteryPool"
    ]
  },
  {
    "id": "keel-equipment",
    "kind": "module",
    "title": "Equipment",
    "group": "assets",
    "visibility": "private",
    "summary": "Token-owned equipment: inventory custody, distribution lanes, reservations, and one-use duplication.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-equipment",
    "deps": [
      "keel-kernel",
      "keel-artifacts",
      "keel-hold"
    ],
    "contracts": [
      "KeelEquipmentInventory.sol",
      "KeelEquipmentDistributor.sol",
      "KeelEquipmentReservationEngine.sol",
      "KeelEquipmentDescriptorValidator.sol",
      "KeelEquipmentInventoryReader.sol",
      "KeelOneUseDuplicator.sol",
      "interfaces/IKeelERC1155EquipmentDescriptor.sol",
      "interfaces/IKeelReservableMint1155.sol",
      "libraries/KeelMintBoundEquipmentProvision.sol"
    ],
    "deployable": [
      "KeelEquipmentDescriptorValidator",
      "KeelEquipmentDistributor",
      "KeelEquipmentInventory",
      "KeelEquipmentInventoryReader",
      "KeelEquipmentReservationEngine",
      "KeelOneUseDuplicator"
    ]
  },
  {
    "id": "keel-market",
    "kind": "module",
    "title": "Market",
    "group": "market",
    "visibility": "private",
    "summary": "The Keel marketplace plugin contract.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-market",
    "deps": [
      "keel-graph",
      "keel-kernel"
    ],
    "contracts": [
      "KeelMarket.sol"
    ],
    "deployable": [
      "KeelMarket"
    ]
  },
  {
    "id": "keel-anchors",
    "kind": "module",
    "title": "Anchors",
    "group": "provenance",
    "visibility": "private",
    "summary": "Cross-chain and off-chain anchoring: portable commitments, permissionless L2 state proofs, and zk verification backends.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-anchors",
    "deps": [
      "keel-kernel",
      "keel-codecs",
      "keel-artifacts",
      "keel-graph",
      "keel-hold"
    ],
    "contracts": [
      "KeelProofUpgradeController.sol",
      "KeelAttestedAnchorRegistry.sol",
      "KeelPortableAnchorRegistry.sol",
      "KeelAnchorReplicationBridge.sol",
      "KeelL2AnchorVerifier.sol",
      "KeelL2StateVerifier.sol",
      "KeelSettlementRegistry.sol",
      "KeelZkAnchorVerifier.sol",
      "KeelZkVerifyProofBackend.sol",
      "KeelZkVerifyProofVerifier.sol",
      "KeelSp1GatewayProofBackend.sol",
      "KeelSp1GatewayProofVerifier.sol",
      "KeelIpfsCidVerifier.sol",
      "KeelNodeRegistry.sol",
      "interfaces/IKeelAnchorProofBackend.sol",
      "interfaces/IKeelAnchorProofVerifier.sol",
      "interfaces/IKeelAnchoredChainQueries.sol",
      "interfaces/IKeelSettlementSource.sol"
    ],
    "deployable": [
      "KeelProofUpgradeController",
      "KeelAnchorReplicationBridge",
      "KeelAttestedAnchorRegistry",
      "KeelIpfsCidVerifier",
      "KeelL2AnchorVerifier",
      "KeelL2StateVerifier",
      "KeelNodeRegistry",
      "KeelPortableAnchorRegistry",
      "KeelSettlementRegistry",
      "KeelSp1GatewayProofBackend",
      "KeelSp1GatewayProofVerifier",
      "KeelZkAnchorVerifier",
      "KeelZkVerifyProofBackend",
      "KeelZkVerifyProofVerifier"
    ]
  },
  {
    "id": "keel-crucible",
    "kind": "module",
    "title": "Collection verification",
    "group": "provenance",
    "visibility": "private",
    "summary": "Collection attestation, community replication, and preservation bounties.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-crucible",
    "deps": [
      "keel-kernel",
      "keel-hold",
      "keel-artifacts"
    ],
    "contracts": [
      "KeelCollectionVerificationRegistry.sol",
      "KeelCollectionVerificationHookBase.sol",
      "KeelCollectionAttestationRegistry.sol",
      "KeelCommunityReplicationRegistry.sol",
      "interfaces/IKeelCollectionVerificationHook.sol",
      "interfaces/IKeelCollectionVerificationAdapter.sol",
      "interfaces/ICommunityHold.sol"
    ],
    "deployable": [
      "KeelCollectionAttestationRegistry",
      "KeelCollectionVerificationRegistry",
      "KeelCommunityReplicationRegistry"
    ]
  },
  {
    "id": "keel-ip-control",
    "kind": "module",
    "title": "IP control",
    "group": "provenance",
    "visibility": "private",
    "summary": "On-chain IP rights control, wrapped-721 custody, and the executor that acts on granted rights.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-ip-control",
    "deps": [
      "keel-hold",
      "keel-artifacts",
      "keel-kernel"
    ],
    "contracts": [
      "KeelIPControl.sol",
      "KeelIPActionExecutor.sol",
      "KeelIPWrapped721.sol",
      "interfaces/IKeelIPControl.sol",
      "interfaces/IKeelIPMintTarget.sol"
    ],
    "deployable": [
      "KeelIPActionExecutor",
      "KeelIPControl",
      "KeelIPWrapped721"
    ]
  },
  {
    "id": "keel-sleeve",
    "kind": "module",
    "title": "Metadata resolver",
    "group": "core",
    "visibility": "private",
    "summary": "Token JSON resolution for collections that delegate metadata assembly.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-sleeve",
    "deps": [
      "keel-hold"
    ],
    "contracts": [
      "KeelSleeve.sol",
      "interfaces/IKeelTokenJSONResolver.sol",
      "KeelStoredTokenJSON.sol",
      "KeelTokenMatrix.sol"
    ],
    "deployable": [
      "KeelSleeve",
      "KeelStoredTokenJSON",
      "KeelTokenMatrix"
    ]
  },
  {
    "id": "keel-web3-url",
    "kind": "module",
    "title": "web3:// adapter",
    "group": "render",
    "visibility": "private",
    "summary": "ERC-5219/7617 resource adapter exposing Keel content over web3:// URLs, plus its demos.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-web3-url",
    "deps": [
      "keel-hold"
    ],
    "contracts": [
      "KeelWeb3ResourceAdapter.sol",
      "interfaces/IDecentralizedApp.sol",
      "interfaces/IERC7572.sol"
    ],
    "deployable": [
      "KeelWeb3ResourceAdapter"
    ]
  },
  {
    "id": "keel-cross-chain-mint",
    "kind": "module",
    "title": "Cross-chain mint",
    "group": "token",
    "visibility": "private",
    "summary": "Bridged mint intents and the batcher that carries them between chains.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-cross-chain-mint",
    "deps": [
      "keel-kernel",
      "keel-mint-access",
      "keel-hold"
    ],
    "contracts": [
      "KeelCrossChainMintBridge.sol",
      "KeelCarrierBatcher.sol",
      "KeelHistoryPublicationJob.sol",
      "KeelPublicationJob.sol"
    ],
    "deployable": [
      "KeelCarrierBatcher",
      "KeelCrossChainMintBridge",
      "KeelHistoryPublicationJob",
      "KeelPublicationJob"
    ]
  },
  {
    "id": "keel-stake",
    "kind": "module",
    "title": "Stake objects",
    "group": "assets",
    "visibility": "private",
    "summary": "Stake-object custody and the seasonal grove state that consumes it.",
    "version": "0.3.0",
    "repo": "keel-web3/keel-stake",
    "deps": [
      "keel-artifacts",
      "keel-kernel"
    ],
    "contracts": [
      "KeelStakeObjectManager.sol"
    ],
    "deployable": [
      "KeelStakeObjectManager"
    ]
  }
];
var KEEL_APPS = [
  {
    "id": "keel-canvas",
    "kind": "app",
    "title": "Canvas",
    "group": "apps",
    "visibility": null,
    "summary": "Shared canvas renderer/splitter/composer surface that both CoolS and LINE collections render through.",
    "version": "0.3.0",
    "repo": null,
    "deps": [
      "keel-kernel",
      "keel-die",
      "keel-artifacts"
    ],
    "contracts": [
      "CoolSCanvas721.sol",
      "CoolSCanvasRenderer.sol",
      "CoolSCanvasSplitter.sol",
      "CoolSCanvasMintController.sol",
      "CoolSComposer.sol",
      "interfaces/ICoolSCanvasRenderer.sol",
      "interfaces/ICoolSCanvasSplitter.sol",
      "interfaces/ICoolSCanvasView.sol",
      "interfaces/ILINE721.sol",
      "interfaces/ILINEThumbnailSource.sol",
      "libraries/CoolSCanvasStorage.sol"
    ],
    "deployable": [
      "CoolSCanvas721",
      "CoolSCanvasMintController",
      "CoolSCanvasRenderer",
      "CoolSCanvasSplitter",
      "CoolSComposer"
    ]
  },
  {
    "id": "cool-s",
    "kind": "app",
    "title": "CoolS",
    "group": "apps",
    "visibility": null,
    "summary": "The CoolS collection: generative mint hook, metadata renderer, release resolver, novelty ledger, visual registry.",
    "version": "0.3.0",
    "repo": null,
    "deps": [
      "keel-kernel",
      "keel-die",
      "keel-equipment",
      "keel-presentation"
    ],
    "contracts": [
      "CoolS721.sol",
      "CoolSMetadataRendererV1.sol",
      "CoolSNoveltyLedgerV1.sol",
      "CoolSReleaseResolverV1.sol",
      "CoolSTargetTableV1.sol",
      "CoolSVisualRegistryV1.sol",
      "CoolSLocalVRFCoordinator.sol",
      "KeelGenerativeMintHookBase.sol",
      "interfaces/ICoolSReleaseResolverV1.sol",
      "libraries/CoolSVisualStateCodecV1.sol"
    ],
    "deployable": [
      "CoolS721",
      "CoolSLocalVRFCoordinator",
      "CoolSMetadataRendererV1",
      "CoolSNoveltyLedgerV1",
      "CoolSReleaseResolverV1",
      "CoolSTargetTableV1",
      "CoolSVisualRegistryV1"
    ]
  },
  {
    "id": "line",
    "kind": "app",
    "title": "LINE",
    "group": "apps",
    "visibility": null,
    "summary": "The LINE collection and its on-chain thumbnail renderer.",
    "version": "0.3.0",
    "repo": null,
    "deps": [
      "keel-die",
      "keel-canvas",
      "keel-artifacts"
    ],
    "contracts": [
      "LINE721.sol",
      "LINEThumbnail.sol",
      "LINEThumbnailRenderer.sol"
    ],
    "deployable": [
      "LINE721",
      "LINEThumbnail",
      "LINEThumbnailRenderer"
    ]
  },
  {
    "id": "vault-runner",
    "kind": "app",
    "title": "Vault Runner",
    "group": "apps",
    "visibility": null,
    "summary": "The Vault Runner game system: characters, packs, items, arcade/achievement registries, run settlement, map auctions.",
    "version": "0.3.0",
    "repo": null,
    "deps": [
      "keel-kernel",
      "keel-die",
      "keel-artifacts",
      "keel-hold",
      "keel-equipment",
      "keel-crucible",
      "keel-harness"
    ],
    "contracts": [
      "VaultCharacter721.sol",
      "VaultCharacterMetadataRenderer.sol",
      "VaultCharacterRegistry.sol",
      "VaultCharacterPackV2.sol",
      "VaultCharacterStarterPack.sol",
      "VaultItem1155.sol",
      "VaultGameCard.sol",
      "VaultArcadeRegistry.sol",
      "VaultAchievementRegistry.sol",
      "VaultMapAuction.sol",
      "VaultRunLeaderboard.sol",
      "VaultRunLootExtraction.sol",
      "VaultRunSignatureAuthority.sol",
      "VaultSpriteAssetRegistry.sol",
      "interfaces/IVaultRunSource.sol",
      "interfaces/IVaultHardcoreRunSource.sol",
      "interfaces/IVaultRunSignatureAuthority.sol"
    ],
    "deployable": [
      "VaultAchievementRegistry",
      "VaultArcadeRegistry",
      "VaultCharacter721",
      "VaultCharacterMetadataRenderer",
      "VaultCharacterPackV2",
      "VaultCharacterRegistry",
      "VaultCharacterStarterPack",
      "VaultGameCard",
      "VaultItem1155",
      "VaultMapAuction",
      "VaultRunLeaderboard",
      "VaultRunLootExtraction",
      "VaultRunSignatureAuthority",
      "VaultSpriteAssetRegistry"
    ]
  }
];
var KEEL_DEPLOYMENTS = [
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelArtifactRegistry",
    "address": "0xe85884ba2af3932d4f98507668ed5fe8fed6db92",
    "block": "11629038",
    "txHash": "0x235a86349768f288282f939b4decfa211bf45acf691a74dc1490c70ea0037d41"
  },
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelHarnessRegistry",
    "address": "0xa5d6ae35c327f998403aa1eb713df3741e3f3136",
    "block": "11629039",
    "txHash": "0xf7e21d4950805b330a8e11f532695586353ae1c41121efc237daee979bded83f"
  },
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelLinkRegistry",
    "address": "0xc2b94319334359171a653c93e402b12b93e24102",
    "block": "11629040",
    "txHash": "0x2ede42b1097011f7485c99e85d0eefbd2d69fbe1234d52858bdd8f68e8c42f7e"
  },
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelManager",
    "address": "0x940004faaee674c99b20ca7ecce6f877b996c3e5",
    "block": "11629033",
    "txHash": "0x0f0d3bbd3aa1266c13c763235b4fefaf999849ac971c78a9574f7a89b0d8229e"
  },
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelManagerProxy",
    "address": "0x7cb6d62cdd968ba45a8a1f0d99a02e5e274fe6e3",
    "block": "11476924",
    "txHash": "0xd651408d7ec6f222aa5a47655ce34e7f92fd02a92c58bee1f1f69c69d25455c2"
  },
  {
    "module": "keel-artifacts",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelSeedRegistry",
    "address": "0xf6b301e56c813692aeb75b9659864c7e76cf4c8b",
    "block": "11629041",
    "txHash": "0xc44f7d534294cf1f47c46c9751fa56f007fff6ee09b06080918f20e2a302e672"
  },
  {
    "module": "keel-creator-identity",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelCreatorProfileRegistry",
    "address": "0xa4112eda52ca519adaeebee7c12c4770594529fa",
    "block": "11476926",
    "txHash": "0x09edbc01e0f41681c211e2781d54ba5f8a7931ea14224bb730b24773365c51a6"
  },
  {
    "module": "keel-crucible",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelCommunityReplicationRegistry",
    "address": "0xe8a4618e7327c75631afcdd2ff7b0f4a73d42595",
    "block": "11629043",
    "txHash": "0x10993ef95265d08e7beabc0c88584f2963ddc3a021c6c4e25a50c847277d8717"
  },
  {
    "module": "keel-die",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KEEL721",
    "address": "0x71B25649E8A27992494eDAD355497c0Bea50A8e0",
    "block": "11476935",
    "txHash": "0x77739909a00b20931c21517d1594dbe386ad94ce0fdced4f6321aec16db03bde"
  },
  {
    "module": "keel-die",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelFactory",
    "address": "0x8839dab4505128378947aa2f75a0556554043ce6",
    "block": "11629044",
    "txHash": "0xba468375724a1f02bc2baec26da7a57592c89dd16e734ae7d2fc7ced562671cd"
  },
  {
    "module": "keel-equipment",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelEquipmentInventory",
    "address": "0xf4b2044c15deed5f7bf1cf3468ae8c78fcfefccf",
    "block": "11476947",
    "txHash": "0x8c82308482b93b060fb499cf284d4b57355dd59df903f47827935062a01d6f59"
  },
  {
    "module": "keel-equipment",
    "chainId": 11155111,
    "instance": "vault-runner",
    "contract": "KeelEquipmentInventory",
    "address": "0xe5f341AB0C6246E230412B464c298fa7980AAdC3",
    "block": "11484773",
    "txHash": "0x1ee75da2e0e69fb136c9d6cfb9dac31d33b0eaeb22380a074347a876dfa9ce7a"
  },
  {
    "module": "keel-graph",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelGraphRegistry",
    "address": "0x5b86439598d2091bf45971c3676eb25c5d64dca4",
    "block": "11476949",
    "txHash": "0x894cb84bf69f040db859ad9dd018c7fb62059282015e384422f6c73114ef2a72"
  },
  {
    "module": "keel-graph",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelPluginRegistry",
    "address": "0xb7a4f9d0ef9d81ab4190d847e804e27c1ea820fd",
    "block": "11476951",
    "txHash": "0x555896b004c2cf657d46ba545436dfaa7e3ea30b5ffaa06b8dd15b034ea6730f"
  },
  {
    "module": "keel-graph",
    "chainId": 11155111,
    "instance": "trusted-runtime",
    "contract": "KeelGraphRegistry",
    "address": "0x5b86439598d2091bf45971c3676eb25c5d64dca4",
    "block": null,
    "txHash": null
  },
  {
    "module": "keel-graph",
    "chainId": 11155111,
    "instance": "trusted-runtime",
    "contract": "KeelModuleReviewRegistry",
    "address": "0x9abb1f929a05e0ddf558aa9f594ec7775e28f8b2",
    "block": null,
    "txHash": null
  },
  {
    "module": "keel-harness",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelHarnessBuilder",
    "address": "0x7ac86609d6781e896c541210fdd8d1d919c5584a",
    "block": "11631488",
    "txHash": "0x822a9256583393e43a4fbca24adbc5bf8ba8f5611ae889fcdb08ae46f4a7e2d6"
  },
  {
    "module": "keel-hold",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelHold",
    "address": "0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267",
    "block": "11559677",
    "txHash": "0xae9e37ce8705258f4395498747e03682207d3a4e04e23e734086fedd01d404ef"
  },
  {
    "module": "keel-hold",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelIndex",
    "address": "0x2b706ded15fb27a582da256321f2b3295413b8ac",
    "block": "11559678",
    "txHash": "0x93bdfd7694deb532a01aee4092020b8aad25a1720317d609949ab68166e944fc"
  },
  {
    "module": "keel-ip-control",
    "chainId": 11155111,
    "instance": "ip-v1",
    "contract": "KeelIPActionExecutor",
    "address": "0x82548953d1a8baba9f4902844877FFA747ff243D",
    "block": "11491417",
    "txHash": "0xf5fcae22f51b8f381ef67c80b4f6f399e3c176936e45ba36813f49aaad8e3347"
  },
  {
    "module": "keel-ip-control",
    "chainId": 11155111,
    "instance": "ip-v1",
    "contract": "KeelIPControl",
    "address": "0x9f62Aec9E1bd5117864C6A19a7FC8C4e51F39aD0",
    "block": "11491416",
    "txHash": "0x924da433760a9ecbfbf1d146a328c065bdf04960d8133c13401763f82293113d"
  },
  {
    "module": "keel-ip-control",
    "chainId": 11155111,
    "instance": "ip-v1",
    "contract": "KeelIPWrapped721",
    "address": "0xD6290b9777B1Be895719e32900552107aADD674c",
    "block": "11491418",
    "txHash": "0x8d2653dcc830a8a400ac5c6cd10d543d3d289fc3e1a1c34701c76e79f009888d"
  },
  {
    "module": "keel-ip-control",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelIPControl",
    "address": "0x1b982718504aef51423f20856b79c62378cb62eb",
    "block": "11629049",
    "txHash": "0x6372164607cc4ac7322669f4938909cc34821ffc04c357cb808e51c008d6ba50"
  },
  {
    "module": "keel-market",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelMarket",
    "address": "0x4f9c6ea07aed067c3f04d798bf22a1e6c5c524a8",
    "block": "11629048",
    "txHash": "0x58e89f90f505e167890dba648ede9e1811083a7fd7461dafa3abc2e5fd93c0ac"
  },
  {
    "module": "keel-mint-access",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelMintGate",
    "address": "0x9f21416da06edddb7f21a70bcbc91cd732803262",
    "block": "11629047",
    "txHash": "0x8ed484bcf0319f0ecf56a3b727f0b8d7f6562d10ec81dc93bdd4fc924ea5b62f"
  },
  {
    "module": "keel-mint-access",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "KeelMintRouteRegistry",
    "address": "0x4dcc1132decf43ce72bbfad6f3ae109e85196fde",
    "block": "11629045",
    "txHash": "0xa2dd281009ab971aa62c2cd5fc58f09059075fb7615ad04c8273a2c469fb792f"
  },
  {
    "module": "keel-mint-access",
    "chainId": 11155111,
    "instance": "showcase",
    "contract": "OneMintController",
    "address": "0xc5a82b8320b6ad23cda749f079e3d7ad7b45cec9",
    "block": "11629046",
    "txHash": "0xb261303956960015186934bf8ca1131ed4f1284d3f771621897cfd4c34e5f867"
  },
  {
    "module": "vault-runner",
    "chainId": 11155111,
    "instance": "vault-runner",
    "contract": "VaultArcadeRegistry",
    "address": "0xC5356FfEBE287145AF9d52300cCd39d0A5787e01",
    "block": "11484773",
    "txHash": "0x1ee75da2e0e69fb136c9d6cfb9dac31d33b0eaeb22380a074347a876dfa9ce7a"
  },
  {
    "module": "vault-runner",
    "chainId": 11155111,
    "instance": "vault-runner",
    "contract": "VaultCharacter721",
    "address": "0xf9EaE6838C718BbeF224c4846b01e35306B60520",
    "block": "11484773",
    "txHash": "0x1ee75da2e0e69fb136c9d6cfb9dac31d33b0eaeb22380a074347a876dfa9ce7a"
  },
  {
    "module": "vault-runner",
    "chainId": 11155111,
    "instance": "vault-runner",
    "contract": "VaultCharacterPackV2",
    "address": "0xdBC33a7633130f11E2A5E020d7029E68402AC489",
    "block": "11484773",
    "txHash": "0x1ee75da2e0e69fb136c9d6cfb9dac31d33b0eaeb22380a074347a876dfa9ce7a"
  }
];

// ../../packages/sdk/dist/modules.js
function immutableModule(module) {
  return Object.freeze({
    ...module,
    deps: Object.freeze([...module.deps]),
    contracts: Object.freeze([...module.contracts]),
    deployable: Object.freeze([...module.deployable])
  });
}
var KEEL_MODULES2 = Object.freeze(KEEL_MODULES.map(immutableModule));
var KEEL_APPS2 = Object.freeze(KEEL_APPS.map(immutableModule));
var KEEL_DEPLOYMENTS2 = Object.freeze(KEEL_DEPLOYMENTS.map((deployment) => Object.freeze({ ...deployment })));
var BY_ID = new Map([...KEEL_MODULES2, ...KEEL_APPS2].map((m) => [m.id, m]));

// ../../packages/sdk/dist/module/descriptor.js
var MODULE_DESCRIPTORS = /* @__PURE__ */ new WeakSet();
var CORE_IDS = new Set(KEEL_MODULES2.map((entry) => entry.id));
var BROWSER_BINDINGS = /* @__PURE__ */ new WeakMap();
var VERIFIED_BROWSER_BINDINGS = /* @__PURE__ */ new WeakSet();
function isModuleDescriptor(value) {
  return typeof value === "object" && value !== null && MODULE_DESCRIPTORS.has(value);
}
function browserModuleCarrierBinding(descriptor) {
  return BROWSER_BINDINGS.get(descriptor);
}
function isBrowserModuleDescriptorVerified(descriptor) {
  return VERIFIED_BROWSER_BINDINGS.has(descriptor);
}
function isCoreCapabilityId(value) {
  return CORE_IDS.has(value);
}

// ../../packages/sdk/dist/module/document.js
var TRUSTED_HTML = /* @__PURE__ */ new WeakSet();
var MODULE_DOCUMENTS = /* @__PURE__ */ new WeakSet();
function defineDocument(input) {
  if (typeof input.title !== "string" || input.title.trim() === "")
    throw new TypeError("a document needs a title.");
  const lang = input.lang ?? "en";
  const mountId = input.mountId ?? "app";
  if (typeof lang !== "string" || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(lang)) {
    throw new TypeError("document lang must be a valid language tag.");
  }
  if (typeof mountId !== "string" || !/^[A-Za-z][A-Za-z0-9_:-]*$/u.test(mountId)) {
    throw new TypeError("document mountId must be a valid nonempty element id.");
  }
  if (typeof input.render !== "function")
    throw new TypeError("document render must be a function.");
  if (input.head !== void 0 && !TRUSTED_HTML.has(input.head)) {
    throw new TypeError("document head must be created with trustedHtml().");
  }
  const value = Object.freeze({
    kind: "keel-module-document@1",
    title: input.title,
    lang,
    mountId,
    ...input.head === void 0 ? {} : { head: input.head },
    render: input.render
  });
  MODULE_DOCUMENTS.add(value);
  return value;
}
function isModuleDocument(value) {
  return typeof value === "object" && value !== null && MODULE_DOCUMENTS.has(value);
}
async function mountModuleDocument(declaration) {
  const moduleDocument = declaration.document;
  if (moduleDocument === void 0 || !isModuleDocument(moduleDocument)) {
    throw new TypeError("module document must be created with defineDocument().");
  }
  document.title = moduleDocument.title;
  document.documentElement.lang = moduleDocument.lang;
  if (moduleDocument.head !== void 0)
    document.head.insertAdjacentHTML("beforeend", moduleDocument.head.source);
  let root = document.getElementById(moduleDocument.mountId);
  if (root === null) {
    root = document.createElement("div");
    root.id = moduleDocument.mountId;
    document.body.append(root);
  }
  await moduleDocument.render({ root, document });
}

// ../../packages/sdk/dist/module/define.js
var declareAsset = (kind) => (name, description = "") => {
  if (name.trim() === "")
    throw new TypeError(`a ${kind} asset needs a name.`);
  return Object.freeze({ kind, name, description });
};
var Asset = Object.freeze({
  image: declareAsset("image"),
  animation: declareAsset("animation"),
  document: declareAsset("document"),
  bytes: declareAsset("bytes")
});
function parseTarget(raw) {
  if (typeof raw !== "string") {
    throw new TypeError(`target must be a string. Got ${String(raw)}.`);
  }
  const parts = raw.split("/");
  const family = parts[1];
  const network = parts[2];
  if (parts[0] !== "@keel" || family !== "eth" && family !== "tez" || !network || parts.length > 4) {
    throw new TypeError(`target must look like "@keel/<eth|tez>/<network>", optionally with "/<surface>". Got ${JSON.stringify(raw)}.`);
  }
  return Object.freeze({ raw, family, network, surface: parts[3] ?? null });
}
var ARTIFACT_KINDS = /* @__PURE__ */ new Set(["module", "app", "collection", "object"]);
var ASSET_KINDS = /* @__PURE__ */ new Set(["image", "animation", "document", "bytes"]);
function ownDataDescriptors(value) {
  if (typeof value !== "object" || value === null)
    return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string"))
      return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.some((key) => {
      const descriptor = descriptors[key];
      return descriptor === void 0 || !("value" in descriptor);
    }))
      return null;
    return descriptors;
  } catch {
    return null;
  }
}
function snapshotAssets(value) {
  if (value === void 0)
    return Object.freeze({});
  const entries = ownDataDescriptors(value);
  if (entries === null)
    throw new TypeError("assets must be an own-data record.");
  const snapshot = {};
  for (const [assetKey, entry] of Object.entries(entries)) {
    const asset = entry.value;
    const fields = ownDataDescriptors(asset);
    if (fields === null || Reflect.ownKeys(fields).length !== 3 || fields.kind === void 0 || fields.name === void 0 || fields.description === void 0) {
      throw new TypeError(`asset ${JSON.stringify(assetKey)} must have exactly kind, name, and description data fields.`);
    }
    const kind = fields.kind.value;
    const name = fields.name.value;
    const description = fields.description.value;
    if (typeof kind !== "string" || !ASSET_KINDS.has(kind) || typeof name !== "string" || name.trim() === "" || typeof description !== "string") {
      throw new TypeError(`asset ${JSON.stringify(assetKey)} is invalid.`);
    }
    Object.defineProperty(snapshot, assetKey, {
      value: Object.freeze({ kind, name, description }),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze(snapshot);
}
function snapshotVerification(value) {
  if (value === void 0)
    return Object.freeze({ shell: true });
  const fields = ownDataDescriptors(value);
  if (fields === null)
    throw new TypeError("verification must be an own-data object.");
  const keys = Reflect.ownKeys(fields);
  if (keys.length === 1 && keys[0] === "shell" && fields.shell?.value === true) {
    return Object.freeze({ shell: true });
  }
  if (keys.length === 2 && keys.includes("shell") && keys.includes("reason") && fields.shell?.value === false && typeof fields.reason?.value === "string" && fields.reason.value.trim() !== "") {
    return Object.freeze({ shell: false, reason: fields.reason.value });
  }
  throw new TypeError("verification must be exactly { shell: true } or { shell: false, reason: nonempty }.");
}
var NPM_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
var EXACT_NPM_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
function snapshotNpm(value) {
  if (value === void 0)
    return Object.freeze({});
  const entries = ownDataDescriptors(value);
  if (entries === null)
    throw new TypeError("npm must be an own-data record without symbols or accessors.");
  const snapshot = {};
  for (const [packageName, entry] of Object.entries(entries)) {
    if (packageName.length > 214 || !NPM_PACKAGE_NAME.test(packageName)) {
      throw new TypeError(`npm package name ${JSON.stringify(packageName)} is invalid.`);
    }
    const version = entry.value;
    if (typeof version !== "string" || !EXACT_NPM_VERSION.test(version)) {
      throw new TypeError(`npm version for ${JSON.stringify(packageName)} must be an exact nonempty version.`);
    }
    Object.defineProperty(snapshot, packageName, {
      value: version,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
  return Object.freeze(snapshot);
}
function defineModule(name, input) {
  if (typeof name !== "string" || name.trim() === "")
    throw new TypeError("a module needs a name.");
  if (!ARTIFACT_KINDS.has(input.kind ?? "module")) {
    throw new TypeError(`unknown Keel artifact kind: ${String(input.kind)}.`);
  }
  const descriptorSnapshot = Object.freeze([...input.extends]);
  const ids = /* @__PURE__ */ new Set();
  const keys = /* @__PURE__ */ new Set();
  const use = [];
  const modules = [];
  const moduleBindings = [];
  const target = parseTarget(input.target);
  for (const descriptor of descriptorSnapshot) {
    if (!isModuleDescriptor(descriptor))
      throw new TypeError("extends contains an invalid Keel module descriptor.");
    if (ids.has(descriptor.id))
      throw new TypeError(`module ${name} extends ${descriptor.id} twice.`);
    if (keys.has(descriptor.key))
      throw new TypeError(`module API name ${descriptor.key} is declared twice.`);
    ids.add(descriptor.id);
    keys.add(descriptor.key);
    if (descriptor.lane === "solidity") {
      if (!isCoreCapabilityId(descriptor.id)) {
        throw new TypeError(`unknown Keel Solidity capability: ${descriptor.id}.`);
      }
      use.push(descriptor.id);
    } else {
      if (isCoreCapabilityId(descriptor.id)) {
        throw new TypeError(`${descriptor.id} is a Solidity capability, not a browser module.`);
      }
      modules.push(descriptor.id);
      const binding = browserModuleCarrierBinding(descriptor);
      if (target.surface === "browser") {
        if (binding === void 0) {
          throw new TypeError(`browser module ${descriptor.id} is not resolved to an on-chain carrier for ${target.raw}.`);
        }
        if (target.family !== "eth" || !/^eip155:[1-9][0-9]*$/u.test(target.network)) {
          throw new TypeError("publishable Ethereum browser targets must name their CAIP-2 chain, for example @keel/eth/eip155:11155111/browser.");
        }
        if (binding.chain !== target.network) {
          throw new TypeError(`browser module ${descriptor.id} is resolved on ${binding.chain}, but the project targets ${target.network}.`);
        }
        if (!isBrowserModuleDescriptorVerified(descriptor)) {
          throw new TypeError(`browser module ${descriptor.id} has not passed an exact on-chain byte read on ${target.network}.`);
        }
        moduleBindings.push(binding);
      }
    }
  }
  const verification = snapshotVerification(input.verification);
  if (input.document !== void 0 && !isModuleDocument(input.document)) {
    throw new TypeError("document must be created with defineDocument().");
  }
  const manifest = Object.freeze({
    schema: "keel-module@1",
    name,
    kind: input.kind ?? "module",
    target,
    use: Object.freeze(use),
    modules: Object.freeze(modules),
    moduleBindings: Object.freeze(moduleBindings),
    assets: snapshotAssets(input.assets),
    npm: snapshotNpm(input.npm),
    verification
  });
  return Object.freeze({
    manifest,
    extends: descriptorSnapshot,
    ...input.document === void 0 ? {} : { document: input.document },
    ...input.init === void 0 ? {} : { init: input.init }
  });
}

// ../../packages/protocol/dist/types.js
var KEEL_MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

// ../../packages/protocol/dist/bytes.js
var encoder = new TextEncoder();
var decoder = new TextDecoder("utf-8", { fatal: true });
var BASE85_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
var BASE85_VALUES = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE85_ALPHABET.length; index += 1) {
    table[BASE85_ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();
var POW85 = [1, 85, 85 ** 2, 85 ** 3, 85 ** 4];

// ../../packages/protocol/dist/packing.js
var UINT48_MAX = (1n << 48n) - 1n;

// ../../packages/protocol/dist/keel-attribution.js
var KEEL_ATTRIBUTION_ROLE_SUGGESTIONS = Object.freeze([
  "artist",
  "engineer",
  "designer",
  "writer",
  "producer",
  "contributor",
  "partner",
  "curator",
  "researcher",
  "other"
]);

// ../../packages/protocol/dist/community-replication.js
var KEEL_COMMUNITY_REPLICATION_CARRIERS = [
  "evm",
  "tezos",
  "ordinals"
];
var KEEL_COMMUNITY_REPLICATION_MIN_LEASE_SECONDS = 5 * 60;
var KEEL_COMMUNITY_REPLICATION_MAX_LEASE_SECONDS = 7 * 24 * 60 * 60;
var CARRIER_SET = new Set(KEEL_COMMUNITY_REPLICATION_CARRIERS);

// ../../packages/protocol/dist/validate.js
var UINT256_MAX = (1n << 256n) - 1n;
var THUMBNAIL_IMAGE_MEDIA = /* @__PURE__ */ new Set(["image/gif", "image/avif", "image/webp", "image/png", "image/jpeg"]);
var THUMBNAIL_ANIMATION_MEDIA = /* @__PURE__ */ new Set([...THUMBNAIL_IMAGE_MEDIA, "video/mp4"]);

// ../../packages/protocol/dist/portable.js
var PORTABLE_CHUNK_BYTES = 16384;
var PORTABLE_MAX_DECODED_BYTES = 268435456;
var PORTABLE_MAX_CHUNKS = PORTABLE_MAX_DECODED_BYTES / PORTABLE_CHUNK_BYTES;
var PortableResourceKind = {
  Viewer: 0,
  Atlas: 1,
  Codex: 2,
  Sound: 3,
  Effect: 4,
  Manifest: 5,
  Metadata: 6,
  Character: 7,
  World: 8,
  Graph: 9
};
var PortableCompression = {
  None: 0,
  Gzip: 1,
  Brotli: 2
};
var PortableEditPolicy = {
  Immutable: 0,
  AppendOnly: 1,
  ControllerRevision: 2
};
var PortableSourceFamily = {
  Ethereum: 1,
  Tezos: 2,
  Bitcoin: 3
};
var PortableGraphRole = {
  Entrypoint: 0,
  Script: 1,
  Style: 2,
  Image: 3,
  Audio: 4,
  Data: 5,
  Font: 6,
  Other: 7
};
var PORTABLE_MEDIA_TYPES = [
  "application/javascript",
  "application/json",
  "application/octet-stream",
  "application/zip",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "image/png",
  "image/webp",
  "text/css",
  "text/html",
  "text/javascript"
];
var mediaTypes = new Set(PORTABLE_MEDIA_TYPES);
var resourceKinds = new Set(Object.values(PortableResourceKind));
var compressions = new Set(Object.values(PortableCompression));
var editPolicies = new Set(Object.values(PortableEditPolicy));
var sourceFamilies = new Set(Object.values(PortableSourceFamily));
var graphRoles = new Set(Object.values(PortableGraphRole));

// ../../packages/protocol/dist/keel-verification-presentation.js
var KEEL_VERIFICATION_PRESENTATION_PROTOCOL = "keel-verification-presentation@1";
var DEFAULT_KEEL_VERIFICATION_PRESENTATION = Object.freeze({
  protocol: KEEL_VERIFICATION_PRESENTATION_PROTOCOL,
  revision: 2,
  seal: Object.freeze({
    glyph: "K",
    shape: "stamp",
    motion: "slide",
    color: "verification-state",
    sizePx: 40,
    fadeInMs: 420,
    holdMs: 650,
    fadeOutMs: 900
  }),
  overlay: Object.freeze({
    placement: "right",
    width: "wide",
    navigation: "tabs",
    initialPage: "overview"
  }),
  theme: Object.freeze({
    accent: "verification-state",
    surface: "#07120f",
    text: "#d9e8e3",
    muted: "#748d85",
    radiusPx: 22
  }),
  pages: Object.freeze([
    Object.freeze({
      id: "overview",
      label: "Proof",
      layout: "stack",
      columns: 1,
      panels: Object.freeze([
        Object.freeze({ id: "proof-summary", type: "overview", span: 1 }),
        Object.freeze({ id: "verification-checks", type: "checks", span: 1 })
      ])
    }),
    Object.freeze({
      id: "sources",
      label: "Files",
      layout: "columns",
      columns: 2,
      panels: Object.freeze([
        Object.freeze({ id: "storage-sources", type: "storage", span: 1 }),
        Object.freeze({ id: "verified-resources", type: "resources", span: 1 })
      ])
    }),
    Object.freeze({
      id: "provenance",
      label: "Trail",
      layout: "grid",
      columns: 2,
      panels: Object.freeze([
        Object.freeze({ id: "token-identity", type: "identity", span: 1 }),
        Object.freeze({ id: "version-commitments", type: "commitments", span: 1 }),
        Object.freeze({ id: "keel-object-trail", type: "object-trail", span: 2 }),
        Object.freeze({ id: "stake-object", type: "staking", span: 2 }),
        Object.freeze({ id: "contract-facets", type: "contract-facets", span: 2 })
      ])
    })
  ])
});

// ../../packages/protocol/dist/keel-rpc-policy.js
var KEEL_DEFAULT_RPC_HOSTS = Object.freeze([
  // Ethereum and EVM L2s.
  "publicnode.com",
  "rpc.thirdweb.com",
  "rpc.ankr.com",
  "cloudflare-eth.com",
  "base.org",
  "g.alchemy.com",
  "infura.io",
  "quiknode.pro",
  "drpc.org",
  // Tezos. One list covers both families: it governs which hosts may be
  // reached, and the client governs which protocol is spoken to them.
  "rpc.tzkt.io",
  "ecadinfra.com",
  "teztnets.com",
  "marigold.dev"
]);
var KEEL_LOCAL_RPC_HOSTS = Object.freeze(["localhost", "127.0.0.1"]);

// ../../packages/protocol/dist/keel-rpc.js
var DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

// ../../packages/protocol/dist/harness-tree.js
var U32 = (1n << 32n) - 1n;
var U256 = (1n << 256n) - 1n;

// ../../packages/protocol/dist/keel-release-policy.js
var KEEL_MAX_RELEASE_SUPPLY = (1n << 62n) - 1n;
var UINT64 = (1n << 64n) - 1n;

// ../../packages/sdk/dist/module/external.js
var REVIEW_REGISTRY_SELECTORS = Object.freeze({
  moduleAuthorized: "0xedb960c2",
  bindingsMatch: "0x76e89920",
  submission: "0x24ce1c3f",
  review: "0x9028d8b0"
});

// ../../packages/sdk/dist/module/template.js
var observer;
var signalReaders = /* @__PURE__ */ new WeakMap();
function signal(initial) {
  let value = initial;
  const listeners = /* @__PURE__ */ new Set();
  const result = { get value() {
    if (observer) {
      listeners.add(observer);
      dependencyCollector?.add(listeners);
    }
    return value;
  }, set value(next) {
    if (Object.is(value, next))
      return;
    value = next;
    for (const notify of [...listeners])
      notify();
  } };
  signalReaders.set(result, () => result.value);
  return result;
}
var Fragment = /* @__PURE__ */ Symbol("keel.fragment");
function jsx(type, props) {
  return { kind: "keel-template-node@1", type, props: props ?? {} };
}
var jsxs = jsx;
var mounts = /* @__PURE__ */ new WeakMap();
function mountTemplate(root, view) {
  mounts.get(root)?.();
  const document2 = root.ownerDocument;
  const cleanups = [];
  function append(parent, child, cleanup, svg = false) {
    if (child == null || typeof child === "boolean")
      return;
    if (Array.isArray(child)) {
      for (const value of child)
        append(parent, value, cleanup, svg);
      return;
    }
    const reader = typeof child === "function" ? child : typeof child === "object" ? signalReaders.get(child) : void 0;
    if (reader) {
      const start = document2.createComment("keel");
      const end = document2.createComment("/keel");
      parent.appendChild(start);
      parent.appendChild(end);
      let children = [];
      let alive = true;
      const dependencies = /* @__PURE__ */ new Set();
      const update = () => {
        if (!alive)
          return;
        for (const dispose2 of children.splice(0))
          dispose2();
        for (const dependency of dependencies)
          dependency.delete(update);
        dependencies.clear();
        while (start.nextSibling && start.nextSibling !== end)
          start.parentNode.removeChild(start.nextSibling);
        const fragment = document2.createDocumentFragment();
        const previous = observer;
        observer = update;
        const previousCollector = dependencyCollector;
        dependencyCollector = dependencies;
        try {
          append(fragment, reader(), children, svg);
        } finally {
          observer = previous;
          dependencyCollector = previousCollector;
        }
        end.parentNode.insertBefore(fragment, end);
      };
      cleanup.push(() => {
        alive = false;
        for (const dependency of dependencies)
          dependency.delete(update);
        for (const dispose2 of children)
          dispose2();
      });
      update();
      return;
    }
    if (typeof child === "string" || typeof child === "number") {
      parent.appendChild(document2.createTextNode(String(child)));
      return;
    }
    if (!(typeof child === "object" && "kind" in child && child.kind === "keel-template-node@1"))
      throw new TypeError("Unsupported KEEL template child.");
    const node = child;
    if (node.type === Fragment) {
      append(parent, node.props.children, cleanup, svg);
      return;
    }
    if (typeof node.type === "function") {
      append(parent, node.type(node.props), cleanup, svg);
      return;
    }
    const inSvg = svg || node.type === "svg";
    const element = inSvg ? document2.createElementNS("http://www.w3.org/2000/svg", node.type) : document2.createElement(node.type);
    for (const [key, value] of Object.entries(node.props)) {
      if (key === "children" || key === "key")
        continue;
      if (key === "innerHTML" || key === "dangerouslySetInnerHTML" || key === "outerHTML")
        throw new TypeError("Use template children for markup.");
      if (key === "ref") {
        if (typeof value !== "function")
          throw new TypeError("Template ref must be a function.");
        value(element);
        cleanup.push(() => value(null));
        continue;
      }
      if (/^on[A-Z]/u.test(key)) {
        if (typeof value !== "function")
          throw new TypeError("Template event handlers must be functions.");
        const event = key.slice(2).toLowerCase();
        element.addEventListener(event, value);
        cleanup.push(() => element.removeEventListener(event, value));
        continue;
      }
      const set = (next) => {
        if (key === "style" && next && typeof next === "object") {
          for (const [property, setting] of Object.entries(next))
            element.style.setProperty(property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`), String(setting));
          return;
        }
        const attribute = key === "className" ? "class" : key === "htmlFor" ? "for" : key;
        if (key === "value" || key === "checked" || key === "selected")
          element[key] = next;
        if (next == null || next === false)
          element.removeAttribute(attribute);
        else
          element.setAttribute(attribute, next === true ? "" : String(next));
      };
      const get = typeof value === "object" && value !== null ? signalReaders.get(value) : typeof value === "function" ? value : void 0;
      if (get) {
        const dependencies = /* @__PURE__ */ new Set();
        const update = () => {
          for (const dep of dependencies)
            dep.delete(update);
          dependencies.clear();
          const old = observer;
          const collector = dependencyCollector;
          observer = update;
          dependencyCollector = dependencies;
          try {
            set(get());
          } finally {
            observer = old;
            dependencyCollector = collector;
          }
        };
        update();
        cleanup.push(() => {
          for (const dep of dependencies)
            dep.delete(update);
        });
      } else
        set(value);
    }
    append(element, node.props.children, cleanup, inSvg && node.type !== "foreignObject");
    parent.appendChild(element);
  }
  root.replaceChildren();
  try {
    append(root, view, cleanups);
  } catch (error) {
    for (const cleanup of cleanups)
      cleanup();
    root.replaceChildren();
    throw error;
  }
  const dispose = () => {
    for (const cleanup of cleanups.splice(0))
      cleanup();
    root.replaceChildren();
    if (mounts.get(root) === dispose)
      mounts.delete(root);
  };
  mounts.set(root, dispose);
  return dispose;
}
var dependencyCollector;
function defineTemplate(options, view) {
  const { name, title, lang, mountId, head, extends: dependencies, ...module } = options;
  return defineModule(name, { ...module, extends: dependencies ?? [], document: defineDocument({ title, ...lang ? { lang } : {}, ...mountId ? { mountId } : {}, ...head ? { head } : {}, render: ({ root }) => {
    mountTemplate(root, view);
  } }) });
}

// src/template.tsx
function Artwork() {
  const captures = signal(0);
  const label = signal("My artwork");
  return /* @__PURE__ */ jsxs("main", { style: { fontFamily: "system-ui", padding: "32px", color: "#152436" }, children: [
    /* @__PURE__ */ jsx("h1", { children: label }),
    /* @__PURE__ */ jsx("p", { children: "KEEL templates use the same modules and types as ordinary JavaScript." }),
    /* @__PURE__ */ jsxs("label", { children: [
      "Artwork title ",
      /* @__PURE__ */ jsx("input", { value: label, onInput: (event) => {
        label.value = event.currentTarget.value;
      } })
    ] }),
    /* @__PURE__ */ jsxs("svg", { width: "320", height: "200", viewBox: "0 0 320 200", "aria-label": "Green circle artwork", children: [
      /* @__PURE__ */ jsx("rect", { width: "320", height: "200", fill: "#10202f" }),
      /* @__PURE__ */ jsx("circle", { cx: "160", cy: "100", r: "70", fill: "#76f2bf" })
    ] }),
    /* @__PURE__ */ jsx("button", { onClick: () => {
      captures.value++;
      thumbnail.snapshot(label.value);
    }, children: "Capture thumbnail" }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Captures: ",
      captures
    ] }),
    /* @__PURE__ */ jsx("p", { children: () => captures.value === 1 ? "First capture sent." : "Ready for another capture." }),
    /* @__PURE__ */ jsxs("p", { children: [
      "Unverified module: ",
      solarDates(2026).year
    ] })
  ] });
}
var template_default = defineTemplate({
  name: "template-example",
  title: "KEEL template example",
  target: "@keel/eth/sepolia"
}, /* @__PURE__ */ jsx(Artwork, {}));

// keel-bootstrap:keel-entry:art
void mountModuleDocument(template_default);
