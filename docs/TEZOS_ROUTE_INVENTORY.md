# KEEL Tezos route: inventory

**Status (2026-10-17).** The Tezos route is built in `keel-contracts` (SmartPy, `master`). It is now attached to the SDK (`packages/sdk/src/tezos-collection.ts`) and to the MCP (8 `keel-tezos-*` collection tools). It runs end to end in an offline Octez mockup.

The earlier report said the route "lacks a renderer binding, mint routes and publishing". That was wrong about the contracts:
- the FA2 has `set_default_presentation`;
- the index has collection and token revisions;
- OneMint has drops with stages, merkle allowlists and pause;
- the Hold writes OnchFS files.

What was missing was SDK and MCP wiring. That wiring is now built; what is left is listed under "To build" below.

All tools are **prepare-only**. Each one returns Micheline operations for the creator's wallet to review. Nothing signs, and every tool refuses private keys, secret keys, mnemonics and seeds, even when they are nested in the input.

Contract paths are relative to `keel-contracts/src/modules`, and line numbers are on `master`.

## 1. Inventory

Status values used in the table:
- **C** = compiled by `script/tezos/compile-collection-route.sh`.
- **T** = has a SmartPy scenario in `test/modules/<module>/tezos/`.
- **M** = exercised in the Octez mockup run (`packages/tezos/scripts/collection-route-mockup.mjs`).

| Family | Contract file:line | Status | SDK function | MCP tool | Gap |
|---|---|---|---|---|---|
| FA2 origination | `keel-die/tezos/keel_collection_fa2.py:70` `KeelCollectionFA2(admin, keel_index, max_supply)` | C T M | `buildKeelTezosCollectionFA2Storage`, `prepareKeelTezosCollectionOriginations` | `keel-tezos-collection-originate-prepare` | TZIP-16 `metadata` is set only at origination (To build 2.1). |
| FA2 admins | `add_administrator` :156, `remove_administrator` :165 | C T | (SDK call builder not needed for launch) | — | No prepare action. These are rarely needed, and the raw call is in the catalogue. |
| FA2 minter / capacity | `set_minter` :179, `reserve_capacity` :198, `release_capacity` :211 | C T M | `prepareKeelTezosMintGate` (set_minter), `prepareKeelTezosMintGateAction({action:"set-minter"})`. Capacity is reserved by OneMint `create_drop`. | `keel-tezos-mint-gate-prepare` | none |
| FA2 mint / batch mint | `strike(to_, quantity)` :222 (minter only; `quantity > 1` is a batch) | C T M | `prepareKeelTezosMint({mode:"direct"})`, `buildKeelCollectionStrike` (older) | `keel-tezos-mint-prepare`, `keel-tezos-publication-prepare action=strike` | none |
| FA2 renderer / presentation | `set_keel_index` :272, `set_default_presentation` :279, `freeze_default_presentation` :302 | C T M | `prepareKeelTezosPresentationBinding` | `keel-tezos-presentation-bind-prepare` | Freezing only happens when `freeze: true` is passed. |
| FA2 token metadata (TZIP-12/21) | `set_token_metadata` :314, `set_token_json` :332, `freeze_token_metadata` :341 | C T M | `buildKeelTezosTokenInfo`, `prepareKeelTezosTokenMetadata`, `keelTezosTextDataUri` | `keel-tezos-token-metadata-prepare` | Inline values are raw-percent `data:` URIs, never Base64; larger payloads go through `onchfs://` Hold files. **Gap:** on `master`, `require_token_editor_` (:140) lets the token's current holder rewrite or freeze its metadata, not only an administrator (To build 2.6). |
| FA2 ledger + views | `transfer` :350, `update_operators` :381, `balance_of` :396. Views :413–473 (`get_balance`, `token_metadata`, `total_supply`, `is_minter`, `default_presentation`, …) | C T M | `checkKeelTezosCollectionPublication`, `decodeKeelTezosTokenMetadataView` | `keel-tezos-readback-check` | none |
| Hold / OnchFS | `keel-hold/tezos/keel_hold_onchfs.py:163` `KeelHoldOnchFS`: `write_chunk` :222, `create_file` :230, `create_directory` :247, `weld_object` :270. Views `read_file` :401, `get_inode_at` :413, `get_object` :427 | C T M | `buildKeelTezosHoldOnchFSStorage`, `prepareKeelTezosHoldResources`, `keelTezosOnchfsFileCid` / `DirectoryCid`, `encodeKeelTezosOnchfsMetadata` | `keel-tezos-hold-resources-prepare` | none. CIDs match the official `onchfs@0.1.0` library. |
| Hold verifier / harness | `configure_verifier` :319, `forge_harness` :334, view `harness_html` :498 | C T | `buildKeelHoldConfigureVerifier`, `buildKeelForgeHarness` (`tezos-publication.ts`) | `keel-tezos-publication-prepare` (`configure-verifier`, `forge-harness`) | These are not in the new launch plan, which uses the registered shell route instead. |
| Hold slug store | `keel-hold/tezos/keel_hold.py:50` `KeelHold.cast_slug` :59 | C T | `buildKeelHoldCarrierOperations` (needs inscriptions computed in advance) | `keel-tezos-publication-prepare` | Older lane. The OnchFS Hold supersedes it for collections. |
| Index / revisions | `keel-hold/tezos/keel_index.py:218` `KeelIndex`: `register_collection` :604, `claim_collection` :631, `set_collection_controller` :651, `publish_collection_revision` :679, `publish_token_revision` :716, `activate_collection_revision` :800, `activate_token_revision` :817, `freeze_collection` :886, `freeze_token` :895. Views `active_presentation` :997, `presentation_matches` | C T M | `buildKeelTezosIndexStorage`, `prepareKeelTezosPresentationBinding` (collection scope) | `keel-tezos-presentation-bind-prepare` | Per-token revisions (`publish_token_revision` / `activate_token_revision`) are not prepared (To build 2.4). |
| Presentation policy | `keel-presentation/tezos/keel_presentation_state.py:262` `KeelPresentationStateRegistry`: `create_policy` :368, `configure_staking_rule` :410, `append_inline_revision` :428, `append_resource_revision` :482, `seal_policy_to_onchain_object` :524 | C T M (create + append_resource) | `buildKeelTezosPresentationStateStorage`, `keelTezosPresentationPolicyId`, binding `presentationPolicy` option | `keel-tezos-presentation-bind-prepare` | Sealing needs a `KeelImmutableCheckpointRegistry` (`keel-artifacts/tezos/keel_immutable_checkpoint.py:226`) and is not prepared (To build 2.3). Staking rules are not prepared. |
| Creator profile | `keel-creator-identity/tezos/keel_creator_profile.py:265` `KeelCreatorProfileRegistry(manager)`: `create_profile` :353, `ensure_profile` :451, `update_profile` :463, `recover_profile` :501. View `can_create_drop` :640 | C T M | `buildKeelTezosCreatorProfileStorage`, `prepareKeelTezosMintGate({creatorProfile})` | `keel-tezos-mint-gate-prepare` | none. The registry needs a manager KT1 that already exists; pass an existing shared registry through `bindings.creatorProfile`. |
| Mint gate: OneMint drops | `keel-mint-access/tezos/keel_mint_gate.py:1315` `OneMintController`: `create_drop` :1397, `set_drop_paused` :1558, `set_stage_merkle_root` :1586, `update_drop_supply` :1620, `close_drop` :1699, `invalidate_nonce` :1740, `withdraw` :2244, `set_delegate` :1380 | C T M | `buildKeelTezosOneMintStorage`, `prepareKeelTezosMintGate`, `prepareKeelTezosMintGateAction`, `predictKeelTezosOneMintDropId`, `buildKeelTezosAllowlistTree`, `keelTezosOneMintMerkleLeaf` | `keel-tezos-mint-gate-prepare` | Covers price, supply, per-wallet/per-transaction limits, timed stages, merkle allowlist, pause/unpause, close, supply change and withdraw. Delegates are not prepared. |
| Mint: OneMint mints | `public_mint` :1749, `merkle_mint` :1928, `admin_strike` :2163 (premint) | C T M | `prepareKeelTezosMint({mode:"public"/"merkle"/"premint"})` | `keel-tezos-mint-prepare` | none |
| Mint: signed stages | `allowlist_mint` :1821 (signer), `claim_mint` :2028 (entitlement token) | C T | — | — | Not prepared (To build 2.2). Token payment is refused in the contract with `UNSUPPORTED_PAYMENT_TOKEN`. |
| Mint gate: campaigns | `KeelMintGate` :378: `set_platform_configuration` :459, `set_campaign_admin` :472, `pause` :483, `unpause` :490, `create_campaign` :497, `set_campaign_paused` :627, `close_campaign` :649, `invalidate_authorization_nonce` :698, `mint` :707, `withdraw` :977 | C T | `buildKeelTezosMintGateStorage` (storage only) | — | Campaign calls are not prepared (To build 2.2). OneMint is the wired route. |
| Shell / harness builder | `keel-harness/tezos/keel_harness_builder.py:638` `KeelHarnessBuilder`: `register_shell` :718, `update_shell` :738, `freeze_shell` :745 | T | `prepareKeelTezosShell`, `keelTezosCreatorShellId` (`tezos-shell.ts`) | `keel-tezos-shell-prepare` | none (this existed before this change). |
| Token-URI composer | `keel-sleeve/tezos/keel_sleeve.py:28` `KeelSleeve` (views only: `token_uri`, …) | T | — | — | Tezos marketplaces read the `token_metadata` big_map, not a view. The Sleeve view is reachable through `KeelTezosPublicationAdapter.view` but is not part of the launch. |
| Market | `keel-market/tezos/keel_market.py:281` `KeelMarket` (list :459, buy :779, bids :864–954, withdraw :1089, …) | T | — | — | Secondary sales are out of scope for a mint. objkt and other marketplaces read FA2 plus TZIP-21 directly. |
| Graph / library / module review | `keel-graph/tezos/keel_graph.py`: `KeelGraphRegistry` :955, `KeelLibraryRegistry` :1259, `KeelModuleReviewRegistry` :2379, `KeelPluginRegistry` :2636 | T | catalogue only (`KEEL_TEZOS_MODULES`) | — | Shared-module publication on Tezos is not part of a single-collection launch. |
| Network / readback | RPC `chain_id`, `script`, `run_script_view`; TzKT `/v1/head`, `/v1/contracts/{kt1}`, `/v1/tokens` | M | `checkKeelTezosCollectionPublication`, `keelTezosChainIdBytes` | `keel-tezos-readback-check`, `keel-network-inspect` | none. HTTPS is required except for loopback. |
| Launch plan | — | — | `planKeelTezosCollectionLaunch`, `planKeelTezosStandardRoute().collectionRoute` | `keel-tezos-collection-launch-plan`, `keel-tezos-standard-route-plan` | none |

**Catalogue.** `script/tezos/generate-sdk-catalog.mjs` now also emits `entrypoints` and `views` per class, taken from the sources. `KEEL_TEZOS_MODULES[*].entrypoints[Contract]` is what `assertKeelTezosEntrypoint` / `assertKeelTezosView` check every prepared call against. `--check` keeps `tezos-modules.generated.ts` current.

### Parity branch

`keel-contracts` has an unmerged branch, `codex/tezos-behavior-parity-20261015`, that is 194 commits ahead of `master`. Compared with `master`, by entrypoint and view name:
- `KeelCollectionFA2` moves `transfer` / `update_operators` / `balance_of` / `get_balance` / `token_metadata` into a new base, `keel-die/tezos/keel_fa2_nft.py` (`KeelNFTLedger`). It adds `set_token_owner_can_edit`, `strike_unreserved` and the view `token_owner_can_edit`.
- `OneMintController` / `KeelMintGate` adds the view `verify_reservation`.
- `KeelIndex`, `KeelPresentationStateRegistry`, `KeelHoldOnchFS` and `KeelCreatorProfileRegistry` keep their names. Their bodies and storage change (for example, `keel_creator_profile.py` has 311 changed lines).

The SDK is written against `master`. When the branch merges:
1. rerun `script/tezos/compile-collection-route.sh`;
2. rerun `generate-sdk-catalog.mjs`;
3. run `tests/tezos-collection-conformance.test.mjs`. It deep-compares every SDK storage builder with the compiled storage and fails on any drift.

## 2. To build

Each item names the contract and the entrypoint. None of these blocks a NOCTURNES Genesis launch through the route above. Item 2.6 decides whether holders can edit their own token's metadata.

**Already built in this change:**
- the 8 MCP tools and the SDK functions above;
- the per-class entrypoint/view catalogue;
- the compile script for the route targets;
- the mockup driver;
- TZIP-21 `royalties`.

### 2.1 `KeelCollectionFA2`: contract metadata after origination
- **Add** `set_contract_metadata(key: string, value: bytes)`, administrator only. It refuses once a new `contract_metadata_frozen` flag is set. Add `freeze_contract_metadata()` and a view `contract_metadata_frozen`.
- **Why:** the TZIP-16 `metadata` big_map is written only by the constructor, so a wrong collection name or description needs a new FA2.
- **SDK:** add `prepareKeelTezosCollectionMetadataUpdate`, and expose it as a `keel-tezos-mint-gate-prepare`-style action on a new collection-admin tool.
- **Not built here.** The parity branch rewrites this file (224 changed lines), so an edit on `master` would conflict. It also changes the compiled code that the provenance JSON pins.

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

### 2.6 `KeelCollectionFA2`: holder edits of token metadata
- **On `master`:** `require_token_editor_` (:140–150) accepts an administrator **or the current holder** for `set_token_metadata`, `set_token_json` and `freeze_token_metadata`. A holder can therefore replace the artwork URIs of their own token, or freeze them so the creator can no longer refresh them.
- **Already built on the parity branch:** `set_token_owner_can_edit(enabled: bool)`, administrator only, plus the view `token_owner_can_edit`. Merging the branch closes the gap. Collections that need creator-only metadata should not launch from `master` until then, or should freeze each token's metadata right after writing it (`freeze: true`).
- **SDK, after the merge:** add a `token-owner-can-edit` action to `prepareKeelTezosMintGateAction` (or to a collection-admin tool), and a readback check of the view.
- **Not duplicated on `master`,** because that would conflict with the branch.

### 2.5 Not KEEL: computed (rendered) token metadata
- Tezos indexers and marketplaces read the stored `token_metadata` big_map; they do not evaluate a view.
- A token whose metadata must reflect live state (for example, a NOCTURNES cart generation) has to rewrite its metadata through `set_token_metadata` when that state changes. The FA2 allows this for an administrator until `freeze_token_metadata`.
- The rewrite is a prepared call (`keel-tezos-token-metadata-prepare`), not a renderer contract.
- **Opt-in alternative for the token's HTML (2026-10-17):** `@keel/sdk/tezos-live-state` (`prepareKeelTezosLiveState`) and the MCP tool `keel-tezos-live-state-prepare`.
  - The metadata stays static. The HTML embeds a JSON snapshot taken at publish time, then reads declared big_map keys (`expr…` hash computed at prepare time) or views from an explicit public RPC list, with optional TzKT.
  - Marketplace thumbnails and traits do not change under it.
  - Costs, measured by `packages/tezos/scripts/live-state-cost-mockup.mjs` (Octez mockup):
    - same-size small `token_info` rewrite: about 0.0017 ꜩ per token, with no burn;
    - inline-HTML rewrite: about 0.017 ꜩ;
    - a contract-internal rewrite loop: at most 135 tokens per operation (gas-bound);
    - a rewrite inside the triggering call: +0.0012 ꜩ.
  - Details are in `nocturnes-genesis/docs/CHAIN.md` §13.

## 3. Mockup: end to end with costs

**Command:**

```sh
cd keel-contracts && script/tezos/compile-collection-route.sh   # out/tezos-collection-route/targets
cd keel-sdk && DOCKER_HOST=unix://$HOME/.colima/default/docker.sock \
  node packages/tezos/scripts/collection-route-mockup.mjs --out <report.json>
```

**Environment:**
- Octez mockup image `tezos/tezos@sha256:c7adc160…` (KEEL's pin), run with `--network none`;
- protocol `PsUshuai9Qap`, chain `NetXynUjJNZm7wi`;
- 250 mutez per byte;
- mockup bootstrap keys only.

**Sequence:**
1. Originate the six contracts.
2. Hold resources: an HTML file, an SVG and a 40 KB atlas, stored as 5 chunks, 3 files and 1 directory.
3. Bind: register, publish and activate the revision, set the default presentation, create the policy and append the resource revision.
4. Gate: creator profile, `set_minter`, then a public drop and a merkle drop, both starting paused.
5. Check that a paused drop refuses to mint, then unpause.
6. Mint: a pilot `public_mint`, a batch of ×2, and a `merkle_mint`.
7. Token metadata: two tokens inline and one through `onchfs://`.
8. SDK readback.
9. Pause, then withdraw.

**Result:**
- **0 failures.**
- `publicationVerified: true` (14 checks).
- The predicted drop ids equal `latest_drop_for_target`.
- The SDK merkle leaf equals the `merkle_leaf` view.

| Step | Ops | Burn ꜩ | Total ꜩ (fee + burn) |
|---|---|---|---|
| Originate Hold, Index, Presentation, CreatorProfile, FA2, OneMint | 6 | 22.382 | **22.477** |
| (each origination's burn) | | Hold 3.158, Index 4.724, Presentation 2.900, Profile 2.650, FA2 2.327, OneMint 6.624 | |
| Hold resources (43,518 bytes; one 16 KB chunk ≈ 4.11 ꜩ) | 12 | 10.880 | 10.933 |
| Bind presentation | 6 | 0.228 | 0.236 |
| Configure mint gate (`create_drop` ≈ 26–28k gas) | 6 | 0.378 | 0.390 |
| Gate actions (pause / unpause / withdraw) | 3 | 0 | 0.005 |
| Mint, 3 calls (≈ 0.074–0.081 each) | 3 | | 0.238 |
| Token metadata (inline HTML token ≈ 0.61; onchfs-referenced ≈ 0.157) | 3 | | 1.340 |
| **Total** | | | **35.62** |

**Cheaper options:**
- Reusing a shared creator-profile registry and a shared Hold removes about 5.8 ꜩ.
- The Hold cost scales at 0.25 ꜩ per stored KB.

## 4. Tests

| Test | What it covers |
|---|---|
| `tests/sdk-tezos-collection.test.mjs` | SDK: origination staging, OnchFS CIDs against official vectors, binding, gate, PACK hashes, mints, TZIP-21, readback. |
| `tests/mcp-tezos-collection.test.mjs` | MCP: schemas, the full review-only flow, key refusal, readback over a loopback RPC. |
| `tests/tezos-collection-conformance.test.mjs` (sibling) | Catalogue `--check`, entrypoints present in source, SDK storage equal to SmartPy-compiled storage. |
| `keel-contracts/script/tezos/test-tezos.sh keel-die keel-mint-access keel-hold keel-presentation keel-creator-identity` | The SmartPy scenarios for every route contract. |
