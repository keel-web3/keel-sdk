/**
 * Manager pause and cold recovery on Tezos, the native side of EVM
 * `KeelManager.pause`, `KeelRecoveryGroups` and `KeelManagerProxy`'s
 * `configureBackup` and `recoverGovernors`.
 *
 * The native `KeelRecoveryGroups` is a port of the EVM registry: groups of one
 * or at least three cold keys, a two-thirds threshold, per-resource bindings and
 * a nonce consumed by each authorization. `KeelManager` binds it once, holds the
 * operational pause and the recovery epoch, and its `recover_governors` runs
 * EVM's checks in EVM's order. The access controller and the signature
 * authority read the manager's pause and epoch, so a recovery retires roles,
 * automation keys and approvals as on EVM. See
 * docs/reviews/tezos-behavior-parity-20261015/MANAGER_RECOVERY.md in
 * keel-contracts.
 *
 * What the chain changes, and these helpers hide:
 *
 * - Cold members and recovered governors are implicit keys (tz1, tz2, tz3). A
 *   Tezos contract cannot sign, so a KT1 gets `KeelTezosRecoverySignerError`.
 * - Signers sign PACKed payloads that bind the registry and chain, where EVM
 *   signs EIP-712 digests; the digest is blake2b of the payload.
 * - A group holds at most 32 keys, so every key and signature fits one
 *   operation.
 * - `upgradeWithBackup` has no Tezos counterpart: the manager is immutable.
 *   `KeelTezosRecoveryUpgradeError` carries the capability map's closest
 *   behaviour.
 *
 * Nothing here signs, submits or reads a chain.
 */

import { blake2b } from "@noble/hashes/blake2b";

import { KeelChainCapabilityError, resolveKeelChainCapability } from "./chain-capability-map.js";
import { keelTezosKeyHashOfPublicKey } from "./tezos-automation.js";
import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import { packKeelTezosMicheline } from "./tezos-live-state.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/** keccak256("keel.recovery.manager"), EVM KeelManagerProxy.RECOVERY_SCOPE, used unchanged on Tezos. */
export const KEEL_TEZOS_MANAGER_RECOVERY_SCOPE = "0xcd155e9e01018fa80a056c2b4c6416622d952ab7f8cc515c7aeb00a6309595f1" as const;
/** The domain cold approvals sign: `keel.tezos.recovery.action.v1`. */
export const KEEL_TEZOS_RECOVERY_ACTION_DOMAIN = "keel.tezos.recovery.action.v1" as const;
/** The domain incoming-key acceptances sign: `keel.tezos.recovery.acceptance.v1`. */
export const KEEL_TEZOS_RECOVERY_ACCEPTANCE_DOMAIN = "keel.tezos.recovery.acceptance.v1" as const;
/** At most this many cold keys in a group: each key and signature travels in one operation. */
export const KEEL_TEZOS_RECOVERY_MAX_MEMBERS = 32 as const;
/** The all-zero group, which removes a binding, as EVM's bytes32(0). */
export const KEEL_TEZOS_RECOVERY_NO_GROUP = `0x${"00".repeat(32)}` as const;
/** The capability row for EVM upgradeWithBackup. */
export const KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY = "authority.recovery.upgrade" as const;

/** Each Tezos refusal and the EVM error it stands for. */
export const KEEL_TEZOS_RECOVERY_ERRORS = Object.freeze({
  KEEL_ROLE: "UnauthorizedRole",
  KEEL_MANAGER_ALREADY_PAUSED: "ManagerAlreadyPaused",
  KEEL_MANAGER_NOT_PAUSED: "ManagerNotPaused",
  KEEL_MANAGER_PAUSED: "ManagerIsPaused",
  KEEL_GOVERNANCE_ONLY: "UnauthorizedSelfCall",
  KEEL_GOVERNOR_ONLY: "GovernorMissing",
  KEEL_RECOVERY_GROUP: "InvalidRecoveryGroup",
  KEEL_RECOVERY_ROSTER: "InvalidRecoveryRoster",
  KEEL_RECOVERY_SIGNATURES: "InvalidRecoverySignatures",
  KEEL_RECOVERY_EXPIRED: "RecoveryExpired",
  KEEL_RECOVERY_NOT_CONFIGURED: "RecoveryNotConfigured",
  KEEL_RECOVERY_REVISION: "RecoveryRevisionMismatch",
  KEEL_RECOVERY_LOCKED: "RecoveryLocked",
  KEEL_RECOVERY_GOVERNORS: "InvalidRecoveryGovernors",
  KEEL_AUTOMATION_KEY: "AutomationKeyInactive",
} as const);

/** Thrown when a cold member or recovered governor is not an implicit-account key. */
export class KeelTezosRecoverySignerError extends TypeError {
  readonly code = "KEEL_TEZOS_RECOVERY_SIGNER" as const;
  readonly signer: string;

  constructor(signer: string) {
    super(`${signer} cannot hold a Tezos recovery key: only tz1, tz2 and tz3 keys sign, and Tezos has no ERC-1271 for KT1 contracts.`);
    this.name = "KeelTezosRecoverySignerError";
    this.signer = signer;
  }
}

/** EVM upgradeWithBackup: the Tezos manager has no script upgrade to recover. */
export class KeelTezosRecoveryUpgradeError extends KeelChainCapabilityError {
  constructor() {
    const resolution = resolveKeelChainCapability(KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY, "tezos");
    if (resolution.supported) throw new Error(`${KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY} must be EVM-only in the capability map.`);
    super(KEEL_TEZOS_RECOVERY_UPGRADE_CAPABILITY, "tezos", resolution.closest);
    this.name = "KeelTezosRecoveryUpgradeError";
  }
}

/** One cold or incoming key's signature: its public key and the Base58 signature. */
export interface KeelTezosRecoverySignature {
  readonly publicKey: string;
  readonly signature: string;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], (pairText) => parseInt(pairText, 16));
const utf8 = (text: string) => hex(new TextEncoder().encode(text));
const pair = (...items: TezosMichelineValue[]): TezosMichelineValue =>
  items.length === 1 ? items[0] as TezosMichelineValue : { prim: "Pair", args: [items[0] as TezosMichelineValue, pair(...items.slice(1))] };
const bytes = (value: Uint8Array | string): TezosMichelineValue => ({ bytes: typeof value === "string" ? value : hex(value) });
const int = (value: bigint): TezosMichelineValue => ({ int: value.toString() });
const bool = (value: boolean): TezosMichelineValue => ({ prim: value ? "True" : "False" });
const blake = (data: Uint8Array) => `0x${hex(blake2b(data, { dkLen: 32 }))}`;

function bytes32(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new TypeError(`${label} must be 32 bytes of 0x hex.`);
  return value.slice(2).toLowerCase();
}

function natural(value: unknown, label: string): bigint {
  const number = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : -1n;
  if (number < 0n) throw new RangeError(`${label} must be a natural number.`);
  return number;
}

function contract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

function network(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("Net")) throw new TypeError("network must be an exact Net... chain identity.");
  keelTezosChainIdBytes(value);
  return value;
}

/** A key hash's binary form (tag and hash), which Michelson compares and PACKs. */
function keyHashBytes(value: string): Uint8Array {
  return keelTezosAddressBytes(value, "key hash").slice(1);
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return (left[index] as number) - (right[index] as number);
  }
  return left.length - right.length;
}

/** An implicit-account key hash, refusing KT1 contracts with the typed error. */
export function keelTezosRecoveryKeyHash(value: string): string {
  if (typeof value !== "string" || !/^tz[123]/u.test(value)) throw new KeelTezosRecoverySignerError(String(value));
  keelTezosAddressBytes(value, "key hash");
  return value;
}

/**
 * Sort key hashes into the order Michelson compares them, refusing KT1s and
 * repeats. `minimum`/`maximum` bound the count.
 */
export function sortKeelTezosRecoveryKeys(values: readonly string[], bounds: { readonly minimum?: number; readonly maximum?: number; readonly forbidTwo?: boolean } = {}): string[] {
  if (!Array.isArray(values)) throw new TypeError("keys must be an array.");
  const keys = values.map((value) => keelTezosRecoveryKeyHash(value));
  const sorted = [...keys].sort((a, b) => compareBytes(keyHashBytes(a), keyHashBytes(b)));
  if (sorted.some((key, index) => index > 0 && key === sorted[index - 1])) throw new RangeError("keys must not repeat.");
  if (sorted.length < (bounds.minimum ?? 1) || sorted.length > (bounds.maximum ?? KEEL_TEZOS_RECOVERY_MAX_MEMBERS)) {
    throw new RangeError(`keys must number ${bounds.minimum ?? 1} to ${bounds.maximum ?? KEEL_TEZOS_RECOVERY_MAX_MEMBERS}.`);
  }
  if (bounds.forbidTwo && sorted.length === 2) throw new RangeError("A recovery group has one key or at least three, never two.");
  return sorted;
}

/** Sort signatures by their key hash, as the registry requires approvals. */
export function sortKeelTezosRecoverySignatures(signatures: readonly KeelTezosRecoverySignature[]): (KeelTezosRecoverySignature & { readonly signer: string })[] {
  if (!Array.isArray(signatures)) throw new TypeError("signatures must be an array.");
  const items = signatures.map((item, index) => {
    if (!item || typeof item.publicKey !== "string" || typeof item.signature !== "string") throw new TypeError(`signatures[${index}] needs publicKey and signature.`);
    if (!/^(?:edsig|spsig1|p2sig|sig)[1-9A-HJ-NP-Za-km-z]+$/u.test(item.signature)) throw new TypeError(`signatures[${index}].signature must be a Base58 Tezos signature.`);
    return { ...item, signer: keelTezosKeyHashOfPublicKey(item.publicKey) };
  });
  return items.sort((a, b) => compareBytes(keyHashBytes(a.signer), keyHashBytes(b.signer)));
}

const signatureList = (items: readonly KeelTezosRecoverySignature[]): TezosMichelineValue =>
  items.map((item) => pair({ string: item.publicKey }, { string: item.signature })) as unknown as TezosMichelineValue;
const keyList = (keys: readonly string[]): TezosMichelineValue => keys.map((key) => ({ string: key })) as unknown as TezosMichelineValue;
const keyListBytes = (keys: readonly string[]): TezosMichelineValue => keys.map((key) => bytes(keyHashBytes(key))) as unknown as TezosMichelineValue;

/** The id `create_group` gives a creator's salt: blake2b(PACK(pair(creator, salt))). */
export function keelTezosRecoveryGroupId(input: { readonly creator: string; readonly salt: string }): string {
  keelTezosAddressBytes(input.creator, "creator");
  return blake(packKeelTezosMicheline(pair(bytes(keelTezosAddressBytes(input.creator, "creator")), bytes(bytes32(input.salt, "salt")))));
}

/** EVM _rosterHash: blake2b(PACK(record(tag, members, verify_keys))). Members must already be sorted. */
export function keelTezosRecoveryRosterHash(members: readonly string[], verifyKeys: boolean): string {
  return blake(packKeelTezosMicheline(pair(bytes(utf8("keel.recovery.roster")), keyListBytes(members), bool(verifyKeys))));
}

/** EVM bindingHash: blake2b(PACK(record(tag, next_group, revision))). */
export function keelTezosRecoveryBindingHash(nextGroup: string, revision: bigint | number): string {
  return blake(packKeelTezosMicheline(pair(bytes(utf8("keel.recovery.binding")), bytes(bytes32(nextGroup, "nextGroup")), int(natural(revision, "revision")))));
}

/** The bound action hash authorize_bound checks: blake2b(PACK(pair(binding_revision, action_hash))). */
export function keelTezosRecoveryBoundActionHash(bindingRevision: bigint | number, actionHash: string): string {
  return blake(packKeelTezosMicheline(pair(int(natural(bindingRevision, "bindingRevision")), bytes(bytes32(actionHash, "actionHash")))));
}

/** The manager's recovery action hash: blake2b(PACK(governors)), the governors sorted. */
export function keelTezosManagerRecoveryActionHash(governors: readonly string[]): string {
  return blake(packKeelTezosMicheline(keyListBytes(sortKeelTezosRecoveryKeys(governors, { minimum: 1, maximum: 32 }))));
}

/** The bytes a cold member signs, as the registry's `action_payload` view returns them. */
export function keelTezosRecoveryActionPayload(input: {
  readonly network: string; readonly registry: string; readonly groupId: string; readonly resource: string; readonly scope: string;
  readonly actionHash: string; readonly nonce: bigint | number; readonly revision: bigint | number; readonly deadline: bigint | number;
}): string {
  const node = pair(
    bytes(utf8(KEEL_TEZOS_RECOVERY_ACTION_DOMAIN)),
    bytes(keelTezosAddressBytes(contract(input.registry, "registry"), "registry")),
    bytes(keelTezosChainIdBytes(network(input.network))),
    bytes(bytes32(input.groupId, "groupId")),
    bytes(keelTezosAddressBytes(input.resource, "resource")),
    bytes(bytes32(input.scope, "scope")),
    bytes(bytes32(input.actionHash, "actionHash")),
    int(natural(input.nonce, "nonce")),
    int(natural(input.revision, "revision")),
    int(natural(input.deadline, "deadline")),
  );
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

/** The digest of signed payload bytes: blake2b, EVM's EIP-712 digest. */
export function keelTezosRecoveryDigest(payload: string): string {
  if (typeof payload !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(payload)) throw new TypeError("payload must be 0x hex.");
  return blake(fromHex(payload.slice(2)));
}

/** The bytes one incoming key signs to accept a digest, as the registry's `acceptance_payload` view returns them. */
export function keelTezosRecoveryAcceptancePayload(input: { readonly network: string; readonly registry: string; readonly digest: string; readonly signer: string }): string {
  const node = pair(
    bytes(utf8(KEEL_TEZOS_RECOVERY_ACCEPTANCE_DOMAIN)),
    bytes(keelTezosAddressBytes(contract(input.registry, "registry"), "registry")),
    bytes(keelTezosChainIdBytes(network(input.network))),
    bytes(bytes32(input.digest, "digest")),
    bytes(keyHashBytes(keelTezosRecoveryKeyHash(input.signer))),
  );
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

function call(destination: string, entrypoint: string, value: TezosMichelineValue, authorization: string) {
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination, parameters: { entrypoint, value } };
  return { operation, authorization, signing: "not-performed" as const, submission: "not-performed" as const };
}

/**
 * EVM createGroup. `acceptances` are needed only with `verifyKeys`, one per
 * member over `keelTezosRecoveryAcceptancePayload` for the roster digest
 * (`roster_payload` view, or `keelTezosRecoveryActionPayload` with the group id
 * as scope, the registry as resource, nonce 0 and revision 0).
 */
export function buildKeelTezosRecoveryCreateGroup(input: {
  readonly registry: string; readonly salt: string; readonly members: readonly string[]; readonly verifyKeys: boolean;
  readonly deadline: bigint | number; readonly acceptances?: readonly KeelTezosRecoverySignature[];
}) {
  const members = sortKeelTezosRecoveryKeys(input.members, { forbidTwo: true });
  const acceptances = sortKeelTezosRecoverySignatures(input.acceptances ?? []);
  if (input.verifyKeys && acceptances.length !== members.length) throw new RangeError("Every member must accept when verifyKeys is set.");
  if (!input.verifyKeys && acceptances.length !== 0) throw new RangeError("Acceptances are only sent with verifyKeys.");
  const value = pair(bytes(bytes32(input.salt, "salt")), keyList(members), bool(input.verifyKeys), int(natural(input.deadline, "deadline")), signatureList(acceptances));
  return { members, rosterHash: keelTezosRecoveryRosterHash(members, input.verifyKeys), ...call(contract(input.registry, "registry"), "create_group", value, "any-sender") };
}

/** EVM rotateGroup: the current quorum's approvals over the roster payload, then the incoming keys' acceptances. */
export function buildKeelTezosRecoveryRotateGroup(input: {
  readonly registry: string; readonly groupId: string; readonly members: readonly string[]; readonly verifyKeys: boolean;
  readonly deadline: bigint | number; readonly approvals: readonly KeelTezosRecoverySignature[]; readonly acceptances?: readonly KeelTezosRecoverySignature[];
}) {
  const members = sortKeelTezosRecoveryKeys(input.members, { forbidTwo: true });
  const value = pair(bytes(bytes32(input.groupId, "groupId")), keyList(members), bool(input.verifyKeys), int(natural(input.deadline, "deadline")),
    signatureList(sortKeelTezosRecoverySignatures(input.approvals)), signatureList(sortKeelTezosRecoverySignatures(input.acceptances ?? [])));
  return { members, rosterHash: keelTezosRecoveryRosterHash(members, input.verifyKeys), ...call(contract(input.registry, "registry"), "rotate_group", value, "any-relayer") };
}

/**
 * EVM configureBackup on the manager. With nothing bound yet only governance may
 * send it (wrap the operation in a governance lambda); after that the cold
 * approvals are the authority and any relayer sends it.
 */
export function buildKeelTezosManagerConfigureBackup(input: {
  readonly manager: string; readonly nextGroup: string; readonly expectedRevision: bigint | number; readonly deadline: bigint | number;
  readonly currentApprovals?: readonly KeelTezosRecoverySignature[]; readonly incomingApprovals?: readonly KeelTezosRecoverySignature[];
  readonly enrolled: boolean;
}) {
  const revision = natural(input.expectedRevision, "expectedRevision");
  const value = pair(bytes(bytes32(input.nextGroup, "nextGroup")), int(revision), int(natural(input.deadline, "deadline")),
    signatureList(sortKeelTezosRecoverySignatures(input.currentApprovals ?? [])), signatureList(sortKeelTezosRecoverySignatures(input.incomingApprovals ?? [])));
  return { actionHash: keelTezosRecoveryBindingHash(input.nextGroup, revision),
    ...call(contract(input.manager, "manager"), "configure_backup", value, input.enrolled ? "any-relayer" : "governance") };
}

/**
 * EVM recoverGovernors. The cold quorum signs the bound payload for the sorted
 * governors' action hash; every incoming governor accepts its digest. The manager
 * comes back paused with the new roster, and old roles, keys and approvals retire.
 */
export function buildKeelTezosManagerRecovery(input: {
  readonly manager: string; readonly governors: readonly string[]; readonly deadline: bigint | number;
  readonly approvals: readonly KeelTezosRecoverySignature[]; readonly acceptances: readonly KeelTezosRecoverySignature[];
}) {
  const governors = sortKeelTezosRecoveryKeys(input.governors, { minimum: 3, maximum: 32 });
  const acceptances = sortKeelTezosRecoverySignatures(input.acceptances);
  if (acceptances.length !== governors.length || acceptances.some((item, index) => item.signer !== governors[index])) {
    throw new RangeError("Every incoming governor must accept, one acceptance each.");
  }
  const value = pair(keyList(governors), int(natural(input.deadline, "deadline")), signatureList(sortKeelTezosRecoverySignatures(input.approvals)), signatureList(acceptances));
  return { governors, actionHash: keelTezosManagerRecoveryActionHash(governors), scope: KEEL_TEZOS_MANAGER_RECOVERY_SCOPE,
    ...call(contract(input.manager, "manager"), "recover_governors", value, "any-relayer") };
}

/** EVM pause() by an Admin: the Admin sends `pause_manager` to the access controller, which forwards it. */
export function buildKeelTezosManagerPause(input: { readonly controller: string }) {
  return call(contract(input.controller, "controller"), "pause_manager", { prim: "Unit" }, "admin");
}

/** EVM unpause(): a governance action on the manager. */
export function buildKeelTezosManagerUnpause(input: { readonly manager: string }) {
  return call(contract(input.manager, "manager"), "unpause", { prim: "Unit" }, "governance");
}

/** The one-time governance binding of the native KeelRecoveryGroups (EVM fixes it in the proxy). */
export function buildKeelTezosBindRecoveryGroups(input: { readonly manager: string; readonly registry: string }) {
  return call(contract(input.manager, "manager"), "bind_recovery_groups", { string: contract(input.registry, "registry") }, "governance");
}

/** EVM upgradeWithBackup has no Tezos counterpart; this always throws the typed capability error. */
export function buildKeelTezosRecoveryUpgrade(): never {
  throw new KeelTezosRecoveryUpgradeError();
}
