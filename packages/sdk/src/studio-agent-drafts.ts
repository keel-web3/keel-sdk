import { decodeFunctionData, keccak256, parseAbi, type Hex } from "viem";
import { parseKeelExecutionAuthority, type KeelExecutionAuthorityView } from "./studio-execution-authority.js";
import { parseKeelNamedProjectProfile, validateKeelNamedProfileCommand, type KeelNamedProjectProfile, type KeelNamedProfileCommand } from "./studio-project-profiles.js";
import { parseKeelSelectedProjectProfile, type KeelSelectedProjectProfile } from "./studio-project-defaults.js";
export type KeelStudioProjectProfilesView = KeelStudioDefaultsView & { readonly starters: readonly KeelNamedProjectProfile[] };
import type { KeelPlanValue } from "./studio-project-planner.js";
export interface KeelStudioConversationSuggestion {
  readonly commandId: string; readonly expectedRevision: number; readonly message: string;
  readonly answers?: Readonly<Record<string, KeelPlanValue | null>>;
}
export interface KeelStudioReleaseConversation {
  readonly schema: "keel-release-conversation@1"; readonly releaseId: string; readonly revision: number;
  readonly turns: readonly { readonly id: string; readonly source?: "creator" | "connected-agent"; readonly releaseRevision: number;
    readonly message: string; readonly reply: string | null; readonly proposal: Readonly<Record<string, KeelPlanValue | null>> | null;
    readonly status: "queued" | "running" | "done" | "failed" | "expired"; readonly createdAt: string; readonly completedAt: string | null }[];
  readonly bridge: { readonly configured: boolean; readonly online: boolean }; readonly editable: boolean;
  readonly planningUrl?: string;
}
export interface KeelStudioConversationSuggestionReceipt {
  readonly schema: "keel-release-conversation-suggestion@1";
  readonly releaseId: string; readonly revision: number;
  readonly turn: KeelStudioReleaseConversation["turns"][number];
  readonly signing: "not-performed"; readonly submission: "not-performed";
  readonly planningUrl?: string;
}
import { resolveKeelBuildDefaults, type KeelEffectiveBuildDefaults, parseKeelStudioDefaultProfile, validateKeelStudioDefaultsCommand, type KeelStudioDefaultsCommand, type KeelStudioDefaultsView } from "./studio-project-defaults.js";
import { KEEL_STUDIO_URL } from "./endpoints.js";
import type { KeelStudioPlanningCommand, KeelStudioPlan, KeelPlanMatrix, KeelResolvedPlan } from "./studio-project-planner.js";

export interface KeelStudioReleasePlanning {
  readonly schema: "keel-release-planning@1";
  readonly execution?: KeelExecutionAuthorityView;
  readonly releaseId: string;
  readonly revision: number;
  readonly plan: KeelStudioPlan;
  readonly matrix: KeelPlanMatrix;
  readonly resolved: KeelResolvedPlan;
  readonly editable: boolean;
  readonly planningUrl: string;
  readonly sections?: readonly { readonly fieldId: string; readonly label: string; readonly editPath: string }[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}
export interface KeelStudioReleaseWalletReview {
  readonly schema: "keel-release-wallet-review@1";
  readonly execution?: KeelExecutionAuthorityView;
  readonly releaseId: string; readonly revision: number; readonly wallet: string;
  readonly preparation: { readonly operationId: string; readonly chainId: number;
    readonly calls: readonly { readonly kind: string; readonly to: string; readonly data: string; readonly value: string }[];
    readonly [key: string]: unknown };
  readonly reviewUrl: string; readonly signing: "not-performed"; readonly submission: "not-performed";
}

export interface KeelStudioReleaseRecovery {
  readonly schema: "keel-release-recovery@1"; readonly releaseId: string; readonly operationId: string;
  readonly status: "recovered" | "pending"; readonly nextAction: "prepare-review" | "await-receipt";
  readonly receiptsPreserved: true; readonly uploadedBytes: 0; readonly signing: "not-performed"; readonly submission: "not-performed";
}

export type KeelStudioReleaseWalletRejection =
  | { readonly kind: "wallet-policy-rejected"; readonly provider: "metamask"; readonly method: "eth_sendTransaction"; readonly code: -32602; readonly reason: "internal-account-data" }
  | { readonly kind: "user-rejected"; readonly provider: "metamask" | "eip1193"; readonly method: "eth_sendTransaction" | "wallet_sendCalls"; readonly code: 4001; readonly reason: "user-declined" }
  | { readonly kind: "dispatch-aborted"; readonly provider: "studio"; readonly method: "eth_sendTransaction" | "wallet_sendCalls"; readonly reason: "browser-journal-unavailable" };
function checkedWalletRejection(rejection: KeelStudioReleaseWalletRejection): void {
  if (!rejection || typeof rejection !== "object" || Array.isArray(rejection)
    || Object.keys(rejection).some(key => !["kind", "provider", "method", "code", "reason"].includes(key))
    || !(rejection.kind === "wallet-policy-rejected" && rejection.provider === "metamask" && rejection.method === "eth_sendTransaction"
      && rejection.code === -32602 && rejection.reason === "internal-account-data"
      || rejection.kind === "user-rejected" && ["metamask", "eip1193"].includes(rejection.provider)
        && ["eth_sendTransaction", "wallet_sendCalls"].includes(rejection.method) && rejection.code === 4001 && rejection.reason === "user-declined"
      || rejection.kind === "dispatch-aborted" && rejection.provider === "studio" && !("code" in rejection)
        && ["eth_sendTransaction", "wallet_sendCalls"].includes(rejection.method) && rejection.reason === "browser-journal-unavailable")) {
    throw new TypeError("Unknown wallet or transport errors cannot establish a rejected transaction.");
  }
}

export interface KeelStudioReleaseWalletRejectionInput {
  readonly operationId: string; readonly attemptId: string; readonly expectedRevision: number; readonly chainId: number;
  readonly preparedDigest: string; readonly walletProofFingerprint: string;
  readonly rejection: KeelStudioReleaseWalletRejection;
}
export interface KeelStudioReleaseWalletRejectionRecovery {
  readonly schema: "keel-release-wallet-rejection-recovery@1"; readonly releaseId: string; readonly operationId: string; readonly attemptId: string;
  readonly status: "recovered"; readonly releaseStatus: "ready"; readonly nextAction: "prepare-review";
  readonly storagePreserved: true; readonly uploadedBytes: 0; readonly signing: "not-performed"; readonly submission: "not-performed";
}

export interface KeelStudioStorageReview {
  readonly projectId: string;
  readonly status: "complete" | "approval-required" | "resume" | "pending-approval-receipt" | "blocked" | "failed";
  readonly walletApprovalRequired: boolean;
  readonly message: string;
  readonly reviewUrl: string;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
  readonly preflight?: Readonly<Record<string, unknown>>;
}

export const KEEL_STUDIO_AGENT_DRAFT_API = "keel-studio-agent-drafts@1" as const;

export const KEEL_STUDIO_RELEASE_TYPES = [
  "open-edition",
  "limited-edition",
  "one-of-one",
  "generative-series",
  "unique-set",
  "interactive-work",
  "game-world",
  "asset-library",
  "custom",
] as const;

export type KeelStudioReleaseType = (typeof KEEL_STUDIO_RELEASE_TYPES)[number];
export type KeelStudioReleaseAccessMode = "public" | "allowlist" | "holder" | "claim" | "custom";

export interface KeelStudioAgentReleaseDraft {
  readonly artifactId: string | null;
  readonly title: string;
  readonly description: string;
  readonly story: string;
  readonly releaseType: KeelStudioReleaseType;
  readonly accessMode: KeelStudioReleaseAccessMode;
  readonly supply: string;
  readonly priceEth: string;
  readonly maxPerTransaction: number;
  readonly maxPerWallet: number;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly networkLabel: string;
  readonly payoutAddress: `0x${string}` | null;
  readonly page: Readonly<Record<string, unknown>>;
}

export interface KeelStudioAgentReleaseView extends KeelStudioAgentReleaseDraft {
  readonly id: string;
  readonly revision: number;
  readonly status: string;
  readonly slug: string;
  /** Open in the website with the creator's existing wallet to review and publish. */
  readonly reviewUrl: string;
}

/** Owner-scoped read-only replay data. It is not a wallet request or permission to contact another provider. */
export interface KeelStudioMetadataReadCall {
  readonly schema: "keel-metadata-read-call@1";
  readonly chainId: number;
  readonly request: { readonly to: string; readonly data: string; readonly value: "0x0"; readonly gas: string };
  readonly block: { readonly number: string; readonly hash: string | null; readonly gasLimit: string };
  readonly readerRuntimeCodeHash: string;
  readonly functionName: "preparedTokenURI" | "preEncodedTokenURI";
  readonly calldataDigest: string;
  readonly expectedMetadataDigest: string;
  readonly expectedMetadataBytes: number;
  readonly graphBytes: number;
  readonly prefixBytes: number;
  readonly suffixBytes: number;
  readonly attempts: readonly { readonly method: "eth_estimateGas" | "eth_call"; readonly gas: string }[];
  readonly runtimeSourceMatch: "not-established";
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

function checkedMetadataReadCall(value: KeelStudioMetadataReadCall): KeelStudioMetadataReadCall {
  const hex = (input: unknown, bytes?: number): input is Hex => typeof input === "string" && /^0x(?:[0-9a-f]{2})*$/iu.test(input) && (bytes === undefined || input.length === 2 + bytes * 2);
  const quantity = (input: unknown): input is string => typeof input === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(input);
  if (!value || value.schema !== "keel-metadata-read-call@1" || !Number.isSafeInteger(value.chainId) || value.chainId < 1
    || value.signing !== "not-performed" || value.submission !== "not-performed" || value.runtimeSourceMatch !== "not-established"
    || !value.request || Object.keys(value.request).some(key => !["to", "data", "value", "gas"].includes(key))
    || !hex(value.request.to, 20) || !hex(value.request.data) || value.request.data.length > 4_200_002 || value.request.value !== "0x0"
    || !quantity(value.request.gas) || BigInt(value.request.gas) <= 0n || BigInt(value.request.gas) > 60_000_000n
    || !value.block || !quantity(value.block.number) || !(value.block.hash === null || hex(value.block.hash, 32))
    || !/^[1-9][0-9]*$/u.test(value.block.gasLimit) || !hex(value.readerRuntimeCodeHash, 32) || !hex(value.calldataDigest, 32)
    || keccak256(value.request.data) !== value.calldataDigest || !hex(value.expectedMetadataDigest, 32)
    || ![value.expectedMetadataBytes, value.graphBytes, value.prefixBytes, value.suffixBytes].every(size => Number.isSafeInteger(size) && size >= 0)
    || !Array.isArray(value.attempts) || value.attempts.length > 64
    || Array.from(value.attempts).some(attempt => !attempt || !["eth_call", "eth_estimateGas"].includes(attempt.method) || !/^[1-9][0-9]*$/u.test(attempt.gas) || BigInt(attempt.gas) > 60_000_000n)) throw new TypeError("Studio returned an invalid read-only metadata call.");
  const decoded = decodeFunctionData({ abi: parseAbi([
    "function preparedTokenURI(bytes32 objectId,bytes32 digest,bytes prefix,bytes suffix) view returns (string)",
    "function preEncodedTokenURI(bytes32 objectId,bytes32 digest,bytes prefix,bytes suffix) view returns (string)",
  ]), data: value.request.data });
  if (decoded.functionName !== value.functionName) throw new TypeError("The metadata call does not match its declared reader method.");
  return value;
}

export interface KeelStudioReleaseDiagnostics {
  readonly schema: "keel-release-diagnostics@1";
  readonly metadataReadCall?: KeelStudioMetadataReadCall;
  readonly releaseId: string;
  readonly artifactId: string | null;
  readonly slug: string;
  readonly revision: number;
  readonly artifactRevision: number | null;
  readonly manifestDigest: string | null;
  readonly chainId: number | null;
  readonly presentationMode: string;
  readonly status: "ready-for-review" | "blocked" | "resume-saved-operation";
  readonly message: string;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly fingerprint?: string;
  readonly diagnostic?: Readonly<Record<string, string | number | boolean>>;
  readonly actions: readonly string[];
  readonly operations?: readonly Readonly<Record<string, unknown>>[];
  readonly recoveryInput?: Omit<KeelStudioReleaseWalletRejectionInput, "rejection">;
  /** Owner-recorded outcome for recoveryInput; omit recovery when this is absent. */
  readonly ownerRecordedRejection?: KeelStudioReleaseWalletRejection;
  readonly legacyObservationInput?: Omit<KeelStudioReleaseWalletRejectionInput, "rejection" | "attemptId">;
  readonly storageEvidence?: readonly {
    readonly resourceId: string;
    readonly status: string;
    readonly chainId: number | null;
    readonly store: string | null;
    readonly objectId: string | null;
    readonly transactionHashes: readonly string[];
  }[];
  readonly signing: "not-performed";
  readonly submission: "not-performed";
  readonly uploadedBytes: 0;
  readonly changed: false;
}

export interface KeelStudioReleaseContinuation {
  readonly schema: "keel-release-continuation@1";
  readonly releaseId: string;
  readonly revision: number;
  readonly status: "review-required" | "owner-observation-required" | "pending" | "blocked" | "published";
  readonly message: string;
  readonly nextAction: "prepare-review" | "record-owner-observation" | "reconcile-wallet-response" | "retry-saved-progress" | "view-publication";
  readonly reviewPath: string;
  readonly diagnostic?: KeelStudioReleaseDiagnostics;
  readonly storagePreserved: true;
  readonly uploadedBytes: 0;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

export interface KeelStudioStorageRecovery {
  readonly status: "not-applicable" | "owner-observation-required" | "blocked";
  readonly ownerPath: string;
  readonly message: string;
  readonly code?: string;
  readonly nextActions: readonly Readonly<Record<string, unknown>>[];
}

export interface KeelStudioAgentDraftWorkspace {
  readonly projects: readonly Readonly<Record<string, unknown>>[];
  readonly releases: readonly KeelStudioAgentReleaseView[];
}

export interface KeelStudioAgentDraftClientOptions {
  readonly studioUrl?: string | URL;
  readonly grantToken: string;
  readonly fetchImplementation?: typeof fetch;
}

const KEEL_STUDIO_AGENT_DRAFT_OPERATIONS = ["list", "read", "diagnose", "continue-publication", "cancel-review", "storage-recovery", "recover", "recover-wallet-rejection", "plan", "plan-edit", "defaults", "defaults-edit", "profiles", "profiles-edit", "profile-select", "conversation", "conversation-suggest", "prepare-review", "storage-review", "create", "update"] as const;
export type KeelStudioAgentDraftOperation = (typeof KEEL_STUDIO_AGENT_DRAFT_OPERATIONS)[number];

/**
 * A flat, JSON/YAML-friendly description of one draft operation. The
 * operation is deliberately limited to the creator's Studio draft API; it
 * accepts no caller-supplied wallet, calldata, signing or submission fields.
 */
export interface KeelStudioAgentDraftOperationConfig extends KeelStudioAgentDraftClientOptions {
  readonly operation: KeelStudioAgentDraftOperation;
  readonly releaseId?: string;
  readonly draft?: KeelStudioAgentReleaseDraft;
  readonly expectedRevision?: number;
  readonly planningCommand?: KeelStudioPlanningCommand;
  readonly defaultsCommand?: KeelStudioDefaultsCommand;
  readonly profileCommand?: KeelNamedProfileCommand;
  readonly profileSelection?: { readonly profileId: string; readonly expectedProfileRevision: number };
  readonly conversationCommand?: KeelStudioConversationSuggestion;
  readonly projectId?: string;
  readonly includeReadCall?: boolean;
  readonly operationId?: string;
  readonly transactionHashes?: readonly string[];
  readonly recoveryInput?: KeelStudioReleaseWalletRejectionInput;
}

export interface KeelStudioReviewCancellation {
  readonly schema: "keel-release-review-cancelled@1";
  readonly releaseId: string; readonly operationId: string; readonly revision: number;
  readonly status: "draft"; readonly nextAction: "plan"; readonly storagePreserved: true;
  readonly uploadedBytes: 0; readonly signing: "not-performed"; readonly submission: "not-performed";
}

export type KeelStudioAgentDraftOperationResult = KeelStudioReviewCancellation | KeelStudioReleaseContinuation | KeelStudioStorageRecovery | KeelStudioReleaseRecovery | KeelStudioReleaseWalletRejectionRecovery | KeelStudioAgentDraftWorkspace | KeelStudioAgentReleaseView | KeelStudioReleaseDiagnostics | KeelStudioReleasePlanning | KeelStudioStorageReview | KeelStudioReleaseWalletReview | KeelStudioDefaultsView | KeelStudioReleaseConversation | KeelStudioConversationSuggestionReceipt | KeelStudioProjectProfilesView | KeelSelectedProjectProfile;

export interface KeelStudioAgentDraftClient {
  readonly cancelReview: (releaseId: string, expectedRevision: number, operationId: string) => Promise<KeelStudioReviewCancellation>;
  readonly list: () => Promise<KeelStudioAgentDraftWorkspace>;
  readonly read: (releaseId: string) => Promise<KeelStudioAgentReleaseView>;
  readonly recover: (releaseId: string, operationId: string, transactionHashes: readonly string[]) => Promise<KeelStudioReleaseRecovery>;
  readonly recoverWalletRejection: (releaseId: string, input: KeelStudioReleaseWalletRejectionInput) => Promise<KeelStudioReleaseWalletRejectionRecovery>;
  readonly continuePublication: (releaseId: string, expectedRevision: number) => Promise<KeelStudioReleaseContinuation>;
  readonly storageRecovery: (projectId: string) => Promise<KeelStudioStorageRecovery>;
  readonly diagnose: (releaseId: string, options?: { readonly includeReadCall?: boolean }) => Promise<KeelStudioReleaseDiagnostics>;
  readonly plan: (releaseId: string) => Promise<KeelStudioReleasePlanning>;
  readonly editPlan: (releaseId: string, command: KeelStudioPlanningCommand) => Promise<KeelStudioReleasePlanning>;
  readonly conversation: (releaseId: string) => Promise<KeelStudioReleaseConversation>;
  readonly suggest: (releaseId: string, suggestion: KeelStudioConversationSuggestion) => Promise<KeelStudioConversationSuggestionReceipt>;
  readonly profiles: () => Promise<KeelStudioProjectProfilesView>;
  readonly editProfiles: (command: KeelNamedProfileCommand) => Promise<KeelStudioDefaultsView>;
  readonly selectProfile: (profileId: string, expectedProfileRevision: number) => Promise<KeelSelectedProjectProfile>;
  readonly defaults: () => Promise<KeelStudioDefaultsView>;
  /** Fresh authenticated read on every call; never a process-wide preferences cache. */
  readonly effectiveBuildDefaults: (input?: Parameters<typeof resolveKeelBuildDefaults>[1]) => Promise<KeelEffectiveBuildDefaults>;
  readonly editDefaults: (command: KeelStudioDefaultsCommand) => Promise<KeelStudioDefaultsView>;
  readonly prepareReview: (releaseId: string, expectedRevision: number) => Promise<KeelStudioReleaseWalletReview>;
  readonly storageReview: (projectId: string) => Promise<KeelStudioStorageReview>;
  readonly create: (draft: KeelStudioAgentReleaseDraft) => Promise<KeelStudioAgentReleaseView>;
  readonly update: (releaseId: string, draft: KeelStudioAgentReleaseDraft, expectedRevision: number) => Promise<KeelStudioAgentReleaseView>;
}

const RELEASE_DRAFT_FIELDS = [
  "artifactId", "title", "description", "story", "releaseType", "accessMode", "supply", "priceEth",
  "maxPerTransaction", "maxPerWallet", "startsAt", "endsAt", "networkLabel", "payoutAddress", "page",
] as const;

function boundedDraftText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be text of at most ${maximum} characters without control characters.`);
  }
  return value;
}

function nullableDraftText(value: unknown, label: string, maximum: number): string | null {
  return value === null ? null : boundedDraftText(value, label, maximum);
}

function positiveDraftInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) {
    throw new TypeError(`${label} must be an integer from 1 through 1000000.`);
  }
  return value as number;
}

/**
 * Validate the portable JSON/YAML draft shape before a CLI or MCP client sends
 * it to Studio. Studio remains authoritative and performs the same validation
 * again against the creator-owned record.
 */
export function validateKeelStudioAgentReleaseDraft(value: unknown): KeelStudioAgentReleaseDraft {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Studio release draft must be an object.");
  const input = value as Record<string, unknown>;
  // A creator or agent commonly edits the object returned by `read`; accept
  // those read-only view fields and strip them from the update payload.
  const allowed = new Set<string>([...RELEASE_DRAFT_FIELDS, "id", "revision", "status", "slug", "reviewUrl", "lastReadDiagnostic"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`Studio release draft.${key} is not supported.`);
  for (const key of RELEASE_DRAFT_FIELDS) if (!(key in input)) throw new TypeError(`Studio release draft.${key} is required.`);

  const title = boundedDraftText(input.title, "Studio release draft.title", 140).trim();
  if (title.length === 0) throw new TypeError("Studio release draft.title must not be empty.");
  const description = boundedDraftText(input.description, "Studio release draft.description", 2_000).trim();
  const story = boundedDraftText(input.story, "Studio release draft.story", 8_000).trim();
  if (typeof input.releaseType !== "string" || !(KEEL_STUDIO_RELEASE_TYPES as readonly string[]).includes(input.releaseType)) {
    throw new TypeError("Studio release draft.releaseType is unsupported.");
  }
  if (typeof input.accessMode !== "string" || !["public", "allowlist", "holder", "claim", "custom"].includes(input.accessMode)) {
    throw new TypeError("Studio release draft.accessMode is unsupported.");
  }
  if (typeof input.supply !== "string" || !/^(?:open|[1-9][0-9]*)$/u.test(input.supply.trim())) {
    throw new TypeError("Studio release draft.supply must be open or a positive integer string.");
  }
  if (typeof input.priceEth !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u.test(input.priceEth.trim())) {
    throw new TypeError("Studio release draft.priceEth must be a non-negative ETH decimal with at most 18 places.");
  }
  const artifactId = nullableDraftText(input.artifactId, "Studio release draft.artifactId", 128);
  const startsAt = nullableDraftText(input.startsAt, "Studio release draft.startsAt", 64);
  const endsAt = nullableDraftText(input.endsAt, "Studio release draft.endsAt", 64);
  const payoutAddress = nullableDraftText(input.payoutAddress, "Studio release draft.payoutAddress", 42);
  if (payoutAddress !== null && !/^0x[0-9a-f]{40}$/iu.test(payoutAddress)) throw new TypeError("Studio release draft.payoutAddress must be a valid address or null.");
  if (input.page === null || typeof input.page !== "object" || Array.isArray(input.page)) throw new TypeError("Studio release draft.page must be an object.");

  return Object.freeze({
    artifactId,
    title,
    description,
    story,
    releaseType: input.releaseType as KeelStudioReleaseType,
    accessMode: input.accessMode as KeelStudioReleaseAccessMode,
    supply: input.supply.trim(),
    priceEth: input.priceEth.trim(),
    maxPerTransaction: positiveDraftInteger(input.maxPerTransaction, "Studio release draft.maxPerTransaction"),
    maxPerWallet: positiveDraftInteger(input.maxPerWallet, "Studio release draft.maxPerWallet"),
    startsAt,
    endsAt,
    networkLabel: boundedDraftText(input.networkLabel, "Studio release draft.networkLabel", 80).trim(),
    payoutAddress: payoutAddress as `0x${string}` | null,
    page: input.page as Readonly<Record<string, unknown>>,
  });
}

function isDraftOperation(value: unknown): value is KeelStudioAgentDraftOperation {
  return typeof value === "string" && (KEEL_STUDIO_AGENT_DRAFT_OPERATIONS as readonly string[]).includes(value);
}

function endpoint(studioUrl: string | URL, path: string): URL {
  const url = new URL(path, studioUrl);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)))) {
    throw new TypeError("KEEL Studio agent draft API requires HTTPS, except on loopback.");
  }
  return url;
}

function releasePath(releaseId: string): string {
  if (typeof releaseId !== "string" || releaseId.trim().length === 0) throw new TypeError("Studio release ID must be non-empty text.");
  return `/api/agent/drafts/${encodeURIComponent(releaseId)}`;
}

function redactSensitiveMessage(message: string, secrets: readonly string[]): string {
  return secrets.reduce((redacted, secret) => {
    if (secret.length === 0) return redacted;
    return redacted
      .split(secret).join("[redacted]")
      .split(encodeURIComponent(secret)).join("[redacted]");
  }, message);
}

export async function studioAgentResponse<T>(response: Response, secrets: readonly string[]): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`KEEL Studio agent draft API returned HTTP ${response.status} without JSON.`);
  }
  if (!response.ok) {
    const message = value !== null && typeof value === "object" && typeof (value as { error?: unknown }).error === "string"
      ? (value as { error: string }).error
      : `KEEL Studio agent draft API failed with HTTP ${response.status}.`;
    throw new Error(redactSensitiveMessage(message, secrets));
  }
  return value as T;
}

export function studioAgentRequest(options: KeelStudioAgentDraftClientOptions, path: string, init?: RequestInit): Promise<Response> {
  if (typeof options.grantToken !== "string" || options.grantToken.length < 48) throw new TypeError("KEEL Studio agent draft grant is invalid.");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${options.grantToken}`);
  return (options.fetchImplementation ?? fetch)(endpoint(options.studioUrl ?? KEEL_STUDIO_URL, path), {
    ...init,
    redirect: "error",
    headers,
  });
}

/**
 * Creates a wallet-neutral client for creator-authorized draft work. It cannot
 * sign, submit or cancel a chain operation. Continuation can reconcile already saved receipts. prepareReview saves only an unsigned owner-review operation through Studio.
 */
export function createKeelStudioAgentDraftClient(options: KeelStudioAgentDraftClientOptions) {
  if (options === null || typeof options !== "object") throw new TypeError("KEEL Studio agent draft client options are required.");
  if (typeof options.grantToken !== "string" || options.grantToken.length < 48) throw new TypeError("KEEL Studio agent draft grant is invalid.");
  if (options.studioUrl !== undefined && typeof options.studioUrl !== "string" && !(options.studioUrl instanceof URL)) throw new TypeError("Studio URL must be text or a URL.");
  if (options.fetchImplementation !== undefined && typeof options.fetchImplementation !== "function") throw new TypeError("fetchImplementation must be a function.");

  const reviewed = (release: KeelStudioAgentReleaseView): KeelStudioAgentReleaseView => {
    if (!release || typeof release.slug !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/u.test(release.slug)) {
      throw new TypeError("Studio returned an invalid release review slug.");
    }
    // Derive only the existing release route from the persisted server slug.
    // Never forward a token, caller-provided URL, or unsigned calldata in the link.
    const reviewUrl = endpoint(options.studioUrl ?? KEEL_STUDIO_URL, `/release/${encodeURIComponent(release.slug)}`).href;
    return Object.freeze({ ...release, reviewUrl });
  };
  const list = async (): Promise<KeelStudioAgentDraftWorkspace> => {
    const workspace = await studioAgentResponse<KeelStudioAgentDraftWorkspace>(await studioAgentRequest(options, "/api/agent/drafts", { cache: "no-store" }), [options.grantToken]);
    return { ...workspace, releases: workspace.releases.map(reviewed) };
  };
  const read = async (releaseId: string): Promise<KeelStudioAgentReleaseView> =>
      reviewed(await studioAgentResponse(await studioAgentRequest(options, releasePath(releaseId), { cache: "no-store" }), [options.grantToken]));
  const cancelReview = async (releaseId: string, expectedRevision: number, operationId: string): Promise<KeelStudioReviewCancellation> => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || typeof operationId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(operationId)) throw new TypeError("Cancel review needs its exact saved revision and operation.");
    const value = await studioAgentResponse<KeelStudioReviewCancellation>(await studioAgentRequest(options, `${releasePath(releaseId)}/review/cancel`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision, operationId }),
    }), [options.grantToken]);
    if (!value || value.schema !== "keel-release-review-cancelled@1" || value.releaseId !== releaseId || value.operationId !== operationId
      || value.revision !== expectedRevision || value.status !== "draft" || value.nextAction !== "plan" || value.storagePreserved !== true
      || value.uploadedBytes !== 0 || value.signing !== "not-performed" || value.submission !== "not-performed") throw new TypeError("Studio did not verify cancellation of this exact unsubmitted review.");
    return value;
  };
  const continuePublication = async (releaseId: string, expectedRevision: number): Promise<KeelStudioReleaseContinuation> => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("Continue needs the current saved release revision.");
    const value = await studioAgentResponse<KeelStudioReleaseContinuation>(await studioAgentRequest(options, `${releasePath(releaseId)}/continue`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision }),
    }), [options.grantToken]);
    const actions = { "review-required": ["prepare-review"], "owner-observation-required": ["record-owner-observation"],
      pending: ["retry-saved-progress", "reconcile-wallet-response"], blocked: ["retry-saved-progress"], published: ["view-publication"] };
    if (!value || value.schema !== "keel-release-continuation@1" || value.releaseId !== releaseId || value.revision !== expectedRevision
      || !Object.hasOwn(actions, value.status) || !actions[value.status].includes(value.nextAction)
      || value.reviewPath !== `/studio/releases/${encodeURIComponent(releaseId)}` || typeof value.message !== "string"
      || value.storagePreserved !== true || value.uploadedBytes !== 0 || value.signing !== "not-performed" || value.submission !== "not-performed"
      || value.diagnostic && (value.diagnostic.releaseId !== releaseId || value.diagnostic.revision !== expectedRevision || value.diagnostic.metadataReadCall !== undefined)) {
      throw new TypeError("Studio returned invalid saved publication progress.");
    }
    return value;
  };
  const storageRecovery = async (projectId: string): Promise<KeelStudioStorageRecovery> => {
    if (typeof projectId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(projectId)) throw new TypeError("Storage recovery needs the existing project ID.");
    const value = await studioAgentResponse<KeelStudioStorageRecovery>(await studioAgentRequest(options, `/api/agent/projects/${encodeURIComponent(projectId)}/preview-replan/legacy`, { cache: "no-store" }), [options.grantToken]);
    if (!value || !["not-applicable", "owner-observation-required", "blocked"].includes(value.status)
      || value.ownerPath !== `/studio/projects/${encodeURIComponent(projectId)}/recovery` || typeof value.message !== "string"
      || !Array.isArray(value.nextActions) || value.nextActions.length > 3 || "observationInput" in value) throw new TypeError("Studio returned invalid storage recovery evidence.");
    return value;
  };
  const recover = async (releaseId: string, operationId: string, transactionHashes: readonly string[]): Promise<KeelStudioReleaseRecovery> => {
    if (typeof operationId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(operationId) || !Array.isArray(transactionHashes) || transactionHashes.length !== 1 || transactionHashes.some(hash => !/^0x[0-9a-f]{64}$/iu.test(hash))) throw new TypeError("Recovery needs the saved operation and exact atomic transaction hash.");
    const value = await studioAgentResponse<KeelStudioReleaseRecovery>(await studioAgentRequest(options, `${releasePath(releaseId)}/recover`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operationId, transactionHashes }),
    }), [options.grantToken]);
    if (value.schema !== "keel-release-recovery@1" || value.releaseId !== releaseId || value.operationId !== operationId || value.receiptsPreserved !== true || value.uploadedBytes !== 0 || value.signing !== "not-performed" || value.submission !== "not-performed" || !["recovered", "pending"].includes(value.status) || value.nextAction !== (value.status === "recovered" ? "prepare-review" : "await-receipt")) throw new TypeError("Studio returned invalid release recovery evidence.");
    return value;
  };
  const recoverWalletRejection = async (releaseId: string, input: KeelStudioReleaseWalletRejectionInput): Promise<KeelStudioReleaseWalletRejectionRecovery> => {
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu, hash = /^0x[0-9a-f]{64}$/iu;
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(key => !["operationId", "attemptId", "expectedRevision", "chainId", "preparedDigest", "walletProofFingerprint", "rejection"].includes(key))
      || typeof releaseId !== "string" || !uuid.test(releaseId) || typeof input.operationId !== "string" || !uuid.test(input.operationId)
      || typeof input.attemptId !== "string" || !uuid.test(input.attemptId)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1
      || !Number.isSafeInteger(input.chainId) || input.chainId < 1
      || typeof input.preparedDigest !== "string" || !hash.test(input.preparedDigest)
      || typeof input.walletProofFingerprint !== "string" || !hash.test(input.walletProofFingerprint)) {
      throw new TypeError("Wallet rejection recovery requires the exact saved operation, revision, chain, digest and proof fingerprint.");
    }
    checkedWalletRejection(input.rejection);
    const value = await studioAgentResponse<KeelStudioReleaseWalletRejectionRecovery>(await studioAgentRequest(options, `${releasePath(releaseId)}/wallet-rejection`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    }), [options.grantToken]);
    if (value.schema !== "keel-release-wallet-rejection-recovery@1" || value.releaseId !== releaseId || value.operationId !== input.operationId
      || value.attemptId !== input.attemptId || value.status !== "recovered" || value.releaseStatus !== "ready" || value.nextAction !== "prepare-review"
      || value.storagePreserved !== true || value.uploadedBytes !== 0 || value.signing !== "not-performed" || value.submission !== "not-performed") {
      throw new TypeError("Studio returned invalid wallet rejection recovery evidence.");
    }
    return value;
  };
  const diagnose = async (releaseId: string, diagnosticOptions: { readonly includeReadCall?: boolean } = {}): Promise<KeelStudioReleaseDiagnostics> => {
    if (diagnosticOptions.includeReadCall !== undefined && typeof diagnosticOptions.includeReadCall !== "boolean") throw new TypeError("includeReadCall must be a boolean.");
    const value = await studioAgentResponse<KeelStudioReleaseDiagnostics>(await studioAgentRequest(options, `${releasePath(releaseId)}/diagnostics${diagnosticOptions.includeReadCall ? "?includeReadCall=true" : ""}`, { cache: "no-store" }), [options.grantToken]);
    if (value.schema !== "keel-release-diagnostics@1" || value.releaseId !== releaseId || value.signing !== "not-performed" || value.submission !== "not-performed" || value.uploadedBytes !== 0 || value.changed !== false) throw new TypeError("Studio returned another or mutating diagnostic result.");
    for (const field of ["recoveryInput", "legacyObservationInput"] as const) {
      const recovery = value[field];
      if (recovery === undefined) continue;
      if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)
        || Object.keys(recovery).some(key => !["operationId", "expectedRevision", "chainId", "preparedDigest", "walletProofFingerprint", ...(field === "recoveryInput" ? ["attemptId"] : [])].includes(key))
        || typeof recovery.operationId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(recovery.operationId)
        || (field === "recoveryInput" && (!("attemptId" in recovery) || typeof recovery.attemptId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(recovery.attemptId)))
        || !Number.isSafeInteger(recovery.expectedRevision) || recovery.expectedRevision !== value.revision
        || !Number.isSafeInteger(recovery.chainId) || recovery.chainId !== value.chainId
        || typeof recovery.preparedDigest !== "string" || !/^0x[0-9a-f]{64}$/iu.test(recovery.preparedDigest)
        || typeof recovery.walletProofFingerprint !== "string" || !/^0x[0-9a-f]{64}$/iu.test(recovery.walletProofFingerprint)) {
        throw new TypeError("Studio returned invalid wallet rejection recovery input.");
      }
    }
    if (value.ownerRecordedRejection !== undefined) {
      if (value.recoveryInput === undefined || value.legacyObservationInput !== undefined
        || value.status !== "resume-saved-operation" || value.code !== "wallet-recovery-required") {
        throw new TypeError("Studio returned an owner-recorded rejection without its current recovery identity.");
      }
      checkedWalletRejection(value.ownerRecordedRejection);
    }
    if (value.metadataReadCall !== undefined) {
      if (!diagnosticOptions.includeReadCall) throw new TypeError("Studio returned private call data that was not requested.");
      checkedMetadataReadCall(value.metadataReadCall);
    }
    return value;
  };
  const planning = async (releaseId: string, command?: KeelStudioPlanningCommand): Promise<KeelStudioReleasePlanning> => {
    if (command !== undefined) validatePlanningCommand(command);
    const value = await studioAgentResponse<KeelStudioReleasePlanning>(await studioAgentRequest(options, `${releasePath(releaseId)}/plan`, command === undefined
      ? { cache: "no-store" } : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }), [options.grantToken]);
    if (value.schema !== "keel-release-planning@1" || value.releaseId !== releaseId || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError("Studio returned another or invalid planning revision.");
    return { ...value, ...(value.execution === undefined ? {} : { execution: parseKeelExecutionAuthority(value.execution, { releaseId, revision: value.revision }) }), planningUrl: endpoint(options.studioUrl ?? KEEL_STUDIO_URL, `/studio/releases/${encodeURIComponent(releaseId)}/plan`).href };
  };
  const conversation = async (releaseId: string, suggestion?: KeelStudioConversationSuggestion): Promise<KeelStudioReleaseConversation | KeelStudioConversationSuggestionReceipt> => {
    if (suggestion !== undefined) {
      if (!suggestion || typeof suggestion !== "object" || Object.keys(suggestion).some(key => !["commandId", "expectedRevision", "message", "answers"].includes(key))
        || typeof suggestion.message !== "string" || !suggestion.message.trim() || suggestion.message.length > 12_000) throw new TypeError("Use a bounded conversation suggestion without wallet or code fields.");
      validatePlanningIdentity(suggestion);
      if (suggestion.answers !== undefined) validatePlanningCommand({ operation: "answer", commandId: suggestion.commandId, expectedRevision: suggestion.expectedRevision, answers: suggestion.answers });
    }
    const value = await studioAgentResponse<KeelStudioReleaseConversation | KeelStudioConversationSuggestionReceipt>(await studioAgentRequest(options, `${releasePath(releaseId)}/conversation`, suggestion === undefined
      ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(suggestion) }), [options.grantToken]);
    if (value.releaseId !== releaseId || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new TypeError("Studio returned another or invalid conversation.");
    if (suggestion === undefined ? value.schema !== "keel-release-conversation@1" || !Array.isArray(value.turns)
      : value.schema !== "keel-release-conversation-suggestion@1" || value.turn?.id !== suggestion.commandId || value.signing !== "not-performed" || value.submission !== "not-performed") throw new TypeError("Studio returned an invalid conversation receipt.");
    return { ...value, planningUrl: endpoint(options.studioUrl ?? KEEL_STUDIO_URL, `/studio/releases/${encodeURIComponent(releaseId)}/plan`).href };
  };
  const defaults = async (command?: KeelStudioDefaultsCommand): Promise<KeelStudioDefaultsView> => {
    const input = command === undefined ? undefined : validateKeelStudioDefaultsCommand(command);
    const value = await studioAgentResponse<KeelStudioDefaultsView>(await studioAgentRequest(options, "/api/agent/project-defaults", input === undefined
      ? { cache: "no-store" } : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), [options.grantToken]);
    if (value.schema !== "keel-studio-defaults-view@1" || value.signing !== "not-performed") throw new TypeError("Studio returned an invalid defaults profile.");
    return { ...value, profile: parseKeelStudioDefaultProfile(value.profile) };
  };
  const profiles = async (command?: KeelNamedProfileCommand): Promise<KeelStudioProjectProfilesView> => {
    const input = command === undefined ? undefined : validateKeelNamedProfileCommand(command);
    const value = await studioAgentResponse<KeelStudioProjectProfilesView>(await studioAgentRequest(options, "/api/agent/project-profiles", input === undefined
      ? { cache: "no-store" } : { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), [options.grantToken]);
    if (value.schema !== "keel-studio-defaults-view@1" || value.signing !== "not-performed") throw new TypeError("Studio returned an invalid project profile view.");
    if (input === undefined && !Array.isArray(value.starters)) throw new TypeError("Studio did not return its supported starting profiles.");
    return { ...value, profile: parseKeelStudioDefaultProfile(value.profile), starters: (value.starters ?? []).map(parseKeelNamedProjectProfile) };
  };
  const selectProfile = async (profileId: string, expectedProfileRevision: number): Promise<KeelSelectedProjectProfile> => {
    if (!/^(?:builtin:[a-z][a-z0-9-]{0,63}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu.test(profileId) || !Number.isSafeInteger(expectedProfileRevision) || expectedProfileRevision < 1) throw new TypeError("Select the saved profile ID and its exact revision.");
    const value = await studioAgentResponse<KeelSelectedProjectProfile & { signing: string; submission: string }>(await studioAgentRequest(options, "/api/agent/project-profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId, expectedProfileRevision }) }), [options.grantToken]);
    const selected = parseKeelSelectedProjectProfile({ snapshot: value.snapshot, ...(value.defaults ? { defaults: value.defaults } : {}) });
    if (selected.snapshot.id !== profileId || selected.snapshot.revision !== expectedProfileRevision || value.signing !== "not-performed" || value.submission !== "not-performed") throw new TypeError("Studio returned another profile or an invalid selection receipt.");
    return selected;
  };
  const prepareReview = async (releaseId: string, expectedRevision: number): Promise<KeelStudioReleaseWalletReview> => {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(releaseId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("Use the saved release UUID and current reviewed revision.");
    const value = await studioAgentResponse<KeelStudioReleaseWalletReview>(await studioAgentRequest(options, `${releasePath(releaseId)}/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision }) }), [options.grantToken]);
    const prepared = value.preparation;
    if (value.schema !== "keel-release-wallet-review@1" || value.releaseId !== releaseId || value.revision !== expectedRevision || value.signing !== "not-performed" || value.submission !== "not-performed"
      || !/^0x[0-9a-f]{40}$/iu.test(value.wallet) || !prepared || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(prepared.operationId)
      || !Number.isSafeInteger(prepared.chainId) || prepared.chainId < 1 || !Array.isArray(prepared.calls) || prepared.calls.length < 1 || prepared.calls.length > 8
      || !Array.from(prepared.calls).every(call => call && typeof call.kind === "string" && /^0x[0-9a-f]{40}$/iu.test(call.to) && /^0x(?:[0-9a-f]{2})*$/iu.test(call.data) && /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/iu.test(call.value))) throw new TypeError("Studio returned another or invalid wallet-review identity.");
    return { ...value, ...(value.execution === undefined ? {} : { execution: parseKeelExecutionAuthority(value.execution, { releaseId, revision: expectedRevision, operationId: prepared.operationId, wallet: value.wallet }) }), reviewUrl: endpoint(options.studioUrl ?? KEEL_STUDIO_URL, `/studio/releases/${encodeURIComponent(releaseId)}/review?operation=${encodeURIComponent(prepared.operationId)}&revision=${expectedRevision}`).href };
  };
  const storageReview = async (projectId: string): Promise<KeelStudioStorageReview> => {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(projectId)) throw new TypeError("Use this project's Studio UUID.");
    const value = await studioAgentResponse<KeelStudioStorageReview>(await studioAgentRequest(options, `/api/agent/projects/${encodeURIComponent(projectId)}/storage-review`, { method: "POST" }), [options.grantToken]);
    if (value.projectId !== projectId || value.signing !== "not-performed" || value.submission !== "not-performed" || !["complete", "approval-required", "resume", "pending-approval-receipt", "blocked", "failed"].includes(value.status) || typeof value.walletApprovalRequired !== "boolean") throw new TypeError("Studio returned an unexpected storage review.");
    return { ...value, reviewUrl: endpoint(options.studioUrl ?? KEEL_STUDIO_URL, `/artifacts/${encodeURIComponent(projectId)}?studio=1`).href };
  };
  const create = async (draft: KeelStudioAgentReleaseDraft): Promise<KeelStudioAgentReleaseView> => {
    const validated = validateKeelStudioAgentReleaseDraft(draft);
    return reviewed(await studioAgentResponse(await studioAgentRequest(options, "/api/agent/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validated),
    }), [options.grantToken]));
  };
  const update = async (releaseId: string, draft: KeelStudioAgentReleaseDraft, expectedRevision: number): Promise<KeelStudioAgentReleaseView> => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("Expected draft revision must be a positive integer.");
    const validated = validateKeelStudioAgentReleaseDraft(draft);
    return reviewed(await studioAgentResponse(await studioAgentRequest(options, releasePath(releaseId), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft: validated, expectedRevision }),
    }), [options.grantToken]));
  };
  return Object.freeze<KeelStudioAgentDraftClient>({ list, read, diagnose, continuePublication, cancelReview, storageRecovery, recover, recoverWalletRejection, profiles: () => profiles(), editProfiles: profiles, selectProfile, plan: releaseId => planning(releaseId), editPlan: planning, conversation: async releaseId => await conversation(releaseId) as KeelStudioReleaseConversation, suggest: async (releaseId, suggestion) => await conversation(releaseId, suggestion) as KeelStudioConversationSuggestionReceipt, defaults: () => defaults(), effectiveBuildDefaults: async input => resolveKeelBuildDefaults((await defaults()).profile, input), editDefaults: defaults, prepareReview, storageReview, create, update });
}

function validatePlanningIdentity(command: { readonly commandId: string; readonly expectedRevision: number }): void {
  if (!command || typeof command !== "object" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(command.commandId) || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) throw new TypeError("Planning edits need a stable command UUID and the current revision.");
}
function validatePlanningCommand(command: KeelStudioPlanningCommand): void {
  validatePlanningIdentity(command);
  const allowed = ["operation", "commandId", "expectedRevision", ...(command.operation === "answer" ? ["answers", "advance"] : command.operation === "navigate" ? ["fieldId"] : command.operation === "mode" ? ["mode"] : command.operation === "review" ? ["configurationKey"] : [])];
  if (Object.keys(command).some(key => !allowed.includes(key))) throw new TypeError("Unsupported planning edit field.");
  if (command.operation === "answer") {
    if (!command.answers || typeof command.answers !== "object" || Array.isArray(command.answers) || Object.keys(command.answers).length < 1 || Object.keys(command.answers).length > 16) throw new TypeError("Answer from one through sixteen related questions.");
    for (const [key, value] of Object.entries(command.answers)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$/u.test(key) || !(value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 8000) || (Array.isArray(value) && value.length <= 256 && value.every(item => typeof item === "string" && item.length <= 160)))) throw new TypeError("Invalid planning answer.");
    }
    if (command.advance !== undefined && typeof command.advance !== "boolean") throw new TypeError("advance must be boolean.");
  } else if (command.operation === "navigate") {
    if (typeof command.fieldId !== "string" || command.fieldId.length > 160) throw new TypeError("Use a current planning field ID.");
  } else if (command.operation === "mode") {
    if (command.mode !== "guided" && command.mode !== "direct") throw new TypeError("Use guided or direct mode.");
  } else if (command.operation === "review") {
    if (typeof command.configurationKey !== "string" || command.configurationKey.length > 100_000) throw new TypeError("Use the current configuration key.");
  } else throw new TypeError("Unsupported planning operation.");
}

function operationReleaseId(config: KeelStudioAgentDraftOperationConfig): string {
  if (typeof config.releaseId !== "string" || config.releaseId.trim() === "") throw new TypeError(`${config.operation} requires a non-empty releaseId.`);
  return config.releaseId;
}

function operationDraft(config: KeelStudioAgentDraftOperationConfig): KeelStudioAgentReleaseDraft {
  if (config.draft === undefined) throw new TypeError(`${config.operation} requires a draft object.`);
  return validateKeelStudioAgentReleaseDraft(config.draft);
}

/** Execute one explicitly configured, creator-scoped draft operation. */
export async function executeKeelStudioAgentDraftOperation(config: KeelStudioAgentDraftOperationConfig): Promise<KeelStudioAgentDraftOperationResult> {
  if (config === null || typeof config !== "object" || !isDraftOperation(config.operation)) throw new TypeError("Studio agent draft operation is unsupported.");
  const supported = new Set(["studioUrl", "grantToken", "operation", "releaseId", "projectId", "draft", "expectedRevision", "planningCommand", "defaultsCommand", "profileCommand", "profileSelection", "conversationCommand", "includeReadCall", "operationId", "transactionHashes", "recoveryInput", "fetchImplementation"]);
  for (const key of Object.keys(config)) if (!supported.has(key)) throw new TypeError(`Studio agent draft configuration.${key} is not supported.`);
  const client = createKeelStudioAgentDraftClient(config);
  switch (config.operation) {
    case "list": return client.list();
    case "read": return client.read(operationReleaseId(config));
    case "recover": return client.recover(operationReleaseId(config), config.operationId!, config.transactionHashes ?? []);
    case "recover-wallet-rejection": {
      if (!config.recoveryInput) throw new TypeError("recover-wallet-rejection requires the diagnostic recoveryInput and an explicitly confirmed typed wallet rejection.");
      return client.recoverWalletRejection(operationReleaseId(config), config.recoveryInput);
    }
    case "continue-publication": return client.continuePublication(operationReleaseId(config), config.expectedRevision!);
    case "cancel-review": return client.cancelReview(operationReleaseId(config), config.expectedRevision!, config.operationId!);
    case "storage-recovery": return client.storageRecovery(config.projectId!);
    case "diagnose": return client.diagnose(operationReleaseId(config), config.includeReadCall === undefined ? {} : { includeReadCall: config.includeReadCall });
    case "plan": return client.plan(operationReleaseId(config));
    case "conversation": return client.conversation(operationReleaseId(config));
    case "conversation-suggest": {
      if (!config.conversationCommand) throw new TypeError("conversation-suggest requires a typed suggestion and conversations:write permission.");
      return client.suggest(operationReleaseId(config), config.conversationCommand);
    }
    case "profiles": return client.profiles();
    case "profiles-edit": {
      if (!config.profileCommand) throw new TypeError("profiles-edit requires an explicit profileCommand and preferences:write permission.");
      return client.editProfiles(config.profileCommand);
    }
    case "profile-select": {
      if (!config.profileSelection || Object.keys(config.profileSelection).some(key => !["profileId", "expectedProfileRevision"].includes(key))) throw new TypeError("profile-select needs the exact profile identity.");
      return client.selectProfile(config.profileSelection.profileId, config.profileSelection.expectedProfileRevision);
    }
    case "defaults": return client.defaults();
    case "defaults-edit": {
      if (!config.defaultsCommand) throw new TypeError("defaults-edit requires an explicit defaultsCommand and preferences:write permission.");
      return client.editDefaults(config.defaultsCommand);
    }
    case "prepare-review": return client.prepareReview(operationReleaseId(config), config.expectedRevision!);
    case "storage-review": {
      if (!config.projectId) throw new TypeError("storage-review requires the creator's projectId.");
      return client.storageReview(config.projectId);
    }
    case "plan-edit": {
      if (!config.planningCommand) throw new TypeError("plan-edit requires a typed planningCommand.");
      return client.editPlan(operationReleaseId(config), config.planningCommand);
    }
    case "create": return client.create(operationDraft(config));
    case "update": return client.update(operationReleaseId(config), operationDraft(config), config.expectedRevision!);
  }
}
