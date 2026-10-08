import type { KeelPlanAnswers } from "./studio-project-planner.js";
import type { KeelProjectProfileConfiguration } from "./studio-project-profiles.js";

export const KEEL_COLLECTION_DEFAULT_AXES = {
  tokenStandard: ["none", "erc721", "erc1155"],
  tokenStructure: ["none", "one-of-one", "edition", "collection"],
  saleMethod: ["none", "fixed-price", "auction", "sealed-bid"],
} as const;
export type KeelCollectionDefaultContext = Partial<Pick<KeelProjectProfileConfiguration, "tokenStandard" | "tokenStructure" | "saleMethod">>;
export type KeelCollectionDefaultFilter = KeelCollectionDefaultContext & { readonly mediaType?: string };
export interface KeelCollectionDefaults { readonly filter: KeelCollectionDefaultFilter; readonly values: KeelPlanAnswers }
const axes = Object.keys(KEEL_COLLECTION_DEFAULT_AXES) as (keyof typeof KEEL_COLLECTION_DEFAULT_AXES)[];
const mediaPattern = /^[a-z0-9][a-z0-9.+-]{0,63}\/[a-z0-9][a-z0-9.+-]{0,95}$/u;
export function parseKeelCollectionDefaultFilter(value: unknown): KeelCollectionDefaultFilter {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) throw new TypeError("Use a collection-type filter with supported configuration axes.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => key !== "mediaType" && !axes.includes(key as typeof axes[number])) || !axes.some(key => v[key] !== undefined)) throw new TypeError("A collection filter needs at least one token standard, structure or sale method; addresses and lifecycle are not filters.");
  for (const key of axes) if (v[key] !== undefined && !(KEEL_COLLECTION_DEFAULT_AXES[key] as readonly unknown[]).includes(v[key])) throw new TypeError("Choose a supported collection-type filter value.");
  if (v.mediaType !== undefined && (typeof v.mediaType !== "string" || !mediaPattern.test(v.mediaType))) throw new TypeError("A collection media filter must be an exact media type.");
  if ((v.tokenStandard === "none" || v.tokenStructure === "none" || v.saleMethod === "none") && axes.some(key => v[key] !== undefined && v[key] !== "none")) throw new TypeError("Storage-only collection filters cannot combine token or sale settings.");
  return Object.freeze(Object.fromEntries([...axes, "mediaType"].flatMap(key => v[key] === undefined ? [] : [[key, v[key]]])) as KeelCollectionDefaultFilter);
}
export function keelCollectionDefaultFilterKey(filter: KeelCollectionDefaultFilter): string {
  return JSON.stringify(parseKeelCollectionDefaultFilter(filter));
}
/** Equal specificity may overlap only when every shared setting agrees. */
export function assertKeelCollectionDefaultsUnambiguous(entries: readonly KeelCollectionDefaults[]): void {
  const keys = entries.map(entry => keelCollectionDefaultFilterKey(entry.filter));
  if (new Set(keys).size !== keys.length) throw new TypeError("This collection filter is listed more than once.");
  for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
    const left = entries[a]!, right = entries[b]!;
    if (Object.keys(left.filter).length !== Object.keys(right.filter).length) continue;
    if (Object.entries(left.filter).some(([key, value]) => right.filter[key as keyof KeelCollectionDefaultFilter] !== undefined && right.filter[key as keyof KeelCollectionDefaultFilter] !== value)) continue;
    if (Object.entries(left.values).some(([key, value]) => right.values[key] !== undefined && JSON.stringify(right.values[key]) !== JSON.stringify(value))) throw new TypeError("Equally specific collection filters overlap with conflicting values. Narrow a filter or use the same value.");
  }
}
export function resolveKeelCollectionDefaultValues(entries: readonly KeelCollectionDefaults[] | undefined, context: KeelCollectionDefaultContext | undefined, mediaType?: string): KeelPlanAnswers {
  if (!context) return {};
  const actual = { ...context, mediaType };
  const matched = (entries ?? []).filter(entry => Object.entries(entry.filter).every(([key, value]) => actual[key as keyof typeof actual] === value));
  matched.sort((a, b) => Object.keys(a.filter).length - Object.keys(b.filter).length || keelCollectionDefaultFilterKey(a.filter).localeCompare(keelCollectionDefaultFilterKey(b.filter)));
  return Object.freeze(Object.assign({}, ...matched.map(entry => entry.values)) as KeelPlanAnswers);
}
/** Only known release structures are mapped; custom content does not imply a token structure. */
export function keelCollectionDefaultsContextFromRelease(input: { readonly releaseType?: string; readonly saleMethod?: string; readonly tokenStandard?: KeelProjectProfileConfiguration["tokenStandard"] }): KeelCollectionDefaultContext {
  const tokenStructure = input.releaseType === "one-of-one" ? "one-of-one" : ["limited-edition", "open-edition"].includes(input.releaseType ?? "") ? "edition" : ["generative-series", "unique-set"].includes(input.releaseType ?? "") ? "collection" : undefined;
  const saleMethod = (KEEL_COLLECTION_DEFAULT_AXES.saleMethod as readonly string[]).includes(input.saleMethod ?? "") ? input.saleMethod as KeelProjectProfileConfiguration["saleMethod"] : undefined;
  return { ...(input.tokenStandard ? { tokenStandard: input.tokenStandard } : {}), ...(tokenStructure ? { tokenStructure } : {}), ...(saleMethod ? { saleMethod } : {}) };
}
