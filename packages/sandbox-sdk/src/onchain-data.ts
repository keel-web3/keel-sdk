import { inspectOnchainDataFragment, orderKeelModules } from "@keel/sdk/onchain-data";

import type { SandboxDataLayer, SandboxDataLayerFault } from "./types.js";

/**
 * WHAT THE SANDBOX OWES A CREATOR WHO PUT A CHAIN IN THEIR ARTWORK.
 *
 * A data fragment fails silently by nature: when it is missing, or sorted after
 * the code that reads it, the artwork does not throw -- it draws with
 * `undefined` and looks merely wrong. So the sandbox has to say out loud that
 * the fragment is there, that it sorts into the data phase ahead of every
 * runtime and render module, and which variables it publishes. Then a creator
 * who sees a blank canvas can tell those two failures apart.
 *
 * Nothing here executes project bytes. The pack is decoded by the same module
 * that wrote it; the sandbox is not a second, private idea of the format.
 */

const DATA_WEIGHT = -32_768;

function isScript(mediaType: string): boolean {
  return mediaType === "text/javascript" || mediaType === "application/javascript";
}

export interface SandboxDataLayerReading {
  readonly layers: readonly SandboxDataLayer[];
  readonly faults: readonly SandboxDataLayerFault[];
}

/**
 * Find every on-chain data fragment in a project and report what it carries.
 *
 * It takes resource descriptors rather than a manifest so that the manifest
 * builder can ask the same question while it is still assembling one.
 */
export function readSandboxDataLayers(
  resources: readonly { readonly id: string; readonly mediaType: string }[],
  sources: ReadonlyMap<string, Uint8Array>,
): SandboxDataLayerReading {
  const scripts = resources.filter((resource) => isScript(resource.mediaType));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const found = new Map<string, ReturnType<typeof inspectOnchainDataFragment>>();
  const faults: SandboxDataLayerFault[] = [];
  for (const resource of scripts) {
    const bytes = sources.get(resource.id);
    if (bytes === undefined) continue;
    let source: string;
    try {
      source = decoder.decode(bytes);
    } catch {
      /* Not text, so not a fragment. A binary resource declared as script is
         already the manifest validator's finding, not this one's. */
      continue;
    }
    try {
      const reading = inspectOnchainDataFragment(source);
      if (reading !== undefined) found.set(resource.id, reading);
    } catch (error) {
      faults.push({ resourceId: resource.id, message: error instanceof Error ? error.message : "The data fragment could not be read." });
    }
  }
  if (found.size === 0) return { layers: [], faults };

  /* The same ordering the graph builder applies, so the position a creator sees
     here is the position the document will run in -- not a claim about it. */
  const ordered = orderKeelModules(scripts.map((resource) => ({
    moduleId: resource.id,
    phase: found.has(resource.id) ? ("data" as const) : ("runtime" as const),
    weight: found.has(resource.id) ? DATA_WEIGHT : 0,
  })));

  const layers: SandboxDataLayer[] = [];
  for (const [order, module] of ordered.entries()) {
    const reading = found.get(module.moduleId);
    if (reading === undefined) continue;
    layers.push({
      resourceId: module.moduleId,
      phase: "data",
      weight: DATA_WEIGHT,
      order,
      globalName: reading.globalName,
      chainId: reading.chainId,
      blockNumber: reading.blockNumber,
      variables: Object.freeze(Object.keys(reading.values)),
      values: reading.values,
    });
  }
  return { layers: Object.freeze(layers), faults: Object.freeze(faults) };
}
