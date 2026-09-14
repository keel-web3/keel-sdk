// GARDEN: a small seeded plaza on an island of lawn -- paving, hedges with
// gaps to walk through, benches facing in, lamp posts, a sign, a stack of
// crates, bushes -- with a few animals wandering, idling and sitting, and one
// anthro character you can drive (click, then WASD: W is where the camera
// looks). Left alone, the character strolls to a bench and sits a while.
//
// It wires nothing by hand: the generator proposes every choice through the
// settings (so locks hold), brains drive the animals, the world's default
// systems do the rest. The same function builds it in Node (tests) and in the
// page (./page.ts). Ported from the proof of concept's projects/garden/garden.js.
//
//   const world = gardenWorld({ seed: "3", width: 128, height: 128, locks: "tag:animal/species=cat" });
//   world.simulate(5); world.frame();

import { yawTo } from "@keel/game-engine/core";
import type { Vec3, Vec3Like } from "@keel/game-engine/core";
import { defineObject, socketOf } from "@keel/game-engine/object";
import type { ObjectInstance, WorldSocket } from "@keel/game-engine/object";
import { createWorld } from "@keel/game-engine/world";
import type { EntityIntent, FxPass, Gen, LayerValues, World, WorldEntity, WorldOptions } from "@keel/game-engine/world";
import { animalMaterials, HERO_MATERIALS, MATERIALS, PALETTES } from "./palette.ts";

// The project's settings: its palette, what the catalogue's material names
// mean here, where the water is. (A scene or a lock can change any of it.)
export const PROJECT: Readonly<LayerValues> = {
  "render.palette": "meadow",
  "render.fog": [30, 95],
  "render.waterY": 0.12,
  "render.sun": [0.45, 0.8, 0.3],
  "system.physics.waterY": 0.12,
  "mat.wood": "oak",
  "mat.trim": "paint",
};
// Thing scopes the project starts with: the lawn is grass, hedges are hedge.
export const TAGS = {
  "tag:ground": { material: "grass" },
  "tag:hedge": { material: "hedge" },
  "tag:bush": { material: "hedge" },
} as const;

// A footprint probe: room for an animal to stand.
const PROBE = defineObject({ key: "probe", parts: [{ box: { c: [0, 0.3, 0], h: [0.45, 0.3, 0.45] }, name: "probe" }] });

/** The generator: every choice proposed through the settings; every draw on its own named stream. */
export function gardenGenerator(g: Gen, world: World): void {
  const G = g.between("ground.size", 11, 14); // (half the lawn)
  const P = g.between("plaza.size", 4.2, 5.4); // (half the plaza)
  const ground = g.place("pad", { id: "ground", tags: ["ground"], ctx: { w: G * 2, d: G * 2, h: 0.3, lip: false }, on: [0] });
  const top = ground.transform.pos[1] + 0.3;
  g.place("pad", { id: "plaza", tags: ["floor", "plaza"], ctx: { w: P * 2, d: P * 2, h: 0.12, lip: false }, pos: [0, 0, 0], on: "auto" });
  const plazaTop = top + 0.12;

  // Hedges round the plaza, a gap in the middle of each side to walk through.
  const hh = g.between("hedge.height", 0.5, 0.8);
  const hedge = (id: string, pos: Vec3Like, w: number, d: number) => g.place("pillar", { id, tags: ["hedge"], ctx: { w, d, h: hh }, pos, on: "auto" });
  const len = P - 0.4;
  const side = P - 1.4;
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) {
      hedge(`hedge-${s > 0 ? "n" : "s"}${t > 0 ? "e" : "w"}`, [t * (P + 2) / 2, 0, s * (P + 0.5)], len, 0.6);
      hedge(`hedge-${s > 0 ? "e" : "w"}${t > 0 ? "n" : "s"}`, [s * (P + 0.5), 0, t * (P + 1) / 2], 0.6, side);
    }
  }

  // Lamp posts in two opposite corners, their heads reaching over the plaza (first: the benches keep clear of them).
  const diag = g.choose("lamps.diagonal", [1, -1]);
  for (const [i, s] of [[1, 1], [2, -1]] as const) {
    const pos: Vec3 = [s * (P - 0.55), plazaTop, s * diag * (P - 0.55)];
    const def = g.piece("lampPost", { id: `lamp-${i}`, tags: ["lamp"], ctx: { h: g.between("lamp.height", 2.6, 3.4) } });
    if (g.fits(def, { pos, yaw: yawTo(pos, [0, 0, 0]), margin: 0.05 })) g.place(def, { id: `lamp-${i}`, tags: ["lamp"], pos, yaw: yawTo(pos, [0, 0, 0]), on: "auto" });
  }

  // Benches on the plaza's edge, facing its middle (a bench's front is where you sit facing).
  const spots: [number, number][] = [];
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) for (const o of [-0.5, 0.5]) spots.push([nx * (P - 0.9) + nz * o * P, nz * (P - 0.9) + nx * o * P]);
  const order = g.stream("bench.spots");
  for (let i = spots.length - 1; i > 0; i -= 1) { const j = order.int(0, i); [spots[i], spots[j]] = [spots[j]!, spots[i]!]; }
  const benches = g.int("benches", 2, 4);
  let placed = 0;
  for (const [x, z] of spots) {
    if (placed >= benches) break;
    const id = `bench-${placed + 1}`;
    const yaw = yawTo([x, 0, z], [0, 0, 0]);
    const def = g.piece("bench", { id, tags: ["bench"] });
    if (!g.fits(def, { pos: [x, plazaTop, z], yaw, margin: 0.2 })) continue;
    g.place(def, { id, tags: ["bench"], pos: [x, 0, z], yaw, on: "auto" });
    // (What the bench is made of: the seed's, unless a setting says -- "this bench is always oak".)
    g.choose("material", ["oak", "teak", "paint"], { thing: { id, tags: ["bench"] }, weights: [3, 2, 1] });
    placed += 1;
  }
  if (placed < benches) g.warn(`benches: ${benches} asked, ${placed} fit round the plaza`);

  // A sign outside one gap, its display to whoever walks up.
  const sside = g.choose("sign.side", [0, 1, 2, 3]);
  const [sx, sz] = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const)[sside]!;
  const spos: Vec3 = [sx * (P + 2.4) + sz * 1.6, top, sz * (P + 2.4) + sx * 1.6];
  const sdef = g.piece("sign", { id: "sign", tags: ["sign"], ctx: { w: g.between("sign.width", 1, 1.6), lift: 0.6, h: 0.7 } });
  if (g.fits(sdef, { pos: spos, yaw: yawTo([0, 0, 0], spos), margin: 0.1 })) g.place(sdef, { id: "sign", tags: ["sign"], pos: spos, yaw: yawTo([0, 0, 0], spos), on: "auto" });

  // Crates in a corner of the lawn: some on the grass, some stacked on the one before.
  const corner = g.choose("crates.corner", [[1, 1], [1, -1], [-1, 1], [-1, -1]]) as readonly [number, number];
  const crates = g.int("crates", 2, 4);
  const S = g.stream("crates");
  let last: ObjectInstance<{ size: number; tall: number }> | null = null;
  for (let i = 1; i <= crates; i += 1) {
    const id = `crate-${i}`;
    const def = g.piece("crate", { id, tags: ["crate"] });
    const stack = last && S.chance(0.45) && last.def.meta.size >= def.meta.size * 0.8;
    const jitter = [S.between(-0.08, 0.08), S.between(-0.08, 0.08)] as const;
    const yaw = S.between(-0.4, 0.4);
    if (stack && last) {
      // (On top of the last one -- if it clears everything else up there.)
      const p = last.transform.pos;
      const pos: Vec3 = [p[0] + jitter[0], p[1] + last.def.meta.tall, p[2] + jitter[1]];
      if (g.fits(def, { pos, yaw, margin: 0.05, ignore: [String(last.id)] })) { last = g.place(def, { id, tags: ["crate"], pos, yaw, on: "auto" }); continue; }
    }
    for (let k = 0; k < 12; k += 1) {
      const pos: Vec3 = [corner[0] * (P + 3.2 + S.between(0, 2.2)), top, corner[1] * (P + 3.2 + S.between(0, 2.2))];
      if (!g.fits(def, { pos, yaw, margin: 0.15 })) continue;
      last = g.place(def, { id, tags: ["crate"], pos, yaw, on: "auto" });
      break;
    }
  }

  // Bushes about the lawn, clear of the hedges and of everything else.
  const bushes = g.int("bushes", 3, 6);
  const B = g.stream("bushes");
  let nb = 0;
  for (let k = 0; k < 40 && nb < bushes; k += 1) {
    const pos: Vec3 = [B.between(-G + 1.4, G - 1.4), top, B.between(-G + 1.4, G - 1.4)];
    if (Math.max(Math.abs(pos[0]), Math.abs(pos[2])) < P + 1.8) continue;
    const s = B.between(0.8, 1.6);
    const def = g.piece("pillar", { id: `bush-${nb + 1}`, tags: ["bush"], ctx: { w: s, d: s * B.between(0.7, 1.1), h: B.between(0.5, 1.1) } });
    const yaw = B.between(-1, 1);
    if (!g.fits(def, { pos, yaw, margin: 0.4 })) continue;
    g.place(def, { id: `bush-${nb + 1}`, tags: ["bush"], pos, yaw, on: "auto" });
    nb += 1;
  }

  // The hero: an anthro animal on the plaza, driven by the player (or strolling to the benches).
  g.spawn({ id: "hero", kind: "anthro", tags: ["hero"], size: 1, pos: [0, plazaTop + 0.3, -1.2], yaw: 0, brain: "stroll", player: true, materials: HERO_MATERIALS, tuning: { runSpeed: 5.5, jump: 7.2 } });

  // Animals about the lawn and the plaza.
  const animals = g.int("animals", 2, 3);
  const A = g.stream("animals");
  for (let i = 1; i <= animals; i += 1) {
    let pos: Vec3 = [0, top + 0.3, 2];
    for (let k = 0; k < 30; k += 1) {
      const p: Vec3 = [A.between(-G + 2, G - 2), top, A.between(-G + 2, G - 2)];
      if (g.fits(PROBE, { pos: p, margin: 0.3 }) && Math.hypot(p[0], p[2] + 1.2) > 2) { pos = [p[0], top + 0.3, p[2]]; break; }
    }
    g.spawn({ id: `animal-${i}`, kind: "animal", tags: ["animal"], pos, yaw: A.between(-3, 3), brain: "wander", materials: animalMaterials(i), mind: { home: [pos[0], pos[2]], range: G - 1.8 } });
  }
  world.focus = "hero";
}

// ---------------------------------------------------------------- brains

type Intent = Partial<EntityIntent>;
const toward = (from: Vec3Like, to: readonly [number, number]): [number, number, number] => { const dx = to[0] - from[0]; const dz = to[1] - from[2]; const l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l, l]; };

// (The one the frame camera is showing stands still for it.)
const posing = (world: World, ent: WorldEntity): boolean => world.camera?.mode === "frame" && (world.state["camera"] as { showing?: string } | undefined)?.showing === ent.id;

/** An animal's memory. */
interface WanderMind { state?: "idle" | "walk" | "sit"; until?: number; goal?: [number, number]; pace?: number; best?: number; stuck?: number; range?: number; home?: [number, number] }

/**
 * An animal: idle a while, wander to a point on the lawn, sometimes sit. Its
 * numbers come from its own stream (world.rng("mind:<id>")), so adding an
 * animal never changes what another does.
 */
export function wander(world: World, ent: WorldEntity, dt: number): Intent {
  const m = ent.mind as WanderMind;
  if (posing(world, ent) && m.state === "walk") return { move: [0, 0] };
  const R = world.rng(`mind:${ent.id}`);
  m.until = m.until ?? 0;
  m.state = m.state ?? "idle";
  if (world.time >= m.until) {
    if (m.state === "sit") ent.hold = null;
    m.state = R.weighted([["walk", 5], ["idle", 3], ["sit", 2]] as const);
    m.until = world.time + (m.state === "walk" ? R.between(3, 7) : R.between(1.5, 4));
    if (m.state === "walk") {
      const r = m.range ?? 8;
      m.goal = [R.between(-r, r), R.between(-r, r)];
      m.pace = R.between(0.35, 0.75);
      m.best = Infinity;
      m.stuck = 0;
    }
    if (m.state === "sit") ent.hold = { clip: "sit" };
  }
  if (m.state !== "walk") return { move: [0, 0], jump: false, hold: false };
  const [x, z, d] = toward(ent.body.pos, m.goal!);
  // (Stuck on a hedge or a bench: give up on that goal and stand a moment.)
  if (d < m.best! - 0.05) { m.best = d; m.stuck = 0; } else m.stuck! += dt;
  if (d < 0.4 || m.stuck! > 1.2) { m.state = "idle"; m.until = world.time + R.between(0.8, 2); return { move: [0, 0] }; }
  return { move: [x * m.pace!, z * m.pace!], jump: false, hold: false };
}

/** The hero's memory. */
interface StrollMind { state?: "pause" | "walk" | "sit"; until?: number; bench?: string; goal?: [number, number]; best?: number; stuck?: number }
const seatOf = (world: World, id: string): WorldSocket & { dir: Vec3; yaw: number } => socketOf(world.objects.get(id)!, "seat") as WorldSocket & { dir: Vec3; yaw: number };

/**
 * The hero when nobody drives: walk to a bench, sit on it a while (the body
 * put on the seat, the sit clip held at the seat's height), stand, wander, go
 * to another. Taking over mid-sit stands it up where it is.
 */
export function stroll(world: World, ent: WorldEntity, dt: number): Intent {
  const m = ent.mind as StrollMind;
  const R = world.rng(`mind:${ent.id}`);
  m.state = m.state ?? "pause";
  m.until = m.until ?? 1;
  const benches = [...world.objects.values()].filter((o) => o.tags.includes("bench")).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (m.state === "sit") {
    if (world.time < m.until) return { move: [0, 0] };
    // (Up, and a step out in front of the bench.)
    const s = seatOf(world, m.bench!);
    ent.hold = null;
    ent.frozen = false;
    world.teleport(ent.id, [s.pos[0] + s.dir[0] * 0.7, ent.body.pos[1], s.pos[2] + s.dir[2] * 0.7], s.yaw);
    m.state = "pause";
    m.until = world.time + R.between(1, 2.5);
  }
  if (m.state === "pause") {
    if (world.time < m.until) return { move: [0, 0] };
    if (!benches.length) { m.state = "pause"; m.until = world.time + 5; return { move: [0, 0] }; }
    const b = benches[R.int(0, benches.length - 1)]!;
    const s = socketOf(b, "seat") as WorldSocket & { dir: Vec3 };
    m.bench = String(b.id);
    m.goal = [s.pos[0] + s.dir[0] * 0.75, s.pos[2] + s.dir[2] * 0.75];
    m.state = "walk";
    m.best = Infinity;
    m.stuck = 0;
  }
  if (posing(world, ent)) return { move: [0, 0] };
  const [x, z, d] = toward(ent.body.pos, m.goal!);
  if (d < m.best! - 0.03) { m.best = d; m.stuck = 0; } else m.stuck! += dt;
  if (m.stuck! > 2) { m.state = "pause"; m.until = world.time + 0.5; return { move: [0, 0] }; }
  if (d < 0.18) {
    // Sit: the body onto the seat (its hips over it), facing the way the seat faces.
    const s = seatOf(world, m.bench!);
    world.teleport(ent.id, [s.pos[0], ent.body.pos[1], s.pos[2]], s.yaw);
    ent.frozen = true;
    ent.hold = { clip: "sit", params: { seat: s.pos[1] - ent.body.pos[1] } };
    m.state = "sit";
    m.until = world.time + R.between(4, 8);
    return { move: [0, 0] };
  }
  const pace = Math.min(0.5, 0.18 + d * 0.2); // (walks up, slowing to arrive)
  return { move: [x * pace, z * pace], jump: false, hold: false };
}

// ---------------------------------------------------------------- fx (frame passes)

/**
 * GARDEN's own passes, by name, for the setting "render.fx": they change what
 * the renderer is handed. (Any other name there -- glow, fog, vignette,
 * scanlines, grade, rim ... -- is one of the renderer's own fx passes.)
 */
export const FX: Readonly<Record<string, NonNullable<FxPass["frame"]>>> = {
  // Low sun, long shadows.
  dusk: (f) => ({ ...f, view: { ...f.view, sun: [0.8, 0.3, -0.25] } }),
  // Mist rolling in: the renderer's fog start pulled close.
  mist: (f) => ({ ...f, view: { ...f.view, fogNear: 6, fogFar: 32 } }),
  // Lamps and screens turned up.
  lantern: (f) => ({ ...f, materials: f.materials.map((m, i) => (MATERIALS[i]!.name === "glow" ? { ...m, glow: 0.8 } : m)) }),
};

// ---------------------------------------------------------------- the world

export interface GardenOptions {
  readonly seed?: string;
  readonly width?: number;
  readonly height?: number;
  /** "scope/key=value;..." (parseLocks). */
  readonly locks?: string;
  /** A scene scope's settings. */
  readonly scene?: LayerValues;
  readonly input?: WorldOptions["input"];
}

/** A generated garden world, with GARDEN's materials, palettes, brains, fx, particles and a petal system. */
export function gardenWorld({ seed = "1", width = 128, height = 128, locks = "", scene = {}, input }: GardenOptions = {}): World {
  const world = createWorld({
    seed, width, height,
    config: { project: PROJECT, scene, ...TAGS, locks },
    materials: MATERIALS,
    palettes: PALETTES,
    input,
    // (A thin camera: the animals are small and hedges close, and the arm needs its radius of room from their middles.)
    camera: { frame: { turn: 0.5, radius: 0.1 }, orbit: { distance: 3.2, radius: 0.12 }, chase: { distance: 3.4, height: 1.2, radius: 0.12 } },
    particles: { recipes: { petal: { life: [2.5, 4.5], speed: [0.1, 0.4], up: [-0.25, -0.05], gravity: 0, drag: 0.1, size: [0.5, 0.8], light: [0.65, 0.95], fade: 0.5, ramp: "petal" } } },
  });
  world.brain("wander", wander).brain("stroll", stroll);
  for (const [name, pass] of Object.entries(FX)) world.fx(name, pass);
  // Petals drifting over the lawn, and dust where feet land.
  world.system("petals", {
    order: 610,
    step(w) {
      const S = w.rng("petals");
      if (S.chance(0.05)) w.particles.emit("petal", [S.between(-12, 12), S.between(1.5, 4), S.between(-12, 12)], { count: 1, S });
    },
  });
  world.on("landed", (e, w) => { w.particles.emit("dust", e.at!, { count: Math.min(8, 2 + Math.round(e["speed"] as number)), spread: 1.2 }); });
  world.generate({ name: "garden", build: gardenGenerator });
  return world;
}
