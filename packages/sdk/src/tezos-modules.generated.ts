// Generated from keel-contracts module manifests by script/tezos/generate-sdk-catalog.mjs.
// Source availability only; this catalogue makes no deployment or behavioral-parity claim.
// Shared declarations are inherited source components, not origination targets.
// Entrypoints and views include methods inherited from shared source components.
// Splits name the pieces, in origination order, that together implement one EVM contract.
// Bindings are one-time calls, after every piece is originated, that wire one piece to another.
export interface KeelTezosModule { readonly id: string; readonly sources: string; readonly contracts: readonly string[]; readonly deployable: readonly string[]; readonly shared?: readonly string[]; readonly splits?: Readonly<Record<string, readonly string[]>>; readonly bindings?: Readonly<Record<string, readonly { readonly on: string; readonly entrypoint: string; readonly argument: string }[]>>; readonly entrypoints: Readonly<Record<string, readonly string[]>>; readonly views: Readonly<Record<string, readonly string[]>>; }
export const KEEL_TEZOS_MODULES: readonly KeelTezosModule[] = [
  {
    "id": "keel-anchors",
    "sources": "src/modules/keel-anchors/tezos",
    "contracts": [
      "keel_anchor_receipt_registry.py",
      "keel_anchor_types.py",
      "keel_btc_header_chain.py",
      "keel_eth_attachment_registry.py",
      "keel_eth_hash_verifier.py",
      "keel_eth_light_client.py",
      "keel_eth_proof_controller.py",
      "keel_eth_state_proof.py",
      "keel_signed_anchor_verifier.py"
    ],
    "deployable": [
      "KeelAnchorReceiptRegistry",
      "KeelBtcHeaderChain",
      "KeelEthAccountProof",
      "KeelEthAttachmentRegistry",
      "KeelEthHashVerifier",
      "KeelEthLightClient",
      "KeelEthProofController",
      "KeelEthStateProof",
      "KeelGovernedEthAttachmentRegistry",
      "KeelSignedAnchorVerifier"
    ],
    "entrypoints": {
      "KeelAnchorReceiptRegistry": [
        "record_receipt",
        "register_verifier",
        "retire_verifier"
      ],
      "KeelBtcHeaderChain": [
        "attach_receipt",
        "lock_configuration",
        "seed_anchor",
        "set_policy",
        "set_receipt_registry",
        "submit_headers",
        "verify_inscription"
      ],
      "KeelEthAccountProof": [],
      "KeelEthAttachmentRegistry": [
        "attach"
      ],
      "KeelEthHashVerifier": [],
      "KeelEthLightClient": [
        "bootstrap",
        "cache_keys",
        "update"
      ],
      "KeelEthProofController": [
        "accept_manager",
        "activate",
        "approve",
        "cancel",
        "expire",
        "nominate_manager",
        "propose",
        "recover",
        "resume",
        "suspend"
      ],
      "KeelEthStateProof": [
        "verify_inclusion"
      ],
      "KeelGovernedEthAttachmentRegistry": [
        "attach"
      ],
      "KeelSignedAnchorVerifier": [
        "retire",
        "submit_attestation"
      ]
    },
    "views": {
      "KeelAnchorReceiptRegistry": [
        "claim_id",
        "receipt",
        "verifier"
      ],
      "KeelBtcHeaderChain": [
        "anchor_of",
        "best",
        "is_anchor",
        "is_verified",
        "receipt_of",
        "source_status",
        "verification_profile"
      ],
      "KeelEthAccountProof": [
        "verify_account"
      ],
      "KeelEthAttachmentRegistry": [
        "attachment",
        "profile_id",
        "profile_status",
        "source_status"
      ],
      "KeelEthHashVerifier": [
        "configuration_hash",
        "verify"
      ],
      "KeelEthLightClient": [
        "configuration_hash",
        "finalized_execution_root",
        "source_status"
      ],
      "KeelEthProofController": [
        "is_admitted",
        "profile",
        "status"
      ],
      "KeelEthStateProof": [
        "last",
        "verify",
        "verify_account"
      ],
      "KeelGovernedEthAttachmentRegistry": [
        "admission_controller",
        "attachment",
        "profile_id",
        "profile_status",
        "source_status"
      ],
      "KeelSignedAnchorVerifier": [
        "nonce_used",
        "signing_payload",
        "verification_profile"
      ]
    }
  },
  {
    "id": "keel-artifacts",
    "sources": "src/modules/keel-artifacts/tezos",
    "contracts": [
      "keel_access_controller.py",
      "keel_artifact_registry.py",
      "keel_harness_registry.py",
      "keel_immutable_checkpoint.py",
      "keel_link_registry.py",
      "keel_manager.py",
      "keel_manager_types.py",
      "keel_seed_registry.py",
      "keel_signature_authority.py"
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
    ],
    "entrypoints": {
      "KeelAccessController": [
        "configure_policy",
        "configure_role",
        "execute_role",
        "finish_execution",
        "pause",
        "unpause"
      ],
      "KeelArtifactRegistry": [
        "append_artifact_revision",
        "claim_protocol_fees",
        "default",
        "forge_artifact",
        "forge_artifact_for",
        "forge_with_revision_policy",
        "freeze_artifact",
        "set_forging_fee",
        "set_publication_job",
        "set_revision_policy"
      ],
      "KeelHarnessRegistry": [
        "activate_fork",
        "append_harness_revision",
        "cancel_pending_fork",
        "forge_harness",
        "forge_harness_for",
        "fork_harness_for_token",
        "freeze_harness",
        "freeze_token_fork",
        "set_publication_job"
      ],
      "KeelImmutableCheckpointRegistry": [
        "append_checkpoint_slug",
        "begin_checkpoint",
        "seal_checkpoint"
      ],
      "KeelLinkRegistry": [
        "publish_fidelity_links"
      ],
      "KeelManager": [
        "accept_governor_reconfiguration",
        "activate_governor_change",
        "approve",
        "cancel_governor_reconfiguration",
        "configure_module",
        "configure_rpc_host_list",
        "expire_governor_reconfiguration",
        "finish_governance_execution",
        "freeze_module",
        "propose",
        "schedule_governor_change"
      ],
      "KeelSeedRegistry": [
        "publish_mint_seed_set",
        "publish_seed_set"
      ],
      "KeelSignatureAuthority": [
        "approve_signature",
        "approve_signature_automation",
        "configure_automation_key",
        "configure_pauser",
        "configure_signature_grant",
        "pause",
        "revoke_signature",
        "unpause"
      ]
    },
    "views": {
      "KeelAccessController": [
        "capability_key_of",
        "role_security"
      ],
      "KeelArtifactRegistry": [
        "artifact_creator",
        "artifact_is_frozen",
        "artifact_lineage",
        "artifact_owner",
        "artifact_revision",
        "artifact_revision_descriptor",
        "artifact_revision_exists",
        "artifact_revision_source",
        "artifact_revisions_exist",
        "can_edit_artifact",
        "forging_fee",
        "keel_hold",
        "latest_artifact_revision",
        "manager",
        "predict_artifact_id",
        "protocol_fee_recipient",
        "protocol_fees_accrued",
        "publication_job",
        "revision_policy"
      ],
      "KeelHarnessRegistry": [
        "artifact_registry",
        "effective_harness",
        "harness_collection",
        "harness_creator",
        "harness_lineage",
        "harness_revision",
        "harness_revision_commitment",
        "harness_revision_exists",
        "harness_revision_publisher",
        "harness_slots",
        "keel_index",
        "latest_harness_revision",
        "manager",
        "predict_harness_id",
        "publication_job",
        "token_fork_lineage",
        "token_fork_revision",
        "token_fork_selections"
      ],
      "KeelImmutableCheckpointRegistry": [
        "get_checkpoint",
        "get_immutable_object",
        "harness_html",
        "harness_html_with_context",
        "predict_object_id",
        "read_checkpoint_pointer",
        "read_immutable_object"
      ],
      "KeelLinkRegistry": [
        "artifact_registry",
        "compute_link_set_digest",
        "fidelity_link",
        "link_by_id",
        "link_exists",
        "link_set",
        "predict_link_id"
      ],
      "KeelManager": [
        "banner",
        "governance_threshold",
        "module",
        "resolve_module",
        "rpc_host_count",
        "rpc_host_list"
      ],
      "KeelSeedRegistry": [
        "compute_seed_set_commitment",
        "derive_token_seed",
        "harness_registry",
        "keel_index",
        "mint_entropy_enabled",
        "mint_seed_set_commitment",
        "predict_seed_set_id",
        "seed_set",
        "seed_set_collection",
        "seed_set_for_harness_revision"
      ],
      "KeelSignatureAuthority": [
        "is_signature_approved",
        "signature_signing_payload"
      ]
    }
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
    ],
    "entrypoints": {
      "KeelAttributionRegistry": [
        "remove_attribution",
        "set_attribution"
      ],
      "KeelCreatorCommitmentRegistry": [
        "publish"
      ],
      "KeelCreatorProfileRegistry": [
        "create_profile",
        "ensure_profile",
        "recover_profile",
        "update_profile"
      ]
    },
    "views": {
      "KeelAttributionRegistry": [
        "attribution",
        "attribution_by_id",
        "attribution_count",
        "attribution_id",
        "can_manage",
        "subject_attribution_ids",
        "subject_key",
        "tag_id_for"
      ],
      "KeelCreatorCommitmentRegistry": [
        "commitment_at",
        "commitment_count",
        "latest_commitment",
        "leaf",
        "resolve_authority",
        "verify"
      ],
      "KeelCreatorProfileRegistry": [
        "can_create_drop",
        "creator_id_of",
        "predict_creator_id",
        "profile",
        "profile_complete",
        "profile_of",
        "username_commitment",
        "wallet_was_bound"
      ]
    }
  },
  {
    "id": "keel-cross-chain-mint",
    "sources": "src/modules/keel-cross-chain-mint/tezos",
    "contracts": [
      "keel_cross_chain_mint_attestor.py"
    ],
    "deployable": [
      "KeelCrossChainMintAttestor"
    ],
    "entrypoints": {
      "KeelCrossChainMintAttestor": [
        "lock_configuration",
        "pause",
        "register_attestor",
        "retire_attestor",
        "set_administrator",
        "set_min_threshold_floor",
        "set_mint_target",
        "set_route",
        "submit_cross_mint",
        "unpause"
      ]
    },
    "views": {
      "KeelCrossChainMintAttestor": [
        "active_attestor_count",
        "attestor",
        "authorization_payload",
        "current_epoch",
        "is_attestor_active",
        "min_threshold_floor",
        "mint_target",
        "nonce_used",
        "route_enabled",
        "source_token_minted"
      ]
    }
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
      "KeelCollectionVerificationInspector",
      "KeelCollectionVerificationRegistry",
      "KeelCommunityReplicationRegistry",
      "KeelReplicationWorkRegistry"
    ],
    "splits": {
      "KeelCollectionVerificationRegistry": [
        "KeelCollectionVerificationInspector",
        "KeelCollectionVerificationRegistry"
      ],
      "KeelCommunityReplicationRegistry": [
        "KeelCommunityReplicationRegistry",
        "KeelReplicationWorkRegistry"
      ]
    },
    "bindings": {
      "KeelCommunityReplicationRegistry": [
        {
          "on": "KeelCommunityReplicationRegistry",
          "entrypoint": "bind_work",
          "argument": "KeelReplicationWorkRegistry"
        }
      ]
    },
    "entrypoints": {
      "KeelCollectionAttestationRegistry": [
        "revoke",
        "set_attestor",
        "set_code_identity",
        "set_threshold",
        "submit"
      ],
      "KeelCollectionVerificationHookBase": [],
      "KeelCollectionVerificationInspector": [],
      "KeelCollectionVerificationRegistry": [
        "observe_token_uri",
        "record_approved",
        "record_content_only",
        "register_adapter_identity",
        "register_collection_identity",
        "register_portable_anchor",
        "revoke",
        "seal_observation",
        "set_policy"
      ],
      "KeelCommunityReplicationRegistry": [
        "bind_object_revision",
        "bind_work",
        "create_campaign",
        "enable_external_carriers",
        "finalize_evm_carrier",
        "record_artifact_revision",
        "replace_campaign",
        "set_artifact_editor",
        "set_artifact_frozen",
        "set_campaign_enabled",
        "validate_revision_append"
      ],
      "KeelReplicationWorkRegistry": [
        "claim_carrier",
        "claim_slugs",
        "open_campaign_work",
        "release_carrier_claim",
        "release_slug_claim",
        "review_carrier_proof",
        "submit_carrier_proof",
        "submit_slug",
        "submit_slugs"
      ]
    },
    "views": {
      "KeelCollectionAttestationRegistry": [
        "attestation_digest",
        "attestation_window_open",
        "receipt"
      ],
      "KeelCollectionVerificationHookBase": [
        "keel_route",
        "keel_verification_protocol",
        "keel_verification_state"
      ],
      "KeelCollectionVerificationInspector": [
        "inspect"
      ],
      "KeelCollectionVerificationRegistry": [
        "adapter_identity",
        "approved_evidence_root",
        "inspect_current",
        "inspection_witnesses",
        "last_receipt",
        "latest_receipt",
        "policy",
        "policy_id",
        "portable_anchor",
        "presentation_content_digest",
        "receipt",
        "receipt_current"
      ],
      "KeelCommunityReplicationRegistry": [
        "active_campaign",
        "campaign_current",
        "campaign_state",
        "last_campaign_id",
        "last_content_object_id",
        "predict_artifact_id",
        "predict_campaign_id",
        "predict_content_object_id",
        "proof_verifier",
        "required_carrier_mask",
        "work_registry"
      ],
      "KeelReplicationWorkRegistry": [
        "accepted_carrier_mask",
        "campaign_carrier_status",
        "campaign_contributor_stats",
        "carrier_proof",
        "carrier_task",
        "completed_slugs",
        "global_contributor_stats",
        "object_required_carrier_mask",
        "predict_carrier_proof_digest",
        "replication_registry",
        "slug_task"
      ]
    }
  },
  {
    "id": "keel-die",
    "sources": "src/modules/keel-die/tezos",
    "contracts": [
      "keel_collection_fa2.py",
      "keel_fa2_nft.py"
    ],
    "deployable": [
      "KeelCollectionFA2"
    ],
    "shared": [
      "KeelNFTLedger"
    ],
    "entrypoints": {
      "KeelCollectionFA2": [
        "add_administrator",
        "balance_of",
        "freeze_contract_metadata",
        "freeze_default_presentation",
        "freeze_token_metadata",
        "release_capacity",
        "remove_administrator",
        "reserve_capacity",
        "set_contract_metadata",
        "set_default_presentation",
        "set_default_royalty",
        "set_keel_index",
        "set_minter",
        "set_token_json",
        "set_token_metadata",
        "set_token_owner_can_edit",
        "strike",
        "strike_unreserved",
        "transfer",
        "update_operators"
      ]
    },
    "views": {
      "KeelCollectionFA2": [
        "administrator_count",
        "contract_metadata_frozen",
        "default_presentation",
        "get_balance",
        "get_total_balance",
        "is_administrator",
        "is_minter",
        "keel_index",
        "owner_of",
        "presentation_frozen",
        "reserved_capacity_of",
        "royalty_info",
        "token_json",
        "token_metadata",
        "token_metadata_frozen",
        "token_owner_can_edit",
        "total_supply"
      ]
    }
  },
  {
    "id": "keel-graph",
    "sources": "src/modules/keel-graph/tezos",
    "contracts": [
      "keel_graph.py"
    ],
    "deployable": [
      "KeelGraphRegistry",
      "KeelLibraryAccessRegistry",
      "KeelLibraryRegistry",
      "KeelModuleReviewRegistry",
      "KeelPluginRegistry"
    ],
    "splits": {
      "KeelLibraryRegistry": [
        "KeelLibraryRegistry",
        "KeelLibraryAccessRegistry"
      ]
    },
    "entrypoints": {
      "KeelGraphRegistry": [
        "accept_publisher",
        "activate_version",
        "begin_publisher_transfer",
        "create_graph",
        "freeze_graph",
        "promote_minimum_tier",
        "publish_version"
      ],
      "KeelLibraryAccessRegistry": [
        "claim_allowlist_access",
        "purchase_access",
        "resolve_access_request",
        "submit_access_request",
        "withdraw"
      ],
      "KeelLibraryRegistry": [
        "accept_controller",
        "activate_policy",
        "begin_controller_transfer",
        "close_asset",
        "freeze_asset",
        "index_asset",
        "promote_minimum_tier",
        "publish_policy"
      ],
      "KeelModuleReviewRegistry": [
        "deprecate_module",
        "grant_approver",
        "revoke_approver",
        "revoke_module",
        "sanction_module",
        "submit_module"
      ],
      "KeelPluginRegistry": [
        "deprecate_plugin",
        "grant_approver",
        "revoke_approver",
        "revoke_plugin",
        "sanction_plugin",
        "submit_plugin"
      ]
    },
    "views": {
      "KeelGraphRegistry": [
        "active_version",
        "get_version",
        "graph",
        "graph_exists",
        "graph_kind",
        "graph_kind_opt",
        "graph_publisher",
        "graph_publisher_opt",
        "graph_record",
        "predict_graph_id",
        "version_of"
      ],
      "KeelLibraryAccessRegistry": [
        "access_request",
        "allowlist_claimed",
        "allowlist_leaf",
        "credit_of",
        "entitlement",
        "grant_count",
        "grant_record",
        "has_access",
        "has_access_at_policy",
        "has_access_with_proof",
        "has_access_with_proof_at_policy",
        "total_credit_liability"
      ],
      "KeelLibraryRegistry": [
        "active_policy",
        "asset",
        "asset_opt",
        "check_asset",
        "check_policy",
        "policy",
        "policy_commitment",
        "policy_opt",
        "predict_asset_id"
      ],
      "KeelModuleReviewRegistry": [
        "bindings_match",
        "has_approver",
        "module_authorized",
        "module_protocol",
        "review",
        "spec_digest",
        "submission"
      ],
      "KeelPluginRegistry": [
        "bindings_match",
        "has_approver",
        "plugin_protocol",
        "review",
        "spec_digest",
        "submission",
        "wallet_authorized"
      ]
    }
  },
  {
    "id": "keel-harness",
    "sources": "src/modules/keel-harness/tezos",
    "contracts": [
      "keel_harness_builder.py"
    ],
    "deployable": [
      "KeelHarnessBuilder"
    ],
    "entrypoints": {
      "KeelHarnessBuilder": [
        "freeze_shell",
        "register_shell",
        "set_keeper",
        "set_protector",
        "set_shell",
        "update_shell"
      ]
    },
    "views": {
      "KeelHarnessBuilder": [
        "base64_encode",
        "build_id",
        "harness_data_uri",
        "harness_data_uri_with_context",
        "harness_html",
        "harness_html_with_context",
        "harness_inline_uri_with_context",
        "harness_source_valid",
        "identity",
        "item_bytes",
        "percent_escape",
        "predict_shell_id",
        "protected_harness_data_uri",
        "reconstruct_html",
        "shell_data_uri",
        "shell_latest_revision",
        "shell_revision",
        "shells",
        "verified_html"
      ]
    }
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
    ],
    "entrypoints": {
      "KeelHold": [
        "cast_slug"
      ],
      "KeelHoldOnchFS": [
        "configure_verifier",
        "create_directory",
        "create_file",
        "forge_harness",
        "weld_object",
        "write_chunk"
      ],
      "KeelIndex": [
        "activate_collection_revision",
        "activate_token_revision",
        "claim_collection",
        "freeze_collection",
        "freeze_token",
        "publish_collection_revision",
        "publish_token_revision",
        "register_collection",
        "set_collection_controller",
        "set_registrar"
      ]
    },
    "views": {
      "KeelHold": [
        "haul_slug"
      ],
      "KeelHoldOnchFS": [
        "get_harness",
        "get_inode_at",
        "get_object",
        "get_verifier",
        "harness_html",
        "harness_part_count",
        "haul_harness_part",
        "haul_object",
        "haul_slug",
        "predict_harness_id",
        "predict_object_id",
        "read_chunk",
        "read_directory",
        "read_file"
      ],
      "KeelIndex": [
        "active_presentation",
        "active_revision",
        "collection_controller",
        "is_registrar",
        "presentation_matches",
        "revision_of",
        "scope_status"
      ]
    }
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
    ],
    "entrypoints": {
      "KeelIPActionExecutor": [
        "execute_download",
        "execute_mint_to_backpack",
        "execute_remint",
        "set_execution_config"
      ],
      "KeelIPBackpackFA2": [
        "balance_of",
        "deposit_to_backpack",
        "mint_to_backpack",
        "transfer",
        "update_operators",
        "withdraw_from_backpack"
      ],
      "KeelIPControl": [
        "create_policy",
        "freeze_policy",
        "grant_access",
        "revoke_access",
        "set_allowlist",
        "set_rule"
      ],
      "KeelIPLicenseRegistry": [
        "register_custom_license",
        "register_standard_license",
        "register_standard_licenses"
      ],
      "KeelIPTokenGate": [
        "set_controller",
        "set_requirements"
      ],
      "KeelIPWrappedFA2": [
        "balance_of",
        "mint_from_keel",
        "transfer",
        "update_operators"
      ]
    },
    "views": {
      "KeelIPActionExecutor": [
        "download_receipt",
        "download_receipt_id",
        "execution_config",
        "nonce",
        "policy_control",
        "signature_payload"
      ],
      "KeelIPBackpackFA2": [
        "backpack_balance",
        "backpack_id",
        "get_balance",
        "get_total_balance",
        "owner_of",
        "token_backpack",
        "token_metadata",
        "token_provenance"
      ],
      "KeelIPControl": [
        "authorization_status"
      ],
      "KeelIPLicenseRegistry": [
        "canonical_license_identifier",
        "canonical_standard_license_id",
        "get_license",
        "standard_license_id"
      ],
      "KeelIPTokenGate": [
        "evaluate",
        "is_authorized",
        "requirement_count",
        "token_requirement"
      ],
      "KeelIPWrappedFA2": [
        "get_balance",
        "get_total_balance",
        "owner_of",
        "token_metadata",
        "token_provenance"
      ]
    }
  },
  {
    "id": "keel-market",
    "sources": "src/modules/keel-market/tezos",
    "contracts": [
      "keel_market.py"
    ],
    "deployable": [
      "KeelMarket"
    ],
    "entrypoints": {
      "KeelMarket": [
        "accept_administrator",
        "accept_bid",
        "buy",
        "cancel_bid",
        "cancel_listing",
        "cancel_listing_to",
        "list",
        "nominate_administrator",
        "place_bid",
        "reclaim_expired_bid",
        "reclaim_expired_listing",
        "recover_untracked_fa2",
        "register_escrow_listing",
        "update_listing",
        "verify_delivery",
        "withdraw"
      ]
    },
    "views": {
      "KeelMarket": [
        "administrator",
        "bid",
        "bid_key",
        "bid_version",
        "credit_of",
        "liabilities",
        "listing",
        "listing_key",
        "listing_transfer_data",
        "listing_version",
        "pending_administrator",
        "platform_fee_bps",
        "platform_recipient",
        "plugin_id",
        "plugin_protocol",
        "plugin_version",
        "settlement_quote",
        "settlement_quote_digest",
        "supports_interface",
        "total_bid_escrow",
        "total_credit_liability"
      ]
    }
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
    ],
    "entrypoints": {
      "KeelMintGate": [
        "close_campaign",
        "create_campaign",
        "invalidate_authorization_nonce",
        "mint",
        "pause",
        "set_campaign_admin",
        "set_campaign_paused",
        "set_platform_configuration",
        "unpause",
        "verify_reservation",
        "withdraw"
      ],
      "OneMintController": [
        "admin_strike",
        "allowlist_mint",
        "claim_mint",
        "close_drop",
        "create_drop",
        "invalidate_nonce",
        "merkle_mint",
        "public_mint",
        "set_delegate",
        "set_drop_paused",
        "set_stage_merkle_root",
        "update_drop_supply",
        "verify_reservation",
        "withdraw"
      ]
    },
    "views": {
      "KeelMintGate": [
        "authorization_digest",
        "campaign_capacity_status",
        "get_campaign",
        "is_campaign_admin",
        "latest_campaign",
        "merkle_leaf",
        "pending_balance_of"
      ],
      "OneMintController": [
        "authorization_digest",
        "current_stage",
        "delegates",
        "effective_stage_limits",
        "get_drop",
        "get_stage",
        "is_drop_sold_out",
        "is_open_supply",
        "latest_drop_for_target",
        "merkle_leaf",
        "pending_balance_of",
        "stage_merkle_root"
      ]
    }
  },
  {
    "id": "keel-presentation",
    "sources": "src/modules/keel-presentation/tezos",
    "contracts": [
      "keel_presentation_state.py"
    ],
    "deployable": [
      "KeelPresentationStateRegistry"
    ],
    "entrypoints": {
      "KeelPresentationStateRegistry": [
        "append_inline_revision",
        "append_resource_revision",
        "configure_staking_rule",
        "create_policy",
        "seal_policy_to_onchain_object"
      ]
    },
    "views": {
      "KeelPresentationStateRegistry": [
        "current_inline_value",
        "current_presentation",
        "policy_is_immutable",
        "policy_materialization",
        "presentation_matches",
        "staking_status"
      ]
    }
  },
  {
    "id": "keel-sleeve",
    "sources": "src/modules/keel-sleeve/tezos",
    "contracts": [
      "keel_sleeve.py"
    ],
    "deployable": [
      "KeelSleeve"
    ],
    "entrypoints": {
      "KeelSleeve": []
    },
    "views": {
      "KeelSleeve": [
        "erc4804_uri",
        "source",
        "token_json",
        "token_uri"
      ]
    }
  },
  {
    "id": "keel-stake",
    "sources": "src/modules/keel-stake/tezos",
    "contracts": [
      "keel_stake_object_manager.py"
    ],
    "deployable": [
      "KeelStakeObjectManager"
    ],
    "entrypoints": {
      "KeelStakeObjectManager": [
        "configure_lockup",
        "configure_runtime",
        "create_stake_object",
        "freeze_stake_object",
        "set_enabled",
        "stake",
        "unstake",
        "verify_stake_escrow",
        "verify_unstake_delivery"
      ]
    },
    "views": {
      "KeelStakeObjectManager": [
        "global_stake_counts",
        "keel_stake_state",
        "packed_stake_counts",
        "presentation_stake_state",
        "stake_counts",
        "stake_object_active",
        "stake_object_config",
        "stake_object_frozen",
        "stake_object_runtime",
        "stake_object_state"
      ]
    }
  }
] as const;
