import { parseKeelProjectProfileSnapshot, parseKeelNamedProjectProfile, type KeelProjectProfileSnapshot, type KeelNamedProjectProfile } from "./studio-project-profiles.js";
import { compileKeelPlanMatrix, validateKeelPlanValue, type KeelPlanAnswers, type KeelPlanDefaults, type KeelPlanMatrix, type KeelPlanValue } from "./studio-project-planner.js";

export interface KeelStudioDefaultProfile {
  readonly schema: "keel-studio-default-profile@1";
  readonly revision: number;
  readonly askToSave: boolean;
  readonly global: KeelPlanAnswers;
  readonly byMedia: Readonly<Record<string, KeelPlanAnswers>>;
  readonly namedProfiles?: readonly KeelNamedProjectProfile[];
}
export type KeelStudioDefaultScope = { readonly kind: "global" } | { readonly kind: "media"; readonly mediaType: string };
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

/** Account defaults are explicit choices, never inferred permissions or transaction authority. */
export function createKeelStudioDefaultProfile(): KeelStudioDefaultProfile {
  return Object.freeze({ schema: "keel-studio-default-profile@1", revision: 0, askToSave: false,
    global: Object.freeze({}), byMedia: Object.freeze({}) });
}

export function parseKeelStudioDefaultProfile(value: unknown): KeelStudioDefaultProfile {
  const input = object(value);
  if (Object.keys(input).some(key => !["schema", "revision", "askToSave", "global", "byMedia", "namedProfiles"].includes(key))
    || input.schema !== "keel-studio-default-profile@1" || !Number.isSafeInteger(input.revision) || Number(input.revision) < 0
    || typeof input.askToSave !== "boolean") throw new TypeError("Invalid saved defaults profile.");
  const media = Object.entries(object(input.byMedia));
  if (media.length > 32 || media.some(([key]) => !mediaPattern.test(key))) throw new TypeError("Saved defaults need a bounded set of exact media types.");
  if (input.namedProfiles !== undefined && (!Array.isArray(input.namedProfiles) || input.namedProfiles.length > 24)) throw new TypeError("Use a bounded named profile collection.");
  const namedProfiles = input.namedProfiles === undefined ? undefined : (input.namedProfiles as unknown[]).map(parseKeelNamedProjectProfile);
  if (namedProfiles && new Set(namedProfiles.map(profile => profile.id)).size !== namedProfiles.length) throw new TypeError("Named profile IDs must be unique.");
  const profile = { schema: "keel-studio-default-profile@1" as const, revision: Number(input.revision), askToSave: input.askToSave,
    ...(namedProfiles ? { namedProfiles } : {}), global: answers(input.global), byMedia: Object.freeze(Object.fromEntries(media.map(([key, item]) => [key, answers(item)]))) };
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
  if (command.scope.kind !== "global" && (command.scope.kind !== "media" || !mediaPattern.test(command.scope.mediaType))) throw new TypeError("Choose all projects or one exact media type.");
  const fields = new Map(compileKeelPlanMatrix(matrix).map(field => [field.id, field]));
  const entries = Object.entries(command.values);
  if (entries.length > 16 || !entries.length && command.askToSave === undefined) throw new TypeError("Choose a bounded set of defaults to update.");
  const selected: Record<string, KeelPlanValue> = { ...(command.scope.kind === "global" ? current.global : current.byMedia[command.scope.mediaType]) };
  for (const [id, value] of entries) {
    const field = fields.get(id);
    const key = field?.defaultKey ?? id;
    if (value === null && Object.hasOwn(selected, key)) { delete selected[key]; continue; }
    if (!field?.allowDefault) throw new TypeError("This setting requires a project-specific answer and cannot become a default.");
    if (value === null) { delete selected[key]; continue; }
    const issue = validateKeelPlanValue(field, value);
    if (issue) throw new TypeError(issue.message);
    selected[key] = copyValue(value);
  }
  const next = command.scope.kind === "global" ? { ...current, global: selected }
    : { ...current, byMedia: { ...current.byMedia, [command.scope.mediaType]: selected } };
  // Empty scopes have no meaning and must not consume the bounded profile capacity.
  const byMedia = Object.fromEntries(Object.entries(next.byMedia).filter(([, settings]) => Object.keys(settings).length > 0));
  return parseKeelStudioDefaultProfile({ ...next, byMedia, revision: current.revision + 1, askToSave: command.askToSave ?? current.askToSave });
}

/** Only applicable, defaultable settings enter a project. Existing plans keep their pinned copy. */
export function pinKeelStudioDefaults(profile: KeelStudioDefaultProfile, matrix: KeelPlanMatrix, mediaType: string): KeelPlanDefaults {
  const current = parseKeelStudioDefaultProfile(profile);
  const fields = compileKeelPlanMatrix(matrix).filter(field => field.allowDefault);
  const selectedMedia = new Set([mediaType, ...fields.flatMap(field => field.defaultMediaType ? [field.defaultMediaType] : [])]);
  const keys = new Set(fields.map(field => field.defaultKey ?? field.id));
  const select = (source: KeelPlanAnswers) => Object.freeze(Object.fromEntries(Object.entries(source).filter(([key]) => keys.has(key)).map(([key, value]) => [key, copyValue(value)])));
  return Object.freeze({ revision: `creator-defaults:${current.revision}`, global: select(current.global),
    byMedia: Object.freeze(Object.fromEntries([...selectedMedia].flatMap(media => current.byMedia[media] ? [[media, select(current.byMedia[media])]] : []))) });
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
export function validateKeelStudioDefaultsCommand(value: unknown): KeelStudioDefaultsCommand {
  const input = object(value), scope = object(input.scope), values = object(input.values);
  if (Object.keys(input).some(key => !["commandId", "expectedRevision", "scope", "values", "askToSave"].includes(key))
    || typeof input.commandId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(input.commandId)
    || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0
    || input.askToSave !== undefined && typeof input.askToSave !== "boolean"
    || Object.keys(values).length > 16 || !Object.keys(values).length && input.askToSave === undefined
    || Object.keys(values).some(key => !keyPattern.test(key))) throw new TypeError("Use a bounded defaults edit with its current revision and stable command UUID.");
  if (scope.kind === "global" ? Object.keys(scope).length !== 1
    : scope.kind !== "media" || Object.keys(scope).length !== 2 || typeof scope.mediaType !== "string" || !mediaPattern.test(scope.mediaType)) throw new TypeError("Choose global defaults or one exact media type.");
  answers(Object.fromEntries(Object.entries(values).filter(([, item]) => item !== null)));
  return { commandId: input.commandId, expectedRevision: Number(input.expectedRevision),
    scope: scope.kind === "global" ? { kind: "global" } : { kind: "media", mediaType: String(scope.mediaType) },
    values: JSON.parse(JSON.stringify(values)) as KeelStudioDefaultsCommand["values"],
    ...(input.askToSave === undefined ? {} : { askToSave: input.askToSave as boolean }) };
}

/** Private copied defaults. Never put this record in an artwork manifest or public metadata. */
export interface KeelSelectedProjectProfile {
  readonly snapshot: KeelProjectProfileSnapshot;
  readonly defaults?: Pick<KeelPlanDefaults, "revision" | "global" | "byMedia">;
}
export function parseKeelSelectedProjectProfile(input: unknown): KeelSelectedProjectProfile {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Invalid selected project profile.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== "snapshot" && key !== "defaults")) throw new TypeError("A profile selection cannot carry permissions or wallet actions.");
  const snapshot = parseKeelProjectProfileSnapshot(value.snapshot);
  if (value.defaults === undefined) return { snapshot };
  if (!value.defaults || typeof value.defaults !== "object" || Array.isArray(value.defaults)) throw new TypeError("Invalid copied project defaults.");
  const defaults = value.defaults as Record<string, unknown>;
  if (Object.keys(defaults).some(key => !["revision", "global", "byMedia"].includes(key)) || typeof defaults.revision !== "string" || !defaults.revision || defaults.revision.length > 240) throw new TypeError("Use bounded copied project defaults.");
  const parsed = parseKeelStudioDefaultProfile({ schema: "keel-studio-default-profile@1", revision: 0, askToSave: false, global: defaults.global ?? {}, byMedia: defaults.byMedia ?? {} });
  return { snapshot, defaults: { revision: defaults.revision, global: parsed.global, byMedia: parsed.byMedia } };
}
