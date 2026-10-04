// Cameras: where the picture is taken from. A camera is { eye, target, fov,
// yaw, pitch } and a rig that moves it:
//
//   orbit  the player's: mouse or stick turns it, the subject sits a little
//          below the middle, W runs where it looks (cam.move)
//   chase  the attract mode's: it turns after the subject's heading, looks
//          ahead of the run, swings out off a wall the subject runs along
//   first  from the subject's eyes (the game hides the subject: cam.hidesSubject)
//   frame  a showcase: the subject's FRONT toward us, its bounds fitted in the
//          picture (a turntable if it spins)
//   rail   scripted keys (cutscenes, attract loops); `fixed` is a rail of one
//
// Rigs step on the game's fixed simulation steps, never on the screen's
// frames, so a camera is where it should be at any frame rate and the same
// steps always give the same camera. Rendering only reads cam.view().
//
//   const cam = createCamera({ mode: "orbit", width: 128, height: 128 });
//   cam.step(dt, subject, { boxes }, { look: [dyaw, dpitch] });   // each fixed step
//   body.step(dt, { move: cam.move(forward, strafe), ... });      // W is forward
//   px.render({ ...cam.view(), time, ... });                      // each frame
//
// The frame convention is src/core/frame.js: +z front, +x right, +y up,
// front(yaw) = [sin, 0, cos]. A positive look yaw turns the view to the
// screen's right (what was on the right comes to the middle); a positive look
// pitch looks up.

import { cameraBasis, frontOf, moveFromView, rightOf, wrapAngle, yawOf } from "../core/frame.js";
import { boxDistance } from "../physics/character.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const smoothstep = (k) => k * k * (3 - 2 * k);
/** The share of the way covered in dt when closing at `rate` per second (frame-rate free). */
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
/** The direction a view at (yaw, pitch) looks along. */
export const dirOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
/** From a toward b, `t` along. */
const along = (a, b, t) => { const d = sub(b, a); const l = len(d); return l < 1e-9 ? [...a] : add(a, scale(d, t / l)); };

/** The fov (vertical, radians) a target size wants: fewer pixels, a tighter frame, so a subject keeps enough of them to read at 32. */
export const fovForTarget = (w, h, base = 1.15) => base * clamp((Math.min(w, h) / 128) ** 0.3, 0.6, 1);
/** How much of the picture a framed subject fills: more at small targets. */
export const fillForTarget = (w, h) => 0.72 + 0.14 * clamp((128 - Math.min(w, h)) / 96, 0, 1);

// ---- the world, as the camera sees it

/** How far p is from the world's solids (negative inside one). A world is { boxes, floorY?, distance?(p) }. */
export function clearance(world, p) {
  let d = Infinity;
  for (const b of world?.boxes ?? []) { const q = boxDistance(p, b).d; if (q < d) d = q; }
  if (world?.floorY !== undefined) d = Math.min(d, p[1] - world.floorY);
  if (world?.distance) d = Math.min(d, world.distance(p));
  return d;
}

/**
 * Sweep a ball of `radius` from `from` toward `to`: how far it gets before it
 * touches something (the whole way if nothing is in it). Sphere-traced, so a
 * point it returns always has at least `radius` of room -- a camera put there
 * is never inside a wall. (Starting inside something, it gets nowhere: 0.)
 */
export function sphereCast(world, from, to, radius = 0.2) {
  const d = sub(to, from);
  const L = len(d);
  if (L < 1e-9) return 0;
  let t = 0;
  for (let i = 0; i < 160; i += 1) {
    const c = clearance(world, add(from, scale(d, t / L))) - radius;
    if (c < 1e-3) return t;
    t += c;
    if (t >= L) return L;
  }
  return t; // (grazing along a face: as far as it has proven clear)
}

// The arm: in at once when something is in the way; back out on a critically
// damped spring when it clears (it starts gently and never overshoots the room).
function armTo(rig, hit, dt, rate) {
  if (rig.arm === null || hit <= rig.arm) { rig.arm = hit; rig.armVel = 0; return hit; }
  rig.armVel += (rate * rate * (hit - rig.arm) - 2 * rate * rig.armVel) * dt;
  rig.arm = Math.min(hit, rig.arm + Math.max(0, rig.armVel) * dt);
  return rig.arm;
}

// (A little room kept off a surface the arm stopped at, so the next sweep can start from there.)
const SKIN = 0.08;

/** The outward normal of the nearest solid at p. */
export function normalAt(world, p) {
  let best = Infinity;
  let n = [0, 1, 0];
  for (const b of world?.boxes ?? []) { const q = boxDistance(p, b); if (q.d < best) { best = q.d; n = q.n; } }
  if (world?.floorY !== undefined && p[1] - world.floorY < best) { best = p[1] - world.floorY; n = [0, 1, 0]; }
  if (world?.distance && world.distance(p) < best) {
    const e = 1e-3;
    const g = [0, 1, 2].map((i) => { const a = [...p]; const b = [...p]; a[i] += e; b[i] -= e; return world.distance(a) - world.distance(b); });
    const l = len(g) || 1;
    n = scale(g, 1 / l);
  }
  return n;
}

/**
 * The arm's path from `from` toward `to`: straight until it touches something;
 * then, if that is a ceiling or a floor, on along it (a camera in a low tunnel
 * slides back under the roof rather than folding into the subject's head).
 * Walls only pull it in. Every point on the path has `radius` of room.
 * Returns { points, reach } -- a polyline and its length.
 */
export function armPath(world, from, to, radius = 0.2) {
  const L = len(sub(to, from));
  const t = sphereCast(world, from, to, radius);
  const hit = along(from, to, t);
  if (t >= L - 1e-9) return { points: [from, hit], reach: t };
  const n = normalAt(world, hit);
  const rest = sub(to, hit);
  const into = dot(rest, n);
  if (Math.abs(n[1]) < 0.7 || into >= 0) return { points: [from, hit], reach: t };
  const off = add(hit, scale(n, SKIN));
  if (clearance(world, off) < radius) return { points: [from, hit], reach: t };
  const slideTo = add(off, sub(rest, scale(n, into)));
  const t2 = sphereCast(world, off, slideTo, radius);
  return { points: [from, hit, off, along(off, slideTo, t2)], reach: t + SKIN + t2 };
}
/** The point `s` along a polyline. */
export function alongPath(points, s) {
  let left = s;
  for (let i = 0; i < points.length - 1; i += 1) {
    const l = len(sub(points[i + 1], points[i]));
    if (left <= l || i === points.length - 2) return along(points[i], points[i + 1], Math.min(left, l));
    left -= l;
  }
  return [...points[0]];
}

// The middle of the subject's body: always open space (the body itself keeps it clear).
const coreOf = (s) => [s.pos[0], s.pos[1] + (s.height ?? 1.1) * 0.5, s.pos[2]];
// A point over the subject's head, pulled down under a low ceiling (with a skin of room to spare).
function safePoint(world, s, p, radius) {
  const core = coreOf(s);
  const t = sphereCast(world, core, p, radius);
  return along(core, p, t >= len(sub(p, core)) - 1e-9 ? t : Math.max(0, t - SKIN));
}
const headingOf = (s) => (s.yaw !== undefined ? s.yaw : Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0) > 1e-6 ? yawOf(s.vel) : 0);

// ---- rigs: each { name, enter(cam, subject), step(dt, subject, world, input, cam) -> { eye, target, fov? } }

/**
 * Third person, player-turned: yaw and pitch from the look input, the subject
 * a little below the middle (the arm hangs off a point over its head), an arm
 * that pulls in when a wall is behind and eases back out, an optional
 * shoulder offset, and (optional) a slow recentre behind the run when the
 * look has been left alone.
 */
export function orbitRig(o = {}) {
  const opt = {
    distance: 3.4, above: 0.45, shoulder: 0, pitch: -0.28, minPitch: -1.2, maxPitch: 0.55,
    follow: 18, followY: 9, recover: 6, radius: 0.2, recenter: 0, recenterRate: 1.5, ...o,
  };
  const rig = {
    name: "orbit", opt, yaw: 0, pitch: opt.pitch, pivot: null, arm: null, armVel: 0, idle: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.pitch = fresh ? opt.pitch : clamp(cam.pitch, opt.minPitch, opt.maxPitch);
      rig.pivot = null; rig.arm = null; rig.idle = 0;
    },
    step(dt, s, world, input = {}, cam = null) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      // (Left alone and running: drift round behind the run, as a pad player expects.)
      const hv = Math.hypot(s.vel?.[0] ?? 0, s.vel?.[2] ?? 0);
      rig.idle = Math.abs(look[0]) + Math.abs(look[1]) > 1e-6 ? 0 : rig.idle + dt;
      if (opt.recenter > 0 && rig.idle > opt.recenter && hv > 2) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(opt.recenterRate, dt));
      const r = rightOf(rig.yaw);
      // (The pivot's height over the subject's middle scales with the fov, so the subject sits the
      // same share below the middle at 32 pixels, in fovForTarget's tighter frame, as at 128.)
      const h = s.height ?? 1.1;
      const k = cam ? Math.tan(cam.baseFov / 2) / Math.tan(1.15 / 2) : 1;
      const want = [s.pos[0] + r[0] * opt.shoulder, s.pos[1] + h * 0.5 + (h * 0.5 + opt.above) * k, s.pos[2] + r[2] * opt.shoulder];
      if (!rig.pivot) rig.pivot = want;
      else {
        const kx = ease(opt.follow, dt);
        const ky = ease(opt.followY, dt);
        rig.pivot = [rig.pivot[0] + (want[0] - rig.pivot[0]) * kx, rig.pivot[1] + (want[1] - rig.pivot[1]) * ky, rig.pivot[2] + (want[2] - rig.pivot[2]) * kx];
      }
      const pivot = safePoint(world, s, rig.pivot, opt.radius);
      const f = dirOf(rig.yaw, rig.pitch);
      const path = armPath(world, pivot, sub(pivot, scale(f, opt.distance)), opt.radius);
      armTo(rig, path.reach, dt, opt.recover);
      const eye = alongPath(path.points, rig.arm);
      // (Looking along the rig's direction through the pivot: a full arm out that is the pivot itself;
      // pulled in, a point past it, so the camera always has somewhere to look.)
      return { eye, target: add(pivot, scale(f, opt.distance - rig.arm)) };
    },
  };
  return rig;
}

/**
 * Third person, self-driving: turns after the subject's heading (faster the
 * faster it runs), looks ahead of the run, stands out over the open side when
 * the subject runs along a wall (subject.wall is the wall's normal), and pulls
 * in off walls like the orbit. WALLRUN's first camera, made frame-rate free.
 */
export function chaseRig(o = {}) {
  const opt = {
    distance: 3, height: 1.5, rise: 0.12, lookHeight: 0.7, lookAhead: 1.4, lead: 0.12,
    turn: 1.45, turnBySpeed: 0.145, swing: 1.5, swingRate: 3.6, eyeRate: 7.4, lookRate: 14, recover: 6, radius: 0.2,
    above: 0.35, unblock: 4, ...o,
  };
  const rig = {
    name: "chase", opt, yaw: 0, side: [0, 0], eye: null, look: null, arm: null, armVel: 0, reach: 0,
    enter(cam, s, fresh) {
      rig.yaw = fresh ? headingOf(s) : cam.yaw;
      rig.side = [0, 0]; rig.arm = null;
      rig.eye = fresh ? null : [...cam.eye];
      rig.look = fresh ? null : [...cam.target];
    },
    step(dt, s, world) {
      const vel = s.vel ?? [0, 0, 0];
      const hv = Math.hypot(vel[0], vel[2]);
      // (A wall between it and the subject -- the arm pulled in past half -- and it comes round faster.)
      const blocked = rig.arm !== null && rig.arm < 0.5 * rig.reach;
      const turn = (opt.turn + hv * opt.turnBySpeed) * (blocked ? opt.unblock : 1);
      if (hv > 1) rig.yaw = wrapAngle(rig.yaw + wrapAngle(headingOf(s) - rig.yaw) * ease(turn, dt));
      const wall = s.mode === "wall" && s.wall ? [s.wall[0] * opt.swing, s.wall[2] * opt.swing] : [0, 0];
      const ks = ease(opt.swingRate, dt);
      rig.side = [rig.side[0] + (wall[0] - rig.side[0]) * ks, rig.side[1] + (wall[1] - rig.side[1]) * ks];
      const f = frontOf(rig.yaw);
      const wantEye = [s.pos[0] - f[0] * opt.distance + rig.side[0], s.pos[1] + opt.height + opt.distance * opt.rise, s.pos[2] - f[2] * opt.distance + rig.side[1]];
      const wantLook = [s.pos[0] + f[0] * opt.lookAhead + vel[0] * opt.lead, s.pos[1] + opt.lookHeight, s.pos[2] + f[2] * opt.lookAhead + vel[2] * opt.lead];
      rig.eye = rig.eye ? lerp3(rig.eye, wantEye, ease(opt.eyeRate * (blocked ? opt.unblock : 1), dt)) : wantEye;
      rig.look = rig.look ? lerp3(rig.look, wantLook, ease(opt.lookRate, dt)) : wantLook;
      // Collision last, on the smoothed eye: from over the subject's head out to it.
      const pivot = safePoint(world, s, [s.pos[0], s.pos[1] + (s.height ?? 1.1) + opt.above, s.pos[2]], opt.radius);
      const path = armPath(world, pivot, rig.eye, opt.radius);
      armTo(rig, path.reach, dt, opt.recover);
      rig.reach = len(sub(rig.eye, pivot));
      return { eye: alongPath(path.points, rig.arm), target: rig.look };
    },
  };
  return rig;
}

/** First person: at the subject's eyes, turned by the look input. The subject is hidden (cam.hidesSubject). */
export function firstRig(o = {}) {
  const opt = { eyeHeight: 0.88, minPitch: -1.45, maxPitch: 1.45, ...o };
  const rig = {
    name: "first", opt, yaw: 0, pitch: 0, hidesSubject: true,
    enter(cam, s, fresh) { rig.yaw = fresh ? headingOf(s) : cam.yaw; rig.pitch = fresh ? 0 : clamp(cam.pitch, opt.minPitch, opt.maxPitch); },
    step(dt, s, world, input = {}) {
      const look = input.look ?? [0, 0];
      rig.yaw = wrapAngle(rig.yaw + look[0]);
      rig.pitch = clamp(rig.pitch + look[1], opt.minPitch, opt.maxPitch);
      const eye = [s.pos[0], s.pos[1] + (s.height ?? 1.1) * opt.eyeHeight, s.pos[2]];
      return { eye, target: add(eye, dirOf(rig.yaw, rig.pitch)) };
    },
  };
  return rig;
}

/** A subject's bounds as [x0, y0, z0, x1, y1, z1]: its own (array or {min, max}), or a cylinder of its radius and height. */
export function boundsOf(s) {
  const b = s.bounds;
  if (Array.isArray(b) && b.length === 6) return b;
  if (b?.min && b?.max) return [...b.min, ...b.max];
  const r = s.radius ?? 0.3;
  const h = s.height ?? 1.1;
  return [s.pos[0] - r, s.pos[1], s.pos[2] - r, s.pos[0] + r, s.pos[1] + h, s.pos[2] + r];
}

/**
 * The view that shows a subject's FRONT, its bounds fitted in the picture.
 * The camera stands on the front side (the front is the subject's yaw through
 * frame.js, or `front` -- a yaw or a direction), turned `turn` off square-on
 * (a three-quarter view at ~0.45) and raised by `elevation`. The distance is
 * solved, not searched: every corner of the bounds lands inside `fill` of the
 * picture at this fov and aspect, and the aim is re-centred on what is seen
 * (NOCTURNES' seenFrame: extents across the view, nearer corners bigger).
 */
export function frameView(s, { front, turn = 0, elevation = 0.14, fov = 1.15, aspect = 1, fill = 0.8, near = 0.3 } = {}) {
  const fy = front === undefined || front === null ? headingOf(s) : Array.isArray(front) ? yawOf(front) : front;
  const a = fy + turn;
  const out = [Math.sin(a) * Math.cos(elevation), Math.sin(elevation), Math.cos(a) * Math.cos(elevation)]; // (subject -> camera: its front side)
  const fwd = scale(out, -1);
  const { right, up } = cameraBasis([0, 0, 0], fwd);
  const [x0, y0, z0, x1, y1, z1] = boundsOf(s);
  const corners = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) corners.push([x, y, z]);
  const ty = Math.tan(fov / 2) * fill;
  const tx = ty * aspect;
  let target = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  let D = near;
  for (let pass = 0; pass < 3; pass += 1) {
    // Near enough that every corner fits: |x| <= tx (D + z) and |y| <= ty (D + z).
    D = near;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = dot(rel, fwd);
      D = Math.max(D, Math.abs(dot(rel, right)) / tx - z, Math.abs(dot(rel, up)) / ty - z, near - z);
    }
    if (pass === 2) break;
    // Then aim at the middle of what's seen from there.
    let lx = Infinity; let hx = -Infinity; let ly = Infinity; let hy = -Infinity;
    for (const p of corners) {
      const rel = sub(p, target);
      const z = D + dot(rel, fwd);
      const sx = dot(rel, right) / z;
      const sy = dot(rel, up) / z;
      lx = Math.min(lx, sx); hx = Math.max(hx, sx); ly = Math.min(ly, sy); hy = Math.max(hy, sy);
    }
    target = add(target, add(scale(right, ((lx + hx) / 2) * D), scale(up, ((ly + hy) / 2) * D)));
  }
  return { eye: add(target, scale(out, D)), target, distance: D, yaw: a + Math.PI };
}

/**
 * Still or turntable: frameView every step, eased to (or snapped with rate 0).
 * `spin` turns it (radians a second); the look input's yaw turns it by hand.
 * `pixels` asks for the subject that many pixels tall (else fillForTarget).
 * In a world with boxes the shot is pulled in front of any wall (collide: false to let it through).
 */
export function frameRig(o = {}) {
  const opt = { turn: 0.45, elevation: 0.14, spin: 0, rate: 6, fill: null, pixels: null, front: null, collide: true, radius: 0.2, ...o };
  const rig = {
    name: "frame", opt, turn: opt.turn, eye: null, target: null,
    enter() { rig.turn = opt.turn; rig.eye = null; rig.target = null; },
    step(dt, s, world, input = {}, cam) {
      rig.turn += opt.spin * dt + (input.look?.[0] ?? 0);
      const fill = opt.pixels ? clamp(opt.pixels / cam.height, 0.1, 0.95) : opt.fill ?? fillForTarget(cam.width, cam.height);
      const v = frameView(s, { front: opt.front, turn: rig.turn, elevation: opt.elevation, fov: cam.baseFov, aspect: cam.aspect, fill });
      const k = opt.rate > 0 && rig.eye ? ease(opt.rate, dt) : 1;
      rig.eye = rig.eye ? lerp3(rig.eye, v.eye, k) : v.eye;
      rig.target = rig.target ? lerp3(rig.target, v.target, k) : v.target;
      // (In a level, a wall between the shot and the subject brings the camera in front of it.)
      if (!opt.collide || !world?.boxes?.length) return { eye: rig.eye, target: rig.target };
      const from = safePoint(world, s, rig.target, opt.radius);
      return { eye: alongPath(armPath(world, from, rig.eye, opt.radius).points, Infinity), target: rig.target };
    },
  };
  return rig;
}

// Catmull-Rom through four points.
function spline(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p1.map((_, i) => 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * t3));
}

/**
 * Scripted: keys [{ at: seconds, eye, target?, fov? }] passed through
 * smoothly (Catmull-Rom), looped or held at the end. A key without a target
 * looks at the subject. Time is the rig's own, advanced by the steps.
 */
export function railRig(o = {}) {
  const opt = { keys: [], loop: true, speed: 1, period: null, name: "rail", ...o };
  const rig = {
    name: opt.name, opt, t: 0,
    enter() { rig.t = 0; },
    /** The view at rig time t (for scrubbing). */
    at(t, s) {
      const keys = opt.keys;
      const aim = (k) => (k.target ? k.target : s ? [s.pos[0], s.pos[1] + (s.height ?? 1.1) * 0.6, s.pos[2]] : [0, 0, 0]);
      if (keys.length === 1) return { eye: [...keys[0].eye], target: [...aim(keys[0])], fov: keys[0].fov };
      const n = keys.length;
      const first = keys[0].at;
      const last = keys[n - 1].at;
      const period = opt.period ?? last - first + (last - first) / (n - 1);
      let tt = first + t;
      if (opt.loop) tt = first + (((t % period) + period) % period);
      else tt = clamp(tt, first, last);
      let i = n - 1;
      while (i > 0 && keys[i].at > tt) i -= 1;
      const next = (j) => (opt.loop ? keys[((j % n) + n) % n] : keys[clamp(j, 0, n - 1)]);
      const end = i === n - 1 ? (opt.loop ? first + period : last) : keys[i + 1].at;
      const u = end > keys[i].at ? clamp((tt - keys[i].at) / (end - keys[i].at), 0, 1) : 0;
      const [k0, k1, k2, k3] = [next(i - 1), next(i), next(i + 1), next(i + 2)];
      const fov = k1.fov !== undefined && k2.fov !== undefined ? k1.fov + (k2.fov - k1.fov) * u : k1.fov;
      return { eye: spline(k0.eye, k1.eye, k2.eye, k3.eye, u), target: spline(aim(k0), aim(k1), aim(k2), aim(k3), u), fov };
    },
    step(dt, s) {
      rig.t += dt * opt.speed;
      return opt.keys.length ? rig.at(rig.t, s) : { eye: [0, 2, -4], target: [0, 1, 0] };
    },
  };
  return rig;
}
/** A camera that stays put: one eye, looking at `target` (or at the subject). */
export const fixedRig = (o = {}) => railRig({ name: "fixed", keys: o.eye ? [{ at: 0, eye: o.eye, target: o.target, fov: o.fov }] : [], ...o });

// ---- the camera

/** A subject from a physics/character.js body: its position, heading, speed, mode and wall. */
export function subjectOf(body, { height = 1.1, radius = 0.26 } = {}) {
  return { pos: body.pos, yaw: body.facing, vel: body.vel, height, radius, mode: body.mode, wall: body.mode === "wall" ? body.wall : null };
}

/**
 * A camera with every rig ready; pick one with `mode` / setMode. Options:
 *   width, height   the target size (sets the fov via fovForTarget and the aspect)
 *   fov             a fixed fov instead
 *   blend           seconds to blend eye/target/fov when the mode changes (0.3)
 *   fovKick         widen the fov by this share at speed (0 = off), over kickSpeeds [from, to]
 *   hideWithin      an eye nearer the subject than this hides it (hidesSubject)
 *   shake           { max: radians at full trauma, decay: trauma a second }
 *   orbit/chase/first/frame/rail/fixed   options for that rig; rigs: more rigs by name
 */
export function createCamera(o = {}) {
  const opt = { mode: "orbit", width: 128, height: 128, fov: null, blend: 0.3, fovKick: 0, kickSpeeds: [6, 12], hideWithin: 0.35, ...o };
  const shakeOpt = { max: 0.05, decay: 1.6, ...o.shake };
  const rigs = {
    orbit: orbitRig(o.orbit), chase: chaseRig(o.chase), first: firstRig(o.first),
    frame: frameRig(o.frame), rail: railRig(o.rail), fixed: fixedRig(o.fixed), ...o.rigs,
  };
  let entering = true;
  let fresh = true;
  let blending = null;
  let kick = 0;
  const cam = {
    eye: [0, 2, -4], target: [0, 1, 0], fov: opt.fov ?? fovForTarget(opt.width, opt.height),
    yaw: 0, pitch: 0, mode: opt.mode, width: opt.width, height: opt.height,
    time: 0, trauma: 0, nod: 0, nodVel: 0, nearSubject: Infinity, rigs,
    get aspect() { return cam.width / cam.height; },
    /** The fov before the speed kick: the fixed one, or the target size's. */
    get baseFov() { return opt.fov ?? fovForTarget(cam.width, cam.height); },
    get rig() { return rigs[cam.mode]; },
    /**
     * The game shouldn't draw the subject: first person (mostly blended in), or
     * an arm pulled in so far the eye is in its face (nearSubject: the eye's
     * distance from its surface, set each step, under hideWithin).
     */
    get hidesSubject() { return (Boolean(rigs[cam.mode].hidesSubject) && (!blending || blending.t > blending.dur * 0.5)) || cam.nearSubject < opt.hideWithin; },
    /** The target size changed: a new fov (unless fixed) and aspect. */
    setTarget(w, h) { cam.width = w; cam.height = h; },
    /** Switch rigs, blending from the current view over `blend` seconds. */
    setMode(name, { blend = opt.blend } = {}) {
      if (!rigs[name]) throw new Error(`no camera mode "${name}"`);
      if (name === cam.mode) return cam;
      blending = blend > 0 && !fresh ? { from: { eye: [...cam.eye], target: [...cam.target], fov: cam.fov }, t: 0, dur: blend } : null;
      cam.mode = name;
      entering = true;
      return cam;
    },
    /** One fixed step: the rig moves, blends, kicks; shake decays. */
    step(dt, subject, world = {}, input = {}) {
      cam.time += dt;
      const rig = rigs[cam.mode];
      if (entering) { rig.enter?.(cam, subject, fresh); entering = false; fresh = false; }
      const out = rig.step(dt, subject, world, input, cam);
      let fov = out.fov ?? cam.baseFov;
      if (opt.fovKick) {
        const hv = Math.hypot(subject.vel?.[0] ?? 0, subject.vel?.[2] ?? 0);
        const [s0, s1] = opt.kickSpeeds;
        kick += (clamp((hv - s0) / (s1 - s0), 0, 1) - kick) * ease(4, dt);
        fov *= 1 + opt.fovKick * kick;
      }
      let { eye, target } = out;
      if (blending) {
        blending.t += dt;
        const k = smoothstep(clamp(blending.t / blending.dur, 0, 1));
        eye = lerp3(blending.from.eye, eye, k);
        target = lerp3(blending.from.target, target, k);
        fov = blending.from.fov + (fov - blending.from.fov) * k;
        if (blending.t >= blending.dur) blending = null;
      }
      cam.eye = [...eye]; cam.target = [...target]; cam.fov = fov;
      // (How far the eye is from the subject's surface, a capsule of its radius and height.)
      const r = subject.radius ?? 0.3;
      const ay = clamp(eye[1], subject.pos[1] + r, subject.pos[1] + Math.max(r, (subject.height ?? 1.1) - r));
      cam.nearSubject = len(sub(eye, [subject.pos[0], ay, subject.pos[2]])) - r;
      const f = sub(target, eye);
      const fl = len(f) || 1;
      if (Math.hypot(f[0], f[2]) > 1e-9) cam.yaw = yawOf(f);
      cam.pitch = Math.asin(clamp(f[1] / fl, -1, 1));
      // Shake fades; the nod (a landing's thud) is a spring settling back.
      cam.trauma = Math.max(0, cam.trauma - shakeOpt.decay * dt);
      cam.nodVel += (-180 * cam.nod - 13.4 * cam.nodVel) * dt;
      cam.nod += cam.nodVel * dt;
      return cam;
    },
    /** Add shake (0..1 trauma; it adds up and fades). */
    shake(amount) { cam.trauma = clamp(cam.trauma + amount, 0, 1); return cam; },
    /** A thud (a landing): the view nods down by about `amount` radians and springs back. */
    thud(amount) { cam.nodVel -= amount * 24.5; return cam; }, // (the spring's first dip is ~0.041 of the kick)
    /**
     * What to render: eye, target, fov -- with the shake and the nod applied.
     * (They turn the view, never move the eye, so the eye stays where the rig
     * proved it has room.)
     */
    view() {
      const d = sub(cam.target, cam.eye);
      const L = len(d) || 1;
      const t = cam.time;
      const s = cam.trauma * cam.trauma * shakeOpt.max;
      const jy = s * (0.6 * Math.sin(t * 37.1 + 1.3) + 0.4 * Math.sin(t * 61.7));
      const jp = s * (0.6 * Math.sin(t * 43.3 + 0.7) + 0.4 * Math.sin(t * 71.9 + 2.1)) + cam.nod;
      if (jy === 0 && jp === 0) return { eye: [...cam.eye], target: [...cam.target], fov: cam.fov };
      return { eye: [...cam.eye], target: add(cam.eye, scale(dirOf(cam.yaw + jy, clamp(cam.pitch + jp, -1.55, 1.55)), L)), fov: cam.fov };
    },
    /** Camera-relative movement: forward 1 is where the view faces, strafe 1 its right. */
    move(forward, strafe) { return moveFromView(cam.yaw, forward, strafe); },
  };
  return cam;
}
