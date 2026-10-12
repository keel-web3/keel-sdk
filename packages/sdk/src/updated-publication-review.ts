import { decodeFunctionData, keccak256, parseAbi, stringToHex, type Address, type Hex } from "viem";
import { buildKeelPublicationJobManifest } from "./managed-publication.js";

/** JSON-safe identities. Adapters authenticate database rows and chain evidence;
 * these pure functions perform no RPC, persistence, signing or submission. */
export interface KeelUpdatedReviewBlock {
  readonly number: string;
  readonly hash: Hex;
  readonly timestamp: string;
}
export interface KeelUpdatedReviewHistory {
  readonly journalDigest: Hex;
  readonly planDigest: Hex;
  readonly deadline: string;
  /** Historical issuance is retained, never upgraded by expiry or user choice. */
  readonly issuance: "unknown" | "never-issued" | "issued";
  /** Hash of the exact original funding request, authenticated by the adapter. */
  readonly fundingCallDigest?: Hex;
  /** Read from this journal, never inferred from the active replacement plan. */
  readonly fundingIdentity?: {
    readonly chainId: number;
    readonly owner: Address;
    readonly executor: Address;
    readonly publicationJob: Address;
    readonly runtimeCodeHash?: Hex;
  };
  readonly knownJobId?: string;
  /** Every original row/path remains bound, even when archive copies differ. */
  readonly occurrences: readonly { readonly planId: string; readonly path: string }[];
}
export interface KeelUpdatedPublicationReviewInput {
  readonly id: string;
  readonly artifact: { readonly id: string; readonly revision: number; readonly manifestDigest: Hex };
  readonly release: { readonly id: string; readonly revision: number };
  readonly snapshotDigest: Hex;
  readonly owner: Address;
  readonly executor: Address;
  readonly chainId: number;
  readonly publicationJob: Address;
  /** Missing runtime identity permits a diagnostic candidate, never promotion. */
  readonly publicationJobRuntimeCodeHash?: Hex;
  readonly storeAddress: Address;
  readonly canonicalBlock: KeelUpdatedReviewBlock;
  readonly originalPlanDigest: Hex;
  readonly originalDeadline: string;
  readonly deadline: string;
  readonly carrierBatches: readonly (readonly Hex[])[];
  readonly operations: readonly { readonly target: Address; readonly value: string; readonly data: Hex }[];
  readonly publicationsDigest: Hex;
  readonly expectedTokenURIHash: Hex;
  readonly history: readonly KeelUpdatedReviewHistory[];
}
export interface KeelUpdatedPublicationReviewCandidate extends KeelUpdatedPublicationReviewInput {
  readonly schema: "keel-updated-publication-review@1";
  readonly reason: "expired-existing-review";
  readonly historyDigest: Hex;
  readonly planDigest: Hex;
  readonly candidateDigest: Hex;
  readonly walletApprovalRequired: false;
  readonly approvalReady: false;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

export interface KeelUpdatedReviewSimulation {
  readonly status: "verified";
  readonly candidateDigest: Hex;
  readonly planDigest: Hex;
  readonly programDigest: Hex;
  readonly block: KeelUpdatedReviewBlock;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly fullProgram: true;
  readonly allCallsSucceeded: true;
  readonly completeMetadata: true;
  readonly expectedTokenURIHash: Hex;
  readonly returnedTokenURIHash: Hex;
  readonly fundingValueWei: string;
  readonly fundingTransactionGasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
}
export interface KeelUpdatedReviewFees {
  readonly candidateDigest: Hex;
  readonly programDigest: Hex;
  readonly block: KeelUpdatedReviewBlock;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly fundingValueWei: string;
  readonly fundingTransactionGasLimit: string;
  readonly maxFeePerGas: string;
  readonly maxPriorityFeePerGas: string;
}
export interface KeelUpdatedReviewExpiredFundingEvidence {
  readonly journalDigest: Hex;
  readonly planDigest: Hex;
  readonly deadline: string;
  readonly fundingCallDigest: Hex;
  readonly fundingCall: KeelUpdatedPublicationFundingCall;
  readonly publicationJob: Address;
  readonly runtimeCodeHash: Hex;
  readonly immutableRuntime: true;
  readonly deadlineRule: "openJob-deadline-lte-timestamp@1";
  /** Neither matching hashes nor this digest alone establish canonicality. */
  readonly runtimeEvidenceDigest: Hex;
}
export interface KeelUpdatedPublicationFundingCall {
  readonly chainId: number;
  readonly from: Address;
  readonly to: Address;
  readonly value: string;
  readonly data: Hex;
}
export type KeelUpdatedReviewReconciliation =
  | { readonly status: "funded"; readonly jobId: string }
  | { readonly status: "pending" | "unknown" }
  | {
    readonly status: "complete-no-funded-history";
    readonly candidateDigest: Hex;
    readonly historyDigest: Hex;
    readonly block: KeelUpdatedReviewBlock;
    readonly deploymentBlock: string;
    readonly deploymentVerified: true;
    readonly coverage: "deployment-through-canonical-pin";
    readonly canonicalReceiptsVerified: true;
    readonly pendingTransactions: "none-known-after-reconciliation";
    /** Binds complete paginated opening/completion/cancellation event results.
     * A missing getter, absent hash or nonce comparison is not this evidence. */
    readonly historyEvidenceDigest: Hex;
    readonly journals: readonly KeelUpdatedReviewExpiredFundingEvidence[];
  };
export interface KeelUpdatedReviewChoice {
  readonly candidateDigest: Hex;
  readonly reviewDigest: Hex;
  readonly owner: Address;
  readonly chosenAt: string;
  readonly action: "use-this-updated-review";
}
export interface KeelUpdatedReviewPromotionInput {
  readonly candidate: KeelUpdatedPublicationReviewCandidate;
  readonly currentSnapshotDigest: Hex;
  readonly lifecycle: "prepared" | "selected" | "approval-issued" | "cancelled" | "superseded";
  readonly canonicalBlock: KeelUpdatedReviewBlock;
  readonly now: string;
  /** Fresh readback of the candidate's original pin, separate from latest pin. */
  readonly candidateCanonicalBlock: KeelUpdatedReviewBlock;
  readonly simulation?: KeelUpdatedReviewSimulation;
  readonly fees?: KeelUpdatedReviewFees;
  readonly reconciliation: KeelUpdatedReviewReconciliation;
  readonly choice?: KeelUpdatedReviewChoice;
}
export type KeelUpdatedReviewPromotionDecision =
  | { readonly status: "preserve-funded-job"; readonly jobId: string; readonly walletApprovalRequired: false }
  | { readonly status: "reconcile-existing-approval"; readonly walletApprovalRequired: false }
  | { readonly status: "blocked"; readonly reason: string; readonly walletApprovalRequired: false }
  | {
    readonly status: "ready-for-normal-approval-boundary";
    readonly candidateDigest: Hex;
    readonly reviewDigest: Hex;
    /** Readiness never dispatches or returns a wallet request. The adapter must
     * recheck its locked CAS and persist issuance at the normal boundary. */
    readonly walletApprovalRequired: false;
    readonly approvalReady: false;
  };

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
const hash = (value: unknown): Hex => keccak256(stringToHex(canonical(value)));
const bytes32 = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]{64}$/iu.test(value);
const address = (value: unknown): value is Address => typeof value === "string" && /^0x[0-9a-f]{40}$/iu.test(value) && !/^0x0{40}$/u.test(value);
const decimal = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value);
const positive = (value: unknown): value is string => decimal(value) && BigInt(value) > 0n;
const uint64 = (value: unknown): value is string => positive(value) && BigInt(value) < 1n << 64n;
const name = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 512;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const sameHash = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
function blockValid(value: KeelUpdatedReviewBlock): boolean {
  return Boolean(value && decimal(value.number) && bytes32(value.hash) && uint64(value.timestamp));
}
function sameBlock(a: KeelUpdatedReviewBlock, b: KeelUpdatedReviewBlock): boolean {
  return blockValid(a) && blockValid(b) && a.number === b.number && sameHash(a.hash, b.hash) && a.timestamp === b.timestamp;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
const openJobAbi = parseAbi(["function openJob(bytes32 planDigest,address executor,uint64 deadline,bytes32[] chunkDigests,bytes32[] operationDigests,address[] allowedTargets) payable returns (uint256 jobId)"]);
export function keelUpdatedPublicationFundingCallDigest(value: KeelUpdatedPublicationFundingCall): Hex {
  if (!count(value?.chainId) || !address(value.from) || !address(value.to) || !decimal(value.value)
    || typeof value.data !== "string" || !/^0x(?:[0-9a-f]{2})+$/iu.test(value.data)) throw new TypeError("Invalid historical funding call envelope.");
  return hash({ schema: "keel-updated-review-funding-call@1", chainId: value.chainId, from: value.from.toLowerCase(), to: value.to.toLowerCase(), value: value.value, data: value.data.toLowerCase() });
}
function exactExpiredFundingCall(candidate: KeelUpdatedPublicationReviewCandidate, history: KeelUpdatedReviewHistory, proof: KeelUpdatedReviewExpiredFundingEvidence): boolean {
  try {
    const call = proof.fundingCall, identity = history.fundingIdentity;
    // This policy accepts one completely reconciled contract/chain. A legacy
    // journal on another contract needs separate coverage, not an inferred scan.
    if (!identity || identity.chainId !== candidate.chainId || !sameHash(identity.publicationJob, candidate.publicationJob)
      || !identity.runtimeCodeHash || !sameHash(identity.runtimeCodeHash, proof.runtimeCodeHash)) return false;
    if (!sameHash(keelUpdatedPublicationFundingCallDigest(call), history.fundingCallDigest)
      || !sameHash(proof.fundingCallDigest, history.fundingCallDigest) || call.chainId !== identity.chainId
      || !sameHash(call.from, identity.owner) || !sameHash(call.to, identity.publicationJob)) return false;
    const decoded = decodeFunctionData({ abi: openJobAbi, data: call.data });
    return decoded.functionName === "openJob" && sameHash(decoded.args[0], history.planDigest)
      && sameHash(decoded.args[1], identity.executor) && decoded.args[2].toString() === history.deadline;
  } catch { return false; }
}

/** Constructs a separate deadline-only proposal. No original row is rewritten,
 * and unknown historical issuance does not prevent read-only preparation. */
export function createKeelUpdatedPublicationReviewCandidate(input: KeelUpdatedPublicationReviewInput): KeelUpdatedPublicationReviewCandidate {
  if (!name(input.id) || !name(input.artifact?.id) || !count(input.artifact?.revision) || !bytes32(input.artifact?.manifestDigest)
    || !name(input.release?.id) || !count(input.release?.revision) || !bytes32(input.snapshotDigest)
    || !address(input.owner) || !address(input.executor) || !address(input.publicationJob) || !address(input.storeAddress) || !count(input.chainId)
    || (input.publicationJobRuntimeCodeHash !== undefined && !bytes32(input.publicationJobRuntimeCodeHash))
    || !blockValid(input.canonicalBlock) || !bytes32(input.originalPlanDigest) || !uint64(input.originalDeadline) || !uint64(input.deadline)
    || BigInt(input.originalDeadline) > BigInt(input.canonicalBlock.timestamp) || BigInt(input.deadline) <= BigInt(input.canonicalBlock.timestamp) + 300n
    || BigInt(input.deadline) > BigInt(input.canonicalBlock.timestamp) + 86400n
    || !bytes32(input.publicationsDigest) || !bytes32(input.expectedTokenURIHash)
    || !Array.isArray(input.history) || input.history.length === 0 || input.history.length > 256
    || !Array.isArray(input.carrierBatches) || !Array.isArray(input.operations)) throw new TypeError("Invalid updated publication review input.");
  const history: KeelUpdatedReviewHistory[] = input.history.map((item: KeelUpdatedReviewHistory) => {
    if (!bytes32(item.journalDigest) || !bytes32(item.planDigest) || !uint64(item.deadline)
      || !["unknown", "never-issued", "issued"].includes(item.issuance)
      || (item.fundingCallDigest !== undefined && !bytes32(item.fundingCallDigest))
      || (item.fundingIdentity !== undefined && (!count(item.fundingIdentity.chainId) || !address(item.fundingIdentity.owner)
        || !address(item.fundingIdentity.executor) || !address(item.fundingIdentity.publicationJob)
        || (item.fundingIdentity.runtimeCodeHash !== undefined && !bytes32(item.fundingIdentity.runtimeCodeHash))))
      || (item.knownJobId !== undefined && !decimal(item.knownJobId))
      || !Array.isArray(item.occurrences) || item.occurrences.length === 0 || item.occurrences.length > 512
      || item.occurrences.some((value: { planId: string; path: string }) => !name(value.planId) || !name(value.path))) throw new TypeError("Invalid historical publication identity.");
    return { journalDigest: item.journalDigest, planDigest: item.planDigest, deadline: item.deadline, issuance: item.issuance,
      ...(item.fundingCallDigest === undefined ? {} : { fundingCallDigest: item.fundingCallDigest }),
      ...(item.fundingIdentity === undefined ? {} : { fundingIdentity: {
        chainId: item.fundingIdentity.chainId, owner: item.fundingIdentity.owner, executor: item.fundingIdentity.executor,
        publicationJob: item.fundingIdentity.publicationJob,
        ...(item.fundingIdentity.runtimeCodeHash === undefined ? {} : { runtimeCodeHash: item.fundingIdentity.runtimeCodeHash }),
      } }),
      ...(item.knownJobId === undefined ? {} : { knownJobId: item.knownJobId }),
      occurrences: item.occurrences.map((value: { planId: string; path: string }) => ({ planId: value.planId, path: value.path })) };
  });
  if (new Set(history.map(item => item.journalDigest.toLowerCase())).size !== history.length
    || new Set(history.flatMap(item => item.occurrences.map(value => `${value.planId}\0${value.path}`))).size !== history.reduce((total, item) => total + item.occurrences.length, 0)
    || !history.some(item => sameHash(item.planDigest, input.originalPlanDigest) && item.deadline === input.originalDeadline)) throw new TypeError("Incomplete or duplicate historical publication identities.");
  const carrierBatches = input.carrierBatches.map((batch: readonly Hex[]) => {
    if (!Array.isArray(batch) || batch.some(value => typeof value !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value))) throw new TypeError("Invalid original carrier bytes.");
    return [...batch];
  });
  const operations = input.operations.map((value: KeelUpdatedPublicationReviewInput["operations"][number]) => {
    if (!address(value.target) || !decimal(value.value) || typeof value.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(value.data)) throw new TypeError("Invalid original operation.");
    return { target: value.target, value: value.value, data: value.data };
  });
  const manifestInput = { owner: input.owner, executor: input.executor, carrierBatches,
    operations: operations.map(value => ({ ...value, value: BigInt(value.value) })) };
  const original = buildKeelPublicationJobManifest({ ...manifestInput, deadline: BigInt(input.originalDeadline) });
  if (!sameHash(original.planDigest, input.originalPlanDigest)) throw new TypeError("Original publication bytes do not match their saved plan digest.");
  const planDigest = buildKeelPublicationJobManifest({ ...manifestInput, deadline: BigInt(input.deadline) }).planDigest;
  const body = {
    schema: "keel-updated-publication-review@1" as const, reason: "expired-existing-review" as const, id: input.id,
    artifact: { id: input.artifact.id, revision: input.artifact.revision, manifestDigest: input.artifact.manifestDigest },
    release: { id: input.release.id, revision: input.release.revision }, snapshotDigest: input.snapshotDigest,
    owner: input.owner, executor: input.executor, chainId: input.chainId, publicationJob: input.publicationJob, storeAddress: input.storeAddress,
    ...(input.publicationJobRuntimeCodeHash === undefined ? {} : { publicationJobRuntimeCodeHash: input.publicationJobRuntimeCodeHash }),
    canonicalBlock: { ...input.canonicalBlock }, originalPlanDigest: input.originalPlanDigest, originalDeadline: input.originalDeadline,
    deadline: input.deadline, carrierBatches, operations, publicationsDigest: input.publicationsDigest, expectedTokenURIHash: input.expectedTokenURIHash,
    history, historyDigest: hash(history), planDigest,
    walletApprovalRequired: false as const, approvalReady: false as const, signing: "not-performed" as const, submission: "not-performed" as const,
  };
  return freeze({ ...body, candidateDigest: hash(body) });
}

/** Restores and verifies persisted JSON; extra request/approval fields, changed
 * arrays or a changed history occurrence cannot retain the original identity. */
export function assertKeelUpdatedPublicationReviewCandidate(value: KeelUpdatedPublicationReviewCandidate): void {
  const rebuilt = createKeelUpdatedPublicationReviewCandidate(value);
  if (canonical(rebuilt) !== canonical(value)) throw new TypeError("The updated publication review candidate changed.");
}

/** Exact review consent binds the complete program, amount, fees, canonical pin
 * and reconciliation evidence, not merely the candidate's stable storage plan. */
export function keelUpdatedPublicationReviewDigest(input: {
  readonly candidateDigest: Hex;
  readonly simulation: KeelUpdatedReviewSimulation;
  readonly fees: KeelUpdatedReviewFees;
  readonly reconciliation: KeelUpdatedReviewReconciliation;
}): Hex { return hash(input); }

/** Does not authorize a transaction. A ready result permits only the existing
 * locked, durable-before-wallet approval boundary to consider this review. */
export function classifyKeelUpdatedPublicationReviewPromotion(input: KeelUpdatedReviewPromotionInput): KeelUpdatedReviewPromotionDecision {
  const blocked = (reason: string): KeelUpdatedReviewPromotionDecision => Object.freeze({ status: "blocked", reason, walletApprovalRequired: false });
  try { assertKeelUpdatedPublicationReviewCandidate(input.candidate); } catch { return blocked("candidate-invalid"); }
  const candidate = input.candidate;
  if (!input.reconciliation || typeof input.reconciliation !== "object") return blocked("historical-funding-unknown");
  const knownJob = candidate.history.find(value => value.knownJobId !== undefined)?.knownJobId;
  if (input.reconciliation.status === "funded" || knownJob !== undefined) {
    const jobId = knownJob ?? (input.reconciliation as { jobId: string }).jobId;
    return decimal(jobId) ? Object.freeze({ status: "preserve-funded-job", jobId, walletApprovalRequired: false }) : blocked("historical-funding-unknown");
  }
  if (input.lifecycle === "approval-issued") return Object.freeze({ status: "reconcile-existing-approval", walletApprovalRequired: false });
  if (input.lifecycle === "cancelled" || input.lifecycle === "superseded") return blocked(`candidate-${input.lifecycle}`);
  if (input.lifecycle !== "prepared" && input.lifecycle !== "selected") return blocked("candidate-lifecycle-unknown");
  if (!bytes32(input.currentSnapshotDigest) || !sameHash(input.currentSnapshotDigest, candidate.snapshotDigest)) return blocked("saved-snapshot-changed");
  if (!sameBlock(input.candidateCanonicalBlock, candidate.canonicalBlock)) return blocked("candidate-pin-reorganized");
  if (!positive(input.now) || !blockValid(input.canonicalBlock)) return blocked("canonical-pin-invalid");
  const now = BigInt(input.now), timestamp = BigInt(input.canonicalBlock.timestamp);
  if (timestamp < now - 180n || timestamp > now + 30n || BigInt(input.canonicalBlock.number) < BigInt(candidate.canonicalBlock.number)
    || (input.canonicalBlock.number === candidate.canonicalBlock.number && !sameBlock(input.canonicalBlock, candidate.canonicalBlock))
    || timestamp < BigInt(candidate.canonicalBlock.timestamp) || BigInt(candidate.deadline) <= timestamp + 300n) return blocked("canonical-pin-or-candidate-expired");
  const reconciliation = input.reconciliation;
  if (reconciliation.status !== "complete-no-funded-history") return blocked(`historical-funding-${reconciliation.status}`);
  if (!sameHash(reconciliation.candidateDigest, candidate.candidateDigest) || !sameHash(reconciliation.historyDigest, candidate.historyDigest)
    || !sameBlock(reconciliation.block, input.canonicalBlock) || !decimal(reconciliation.deploymentBlock)
    || BigInt(reconciliation.deploymentBlock) > BigInt(input.canonicalBlock.number) || reconciliation.deploymentVerified !== true
    || reconciliation.coverage !== "deployment-through-canonical-pin" || reconciliation.canonicalReceiptsVerified !== true
    || reconciliation.pendingTransactions !== "none-known-after-reconciliation" || !bytes32(reconciliation.historyEvidenceDigest)
    || !Array.isArray(reconciliation.journals) || reconciliation.journals.length !== candidate.history.length) return blocked("historical-funding-coverage-incomplete");
  for (const [index, history] of candidate.history.entries()) {
    const proof = reconciliation.journals[index];
    if (!proof || !sameHash(proof.journalDigest, history.journalDigest) || !sameHash(proof.planDigest, history.planDigest)
      || proof.deadline !== history.deadline || BigInt(history.deadline) > timestamp || !history.fundingCallDigest
      || !sameHash(proof.fundingCallDigest, history.fundingCallDigest) || !sameHash(proof.publicationJob, candidate.publicationJob)
      || !exactExpiredFundingCall(candidate, history, proof)
      || !candidate.publicationJobRuntimeCodeHash || !sameHash(proof.runtimeCodeHash, candidate.publicationJobRuntimeCodeHash)
      || !bytes32(proof.runtimeEvidenceDigest) || proof.immutableRuntime !== true
      || proof.deadlineRule !== "openJob-deadline-lte-timestamp@1") return blocked("prior-funding-call-not-proven-expired");
  }
  const simulation = input.simulation, fees = input.fees;
  if (!simulation || !fees) return blocked("complete-simulation-and-fees-required");
  const fresh = (value: { verifiedAt: string; expiresAt: string }) => positive(value.verifiedAt) && positive(value.expiresAt)
    && BigInt(value.verifiedAt) <= now + 30n && BigInt(value.verifiedAt) >= now - 180n
    && BigInt(value.expiresAt) > now && BigInt(value.expiresAt) > BigInt(value.verifiedAt) && BigInt(value.expiresAt) <= BigInt(value.verifiedAt) + 300n;
  if (simulation.status !== "verified" || !sameHash(simulation.candidateDigest, candidate.candidateDigest)
    || !sameHash(simulation.planDigest, candidate.planDigest) || !sameBlock(simulation.block, input.canonicalBlock)
    || !bytes32(simulation.programDigest) || simulation.fullProgram !== true || simulation.allCallsSucceeded !== true || simulation.completeMetadata !== true
    || !sameHash(simulation.expectedTokenURIHash, candidate.expectedTokenURIHash) || !sameHash(simulation.returnedTokenURIHash, candidate.expectedTokenURIHash)
    || !fresh(simulation)) return blocked("complete-simulation-stale-or-mismatched");
  if (!sameHash(fees.candidateDigest, candidate.candidateDigest) || !sameHash(fees.programDigest, simulation.programDigest)
    || !sameBlock(fees.block, input.canonicalBlock) || !fresh(fees)
    || !decimal(fees.fundingValueWei) || !positive(fees.fundingTransactionGasLimit) || !positive(fees.maxFeePerGas) || !decimal(fees.maxPriorityFeePerGas)
    || BigInt(fees.maxPriorityFeePerGas) > BigInt(fees.maxFeePerGas)
    || fees.fundingValueWei !== simulation.fundingValueWei || fees.fundingTransactionGasLimit !== simulation.fundingTransactionGasLimit
    || fees.maxFeePerGas !== simulation.maxFeePerGas || fees.maxPriorityFeePerGas !== simulation.maxPriorityFeePerGas) return blocked("fee-review-stale-or-mismatched");
  const reviewDigest = keelUpdatedPublicationReviewDigest({ candidateDigest: candidate.candidateDigest, simulation, fees, reconciliation });
  const choice = input.choice;
  if (!choice || choice.action !== "use-this-updated-review" || !sameHash(choice.candidateDigest, candidate.candidateDigest)
    || !sameHash(choice.reviewDigest, reviewDigest) || !sameHash(choice.owner, candidate.owner) || !positive(choice.chosenAt)
    || BigInt(choice.chosenAt) > now + 30n || BigInt(choice.chosenAt) < BigInt(simulation.verifiedAt)
    || BigInt(choice.chosenAt) < BigInt(fees.verifiedAt)) return blocked("exact-owner-review-required");
  return Object.freeze({ status: "ready-for-normal-approval-boundary", candidateDigest: candidate.candidateDigest, reviewDigest, walletApprovalRequired: false, approvalReady: false });
}
