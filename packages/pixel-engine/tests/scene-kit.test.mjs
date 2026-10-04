// src/scene/kit.js against NOCTURNES' kit.js and parts.js: the copied shapes,
// booleans, rotations and bounds must be identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const NOCTURNES = resolve(process.env.NOCTURNES ?? resolve(here, "../../keel-nocturnes"));
const nKit = await import(pathToFileURL(`${NOCTURNES}/src/kit.js`).href);
const nParts = await import(pathToFileURL(`${NOCTURNES}/src/parts.js`).href);
const eKit = await import("../src/scene/kit.js");

function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const exact = (a, b, msg) => { if (!Object.is(a, b)) assert.fail(`${msg}: ${a} !== ${b}`); };

test("kit: rotations, placement and bounds match parts.js / kit.js", () => {
  const r = rand(3);
  for (let i = 0; i < 2000; i += 1) {
    const [yaw, pitch, roll] = [r() * 7 - 3.5, r() * 7 - 3.5, r() * 7 - 3.5];
    const m = nParts.rotation(yaw, pitch, roll);
    assert.deepEqual(eKit.rotation(yaw, pitch, roll), m);
    const m2 = nParts.rotation(pitch, roll, yaw);
    assert.deepEqual(eKit.mat3mul(m, m2), nParts.mat3mul(m, m2));
    const b = [-r(), -r(), -r(), r(), r(), r()];
    const piv = [r() - 0.5, r() - 0.5, r() - 0.5];
    assert.deepEqual(eKit.rotateBounds(b, m, piv), nKit.rotateBounds(b, m, piv));
    const b2 = [r() - 0.5, r() - 0.5, r() - 0.5, r() + 0.5, r() + 0.5, r() + 0.5];
    assert.deepEqual(eKit.unionBounds([b, b2]), nParts.unionBounds([b, b2]));
    assert.deepEqual(eKit.ball(yaw, pitch, roll, 0.3), nParts.ball(yaw, pitch, roll, 0.3));
    exact(eKit.angleOf(yaw, pitch), nParts.angleOf(yaw, pitch), "angleOf");
    const u = [r() - 0.5, r() - 0.5, r() - 0.5];
    const v = [r() - 0.5, r() - 0.5, r() - 0.5];
    const nu = Math.hypot(...u);
    const nv = Math.hypot(...v);
    assert.deepEqual(eKit.rotateOnto(u.map((x) => x / nu), v.map((x) => x / nv)), nKit.rotateOnto(u.map((x) => x / nu), v.map((x) => x / nv)));
  }
});

test("kit: shapes, booleans and placed SDFs match at random points", () => {
  const r = rand(8);
  const build = (K) => {
    const a = K.box([0.1, 0.2, 0], [0.2, 0.15, 0.1], 0.02);
    const c = K.cyl([0, 0.1, 0.05], 0.12, 0.2, "z", 0.01);
    const cx = K.cyl([0, 0, 0], 0.1, 0.3, "x");
    const s = K.sphere([0.05, 0.3, 0], 0.14);
    const e = K.ellipsoid([0, 0.1, 0], [0.2, 0.1, 0.15]);
    const cap = K.capsule([0, 0, 0], [0.2, 0.3, -0.1], 0.05);
    const tor = K.torus([0, 0.2, 0], 0.2, 0.04, "x");
    const torz = K.torus([0, 0.2, 0], 0.2, 0.04, "z");
    const un = K.U(a, s, cap);
    const ct = K.cut(e, s);
    const it = K.inter(a, e);
    const m = nParts.rotation(0.4, -0.3, 0.2);
    const tu = K.turned(un, m, [0.05, 0.1, 0]);
    return [a, c, cx, s, e, cap, tor, torz, un, ct, it, tu];
  };
  const A = build(nKit);
  const B = build(eKit);
  A.forEach((sa, i) => assert.deepEqual(B[i].b, sa.b, `bounds of shape ${i}`));
  const m = nParts.rotation(1.1, 0.2, -0.4);
  const pa = nParts.placed(A[8].f, [0.3, -0.1, 0.2], m);
  const pb = eKit.placed(B[8].f, [0.3, -0.1, 0.2], m);
  const ra = nKit.rotatedSdf(A[9].f, m);
  const rb = eKit.rotatedSdf(B[9].f, m);
  for (let i = 0; i < 20000; i += 1) {
    const [x, y, z] = [r() - 0.5, r() - 0.3, r() - 0.5];
    A.forEach((sa, k) => exact(B[k].f(x, y, z, 0), sa.f(x, y, z, 0), `shape ${k}`));
    exact(pb(x, y, z, 0), pa(x, y, z, 0), "placed");
    exact(rb(x, y, z, 0), ra(x, y, z, 0), "rotatedSdf");
  }
  // lowest(): the marched lowest point of a set of parts.
  const partsN = [{ sdf: A[8].f, bounds: A[8].b }, { sdf: A[11].f, bounds: A[11].b }];
  const partsE = [{ sdf: B[8].f, bounds: B[8].b }, { sdf: B[11].f, bounds: B[11].b }];
  exact(eKit.lowest(partsE), nKit.lowest(partsN), "lowest");
});

test("kit: engine part() takes any material and keeps extra fields", () => {
  const p = eKit.mk(eKit.sphere([0, 0, 0], 1), { name: "ball", mat: "rubber", accent: 1 }, { rubber: { albedo: 0.26 } });
  assert.equal(p.name, "ball");
  assert.equal(p.accent, 1);
  assert.deepEqual(p.m, { albedo: 0.26 });
  assert.deepEqual(p.bounds, [-1, -1, -1, 1, 1, 1]);
  assert.equal(p.sdf(2, 0, 0), 1);
  const q = eKit.mk(eKit.box([0, 0, 0], [1, 1, 1], 0), { mat: "whatever" });
  assert.deepEqual(q.m, {});
  assert.throws(() => eKit.part({ sdf: () => 0 }));
  const l = eKit.lathePart({ points: [[0, 0], [0.3, 0], [0.3, 0.5], [0, 0.5]], round: 0, mat: "x" });
  assert.deepEqual(l.bounds, [-0.3, 0, -0.3, 0.3, 0.5, 0.3]);
  assert.ok(Math.abs(l.sdf(0.5, 0.25, 0) - 0.2) < 1e-9);
});
