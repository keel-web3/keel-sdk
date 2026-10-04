// The world's particles: src/particles' recipes and motion, kept as plain
// data so a snapshot can save them. (src/particles/particles.js keeps its pool
// in a closure; this is the same step, the same draws in the same order, the
// same list() -- with the pool out in the open. Add recipes to `recipes`.)
//
//   world.particles.emit("dust", at, { count: 4, vel, spread, ramp });   // draws from world.rng("particles")
//   world.particles.list()   // [{ p, size, ramp, light }] for the renderer

import { createParticles } from "../particles/particles.js";

/** Recipes by name (the engine's dust/spark/splash/mote, plus a project's own). */
export const baseRecipes = () => ({ ...createParticles(0).recipes });

export function createWorldParticles({ max = 600, recipes = baseRecipes(), stream } = {}) {
  let pool = [];
  const lerp = (S, [a, b]) => a + (b - a) * S.f();
  const ps = {
    recipes,
    max,
    get count() { return pool.length; },
    /** Emit `count` of a recipe at a point (S: a stream; the world's "particles" stream by default). */
    emit(kind, at, { count = 4, S = stream(), vel = [0, 0, 0], spread = 1, ramp } = {}) {
      const R = recipes[kind];
      if (!R) throw new RangeError(`No particle recipe "${kind}" (${Object.keys(recipes).join(", ")}).`);
      for (let i = 0; i < count && pool.length < ps.max; i += 1) {
        const a = S.f() * Math.PI * 2;
        const sp = lerp(S, R.speed) * spread;
        pool.push({
          kind, p: [...at], v: [vel[0] + Math.cos(a) * sp, vel[1] + lerp(S, R.up), vel[2] + Math.sin(a) * sp],
          age: 0, life: lerp(S, R.life), size: lerp(S, R.size), light: lerp(S, R.light), ramp: ramp ?? R.ramp,
        });
      }
    },
    step(dt) {
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const q = pool[i];
        const R = recipes[q.kind];
        q.age += dt;
        if (q.age >= q.life) { pool.splice(i, 1); continue; }
        const k = Math.exp(-R.drag * dt);
        q.v[0] *= k; q.v[2] *= k;
        q.v[1] = q.v[1] * k - R.gravity * dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      }
    },
    /** What the renderer draws: each one dimming as it goes; `sizeScale` from the target rules. */
    list(sizeScale = 1) {
      return pool.map((q) => ({ p: q.p, size: q.size * sizeScale, ramp: q.ramp, light: q.light * (1 - recipes[q.kind].fade * (q.age / q.life)) }));
    },
    clear() { pool = []; },
    save() { return pool.map((q) => ({ ...q, p: [...q.p], v: [...q.v] })); },
    load(list) { pool = list.map((q) => ({ ...q, p: [...q.p], v: [...q.v] })); },
  };
  return ps;
}
