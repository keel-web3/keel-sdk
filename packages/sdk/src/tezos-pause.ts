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

import { keelPauseControls, keelPausePresets } from "./admin-pauses.js";
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
