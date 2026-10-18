/**
 * KEEL's shared system pause on Tezos, with EVM's bits, masks and revision.
 *
 * EVM keeps the flags and the Admin tier in one KeelManager. Tezos keeps the
 * flags in KeelManager and the Admin tier in its KeelAccessController, which
 * forwards an admin's stop to the manager. So a stop is routed to the access
 * controller, and a resume is a call the manager makes to itself inside a
 * two-thirds governance lambda, as EVM's resume runs through executeGovernance.
 * Reads return the same shape as `readKeelPauseState`. Nothing here signs,
 * submits or reads a chain.
 */

import { keelPauseBits, keelPauseControls, keelPausePresets } from "./admin-pauses.js";
import { keelTezosAddressBytes } from "./tezos-collection.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/** The manager registry ID under which governance registers the access controller it trusts to stop systems. */
export const KEEL_TEZOS_ACCESS_CONTROLLER_MODULE_ID = "0x0232c188a5735f6ca1893d43dac4f40bba166003009fcb2e3186726f90ce664a" as const;
const UINT64_MAX = (1n << 64n) - 1n;

/** EVM error names and the Tezos strings that mean the same refusal. */
export const KEEL_TEZOS_PAUSE_ERRORS = Object.freeze({
  KEEL_ROLE: "UnauthorizedRole",
  KEEL_INVALID_PAUSE_MASK: "InvalidPauseMask",
  KEEL_STALE_PAUSE_REVISION: "StalePauseRevision",
  KEEL_SYSTEMS_UNAVAILABLE: "SystemsUnavailable",
  KEEL_GOVERNANCE_ONLY: "UnauthorizedSelfCall",
} as const);

function mask(value: bigint): bigint {
  if (typeof value !== "bigint" || value <= 0n || (value & ~keelPausePresets.all) !== 0n) throw new RangeError("Choose one or more supported pause controls.");
  return value;
}

function contract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

/** An admin's stop. It only sets the selected bits and cannot resume anything. */
export function buildKeelTezosPauseAction(accessController: string, value: bigint) {
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: contract(accessController, "accessController"),
    parameters: { entrypoint: "pause_systems", value: { int: mask(value).toString() } } };
  return { operation, authorization: "admin" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

/**
 * Governance's resume. The manager calls its own `resume_systems`, so this
 * transaction goes inside a two-thirds lambda the manager executes.
 */
export function buildKeelTezosResumeAction(manager: string, value: bigint, expectedRevision: bigint) {
  if (typeof expectedRevision !== "bigint" || expectedRevision < 0n || expectedRevision > UINT64_MAX) throw new RangeError("expectedRevision must be a uint64.");
  const parameter: TezosMichelineValue = { prim: "Pair", args: [{ int: mask(value).toString() }, { int: expectedRevision.toString() }] };
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: contract(manager, "manager"),
    parameters: { entrypoint: "resume_systems", value: parameter } };
  return { operation, authorization: "governance" as const, sender: manager, signing: "not-performed" as const, submission: "not-performed" as const };
}

/** Decode the manager's `system_pause_state` view, `Pair flags revision`, into `readKeelPauseState`'s shape. */
export function decodeKeelTezosPauseState(value: TezosMichelineValue) {
  const node = value as { prim?: string; args?: readonly { int?: string }[] };
  const [flagsNode, revisionNode] = node.prim === "Pair" && node.args?.length === 2 ? node.args : [];
  if (typeof flagsNode?.int !== "string" || typeof revisionNode?.int !== "string") throw new TypeError("Expected Pair flags revision.");
  const flags = BigInt(flagsNode.int);
  const revision = BigInt(revisionNode.int);
  if (flags < 0n || (flags & ~keelPausePresets.all) !== 0n || revision < 0n || revision > UINT64_MAX) throw new RangeError("Invalid Tezos pause state.");
  return { flags, revision, controls: keelPauseControls.map((control) => ({ ...control, paused: (flags & control.mask) !== 0n })),
    allMintsPaused: (flags & keelPausePresets.allMints) === keelPausePresets.allMints };
}

const { chunking, viewers, mint721, mintAdmin, mintCampaign, mintOne, mintCrossChain, mintIP, publication, market, staking } = keelPauseBits;

/**
 * The shared pause bits each native write checks first, keyed `Contract.entrypoint`.
 * They are EVM's bits for the EVM function each entrypoint mirrors. Writes not
 * listed (cancels, reclaims, withdrawals, reads) are never stopped, as on EVM.
 * Each contract asks its own authority: KeelArtifactRegistry its manager, the
 * harness registries their artifact registry's manager, the holds, the stake
 * manager and the IP executor their fixed administrator, and the market,
 * collections, mint gate, OneMint and cross-chain attestor the pause authority
 * fixed at origination. An implicit-account authority means the contract is not
 * stopped, as a codeless authority on EVM. OneMint checks MINT_ONE as soon as a
 * mint is decoded (EVM's batch checkout does too; its single-drop paths check at
 * delivery), so the same stopped bit refuses the same mints on both chains.
 */
export const KEEL_TEZOS_PAUSE_GATES: Readonly<Record<string, bigint>> = Object.freeze({
  "KeelArtifactRegistry.forge_artifact": publication,
  "KeelArtifactRegistry.forge_artifact_for": publication,
  "KeelArtifactRegistry.forge_with_revision_policy": publication,
  "KeelArtifactRegistry.append_artifact_revision": publication,
  "KeelHarnessRegistry.forge_harness": viewers,
  "KeelHarnessRegistry.forge_harness_for": viewers,
  "KeelHarnessRegistry.append_harness_revision": viewers,
  "KeelHarnessRegistry.append_harness_selections": viewers,
  "KeelHarnessRegistry.fork_harness_for_token": viewers,
  "KeelHarnessRegistry.activate_fork": viewers,
  "KeelHarnessTreeRegistry.forge_harness_tree": viewers,
  "KeelHarnessTreeRegistry.forge_harness_tree_for": viewers,
  "KeelHarnessTreeRegistry.append_harness_tree": viewers,
  "KeelHarnessTreeRegistry.fork_harness_tree_for_token": viewers,
  "KeelStakeObjectManager.stake": staking,
  "KeelHold.cast_slug": chunking,
  "KeelHoldOnchFS.write_chunk": chunking,
  "KeelHoldOnchFS.create_file": chunking,
  "KeelHoldOnchFS.create_directory": chunking,
  "KeelHoldOnchFS.weld_object": publication,
  "KeelHoldOnchFS.forge_harness": viewers,
  "KeelMarket.register_escrow_listing": market,
  "KeelMarket.list": market,
  "KeelMarket.update_listing": market,
  "KeelMarket.buy": market,
  "KeelMarket.place_bid": market,
  "KeelMarket.accept_bid": market,
  "KeelIPActionExecutor.execute_remint": mintIP,
  "KeelIPActionExecutor.execute_mint_to_backpack": mintIP,
  "KeelCollectionFA2.strike": mint721,
  "KeelCollectionFA2.strike_unreserved": mint721,
  "KeelCollectionFA2.set_default_presentation": viewers,
  "KeelCollectionFA2.set_token_metadata": viewers,
  "KeelCollectionFA2.set_token_json": viewers,
  "KeelCollectionFA2.set_contract_metadata": viewers,
  "KeelCollectionFA2.set_keel_index": viewers,
  "KeelSeededCollectionFA2.strike": mint721,
  "KeelSeededCollectionFA2.strike_unreserved": mint721,
  "KeelSeededCollectionFA2.strike_with_data": mint721,
  "KeelSeededCollectionFA2.set_default_presentation": viewers,
  "KeelSeededCollectionFA2.set_token_metadata": viewers,
  "KeelSeededCollectionFA2.set_token_json": viewers,
  "KeelSeededCollectionFA2.set_contract_metadata": viewers,
  "KeelSeededCollectionFA2.set_keel_index": viewers,
  "KeelMintGate.mint": mintCampaign,
  "OneMintController.public_mint": mintOne,
  "OneMintController.allowlist_mint": mintOne,
  "OneMintController.merkle_mint": mintOne,
  "OneMintController.claim_mint": mintOne,
  "OneMintController.admin_strike": mintAdmin | mintOne,
  "KeelCrossChainMintAttestor.submit_cross_mint": mintCrossChain,
});

/**
 * Bits the Tezos manager stores, as EVM's does, that no native contract checks:
 * MINT_1155 (no multi-edition collection), MINT_AUCTION (no auction issuer),
 * COLLECTIONS (no creator factory; creators originate collections directly) and
 * TREASURY (no pooled treasury; contracts pay their recipients at once). Studio
 * shows them in the state and says that, on Tezos, they stop nothing.
 */
export const KEEL_TEZOS_PAUSE_UNGATED_BITS: bigint =
  keelPauseBits.mint1155 | keelPauseBits.mintAuction | keelPauseBits.collections | keelPauseBits.treasury;

/** The pause bits a native call checks first, or 0n when no shared stop applies to it. */
export function keelTezosPauseGate(contract: string, entrypoint: string): bigint {
  return KEEL_TEZOS_PAUSE_GATES[`${contract}.${entrypoint}`] ?? 0n;
}

/** The controls that would stop a native call under the given flags, for Studio to name before it signs. */
export function keelTezosPausedFor(contract: string, entrypoint: string, flags: bigint) {
  const blocked = keelTezosPauseGate(contract, entrypoint) & flags;
  return keelPauseControls.filter((control) => (control.mask & blocked) !== 0n);
}
