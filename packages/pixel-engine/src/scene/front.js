// Front detection: which way a thing faces, worked out from what it is made
// of -- and a declared front checked against that.
//
//   detectFront(thing, opts) -> {
//     yaw, dir          the front, in the world when the thing has a transform
//                       (an entity, an object instance), else in its own frame
//     confidence        0..1
//     declared          was a front declared (a `front` field, or NOCTURNES' facing flag)?
//     agrees            does the evidence agree with it? (true / false / null: can't tell)
//     symmetric         nothing tells a front (a ball, a vase, a plain table)
//     symmetry          "round" | "mirror" | null
//     axisYaw           the front lies along +-this (a bench: square to its length)
//     detected          { yaw, dir, confidence } from the evidence alone
//     local             { yaw, dir } in the thing's own frame
//     layers            { features, useCase, geometry }: each { yaw, strength, ... }
//     why               [plain-English lines]
//   }
//
// The evidence, in layers (all in the thing's own frame, +z front, frame.js):
//   a. DECLARED   a `front` (yaw, direction or "+z"-style) wins -- but is checked.
//   b. FEATURES   parts named like a face, a screen, a cone, a door (FEATURES,
//                 extendable): where they are seen from, round a ring of views,
//                 where they sit off the body, and any normal a part carries
//                 (NOCTURNES screens carry their axes).
//   c. GEOMETRY   with nothing named: round a ring of views, which side is
//                 recessed (a chair's seat, a shelf), busier with edges and small
//                 parts, a broad flat face; which side the mass leans away from.
//                 Symmetric things come back symmetric, with low confidence.
//   d. USE        a seat faces out from its backrest; a screen away from its
//                 stand; shelves away from their back; a lamp where its head reaches.
//
// Everything is measured in the thing's own frame and turned by its transform,
// so the answer turns exactly with the thing. Raw world-space boxes and
// capsules (no transform) are measured where they are: the ring of views is
// laid along the thing's own principal axis, so that turns with it too.

import { wrapAngle } from "../core/frame.js";
import { dirToWorld } from "./entity.js";
import { unionBounds } from "./kit.js";
import { rayAabb } from "./bounds.js";
import { toPart } from "../object/prims.js";

// ---------------------------------------------------------------- vocabulary

/**
 * What a part's name says about the front. side "front": the part is on the
 * front (a screen, an eye); "back": it is behind (a backrest, a tail).
 * Weight: how sure the word is. Extend with defineFeature().
 */
export const FEATURES = new Map();
const F = (weight) => ({ side: "front", weight });
const B = (weight) => ({ side: "back", weight });
for (const [word, spec] of Object.entries({
  // (Faces: what looks out.)
  face: F(1.2), eye: F(1), nose: F(1), mouth: F(0.8), snout: F(1), beak: F(1), visor: F(1), grin: F(0.8), brow: F(0.6),
  // (What shows.)
  screen: F(1.5), display: F(1.5), lcd: F(1.2), lens: F(1.2), dial: F(0.8), gauge: F(0.8), bezel: F(0.8), clockface: F(1.2), readout: F(1),
  photo: F(1.2), picture: F(1.2), portrait: F(1.2), poster: F(1), soundhole: F(1), fretboard: F(0.6), chute: F(0.8),
  // (What sounds.)
  cone: F(1.1), speaker: F(1), grille: F(1), grill: F(1), woofer: F(1.1), tweeter: F(1.1),
  // (What's worked from the front.)
  knob: F(0.6), button: F(0.5), buttons: F(0.5), key: F(0.3), keypad: F(0.5), slot: F(0.5), tray: F(0.5), switch: F(0.3),
  // (What opens.)
  door: F(1.2), drawer: F(1.2), opening: F(1), hatch: F(1), headlight: F(1), front: F(1.5), fascia: F(1), label: F(0.4),
  // (Behind.)
  back: B(1.2), backrest: B(1.5), rear: B(1.2), tail: B(1), hinge: B(0.5), cable: B(0.3), cord: B(0.3), plug: B(0.3), vent: B(0.3),
})) FEATURES.set(word, spec);

/** Add (or replace) a feature word: defineFeature("porthole", { side: "front", weight: 1 }). */
export function defineFeature(word, { side = "front", weight = 1 } = {}) {
  if (side !== "front" && side !== "back") throw new RangeError('A feature side is "front" or "back".');
  if (!(weight > 0)) throw new RangeError("A feature weight must be positive.");
  FEATURES.set(String(word).toLowerCase(), { side, weight });
}

/**
 * Use cases: from the parts named in `from` toward the parts named in `to`
 * is the front. Extend with defineUseCase().
 */
export const USE_CASES = [
  { why: "a seat faces out from its backrest", from: ["backrest", "back"], to: ["seat", "cushion", "saddle"] },
  { why: "a screen faces away from its stand", from: ["stand", "neck", "mount", "bracket", "easel", "kickstand"], to: ["screen", "display", "panel", "sign", "board", "face"] },
  { why: "a picture faces away from the leg it leans on", from: ["leg", "easel", "kickstand"], to: ["photo", "picture", "portrait", "canvas"] },
  { why: "shelves open away from their back", from: ["back", "backboard", "backpanel"], to: ["shelf", "drawer", "door"] },
  { why: "a lamp faces where its head reaches", from: ["post", "pole", "column"], to: ["head", "lantern", "shade", "bulb", "lamp"] },
];
export function defineUseCase({ why, from, to }) {
  if (!Array.isArray(from) || !Array.isArray(to) || !from.length || !to.length) throw new TypeError("A use case needs from[] and to[] words.");
  USE_CASES.push({ why: why ?? `${to[0]} faces away from ${from[0]}`, from: from.map((w) => w.toLowerCase()), to: to.map((w) => w.toLowerCase()) });
}

/** A part's words: its name (and role) split on spaces, dashes and camelCase, lower-cased. */
export function wordsOf(p) {
  const text = [p.role, p.name, p.feature].filter((v) => typeof v === "string").join(" ");
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

// A word, or its singular: [the table's word, its entry], or null.
const lookup = (w, table) => (table.has(w) ? [w, table.get(w)] : w.endsWith("s") && table.has(w.slice(0, -1)) ? [w.slice(0, -1), table.get(w.slice(0, -1))] : null);

/** What a part says about the front: { side, weight, word } or null. Screen materials count as screens. */
export function featureOf(p, table = FEATURES) {
  if (p.feature === false) return null;
  let best = null;
  for (const w of wordsOf(p)) {
    const hit = lookup(w, table);
    if (hit && (!best || hit[1].weight > best.weight)) best = { ...hit[1], word: hit[0] };
  }
  if (!best && (p.mat === "screen" || p.mat === "lcd")) best = { ...(table.get("screen") ?? F(1.5)), word: `mat:${p.mat}` };
  return best;
}

const hasWord = (p, list) => wordsOf(p).some((w) => list.includes(w) || (w.endsWith("s") && list.includes(w.slice(0, -1))));

// ---------------------------------------------------------------- fronts as data

/**
 * A declared front, in any of its spellings, as a yaw in the thing's own frame:
 * a yaw number, a direction [x, y, z], "+z" / "-z" / "+x" / "-x", or
 * { yaw } / { dir }. Null for none.
 */
export function parseFront(front) {
  if (front === null || front === undefined || front === false) return null;
  if (typeof front === "number") return wrapAngle(front);
  if (front === true) return 0;
  if (typeof front === "string") {
    const m = { "+z": 0, z: 0, front: 0, "-z": Math.PI, back: Math.PI, "+x": Math.PI / 2, x: Math.PI / 2, right: Math.PI / 2, "-x": -Math.PI / 2, left: -Math.PI / 2 }[front.trim().toLowerCase()];
    if (m === undefined) throw new RangeError(`Unknown front "${front}".`);
    return wrapAngle(m);
  }
  if (Array.isArray(front)) {
    if (Math.hypot(front[0], front[2]) < 1e-9) throw new RangeError("A front direction needs a horizontal part.");
    return Math.atan2(front[0], front[2]);
  }
  if (typeof front === "object") {
    if (front.yaw !== undefined) return parseFront(front.yaw);
    if (front.dir) return parseFront(front.dir);
  }
  throw new TypeError("A front is a yaw, a direction, a '+z'-style name, or { yaw } / { dir }.");
}

const dirOfYaw = (y) => [Math.sin(y), 0, Math.cos(y)];
const yawOfV = (v) => Math.atan2(v[0], v[1]); // (v is horizontal [x, z])
/** The unsigned angle between two yaws, 0..PI. */
export const angleBetween = (a, b) => Math.abs(wrapAngle(a - b));

// ---------------------------------------------------------------- the thing, normalised

function normalise(thing, opts) {
  let parts;
  let transform = null;
  let declared = null;
  let declaredFrom = null;
  const src = Array.isArray(thing) ? { parts: thing } : thing;
  if (!src || typeof src !== "object") throw new TypeError("detectFront needs an object, an entity, parts, or { boxes, capsules }.");
  if (Array.isArray(src.parts)) parts = src.parts.map(toPart);
  else parts = [];
  for (const b of src.boxes ?? []) parts.push(toPart({ name: b.name ?? "box", ...b }));
  for (const c of src.capsules ?? []) parts.push(toPart({ name: c.name ?? "capsule", ...c }));
  if (!parts.length) throw new RangeError("detectFront: the thing has no parts.");
  if (src.transform) transform = src.transform;
  const pick = [["opts.front", opts.front], ["front", src.front], ["def.front", src.def?.front], ["components.front", src.components?.front]];
  for (const [from, v] of pick) {
    if (v !== undefined && v !== null) { declared = parseFront(v); declaredFrom = from; break; }
  }
  if (declared === null && src.facing === true && opts.front !== null) { declared = 0; declaredFrom = "facing flag (+z)"; }
  return { parts, transform, declared, declaredFrom, facingFlag: src.facing };
}

// ---------------------------------------------------------------- sampling

/** The parts as a field: distance, and first hit along a ray with the parts it could meet. */
function fieldOf(parts, pad) {
  const boxes = parts.map((p) => [p.bounds[0] - pad, p.bounds[1] - pad, p.bounds[2] - pad, p.bounds[3] + pad, p.bounds[4] + pad, p.bounds[5] + pad]);
  const dist = (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const b = boxes[i];
      // (Outside a part's padded box, the box is a lower bound on its distance: skip the SDF.)
      const ox = Math.max(b[0] - x, 0, x - b[3]);
      const oy = Math.max(b[1] - y, 0, y - b[4]);
      const oz = Math.max(b[2] - z, 0, z - b[5]);
      const lb = Math.hypot(ox, oy, oz);
      if (lb >= d) continue;
      const v = parts[i].sdf(x, y, z, 0, null);
      if (v < d) d = v;
    }
    return d;
  };
  const hit = (o, dir, eps, steps) => {
    const cand = [];
    let t0 = Infinity;
    let t1 = -Infinity;
    for (let i = 0; i < parts.length; i += 1) {
      const s = rayAabb(o, dir, boxes[i]);
      if (!s) continue;
      cand.push(i);
      if (s[0] < t0) t0 = s[0];
      if (s[1] > t1) t1 = s[1];
    }
    if (!cand.length) return null;
    let t = t0;
    for (let n = 0; n < steps && t <= t1; n += 1) {
      const x = o[0] + dir[0] * t;
      const y = o[1] + dir[1] * t;
      const z = o[2] + dir[2] * t;
      let d = Infinity;
      let who = -1;
      for (const i of cand) {
        const v = parts[i].sdf(x, y, z, 0, null);
        if (v < d) { d = v; who = i; }
      }
      if (d < eps) return { t, part: who, p: [x, y, z] };
      t += Math.max(d * 0.9, eps);
    }
    return null;
  };
  return { dist, hit };
}

/** Occupied samples on a grid: centroid, principal axis (a yaw), the spread along it. */
function massOf(parts, field, B, n) {
  const ext = [B[3] - B[0], B[4] - B[1], B[5] - B[2]];
  const cell = Math.max(...ext) / n;
  let m = 0;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  const pts = [];
  const nx = Math.max(2, Math.ceil(ext[0] / cell));
  const ny = Math.max(2, Math.ceil(ext[1] / cell));
  const nz = Math.max(2, Math.ceil(ext[2] / cell));
  for (let i = 0; i < nx; i += 1) for (let j = 0; j < ny; j += 1) for (let k = 0; k < nz; k += 1) {
    const x = B[0] + ((i + 0.5) * ext[0]) / nx;
    const y = B[1] + ((j + 0.5) * ext[1]) / ny;
    const z = B[2] + ((k + 0.5) * ext[2]) / nz;
    // (Near the surface counts: a sign a few cells thin still has its weight.)
    if (field.dist(x, y, z) < cell * 0.5) { m += 1; sx += x; sy += y; sz += z; pts.push(x, z); }
  }
  if (!m) {
    const c = [(B[0] + B[3]) / 2, (B[1] + B[4]) / 2, (B[2] + B[5]) / 2];
    return { centroid: c, axisYaw: 0, ratio: 1, mid: c, n: 0 };
  }
  const c = [sx / m, sy / m, sz / m];
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - c[0];
    const dz = pts[i + 1] - c[2];
    cxx += dx * dx; czz += dz * dz; cxz += dx * dz;
  }
  // The long axis of the footprint (as a yaw: the direction [sin, cos]).
  const tr = cxx + czz;
  const det = cxx * czz - cxz * cxz;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = tr / 2 - disc;
  let ex = cxz;
  let ez = l1 - cxx;
  if (Math.hypot(ex, ez) < 1e-12) { ex = cxx >= czz ? 1 : 0; ez = cxx >= czz ? 0 : 1; }
  const axisYaw = Math.atan2(ex, ez);
  // The middle of the footprint's extent along its own axes (not the world box's): turns with the thing.
  const a1 = [Math.sin(axisYaw), Math.cos(axisYaw)];
  const a2 = [a1[1], -a1[0]];
  let lo1 = Infinity; let hi1 = -Infinity; let lo2 = Infinity; let hi2 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - c[0];
    const dz = pts[i + 1] - c[2];
    const u = dx * a1[0] + dz * a1[1];
    const v = dx * a2[0] + dz * a2[1];
    if (u < lo1) lo1 = u; if (u > hi1) hi1 = u; if (v < lo2) lo2 = v; if (v > hi2) hi2 = v;
  }
  const m1 = (lo1 + hi1) / 2;
  const m2 = (lo2 + hi2) / 2;
  const mid = [c[0] + a1[0] * m1 + a2[0] * m2, c[1], c[2] + a1[1] * m1 + a2[1] * m2];
  return { centroid: c, axisYaw, ratio: l1 > 0 ? l2 / l1 : 1, mid, n: m, cell };
}

// Add the outward normal of the part hit, at the hit, to its running sum (features only).
function addNormal(nsum, parts, h, e, w) {
  const f = parts[h.part].sdf;
  const [x, y, z] = h.p;
  const gx = f(x + e, y, z, 0, null) - f(x - e, y, z, 0, null);
  const gy = f(x, y + e, z, 0, null) - f(x, y - e, z, 0, null);
  const gz = f(x, y, z + e, 0, null) - f(x, y, z - e, 0, null);
  const l = Math.hypot(gx, gy, gz);
  if (!(l > 0)) return;
  nsum[h.part * 4] += (gx / l) * w;
  nsum[h.part * 4 + 1] += (gy / l) * w;
  nsum[h.part * 4 + 2] += (gz / l) * w;
  nsum[h.part * 4 + 3] += w;
}

/**
 * Views round a ring: for each direction u_k (horizontal, from the thing
 * toward the viewer), an orthographic grid of rays looking back at it from a
 * little above. Per view: feature and back-feature visibility, edges
 * (depth steps and part changes), recess (how far in the surface is), a broad
 * flat face.
 */
function ringOf(parts, field, feats, { dirs, grid, elevation, phase, center, radius, R, B, eps, steps, nsum }) {
  const views = [];
  const ce = Math.cos(elevation);
  const se = Math.sin(elevation);
  const diam = 2 * radius;
  // (The grid spans the footprint's circle, the same from every side: a ball
  // looks the same from everywhere, and a turned thing is sampled as it was.)
  const s0 = -R;
  const s1 = R;
  const v0 = (B[1] - center[1]) * ce - R * se;
  const v1 = (B[4] - center[1]) * ce + R * se;
  const supp = R;
  for (let k = 0; k < dirs; k += 1) {
    const th = phase + (k * 2 * Math.PI) / dirs;
    const uh = [Math.sin(th), 0, Math.cos(th)];
    const u = [uh[0] * ce, se, uh[2] * ce]; // (toward the viewer)
    const d = [-u[0], -u[1], -u[2]];
    const r = [Math.cos(th), 0, -Math.sin(th)];
    const up = [-uh[0] * se, ce, -uh[2] * se];
    const back = radius * 2.2;
    const depth = new Float64Array(grid * grid).fill(NaN);
    const who = new Int32Array(grid * grid).fill(-1);
    // (Seen area per part: cells times each cell's area, so views and the top view compare.)
    const cellArea = ((s1 - s0) / grid) * ((v1 - v0) / grid);
    const perPart = new Float64Array(parts.length);
    let hits = 0;
    let front = 0;
    let behind = 0;
    let recess = 0;
    for (let i = 0; i < grid; i += 1) {
      const s = s0 + ((i + 0.5) * (s1 - s0)) / grid;
      for (let j = 0; j < grid; j += 1) {
        const v = v0 + ((j + 0.5) * (v1 - v0)) / grid;
        const o = [
          center[0] + u[0] * back + r[0] * s + up[0] * v,
          center[1] + u[1] * back + r[1] * s + up[1] * v,
          center[2] + u[2] * back + r[2] * s + up[2] * v,
        ];
        const h = field.hit(o, d, eps, steps);
        if (!h) continue;
        hits += 1;
        const proj = (h.p[0] - center[0]) * uh[0] + (h.p[2] - center[2]) * uh[2];
        depth[i * grid + j] = proj;
        who[i * grid + j] = h.part;
        perPart[h.part] += cellArea;
        recess += (supp - proj) / diam;
        const f = feats[h.part];
        if (f) {
          if (f.side === "front") front += f.weight; else behind += f.weight;
          addNormal(nsum, parts, h, eps * 4, cellArea);
        }
      }
    }
    const rays = grid * grid;
    // Edges: neighbouring rays that both hit but step in depth, or change part.
    let edges = 0;
    let pairs = 0;
    let top = -Infinity;
    for (let n = 0; n < rays; n += 1) if (depth[n] > top) top = depth[n];
    let flat = 0;
    for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
      const a = i * grid + j;
      if (Number.isNaN(depth[a])) continue;
      if (depth[a] >= top - 0.025 * diam) flat += 1;
      for (const b of [i + 1 < grid ? a + grid : -1, j + 1 < grid ? a + 1 : -1]) {
        if (b < 0 || Number.isNaN(depth[b])) continue;
        pairs += 1;
        if (who[a] !== who[b] || Math.abs(depth[a] - depth[b]) > 0.04 * diam) edges += 1;
      }
    }
    views.push({
      yaw: th, uh, hits: hits / rays,
      front: front / rays, behind: behind / rays,
      edges: pairs ? edges / pairs : 0,
      recess: hits ? recess / hits : 0,
      flat: flat / rays,
      parts: new Set(Array.from(who).filter((w) => w >= 0)).size,
      perPart,
    });
  }
  return views;
}

// Front/back contrast of one measure round the ring, as a horizontal vector
// [x, z] (length about 1 for a clean one-sided profile).
function contrast(views, key, floor) {
  const n = views.length;
  const half = n / 2;
  let x = 0;
  let z = 0;
  for (let k = 0; k < n; k += 1) {
    const a = views[k][key];
    const b = views[(k + half) % n][key];
    const c = (a - b) / (a + b + floor);
    x += c * views[k].uh[0];
    z += c * views[k].uh[2];
  }
  return [(2 * x) / n, (2 * z) / n];
}

const len2 = (v) => Math.hypot(v[0], v[1]);
const scale2 = (v, k) => [v[0] * k, v[1] * k];
const clamp2 = (v, m = 1) => { const l = len2(v); return l > m ? scale2(v, m / l) : v; };
const deg = (a) => `${Math.round((a * 180) / Math.PI)}°`;

// What is seen from straight above: each part's share of a grid of rays
// looking down (a lying screen, keys, face buttons: things that face up).
function topView(parts, field, feats, { center, R, B, grid, eps, steps, nsum }) {
  const seen = new Float64Array(parts.length);
  const y = B[4] + (B[4] - B[1]) * 0.1 + eps * 10;
  for (let i = 0; i < grid; i += 1) for (let j = 0; j < grid; j += 1) {
    const o = [center[0] - R + ((i + 0.5) * 2 * R) / grid, y, center[2] - R + ((j + 0.5) * 2 * R) / grid];
    const h = field.hit(o, [0, -1, 0], eps, steps);
    if (!h) continue;
    seen[h.part] += ((2 * R) / grid) ** 2;
    if (feats[h.part]) addNormal(nsum, parts, h, eps * 4, ((2 * R) / grid) ** 2);
  }
  return seen;
}

// A part's centroid from inside it (its bounds can be far bigger than it: a
// swivelling seat's bounds are the circle it sweeps). Falls back to the bounds' middle.
function solidCentroid(p, n = 8) {
  const b = p.bounds;
  let m = 0; let x = 0; let y = 0; let z = 0;
  const cell = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / n;
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) for (let k = 0; k < n; k += 1) {
    const px = b[0] + ((i + 0.5) * (b[3] - b[0])) / n;
    const py = b[1] + ((j + 0.5) * (b[4] - b[1])) / n;
    const pz = b[2] + ((k + 0.5) * (b[5] - b[2])) / n;
    if (p.sdf(px, py, pz, 0, null) < cell * 0.35) { m += 1; x += px; y += py; z += pz; }
  }
  return m ? [x / m, y / m, z / m, m] : [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, 0];
}

function centroidOf(list) {
  let w = 0; let x = 0; let y = 0; let z = 0;
  for (const p of list) {
    const c = solidCentroid(p);
    const b = p.bounds;
    const v = Math.max(1e-9, (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2])) ** (1 / 3);
    w += v; x += c[0] * v; y += c[1] * v; z += c[2] * v;
  }
  return w ? [x / w, y / w, z / w] : null;
}

// The rotation a NOCTURNES-style part carries (present() leaves `rot`), applied to a direction.
const applyRot = (m, v) => (m ? [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]] : v);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A normal a part declares: `normal`, or a NOCTURNES screen's axes (ax x ay), turned by its `rot`. */
function declaredNormal(p) {
  if (Array.isArray(p.normal)) return p.normal;
  if (p.screen && Array.isArray(p.screen.ax) && Array.isArray(p.screen.ay)) return applyRot(p.rot, cross(p.screen.ax, p.screen.ay));
  return null;
}

// ---------------------------------------------------------------- the evidence

/**
 * The evidence alone, in the parts' own frame: { yaw, confidence, layers,
 * symmetric, symmetry, axisYaw, why }.
 */
export function frontEvidence(partsIn, opts = {}) {
  const parts = partsIn.map(toPart);
  const table = opts.features ? new Map([...FEATURES, ...Object.entries(opts.features)]) : FEATURES;
  const B = unionBounds(parts.map((p) => p.bounds));
  const size = Math.max(B[3] - B[0], B[4] - B[1], B[5] - B[2]) || 1;
  const field = fieldOf(parts, size * 0.002);
  const mass = massOf(parts, field, B, opts.massGrid ?? 16);
  const center = mass.centroid;
  let radius = 0;
  for (const x of [B[0], B[3]]) for (const y of [B[1], B[4]]) for (const z of [B[2], B[5]]) radius = Math.max(radius, Math.hypot(x - center[0], y - center[1], z - center[2]));
  const R = Math.max(1e-6, Math.max(...[[B[0], B[2]], [B[0], B[5]], [B[3], B[2]], [B[3], B[5]]].map(([x, z]) => Math.hypot(x - center[0], z - center[2]))));
  const feats = parts.map((p) => featureOf(p, table));
  const why = [];

  // (Per part: the sum of the outward normals where it was seen, and the area they stand for.)
  const nsum = new Float64Array(parts.length * 4);
  const views = ringOf(parts, field, feats, {
    dirs: opts.dirs ?? 24, grid: opts.grid ?? 12, elevation: opts.elevation ?? 0.2, phase: mass.axisYaw,
    center, radius, R, B, eps: size * 0.0015, steps: opts.steps ?? 90, nsum,
  });

  // ---- b. features
  const featured = parts.map((p, i) => ({ p, f: feats[i], i })).filter((q) => q.f);
  let features = null;
  let up = 0;
  if (featured.length) {
    // Which way each feature's visible surface faces (from the sides and from
    // above): out (a screen), or up (keys, face buttons, a lying screen).
    topView(parts, field, feats, { center, R, B, grid: opts.grid ?? 12, eps: size * 0.0015, steps: opts.steps ?? 90, nsum });
    const upness = new Map();
    let sx = 0; let sz = 0; let sw = 0;
    // (A feature barely seen -- tucked inside another part -- has a noisy normal: it counts by how much of it shows.)
    const amax = Math.max(1e-12, ...featured.map(({ i }) => nsum[i * 4 + 3]));
    for (const { f, i } of featured) {
      const a = nsum[i * 4 + 3];
      if (!(a > 0)) { upness.set(i, 0); continue; }
      const n = [nsum[i * 4] / a, nsum[i * 4 + 1] / a, nsum[i * 4 + 2] / a];
      const l = Math.hypot(...n) || 1;
      upness.set(i, Math.max(0, n[1]) / l);
      const sgn = f.side === "front" ? 1 : -1;
      const w = f.weight * Math.min(1, (4 * a) / amax);
      sx += sgn * w * n[0]; sz += sgn * w * n[2]; sw += w;
    }
    const surf = sw ? clamp2([(sx / sw) * 1.25, (sz / sw) * 1.25]) : [0, 0];
    let vx = 0; let vz = 0; let tot = 0;
    for (const v of views) {
      for (const { f, i } of featured) {
        const w = v.perPart[i] * f.weight;
        const sgn = f.side === "front" ? 1 : -1;
        vx += sgn * w * v.uh[0]; vz += sgn * w * v.uh[2]; tot += w;
      }
    }
    const vis = tot > 1e-9 ? clamp2([(vx / tot) * 1.25, (vz / tot) * 1.25]) : [0, 0];
    // Where the features sit off the body; a feature on top says little about the front.
    let cx = 0; let cz = 0; let cw = 0; let uw = 0;
    let nx = 0; let nz = 0; let nw = 0;
    for (const { p, f, i } of featured) {
      const c = solidCentroid(p);
      const s = f.side === "front" ? 1 : -1;
      const out = 1 - upness.get(i);
      cx += s * f.weight * out * (c[0] - center[0]); cz += s * f.weight * out * (c[2] - center[2]); cw += f.weight;
      up += upness.get(i) * f.weight; uw += f.weight;
      const n = declaredNormal(p);
      if (n) {
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        nx += (s * f.weight * n[0]) / l; nz += (s * f.weight * n[2]) / l; nw += f.weight;
      }
    }
    up = uw ? up / uw : 0;
    const off = cw ? clamp2([cx / (cw * 0.25 * R), cz / (cw * 0.25 * R)]) : [0, 0];
    // (A declared normal that points up adds little sideways: its horizontal part is what counts.)
    const nrm = nw ? clamp2([nx / nw, nz / nw]) : null;
    const parts3 = [[surf, 1], [vis, 0.7], [off, 0.4], ...(nrm ? [[nrm, 1.2]] : [])];
    const W = parts3.reduce((acc, [, w]) => acc + w, 0);
    const v = parts3.reduce((acc, [q, w]) => [acc[0] + q[0] * w, acc[1] + q[1] * w], [0, 0]).map((q) => q / W);
    const amount = Math.min(1, featured.reduce((acc, q) => acc + q.f.weight, 0));
    features = { v: scale2(v, amount), vis, surf, offset: off, normal: nrm, up, words: [...new Set(featured.map((q) => q.f.word))] };
    const say = (q) => (len2(q) > 0.05 ? `${deg(yawOfV(q))} (${len2(q).toFixed(2)})` : "none");
    why.push(`features [${features.words.join(", ")}]: their surfaces face ${say(surf)}, seen most from ${say(vis)}, sit off the body toward ${say(off)}${nrm ? `, declare normals toward ${say(nrm)}` : ""}${up > 0.5 ? `; mostly on top (${up.toFixed(2)} face up)` : ""}`);
  }

  // ---- d. use cases
  let useCase = null;
  {
    let ux = 0; let uz = 0; let uw = 0;
    const said = [];
    for (const rule of opts.useCases ?? USE_CASES) {
      const from = parts.filter((p) => hasWord(p, rule.from));
      const to = parts.filter((p) => hasWord(p, rule.to) && !from.includes(p));
      if (!from.length || !to.length) continue;
      const a = centroidOf(from);
      const b = centroidOf(to);
      const off = [b[0] - a[0], b[2] - a[2]];
      if (len2(off) < 0.02 * R) continue;
      const s = Math.min(1, len2(off) / (0.15 * R));
      ux += (off[0] / len2(off)) * s; uz += (off[1] / len2(off)) * s; uw += 1;
      said.push(`${rule.why} (${deg(yawOfV(off))})`);
    }
    if (uw) { useCase = { v: clamp2([ux / uw, uz / uw]) }; why.push(`use: ${said.join("; ")}`); }
  }

  // ---- c. geometry
  const recess = contrast(views, "recess", 0.05);
  const edges = contrast(views, "edges", 0.03);
  const flat = contrast(views, "flat", 0.05);
  const mo = [mass.centroid[0] - mass.mid[0], mass.centroid[2] - mass.mid[2]];
  const massV = clamp2(scale2(mo, 1 / (0.15 * R)));
  const GW = { recess: 1, edges: 0.8, flat: 0.5, mass: 0.5 };
  const gv = [
    (recess[0] * GW.recess + edges[0] * GW.edges + flat[0] * GW.flat - massV[0] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
    (recess[1] * GW.recess + edges[1] * GW.edges + flat[1] * GW.flat - massV[1] * GW.mass) / (GW.recess + GW.edges + GW.flat + GW.mass),
  ];
  // (Small contrasts are sampling noise, not a front.)
  const gs = Math.max(0, len2(gv) - 0.04) / (1 - 0.04);
  const geometry = { v: len2(gv) > 1e-9 ? scale2(gv, gs / len2(gv)) : [0, 0], recess, edges, flat, mass: massV };
  // Round: every view alike. Mirror: each view like its opposite.
  const spread = (key) => { const xs = views.map((v) => v[key]); const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) / (Math.abs(m) + 0.02); };
  const round = mass.ratio > 0.85 && spread("hits") < 0.06 && spread("recess") < 0.12 && spread("edges") < 0.25
    && Math.max(len2(recess), len2(edges), len2(flat)) < 0.15;
  why.push(`geometry: recess ${deg(yawOfV(recess))} (${len2(recess).toFixed(2)}), edges ${deg(yawOfV(edges))} (${len2(edges).toFixed(2)}), flat face ${deg(yawOfV(flat))} (${len2(flat).toFixed(2)}), mass leans ${deg(yawOfV(massV))} (${len2(massV).toFixed(2)})${round ? "; round: every view alike" : ""}`);

  // ---- combined
  const layers = [
    ["features", features, 3, 0.95],
    ["useCase", useCase, 2.5, 0.9],
    ["geometry", geometry, 1, 0.6],
  ].filter(([, L]) => L && len2(L.v) > 1e-6);
  let sx = 0; let sz = 0; let sabs = 0; let miss = 1;
  for (const [, L, W, q] of layers) {
    sx += L.v[0] * W; sz += L.v[1] * W; sabs += len2(L.v) * W;
    miss *= 1 - Math.min(1, len2(L.v)) * q;
  }
  const agreement = sabs > 0 ? Math.hypot(sx, sz) / sabs : 0;
  let confidence = agreement * (1 - miss);
  const yaw = Math.hypot(sx, sz) > 1e-9 ? Math.atan2(sx, sz) : 0;
  const onlyGeometry = !features && !useCase;
  const symmetric = onlyGeometry && (round || gs < 0.12);
  if (symmetric) confidence = Math.min(confidence, 0.15);
  const out = (L) => (L ? { yaw: yawOfV(L.v), strength: len2(L.v) } : null);
  return {
    yaw, dir: dirOfYaw(yaw), confidence,
    symmetric, symmetry: round ? "round" : symmetric ? "mirror" : null,
    // (How much of the named front faces up: a lying phone, a keyboard's keys.)
    up,
    // (Square to the long axis: where a front would be, either way.)
    axisYaw: wrapAngle(mass.axisYaw + Math.PI / 2),
    layers: {
      features: features ? { ...out(features), words: features.words, seen: yawOfV(features.vis), offset: yawOfV(features.offset), up: features.up } : null,
      useCase: out(useCase),
      geometry: { ...out(geometry), recess: len2(recess), edges: len2(edges), flat: len2(flat), mass: len2(massV) },
    },
    agreement,
    why,
  };
}

// ---------------------------------------------------------------- the ask

/**
 * detectFront(thing, opts): see the top of this file. `thing` is an object
 * definition or instance, an entity with parts, an array of parts/prims, or
 * { boxes, capsules } (raw renderer/physics solids, world space). opts:
 *   front       a declared front to check (overrides the thing's own)
 *   features    { word: { side, weight } } added to the vocabulary for this call
 *   useCases    replaces USE_CASES for this call
 *   dirs, grid, elevation, steps, massGrid   the ring's sampling
 *   evidence    a frontEvidence() result to reuse (the same parts, another placement)
 */
export function detectFront(thing, opts = {}) {
  const T = normalise(thing, opts);
  const E = opts.evidence ?? frontEvidence(T.parts, opts);
  const why = [...E.why];
  let local = E.yaw;
  let confidence = E.confidence;
  let agrees = null;
  if (T.declared !== null) {
    const off = angleBetween(T.declared, E.yaw);
    if (E.confidence >= 0.2) agrees = off <= Math.PI / 4;
    why.unshift(`declared ${deg(T.declared)} (${T.declaredFrom}); the evidence says ${deg(E.yaw)} at ${E.confidence.toFixed(2)}${agrees === null ? " -- too weak to check" : agrees ? " -- agrees" : ` -- DISAGREES by ${deg(off)}`}`);
    local = T.declared;
    confidence = agrees === true ? Math.max(0.9, E.confidence) : agrees === false ? 0.5 : 0.8;
  } else if (T.facingFlag === false) {
    why.unshift("authored with no front (facing: false)");
  }
  if (E.symmetric && T.declared === null) why.push(`symmetric (${E.symmetry}): no front to find`);
  // Into the world, when there is a transform.
  const toWorld = (y) => {
    if (!T.transform) return { yaw: wrapAngle(y), dir: dirOfYaw(y) };
    const d = dirToWorld({ transform: T.transform }, dirOfYaw(y));
    const h = Math.hypot(d[0], d[2]) || 1;
    return { yaw: Math.atan2(d[0], d[2]), dir: [d[0] / h, 0, d[2] / h] };
  };
  const w = toWorld(local);
  const det = toWorld(E.yaw);
  return {
    yaw: w.yaw, dir: w.dir, confidence,
    declared: T.declared !== null, declaredYaw: T.declared === null ? null : toWorld(T.declared).yaw,
    agrees,
    symmetric: E.symmetric, symmetry: E.symmetry,
    axisYaw: toWorld(E.axisYaw).yaw,
    detected: { yaw: det.yaw, dir: det.dir, confidence: E.confidence },
    local: { yaw: wrapAngle(local), dir: dirOfYaw(local), detectedYaw: E.yaw },
    layers: E.layers,
    why,
  };
}

/** Does a thing at `pos` facing `yaw` show its front to a viewer at `eye`? The angle off, 0..PI. */
export function frontOffFrom(pos, yaw, eye) {
  return angleBetween(yaw, Math.atan2(eye[0] - pos[0], eye[2] - pos[2]));
}
