// A character's body: kinematic, stepped at a fixed rate, colliding with the
// same boxes the renderer draws. Its moves are modes -- on the ground, in the
// air, running along a wall, grinding a rail, skimming the water -- each with
// the few rules that make it feel right (coyote time and a buffered jump on
// the ground; light gravity and a kick off on a wall; a rail that holds you
// and slopes you; water that holds you only while you're fast).
//
//   const body = createCharacter({ boxes, wedges, rails, waterY, spawn });
//   body.step(dt, { move: [x, z], jump: pressed, hold: held });
//   body.pos, body.vel, body.mode, body.events (landed, jumped, wallStart, ...)
//
// Wedges are ramps: a box whose top slopes (see wedgeDistance). Up to
// `slopeMax` the body stands on one and runs up and down it; steeper, it
// slides. A world without wedges steps exactly as it did before they existed
// (tests/physics-golden.test.mjs pins it to the bit).

export const TUNING = {
  radius: 0.26, gravity: 24, runSpeed: 9.5, runAccel: 48, friction: 30, airAccel: 16, jump: 8.6,
  coyote: 0.1, buffer: 0.12, wallMin: 4.5, wallGravity: 0.16, wallTime: 1.35, wallKick: 7.5, wallUp: 7.4,
  railSnap: 0.45, railLift: 0.28, railPush: 3, railCruise: 11, railMax: 14, skimMin: 6.5, skimDrag: 1.4, respawn: 0.9,
  slopeMax: 42, // (degrees: a wedge up to this stands and runs; steeper slides)
  maxFall: 30, // (m/s: never faster than radius x 120 Hz, so nothing is fallen through)
  stepDown: 0.3, // (m: off a ramp's crest the feet find the floor this far below)
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Distance from p to a box turned by yaw about y, and the outward normal there. */
export function boxDistance(p, b) {
  const c = Math.cos(b.yaw ?? 0);
  const s = Math.sin(b.yaw ?? 0);
  const x = p[0] - b.c[0];
  const y = p[1] - b.c[1];
  const z = p[2] - b.c[2];
  const l = [c * x - s * z, y, s * x + c * z]; // (world -> the box's frame: core/frame.js worldToLocal)
  const q = [Math.abs(l[0]) - b.h[0], Math.abs(l[1]) - b.h[1], Math.abs(l[2]) - b.h[2]];
  const o = [Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)];
  const out = len(o);
  let n;
  let d;
  if (out > 0) { d = out; n = [Math.sign(l[0]) * o[0] / out, Math.sign(l[1]) * o[1] / out, Math.sign(l[2]) * o[2] / out]; }
  else {
    const k = q[0] > q[1] ? (q[0] > q[2] ? 0 : 2) : q[1] > q[2] ? 1 : 2;
    d = q[k];
    n = [0, 0, 0];
    n[k] = Math.sign(l[k]) || 1;
  }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

// The exact distance to a convex polygon in 2D, and its outward gradient (edges of zero length are skipped).
function polyDistance(u, v, P) {
  let best = Infinity;
  let gu = 0;
  let gv = 0;
  let inside = true;
  let far = -Infinity;
  let fu = 0;
  let fv = 0;
  for (let i = 0; i < P.length; i += 1) {
    const [au, av] = P[i];
    const [bu, bv] = P[(i + 1) % P.length];
    const eu = bu - au;
    const ev = bv - av;
    const L2 = eu * eu + ev * ev;
    if (L2 < 1e-18) continue;
    const t = Math.max(0, Math.min(1, ((u - au) * eu + (v - av) * ev) / L2));
    const du = u - (au + eu * t);
    const dv = v - (av + ev * t);
    const d = Math.hypot(du, dv);
    if (d < best) { best = d; gu = du; gv = dv; }
    // (Counter-clockwise: the outward normal of an edge is (ev, -eu).)
    const L = Math.sqrt(L2);
    const s = ((u - au) * ev - (v - av) * eu) / L;
    if (s > 0) inside = false;
    if (s > far) { far = s; fu = ev / L; fv = -eu / L; }
  }
  if (inside) return { d: far, gu: fu, gv: fv };
  return { d: best, gu: gu / (best || 1), gv: gv / (best || 1) };
}

/** A wedge's cross-section (local z, y), counter-clockwise: the foot at +z, rising to its full height at -z. */
export function wedgeSection({ h, lo = 0 }) {
  const f = Math.max(0, Math.min(0.98, lo));
  return [[-h[2], -h[1]], [h[2], -h[1]], [h[2], -h[1] + 2 * h[1] * f], [-h[2], h[1]]];
}
/** A wedge's slope in radians (0 flat, PI/2 a wall). */
export const slopeOf = ({ h, lo = 0 }) => Math.atan2(2 * h[1] * (1 - Math.max(0, Math.min(0.98, lo))), 2 * h[2]);

/**
 * Distance from p to a wedge -- a ramp: a box { c, h, yaw } whose top slopes,
 * rising from its foot at local +z (`lo` x its height there, default 0) to its
 * full height at local -z; so its slope looks along frontOf(yaw), the way the
 * catalogue's ramps face -- and the outward normal there. Exact inside and out.
 */
export function wedgeDistance(p, w) {
  const c = Math.cos(w.yaw ?? 0);
  const s = Math.sin(w.yaw ?? 0);
  const x = p[0] - w.c[0];
  const y = p[1] - w.c[1];
  const z = p[2] - w.c[2];
  const lx = c * x - s * z; // (world -> the wedge's frame, as boxDistance)
  const lz = s * x + c * z;
  const a = Math.abs(lx) - w.h[0];
  const sec = polyDistance(lz, y, wedgeSection(w));
  const b = sec.d;
  let n;
  let d;
  if (a > 0 && b > 0) { d = Math.hypot(a, b); n = [(Math.sign(lx) * a) / d, (sec.gv * b) / d, (sec.gu * b) / d]; }
  else if (a > b) { d = a; n = [Math.sign(lx) || 1, 0, 0]; }
  else { d = b; n = [0, sec.gv, sec.gu]; }
  return { d, n: [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]] };
}

/** Distance to any solid: a box, or a wedge ({ kind: "wedge" }). */
export const solidDistance = (p, b) => (b.kind === "wedge" ? wedgeDistance(p, b) : boxDistance(p, b));

/** The nearest point on a rail (a polyline) to p: segment, fraction, the point, its tangent. */
export function nearestOnRail(p, rail) {
  let best = null;
  for (let i = 0; i < rail.length - 1; i += 1) {
    const a = rail[i];
    const b = rail[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = dot(ab, ab);
    const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1], p[2] - a[2]], ab) / L2));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (!best || d < best.d) { const l = Math.sqrt(L2); best = { d, i, t, q, tan: [ab[0] / l, ab[1] / l, ab[2] / l], segLen: l }; }
  }
  return best;
}

export function createCharacter({ boxes = [], wedges = [], rails = [], waterY = 0, spawn = [0, 1, 0], tuning = {} }) {
  const K = { ...TUNING, ...tuning };
  // (A box with kind "wedge" is a wedge -- the renderer's setWorld reads it the same way. A list with none is kept as given.)
  if (boxes.some((b) => b.kind === "wedge")) { wedges = [...wedges, ...boxes.filter((b) => b.kind === "wedge")]; boxes = boxes.filter((b) => b.kind !== "wedge"); }
  const walkable = Math.cos((K.slopeMax * Math.PI) / 180);
  const body = {
    pos: [...spawn], vel: [0, 0, 0], mode: "air", facing: 0, time: 0,
    wall: null, wallFace: null, wallTime: 0, rail: null, railS: 0, railDir: 1, coyote: 0, buffer: 0, sinking: 0,
    checkpoint: [...spawn], events: [], slope: null,
  };
  const emit = (type, extra = {}) => body.events.push({ type, at: [...body.pos], ...extra });

  // Push the body's spheres out of every box; report what it stands on and what it leans on.
  function collide() {
    let ground = null;
    let side = null;
    let sideBox = null;
    let slope = null;
    for (const h of [K.radius, 0.56, 0.86]) {
      for (const b of boxes) {
        const c = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = boxDistance(c, b);
        if (d < K.radius) {
          const push = K.radius - d;
          body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push;
          const vn = dot(body.vel, n);
          if (vn < 0) { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          if (n[1] > 0.65 && h === K.radius) ground = n;
          else if (Math.abs(n[1]) < 0.35) { side = n; sideBox = b; }
        } else if (h === K.radius && d < K.radius + 0.06 && n[1] > 0.65 && body.vel[1] <= 0.5) ground = n;
      }
      // Wedges: a walkable slope is stood on -- pushed out straight up and moved along it, not down it -- and a
      // steeper one pushes out along its normal, so the body slides. (Their sides aren't run on: not walls.)
      for (const w of wedges) {
        const c = [body.pos[0], body.pos[1] + h, body.pos[2]];
        const { d, n } = wedgeDistance(c, w);
        const stand = h === K.radius && n[1] > walkable;
        if (d < K.radius) {
          const push = K.radius - d;
          if (stand) body.pos[1] += push / n[1];
          else { body.pos[0] += n[0] * push; body.pos[1] += n[1] * push; body.pos[2] += n[2] * push; }
          const vn = dot(body.vel, n);
          if (vn < 0) {
            if (stand) body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1]; // (along the slope, the run kept)
            else { body.vel[0] -= n[0] * vn; body.vel[1] -= n[1] * vn; body.vel[2] -= n[2] * vn; }
          }
          if (stand) { ground = n; slope = n; }
        } else if (stand && d < K.radius + 0.06 && dot(body.vel, n) <= 0.5) { ground = n; slope = n; }
      }
    }
    return { ground, side, sideBox, slope: slope && ground === slope ? slope : null };
  }
  // The ground just below the feet (within stepDown), for staying on them over a ramp's crest.
  function groundBelow() {
    const c = [body.pos[0], body.pos[1] + K.radius, body.pos[2]];
    let best = null;
    const look = (list, wedge) => {
      for (const b of list) {
        const { d, n } = wedge ? wedgeDistance(c, b) : boxDistance(c, b);
        if (n[1] <= (wedge ? walkable : 0.65) || d < K.radius) continue;
        const drop = (d - K.radius) / n[1];
        if (drop < K.stepDown && (!best || drop < best.drop)) best = { drop, n, wedge };
      }
    };
    look(boxes, false);
    look(wedges, true);
    return best;
  }
  // A wall to run on: one that rises past the head (a floor's edge is a step), met on a face (not round an edge or an end).
  const runnable = (n, b) => {
    if (b.c[1] + b.h[1] < body.pos[1] + 1.1) return false;
    const c = Math.cos(b.yaw ?? 0);
    const s = Math.sin(b.yaw ?? 0);
    return Math.abs(n[0] * c - n[2] * s) > 0.99 || Math.abs(n[0] * s + n[2] * c) > 0.99;
  };
  // A wall beside the body, within reach of its middle.
  // (Running along one: only the same face counts -- past a thin wall's end the nearest point turns round
  // its corner, and following it would wrap the run onto the far side.)
  function wallBeside(face = null) {
    const c = [body.pos[0], body.pos[1] + 0.56, body.pos[2]];
    let best = null;
    for (const b of boxes) {
      const { d, n } = boxDistance(c, b);
      if (face && dot(n, face) < 0.99) continue;
      if (b.c[1] + b.h[1] < body.pos[1] + 1.1) continue; // (a wall rises past the head; a floor's edge is a step, not a wall)
      if (d < K.radius + 0.42 && Math.abs(n[1]) < 0.3 && (!best || d < best.d)) best = { d, n, b };
    }
    return best;
  }

  body.step = (dt, input) => {
    body.events.length = 0;
    body.time += dt;
    const move = input.move ?? [0, 0];
    const mlen = Math.min(1, Math.hypot(move[0], move[1]));
    const wish = mlen > 0.05 ? [move[0] / Math.hypot(move[0], move[1]), 0, move[1] / Math.hypot(move[0], move[1])] : null;
    if (input.jump) body.buffer = K.buffer; else body.buffer = Math.max(0, body.buffer - dt);
    const hv = [body.vel[0], 0, body.vel[2]];
    const hs = len(hv);

    if (body.mode === "sink") {
      body.sinking += dt;
      body.vel = [body.vel[0] * 0.9, -1.2, body.vel[2] * 0.9];
      body.pos[1] += body.vel[1] * dt;
      if (body.sinking > K.respawn) { body.pos = [...body.checkpoint]; body.vel = [0, 0, 0]; body.mode = "air"; body.sinking = 0; emit("respawn"); }
      return body;
    }

    if (body.mode === "grind") {
      const rail = rails[body.rail];
      const at = nearestOnRail(body.pos.map((v, i) => (i === 1 ? v - K.railLift : v)), rail);
      const tan = at.tan.map((v) => v * body.railDir);
      // (Downhill speeds it, uphill slows it, and it settles toward a rail's cruise -- never a fling.)
      let speed = dot(body.vel, tan) - K.gravity * tan[1] * dt * 0.8;
      speed += (K.railCruise - speed) * Math.min(1, 1.5 * dt);
      speed = Math.min(K.railMax, Math.max(4, speed));
      body.vel = tan.map((v) => v * speed);
      body.pos = [at.q[0] + body.vel[0] * dt, at.q[1] + K.railLift + body.vel[1] * dt, at.q[2] + body.vel[2] * dt];
      emit("grinding", { tan });
      const end = (body.railDir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (body.railDir < 0 && at.i === 0 && at.t < 0.02);
      if (body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.buffer = 0; body.coyote = 0; emit("jumped"); }
      else if (end) { body.mode = "air"; body.vel[1] += 2; emit("railEnd"); }
      body.facing = Math.atan2(body.vel[0], body.vel[2]);
      return body;
    }

    if (body.mode === "wall") {
      const w = wallBeside(body.wallFace);
      body.wallTime += dt;
      if (!w || body.wallTime > K.wallTime || hs < K.wallMin * 0.6) { body.mode = "air"; emit("wallEnd"); }
      else {
        const n = w.n;
        // Along the wall, the way it was going; a little into it so it holds; hardly any gravity.
        const along = [hv[0] - n[0] * dot(hv, n), 0, hv[2] - n[2] * dot(hv, n)];
        const al = len(along) || 1;
        const sp = Math.max(K.wallMin + 1, al);
        body.vel[0] = (along[0] / al) * sp - n[0] * 0.8;
        body.vel[2] = (along[2] / al) * sp - n[2] * 0.8;
        body.vel[1] -= K.gravity * K.wallGravity * dt;
        body.wall = n;
        emit("wallRunning", { n });
        if (body.buffer > 0) {
          body.vel = [body.vel[0] * 0.9 + n[0] * K.wallKick, K.wallUp, body.vel[2] * 0.9 + n[2] * K.wallKick];
          body.mode = "air"; body.buffer = 0; emit("wallJump", { n });
        }
      }
    }

    if (body.mode === "ground" || body.mode === "air" || body.mode === "skim") {
      const onGround = body.mode === "ground";
      const accel = onGround ? K.runAccel : body.mode === "skim" ? K.runAccel * 0.4 : K.airAccel;
      if (wish) {
        const target = [wish[0] * K.runSpeed * mlen, wish[2] * K.runSpeed * mlen];
        const dx = target[0] - body.vel[0];
        const dz = target[1] - body.vel[2];
        const dl = Math.hypot(dx, dz);
        const stepA = Math.min(dl, accel * dt);
        // (In the air, don't brake what the run carried: only add toward where it's steered.)
        if (onGround || dl > 0) { body.vel[0] += (dx / (dl || 1)) * stepA; body.vel[2] += (dz / (dl || 1)) * stepA; }
      } else if (onGround) {
        const f = Math.max(0, hs - K.friction * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
      }
      if (body.mode === "skim") {
        const f = Math.max(0, hs - K.skimDrag * dt) / (hs || 1);
        body.vel[0] *= f; body.vel[2] *= f;
        body.vel[1] = 0;
        body.pos[1] = waterY;
        emit("skimming");
        if (hs < K.skimMin * 0.9) { body.mode = "sink"; emit("splashIn"); return body; }
        if (body.buffer > 0) { body.vel[1] = K.jump * 0.9; body.mode = "air"; body.buffer = 0; emit("jumped"); }
      } else {
        if (onGround && body.slope) {
          // (On a ramp: along it, at the run's speed -- up it, down it, never sliding off it while stood on.)
          const n = body.slope;
          body.vel[1] = -(n[0] * body.vel[0] + n[2] * body.vel[2]) / n[1];
        } else body.vel[1] = Math.max(body.vel[1] - K.gravity * dt, -K.maxFall);
        if (body.coyote > 0 && body.buffer > 0) { body.vel[1] = K.jump; body.mode = "air"; body.coyote = 0; body.buffer = 0; emit("jumped"); }
        // Short hops: let go of jump early and the rise is cut.
        if (body.mode === "air" && body.vel[1] > 0 && !input.hold) body.vel[1] -= K.gravity * 1.4 * dt;
      }
    }

    // Move, then push out.
    body.pos[0] += body.vel[0] * dt; body.pos[1] += body.vel[1] * dt; body.pos[2] += body.vel[2] * dt;
    let { ground, side, sideBox, slope } = collide();
    // Over a ramp's crest either way (off its top, or off a floor onto it), stay on the feet: step down onto
    // what's just below. (Only to or from a wedge -- a world of boxes never takes this path.)
    if (!ground && wedges.length && body.mode === "ground" && !body.events.some((e) => e.type === "jumped")) {
      const below = groundBelow();
      if (below && (body.slope || below.wedge)) { body.pos[1] -= below.drop; ground = below.n; slope = below.wedge ? below.n : null; body.vel[1] = slope ? -(slope[0] * body.vel[0] + slope[2] * body.vel[2]) / slope[1] : 0; }
    }
    body.slope = slope; // (standing on a wedge: its normal)
    const wasAir = body.mode === "air";
    if (body.mode !== "wall" && body.mode !== "skim") {
      if (ground) {
        if (wasAir) emit("landed", { speed: -body.vel[1] });
        body.mode = "ground"; body.coyote = K.coyote; body.checkpoint = [body.pos[0], body.pos[1] + 0.2, body.pos[2]];
        if (body.vel[1] < 0 && !slope) body.vel[1] = 0;
      } else {
        if (body.mode === "ground") body.mode = "air";
        body.coyote = Math.max(0, body.coyote - dt);
      }
    }
    // Catch a wall: in the air, fast, going along it rather than into it.
    if (body.mode === "air" && hs > K.wallMin && body.vel[1] < 4) {
      const w = side ? { n: side, b: sideBox } : wallBeside();
      if (w && Math.abs(dot(hv, w.n)) < hs * 0.75 && runnable(w.n, w.b)) { body.mode = "wall"; body.wallTime = 0; body.wall = w.n; body.wallFace = w.n; body.vel[1] = Math.max(body.vel[1], 1.2); emit("wallStart", { n: w.n }); }
    }
    // Catch a rail: falling onto it.
    if (body.mode === "air" && body.vel[1] <= 0.5) {
      rails.forEach((rail, i) => {
        if (body.mode !== "air") return;
        const at = nearestOnRail([body.pos[0], body.pos[1] - 0.05, body.pos[2]], rail);
        if (at && at.d < K.railSnap) {
          const dir = dot(body.vel, at.tan) >= 0 ? 1 : -1;
          // (Not where it would end at once: off a rail's end it would catch, end, fall and catch again, for ever.)
          if ((dir > 0 && at.i === rail.length - 2 && at.t > 0.98) || (dir < 0 && at.i === 0 && at.t < 0.02)) return;
          body.mode = "grind"; body.rail = i;
          body.railDir = dir;
          // (Pushed on, but never past the rail's cap: a fall onto a rail isn't a launch.)
          const sp = Math.min(K.railMax, Math.max(Math.abs(dot(body.vel, at.tan)), hs, 6) + K.railPush);
          body.vel = at.tan.map((v) => v * body.railDir * sp);
          emit("railStart");
        }
      });
    }
    // Water: fast enough, it holds you; otherwise in you go.
    if ((body.mode === "air" || body.mode === "ground") && body.pos[1] <= waterY && body.vel[1] <= 0) {
      if (hs >= K.skimMin) { body.mode = "skim"; body.pos[1] = waterY; body.vel[1] = 0; emit("skimStart"); }
      else { body.mode = "sink"; body.sinking = 0; emit("splashIn"); }
    }
    if (hs > 0.5) body.facing = Math.atan2(body.vel[0], body.vel[2]);
    return body;
  };
  return body;
}
