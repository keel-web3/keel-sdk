// A small catalogue of static props and level pieces, as seeded builders:
// pillar, wall, pad, ramp, rail, arch, tunnel, crate, bench, sign, lamp post,
// stairs. Each is built in its own frame (+z front, +y up, the pivot in the
// middle of its base), from boxes and capsules -- the solids the renderer and
// the character controller share -- so its colliders ARE its parts.
//
//   build(S, ctx) -> definition      S: a seeded stream (core/rng.js stream)
//   ctx overrides any size: { w, d, h, length, thick, steps, ... } -- the draw
//   still happens first, so a size given leaves every later draw where it was.
//
// Fronts, as declared (and each checked by tests/object.test.mjs):
//   pillar, pad, crate   +z by convention (the crate's label is on it)
//   wall                 +z: one broad face (either can be run along)
//   ramp, stairs         +z: the foot you walk up from; they rise toward -z
//   rail                 +z: the way it's ridden, start at z = 0
//   arch, tunnel         +z: the mouth you go in by
//   bench                +z: where you sit facing (the backrest behind)
//   sign                 +z: the display side (the posts behind)
//   lamp post            +z: where its head reaches out over

import { createRegistry, defaultRegistry } from "../scene/registry.js";
import { createRoll, stream } from "../core/rng.js";
import { defineObject } from "./object.js";

// A number from ctx, or drawn -- the draw ALWAYS happens.
const pick = (S, given, a, b) => { const v = S.between(a, b); return given ?? v; };
const pickInt = (S, given, a, b) => { const v = S.int(a, b); return given ?? v; };
const chance = (S, given, p) => { const v = S.chance(p); return given ?? v; };

const bx = (name, c, h, extra = {}) => ({ box: { c, h, yaw: extra.yaw ?? 0 }, name, mat: extra.mat ?? "wall", ...extra });
const cap = (name, a, b, r, extra = {}) => ({ capsule: { a, b, r }, name, mat: extra.mat ?? "metal", ...extra });

// ---------------------------------------------------------------- the pieces

function pillar(S, ctx = {}) {
  const w = pick(S, ctx.w, 0.6, 3.5);
  const d = pick(S, ctx.d, 0.6, 3.5);
  const h = pick(S, ctx.h, 3, 12);
  const sink = ctx.sink ?? 0;
  return defineObject({
    key: "pillar", tags: ["level", "solid", "wallrun"], front: "+z",
    parts: [bx("pillar", [0, (h - sink) / 2, 0], [w / 2, (h + sink) / 2, d / 2])],
    sockets: { face: { kind: "anchor", pos: [0, h / 2, d / 2], yaw: 0, normal: [0, 0, 1] } },
    meta: { w, d, h },
  });
}

function wall(S, ctx = {}) {
  const length = pick(S, ctx.length, 4, 20);
  const h = pick(S, ctx.h, 3, 12);
  const thick = pick(S, ctx.thick, 0.3, 0.7);
  const sink = ctx.sink ?? 0;
  return defineObject({
    key: "wall", tags: ["level", "solid", "wallrun", "runnable"], front: "+z",
    parts: [bx("wall", [0, (h - sink) / 2, 0], [length / 2, (h + sink) / 2, thick / 2])],
    sockets: {
      // (The two faces you can run along: yaw is the way a runner faces, going +x.)
      runFront: { kind: "anchor", pos: [0, h * 0.35, thick / 2], yaw: Math.PI / 2, normal: [0, 0, 1], extent: [length / 2, 0] },
      runBack: { kind: "anchor", pos: [0, h * 0.35, -thick / 2], yaw: Math.PI / 2, normal: [0, 0, -1], extent: [length / 2, 0] },
    },
    meta: { length, h, thick },
  });
}

function pad(S, ctx = {}) {
  const w = pick(S, ctx.w, 2.5, 8);
  const d = pick(S, ctx.d, 2.5, 8);
  const h = pick(S, ctx.h, 0.2, 0.6);
  const sink = ctx.sink ?? 0;
  const lip = chance(S, ctx.lip, 0.4);
  const parts = [bx("pad", [0, (h - sink) / 2, 0], [w / 2, (h + sink) / 2, d / 2], { mat: "floor" })];
  // (A lip along the front edge, a hand high: what you'd step up on.)
  if (lip) parts.push(bx("lip", [0, h + 0.04, d / 2 - 0.1], [w / 2, 0.04, 0.1], { mat: "trim", collide: false }));
  return defineObject({
    key: "pad", tags: ["level", "floor", "wallrun"], front: "+z", parts,
    sockets: {
      top: { kind: "top", pos: [0, h, 0], yaw: 0, extent: [w / 2, d / 2] },
      spawn: { kind: "spawn", pos: [0, h, 0], yaw: 0 },
    },
    meta: { w, d, h },
  });
}

// Rises from its foot at +z to its top at -z, in slabs (physics and the
// renderer have boxes turned about y only: a slope is its steps).
function ramp(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.5, 4);
  const length = pick(S, ctx.length, 3, 9);
  const h = pick(S, ctx.h, 0.6, 2.5);
  const steps = ctx.steps ?? Math.max(4, Math.ceil(h / 0.1));
  const parts = [];
  const run = length / steps;
  for (let i = 0; i < steps; i += 1) {
    const top = (h * (i + 1)) / steps;
    parts.push(bx(`slab${i}`, [0, top / 2, length / 2 - run * (i + 0.5)], [w / 2, top / 2, run / 2], { mat: "floor" }));
  }
  return defineObject({
    key: "ramp", tags: ["level", "floor", "wallrun"], front: "+z", parts,
    sockets: {
      foot: { kind: "anchor", pos: [0, 0, length / 2], yaw: Math.PI }, // (standing at the foot, facing up it)
      top: { kind: "top", pos: [0, h, -length / 2 + run / 2], yaw: 0, extent: [w / 2, run / 2] },
    },
    meta: { w, length, h, steps },
  });
}

function stairs(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.2, 3);
  const steps = pickInt(S, ctx.steps, 4, 12);
  const rise = pick(S, ctx.rise, 0.15, 0.22);
  const tread = pick(S, ctx.tread, 0.25, 0.35);
  const length = steps * tread;
  const parts = [];
  for (let i = 0; i < steps; i += 1) {
    const top = rise * (i + 1);
    parts.push(bx(`step${i}`, [0, top / 2, length / 2 - tread * (i + 0.5)], [w / 2, top / 2, tread / 2], { mat: "floor" }));
  }
  return defineObject({
    key: "stairs", tags: ["level", "floor"], front: "+z", parts,
    sockets: {
      foot: { kind: "anchor", pos: [0, 0, length / 2 + 0.2], yaw: Math.PI },
      top: { kind: "top", pos: [0, rise * steps, -length / 2 + tread / 2], yaw: 0, extent: [w / 2, tread / 2] },
    },
    meta: { w, steps, rise, tread },
  });
}

// A rail to grind: a bending, rising polyline from z = 0 to z = length, bars
// between its points, posts under it. Its front is the way it's ridden.
// ctx: length, bend (signed), rise, y (its height at the ends), segments, r, posts, shape.
function rail(S, ctx = {}) {
  const length = pick(S, ctx.length, 10, 26);
  const sgn = S.chance(0.5) ? -1 : 1;
  const bend = pick(S, ctx.bend, 0, 7) * (ctx.bend === undefined ? sgn : 1);
  const rise = pick(S, ctx.rise, 0, 1.6);
  const y0 = ctx.y ?? 0.8;
  const n = ctx.segments ?? 12;
  const r = ctx.r ?? 0.07;
  // (shape "ease": sin^2 -- it leaves and arrives straight and level, as WALLRUN's does; "arc": sin.)
  const ease = (ctx.shape ?? "ease") === "ease";
  const line = [];
  for (let k = 0; k <= n; k += 1) {
    const t = k / n;
    const k2 = ease ? Math.sin(Math.PI * t) ** 2 : Math.sin(Math.PI * t);
    line.push([bend * k2, y0 + rise * k2, length * t]);
  }
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(cap(`bar${i}`, line[i], line[i + 1], r, { mat: "rail", collide: false }));
  const posts = ctx.posts ?? true;
  if (posts) for (let i = 0; i <= n; i += 3) parts.push(cap(`post${i}`, [line[i][0], 0.03, line[i][2]], [line[i][0], line[i][1] - r, line[i][2]], r * 0.6, { mat: "metal", collide: false }));
  const tan = (i, j) => Math.atan2(line[j][0] - line[i][0], line[j][2] - line[i][2]);
  return defineObject({
    key: "rail", tags: ["level", "rail", "wallrun"], front: "+z", parts, rails: [line],
    sockets: {
      start: { kind: "anchor", pos: line[0], yaw: tan(0, 1) },
      end: { kind: "anchor", pos: line[n], yaw: tan(n - 1, n) },
    },
    meta: { length, bend, rise },
  });
}

function arch(S, ctx = {}) {
  const span = pick(S, ctx.span, 2, 5);
  const h = pick(S, ctx.h, 2.5, 5);
  const thick = pick(S, ctx.thick, 0.4, 0.9);
  const post = pick(S, ctx.post, 0.4, 0.8);
  const lintel = post * 0.8;
  return defineObject({
    key: "arch", tags: ["level", "solid"], front: "+z",
    parts: [
      bx("post", [-(span / 2 + post / 2), h / 2, 0], [post / 2, h / 2, thick / 2]),
      bx("post", [span / 2 + post / 2, h / 2, 0], [post / 2, h / 2, thick / 2]),
      bx("lintel", [0, h + lintel / 2, 0], [span / 2 + post, lintel / 2, thick / 2]),
    ],
    sockets: {
      entry: { kind: "anchor", pos: [0, 0, thick / 2 + 0.5], yaw: Math.PI }, // (standing before it, facing through)
      exit: { kind: "anchor", pos: [0, 0, -thick / 2 - 0.5], yaw: Math.PI },
    },
    meta: { span, h, thick },
  });
}

function tunnel(S, ctx = {}) {
  const length = pick(S, ctx.length, 8, 16);
  const span = pick(S, ctx.span, 3, 6);
  const h = pick(S, ctx.h, 3, 5);
  const thick = pick(S, ctx.thick, 0.4, 0.7);
  const roof = pick(S, ctx.roof, 0.3, 0.6);
  const floor = chance(S, ctx.floor, 0.5);
  const parts = [
    bx("wall", [-(span / 2 + thick / 2), h / 2, 0], [thick / 2, h / 2, length / 2]),
    bx("wall", [span / 2 + thick / 2, h / 2, 0], [thick / 2, h / 2, length / 2]),
    bx("roof", [0, h + roof / 2, 0], [span / 2 + thick, roof / 2, length / 2]),
  ];
  if (floor) parts.push(bx("floor", [0, -0.15, 0], [span / 2, 0.15, length / 2], { mat: "floor" }));
  return defineObject({
    key: "tunnel", tags: ["level", "solid", "wallrun"], front: "+z", parts,
    sockets: {
      entry: { kind: "anchor", pos: [0, 0, length / 2 + 0.5], yaw: Math.PI },
      exit: { kind: "anchor", pos: [0, 0, -length / 2 - 0.5], yaw: Math.PI },
      runLeft: { kind: "anchor", pos: [-span / 2, h * 0.4, 0], yaw: Math.PI, normal: [1, 0, 0], extent: [0, length / 2] },
      runRight: { kind: "anchor", pos: [span / 2, h * 0.4, 0], yaw: Math.PI, normal: [-1, 0, 0], extent: [0, length / 2] },
    },
    meta: { length, span, h },
  });
}

function crate(S, ctx = {}) {
  const s = pick(S, ctx.size, 0.5, 1.2);
  const tall = s * pick(S, ctx.tall, 0.8, 1.2);
  const band = s * 0.06;
  const parts = [bx("crate", [0, tall / 2, 0], [s / 2, tall / 2, s / 2], { mat: "wood" })];
  // (Bands round it -- the same on every side -- and a stencilled label on the front.)
  for (const y of [tall * 0.15, tall * 0.85]) {
    parts.push(bx("band", [0, y, 0], [s / 2 + 0.01, band / 2, s / 2 + 0.01], { mat: "metal", collide: false }));
  }
  parts.push(bx("label", [0, tall * 0.5, s / 2 + 0.008], [s * 0.3, tall * 0.18, 0.008], { mat: "paint", collide: false }));
  return defineObject({
    key: "crate", tags: ["prop", "solid", "movable"], front: "+z", parts,
    sockets: {
      grabLeft: { kind: "grab", pos: [-s / 2, tall * 0.6, 0], yaw: -Math.PI / 2 },
      grabRight: { kind: "grab", pos: [s / 2, tall * 0.6, 0], yaw: Math.PI / 2 },
    },
    meta: { size: s, tall },
  });
}

function bench(S, ctx = {}) {
  const w = pick(S, ctx.w, 1.2, 2.4);
  const seatH = pick(S, ctx.seatH, 0.4, 0.5);
  const seatD = pick(S, ctx.seatD, 0.38, 0.5);
  const hasBack = chance(S, ctx.back, 0.75);
  const backH = pick(S, ctx.backH, 0.35, 0.55);
  const slab = 0.05;
  const leg = 0.05;
  const parts = [bx("seat", [0, seatH - slab / 2, 0], [w / 2, slab / 2, seatD / 2], { mat: "wood" })];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(bx("leg", [sx * (w / 2 - leg * 2), (seatH - slab) / 2, sz * (seatD / 2 - leg * 1.5)], [leg / 2, (seatH - slab) / 2, leg / 2], { mat: "metal" }));
  }
  if (hasBack) {
    const zb = -seatD / 2 + 0.03;
    parts.push(bx("backrest", [0, seatH + backH / 2 + 0.04, zb], [w / 2, backH / 2, 0.03], { mat: "wood" }));
    for (const sx of [-1, 1]) parts.push(bx("strut", [sx * (w / 2 - leg * 2), seatH + 0.02, zb], [leg / 2, 0.05, leg / 2], { mat: "metal" }));
  }
  return defineObject({
    key: "bench", tags: ["prop", "seat"], front: "+z", parts,
    sockets: {
      // (Sitting: the hips here, facing out the front.)
      seat: { kind: "seat", pos: [0, seatH, hasBack ? 0.05 : 0], yaw: 0, extent: [w / 2 - 0.1, seatD / 2 - 0.05] },
      seatLeft: { kind: "seat", pos: [-w / 4, seatH, hasBack ? 0.05 : 0], yaw: 0 },
      seatRight: { kind: "seat", pos: [w / 4, seatH, hasBack ? 0.05 : 0], yaw: 0 },
    },
    meta: { w, seatH, hasBack },
  });
}

function sign(S, ctx = {}) {
  const w = pick(S, ctx.w, 1, 3.2);
  const h = pick(S, ctx.h, 0.6, 1.8);
  const lift = pick(S, ctx.lift, 0.8, 2.2);
  const board = 0.08;
  const twoPosts = chance(S, ctx.twoPosts, 0.6);
  const glow = chance(S, ctx.glow, 0.5);
  const parts = [bx("panel", [0, lift + h / 2, 0], [w / 2, h / 2, board / 2], { mat: "metal" })];
  // (The display: set in the front face.)
  parts.push(bx(glow ? "screen" : "display", [0, lift + h / 2, board / 2 + 0.01], [w / 2 - 0.06, h / 2 - 0.06, 0.012], { mat: glow ? "glow" : "paint", collide: false }));
  const pz = -board / 2 - 0.05;
  const posts = twoPosts ? [-w / 2 + 0.12, w / 2 - 0.12] : [0];
  for (const x of posts) parts.push(cap("post", [x, 0.05, pz], [x, lift + h * 0.9, pz], 0.05, { mat: "metal" }));
  // (A stand's back brace: the post's side.)
  parts.push(bx("stand", [0, 0.04, pz - 0.1], [twoPosts ? w / 2 - 0.05 : 0.3, 0.04, 0.2], { mat: "metal" }));
  return defineObject({
    key: "sign", tags: ["prop", "display"], front: "+z", parts,
    sockets: { face: { kind: "anchor", pos: [0, lift + h / 2, board / 2 + 0.02], yaw: 0, normal: [0, 0, 1], extent: [w / 2 - 0.06, 0] } },
    meta: { w, h, lift, glow },
  });
}

function lampPost(S, ctx = {}) {
  const h = pick(S, ctx.h, 3, 5.5);
  const reach = pick(S, ctx.reach, 0.6, 1.4);
  const r = pick(S, ctx.r, 0.06, 0.1);
  const parts = [
    bx("base", [0, 0.1, 0], [r * 3, 0.1, r * 3], { mat: "metal" }),
    cap("pole", [0, 0.2, 0], [0, h, 0], r, { mat: "metal" }),
    cap("arm", [0, h, 0], [0, h, reach], r * 0.7, { mat: "metal", collide: false }),
    bx("head", [0, h - 0.12, reach], [0.18, 0.1, 0.22], { mat: "metal", collide: false }),
    bx("bulb", [0, h - 0.25, reach], [0.1, 0.04, 0.12], { mat: "glow", collide: false }),
  ];
  return defineObject({
    key: "lampPost", tags: ["prop", "light"], front: "+z", parts,
    sockets: { light: { kind: "anchor", pos: [0, h - 0.3, reach], yaw: 0, normal: [0, -1, 0] } },
    meta: { h, reach },
  });
}

// ---------------------------------------------------------------- the catalogue

/** Every builder: [key, weight, role, build]. Role "level" or "prop". */
export const PIECES = [
  ["pillar", 3, "level", pillar],
  ["wall", 3, "level", wall],
  ["pad", 3, "level", pad],
  ["ramp", 1, "level", ramp],
  ["stairs", 1, "level", stairs],
  ["rail", 2, "level", rail],
  ["arch", 1, "level", arch],
  ["tunnel", 1, "level", tunnel],
  ["crate", 2, "prop", crate],
  ["bench", 2, "prop", bench],
  ["sign", 2, "prop", sign],
  ["lampPost", 2, "prop", lampPost],
];
export const PIECE_KEYS = PIECES.map(([k]) => k);

/**
 * Put the catalogue into a registry as the realm "Objects" (the default
 * registry when none is given). Returns the realm.
 */
export function registerCatalogue(registry = defaultRegistry, realmName = "Objects") {
  const realm = registry.defineRealm(realmName);
  for (const [key, weight, role, build] of PIECES) if (!realm.get(key)) realm.add({ key, weight, role, build });
  return realm;
}

// (A private registry, so the catalogue never depends on what else the default one holds.)
const OWN = createRegistry();
registerCatalogue(OWN);

/**
 * buildPiece(key, seed, ctx) -> a definition, from a seed (bytes32 hex, as
 * everywhere) through the registry's fixed slots: the same seed and key, the
 * same piece, on every machine.
 */
export function buildPiece(key, seed, ctx = {}) {
  if (!PIECE_KEYS.includes(key)) throw new RangeError(`No piece ${key}. Pieces: ${PIECE_KEYS.join(", ")}.`);
  return OWN.makeAsset(seed, { realm: "Objects", key, ctx });
}

/** A builder from a stream you already have (a level's own stream). */
export function buildPieceFrom(key, S, ctx = {}) {
  const e = PIECES.find(([k]) => k === key);
  if (!e) throw new RangeError(`No piece ${key}.`);
  const def = e[3](S, ctx);
  return def;
}

/** A stream for a seed and a label (a level's rooms, a prop set), for buildPieceFrom. */
export const pieceStream = (seed, slot = 1) => stream(createRoll(seed), slot);
