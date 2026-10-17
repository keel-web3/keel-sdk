# KEEL Tezos route: inventory

**Status (2026-10-17, parity branch).** The SDK route (`packages/sdk/src/tezos-collection.ts`) and the 8 `keel-tezos-*` MCP collection tools target the `keel-contracts` branch `codex/tezos-behavior-parity-20261015`. They were first written against `master` and then adapted to the parity contracts: the FA2 now inherits its ledger from `keel_fa2_nft.py` (`KeelNFTLedger`), has 20 storage fields, a creator-only metadata default, `strike_unreserved` and administrator-maintained TZIP-16 metadata (`set_contract_metadata` until `freeze_contract_metadata`). The SmartPy-compiled storage of every route contract equals the SDK storage builders (`tests/tezos-collection-conformance.test.mjs`).

All tools are **prepare-only**. Each returns Micheline operations for the creator's wallet to review. Nothing signs, and every tool refuses private keys, secret keys, mnemonics and seeds, even nested in the input.

Contract paths are relative to `keel-contracts/src/modules`; line numbers are on the parity branch.

## 1. Inventory

Status values used in the table:
- **C** = compiled by `script/tezos/compile-collection-route.sh`.
- **T** = has a SmartPy scenario in `test/modules/<module>/tezos/`.
- **M** = exercised by `packages/tezos/scripts/collection-route-mockup.mjs` in an offline Octez mockup. The parity-branch mockup run is queued (see section 3); M marks what the driver covers, not a completed parity run.

| Family | Contract file:line | Status | SDK function | MCP tool | Gap |
|---|---|---|---|---|---|
| FA2 origination | `keel-die/tezos/keel_collection_fa2.py:57` `KeelCollectionFA2(admin, keel_index, max_supply)` over `keel_fa2_nft.py:46` `KeelNFTLedger` | C T M | `buildKeelTezosCollectionFA2Storage`, `prepareKeelTezosCollectionOriginations` (`holderMetadataEditing`, default false) | `keel-tezos-collection-originate-prepare` | none; TZIP-16 metadata stays editable until frozen (2.1). |
| FA2 admins | `add_administrator` :141, `remove_administrator` :150 | C T | (not needed for launch) | — | No prepare action; the raw call is catalogued. |
| FA2 minter / capacity | `set_minter` :164, `reserve_capacity` :183, `release_capacity` :196 | C T M | `prepareKeelTezosMintGate` (set_minter), `prepareKeelTezosMintGateAction({action:"set-minter"})`. OneMint `create_drop` reserves capacity. | `keel-tezos-mint-gate-prepare` | none |
| FA2 mint / batch mint | `strike` :252 (consumes the minter's own reservation first), `strike_unreserved` :258 (never consumes a reservation) | C T M | `prepareKeelTezosMint({mode:"direct", unreserved?})` | `keel-tezos-mint-prepare` | none |
| FA2 renderer / presentation | `set_keel_index` :273, `set_default_presentation` :280, `freeze_default_presentation` :303 | C T M | `prepareKeelTezosPresentationBinding` | `keel-tezos-presentation-bind-prepare` | Freezing needs `freeze: true`. |
| FA2 token metadata (TZIP-12/21) | `set_token_metadata` :315, `set_token_json` :333, `freeze_token_metadata` :342; authority `require_token_editor_` :122; `set_token_owner_can_edit` :267 | C T M | `buildKeelTezosTokenInfo`, `prepareKeelTezosTokenMetadata`, `prepareKeelTezosMintGateAction({action:"set-holder-metadata-editing"})` | `keel-tezos-token-metadata-prepare`, `keel-tezos-mint-gate-prepare` | Creator administrators rewrite until a token is frozen. Holders edit and freeze their own token only after the creator enables it, the same default as EVM KEEL721. Inline values are raw-percent `data:` URIs, never Base64. |
| FA2 ledger + views | `keel_fa2_nft.py`: `transfer` :55, `update_operators` :94, `balance_of` :109; views `get_balance` :126, `owner_of` :132, `token_metadata` :142; collection views include `total_supply`, `is_minter`, `default_presentation`, `token_owner_can_edit` | C T M | `checkKeelTezosCollectionPublication` (also checks `token_owner_can_edit`), `decodeKeelTezosTokenMetadataView` | `keel-tezos-readback-check` | none |
| Hold / OnchFS | `keel-hold/tezos/keel_hold_onchfs.py:163` `KeelHoldOnchFS`: `write_chunk` :222, `create_file` :231, `create_directory` :249, `weld_object` :273. Views `read_file` :407, `get_inode_at` :419, `get_object` :433 | C T M | `buildKeelTezosHoldOnchFSStorage`, `prepareKeelTezosHoldResources`, `keelTezosOnchfsFileCid` / `DirectoryCid`, `encodeKeelTezosOnchfsMetadata` | `keel-tezos-hold-resources-prepare` | CIDs match `onchfs@0.1.0`. The object id commits to manifest bytes; descriptor binding is an open contract review item. |
| Hold verifier / harness | `configure_verifier` :323, `forge_harness` :339, view `harness_html` :504 | C T | `buildKeelHoldConfigureVerifier`, `buildKeelForgeHarness` (`tezos-publication.ts`) | `keel-tezos-publication-prepare` | Not in the launch plan, which uses the registered shell route. |
| Hold slug store | `keel-hold/tezos/keel_hold.py:50` `KeelHold.cast_slug` :59 | C T | `buildKeelHoldCarrierOperations` | `keel-tezos-publication-prepare` | Older lane; OnchFS supersedes it for collections. |
| Index / revisions | `keel-hold/tezos/keel_index.py:236` `KeelIndex`: `register_collection` :573, `claim_collection` :600, `set_collection_controller` :623, `publish_collection_revision` :651, `publish_token_revision` :688, `activate_collection_revision` :772, `activate_token_revision` :789, `freeze_collection` :858, `freeze_token` :867. View `active_presentation` :969 | C T M | `buildKeelTezosIndexStorage`, `prepareKeelTezosPresentationBinding` (collection scope) | `keel-tezos-presentation-bind-prepare` | Per-token revisions are not prepared (2.4). |
| Presentation policy | `keel-presentation/tezos/keel_presentation_state.py:276` `KeelPresentationStateRegistry`: `create_policy` :364, `configure_staking_rule` :433, `append_inline_revision` :452, `append_resource_revision` :496, `seal_policy_to_onchain_object` :528 | C T M (create + append_resource) | `buildKeelTezosPresentationStateStorage`, `keelTezosPresentationPolicyId`, binding `presentationPolicy` | `keel-tezos-presentation-bind-prepare` | Sealing (2.3) and staking rules are not prepared. |
| Creator profile | `keel-creator-identity/tezos/keel_creator_profile.py:305` `KeelCreatorProfileRegistry(manager)`: `create_profile` :345, `ensure_profile` :413, `update_profile` :425, `recover_profile` :463. View `can_create_drop` :581 | C T M | `buildKeelTezosCreatorProfileStorage`, `prepareKeelTezosMintGate({creatorProfile})` | `keel-tezos-mint-gate-prepare` | The registry needs an originated manager KT1, or bind a shared registry. |
| Mint gate: OneMint drops | `keel-mint-access/tezos/keel_mint_gate.py:1352` `OneMintController`: `set_delegate` :1435, `create_drop` :1451, `set_drop_paused` :1606, `set_stage_merkle_root` :1616, `update_drop_supply` :1632, `close_drop` :1698, `invalidate_nonce` :1724, `withdraw` :2129 | C T M | `buildKeelTezosOneMintStorage`, `prepareKeelTezosMintGate`, `prepareKeelTezosMintGateAction`, `predictKeelTezosOneMintDropId`, `buildKeelTezosAllowlistTree`, `keelTezosOneMintMerkleLeaf` | `keel-tezos-mint-gate-prepare` | Delegates are not prepared. |
| Mint: OneMint mints | `public_mint` :1734, `merkle_mint` :1879, `admin_strike` :2080 (premint) | C T M | `prepareKeelTezosMint({mode:"public"/"merkle"/"premint"})` | `keel-tezos-mint-prepare` | none |
| Mint: signed stages | `allowlist_mint` :1789 (signer), `claim_mint` :1962 (entitlement token) | C T | — | — | Not prepared (2.2). Token payment is refused by the contract (`UNSUPPORTED_PAYMENT_TOKEN`). |
| Mint gate: campaigns | `KeelMintGate` :420: `set_platform_configuration` :503, `set_campaign_admin` :516, `create_campaign` :541, `mint` :757, `withdraw` :1013 | C T | `buildKeelTezosMintGateStorage` (storage only) | — | Campaign calls are not prepared (2.2). |
| Shell / harness builder | `keel-harness/tezos/keel_harness_builder.py:638` `KeelHarnessBuilder`: `register_shell` :718, `update_shell` :738, `freeze_shell` :745 | T | `prepareKeelTezosShell`, `keelTezosCreatorShellId` | `keel-tezos-shell-prepare` | none |
| Token-URI composer | `keel-sleeve/tezos/keel_sleeve.py:28` `KeelSleeve` (views only) | T | — | — | Marketplaces read the `token_metadata` big_map, not a view. |
| Market | `keel-market/tezos/keel_market.py:286` `KeelMarket` | T | — | — | Secondary sales are outside the launch route. |
| Network / readback | RPC `chain_id`, `script`, `run_script_view`; TzKT `/v1/head`, `/v1/contracts/{kt1}`, `/v1/tokens` | M | `checkKeelTezosCollectionPublication`, `keelTezosChainIdBytes` | `keel-tezos-readback-check`, `keel-network-inspect` | HTTPS required except for loopback. |
| Launch plan | — | — | `planKeelTezosCollectionLaunch`, `planKeelTezosStandardRoute().collectionRoute` | `keel-tezos-collection-launch-plan`, `keel-tezos-standard-route-plan` | none |

**Catalogue.** `script/tezos/generate-sdk-catalog.mjs` emits `entrypoints` and `views` per deployable class, including methods inherited from shared source components (for example `KeelCollectionFA2` inherits `transfer`, `balance_of`, `token_metadata` and `owner_of` from `KeelNFTLedger`). `assertKeelTezosEntrypoint` / `assertKeelTezosView` check every prepared call against it, and `--check` keeps `tezos-modules.generated.ts` current.

## 2. To build

Each item names the contract and the entrypoint. None of these blocks a NOCTURNES Genesis launch through the route above. Item 2.6 decides whether holders can edit their own token's metadata.

**Already built in this change:**
- the 8 MCP tools and the SDK functions above;
- the per-class entrypoint/view catalogue;
- the compile script for the route targets;
- the mockup driver;
- TZIP-21 `royalties`.

### 2.1 `KeelCollectionFA2`: contract metadata after origination: closed on the parity branch
- `set_contract_metadata(key, Some bytes | None)` and `freeze_contract_metadata()` are administrator-only; the view `contract_metadata_frozen` reports the weld. The TZIP-16 locator key `""` cannot be removed.
- SDK/MCP: `prepareKeelTezosMintGateAction({action:"set-collection-metadata", collectionMetadata})` and `{action:"freeze-collection-metadata"}`.

### 2.2 SDK only: signed OneMint stages and campaigns
- **`OneMintController.allowlist_mint`** (:1821) needs an offchain signer's signature over the stage digest. Add `prepareKeelTezosMint({mode:"signed", signature, nonce, deadline})`; the creator's signer produces the signature outside KEEL. Also add a digest helper that matches the contract's PACK record.
- **`OneMintController.claim_mint`** (:2028) needs an entitlement-token stage, `kind 8`. Add `mode:"claim"` with the entitlement FA2 and token id.
- **`KeelMintGate.create_campaign` / `mint`** (:497 / :707) need `signature`/`key`/`key_hash` options even for `signature_mode = NONE`. Add `prepareKeelTezosCampaign` and `prepareKeelTezosCampaignMint` that emit `None` for those options.
- **Token payment** (stage kind 6): the contract refuses it (`UNSUPPORTED_PAYMENT_TOKEN`). Building it is a **contract** change, an FA2/FA1.2 transfer in `public_mint` and the other mint entrypoints, and it is not small.

### 2.3 SDK only: sealing a presentation policy
- `KeelPresentationStateRegistry.seal_policy_to_onchain_object` (:524) needs a `get_immutable_object` view on `KeelImmutableCheckpointRegistry` (`keel_immutable_checkpoint.py:226`: `begin_checkpoint` :236, `append_checkpoint_slug` :264, `seal_checkpoint` :307).
- **Add:** a checkpoint origination in `prepareKeelTezosCollectionOriginations`, and a `seal: { checkpoint }` option in `prepareKeelTezosPresentationBinding` that emits begin → append → seal → `seal_policy_to_onchain_object`.

### 2.4 SDK only: per-token presentation revisions
- **Add** a `scope: "token"` option to `prepareKeelTezosPresentationBinding`. It emits `KeelIndex.publish_token_revision` (:716) and `activate_token_revision` (:817).
- **Use:** per-token animated presentations, where a collection-level revision is too coarse.

### 2.6 Holder edits of token metadata: closed on the parity branch
- `KeelCollectionFA2` starts with `token_owner_can_edit = False`. Administrators rewrite `set_token_metadata` / `set_token_json` until that token is frozen; holders are refused with `UNAUTHORIZED_PRESENTATION_EDITOR`.
- The creator opts holders in or out with `set_token_owner_can_edit` (SDK `prepareKeelTezosMintGateAction({action:"set-holder-metadata-editing"})`, or `holderMetadataEditing: true` at origination). The readback checks the view.
- A holder freezes their own token only while the creator has holder editing on, as on EVM KEEL721. A freeze ends creator rewrites for that token, so by default only the creator freezes.

### 2.5 Not KEEL: computed (rendered) token metadata
- Tezos indexers and marketplaces read the stored `token_metadata` big_map; they do not evaluate a view.
- A token whose metadata must reflect live state (for example, a NOCTURNES cart generation) has to rewrite its metadata through `set_token_metadata` when that state changes. The FA2 allows this for an administrator until `freeze_token_metadata`.
- The rewrite is a prepared call (`keel-tezos-token-metadata-prepare`), not a renderer contract.
- **Metadata state = live read + small creator-only trait rewrites.** One Studio call, two adapters. On EVM, `tokenURI` reads the state directly. On Tezos:
  - the token's HTML reads the state live: `@keel/sdk/tezos-live-state` (`prepareKeelTezosLiveState`) and the MCP tool `keel-tezos-live-state-prepare`. The metadata stays static. The HTML embeds a JSON snapshot taken at publish time, then reads declared big_map keys (`expr…` hash computed at prepare time) or views from an explicit public RPC list, with optional TzKT.
  - the traits a marketplace lists are rewritten by the creator inside the triggering call's own operation group: `prepareKeelTezosStateRewrite`. The group is atomic, so the state change and its listed traits land together.
  - Creator-only editor model: `token_owner_can_edit` stays off, and the triggering contract is never made an FA2 administrator. `checkKeelTezosStateRewriteAuthority` reads both before signing.
  - Costs and refusals are measured by `packages/tezos/scripts/live-state-cost-mockup.mjs` (Octez mockup, parity contracts):
    - the trait rewrite inside the triggering group adds about 0.0017 ꜩ (7,166 gas) to the call alone;
    - a same-size small `token_info` rewrite costs about 0.0018 ꜩ per token, with no burn;
    - a creator batch fits 84 rewrites per operation group (100 tokens: 2 groups, about 0.117 ꜩ);
    - an inline-HTML rewrite costs about 0.017 ꜩ per token;
    - the cart contract's own internal rewrite and a holder's rewrite are both refused with `UNAUTHORIZED_PRESENTATION_EDITOR`.

## 3. Mockup: end to end with costs

**Command:**

```sh
cd keel-contracts && script/tezos/compile-collection-route.sh   # out/tezos-collection-route/targets
cd keel-sdk && KEEL_CONTRACTS_DIR=<contracts checkout> DOCKER_CONTEXT=colima \
  node packages/tezos/scripts/collection-route-mockup.mjs --out <report.json>
```

The driver originates the six route contracts in a network-disabled Octez mockup (pinned image `tezos/tezos@sha256:c7adc160…`, protocol `PsUshuai9Qap`, bootstrap keys only), stores Hold resources, binds presentation, configures paused public and merkle drops, mints, writes token metadata and reads back. On the parity branch it also checks metadata authority: a holder's rewrite and freeze are refused by default, the creator rewrites, the creator enables holder editing, a holder rewrites and freezes, and a creator rewrite of the frozen token is refused.

**Parity-branch run: queued.** The pinned Octez image was removed from this machine before the run; it is not re-pulled without the owner's approval. The `master` run on 2026-10-17 passed with 0 failures and a total of about 35.62 ꜩ (fee plus storage burn, 250 mutez per byte). Those figures describe `master` contracts and are not parity evidence.

## 4. Tests

| Test | What it covers |
|---|---|
| `tests/sdk-tezos-collection.test.mjs` | SDK: origination staging, OnchFS CIDs against official vectors, binding, gate, PACK hashes, mints, TZIP-21, readback. |
| `tests/mcp-tezos-collection.test.mjs` | MCP: schemas, the full review-only flow, key refusal, readback over a loopback RPC. |
| `tests/tezos-collection-conformance.test.mjs` (sibling; honours `KEEL_CONTRACTS_DIR`) | Catalogue `--check`, entrypoints present in the module sources (including inherited ones), SDK storage equal to SmartPy-compiled storage. |
| `keel-contracts/script/tezos/test-tezos.sh keel-die keel-mint-access keel-hold keel-presentation keel-creator-identity` | The SmartPy scenarios for every route contract. |
