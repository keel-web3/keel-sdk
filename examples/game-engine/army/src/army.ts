// The army's simulation: thousands of units wandering a square map on a
// fixed step. Each unit walks, runs (or trots, gallops) to a point it picked,
// stands a while, picks another; neighbours push apart. Typed arrays and the
// bake package's spatial grid, so ten thousand units cost a millisecond or two
// a step. Deterministic from the seed: randomness from core's seeded streams.

import { createRoll, deriveSeed, stream } from "@keel/game-engine/core";
import type { Stream } from "@keel/game-engine/core";
import { createGrid } from "@keel/game-engine/bake";
import type { Grid } from "@keel/game-engine/bake";

/** What the sim needs of a design: a speed per gait (0 idle, 1 walk, 2 run / trot, 3 run / gallop) and its size. */
export interface UnitKind {
  readonly speeds: readonly [number, number, number, number];
  readonly radius: number;
}

export interface Army {
  readonly n: number;
  readonly map: number;
  /** Positions now and one step ago (the picture draws between them), heading, gait, design, distance walked (frames advance by it). */
  readonly x: Float32Array; readonly z: Float32Array;
  readonly px: Float32Array; readonly pz: Float32Array;
  readonly yaw: Float32Array;
  readonly gait: Uint8Array;
  /** Which kind each unit is (an index into `kinds`). */
  readonly design: Uint16Array;
  readonly dist: Float32Array;
  /** A per-unit time offset, so idle units don't breathe in step. */
  readonly phase: Float32Array;
  readonly grid: Grid;
  readonly time: number;
  step(dt: number): void;
}

export const TURN = 4; // rad/s

/** `designOf` gives each unit its kind (default: drawn from the seed); `speedOf` its own pace, a factor on its kind's speeds (default 1). */
export function createArmy(seed: string, kinds: readonly UnitKind[], n: number, map: number, designOf?: (i: number) => number, speedOf?: (i: number) => number): Army {
  const S: Stream = stream(createRoll(deriveSeed(seed, "army/sim")), 0);
  const x = new Float32Array(n), z = new Float32Array(n), px = new Float32Array(n), pz = new Float32Array(n), yaw = new Float32Array(n);
  const tx = new Float32Array(n), tz = new Float32Array(n), timer = new Float32Array(n), dist = new Float32Array(n), phase = new Float32Array(n);
  const gait = new Uint8Array(n), design = new Uint16Array(n);
  const pace = Float32Array.from({ length: n }, (_, i) => speedOf?.(i) ?? 1);
  const grid = createGrid({ cell: 4, capacity: n });
  const pick = (i: number) => {
    // Somewhere within 30 m, on the map; walk mostly, sometimes run.
    const a = S.f() * Math.PI * 2, r = 4 + S.f() * 26;
    tx[i] = Math.min(map - 1, Math.max(1, x[i]! + Math.sin(a) * r));
    tz[i] = Math.min(map - 1, Math.max(1, z[i]! + Math.cos(a) * r));
    const g = S.f();
    gait[i] = g < 0.62 ? 1 : g < 0.85 ? 2 : 3;
  };
  for (let i = 0; i < n; i += 1) {
    const drawn = Math.floor(S.f() * kinds.length);
    design[i] = designOf ? designOf(i) : drawn;
    x[i] = px[i] = S.f() * map;
    z[i] = pz[i] = S.f() * map;
    yaw[i] = S.f() * Math.PI * 2;
    phase[i] = S.f() * 10;
    if (S.chance(0.35)) { gait[i] = 0; timer[i] = S.f() * 4; } else pick(i);
    grid.set(i, x[i]!, z[i]!, kinds[design[i]!]!.radius);
  }
  const near: number[] = [];
  let time = 0;
  let tick = 0;
  return {
    n, map, x, z, px, pz, yaw, gait, design, dist, phase, grid,
    get time() { return time; },
    step(dt) {
      time += dt;
      tick += 1;
      px.set(x); pz.set(z);
      for (let i = 0; i < n; i += 1) {
        const kind = kinds[design[i]!]!;
        const g = gait[i]!;
        if (g === 0) {
          timer[i] = timer[i]! - dt;
          if (timer[i]! <= 0) pick(i);
          continue;
        }
        const dx = tx[i]! - x[i]!, dz = tz[i]! - z[i]!;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.6) { gait[i] = 0; timer[i] = 1 + S.f() * 4; continue; }
        // Turn toward the target (at most TURN rad/s), then go where it faces -- slower while turning hard.
        const want = Math.atan2(dx, dz);
        let turn = want - yaw[i]!;
        turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
        const most = TURN * dt;
        yaw[i] = yaw[i]! + (turn > most ? most : turn < -most ? -most : turn);
        const speed = kind.speeds[g]! * pace[i]! * (0.35 + 0.65 * Math.max(0, Math.cos(turn)));
        let vx = Math.sin(yaw[i]!) * speed, vz = Math.cos(yaw[i]!) * speed;
        // Separation: a quarter of the units a step look for neighbours and step aside.
        if ((i & 3) === (tick & 3)) {
          near.length = 0;
          grid.near(x[i]!, z[i]!, kind.radius * 2, near);
          for (const j of near) {
            if (j === i) continue;
            const ox = x[i]! - x[j]!, oz = z[i]! - z[j]!;
            const od = Math.sqrt(ox * ox + oz * oz) || 1e-3;
            const push = (kind.radius + kinds[design[j]!]!.radius - od) * 6;
            if (push > 0) { vx += (ox / od) * push; vz += (oz / od) * push; }
          }
        }
        const nx = Math.min(map, Math.max(0, x[i]! + vx * dt)), nz = Math.min(map, Math.max(0, z[i]! + vz * dt));
        const mx = nx - x[i]!, mz = nz - z[i]!;
        dist[i] = dist[i]! + Math.sqrt(mx * mx + mz * mz);
        x[i] = nx; z[i] = nz;
        grid.set(i, nx, nz, kind.radius);
      }
    },
  };
}
