/**
 * KEEL execution automation on Tezos, the native side of EVM
 * `KeelManager.executeAutomation`.
 *
 * EVM keeps the key, the grants and the execution in one manager. Tezos keeps
 * role and automation execution in `KeelAccessController`, which the manager
 * configures inside two-thirds governance lambdas, as EVM governance calls the
 * manager. The checks and their order are EVM's; see
 * docs/reviews/tezos-behavior-parity-20261015/EXECUTION_AUTOMATION.md in
 * keel-contracts. Three differences are the chain's:
 *
 * - A capability names the exact `(target, payload)` sent to the target's
 *   `keel_manage(bytes)`, where EVM names `(target, selector)`.
 * - Only implicit-account keys (tz1, tz2, tz3) sign. A KT1 cannot produce a
 *   signature and Tezos has no ERC-1271, so a KT1 signer is refused with
 *   `KeelTezosAutomationSignerError`.
 * - The controller keeps its own signer nonce. The signed bytes bind the
 *   controller and chain, as EIP-712's domain does.
 *
 * Nothing here signs, submits or reads a chain.
 */

import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";

import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import { packKeelTezosMicheline } from "./tezos-live-state.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/** The domain the signed bytes start with: `keel.tezos.automation.execute.v1`. */
export const KEEL_TEZOS_AUTOMATION_DOMAIN = "keel.tezos.automation.execute.v1" as const;
/** EVM MAX_AUTOMATION_KEY_LIFETIME: keys and grants end within 30 days. */
export const KEEL_TEZOS_AUTOMATION_MAX_LIFETIME_SECONDS = 2_592_000 as const;
/** The policy tier an automation key may use, EVM AccessTier.Automation. */
export const KEEL_TEZOS_AUTOMATION_TIER = 1 as const;

/**
 * EVM error names and the Tezos strings that mean the same refusal. The same
 * Tezos string can mean two EVM errors, so the map is split by call: a missing
 * key is InvalidValidityWindow when governance grants and AutomationKeyInactive
 * when a relayer executes, and so on.
 */
export const KEEL_TEZOS_AUTOMATION_ERRORS = Object.freeze({
  configure: Object.freeze({
    KEEL_AUTOMATION_LIFETIME: "InvalidValidityWindow",
    KEEL_AUTOMATION_EXPIRED: "InvalidValidityWindow",
    KEEL_AUTOMATION_WINDOW: "InvalidValidityWindow",
    KEEL_AUTOMATION_KEY: "InvalidValidityWindow",
    KEEL_POLICY: "ExecutionNotAllowed",
    KEEL_TIER: "ExecutionNotAllowed",
    KEEL_VALUE_LIMIT: "ExecutionNotAllowed",
  } as const),
  execute: Object.freeze({
    KEEL_PAUSED: "ManagerIsPaused",
    KEEL_AMOUNT: "IncorrectValue",
    KEEL_DEADLINE: "SignatureExpired",
    KEEL_AUTOMATION_KEY: "AutomationKeyInactive",
    KEEL_POLICY: "ExecutionNotAllowed",
    KEEL_TIER: "ExecutionNotAllowed",
    KEEL_AUTOMATION_GRANT: "AutomationCapabilityMissing",
    KEEL_VALUE_LIMIT: "ValueLimitExceeded",
    KEEL_SIGNATURE_INVALID: "InvalidSignature",
  } as const),
} as const);

/** Thrown when an automation signer is not an implicit-account key. */
export class KeelTezosAutomationSignerError extends TypeError {
  readonly code = "KEEL_TEZOS_AUTOMATION_SIGNER" as const;
  readonly signer: string;

  constructor(signer: string) {
    super(`${signer} cannot sign Tezos automation: only tz1, tz2 and tz3 keys sign, and Tezos has no ERC-1271 for KT1 contracts.`);
    this.name = "KeelTezosAutomationSignerError";
    this.signer = signer;
  }
}

/** One exact call through the controller: the bytes go to the target's `keel_manage`, with `amount` mutez. */
export interface KeelTezosManagedCall {
  readonly target: string;
  readonly payload: string;
  readonly amount: bigint | number | string;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PUBLIC_KEYS = [
  { prefix: "edpk", bytes: [13, 15, 37, 217], length: 32, hash: [6, 161, 159] },
  { prefix: "sppk", bytes: [3, 254, 226, 86], length: 33, hash: [6, 161, 161] },
  { prefix: "p2pk", bytes: [3, 178, 139, 127], length: 33, hash: [6, 161, 164] },
] as const;
const MUTEZ_MAX = (1n << 63n) - 1n;

function base58Decode(text: string, label: string): Uint8Array {
  let number = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) throw new TypeError(`${label} is not Base58.`);
    number = number * 58n + BigInt(digit);
  }
  const out: number[] = [];
  while (number > 0n) { out.unshift(Number(number % 256n)); number /= 256n; }
  for (const char of text) { if (char !== "1") break; out.unshift(0); }
  const bytes = Uint8Array.from(out);
  const body = bytes.slice(0, -4);
  const checksum = sha256(sha256(body)).slice(0, 4);
  if (bytes.length < 5 || checksum.some((byte, index) => byte !== bytes[bytes.length - 4 + index])) throw new TypeError(`${label} has a bad checksum.`);
  return body;
}

function base58Encode(prefix: readonly number[], payload: Uint8Array): string {
  const body = Uint8Array.from([...prefix, ...payload]);
  const bytes = Uint8Array.from([...body, ...sha256(sha256(body)).slice(0, 4)]);
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let out = "";
  while (number > 0n) { out = BASE58[Number(number % 58n)] + out; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = `1${out}`; }
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function payloadHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0x)?(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new TypeError(`${label} must be even-length hex.`);
  return value.replace(/^0x/u, "").toLowerCase();
}

function mutez(value: unknown, label: string): bigint {
  const amount = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : undefined;
  if (amount === undefined || amount < 0n || amount > MUTEZ_MAX) throw new RangeError(`${label} must be mutez.`);
  return amount;
}

function seconds(value: unknown, label: string): bigint {
  const time = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : undefined;
  if (time === undefined || time < 0n) throw new RangeError(`${label} must be whole UNIX seconds.`);
  return time;
}

function contract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

/** The signer's key hash, refusing anything but an implicit-account key. */
export function keelTezosAutomationSigner(signer: string): string {
  if (typeof signer === "string" && signer.startsWith("KT1")) throw new KeelTezosAutomationSignerError(signer);
  if (typeof signer !== "string" || !/^tz[123]/u.test(signer)) throw new KeelTezosAutomationSignerError(String(signer));
  keelTezosAddressBytes(signer, "signer");
  return signer;
}

/** The tz1, tz2 or tz3 key hash of an edpk, sppk or p2pk public key, as `sp.hash_key` computes it. */
export function keelTezosKeyHashOfPublicKey(publicKey: string): string {
  const kind = PUBLIC_KEYS.find((entry) => typeof publicKey === "string" && publicKey.startsWith(entry.prefix));
  if (kind === undefined) throw new KeelTezosAutomationSignerError(String(publicKey));
  const body = base58Decode(publicKey, "publicKey");
  if (body.length !== kind.bytes.length + kind.length || kind.bytes.some((byte, index) => body[index] !== byte)) throw new TypeError("publicKey has the wrong length.");
  return base58Encode(kind.hash, blake2b(body.slice(kind.bytes.length), { dkLen: 20 }));
}

function call(value: KeelTezosManagedCall, label = "call") {
  if (!value || typeof value !== "object") throw new TypeError(`${label} must be an object.`);
  return { target: contract(value.target, `${label}.target`), payload: payloadHex(value.payload, `${label}.payload`), amount: mutez(value.amount, `${label}.amount`) };
}

const pair = (...items: TezosMichelineValue[]): TezosMichelineValue =>
  items.length === 1 ? items[0] as TezosMichelineValue : { prim: "Pair", args: [items[0] as TezosMichelineValue, pair(...items.slice(1))] };
const bytes = (value: Uint8Array | string): TezosMichelineValue => ({ bytes: typeof value === "string" ? value : hex(value) });
const int = (value: bigint): TezosMichelineValue => ({ int: value.toString() });

/** The controller's capability key, `blake2b(PACK(record(target, payload)))`, as its `capability_key_of` view returns. */
export function keelTezosCapabilityKey(value: { readonly target: string; readonly payload: string }): string {
  const target = contract(value.target, "target");
  const material = pair(bytes(keelTezosAddressBytes(target, "target")), bytes(payloadHex(value.payload, "payload")));
  return `0x${hex(blake2b(packKeelTezosMicheline(material), { dkLen: 32 }))}`;
}

/** The exact bytes the automation key signs, as the controller's `automation_signing_payload` view returns them. */
export function keelTezosAutomationSigningPayload(input: {
  readonly network: string; readonly controller: string; readonly signer: string; readonly call: KeelTezosManagedCall;
  readonly nonce: bigint | number; readonly deadline: bigint | number;
}): string {
  const controller = contract(input.controller, "controller");
  const signer = keelTezosAutomationSigner(input.signer);
  const action = call(input.call);
  const nonce = typeof input.nonce === "bigint" ? input.nonce : typeof input.nonce === "number" && Number.isSafeInteger(input.nonce) ? BigInt(input.nonce) : -1n;
  if (nonce < 0n) throw new RangeError("nonce must be a natural number.");
  const node = pair(
    bytes(hex(new TextEncoder().encode(KEEL_TEZOS_AUTOMATION_DOMAIN))),
    bytes(keelTezosAddressBytes(controller, "controller")),
    bytes(keelTezosChainIdBytes(input.network)),
    bytes(keelTezosAddressBytes(signer, "signer").slice(1)),
    bytes(keelTezosAddressBytes(action.target, "call.target")),
    int(action.amount),
    bytes(blake2b(Uint8Array.from(action.payload.match(/../gu) ?? [], (pairText) => parseInt(pairText, 16)), { dkLen: 32 })),
    int(nonce),
    int(seconds(input.deadline, "deadline")),
  );
  return `0x${hex(packKeelTezosMicheline(node))}`;
}

function governance(destination: string, entrypoint: string, value: TezosMichelineValue) {
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination, parameters: { entrypoint, value } };
  return { operation, authorization: "governance" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

/**
 * Governance's key switch, EVM configureAutomationKey. With `signatureAuthority`
 * the same switch goes to KeelSignatureAuthority too, so one lambda turns the key
 * on or off for execution and signature approvals together, as EVM's one manager
 * does. Disabling ignores `validUntil`.
 */
export function buildKeelTezosAutomationKeyActions(input: {
  readonly controller: string; readonly signatureAuthority?: string; readonly publicKey: string;
  readonly validUntil: bigint | number; readonly enabled: boolean;
}) {
  const signer = keelTezosKeyHashOfPublicKey(input.publicKey);
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
  const value = pair({ string: input.publicKey }, int(input.enabled ? seconds(input.validUntil, "validUntil") : 0n), { prim: input.enabled ? "True" : "False" });
  const targets = [contract(input.controller, "controller")];
  if (input.signatureAuthority !== undefined) targets.push(contract(input.signatureAuthority, "signatureAuthority"));
  return { signer, actions: targets.map((target) => governance(target, "configure_automation_key", value)) };
}

/** Governance's grant, EVM configureAutomationCapability, for one exact call. */
export function buildKeelTezosAutomationCapabilityAction(input: {
  readonly controller: string; readonly signer: string; readonly call: Omit<KeelTezosManagedCall, "amount">;
  readonly validAfter: bigint | number; readonly validUntil: bigint | number; readonly maxAmount: bigint | number | string;
  readonly enabled: boolean;
}) {
  const signer = keelTezosAutomationSigner(input.signer);
  const capabilityKey = keelTezosCapabilityKey(input.call);
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
  const after = seconds(input.validAfter, "validAfter");
  const until = seconds(input.validUntil, "validUntil");
  if (input.enabled && until <= after) throw new RangeError("validUntil must be after validAfter.");
  if (input.enabled && until - after > BigInt(KEEL_TEZOS_AUTOMATION_MAX_LIFETIME_SECONDS)) throw new RangeError("A grant lasts 30 days at most.");
  const value = pair({ string: signer }, bytes(capabilityKey.slice(2)), int(after), int(until), int(mutez(input.maxAmount, "maxAmount")), { prim: input.enabled ? "True" : "False" });
  return { capabilityKey, ...governance(contract(input.controller, "controller"), "configure_automation_capability", value) };
}

/** Governance's Automation-tier policy for one exact call (minimum tier 1, so roles may use it too). */
export function buildKeelTezosAutomationPolicyAction(input: {
  readonly controller: string; readonly call: Omit<KeelTezosManagedCall, "amount">; readonly maxAmount: bigint | number | string; readonly enabled: boolean;
}) {
  const capabilityKey = keelTezosCapabilityKey(input.call);
  if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
  const value = pair(bytes(capabilityKey.slice(2)), int(BigInt(KEEL_TEZOS_AUTOMATION_TIER)), int(mutez(input.maxAmount, "maxAmount")), { prim: input.enabled ? "True" : "False" });
  return { capabilityKey, ...governance(contract(input.controller, "controller"), "configure_policy", value) };
}

/**
 * The relayer's transaction, EVM executeAutomation. Any account may send it; it
 * attaches exactly the call's mutez. The signature is the key holder's, over
 * `keelTezosAutomationSigningPayload` for the controller's current nonce.
 */
export function buildKeelTezosAutomationExecution(input: {
  readonly controller: string; readonly signer: string; readonly call: KeelTezosManagedCall;
  readonly deadline: bigint | number; readonly signature: string;
}) {
  const signer = keelTezosAutomationSigner(input.signer);
  const action = call(input.call);
  if (typeof input.signature !== "string" || !/^(?:edsig|spsig1|p2sig|sig)[1-9A-HJ-NP-Za-km-z]+$/u.test(input.signature)) throw new TypeError("signature must be a Base58 Tezos signature.");
  const value = pair({ string: signer }, pair({ string: action.target }, bytes(action.payload), int(action.amount)), int(seconds(input.deadline, "deadline")), { string: input.signature });
  const operation: TezosTransactionOperation = { kind: "transaction", amount: action.amount.toString(), destination: contract(input.controller, "controller"),
    parameters: { entrypoint: "execute_automation", value } };
  return { operation, authorization: "any-relayer" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

/** Decode the controller's `automation_key_state` view into EVM automationKeyState's shape (expiry 0 when absent). */
export function decodeKeelTezosAutomationKeyState(value: TezosMichelineValue) {
  const node = value as { prim?: string; args?: readonly TezosMichelineValue[] };
  const [expiry, rest] = node.prim === "Pair" && node.args?.length === 2 ? node.args : [];
  const tail = rest as { prim?: string; args?: readonly { int?: string }[] } | undefined;
  const [nonce, generation] = tail?.prim === "Pair" && tail.args?.length === 2 ? tail.args : [];
  const option = expiry as { prim?: string; args?: readonly { int?: string; string?: string }[] } | undefined;
  if (typeof nonce?.int !== "string" || typeof generation?.int !== "string" || (option?.prim !== "None" && option?.prim !== "Some")) throw new TypeError("Expected Pair (option timestamp) (Pair nonce generation).");
  let validUntil = 0n;
  if (option.prim === "Some") {
    const inner = option.args?.[0];
    if (typeof inner?.int === "string") validUntil = BigInt(inner.int);
    else if (typeof inner?.string === "string" && Number.isFinite(Date.parse(inner.string))) validUntil = BigInt(Date.parse(inner.string) / 1000);
    else throw new TypeError("Expected a timestamp.");
  }
  return { validUntil, nonce: BigInt(nonce.int), generation: BigInt(generation.int) };
}
