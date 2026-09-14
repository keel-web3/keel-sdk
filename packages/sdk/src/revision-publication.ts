import type { Integrity } from "@keel/protocol";

export const KEEL_GRAPH_REVISION_PLAN_PROTOCOL = "keel-graph-revision-plan@1" as const;
export const KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES = 64 * 1024;
export const KEEL_GRAPH_REVISION_MAX_RESOURCES = 128;

export type KeelGraphRevisionKind =
  | "module-revision"
  | "entrypoint-revision"
  | "asset-revision"
  | "shell-revision";

export type KeelGraphRevisionBindingMode = "follow-latest" | "pinned";

export type KeelGraphRevisionResourceRole =
  | "shell-prefix"
  | "module"
  | "entrypoint"
  | "asset"
  | "shell-suffix";

export type KeelGraphRevisionIntegrity = Integrity & { readonly byteLength: number };

export interface KeelGraphRevisionResource {
  /** Stable logical key used to compare the same file or module across revisions. */
  readonly id: string;
  readonly role: KeelGraphRevisionResourceRole;
  /** Sequential version of this logical resource. */
  readonly version: number;
  /** Exact selected-chain object binding for this resource version. */
  readonly store: `0x${string}`;
  readonly objectId: `0x${string}`;
  readonly mediaType: string;
  /** Integrity of the decoded bytes accepted by the upload planner. */
  readonly integrity: KeelGraphRevisionIntegrity;
  /** Measured bytes placed in immutable storage after the declared codec. */
  readonly storedByteLength: number;
}

export interface KeelGraphRevisionSnapshot {
  readonly chainId: number;
  readonly graphRegistry: `0x${string}`;
  /** Stable KeelGraphRegistry graph ID. */
  readonly graphId: `0x${string}`;
  readonly graphVersion: number;
  readonly resources: readonly KeelGraphRevisionResource[];
}

export interface KeelGraphRevisionInput {
  readonly kind: KeelGraphRevisionKind;
  readonly bindingMode: KeelGraphRevisionBindingMode;
  /** Automatic revision publication accepts exactly one creator-declared changed file. */
  readonly changedResourceIds: readonly [string];
  readonly live: KeelGraphRevisionSnapshot;
  readonly candidate: KeelGraphRevisionSnapshot;
}

export interface KeelGraphRevisionPlan {
  readonly schema: typeof KEEL_GRAPH_REVISION_PLAN_PROTOCOL;
  readonly status: "review-only";
  readonly kind: KeelGraphRevisionKind;
  readonly bindingMode: KeelGraphRevisionBindingMode;
  readonly graph: {
    readonly chainId: number;
    readonly graphRegistry: `0x${string}`;
    readonly graphId: `0x${string}`;
    readonly fromVersion: number;
    readonly toVersion: number;
  };
  readonly changedResources: readonly [KeelGraphRevisionResource];
  readonly reusedResources: readonly KeelGraphRevisionResource[];
  readonly bytes: {
    readonly newDecodedBytes: number;
    readonly newStoredBytes: number;
    readonly replacedDecodedBytes: number;
    readonly replacedStoredBytes: number;
    readonly reusedDecodedBytes: number;
    readonly reusedStoredBytes: number;
    readonly candidateDecodedBytes: number;
    readonly candidateStoredBytes: number;
    readonly newStoredPercent: number;
    readonly reusedStoredPercent: number;
    readonly avoidedRepublishBytes: number;
  };
  readonly publication: {
    readonly scope: "one-declared-resource-only";
    readonly reusePolicy: "mandatory";
    readonly graphAction: "publish-next-version-then-activate";
    readonly tokenPresentationAction: "none-follow-latest" | "update-binding-only";
  };
  readonly automaticGate: {
    readonly status: "passed";
    readonly maximumNewStoredBytes: typeof KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES;
  };
  readonly walletApproval: "eligible-after-exact-byte-plan-and-simulation";
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

export interface KeelGraphRevisionUploadSource {
  readonly chainId: number;
  readonly store: `0x${string}`;
  readonly mediaType: string;
  readonly integrity: Integrity;
  readonly storedByteLength: number;
}

const BYTES32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const LOGICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
const MAX_RESOURCE_BYTES = 268_435_456;
const ROLES = new Set<KeelGraphRevisionResourceRole>(["shell-prefix", "module", "entrypoint", "asset", "shell-suffix"]);
const KINDS = new Set<KeelGraphRevisionKind>(["module-revision", "entrypoint-revision", "asset-revision", "shell-revision"]);

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  for (const key of Object.keys(input)) if (!fields.has(key)) throw new TypeError(`${label}.${key} is not supported.`);
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function resourceIntegrity(value: unknown, label: string): KeelGraphRevisionIntegrity {
  const input = object(value, label);
  exact(input, ["algorithm", "digest", "byteLength"], label);
  if (input.algorithm !== "sha256" || typeof input.digest !== "string" || !BYTES32.test(input.digest)) {
    throw new TypeError(`${label} must be lower-case SHA-256.`);
  }
  return Object.freeze({
    algorithm: "sha256" as const,
    digest: input.digest as `0x${string}`,
    byteLength: positiveInteger(input.byteLength, `${label}.byteLength`, MAX_RESOURCE_BYTES),
  });
}

function resource(value: unknown, index: number): KeelGraphRevisionResource {
  const label = `revision resource ${index}`;
  const input = object(value, label);
  exact(input, ["id", "role", "version", "store", "objectId", "mediaType", "integrity", "storedByteLength"], label);
  if (typeof input.id !== "string" || !LOGICAL_ID.test(input.id)) throw new TypeError(`${label}.id is invalid.`);
  if (typeof input.role !== "string" || !ROLES.has(input.role as KeelGraphRevisionResourceRole)) throw new TypeError(`${label}.role is invalid.`);
  if (typeof input.store !== "string" || !ADDRESS.test(input.store)) throw new TypeError(`${label}.store must be a lower-case address.`);
  if (typeof input.objectId !== "string" || !BYTES32.test(input.objectId)) throw new TypeError(`${label}.objectId must be lower-case bytes32.`);
  if (typeof input.mediaType !== "string" || input.mediaType.length > 128 || !MEDIA_TYPE.test(input.mediaType)) throw new TypeError(`${label}.mediaType is invalid.`);
  return Object.freeze({
    id: input.id,
    role: input.role as KeelGraphRevisionResourceRole,
    version: positiveInteger(input.version, `${label}.version`),
    store: input.store as `0x${string}`,
    objectId: input.objectId as `0x${string}`,
    mediaType: input.mediaType,
    integrity: resourceIntegrity(input.integrity, `${label}.integrity`),
    storedByteLength: positiveInteger(input.storedByteLength, `${label}.storedByteLength`, MAX_RESOURCE_BYTES),
  });
}

function snapshot(value: unknown, label: string): KeelGraphRevisionSnapshot {
  const input = object(value, label);
  exact(input, ["chainId", "graphRegistry", "graphId", "graphVersion", "resources"], label);
  if (typeof input.graphRegistry !== "string" || !ADDRESS.test(input.graphRegistry)) throw new TypeError(`${label}.graphRegistry must be a lower-case address.`);
  if (typeof input.graphId !== "string" || !BYTES32.test(input.graphId)) throw new TypeError(`${label}.graphId must be lower-case bytes32.`);
  if (!Array.isArray(input.resources) || input.resources.length < 1 || input.resources.length > KEEL_GRAPH_REVISION_MAX_RESOURCES) {
    throw new RangeError(`${label}.resources must contain 1 through ${KEEL_GRAPH_REVISION_MAX_RESOURCES} resources.`);
  }
  const resources = input.resources.map((item, index) => resource(item, index));
  const ids = new Set<string>();
  for (const item of resources) {
    if (ids.has(item.id)) throw new TypeError(`${label}.resources contains duplicate id ${item.id}.`);
    ids.add(item.id);
  }
  return Object.freeze({
    chainId: positiveInteger(input.chainId, `${label}.chainId`),
    graphRegistry: input.graphRegistry as `0x${string}`,
    graphId: input.graphId as `0x${string}`,
    graphVersion: positiveInteger(input.graphVersion, `${label}.graphVersion`),
    resources: Object.freeze(resources),
  });
}

function sameIntegrity(left: Integrity, right: Integrity): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest && left.byteLength === right.byteLength;
}

function sameResource(left: KeelGraphRevisionResource, right: KeelGraphRevisionResource): boolean {
  return left.id === right.id
    && left.role === right.role
    && left.version === right.version
    && left.store === right.store
    && left.objectId === right.objectId
    && left.mediaType === right.mediaType
    && sameIntegrity(left.integrity, right.integrity)
    && left.storedByteLength === right.storedByteLength;
}

function allowedRoles(kind: KeelGraphRevisionKind): ReadonlySet<KeelGraphRevisionResourceRole> {
  if (kind === "module-revision") return new Set(["module"]);
  if (kind === "entrypoint-revision") return new Set(["entrypoint"]);
  if (kind === "asset-revision") return new Set(["asset"]);
  return new Set(["shell-prefix", "shell-suffix"]);
}

function sum(resources: readonly KeelGraphRevisionResource[], field: "decoded" | "stored"): number {
  return resources.reduce((total, item) => total + (field === "decoded" ? item.integrity.byteLength : item.storedByteLength), 0);
}

/**
 * Hard automatic-update gate. It compares the live selected-chain graph with
 * the candidate graph and refuses any undeclared resource change or republish.
 * New work uses the ordinary publication planner; this function is only for
 * the next version of an existing graph.
 */
export function planKeelGraphRevision(value: unknown): KeelGraphRevisionPlan {
  const input = object(value, "graph revision input");
  exact(input, ["kind", "bindingMode", "changedResourceIds", "live", "candidate"], "graph revision input");
  if (typeof input.kind !== "string" || !KINDS.has(input.kind as KeelGraphRevisionKind)) throw new TypeError("graph revision input.kind is invalid.");
  if (input.bindingMode !== "follow-latest" && input.bindingMode !== "pinned") throw new TypeError("graph revision input.bindingMode is invalid.");
  if (!Array.isArray(input.changedResourceIds) || input.changedResourceIds.length !== 1 || typeof input.changedResourceIds[0] !== "string" || !LOGICAL_ID.test(input.changedResourceIds[0])) {
    throw new TypeError("Automatic revision publication requires exactly one declared changedResourceId.");
  }
  const changedId = input.changedResourceIds[0] as string;
  const live = snapshot(input.live, "live graph");
  const candidate = snapshot(input.candidate, "candidate graph");
  if (candidate.chainId !== live.chainId || candidate.graphRegistry !== live.graphRegistry) {
    throw new TypeError("A graph revision cannot switch chain or graph registry.");
  }
  if (candidate.graphId !== live.graphId) throw new TypeError("A graph revision cannot switch graphId.");
  if (live.graphVersion === Number.MAX_SAFE_INTEGER || candidate.graphVersion !== live.graphVersion + 1) {
    throw new TypeError("The candidate graph must be the next sequential graph version.");
  }
  if (candidate.resources.length !== live.resources.length) {
    throw new TypeError("Automatic revision publication cannot add or remove resources; use an explicit full-graph review.");
  }

  const liveById = new Map(live.resources.map((item) => [item.id, item] as const));
  const candidateById = new Map(candidate.resources.map((item) => [item.id, item] as const));
  if (!liveById.has(changedId) || !candidateById.has(changedId)) throw new TypeError(`Declared changed resource ${changedId} is missing from the live or candidate graph.`);
  for (const id of liveById.keys()) {
    if (!candidateById.has(id)) throw new TypeError("Automatic revision publication cannot rename resources; use an explicit full-graph review.");
  }

  const actualChanges: string[] = [];
  const reused: KeelGraphRevisionResource[] = [];
  for (const [id, before] of liveById) {
    const after = candidateById.get(id) as KeelGraphRevisionResource;
    if (before.role !== after.role || before.mediaType !== after.mediaType || before.store !== after.store) {
      throw new TypeError(`Resource ${id} changes role, media type, or selected-chain store; automatic revisions cannot reinterpret or move a resource.`);
    }
    if (sameResource(before, after)) reused.push(after);
    else actualChanges.push(id);
  }
  if (actualChanges.length !== 1 || actualChanges[0] !== changedId) {
    const description = actualChanges.length === 0 ? "no resources" : actualChanges.join(", ");
    throw new TypeError(`Declared revision changes ${changedId}, but the graph changes ${description}. Unrelated resources must reuse their live object IDs and commitments.`);
  }

  const before = liveById.get(changedId) as KeelGraphRevisionResource;
  const changed = candidateById.get(changedId) as KeelGraphRevisionResource;
  if (!allowedRoles(input.kind as KeelGraphRevisionKind).has(changed.role)) {
    throw new TypeError(`${input.kind} cannot change a ${changed.role} resource.`);
  }
  if (before.version === Number.MAX_SAFE_INTEGER || changed.version !== before.version + 1) {
    throw new TypeError(`Changed resource ${changedId} must advance exactly one version.`);
  }
  if (sameIntegrity(before.integrity, changed.integrity)) {
    throw new TypeError(`Changed resource ${changedId} has identical bytes; republishing it is blocked.`);
  }
  if (before.objectId === changed.objectId) {
    throw new TypeError(`Changed resource ${changedId} must bind a new immutable content object ID.`);
  }
  if (before.objectId !== changed.objectId && before.integrity.digest === changed.integrity.digest) {
    throw new TypeError(`Changed resource ${changedId} points identical bytes at a new object; redundant storage is blocked.`);
  }
  if (changed.storedByteLength > KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES) {
    throw new RangeError(`Automatic revision ${changedId} is ${changed.storedByteLength} stored bytes, above the ${KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES}-byte safety limit. A full-graph wallet plan is blocked; use explicit large-resource review.`);
  }

  const reusedDecodedBytes = sum(reused, "decoded");
  const reusedStoredBytes = sum(reused, "stored");
  const candidateDecodedBytes = reusedDecodedBytes + changed.integrity.byteLength;
  const candidateStoredBytes = reusedStoredBytes + changed.storedByteLength;
  const newStoredPercent = (changed.storedByteLength / candidateStoredBytes) * 100;

  return Object.freeze({
    schema: KEEL_GRAPH_REVISION_PLAN_PROTOCOL,
    status: "review-only" as const,
    kind: input.kind as KeelGraphRevisionKind,
    bindingMode: input.bindingMode as KeelGraphRevisionBindingMode,
    graph: Object.freeze({ chainId: live.chainId, graphRegistry: live.graphRegistry, graphId: live.graphId, fromVersion: live.graphVersion, toVersion: candidate.graphVersion }),
    changedResources: Object.freeze([changed]) as readonly [KeelGraphRevisionResource],
    reusedResources: Object.freeze(reused),
    bytes: Object.freeze({
      newDecodedBytes: changed.integrity.byteLength,
      newStoredBytes: changed.storedByteLength,
      replacedDecodedBytes: before.integrity.byteLength,
      replacedStoredBytes: before.storedByteLength,
      reusedDecodedBytes,
      reusedStoredBytes,
      candidateDecodedBytes,
      candidateStoredBytes,
      newStoredPercent,
      reusedStoredPercent: 100 - newStoredPercent,
      avoidedRepublishBytes: reusedStoredBytes,
    }),
    publication: Object.freeze({
      scope: "one-declared-resource-only" as const,
      reusePolicy: "mandatory" as const,
      graphAction: "publish-next-version-then-activate" as const,
      tokenPresentationAction: input.bindingMode === "follow-latest" ? "none-follow-latest" as const : "update-binding-only" as const,
    }),
    automaticGate: Object.freeze({ status: "passed" as const, maximumNewStoredBytes: KEEL_AUTOMATIC_REVISION_MAX_STORED_BYTES }),
    walletApproval: "eligible-after-exact-byte-plan-and-simulation" as const,
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  });
}

/** Bind the only uploaded source to the only resource accepted by the gate. */
export function assertKeelRevisionUploadMatchesPlan(
  plan: KeelGraphRevisionPlan,
  source: KeelGraphRevisionUploadSource,
): KeelGraphRevisionResource {
  if (plan.schema !== KEEL_GRAPH_REVISION_PLAN_PROTOCOL || plan.status !== "review-only" || plan.changedResources.length !== 1) {
    throw new TypeError("A valid KEEL graph revision plan is required.");
  }
  if (
    !Number.isSafeInteger(source.chainId) || source.chainId < 1
    || typeof source.store !== "string" || !ADDRESS.test(source.store.toLowerCase())
    || typeof source.mediaType !== "string"
    || !Number.isSafeInteger(source.storedByteLength) || source.storedByteLength < 1
  ) {
    throw new TypeError("A valid measured revision upload source is required.");
  }
  const changed = plan.changedResources[0];
  if (
    source.chainId !== plan.graph.chainId
    || source.store.toLowerCase() !== changed.store
    || source.mediaType !== changed.mediaType
    || !sameIntegrity(source.integrity, changed.integrity)
    || source.storedByteLength !== changed.storedByteLength
  ) {
    throw new TypeError(`The upload source does not match the only permitted changed resource ${changed.id}.`);
  }
  return changed;
}
