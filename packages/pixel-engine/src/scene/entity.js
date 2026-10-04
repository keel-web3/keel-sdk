// Entities: a transform, parts in the entity's own frame, tags, components.
//
// An entity is plain data plus functions (its parts' SDFs). Its parts are
// NOCTURNES-style parts -- { name, sdf(x,y,z,t,V), bounds:[x0,y0,z0,x1,y1,z1],
// mat, ... } -- in LOCAL units: origin at the entity's pivot, y up. The
// transform places it in the world:
//
//   world = pos + R(yaw, pitch, roll) * (scale * local)
//
// R is kit.js rotation() (yaw about y, then pitch about x, roll about z), the
// same matrix NOCTURNES poses its objects with. Scale is uniform, so a world
// distance is the local distance times scale -- SDFs stay SDFs.

import { rotation } from "./kit.js";

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Normalise a transform: { pos:[x,y,z], yaw, pitch, roll, scale }, all defaulted. */
export function makeTransform(t = {}) {
  const pos = t.pos ?? [0, 0, 0];
  if (!Array.isArray(pos) || pos.length !== 3) throw new TypeError("transform.pos must be [x, y, z].");
  const scale = t.scale ?? 1;
  if (!(scale > 0)) throw new RangeError("transform.scale must be a positive number.");
  return { pos: [pos[0], pos[1], pos[2]], yaw: t.yaw ?? 0, pitch: t.pitch ?? 0, roll: t.roll ?? 0, scale };
}

/** The transform's rotation matrix (row-major 3x3, local -> world). */
export function rotationOf(transform) {
  const { yaw = 0, pitch = 0, roll = 0 } = transform;
  return yaw === 0 && pitch === 0 && roll === 0 ? IDENTITY : rotation(yaw, pitch, roll);
}

/**
 * createEntity({ id, transform, parts, tags, components }) -> entity
 *   id          string or number (required)
 *   transform   { pos, yaw, pitch, roll, scale } (defaults: origin, 0, 1)
 *   parts       [{ name, sdf, bounds, mat, ... }] in local units
 *   tags        string[] (kept sorted and unique)
 *   components  { name: plain data } (physics, particles, config layer...)
 */
export function createEntity({ id, transform = {}, parts = [], tags = [], components = {} } = {}) {
  if (id === undefined || id === null) throw new TypeError("An entity needs an id.");
  for (const p of parts) {
    if (typeof p.sdf !== "function") throw new TypeError(`Part ${p.name ?? "?"} of ${id} has no sdf.`);
    if (!Array.isArray(p.bounds) || p.bounds.length !== 6) throw new TypeError(`Part ${p.name ?? "?"} of ${id} has no bounds.`);
  }
  return {
    id,
    transform: makeTransform(transform),
    parts: [...parts],
    tags: [...new Set(tags)].sort(),
    components: { ...components },
  };
}

/** A copy with a new transform (fields merged over the old one). */
export function withTransform(entity, patch) {
  return { ...entity, transform: makeTransform({ ...entity.transform, ...patch }) };
}

export const hasTag = (entity, tag) => entity.tags.includes(tag);

/** A copy with a component set (or removed when `data` is undefined). */
export function withComponent(entity, name, data) {
  const components = { ...entity.components };
  if (data === undefined) delete components[name];
  else components[name] = data;
  return { ...entity, components };
}

/** Entities carrying every tag given. */
export const byTag = (entities, ...tags) => entities.filter((e) => tags.every((t) => e.tags.includes(t)));

/** Local -> world for one point. */
export function toWorld(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const x = p[0] * scale;
  const y = p[1] * scale;
  const z = p[2] * scale;
  return [
    m[0] * x + m[1] * y + m[2] * z + pos[0],
    m[3] * x + m[4] * y + m[5] * z + pos[1],
    m[6] * x + m[7] * y + m[8] * z + pos[2],
  ];
}

/** World -> local for one point (inverse rotation = transpose). */
export function toLocal(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const dx = p[0] - pos[0];
  const dy = p[1] - pos[1];
  const dz = p[2] - pos[2];
  return [
    (m[0] * dx + m[3] * dy + m[6] * dz) / scale,
    (m[1] * dx + m[4] * dy + m[7] * dz) / scale,
    (m[2] * dx + m[5] * dy + m[8] * dz) / scale,
  ];
}

/** Local -> world for a direction (rotation only, unit length kept). */
export function dirToWorld(entity, d) {
  const m = rotationOf(entity.transform);
  return [m[0] * d[0] + m[1] * d[1] + m[2] * d[2], m[3] * d[0] + m[4] * d[1] + m[5] * d[2], m[6] * d[0] + m[7] * d[1] + m[8] * d[2]];
}

/** World -> local for a direction. */
export function dirToLocal(entity, d) {
  const m = rotationOf(entity.transform);
  return [m[0] * d[0] + m[3] * d[1] + m[6] * d[2], m[1] * d[0] + m[4] * d[1] + m[7] * d[2], m[2] * d[0] + m[5] * d[1] + m[8] * d[2]];
}

/**
 * One part's SDF in world space: (x, y, z, t, V) -> world distance. Cheap
 * enough for the hot path (no allocation per call).
 */
export function worldSdf(entity, p) {
  const { pos, scale } = entity.transform;
  const m = rotationOf(entity.transform);
  const f = p.sdf;
  const inv = 1 / scale;
  return (x, y, z, t = 0, V) => {
    const dx = x - pos[0];
    const dy = y - pos[1];
    const dz = z - pos[2];
    return scale * f(
      (m[0] * dx + m[3] * dy + m[6] * dz) * inv,
      (m[1] * dx + m[4] * dy + m[7] * dz) * inv,
      (m[2] * dx + m[5] * dy + m[8] * dz) * inv,
      t,
      V,
    );
  };
}

/** The whole entity as one world-space SDF (union of its parts). */
export function entitySdf(entity) {
  const fs = entity.parts.map((p) => worldSdf(entity, p));
  return (x, y, z, t = 0, V) => {
    let d = Infinity;
    for (const f of fs) {
      const v = f(x, y, z, t, V);
      if (v < d) d = v;
    }
    return d;
  };
}
