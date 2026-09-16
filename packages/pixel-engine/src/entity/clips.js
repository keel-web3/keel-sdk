// Clips: procedural animation as pure functions, and the animator that blends
// them from a physics body.
//
//   clip(spec, t, phase, params) -> pose        (rig.js explains a pose)
//     t       seconds (breathing, looking about, balancing)
//     phase   { phase, landT }: phase is the gait cycle 0..1, advanced by DISTANCE
//             travelled, so a planted foot stays where it was put
//     params  { speed, vy, wall, turn, seat, hands }
//
// Legs are placed by IK: a foot in stance slides back under the body exactly as
// fast as the body goes forward (so it stands still in the world), a foot in
// swing arcs forward. A walk has both feet down at once, a run has both up.
// Arms swing against the legs. Every pose also says how far one cycle carries
// the body (`cycle`), which is how the animator turns distance into phase.
//
//   const anim = animator(spec);
//   anim.step(dt, body);                       // body: { pos, vel, facing, mode, wall }
//   renderer.setWorld({ capsules: anim.capsules(materials) });

import { rightOf } from "../core/frame.js";
import { poseSkeleton } from "./rig.js";
import { skinOf } from "./skin.js";

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (v) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const SIDES = [["L", -1], ["R", 1]];

/**
 * One foot through a cycle. q: its own phase 0..1 (0 = touch down). In stance
 * (q < duty) it goes from +s/2 to -s/2 at a steady rate; in swing it comes back
 * over an arc of height `lift`. Returns { z, y, stance, u } (u: progress in that part).
 */
export function footCycle(q, duty, s, lift) {
  if (q < duty) { const u = q / duty; return { z: s / 2 - s * u, y: 0, stance: true, u }; }
  const u = (q - duty) / (1 - duty);
  return { z: -s / 2 + s * smooth(u), y: lift * Math.sin(Math.PI * u), stance: false, u };
}

const blank = () => ({ root: { yaw: 0, pitch: 0, roll: 0, off: [0, 0, 0] }, rot: {}, ik: {}, ears: 0, cycle: 0 });

// ---- two legs ----

function legsAt(spec) {
  const b = spec.body;
  return { b, reach: b.hipH - b.ankleH, w: b.hipW };
}

/** A gait on two legs (walk, run, skim): cfg says how. */
function bipedGait(spec, t, ph, params, cfg) {
  const { b, reach, w } = legsAt(spec);
  const p = blank();
  const s = cfg.s * reach * (b.stride ?? 1);
  const duty = cfg.duty;
  const zs = {};
  for (const [side, x] of SIDES) {
    const c = footCycle(frac(ph.phase + (x > 0 ? 0.5 : 0)), duty, s, cfg.lift * reach);
    zs[side] = c.z / (s / 2 || 1);
    p.ik[`leg.${side}`] = { at: [x * w * 1.05, b.ankleH + c.y, c.z], w: 1, pitch: c.stance ? 0 : 0.35 * Math.sin(Math.PI * c.u), yaw: x * 0.06 };
  }
  // Up and down twice a cycle (a walk vaults over the stance leg, a run sinks into it), side to side once.
  const mid = ph.phase - duty / 2;
  const sway = -cfg.sway * reach * Math.cos(TAU * mid);
  let lift = -cfg.crouch * reach + cfg.bob * reach * Math.cos(TAU * 2 * mid);
  // (Never so high a planted foot can't reach the ground: the hips drop into a long step.)
  const twist = cfg.twist * zs.L;
  for (const [side, x] of SIDES) {
    const g = p.ik[`leg.${side}`];
    if (g.at[1] > b.ankleH + 1e-12) continue;
    const hx = sway + x * w * Math.cos(twist);
    const hz = -x * w * Math.sin(twist);
    const flat2 = (g.at[0] - hx) ** 2 + (g.at[2] - hz) ** 2;
    const high = b.ankleH + Math.sqrt(Math.max(0, (reach * 0.985) ** 2 - flat2)) - b.hipH;
    if (lift > high) lift = high;
  }
  p.root.off = [sway, lift, 0];
  p.rot.hips = [0, twist, 0];
  p.rot.spine = [cfg.lean, 0, 0];
  p.rot.chest = [cfg.lean * 0.3, -cfg.twist * 1.4 * zs.L, 0];
  p.rot.neck = [-cfg.lean * 0.6, 0, 0];
  p.rot.head = [-cfg.lean * 0.5, cfg.twist * 0.5 * zs.L, 0];
  for (const [side, x] of SIDES) {
    // (Leg forward, same arm back: a hanging bone swings back with +rx.)
    const k = zs[side];
    const arm = cfg.armBack ?? 0;
    p.rot[`upperArm.${side}`] = [arm + cfg.armAmp * k, 0, x * cfg.armOut];
    p.rot[`forearm.${side}`] = [-cfg.elbow - 0.35 * cfg.armAmp * Math.max(0, -k), 0, 0];
  }
  p.rot.tail0 = [0.15 + cfg.lean * 0.4, 0.3 * Math.sin(TAU * ph.phase), 0];
  p.rot.tail1 = [0.1, 0.35 * Math.sin(TAU * ph.phase - 0.8), 0];
  p.ears = cfg.ears;
  p.cycle = s / duty;
  return p;
}

const WALK = { duty: 0.62, s: 0.85, lift: 0.16, bob: 0.03, sway: 0.035, crouch: 0.04, lean: 0.06, twist: 0.14, armAmp: 0.38, armOut: 0.1, elbow: 0.25, ears: 0.1 };
const runCfg = (spec, speed) => {
  // Faster -> less time on the ground and more in the air (a sprint is mostly flight).
  const v = speed / (Math.max(0.05, spec.body.hipH - spec.body.ankleH) * 10);
  return { duty: clamp(0.4 - 0.065 * v, 0.15, 0.38), s: 1.12, lift: 0.42, bob: -0.05, sway: 0.012, crouch: 0.1, lean: 0.3 + clamp(v * 0.03, 0, 0.12), twist: 0.2, armAmp: 0.85, armOut: 0.14, elbow: 1.35, ears: 0.6 };
};

const SEAT_SINK = 0.85;
/** The seat a two-legged spec sits on best: thighs level, feet flat (its knee height, less its bottom). */
export const seatOf = (spec) => spec.body.ankleH + spec.body.shin - spec.body.torsoR * SEAT_SINK;

/** Walk speed -> run speed, in leg lengths a second (the animator's "walk" below, "run" above). */
export const RUN_FROM = 4.5;
const mixCfg = (a, b, k) => Object.fromEntries(Object.keys(b).map((n) => [n, (a[n] ?? 0) + ((b[n] ?? 0) - (a[n] ?? 0)) * k]));

export const HUMANOID_CLIPS = {
  /** Standing: breathing, looking about, arms loose. */
  idle(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.4);
    p.root.off = [0, -reach * 0.035 + br * b.H * 0.004, 0];
    p.rot.spine = [0.03 + br * 0.012, 0, 0];
    p.rot.chest = [br * 0.02, 0, 0];
    p.rot.head = [-0.04 + 0.03 * Math.sin((TAU * t) / 5.1), 0.28 * Math.sin((TAU * t) / 7.3) * Math.sin((TAU * t) / 11.1), 0];
    for (const [side, x] of SIDES) {
      p.rot[`upperArm.${side}`] = [0.04, 0, x * (0.1 + br * 0.02)];
      p.rot[`forearm.${side}`] = [-0.25, 0, 0];
      p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH, 0.01 * b.H], w: 1, yaw: x * 0.12 };
    }
    p.rot.tail0 = [0.1, 0.3 * Math.sin((TAU * t) / 2.3), 0];
    p.rot.tail1 = [0.2, 0.3 * Math.sin((TAU * t) / 2.3 - 0.9), 0];
    return p;
  },
  walk: (spec, t, ph) => bipedGait(spec, t, ph, {}, WALK),
  run: (spec, t, ph, params = {}) => bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8)),
  /**
   * Walk into run as ONE gait, its duty, stride, bob and arms sliding with the speed
   * (params.speed): what the animator plays on the ground, so there's no crossfade
   * between a foot in stance and the same foot in swing.
   */
  move(spec, t, ph, params = {}) {
    const reach = spec.body.hipH - spec.body.ankleH;
    const v = (params.speed ?? 0) / reach;
    const k = smooth((v - RUN_FROM * 0.55) / (RUN_FROM * 0.9));
    return bipedGait(spec, t, ph, params, k <= 0 ? WALK : mixCfg(WALK, runCfg(spec, params.speed ?? 0), k));
  },
  /** Low and fast over water: short quick steps, leaning in, arms straight back. */
  skim: (spec, t, ph) => bipedGait(spec, t, ph, {}, { duty: 0.3, s: 0.75, lift: 0.14, bob: -0.02, sway: 0.01, crouch: 0.24, lean: 0.55, twist: 0.1, armAmp: 0.15, armOut: 0.3, armBack: 0.95, elbow: 0.15, ears: 1 }),
  /** Going up: one knee tucked high, the other trailing, arms up. */
  jump(spec) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w, b.hipH - reach * 0.45, reach * 0.35], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w, b.ankleH + reach * 0.22, -reach * 0.3], w: 1, pitch: 0.5 };
    p.rot.spine = [0.15, 0, 0];
    p.rot.head = [-0.15, 0, 0];
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-1.7, 0, x * 0.45]; p.rot[`forearm.${side}`] = [-0.6, 0, 0]; }
    p.rot.tail0 = [0.5, 0, 0];
    p.ears = 0.8;
    return p;
  },
  /** Coming down: legs reaching for the ground, arms up and out for balance. */
  fall(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    p.ik["leg.L"] = { at: [-w * 1.4, b.ankleH + reach * 0.2, reach * 0.18], w: 1, pitch: 0.3 };
    p.ik["leg.R"] = { at: [w * 1.4, b.ankleH + reach * 0.14, -reach * 0.08], w: 1, pitch: 0.35 };
    p.rot.spine = [-0.04, 0, 0];
    const flap = 0.12 * Math.sin(TAU * t * 2.2);
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.3, 0, x * (2 + flap)]; p.rot[`forearm.${side}`] = [-0.45, 0, 0]; }
    p.rot.tail0 = [-0.3, 0, 0];
    p.ears = 1;
    return p;
  },
  /** Just landed: squashed down on planted feet, springing back as landT runs 0 -> LAND_TIME. */
  land(spec, t, ph) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const sq = 1 - smooth((ph.landT ?? 0) / LAND_TIME);
    p.root.off = [0, -reach * (0.04 + 0.3 * sq), 0];
    p.rot.spine = [0.08 + 0.35 * sq, 0, 0];
    p.rot.head = [-0.25 * sq, 0, 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.${side}`] = { at: [x * w * 1.35, b.ankleH, x * 0.03 * reach], w: 1, yaw: x * 0.15 };
      p.rot[`upperArm.${side}`] = [-0.7 * sq, 0, x * (0.25 + 0.3 * sq)];
      p.rot[`forearm.${side}`] = [-0.5, 0, 0];
    }
    p.ears = 0.4 * sq;
    return p;
  },
  /**
   * Running along a wall: the run, tilted off it -- feet toward the wall, head away.
   * params.wall: +1 the wall is on its left, -1 on its right; params.wallGap: how far its
   * feet point is from the wall (optional: the feet are moved onto it).
   */
  wallRun(spec, t, ph, params = {}) {
    const p = bipedGait(spec, t, ph, params, runCfg(spec, params.speed ?? 8));
    const side = params.wall ?? 0;
    // (+roll tips the head toward -x; a wall on the left (side +1) tips it toward +x, away.)
    p.root.roll = -0.5 * side;
    // (Given how far the body is from the wall, the feet go onto it.)
    if (params.wallGap > 0 && side !== 0) p.root.shift = [-side * Math.max(0, params.wallGap - spec.body.footR), 0, 0];
    const near = side > 0 ? "L" : "R";
    if (side !== 0) { p.rot[`upperArm.${near}`] = [0.35, 0, -side * 1.25]; p.rot[`forearm.${near}`] = [-0.3, 0, 0]; }
    return p;
  },
  /** On a rail: crouched, feet one before the other, arms out, balancing. */
  grind(spec, t) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const bal = Math.sin(TAU * t * 0.9);
    // (Balancing sways the body over planted feet: at the hips, not the root, so the feet stay on the rail.)
    p.root.off = [0.06 * reach * bal, -reach * 0.28, 0];
    p.rot.hips = [0, 0.3, 0.06 * bal];
    p.rot.spine = [0.25, 0, -0.1 * bal];
    p.rot.chest = [0.05, -0.2, 0];
    p.rot.head = [-0.2, -0.1, 0];
    p.ik["leg.L"] = { at: [-w * 0.55, b.ankleH, -reach * 0.3], w: 1, yaw: -0.5 };
    p.ik["leg.R"] = { at: [w * 0.55, b.ankleH, reach * 0.3], w: 1, yaw: 0.25 };
    for (const [side, x] of SIDES) { p.rot[`upperArm.${side}`] = [-0.1, 0, x * (1.35 + 0.1 * bal * x)]; p.rot[`forearm.${side}`] = [-0.2, 0, 0]; }
    p.rot.tail0 = [0, 0.4 * bal, 0];
    p.ears = 0.3;
    return p;
  },
  /**
   * Sitting on something params.seat high: thighs level, feet on the ground, hands on the knees.
   * The default seat is the one its legs fit (seatOf); a higher one leaves the feet dangling;
   * seat 0 is the floor (legs out ahead, hands behind).
   */
  sit(spec, t, ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.8);
    if (params.seat === 0) {
      const hy = b.torsoR * 0.95;
      const z = Math.sqrt(Math.max(0, (reach * 0.97) ** 2 - (hy - b.ankleH) ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.3, b.ankleH, z], w: 1, yaw: x * 0.2, pole: [0, 1, 0.2] };
        p.ik[`arm.${side}`] = { at: [x * (b.shoulderW + b.armR * 2), b.armR * 1.2, -b.torsoR * 1.3], w: 1 };
      }
    } else {
      // (It sits on its bottom: the hip joints ride a little under a torso's radius above the seat.)
      const hy = (params.seat ?? seatOf(spec)) + b.torsoR * SEAT_SINK;
      const drop = Math.sqrt(Math.max(0, (reach * 0.995) ** 2 - b.thigh ** 2));
      p.root.off = [0, hy - b.hipH, 0];
      for (const [side, x] of SIDES) {
        p.ik[`leg.${side}`] = { at: [x * w * 1.15, Math.max(b.ankleH, hy - drop), b.thigh], w: 1, yaw: x * 0.08, pole: [0, 0.35, 1] };
        p.ik[`arm.${side}`] = { at: [x * w * 1.25, hy + b.legR * 1.6, b.thigh * 0.75], w: 1 };
      }
    }
    p.rot.spine = [-0.04 + br * 0.01, 0, 0];
    p.rot.head = [0.05, 0.2 * Math.sin((TAU * t) / 9), 0];
    p.rot.tail0 = [-0.45, 0.5, 0];
    p.rot.tail1 = [-0.2, 0.6, 0];
    return p;
  },
  /** Turning on the spot: stepping foot to foot, the upper body leading. params.turn: turn rate (rad/s, + to its right). */
  turn(spec, t, ph, params = {}) {
    const { b, reach, w } = legsAt(spec);
    const p = HUMANOID_CLIPS.idle(spec, t);
    const q = frac(t * 1.8);
    for (const [side, x] of SIDES) {
      const u = x < 0 ? q * 2 : q * 2 - 1;
      const lift = u > 0 && u < 1 ? Math.sin(Math.PI * u) * reach * 0.12 : 0;
      p.ik[`leg.${side}`] = { at: [x * w * 1.15, b.ankleH + lift, 0.01 * b.H], w: 1, yaw: x * 0.12 - Math.sign(params.turn ?? 0) * 0.2 * (lift > 0 ? 1 : 0) };
    }
    p.rot.chest = [0, Math.sign(params.turn ?? 0) * 0.15, 0];
    p.rot.head = [0, Math.sign(params.turn ?? 0) * 0.3, 0];
    return p;
  },
};
HUMANOID_CLIPS.wallrun = HUMANOID_CLIPS.wallRun;

// ---- four legs ----

/** Gaits by their footfalls: each foot's touch-down in the cycle, how long it stays down, how far it steps. */
export const GAITS = {
  // Lateral-sequence walk: hind left, fore left, hind right, fore right.
  walk: { at: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, duty: 0.66, s: 0.7, lift: 0.2, bob: 0.02, flex: 0.02, nod: 0.05 },
  // Trot: diagonal pairs together. (FR at 1 is FR at 0 -- written so a walk slides into it the short way.)
  trot: { at: { HL: 0, FR: 1, HR: 0.5, FL: 0.5 }, duty: 0.48, s: 0.9, lift: 0.3, bob: 0.03, flex: 0.03, nod: 0.04 },
  // Transverse gallop: the hinds one after the other, then the fores (the spine bends and stretches).
  gallop: { at: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.52 }, duty: 0.3, s: 1.05, lift: 0.38, bob: 0.06, flex: 0.18, nod: 0.08 },
  // Bound (a rabbit's hop): the hinds together, then the fores together.
  bound: { at: { HL: 0, HR: 0.03, FL: 0.5, FR: 0.53 }, duty: 0.32, s: 1.1, lift: 0.45, bob: 0.08, flex: 0.25, nod: 0.06 },
};
const HOPPERS = new Set(["rabbit", "mouse"]);
/** Walk -> trot and trot -> gallop speeds, in leg lengths a second (the middle of each blend). */
export const QUAD_GAIT_AT = { trot: 3.2, gallop: 7 };
const mixGait = (a, b, k) => ({
  at: Object.fromEntries(Object.keys(a.at).map((f) => [f, a.at[f] + (b.at[f] - a.at[f]) * k])),
  ...Object.fromEntries(["duty", "s", "lift", "bob", "flex", "nod"].map((n) => [n, a[n] + (b[n] - a[n]) * k])),
});
/** The gait a quadruped uses at a speed: walk, trot, gallop (a hopper's trot and gallop are its bound), blended between. */
export function gaitAt(spec, speed) {
  const v = speed / (spec.body.shoulderH - spec.body.ankleH);
  const hop = HOPPERS.has(spec.species);
  const trot = hop ? GAITS.bound : GAITS.trot;
  const fast = hop ? GAITS.bound : GAITS.gallop;
  const k1 = smooth((v - QUAD_GAIT_AT.trot * 0.75) / (QUAD_GAIT_AT.trot * 0.5));
  const k2 = smooth((v - QUAD_GAIT_AT.gallop * 0.8) / (QUAD_GAIT_AT.gallop * 0.4));
  return k2 > 0 ? mixGait(trot, fast, k2) : mixGait(GAITS.walk, trot, k1);
}

function quadAt(spec) {
  const b = spec.body;
  return { b, zF: b.bodyLen / 2, zH: -b.bodyLen / 2, rF: b.shoulderH - b.ankleH, rH: b.hipH - b.ankleH };
}

function quadGait(spec, t, ph, g) {
  const { b, zF, zH, rF, rH } = quadAt(spec);
  const p = blank();
  const reach = (rF + rH) / 2;
  const s = g.s * reach * (b.stride ?? 1);
  for (const k of ["FL", "FR", "HL", "HR"]) {
    const x = k[1] === "L" ? -1 : 1;
    const c = footCycle(frac(ph.phase - g.at[k]), g.duty, s, g.lift * (k[0] === "F" ? rF : rH));
    p.ik[`leg.${k}`] = { at: [x * b.w, b.ankleH + c.y, (k[0] === "F" ? zF : zH) + c.z], w: 1, pitch: c.stance ? 0 : -0.4 * Math.sin(Math.PI * c.u) };
  }
  const flex = g.flex * Math.sin(TAU * ph.phase);
  p.root.off = [0, -reach * 0.04 + g.bob * reach * Math.cos(TAU * 2 * ph.phase), 0];
  p.rot.pelvis = [flex * 0.5, 0, 0];
  p.rot.spine = [-flex, 0, 0];
  p.rot.chest = [flex * 0.5, 0, 0];
  p.rot.neck = [g.nod * Math.sin(TAU * 2 * ph.phase + 0.6), 0, 0];
  p.rot.tail0 = [-(b.tailRise ?? 0.4) * g.flex * 2.5 + 0.1, 0.3 * Math.sin(TAU * ph.phase), 0];
  p.rot.tail1 = [0.1, 0.35 * Math.sin(TAU * ph.phase - 0.7), 0];
  p.rot.tail2 = [0.05, 0.35 * Math.sin(TAU * ph.phase - 1.4), 0];
  p.ears = g.flex;
  p.cycle = s / g.duty;
  return p;
}

// (Tip the pelvis back until the shoulders stand at `want` above the ground.)
function pitchFor(spec, pelvisY, want) {
  const b = spec.body;
  const rise = b.shoulderH - b.hipH;
  const h = (a) => pelvisY + rise * Math.cos(a) + b.bodyLen * Math.sin(-a);
  let lo = -1.35;
  let hi = 0;
  for (let i = 0; i < 24; i += 1) { const m = (lo + hi) / 2; if (h(m) > want) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export const QUADRUPED_CLIPS = {
  idle(spec, t) {
    const { b, zF, zH, rF } = quadAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3);
    p.root.off = [0, -rF * 0.03 + br * b.bodyR * 0.02, 0];
    p.rot.spine = [br * 0.01, 0, 0];
    p.rot.neck = [-0.05, 0.3 * Math.sin((TAU * t) / 6.7) * Math.sin((TAU * t) / 9.9), 0];
    p.rot.head = [0.05 * Math.sin((TAU * t) / 4.3), 0, 0];
    for (const k of ["FL", "FR", "HL", "HR"]) p.ik[`leg.${k}`] = { at: [(k[1] === "L" ? -1 : 1) * b.w, b.ankleH, k[0] === "F" ? zF : zH], w: 1 };
    p.rot.tail0 = [0.15, 0.4 * Math.sin((TAU * t) / 2.6), 0];
    p.rot.tail1 = [0.1, 0.4 * Math.sin((TAU * t) / 2.6 - 0.8), 0];
    p.rot.tail2 = [0.05, 0.4 * Math.sin((TAU * t) / 2.6 - 1.6), 0];
    return p;
  },
  /** Walk into trot into gallop as one gait, by params.speed (what the animator plays). */
  move: (spec, t, ph, params = {}) => quadGait(spec, t, ph, gaitAt(spec, params.speed ?? 0)),
  walk: (spec, t, ph) => quadGait(spec, t, ph, GAITS.walk),
  trot: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.trot),
  gallop: (spec, t, ph) => quadGait(spec, t, ph, HOPPERS.has(spec.species) ? GAITS.bound : GAITS.gallop),
  bound: (spec, t, ph) => quadGait(spec, t, ph, GAITS.bound),
  /** Sitting: haunches down, pelvis tipped back, fore legs straight, tail round the paws. */
  sit(spec, t) {
    const { b, zF, zH, rF } = quadAt(spec);
    const p = blank();
    const py = b.bodyR * 1.12;
    const a = pitchFor(spec, py, b.ankleH + rF * 0.96);
    p.root.off = [0, py - b.hipH, 0];
    p.rot.pelvis = [a, 0, 0];
    p.rot.neck = [-a * 0.75, 0.25 * Math.sin((TAU * t) / 7), 0];
    p.rot.head = [-a * 0.2, 0, 0];
    // Where the shoulders went: up and back, round the pelvis.
    const rise = b.shoulderH - b.hipH;
    const zc = zH + rise * Math.sin(a) + b.bodyLen * Math.cos(a);
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH, zc + b.pawLen * 0.2], w: 1 };
      // (The hind knee comes up by the flank, the hock goes down behind it.)
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.35, b.ankleH, zH + b.upperH * 0.9], w: 1, pole: [x * 0.3, 0.7, 1] };
    }
    // (A tail pointing back is LIFTED by +rx: this lays it down on the ground, then curls it round.)
    p.rot.tail0 = [-(b.tailRise ?? 0.4) - a - 0.15, 0.5, 0];
    p.rot.tail1 = [0.05, 0.7, 0];
    p.rot.tail2 = [0, 0.7, 0];
    return p;
  },
  /** Lying down: belly on the ground, fore paws out ahead, hinds tucked, head up. */
  lie(spec, t) {
    const { b, zF, zH } = quadAt(spec);
    const p = blank();
    const br = Math.sin((TAU * t) / 3.6);
    const a = pitchFor(spec, b.bodyR * 1.1, b.bodyR * 1.25 + Math.max(0, b.shoulderH - b.hipH) * 0.3);
    p.root.off = [0, b.bodyR * 1.1 - b.hipH, 0];
    p.rot.pelvis = [a, 0, 0];
    p.rot.spine = [br * 0.015, 0, 0];
    p.rot.neck = [-0.25, 0.3 * Math.sin((TAU * t) / 8), 0];
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w * 1.1, b.ankleH, zF + b.upperF * 1.25], w: 1 };
      p.ik[`leg.H${side}`] = { at: [x * b.w * 1.9, b.ankleH, zH + b.upperH * 0.9], w: 1, yaw: x * 0.5, pole: [x * 0.8, 0.6, 0.5] };
    }
    p.rot.tail0 = [-(b.tailRise ?? 0.4) - a - 0.1, 0.5, 0];
    p.rot.tail1 = [0, 0.5, 0];
    p.rot.tail2 = [0, 0.4, 0];
    return p;
  },
  /** In the air: fore legs reaching ahead, hinds stretched behind. */
  leap(spec) {
    const { b, zF, zH, rF, rH } = quadAt(spec);
    const p = blank();
    for (const [side, x] of SIDES) {
      p.ik[`leg.F${side}`] = { at: [x * b.w, b.ankleH + rF * 0.55, zF + rF * 0.6], w: 1, pitch: -0.3 };
      p.ik[`leg.H${side}`] = { at: [x * b.w, b.ankleH + rH * 0.45, zH - rH * 0.65], w: 1, pitch: 0.6 };
    }
    p.rot.spine = [-0.08, 0, 0];
    p.rot.neck = [0.1, 0, 0];
    p.rot.tail0 = [0.1, 0, 0];
    p.ears = 0.8;
    return p;
  },
};

/** The clip table for a spec's body plan. */
export const clipsFor = (spec) => (spec.plan === "quadruped" ? QUADRUPED_CLIPS : HUMANOID_CLIPS);
/** Which clips move the gait phase (the others hold it where it is). */
export const LOCOMOTION = new Set(["walk", "run", "move", "skim", "wallRun", "trot", "gallop", "bound"]);
export const LAND_TIME = 0.22;
// How long each clip takes to fade in, in units of the animator's `fade` (a landing is sudden, lying down isn't).
const FADES = { land: 0.85, jump: 0.9, fall: 1.5, sit: 2.5, lie: 3, turn: 1.5, idle: 1.5, gallop: 1.3, trot: 1.3 };

// ---- blending ----

/** Blend poses: [[pose, weight], ...] -> one pose (weights normalised). */
export function blendPoses(list) {
  let total = 0;
  for (const [, w] of list) total += w;
  if (!(total > 0)) return list.length ? list[0][0] : blank();
  if (list.length === 1) return list[0][0];
  const out = blank();
  const names = new Set();
  const chains = new Set();
  for (const [p] of list) { for (const n of Object.keys(p.rot)) names.add(n); for (const n of Object.keys(p.ik)) chains.add(n); }
  for (const n of names) out.rot[n] = [0, 0, 0];
  for (const [p, w0] of list) {
    const w = w0 / total;
    out.root.yaw += w * (p.root.yaw ?? 0); out.root.pitch += w * (p.root.pitch ?? 0); out.root.roll += w * (p.root.roll ?? 0);
    for (let i = 0; i < 3; i += 1) out.root.off[i] += w * (p.root.off?.[i] ?? 0);
    if (p.root.shift) { out.root.shift ??= [0, 0, 0]; for (let i = 0; i < 3; i += 1) out.root.shift[i] += w * p.root.shift[i]; }
    for (const n of names) { const r = p.rot[n]; if (r) for (let i = 0; i < 3; i += 1) out.rot[n][i] += w * r[i]; }
    out.ears += w * (p.ears ?? 0);
    out.cycle += w * (p.cycle ?? 0);
  }
  for (const n of chains) {
    let sw = 0;
    const g = { at: [0, 0, 0], w: 0, pitch: 0, yaw: 0 };
    let pole = null;
    for (const [p, w0] of list) {
      const e = p.ik[n];
      if (!e) continue;
      const w = w0 / total;
      sw += w;
      for (let i = 0; i < 3; i += 1) g.at[i] += w * e.at[i];
      g.w += w * (e.w ?? 1); g.pitch += w * (e.pitch ?? 0); g.yaw += w * (e.yaw ?? 0);
      if (e.pole) pole = pole ? pole.map((v, i) => v + w * e.pole[i]) : e.pole.map((v) => v * w);
    }
    g.at = g.at.map((v) => v / sw); g.pitch /= sw; g.yaw /= sw;
    if (pole) g.pole = pole.map((v) => v / sw);
    // (A chain only some clips place blends toward where FK leaves it.)
    g.flat = g.w > 0.999;
    out.ik[n] = g;
  }
  return out;
}

// ---- the animator ----

/**
 * animator(spec, { fade }) -> { step(dt, body, { dist }), pose, state, hold(clip, params), release(),
 *                                skeleton(), capsules(materials) }
 * body: { pos: feet on the ground, vel, facing (yaw), mode: ground|air|wall|grind|skim|sink,
 *         wall: normal from the wall to the body, wallGap?: how far pos is from the wall }
 * The phase runs on distance travelled (body.pos between steps, or `dist` if given).
 */
export function animator(spec, { fade = 0.14 } = {}) {
  const quad = spec.plan === "quadruped";
  const clips = clipsFor(spec);
  const b = spec.body;
  const reach = quad ? b.shoulderH - b.ankleH : b.hipH - b.ankleH;
  const st = { layers: [], phase: 0, time: 0, dist: 0, landT: 99, mode: null, facing: null, turn: 0, last: null, clip: null, held: null, params: {} };
  let pose = blank();
  let body0 = { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "ground" };

  function pick(body, speed) {
    if (st.held) return st.held.clip;
    const m = body.mode ?? "ground";
    if (quad) {
      if (m === "air" || m === "sink") return "leap";
      if (m === "wall" || m === "skim") return "gallop";
      if (speed < reach * 0.25) return "idle";
      if (speed < reach * QUAD_GAIT_AT.trot) return "walk";
      if (speed < reach * QUAD_GAIT_AT.gallop) return "trot";
      return "gallop";
    }
    if (m === "air") return (body.vel?.[1] ?? 0) > 0.5 ? "jump" : "fall";
    if (m === "sink") return "fall";
    if (m === "wall") return "wallRun";
    if (m === "grind") return "grind";
    if (m === "skim") return "skim";
    const runFrom = reach * RUN_FROM;
    if (st.landT < LAND_TIME && speed < runFrom) return "land";
    if (speed < reach * 0.3) return Math.abs(st.turn) > 1.5 ? "turn" : "idle";
    return speed < runFrom ? "walk" : "run";
  }

  const api = {
    get pose() { return pose; },
    get state() { return { clip: st.clip, phase: st.phase, time: st.time, dist: st.dist, layers: st.layers.map((l) => ({ ...l })) }; },
    /** Hold a clip whatever the body does (sit, lie, a pose for a cutscene) until release(). */
    hold(clip, params = {}) { if (!clips[clip]) throw new RangeError(`No ${spec.plan} clip "${clip}" (${Object.keys(clips).join(", ")}).`); st.held = { clip, params }; return api; },
    release() { st.held = null; return api; },
    /** Advance by dt seconds with the body as it is now. */
    step(dt, body, { dist } = {}) {
      body0 = body;
      st.time += dt;
      let dd;
      if (dist !== undefined) { dd = st.last === null ? 0 : Math.max(0, dist - st.last); st.last = dist; }
      else {
        const prev = st.prevPos ?? body.pos;
        const dy = body.mode === "wall" ? body.pos[1] - prev[1] : 0;
        dd = Math.hypot(body.pos[0] - prev[0], dy, body.pos[2] - prev[2]);
        st.prevPos = [...body.pos];
      }
      // (A teleport -- a respawn -- is not a step.)
      if (dd > reach * 20) dd = 0;
      st.dist += dd;
      const speed = Math.hypot(body.vel?.[0] ?? 0, body.vel?.[2] ?? 0);
      if (st.facing !== null && dt > 0) {
        const d = Math.atan2(Math.sin(body.facing - st.facing), Math.cos(body.facing - st.facing));
        st.turn += (d / dt - st.turn) * Math.min(1, dt * 10);
      }
      st.facing = body.facing ?? 0;
      if (st.mode !== null && st.mode !== "ground" && body.mode === "ground") st.landT = 0;
      else st.landT += dt;
      st.mode = body.mode;
      // Which side the wall is on: +1 its left (the wall's normal points to its right).
      const wall = body.mode === "wall" && body.wall ? Math.sign(body.wall[0] * rightOf(st.facing)[0] + body.wall[2] * rightOf(st.facing)[2]) : 0;
      // (The gait follows the speed a little behind it, so a sudden burst eases the stride open rather than snapping it.)
      // (Four legs take a stride or two to change gait: their footfalls reorder.)
      st.gait = st.gait === undefined ? speed : st.gait + (speed - st.gait) * Math.min(1, dt * (quad ? 3.5 : 10));
      st.params = { speed: st.gait, vy: body.vel?.[1] ?? 0, wall, wallGap: body.wallGap, turn: st.turn, ...(st.held?.params ?? {}) };

      const clip = pick(body, speed);
      // (Walk and run -- and on four legs trot and gallop -- are one layer, the move gait, told the speed.)
      const layer = clip === "walk" || clip === "run" || (quad && (clip === "trot" || clip === "gallop")) ? "move" : clip;
      st.clip = clip;
      if (!st.layers.some((l) => l.name === layer)) st.layers.push({ name: layer, w: st.layers.length ? 0 : 1 });
      const span = fade * (FADES[layer] ?? 1);
      const rate = span > 0 ? dt / span : 1;
      // (The new layer rises; the rest share what's left in the proportions they had, so the weights always sum to 1.)
      const top = st.layers.find((l) => l.name === layer);
      top.w = Math.min(1, top.w + rate);
      const rest = st.layers.reduce((a, l) => a + (l === top ? 0 : l.w), 0);
      for (const l of st.layers) if (l !== top) l.w = rest > 0 ? (l.w / rest) * (1 - top.w) : 0;
      st.layers = st.layers.filter((l) => l.w > 1e-6 || l === top);
      if (st.layers.length === 1) top.w = 1;
      // Phase: distance over the cycle length the moving layers ask for.
      if (pose.cycle > 1e-6) st.phase = frac(st.phase + dd / pose.cycle);
      const ph = { phase: st.phase, landT: st.landT };
      pose = blendPoses(st.layers.map((l) => [clips[l.name](spec, st.time, ph, st.params), l.w]));
      if (!(pose.cycle > 0)) {
        // (Standing still, the next step starts from a cycle a walk would use.)
        pose.cycle = clips.move(spec, st.time, ph, { speed: 0 }).cycle;
      }
      return api;
    },
    /** The posed skeleton in the world, at the body's feet, facing its heading. */
    skeleton(place) { return poseSkeleton(spec.rig, pose, place ?? { pos: body0.pos, yaw: body0.facing ?? 0 }); },
    /** The capsules to draw. */
    capsules(materials, opts) { return skinOf(spec, api.skeleton(), materials, opts); },
  };
  return api;
}

/** One clip at one moment, posed and skinned: for sheets, thumbnails and tests. */
export function posed(spec, clip, { t = 0, phase = 0, params = {}, pos = [0, 0, 0], yaw = 0, landT = 0 } = {}) {
  const clips = clipsFor(spec);
  if (!clips[clip]) throw new RangeError(`No ${spec.plan} clip "${clip}" (${Object.keys(clips).join(", ")}).`);
  const pose = clips[clip](spec, t, { phase, landT }, params);
  return poseSkeleton(spec.rig, pose, { pos, yaw });
}
