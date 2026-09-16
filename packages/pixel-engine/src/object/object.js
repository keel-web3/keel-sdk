// Objects: things that don't move. A pillar, a wall, a bench, a sign, a lamp
// post -- defined once in their own frame (+z front, +x right, +y up;
// core/frame.js), placed anywhere by a position, a yaw and a scale, and
// handing back everything the rest of the engine needs:
//
//   bounds       local and world AABBs, and the footprint on the ground
//   colliders    boxes { c, h, yaw, mat } in the world, as physics/character.js
//                createCharacter({ boxes }) and the renderer's setWorld({ boxes }) take
//   rails        polylines in the world, for createCharacter({ rails })
//   sockets      named points in the object's frame: tops you can put things
//                on (with their extent), seats (with their facing), grab
//                points, the spot to view it from
//   front        declared, and checked (scene/front.js)
//   resting      settle() drops it onto the highest support under it; restsOn() checks
//
//   const bench = defineObject({ key: "bench", parts: [...], front: "+z", tags: ["prop"] });
//   const b = placeObject(bench, { pos: [2, 0, 5], yaw: Math.PI / 2 });
//   worldColliders(b); socketOf(b, "seat"); bakeForRenderer([b]);
//
// A definition is plain data plus its parts' SDFs; an instance is a scene
// entity (scene/entity.js createEntity) with the definition riding along.

import { localToWorld, wrapAngle, worldToLocal } from "../core/frame.js";
import { createEntity, dirToWorld, toWorld } from "../scene/entity.js";
import { aabbOf, localAabbOf } from "../scene/bounds.js";
import { lowest } from "../scene/kit.js";
import { detectFront, parseFront } from "../scene/front.js";
import { boxBounds, overTop, toPart } from "./prims.js";

const SOCKET_KINDS = new Set(["top", "seat", "grab", "view", "anchor", "hang", "spawn"]);
const REST_MODES = new Set(["base", "hang", "float"]);

// ---------------------------------------------------------------- colliders from parts

// A capsule's collider: a box along it when it is upright or level (a pole, a
// beam, a rail's bar), its box otherwise (turned solids beyond yaw are not
// something physics has).
function capsuleCollider({ a, b, r }, mat) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(...d);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const flat = Math.hypot(d[0], d[2]);
  if (L < 1e-9 || flat / (L || 1) < 0.02) return { c, h: [r, Math.abs(d[1]) / 2 + r, r], yaw: 0, mat };
  if (Math.abs(d[1]) / L < 0.02) return { c, h: [r, r, flat / 2 + r], yaw: Math.atan2(d[0], d[2]), mat };
  const bb = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r];
  return { c: [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2], h: [(bb[3] - bb[0]) / 2, (bb[4] - bb[1]) / 2, (bb[5] - bb[2]) / 2], yaw: 0, mat, approx: true };
}

/**
 * The colliders a set of parts implies, in their own frame: a box part is its
 * box; a capsule part a box along it; an SDF part its bounds, when it asks
 * (`collide: "bounds"`). `collide: false` on any part leaves it out.
 */
export function collidersFromParts(parts) {
  const out = [];
  for (const p of parts) {
    if (p.collide === false) continue;
    const mat = p.mat ?? 0;
    if (p.prim?.type === "box") out.push({ c: [...p.prim.c], h: [...p.prim.h], yaw: p.prim.yaw ?? 0, mat, part: p.name });
    else if (p.prim?.type === "capsule") out.push({ ...capsuleCollider(p.prim, mat), part: p.name, capsule: true });
    else if (p.collide === "bounds") {
      const b = p.bounds;
      out.push({ c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0, mat, part: p.name });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sockets

function normSocket(name, s) {
  if (!s || !Array.isArray(s.pos) || s.pos.length !== 3) throw new TypeError(`Socket ${name} needs pos [x, y, z].`);
  const kind = s.kind ?? (SOCKET_KINDS.has(name) ? name : "anchor");
  const out = { name, kind, pos: [...s.pos], yaw: s.yaw === undefined ? null : parseFront(s.yaw) };
  if (s.extent) out.extent = [s.extent[0], s.extent[1]]; // (half-extents across x and z of the socket's own frame)
  if (s.normal) out.normal = [...s.normal];
  if (s.meta) out.meta = s.meta;
  return out;
}

/**
 * The tops of an object's box colliders that nothing sits on: surfaces you can
 * put things on, each { pos (the middle of the top), yaw, extent [hx, hz], area }.
 * Biggest first, then highest. (A pole's end, a capsule's box, or a sliver
 * thinner than `minHalf` across is not somewhere to put things.)
 */
export function topsOf(parts, colliders = collidersFromParts(parts), { minHalf = 0.03 } = {}) {
  const tops = [];
  for (const b of colliders) {
    if (b.approx || b.capsule || b.h[0] < minHalf || b.h[2] < minHalf) continue;
    const y = b.c[1] + b.h[1];
    const pos = [b.c[0], y, b.c[2]];
    // (Covered: another part is right on top of its middle.)
    const probe = [b.c[0], y + Math.max(0.01, b.h[1] * 0.05), b.c[2]];
    const covered = parts.some((p) => p.name !== b.part && p.sdf(probe[0], probe[1], probe[2], 0, null) < 0);
    if (covered) continue;
    tops.push({ pos, yaw: b.yaw ?? 0, extent: [b.h[0], b.h[2]], area: 4 * b.h[0] * b.h[2], part: b.part });
  }
  return tops.sort((a, b) => b.area - a.area || b.pos[1] - a.pos[1]);
}

// ---------------------------------------------------------------- definitions

/**
 * defineObject({ key, parts, front, show, tags, colliders, sockets, rest, rails, meta }) -> definition
 *   key        string (required)
 *   parts      [{ box:{c,h,yaw} | capsule:{a,b,r} | shape:{f,b} | sdf+bounds, name, mat, role, collide }]
 *              in the object's own frame: origin at its pivot (the middle of its
 *              base, for things that stand), +z its front
 *   front      the declared front: a yaw, a direction, "+z"/"-x"..., or null (none)
 *   show       the side to turn to a viewer, when it isn't the front (default: the front)
 *   tags       string[]
 *   colliders  boxes { c, h, yaw, mat } in the own frame (default: from the parts)
 *   sockets    { name: { kind, pos, yaw, extent, normal } } in the own frame; a
 *              "top" (the biggest free box top) and a "view" (in front, looking
 *              back at it) are added when not given
 *   rest       "base" (stands on its lowest point; default), "hang" (needs no
 *              support: a sign on a wall), "float"
 *   rails      [[ [x,y,z], ... ]] polylines in the own frame (grind lines)
 *   meta       anything else, kept
 */
export function defineObject({ key, parts, front = null, show = null, tags = [], colliders = null, sockets = {}, rest = "base", rails = [], meta = {} } = {}) {
  if (typeof key !== "string" || !key) throw new TypeError("An object needs a string key.");
  if (!Array.isArray(parts) || !parts.length) throw new TypeError(`Object ${key} needs parts.`);
  if (!REST_MODES.has(rest)) throw new RangeError(`Object ${key}: rest is "base", "hang" or "float".`);
  const ps = parts.map(toPart);
  const cols = (colliders ?? collidersFromParts(ps)).map((b) => ({ c: [...b.c], h: [...b.h], yaw: b.yaw ?? 0, mat: b.mat ?? 0, ...(b.part ? { part: b.part } : {}), ...(b.approx ? { approx: true } : {}), ...(b.capsule ? { capsule: true } : {}) }));
  const local = localAabbOf({ parts: ps });
  const frontYaw = parseFront(front);
  // (The side to show a viewer, when it isn't the front: a piggy bank three-quarters, a stapler side-on.)
  const showYaw = show === null ? frontYaw : parseFront(show);
  const sock = {};
  for (const [name, s] of Object.entries(sockets)) sock[name] = normSocket(name, s);
  // The biggest free top, and where to look at it from, unless given.
  if (!sock.top) {
    const t = topsOf(ps, cols)[0];
    if (t) sock.top = { name: "top", kind: "top", pos: t.pos, yaw: t.yaw, extent: t.extent, auto: true };
  }
  if (!sock.view && showYaw !== null) {
    const size = Math.max(local[3] - local[0], local[4] - local[1], local[5] - local[2]);
    const reach = Math.max(Math.abs(local[0]), Math.abs(local[3]), Math.abs(local[2]), Math.abs(local[5]));
    const dist = reach + Math.max(1, size * 1.2);
    const f = [Math.sin(showYaw), Math.cos(showYaw)];
    sock.view = { name: "view", kind: "view", pos: [f[0] * dist, (local[1] + local[4]) / 2, f[1] * dist], yaw: wrapAngle(showYaw + Math.PI), auto: true };
  }
  return {
    kind: "object",
    key,
    parts: ps,
    front: frontYaw,
    show: showYaw,
    tags: [...new Set(tags)].sort(),
    colliders: cols,
    sockets: sock,
    rest,
    rails: rails.map((r) => r.map((p) => [...p])),
    bounds: local,
    meta: { ...meta },
  };
}

/** The object's lowest point in its own frame (exact for box and capsule parts, marched for SDFs). Cached. */
const BOTTOMS = new WeakMap();
export function bottomOf(def) {
  if (BOTTOMS.has(def)) return BOTTOMS.get(def);
  const allPrims = def.parts.every((p) => p.prim);
  const y = allPrims ? def.bounds[1] : lowest(def.parts);
  BOTTOMS.set(def, y);
  return y;
}

// ---------------------------------------------------------------- instances

let nextInstance = 1;

/**
 * placeObject(def, { pos, yaw, scale, id, tags }) -> instance: a scene entity
 * (createEntity) with `def` and `key`. Objects stand upright: position, yaw
 * and a uniform scale only.
 */
export function placeObject(def, { pos = [0, 0, 0], yaw = 0, scale = 1, id = null, tags = [] } = {}) {
  if (!def || def.kind !== "object") throw new TypeError("placeObject needs a definition from defineObject.");
  const e = createEntity({
    id: id ?? `${def.key}#${nextInstance++}`,
    transform: { pos, yaw: wrapAngle(yaw), scale },
    parts: def.parts,
    tags: [...def.tags, ...tags],
    components: { object: { key: def.key } },
  });
  return { ...e, def, key: def.key };
}

/** A copy moved/turned (fields merged over the old placement). */
export const movedObject = (inst, patch) => placeObject(inst.def, { pos: inst.transform.pos, yaw: inst.transform.yaw, scale: inst.transform.scale, id: inst.id, ...patch });

/** World AABB. */
export const worldAabb = (inst) => aabbOf(inst);
/** Local AABB (the definition's). */
export const localAabb = (inst) => (inst.def ?? inst).bounds;

/**
 * The footprint on the ground: its four corners (the local box turned and
 * moved, x-z), and the world rectangle round them [x0, z0, x1, z1].
 */
export function footprint(inst) {
  const b = inst.def.bounds;
  const { pos, yaw, scale } = inst.transform;
  const corners = [[b[0], b[2]], [b[3], b[2]], [b[3], b[5]], [b[0], b[5]]].map(([x, z]) => {
    const w = localToWorld(pos, yaw, [x * scale, 0, z * scale]);
    return [w[0], w[2]];
  });
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return { corners, rect: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
}

/** A local collider box into the world (the instance's yaw adds to the box's). */
export function colliderToWorld(inst, b) {
  const { pos, yaw, scale } = inst.transform;
  return {
    c: localToWorld(pos, yaw, [b.c[0] * scale, b.c[1] * scale, b.c[2] * scale]),
    h: [b.h[0] * scale, b.h[1] * scale, b.h[2] * scale],
    yaw: wrapAngle(yaw + (b.yaw ?? 0)),
    mat: b.mat ?? 0,
  };
}

/** Collider boxes in the world, ready for createCharacter({ boxes }) and setWorld({ boxes }). */
export const worldColliders = (inst) => inst.def.colliders.map((b) => colliderToWorld(inst, b));

/** Rails (polylines) in the world, for createCharacter({ rails }). */
export const worldRails = (inst) => inst.def.rails.map((r) => r.map((p) => toWorld(inst, p)));

/** One socket in the world: { name, kind, pos, yaw, dir, extent, ... } or null. */
export function socketOf(inst, name) {
  const s = inst.def.sockets[name];
  if (!s) return null;
  const { yaw, scale } = inst.transform;
  const out = { ...s, pos: toWorld(inst, s.pos) };
  if (s.yaw !== null && s.yaw !== undefined) {
    out.yaw = wrapAngle(s.yaw + yaw);
    out.dir = [Math.sin(out.yaw), 0, Math.cos(out.yaw)];
  }
  if (s.extent) out.extent = [s.extent[0] * scale, s.extent[1] * scale];
  if (s.normal) out.normal = dirToWorld(inst, s.normal);
  return out;
}

/** Every socket in the world, by name. */
export function worldSockets(inst) {
  const out = {};
  for (const name of Object.keys(inst.def.sockets)) out[name] = socketOf(inst, name);
  return out;
}

/** Sockets of a kind (in the world). */
export const socketsOfKind = (inst, kind) => Object.values(worldSockets(inst)).filter((s) => s.kind === kind);

/**
 * Is a world point on a top socket (inside its extent, within `tol` of its
 * height)? For "can I put this here".
 */
export function onSocket(inst, name, p, tol = 0.02) {
  const s = socketOf(inst, name);
  if (!s || !s.extent) return false;
  const l = worldToLocal(s.pos, s.yaw ?? 0, p);
  return Math.abs(l[0]) <= s.extent[0] && Math.abs(l[2]) <= s.extent[1] && Math.abs(l[1]) <= tol;
}

// ---------------------------------------------------------------- fronts

/** The object's front: declared (checked) or detected. See scene/front.js detectFront. */
export const frontOfObject = (thing, opts = {}) => detectFront(thing, opts);

/**
 * The yaw that turns an instance's show side (its front, unless it declares
 * another) toward a point: placeObject(def, { yaw: yawToShow(def, pos, eye) }).
 */
export function yawToShow(def, pos, target) {
  const side = def.show ?? def.front ?? 0;
  return wrapAngle(Math.atan2(target[0] - pos[0], target[2] - pos[2]) - side);
}

// ---------------------------------------------------------------- resting

// Supports: instances (their colliders), boxes { c, h, yaw }, a number (a floor
// at that height), or { y } (the same).
function supportBoxes(supports) {
  const out = [];
  for (const s of supports) {
    if (typeof s === "number") out.push({ plane: s, from: "floor" });
    else if (s && typeof s.y === "number" && !s.c) out.push({ plane: s.y, from: s.name ?? "floor" });
    else if (s && s.def && s.transform) for (const b of worldColliders(s)) out.push({ box: b, from: s.id });
    else if (s && s.c && s.h) out.push({ box: { c: s.c, h: s.h, yaw: s.yaw ?? 0 }, from: s.name ?? "box" });
    else throw new TypeError("A support is an object instance, a box { c, h, yaw }, a number or { y }.");
  }
  return out;
}

// Points on the underside: the bottoms of the parts that reach the lowest point, in the world.
function contactPoints(inst, n = 5) {
  const def = inst.def;
  const low = bottomOf(def);
  const size = Math.max(def.bounds[4] - def.bounds[1], 1e-6);
  const feet = def.parts.filter((p) => p.bounds[1] <= low + size * 0.05 + 1e-6);
  const pts = [];
  for (const p of feet) {
    const b = p.bounds;
    for (let i = 0; i < n; i += 1) for (let k = 0; k < n; k += 1) {
      const x = b[0] + ((b[3] - b[0]) * (i + 0.5)) / n;
      const z = b[2] + ((b[5] - b[2]) * (k + 0.5)) / n;
      // (Only where the part really reaches down: a column under a round foot, not its box's corners.)
      if (p.sdf(x, low + size * 0.06, z, 0, null) > size * 0.03) continue;
      pts.push(toWorld(inst, [x, low, z]));
    }
  }
  if (!pts.length) pts.push(toWorld(inst, [0, low, 0]));
  return pts;
}

/**
 * settle(inst, supports, { stepUp, maxDrop, minCover }) -> {
 *   instance   the object moved so its lowest point is on the highest support under it
 *   gap        how far it was above that support before (negative: sunk into it)
 *   support    what it rests on (id / "floor" / name), or null
 *   cover      the share of its underside over that support (0..1)
 *   rests      true when it now rests (or needs no support: rest "hang"/"float")
 * }
 * A support counts when its top is under the object's underside (within
 * `stepUp` above it, so a thing sunk a little comes up) and covers at least
 * `minCover` of it. Nothing floats: with no support, it is left where it is and
 * `rests` is false.
 */
export function settle(inst, supports, { stepUp = 0.05, maxDrop = Infinity, minCover = 0.25 } = {}) {
  const S = supportBoxes(supports.filter((s) => s !== inst && !(s && s.id !== undefined && s.id === inst.id)));
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  let best = null;
  const offer = (top, from, covered) => {
    const cover = covered / pts.length;
    if (cover < minCover) return;
    if (top > bottom + stepUp || bottom - top > maxDrop) return;
    if (!best || top > best.top) best = { top, from, cover };
  };
  for (const s of S) {
    if (s.plane !== undefined) { offer(s.plane, s.from, pts.length); continue; }
    const top = s.box.c[1] + s.box.h[1];
    offer(top, s.from, pts.filter((p) => overTop(p, s.box)).length);
  }
  if (!best) return { instance: inst, gap: null, support: null, cover: 0, rests: inst.def.rest !== "base" };
  const gap = bottom - best.top;
  const pos = [inst.transform.pos[0], inst.transform.pos[1] - gap, inst.transform.pos[2]];
  return { instance: movedObject(inst, { pos }), gap, support: best.from, cover: best.cover, rests: true };
}

/** Does it rest on this support: its underside within `tol` of the support's top, over it? */
export function restsOn(inst, support, { tol = 1e-3, minCover = 0.25 } = {}) {
  const bottom = inst.transform.pos[1] + bottomOf(inst.def) * inst.transform.scale;
  const pts = contactPoints(inst);
  for (const s of supportBoxes([support])) {
    if (s.plane !== undefined) { if (Math.abs(bottom - s.plane) <= tol) return true; continue; }
    const top = s.box.c[1] + s.box.h[1];
    if (Math.abs(bottom - top) <= tol && pts.filter((p) => overTop(p, s.box)).length / pts.length >= minCover) return true;
  }
  return false;
}

// ---------------------------------------------------------------- baking

const matIndex = (m, mats) => (typeof m === "number" ? m : mats && m in mats ? mats[m] : 0);

/**
 * bakeForRenderer(instances, { mats, bounds }) -> { boxes, capsules, skipped }
 * for the GPU renderer's setWorld({ boxes, capsules }): box parts as boxes,
 * capsule parts as capsules, in the world. `mats` maps material names to the
 * renderer's material indices (numbers pass through). SDF parts the renderer
 * can't draw are listed in `skipped` -- or drawn as their bounds with
 * `bounds: true`.
 */
export function bakeForRenderer(instances, { mats = null, bounds = false } = {}) {
  const boxes = [];
  const capsules = [];
  const skipped = [];
  for (const inst of instances) {
    const { scale } = inst.transform;
    for (const p of inst.def.parts) {
      if (p.render === false) continue;
      const mat = matIndex(p.mat, mats);
      if (p.prim?.type === "box") boxes.push({ ...colliderToWorld(inst, p.prim), mat });
      else if (p.prim?.type === "capsule") capsules.push({ a: toWorld(inst, p.prim.a), b: toWorld(inst, p.prim.b), r: p.prim.r * scale, mat });
      else if (bounds) {
        const b = p.bounds;
        boxes.push({ ...colliderToWorld(inst, { c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], h: [(b[3] - b[0]) / 2, (b[4] - b[1]) / 2, (b[5] - b[2]) / 2], yaw: 0 }), mat });
      } else skipped.push({ id: inst.id, part: p.name });
    }
  }
  return { boxes, capsules, skipped };
}

/** bakeForPhysics(instances) -> { boxes, rails } for createCharacter({ boxes, rails }). */
export function bakeForPhysics(instances, { mats = null } = {}) {
  const boxes = [];
  const rails = [];
  for (const inst of instances) {
    for (const b of worldColliders(inst)) boxes.push({ ...b, mat: matIndex(b.mat, mats) });
    rails.push(...worldRails(inst));
  }
  return { boxes, rails };
}

export { boxBounds };
