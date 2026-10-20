/**
 * Entrypoint capabilities on Tezos, the native side of EVM `KeelManager`'s
 * `(target, selector)` execution policies.
 *
 * EVM lets an Admin, a Moderator or an automation key call one selector on one
 * target with any arguments. `KeelAccessController` does the same for one typed
 * entrypoint: governance names `(target, entrypoint, parameter type)`, the
 * controller writes and typechecks the adapter lambda itself, and the caller
 * supplies only the packed arguments. See
 * docs/reviews/tezos-behavior-parity-20261015/ENTRYPOINT_CAPABILITIES.md in
 * keel-contracts. What the chain changes, and these helpers hide:
 *
 * - The parameter type is part of the key, because a Tezos entrypoint is typed
 *   and the adapter needs the type. A selector already encodes the argument
 *   types on EVM.
 * - The target sees the access controller as the caller, not the manager. A
 *   module that should accept role calls trusts the controller, as an EVM
 *   module grants the manager a role.
 * - EVM protects nine selectors. The controller protects the entrypoint names
 *   the KEEL Tezos modules use for the same powers; this module refuses them
 *   before any call is built.
 *
 * Nothing here signs, submits or reads a chain.
 */

import { blake2b } from "@noble/hashes/blake2b";

import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import type { KeelTezosGovernanceCall } from "./tezos-governance.js";
import {
  keelTezosLiveMichelineType,
  keelTezosLiveMichelineValue,
  packKeelTezosMicheline,
  type KeelTezosLiveType,
  type KeelTezosLiveValue,
} from "./tezos-live-state.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/** The domain an automation key's entrypoint signature starts with. */
export const KEEL_TEZOS_ENTRYPOINT_AUTOMATION_DOMAIN = "keel.tezos.automation.entrypoint.v1" as const;

/** EVM ProtectedCapability, in the names KEEL Tezos modules use for role, ownership and admin changes. */
export const KEEL_TEZOS_PROTECTED_ENTRYPOINTS = Object.freeze([
  "set_administrator", "add_administrator", "remove_administrator", "nominate_administrator", "accept_administrator",
  "nominate_manager", "accept_manager", "set_controller", "accept_controller", "begin_controller_transfer",
  "set_collection_controller", "set_campaign_admin", "configure_role",
] as const);

/** The only manager entrypoint a capability may name, as EVM allows pauseSystems on the manager. */
export const KEEL_TEZOS_MANAGER_DELEGABLE_ENTRYPOINTS = Object.freeze(["pause_systems"] as const);

/** Tezos refusals by the EVM error each one stands for, split by call as the automation map is. */
export const KEEL_TEZOS_ENTRYPOINT_CAPABILITY_ERRORS = Object.freeze({
  configure: Object.freeze({
    KEEL_TARGET: "InvalidTarget",
    KEEL_ENTRYPOINT: "InvalidSelector",
    KEEL_MANAGER_PROTECTED: "ProtectedManagerFunction",
    KEEL_CONTROLLER_PROTECTED: "ProtectedManagerFunction",
    KEEL_CAPABILITY_PROTECTED: "ProtectedCapability",
    KEEL_TIER: "InvalidAccessTier",
    KEEL_PARAMETER_TYPE: "InvalidSelector",
  } as const),
  execute: Object.freeze({
    KEEL_PAUSED: "ManagerIsPaused",
    KEEL_MANAGER_PAUSED: "ManagerIsPaused",
    KEEL_AMOUNT: "IncorrectValue",
    KEEL_ROLE: "UnauthorizedRole",
    KEEL_POLICY: "ExecutionNotAllowed",
    KEEL_TIER: "ExecutionNotAllowed",
    KEEL_VALUE_LIMIT: "ValueLimitExceeded",
    KEEL_DEADLINE: "SignatureExpired",
    KEEL_AUTOMATION_KEY: "AutomationKeyInactive",
    KEEL_AUTOMATION_GRANT: "AutomationCapabilityMissing",
    KEEL_SIGNATURE_INVALID: "InvalidSignature",
  } as const),
} as const);

/** Thrown before any call is built for a capability the controller would refuse to configure. */
export class KeelTezosEntrypointCapabilityError extends TypeError {
  readonly code: "KEEL_CAPABILITY_PROTECTED" | "KEEL_MANAGER_PROTECTED" | "KEEL_CONTROLLER_PROTECTED" | "KEEL_ENTRYPOINT" | "KEEL_TARGET";
  readonly evmError: string;
  constructor(code: KeelTezosEntrypointCapabilityError["code"], message: string) {
    super(message);
    this.name = "KeelTezosEntrypointCapabilityError";
    this.code = code;
    this.evmError = KEEL_TEZOS_ENTRYPOINT_CAPABILITY_ERRORS.configure[code];
  }
}

/** One capability: a target contract, its entrypoint and the entrypoint's parameter type. */
export interface KeelTezosEntrypointCapability {
  readonly target: string;
  /** "default" for a contract's default entrypoint. */
  readonly entrypoint: string;
  /** The parameter type, as a declared type or raw Micheline (no annotations). */
  readonly parameterType: KeelTezosLiveType | { readonly micheline: TezosMichelineValue };
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../gu) ?? [], (pair) => parseInt(pair, 16));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => Array.from(part)));
const u32 = (value: number) => Uint8Array.of(value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
const pair = (...items: TezosMichelineValue[]): TezosMichelineValue =>
  items.length === 1 ? items[0] as TezosMichelineValue : { prim: "Pair", args: [items[0] as TezosMichelineValue, pair(...items.slice(1))] };

function natural(value: unknown, label: string, max = (1n << 63n) - 1n): bigint {
  const number = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : -1n;
  if (number < 0n || number > max) throw new RangeError(`${label} must be a natural number no larger than ${max}.`);
  return number;
}

function contract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

// Michelson type primitives as binary Micheline numbers them.
const TYPE_CODES: Readonly<Record<string, number>> = {
  bool: 0x59, contract: 0x5a, int: 0x5b, key: 0x5c, key_hash: 0x5d, lambda: 0x5e, list: 0x5f, map: 0x60, big_map: 0x61, nat: 0x62,
  option: 0x63, or: 0x64, pair: 0x65, set: 0x66, signature: 0x67, string: 0x68, bytes: 0x69, mutez: 0x6a, timestamp: 0x6b,
  unit: 0x6c, operation: 0x6d, address: 0x6e, chain_id: 0x74, never: 0x78, ticket: 0x87,
};

/** Binary Micheline of a type without annotations; a pair of three or more is written as its right comb. */
function encodeType(node: TezosMichelineValue): Uint8Array {
  const item = node as { prim?: unknown; args?: readonly TezosMichelineValue[]; annots?: unknown };
  const code = typeof item.prim === "string" ? TYPE_CODES[item.prim] : undefined;
  if (code === undefined || Array.isArray(node)) throw new TypeError(`parameterType: ${JSON.stringify(node)} is not a Michelson type.`);
  if (item.annots !== undefined) throw new TypeError("parameterType carries no annotations; the controller keys the bare type.");
  const args = item.args ?? [];
  if (item.prim === "pair" && args.length > 2) return encodeType({ prim: "pair", args: [args[0] as TezosMichelineValue, { prim: "pair", args: args.slice(1) }] });
  if (args.length === 0) return Uint8Array.of(0x03, code);
  if (args.length === 1) return concat(Uint8Array.of(0x05, code), encodeType(args[0] as TezosMichelineValue));
  if (args.length === 2) return concat(Uint8Array.of(0x07, code), encodeType(args[0] as TezosMichelineValue), encodeType(args[1] as TezosMichelineValue));
  throw new TypeError(`parameterType: ${item.prim} takes at most two arguments.`);
}

function typeNode(capability: KeelTezosEntrypointCapability): TezosMichelineValue {
  const type = capability.parameterType;
  return typeof type === "object" && type !== null && "micheline" in type ? type.micheline : keelTezosLiveMichelineType(type as KeelTezosLiveType);
}

function normalize(capability: KeelTezosEntrypointCapability) {
  if (!capability || typeof capability !== "object") throw new TypeError("capability must be an object.");
  if (typeof capability.target !== "string" || !capability.target.startsWith("KT1")) {
    throw new KeelTezosEntrypointCapabilityError("KEEL_TARGET", "A capability targets an originated KT1 contract; an account has no entrypoints.");
  }
  keelTezosAddressBytes(capability.target, "target");
  const entrypoint = capability.entrypoint;
  if (typeof entrypoint !== "string" || !/^[A-Za-z0-9_.%@]{1,31}$/u.test(entrypoint)) {
    throw new KeelTezosEntrypointCapabilityError("KEEL_ENTRYPOINT", "An entrypoint name is 1 to 31 Michelson annotation characters.");
  }
  const parameterType = encodeType(typeNode(capability));
  return { target: capability.target, entrypoint, parameterType };
}

/** The controller's capability key, `blake2b(PACK(record(target, entrypoint, parameter_type)))`; EVM policyKey(target, selector). */
export function keelTezosEntrypointCapabilityKey(capability: KeelTezosEntrypointCapability): string {
  const { target, entrypoint, parameterType } = normalize(capability);
  const material = pair({ bytes: hex(keelTezosAddressBytes(target, "target")) }, { string: entrypoint }, { bytes: hex(parameterType) });
  return `0x${hex(blake2b(packKeelTezosMicheline(material), { dkLen: 32 }))}`;
}

/** The exact adapter and probe the controller writes and UNPACKs for this capability, as its `entrypoint_lambdas_of` view returns them. */
export function keelTezosEntrypointLambdas(capability: KeelTezosEntrypointCapability) {
  const { target, entrypoint, parameterType } = normalize(capability);
  const address = keelTezosAddressBytes(target, "target");
  let site = concat(fromHex("0743036e0a"), u32(address.length), address);
  if (entrypoint === "default") site = concat(site, fromHex("0555"), parameterType);
  else {
    const annotation = new TextEncoder().encode(`%${entrypoint}`);
    site = concat(site, fromHex("0655"), parameterType, u32(annotation.length), annotation);
  }
  const lambda = (body: Uint8Array) => `0x${hex(concat(fromHex("0502"), u32(body.length), body))}`;
  return {
    adapter: lambda(concat(fromHex("037a037a050d"), parameterType, fromHex("072f02000000140743036801000000094b45454c5f4152475303270200000000"),
      site, fromHex("072f020000001607430368010000000b4b45454c5f5441524745540327020000000005710002034d031b034f0342"))),
    probe: lambda(concat(fromHex("0320"), site, fromHex("072f02000000060743035903030200000008032007430359030a"))),
  };
}

/** PACK of a call's arguments: a declared type and value, or raw Micheline in optimized form. */
export function packKeelTezosEntrypointArgs(capability: KeelTezosEntrypointCapability, value: KeelTezosLiveValue | { readonly micheline: TezosMichelineValue }): string {
  const type = capability.parameterType;
  const node = typeof value === "object" && value !== null && !Array.isArray(value) && "micheline" in value
    ? value.micheline as TezosMichelineValue
    : typeof type === "object" && type !== null && "micheline" in type
      ? (() => { throw new TypeError("A raw Micheline parameter type needs raw Micheline arguments: { micheline }."); })()
      : keelTezosLiveMichelineValue(type as KeelTezosLiveType, value as KeelTezosLiveValue, "pack", "args");
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

/**
 * EVM configureExecutionPolicy(target, selector, tier, maxValue, enabled) as a
 * call governance makes on the controller. Refuses, with
 * `KeelTezosEntrypointCapabilityError`, what the controller would refuse
 * before it ever reads the chain: protected names, the controller itself, a
 * manager entrypoint other than `pause_systems`, a bad name or tier.
 */
export function prepareKeelTezosEntrypointCapability(input: KeelTezosEntrypointCapability & {
  readonly controller: string; readonly manager?: string; readonly minimumTier: 1 | 2 | 3; readonly maxAmount: bigint | number | string;
  readonly enabled: boolean;
}) {
  const controller = contract(input.controller, "controller");
  const capability = normalize(input);
  if (capability.target === controller) throw new KeelTezosEntrypointCapabilityError("KEEL_CONTROLLER_PROTECTED", "The controller is never a capability target.");
  if (input.manager !== undefined && capability.target === contract(input.manager, "manager")
    && !(KEEL_TEZOS_MANAGER_DELEGABLE_ENTRYPOINTS as readonly string[]).includes(capability.entrypoint)) {
    throw new KeelTezosEntrypointCapabilityError("KEEL_MANAGER_PROTECTED", "Of the manager's own entrypoints only pause_systems may be delegated.");
  }
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
  if (input.enabled && (KEEL_TEZOS_PROTECTED_ENTRYPOINTS as readonly string[]).includes(capability.entrypoint)) {
    throw new KeelTezosEntrypointCapabilityError("KEEL_CAPABILITY_PROTECTED", `${capability.entrypoint} changes authority and cannot be delegated.`);
  }
  if (input.enabled && ![1, 2, 3].includes(input.minimumTier)) throw new RangeError("minimumTier is 1 (Automation), 2 (Moderator) or 3 (Admin).");
  const maxAmount = natural(input.maxAmount, "maxAmount");
  const value = pair({ string: capability.target }, { string: capability.entrypoint }, { bytes: hex(capability.parameterType) },
    { int: String(input.minimumTier ?? 0) }, { int: maxAmount.toString() }, { prim: input.enabled ? "True" : "False" });
  const parameterType: TezosMichelineValue = { prim: "pair", args: [{ prim: "address" }, { prim: "pair", args: [{ prim: "string" },
    { prim: "pair", args: [{ prim: "bytes" }, { prim: "pair", args: [{ prim: "nat" }, { prim: "pair", args: [{ prim: "mutez" }, { prim: "bool" }] }] }] }] }] };
  const governanceCall: KeelTezosGovernanceCall = { destination: controller, entrypoint: "configure_entrypoint_policy", parameterType, value };
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: controller, parameters: { entrypoint: "configure_entrypoint_policy", value } };
  return {
    capabilityKey: keelTezosEntrypointCapabilityKey(input), parameterType: `0x${hex(capability.parameterType)}`,
    ...keelTezosEntrypointLambdas(input), governanceCall, operation,
    authorization: "governance" as const, signing: "not-performed" as const, submission: "not-performed" as const,
  };
}

/** EVM executeRole(Call(target, value, data)) for an entrypoint capability: the caller attaches exactly `amount`. */
export function buildKeelTezosRoleEntrypointCall(input: KeelTezosEntrypointCapability & {
  readonly controller: string; readonly args: KeelTezosLiveValue | { readonly micheline: TezosMichelineValue }; readonly amount?: bigint | number | string;
}) {
  const controller = contract(input.controller, "controller");
  const amount = natural(input.amount ?? 0, "amount");
  const capabilityKey = keelTezosEntrypointCapabilityKey(input);
  const args = packKeelTezosEntrypointArgs(input, input.args);
  const value = pair({ bytes: capabilityKey.slice(2) }, { bytes: args.slice(2) }, { int: amount.toString() });
  const operation: TezosTransactionOperation = { kind: "transaction", amount: amount.toString(), destination: controller,
    parameters: { entrypoint: "execute_role_entrypoint", value } };
  return { capabilityKey, args, operation, authorization: "admin-or-moderator" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

/** The exact bytes an automation key signs for an entrypoint call, as the controller's `entrypoint_signing_payload` view returns them. */
export function keelTezosAutomationEntrypointPayload(input: {
  readonly network: string; readonly controller: string; readonly signer: string; readonly capabilityKey: string;
  readonly args: string; readonly amount?: bigint | number | string; readonly nonce: bigint | number; readonly deadline: bigint | number;
}): string {
  const controller = contract(input.controller, "controller");
  if (typeof input.signer !== "string" || !/^tz[123]/u.test(input.signer)) throw new TypeError("signer must be a tz1, tz2 or tz3 key hash.");
  if (typeof input.capabilityKey !== "string" || !/^0x[0-9a-f]{64}$/u.test(input.capabilityKey)) throw new TypeError("capabilityKey must be 32 bytes of hex.");
  if (typeof input.args !== "string" || !/^0x05(?:[0-9a-f]{2})+$/u.test(input.args)) throw new TypeError("args must be PACKed bytes (0x05...).");
  const node = pair(
    { bytes: hex(new TextEncoder().encode(KEEL_TEZOS_ENTRYPOINT_AUTOMATION_DOMAIN)) },
    { bytes: hex(keelTezosAddressBytes(controller, "controller")) },
    { bytes: hex(keelTezosChainIdBytes(input.network)) },
    { bytes: hex(keelTezosAddressBytes(input.signer, "signer").slice(1)) },
    { bytes: input.capabilityKey.slice(2) },
    { int: natural(input.amount ?? 0, "amount").toString() },
    { bytes: hex(blake2b(fromHex(input.args.slice(2)), { dkLen: 32 })) },
    { int: natural(input.nonce, "nonce", (1n << 256n) - 1n).toString() },
    { int: natural(input.deadline, "deadline", (1n << 64n) - 1n).toString() },
  );
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

/** The relayer's transaction, EVM executeAutomation, for an entrypoint capability. */
export function buildKeelTezosAutomationEntrypointCall(input: {
  readonly controller: string; readonly signer: string; readonly capabilityKey: string; readonly args: string;
  readonly amount?: bigint | number | string; readonly deadline: bigint | number; readonly signature: string;
}) {
  const controller = contract(input.controller, "controller");
  if (typeof input.signer !== "string" || !/^tz[123]/u.test(input.signer)) throw new TypeError("signer must be a tz1, tz2 or tz3 key hash.");
  if (typeof input.signature !== "string" || !/^(?:edsig|spsig1|p2sig|sig)[1-9A-HJ-NP-Za-km-z]+$/u.test(input.signature)) throw new TypeError("signature must be a Base58 Tezos signature.");
  if (!/^0x[0-9a-f]{64}$/u.test(input.capabilityKey) || !/^0x05(?:[0-9a-f]{2})+$/u.test(input.args)) throw new TypeError("capabilityKey and args must be hex.");
  const amount = natural(input.amount ?? 0, "amount");
  const value = pair({ string: input.signer }, pair({ bytes: input.capabilityKey.slice(2) }, { bytes: input.args.slice(2) }, { int: amount.toString() }),
    { int: natural(input.deadline, "deadline", (1n << 64n) - 1n).toString() }, { string: input.signature });
  const operation: TezosTransactionOperation = { kind: "transaction", amount: amount.toString(), destination: controller,
    parameters: { entrypoint: "execute_automation_entrypoint", value } };
  return { operation, authorization: "any-relayer" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}
