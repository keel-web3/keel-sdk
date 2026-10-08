import { assertKeelCollectionDefaultsUnambiguous, keelCollectionDefaultFilterKey, parseKeelCollectionDefaultFilter, resolveKeelCollectionDefaultValues, type KeelCollectionDefaultContext, type KeelCollectionDefaultFilter, type KeelCollectionDefaults } from "./studio-default-filters.js";
export * from "./studio-default-filters.js";
import { keelProjectProfileAnswers, parseKeelProjectProfileSnapshot, parseKeelNamedProjectProfile, type KeelProjectProfileSnapshot, type KeelNamedProjectProfile } from "./studio-project-profiles.js";
import { KEEL_DEFAULT_RPC_READ_CONCURRENCY } from "./rpc-read-manifest.js";
import { compileKeelPlanMatrix, validateKeelPlanValue, type KeelPlanAnswers, type KeelPlanDefaults, type KeelPlanMatrix, type KeelPlanValue } from "./studio-project-planner.js";

export interface KeelStudioDefaultProfile {
  readonly schema: "keel-studio-default-profile@1";
  readonly revision: number;
  readonly askToSave: boolean;
  readonly global: KeelPlanAnswers;
  readonly byMedia: Readonly<Record<string, KeelPlanAnswers>>;
  readonly collectionFilters?: readonly KeelCollectionDefaults[];
  readonly namedProfiles?: readonly KeelNamedProjectProfile[];
}
export type KeelStudioDefaultScope = { readonly kind: "global" } | { readonly kind: "media"; readonly mediaType: string } | { readonly kind: "collection"; readonly filter: KeelCollectionDefaultFilter };
const mediaPattern = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,95}$/u;
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$/u;
const copyValue = (value: KeelPlanValue): KeelPlanValue => Array.isArray(value) ? Object.freeze([...value]) : value;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Saved defaults must be a plain record.");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError("Saved defaults cannot contain class instances.");
  return value as Record<string, unknown>;
}
function answers(value: unknown): KeelPlanAnswers {
  const entries = Object.entries(object(value));
  if (entries.length > 128) throw new RangeError("Too many saved settings.");
  return Object.freeze(Object.fromEntries(entries.map(([key, item]) => {
    if (!keyPattern.test(key)) throw new TypeError("Invalid saved setting identifier.");
    if (typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return [key, item];
    if (typeof item === "string" && item.length <= 8_000 && !/[\u0000-\u001f\u007f]/u.test(item)) return [key, item];
    if (Array.isArray(item) && item.length <= 256 && item.every((entry): entry is string => typeof entry === "string" && entry.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(entry))) return [key, Object.freeze([...item])];
    throw new TypeError("A saved setting has an unsupported value.");
  })));
}

function parseCollectionDefaults(value: unknown): readonly KeelCollectionDefaults[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError("Use at most 32 collection-type default filters.");
  const entries = value.map(item => {
    const row = object(item);
    if (Object.keys(row).some(key => key !== "filter" && key !== "values")) throw new TypeError("A collection default contains only its filter and values.");
    return { filter: parseKeelCollectionDefaultFilter(row.filter), values: answers(row.values) };
  });
  assertKeelCollectionDefaultsUnambiguous(entries);
  return Object.freeze(entries);
}

/** Account defaults are explicit choices, never inferred permissions or transaction authority. */
export function createKeelStudioDefaultProfile(): KeelStudioDefaultProfile {
  return Object.freeze({ schema: "keel-studio-default-profile@1", revision: 0, askToSave: false,
    global: Object.freeze({}), byMedia: Object.freeze({}) });
}

export function parseKeelStudioDefaultProfile(value: unknown): KeelStudioDefaultProfile {
  const input = object(value);
  if (Object.keys(input).some(key => !["schema", "revision", "askToSave", "global", "byMedia", "namedProfiles", "collectionFilters"].includes(key))
    || input.schema !== "keel-studio-default-profile@1" || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.askToSave !== "boolean") throw new TypeError("Invalid saved defaults profile.");
  const media = Object.entries(object(input.byMedia));
  if (media.length > 32 || media.some(([key]) => !mediaPattern.test(key))) throw new TypeError("Saved defaults need a bounded set of exact media types.");
  if (input.namedProfiles !== undefined && (!Array.isArray(input.namedProfiles) || input.namedProfiles.length > 24)) throw new TypeError("Use a bounded named profile collection.");
  const namedProfiles = input.namedProfiles === undefined ? undefined : (input.namedProfiles as unknown[]).map(parseKeelNamedProjectProfile);
  if (namedProfiles && new Set(namedProfiles.map(profile => profile.id)).size !== namedProfiles.length) throw new TypeError("Named profile IDs must be unique.");
  const collectionFilters = input.collectionFilters === undefined ? undefined : parseCollectionDefaults(input.collectionFilters);
  const profile = { schema: "keel-studio-default-profile@1" as const, revision: Number(input.revision), askToSave: input.askToSave,
    ...(namedProfiles ? { namedProfiles } : {}), ...(collectionFilters ? { collectionFilters } : {}), global: answers(input.global), byMedia: Object.freeze(Object.fromEntries(media.map(([key, item]) => [key, answers(item)]))) };
  if (new TextEncoder().encode(JSON.stringify(profile)).byteLength > 65_536) throw new RangeError("Saved defaults exceed the supported profile size.");
  return Object.freeze(profile);
}

export function updateKeelStudioDefaultProfile(profile: KeelStudioDefaultProfile, matrix: KeelPlanMatrix, command: {
  readonly expectedRevision: number;
  readonly scope: KeelStudioDefaultScope;
  readonly values: Readonly<Record<string, KeelPlanValue | null>>;
  readonly askToSave?: boolean;
}): KeelStudioDefaultProfile {
  const current = parseKeelStudioDefaultProfile(profile);
  if (command.expectedRevision !== current.revision) throw new Error("defaults-conflict");
  const scope = checkedScope(command.scope);
  const fields = new Map(compileKeelPlanMatrix(matrix).map(field => [field.id, field]));
  const entries = Object.entries(command.values);
  if (entries.length > 16 || !entries.length && command.askToSave === undefined) throw new TypeError("Choose a bounded set of defaults to update.");
  const selected: Record<string, KeelPlanValue> = { ...(scope.kind === "global" ? current.global : scope.kind === "media" ? current.byMedia[scope.mediaType] : current.collectionFilters?.find(entry => keelCollectionDefaultFilterKey(entry.filter) === keelCollectionDefaultFilterKey(scope.filter))?.values) };
  for (const [id, value] of entries) {
    if (scope.kind === "collection" && ["releaseType", "sale", "tokenStandard", "tokenStructure", "saleMethod"].includes(id) && value !== null) throw new TypeError("Collection filters cannot change the token or sale type they match. Choose those in the project or a named profile.");
    const field = fields.get(id);
    const key = field?.defaultKey ?? id;
    if (value === null && Object.hasOwn(selected, key)) { delete selected[key]; continue; }
    if (!field?.allowDefault) throw new TypeError("This setting requires a project-specific answer and cannot become a default.");
    if (value === null) { delete selected[key]; continue; }
    const issue = validateKeelPlanValue(field, value);
    if (issue) throw new TypeError(issue.message);
    selected[key] = copyValue(value);
  }
  const next = scope.kind === "global" ? { ...current, global: selected }
    : scope.kind === "media" ? { ...current, byMedia: { ...current.byMedia, [scope.mediaType]: selected } }
    : { ...current, collectionFilters: [...(current.collectionFilters ?? []).filter(entry => keelCollectionDefaultFilterKey(entry.filter) !== keelCollectionDefaultFilterKey(scope.filter)), ...(Object.keys(selected).length ? [{ filter: scope.filter, values: selected }] : [])] };
  // Empty scopes have no meaning and must not consume the bounded profile capacity.
  const byMedia = Object.fromEntries(Object.entries(next.byMedia).filter(([, settings]) => Object.keys(settings).length > 0));
  return parseKeelStudioDefaultProfile({ ...next, byMedia, revision: current.revision + 1, askToSave: command.askToSave ?? current.askToSave });
}

/** Only applicable, defaultable settings enter a project. Existing plans keep their pinned copy. */
export function pinKeelStudioDefaults(profile: KeelStudioDefaultProfile, matrix: KeelPlanMatrix, mediaType: string, collection?: KeelCollectionDefaultContext): KeelPlanDefaults {
  const current = parseKeelStudioDefaultProfile(profile);
  const fields = compileKeelPlanMatrix(matrix).filter(field => field.allowDefault);
  const selectedMedia = new Set([mediaType, ...fields.flatMap(field => field.defaultMediaType ? [field.defaultMediaType] : [])]);
  const keys = new Set(fields.map(field => field.defaultKey ?? field.id));
  const select = (source: KeelPlanAnswers) => Object.freeze(Object.fromEntries(Object.entries(source).filter(([key]) => keys.has(key)).map(([key, value]) => [key, copyValue(value)])));
  return Object.freeze({ revision: `creator-defaults:${current.revision}`, global: select(current.global),
    byMedia: Object.freeze(Object.fromEntries([...selectedMedia].flatMap(media => {
      const values = { ...current.byMedia[media], ...resolveKeelCollectionDefaultValues(current.collectionFilters, collection, media) };
      return Object.keys(values).length ? [[media, select(values)]] : [];
    }))) });
}

export interface KeelStudioDefaultsCommand {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly scope: KeelStudioDefaultScope;
  readonly values: Readonly<Record<string, KeelPlanValue | null>>;
  readonly askToSave?: boolean;
}
export interface KeelStudioDefaultsView {
  readonly schema: "keel-studio-defaults-view@1";
  readonly profile: KeelStudioDefaultProfile;
  readonly lastAppliedCommand?: { readonly id: string; readonly digest: string; readonly revision: number };
  readonly signing: "not-performed";
}
function checkedScope(value: unknown): KeelStudioDefaultScope {
  const scope = object(value);
  if (scope.kind === "global" && Object.keys(scope).length === 1) return { kind: "global" };
  if (scope.kind === "media" && Object.keys(scope).length === 2 && typeof scope.mediaType === "string" && mediaPattern.test(scope.mediaType)) return { kind: "media", mediaType: scope.mediaType };
  if (scope.kind === "collection" && Object.keys(scope).length === 2 && Object.hasOwn(scope, "filter")) return { kind: "collection", filter: parseKeelCollectionDefaultFilter(scope.filter) };
  throw new TypeError("Choose global defaults, one exact media type, or a bounded collection-type filter.");
}
export function validateKeelStudioDefaultsCommand(value: unknown): KeelStudioDefaultsCommand {
  const input = object(value), scope = object(input.scope), values = object(input.values);
  if (Object.keys(input).some(key => !["commandId", "expectedRevision", "scope", "values", "askToSave"].includes(key))
    || typeof input.commandId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.commandId)
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0
    || input.askToSave !== undefined && typeof input.askToSave !== "boolean"
    || Object.keys(values).length > 16 || !Object.keys(values).length && input.askToSave === undefined
    || Object.keys(values).some(key => !keyPattern.test(key))) throw new TypeError("Use a bounded defaults edit with its current revision and stable command UUID.");
  const selectedScope = checkedScope(scope);
  answers(Object.fromEntries(Object.entries(values).filter(([, item]) => item !== null)));
  return { commandId: input.commandId, expectedRevision: Number(input.expectedRevision),
    scope: selectedScope,
    values: JSON.parse(JSON.stringify(values)) as KeelStudioDefaultsCommand["values"],
    ...(input.askToSave === undefined ? {} : { askToSave: input.askToSave as boolean }) };
}

/** Private copied defaults. Never put this record in an artwork manifest or public metadata. */
export interface KeelSelectedProjectProfile {
  readonly snapshot: KeelProjectProfileSnapshot;
  readonly defaults?: Pick<KeelPlanDefaults, "revision" | "global" | "byMedia"> & { readonly collectionFilters?: readonly KeelCollectionDefaults[] };
}
export function parseKeelSelectedProjectProfile(input: unknown): KeelSelectedProjectProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid selected project profile.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "snapshot" && key !== "defaults")) throw new TypeError("A profile selection cannot carry permissions or wallet actions.");
  const snapshot = parseKeelProjectProfileSnapshot(value.snapshot);
  if (value.defaults === undefined) return { snapshot };
  if (!value.defaults || typeof value.defaults !== "object" || Array.isArray(value.defaults)) throw new TypeError("Invalid copied project defaults.");
  const defaults = value.defaults as Record<string, unknown>;
  if (Object.keys(defaults).some(key => !["revision", "global", "byMedia", "collectionFilters"].includes(key)) || typeof defaults.revision !== "string" || !defaults.revision || defaults.revision.length > 240) throw new TypeError("Use bounded copied project defaults.");
  const parsed = parseKeelStudioDefaultProfile({ schema: "keel-studio-default-profile@1", revision: 0, askToSave: false, global: defaults.global ?? {}, byMedia: defaults.byMedia ?? {}, ...(defaults.collectionFilters === undefined ? {} : { collectionFilters: defaults.collectionFilters }) });
  return { snapshot, defaults: { revision: defaults.revision, global: parsed.global, byMedia: parsed.byMedia, ...(parsed.collectionFilters ? { collectionFilters: parsed.collectionFilters } : {}) } };
}

/** Apply a copied account snapshot only to a new plan; later account changes do not enter it. */
export function pinKeelSelectedProjectDefaults(selection: KeelSelectedProjectProfile, matrix: KeelPlanMatrix, mediaType: string): KeelPlanDefaults {
  const selected = parseKeelSelectedProjectProfile(selection);
  const profile = parseKeelStudioDefaultProfile({ schema: "keel-studio-default-profile@1", revision: 0, askToSave: false, global: selected.defaults?.global ?? {}, byMedia: selected.defaults?.byMedia ?? {}, ...(selected.defaults?.collectionFilters ? { collectionFilters: selected.defaults.collectionFilters } : {}) });
  return { ...pinKeelStudioDefaults(profile, matrix, mediaType, selected.snapshot.configuration), revision: selected.defaults?.revision ?? `named-profile:${selected.snapshot.id}:${selected.snapshot.revision}`, project: keelProjectProfileAnswers(selected.snapshot) };
}

/** Shared private build choices. Contract limits are hard ceilings, never preferences. */
export const KEEL_BUILD_DEFAULT_FIELDS: readonly import("./studio-project-planner.js").KeelPlanField[] = [
  ...(["imageDelivery", "animationDelivery"] as const).map(id => ({ id, label: id === "imageDelivery" ? "Image slot delivery" : "Animation slot delivery", kind: "choice" as const, required: false, allowDefault: true, choices: ["onchain", "ipfs", "hosted"].map(value => ({ value, label: value, status: "available" as const })), explanation: "Saved intent only. External delivery requires a supported route and exact source/read checks; this does not upload, pin, publish or authorize spending." })),
  { id: "rpcMaxConcurrentReads", label: "Parallel native RPC reads", kind: "integer", minimum: 1, maximum: 64, required: false, allowDefault: true, explanation: "Bounded Hybrid carrier reads. This does not change delivery, authorize a provider or set transaction gas." },
  { id: "compression", label: "Lossless compression", kind: "choice", required: false, allowDefault: true, choices: ["auto", "brotli", "none"].map(value => ({ value, label: value, status: "available" as const })) },
  { id: "brotliQuality", label: "Brotli quality", kind: "integer", minimum: 0, maximum: 11, required: false, allowDefault: true },
  { id: "transportProfile", label: "Prepared payload encoding", kind: "choice", required: false, allowDefault: true, choices: ["base90-v1", "base91-v1", "base90-block-v2", "uri81-block-v1"].map(value => ({ value, label: value, status: "available" as const })) },
  { id: "payloadStorage", label: "Payload storage", kind: "choice", required: false, allowDefault: true, choices: ["compact", "raw"].map(value => ({ value, label: value, status: "available" as const })) },
  { id: "maxReadGas", label: "Maximum complete-read gas", kind: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, required: false, allowDefault: true },
  { id: "maxOutputBytes", label: "Maximum complete tokenURI bytes", kind: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, required: false, allowDefault: true },
  { id: "hybridFallback", label: "Allow reviewing Hybrid after an Inline limit", kind: "boolean", required: false, allowDefault: true, explanation: "This preference never approves payment, external uploads or a silent delivery change." },
];
export interface KeelEffectiveBuildDefaults {
  readonly schema: "keel-effective-build-defaults@1";
  readonly revision: number;
  readonly values: KeelPlanAnswers;
  readonly sources: Readonly<Record<string, "system" | "account" | "media" | "collection" | "project" | "build" | "contract">>;
  readonly requiresFullReadValidation: true;
}
/** Fetch the authoritative profile before calling. Project/build overrides stay explicit. */
export function resolveKeelBuildDefaults(profile: KeelStudioDefaultProfile, input: {
  readonly mediaType?: string;
  readonly collection?: KeelCollectionDefaultContext;
  readonly project?: KeelPlanAnswers;
  readonly build?: KeelPlanAnswers;
  readonly constraints?: { readonly maxReadGas?: number; readonly maxOutputBytes?: number; readonly transportProfiles?: readonly string[] };
} = {}): KeelEffectiveBuildDefaults {
  const current = parseKeelStudioDefaultProfile(profile);
  const values: Record<string, KeelPlanValue> = { imageDelivery: "onchain", animationDelivery: "onchain", compression: "auto", brotliQuality: 11, transportProfile: "base90-v1", payloadStorage: "compact", hybridFallback: false, rpcMaxConcurrentReads: KEEL_DEFAULT_RPC_READ_CONCURRENCY };
  const sources: Record<string, "system" | "account" | "media" | "collection" | "project" | "build" | "contract"> = Object.fromEntries(Object.keys(values).map(key => [key, "system"]));
  const fields = new Map(KEEL_BUILD_DEFAULT_FIELDS.map(field => [field.id, field]));
  for (const [source, layer] of [["account", current.global], ["media", current.byMedia[input.mediaType ?? ""]], ["collection", resolveKeelCollectionDefaultValues(current.collectionFilters, input.collection, input.mediaType)], ["project", input.project], ["build", input.build]] as const) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      const field = fields.get(key);
      if (!field) { if (source === "build") throw new TypeError("Unsupported explicit build setting."); continue; }
      const issue = validateKeelPlanValue(field, value);
      if (issue) throw new TypeError(issue.message);
      values[key] = copyValue(value); sources[key] = source;
    }
  }
  if (values.payloadStorage === "raw") { values.compression = "none"; sources.compression = sources.payloadStorage!; }
  for (const key of ["maxReadGas", "maxOutputBytes"] as const) {
    const ceiling = input.constraints?.[key];
    if (ceiling !== undefined) {
      if (!Number.isSafeInteger(ceiling) || ceiling < 1) throw new TypeError("Invalid registered reader limit.");
      if (values[key] === undefined || Number(values[key]) > ceiling) { values[key] = ceiling; sources[key] = "contract"; }
    }
  }
  if (input.constraints?.transportProfiles && !input.constraints.transportProfiles.includes(String(values.transportProfile))) throw new TypeError("The selected prepared encoding is not supported by the registered reader.");
  return Object.freeze({ schema: "keel-effective-build-defaults@1", revision: current.revision, values: Object.freeze(values), sources: Object.freeze(sources), requiresFullReadValidation: true });
}
/** Call immediately before funding; a stale build must be rebuilt and reviewed. */
export function assertKeelBuildDefaultsCurrent(prepared: KeelEffectiveBuildDefaults, current: KeelEffectiveBuildDefaults): void {
  // Snapshots predating slot preferences used onchain for both slots. Adding those
  // explicit system defaults must not invalidate unchanged paid/prepared work.
  const comparable = (values: KeelPlanAnswers) => {
    const normalized = { imageDelivery: "onchain", animationDelivery: "onchain", ...values };
    return JSON.stringify(Object.keys(normalized).sort().map(key => [key, normalized[key as keyof typeof normalized]]));
  };
  if (prepared.revision !== current.revision || comparable(prepared.values) !== comparable(current.values)) throw new Error("build-defaults-stale: refresh defaults, rebuild and review before funding");
}
