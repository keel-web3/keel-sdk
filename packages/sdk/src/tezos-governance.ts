/**
 * Governance actions on Tezos, the native side of EVM `KeelManager`'s
 * `executeGovernance(Call(target, value, data), deadline, signatures)`.
 *
 * A Tezos `KeelManager` executes a governance action when an approval reaches
 * two-thirds of the governors. The action is a Michelson lambda, so it can send
 * any typed call. `buildKeelTezosGovernanceProposal` takes the same shape as an
 * EVM call (a destination, the value and the call) and writes that lambda. See
 * docs/reviews/tezos-behavior-parity-20261015/GOVERNANCE_VALUE_AND_COUNTERS.md
 * in keel-contracts.
 *
 * What the chain changes, and these helpers hide:
 *
 * - EVM's relayer attaches `call.value`. On Tezos the approval that reaches the
 *   threshold attaches it, and every other approval attaches nothing;
 *   `buildKeelTezosGovernanceApprovals` returns them in order with the right
 *   amounts. A wrong amount fails with `KEEL_INCORRECT_VALUE`, EVM's
 *   `IncorrectValue`.
 * - The lambda forwards the value itself. This builder always forwards exactly
 *   the declared value, split across the calls as given.
 * - Counters EVM stores as `uint64` fail at `2^64 - 1` with
 *   `KEEL_COUNTER_OVERFLOW`, EVM's `Panic(0x11)`.
 * - Amounts are mutez, at most `2^63 - 1`.
 *
 * Nothing here signs, submits or reads a chain.
 */

import { keelTezosAddressBytes } from "./tezos-collection.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

/** The largest value EVM's `uint64` counters reach; Tezos refuses to pass it too. */
export const KEEL_TEZOS_UINT64_MAX = (1n << 64n) - 1n;

/** The largest Tezos amount, in mutez. */
export const KEEL_TEZOS_MUTEZ_MAX = (1n << 63n) - 1n;

/** Tezos governance and counter failures, by the EVM error each one stands for. */
export const KEEL_TEZOS_GOVERNANCE_ERRORS = Object.freeze({
  KEEL_INCORRECT_VALUE: "IncorrectValue",
  KEEL_COUNTER_OVERFLOW: "Panic(0x11)",
  KEEL_PAUSE_REVISION_OVERFLOW: "Panic(0x11)",
} as const);

/** One typed call a governance action makes, with the mutez it carries. */
export interface KeelTezosGovernanceCall {
  /** A KT1 contract or an implicit account. */
  readonly destination: string;
  /** The entrypoint; omitted or "default" sends to the default entrypoint. */
  readonly entrypoint?: string;
  /** The entrypoint's Michelson parameter type, as Micheline. */
  readonly parameterType: TezosMichelineValue;
  /** The parameter, as Micheline. */
  readonly value: TezosMichelineValue;
  /** Mutez sent with this call. */
  readonly amount?: bigint | number | string;
}

function natural(value: unknown, label: string, max: bigint): bigint {
  const number = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value)
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : -1n;
  if (number < 0n || number > max) throw new RangeError(`${label} must be a natural number no larger than ${max}.`);
  return number;
}

function manager(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError("manager must be an originated KT1 contract.");
  keelTezosAddressBytes(value, "manager");
  return value;
}

/** Approvals a proposal needs, the proposer's included: ceil(2N/3), as EVM's threshold. */
export function keelTezosGovernanceThreshold(governorCount: number | bigint): number {
  const count = natural(governorCount, "governorCount", 32n);
  if (count < 3n) throw new RangeError("A Tezos manager has 3 to 32 governors.");
  return Number((2n * count + 2n) / 3n);
}

/**
 * The governance lambda for these calls, in order. Its type is the manager's
 * `lambda (pair unit (list operation)) (pair unit (list operation))`. The
 * manager reverses its operation list once at the end, so calls are consed in
 * the order given.
 */
export function buildKeelTezosGovernanceLambda(calls: readonly KeelTezosGovernanceCall[]): { lambda: TezosMichelineValue; value: bigint } {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 32) throw new RangeError("calls must list 1..32 calls.");
  const code: TezosMichelineValue[] = [{ prim: "CDR" }];
  let value = 0n;
  calls.forEach((call, index) => {
    if (!call || typeof call !== "object") throw new TypeError(`calls[${index}] must be a call.`);
    keelTezosAddressBytes(call.destination, `calls[${index}].destination`);
    const entrypoint = call.entrypoint ?? "default";
    if (!/^[A-Za-z0-9_]{1,31}$/u.test(entrypoint)) throw new TypeError(`calls[${index}].entrypoint is not a Michelson entrypoint.`);
    if (call.parameterType === undefined || call.value === undefined) throw new TypeError(`calls[${index}] needs parameterType and value.`);
    const amount = natural(call.amount ?? 0, `calls[${index}].amount`, KEEL_TEZOS_MUTEZ_MAX);
    value += amount;
    code.push(
      { prim: "PUSH", args: [{ prim: "address" }, { string: call.destination }] },
      { prim: "CONTRACT", args: [call.parameterType], ...(entrypoint === "default" ? {} : { annots: [`%${entrypoint}`] }) },
      { prim: "IF_NONE", args: [[{ prim: "PUSH", args: [{ prim: "string" }, { string: "KEEL_TARGET" }] }, { prim: "FAILWITH" }], []] },
      { prim: "PUSH", args: [{ prim: "mutez" }, { int: amount.toString() }] },
      { prim: "PUSH", args: [call.parameterType, call.value] },
      { prim: "TRANSFER_TOKENS" },
      { prim: "CONS" },
    );
  });
  if (value > KEEL_TEZOS_MUTEZ_MAX) throw new RangeError("The calls together carry more than a Tezos amount can hold.");
  code.push({ prim: "UNIT" }, { prim: "PAIR" });
  return { lambda: code, value };
}

/**
 * EVM `executeGovernance` as a Tezos proposal. A zero-value action uses
 * `propose`; one that carries tez uses `propose_with_value`, and the approval
 * that executes it must attach exactly `value`.
 */
export function buildKeelTezosGovernanceProposal(input: {
  readonly manager: string; readonly calls: readonly KeelTezosGovernanceCall[]; readonly deadline: bigint | number | string;
}) {
  const target = manager(input.manager);
  const deadline = natural(input.deadline, "deadline", KEEL_TEZOS_UINT64_MAX);
  const { lambda, value } = buildKeelTezosGovernanceLambda(input.calls);
  const parameters = value === 0n
    ? { entrypoint: "propose", value: { prim: "Pair", args: [lambda, { int: deadline.toString() }] } }
    : { entrypoint: "propose_with_value", value: { prim: "Pair", args: [lambda, { prim: "Pair", args: [{ int: deadline.toString() }, { int: value.toString() }] }] } };
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: target, parameters: parameters as TezosTransactionOperation["parameters"] };
  return { lambda, value, operation, authorization: "governor" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

/**
 * The approvals after the proposer's, in order, for a manager with
 * `governorCount` governors. Only the last one executes the action and
 * attaches `value`.
 */
export function buildKeelTezosGovernanceApprovals(input: {
  readonly manager: string; readonly proposalId: bigint | number | string; readonly value?: bigint | number | string;
  readonly governorCount: number | bigint;
}) {
  const target = manager(input.manager);
  const proposalId = natural(input.proposalId, "proposalId", (1n << 256n) - 1n);
  const value = natural(input.value ?? 0, "value", KEEL_TEZOS_MUTEZ_MAX);
  const needed = keelTezosGovernanceThreshold(input.governorCount) - 1;
  return Array.from({ length: needed }, (_, index) => {
    const executes = index === needed - 1;
    const operation: TezosTransactionOperation = {
      kind: "transaction", amount: (executes ? value : 0n).toString(), destination: target,
      parameters: { entrypoint: "approve", value: { int: proposalId.toString() } },
    };
    return { operation, executes, authorization: "governor" as const, signing: "not-performed" as const, submission: "not-performed" as const };
  });
}
