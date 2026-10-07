import { canonicalJson, createIntegrity } from "@keel/protocol";

/** Shared planning data only. A resolved plan never grants signing or spending authority. */
export const KEEL_STUDIO_PLAN_SCHEMA = "keel-studio-plan@1" as const;
export type KeelPlanValue = string | number | boolean | readonly string[];
export type KeelPlanAnswers = Readonly<Record<string, KeelPlanValue>>;
export type KeelStudioPlanningCommand = { readonly commandId: string; readonly expectedRevision: number } & (
  | { readonly operation: "answer"; readonly answers: Readonly<Record<string, KeelPlanValue | null>>; readonly advance?: boolean }
  | { readonly operation: "navigate"; readonly fieldId: string }
  | { readonly operation: "mode"; readonly mode: "guided" | "direct" }
  | { readonly operation: "review"; readonly configurationKey: string }
);
export type KeelPlanPredicate =
  | { readonly constant: boolean }
  | { readonly field: string; readonly equals: KeelPlanValue }
  | { readonly field: string; readonly oneOf: readonly KeelPlanValue[] }
  | { readonly all: readonly KeelPlanPredicate[] }
  | { readonly any: readonly KeelPlanPredicate[] }
  | { readonly not: KeelPlanPredicate };
export interface KeelPlanChoice {
  readonly value: string;
  readonly label: string;
  readonly status: "available" | "configuration-required" | "unsupported";
  readonly explanation?: string;
}
export interface KeelPlanField {
  readonly id: string;
  readonly label: string;
  readonly explanation?: string;
  readonly kind: "text" | "integer" | "boolean" | "choice" | "multi-choice" | "address" | "amount" | "timestamp";
  readonly choices?: readonly KeelPlanChoice[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly required: boolean;
  readonly when?: KeelPlanPredicate;
  readonly dependencies?: readonly string[];
  readonly advanced?: boolean;
  readonly allowDefault?: boolean;
  readonly defaultKey?: string;
  readonly defaultMediaType?: string;
  readonly recommendation?: KeelPlanValue;
}
export interface KeelPlanMatrix {
  readonly schema: "keel-studio-plan-matrix@1";
  /** Include the selected network, registered capabilities, and their revision in this identity. */
  readonly capabilityRevision: string;
  readonly fields: readonly KeelPlanField[];
}
export interface KeelPlanResource {
  readonly id: string;
  readonly mediaType: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly source: { readonly kind: "local"; readonly path: string }
    | { readonly kind: "onchain"; readonly chainId: number; readonly store: string; readonly objectId: string; readonly revision?: number };
}
export interface KeelPlanDefaults {
  readonly revision: string;
  readonly global?: KeelPlanAnswers;
  readonly byMedia?: Readonly<Record<string, KeelPlanAnswers>>;
  readonly project?: KeelPlanAnswers;
}
export interface KeelStudioPlan {
  readonly schema: typeof KEEL_STUDIO_PLAN_SCHEMA;
  readonly id: string;
  readonly projectId: string;
  readonly revision: number;
  readonly mode: "guided" | "direct";
  readonly mediaType: string;
  readonly resources: readonly KeelPlanResource[];
  readonly answers: KeelPlanAnswers;
  readonly answerContexts?: Readonly<Record<string, string>>;
  readonly retiredAnswers?: KeelPlanAnswers;
  readonly retainedAnswers?: Readonly<Record<string, readonly { readonly contextKey: string; readonly value: KeelPlanValue }[]>>;
  /** Pinned snapshot. Saving new preferences does not rewrite other active drafts. */
  readonly defaults: KeelPlanDefaults;
  readonly currentFieldId?: string;
  readonly reviewedConfiguration?: string;
}
export interface KeelPlanIssue { readonly field: string; readonly message: string; readonly kind: "missing" | "invalid" | "unavailable"; }
export interface KeelResolvedPlan {
  readonly status: "needs-input" | "blocked" | "ready-for-review";
  readonly activeFields: readonly KeelPlanField[];
  readonly answers: KeelPlanAnswers;
  readonly inactiveAnswers: KeelPlanAnswers;
  readonly defaultedFields: readonly string[];
  readonly issues: readonly KeelPlanIssue[];
  readonly nextQuestion?: KeelPlanField;
  readonly configurationKey: string;
  readonly reviewed: boolean;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function predicateFields(predicate: KeelPlanPredicate): string[] {
  if ("constant" in predicate) return [];
  if ("field" in predicate) return [predicate.field];
  if ("not" in predicate) return predicateFields(predicate.not);
  return ("all" in predicate ? predicate.all : predicate.any).flatMap(predicateFields);
}
function matches(predicate: KeelPlanPredicate, answers: KeelPlanAnswers): boolean {
  if ("constant" in predicate) return predicate.constant;
  if ("field" in predicate) {
    if (!Object.hasOwn(answers, predicate.field)) return false;
    return "equals" in predicate ? same(answers[predicate.field], predicate.equals) : predicate.oneOf.some(value => same(value, answers[predicate.field]));
  }
  if ("not" in predicate) return !matches(predicate.not, answers);
  return "all" in predicate ? predicate.all.every(condition => matches(condition, answers)) : predicate.any.some(condition => matches(condition, answers));
}

/** Validate and topologically order the matrix once; arbitrary callbacks are never executed. */
export function compileKeelPlanMatrix(matrix: KeelPlanMatrix): readonly KeelPlanField[] {
  if (matrix.schema !== "keel-studio-plan-matrix@1" || !matrix.capabilityRevision || matrix.fields.length > 512) throw new TypeError("Invalid planning capability matrix.");
  const fields = new Map(matrix.fields.map(field => [field.id, field]));
  if (fields.size !== matrix.fields.length) throw new TypeError("Planning field IDs must be unique.");
  const visited = new Set<string>(), visiting = new Set<string>(), ordered: KeelPlanField[] = [];
  function visit(id: string) {
    if (visited.has(id)) return;
    const field = fields.get(id);
    if (!field) throw new TypeError(`Unknown planning dependency: ${id}.`);
    if (visiting.has(id)) throw new TypeError(`Planning dependency cycle at ${id}.`);
    if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$/u.test(field.id) || !field.label.trim()) throw new TypeError("Invalid planning question.");
    if ((field.kind === "choice" || field.kind === "multi-choice") && !field.choices) throw new TypeError(`Missing capability choices for ${id}.`);
    if (field.choices && new Set(field.choices.map(choice => choice.value)).size !== field.choices.length) throw new TypeError(`Duplicate capability choice for ${id}.`);
    visiting.add(id);
    for (const dependency of new Set([...(field.dependencies ?? []), ...(field.when ? predicateFields(field.when) : [])])) visit(dependency);
    visiting.delete(id); visited.add(id); ordered.push(field);
  }
  for (const field of matrix.fields) visit(field.id);
  return Object.freeze(ordered);
}

function invalidValue(field: KeelPlanField, value: KeelPlanValue): KeelPlanIssue | undefined {
  const invalid = (message: string): KeelPlanIssue => ({ field: field.id, kind: "invalid", message });
  if (field.kind === "boolean") return typeof value === "boolean" ? undefined : invalid("Choose yes or no.");
  if (field.kind === "integer") return typeof value === "number" && Number.isSafeInteger(value)
    && value >= (field.minimum ?? 0) && value <= (field.maximum ?? Number.MAX_SAFE_INTEGER) ? undefined : invalid("Enter a whole number within the allowed range.");
  if (field.kind === "choice" || field.kind === "multi-choice") {
    const values = field.kind === "choice" ? (typeof value === "string" ? [value] : undefined) : (Array.isArray(value) ? value : undefined);
    if (!values || values.length === 0 || new Set(values).size !== values.length || values.some(item => typeof item !== "string")) return invalid("Choose an available option.");
    for (const item of values) {
      const choice = field.choices?.find(candidate => candidate.value === item);
      if (!choice) return invalid("This option is not offered by the selected capability.");
      if (choice.status !== "available") return { field: field.id, kind: "unavailable", message: choice.explanation ?? `${choice.label} is not available for this configuration.` };
    }
    return undefined;
  }
  if (typeof value !== "string" || value.length > (field.maximum ?? 2000) || /[\u0000-\u001f\u007f]/u.test(value)) return invalid("Enter bounded text without control characters.");
  if (field.required && value.trim() === "") return invalid("This answer is required.");
  if (field.kind === "address" && !/^0x[0-9a-f]{40}$/iu.test(value)) return invalid("Enter an address on the selected network.");
  if (field.kind === "amount" && !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/u.test(value)) return invalid("Enter a non-negative amount without rounding.");
  if (field.kind === "timestamp" && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value)))) return invalid("Choose a date and time with its timezone.");
  return undefined;
}

function validatePlan(plan: KeelStudioPlan) {
  if (plan.schema !== KEEL_STUDIO_PLAN_SCHEMA || !plan.id || !plan.projectId || !Number.isSafeInteger(plan.revision) || plan.revision < 1) throw new TypeError("Invalid resumable plan identity.");
  if (!["guided", "direct"].includes(plan.mode)) throw new TypeError("Invalid project planning mode.");
  if (plan.resources.length > 256 || Object.keys(plan.answers).length > 512) throw new RangeError("This plan exceeds the supported resource or answer count.");
  const ids = new Set<string>();
  for (const resource of plan.resources) {
    if (ids.has(resource.id) || !resource.id || resource.id.length > 512 || !/^(?:0x|sha256:)[0-9a-f]{64}$/iu.test(resource.digest) || !Number.isSafeInteger(resource.byteLength) || resource.byteLength < 0) throw new TypeError("Resources need unique IDs and exact byte commitments.");
    ids.add(resource.id);
    if (resource.source.kind === "onchain" && (!Number.isSafeInteger(resource.source.chainId) || resource.source.chainId < 1
      || !/^0x[0-9a-f]{40}$/iu.test(resource.source.store) || !/^0x[0-9a-f]{64}$/iu.test(resource.source.objectId))) throw new TypeError("Existing storage needs its exact chain, store, and object ID.");
  }
}

function dependencyKey(field: KeelPlanField, answers: KeelPlanAnswers): string {
  const dependencies = [...new Set([...(field.dependencies ?? []), ...(field.when ? predicateFields(field.when) : [])])].sort();
  return canonicalJson(Object.fromEntries(dependencies.map(id => [id, answers[id] ?? null])));
}
function snapshotValue(value: KeelPlanValue): KeelPlanValue {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

/** Both UI and MCP render this exact resolution. Direct mode never bypasses validation. */
export function resolveKeelStudioPlan(matrix: KeelPlanMatrix, plan: KeelStudioPlan): KeelResolvedPlan {
  validatePlan(plan);
  const ordered = compileKeelPlanMatrix(matrix);
  const known = new Set(ordered.map(field => field.id));
  for (const key of Object.keys(plan.answers)) if (!known.has(key)) throw new TypeError(`Unknown planning answer: ${key}.`);
  const answers: Record<string, KeelPlanValue> = {}, inactive: Record<string, KeelPlanValue> = {};
  const active: KeelPlanField[] = [], defaulted: string[] = [], issues: KeelPlanIssue[] = [];
  for (const field of ordered) {
    const defaults = { ...plan.defaults.global, ...plan.defaults.byMedia?.[field.defaultMediaType ?? plan.mediaType], ...plan.defaults.project };
    const defaultKey = field.defaultKey ?? field.id;
    if (field.when && !matches(field.when, answers)) { if (Object.hasOwn(plan.answers, field.id)) inactive[field.id] = plan.answers[field.id]!; continue; }
    active.push(field);
    let value = plan.answers[field.id];
    const contextKey = dependencyKey(field, answers);
    if (value !== undefined && plan.answerContexts?.[field.id] !== undefined && plan.answerContexts[field.id] !== contextKey) {
      inactive[field.id] = value;
      value = plan.retainedAnswers?.[field.id]?.find(candidate => candidate.contextKey === contextKey)?.value;
    }
    if (value === undefined && field.allowDefault && Object.hasOwn(defaults, defaultKey)) {
      const proposed = defaults[defaultKey]!;
      // Invalid defaults reopen the question instead of silently overriding it.
      if (!invalidValue(field, proposed)) { value = proposed; defaulted.push(field.id); }
    }
    if (value === undefined) { if (field.required) issues.push({ field: field.id, kind: "missing", message: field.label }); continue; }
    const issue = invalidValue(field, value);
    if (issue) { issues.push(issue); continue; }
    answers[field.id] = snapshotValue(value);
  }
  const configurationKey = canonicalJson({ schema: matrix.schema, capabilityRevision: matrix.capabilityRevision,
    projectId: plan.projectId, mediaType: plan.mediaType, resources: plan.resources, answers });
  const next = issues[0] && active.find(field => field.id === issues[0]!.field);
  return Object.freeze({ status: issues.some(issue => issue.kind === "unavailable") ? "blocked" : issues.length ? "needs-input" : "ready-for-review",
    activeFields: Object.freeze(active), answers: Object.freeze(answers), inactiveAnswers: Object.freeze(inactive), defaultedFields: Object.freeze(defaulted), issues: Object.freeze(issues),
    ...(next ? { nextQuestion: { ...next, advanced: false } } : {}), configurationKey,
    reviewed: plan.reviewedConfiguration === configurationKey && issues.length === 0, signing: "not-performed", submission: "not-performed" });
}

/** Initialize explicit answers against the current capability/dependency context. */
export function createKeelStudioPlan(matrix: KeelPlanMatrix, input: Omit<KeelStudioPlan, "schema" | "revision" | "answerContexts" | "retainedAnswers" | "retiredAnswers" | "reviewedConfiguration">): KeelStudioPlan {
  const plan: KeelStudioPlan = { ...input, schema: KEEL_STUDIO_PLAN_SCHEMA, revision: 1,
    answers: Object.fromEntries(Object.entries(input.answers).map(([key, value]) => [key, snapshotValue(value)])),
    resources: input.resources.map(resource => ({ ...resource, source: { ...resource.source } })),
    defaults: JSON.parse(JSON.stringify(input.defaults)) as KeelPlanDefaults };
  const resolved = resolveKeelStudioPlan(matrix, plan);
  const fields = new Map(matrix.fields.map(field => [field.id, field]));
  return Object.freeze({ ...plan, answerContexts: Object.fromEntries(Object.keys(plan.answers)
    .map(key => [key, dependencyKey(fields.get(key)!, resolved.answers)])) });
}

/** Optimistic edits keep branch answers for Back, while the resolver excludes inactive data. */
export function answerKeelStudioPlan(matrix: KeelPlanMatrix, plan: KeelStudioPlan, expectedRevision: number, patch: Readonly<Record<string, KeelPlanValue | undefined>>): KeelStudioPlan {
  if (plan.revision !== expectedRevision) throw new Error("This plan changed. Read its current revision before editing.");
  const fields = new Map(matrix.fields.map(field => [field.id, field]));
  const previous = resolveKeelStudioPlan(matrix, plan);
  const contexts: Record<string, string> = { ...plan.answerContexts };
  const retained: Record<string, readonly { readonly contextKey: string; readonly value: KeelPlanValue }[]> = { ...plan.retainedAnswers };
  const answers: Record<string, KeelPlanValue> = { ...plan.answers };
  for (const [key, value] of Object.entries(answers)) {
    const field = fields.get(key)!;
    contexts[key] ??= dependencyKey(field, previous.answers);
    retained[key] = [{ contextKey: contexts[key]!, value: snapshotValue(value) }, ...(retained[key] ?? []).filter(item => item.contextKey !== contexts[key])].slice(0, 8);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!fields.has(key)) throw new TypeError(`Unknown planning answer: ${key}.`);
    delete contexts[key];
    if (value === undefined) { delete answers[key]; delete retained[key]; } else answers[key] = snapshotValue(value);
  }
  const candidate: KeelStudioPlan = { ...plan, revision: plan.revision + 1, answers, answerContexts: contexts, retainedAnswers: retained };
  const resolved = resolveKeelStudioPlan(matrix, candidate);
  for (const key of Object.keys(patch)) if (answers[key] !== undefined) contexts[key] = dependencyKey(fields.get(key)!, resolved.answers);
  const { reviewedConfiguration: _previousReview, ...withoutReview } = candidate;
  return Object.freeze(plan.reviewedConfiguration === resolved.configurationKey ? candidate : withoutReview);
}

/** Explicit schema/capability migration preserves retired answers without forwarding unsupported fields. */
export function migrateKeelStudioPlan(matrix: KeelPlanMatrix, plan: KeelStudioPlan): KeelStudioPlan {
  const known = new Set(compileKeelPlanMatrix(matrix).map(field => field.id));
  const retired: Record<string, KeelPlanValue> = { ...plan.retiredAnswers };
  const answers: Record<string, KeelPlanValue> = {};
  for (const [key, value] of Object.entries(plan.answers)) {
    if (known.has(key)) answers[key] = snapshotValue(value); else retired[key] = snapshotValue(value);
  }
  for (const key of known) if (!Object.hasOwn(answers, key) && Object.hasOwn(retired, key)) {
    answers[key] = snapshotValue(retired[key]!); delete retired[key];
  }
  const { reviewedConfiguration: _previousReview, ...base } = plan;
  const migrated = { ...base, revision: plan.revision + 1, answers, retiredAnswers: retired };
  resolveKeelStudioPlan(matrix, migrated);
  return Object.freeze(migrated);
}

export async function keelStudioPlanFingerprint(matrix: KeelPlanMatrix, plan: KeelStudioPlan): Promise<string> {
  return (await createIntegrity(new TextEncoder().encode(resolveKeelStudioPlan(matrix, plan).configurationKey))).digest;
}

export interface KeelPreflightObservation {
  readonly id: "source-bytes" | "complete-metadata" | "reader-identity" | "reader-simulation" | "authority" | "storage-quote" | "availability";
  readonly status: "passed" | "failed" | "unknown";
  readonly explanation: string;
}
export interface KeelPublicationPreflight {
  readonly schema: "keel-publication-preflight@1";
  readonly planFingerprint: string;
  readonly chainId: number;
  readonly readerIdentity: string;
  readonly checkedAt: string;
  readonly expiresAt: string;
  readonly observations: readonly KeelPreflightObservation[];
}

/** Server entrypoints must load their own retained evidence, never a caller's passed=true flag. */
export function assessKeelPublicationPreflight(input: {
  readonly fingerprint: string;
  readonly chainId: number;
  readonly readerIdentity: string;
  readonly required: readonly KeelPreflightObservation["id"][];
  readonly evidence?: KeelPublicationPreflight;
  readonly now: number;
}) {
  const evidence = input.evidence;
  if (!evidence || evidence.schema !== "keel-publication-preflight@1") return { ready: false as const, reason: "missing-preflight" as const };
  if (evidence.planFingerprint !== input.fingerprint || evidence.chainId !== input.chainId || evidence.readerIdentity !== input.readerIdentity) return { ready: false as const, reason: "configuration-changed" as const };
  if (!Number.isFinite(input.now) || !Number.isFinite(Date.parse(evidence.checkedAt)) || !Number.isFinite(Date.parse(evidence.expiresAt))
    || Date.parse(evidence.checkedAt) > input.now || Date.parse(evidence.expiresAt) <= input.now || Date.parse(evidence.expiresAt) <= Date.parse(evidence.checkedAt)) return { ready: false as const, reason: "expired-preflight" as const };
  const checks = new Map(evidence.observations.map(check => [check.id, check]));
  if (checks.size !== evidence.observations.length) return { ready: false as const, reason: "ambiguous-preflight" as const };
  const missing = input.required.filter(id => checks.get(id)?.status !== "passed");
  if (missing.length) return { ready: false as const, reason: "incomplete-preflight" as const, checks: missing };
  return { ready: true as const, reason: "verified-preflight" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

export { buildKeelStudioDecisionMatrix, type KeelStudioPlanningCapabilities, type KeelPlanningRoute } from "./studio-project-decisions.js";
