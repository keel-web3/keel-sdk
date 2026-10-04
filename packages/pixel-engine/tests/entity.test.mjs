// The entity system: specs from seeds and pins, rigs, skins, and fronts that
// are where core/frame.js says they are -- at every yaw, for every kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, rightOf, yawOf } from "../src/core/frame.js";
import {
  CHOICES, KINDS, SPECIES, MAX_CAPSULES, apply, clipsFor, entityOf, euler, featurePoints, frontOfEntity,
  lowestY, materialFor, measuredLengths, posed, readsOf, restLengths, rotX, rotY, rotZ, skinOf, solveTwoBone,
} from "../src/entity/index.js";

const SEEDS = Array.from({ length: 200 }, (_, i) => String(i));
const YAWS = Array.from({ length: 16 }, (_, i) => -Math.PI + (i + 0.37) * (Math.PI / 8));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const near = (a, b, e) => a.every((v, i) => Math.abs(v - b[i]) < e);
const finite = (caps) => caps.every((c) => [...c.a, ...c.b, c.r].every(Number.isFinite) && c.r > 0 && Number.isInteger(c.mat));
const specs = {};
for (const kind of KINDS) specs[kind] = SEEDS.map((s) => entityOf(s, { kind }));

test("rotations turn the way core/frame.js does, and the pose signs are as documented", () => {
  for (const y of YAWS) {
    assert.ok(near(apply(rotY(y), [0, 0, 1]), frontOf(y), 1e-12), "Ry(yaw) takes +z to frontOf(yaw)");
    assert.ok(near(apply(rotY(y), [1, 0, 0]), rightOf(y), 1e-12), "Ry(yaw) takes +x to rightOf(yaw)");
  }
  assert.ok(apply(rotX(0.3), [0, 1, 0])[2] > 0, "rx > 0 tips an upright bone forward");
  assert.ok(apply(rotX(0.3), [0, -1, 0])[2] < 0, "rx > 0 swings a hanging bone back");
  assert.ok(apply(rotX(0.3), [0, 0, 1])[1] < 0, "rx > 0 tips a forward bone down");
  assert.ok(apply(rotZ(0.3), [0, -1, 0])[0] > 0, "rz > 0 swings a hanging bone to its right");
  assert.ok(apply(euler(0, 0.3, 0), [0, 0, 1])[0] > 0, "ry > 0 turns the front to the right");
});

test("two-bone IK keeps both lengths, reaches what it can, and bends toward the pole", () => {
  for (let i = 0; i < 400; i += 1) {
    const L1 = 0.3 + (i % 7) * 0.05;
    const L2 = 0.25 + (i % 5) * 0.06;
    const a = [Math.sin(i) * 2, 1 + Math.cos(i * 1.3), Math.sin(i * 0.7)];
    const t = [a[0] + Math.sin(i * 2.1) * 0.9, a[1] - Math.abs(Math.cos(i * 0.3)) * 0.9, a[2] + Math.cos(i * 1.7) * 0.9];
    const pole = [Math.sin(i * 0.9), 0.2, Math.cos(i * 0.9)];
    const { mid, end, reached } = solveTwoBone(a, t, L1, L2, pole);
    assert.ok(Math.abs(Math.hypot(...sub(mid, a)) - L1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...sub(end, mid)) - L2) < 1e-9);
    if (reached) assert.ok(near(end, t, 1e-7));
    // (The middle joint sits on the pole's side of the a->end line.)
    const n = sub(end, a);
    const l = Math.hypot(...n);
    const off = sub(sub(mid, a), n.map((v) => (v / l) * dot(sub(mid, a), n.map((w) => w / l))));
    if (Math.hypot(...off) > 1e-6) assert.ok(dot(off, pole) > -1e-9);
  }
});

test("every kind, 200 seeds, 16 yaws: eyes, nose and toes in front, the right hand on the right", () => {
  for (const kind of KINDS) {
    for (const spec of specs[kind]) {
      for (const yaw of YAWS) {
        const caps = skinOf(spec, posed(spec, "idle", { yaw, pos: [3, 0, -2] }));
        const F = featurePoints(caps);
        const f = frontOf(yaw);
        const r = rightOf(yaw);
        const where = `${kind} ${spec.species} seed ${spec.seed} yaw ${yaw.toFixed(2)}`;
        for (const k of ["eye.L", "eye.R", "nose", "face"]) assert.ok(dot(sub(F[k], F.centre), f) > 0, `${k} in front of the body: ${where}`);
        for (const k of ["eye.L", "eye.R", "nose"]) assert.ok(dot(sub(F[k], F.head), f) > 0, `${k} on the front of the head: ${where}`);
        const toes = Object.keys(F).filter((k) => k.startsWith("toe."));
        assert.equal(toes.length, spec.plan === "quadruped" ? 4 : 2);
        const tc = toes.reduce((s, k) => s.map((v, i) => v + F[k][i] / toes.length), [0, 0, 0]);
        assert.ok(dot(sub(tc, F.centre), f) > 0, `toes in front of the body: ${where}`);
        for (const k of toes) assert.ok(dot(sub(F[k], F[`heel.${k.slice(4)}`]), f) > 0, `${k} ahead of its heel: ${where}`);
        assert.ok(dot(sub(F["eye.R"], F["eye.L"]), r) > 0, `right eye on the right: ${where}`);
        if (spec.plan === "humanoid") {
          assert.ok(dot(sub(F["hand.R"], F.centre), r) > 0, `right hand on the right: ${where}`);
          assert.ok(dot(sub(F["hand.L"], F.centre), r) < 0, `left hand on the left: ${where}`);
          assert.ok(dot(sub(F["toe.R"], F["toe.L"]), r) > 0, `right foot on the right: ${where}`);
        } else {
          assert.ok(dot(sub(F["toe.FR"], F["toe.FL"]), r) > 0 && dot(sub(F["toe.HR"], F["toe.HL"]), r) > 0, `right paws on the right: ${where}`);
          assert.ok(dot(sub(F["toe.FL"], F["toe.HL"]), f) > 0, `fore paws ahead of the hinds: ${where}`);
        }
        const seen = frontOfEntity(caps, { yaw });
        assert.ok(seen.error < 0.12 && seen.confidence > 0.9, `seen front ${seen.yaw.toFixed(2)} (${seen.why}): ${where}`);
        assert.ok(caps.length <= MAX_CAPSULES && finite(caps), `capsules: ${where}`);
      }
    }
  }
});

test("standing, the soles are on the ground and nothing is under it", () => {
  for (const kind of KINDS) {
    const clips = kind === "animal" ? ["idle", "sit", "lie"] : ["idle", "land", "grind", "sit", "turn"];
    for (const spec of specs[kind]) {
      const H = spec.body.H;
      for (const clip of clips) {
        for (const yaw of [0.3, 2.2, -1.9]) {
          const caps = skinOf(spec, posed(spec, clip, { yaw, pos: [1, 2, 3], t: 0.7 }));
          const where = `${kind} ${spec.species} seed ${spec.seed} ${clip}`;
          assert.ok(lowestY(caps) > 2 - 1e-6 * H, `nothing under the ground: ${where} (${lowestY(caps) - 2})`);
          const soles = caps.filter((c) => /^(foot|paw)\./.test(c.part)).map((c) => Math.min(c.a[1], c.b[1]) - c.r - 2);
          if (clip !== "turn") for (const s of soles) assert.ok(Math.abs(s) < 1e-6 * H, `a sole on the ground: ${where} (${s})`);
          else assert.ok(Math.min(...soles) < 1e-6 * H, `a foot down while turning: ${where}`);
        }
      }
    }
  }
});

test("every clip: no NaN, bone lengths kept, faces front, at most 28 capsules", () => {
  for (const kind of KINDS) {
    for (const spec of specs[kind].slice(0, 60)) {
      const rest = restLengths(spec.rig);
      for (const clip of Object.keys(clipsFor(spec))) {
        for (const [i, yaw] of YAWS.filter((_, j) => j % 4 === 1).entries()) {
          const params = { speed: 3 + i * 3, wall: i % 2 ? 1 : -1, turn: 1, seat: i === 2 ? 0 : undefined };
          const skel = posed(spec, clip, { yaw, phase: i * 0.29, t: i * 0.9, params, landT: i * 0.05 });
          const got = measuredLengths(spec.rig, skel);
          for (const [bone, L] of Object.entries(rest)) assert.ok(Math.abs(got[bone] - L) < 1e-9 * (1 + L), `${bone} length in ${clip}`);
          const caps = skinOf(spec, skel);
          const where = `${kind} ${spec.species} seed ${spec.seed} ${clip} yaw ${yaw.toFixed(2)}`;
          assert.ok(finite(caps) && caps.length <= MAX_CAPSULES, `capsules: ${where}`);
          const F = featurePoints(caps);
          const f = frontOf(yaw);
          assert.ok(dot(sub(F.face, F.head), f) > 0, `face on the front of the head: ${where}`);
          for (const k of Object.keys(F).filter((q) => q.startsWith("toe."))) assert.ok(dot(sub(F[k], F[`heel.${k.slice(4)}`]), f) > 0, `${k} ahead of its heel: ${where}`);
          if (spec.plan === "humanoid") assert.ok(dot(sub(F["hand.R"], F["hand.L"]), rightOf(yaw)) > 0, `right hand right of the left: ${where}`);
          const seen = frontOfEntity(caps, { yaw });
          assert.ok(seen.agrees && seen.error < 0.5, `seen front off by ${seen.error.toFixed(2)} (${seen.why}): ${where}`);
        }
      }
    }
  }
});

test("the same seed makes the same entity, capsule for capsule", () => {
  for (const kind of KINDS) {
    for (const seed of ["0", "7", "0xbeef", "a runner"]) {
      const a = entityOf(seed, { kind });
      const b = entityOf(seed, { kind });
      assert.deepEqual(a, b);
      for (const clip of Object.keys(clipsFor(a))) {
        const o = { yaw: 1.1, phase: 0.4, t: 2.5, params: { speed: 7, wall: 1 } };
        assert.deepEqual(skinOf(a, posed(a, clip, o)), skinOf(b, posed(b, clip, o)));
      }
    }
  }
  // (Different seeds really differ.)
  const looks = new Set(SEEDS.slice(0, 40).map((s) => JSON.stringify(entityOf(s, { kind: "anthro" }).choices)));
  assert.equal(looks.size, 40);
});

test("pinning a choice moves nothing that doesn't read it", () => {
  const other = (ch, c) => {
    const opts = ch.optionsOf ? ch.optionsOf(c) : ch.options;
    if (opts) return opts.find((o) => o !== c[ch.name]);
    if (typeof c[ch.name] === "number") return c[ch.name] * 0.97;
    return undefined;
  };
  for (const kind of KINDS) {
    for (const seed of SEEDS.slice(0, 40)) {
      const base = entityOf(seed, { kind });
      for (const ch of CHOICES) {
        if (ch.name === "kind") continue;
        const v = other(ch, base.choices);
        if (v === undefined) continue;
        const pinned = entityOf(seed, { kind, pins: { [ch.name]: v } });
        assert.deepEqual(pinned.choices[ch.name], v);
        const reads = new Set([...CHOICES.filter((c) => readsOf(c.name).has(ch.name)).map((c) => c.name), ch.name]);
        for (const c of CHOICES) {
          if (reads.has(c.name)) continue;
          assert.deepEqual(pinned.choices[c.name], base.choices[c.name], `${kind} seed ${seed}: pinning ${ch.name} moved ${c.name}`);
        }
      }
    }
  }
  // The runner's look, pinned; everything else still the seed's.
  const r = entityOf("9", { kind: "anthro", species: "cat", pins: { top: "jacket", pack: "round" } });
  assert.equal(r.species, "cat");
  assert.equal(r.outfit.pack, "round");
  assert.equal(r.choices.height, entityOf("9", { kind: "anthro" }).choices.height);
  assert.deepEqual(r.pinned, ["kind", "pack", "species", "top"]);
  // Aliases, and pins that can't be.
  assert.equal(entityOf("1", { kind: "animal", species: "bunny" }).species, "rabbit");
  assert.equal(entityOf("1", { kind: "anthro", species: "rabbit" }).species, "bunny");
  assert.throws(() => entityOf("1", { kind: "animal", species: "frog" }), RangeError);
  assert.throws(() => entityOf("1", { pins: { wings: 2 } }), TypeError);
});

test("every species of every kind can be made, and a size pin sets the size", () => {
  for (const kind of KINDS) {
    for (const [sp] of SPECIES[kind]) {
      const s = entityOf("3", { kind, species: sp });
      assert.equal(s.species, sp);
      assert.equal(s.plan, kind === "animal" ? "quadruped" : "humanoid");
      const caps = skinOf(s, posed(s, "idle"));
      assert.ok(caps.length <= MAX_CAPSULES && finite(caps));
    }
  }
  const tall = entityOf("3", { kind: "humanoid", size: 1.8 });
  const top = Math.max(...skinOf(tall, posed(tall, "idle")).map((c) => Math.max(c.a[1], c.b[1]) + c.r));
  assert.ok(Math.abs(top - 1.8) < 0.1, `a 1.8 person stands about 1.8 tall (${top.toFixed(3)})`);
  assert.equal(entityOf("3", { kind: "animal", size: 0.4 }).body.shoulderH, 0.4);
});

test("materials come from the caller's table by role, with fallbacks", () => {
  const spec = entityOf("5", { kind: "anthro", pins: { pants: "long", top: "jacket" } });
  const caps = skinOf(spec, posed(spec, "idle"), { fur: 20, cloth: 21, clothAlt: 22, accent: 23, dark: 24, blush: 25, furAlt: 26, hair: 27 });
  const byPart = Object.fromEntries(caps.map((c) => [c.part, c]));
  assert.equal(byPart.head.mat, 20);
  assert.equal(byPart.chest.mat, 21);
  assert.equal(byPart["thigh.L"].mat, 22);
  assert.equal(byPart["eye.R"].mat, 24);
  // Only fur given: everything falls back to it (or to 0 for the dark roles with no dark).
  assert.equal(materialFor("clothAlt", { fur: 6, dark: 3 }), 3);
  assert.equal(materialFor("accent", { fur: 6 }), 6);
  assert.equal(materialFor("hair", {}), 0);
});

test("frontOfEntity: declared, from a skeleton, and a wrongly turned model is caught", () => {
  const spec = entityOf("11", { kind: "anthro" });
  assert.equal(frontOfEntity(spec).yaw, 0);
  assert.deepEqual(frontOfEntity(spec).dir, [0, 0, 1]);
  const skel = posed(spec, "idle", { yaw: 2 });
  assert.ok(Math.abs(frontOfEntity(skel).yaw - 2) < 1e-12);
  const caps = skinOf(spec, skel);
  const good = frontOfEntity(caps, { yaw: 2 });
  assert.ok(good.agrees && good.confidence > 0.95, good.why);
  // Turned half round about its centre: the reading turns with it, and disagrees with yaw 2.
  const c = featurePoints(caps).centre;
  const turn = (p) => [2 * c[0] - p[0], p[1], 2 * c[2] - p[2]];
  const back = caps.map((q) => ({ ...q, a: turn(q.a), b: turn(q.b) }));
  const bad = frontOfEntity(back, { yaw: 2 });
  assert.ok(!bad.agrees && bad.error > 2.8, `a model facing backwards is caught (${bad.error})`);
  // Mirrored (left and right swapped, the face still ahead): the cues split and the confidence drops.
  const f = frontOf(2);
  const r = rightOf(2);
  const mirror = (p) => { const d = sub(p, c); const k = 2 * dot(d, r); return [p[0] - r[0] * k, p[1], p[2] - r[2] * k]; };
  const mirrored = caps.map((q) => ({ ...q, a: mirror(q.a), b: mirror(q.b) }));
  const m = frontOfEntity(mirrored, { yaw: 2 });
  assert.ok(m.confidence < 0.8 && /DISAGREEING/.test(m.why), `a mirrored rig is caught: ${m.why}`);
  assert.ok(Math.abs(yawOf(f) - 2) < 1e-12);
});
