// The zoo, as a model: no drawing, no clock. From whatever modules the page
// brought -- every pack providing a body contract, every pack of wearables,
// every animal AI -- it stocks a pen with animals (herds under a social AI,
// the rest under a solo one, each brain's params from its body's sockets),
// lines up the two-legged characters, and dresses every one in wearables that
// fit it (runtime's fits(): body contracts, and the packs agreeing). step()
// advances the animals one fixed step; a wolf crosses the pen on a fixed path,
// or wherever scare() puts it.

import { createRoll, deriveSeed, stream } from "@keel/game-engine/core";
import type { Stream } from "@keel/game-engine/core";
import { wear } from "@keel/game-engine/entity";
import type { AttributeShape, EntitySpec } from "@keel/game-engine/entity";
import { fits } from "@keel/game-engine/runtime";
import type { AnyAttributeDef, AnyEntityDef, ModuleManifest, PackDef } from "@keel/game-engine/runtime";

// ---------------------------------------------------------------- the ai/animal@1 contract, as the zoo uses it

export type Vec3 = [number, number, number];
export type AnimalMode = "idle" | "walk" | "run" | "sit" | "flee";
export interface Agent { readonly id: string; readonly pos: Vec3; readonly vel: Vec3; readonly facing: number; readonly mode: AnimalMode }
export interface Neighbour { readonly id: string; readonly pos: Vec3; readonly vel: Vec3; readonly mode?: AnimalMode; readonly leader?: boolean }
export interface WorldQuery {
  neighbours(pos: Vec3, r: number): readonly Neighbour[];
  readonly obstacles: ReadonlyArray<{ readonly pos: Vec3; readonly r: number }>;
  readonly bounds?: readonly [number, number, number, number];
  readonly threat?: Vec3 | null;
}
export interface BrainLike { step(agent: Agent, world: WorldQuery): Agent }
export interface AnimalAi {
  readonly contract: string;
  readonly id: string;
  readonly social: boolean;
  createBrain(seed: string, params?: object): BrainLike;
  paramsFor(sockets: Readonly<Record<string, { readonly size: readonly [number, number, number] }>>): object;
}

export interface Provided<T> { readonly manifest: ModuleManifest; readonly api: T }
export interface Sources {
  /** Packs providing body/quadruped and body/humanoid. */
  readonly bodies: ReadonlyArray<Provided<{ pack: PackDef }>>;
  /** Packs providing attributes/wearable. */
  readonly wearables: ReadonlyArray<Provided<{ pack: PackDef }>>;
  /** Modules providing ai/animal. */
  readonly ais: ReadonlyArray<Provided<AnimalAi>>;
}

// ---------------------------------------------------------------- the zoo

export interface Worn {
  readonly attribute: string;
  readonly from: string;
  readonly slot: string;
  readonly pins: Readonly<Record<string, string | number | boolean>>;
  readonly parts: number;
}
export interface Animal {
  readonly entity: string;
  readonly pack: string;
  readonly ai: string;
  readonly leader: boolean;
  readonly group: string;
  readonly spec: EntitySpec;
  /** Body length, metres (from its back socket). */
  readonly length: number;
  readonly worn: readonly Worn[];
  agent: Agent;
}
export interface Person {
  readonly entity: string;
  readonly pack: string;
  readonly spec: EntitySpec;
  readonly pos: Vec3;
  readonly worn: readonly Worn[];
}

export const PEN = [-12, -8, 12, 8] as const;
export const OBSTACLES = [{ pos: [-5, 0, 2.5] as Vec3, r: 1.6 }, { pos: [4.5, 0, -1] as Vec3, r: 1.2 }, { pos: [8, 0, 4.5] as Vec3, r: 0.9 }];
export const DT = 1 / 30;

// How many of each: herding kinds in herds, the rest in ones and twos.
const HOW_MANY: Readonly<Record<string, number>> = { deer: 7, dog: 4, rabbit: 3, mouse: 3, cat: 2, fox: 2, bear: 1 };

const sOf = (seed: string, label: string | number): Stream => stream(createRoll(deriveSeed(seed, label)), 0);

/** Wearables that fit this entity, one per slot at most, each with its choices drawn (and a pair's other half matched). */
function dress(entity: { def: AnyEntityDef; pack: ModuleManifest }, spec: EntitySpec, wearables: Sources["wearables"], S: Stream, chance: number): Worn[] {
  const fitting: Array<{ def: AnyAttributeDef; pack: ModuleManifest }> = [];
  for (const w of wearables) for (const def of w.api.pack.attributes) if (fits({ def, pack: w.manifest }, entity).ok) fitting.push({ def, pack: w.manifest });
  const slots = [...new Set(fitting.map((f) => f.def.slot))].sort();
  const out: Worn[] = [];
  for (const slot of slots) {
    const pick = S.pick(fitting.filter((f) => f.def.slot === slot));
    const want = S.chance(chance);
    if (!want || out.some((o) => o.slot === slot)) continue;
    const pins: Record<string, string | number | boolean> = {};
    for (const [name, c] of Object.entries(pick.def.choices ?? {})) {
      const range = (c as { range?: readonly [number, number] }).range;
      pins[name] = range ? Math.round(S.between(range[0], range[1]) * 100) / 100 : S.pick(c as readonly (string | number | boolean)[]);
    }
    const put = (def: AnyAttributeDef, from: ModuleManifest) => {
      const worn = wear(def, spec, sOf(spec.seed, def.id), pins);
      const d = worn.design as AttributeShape;
      out.push({ attribute: def.id, from: from.id, slot: def.slot, pins, parts: (d.capsules?.length ?? 0) + (d.boxes?.length ?? 0) });
    };
    put(pick.def, pick.pack);
    // (A pair -- boots -- is two attributes, one a side: put the other on too, with the same pins.)
    if (pick.def.tags?.includes("pair")) {
      const side = /\.([LR])$/.exec(slot)?.[1];
      const other = side && fitting.find((f) => f.pack.id === pick.pack.id && f.def.slot === slot.replace(/[LR]$/, side === "L" ? "R" : "L") && f.def.tags?.includes("pair"));
      if (other) put(other.def, other.pack);
    }
  }
  return out;
}

export function createZoo(sources: Sources, seed = "0x200") {
  const quadrupeds: Array<{ def: AnyEntityDef; pack: ModuleManifest }> = [];
  const people: Array<{ def: AnyEntityDef; pack: ModuleManifest }> = [];
  for (const b of sources.bodies) for (const def of b.api.pack.entities) (def.body.startsWith("body/quadruped@") ? quadrupeds : def.body.startsWith("body/humanoid@") ? people : []).push({ def, pack: b.manifest });
  const social = sources.ais.find((a) => a.api.social) ?? sources.ais[0];
  const solo = sources.ais.find((a) => !a.api.social) ?? sources.ais[0];
  const S = sOf(seed, "zoo");

  const animals: Animal[] = [];
  const brains: BrainLike[] = [];
  const spot = (): Vec3 => {
    for (;;) {
      const p: Vec3 = [S.between(PEN[0] + 1, PEN[2] - 1), 0, S.between(PEN[1] + 3, PEN[3] - 1)];
      if (!OBSTACLES.some((o) => Math.hypot(p[0] - o.pos[0], p[2] - o.pos[2]) < o.r + 0.6)) return p;
    }
  };
  for (const q of quadrupeds) {
    const herd = Boolean(q.def.tags?.includes("herd")) && social !== undefined;
    const ai = herd ? social : solo;
    if (!ai) continue;
    const n = HOW_MANY[q.def.id] ?? 2;
    const home = spot();
    for (let i = 0; i < n; i += 1) {
      const spec = q.def.build(sOf(seed, `${q.pack.id}/${q.def.id}/${i}`), {}) as EntitySpec;
      const sockets = q.def.sockets(spec);
      const back = sockets["back"];
      const length = back ? back.size[2] / 0.6 : 0.5;
      const leader = herd && i === 0;
      const brain = ai.api.createBrain(deriveSeed(seed, `brain/${q.def.id}/${i}`), { ...ai.api.paramsFor(sockets), ...(herd ? { leader } : {}) });
      const pos: Vec3 = herd ? [home[0] + S.between(-1.5, 1.5), 0, home[2] + S.between(-1.5, 1.5)] : spot();
      animals.push({
        entity: q.def.id, pack: q.pack.id, ai: ai.api.id, leader, group: herd ? `${q.pack.id}/${q.def.id}` : `solo:${q.def.id}/${i}`, spec, length,
        worn: dress(q, spec, sources.wearables, S, 0.18),
        agent: { id: `${q.def.id}#${i}`, pos, vel: [0, 0, 0], facing: S.between(-Math.PI, Math.PI), mode: "idle" },
      });
      brains.push(brain);
    }
  }

  const standing: Person[] = people.map((p, i) => {
    const spec = p.def.build(sOf(seed, `${p.pack.id}/${p.def.id}`), {}) as EntitySpec;
    const x = PEN[0] + 1.5 + (i * (PEN[2] - PEN[0] - 3)) / Math.max(1, people.length - 1);
    return { entity: p.def.id, pack: p.pack.id, spec, pos: [x, 0, PEN[1] + 1.2], worn: dress(p, spec, sources.wearables, S, 0.55) };
  });

  // (The people stand in the pen: the animals go round them.)
  const obstacles = [...OBSTACLES, ...standing.map((p) => ({ pos: p.pos, r: 0.45 }))];
  let tick = 0;
  let scared: { at: Vec3; until: number } | null = null;
  /** The wolf: a slow figure-of-eight through the pen, every so often; or where it was put. */
  const wolf = (): Vec3 | null => {
    if (scared && tick < scared.until) return scared.at;
    const cycle = tick % (30 * 40);
    if (cycle > 30 * 14) return null;
    const t = cycle / (30 * 14);
    return [Math.sin(t * Math.PI * 2) * (PEN[2] - 2), 0, Math.sin(t * Math.PI * 4) * (PEN[3] - 3)];
  };

  function queryFor(group: string, threat: Vec3 | null): WorldQuery {
    // (A herd sees its own kind -- boids of one species; a lone animal minds everyone's personal space.)
    const mates = group.startsWith("solo:") ? animals : animals.filter((a) => a.group === group);
    return {
      neighbours: (pos, r) => mates.filter((a) => Math.hypot(a.agent.pos[0] - pos[0], a.agent.pos[2] - pos[2]) < r).map((a) => ({ id: a.agent.id, pos: a.agent.pos, vel: a.agent.vel, mode: a.agent.mode, leader: a.leader })),
      obstacles,
      bounds: PEN,
      threat,
    };
  }

  return {
    animals,
    people: standing,
    sources: { bodies: sources.bodies.map((b) => b.manifest.id), wearables: sources.wearables.map((w) => w.manifest.id), ais: sources.ais.map((a) => a.api.id) },
    get tick() { return tick; },
    wolf,
    /** Put the wolf here for three seconds. */
    scare(at: Vec3): void { scared = { at, until: tick + 90 }; },
    /** One fixed step (DT): every brain against the same snapshot. */
    step(): void {
      const threat = wolf();
      const queries = new Map<string, WorldQuery>();
      const next = animals.map((a, i) => {
        let q = queries.get(a.group);
        if (!q) { q = queryFor(a.group, threat); queries.set(a.group, q); }
        return brains[i]!.step(a.agent, q);
      });
      next.forEach((agent, i) => { animals[i]!.agent = agent; });
      tick += 1;
    },
  };
}

export type Zoo = ReturnType<typeof createZoo>;
