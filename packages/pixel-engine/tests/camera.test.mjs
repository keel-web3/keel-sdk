// Cameras (src/camera/camera.js): the orbit the player turns, the chase the
// attract mode rides, first person, the showcase frame, rails -- all on the
// one frame convention, all stepped, all repeatable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraBasis, frontOf, localToWorld, rightOf, wrapAngle } from "../src/core/frame.js";
import { boxDistance, createCharacter } from "../src/physics/character.js";
import { clearance, createCamera, fovForTarget, frameView, railRig, sphereCast, subjectOf } from "../src/camera/camera.js";
import { createInput } from "../src/input/input.js";

const STEP = 1 / 120;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const flat = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
const YAWS = Array.from({ length: 16 }, (_, i) => -Math.PI + (i + 0.5) * (Math.PI / 8));
const FLOOR = { c: [0, -1, 0], h: [40, 1, 40], mat: 1 };
const subjectAt = (pos, yaw = 0, extra = {}) => ({ pos, yaw, vel: [0, 0, 0], height: 1.1, radius: 0.26, ...extra });
const run = (cam, s, world, n, input = {}) => { for (let i = 0; i < n; i += 1) cam.step(STEP, s, world, input); return cam; };
// Where a world point lands on the picture (-1..1 each way), the renderer's own projection.
function screenOf(view, p, aspect = 1) {
  const { forward, right, up } = cameraBasis(view.eye, view.target);
  const v = sub(p, view.eye);
  const z = dot(v, forward);
  const t = Math.tan(view.fov / 2);
  return [dot(v, right) / (z * t * aspect), dot(v, up) / (z * t), z];
}

test("fovForTarget: 1.15 at 128 and up, tighter below, never under 0.6 of it", () => {
  assert.equal(fovForTarget(128, 128), 1.15);
  assert.equal(fovForTarget(256, 512), 1.15);
  assert.ok(Math.abs(fovForTarget(32, 32) - 1.15 * 0.25 ** 0.3) < 1e-12);
  assert.ok(fovForTarget(8, 8) >= 1.15 * 0.6 - 1e-12);
});

test("orbit: W runs along the camera's yaw (and D to the screen's right) at 16 yaws -- through the real body", () => {
  for (const y of YAWS) {
    const cam = createCamera({ mode: "orbit" });
    const s = subjectAt([0, 0, 0], y);
    run(cam, s, { boxes: [FLOOR] }, 2);
    assert.ok(Math.abs(wrapAngle(cam.yaw - y)) < 1e-9, "a fresh orbit starts behind the subject");
    const seen = flat(cameraBasis(cam.eye, cam.target).forward);
    const right = cameraBasis(cam.eye, cam.target).right;
    for (const [key, want] of [["w", seen], ["d", right], ["s", seen.map((v) => -v)], ["a", right.map((v) => -v)]]) {
      const input = createInput();
      input.key(key, true);
      const it = input.sample(STEP, cam.yaw);
      assert.ok(Math.abs(it.move[0] - want[0]) < 1e-9 && Math.abs(it.move[1] - want[2]) < 1e-9, `${key} at yaw ${y.toFixed(2)}`);
      // And the body goes there.
      const body = createCharacter({ boxes: [FLOOR], rails: [], waterY: -10, spawn: [0, 0.05, 0] });
      for (let i = 0; i < 60; i += 1) body.step(STEP, it);
      assert.ok(dot(flat(body.pos), want) > 0.999, `the body runs where ${key} says`);
    }
  }
});

test("orbit: mouse right turns the view right -- the old screen-right becomes the new forward", () => {
  for (const y of YAWS) {
    const cam = createCamera({ mode: "orbit" });
    const s = subjectAt([0, 0, 0], y);
    const world = { boxes: [FLOOR] };
    run(cam, s, world, 2);
    const before = cameraBasis(cam.eye, cam.target);
    const input = createInput({ sensitivity: 0.01 });
    input.look((Math.PI / 2) / 0.01, 0); // (a quarter turn of mouse to the right)
    const it = input.sample(STEP, cam.yaw);
    assert.ok(it.look[0] > 0, "moving the mouse right is a positive look yaw");
    cam.step(STEP, s, world, it);
    const after = flat(cameraBasis(cam.eye, cam.target).forward);
    assert.ok(dot(after, flat(before.right)) > 0.999, `yaw ${y.toFixed(2)}`);
    // (A small turn right: the new forward leans toward the old right.)
    const cam2 = createCamera({ mode: "orbit" });
    run(cam2, s, world, 2);
    cam2.step(STEP, s, world, { look: [0.05, 0] });
    assert.ok(dot(flat(cameraBasis(cam2.eye, cam2.target).forward), before.right) > 0.04);
  }
});

test("orbit: mouse up looks up; pitch clamps both ways", () => {
  const cam = createCamera({ mode: "orbit", orbit: { minPitch: -1.1, maxPitch: 0.5 } });
  const s = subjectAt([0, 0, 0], 0.3);
  const world = { boxes: [] }; // (open space: nothing pulls the arm in)
  run(cam, s, world, 2);
  const p0 = cam.pitch;
  const input = createInput();
  input.look(0, -40); // (mouse moved up)
  cam.step(STEP, s, world, input.sample(STEP, cam.yaw));
  assert.ok(cam.pitch > p0, "up is up");
  run(cam, s, world, 10, { look: [0, 1] });
  assert.ok(Math.abs(cam.pitch - 0.5) < 1e-9 && Math.abs(cam.rig.pitch - 0.5) < 1e-12);
  run(cam, s, world, 10, { look: [0, -1] });
  assert.ok(Math.abs(cam.pitch + 1.1) < 1e-9 && Math.abs(cam.rig.pitch + 1.1) < 1e-12);
  const inverted = createInput({ invertY: true });
  inverted.look(0, -40);
  assert.ok(inverted.sample(STEP, 0).look[1] < 0, "invert-Y flips it");
});

test("orbit: the subject sits a little below the middle of the picture, the same at 32 pixels as at 128", () => {
  for (const [y, px] of YAWS.map((y, i) => [y, [32, 64, 128, 256][i % 4]])) {
    const cam = createCamera({ mode: "orbit", width: px, height: px });
    const s = subjectAt([2, 0.35, -1], y);
    run(cam, s, { boxes: [] }, 30);
    const [sx, sy, z] = screenOf(cam.view(), [2, 0.35 + 0.55, -1]);
    assert.ok(z > 0 && Math.abs(sx) < 1e-6, "in front, centred across");
    assert.ok(sy < -0.3 && sy > -0.5, `below the middle, not off the bottom, at ${px} px (${sy.toFixed(3)})`);
  }
});

test("sphereCast: a point it returns always has the radius of room", () => {
  const world = { boxes: [FLOOR, { c: [0, 2, 3], h: [2, 2, 0.25], yaw: 0.4 }] };
  for (const y of YAWS) {
    const from = [0, 1, 0];
    const to = [Math.sin(y) * 6, 1.5, Math.cos(y) * 6];
    const t = sphereCast(world, from, to, 0.2);
    const l = Math.hypot(...sub(to, from));
    const p = from.map((v, i) => v + ((to[i] - v) * t) / l);
    assert.ok(clearance(world, p) >= 0.2 - 1e-3);
  }
});

test("orbit: a wall behind pulls the eye in -- never inside a box -- and it eases back out when the wall goes", () => {
  const wall = { c: [0, 2, -1.2], h: [4, 3, 0.3], mat: 0 }; // (just behind a subject facing +z)
  const roof = { c: [5, 1.9, 0], h: [1.5, 0.3, 3], mat: 0 }; // (a low tunnel roof over x = 5)
  const post = { c: [1.4, 1, 1.6], h: [0.3, 1.5, 0.3], yaw: 0.7, mat: 0 };
  const world = { boxes: [FLOOR, wall, roof, post] };
  const R = 0.2;
  for (const [x, z] of [[0, 0], [5, 0], [1.2, 0.8]]) {
    const cam = createCamera({ mode: "orbit" });
    const s = subjectAt([x, 0, z], 0);
    run(cam, s, world, 2);
    // Sweep all the way round and up and down: the eye stays out of every box.
    for (let i = 0; i < 720; i += 1) {
      cam.step(STEP, s, world, { look: [0.02, Math.sin(i * 0.05) * 0.03] });
      for (const b of world.boxes) assert.ok(boxDistance(cam.eye, b).d >= R - 2e-3, `eye in a box at (${x}, ${z}) step ${i}`);
    }
  }
  // Behind the subject, the wall is 1.2 away: the arm is short. Take the wall away: it comes back out, smoothly.
  const cam = createCamera({ mode: "orbit" });
  const s = subjectAt([0, 0, 0], 0);
  run(cam, s, { boxes: [FLOOR, wall] }, 10);
  assert.ok(cam.rig.arm < 2, `pulled in (${cam.rig.arm.toFixed(2)})`);
  let last = cam.rig.arm;
  for (let i = 0; i < 360; i += 1) {
    cam.step(STEP, s, { boxes: [FLOOR] }, {});
    assert.ok(cam.rig.arm >= last - 1e-12, "it never snaps in without a reason");
    assert.ok(cam.rig.arm - last < 0.06, "and eases out rather than jumping");
    last = cam.rig.arm;
  }
  assert.ok(Math.abs(cam.rig.arm - cam.rig.opt.distance) < 0.02, `back out to the full arm (${cam.rig.arm.toFixed(3)})`);
});

test("orbit and chase in a low tunnel: the arm slides back under the roof instead of folding into the head", () => {
  const roof = { c: [0, 2.3, 0], h: [2.6, 0.25, 6], mat: 0 }; // (its underside at 2.05)
  const walls = [{ c: [-2.35, 1, 0], h: [0.25, 1.1, 6] }, { c: [2.35, 1, 0], h: [0.25, 1.1, 6] }];
  const world = { boxes: [FLOOR, roof, ...walls] };
  for (const mode of ["orbit", "chase"]) {
    const cam = createCamera({ mode });
    const s = subjectAt([0, 0, 0], 0, { vel: [0, 0, 6] });
    for (let i = 0; i < 480; i += 1) {
      // (Running through it, hopping now and then.)
      s.pos = [0, Math.max(0, Math.sin(i * 0.02) * 0.7), -4 + i * (6 / 480)];
      cam.step(STEP, s, world);
      for (const b of world.boxes) assert.ok(boxDistance(cam.eye, b).d >= 0.2 - 2e-3, `${mode}: eye in a box at step ${i}`);
      if (i > 60) assert.ok(s.pos[2] - cam.eye[2] > 1.5, `${mode}: still behind at step ${i} (${(s.pos[2] - cam.eye[2]).toFixed(2)})`);
    }
    assert.ok(!cam.hidesSubject);
  }
});

test("orbit: looking up from low, the arm slides along the floor", () => {
  const cam = createCamera({ mode: "orbit", orbit: { maxPitch: 0.9 } });
  const s = subjectAt([0, 0, 0], 0);
  const world = { boxes: [FLOOR] };
  run(cam, s, world, 2);
  run(cam, s, world, 240, { look: [0, 0.05] });
  assert.ok(cam.eye[1] >= 0.2 - 1e-3, "above the floor");
  assert.ok(-cam.eye[2] > 1.5, `and still back behind (${cam.eye[2].toFixed(2)})`);
  assert.ok(cam.pitch > 0, "looking up");
});

test("hidesSubject: first person, or an eye pulled right into the subject's face", () => {
  const cam = createCamera({ mode: "orbit" });
  const s = subjectAt([0, 0, 0], 0);
  const tight = { boxes: [FLOOR, { c: [0, 1.5, -0.55], h: [3, 3, 0.2] }, { c: [0, 1.6, 0], h: [3, 0.3, 3] }] }; // (a wall at its back, a roof just over its head)
  run(cam, s, tight, 10);
  assert.ok(cam.nearSubject < 0.35 && cam.hidesSubject);
  run(cam, s, { boxes: [FLOOR] }, 240);
  assert.ok(!cam.hidesSubject);
});

test("orbit: a shoulder offset puts the subject off to one side", () => {
  const cam = createCamera({ mode: "orbit", orbit: { shoulder: 0.6 } });
  const s = subjectAt([0, 0, 0], 1);
  run(cam, s, { boxes: [] }, 30);
  assert.ok(screenOf(cam.view(), [0, 0.55, 0])[0] < -0.05, "right shoulder: the subject sits left of the middle");
});

test("chase: settles behind the running subject, and swings out over the open side on a wall", () => {
  for (const y of YAWS.filter((_, i) => i % 2 === 0)) {
    const cam = createCamera({ mode: "chase" });
    const f = frontOf(y);
    const s = subjectAt([0, 0, 0], y, { vel: [f[0] * 8, 0, f[2] * 8] });
    // Start it looking the wrong way: the chase must come round.
    run(cam, subjectAt([0, 0, 0], y + 2.5), { boxes: [] }, 1);
    for (let i = 0; i < 480; i += 1) { s.pos = [s.pos[0] + f[0] * 8 * STEP, 0, s.pos[2] + f[2] * 8 * STEP]; cam.step(STEP, s, { boxes: [] }); }
    const back = sub(cam.eye, s.pos);
    assert.ok(dot(back, f) < -2, `behind at yaw ${y.toFixed(2)} (${dot(back, f).toFixed(2)})`);
    assert.ok(Math.abs(dot(back, rightOf(y))) < 0.2, "and square behind");
    assert.ok(dot(sub(cam.target, s.pos), f) > 0, "looking ahead of the run");
  }
  const cam = createCamera({ mode: "chase" });
  const s = subjectAt([0, 0, 0], 0, { vel: [0, 0, 8], mode: "wall", wall: [-1, 0, 0] });
  for (let i = 0; i < 360; i += 1) { s.pos = [0, 0, s.pos[2] + 8 * STEP]; cam.step(STEP, s, { boxes: [] }); }
  assert.ok(cam.eye[0] - s.pos[0] < -1, "out over the side the wall faces");
});

test("frame: the subject's front toward the camera, its bounds inside the picture, at any aspect", () => {
  for (const y of YAWS) {
    for (const turn of [0, 0.45, -0.7]) {
      for (const aspect of [1, 16 / 9, 0.5]) {
        const s = subjectAt([3, 0.2, -2], y, { bounds: [2.6, 0.2, -2.3, 3.4, 1.9, -1.7] });
        const v = frameView(s, { turn, aspect, fov: 1.15, fill: 0.8 });
        assert.ok(dot(frontOf(y), sub(v.eye, s.pos)) > 0, "seen from its front");
        const [x0, y0, z0, x1, y1, z1] = s.bounds;
        let most = 0;
        for (const x of [x0, x1]) for (const yy of [y0, y1]) for (const z of [z0, z1]) {
          const [sx, sy, zz] = screenOf({ ...v, fov: 1.15 }, [x, yy, z], aspect);
          assert.ok(zz > 0 && Math.abs(sx) <= 0.8 + 1e-9 && Math.abs(sy) <= 0.8 + 1e-9, `corner outside at yaw ${y.toFixed(2)} turn ${turn} aspect ${aspect}`);
          most = Math.max(most, Math.abs(sx), Math.abs(sy));
        }
        assert.ok(most > 0.75, "and fitted, not lost in the frame");
      }
    }
  }
});

test("frame: seen from the front, the subject's right hand is on the screen's left (a mirror, as in life)", () => {
  const cam = createCamera({ mode: "frame", frame: { turn: 0, rate: 0 } });
  for (const y of YAWS) {
    const s = subjectAt([0, 0, 0], y);
    cam.rigs.frame.enter();
    cam.step(STEP, s, {});
    const hand = localToWorld(s.pos, y, [0.25, 0.6, 0]);
    assert.ok(screenOf(cam.view(), hand)[0] < 0);
  }
});

test("frame: in a level, a wall in front of the subject brings the shot in (never inside it)", () => {
  const wall = { c: [0, 1.5, 1.2], h: [4, 2, 0.25] }; // (a wall 1.2 in front of a subject facing +z)
  const cam = createCamera({ mode: "frame", frame: { spin: 0.8, rate: 0 } });
  const s = subjectAt([0, 0, 0], 0);
  for (let i = 0; i < 600; i += 1) {
    cam.step(STEP, s, { boxes: [FLOOR, wall] });
    for (const b of [FLOOR, wall]) assert.ok(boxDistance(cam.eye, b).d >= 0.2 - 2e-3);
  }
});

test("frame: a turntable spins about the subject and keeps it in", () => {
  const cam = createCamera({ mode: "frame", frame: { spin: 1.2, rate: 0 } });
  const s = subjectAt([0, 0, 0], 0);
  for (let i = 0; i < 600; i += 1) {
    cam.step(STEP, s, {});
    const [sx, sy] = screenOf(cam.view(), [0, 0.55, 0]);
    assert.ok(Math.abs(sx) < 0.2 && Math.abs(sy) < 0.2);
  }
  assert.ok(Math.abs(cam.rigs.frame.turn - (0.45 + 1.2 * 5)) < 1e-9);
});

test("first person: at the eyes, turned by the look; the subject is hidden", () => {
  const cam = createCamera({ mode: "first" });
  const s = subjectAt([1, 2, 3], 0.8);
  cam.step(STEP, s, {});
  assert.ok(Math.abs(cam.eye[1] - (2 + 1.1 * 0.88)) < 1e-12 && cam.eye[0] === 1 && cam.eye[2] === 3);
  assert.ok(Math.abs(cam.yaw - 0.8) < 1e-9 && cam.hidesSubject);
  cam.step(STEP, s, {}, { look: [0.5, 0] });
  assert.ok(Math.abs(cam.yaw - 1.3) < 1e-9);
});

test("rail: passes through its keys at their times, loops, looks at the subject when a key has no target", () => {
  const keys = [{ at: 0, eye: [0, 2, -5] }, { at: 2, eye: [5, 3, 0], target: [0, 0, 0] }, { at: 4, eye: [0, 2, 5] }];
  const r = railRig({ keys });
  const s = subjectAt([1, 0, 1]);
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(close(r.at(0, s).eye, keys[0].eye) && close(r.at(2, s).eye, keys[1].eye) && close(r.at(4, s).eye, keys[2].eye));
  assert.ok(close(r.at(2, s).target, [0, 0, 0]) && close(r.at(0, s).target, [1, 1.1 * 0.6, 1]));
  assert.ok(close(r.at(6 + 2, s).eye, keys[1].eye), "loops with a period of 6");
  const cam = createCamera({ mode: "rail", rail: { keys } });
  run(cam, s, {}, 240);
  assert.ok(Math.hypot(...sub(cam.eye, keys[1].eye)) < 1e-6, "stepped 2 s along: at the second key");
  const fixed = createCamera({ mode: "fixed", fixed: { eye: [4, 4, 4] } });
  fixed.step(STEP, s, {});
  assert.ok(close(fixed.eye, [4, 4, 4]) && close(fixed.target, [1, 0.66, 1]));
});

test("mode changes blend over ~0.3 s: no jump on the switch, the new rig's view after", () => {
  const cam = createCamera({ mode: "orbit" });
  const s = subjectAt([0, 0, 0], 0.4);
  run(cam, s, { boxes: [] }, 60);
  const before = [...cam.eye];
  cam.setMode("frame");
  cam.step(STEP, s, {});
  assert.ok(Math.hypot(...sub(cam.eye, before)) < 0.05, "continuous at the switch");
  run(cam, s, {}, 36);
  // (Past the blend the camera is the frame rig's own view, which eases to its fit.)
  assert.ok(Math.hypot(...sub(cam.eye, cam.rigs.frame.eye)) < 1e-12);
  assert.throws(() => cam.setMode("nope"));
});

test("shake and thud turn the view and fade; they never move the eye", () => {
  const cam = createCamera({ mode: "orbit" });
  const s = subjectAt([0, 0, 0], 0);
  run(cam, s, { boxes: [] }, 10);
  cam.shake(1).thud(0.08);
  let moved = 0;
  let deepest = 0;
  for (let i = 0; i < 360; i += 1) {
    cam.step(STEP, s, { boxes: [] });
    const v = cam.view();
    assert.deepEqual(v.eye, cam.eye);
    moved = Math.max(moved, Math.hypot(...sub(v.target, cam.target)));
    deepest = Math.min(deepest, cam.nod);
  }
  assert.ok(moved > 0.05, "it shook");
  assert.ok(deepest < -0.06 && deepest > -0.1, `the thud nods about its amount (${deepest.toFixed(3)})`);
  assert.equal(cam.trauma, 0);
  assert.ok(Math.abs(cam.nod) < 1e-3);
});

test("fov: follows the target size, blends, and kicks with speed when asked", () => {
  const cam = createCamera({ mode: "orbit", width: 32, height: 32, fovKick: 0.1 });
  const s = subjectAt([0, 0, 0], 0);
  cam.step(STEP, s, {});
  assert.ok(Math.abs(cam.fov - fovForTarget(32, 32)) < 1e-12);
  s.vel = [0, 0, 14];
  run(cam, s, {}, 240);
  assert.ok(cam.fov > fovForTarget(32, 32) * 1.09);
  cam.setTarget(256, 256);
  s.vel = [0, 0, 0];
  run(cam, s, {}, 600);
  assert.ok(Math.abs(cam.fov - 1.15) < 1e-3);
});

test("determinism: the same steps give the same camera, bit for bit, through every mode", () => {
  const once = () => {
    const cam = createCamera({ mode: "chase", fovKick: 0.08 });
    const body = createCharacter({ boxes: [FLOOR, { c: [3, 2, 6], h: [0.3, 3, 4] }], rails: [], waterY: -10, spawn: [0, 0.1, 0] });
    const world = { boxes: [FLOOR, { c: [3, 2, 6], h: [0.3, 3, 4] }] };
    const trace = [];
    for (let i = 0; i < 1200; i += 1) {
      if (i === 300) cam.setMode("orbit");
      if (i === 600) cam.setMode("first");
      if (i === 800) cam.setMode("frame");
      if (i === 1000) cam.setMode("chase");
      if (i % 97 === 0) cam.shake(0.4).thud(0.03);
      const look = [Math.sin(i * 0.013) * 0.01, Math.cos(i * 0.021) * 0.004];
      body.step(STEP, { move: cam.move(1, Math.sin(i * 0.01)), jump: i % 150 === 0, hold: i % 150 < 40 });
      cam.step(STEP, subjectOf(body), world, { look });
      trace.push(...cam.view().eye, ...cam.view().target, cam.fov);
    }
    return trace;
  };
  assert.deepEqual(once(), once());
});
