import { encodeAbiParameters, encodeFunctionData, parseAbi, type Hex } from "viem";
/** Receipt evidence and recovery instructions, never an unsigned or signed wallet request. */
export interface KeelPublicationFailureDiagnostic {
  readonly schema: "keel-publication-failure@1";
  readonly releaseId: string;
  readonly operationId: string;
  readonly releaseRevision: number;
  readonly artifactId: string | null;
  readonly chainId: number;
  readonly walletBatchId: string | null;
  readonly transactionHashes: readonly string[];
  readonly identity: "confirmed" | "unverified";
  readonly status: "failed" | "pending" | "unknown" | "partial-success" | "succeeded";
  readonly atomicity: "atomic-rollback" | "atomic-success" | "unknown";
  readonly receipts: readonly {
    readonly transactionHash: string; readonly blockNumber: string; readonly blockHash: string;
    readonly status: "success" | "reverted"; readonly canonical: boolean;
    readonly gasUsed: string; readonly effectiveGasPrice: string | null;
  }[];
  readonly calls: readonly {
    readonly index: number; readonly kind: string; readonly to: string; readonly value: string;
    readonly selector: string | null; readonly calldataDigest: string;
    readonly outcome: "rolled-back" | "failed" | "not-executed" | "succeeded" | "unknown";
    readonly certainty: "confirmed" | "unknown";
    readonly cause: {
      readonly kind: "out-of-gas" | "revert" | "unknown";
      readonly source: "callTracer" | "none";
      readonly errorSelector: string | null; readonly revertReason: string | null; readonly panicCode: string | null;
    };
    readonly gas: { readonly provided: string | null; readonly used: string | null; readonly source: "callTracer" | "none"; readonly stateGas: "not-established" };
  }[];
  readonly trace: { readonly status: "available" | "not-requested" | "unsupported" | "throttled" | "unavailable" | "invalid" };
  readonly paidStorage: { readonly objectIds: readonly string[]; readonly reuseRequired: true; readonly uploadedBytes: 0 };
  readonly recovery: {
    readonly status: "blocked" | "reconcile-failed-operation" | "review-new-attempt" | "complete";
    readonly canPrepareNewAttempt: boolean; readonly sameArtifact: true; readonly mustReusePaidObjects: true;
    readonly newStoragePaymentRequired: false; readonly missingCallIndexes: readonly number[];
    readonly nextActions: readonly string[];
  };
}

export interface KeelStudioPublicationReconcileInput {
  readonly expectedRevision: number;
  readonly operationId: string;
  readonly walletBatchId?: string;
  readonly txHashes: readonly string[];
  readonly includeTrace?: boolean;
}

export interface KeelStudioPublicationReconcileResult {
  readonly schema: "keel-publication-reconcile@1";
  readonly releaseId: string; readonly revision: number; readonly operationId: string;
  readonly status: "failed-recoverable" | "pending" | "unknown" | "partial-success" | "complete";
  readonly publicationFailure: KeelPublicationFailureDiagnostic;
  readonly changed: boolean;
  readonly signing: "not-performed"; readonly submission: "not-performed"; readonly uploadedBytes: 0;
}

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
const hex = (value: unknown, bytes: number): value is string => typeof value === "string" && new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "iu").test(value);
const natural = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value) && value.length <= 78;
const bounded = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

export function validateKeelPublicationReconcileInput(value: unknown): KeelStudioPublicationReconcileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Use the saved operation, revision, batch and transaction hashes.");
  const input = value as KeelStudioPublicationReconcileInput;
  if (Object.keys(input).some(key => !["expectedRevision", "operationId", "walletBatchId", "txHashes", "includeTrace"].includes(key))
    || !uuid(input.operationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
    || (input.walletBatchId !== undefined && (!bounded(input.walletBatchId, 1024) || input.walletBatchId.length === 0))
    || (input.includeTrace !== undefined && typeof input.includeTrace !== "boolean")
    || !Array.isArray(input.txHashes) || input.txHashes.length > 8 || !input.txHashes.every(hash => hex(hash, 32))
    || new Set(input.txHashes.map(hash => hash.toLowerCase())).size !== input.txHashes.length) throw new TypeError("Use the exact saved operation and unique transaction hashes; wallet calls are never accepted here.");
  return { expectedRevision: input.expectedRevision, operationId: input.operationId, txHashes: [...input.txHashes],
    ...(input.walletBatchId === undefined ? {} : { walletBatchId: input.walletBatchId }), ...(input.includeTrace === undefined ? {} : { includeTrace: input.includeTrace }) };
}

export function validateKeelPublicationFailureDiagnostic(value: KeelPublicationFailureDiagnostic): KeelPublicationFailureDiagnostic {
  if (!value || value.schema !== "keel-publication-failure@1" || !uuid(value.releaseId) || !uuid(value.operationId)
    || !Number.isSafeInteger(value.releaseRevision) || value.releaseRevision < 1 || !Number.isSafeInteger(value.chainId) || value.chainId < 1
    || !(value.artifactId === null || uuid(value.artifactId)) || !(value.walletBatchId === null || bounded(value.walletBatchId, 1024))
    || !["confirmed", "unverified"].includes(value.identity) || !["failed", "pending", "unknown", "partial-success", "succeeded"].includes(value.status)
    || !["atomic-rollback", "atomic-success", "unknown"].includes(value.atomicity)
    || !Array.isArray(value.transactionHashes) || value.transactionHashes.length > 8 || !value.transactionHashes.every(hash => hex(hash, 32))
    || !Array.isArray(value.receipts) || value.receipts.length > 8 || value.receipts.some(receipt => !receipt || !hex(receipt.transactionHash, 32)
      || !value.transactionHashes.some(hash => hash.toLowerCase() === receipt.transactionHash.toLowerCase()) || !natural(receipt.blockNumber)
      || !hex(receipt.blockHash, 32) || !["success", "reverted"].includes(receipt.status) || typeof receipt.canonical !== "boolean"
      || !natural(receipt.gasUsed) || !(receipt.effectiveGasPrice === null || natural(receipt.effectiveGasPrice)))
    || !Array.isArray(value.calls) || value.calls.length > 8 || value.calls.some((call, index) => !call || call.index !== index
      || !bounded(call.kind, 128) || !hex(call.to, 20) || !natural(call.value) || !(call.selector === null || hex(call.selector, 4)) || !hex(call.calldataDigest, 32)
      || !["rolled-back", "failed", "not-executed", "succeeded", "unknown"].includes(call.outcome) || !["confirmed", "unknown"].includes(call.certainty)
      || !call.cause || !["out-of-gas", "revert", "unknown"].includes(call.cause.kind) || !["callTracer", "none"].includes(call.cause.source)
      || !(call.cause.errorSelector === null || hex(call.cause.errorSelector, 4)) || !(call.cause.revertReason === null || bounded(call.cause.revertReason, 256))
      || !(call.cause.panicCode === null || natural(call.cause.panicCode)) || !call.gas || !["callTracer", "none"].includes(call.gas.source)
      || call.gas.stateGas !== "not-established" || !(call.gas.provided === null || natural(call.gas.provided)) || !(call.gas.used === null || natural(call.gas.used)))
    || !value.trace || !["available", "not-requested", "unsupported", "throttled", "unavailable", "invalid"].includes(value.trace.status)
    || !value.paidStorage || value.paidStorage.reuseRequired !== true || value.paidStorage.uploadedBytes !== 0
    || !Array.isArray(value.paidStorage.objectIds) || value.paidStorage.objectIds.length > 1024 || !value.paidStorage.objectIds.every(id => hex(id, 32))
    || !value.recovery || !["blocked", "reconcile-failed-operation", "review-new-attempt", "complete"].includes(value.recovery.status)
    || typeof value.recovery.canPrepareNewAttempt !== "boolean" || value.recovery.sameArtifact !== true || value.recovery.mustReusePaidObjects !== true || value.recovery.newStoragePaymentRequired !== false
    || !Array.isArray(value.recovery.missingCallIndexes) || value.recovery.missingCallIndexes.some(index => !Number.isSafeInteger(index) || index < 0 || index >= value.calls.length)
    || !Array.isArray(value.recovery.nextActions) || value.recovery.nextActions.length > 16 || !value.recovery.nextActions.every(action => bounded(action, 256))) throw new TypeError("Studio returned an invalid publication diagnosis.");
  if (value.calls.length === 0 && (value.status !== "unknown" || value.identity !== "unverified" || value.recovery.status !== "blocked" || value.recovery.canPrepareNewAttempt)) throw new TypeError("Missing saved calls must remain unknown and blocked.");
  if (value.recovery.canPrepareNewAttempt && (value.identity !== "confirmed" || value.status !== "failed" || value.atomicity !== "atomic-rollback"
    || value.receipts.length !== 1 || value.transactionHashes.length !== 1 || !value.receipts.every(receipt => receipt.canonical && receipt.status === "reverted")
    || value.recovery.status !== "review-new-attempt" || value.recovery.missingCallIndexes.length !== value.calls.length || value.calls.some((_, index) => !value.recovery.missingCallIndexes.includes(index)))) throw new TypeError("Unresolved receipts cannot authorize another publication attempt.");
  return value;
}

/** Exact server-reviewed self transaction. A review response never signs or submits it. */
export interface KeelStudioAtomicPublicationTransaction {
  readonly schema: "keel-release-atomic-transaction@1";
  readonly type: "eip1559"; readonly chainId: number; readonly from: string; readonly to: string;
  readonly data: string; readonly value: string; readonly nonce: string; readonly gas: string;
  readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string;
  readonly delegation: string; readonly delegationRuntimeHash: string;
  readonly blockNumber: string; readonly blockHash: string;
  readonly checkedAt: string; readonly expiresAt: string; readonly simulationFingerprint: string;
}
export function validateKeelAtomicPublicationTransaction(value: KeelStudioAtomicPublicationTransaction, input: {
  readonly chainId: number; readonly wallet: string;
  readonly calls: readonly { readonly to: string; readonly data: string; readonly value: string }[];
}): KeelStudioAtomicPublicationTransaction {
  if (!value || value.schema !== "keel-release-atomic-transaction@1" || value.type !== "eip1559" || value.chainId !== input.chainId
    || !hex(value.from, 20) || !hex(value.to, 20) || value.from.toLowerCase() !== input.wallet.toLowerCase() || value.to.toLowerCase() !== input.wallet.toLowerCase()
    || !natural(value.value) || BigInt(value.value) !== input.calls.reduce((sum, call) => sum + BigInt(call.value), 0n)
    || !natural(value.nonce) || BigInt(value.nonce) > BigInt(Number.MAX_SAFE_INTEGER) || !natural(value.gas) || BigInt(value.gas) <= 0n
    || !natural(value.maxFeePerGas) || BigInt(value.maxFeePerGas) <= 0n || !natural(value.maxPriorityFeePerGas) || BigInt(value.maxPriorityFeePerGas) > BigInt(value.maxFeePerGas)
    || !hex(value.delegation, 20) || !hex(value.delegationRuntimeHash, 32) || !natural(value.blockNumber) || !hex(value.blockHash, 32)
    || !Number.isFinite(Date.parse(value.checkedAt)) || !Number.isFinite(Date.parse(value.expiresAt))
    || Date.parse(value.expiresAt) <= Date.parse(value.checkedAt) || Date.parse(value.expiresAt) - Date.parse(value.checkedAt) > 120_000
    || !/^(?:0x|sha256:)[0-9a-f]{64}$/iu.test(value.simulationFingerprint)) throw new TypeError("Studio returned an invalid atomic publication transaction.");
  const execution = encodeAbiParameters([{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
    [input.calls.map(call => ({ target: call.to as Hex, value: BigInt(call.value), callData: call.data as Hex }))]);
  const data = encodeFunctionData({ abi: parseAbi(["function execute(bytes32 mode,bytes executionData) payable"]), functionName: "execute", args: [`0x01${"00".repeat(31)}`, execution] });
  if (typeof value.data !== "string" || value.data.toLowerCase() !== data.toLowerCase()) throw new TypeError("The atomic envelope does not exactly match the saved ordered calls.");
  return value;
}
