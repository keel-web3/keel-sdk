/**
 * Native token-bound accounts on Tezos, the side of ERC-6551 that EVM KEEL reaches
 * through a configured registry (IKeelTokenBoundAccountRegistry).
 *
 * KeelTokenBoundAccountRegistry originates one KeelTokenBoundAccount per
 * (host FA2, token, salt), as an ERC-6551 registry deploys one account per
 * (implementation, salt, chain, token contract, token). The account holds tez and
 * any FA2 token and runs a lambda's operations only for the host token's current
 * owner. Two differences are the chain's, and these helpers hide them:
 *
 * - No counterfactual address. Tezos origination addresses come from the
 *   operation, so the registry's `account` view is `None` until the account
 *   exists. `prepareKeelTezosTokenBoundAccount` returns "create, then read back",
 *   which is what EVM callers do when nothing is deployed yet.
 * - Calls are lambdas. ERC-6551 `execute(to, value, data, 0)` becomes a lambda
 *   that emits the transfers; `buildKeelTezosAccountExecute` writes it.
 *
 * The registry's fixed account code is its implementation, so `implementation`
 * is the registry address on Tezos. Nothing here signs, submits or reads a chain.
 */

import { KeelChainCapabilityError, resolveKeelChainCapability } from "./chain-capability-map.js";
import { keelTezosAddressBytes } from "./tezos-collection.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

const MUTEZ_MAX = (1n << 63n) - 1n;

/** The capability row for ERC-6551 operations other than CALL. */
export const KEEL_TEZOS_ACCOUNT_DELEGATE_CAPABILITY = "stake.token-bound-account.delegate-call" as const;

/**
 * ERC-6551 operations other than CALL (0): DELEGATECALL (1), CREATE (2) and
 * CREATE2 (3). Tezos has no delegate call, and a lambda cannot originate code
 * that runs as the account, so these are refused with the capability map's
 * typed error and closest behaviour instead of being approximated.
 */
export class KeelTezosAccountOperationError extends KeelChainCapabilityError {
  readonly operation: number;
  constructor(operation: number) {
    const resolution = resolveKeelChainCapability(KEEL_TEZOS_ACCOUNT_DELEGATE_CAPABILITY, "tezos");
    if (resolution.supported) throw new Error(`${KEEL_TEZOS_ACCOUNT_DELEGATE_CAPABILITY} must be EVM-only in the capability map.`);
    super(KEEL_TEZOS_ACCOUNT_DELEGATE_CAPABILITY, "tezos", resolution.closest);
    this.name = "KeelTezosAccountOperationError";
    this.operation = operation;
  }
}

function contract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  keelTezosAddressBytes(value, label);
  return value;
}

function address(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a Tezos address.`);
  keelTezosAddressBytes(value, label);
  return value;
}

function natural(value: unknown, label: string, max = (1n << 256n) - 1n): bigint {
  const number = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : -1n;
  if (number < 0n || number > max) throw new RangeError(`${label} must be a natural number.`);
  return number;
}

function salt(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new TypeError("salt must be 0x-prefixed even-length hex.");
  return value.slice(2).toLowerCase();
}

/** The registry key, `record(token_contract, token_id, salt)`, as `create_account` and `account` take it. */
export function keelTezosTokenBoundAccountKey(input: { readonly tokenContract: string; readonly tokenId: bigint | number | string; readonly salt: string }): TezosMichelineValue {
  return { prim: "Pair", args: [{ string: contract(input.tokenContract, "tokenContract") }, { prim: "Pair", args: [{ int: natural(input.tokenId, "tokenId").toString() }, { bytes: salt(input.salt) }] }] };
}

/**
 * Make sure a host token has its account: the `create_account` transaction (any
 * sender, no tez; a repeat is a no-op) and the `account` view to read the
 * address back, since Tezos cannot name it before it exists.
 */
export function prepareKeelTezosTokenBoundAccount(input: {
  readonly network: string; readonly registry: string; readonly tokenContract: string; readonly tokenId: bigint | number | string; readonly salt: string;
}) {
  if (typeof input.network !== "string" || !input.network.startsWith("Net")) throw new TypeError("network must be an exact Net... chain identity.");
  const registry = contract(input.registry, "registry");
  const key = keelTezosTokenBoundAccountKey(input);
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: registry, parameters: { entrypoint: "create_account", value: key } };
  return {
    schema: "keel.tezos-token-bound-account@1" as const, family: "tezos" as const, network: input.network,
    implementation: registry, operation, authorization: "any-sender" as const,
    readBack: { contract: registry, view: "account", input: key, returns: "option address" as const },
    signing: "not-performed" as const, submission: "not-performed" as const,
    note: "The registry's account view is None until this transaction is included; read the address back before using it.",
  };
}

/** One call the account makes: send tez to an address, or move an FA2 token it holds. */
export type KeelTezosAccountCall =
  | { readonly kind: "value"; readonly to: string; readonly amount: bigint | number | string }
  | { readonly kind: "fa2"; readonly fa2: string; readonly tokenId: bigint | number | string; readonly to: string; readonly amount?: bigint | number | string };

const FA2_TRANSFER_TYPE: TezosMichelineValue = { prim: "list", args: [{ prim: "pair", args: [{ prim: "address" }, { prim: "list", args: [{ prim: "pair", args: [{ prim: "address" }, { prim: "pair", args: [{ prim: "nat" }, { prim: "nat" }] }] }] }] }] };

function failNone(error: string): TezosMichelineValue[] {
  return [{ prim: "IF_NONE", args: [[{ prim: "PUSH", args: [{ prim: "string" }, { string: error }] }, { prim: "FAILWITH" }], []] }];
}

/** The instructions that push one call's operation, with the operation list beneath it, then CONS it on. */
function callCode(call: KeelTezosAccountCall, account: string, index: number): TezosMichelineValue[] {
  if (!call || typeof call !== "object") throw new TypeError(`calls[${index}] must be an object.`);
  if (call.kind === "value") {
    const to = address(call.to, `calls[${index}].to`);
    const amount = natural(call.amount, `calls[${index}].amount`, MUTEZ_MAX);
    return [
      { prim: "PUSH", args: [{ prim: "address" }, { string: to }] },
      { prim: "CONTRACT", args: [{ prim: "unit" }] },
      ...failNone("KEEL_ACCOUNT_TARGET"),
      { prim: "PUSH", args: [{ prim: "mutez" }, { int: amount.toString() }] },
      { prim: "UNIT" },
      { prim: "TRANSFER_TOKENS" },
      { prim: "CONS" },
    ];
  }
  if (call.kind === "fa2") {
    const fa2 = contract(call.fa2, `calls[${index}].fa2`);
    const to = address(call.to, `calls[${index}].to`);
    const tokenId = natural(call.tokenId, `calls[${index}].tokenId`);
    const amount = natural(call.amount ?? 1, `calls[${index}].amount`);
    const batch: TezosMichelineValue = [{ prim: "Pair", args: [{ string: account }, [{ prim: "Pair", args: [{ string: to }, { prim: "Pair", args: [{ int: tokenId.toString() }, { int: amount.toString() }] }] }]] }];
    return [
      { prim: "PUSH", args: [{ prim: "address" }, { string: fa2 }] },
      { prim: "CONTRACT", annots: ["%transfer"], args: [FA2_TRANSFER_TYPE] },
      ...failNone("KEEL_ACCOUNT_TARGET"),
      { prim: "PUSH", args: [{ prim: "mutez" }, { int: "0" }] },
      { prim: "PUSH", args: [FA2_TRANSFER_TYPE, batch] },
      { prim: "TRANSFER_TOKENS" },
      { prim: "CONS" },
    ] as TezosMichelineValue[];
  }
  throw new TypeError(`calls[${index}].kind must be "value" or "fa2".`);
}

/**
 * The host owner's `execute` transaction, ERC-6551 execute(to, value, data, 0)
 * for one or more calls. The lambda's operations run in the order given.
 * `attach` is tez the owner sends into the account with the call (default 0).
 */
export function buildKeelTezosAccountExecute(input: {
  readonly account: string; readonly calls: readonly KeelTezosAccountCall[]; readonly attach?: bigint | number | string;
  /** ERC-6551's operation byte; only 0 (CALL) exists on Tezos. */
  readonly operation?: number;
}) {
  if (input.operation !== undefined && input.operation !== 0) throw new KeelTezosAccountOperationError(input.operation);
  const account = contract(input.account, "account");
  if (!Array.isArray(input.calls) || input.calls.length === 0 || input.calls.length > 32) throw new RangeError("calls must list 1..32 calls.");
  // CONS prepends, so push the last call first to emit them in the order given.
  const code: TezosMichelineValue[] = [{ prim: "DROP" }, { prim: "NIL", args: [{ prim: "operation" }] }];
  for (let index = input.calls.length - 1; index >= 0; index -= 1) code.push(...callCode(input.calls[index] as KeelTezosAccountCall, account, index));
  const operation: TezosTransactionOperation = {
    kind: "transaction", amount: natural(input.attach ?? 0, "attach", MUTEZ_MAX).toString(), destination: account,
    parameters: { entrypoint: "execute", value: code as unknown as TezosMichelineValue },
  };
  return { operation, authorization: "host-owner" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}
