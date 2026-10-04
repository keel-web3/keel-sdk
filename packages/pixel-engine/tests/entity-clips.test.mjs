// Entity animation: gaits that put their feet down in the right order, planted
// feet that stay planted, an animator that follows a physics body without pops,
// and a wall run tilted the right way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, rightOf, worldToLocal } from "../src/core/frame.js";
import { GAITS, KINDS, LAND_TIME, animator, entityOf, featurePoints, posed, skinOf } from "../src/entity/index.js";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sole = (c) => Math.min(c.a[1], c.b[1]) - c.r;
const reachOf = (spec) => (spec.plan === "quadruped" ? spec.body.shoulderH - spec.body.ankleH : spec.body.hipH - spec.body.ankleH);

/** When each foot touches down over one cycle (phases 0..1), read off the posed paws. */
function touchdowns(spec, clip, feet, N = 400) {
  const down = (i) => {
    const caps = skinOf(spec, posed(spec, clip, { phase: i / N, yaw: 0.8 }));
    return Object.fromEntries(feet.map((k) => [k, sole(caps.find((c) => c.part === k)) < 1e-9 * spec.body.H]));
  };
  const out = {};
  let prev = down(N - 1);
  for (let i = 0; i < N; i += 1) {
    const now = down(i);
    for (const k of feet) if (now[k] && !prev[k] && out[k] === undefined) out[k] = i / N;
    prev = now;
  }
  return out;
}
const cyclicOrder = (td, first) => Object.keys(td).sort((a, b) => ((td[a] - td[first] + 1) % 1) - ((td[b] - td[first] + 1) % 1));

test("quadruped footfalls: walk HL FL HR FR, trot in diagonal pairs, gallop hinds then fores, bound in pairs", () => {
  const paws = ["paw.HL", "paw.FL", "paw.HR", "paw.FR"];
  for (const sp of ["cat", "dog", "fox", "bear", "deer"]) {
    for (const seed of ["1", "2"]) {
      const spec = entityOf(seed, { kind: "animal", species: sp });
      const walk = touchdowns(spec, "walk", paws);
      assert.deepEqual(cyclicOrder(walk, "paw.HL"), ["paw.HL", "paw.FL", "paw.HR", "paw.FR"], `${sp} walk ${JSON.stringify(walk)}`);
      const trot = touchdowns(spec, "trot", paws);
      assert.ok(Math.abs(trot["paw.HL"] - trot["paw.FR"]) < 0.01 && Math.abs(trot["paw.HR"] - trot["paw.FL"]) < 0.01, `${sp} trot pairs ${JSON.stringify(trot)}`);
      assert.ok(Math.abs(((trot["paw.HR"] - trot["paw.HL"] + 1) % 1) - 0.5) < 0.01, `${sp} trot pairs half a cycle apart`);
      const gallop = touchdowns(spec, "gallop", paws);
      assert.deepEqual(cyclicOrder(gallop, "paw.HL"), ["paw.HL", "paw.HR", "paw.FL", "paw.FR"], `${sp} gallop ${JSON.stringify(gallop)}`);
    }
  }
  for (const sp of ["rabbit", "mouse"]) {
    const spec = entityOf("4", { kind: "animal", species: sp });
    // (A rabbit's trot and gallop are its bound: hinds together, then fores together.)
    for (const clip of ["gallop", "bound"]) {
      const td = touchdowns(spec, clip, paws);
      assert.ok(Math.abs(td["paw.HL"] - td["paw.HR"]) < 0.06 && Math.abs(td["paw.FL"] - td["paw.FR"]) < 0.06, `${sp} ${clip} ${JSON.stringify(td)}`);
      assert.deepEqual(cyclicOrder(td, "paw.HL").slice(2).sort(), ["paw.FL", "paw.FR"], `${sp} ${clip}: hinds, then fores`);
    }
  }
  // The table the clips read says the same.
  assert.deepEqual(Object.entries(GAITS.walk.at).sort((a, b) => a[1] - b[1]).map(([k]) => k), ["HL", "FL", "HR", "FR"]);
});

test("a biped walk always has a foot down; a fast run has both feet up for a moment; arms swing against legs", () => {
  for (const kind of ["humanoid", "anthro"]) {
    for (const seed of ["1", "2", "3", "4", "5"]) {
      const spec = entityOf(seed, { kind });
      let flight = 0;
      for (let i = 0; i < 100; i += 1) {
        const yaw = i * 0.13;
        const walk = skinOf(spec, posed(spec, "walk", { phase: i / 100, yaw }));
        const feetW = walk.filter((c) => c.part.startsWith("foot."));
        assert.ok(Math.min(...feetW.map(sole)) < 1e-9, `${kind} ${seed} walk phase ${i / 100}: a foot down`);
        const run = skinOf(spec, posed(spec, "run", { phase: i / 100, yaw, params: { speed: reachOf(spec) * 30 } }));
        if (Math.min(...run.filter((c) => c.part.startsWith("foot.")).map(sole)) > 1e-4) flight += 1;
        // Leg forward, same-side arm back (in its own frame: z is ahead).
        const F = featurePoints(run);
        const pos = [0, 0, 0];
        const local = (p) => worldToLocal(pos, yaw, p);
        const legL = local(F["toe.L"])[2] - local(F["toe.R"])[2];
        const armL = local(F["hand.L"])[2] - local(F["hand.R"])[2];
        if (Math.abs(legL) > reachOf(spec) * 0.3) assert.ok(Math.sign(legL) !== Math.sign(armL), `${kind} ${seed} run: arms against legs at ${i / 100}`);
      }
      assert.ok(flight > 10, `${kind} ${seed}: a sprint has flight (${flight}/100)`);
    }
  }
});

/** A body running straight along a heading at a speed, stepped at 120 Hz. */
function runBody(anim, { yaw, speed, seconds, mode = "ground", wall, from = [2, 0, -1] }) {
  const f = frontOf(yaw);
  const body = { pos: [...from], vel: [f[0] * speed, 0, f[2] * speed], facing: yaw, mode, wall };
  const frames = [];
  const dt = 1 / 120;
  for (let i = 0; i < seconds * 120; i += 1) {
    body.pos = [body.pos[0] + body.vel[0] * dt, body.pos[1], body.pos[2] + body.vel[2] * dt];
    anim.step(dt, body);
    frames.push({ t: i * dt, caps: anim.capsules(), clip: anim.state.clip });
  }
  return frames;
}

test("planted feet stay planted: the animator's phase runs on distance, so nothing slides", () => {
  const cases = [
    ["anthro", 2, "walk"], ["anthro", 8, "run"], ["humanoid", 2, "walk"], ["humanoid", 7, "run"],
    ["animal", 1.5, "walk"], ["animal", 5, "trot"], ["animal", 10, "gallop"],
  ];
  for (const [kind, k, clip] of cases) {
    for (const seed of ["3", "8"]) {
      for (const yaw of [0.4, -2.3]) {
        const spec = entityOf(seed, { kind });
        const reach = reachOf(spec);
        const anim = animator(spec);
        const frames = runBody(anim, { yaw, speed: reach * k, seconds: 3 });
        assert.equal(frames.at(-1).clip, clip, `${kind} at ${k} reach/s is a ${clip}`);
        let checked = 0;
        for (let i = 180; i < frames.length; i += 1) {
          for (const c of frames[i].caps) {
            if (!/^(foot|paw)\./.test(c.part)) continue;
            const before = frames[i - 1].caps.find((q) => q.part === c.part);
            if (sole(c) > 1e-9 || sole(before) > 1e-9) continue;
            const slid = Math.hypot(c.a[0] - before.a[0], c.a[2] - before.a[2]);
            assert.ok(slid < reach * 1e-6, `${kind} ${clip} seed ${seed}: ${c.part} slid ${slid} at ${frames[i].t.toFixed(3)}`);
            checked += 1;
          }
        }
        assert.ok(checked > 60, `${kind} ${clip}: enough planted frames checked (${checked})`);
      }
    }
  }
});

/** The most any joint moves in a frame (less the body's own move) in steady gaits from a stroll to a sprint. */
function steadyMotion(spec) {
  const reach = reachOf(spec);
  let most = 0;
  for (let k = 1; k <= 10; k += 1) {
    const anim = animator(spec);
    const body = { pos: [0, 0, 0], vel: [0, 0, reach * k], facing: 0, mode: "ground" };
    let prev = null;
    for (let i = 0; i < 200; i += 1) {
      body.pos = [0, 0, body.pos[2] + (reach * k) / 60];
      anim.step(1 / 60, body);
      const bones = anim.skeleton().bones;
      if (prev && i > 120) for (const [n, b] of Object.entries(bones)) most = Math.max(most, Math.hypot(...sub(b.p, prev[n])) - (reach * k) / 60);
      prev = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, b.p]));
    }
  }
  return most;
}

test("the animator follows the body's mode, crossfades without pops, and is deterministic", () => {
  for (const kind of KINDS) {
    const spec = entityOf("21", { kind });
    const reach = reachOf(spec);
    const steady = steadyMotion(spec);
    const run = (anim) => {
      const body = { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0.5, mode: "ground" };
      const seen = [];
      const dt = 1 / 60;
      const script = (t) => {
        if (t < 0.5) return { v: 0, mode: "ground", vy: 0 };
        if (t < 1.5) return { v: reach * 2, mode: "ground", vy: 0 };
        if (t < 2.5) return { v: reach * 9, mode: "ground", vy: 0 };
        if (t < 2.8) return { v: reach * 9, mode: "air", vy: 3 };
        if (t < 3.1) return { v: reach * 9, mode: "air", vy: -3 };
        if (t < 3.6) return { v: 0.001, mode: "ground", vy: 0 };
        return { v: 0, mode: "ground", vy: 0 };
      };
      let prev = null;
      let pop = 0;
      let v = 0;
      for (let t = 0; t < 4; t += dt) {
        const s = script(t);
        // (Speeding up and slowing down as the physics body does: top speed in about a quarter second.)
        const accel = reach * 36 * dt;
        v += Math.max(-accel, Math.min(accel, s.v - v));
        const f = frontOf(body.facing);
        body.vel = [f[0] * v, s.vy, f[2] * v];
        body.pos = [body.pos[0] + body.vel[0] * dt, Math.max(0, body.pos[1] + s.vy * dt), body.pos[2] + body.vel[2] * dt];
        body.mode = s.mode;
        anim.step(dt, body);
        const st = anim.state;
        const wsum = st.layers.reduce((a, l) => a + l.w, 0);
        assert.ok(Math.abs(wsum - 1) < 1e-9, `the layers' weights sum to 1 (${wsum})`);
        seen.push(st.clip);
        const skel = anim.skeleton();
        // (Joint jumps between frames, relative to the body moving: a pop is a big one.)
        if (prev) {
          const move = Math.hypot(body.vel[0], body.vel[1], body.vel[2]) * dt;
          for (const [name, bn] of Object.entries(skel.bones)) pop = Math.max(pop, Math.hypot(...sub(bn.p, prev[name])) - move);
        }
        prev = Object.fromEntries(Object.entries(skel.bones).map(([n, bn]) => [n, bn.p]));
      }
      return { seen, pop, caps: anim.capsules() };
    };
    const a = run(animator(spec));
    const b = run(animator(spec));
    assert.deepEqual(a.caps, b.caps, "the same body, the same capsules");
    const order = a.seen.filter((c, i) => c !== a.seen[i - 1]);
    const want = kind === "animal" ? ["idle", "walk", "trot", "gallop", "leap", "idle"] : ["idle", "walk", "run", "jump", "fall", "land", "idle"];
    for (const c of want) assert.ok(order.includes(c), `${kind}: ${c} in ${order.join(" > ")}`);
    assert.ok(order.indexOf(want.at(-2)) < order.lastIndexOf("idle"), `${kind}: settles to idle`);
    // (A pop: a joint jumping much further in a frame than any steady gait ever moves it.)
    assert.ok(a.pop < steady * 1.5, `${kind}: through every change no joint moves more than 1.5x its steady-gait most in a frame (${(a.pop / steady).toFixed(2)}x)`);
  }
});

test("phase is continuous through a walk-to-run blend", () => {
  const spec = entityOf("5", { kind: "anthro" });
  const reach = reachOf(spec);
  const anim = animator(spec);
  const body = { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "ground" };
  let last = null;
  for (let i = 0; i < 360; i += 1) {
    const v = reach * (1 + (8 * i) / 360);
    body.vel = [0, 0, v];
    body.pos = [0, 0, body.pos[2] + v / 120];
    anim.step(1 / 120, body);
    const p = anim.state.phase;
    if (last !== null) {
      const d = (p - last + 1) % 1;
      assert.ok(d >= 0 && d < 0.08, `phase steps forward a little each frame (${d})`);
    }
    last = p;
  }
});

test("on a wall: feet toward it, head away, whichever side it's on; wallGap puts the feet on it", () => {
  for (const kind of ["anthro", "humanoid"]) {
    for (const seed of ["1", "6"]) {
      const spec = entityOf(seed, { kind });
      for (const yaw of [0.2, 2.9, -1.4]) {
        for (const side of [1, -1]) {
          // The wall's normal points from the wall to the body: a wall on its left points to its right.
          const n = rightOf(yaw).map((v) => v * side);
          const anim = animator(spec, { fade: 0 });
          const f = frontOf(yaw);
          const body = { pos: [0, 1, 0], vel: [f[0] * 8, 1, f[2] * 8], facing: yaw, mode: "wall", wall: n };
          anim.step(1 / 60, body);
          const F = featurePoints(anim.capsules());
          const away = dot(sub(F.head, [0, 1, 0]), n);
          assert.ok(away > spec.body.H * 0.1, `${kind} ${seed} yaw ${yaw} wall ${side > 0 ? "left" : "right"}: head leans off the wall (${away.toFixed(3)})`);
          const feet = [(F["toe.L"][0] + F["toe.R"][0]) / 2, 0, (F["toe.L"][2] + F["toe.R"][2]) / 2];
          assert.ok(dot(sub(feet, F.head), n) < 0, "feet nearer the wall than the head");
          // Told the gap, the feet move onto the wall.
          const anim2 = animator(spec, { fade: 0 });
          anim2.step(1 / 60, { ...body, wallGap: 0.3 });
          const G = featurePoints(anim2.capsules());
          const moved = dot(sub(G["toe.L"], F["toe.L"]), n);
          assert.ok(Math.abs(moved + (0.3 - spec.body.footR)) < 1e-9, `feet moved ${moved} toward the wall`);
        }
      }
    }
  }
});

test("hold and release a clip; a landing squashes then recovers", () => {
  const spec = entityOf("2", { kind: "animal" });
  const anim = animator(spec, { fade: 0.1 });
  const body = { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "ground" };
  anim.hold("lie");
  for (let i = 0; i < 30; i += 1) anim.step(1 / 60, body);
  assert.equal(anim.state.clip, "lie");
  const lying = Math.max(...anim.capsules().map((c) => Math.max(c.a[1], c.b[1])));
  anim.release();
  for (let i = 0; i < 30; i += 1) anim.step(1 / 60, body);
  assert.equal(anim.state.clip, "idle");
  assert.ok(Math.max(...anim.capsules().map((c) => Math.max(c.a[1], c.b[1]))) > lying, "standing is taller than lying");
  assert.throws(() => anim.hold("moonwalk"), RangeError);

  const p = entityOf("2", { kind: "anthro" });
  const hip = (landT) => posed(p, "land", { landT }).bones.hips.p[1];
  assert.ok(hip(0) < hip(LAND_TIME * 0.5) && hip(LAND_TIME * 0.5) < hip(LAND_TIME), "squashed on impact, springing back");
});
