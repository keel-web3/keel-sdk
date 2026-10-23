/**
 * The Tezos side of EVM `KeelManager` as an ERC-1271 signer.
 *
 * EVM accepts a digest when governance stored an approval for it, or when a
 * fresh two-thirds governor envelope `(deadline, epoch, Signature[])` signs
 * `contractSignatureDigest(digest, deadline)`. `KeelSignatureAuthority`
 * answers `is_valid_signature` with the same two paths and reads the governor
 * roster from `KeelManager`. See
 * docs/reviews/tezos-behavior-parity-20261015/SIGNATURE_AUTHORITY_CAPABILITIES.md
 * in keel-contracts. What the chain changes, and these helpers hide:
 *
 * - Michelson verifies against a public key, so each envelope signature
 *   carries its key. Signatures are ordered by key hash, which
 *   `buildKeelTezosGovernorEnvelope` sorts, as EVM orders by address.
 * - Tezos has no ERC-1271, so a consuming contract calls the view by name; the
 *   SDK returns that call.
 * - Approve and revoke go to the signature authority, from governance or from
 *   the manager's access controller through an entrypoint capability, as EVM
 *   names approveSignature and revokeSignature in an execution policy.
 *
 * Nothing here signs, submits or reads a chain.
 */

import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import type { KeelTezosGovernanceCall } from "./tezos-governance.js";
import { sortKeelTezosRecoverySignatures } from "./tezos-recovery.js";
import { packKeelTezosMicheline } from "./tezos-live-state.js";
import type { TezosMichelineValue } from "./tezos-publication.js";

/** The domain every governor envelope signature starts with. */
export const KEEL_TEZOS_CONTRACT_SIGNATURE_DOMAIN = "keel.tezos.contract-signature.v1" as const;
/** EVM MAX_SIGNATURE_APPROVAL_DURATION: 30 days. */
export const KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS = 2_592_000 as const;

/** Approval refusals by the EVM error each stands for. */
export const KEEL_TEZOS_SIGNATURE_AUTHORITY_ERRORS = Object.freeze({
  KEEL_DIGEST: "InvalidApproval",
  KEEL_APPROVAL: "InvalidApproval",
  KEEL_APPROVAL_DURATION: "InvalidApproval",
  KEEL_MANAGER_ONLY: "UnauthorizedSelfCall",
  KEEL_ROLE: "UnauthorizedRole",
  KEEL_POLICY: "ExecutionNotAllowed",
} as const);

/** The entrypoint capabilities that delegate approve and revoke (see tezos-entrypoint-capability.ts). */
export const KEEL_TEZOS_SIGNATURE_APPROVAL_CAPABILITIES = Object.freeze({
  approve: Object.freeze({ entrypoint: "approve_signature", parameterType: { micheline: { prim: "pair", args: [{ prim: "bytes" }, { prim: "timestamp" }] } } }),
  revoke: Object.freeze({ entrypoint: "revoke_signature", parameterType: { micheline: { prim: "bytes" } } }),
} as const);

export interface KeelTezosGovernorSignature {
  /** edpk, sppk or p2pk; the authority hashes it and checks governor membership. */
  readonly publicKey: string;
  /** edsig, spsig1, p2sig or sig over `keelTezosContractSignaturePayload`. */
  readonly signature: string;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const pair = (...items: TezosMichelineValue[]): TezosMichelineValue =>
  items.length === 1 ? items[0] as TezosMichelineValue : { prim: "Pair", args: [items[0] as TezosMichelineValue, pair(...items.slice(1))] };

function whole(value: unknown, label: string, max = (1n << 64n) - 1n): bigint {
  const number = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : -1n;
  if (number < 0n || number > max) throw new RangeError(`${label} must be a whole number no larger than ${max}.`);
  return number;
}

function kt1(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

function digest32(value: unknown, label = "digest"): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) throw new TypeError(`${label} must be 32 bytes of lowercase hex.`);
  return value;
}

/** The bytes each governor signs: PACK(record(domain, manager, chain, digest, deadline, epoch)); EVM contractSignatureDigest. */
export function keelTezosContractSignaturePayload(input: {
  readonly network: string; readonly manager: string; readonly digest: string; readonly deadline: bigint | number; readonly epoch: bigint | number;
}): string {
  const node = pair(
    { bytes: hex(new TextEncoder().encode(KEEL_TEZOS_CONTRACT_SIGNATURE_DOMAIN)) },
    { bytes: hex(keelTezosAddressBytes(kt1(input.manager, "manager"), "manager")) },
    { bytes: hex(keelTezosChainIdBytes(input.network)) },
    { bytes: digest32(input.digest).slice(2) },
    { int: whole(input.deadline, "deadline").toString() },
    { int: whole(input.epoch, "epoch").toString() },
  );
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

/** EVM abi.encode(deadline, epoch, Signature[]) as the Michelson envelope, signatures sorted by key hash. */
export function buildKeelTezosGovernorEnvelope(input: {
  readonly deadline: bigint | number; readonly epoch: bigint | number; readonly signatures: readonly KeelTezosGovernorSignature[];
}): TezosMichelineValue {
  if (!Array.isArray(input.signatures) || input.signatures.length === 0 || input.signatures.length > 32) {
    throw new RangeError("signatures must list 1..32 governor signatures.");
  }
  const sorted = sortKeelTezosRecoverySignatures(input.signatures);
  if (sorted.some((item, index) => index > 0 && item.signer === sorted[index - 1]!.signer)) throw new RangeError("A governor signs an envelope once.");
  return pair({ int: whole(input.deadline, "deadline").toString() }, { int: whole(input.epoch, "epoch").toString() },
    sorted.map((item) => ({ prim: "Pair", args: [{ string: item.publicKey }, { string: item.signature }] })) as unknown as TezosMichelineValue);
}

/** The view call a consuming contract or reader makes: EVM isValidSignature(digest, signature). */
export function buildKeelTezosSignatureValidation(input: {
  readonly authority: string; readonly digest: string; readonly envelope?: TezosMichelineValue;
}) {
  const argument = pair({ bytes: digest32(input.digest).slice(2) },
    input.envelope === undefined ? { prim: "None" } : { prim: "Some", args: [input.envelope] });
  return { contract: kt1(input.authority, "authority"), view: "is_valid_signature", argument, returns: "bool" as const };
}

type ApprovalInput =
  | { readonly kind: "approve"; readonly authority: string; readonly digest: string; readonly validUntil: bigint | number; readonly now: bigint | number }
  | { readonly kind: "revoke"; readonly authority: string; readonly digest: string };

/** The Micheline argument approve_signature or revoke_signature takes, after EVM's InvalidApproval bounds. */
function approvalValue(input: ApprovalInput): TezosMichelineValue {
  const digest = digest32(input.digest);
  if (input.kind === "revoke") return { bytes: digest.slice(2) };
  if (/^0x0{64}$/u.test(digest)) throw new RangeError("The zero digest cannot be approved (EVM InvalidApproval).");
  const validUntil = whole(input.validUntil, "validUntil");
  const now = whole(input.now, "now");
  if (validUntil <= now || validUntil > now + BigInt(KEEL_TEZOS_MAX_SIGNATURE_APPROVAL_SECONDS)) {
    throw new RangeError("validUntil must be after now and at most 30 days ahead (EVM InvalidApproval).");
  }
  return { prim: "Pair", args: [{ bytes: digest.slice(2) }, { int: validUntil.toString() }] };
}

/** EVM approveSignature / revokeSignature as governance calls on the signature authority. */
export function buildKeelTezosSignatureApprovalCall(input: ApprovalInput): KeelTezosGovernanceCall {
  const authority = kt1(input.authority, "authority");
  const { entrypoint, parameterType } = KEEL_TEZOS_SIGNATURE_APPROVAL_CAPABILITIES[input.kind];
  return { destination: authority, entrypoint, parameterType: parameterType.micheline, value: approvalValue(input) };
}

/**
 * The entrypoint capability that lets a role or automation key approve or revoke, as EVM names
 * approveSignature or revokeSignature in configureExecutionPolicy. Pass it to
 * prepareKeelTezosEntrypointCapability (policy) and buildKeelTezosRoleEntrypointCall or
 * keelTezosAutomationEntrypointPayload (calls), with the arguments from keelTezosSignatureApprovalArgs.
 */
export function keelTezosSignatureApprovalCapability(authority: string, kind: "approve" | "revoke") {
  const capability = KEEL_TEZOS_SIGNATURE_APPROVAL_CAPABILITIES[kind];
  if (capability === undefined) throw new TypeError('kind must be "approve" or "revoke".');
  return { target: kt1(authority, "authority"), entrypoint: capability.entrypoint, parameterType: capability.parameterType };
}

/** The raw Micheline arguments of a delegated approve or revoke, checked as the authority will check them. */
export function keelTezosSignatureApprovalArgs(input: ApprovalInput): { readonly micheline: TezosMichelineValue } {
  kt1(input.authority, "authority");
  return { micheline: approvalValue(input) };
}
