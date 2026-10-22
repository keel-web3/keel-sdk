import { canonicalJson, createIntegrity } from "@keel/protocol";
import { KEEL_THREE_R180, assertKeelThreeR180OfficialBytes } from "./three-module.js";
import type { BrowserModuleCarrierBinding } from "./module/descriptor.js";
import type { KeelAuthoredPublishedModule, KeelAuthoredPublishedModuleInput } from "./authored-project-graph.js";

/** Maintained source/API/license qualification. This is not chain availability. */
export const AUTHORED_THREE_PROFILES = [
  { ...KEEL_THREE_R180.core, moduleId: KEEL_THREE_R180.core.id, aliases: ["three.core.min.js", "./three.core.min.js", "/content/three.core.min.js"], dependencies: [] as string[] },
  { ...KEEL_THREE_R180.main, moduleId: KEEL_THREE_R180.main.id, aliases: ["three.module.min.js", "./three.module.min.js", "/content/three.module.min.js"], dependencies: [KEEL_THREE_R180.core.id] },
] as const;
function binding(value: BrowserModuleCarrierBinding, chainId: number, profile: typeof AUTHORED_THREE_PROFILES[number]): BrowserModuleCarrierBinding {
  if (!value || Object.keys(value).some(key => !["moduleId", "version", "digest", "objectId", "store", "chain"].includes(key))
    || value.moduleId !== profile.moduleId || value.version !== KEEL_THREE_R180.version || value.digest !== profile.digest || value.chain !== `eip155:${chainId}`
    || !/^0x[0-9a-f]{64}$/u.test(value.objectId) || !/^0x[0-9a-f]{40}$/u.test(value.store)) throw new TypeError("Published authored dependency differs from its exact selected-chain maintained source binding.");
  return { ...value };
}
export async function qualifyAuthoredPublishedModules(input: readonly KeelAuthoredPublishedModuleInput[] | undefined, chainId: number) {
  if (input === undefined || input.length === 0) return [];
  if (!Array.isArray(input) || input.length !== 2) throw new TypeError("The qualified authored Three r180 dependency requires its complete core/main closure; custom unreviewed profiles cannot be inferred.");
  const records: KeelAuthoredPublishedModule[] = [];
  for (const [index, profile] of AUTHORED_THREE_PROFILES.entries()) {
    const value = input[index]!;
    if (!value || Object.keys(value).some(key => !["binding", "source"].includes(key)) || !(value.source instanceof Uint8Array)) throw new TypeError("Published dependencies require exact separately resolved source bytes, never creator uploads.");
    const selected = binding(value.binding, chainId, profile);
    if (index && selected.store !== input[0]!.binding.store) throw new TypeError("Published dependency closure crosses selected stores.");
    const integrity = await createIntegrity(value.source);
    if (`sha256:${integrity.digest.slice(2)}` !== profile.digest || value.source.length !== profile.byteLength) throw new TypeError(`Published ${profile.moduleId} source failed its exact maintained digest/length check.`);
    records.push({ binding: selected, sourceIntegrity: { ...integrity, byteLength: value.source.length }, aliases: [...profile.aliases], execution: "module", license: "MIT", dependencies: [...profile.dependencies] });
  }
  await assertKeelThreeR180OfficialBytes({ core: input[0]!.source, main: input[1]!.source });
  return records;
}
export function assertAuthoredPublishedRecords(expected: readonly KeelAuthoredPublishedModule[], actual: readonly KeelAuthoredPublishedModule[]) {
  if (canonicalJson(expected) !== canonicalJson(actual)) throw new TypeError("Published authored dependency source, API/license profile, aliases, chain or complete closure changed.");
}
