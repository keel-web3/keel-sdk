// Primitives as parts: the renderer's and the physics' two solids -- a box
// turned about y, and a capsule -- made into scene parts (an SDF and its
// bounds) that remember what they were, so an object built from them can hand
// the same solids back to the renderer and the character controller.
//
//   box      { c:[x,y,z], h:[hx,hy,hz], yaw }   turned about y (core/frame.js)
//   capsule  { a:[x,y,z], b:[x,y,z], r }
//
// A box's yaw is the frame.js yaw: its own +z face looks along frontOf(yaw) --
// the same box physics/character.js boxDistance and the GPU shader draw.

import { worldToLocal } from "../core/frame.js";
import { sdBox, sdCapsule } from "../core/sdf.js";
import { part, unionBounds } from "../scene/kit.js";

const num3 = (v, what) => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) throw new TypeError(`${what} must be [x, y, z].`);
  return [v[0], v[1], v[2]];
};

/** The AABB of a box turned by yaw about y: its four corners, boxed again. */
export function boxBounds({ c, h, yaw = 0 }) {
  const co = Math.abs(Math.cos(yaw));
  const si = Math.abs(Math.sin(yaw));
  const ex = h[0] * co + h[2] * si;
  const ez = h[0] * si + h[2] * co;
  return [c[0] - ex, c[1] - h[1], c[2] - ez, c[0] + ex, c[1] + h[1], c[2] + ez];
}

/** A capsule's AABB. */
export const capsuleBounds = ({ a, b, r }) => unionBounds([
  [a[0] - r, a[1] - r, a[2] - r, a[0] + r, a[1] + r, a[2] + r],
  [b[0] - r, b[1] - r, b[2] - r, b[0] + r, b[1] + r, b[2] + r],
]);

/** Signed distance to a turned box (no allocation: the hot path). */
export function boxSdf({ c, h, yaw = 0, round = 0 }) {
  const co = Math.cos(yaw);
  const si = Math.sin(yaw);
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = h;
  return (x, y, z) => {
    const dx = x - cx;
    const dz = z - cz;
    // (world -> the box's frame, core/frame.js worldToLocal: x' = c x - s z, z' = s x + c z)
    return sdBox(dx * co - dz * si, y - cy, dx * si + dz * co, hx, hy, hz, round);
  };
}

export const capsuleSdf = ({ a, b, r }) => (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r);

/** A box as a part: { name, mat, ... } plus prim { type:"box", c, h, yaw }. */
export function boxPart(spec, extra = {}) {
  const c = num3(spec.c, "box.c");
  const h = num3(spec.h, "box.h");
  if (!h.every((v) => v > 0)) throw new RangeError("box.h must be positive half-extents.");
  const yaw = spec.yaw ?? 0;
  const prim = { type: "box", c, h, yaw };
  return part({ ...extra, sdf: boxSdf({ c, h, yaw, round: spec.round ?? 0 }), bounds: boxBounds(prim), prim });
}

/** A capsule as a part: prim { type:"capsule", a, b, r }. */
export function capsulePart(spec, extra = {}) {
  const a = num3(spec.a, "capsule.a");
  const b = num3(spec.b, "capsule.b");
  if (!(spec.r > 0)) throw new RangeError("capsule.r must be positive.");
  const prim = { type: "capsule", a, b, r: spec.r };
  return part({ ...extra, sdf: capsuleSdf(prim), bounds: capsuleBounds(prim), prim });
}

/**
 * Anything part-like -> a part:
 *   { box: {c,h,yaw}, name, mat, ... }       a box part
 *   { capsule: {a,b,r}, name, mat, ... }     a capsule part
 *   { shape: {f,b}, name, mat, ... }         a kit.js shape
 *   { c, h, yaw?, name? }                    a bare renderer box
 *   { a, b, r, name? }                       a bare renderer capsule
 *   { sdf, bounds, ... }                     already a part (kept as it is)
 */
export function toPart(spec) {
  if (!spec || typeof spec !== "object") throw new TypeError("A part must be an object.");
  if (typeof spec.sdf === "function") return spec;
  const { box, capsule, shape, ...rest } = spec;
  if (box) return boxPart(box, rest);
  if (capsule) return capsulePart(capsule, rest);
  if (shape) return part({ ...rest, sdf: shape.f, bounds: shape.b });
  if (spec.c && spec.h) {
    const { c, h, yaw, round, ...more } = spec;
    return boxPart({ c, h, yaw, round }, more);
  }
  if (spec.a && spec.b && spec.r) {
    const { a, b, r, ...more } = spec;
    return capsulePart({ a, b, r }, more);
  }
  throw new TypeError(`Part ${spec.name ?? "?"} is neither a box, a capsule, a shape nor an SDF part.`);
}

/** Is a point inside a turned box's footprint (x, z) -- and how far below/above its top? */
export function overTop(p, bx, margin = 0) {
  const l = worldToLocal(bx.c, bx.yaw ?? 0, p);
  return Math.abs(l[0]) <= bx.h[0] + margin && Math.abs(l[2]) <= bx.h[2] + margin;
}
