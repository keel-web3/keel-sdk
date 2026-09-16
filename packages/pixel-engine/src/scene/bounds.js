// Bounds: what an entity occupies, in world space.
//
//   AABB    [x0,y0,z0,x1,y1,z1] -- the parts' local boxes, rotated, scaled and
//           moved (conservative: a rotated box's corners, boxed again)
//   sphere  { center:[x,y,z], radius } -- around the world AABB
//   SDF     the parts' own distance functions, for exact distance and rays
//
// AABBs and spheres are for culling and broad phase; `distance`, `raycast`
// and `touching` ask the SDFs, for what really is there.

import { rotateBounds, unionBounds } from "./kit.js";
import { entitySdf, rotationOf, worldSdf } from "./entity.js";

const EMPTY = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];

/** The union of an entity's part bounds, in its own frame. */
export function localAabbOf(entity) {
  return entity.parts.length ? unionBounds(entity.parts.map((p) => p.bounds)) : EMPTY.slice();
}

/** A local box through a transform: rotated (corners reboxed), scaled, moved. */
export function transformAabb(box, transform) {
  if (!Number.isFinite(box[0])) return EMPTY.slice();
  const { pos, scale } = transform;
  const m = rotationOf(transform);
  const r = rotateBounds(box, m);
  return [r[0] * scale + pos[0], r[1] * scale + pos[1], r[2] * scale + pos[2], r[3] * scale + pos[0], r[4] * scale + pos[1], r[5] * scale + pos[2]];
}

/** One part's world AABB. */
export const partAabbOf = (entity, part) => transformAabb(part.bounds, entity.transform);

/**
 * The entity's world AABB. Each part's box is transformed on its own and the
 * results unioned -- tighter than transforming the union when rotated.
 */
export function aabbOf(entity) {
  if (!entity.parts.length) return EMPTY.slice();
  return unionBounds(entity.parts.map((p) => partAabbOf(entity, p)));
}

/** Bounding sphere around the world AABB: { center, radius }. */
export function sphereOf(entity) {
  const b = aabbOf(entity);
  if (!Number.isFinite(b[0])) return { center: [0, 0, 0], radius: 0 };
  const center = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  return { center, radius: Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 };
}

const boxOf = (a) => (Array.isArray(a) ? a : aabbOf(a));

/** Do two AABBs (or two entities' AABBs) overlap, or come within `margin`? Touching counts. */
export function overlaps(a, b, margin = 0) {
  const p = boxOf(a);
  const q = boxOf(b);
  return p[0] <= q[3] + margin && p[3] >= q[0] - margin
    && p[1] <= q[4] + margin && p[4] >= q[1] - margin
    && p[2] <= q[5] + margin && p[5] >= q[2] - margin;
}

/** Is a world point inside an AABB (or an entity's AABB)? */
export function containsPoint(a, p) {
  const b = boxOf(a);
  return p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5];
}

/** Two AABBs' union. */
export const mergeAabb = (a, b) => unionBounds([a, b]);

/** Signed distance from a world point to the entity's surface, via its parts' SDFs (negative inside). */
export function distance(entity, point, t = 0) {
  let d = Infinity;
  for (const p of entity.parts) {
    const v = worldSdf(entity, p)(point[0], point[1], point[2], t);
    if (v < d) d = v;
  }
  return d;
}

/** Which part is nearest a world point: { part, distance } (null for no parts). */
export function nearestPart(entity, point, t = 0) {
  let best = null;
  for (const p of entity.parts) {
    const v = worldSdf(entity, p)(point[0], point[1], point[2], t);
    if (!best || v < best.distance) best = { part: p, distance: v };
  }
  return best;
}

/** Surface normal at a world point (central differences on the entity SDF). */
export function normalAt(entity, point, t = 0, h = 0.0012) {
  const f = entitySdf(entity);
  const [x, y, z] = point;
  const nx = f(x + h, y, z, t) - f(x - h, y, z, t);
  const ny = f(x, y + h, z, t) - f(x, y - h, z, t);
  const nz = f(x, y, z + h, t) - f(x, y, z - h, t);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/**
 * Ray vs AABB (slab test; the NOCTURNES trace.js rayBox): origin o, direction
 * d (need not be unit), box b. Returns [tNear, tFar] clamped to t >= 0, or
 * null when the ray misses (or the box is behind).
 */
export function rayAabb(o, d, b) {
  let tn = -Infinity;
  let tf = Infinity;
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b[i] || o[i] > b[i + 3]) return null;
      continue;
    }
    let t0 = (b[i] - o[i]) / d[i];
    let t1 = (b[i + 3] - o[i]) / d[i];
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tn) tn = t0;
    if (t1 < tf) tf = t1;
    if (tn > tf) return null;
  }
  if (tf < 0) return null;
  return [Math.max(tn, 0), tf];
}

/**
 * Ray vs entity: the AABB first, then sphere-traced through the SDF. `d` must
 * be unit length. Returns { t, point } for the first hit within `far`, or null.
 */
export function raycast(entity, o, d, { far = Infinity, t = 0, eps = 0.0005, steps = 200 } = {}) {
  const span = rayAabb(o, d, aabbOf(entity));
  if (!span || span[0] > far) return null;
  const f = entitySdf(entity);
  let s = span[0];
  const end = Math.min(span[1], far);
  for (let i = 0; i < steps && s <= end; i += 1) {
    const p = [o[0] + d[0] * s, o[1] + d[1] * s, o[2] + d[2] * s];
    const v = f(p[0], p[1], p[2], t);
    if (v < eps) return { t: s, point: p };
    s += Math.max(v, eps);
  }
  return null;
}

/**
 * Do two entities' SURFACES come within `margin` of each other? AABB broad
 * phase, then a deterministic grid of `n`^3 samples over the boxes' overlap:
 * a sample inside (or within margin of) both SDFs is contact. Resolution is
 * the grid: it may call contact up to half a cell early, and can miss thin
 * features finer than a cell. Raise `n` for tighter answers.
 */
export function touching(a, b, { margin = 0, n = 8, t = 0 } = {}) {
  const pa = aabbOf(a);
  const pb = aabbOf(b);
  if (!overlaps(pa, pb, margin)) return false;
  const lo = [Math.max(pa[0], pb[0]) - margin, Math.max(pa[1], pb[1]) - margin, Math.max(pa[2], pb[2]) - margin];
  const hi = [Math.min(pa[3], pb[3]) + margin, Math.min(pa[4], pb[4]) + margin, Math.min(pa[5], pb[5]) + margin];
  const fa = entitySdf(a);
  const fb = entitySdf(b);
  const cell = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / n;
  for (let i = 0; i <= n; i += 1) for (let j = 0; j <= n; j += 1) for (let k = 0; k <= n; k += 1) {
    const x = lo[0] + ((hi[0] - lo[0]) * i) / n;
    const y = lo[1] + ((hi[1] - lo[1]) * j) / n;
    const z = lo[2] + ((hi[2] - lo[2]) * k) / n;
    // (Half a cell of slack: the surfaces may meet between samples.)
    if (fa(x, y, z, t) <= margin + cell * 0.5 && fb(x, y, z, t) <= margin + cell * 0.5) return true;
  }
  return false;
}
