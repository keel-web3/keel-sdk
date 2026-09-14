// Units walking the level: structure-of-arrays, a fixed step, every unit
// heading down a flow field toward its goal (a few goals, a field each,
// shared by everyone going there: @keel-engine/terrain's flow cache), and on
// to another goal when it arrives -- after standing about a while, now and
// then sparring (keel/entity's attack). No per-unit search; the step is a
// table read and a few multiplies a unit. Deterministic (seeded streams).
//
// One unit can be POSSESSED: its flow field is suspended and it's driven by
// commands (keel/view's command stream: move, face, act per tick) through the
// same ground rules -- never off a cliff -- until it's released back to its AI.

import { namedStream } from "@keel/game-engine/world";
import { createFlowCache, flowField, steer } from "@keel/game-engine/terrain";
import { FLAG } from "@keel/game-engine/terrain";
import type { FlowCache, FlowField, PathGrid, Terrain } from "@keel/game-engine/terrain";
import { ACT, newDriven, stepPossessed } from "@keel/game-engine/view";
import type { Driven, PossessCommand } from "@keel/game-engine/view";

/** Gaits: what a unit's clip is. */
export const GAIT = { idle: 0, walk: 1, run: 2, attack: 3 } as const;

/** Per unit, what its body does: its walking and running speeds (m/s). */
export interface UnitBodies {
  readonly walk: (u: number) => number;
  readonly run: (u: number) => number;
}

export interface Units {
  readonly n: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly y: Float32Array;
  /** Last step's position (for drawing between steps). */
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly yaw: Float32Array;
  /** A design index per unit (the old capsule figures; kept for callers that draw by design). */
  readonly design: Uint8Array;
  readonly goal: Uint16Array;
  readonly goals: ReadonlyArray<readonly [number, number]>;
  readonly fields: FlowCache;
  /** GAIT per unit, distance walked (its stride's phase), its speed now, how long into an action. */
  readonly gait: Uint8Array;
  readonly dist: Float32Array;
  readonly speed: Float32Array;
  readonly actionT: Float32Array;
  /** The possessed unit (-1: none) and its driven state. */
  readonly possessed: number;
  readonly driven: Driven | null;
  possess(u: number): void;
  release(): void;
  /** One fixed step; `commands` drive the possessed unit (keel/view's command stream, this tick's). */
  step(dt: number, commands?: readonly PossessCommand[]): void;
  /** How long the last step took (ms). */
  readonly stepMs: number;
  /** The sim clock (s). */
  readonly time: number;
}

const ATTACK_TIME = 0.62;

export function createUnits(seed: string, t: Terrain, grid: PathGrid, goalsIn: ReadonlyArray<readonly [number, number]>, count: number, designs: number, bodies?: UnitBodies): Units {
  const S = namedStream(seed, "level-demo:units");
  const R = namedStream(seed, "level-demo:units/life"); // (standing about, sparring, running: their own stream)
  // (A goal on blocked ground -- a house -- moves to the nearest tile a unit can stand on.)
  const nearestPassable = ([i, j]: readonly [number, number]): readonly [number, number] | null => {
    for (let r = 0; r < 6; r += 1) for (let dj = -r; dj <= r; dj += 1) for (let di = -r; di <= r; di += 1) if (Math.max(Math.abs(di), Math.abs(dj)) === r && grid.passable(i + di, j + dj)) return [i + di, j + dj];
    return null;
  };
  const goals = goalsIn.map(nearestPassable).filter((g): g is readonly [number, number] => g !== null);
  if (!goals.length) throw new Error("No goal a unit can reach.");
  const x = new Float32Array(count), z = new Float32Array(count), y = new Float32Array(count), px = new Float32Array(count), pz = new Float32Array(count), yaw = new Float32Array(count);
  const design = new Uint8Array(count), goal = new Uint16Array(count), speed = new Float32Array(count);
  const gait = new Uint8Array(count), dist = new Float32Array(count), speedNow = new Float32Array(count), actionT = new Float32Array(count), wait = new Float32Array(count), pace = new Float32Array(count);
  const ts = t.tileSize;
  const fields = createFlowCache({ capacity: 64 });
  const fieldOf = (g: number): FlowField => fields.get(`goal:${g}`, (into) => flowField(grid, [goals[g]!], into ? { into } : {}));
  // Spawn round the goals, on passable ground a field reaches.
  for (let u = 0; u < count; u += 1) {
    const home = S.int(0, goals.length - 1);
    const f = fieldOf((home + 1) % goals.length);
    let i = goals[home]![0], j = goals[home]![1];
    for (let tries = 0; tries < 40; tries += 1) {
      const a = i + S.int(-12, 12), b = j + S.int(-12, 12);
      if (grid.passable(a, b) && f.dist[b * t.width + a] !== 0xffffffff) { i = a; j = b; break; }
    }
    x[u] = px[u] = (i + 0.2 + S.f() * 0.6) * ts;
    z[u] = pz[u] = (j + 0.2 + S.f() * 0.6) * ts;
    y[u] = t.heightAt(x[u]!, z[u]!);
    design[u] = S.int(0, designs - 1);
    goal[u] = (home + 1) % goals.length;
    speed[u] = 1.6 + S.f() * 1.2;
    // (A body's own pace: mostly walking at its walk, a few running; some start standing.)
    const run = R.f() < 0.18;
    gait[u] = R.f() < 0.25 ? GAIT.idle : run ? GAIT.run : GAIT.walk;
    pace[u] = run ? 1 : 0;
    if (bodies) speed[u] = (run ? bodies.run(u) : bodies.walk(u)) * (0.9 + R.f() * 0.2);
    if (gait[u] === GAIT.idle) wait[u] = R.f() * 5;
    yaw[u] = R.f() * Math.PI * 2;
  }
  const dir: [number, number] = [0, 0];
  let stepMs = 0, time = 0;
  // dir8 of a one-tile step (dx, dz in -1..1) -> its bit in the grid's links.
  const BIT = [[5, 6, 7], [4, -1, 0], [3, 2, 1]];
  const canStep = (i: number, j: number, a: number, b: number): boolean => {
    if (a === i && b === j) return true;
    if (a < 0 || b < 0 || a >= t.width || b >= t.depth || Math.abs(a - i) > 1 || Math.abs(b - j) > 1) return false;
    const d = BIT[a - i + 1]![b - j + 1]!;
    return (grid.links[j * t.width + i]! & (1 << d)) !== 0;
  };
  /** Where a step from (ox, oz) toward (nx, nz) ends: across tiles only where the grid links them (slide along one axis, or wait). */
  const move = (ox: number, oz: number, nx: number, nz: number): readonly [number, number] => {
    const oi = Math.floor(ox / ts), oj = Math.floor(oz / ts);
    if (canStep(oi, oj, Math.floor(nx / ts), Math.floor(nz / ts))) return [nx, nz];
    if (canStep(oi, oj, Math.floor(nx / ts), oj)) return [nx, oz];
    if (canStep(oi, oj, oi, Math.floor(nz / ts))) return [ox, nz];
    return [ox, oz];
  };
  const groundY = (nx: number, nz: number): number => {
    const ci = Math.floor(nx / ts), cj = Math.floor(nz / ts);
    // (On a bridge's deck, its level; else the ground's.)
    const ck = cj * t.width + ci;
    return ci >= 0 && cj >= 0 && ci < t.width && cj < t.depth && t.flags[ck]! & FLAG.BRIDGE ? t.deck[ck]! * t.stepHeight : t.heightAt(nx, nz);
  };
  let possessed = -1;
  let driven: Driven | null = null;
  const rules = { walk: 2.4, run: 5.6, turn: 10, move };
  const units: Units = {
    n: count, x, z, y, px, pz, yaw, design, goal, goals, fields, gait, dist, speed: speedNow, actionT,
    get possessed() { return possessed; },
    get driven() { return driven; },
    get stepMs() { return stepMs; },
    get time() { return time; },
    possess(u) {
      if (u < 0 || u >= count) return;
      units.release();
      possessed = u;
      driven = newDriven(x[u]!, z[u]!, yaw[u]!);
      driven.dist = dist[u]!;
    },
    release() {
      if (possessed < 0) return;
      // (Back to its AI: on toward its goal, from where it was left.)
      gait[possessed] = GAIT.walk; actionT[possessed] = 0;
      possessed = -1; driven = null;
    },
    step(dt, commands = []) {
      const t0 = performance.now();
      time += dt;
      for (let u = 0; u < count; u += 1) {
        px[u] = x[u]!; pz[u] = z[u]!;
        if (u === possessed && driven) {
          const c = commands.find((q) => q.unit === u) ?? null;
          stepPossessed(driven, c, dt, rules);
          x[u] = driven.x; z[u] = driven.z; yaw[u] = driven.yaw; dist[u] = driven.dist; speedNow[u] = driven.speed;
          y[u] = groundY(driven.x, driven.z);
          gait[u] = driven.action === ACT.attack ? GAIT.attack : driven.speed > 3.6 ? GAIT.run : driven.speed > 0.2 ? GAIT.walk : GAIT.idle;
          actionT[u] = driven.actionT;
          continue;
        }
        // Standing about (now and then sparring), then off again.
        if (gait[u] === GAIT.idle || gait[u] === GAIT.attack) {
          speedNow[u] = 0;
          if (gait[u] === GAIT.attack) { actionT[u] = actionT[u]! + dt; if (actionT[u]! >= ATTACK_TIME) { gait[u] = GAIT.idle; actionT[u] = 0; } }
          wait[u] = wait[u]! - dt;
          if (gait[u] === GAIT.idle && R.f() < dt * 0.08) { gait[u] = GAIT.attack; actionT[u] = 0; }
          if (wait[u]! > 0 || gait[u] === GAIT.attack) continue;
          gait[u] = pace[u] ? GAIT.run : GAIT.walk;
        }
        const g = goal[u]!;
        const f = fieldOf(g);
        // (On the goal's tile: stand a while, then on to another goal.)
        const here = Math.floor(z[u]! / ts) * t.width + Math.floor(x[u]! / ts);
        steer(f, x[u]!, z[u]!, ts, dir);
        if (f.dist[here] === 0 || (dir[0] === 0 && dir[1] === 0)) {
          goal[u] = (g + 1 + (u % Math.max(1, goals.length - 1))) % goals.length;
          gait[u] = GAIT.idle; wait[u] = 1.5 + R.f() * 5;
          continue;
        }
        const v = speed[u]! * dt;
        const [nx, nz] = move(x[u]!, z[u]!, x[u]! + dir[0] * v, z[u]! + dir[1] * v);
        const moved = Math.hypot(nx - x[u]!, nz - z[u]!);
        dist[u] = dist[u]! + moved;
        speedNow[u] = moved / dt;
        x[u] = nx; z[u] = nz;
        y[u] = groundY(nx, nz);
        // (Turning toward where it goes, not snapping: a 16-direction sprite shows every step of a turn.)
        const want = Math.atan2(dir[0], dir[1]);
        let d = want - yaw[u]!;
        d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
        const most = 7 * dt;
        yaw[u] = yaw[u]! + (d > most ? most : d < -most ? -most : d);
      }
      stepMs = performance.now() - t0;
    },
  };
  return units;
}
