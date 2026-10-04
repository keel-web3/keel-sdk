// KEEL Pixel scene kit -- shapes that carry their own bounds, booleans that
// keep them, rotations and placement. Copied from NOCTURNES src/kit.js
// (box, cyl, sphere, ellipsoid, capsule, torus, U, cut, inter, turned,
// rotateBounds, lowest, rotateOnto, rotatedSdf) and src/parts.js (rotation,
// placed, ball, unionBounds, mat3mul, angleOf); tests/scene-kit.test.mjs
// proves them identical. `part`, `mk` and `lathePart` are the engine's own:
// NOCTURNES' part() is bound to its material table, the engine's takes any
// material name (and an optional table of material knobs).
//
// A SHAPE is { f(x,y,z,t,V) -> signed distance, b: [x0,y0,z0,x1,y1,z1] }.
// A PART is { id, name, mat, m, sdf, bounds, ... } -- a shape with a material.

import { TAU } from "../core/math.js";
import { profile, sdBox, sdCapsule, sdCylinder, sdEllipsoid, sdLathe, sdSphere, sdTorus } from "../core/sdf.js";

// ---- from NOCTURNES parts.js ----

// ---- rotations ----

/** Rotation matrix from yaw (about y), pitch (about x), roll (about z). */
export function rotation(yaw = 0, pitch = 0, roll = 0) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // R = Ry * Rx * Rz
  return [
    cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp,
    cp * sr, cp * cr, -sp,
    -sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp,
  ];
}

/** Wrap a local sdf so it can be placed at `pos` with rotation matrix `m`. */
export function placed(sdf, pos, m) {
  const [px, py, pz] = pos;
  if (!m) return (x, y, z, t, V) => sdf(x - px, y - py, z - pz, t, V);
  return (x, y, z, t, V) => {
    const dx = x - px;
    const dy = y - py;
    const dz = z - pz;
    // inverse rotation = transpose
    return sdf(
      m[0] * dx + m[3] * dy + m[6] * dz,
      m[1] * dx + m[4] * dy + m[7] * dz,
      m[2] * dx + m[5] * dy + m[8] * dz,
      t,
      V,
    );
  };
}

/** Conservative AABB of a sphere of radius r around a point. */
export const ball = (x, y, z, r) => [x - r, y - r, z - r, x + r, y + r, z + r];

export function unionBounds(list) {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const b of list) {
    for (let i = 0; i < 3; i += 1) {
      if (b[i] < out[i]) out[i] = b[i];
      if (b[i + 3] > out[i + 3]) out[i + 3] = b[i + 3];
    }
  }
  return out;
}

/** 3x3 row-major product a*b. */
export function mat3mul(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return out;
}

export const angleOf = (x, z) => Math.atan2(z, x) / TAU;

// ---- from NOCTURNES kit.js ----

const bx = (c, h) => [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]];

export const box = (c, h, r = 0.01) => ({ f: (x, y, z) => sdBox(x - c[0], y - c[1], z - c[2], h[0], h[1], h[2], r), b: bx(c, h) });

/** Cylinder of radius r, half-length h, along 'x' | 'y' | 'z'. */
export function cyl(c, r, h, axis = "y", round = 0) {
  if (axis === "y") return { f: (x, y, z) => sdCylinder(x - c[0], y - c[1], z - c[2], r, h, round), b: bx(c, [r, h, r]) };
  if (axis === "z") return { f: (x, y, z) => sdCylinder(x - c[0], z - c[2], y - c[1], r, h, round), b: bx(c, [r, r, h]) };
  return { f: (x, y, z) => sdCylinder(y - c[1], x - c[0], z - c[2], r, h, round), b: bx(c, [h, r, r]) };
}

export const sphere = (c, r) => ({ f: (x, y, z) => sdSphere(x - c[0], y - c[1], z - c[2], r), b: bx(c, [r, r, r]) });
export const ellipsoid = (c, rs) => ({ f: (x, y, z) => sdEllipsoid(x - c[0], y - c[1], z - c[2], rs[0], rs[1], rs[2]), b: bx(c, rs) });
export const capsule = (a, b, r) => ({
  f: (x, y, z) => sdCapsule(x, y, z, a[0], a[1], a[2], b[0], b[1], b[2], r),
  b: unionBounds([bx(a, [r, r, r]), bx(b, [r, r, r])]),
});

/** Torus whose ring lies in the plane normal to `axis`. */
export function torus(c, R, r, axis = "y") {
  const e = R + r;
  if (axis === "y") return { f: (x, y, z) => sdTorus(x - c[0], y - c[1], z - c[2], R, r), b: bx(c, [e, r, e]) };
  if (axis === "z") return { f: (x, y, z) => sdTorus(x - c[0], z - c[2], y - c[1], R, r), b: bx(c, [e, e, r]) };
  return { f: (x, y, z) => sdTorus(y - c[1], x - c[0], z - c[2], R, r), b: bx(c, [r, e, e]) };
}

export const U = (...shapes) => ({
  f: (x, y, z, t, V) => {
    let d = Infinity;
    for (const s of shapes) {
      const v = s.f(x, y, z, t, V);
      if (v < d) d = v;
    }
    return d;
  },
  b: unionBounds(shapes.map((s) => s.b)),
});

export const cut = (a, ...holes) => ({
  f: (x, y, z, t, V) => {
    let d = a.f(x, y, z, t, V);
    for (const h of holes) d = Math.max(d, -h.f(x, y, z, t, V));
    return d;
  },
  b: a.b,
});

export const inter = (a, b) => ({ f: (x, y, z, t, V) => Math.max(a.f(x, y, z, t, V), b.f(x, y, z, t, V)), b: a.b });

/** Rotate a shape about a pivot. */
export function turned(shape, m, pivot = [0, 0, 0]) {
  const f = placed((x, y, z, t, V) => shape.f(x + pivot[0], y + pivot[1], z + pivot[2], t, V), pivot, m);
  return { f, b: rotateBounds(shape.b, m, pivot) };
}

export function rotateBounds(b, m, pivot = [0, 0, 0]) {
  const pts = [];
  for (const x of [b[0], b[3]]) for (const y of [b[1], b[4]]) for (const z of [b[2], b[5]]) {
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    const dz = z - pivot[2];
    const px = m[0] * dx + m[1] * dy + m[2] * dz + pivot[0];
    const py = m[3] * dx + m[4] * dy + m[5] * dz + pivot[1];
    const pz = m[6] * dx + m[7] * dy + m[8] * dz + pivot[2];
    pts.push([px, py, pz, px, py, pz]);
  }
  return unionBounds(pts);
}

/** Lowest point of a set of parts: marched up from below on a grid, then found exactly near the best column. */
export function lowest(parts) {
  const b = unionBounds(parts.map((p) => p.bounds));
  const hitY = (x, z) => {
    let y = b[1] - 0.05;
    for (let s = 0; s < 160 && y < b[4]; s += 1) {
      let d = Infinity;
      for (const p of parts) d = Math.min(d, p.sdf(x, y, z, 0));
      if (d < 0.0005) return y;
      y += Math.max(d * 0.9, 0.0005);
    }
    return Infinity;
  };
  let low = Infinity;
  let bx0 = 0;
  let bz0 = 0;
  const n = 18;
  for (let i = 0; i <= n; i += 1) {
    for (let k = 0; k <= n; k += 1) {
      const x = b[0] + ((b[3] - b[0]) * i) / n;
      const z = b[2] + ((b[5] - b[2]) * k) / n;
      const y = hitY(x, z);
      if (y < low) { low = y; bx0 = x; bz0 = z; }
    }
  }
  if (low === Infinity) return b[1];
  // A point or a curve underneath falls between the columns: walk downhill to it.
  let h = Math.max(b[3] - b[0], b[5] - b[2]) / n / 2;
  for (let it = 0; it < 40 && h > 1e-4; it += 1) {
    let moved = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const y = hitY(bx0 + dx * h, bz0 + dz * h);
      if (y < low - 1e-6) { low = y; bx0 += dx * h; bz0 += dz * h; moved = true; break; }
    }
    if (!moved) h /= 2;
  }
  return low;
}

const mul3 = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
/** The rotation taking unit vector a onto unit vector b. */
export function rotateOnto(a, b) {
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c < -0.9999) {
    // Opposite: half a turn about any axis square to a.
    const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const k = [a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]];
    const l = Math.hypot(...k);
    const u = k.map((v) => v / l);
    return [0, 1, 2].flatMap((r) => [0, 1, 2].map((q) => 2 * u[r] * u[q] - (r === q ? 1 : 0)));
  }
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const K = [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
  const K2 = mul3(K, K);
  return [0, 1, 2].flatMap((r) => [0, 1, 2].map((q) => (r === q ? 1 : 0) + K[r * 3 + q] + K2[r * 3 + q] / (1 + c)));
}
/** A shape (model frame) seen through rotation R (model -> world). */
export function rotatedSdf(f, R) {
  return (x, y, z, t, V) => f(R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z, t, V);
}

// ---- engine: parts without a fixed material table ----

let nextPartId = 1;

/**
 * part({ name, mat, sdf, bounds, ...anything }) -> a part. `mat` is any
 * material name; `materials` (optional) is a table of material knobs, looked
 * up into `m` ({} when absent). Every other field rides along unchanged, so a
 * NOCTURNES-style part ({ accent, pattern, dynamic, light, ... }) keeps them.
 */
export function part(spec, materials = null) {
  if (typeof spec.sdf !== "function") throw new TypeError("A part needs an sdf(x, y, z, t).");
  if (!Array.isArray(spec.bounds) || spec.bounds.length !== 6) throw new TypeError("A part needs bounds [x0,y0,z0,x1,y1,z1].");
  const m = (materials && spec.mat && materials[spec.mat]) ?? spec.m ?? {};
  return { ...spec, id: spec.id ?? nextPartId++, name: spec.name ?? spec.mat ?? "part", mat: spec.mat ?? null, m };
}

/** A part from a shape. */
export const mk = (shape, spec = {}, materials = null) => part({ ...spec, sdf: shape.f, bounds: shape.b }, materials);

/** A surface of revolution around local y from a profile [[r, y], ...]. */
export function lathePart(spec, materials = null) {
  const prof = profile(spec.points);
  const round = spec.round ?? 0.008;
  const oy = spec.y ?? 0;
  return part({
    ...spec,
    axisym: true,
    sdf: (x, y, z) => sdLathe(x, y - oy, z, prof, round),
    bounds: [-prof.rmax, prof.ymin + oy, -prof.rmax, prof.rmax, prof.ymax + oy, prof.rmax],
  }, materials);
}
