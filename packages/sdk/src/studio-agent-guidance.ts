/** A saved-state binding is a concurrency guard, never signing authority. */
export interface KeelStudioAgentStateBinding {
  readonly ownerId: string;
  readonly projectId: string | null;
  readonly projectRevision: number | null;
  readonly projectManifestDigest: string | null;
  readonly releaseId: string | null;
  readonly releaseRevision: number | null;
  readonly operationId: string | null;
}

export interface KeelStudioAgentNextAction {
  readonly kind: "tool" | "owner";
  readonly operation: "read" | "plan" | "diagnose" | "continue-publication" | "prepare-review" | "read-review" | "storage-review" | "owner-review" | "owner-progress";
  readonly tool: string | null;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly binding: KeelStudioAgentStateBinding;
  readonly requiredScope: "drafts:read" | "drafts:write" | null;
  readonly allowed: boolean;
  readonly reason: string;
  readonly retryable: boolean;
  readonly ownerWalletRequired: boolean;
  readonly ownerPath?: string;
}

export interface KeelStudioAgentStorageProgress {
  readonly totalPlans: number;
  readonly completedPlans: number;
  readonly failedPlans: number;
  readonly recordedJobIds: readonly string[];
  readonly fundingReceiptRecorded: boolean;
  readonly completedChunks: number;
  readonly completedOperations: number;
  readonly evidence: "saved-state-only";
}

export interface KeelStudioAgentProgress {
  readonly schema: "keel-agent-progress@1";
  readonly binding: KeelStudioAgentStateBinding;
  readonly observedAt: string;
  readonly lifecycle: string;
  readonly storage: KeelStudioAgentStorageProgress;
  readonly operation: null | {
    readonly id: string; readonly revision: number; readonly status: string;
    readonly transactionHash: string | null; readonly receiptStatus: string | null;
    readonly walletResponseRecorded: boolean; readonly ownerRejectionRecorded: boolean;
    readonly recoveryRecorded: boolean;
  };
  readonly publication: "not-established" | "recorded-confirmed";
  readonly completedWork: readonly string[];
  readonly blockers: readonly { readonly code: string; readonly message: string; readonly retryable: boolean }[];
  readonly nextActions: readonly KeelStudioAgentNextAction[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

export interface KeelStudioAgentWorkspaceQuery {
  readonly limit?: number;
  readonly cursor?: string;
  readonly projectId?: string;
}

export interface KeelStudioAgentWorkspacePage {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly order: "created-desc-id-desc";
  readonly snapshotAt: string;
}

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const digest = /^0x[0-9a-f]{64}$/iu;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseKeelStudioAgentStateBinding(value: unknown): KeelStudioAgentStateBinding {
  const keys = ["ownerId", "projectId", "projectRevision", "projectManifestDigest", "releaseId", "releaseRevision", "operationId"];
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || typeof value.ownerId !== "string" || !uuid.test(value.ownerId)
    || !(value.projectId === null || typeof value.projectId === "string" && uuid.test(value.projectId))
    || !(value.projectRevision === null || positive(value.projectRevision))
    || !(value.projectManifestDigest === null || typeof value.projectManifestDigest === "string" && digest.test(value.projectManifestDigest))
    || (value.projectId === null) !== (value.projectRevision === null) || (value.projectId === null) !== (value.projectManifestDigest === null)
    || !(value.releaseId === null || typeof value.releaseId === "string" && uuid.test(value.releaseId))
    || !(value.releaseRevision === null || positive(value.releaseRevision))
    || (value.releaseId === null) !== (value.releaseRevision === null)
    || !(value.operationId === null || typeof value.operationId === "string" && uuid.test(value.operationId))
    || value.operationId !== null && value.releaseId === null) throw new TypeError("Studio returned an invalid owner/project/revision binding.");
  return value as unknown as KeelStudioAgentStateBinding;
}

export function sameKeelStudioAgentState(a: KeelStudioAgentStateBinding, b: KeelStudioAgentStateBinding): boolean {
  return Object.keys(parseKeelStudioAgentStateBinding(a)).every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
}

const toolOperations: Readonly<Record<string, string>> = {
  read: "keel_release_read", plan: "keel_release_plan_read", diagnose: "keel_release_diagnose",
  "continue-publication": "keel_release_continue", "prepare-review": "keel_release_review_prepare",
  "read-review": "keel_release_review_read", "storage-review": "keel_storage_review",
};

/** Reject cross-object actions and arbitrary tool/URL instructions before an agent consumes them. */
export function parseKeelStudioAgentProgress(value: unknown, expected?: { readonly releaseId?: string; readonly revision?: number; readonly projectId?: string | null }): KeelStudioAgentProgress {
  if (!object(value) || value.schema !== "keel-agent-progress@1" || value.signing !== "not-performed" || value.submission !== "not-performed"
    || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt)) || typeof value.lifecycle !== "string"
    || !["not-established", "recorded-confirmed"].includes(String(value.publication))
    || !Array.isArray(value.completedWork) || value.completedWork.some(item => typeof item !== "string")
    || !Array.isArray(value.blockers) || value.blockers.length > 20
    || value.blockers.some(item => !object(item) || typeof item.code !== "string" || typeof item.message !== "string" || typeof item.retryable !== "boolean")
    || !Array.isArray(value.nextActions) || value.nextActions.length > 5) throw new TypeError("Studio returned invalid saved progress.");
  const binding = parseKeelStudioAgentStateBinding(value.binding);
  if (expected?.releaseId !== undefined && binding.releaseId !== expected.releaseId || expected?.revision !== undefined && binding.releaseRevision !== expected.revision
    || expected?.projectId !== undefined && binding.projectId !== expected.projectId) throw new TypeError("Studio progress belongs to a different saved object or revision.");
  const storage = value.storage;
  if (!object(storage) || storage.evidence !== "saved-state-only" || typeof storage.fundingReceiptRecorded !== "boolean"
    || ![storage.totalPlans, storage.completedPlans, storage.failedPlans, storage.completedChunks, storage.completedOperations].every(item => Number.isSafeInteger(item) && (item as number) >= 0)
    || (storage.completedPlans as number) > (storage.totalPlans as number) || (storage.failedPlans as number) > (storage.totalPlans as number)
    || !Array.isArray(storage.recordedJobIds) || storage.recordedJobIds.some(item => typeof item !== "string" || !/^(?:0|[1-9]\d*)$/u.test(item))) throw new TypeError("Studio returned invalid saved storage progress.");
  if ((value.operation === null) !== (binding.operationId === null)) throw new TypeError("Studio returned an inconsistent operation binding.");
  if (value.operation !== null && (!object(value.operation) || value.operation.id !== binding.operationId
    || !positive(value.operation.revision) || typeof value.operation.status !== "string"
    || ![value.operation.walletResponseRecorded, value.operation.ownerRejectionRecorded, value.operation.recoveryRecorded].every(item => typeof item === "boolean")
    || !(value.operation.transactionHash === null || typeof value.operation.transactionHash === "string" && digest.test(value.operation.transactionHash))
    || !(value.operation.receiptStatus === null || typeof value.operation.receiptStatus === "string"))) throw new TypeError("Studio returned invalid operation progress.");
  for (const action of value.nextActions) {
    if (!object(action) || !["tool", "owner"].includes(String(action.kind)) || typeof action.operation !== "string"
      || !object(action.arguments) || typeof action.allowed !== "boolean" || typeof action.reason !== "string"
      || typeof action.retryable !== "boolean" || typeof action.ownerWalletRequired !== "boolean"
      || !sameKeelStudioAgentState(binding, parseKeelStudioAgentStateBinding(action.binding))) throw new TypeError("Studio returned an unbound next action.");
    if (action.kind === "tool") {
      const write = ["continue-publication", "prepare-review", "storage-review"].includes(action.operation);
      if (toolOperations[action.operation] !== action.tool || action.requiredScope !== (write ? "drafts:write" : "drafts:read") || action.ownerWalletRequired
        || !sameKeelStudioAgentState(binding, parseKeelStudioAgentStateBinding(action.arguments.expectedState))
        || (action.operation === "storage-review" ? action.arguments.projectId !== binding.projectId : action.arguments.releaseId !== binding.releaseId)
        || ["continue-publication", "prepare-review", "read-review"].includes(action.operation) && action.arguments.expectedRevision !== binding.releaseRevision
        || action.operation === "read-review" && action.arguments.operationId !== binding.operationId
        || action.operation === "continue-publication" && (action.arguments.expectedOperationId ?? null) !== binding.operationId) throw new TypeError("Studio returned an unsafe tool action.");
    } else {
      const review = action.operation === "owner-review";
      const path = review ? `/studio/releases/${binding.releaseId}/review?operation=${binding.operationId}&revision=${binding.releaseRevision}`
        : binding.releaseId ? `/studio/releases/${binding.releaseId}` : `/artifacts/${binding.projectId}?studio=1`;
      if (!["owner-review", "owner-progress"].includes(action.operation) || action.tool !== null || action.requiredScope !== null || action.ownerPath !== path
        || review && (!binding.releaseId || !binding.operationId || !action.ownerWalletRequired)) throw new TypeError("Studio returned an invalid owner action.");
    }
  }
  return value as unknown as KeelStudioAgentProgress;
}
