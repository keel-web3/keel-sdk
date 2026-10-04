// src/scene/front.js: fronts found from what things are made of, at any yaw.

import { test } from "node:test";
import assert from "node:assert/strict";
import { localToWorld, wrapAngle } from "../src/core/frame.js";
import { createEntity } from "../src/scene/entity.js";
import { box, capsule, lathePart, mk, sphere, torus } from "../src/scene/kit.js";
import { toPart } from "../src/object/prims.js";
import { angleBetween, defineFeature, detectFront, featureOf, FEATURES, frontEvidence, parseFront } from "../src/scene/front.js";

const YAWS = Array.from({ length: 16 }, (_, k) => wrapAngle(0.1 + (k * 2 * Math.PI) / 16));
const DEG = Math.PI / 180;

// ---- synthetic things, built facing +z (as raw boxes/capsules: { c, h } / { a, b, r }, and names)

const tvBoxes = () => [
  { name: "cabinet", c: [0, 0.45, 0], h: [0.5, 0.4, 0.35] },
  { name: "screen", c: [0, 0.5, 0.36], h: [0.38, 0.28, 0.015] },
  { name: "knob", c: [0.42, 0.3, 0.36], h: [0.03, 0.03, 0.02] },
];
const chairBoxes = () => [
  { name: "seat", c: [0, 0.45, 0], h: [0.24, 0.03, 0.24] },
  { name: "backrest", c: [0, 0.8, -0.22], h: [0.24, 0.32, 0.03] },
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => ({ name: "leg", c: [x * 0.2, 0.21, z * 0.2], h: [0.02, 0.21, 0.02] })),
];
const speakerParts = () => [
  { name: "cabinet", c: [0, 0.6, 0], h: [0.25, 0.6, 0.22] },
  { name: "cone", a: [0, 0.45, 0.2], b: [0, 0.45, 0.225], r: 0.14 },
  { name: "tweeter", a: [0, 0.95, 0.2], b: [0, 0.95, 0.225], r: 0.05 },
];
const doorBox = () => [
  { name: "cabinet", c: [0, 0.8, 0], h: [0.45, 0.8, 0.3] },
  { name: "door", c: [0, 0.8, 0.31], h: [0.4, 0.72, 0.012] },
  { name: "handle", c: [0.3, 0.8, 0.33], h: [0.015, 0.08, 0.015] },
];
const faceParts = () => [
  mk(sphere([0, 1.5, 0], 0.2), { name: "head" }),
  mk(sphere([-0.07, 1.55, 0.17], 0.035), { name: "left eye" }),
  mk(sphere([0.07, 1.55, 0.17], 0.035), { name: "right eye" }),
  mk(capsule([0, 1.52, 0.18], [0, 1.47, 0.22], 0.025), { name: "nose" }),
  mk(box([0, 1.4, 0.18], [0.06, 0.012, 0.02]), { name: "mouth" }),
  mk(capsule([0, 0.8, 0], [0, 1.3, 0], 0.15), { name: "body" }),
];
const vaseParts = () => [lathePart({ name: "vase", points: [[0.18, 0], [0.32, 0.25], [0.3, 0.5], [0.14, 0.85], [0.18, 1]] })];
const ballParts = () => [mk(sphere([0, 0.4, 0], 0.4), { name: "ball" })];
const tableParts = () => [
  mk(box([0, 0.72, 0], [0.8, 0.03, 0.5]), { name: "top" }),
  ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => mk(box([x * 0.72, 0.35, z * 0.42], [0.03, 0.35, 0.03]), { name: "leg" })),
];

// Raw world-space solids turned by yaw about the origin (no transform: detection measures them where they are).
const turnRaw = (list, yaw) => list.map((p) => (p.c
  ? { ...p, c: localToWorld([0, 0, 0], yaw, p.c), yaw: wrapAngle(yaw + (p.yaw ?? 0)) }
  : { ...p, a: localToWorld([0, 0, 0], yaw, p.a), b: localToWorld([0, 0, 0], yaw, p.b) }));

const CASES = [
  ["TV with a screen", tvBoxes, 0.8],
  ["chair with a backrest", chairBoxes, 0.8],
  ["speaker with a cone", speakerParts, 0.7],
  ["box with a door", doorBox, 0.8],
];

for (const [name, make, minConf] of CASES) {
  test(`front: ${name}, as an entity at 16 yaws (exact)`, () => {
    const base = detectFront({ boxes: make().filter((p) => p.c), capsules: make().filter((p) => p.a) });
    assert.ok(angleBetween(base.yaw, 0) < 5 * DEG, `faces +z: ${base.yaw}`);
    assert.ok(base.confidence >= minConf, `confident: ${base.confidence}\n${base.why.join("\n")}`);
    assert.equal(base.symmetric, false);
    for (const yaw of YAWS) {
      const e = createEntity({ id: name, transform: { pos: [3, 0, -2], yaw }, parts: make().map(toPartSpec).map(toPart) });
      const r = detectFront(e);
      // (The same parts in their own frame: the answer turns exactly with the thing.)
      assert.ok(angleBetween(r.yaw, yaw + base.yaw) < 1e-9, `${name} at ${yaw}: ${r.yaw}`);
      assert.ok(Math.abs(r.dir[0] - Math.sin(yaw + base.yaw)) < 1e-9 && Math.abs(r.dir[2] - Math.cos(yaw + base.yaw)) < 1e-9);
      assert.ok(Math.abs(r.confidence - base.confidence) < 1e-12);
    }
  });

  test(`front: ${name}, as raw world boxes turned to 16 yaws`, () => {
    for (const yaw of YAWS) {
      const parts = turnRaw(make(), yaw);
      const r = detectFront({ boxes: parts.filter((p) => p.c), capsules: parts.filter((p) => p.a) });
      assert.ok(angleBetween(r.yaw, yaw) < 12 * DEG, `${name} at ${(yaw / DEG).toFixed(0)}°: ${(r.yaw / DEG).toFixed(1)}°\n${r.why.join("\n")}`);
      assert.ok(r.confidence >= minConf * 0.9, `${name} at ${yaw}: ${r.confidence}`);
    }
  });
}

// (Raw specs -> part specs for createEntity: toPart does the rest.)
function toPartSpec(p) {
  if (p.box || p.capsule) return p;
  return p.c ? { box: { c: p.c, h: p.h }, name: p.name } : { capsule: { a: p.a, b: p.b, r: p.r }, name: p.name };
}

test("front: a face (eyes, nose, mouth) at 16 yaws", () => {
  for (const yaw of YAWS) {
    const r = detectFront(createEntity({ id: "face", transform: { yaw }, parts: faceParts() }));
    assert.ok(angleBetween(r.yaw, yaw) < 1e-9, `face at ${yaw}: ${r.yaw}`);
    assert.ok(r.confidence > 0.8, `${r.confidence}\n${r.why.join("\n")}`);
    assert.deepEqual(r.layers.features.words.sort(), ["eye", "mouth", "nose"]);
  }
});

test("front: symmetric things come back symmetric, with low confidence -- not a made-up answer", () => {
  for (const [name, make, kind] of [["vase", vaseParts, "round"], ["ball", ballParts, "round"], ["table", tableParts, "mirror"]]) {
    for (const yaw of YAWS.slice(0, 4)) {
      const r = detectFront(createEntity({ id: name, transform: { yaw }, parts: make() }));
      assert.equal(r.symmetric, true, `${name} symmetric`);
      assert.equal(r.symmetry, kind, `${name} is ${kind}, got ${r.symmetry}`);
      assert.ok(r.confidence <= 0.15, `${name} confidence ${r.confidence}`);
      assert.equal(r.declared, false);
    }
  }
  // (A plain box: mirror-symmetric; its front lies along one of its axes.)
  const plain = detectFront({ boxes: [{ c: [0, 0.5, 0], h: [1, 0.5, 0.3] }] });
  assert.equal(plain.symmetric, true);
  assert.ok(angleBetween(plain.axisYaw, 0) < 1e-6 || angleBetween(plain.axisYaw, Math.PI) < 1e-6, `square to the long side: ${plain.axisYaw}`);
});

test("front: a declared front wins, and is checked against the evidence", () => {
  const good = detectFront({ boxes: tvBoxes(), front: "+z" });
  assert.equal(good.declared, true);
  assert.equal(good.agrees, true);
  assert.ok(good.confidence >= 0.9);
  const bad = detectFront({ boxes: tvBoxes(), front: "-z" });
  assert.equal(bad.agrees, false, "a TV declared to face away from its screen");
  assert.ok(angleBetween(bad.yaw, Math.PI) < 1e-12, "the declaration still wins");
  assert.ok(angleBetween(bad.detected.yaw, 0) < 5 * DEG, "the evidence is reported");
  assert.ok(bad.confidence <= 0.5);
  assert.ok(bad.why[0].includes("DISAGREES"));
  // (Nothing to check it against: can't tell.)
  const vase = detectFront({ parts: vaseParts(), front: Math.PI / 2 });
  assert.equal(vase.agrees, null);
  assert.ok(angleBetween(vase.yaw, Math.PI / 2) < 1e-12);
  // (A declared front on an instance turns with it.)
  for (const yaw of YAWS) {
    const e = createEntity({ id: "tv", transform: { yaw }, parts: tvBoxes().map(toPartSpec).map(toPart) });
    const r = detectFront({ ...e, front: "+x" });
    assert.ok(angleBetween(r.yaw, yaw + Math.PI / 2) < 1e-9);
    assert.equal(r.agrees, false);
  }
  // (NOCTURNES' facing flag reads as "+z".)
  assert.equal(detectFront({ boxes: tvBoxes(), facing: true }).agrees, true);
});

test("front: spellings of a front", () => {
  assert.equal(parseFront("+z"), 0);
  assert.ok(Math.abs(parseFront("-z") - Math.PI) < 1e-12);
  assert.ok(Math.abs(parseFront("+x") - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(parseFront([0, 0, -1]) - Math.PI) < 1e-12);
  assert.ok(Math.abs(parseFront({ yaw: 0.5 }) - 0.5) < 1e-12);
  assert.equal(parseFront(null), null);
  assert.throws(() => parseFront("up"));
  assert.throws(() => parseFront([0, 1, 0]));
});

test("front: the vocabulary reads names, camelCase and plurals, and can be extended", () => {
  assert.equal(featureOf({ name: "leftEye" }).word, "eye");
  assert.equal(featureOf({ name: "Knobs" }).word, "knob");
  assert.equal(featureOf({ name: "tweeter" }).side, "front");
  assert.equal(featureOf({ name: "backrest" }).side, "back");
  assert.equal(featureOf({ name: "panel", mat: "screen" }).word, "mat:screen");
  assert.equal(featureOf({ name: "porthole" }), null);
  const ship = [{ name: "hull", c: [0, 0.5, 0], h: [0.4, 0.5, 0.4] }, { name: "porthole", a: [0, 0.6, 0.4], b: [0, 0.6, 0.42], r: 0.12 }];
  assert.equal(detectFront({ boxes: [ship[0]], capsules: [ship[1]] }).symmetric, true, "unnamed: no front");
  // (Per call, without touching the table...)
  const once = detectFront({ boxes: [ship[0]], capsules: [ship[1]] }, { features: { porthole: { side: "front", weight: 1 } } });
  assert.ok(angleBetween(once.yaw, 0) < 5 * DEG && once.confidence > 0.6);
  assert.equal(FEATURES.has("porthole"), false);
  // (...or for good.)
  defineFeature("porthole", { side: "front", weight: 1 });
  try {
    assert.ok(angleBetween(detectFront({ boxes: [ship[0]], capsules: [ship[1]] }).yaw, 0) < 5 * DEG);
  } finally { FEATURES.delete("porthole"); }
});

test("front: use cases -- a seat faces out from its backrest, a screen away from its stand", () => {
  // (No named face: only the seat and the back say where it looks.)
  const stool = [{ name: "seat", c: [0, 0.45, 0.05], h: [0.2, 0.03, 0.2] }, { name: "back", c: [0, 0.75, -0.17], h: [0.2, 0.3, 0.03] }];
  const r = detectFront({ boxes: stool });
  assert.ok(r.layers.useCase && angleBetween(r.layers.useCase.yaw, 0) < 1e-6, JSON.stringify(r.layers.useCase));
  assert.ok(angleBetween(r.yaw, 0) < 5 * DEG);
  const mon = [{ name: "stand", c: [0, 0.03, -0.1], h: [0.15, 0.03, 0.12] }, { name: "neck", c: [0, 0.25, -0.12], h: [0.03, 0.2, 0.02] }, { name: "panel", c: [0, 0.55, -0.05], h: [0.4, 0.25, 0.02] }];
  const m = detectFront({ boxes: mon });
  assert.ok(angleBetween(m.yaw, 0) < 10 * DEG, `${m.yaw}\n${m.why.join("\n")}`);
});

test("front: geometry alone finds an unnamed chair's opening, at low confidence", () => {
  const unnamed = chairBoxes().map((p, i) => ({ ...p, name: `part${i}` }));
  const r = detectFront({ boxes: unnamed });
  assert.equal(r.layers.features, null);
  assert.equal(r.layers.useCase, null);
  assert.ok(r.confidence < 0.6, "geometry alone is never sure");
});

test("front: deterministic, and evidence can be reused across placements", () => {
  const a = detectFront({ parts: faceParts() });
  const b = detectFront({ parts: faceParts() });
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const E = frontEvidence(faceParts());
  for (const yaw of YAWS.slice(0, 3)) {
    const r = detectFront(createEntity({ id: "f", transform: { yaw }, parts: faceParts() }), { evidence: E });
    assert.ok(angleBetween(r.yaw, yaw + E.yaw) < 1e-12);
  }
});

test("front: a torus-ringed speaker cone on a round cabinet still reads as front", () => {
  const parts = [
    mk(sphere([0, 0.5, 0], 0.45), { name: "cabinet" }),
    mk(torus([0, 0.5, 0.43], 0.12, 0.03, "z"), { name: "cone" }),
  ];
  for (const yaw of YAWS.slice(0, 4)) {
    const r = detectFront(createEntity({ id: "pod", transform: { yaw }, parts }));
    assert.ok(angleBetween(r.yaw, yaw) < 1e-9);
    assert.equal(r.symmetric, false, "a round body with a cone is not round any more");
    assert.ok(r.confidence > 0.6, `${r.confidence}`);
  }
});
