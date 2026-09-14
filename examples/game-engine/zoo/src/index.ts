// ZOO: an example proving the engine's packs and AI compose in one KEEL
// document. It needs contracts, not modules: every pack providing
// body/quadruped and body/humanoid, every pack of wearables
// (attributes/wearable), every ai/animal -- the registry hands them over in
// setup(ctx), and the zoo stocks a pen with what came. main(host) draws it.

import type { ModuleContext, PackDef } from "@keel/game-engine/runtime";
import { mount } from "./page.ts";
import { createZoo } from "./zoo.ts";
import type { AnimalAi, Sources } from "./zoo.ts";

export { createZoo, DT, OBSTACLES, PEN } from "./zoo.ts";
export type { Agent, Animal, AnimalAi, Person, Sources, Worn, Zoo } from "./zoo.ts";

let sources: Sources = { bodies: [], wearables: [], ais: [] };

export function setup(ctx: ModuleContext): void {
  sources = {
    bodies: [...ctx.providers<{ pack: PackDef }>("body/quadruped"), ...ctx.providers<{ pack: PackDef }>("body/humanoid")]
      // (A pack can provide both: count it once.)
      .filter((p, i, all) => all.findIndex((q) => q.manifest.id === p.manifest.id) === i),
    wearables: ctx.providers<{ pack: PackDef }>("attributes/wearable"),
    ais: ctx.providers<AnimalAi>("ai/animal"),
  };
}

/** What setup() collected (for tests and tools). */
export const collected = (): Sources => sources;

export function main(host: HTMLElement): void {
  const seed = String((globalThis as { KEEL_SEED?: unknown }).KEEL_SEED ?? "0x200");
  mount(host, createZoo(sources, /^0x[0-9a-f]+$/i.test(seed) ? seed : "0x200"));
}
