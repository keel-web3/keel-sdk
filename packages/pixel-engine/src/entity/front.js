// Fronts of entities: which way a thing faces, declared and seen.
//
// The declared front is the convention (core/frame.js): an entity's own +z,
// its right hand on +x. The SEEN front is read off the features a skin put on
// -- where the face is against the body, which way the eyes' left-to-right
// runs, which way the toes point, which side the right hand is on -- so a
// wrongly turned model (a face on its back, a mirrored rig) shows up as a
// disagreement instead of a bug report.
//
//   frontOfEntity(spec)                    -> { yaw: 0, dir: [0,0,1], confidence: 1, why: "declared ..." }
//   frontOfEntity(capsules)                -> read off the parts (any yaw)
//   frontOfEntity(capsules, { yaw })       -> ... and checked against the yaw you meant: .agrees, .error

import { frontOf, yawOf } from "../core/frame.js";
import { declaredFront } from "./rig.js";

const TORSO = new Set(["hips", "chest"]);
const FACE = (p) => p === "nose" || p === "snout" || p.startsWith("eye.");
const UP = [0, 1, 0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const flat = (v) => { const l = Math.hypot(v[0], v[2]); return l > 1e-12 ? [v[0] / l, 0, v[2] / l] : null; };
const mid = (c) => [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];

/** Where the named features are, from a skin: centres, plus toe.* (the b end of each foot.* / paw.*) and ankle.* (its a end). */
export function featurePoints(caps) {
  const out = {};
  // (The body's centre: a quadruped's spine capsule alone -- its chest ball would pull it forward --
  // or a two-legged body's pelvis and chest together.)
  const torso = caps.some((c) => c.part === "body") ? new Set(["body"]) : TORSO;
  const sums = {};
  const push = (k, p, w = 1) => { const s = (sums[k] ??= [0, 0, 0, 0]); s[0] += p[0] * w; s[1] += p[1] * w; s[2] += p[2] * w; s[3] += w; };
  for (const c of caps) {
    push(c.part, mid(c));
    const m = /^(foot|paw)\.(.+)$/.exec(c.part);
    if (m) { push(`toe.${m[2]}`, c.b); push(`heel.${m[2]}`, c.a); }
    if (FACE(c.part)) push("face", mid(c), c.r);
    if (torso.has(c.part)) push("centre", mid(c), c.r ** 3);
  }
  for (const [k, s] of Object.entries(sums)) out[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  return out;
}

/**
 * frontOfEntity(spec | skeleton | capsules, { yaw }) -> { yaw, dir, confidence, why, cues, agrees?, error? }
 *   spec       the declared front (own frame: yaw 0)
 *   skeleton   the declared front of a posed skeleton (its heading)
 *   capsules   the seen front, from the face, the eyes, the toes and the hands
 * confidence: 0..1, how much the cues agree (1: all point the same way).
 */
export function frontOfEntity(thing, { yaw: meant } = {}) {
  let res;
  if (Array.isArray(thing)) res = seenFront(thing);
  else if (thing?.bones && thing?.root) { const dir = declaredFront(thing); res = { yaw: yawOf(dir), dir, confidence: 1, why: "declared: the skeleton's heading (own +z)", cues: [] }; }
  else if (thing?.front) res = { yaw: 0, dir: [...thing.front.dir], confidence: 1, why: "declared: own +z is the front, +x the right hand (core/frame.js)", cues: [] };
  else throw new TypeError("frontOfEntity wants a spec, a posed skeleton or a list of capsules.");
  if (meant !== undefined) {
    const f = frontOf(meant);
    const d = res.dir[0] * f[0] + res.dir[2] * f[2];
    res.error = Math.acos(Math.max(-1, Math.min(1, d)));
    res.agrees = d > Math.cos(Math.PI / 4);
  }
  return res;
}

function seenFront(caps) {
  const F = featurePoints(caps);
  const cues = [];
  const cue = (name, v, weight) => { const d = v && flat(v); if (d) cues.push({ name, dir: d, weight }); };
  const centre = F.centre ?? F.head;
  // The face against the body (the strongest cue: a face is where it looks).
  if (F.face && centre) cue("face ahead of the body", sub(F.face, centre), 3);
  if (F.face && F.head) cue("face on the front of the head", sub(F.face, F.head), 2);
  // Eyes run left to right: front = right x up.
  if (F["eye.L"] && F["eye.R"]) cue("eyes left-to-right", cross(sub(F["eye.R"], F["eye.L"]), UP), 2);
  // Toes ahead of their heels.
  let toes = null;
  for (const k of Object.keys(F)) {
    if (!k.startsWith("toe.")) continue;
    const v = sub(F[k], F[`heel.${k.slice(4)}`]);
    toes = toes ? [toes[0] + v[0], toes[1] + v[1], toes[2] + v[2]] : v;
  }
  cue("toes ahead of heels", toes, 1.5);
  // The right hand on the right: front = right x up.
  if (F["hand.L"] && F["hand.R"]) cue("right hand on the right", cross(sub(F["hand.R"], F["hand.L"]), UP), 1);
  if (!cues.length) return { yaw: 0, dir: [0, 0, 1], confidence: 0, why: "no face, eyes, toes or hands to read", cues };
  let x = 0;
  let z = 0;
  let wsum = 0;
  for (const c of cues) { x += c.dir[0] * c.weight; z += c.dir[2] * c.weight; wsum += c.weight; }
  const l = Math.hypot(x, z);
  const dir = l > 1e-12 ? [x / l, 0, z / l] : [0, 0, 1];
  const against = cues.filter((c) => c.dir[0] * dir[0] + c.dir[2] * dir[2] < 0).map((c) => c.name);
  const why = `seen: ${cues.map((c) => c.name).join(", ")}${against.length ? `; DISAGREEING: ${against.join(", ")}` : "; all agree"}`;
  return { yaw: yawOf(dir), dir, confidence: l / wsum, why, cues };
}
