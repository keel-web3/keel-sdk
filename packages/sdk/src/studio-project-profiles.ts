import type { KeelPlanAnswers, KeelPlanValue } from "./studio-project-planner.js";

/** Configuration axes are independent. Runtime lifecycle is deliberately absent. */
export interface KeelProjectProfileConfiguration {
  readonly content: "finished-media" | "scripted" | "generative" | "mixed";
  readonly tokenStandard: "none" | "erc721" | "erc1155";
  readonly tokenStructure: "none" | "one-of-one" | "edition" | "collection";
  readonly saleMethod: "none" | "fixed-price" | "auction" | "sealed-bid";
  readonly payloadStorage: "compact" | "raw";
  readonly viewer: "keel-verification-shell" | "none";
  readonly values: KeelPlanAnswers;
  readonly libraries: readonly { readonly moduleId: string; readonly version: string; readonly digest: string; readonly objectId: string; readonly store: string; readonly chain: string }[];
}
export interface KeelNamedProjectProfile {
  readonly id: string; readonly revision: number; readonly name: string; readonly description: string;
  readonly favorite: boolean; readonly configuration: KeelProjectProfileConfiguration;
}
export interface KeelProjectProfileSnapshot {
  readonly schema: "keel-project-profile-snapshot@1";
  readonly id: string; readonly revision: number; readonly name: string;
  readonly configuration: KeelProjectProfileConfiguration;
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;
const profileId = /^(?:builtin:[a-z][a-z0-9-]{0,63}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/iu;
const forbidden = new Set(["title", "description", "releaseType", "sale", "status", "lifecycle", "wallet", "privateKey", "apiKey"]);
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) throw new TypeError("A project profile must be a plain record.");
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || !empty && !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError("Use bounded printable profile text.");
  return value.trim();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new TypeError("Unsupported project profile choice.");
  return value as T;
}
export function parseKeelProjectProfileConfiguration(value: unknown): KeelProjectProfileConfiguration {
  const v = record(value);
  if (Object.keys(v).some(key => !["content", "tokenStandard", "tokenStructure", "saleMethod", "payloadStorage", "viewer", "values", "libraries"].includes(key))) throw new TypeError("Profiles contain configuration only; lifecycle and wallet authority cannot be preset.");
  const content = choice(v.content, ["finished-media", "scripted", "generative", "mixed"] as const);
  const tokenStandard = choice(v.tokenStandard, ["none", "erc721", "erc1155"] as const);
  const tokenStructure = choice(v.tokenStructure, ["none", "one-of-one", "edition", "collection"] as const);
  const saleMethod = choice(v.saleMethod, ["none", "fixed-price", "auction", "sealed-bid"] as const);
  if ((tokenStandard === "none") !== (tokenStructure === "none") || (tokenStandard === "none") !== (saleMethod === "none")) throw new TypeError("Storage-only profiles omit both token structure and sale method.");
  const entries = Object.entries(record(v.values));
  if (entries.length > 32) throw new RangeError("Too many profile settings.");
  const values: Record<string, KeelPlanValue> = {};
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.:-]{0,159}$/u.test(key) || forbidden.has(key)) throw new TypeError("This value needs a project answer or its separate configuration axis.");
    if (typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) || typeof item === "string" && item.length <= 8_000 && !/[\u0000-\u001f\u007f]/u.test(item)) values[key] = item;
    else if (Array.isArray(item) && item.length <= 32 && item.every(entry => typeof entry === "string" && entry.length <= 160)) values[key] = [...item] as string[];
    else throw new TypeError("Unsupported profile setting value.");
  }
  if (!Array.isArray(v.libraries) || v.libraries.length > 16) throw new TypeError("Choose a bounded set of exact library bindings.");
  const libraries = v.libraries.map(input => {
    const binding = record(input);
    if (Object.keys(binding).some(key => !["moduleId", "version", "digest", "objectId", "store", "chain"].includes(key))) throw new TypeError("Use an exact published library binding.");
    const moduleId = text(binding.moduleId, 160), version = text(binding.version, 80), chain = text(binding.chain, 80);
    if (!/^0x[0-9a-f]{64}$/iu.test(String(binding.digest)) || !/^0x[0-9a-f]{64}$/iu.test(String(binding.objectId)) || !/^0x[0-9a-f]{40}$/iu.test(String(binding.store))) throw new TypeError("A library profile needs its exact digest, object and store.");
    return { moduleId, version, chain, digest: String(binding.digest), objectId: String(binding.objectId), store: String(binding.store) };
  });
  if (new Set(libraries.map(binding => `${binding.chain}:${binding.moduleId}`)).size !== libraries.length) throw new TypeError("A library is listed more than once.");
  const result = { content, tokenStandard, tokenStructure, saleMethod,
    payloadStorage: choice(v.payloadStorage, ["compact", "raw"] as const), viewer: choice(v.viewer, ["keel-verification-shell", "none"] as const), values, libraries };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32_768) throw new RangeError("This profile is too large.");
  return result;
}
export function parseKeelNamedProjectProfile(value: unknown): KeelNamedProjectProfile {
  const v = record(value);
  if (Object.keys(v).some(key => !["id", "revision", "name", "description", "favorite", "configuration"].includes(key)) || typeof v.id !== "string" || !profileId.test(v.id)
    || !Number.isSafeInteger(v.revision) || Number(v.revision) < 1 || typeof v.favorite !== "boolean") throw new TypeError("Invalid named project profile.");
  return { id: v.id, revision: Number(v.revision), name: text(v.name, 80), description: text(v.description, 320, true), favorite: v.favorite, configuration: parseKeelProjectProfileConfiguration(v.configuration) };
}
export function snapshotKeelProjectProfile(profile: KeelNamedProjectProfile): KeelProjectProfileSnapshot {
  const checked = parseKeelNamedProjectProfile(profile);
  return { schema: "keel-project-profile-snapshot@1", id: checked.id, revision: checked.revision, name: checked.name, configuration: checked.configuration };
}
export function parseKeelProjectProfileSnapshot(value: unknown): KeelProjectProfileSnapshot {
  const v = record(value);
  if (Object.keys(v).some(key => !["schema", "id", "revision", "name", "configuration"].includes(key)) || v.schema !== "keel-project-profile-snapshot@1") throw new TypeError("Invalid copied project profile.");
  return snapshotKeelProjectProfile(parseKeelNamedProjectProfile({ id: v.id, revision: v.revision, name: v.name, configuration: v.configuration, description: "", favorite: false }));
}
/** A copied profile supplies defaults; explicit project answers are merged after these values. */
export function keelProjectProfileAnswers(profile: KeelProjectProfileSnapshot): KeelPlanAnswers {
  const { configuration: c } = parseKeelProjectProfileSnapshot(profile);
  if (c.tokenStandard === "none") return { ...c.values };
  return { ...c.values, releaseType: c.tokenStructure === "one-of-one" ? "one-of-one" : c.tokenStructure === "edition" ? "limited-edition" : c.content === "generative" ? "generative-series" : "unique-set",
    sale: c.saleMethod, ...(c.tokenStructure === "one-of-one" ? { supply: 1 } : {}) };
}
export function keelProjectProfileCapability(profile: KeelNamedProjectProfile | KeelProjectProfileSnapshot) {
  const c = profile.configuration;
  if (c.tokenStandard === "erc1155") return { available: false, reason: "This Studio publisher needs an ERC-1155 route before it can prepare this profile.", path: null };
  if (c.saleMethod === "sealed-bid") return { available: false, reason: "Deposit-backed sealed bids require a reviewed contract route. This profile cannot authorize storage or a sale yet.", path: null };
  if (c.saleMethod === "auction") return { available: false, reason: "Use the existing Fray intent builder to review auction policy. This release publisher cannot substitute a fixed-price sale.", path: "/studio/fray/new" };
  return { available: true, reason: "The chosen setup still needs exact project and network checks before any transaction.", path: null };
}
function builtin(id: string, name: string, description: string, content: KeelProjectProfileConfiguration["content"], tokenStructure: KeelProjectProfileConfiguration["tokenStructure"], saleMethod: KeelProjectProfileConfiguration["saleMethod"] = "fixed-price"): KeelNamedProjectProfile {
  return { id: `builtin:${id}`, revision: 1, name, description, favorite: false, configuration: { content, tokenStandard: tokenStructure === "none" ? "none" : "erc721", tokenStructure, saleMethod,
    payloadStorage: "compact", viewer: "keel-verification-shell", values: {}, libraries: [] } };
}
export const KEEL_PROJECT_STARTER_PROFILES: readonly KeelNamedProjectProfile[] = [
  builtin("erc721-one", "ERC-721 · one of one", "One collectible. A short flow for a finished work.", "finished-media", "one-of-one"),
  builtin("erc721-edition", "ERC-721 · edition", "Several tokens using the same work. Choose supply and collecting rules.", "finished-media", "edition"),
  builtin("generative", "Generative collection", "Scripts, seeds and reusable libraries. Save your exact library choices in a named profile.", "generative", "collection"),
  builtin("auction", "Auction", "Review auction policy through the existing Fray builder.", "finished-media", "one-of-one", "auction"),
  builtin("storage-only", "Preserve files", "Store and verify a work without creating tokens or sale rules.", "mixed", "none", "none"),
];
export interface KeelNamedProfileCommand {
  readonly commandId: string; readonly expectedRevision: number; readonly profileId: string;
  readonly operation: "create" | "edit" | "remove";
  readonly profile?: { readonly name: string; readonly description: string; readonly favorite: boolean; readonly configuration: KeelProjectProfileConfiguration };
}
export function validateKeelNamedProfileCommand(value: unknown): KeelNamedProfileCommand {
  const v = record(value);
  if (Object.keys(v).some(key => !["commandId", "expectedRevision", "profileId", "operation", "profile"].includes(key)) || typeof v.commandId !== "string" || !uuid.test(v.commandId)
    || typeof v.profileId !== "string" || !uuid.test(v.profileId) || !Number.isSafeInteger(v.expectedRevision) || Number(v.expectedRevision) < 0 || !["create", "edit", "remove"].includes(String(v.operation))) throw new TypeError("Use an explicit profile operation, stable IDs and the current account revision.");
  if (v.operation === "remove" ? v.profile !== undefined : v.profile === undefined) throw new TypeError("Only create and edit accept profile values.");
  const checked = v.profile === undefined ? undefined : parseKeelNamedProjectProfile({ ...record(v.profile), id: v.profileId, revision: 1 });
  return { commandId: v.commandId, expectedRevision: Number(v.expectedRevision), profileId: v.profileId, operation: v.operation as KeelNamedProfileCommand["operation"], ...(checked ? { profile: { name: checked.name, description: checked.description, favorite: checked.favorite, configuration: checked.configuration } } : {}) };
}
export function applyKeelNamedProfileCommand(profiles: readonly KeelNamedProjectProfile[], input: KeelNamedProfileCommand): readonly KeelNamedProjectProfile[] {
  const command = validateKeelNamedProfileCommand(input), current = profiles.map(parseKeelNamedProjectProfile), found = current.find(profile => profile.id === command.profileId);
  if (command.operation === "create" && found || command.operation !== "create" && !found) throw new Error("profile-conflict");
  if (command.operation === "remove") return current.filter(profile => profile.id !== command.profileId);
  const next = parseKeelNamedProjectProfile({ ...command.profile, id: command.profileId, revision: (found?.revision ?? 0) + 1 });
  const result = found ? current.map(profile => profile.id === next.id ? next : profile) : [...current, next];
  if (result.length > 24) throw new RangeError("Keep at most 24 named profiles. Remove an unused profile before adding another.");
  return result;
}
