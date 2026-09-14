// Generated from keel-contracts module manifests by script/tezos/generate-sdk-catalog.mjs.
// Source availability only; this catalogue makes no deployment or behavioral-parity claim.
export interface KeelTezosModule { readonly id: string; readonly sources: string; readonly contracts: readonly string[]; readonly deployable: readonly string[]; }
export const KEEL_TEZOS_MODULES: readonly KeelTezosModule[] = [
  {
    "id": "keel-anchors",
    "sources": "src/modules/keel-anchors/tezos",
    "contracts": [
      "keel_btc_header_chain.py",
      "keel_eth_state_proof.py"
    ],
    "deployable": [
      "KeelBtcHeaderChain",
      "KeelEthStateProof"
    ]
  },
  {
    "id": "keel-artifacts",
    "sources": "src/modules/keel-artifacts/tezos",
    "contracts": [
      "keel_artifact_registry.py",
      "keel_harness_registry.py",
      "keel_immutable_checkpoint.py",
      "keel_link_registry.py",
      "keel_manager.py",
      "keel_seed_registry.py"
    ],
    "deployable": [
      "KeelAccessController",
      "KeelArtifactRegistry",
      "KeelHarnessRegistry",
      "KeelImmutableCheckpointRegistry",
      "KeelLinkRegistry",
      "KeelManager",
      "KeelSeedRegistry",
      "KeelSignatureAuthority"
    ]
  },
  {
    "id": "keel-creator-identity",
    "sources": "src/modules/keel-creator-identity/tezos",
    "contracts": [
      "keel_creator_profile.py"
    ],
    "deployable": [
      "KeelAttributionRegistry",
      "KeelCreatorCommitmentRegistry",
      "KeelCreatorProfileRegistry"
    ]
  },
  {
    "id": "keel-cross-chain-mint",
    "sources": "src/modules/keel-cross-chain-mint/tezos",
    "contracts": [
      "keel_cross_chain_mint_attestor.py"
    ],
    "deployable": [
      "KeelCrossChainMintAttestor"
    ]
  },
  {
    "id": "keel-crucible",
    "sources": "src/modules/keel-crucible/tezos",
    "contracts": [
      "keel_crucible.py"
    ],
    "deployable": [
      "KeelCollectionAttestationRegistry",
      "KeelCollectionVerificationHookBase",
      "KeelCollectionVerificationRegistry",
      "KeelCommunityReplicationRegistry"
    ]
  },
  {
    "id": "keel-die",
    "sources": "src/modules/keel-die/tezos",
    "contracts": [
      "keel_collection_fa2.py"
    ],
    "deployable": [
      "KeelCollectionFA2"
    ]
  },
  {
    "id": "keel-equipment",
    "sources": "src/modules/keel-equipment/tezos",
    "contracts": [
      "keel_equipment.py"
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
    "id": "keel-graph",
    "sources": "src/modules/keel-graph/tezos",
    "contracts": [
      "keel_graph.py"
    ],
    "deployable": [
      "KeelGraphRegistry",
      "KeelLibraryRegistry",
      "KeelModuleReviewRegistry",
      "KeelPluginRegistry"
    ]
  },
  {
    "id": "keel-harness",
    "sources": "src/modules/keel-harness/tezos",
    "contracts": [
      "keel_harness_builder.py"
    ],
    "deployable": [
      "KeelHarnessBuilder"
    ]
  },
  {
    "id": "keel-hold",
    "sources": "src/modules/keel-hold/tezos",
    "contracts": [
      "keel_hold.py",
      "keel_hold_onchfs.py",
      "keel_index.py"
    ],
    "deployable": [
      "KeelHold",
      "KeelHoldOnchFS",
      "KeelIndex"
    ]
  },
  {
    "id": "keel-ip-control",
    "sources": "src/modules/keel-ip-control/tezos",
    "contracts": [
      "keel_ip_control.py",
      "keel_ip_action_executor.py",
      "keel_ip_action_types.py",
      "keel_ip_license.py",
      "keel_ip_token_gate.py",
      "keel_ip_wrapped_fa2.py"
    ],
    "deployable": [
      "KeelIPControl",
      "KeelIPActionExecutor",
      "KeelIPLicenseRegistry",
      "KeelIPTokenGate",
      "KeelIPWrappedFA2",
      "KeelIPBackpackFA2"
    ]
  },
  {
    "id": "keel-market",
    "sources": "src/modules/keel-market/tezos",
    "contracts": [
      "keel_market.py"
    ],
    "deployable": [
      "KeelMarket"
    ]
  },
  {
    "id": "keel-mint-access",
    "sources": "src/modules/keel-mint-access/tezos",
    "contracts": [
      "keel_mint_gate.py"
    ],
    "deployable": [
      "KeelMintGate",
      "OneMintController"
    ]
  },
  {
    "id": "keel-presentation",
    "sources": "src/modules/keel-presentation/tezos",
    "contracts": [
      "keel_presentation_state.py"
    ],
    "deployable": [
      "KeelPresentationStateRegistry"
    ]
  },
  {
    "id": "keel-sleeve",
    "sources": "src/modules/keel-sleeve/tezos",
    "contracts": [
      "keel_sleeve.py"
    ],
    "deployable": [
      "KeelSleeve"
    ]
  },
  {
    "id": "keel-stake",
    "sources": "src/modules/keel-stake/tezos",
    "contracts": [
      "keel_stake_object_manager.py"
    ],
    "deployable": [
      "KeelStakeObjectManager"
    ]
  }
] as const;
