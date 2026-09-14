// The valley's units and objects as sprites, from THREE sprite streams --
// the bake is keyed by pitch, so each camera angle is its own stream:
//
//   far    the overview's steep angle, 8 directions, 2..19 px/m: thousands of
//          units small; a dot (under DOT_PX) is its body only
//   near   the close zoom's lower, tactical angle, 16 directions, 13..128 px/m:
//          a unit a good part of the screen, every clip (walk, run, attack),
//          dressed
//   eye    a perspective view's billboards (chase, first person): nearly level,
//          16 directions, 2..76 px/m, baked at the size a unit shows at where it
//          turns from a solid to a billboard (farther ones drawn smaller)
//
// A perspective view draws each billboard from the lane baked nearest the
// angle it's seen at -- level ones from "eye", ones seen from above (the
// dolly's start, a unit below a cliff) from "near" or "far" -- so a sprite is
// never seen from an angle it wasn't drawn for.
//
// Each stream is examples/army's smart loader (visible first, the rest while
// playing, stand-ins -- never a box) into its own shelf atlas; the three share
// the sprite renderer's page array (each stream its own range of pages), and
// one bake worker serves them all.

import {
  IDLE_PERIOD, LAYER_INSTANCE_FLOATS, STREAM_LUT, WORN_SLOT, createSpriteStream, dressPopulation, paintRoles, paintSlots,
} from "@keel/game-engine/bake";
import type { BakeSource, DesignSpec, IndexedSource, LayerInstances, LayerPaint, LookTable, Population, PopulationShapes, SpriteRenderer, SpriteStream, StreamDesign } from "@keel/game-engine/bake";
import { DOT_PX, zoomLadder } from "@keel/game-engine/view";
import { GAIT } from "./units.ts";
import type { Units } from "./units.ts";

export const MAXC = 5, MAXF = 8, MAXW = 3, SOCK = 12;
const TAU = Math.PI * 2;
const ATTACK_TIME = 0.62;

/** A stream's camera: its pitch, directions and ladder; its share of texture memory (pages of 2048²). */
export interface StreamSpec { readonly name: "far" | "near" | "eye"; readonly pitch: number; readonly dirs: number; readonly ladder: readonly number[]; readonly pages: number }
export const STREAMS: readonly StreamSpec[] = [
  { name: "far", pitch: 0.72, dirs: 8, ladder: zoomLadder(2, 128).filter((k) => k <= 19), pages: 2 },
  { name: "near", pitch: 0.5, dirs: 16, ladder: zoomLadder(2, 128).filter((k) => k >= 13), pages: 9 },
  { name: "eye", pitch: 0.14, dirs: 16, ladder: zoomLadder(2, 128).filter((k) => k <= 76), pages: 3 },
];
export const PAGE_SIZE = 2048;
/** The largest scale trees and props are baked at (px/m). */
export const OBJECT_MAX_K = 48;
/**
 * Trees and props as perspective billboards come in three baked sizes: each object has two more slots, capped at
 * these scales (the stream's maxScale) -- so a tree 60 m off is drawn from its 8 px/m bake, one 15 m off from its
 * 16, a near one from the lane's own -- texels about a pixel each at every distance, never a big bake shrunk to
 * a shimmer or a small one blown up to blocks.
 */
export const BILLBOARD_CAPS = [8, 16] as const;
export const TOTAL_PAGES = STREAMS.reduce((n, s) => n + s.pages, 0);
const PAGE_BASE = STREAMS.map((_, i) => STREAMS.slice(0, i).reduce((n, s) => n + s.pages, 0));

// The dither screen by scale: tiny sprites want the 2x2 screen, bigger ones 4x4.
export const screenFor = (k: number): number => (k <= 12 ? 2 : 4);
export const plainStyle = (k: number) => ({ screen: screenFor(k), dither: 0.9, outline: 1 });

/** What a bake draws from: indexed shapes (bodies, wearables) and plain designs (the level's objects). */
export interface MobDesigns {
  readonly shapes: PopulationShapes;
  readonly objects: ReadonlyArray<DesignSpec & BakeSource>;
}

/** Per stream: the stream, its socket records, per body and gait the slot of that clip's frame 0. */
interface Lane {
  readonly spec: StreamSpec;
  readonly stream: SpriteStream;
  readonly rec: Float32Array;
  readonly gaitSlot: Int32Array;
  readonly cosP: number;
  readonly base: number;
  /** Its largest rung trees and props are baked at. */
  readonly top: number;
}

export interface Mobs {
  readonly B: number;
  readonly A: number;
  readonly O: number;
  readonly lanes: readonly Lane[];
  readonly shapes: PopulationShapes;
  readonly pop: Population | null;
  /** Per unit: body, look, wearables (shape, look, socket), animation layer; its body's and wearables' paints (for 3D). */
  readonly unitBody: Uint16Array;
  readonly unitLook: Uint32Array;
  readonly wearN: Uint8Array;
  readonly wearShape: Int32Array;
  readonly wearLook: Uint32Array;
  readonly wearSocket: Uint8Array;
  readonly unitPaint: LayerPaint[];
  readonly wearPaint: LayerPaint[];
  /** Per body: its clips by gait (idle, walk, run, attack) and their cycle, period, frames. */
  readonly clipIndex: Int8Array;
  readonly maxHeight: number;
  /** Paint every unit's look (the look pools: slower than the shapes, so after the bake has begun). */
  dress(): void;
  readonly dressed: boolean;
  /** Pages the sprite renderer must hold. */
  readonly pages: number;
  /** The stream for a lane at a scale: set its scale (a rung of its own ladder). */
  setScale(lane: number, k: number, now: number): number;
  /** Frame bookkeeping. */
  begin(now: number): void;
  update(now: number): void;
  /** One unit's layers into `inst` for an orthographic view through lane `li` (k: the view's scale). False if nothing drawn. */
  pushOrtho(li: number, inst: LayerInstances, i: number, x: number, y: number, z: number, camYaw: number, k: number, t: number): boolean;
  /** One unit as a billboard from lane `li` (the one baked nearest the angle it's seen at), drawn at `k` px/m (its on-screen scale), dissolved by `fade`. */
  pushBillboard(li: number, inst: LayerInstances, i: number, x: number, y: number, z: number, viewYaw: number, k: number, t: number, fade: number): boolean;
  /** The lane whose pitch is nearest an elevation (radians the eye looks down at a thing). */
  laneFor(elevation: number): number;
  /** An object (design index O-relative) as a sprite: ortho (lane, k) or billboard (k, fade; `billboard`: from the baked size nearest k). */
  pushObject(li: number, inst: LayerInstances, o: number, x: number, y: number, z: number, k: number, scale: number, fade?: number, billboard?: boolean): boolean;
  /** Counters for the last frame: layers wanted, crisp (at the view's rung), exact, drawn. */
  readonly frame: { wanted: number; crisp: number; exact: number; drawn: number };
  resetFrame(): void;
  /** Every design, by key, for a bake (what the worker also builds from the seed). */
  readonly sources: { indexed: Map<string, IndexedSource>; plain: Map<string, BakeSource> };
  stats(): Array<ReturnType<SpriteStream["stats"]> & { lane: string }>;
}

export function createMobs(designs: MobDesigns, units: Units, table: LookTable, sr: SpriteRenderer): Mobs {
  const p = designs.shapes;
  const B = p.bodies.length, A = p.attributes.length, O = designs.objects.length;
  const specs: DesignSpec[] = [...p.bodies, ...p.attributes, ...designs.objects, ...BILLBOARD_CAPS.flatMap(() => designs.objects)];
  const plainKeys = new Set(designs.objects.map((d) => d.key));
  const sources = {
    indexed: new Map<string, IndexedSource>([...p.bodies, ...p.attributes].map((d) => [d.key, d])),
    plain: new Map<string, BakeSource>(designs.objects.map((d) => [d.key, d])),
  };
  // Who wears what, where (in socket order).
  const N = p.units.length;
  const unitBody = new Uint16Array(N), unitLook = new Uint32Array(N), wearN = new Uint8Array(N);
  const wearShape = new Int32Array(N * MAXW).fill(-1), wearLook = new Uint32Array(N * MAXW), wearSocket = new Uint8Array(N * MAXW);
  const unitStride = Float32Array.from(p.units, (u) => u.anim.stride), unitIdle = Float32Array.from(p.units, (u) => IDLE_PERIOD[u.anim.idle] ?? 1), unitPhase = Float32Array.from(p.units, (u) => u.anim.phase);
  const unitPaint: LayerPaint[] = new Array<LayerPaint>(N), wearPaint: LayerPaint[] = new Array<LayerPaint>(N * MAXW);
  const quad = p.bodies.map((b) => b.spec.plan === "quadruped");
  const gaitClips = p.bodies.map((_, i) => (quad[i] ? ["idle", "walk", "trot", "attack"] : ["idle", "walk", "run", "attack"]));
  const clipIndex = new Int8Array(B * MAXC).fill(-1), cyc = new Float32Array(B * MAXC), per = new Float32Array(B * MAXC).fill(1), nfr = new Uint8Array(B * MAXC).fill(1);
  p.bodies.forEach((d, i) => gaitClips[i]!.forEach((name, g) => {
    const ci = d.clips.findIndex((c) => c.name === name);
    if (ci < 0) return;
    const info = d.clip(name);
    clipIndex[i * MAXC + g] = ci;
    cyc[i * MAXC + g] = info.cycle; per[i * MAXC + g] = info.period; nfr[i * MAXC + g] = info.frames;
  }));
  const maxHeight = Math.max(2, ...specs.map((d) => d.height));
  p.units.forEach((u, i) => {
    unitBody[i] = u.body;
    const worn = u.wears.slice().sort((x, y) => (p.attributes[x.shape]!.socket < p.attributes[y.shape]!.socket ? -1 : 1));
    wearN[i] = Math.min(MAXW, worn.length);
    worn.slice(0, MAXW).forEach((w, j) => { wearShape[i * MAXW + j] = w.shape; });
  });
  const lift = Float32Array.from(p.attributes, (a) => a.lift);

  // The streams: every design in each (weights: bodies by how many wear them).
  const bodyN = new Float64Array(B), wearCount = new Float64Array(A);
  for (const u of p.units) { bodyN[u.body] = bodyN[u.body]! + 1; for (const w of u.wears) wearCount[w.shape] = wearCount[w.shape]! + 1; }
  const maxB = Math.max(1, ...bodyN), maxA = Math.max(1, ...wearCount);
  const streamDesigns = specs.map((spec, i): StreamDesign => {
    // (A body may stand in from a bake up to 3x smaller -- chunky for a moment, never missing -- while a close zoom's
    // frames bake; a hat only 1.5x: blown up further it's a box.)
    if (i < B) return { spec, weight: bodyN[i]! / maxB, hints: { kind: "entity" }, upscale: 3 };
    if (i < B + A) return { spec, weight: wearCount[i - B]! / maxA, hints: { kind: "attribute" }, upscale: 1.5 };
    // (Trees and props are baked no closer than OBJECT_MAX_K: past it, that bake drawn bigger; their billboard sizes
    // after them, capped smaller -- only a perspective view asks for those.)
    const tier = Math.floor((i - B - A) / O);
    return { spec, hints: { kind: "prop" }, maxScale: tier === 0 ? OBJECT_MAX_K : BILLBOARD_CAPS[tier - 1]!, ...(tier > 0 ? { weight: 0.3 } : {}) };
  });
  let reserved = false;
  const lanes: Lane[] = STREAMS.map((spec, li) => {
    const base = PAGE_BASE[li]!;
    const stream = createSpriteStream({
      designs: streamDesigns, ladder: spec.ladder, directions: spec.dirs, pitch: spec.pitch, memory: spec.pages * PAGE_SIZE * PAGE_SIZE * 4, pageSize: PAGE_SIZE,
      style: (d, s) => (plainKeys.has(d.key) ? JSON.stringify(plainStyle(s)) : "indexed"),
      // (The three streams share one page array, reserved whole the first time: it's never regrown and copied.)
      onPages: () => { if (!reserved) { sr.reservePages(TOTAL_PAGES, PAGE_SIZE); reserved = true; } },
      onWrite: (r, rgba) => sr.writeSprite(base + r.page, r.x, r.y, r.w, r.h, rgba),
    });
    const records = p.bodies.map((b) => b.records(spec.dirs, spec.pitch));
    if (Math.max(...records.map((r) => r.sockets.length)) > SOCK) throw new Error("More sockets than the lookup has room for.");
    const D = spec.dirs;
    const rec = new Float32Array(B * MAXC * MAXF * D * SOCK * 2);
    records.forEach((r, bi) => { for (let c = 0; c < Math.min(MAXC, p.bodies[bi]!.clips.length); c += 1) for (let f = 0; f < Math.min(MAXF, p.bodies[bi]!.clips[c]!.frames); f += 1) for (let d = 0; d < D; d += 1) for (let sk = 0; sk < r.sockets.length; sk += 1) {
      const from = r.at(c, f, d, sk), to = (((((bi * MAXC + c) * MAXF + f) * D) + d) * SOCK + sk) * 2;
      rec[to] = r.data[from]!; rec[to + 1] = r.data[from + 1]!;
    } });
    const gaitSlot = new Int32Array(B * MAXC);
    for (let b = 0; b < B; b += 1) for (let g = 0; g < MAXC; g += 1) { const c = clipIndex[b * MAXC + g]!; gaitSlot[b * MAXC + g] = c >= 0 ? stream.clipBase(b, c) : stream.base[b]!; }
    return { spec, stream, rec, gaitSlot, cosP: Math.cos(spec.pitch), base, top: Math.max(...spec.ladder.filter((k) => k <= OBJECT_MAX_K)) };
  });
  // Socket index per unit's wearable (the same in every lane: records list sockets by name).
  const sockNames = p.bodies.map((b) => b.records(8, 0.6).sockets);
  p.units.forEach((u, i) => { for (let j = 0; j < wearN[i]!; j += 1) wearSocket[i * MAXW + j] = sockNames[u.body]!.indexOf(p.attributes[wearShape[i * MAXW + j]!]!.socket); });

  let pop: Population | null = null;
  const frameStats = { wanted: 0, crisp: 0, exact: 0, drawn: 0 };

  // The frame a unit shows (its own stride over the ground; its own idle style and phase; an attack by its time).
  const frameOf = (i: number, ci: number, g: number, t: number): number => {
    const frames = nfr[ci]!;
    let u: number;
    if (g === GAIT.attack) u = Math.min(0.999, units.actionT[i]! / ATTACK_TIME);
    else { const c = cyc[ci]!; u = c > 0 ? units.dist[i]! / (c * unitStride[i]!) : t / (per[ci]! * unitIdle[i]!) + unitPhase[i]!; u -= Math.floor(u); }
    const f = Math.floor(u * frames);
    return f >= frames ? frames - 1 : f;
  };
  const gaitOf = (i: number, b: number): number => { const g = units.gait[i]!; return clipIndex[b * MAXC + g]! >= 0 ? g : GAIT.walk; };

  /** Body then wearables, anchored at the unit's ground point; `s0` the draw scale for this view (k / baked). */
  function push(lane: Lane, inst: LayerInstances, i: number, x: number, y: number, z: number, rel: number, k: number, t: number, bias: number, fade: number, perspective: boolean): boolean {
    const st = lane.stream, D = lane.spec.dirs;
    const seen = st.seen, lut = st.lut, ex = st.exact, stamp = st.stamp, wb = st.base;
    const b = unitBody[i]!;
    const g = gaitOf(i, b);
    const ci = b * MAXC + g;
    const f = frameOf(i, ci, g, t);
    let r = rel / TAU;
    r -= Math.floor(r);
    const dir = Math.round(r * D) % D;
    const slot = lane.gaitSlot[ci]! + f * D + dir;
    seen[slot] = stamp;
    // (A dot: its body only -- a hat on a four-pixel unit is noise.)
    const px = p.bodies[b]!.height * (perspective ? 1 : lane.cosP) * k;
    const nw = px < DOT_PX ? 0 : wearN[i]!;
    const w0 = i * MAXW;
    for (let j = 0; j < nw; j += 1) seen[wb[B + wearShape[w0 + j]!]! + dir] = stamp;
    frameStats.wanted += 1 + nw;
    const o = slot * STREAM_LUT;
    const s = lut[o + 7]!;
    // (No bake of this body at any scale it may be drawn from: the unit waits a frame. Never a box.)
    if (!s || inst.count + 1 + nw > inst.capacity) return false;
    // (Crisp: at the view's own scale -- or, for a billboard, baked within an eighth of the size it shows at.)
    const crispS = perspective ? Math.abs(k / s - 1) < 0.125 : s === st.scale;
    if (crispS) { frameStats.crisp += 1; if (ex[slot] || perspective) frameStats.exact += 1; }
    frameStats.drawn += 1;
    const D2 = inst.data;
    let q = inst.count * LAYER_INSTANCE_FLOATS;
    D2[q] = x; D2[q + 1] = y; D2[q + 2] = z; D2[q + 3] = lut[o]!; D2[q + 4] = lut[o + 1]!; D2[q + 5] = lut[o + 2]!; D2[q + 6] = lut[o + 3]!; D2[q + 7] = lut[o + 4]!; D2[q + 8] = lut[o + 5]!;
    D2[q + 9] = lut[o + 6]! + lane.base; D2[q + 10] = unitLook[i]!; D2[q + 11] = bias; D2[q + 12] = k / s; D2[q + 13] = fade;
    inst.count += 1;
    // (Sockets where the frame DRAWN has them: a stand-in frame carries its hats with it.)
    const r0 = ((((b * MAXC + clipIndex[ci]!) * MAXF + lut[o + 8]!) * D) + dir) * SOCK;
    for (let j = 0; j < nw; j += 1) {
      const a = wearShape[w0 + j]!;
      const ws = wb[B + a]! + dir;
      const qq = ws * STREAM_LUT;
      const ka = lut[qq + 7]!;
      if (!ka) continue; // (not baked at a scale it may be drawn from: without it for now)
      if (perspective ? Math.abs(k / ka - 1) < 0.125 : ka === st.scale) { frameStats.crisp += 1; if (ex[ws] || perspective) frameStats.exact += 1; }
      frameStats.drawn += 1;
      const rr = (r0 + wearSocket[w0 + j]!) * 2;
      q += LAYER_INSTANCE_FLOATS;
      D2[q] = x; D2[q + 1] = y; D2[q + 2] = z; D2[q + 3] = lut[qq]!; D2[q + 4] = lut[qq + 1]!; D2[q + 5] = lut[qq + 2]!; D2[q + 6] = lut[qq + 3]!;
      D2[q + 7] = lut[qq + 4]! - lane.rec[rr]! * ka; D2[q + 8] = lut[qq + 5]! - lift[a]! * lane.cosP * ka + lane.rec[rr + 1]! * ka;
      D2[q + 9] = lut[qq + 6]! + lane.base; D2[q + 10] = wearLook[w0 + j]!; D2[q + 11] = bias + 0.05 + 0.01 * j; D2[q + 12] = k / ka; D2[q + 13] = fade;
      inst.count += 1;
    }
    return true;
  }

  const api: Mobs = {
    B, A, O, lanes, shapes: p,
    get pop() { return pop; },
    unitBody, unitLook, wearN, wearShape, wearLook, wearSocket, unitPaint, wearPaint, clipIndex, maxHeight,
    get dressed() { return pop !== null; },
    dress() {
      if (pop) return;
      pop = dressPopulation(p);
      pop.units.forEach((u, i) => {
        const body = pop!.bodies[u.body]!;
        const paint = paintSlots(u.look, body.slotRoles(u.coverage), u.wornLook, WORN_SLOT);
        unitPaint[i] = paint;
        unitLook[i] = table.add(paint);
        const worn = u.wears.slice().sort((x, y) => (p.attributes[x.shape]!.socket < p.attributes[y.shape]!.socket ? -1 : 1));
        worn.slice(0, MAXW).forEach((w, j) => { const wp = paintRoles(w.look); wearPaint[i * MAXW + j] = wp; wearLook[i * MAXW + j] = table.add(wp); });
      });
      sr.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture() });
    },
    pages: TOTAL_PAGES,
    setScale(li, k, now) {
      const lane = lanes[li]!;
      const L = lane.spec.ladder;
      let best = L[0]!;
      for (const r of L) if (Math.abs(Math.log(r / k)) < Math.abs(Math.log(best / k))) best = r;
      lane.stream.setScale(best, now);
      return best;
    },
    begin(now) { for (const l of lanes) l.stream.begin(now); },
    update(now) { for (const l of lanes) l.stream.update(now); },
    pushOrtho(li, inst, i, x, y, z, camYaw, k, t) { return push(lanes[li]!, inst, i, x, y, z, units.yaw[i]! - camYaw - Math.PI, k, t, 0, 0, false); },
    pushBillboard(li, inst, i, x, y, z, viewYaw, k, t, fade) { return push(lanes[li]!, inst, i, x, y, z, units.yaw[i]! - viewYaw - Math.PI, k, t, 0, fade, true); },
    laneFor(el) { let best = 2, bd = Infinity; for (let li = 0; li < lanes.length; li += 1) { const d = Math.abs(lanes[li]!.spec.pitch - el); if (d < bd) { bd = d; best = li; } } return best; },
    pushObject(li, inst, o, x, y, z, k, scale, fade = 0, billboard = false) {
      const lane = lanes[li]!;
      const st = lane.stream;
      const slot = st.base[B + A + o]!;
      if (billboard) {
        // (The size it wants: the slot whose cap (or the lane's own scale) is nearest what it shows at -- that one is
        // asked for; drawn meanwhile from whichever of the three is baked nearest.)
        const want = Math.log(k * scale);
        const lut = st.lut;
        let ideal = -1, bd = Infinity, best = -1, bs = Infinity;
        for (let n = 0; n <= BILLBOARD_CAPS.length; n += 1) {
          const sl = st.base[B + A + n * O + o]!;
          const cap = Math.min(st.scale, n === 0 ? OBJECT_MAX_K : BILLBOARD_CAPS[n - 1]!);
          const d = Math.abs(want - Math.log(cap));
          if (d < bd) { bd = d; ideal = sl; }
          const baked = lut[sl * STREAM_LUT + 7]!;
          if (baked) { const e = Math.abs(want - Math.log(baked)); if (e < bs) { bs = e; best = sl; } }
        }
        st.seen[ideal] = st.stamp;
        if (ideal !== best && lut[ideal * STREAM_LUT + 7]) best = ideal;
        frameStats.wanted += 1;
        if (best < 0 || inst.count >= inst.capacity) return false;
        const off = best * STREAM_LUT, s = lut[off + 7]!;
        if (best === ideal) { frameStats.crisp += 1; frameStats.exact += 1; }
        frameStats.drawn += 1;
        inst.push(x, y, z, lut[off]!, lut[off + 1]!, lut[off + 2]!, lut[off + 3]!, lut[off + 4]!, lut[off + 5]!, lut[off + 6]! + lane.base, -1, 0, (k / s) * scale);
        inst.data[(inst.count - 1) * LAYER_INSTANCE_FLOATS + 13] = fade;
        return true;
      }
      st.seen[slot] = st.stamp;
      frameStats.wanted += 1;
      const off = slot * STREAM_LUT;
      const s = st.lut[off + 7]!;
      if (!s || inst.count >= inst.capacity) return false;
      // (Past OBJECT_MAX_K its top bake is as crisp as it gets.)
      if (s === st.scale || (st.scale > OBJECT_MAX_K && s === lane.top)) { frameStats.crisp += 1; frameStats.exact += 1; }
      frameStats.drawn += 1;
      const lut = st.lut;
      inst.push(x, y, z, lut[off]!, lut[off + 1]!, lut[off + 2]!, lut[off + 3]!, lut[off + 4]!, lut[off + 5]!, lut[off + 6]! + lane.base, -1, 0, (k / s) * scale);
      inst.data[(inst.count - 1) * LAYER_INSTANCE_FLOATS + 13] = fade;
      return true;
    },
    frame: frameStats,
    resetFrame() { frameStats.wanted = 0; frameStats.crisp = 0; frameStats.exact = 0; frameStats.drawn = 0; },
    sources,
    stats() { return lanes.map((l) => ({ ...l.stream.stats(), lane: l.spec.name })); },
  };
  return api;
}
