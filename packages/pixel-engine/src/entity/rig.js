// Skeletons: bone trees with rest offsets in the entity's own frame (core/frame.js:
// +z FRONT, +x its RIGHT hand, +y UP), posed by forward kinematics and a small
// two-bone IK for feet and hands.
//
// Two body plans:
//   humanoid   hips, spine, chest, neck, head, L/R shoulder-upperArm-forearm-hand,
//              L/R thigh-shin-foot, and a two-bone tail (skinned only when the
//              spec has one) -- people, and ANTHRO animals on a person's body.
//   quadruped  pelvis, spine, chest, neck, head, four legs of upper-lower-paw
//              (FL FR HL HR: fore/hind, left/right), a three-bone tail.
//
// "L" is always the entity's own left (-x), "R" its right (+x). Every bone's
// rest frame is the entity's frame, so a rest offset reads straight off the
// convention: [0, 0, 1] is ahead of the parent, [1, 0, 0] to its right.
//
// A POSE is plain data, easy to blend (clips.js makes them):
//   {
//     root: { yaw, pitch, roll, off, shift },      // the whole body about its ground point; off [x,y,z] moves the top
//                                                  // bone (bob, crouch), shift [x,y,z] moves everything (heading frame)
//     rot:  { boneName: [rx, ry, rz] },            // each bone about its own axes, Ry * Rx * Rz
//     ik:   { chainName: { at: [x, y, z], w, pitch, yaw } },  // an end target in the ROOT frame (feet planted), weight 0..1
//     ears, flare, ...                             // extras the skin may read (ears swept back, ...)
//   }
// Rotation signs (right-handed about the bone's own axis):
//   rx > 0  tips a bone that points up FORWARD, swings a hanging one BACK, tips a forward one DOWN
//           (and so LIFTS one pointing back, like a tail)
//   ry > 0  turns the bone's front (+z) toward its right hand (+x) -- the same way a yaw turns
//   rz > 0  tips a bone that points up toward -x (its left), swings a hanging one toward +x (its right)

import { frontOf } from "../core/frame.js";

// ---- 3x3 rotations (row-major, local -> world) ----

export const IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
export const rotX = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a) => { const c = Math.cos(a); const s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
export function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}
export const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
/** Ry(ry) * Rx(rx) * Rz(rz): yaw, then pitch, then roll (the order kit.js rotation uses). */
export function euler(rx = 0, ry = 0, rz = 0) {
  if (rx === 0 && ry === 0 && rz === 0) return [...IDENTITY];
  return mul(rotY(ry), mul(rotX(rx), rotZ(rz)));
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; };

/** The rotation that takes unit vector u onto unit vector v (the shortest turn). */
export function rotateOnto(u, v) {
  const c = dot(u, v);
  if (c > 1 - 1e-12) return [...IDENTITY];
  let k = cross(u, v);
  if (c < -1 + 1e-9) {
    // (Opposite: half a turn about anything perpendicular.)
    k = Math.abs(u[0]) < 0.9 ? cross(u, [1, 0, 0]) : cross(u, [0, 1, 0]);
    k = unit(k);
    return [2 * k[0] * k[0] - 1, 2 * k[0] * k[1], 2 * k[0] * k[2], 2 * k[1] * k[0], 2 * k[1] * k[1] - 1, 2 * k[1] * k[2], 2 * k[2] * k[0], 2 * k[2] * k[1], 2 * k[2] * k[2] - 1];
  }
  const s = len(k);
  k = scale(k, 1 / s);
  const t = 1 - c;
  const [x, y, z] = k;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

// ---- two-bone IK ----

/**
 * Two bones from `a` of lengths L1, L2 reaching for `target`, the middle joint
 * bending toward `pole` (a world direction). Lengths are kept exactly: a target
 * out of reach is reached for along the line and fallen short of.
 * Returns { mid, end, reached }.
 */
export function solveTwoBone(a, target, L1, L2, pole) {
  let d = sub(target, a);
  let dist = len(d);
  const n = dist > 1e-9 ? scale(d, 1 / dist) : unit(pole);
  const lo = Math.abs(L1 - L2) + 1e-9;
  const hi = L1 + L2 - 1e-9;
  const reached = dist <= hi && dist >= lo;
  dist = Math.min(hi, Math.max(lo, dist));
  const end = add(a, scale(n, dist));
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  let q = sub(pole, scale(n, dot(pole, n)));
  if (len(q) < 1e-9) q = Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0]);
  q = unit(q);
  const mid = add(a, add(scale(n, L1 * cosA), scale(q, L1 * sinA)));
  return { mid, end, reached };
}

// ---- body plans ----

/**
 * A humanoid rig from proportions (world units):
 *   hipH ankleH thigh shin footLen footR hipW torso neck headR
 *   shoulderW upperArm forearm handLen torsoR tailLen
 * (species.js makes these from a seed.)
 */
export function humanoidRig(b) {
  const T = b.torso;
  const tl = b.tailLen || b.torsoR * 0.5;
  const tailDir = unit([0, 0.55, -1]);
  const bones = [
    { name: "hips", parent: null, off: [0, b.hipH, 0] },
    { name: "spine", parent: "hips", off: [0, T * 0.28, 0] },
    { name: "chest", parent: "spine", off: [0, T * 0.3, 0] },
    { name: "neck", parent: "chest", off: [0, T * 0.42, 0] },
    { name: "head", parent: "neck", off: [0, b.neck, 0], tip: [0, b.headR * 2, 0] },
    { name: "tail0", parent: "hips", off: [0, T * 0.05, -b.torsoR * 0.8] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, tl * 0.5), tip: scale(tailDir, tl * 0.5) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]]) {
    bones.push(
      { name: `shoulder.${side}`, parent: "chest", off: [s * b.shoulderW * 0.35, T * 0.36, 0] },
      { name: `upperArm.${side}`, parent: `shoulder.${side}`, off: [s * b.shoulderW * 0.65, 0, 0] },
      { name: `forearm.${side}`, parent: `upperArm.${side}`, off: [0, -b.upperArm, 0] },
      { name: `hand.${side}`, parent: `forearm.${side}`, off: [0, -b.forearm, 0], tip: [0, -b.handLen, 0] },
      { name: `thigh.${side}`, parent: "hips", off: [s * b.hipW, 0, 0] },
      { name: `shin.${side}`, parent: `thigh.${side}`, off: [0, -b.thigh, 0] },
      // (The foot's tip is the toe: ahead on +z, down at the sole.)
      { name: `foot.${side}`, parent: `shin.${side}`, off: [0, -b.shin, 0], tip: [0, -(b.ankleH - b.footR), b.footLen * 0.78] },
    );
  }
  return makeRig("humanoid", bones, {
    "leg.L": { bones: ["thigh.L", "shin.L", "foot.L"], pole: [0, 0, 1], poleIn: "hips" },
    "leg.R": { bones: ["thigh.R", "shin.R", "foot.R"], pole: [0, 0, 1], poleIn: "hips" },
    // (Elbows bend back and a little out.)
    "arm.L": { bones: ["upperArm.L", "forearm.L", "hand.L"], pole: [-0.35, 0, -1], poleIn: "chest" },
    "arm.R": { bones: ["upperArm.R", "forearm.R", "hand.R"], pole: [0.35, 0, -1], poleIn: "chest" },
  }, b);
}

/**
 * A quadruped rig from proportions:
 *   shoulderH hipH bodyLen bodyR neckLen neckRise headR w
 *   upperF lowerF upperH lowerH ankleH pawLen pawR tailLen tailRise
 * Fore legs bend at the wrist (the joint shows forward), hind legs at the hock (it shows behind).
 */
export function quadrupedRig(b) {
  const rise = (b.shoulderH - b.hipH) * 0.5;
  const seg = b.tailLen / 3;
  const tr = b.tailRise ?? 0.4;
  const tailDir = [0, Math.sin(tr), -Math.cos(tr)];
  const bones = [
    { name: "pelvis", parent: null, off: [0, b.hipH, -b.bodyLen / 2] },
    { name: "spine", parent: "pelvis", off: [0, rise, b.bodyLen / 2] },
    { name: "chest", parent: "spine", off: [0, rise, b.bodyLen / 2] },
    { name: "neck", parent: "chest", off: [0, b.bodyR * 0.35, b.bodyR * 0.45] },
    { name: "head", parent: "neck", off: [0, b.neckLen * Math.sin(b.neckRise), b.neckLen * Math.cos(b.neckRise)], tip: [0, 0, b.headR * 2] },
    { name: "tail0", parent: "pelvis", off: [0, b.bodyR * 0.3, -b.bodyR * 0.55] },
    { name: "tail1", parent: "tail0", off: scale(tailDir, seg) },
    { name: "tail2", parent: "tail1", off: scale(tailDir, seg), tip: scale(tailDir, seg) },
  ];
  for (const [s, side] of [[-1, "L"], [1, "R"]]) {
    for (const [end, parent, up, lo] of [["F", "chest", b.upperF, b.lowerF], ["H", "pelvis", b.upperH, b.lowerH]]) {
      const k = `${end}${side}`;
      bones.push(
        { name: `upper.${k}`, parent, off: [s * b.w, 0, 0] },
        { name: `lower.${k}`, parent: `upper.${k}`, off: [0, -up, 0] },
        { name: `paw.${k}`, parent: `lower.${k}`, off: [0, -lo, 0], tip: [0, -(b.ankleH - b.pawR), b.pawLen] },
      );
    }
  }
  const chains = {};
  for (const k of ["FL", "FR", "HL", "HR"]) {
    chains[`leg.${k}`] = { bones: [`upper.${k}`, `lower.${k}`, `paw.${k}`], pole: [0, 0, k[0] === "F" ? 1 : -1], poleIn: k[0] === "F" ? "chest" : "pelvis" };
  }
  return makeRig("quadruped", bones, chains, b);
}

function makeRig(plan, bones, chains, body) {
  const index = {};
  bones.forEach((bone, i) => {
    if (bone.parent !== null && index[bone.parent] === undefined) throw new Error(`${plan}: ${bone.name} comes before its parent ${bone.parent}`);
    index[bone.name] = i;
  });
  const children = Object.fromEntries(bones.map((bn) => [bn.name, []]));
  for (const bn of bones) if (bn.parent) children[bn.parent].push(bn.name);
  // Each chain's rest lengths (the IK keeps them).
  for (const c of Object.values(chains)) c.lengths = [len(bones[index[c.bones[1]]].off), len(bones[index[c.bones[2]]].off)];
  return { plan, bones, index, children, chains, body, top: bones[0].name };
}

/** Rest length of every bone that has a parent bone (its offset from that parent). */
export function restLengths(rig) {
  const out = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(bn.off);
  return out;
}

// ---- posing ----

/**
 * Pose a rig into the world. `place` is where the entity stands: its ground
 * point `pos` and its heading `yaw` (core/frame.js: yaw 0 faces +z).
 * Returns a skeleton: { plan, root: { pos, yaw, m }, bones: { name: { p, m } }, pose }
 * where p is the bone's joint in the world and m its world rotation.
 */
export function poseSkeleton(rig, pose = {}, place = {}) {
  const R = pose.root ?? {};
  const yaw = place.yaw ?? 0;
  // (root.shift moves the whole body, feet and all, in its heading frame: onto a wall, off a ledge.)
  const pos = R.shift ? add(place.pos ?? [0, 0, 0], apply(rotY(yaw), R.shift)) : place.pos ?? [0, 0, 0];
  const rootM = mul(rotY(yaw + (R.yaw ?? 0)), mul(rotX(R.pitch ?? 0), rotZ(R.roll ?? 0)));
  const rot = pose.rot ?? {};
  const out = {};
  const fk = (bn) => {
    const parent = bn.parent ? out[bn.parent] : { p: pos, m: rootM };
    const off = bn.parent ? bn.off : add(bn.off, R.off ?? [0, 0, 0]);
    const r = rot[bn.name];
    out[bn.name] = { p: add(parent.p, apply(parent.m, off)), m: r ? mul(parent.m, euler(r[0], r[1], r[2])) : parent.m };
  };
  for (const bn of rig.bones) fk(bn);
  const refk = (name) => { for (const c of rig.children[name]) { fk(rig.bones[rig.index[c]]); refk(c); } };

  for (const [name, goal] of Object.entries(pose.ik ?? {})) {
    const chain = rig.chains[name];
    const w = goal?.w ?? 1;
    if (!chain || !(w > 0) || !goal.at) continue;
    const [b0, b1, b2] = chain.bones;
    const A = out[b0].p;
    const wanted = add(pos, apply(rootM, goal.at));
    const target = w >= 1 ? wanted : add(out[b2].p, scale(sub(wanted, out[b2].p), w));
    const pole = unit(apply(out[chain.poleIn].m, goal.pole ?? chain.pole));
    const [L1, L2] = chain.lengths;
    const { mid, end } = solveTwoBone(A, target, L1, L2, pole);
    // The two bones turn (shortest turn from where FK had them), the end lands on the target.
    const r0 = rig.bones[rig.index[b1]].off;
    const r1 = rig.bones[rig.index[b2]].off;
    const m0 = mul(rotateOnto(unit(apply(out[b0].m, r0)), unit(sub(mid, A))), out[b0].m);
    const m1fk = mul(m0, euler(...(rot[b1] ?? [0, 0, 0])));
    const m1 = mul(rotateOnto(unit(apply(m1fk, r1)), unit(sub(end, mid))), m1fk);
    out[b0] = { p: A, m: m0 };
    out[b1] = { p: mid, m: m1 };
    // (A planted end lies flat in the root frame, turned by its own pitch and yaw; a free one follows its bone.)
    const flat = goal.flat ?? w >= 1;
    const m2 = flat ? mul(rootM, euler(goal.pitch ?? 0, goal.yaw ?? 0, 0)) : mul(m1, euler(...(rot[b2] ?? [0, 0, 0])));
    out[b2] = { p: end, m: m2 };
    refk(b2);
  }
  return { plan: rig.plan, root: { pos: [...pos], yaw, m: rootM }, bones: out, pose };
}

/** A point in a bone's frame -> world. */
export const boneToWorld = (skel, name, local) => { const b = skel.bones[name]; return add(b.p, apply(b.m, local)); };
/** A bone's own +z (its front) in the world. */
export const boneFront = (skel, name) => apply(skel.bones[name].m, [0, 0, 1]);

/** Measured bone lengths of a posed skeleton (distance to the parent's joint). */
export function measuredLengths(rig, skel) {
  const out = {};
  for (const bn of rig.bones) if (bn.parent) out[bn.name] = len(sub(skel.bones[bn.name].p, skel.bones[bn.parent].p));
  return out;
}

/** The declared front of a posed skeleton: its heading (plus any root yaw in the pose). */
export const declaredFront = (skel) => frontOf(skel.root.yaw + (skel.pose?.root?.yaw ?? 0));
