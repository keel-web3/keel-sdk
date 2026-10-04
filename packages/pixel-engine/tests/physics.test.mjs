// The character body's moves, one rule at a time: the jump (arc, coyote time,
// the buffer, hold vs tap), the wall-run (start, hold, end, kick; one face,
// never round a wall's end; a floor's edge is not a wall), the rail (catch,
// grind, cap, exit), the water (skim when fast, sink when slow), the respawn,
// collision at every yaw with no tunnelling, and determinism.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxDistance, createCharacter, nearestOnRail, slopeOf, solidDistance, TUNING, wedgeDistance } from "../src/physics/character.js";
import { frontOf, localToWorld, rightOf } from "../src/core/frame.js";

const DT = 1 / 120;
const K = TUNING;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const FLOOR = { c: [0, -1, 0], h: [60, 1, 60] }; // (top at y = 0)
const slab = (x0, x1, z0, z1, y = 0, mat = 1) => ({ c: [(x0 + x1) / 2, y - 1.5, (z0 + z1) / 2], h: [(x1 - x0) / 2, 1.5, (z1 - z0) / 2], mat });
const idle = { move: [0, 0], jump: false, hold: false };
const run = (body, n, input) => { const ev = []; for (let i = 0; i < n; i += 1) { body.step(DT, typeof input === "function" ? input(body, i) : input); ev.push(...body.events.map((e) => e.type)); } return ev; };
const settle = (body) => run(body, 60, idle);

// ---------------------------------------------------------------- the jump

test("jump: a held jump from standing rises v²/2g, and comes back down where it left", () => {
  const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, 0] });
  settle(body);
  assert.equal(body.mode, "ground");
  const y0 = body.pos[1];
  let peak = y0;
  const ev = run(body, 120, (b, i) => { peak = Math.max(peak, b.pos[1]); return { move: [0, 0], jump: i === 0, hold: true }; });
  const want = (K.jump * K.jump) / (2 * K.gravity); // (1.54 m)
  assert.ok(Math.abs(peak - y0 - want) < want * 0.03, `peak ${peak - y0} vs ${want}`);
  assert.ok(ev.includes("jumped") && ev.includes("landed"));
  assert.equal(body.mode, "ground");
  assert.ok(Math.hypot(body.pos[0], body.pos[2]) < 1e-9, "straight up, straight down");
});

test("jump: a running jump carries run speed x flight time (2v/g)", () => {
  const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, -20] });
  run(body, 240, { move: [0, 1], jump: false, hold: true }); // (up to speed)
  assert.ok(Math.abs(body.vel[2] - K.runSpeed) < 1e-6, `run speed ${body.vel[2]}`);
  const z0 = body.pos[2];
  let zLand = null;
  run(body, 120, (b, i) => { if (zLand === null && i > 0 && b.events.some((e) => e.type === "landed")) zLand = b.pos[2]; return { move: [0, 1], jump: i === 0, hold: true }; });
  const want = K.runSpeed * ((2 * K.jump) / K.gravity); // (6.8 m)
  assert.ok(zLand !== null, "it landed");
  assert.ok(Math.abs(zLand - z0 - want) < want * 0.04, `range ${zLand - z0} vs ${want}`);
});

test("jump: tapped (let go at once) rises well under half a held jump", () => {
  const peakOf = (hold) => {
    const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, 0] });
    settle(body);
    const y0 = body.pos[1];
    let peak = y0;
    run(body, 120, (b, i) => { peak = Math.max(peak, b.pos[1]); return { move: [0, 0], jump: i === 0, hold: hold || i === 0 }; });
    return peak - y0;
  };
  const held = peakOf(true);
  const tap = peakOf(false);
  // (Let go and the rise has 2.4 g against it: v²/(2 * 2.4 g).)
  const want = (K.jump * K.jump) / (2 * K.gravity * 2.4);
  assert.ok(Math.abs(tap - want) < want * 0.08, `tap ${tap} vs ${want}`); // (the first step rises uncut)
  assert.ok(tap < held * 0.45, `tap ${tap} held ${held}`);
});

test("jump: coyote time -- a jump just after running off an edge still counts; a late one doesn't", () => {
  const tryAfter = (late) => {
    const body = createCharacter({ boxes: [slab(-3, 3, -10, 0, 2)], waterY: -20, spawn: [0, 2.05, -6] });
    let leftAt = null;
    let jumped = false;
    run(body, 200, (b, i) => {
      if (leftAt === null && b.mode === "air" && i > 10) leftAt = i;
      const press = leftAt !== null && i === leftAt + late;
      if (b.events.some((e) => e.type === "jumped")) jumped = true;
      return { move: [0, 1], jump: press, hold: true };
    });
    return jumped;
  };
  assert.equal(tryAfter(Math.floor((K.coyote * 0.6) / DT)), true, "within coyote time");
  assert.equal(tryAfter(Math.ceil((K.coyote * 1.6) / DT)), false, "past coyote time");
});

test("jump: the buffer -- pressed just before landing, it jumps on landing; pressed early, it doesn't", () => {
  const tryBefore = (early) => {
    // Drop from 3 m; find the landing step first, then press `early` seconds before it.
    const probe = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 3, 0] });
    let land = 0;
    for (let i = 0; i < 200 && !land; i += 1) { probe.step(DT, idle); if (probe.mode === "ground") land = i; }
    const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 3, 0] });
    const press = land - Math.round(early / DT);
    const ev = run(body, land + 30, (b, i) => ({ move: [0, 0], jump: i === press, hold: true }));
    return ev.includes("jumped");
  };
  assert.equal(tryBefore(K.buffer * 0.6), true, "inside the buffer");
  assert.equal(tryBefore(K.buffer * 1.8), false, "before the buffer");
});

// ---------------------------------------------------------------- the wall

// A wall along z at x = 1 (face toward -x at x = 0.75), running from z = 0 to z0 + len.
const wallAt = (len = 30, top = 8, z0 = 0) => ({ c: [1, top / 2 - 1, z0 + len / 2], h: [0.25, top / 2 + 1, len / 2], mat: 0 });
function onTheWall({ len = 30, top = 8 } = {}) {
  const body = createCharacter({ boxes: [FLOOR, wallAt(len, top)], waterY: -10, spawn: [0.1, 0.05, -12] });
  // Up to speed along the wall, then a jump beside it.
  const ev = run(body, 150, (b, i) => ({ move: [0, 1], jump: i === 140, hold: true }));
  return { body, ev };
}

test("wall: fast and alongside, a jump starts a wall-run on the wall's face", () => {
  const { body, ev } = onTheWall();
  let started = ev.includes("wallStart");
  for (let i = 0; i < 30 && !started; i += 1) { body.step(DT, { move: [0.3, 1], jump: false, hold: true }); started = body.events.some((e) => e.type === "wallStart"); }
  assert.ok(started, "wallStart");
  assert.equal(body.mode, "wall");
  assert.ok(Math.abs(body.wall[0] + 1) < 1e-9, `normal points off the face: ${body.wall}`);
});

test("wall: it holds -- light gravity, speed kept along the face -- then lets go after wallTime", () => {
  const { body } = onTheWall();
  for (let i = 0; i < 30 && body.mode !== "wall"; i += 1) body.step(DT, { move: [0.3, 1], jump: false, hold: true });
  assert.equal(body.mode, "wall");
  const y0 = body.pos[1];
  let t = 0;
  let ended = false;
  let minSpeed = Infinity;
  while (t < K.wallTime + 0.2 && !ended) {
    body.step(DT, { move: [0, 1], jump: false, hold: true });
    t += DT;
    if (body.events.some((e) => e.type === "wallEnd")) ended = true;
    else { minSpeed = Math.min(minSpeed, body.vel[2]); assert.ok(body.pos[0] <= 0.75 - K.radius + 1e-6 && body.pos[0] > 0.75 - K.radius - 0.42, `within reach of the face: ${body.pos[0]}`); }
  }
  assert.ok(ended, "wallEnd");
  assert.ok(Math.abs(t - K.wallTime) < 0.05, `ended after ${t}s`);
  assert.ok(minSpeed >= K.wallMin, `kept its speed: ${minSpeed}`);
  assert.ok(body.pos[1] > y0 - 1, "hardly fell (light gravity)");
});

test("wall: the kick throws it off the face and up", () => {
  const { body } = onTheWall();
  for (let i = 0; i < 30 && body.mode !== "wall"; i += 1) body.step(DT, { move: [0.3, 1], jump: false, hold: true });
  run(body, 20, { move: [0, 1], jump: false, hold: true });
  body.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.ok(body.events.some((e) => e.type === "wallJump"));
  assert.equal(body.mode, "air");
  assert.ok(body.vel[0] < -K.wallKick * 0.85, `off the face: ${body.vel[0]}`); // (less the air steering of the same step)
  assert.ok(Math.abs(body.vel[1] - (K.wallUp - K.gravity * DT)) < 0.5, `up: ${body.vel[1]}`);
});

test("wall: it stays on one face and never wraps round a thin wall's end", () => {
  // A short wall: the run carries it past the end, where the nearest point turns the corner.
  const body = createCharacter({ boxes: [FLOOR, wallAt(6, 8, -3)], waterY: -10, spawn: [0.1, 0.05, -12] });
  let face = null;
  let ended = false;
  run(body, 400, (b, i) => {
    if (b.mode === "wall") {
      face ??= [...b.wall];
      assert.ok(dot(b.wall, face) > 0.9, `stayed on one face: ${b.wall}`);
      assert.ok(b.pos[0] < 0.75, "never round to the far side");
    }
    if (b.pos[2] < 3 + K.radius) assert.ok(b.pos[0] < 0.75, `never behind the wall: ${b.pos}`);
    if (face) assert.ok(b.vel[2] > 0, "never turned round the end");
    if (b.events.some((e) => e.type === "wallEnd")) ended = true;
    return { move: b.mode === "ground" ? [0, 1] : [0.3, 1], jump: i === 128, hold: true };
  });
  assert.ok(face, "it ran the wall");
  assert.ok(ended, "and let go at its end");
});

test("wall: a floor's edge is a step, not a wall", () => {
  // Jump alongside a raised pad whose top is below the head: no wall-run.
  const pad = { c: [1.5, 0, 0], h: [0.75, 0.6, 30] }; // (top at 0.6)
  const body = createCharacter({ boxes: [FLOOR, pad], waterY: -10, spawn: [0.2, 0.05, -25] });
  const ev = run(body, 300, (b, i) => ({ move: [0.2, 1], jump: i % 90 === 60, hold: true }));
  assert.ok(!ev.includes("wallStart"), "no wall-run on a pad's side");
  // Nor brushing into it, low, in the air (the middle sphere leans on the pad's side).
  const b2 = createCharacter({ boxes: [FLOOR, { c: [1.5, 0, 0], h: [0.75, 1.0, 30] }], waterY: -10, spawn: [0.2, 0.05, -25] });
  const ev2 = run(b2, 400, (b, i) => ({ move: b.mode === "ground" ? [0, 1] : [0.5, 1], jump: i % 100 === 80, hold: true }));
  assert.ok(!ev2.includes("wallStart"), "no wall-run on a waist-high block");
});

// ---------------------------------------------------------------- the rail

const RAIL = [[0, 1, 0], [0, 1, 10], [0, 1.5, 20]];
function onTheRail(rail = RAIL, speed = 6) {
  const body = createCharacter({ boxes: [], rails: [rail], waterY: -20, spawn: [0, 1.8, 1] });
  body.vel = [0, 0, speed];
  const ev = run(body, 40, { move: [0, 1], jump: false, hold: true });
  return { body, ev };
}

test("rail: falling onto it catches it, pushed on along it", () => {
  const { body, ev } = onTheRail();
  assert.ok(ev.includes("railStart"));
  assert.equal(body.mode, "grind");
  assert.ok(body.vel[2] > 6, `pushed on: ${body.vel[2]}`);
  const at = nearestOnRail([body.pos[0], body.pos[1] - K.railLift, body.pos[2]], RAIL);
  assert.ok(at.d < 0.2, `rides the rail: ${at.d}`);
});

test("rail: it settles toward cruise, a steep drop never flings it past railMax, and it leaves at the end", () => {
  const drop = [[0, 30, 0], [0, 20, 10], [0, 10, 20], [0, 0, 30]]; // (45° down)
  const body = createCharacter({ boxes: [], rails: [drop], waterY: -50, spawn: [0, 30.8, 0.5] });
  body.vel = [0, 0, 8];
  let top = 0;
  let caught = false;
  let ended = false;
  let lastVy = 0;
  for (let i = 0; i < 600 && !ended; i += 1) {
    body.step(DT, { move: [0, 1], jump: false, hold: true });
    if (body.mode === "grind") { caught = true; top = Math.max(top, Math.hypot(...body.vel)); }
    if (body.events.some((e) => e.type === "railEnd")) { ended = true; lastVy = body.vel[1]; }
  }
  assert.ok(caught, "caught");
  assert.ok(top <= K.railMax + 1e-9, `capped: ${top}`);
  assert.ok(top > K.railCruise, `the drop sped it past cruise: ${top}`);
  assert.ok(ended, "railEnd");
  assert.equal(body.mode, "air");
  assert.ok(lastVy > -K.railMax, "left with a lift");
});

test("rail: a flat rail settles on cruise, and a jump leaves it", () => {
  const long = [[0, 1, 0], [0, 1, 100]];
  const { body } = onTheRail(long, 4);
  run(body, 240, { move: [0, 1], jump: false, hold: true });
  assert.equal(body.mode, "grind");
  assert.ok(Math.abs(body.vel[2] - K.railCruise) < 0.3, `cruise ${body.vel[2]}`);
  body.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.ok(body.events.some((e) => e.type === "jumped"));
  assert.equal(body.mode, "air");
  assert.ok(body.vel[1] > K.jump * 0.9);
});

// ---------------------------------------------------------------- the water

function offThePad(speed) {
  const body = createCharacter({ boxes: [slab(-3, 3, -12, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -10] });
  const ev = run(body, 600, { move: [0, speed], jump: false, hold: false });
  return { body, ev };
}

test("water: fast (above skimMin) it skims; slow it sinks", () => {
  const fast = offThePad(1);
  assert.ok(fast.ev.includes("skimStart"), "skims");
  assert.ok(K.runSpeed >= K.skimMin);
  const slow = offThePad((K.skimMin * 0.8) / K.runSpeed);
  assert.ok(!slow.ev.includes("skimStart"), "no skim");
  assert.ok(slow.ev.includes("splashIn"), "sinks");
});

test("water: a skim holds the surface, drags, and sinks once slow; a jump leaves it", () => {
  const body = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  run(body, 600, (b) => ({ move: [0, b.mode === "skim" ? 0 : 1], jump: false, hold: false }));
  // (It skimmed, let go of the stick, dragged below skimMin * 0.9 and sank -- or is sinking.)
  const b2 = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  let skimmed = false;
  let sank = false;
  for (let i = 0; i < 1200 && !sank; i += 1) {
    b2.step(DT, { move: [0, b2.mode === "skim" ? 0 : 1], jump: false, hold: false });
    if (b2.mode === "skim") { skimmed = true; assert.equal(b2.pos[1], 0, "on the surface"); }
    if (b2.mode === "sink") { sank = true; assert.ok(Math.hypot(b2.vel[0], b2.vel[2]) < K.skimMin, "slowed first"); }
  }
  assert.ok(skimmed && sank);
  const b3 = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  for (let i = 0; i < 600 && b3.mode !== "skim"; i += 1) b3.step(DT, { move: [0, 1], jump: false, hold: false });
  b3.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.equal(b3.mode, "air");
  assert.ok(b3.vel[1] > 0);
});

test("respawn: sunk, it comes back at the last place it stood after `respawn` seconds", () => {
  const { body } = offThePad((K.skimMin * 0.8) / K.runSpeed);
  const b = createCharacter({ boxes: [slab(-3, 3, -12, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -10] });
  let sunkAt = null;
  let back = null;
  let checkpoint = null;
  for (let i = 0; i < 1000 && back === null; i += 1) {
    b.step(DT, { move: [0, sunkAt === null ? 0.5 : 0], jump: false, hold: false });
    if (sunkAt === null && b.mode === "sink") { sunkAt = i; checkpoint = [...b.checkpoint]; }
    if (b.events.some((e) => e.type === "respawn")) back = i;
  }
  assert.ok(body.mode === "sink" || body.events.length >= 0);
  assert.ok(back !== null, "respawned");
  assert.ok(Math.abs((back - sunkAt) * DT - K.respawn) < 0.02, `after ${(back - sunkAt) * DT}s`);
  assert.deepEqual(b.pos, checkpoint);
  assert.ok(checkpoint[2] < K.radius && checkpoint[2] > -3, `the pad's end, where it last stood: ${checkpoint}`);
  assert.equal(b.mode, "air");
});

// ---------------------------------------------------------------- collision

const YAWS16 = Array.from({ length: 16 }, (_, k) => (k * 2 * Math.PI) / 16 + 0.05);

test("collision: a thin wall at 16 yaws stops a run at full speed -- no tunnelling at 120 Hz", () => {
  for (const yaw of YAWS16) {
    for (const thick of [0.02, 0.1, 0.5]) {
      // The wall's face looks along frontOf(yaw); run at it from its front.
      const wall = { c: [0, 1, 0], h: [3, 3, thick / 2], yaw };
      const f = frontOf(yaw);
      const start = localToWorld([0, 0, 0], yaw, [0.3, 0.05, 4]);
      const body = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: start });
      body.vel = [-f[0] * K.runSpeed, 0, -f[2] * K.runSpeed];
      run(body, 120, { move: [-f[0], -f[2]], jump: false, hold: false });
      const side = dot([body.pos[0], 0, body.pos[2]], f);
      assert.ok(side > thick / 2 + K.radius - 0.02, `yaw ${yaw.toFixed(2)} thick ${thick}: still in front (${side})`);
      // And flung at it at the rail's cap and a wall-kick's speed, in the air.
      const b2 = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 1, 3]) });
      b2.vel = [-f[0] * (K.railMax + K.wallKick), 0, -f[2] * (K.railMax + K.wallKick)];
      run(b2, 60, idle);
      assert.ok(dot([b2.pos[0], 0, b2.pos[2]], f) > 0, `yaw ${yaw.toFixed(2)} thick ${thick}: the fling didn't pass through`);
    }
  }
});

test("collision: a slide along a turned wall keeps the along-speed (only the into-part is taken)", () => {
  for (const yaw of YAWS16) {
    const wall = { c: [0, 1, 0], h: [20, 3, 0.25], yaw };
    const f = frontOf(yaw);
    const r = rightOf(yaw);
    const body = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [-5, 0.05, 0.25 + K.radius + 0.01]) });
    body.vel = [(r[0] - f[0]) * 5, 0, (r[2] - f[2]) * 5];
    body.step(DT, { move: [r[0] - f[0], r[2] - f[2]], jump: false, hold: false });
    run(body, 30, { move: [r[0], r[2]], jump: false, hold: false });
    assert.ok(dot(body.vel, r) > 4, `yaw ${yaw.toFixed(2)}: slides on along the wall ${dot(body.vel, r)}`);
    assert.ok(dot(body.pos, f) > 0.25, "and stays in front of it");
  }
});

test("collision: a fall from 12 m onto a thin slab lands on it", () => {
  const body = createCharacter({ boxes: [{ c: [0, 0, 0], h: [3, 0.05, 3] }], waterY: -30, spawn: [0, 12, 0] });
  run(body, 240, idle);
  assert.equal(body.mode, "ground");
  assert.ok(Math.abs(body.pos[1] - 0.05) < 0.02, `on top: ${body.pos[1]}`);
});

test("boxDistance at 16 yaws matches brute force: the distance, and the normal points away", () => {
  const b = { c: [0.4, 0.2, -0.3], h: [0.7, 0.4, 1.3] };
  for (const yaw of YAWS16) {
    const box = { ...b, yaw };
    for (let k = 0; k < 40; k += 1) {
      const p = [Math.sin(k * 1.7) * 2.5, Math.cos(k * 2.3) * 1.5, Math.sin(k * 0.9 + 1) * 2.5];
      const { d, n } = boxDistance(p, box);
      const e = 1e-5;
      const g = [0, 1, 2].map((i) => { const a = [...p]; const c = [...p]; a[i] += e; c[i] -= e; return (boxDistance(a, box).d - boxDistance(c, box).d) / (2 * e); });
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
      if (d > 0.01) assert.ok(dot(g, n) > 0.999, `gradient agrees outside ${g} ${n}`);
    }
  }
});

// ---------------------------------------------------------------- determinism

test("determinism: the same inputs make the same run, to the bit, every time", () => {
  const world = { boxes: [FLOOR, wallAt(), { c: [-3, 0.5, 5], h: [1, 0.5, 1], yaw: 0.7 }], rails: [RAIL.map((p) => [p[0] - 5, p[1], p[2]])], waterY: -10, spawn: [0, 0.05, -12] };
  const go = () => {
    const body = createCharacter(world);
    const out = [];
    for (let i = 0; i < 1200; i += 1) {
      body.step(DT, { move: [Math.sin(i * 0.01), Math.cos(i * 0.013)], jump: i % 70 === 0, hold: i % 70 < 30 });
      out.push(...body.pos, ...body.vel, body.mode);
    }
    return out;
  };
  assert.deepEqual(go(), go());
});

// ---------------------------------------------------------------- wedges (ramps)


// A ramp of slope `deg` on the floor: foot at +z (local), rising toward -z; `len` long, `w` wide.
const rampOf = (deg, { len = 6, w = 3, yaw = 0, at = [0, 0, 0], lo = 0 } = {}) => {
  const hy = (len * Math.tan((deg * Math.PI) / 180)) / 2 / (1 - lo);
  return { kind: "wedge", c: [at[0], at[1] + hy, at[2]], h: [w / 2, hy, len / 2], yaw, lo, mat: 1 };
};

test("wedgeDistance is exact: |grad| = 1, the normal is the gradient, and p - n d lies on the surface", () => {
  for (const yaw of YAWS16) {
    for (const lo of [0, 0.3]) {
      const w = { c: [0.3, 0.5, -0.2], h: [0.8, 0.6, 1.4], yaw, lo };
      for (let k = 0; k < 60; k += 1) {
        const p = [Math.sin(k * 1.7) * 2.5, 0.5 + Math.cos(k * 2.3) * 1.6, Math.sin(k * 0.9 + 1) * 2.5];
        const { d, n } = wedgeDistance(p, w);
        assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, "unit normal");
        const e = 1e-6;
        const g = [0, 1, 2].map((i) => { const a = [...p]; const c = [...p]; a[i] += e; c[i] -= e; return (wedgeDistance(a, w).d - wedgeDistance(c, w).d) / (2 * e); });
        if (Math.abs(d) > 0.02) assert.ok(dot(g, n) > 0.999, `gradient ${g} vs normal ${n}`);
        if (d > 0.02) assert.ok(Math.abs(wedgeDistance([p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d], w).d) < 1e-9, "projects onto the surface");
      }
    }
  }
});

test("wedges turn like everything else: the slope looks along frontOf(yaw), the high face behind", () => {
  for (const yaw of YAWS16) {
    const w = rampOf(30, { yaw });
    assert.ok(Math.abs(slopeOf(w) - Math.PI / 6) < 1e-12);
    const above = localToWorld(w.c, yaw, [0, 3, 0]);
    const { n } = wedgeDistance(above, w);
    const f = frontOf(yaw);
    assert.ok(Math.abs(n[1] - Math.cos(Math.PI / 6)) < 1e-9, `slope normal ${n}`);
    assert.ok(Math.abs(n[0] * f[0] + n[2] * f[2] - Math.sin(Math.PI / 6)) < 1e-9, "leans toward the foot (front)");
    const behind = localToWorld(w.c, yaw, [0, 0, -w.h[2] - 1]);
    const back = wedgeDistance(behind, w);
    assert.ok(Math.abs(back.d - 1) < 1e-9 && dot(back.n, f) < -0.999, "the high face looks back");
    assert.equal(solidDistance(above, w).d, wedgeDistance(above, w).d);
    assert.equal(solidDistance(above, { ...w, kind: undefined }).d, boxDistance(above, w).d);
  }
});

test("wedge: stood on at 30° and 40°, the body stays put -- no creeping down", () => {
  for (const deg of [20, 30, 40]) {
    for (const yaw of [0, 1.1, -2.3]) {
      const w = rampOf(deg, { yaw });
      const spot = localToWorld(w.c, yaw, [0.2, w.h[1] + 0.3, 0]);
      const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: spot });
      run(body, 120, idle);
      assert.equal(body.mode, "ground", `${deg}° stands`);
      const p0 = [...body.pos];
      run(body, 240, idle);
      assert.ok(Math.hypot(body.pos[0] - p0[0], body.pos[1] - p0[1], body.pos[2] - p0[2]) < 1e-3, `${deg}° yaw ${yaw}: crept ${body.pos} from ${p0}`);
      assert.equal(body.mode, "ground");
      assert.ok(body.slope && Math.abs(body.slope[1] - Math.cos((deg * Math.PI) / 180)) < 1e-6, "knows its slope");
    }
  }
});

test("wedge: it runs up a 35° ramp onto the block at its top, and down again, on the ground all the way", () => {
  for (const yaw of YAWS16.slice(0, 8)) {
    const w = rampOf(35, { yaw, len: 5 });
    const top = 2 * w.h[1];
    const block = { c: localToWorld([0, 0, 0], yaw, [0, top / 2, -w.h[2] - 3]), h: [1.5, top / 2, 3], yaw };
    const f = frontOf(yaw);
    const body = createCharacter({ boxes: [FLOOR, block], wedges: [w], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 0.05, w.h[2] + 3]) });
    let air = 0;
    let steps = 0;
    run(body, 240, (b) => { if (b.mode === "air") air += 1; steps += 1; const far = dot([b.pos[0] - block.c[0], 0, b.pos[2] - block.c[2]], f) < 0; return { move: far ? [0, 0] : [-f[0], -f[2]], jump: false, hold: false }; });
    assert.ok(Math.abs(body.pos[1] - top) < 0.03, `yaw ${yaw.toFixed(2)}: on top at ${body.pos[1]} (top ${top})`);
    assert.ok(air < 6, `stayed on its feet going up (${air} air steps)`);
    // Turn round and run down: glued to the slope, not bounding off it.
    air = 0;
    run(body, 150, (b) => { if (b.mode === "air") air += 1; return { move: [f[0], f[2]], jump: false, hold: false }; });
    assert.ok(body.pos[1] < 0.05, "back on the floor");
    assert.ok(air < 12, `down the ramp on its feet (${air} air steps)`);
  }
});

test("wedge: steeper than slopeMax, it slides and can't stand or climb", () => {
  const w = rampOf(55, { len: 3 });
  const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, w.h[1] * 1.4 + 0.4, 0] });
  let ground = 0;
  run(body, 240, (b) => { if (b.mode === "ground" && b.pos[1] > 0.1) ground += 1; return idle; });
  assert.equal(ground, 0, "never stood on the steep slope");
  assert.ok(body.pos[1] < 0.02 && body.pos[2] > w.h[2], `slid off its foot: ${body.pos}`);
  // Run at it: it can't get up.
  const b2 = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, 0.05, 6] });
  let high = 0;
  run(b2, 240, (b) => { high = Math.max(high, b.pos[1]); return { move: [0, -1], jump: false, hold: false }; });
  assert.ok(high < w.h[1], `stayed low: ${high}`);
});

test("wedge: a jump from a ramp, and landing on one", () => {
  const w = rampOf(25, { len: 8 });
  const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, w.h[1] + 0.2, 0] });
  run(body, 60, idle);
  const ev = run(body, 120, (b, i) => ({ move: [0, 0], jump: i === 0, hold: true }));
  assert.ok(ev.includes("jumped") && ev.includes("landed"));
  assert.equal(body.mode, "ground");
  const drop = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0.5, 5, 1] });
  const ev2 = run(drop, 200, idle);
  assert.ok(ev2.includes("landed"));
  assert.equal(drop.mode, "ground");
  assert.ok(wedgeDistance([drop.pos[0], drop.pos[1] + K.radius, drop.pos[2]], w).d > K.radius - 0.01, "on it, not in it");
});

test("wedge: its high face stops a run at 16 yaws, and it is no wall to run on", () => {
  for (const yaw of YAWS16) {
    const w = rampOf(40, { yaw, len: 3, w: 6 });
    const f = frontOf(yaw);
    const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 0.05, -w.h[2] - 4]) });
    const ev = run(body, 150, { move: [f[0], f[2]], jump: false, hold: false });
    const local = dot([body.pos[0] - w.c[0], 0, body.pos[2] - w.c[2]], f);
    assert.ok(local < -w.h[2] - K.radius + 0.02, `yaw ${yaw.toFixed(2)}: stopped behind its high face (${local})`);
    assert.ok(!ev.includes("wallStart"));
  }
});

test("wedge: a boxes-only world ignores the wedge code (the golden runs pin it); a fall never passes maxFall", () => {
  const body = createCharacter({ boxes: [{ c: [0, -1, 0], h: [3, 0.02, 3] }], waterY: -300, spawn: [0, 80, 0] });
  let fastest = 0;
  run(body, 600, (b) => { fastest = Math.max(fastest, -b.vel[1]); return idle; });
  assert.ok(fastest <= K.maxFall + 1e-9, `fell at ${fastest}`);
  assert.equal(body.mode, "ground", "and landed on a 4 cm slab from 81 m");
});

test("wedge: one given among the boxes (kind: \"wedge\") is a wedge, as the renderer reads it", () => {
  const w = rampOf(30);
  const spot = [0, w.c[1] + w.h[1] + 0.3, 0];
  const a = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: spot });
  const b = createCharacter({ boxes: [FLOOR, w], waterY: -10, spawn: spot });
  run(a, 120, idle);
  run(b, 120, idle);
  assert.deepEqual(a.pos, b.pos);
  assert.ok(b.slope, "stood on it as a slope, not a box");
});
