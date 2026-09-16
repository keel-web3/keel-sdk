// Skin: a spec and a posed skeleton -> capsules for the renderer, in the world.
// A sphere is a capsule with both ends together. Every capsule is tagged with
// the PART it is (so front detection, tests and games can find the face, the
// hands, the toes) and the ROLE its material plays (fur, cloth, ...), which a
// caller's table turns into the renderer's material numbers.
//
//   const caps = skinOf(spec, skeleton, { fur: 6, cloth: 7, accent: 8, dark: 3, blush: 9 });
//   renderer.setWorld({ boxes, capsules: [...level, ...caps] });
//
// Parts (L is the entity's own left, R its right):
//   two legs   hips chest neck head eye.L eye.R brow.L brow.R nose snout ear.L ear.R
//              innerEar.L innerEar.R hair hair.back hood pack tail tail.tip accessory
//              upperArm.* forearm.* hand.* thigh.* shin.* foot.*
//   four legs  body chest neck head eye.* nose snout ear.* antler.* collar tail tail.mid tail.tip
//              upper.FL.. lower.FL.. paw.FL..
// A foot.* / paw.* capsule runs heel (a) -> toe (b): its b is the toe, on the front.

import { boneToWorld } from "./rig.js";

/** WALLRUN's material numbers (projects/wallrun/palette.js), the default table. */
export const DEFAULT_MATERIALS = Object.freeze({ dark: 3, fur: 6, cloth: 7, accent: 8, blush: 9 });
// (A role the caller's table leaves out falls back along here.)
const FALLBACK = { furAlt: "fur", clothAlt: "dark", hair: "dark", accent: "cloth", blush: "fur", cloth: "fur", fur: "dark" };
/** The most capsules a skin makes (the renderer holds 64 in a whole scene). */
export const MAX_CAPSULES = 28;

export function materialFor(role, table = DEFAULT_MATERIALS) {
  let r = role;
  for (let i = 0; i < 8 && table[r] === undefined; i += 1) r = FALLBACK[r];
  return table[r] ?? 0;
}

/**
 * skinOf(spec, skeleton, materials?, { max }) -> [{ a, b, r, mat, part, role }]
 * No more than `max` (28) capsules: the least important (inner ears first) go when a look runs over.
 */
export function skinOf(spec, skel, materials = DEFAULT_MATERIALS, { max = MAX_CAPSULES } = {}) {
  const list = [];
  // (keep: 0 is essential; higher goes first when over budget)
  const cap = (part, role, a, b, r, drop = 0) => list.push({ a, b, r, part, role, drop });
  const ball = (part, role, p, r, drop = 0) => cap(part, role, p, p, r, drop);
  const W = (bone, local) => boneToWorld(skel, bone, local);
  const P = (bone) => skel.bones[bone].p;
  if (spec.plan === "quadruped") skinQuadruped(spec, skel, { cap, ball, W, P });
  else skinHumanoid(spec, skel, { cap, ball, W, P });
  let out = list;
  if (out.length > max) {
    // (Drop the most droppable, latest first, until it fits.)
    const order = out.map((c, i) => [c.drop, i]).sort((x, y) => y[0] - x[0] || y[1] - x[1]);
    const gone = new Set(order.slice(0, out.length - max).map(([, i]) => i));
    out = out.filter((_, i) => !gone.has(i));
  }
  return out.map(({ a, b, r, part, role }) => ({ a, b, r, mat: materialFor(role, materials), part, role }));
}

function skinHumanoid(spec, skel, { cap, ball, W, P }) {
  const B = spec.body;
  const F = spec.features;
  const O = spec.outfit;
  const human = spec.kind === "humanoid";
  const hr = B.headR;
  const T = B.torso;
  const longTop = O.top === "jacket" || O.top === "hoodie";
  const sleeves = longTop || O.top === "tee";
  const bare = O.top === "none";

  // The torso: a pelvis and a chest (a person's chest runs across the shoulders).
  cap("hips", longTop ? "cloth" : O.pants !== "none" ? "clothAlt" : bare ? "fur" : "cloth", P("hips"), P("spine"), B.torsoR * (human ? 0.9 : 0.93));
  if (human) cap("chest", bare ? "fur" : "cloth", W("chest", [-B.shoulderW * 0.42, T * 0.24, 0]), W("chest", [B.shoulderW * 0.42, T * 0.24, 0]), B.torsoR);
  else cap("chest", bare ? "fur" : "cloth", P("spine"), W("neck", [0, -B.torsoR * 0.35, 0]), B.torsoR);

  // Legs: thigh, shin, a foot from heel to toe.
  for (const s of ["L", "R"]) {
    cap(`thigh.${s}`, O.pants === "none" ? "fur" : "clothAlt", P(`thigh.${s}`), P(`shin.${s}`), B.legR);
    cap(`shin.${s}`, O.pants === "long" ? "clothAlt" : "fur", P(`shin.${s}`), P(`foot.${s}`), B.legR * 0.92);
    const sole = -(B.ankleH - B.footR);
    cap(`foot.${s}`, O.shoes === "bare" ? (F.coat === "socks" ? "furAlt" : "fur") : "dark", W(`foot.${s}`, [0, sole, -B.footLen * 0.18]), W(`foot.${s}`, [0, sole, B.footLen * 0.78]), B.footR);
  }
  // Arms: sleeves as far as the top has them, fur (or skin) past that.
  for (const s of ["L", "R"]) {
    cap(`upperArm.${s}`, sleeves ? "cloth" : "fur", P(`upperArm.${s}`), P(`forearm.${s}`), B.armR);
    cap(`forearm.${s}`, longTop ? "cloth" : "fur", P(`forearm.${s}`), P(`hand.${s}`), B.armR * 0.95);
    ball(`hand.${s}`, F.coat === "socks" ? "furAlt" : "fur", W(`hand.${s}`, [0, -B.handLen * 0.45, 0]), B.armR * (human ? 1.15 : 1.3));
  }

  // The head. Its centre sits a radius up the head bone; the face is its +z.
  const C = (x, y, z) => W("head", [x * hr, hr * (1 + y), z * hr]);
  if (human) cap("neck", "fur", P("neck"), P("head"), B.armR * 1.25);
  ball("head", "fur", C(0, 0, 0.04), hr);
  const er = F.eyes.r * hr;
  if (F.frogEyes) {
    for (const [s, x] of [["L", -1], ["R", 1]]) {
      ball(`brow.${s}`, "fur", C(x * 0.5, 0.62, 0.42), hr * 0.34);
      ball(`eye.${s}`, "dark", C(x * 0.5, 0.72, 0.72), er);
    }
  } else {
    for (const [s, x] of [["L", -1], ["R", 1]]) ball(`eye.${s}`, "dark", C(x * F.eyes.spread, 0.02, 0.88), er);
  }
  const sn = F.snout;
  if (human) ball("nose", "fur", C(0, -0.12, 0.98), hr * 0.12);
  else if (sn > 0.3) {
    cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.3, 0.55), C(0, -0.32, 0.72 + sn), hr * 0.3);
    ball("nose", spec.species === "bear" || spec.species === "dog" ? "dark" : "blush", C(0, -0.2, 0.98 + sn), hr * 0.12);
  } else if (sn > 0) {
    if (F.coat === "muzzle") ball("snout", "furAlt", C(0, -0.3, 0.72), hr * 0.3);
    ball("nose", "blush", C(0, -0.18, 0.93 + sn * 0.6), hr * (0.07 + sn * 0.3));
  } else {
    ball("nose", "fur", C(0, -0.25, 0.97), hr * 0.08); // (a frog: a nub of a nose, still on the front)
  }
  ears(spec, skel, cap, ball, C, hr, skel.pose?.ears ?? 0);

  // Hair, hood, hat, pack, tail.
  const hair = F.hair;
  if (hair !== "none") {
    ball("hair", "hair", C(0, 0.14, -0.1), hr * 0.99);
    if (hair === "long") cap("hair.back", "hair", C(0, 0.1, -0.4), C(0, -1.25, -0.55), hr * 0.66);
    if (hair === "bun") ball("hair.back", "hair", C(0, 0.95, -0.5), hr * 0.42);
    if (hair === "spiky") cap("hair.back", "hair", C(0, 0.4, -0.15), C(0, 1.05, -0.5), hr * 0.5);
    if (hair === "pony") cap("hair.back", "hair", C(0, 0.45, -0.9), C(0, -0.7, -1.3), hr * 0.3);
  }
  if (O.hood) cap("hood", "cloth", C(0, 0.06, -0.3), C(0, -0.4, -0.45), hr * 0.95, 4);
  const acc = O.accessory;
  if (acc === "scarf") cap("accessory", "accent", W("neck", [-B.torsoR * 0.55, 0, B.torsoR * 0.2]), W("neck", [B.torsoR * 0.55, 0, B.torsoR * 0.2]), B.armR * 1.15, 3);
  if (acc === "cap") cap("accessory", "accent", C(0, 0.72, -0.1), C(0, 0.55, 0.78), hr * 0.48, 3);
  if (acc === "goggles") cap("accessory", "dark", C(-0.55, 0.42, 0.78), C(0.55, 0.42, 0.78), hr * 0.18, 3);
  if (acc === "headband") cap("accessory", "accent", C(-0.62, 0.5, 0.62), C(0.62, 0.5, 0.62), hr * 0.12, 3);
  if (O.pack !== "none") {
    const pr = B.torsoR * (O.pack === "round" ? 0.95 : O.pack === "tall" ? 0.72 : 0.7);
    const back = -(B.torsoR + pr * 0.45);
    if (O.pack === "tall") cap("pack", "accent", W("chest", [0, -T * 0.08, back]), W("chest", [0, T * 0.3, back]), pr, 2);
    else ball("pack", "accent", W("chest", [0, T * 0.12, back]), pr, 2);
  }
  tail(spec, skel, cap, ball, P, W, B.legR, B.torsoR);
}

// Ears by shape, on the top of the head, leaning out; `back` sweeps them back (a run, a fall).
function ears(spec, skel, cap, ball, C, hr, back) {
  const E = spec.features.ears;
  if (E.shape === "none" || !(E.len > 0)) return;
  const sp = E.spread;
  const up = Math.sqrt(Math.max(0, 1 - sp * sp));
  for (const [s, x] of [["L", -1], ["R", 1]]) {
    const base = [x * sp * 0.95, up * 0.95, -0.05];
    let dir;
    if (E.shape === "lop") dir = [x * 0.75, -0.62, -0.15];
    else if (E.shape === "flop") dir = [x * 0.45, -0.88, 0.1];
    else if (E.shape === "side") dir = [x * 0.95, 0.3, -0.15];
    else dir = [x * 0.28, 1, -0.08 - back * 0.9];
    const l = Math.hypot(...dir);
    const tip = [base[0] + (dir[0] / l) * E.len, base[1] + (dir[1] / l) * E.len, base[2] + (dir[2] / l) * E.len];
    if (E.shape === "round" || E.shape === "big") { ball(`ear.${s}`, "fur", C(base[0] * 1.05, base[1] * 1.05, 0), E.w * hr); continue; }
    cap(`ear.${s}`, "fur", C(...base), C(...tip), E.w * hr);
    if (E.shape !== "flop" && E.shape !== "lop" && E.shape !== "side") {
      cap(`innerEar.${s}`, "blush", C(base[0], base[1], 0.02), C((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2 + E.w * 0.6), E.w * hr * 0.5, 9);
    }
  }
}

function tail(spec, skel, cap, ball, P, W, legR, bodyR) {
  const T = spec.features.tail;
  if (T.shape === "none" || !(T.len > 0)) return;
  const quad = spec.plan === "quadruped";
  const tip = quad ? W("tail2", spec.rig.bones[spec.rig.index.tail2].tip) : W("tail1", spec.rig.bones[spec.rig.index.tail1].tip);
  const tipped = spec.features.coat === "tipped" ? "furAlt" : "fur";
  if (T.shape === "puff" || T.shape === "stub") { ball("tail", quad ? "furAlt" : "fur", P("tail0"), Math.max(T.len * (quad ? 0.3 : 0.9), legR)); return; }
  const r = T.shape === "bushy" ? bodyR * (quad ? 0.32 : 0.28) : T.shape === "thin" ? legR * 0.32 : legR * (quad ? 0.8 : 0.62);
  if (quad) {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.8 : 1));
    cap("tail.mid", "fur", P("tail1"), P("tail2"), r * (T.shape === "bushy" ? 1.25 : 1), 1);
    cap("tail.tip", tipped, P("tail2"), tip, r * (T.shape === "bushy" ? 1.15 : 0.9));
  } else {
    cap("tail", "fur", P("tail0"), P("tail1"), r * (T.shape === "bushy" ? 0.85 : 1));
    cap("tail.tip", tipped, P("tail1"), tip, r * (T.shape === "bushy" ? 1.3 : 0.9), 1);
  }
}

function skinQuadruped(spec, skel, { cap, ball, W, P }) {
  const B = spec.body;
  const F = spec.features;
  const hr = B.headR;
  cap("body", "fur", W("pelvis", [0, 0, -B.bodyR * 0.15]), P("chest"), B.bodyR);
  ball("chest", "fur", W("chest", [0, -B.bodyR * 0.08, B.bodyR * 0.1]), B.bodyR * 1.08, 5);
  cap("neck", "fur", P("neck"), P("head"), Math.min(B.bodyR * 0.55, hr * 0.75));
  const C = (x, y, z) => W("head", [x * hr, hr * (0.25 + y), hr * (0.5 + z)]);
  ball("head", "fur", C(0, 0, 0), hr);
  const sn = F.snout;
  cap("snout", F.coat === "muzzle" ? "furAlt" : "fur", C(0, -0.25, 0.4), C(0, -0.3, 0.55 + sn), hr * 0.42);
  ball("nose", spec.species === "cat" || spec.species === "rabbit" || spec.species === "mouse" ? "blush" : "dark", C(0, -0.14, 0.9 + sn), hr * 0.15);
  for (const [s, x] of [["L", -1], ["R", 1]]) ball(`eye.${s}`, "dark", C(x * F.eyes.spread * 1.1, 0.3, 0.84), F.eyes.r * hr);
  ears(spec, skel, cap, ball, (x, y, z) => C(x, y, z - 0.1), hr, skel.pose?.ears ?? 0);
  if (F.antlers) {
    for (const [s, x] of [["L", -1], ["R", 1]]) {
      cap(`antler.${s}`, "furAlt", C(x * 0.35, 0.85, -0.1), C(x * 1.1, 2.4, -0.45), hr * 0.1);
      cap(`antler.${s}`, "furAlt", C(x * 0.75, 1.6, -0.27), C(x * 0.55, 2.3, 0.35), hr * 0.08, 6);
    }
  }
  if (spec.outfit.accessory === "collar") cap("collar", "accent", W("neck", [-B.bodyR * 0.5, 0, B.bodyR * 0.1]), W("neck", [B.bodyR * 0.5, 0, B.bodyR * 0.1]), B.legR * 0.9, 3);
  for (const k of ["FL", "FR", "HL", "HR"]) {
    const hind = k[0] === "H";
    cap(`upper.${k}`, "fur", P(`upper.${k}`), P(`lower.${k}`), B.legR * (hind ? 1.45 : 1.15));
    cap(`lower.${k}`, "fur", P(`lower.${k}`), P(`paw.${k}`), B.legR);
    const sole = -(B.ankleH - B.pawR);
    cap(`paw.${k}`, F.coat === "socks" ? "furAlt" : "fur", W(`paw.${k}`, [0, sole, -B.pawR * 0.3]), W(`paw.${k}`, [0, sole, B.pawLen]), B.pawR);
  }
  tail(spec, skel, cap, ball, P, W, B.legR, B.bodyR);
}

/** Lowest point of a set of capsules (the soles, standing). */
export const lowestY = (caps) => Math.min(...caps.map((c) => Math.min(c.a[1], c.b[1]) - c.r));
/** Capsules of one part (or parts starting with a prefix: "eye." -> both eyes). */
export const partsOf = (caps, name) => caps.filter((c) => c.part === name || (name.endsWith(".") && c.part.startsWith(name)));

