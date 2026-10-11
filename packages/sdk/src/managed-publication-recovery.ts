/** Pure recovery policy. Adapters must authenticate these durable facts and
 * canonical reads; this function does not turn missing hashes into evidence. */
export interface KeelUnfundedPublicationRecoveryInput {
  readonly planDigest: string;
  readonly generation: string;
  readonly deadline: bigint;
  readonly canonicalBlock: { readonly number: bigint; readonly hash: string; readonly timestamp: bigint };
  readonly minimumRemainingLifetimeSeconds: bigint;
  readonly renewedLifetimeSeconds: bigint;
  readonly issuance:
    | { readonly status: "never-issued"; readonly boundary: "keel-persist-before-approval@1"; readonly planDigest: string; readonly generation: string }
    | { readonly status: "issued" | "pending" | "unknown" };
  readonly reconciliation:
    | { readonly status: "no-funded-job"; readonly planDigest: string; readonly blockNumber: bigint; readonly blockHash: string }
    | { readonly status: "funded" | "pending" | "unknown" };
  readonly activity: {
    readonly jobId?: string;
    readonly approvalTransactionHash?: string;
    readonly transactionCount: number;
    readonly completedChunks: number;
    readonly completedOperations: number;
    readonly paidFeeWei: bigint;
  };
}

export type KeelUnfundedPublicationRecoveryDecision =
  | { readonly status: "keep-saved-plan" }
  | { readonly status: "refresh-unfunded-review"; readonly deadline: bigint; readonly previousDeadline: bigint; readonly fullSimulationRequired: true; readonly approvalReady: false }
  | { readonly status: "preserve-funded-job" }
  | { readonly status: "reconcile-approval"; readonly reason: "recorded-activity" | "issuance-unknown" | "chain-reconciliation-incomplete" | "evidence-identity-mismatch" };

const digest = (value: string) => typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
const count = (value: number) => Number.isSafeInteger(value) && value >= 0;
const uint64 = (value: bigint) => typeof value === "bigint" && value > 0n && value < 1n << 64n;

/** Renew only a demonstrably unissued, unfunded review close to expiry. A
 * returned deadline is a proposal for a locked, archived CAS, never approval.
 * Existing funded jobs and every uncertain/issued attempt retain their identity. */
export function classifyKeelUnfundedPublicationRecovery(input: KeelUnfundedPublicationRecoveryInput): KeelUnfundedPublicationRecoveryDecision {
  if (!digest(input.planDigest) || typeof input.generation !== "string" || input.generation.length === 0
    || !uint64(input.deadline) || !digest(input.canonicalBlock.hash)
    || typeof input.canonicalBlock.number !== "bigint" || input.canonicalBlock.number < 0n
    || !uint64(input.canonicalBlock.timestamp)
    || typeof input.minimumRemainingLifetimeSeconds !== "bigint" || input.minimumRemainingLifetimeSeconds < 0n
    || !uint64(input.renewedLifetimeSeconds) || input.renewedLifetimeSeconds <= input.minimumRemainingLifetimeSeconds
    || !uint64(input.canonicalBlock.timestamp + input.renewedLifetimeSeconds)
    || !count(input.activity.transactionCount) || !count(input.activity.completedChunks) || !count(input.activity.completedOperations)
    || typeof input.activity.paidFeeWei !== "bigint" || input.activity.paidFeeWei < 0n) {
    throw new TypeError("Invalid unfunded publication recovery evidence.");
  }
  if (input.reconciliation.status === "funded" || input.activity.jobId !== undefined) return Object.freeze({ status: "preserve-funded-job" });
  if (input.activity.approvalTransactionHash !== undefined || input.activity.transactionCount !== 0
    || input.activity.completedChunks !== 0 || input.activity.completedOperations !== 0 || input.activity.paidFeeWei !== 0n) {
    return Object.freeze({ status: "reconcile-approval", reason: "recorded-activity" });
  }
  if (input.issuance.status !== "never-issued") return Object.freeze({ status: "reconcile-approval", reason: "issuance-unknown" });
  if (input.issuance.boundary !== "keel-persist-before-approval@1" || input.issuance.generation !== input.generation
    || input.issuance.planDigest.toLowerCase() !== input.planDigest.toLowerCase()) {
    return Object.freeze({ status: "reconcile-approval", reason: "evidence-identity-mismatch" });
  }
  if (input.reconciliation.status !== "no-funded-job") return Object.freeze({ status: "reconcile-approval", reason: "chain-reconciliation-incomplete" });
  if (input.reconciliation.planDigest.toLowerCase() !== input.planDigest.toLowerCase()
    || input.reconciliation.blockNumber !== input.canonicalBlock.number
    || input.reconciliation.blockHash.toLowerCase() !== input.canonicalBlock.hash.toLowerCase()) {
    return Object.freeze({ status: "reconcile-approval", reason: "evidence-identity-mismatch" });
  }
  if (input.deadline > input.canonicalBlock.timestamp + input.minimumRemainingLifetimeSeconds) return Object.freeze({ status: "keep-saved-plan" });
  return Object.freeze({ status: "refresh-unfunded-review", deadline: input.canonicalBlock.timestamp + input.renewedLifetimeSeconds,
    previousDeadline: input.deadline, fullSimulationRequired: true, approvalReady: false });
}
