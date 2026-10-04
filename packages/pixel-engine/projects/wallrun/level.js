// A WALLRUN course from a seed: the reference's world -- tall checker-tiled
// walls and pads standing in dark water that glows where it meets them, a
// lid of cloud -- laid out as a run: a start pad among the maze, a corridor
// of walls over water to run along, a rail arcing across open water, a few
// pads to hop, a dark tunnel, a plaza at the end. The route is written down
// too (where to steer, what to do there), so the course can play itself.
//
// Everything in it is an engine object (src/object): pads, walls, pillars,
// the rail on its posts, the tunnel, and the props on the plaza -- lamp
// posts, benches, crates, a sign -- each with its front, its sockets and its
// colliders, baked once into the boxes and capsules physics and the renderer
// share. (The course's own draws come from `${seed}|level` in the same order
// they always did; the props draw from `${seed}|props`, so dressing the plaza
// never moves the course.)

import { buildPieceFrom } from "../../src/object/catalogue.js";
import { bakeForPhysics, bakeForRenderer, footprint, placeObject, settle, yawToShow } from "../../src/object/object.js";
import { streamOf } from "./seed.js";

// Piece materials -> WALLRUN's materials (palette.js).
export const PIECE_MATS = { wall: 0, floor: 1, trim: 0, rail: 2, metal: 2, dark: 3, wood: 14, paint: 8, glow: 15 };
const SINK = 3; // (everything stands in the water this deep)

export function levelOf(seed) {
  const S = streamOf(`${seed}|level`);
  const P = streamOf(`${seed}|pieces`); // (the pieces' own draws; every size given here overrides them)
  const objects = [];
  const route = []; // { p: [x, y, z], act: "run" | "jump" | "wall" | "rail" }
  const top = 0.35; // (pads stand this far out of the water)
  const put = (key, ctx, pos, yaw = 0) => { const o = placeObject(buildPieceFrom(key, P, ctx), { pos, yaw, id: `${key}${objects.length}` }); objects.push(o); return o; };
  // (A floor: a pad from the bottom of the water to `y`.)
  const floor = (x0, x1, z0, z1, y = top) => put("pad", { w: x1 - x0, d: z1 - z0, h: y + SINK, lip: false }, [(x0 + x1) / 2, -SINK, (z0 + z1) / 2]);
  // (A wall along z at x: a wall piece turned a quarter, so its length runs down the course.)
  const wall = (x, z0, z1, h, thick = 0.5) => put("wall", { length: z1 - z0, h: h + SINK, thick }, [x, -SINK, (z0 + z1) / 2], Math.PI / 2);
  const pillar = (x, z, w, d, h) => put("pillar", { w, d, h: h + SINK }, [x, -SINK, z]);

  // 1. The start: a pad among tall maze walls.
  floor(-7, 7, -8, 12);
  for (let i = 0; i < 7; i += 1) {
    const side = i % 2 ? 1 : -1;
    pillar(side * S.between(8, 16), S.between(-10, 20), S.between(0.6, 3.5), S.between(3, 10), S.between(6, 13));
  }
  pillar(S.between(-3, 3), -9, S.between(4, 8), 0.6, S.between(6, 10));
  route.push({ p: [0, top, -4], act: "run" }, { p: [0, top, 10], act: "run" });
  let z = 12;

  // 2. The corridor: walls either side, water between -- run along one, kick across, run the other.
  const cw = S.between(2.6, 3.4);
  const clen = S.between(15, 21);
  const side = S.pick([-1, 1]);
  wall(-cw, z - 1, z + clen, S.between(8, 12));
  wall(cw, z - 1, z + clen + 1, S.between(8, 12));
  route.push(
    { p: [side * (cw - 0.7), top + 1.2, z + 2], act: "wall" }, { p: [side * (cw - 0.7), top + 1.2, z + clen * 0.45], act: "wall" },
    { p: [-side * (cw - 0.7), top + 1.2, z + clen * 0.62], act: "wall" }, { p: [-side * (cw - 0.7), top + 1, z + clen - 1], act: "wall" },
  );
  z += clen;
  floor(-4.5, 4.5, z, z + 9);
  route.push({ p: [0, top, z + 3], act: "run" });
  pillar(-6.5, z + 4, 1.2, 7, S.between(7, 11));
  z += 9;

  // 3. A rail across the open water on its posts, bending and rising a little.
  // (Eased: it leaves and arrives straight and level, so a runner comes off it pointing down the course.)
  const rlen = S.between(18, 26);
  const bend = S.pick([-1, 1]) * S.between(3, 7);
  const rise = S.between(0.4, 1.6);
  const railObj = put("rail", { length: rlen, bend, rise, y: 1.15, segments: 12, shape: "ease" }, [0, 0, z + 1.5]);
  const rail = railObj.def.rails[0].map((p) => [p[0], p[1], p[2] + z + 1.5]);
  route.push({ p: [0, top, z - 1.5], act: "jump" }, { p: rail[1], act: "rail" }, { p: rail[rail.length - 2], act: "rail" });
  z += rlen + 3;
  floor(-3.5, 3.5, z, z + 7);
  route.push({ p: [0, top, z + 3.5], act: "run" });
  z += 7;

  // 4. Pads to hop, stepping about.
  const hops = S.int(3, 5);
  let x = 0;
  for (let i = 0; i < hops; i += 1) {
    const gap = S.between(2.2, 3.4);
    const w = S.between(2.6, 3.6);
    const y = top + S.between(-0.1, 0.9);
    x = Math.max(-5, Math.min(5, x + S.between(-2.5, 2.5)));
    z += gap;
    floor(x - w / 2, x + w / 2, z, z + w, y);
    route.push({ p: [x, y, z - 0.6], act: "jump" }, { p: [x, y, z + w / 2], act: "run" });
    z += w;
  }

  // 5. A tunnel: walls, a roof, dark inside. (Its mouth lines up with the last pad, so the way in is straight.)
  z += 2.5;
  const tlen = S.between(11, 16);
  const tx = x;
  floor(tx - 3.2, tx + 3.2, z - 2.8, z + tlen);
  // (Walls from the water's bottom; the roof's underside 3.35 above the pads, as dark as the reference's.)
  put("tunnel", { length: tlen, span: 4.9, h: 3.35 + SINK, thick: 0.5, roof: 0.7, floor: false }, [tx, -SINK, z + tlen / 2], Math.PI);
  route.push({ p: [tx, top, z - 1.5], act: "run" }, { p: [tx, top, z + tlen / 2], act: "run" }, { p: [tx * 0.5, top, z + tlen], act: "run" });
  z += tlen;

  // 6. The plaza at the end, the maze round it again.
  const plaza = floor(-10, 10, z, z + 16);
  for (let i = 0; i < 5; i += 1) pillar(S.pick([-1, 1]) * S.between(11, 18), z + S.between(0, 16), S.between(0.6, 3), S.between(3, 9), S.between(6, 12));
  route.push({ p: [0, top, z + 12], act: "run" });
  dressPlaza(`${seed}|props`, objects, plaza, [0, top, z], P);

  const { boxes, rails } = bakeForPhysics(objects, { mats: PIECE_MATS });
  const { capsules } = bakeForRenderer(objects, { mats: PIECE_MATS });
  return { objects, boxes, rails, capsules, route, waterY: 0, spawn: [0, top + 0.1, -5], end: z + 16 };
}

// The plaza's props, off the runner's line (|x| >= 4): lamp posts reaching over
// it, benches and a sign turned to show their fronts to someone coming out of
// the tunnel, crates by the pillars. Each settles onto the plaza -- nothing floats.
function dressPlaza(seed, objects, plaza, [cx, top, z0], P) {
  const S = streamOf(seed);
  const comer = [cx, top + 1.2, z0 - 2]; // (where a runner comes out of the tunnel: what's shown faces them)
  const place = (key, ctx, x, z, yaw = null) => {
    const def = buildPieceFrom(key, P, ctx);
    const pos = [x, top + 2, z];
    const { instance: inst, rests } = settle(placeObject(def, { pos, yaw: yaw ?? yawToShow(def, pos, comer), id: `${key}${objects.length}` }), [plaza]);
    if (!rests) return null;
    const f = footprint(inst).rect;
    if (objects.some((o) => o !== plaza && o.def.tags.includes("prop") && overlapXZ(f, footprint(o).rect))) return null;
    objects.push(inst);
    return inst;
  };
  for (const sx of [-1, 1]) if (S.chance(0.85)) place("lampPost", {}, sx * S.between(5, 8), z0 + S.between(2, 13), sx > 0 ? -Math.PI / 2 : Math.PI / 2);
  for (let i = 0; i < S.int(1, 2); i += 1) place("bench", {}, S.pick([-1, 1]) * S.between(4.5, 8.5), z0 + S.between(4, 14));
  if (S.chance(0.7)) place("sign", {}, S.pick([-1, 1]) * S.between(4.5, 7), z0 + S.between(6, 12));
  for (let i = 0; i < S.int(1, 4); i += 1) place("crate", {}, S.pick([-1, 1]) * S.between(4.5, 9.5), z0 + S.between(1, 15), S.between(0, Math.PI));
}

const overlapXZ = (a, b) => a[0] < b[2] + 0.3 && a[2] > b[0] - 0.3 && a[1] < b[3] + 0.3 && a[3] > b[1] - 0.3; // (rects [x0, z0, x1, z1], a hand apart)
