// Particles: a pool of points in the world, each with a lightness and a palette
// ramp, drawn by the pixel renderer in the same palette as everything else.
// Emitters are small recipes -- a puff of dust, a spray of sparks, a splash,
// motes hanging in the air -- and every one takes a seeded stream, so a scene
// that plays itself plays the same each time.
//
//   const ps = createParticles(600);
//   ps.emit("dust", at, { count: 6, S, vel });
//   ps.step(dt); renderer.render({ ..., particles: ps.list() });

const RECIPES = {
  // Kicked-up dust: a few soft puffs, out and up, slowing, fading.
  dust: { life: [0.35, 0.7], speed: [0.4, 1.4], up: [0.3, 1.2], gravity: -0.4, drag: 3, size: [0.9, 1.6], light: [0.72, 0.9], fade: 0.5, ramp: "stone" },
  // Sparks off a rail: fast, streaking back, falling.
  spark: { life: [0.15, 0.4], speed: [1, 3.5], up: [0.5, 2.5], gravity: 14, drag: 0.5, size: [0.5, 0.9], light: [0.75, 1], fade: 0.7, ramp: "spark" },
  // Water thrown up by a foot on the surface.
  splash: { life: [0.3, 0.6], speed: [0.5, 2], up: [1.5, 3.5], gravity: 12, drag: 0.8, size: [0.6, 1.1], light: [0.8, 1], fade: 0.4, ramp: "water" },
  // Motes: specks hanging and drifting.
  mote: { life: [2, 4], speed: [0.05, 0.2], up: [-0.05, 0.1], gravity: 0, drag: 0.2, size: [0.5, 0.8], light: [0.6, 0.95], fade: 0.5, ramp: "stone" },
};

export function createParticles(max = 600) {
  const pool = [];
  const lerp = (S, [a, b]) => a + (b - a) * S.f();
  return {
    recipes: RECIPES,
    /** Emit `count` of a recipe at a point, with an extra velocity (the thing that threw them). */
    emit(kind, at, { count = 4, S, vel = [0, 0, 0], spread = 1, ramp } = {}) {
      const R = RECIPES[kind];
      for (let i = 0; i < count && pool.length < max; i += 1) {
        const a = S.f() * Math.PI * 2;
        const sp = lerp(S, R.speed) * spread;
        pool.push({
          p: [...at], v: [vel[0] + Math.cos(a) * sp, vel[1] + lerp(S, R.up), vel[2] + Math.sin(a) * sp],
          age: 0, life: lerp(S, R.life), size: lerp(S, R.size), light: lerp(S, R.light), ramp: ramp ?? R.ramp, R,
        });
      }
    },
    step(dt) {
      for (let i = pool.length - 1; i >= 0; i -= 1) {
        const q = pool[i];
        q.age += dt;
        if (q.age >= q.life) { pool.splice(i, 1); continue; }
        const k = Math.exp(-q.R.drag * dt);
        q.v[0] *= k; q.v[2] *= k;
        q.v[1] = q.v[1] * k - q.R.gravity * dt;
        q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      }
    },
    /** What the renderer draws: each one dimming as it goes. */
    list() {
      return pool.map((q) => ({ p: q.p, size: q.size, ramp: q.ramp, light: q.light * (1 - q.R.fade * (q.age / q.life)) }));
    },
    get count() { return pool.length; },
  };
}
