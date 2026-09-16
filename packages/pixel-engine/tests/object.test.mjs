// src/object: definitions, placement, colliders, sockets, resting, baking, the catalogue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { localToWorld, wrapAngle } from "../src/core/frame.js";
import { seedFromToken } from "../src/core/rng.js";
import { distance } from "../src/scene/bounds.js";
import { createRegistry } from "../src/scene/registry.js";
import { toWorld } from "../src/scene/entity.js";
import { mk, sphere } from "../src/scene/kit.js";
import { angleBetween, detectFront } from "../src/scene/front.js";
import { boxDistance, createCharacter } from "../src/physics/character.js";
import {
  bakeForPhysics, bakeForRenderer, bottomOf, defineObject, footprint, frontOfObject, onSocket, placeObject,
  restsOn, settle, socketOf, socketsOfKind, topsOf, worldAabb, worldColliders, worldRails, worldSockets, yawToShow,
} from "../src/object/object.js";
import { buildPiece, buildPieceFrom, PIECE_KEYS, pieceStream, registerCatalogue } from "../src/object/catalogue.js";

const YAWS = Array.from({ length: 16 }, (_, k) => wrapAngle(0.1 + (k * 2 * Math.PI) / 16));
const near = (a, b, eps = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const nearV = (a, b, eps = 1e-9, msg = "") => a.forEach((v, i) => near(v, b[i], eps, `${msg}[${i}]`));
const SEEDS = [1, 2, 3].map((i) => seedFromToken(i, "objects"));

// A tiny hand-made object: a desk with a lamp's pole on it.
const desk = () => defineObject({
  key: "desk", front: "+z", tags: ["prop"],
  parts: [
    { box: { c: [0, 0.72, 0], h: [0.6, 0.03, 0.35] }, name: "top", mat: "wood" },
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => ({ box: { c: [x * 0.55, 0.345, z * 0.3], h: [0.03, 0.345, 0.03] }, name: "leg", mat: "wood" })),
    { box: { c: [0, 0.9, -0.3], h: [0.6, 0.15, 0.02] }, name: "back", mat: "wood" },
    { capsule: { a: [-0.5, 0.75, -0.2], b: [-0.5, 1.2, -0.2], r: 0.02 }, name: "pole", mat: "metal" },
    { box: { c: [0.1, 0.8, 0.36], h: [0.3, 0.05, 0.01] }, name: "drawer", mat: "wood", collide: false },
  ],
  sockets: { seat: { kind: "seat", pos: [0, 0.45, 0.6], yaw: Math.PI } },
});

test("object: a definition keeps its parts, colliders, bounds, front and sockets", () => {
  const d = desk();
  assert.equal(d.kind, "object");
  assert.equal(d.parts.length, 8);
  assert.equal(d.front, 0);
  // (Box parts -> their boxes; the capsule -> a box along it; collide:false -> none.)
  assert.equal(d.colliders.length, 7);
  const pole = d.colliders.find((c) => c.part === "pole");
  nearV(pole.h, [0.02, 0.225 + 0.02, 0.02], 1e-12);
  nearV(d.bounds, [-0.6, 0, -0.35, 0.6, 1.22, 0.37], 1e-12);
  assert.ok(d.sockets.top && d.sockets.top.auto, "a free top found");
  near(d.sockets.top.pos[1], 0.75, 1e-12, "the biggest free top: the desk's");
  assert.ok(d.sockets.view, "a view point in front");
  assert.ok(d.sockets.view.pos[2] > d.bounds[5] && angleBetween(d.sockets.view.yaw, Math.PI) < 1e-12, "looking back at it");
  assert.throws(() => defineObject({ key: "x", parts: [] }));
  assert.throws(() => defineObject({ key: "x", parts: [{ box: { c: [0, 0, 0], h: [1, 1, 1] } }], rest: "sit" }));
  assert.throws(() => defineObject({ key: "x", parts: [{ name: "?" }] }));
});

test("object: tops of boxes nothing sits on", () => {
  const tops = topsOf(desk().parts);
  assert.equal(tops[0].part, "top");
  assert.ok(!tops.some((t) => t.part === "back"), "a panel 4 cm thick is a sliver, not a shelf");
  assert.ok(!tops.some((t) => t.part === "leg"), "legs are covered by the top");
  assert.ok(!tops.some((t) => t.part === "pole"), "a pole's end is not a top");
});

test("object: placement -- world bounds, footprint, colliders and sockets move with the instance", () => {
  const d = desk();
  for (const yaw of YAWS) {
    const inst = placeObject(d, { pos: [4, 1, -3], yaw, scale: 1.5 });
    assert.equal(inst.key, "desk");
    assert.ok(inst.tags.includes("prop"));
    const cs = worldColliders(inst);
    d.colliders.forEach((b, i) => {
      nearV(cs[i].c, localToWorld([4, 1, -3], yaw, b.c.map((v) => v * 1.5)), 1e-9);
      nearV(cs[i].h, b.h.map((v) => v * 1.5), 1e-12);
      near(angleBetween(cs[i].yaw, yaw + b.yaw), 0, 1e-9);
    });
    const s = socketOf(inst, "seat");
    nearV(s.pos, toWorld(inst, [0, 0.45, 0.6]), 1e-9);
    near(angleBetween(s.yaw, yaw + Math.PI), 0, 1e-9);
    nearV(s.dir, [Math.sin(s.yaw), 0, Math.cos(s.yaw)], 1e-12);
    const top = socketOf(inst, "top");
    nearV(top.extent, d.sockets.top.extent.map((v) => v * 1.5), 1e-12);
    assert.equal(Object.keys(worldSockets(inst)).length, Object.keys(d.sockets).length);
    assert.equal(socketsOfKind(inst, "seat").length, 1);
    // (A point on the top, turned with it, is on it; a hand off the edge is not.)
    const onTop = toWorld(inst, [top.extent[0] / 1.5 * 0.5, d.sockets.top.pos[1], d.sockets.top.pos[2]]);
    assert.ok(onSocket(inst, "top", onTop));
    assert.ok(!onSocket(inst, "top", toWorld(inst, [2, d.sockets.top.pos[1], d.sockets.top.pos[2]])));
    // (The footprint is the local box turned -- an oriented rectangle holding everything the world box does.)
    const fp = footprint(inst);
    assert.equal(fp.corners.length, 4);
    near(Math.hypot(fp.corners[1][0] - fp.corners[0][0], fp.corners[1][1] - fp.corners[0][1]), 1.2 * 1.5, 1e-9);
    const w = worldAabb(inst);
    assert.ok(fp.rect[0] <= w[0] + 1e-9 && fp.rect[2] >= w[3] - 1e-9 && fp.rect[1] <= w[2] + 1e-9 && fp.rect[3] >= w[5] - 1e-9);
    // (The front turns with it.)
    const f = frontOfObject(inst);
    near(angleBetween(f.yaw, yaw), 0, 1e-9);
  }
});

test("object: colliders match their parts (physics' boxDistance == the parts' SDF)", () => {
  for (const key of ["pillar", "wall", "pad", "ramp", "stairs", "arch", "tunnel"]) {
    for (const seed of SEEDS) {
      const def = buildPiece(key, seed);
      for (const yaw of [0.3, 2.2]) {
        const inst = placeObject(def, { pos: [1, 0.5, 2], yaw });
        const boxes = worldColliders(inst);
        const b = worldAabb(inst);
        const size = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        // (Deterministic probe points round and through it.)
        for (let i = 0; i < 60; i += 1) {
          const u = [((i * 0.618034) % 1), ((i * 0.381966 + 0.2) % 1), ((i * 0.7548776 + 0.5) % 1)];
          const p = [b[0] - 0.2 * size + u[0] * 1.4 * size, b[1] - 0.2 * size + u[1] * 1.4 * size, b[2] - 0.2 * size + u[2] * 1.4 * size];
          const phys = Math.min(...boxes.map((q) => boxDistance(p, q).d));
          const sdf = distance(inst, p);
          // (Outside, a union of boxes and the min of their distances agree exactly; inside, the min is a bound.)
          if (sdf > 0) near(phys, sdf, 1e-9, `${key} at ${p}`);
          else assert.ok(phys <= 1e-9, `${key}: inside the parts, inside a collider`);
        }
      }
    }
  }
});

test("object: settle leaves no gap, and nothing floats", () => {
  const pad = placeObject(buildPiece("pad", SEEDS[0]), { pos: [0, 0, 0] });
  const top = worldColliders(pad)[0].c[1] + worldColliders(pad)[0].h[1];
  for (const [i, yaw] of YAWS.entries()) {
    const crate = placeObject(buildPiece("crate", SEEDS[i % 3]), { pos: [0.3, 2 + i * 0.1, -0.2], yaw });
    const r = settle(crate, [pad, 0]);
    assert.equal(r.rests, true);
    assert.equal(r.support, pad.id);
    near(r.gap, 2 + i * 0.1 - top, 1e-9, "the gap it had");
    const bottom = r.instance.transform.pos[1] + bottomOf(r.instance.def);
    near(bottom, top, 1e-9, "on the pad, exactly");
    assert.ok(restsOn(r.instance, pad));
    assert.ok(!restsOn(crate, pad), "not before");
    nearV([r.instance.transform.pos[0], r.instance.transform.pos[2]], [0.3, -0.2], 0, "straight down");
    near(r.instance.transform.yaw, crate.transform.yaw, 0);
  }
  // Sunk a little into it: it comes up (within stepUp).
  const sunk = settle(placeObject(buildPiece("crate", SEEDS[1]), { pos: [0, top - 0.03, 0] }), [pad]);
  near(sunk.gap, -0.03, 1e-9);
  assert.ok(restsOn(sunk.instance, pad));
  // Off every support and no floor: left where it is, not resting.
  const off = settle(placeObject(buildPiece("crate", SEEDS[1]), { pos: [50, 3, 0] }), [pad]);
  assert.equal(off.rests, false);
  assert.equal(off.gap, null);
  // With a floor: it drops to it.
  const floor = settle(placeObject(buildPiece("crate", SEEDS[1]), { pos: [50, 3, 0] }), [pad, { y: -1 }]);
  near(floor.instance.transform.pos[1], -1, 1e-9);
  // The highest support under it wins: a crate on a crate on the pad.
  const low = settle(placeObject(buildPiece("crate", SEEDS[2]), { pos: [0, 5, 0] }), [pad]).instance;
  const up = settle(placeObject(buildPiece("crate", SEEDS[0]), { pos: [0.05, 9, 0.02], yaw: 0.4 }), [pad, low]);
  assert.equal(up.support, low.id);
  near(up.instance.transform.pos[1], low.transform.pos[1] + low.def.bounds[4], 1e-9);
  // A hanging sign needs no support.
  const sign = defineObject({ key: "hung", rest: "hang", parts: [{ box: { c: [0, 0, 0], h: [0.5, 0.3, 0.02] } }] });
  assert.equal(settle(placeObject(sign, { pos: [0, 3, 0] }), []).rests, true);
});

test("object: settle finds an SDF object's true lowest point", () => {
  const ball = defineObject({ key: "ball", parts: [mk(sphere([0, 0.5, 0], 0.3), { name: "ball" })] });
  near(bottomOf(ball), 0.2, 2e-3);
  const r = settle(placeObject(ball, { pos: [0, 1, 0] }), [0]);
  near(r.instance.transform.pos[1] + 0.2, 0, 2e-3);
});

test("object: baking for the renderer and for physics", () => {
  const rail = placeObject(buildPiece("rail", SEEDS[0]), { pos: [0, 0, 5], yaw: 0.5 });
  const lamp = placeObject(buildPiece("lampPost", SEEDS[1]), { pos: [3, 0, 0], yaw: -1 });
  const mats = { wall: 0, floor: 1, rail: 2, metal: 3, glow: 4 };
  const r = bakeForRenderer([rail, lamp], { mats });
  const nCaps = [rail, lamp].reduce((s, i) => s + i.def.parts.filter((p) => p.prim?.type === "capsule").length, 0);
  const nBoxes = [rail, lamp].reduce((s, i) => s + i.def.parts.filter((p) => p.prim?.type === "box").length, 0);
  assert.equal(r.capsules.length, nCaps);
  assert.equal(r.boxes.length, nBoxes);
  assert.equal(r.skipped.length, 0);
  assert.ok(r.capsules.some((c) => c.mat === 2) && r.boxes.some((b) => b.mat === 4));
  // (A capsule's ends go through the instance.)
  const p0 = rail.def.parts[0].prim;
  nearV(r.capsules[0].a, toWorld(rail, p0.a), 1e-12);
  // Physics: the rail's line in the world, the lamp's solid pole and base.
  const ph = bakeForPhysics([rail, lamp], { mats });
  assert.equal(ph.rails.length, 1);
  nearV(ph.rails[0][0], toWorld(rail, rail.def.rails[0][0]), 1e-12);
  nearV(worldRails(rail)[0].at(-1), toWorld(rail, rail.def.rails[0].at(-1)), 1e-12);
  assert.equal(ph.boxes.length, lamp.def.colliders.length);
  // An SDF part: skipped, or drawn as its bounds when asked.
  const blob = placeObject(defineObject({ key: "blob", parts: [mk(sphere([0, 1, 0], 1), { name: "blob", mat: "glow" })] }));
  assert.equal(bakeForRenderer([blob]).skipped.length, 1);
  assert.equal(bakeForRenderer([blob], { bounds: true, mats }).boxes[0].mat, 4);
});

test("object: a character lands on a baked pad and walks up baked stairs", () => {
  const pad = placeObject(buildPiece("pad", SEEDS[0], { w: 8, d: 8, h: 0.4 }), { pos: [0, 0, 0] });
  const stairs = placeObject(buildPiece("stairs", SEEDS[1], { steps: 6, rise: 0.15, tread: 0.3, w: 2 }), { pos: [0, 0.4, 1.5], yaw: Math.PI });
  const { boxes } = bakeForPhysics([pad, stairs]);
  const body = createCharacter({ boxes, spawn: [0, 2, -2], waterY: -10 });
  for (let i = 0; i < 90; i += 1) body.step(1 / 60, { move: [0, 0] });
  assert.equal(body.mode, "ground");
  near(body.pos[1], 0.4, 0.05, "on the pad's top");
  // (The stairs face -z at yaw PI: their foot is at the pad's middle; walk +z up them.)
  const foot = socketOf(stairs, "foot");
  assert.ok(Math.abs(Math.cos(foot.yaw) - 1) < 1e-9, "the foot faces +z: up the stairs is +z");
  let high = 0;
  for (let i = 0; i < 150 && body.pos[2] < 2.2; i += 1) { body.step(1 / 60, { move: [0, 0.5] }); high = Math.max(high, body.pos[1]); }
  assert.ok(high > 0.4 + 0.15 * 4, `climbed: ${high}`);
});

test("object: the catalogue -- every piece, deterministic, fronts declared and never contradicted", () => {
  assert.deepEqual(PIECE_KEYS, ["pillar", "wall", "pad", "ramp", "stairs", "rail", "arch", "tunnel", "crate", "bench", "sign", "lampPost"]);
  for (const key of PIECE_KEYS) {
    for (const seed of SEEDS) {
      const a = buildPiece(key, seed);
      const b = buildPiece(key, seed);
      assert.equal(a.key, key);
      assert.equal(a.realm, "Objects");
      assert.deepEqual(a.colliders, b.colliders, `${key}: same seed, same piece`);
      assert.deepEqual(a.meta, b.meta);
      assert.equal(a.front, 0, `${key} declares +z`);
      const f = detectFront(a);
      assert.notEqual(f.agrees, false, `${key}: its parts contradict its front\n${f.why.join("\n")}`);
    }
    assert.notDeepEqual(buildPiece(key, SEEDS[0]).meta, buildPiece(key, SEEDS[1]).meta, `${key}: seeds differ`);
  }
  // (Things with a face say so: the check is real for them.)
  for (const key of ["sign", "lampPost", "crate"]) assert.equal(detectFront(buildPiece(key, SEEDS[0])).agrees, true, key);
  const benchWithBack = SEEDS.map((s) => buildPiece("bench", s)).find((d) => d.meta.hasBack);
  assert.equal(detectFront(benchWithBack).agrees, true);
  // ctx sizes win, and the draws still happen (so later draws are unchanged).
  const S1 = pieceStream(SEEDS[0]);
  const S2 = pieceStream(SEEDS[0]);
  const w1 = buildPieceFrom("wall", S1);
  const w2 = buildPieceFrom("wall", S2, { length: 30 });
  near(w2.meta.length, 30, 0);
  near(w2.meta.h, w1.meta.h, 0);
  near(S1.f(), S2.f(), 0, "the stream stays in step");
  assert.throws(() => buildPiece("sofa", SEEDS[0]));
});

test("object: the bench's seat faces where the bench does, at every yaw", () => {
  const d = SEEDS.map((s) => buildPiece("bench", s)).find((q) => q.meta.hasBack);
  for (const yaw of YAWS) {
    const inst = placeObject(d, { pos: [2, 0, 1], yaw });
    const seat = socketOf(inst, "seat");
    const f = detectFront(inst);
    near(angleBetween(seat.yaw, f.yaw), 0, 1e-9);
    near(angleBetween(f.detected.yaw, yaw), 0, 0.1);
  }
});

test("object: the catalogue registers into any registry as a realm", () => {
  const reg = createRegistry();
  const realm = registerCatalogue(reg);
  assert.deepEqual(realm.keys(), PIECE_KEYS);
  const a = reg.makeAsset(SEEDS[0], { realm: "Objects", key: "sign" });
  assert.deepEqual(a.meta, buildPiece("sign", SEEDS[0]).meta);
  assert.equal(realm.pool("prop").length, 4);
});

test("object: turning a thing to show a viewer its front (or its declared show side)", () => {
  const tv = defineObject({ key: "tv", front: "+z", parts: [{ box: { c: [0, 0.4, 0], h: [0.4, 0.3, 0.3] }, name: "cabinet" }, { box: { c: [0, 0.45, 0.31], h: [0.3, 0.2, 0.01] }, name: "screen" }] });
  const pig = defineObject({ key: "pig", front: "+x", show: 0.6, parts: [{ box: { c: [0, 0.3, 0], h: [0.4, 0.2, 0.2] }, name: "body" }, { box: { c: [0.42, 0.35, 0], h: [0.02, 0.05, 0.05] }, name: "snout" }] });
  assert.equal(detectFront(pig).agrees, true, "its front is its snout");
  for (const yaw of YAWS) {
    const eye = [Math.sin(yaw) * 6, 1.5, Math.cos(yaw) * 6];
    const pos = [0.5, 0, -0.3];
    const t = placeObject(tv, { pos, yaw: yawToShow(tv, pos, eye) });
    near(angleBetween(detectFront(t).detected.yaw, Math.atan2(eye[0] - pos[0], eye[2] - pos[2])), 0, 0.05, "the screen to the eye");
    const p = placeObject(pig, { pos, yaw: yawToShow(pig, pos, eye) });
    near(angleBetween(p.transform.yaw + 0.6, Math.atan2(eye[0] - pos[0], eye[2] - pos[2])), 0, 1e-9, "its show side to the eye");
  }
  assert.ok(Math.abs(pig.sockets.view.pos[0] - Math.sin(0.6) * Math.hypot(pig.sockets.view.pos[0], pig.sockets.view.pos[2])) < 1e-9, "the view point is on the show side");
});

test("object: WALLRUN's course is built from catalogue pieces, and its props rest on the plaza", async () => {
  const { levelOf, PIECE_MATS } = await import("../projects/wallrun/level.js");
  for (const seed of ["a", "b", "c", "1", "2", "3"]) {
    const L = levelOf(seed);
    // What physics and the renderer get IS the objects, baked.
    const phys = bakeForPhysics(L.objects, { mats: PIECE_MATS });
    assert.deepEqual(L.boxes, phys.boxes);
    assert.deepEqual(L.rails, phys.rails);
    assert.deepEqual(L.capsules, bakeForRenderer(L.objects, { mats: PIECE_MATS }).capsules);
    // The rail: one line, eased -- it leaves and arrives nearly level (a twelfth of the way in, sin^2 has hardly risen).
    const line = L.rails[0];
    const rise = Math.abs(line[6][1] - line[0][1]);
    assert.ok(Math.abs(line[1][1] - line[0][1]) <= 0.08 * rise + 1e-9 && Math.abs(line.at(-1)[1] - line.at(-2)[1]) <= 0.08 * rise + 1e-9);
    // Every prop sits on the plaza, and none overlaps another.
    const plaza = L.objects.filter((o) => o.def.key === "pad").at(-1);
    const props = L.objects.filter((o) => o.def.tags.includes("prop"));
    assert.ok(props.length >= 1, "the plaza is dressed");
    for (const p of props) assert.ok(restsOn(p, plaza), `${p.id} rests on the plaza`);
    for (const p of props) assert.ok(Math.abs(p.transform.pos[0]) >= 3.5, `${p.id} keeps off the runner's line`);
  }
});
