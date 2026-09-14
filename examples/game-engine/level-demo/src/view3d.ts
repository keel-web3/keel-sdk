// The valley seen from the ground: a perspective picture in pixel art, for
// the chase camera and first person. The hybrid:
//
//   near, solid     keel/render's raster mode on a low-res target: the terrain
//                   as chunk meshes (keel/view terrainChunkMesh: tops, ramps,
//                   cliff faces, water), the houses' and the bridge's boxes,
//                   the trees' boxes and capsules (their object definitions
//                   ARE 3D parts), and the units near enough to be big --
//                   posed live from their clips, wearing what they wear, each
//                   part on its own look's ramp. Lit by the sun, quantised to
//                   palette ramps, dithered, outlined by the pixel pass.
//   far, sprites    units and trees past their switch distance as billboards
//                   from the "eye" sprite stream (baked nearly level, 16
//                   directions), hidden by hills and houses through the
//                   depth render({ depthOut }) leaves -- the same looks the
//                   overview paints.
//   between         both at once, dissolved into each other through a 4x4
//                   screen: the solid keeps a share of the thresholds, the
//                   sprite the rest -- a switch never pops.
//   past the fog    nothing: the fog fx takes the distance to the sky's ramp.
//
// Everything is one GL context: the overview's ground and sprite renderers,
// this pixel renderer, and a dissolve between two pictures (a mode swap).

import { cameraBasis } from "@keel/game-engine/core";
import { createPixelRenderer, createSkyPass, RasterSolids } from "@keel/game-engine/render";
import type { Material, PixelRenderer, RasterContext, RenderCanvas, RenderWorld } from "@keel/game-engine/render";
import { slotOfPart, slotOfRole, wornSlotOf } from "@keel/game-engine/bake";
import type { BodyShape, LayerInstances, LayerPaint, SpriteRenderer } from "@keel/game-engine/bake";
import { actionPose, animator, blendPoses, clipOf, placeAttribute, poseSkeleton, skinOf } from "@keel/game-engine/entity";
import type { Animator, Skeleton } from "@keel/game-engine/entity";
import { oklch, rampColours, rampKey } from "@keel/game-engine/core";
import type { RoleLook } from "@keel/game-engine/core";
import type { GpuTerrain, GroundPalette, SurfaceBiome, Terrain } from "@keel/game-engine/terrain";
import type { GroundExtra } from "@keel/game-engine/terrain";
import { perspectiveScale, pushWorld, solidBandFor, solidShare, terrainChunkMesh, worldExtent } from "@keel/game-engine/view";
import type { PerspShot } from "@keel/game-engine/view";
import { MATS } from "./designs.ts";
import type { Design } from "./designs.ts";
import { MAXW } from "./mobs.ts";
import type { Mobs } from "./mobs.ts";
import { GAIT } from "./units.ts";
import type { Units } from "./units.ts";

export const FAR = 140;
/** The world's sun: the side the bakes light every sprite from (from the screen's left, above, the camera's side). */
export const SUN: [number, number, number] = [-0.5, 0.75, -0.45];
const WATER = 4, SKY = 5;
const T_TOP = 20, T_FACE = 60, EXTRA = 100, UNIT_MAT = 250;
const LOOK_RAMPS = 200, LOOK_LEN = 6;
const POSE_STEPS = 32;
/** Units solid at once, at most (the nearest; the rest stay billboards): each wears a dozen ramps of its own. */
const MAX_SOLID_UNITS = 12;
const ATTACK_TIME = 0.62;
/** No unit is solid past this (m): a narrow fov (the dolly's start) would otherwise make a whole crowd solid. */
const SOLID_MAX = 16;

export interface World3DOptions {
  /** Trees solid within this (m), billboards to the fog (default 42 / 110). */
  readonly treeSolid?: number;
  readonly cull?: number;
  /** A unit turns solid where its sprite would be this many picture pixels tall (default 56). */
  readonly solidPx?: number;
  readonly fog?: readonly [number, number];
  /** Trees and props as 3D parts near the eye (the old way) instead of pixel-art billboards (default false). */
  readonly trees3d?: boolean;
  /** The raymarched sky and no sky pass, no blob shadows (the old way, for comparing). */
  readonly legacy?: boolean;
  /** The ground seen from the ground: texels a metre (default 32) and the dither's reach (default 0.5). */
  readonly art?: number;
  readonly dither?: number;
}

/**
 * The GPU ground (keel/terrain createGpuTerrain), when the page draws with it: the terrain's chunks -- and the houses
 * and the bridge baked into them -- are painted by it in perspective too (its drawPerspective through keel/render's
 * raster hook), the same surface as the overview's, seen from the ground; null: the terrain meshes (the CPU path).
 */
export interface World3DGround {
  readonly gpu: () => GpuTerrain | null;
  readonly biome?: SurfaceBiome;
}

/** Where objects are, for culling: keel/bake's grid. */
export interface ObjectGrid { rect(x0: number, z0: number, x1: number, z1: number, out: number[]): void }

/** A sprite object placed in the level: which design, where, how big, which way. */
export interface Placed { readonly design: number; readonly x: number; readonly y: number; readonly z: number; readonly scale: number; readonly yaw: number }

export interface World3D {
  readonly px: PixelRenderer;
  /** A level's terrain, palette, houses and objects: meshes built, materials and ramps set. */
  setLevel(t: Terrain, palette: GroundPalette, extras: readonly GroundExtra[], objects: readonly Design[], placed: readonly Placed[], grid: ObjectGrid, ground?: World3DGround): void;
  setTarget(w: number, h: number): void;
  /** Draw a perspective frame: the world, the units (the possessed one live-animated, hidden in first person), the billboards. */
  draw(shot: PerspShot, f: { units: Units; mobs: Mobs; alpha: number; time: number; dt: number; hide: number; held: boolean }): void;
  readonly stats: { solids: number; triangles: number; meshes: number; billboards: number; solidUnits: number; trees: number; lookRamps: number; ms: number; parts: Record<string, number>; meshList: string; gpuMs: number | null };
  /** For looking into a picture: leave out a kind of thing. */
  readonly skip: { houses: boolean; objects: boolean; units: boolean; boards: boolean };
}


export function createWorld3D(canvas: RenderCanvas, sr: SpriteRenderer, layers: LayerInstances, o: World3DOptions = {}): World3D {
  // (The display canvas's own context -- shared with the ground and sprite renderers; its raymarcher compiles on the first frame.)
  const px = createPixelRenderer(canvas, { width: 64, height: 64, bakeOnly: true });
  // (Past ~96 m the fog has everything but the skyline: nothing's drawn there.)
  const treeSolid = o.treeSolid ?? 30, cull = o.cull ?? 96, solidPx = o.solidPx ?? 56;
  // (The fog starts close enough to give depth -- a crowd 60 m off goes to the sky's hazy ramp, not a strip of confetti.)
  const [fogNear, fogFar] = o.fog ?? (o.legacy ? [34, 104] : [18, 96]);
  const solids = new RasterSolids(8192);
  const trees3d = o.trees3d ?? false;
  const legacy = o.legacy ?? false;
  const artK = o.art ?? 32, artDither = o.dither ?? 0.5;
  const sky = createSkyPass(px.gl);
  // Blob shadows under what stands near the eye (the GPU ground darkens its texels under them): [x, z, radius, strength].
  const casters = new Float32Array(4 * 1024);
  let nCasters = 0;
  const caster = (x: number, z: number, r: number, a: number): void => { if (nCasters < 1024) { const o = nCasters * 4; casters[o] = x; casters[o + 1] = z; casters[o + 2] = r; casters[o + 3] = a; nCasters += 1; } };
  let terrain: Terrain | null = null;
  let meshKeys: string[] = [];
  let meshBounds: Array<readonly [number, number, number, number, number, number]> = [];
  let houses: readonly GroundExtra[] = [];
  let extraMat = new Map<string, number>();
  let designWorlds: RenderWorld[] = [];
  let designExtent: Array<[number, number]> = [];
  let placedList: readonly Placed[] = [];
  let groundOf: World3DGround = { gpu: () => null };
  let skyAt: [number, number] = [0, 10];
  let objGrid: ObjectGrid = { rect() { /* (no level yet) */ } };
  let W = 64, H = 64;
  let waterY = 0;
  // ---- ramps: the ground palette's, a sky, then LOOK_RAMPS for the looks of units near enough to be solid.
  let baseColours: Array<[number, number, number]> = [];
  let rampNames: Record<string, [number, number]> = {};
  let baseRamps = 0;
  const lookKey = new Map<string, number>(); // rampKey -> look slot
  const slotKey: string[] = new Array<string>(LOOK_RAMPS).fill("");
  const slotUsed = new Uint32Array(LOOK_RAMPS);
  const slotColours: Array<Array<[number, number, number]>> = Array.from({ length: LOOK_RAMPS }, () => []);
  let frameNo = 1, paletteDirty = false;
  const rampOf = (look: RoleLook | null | undefined): number => {
    if (!look) return -1;
    const key = rampKey(look, LOOK_LEN);
    let s = lookKey.get(key);
    if (s === undefined) {
      // (The least recently used slot not drawn this frame.)
      let best = -1, oldest = Infinity;
      for (let i = 0; i < LOOK_RAMPS; i += 1) if (slotUsed[i]! < oldest && slotUsed[i] !== frameNo) { oldest = slotUsed[i]!; best = i; }
      if (best < 0) return -1;
      if (slotKey[best]) lookKey.delete(slotKey[best]!);
      slotKey[best] = key; lookKey.set(key, best);
      slotColours[best] = rampColours(look, LOOK_LEN).map((c) => [c[0], c[1], c[2]] as [number, number, number]);
      s = best; paletteDirty = true;
    }
    slotUsed[s] = frameNo;
    return baseRamps + s;
  };
  function uploadPalette() {
    const colours = baseColours.slice();
    const ramps: Record<string, [number, number]> = { ...rampNames };
    for (let i = 0; i < LOOK_RAMPS; i += 1) {
      const c = slotColours[i]!.length ? slotColours[i]! : Array.from({ length: LOOK_LEN }, (_, k) => [60 + k * 30, 60 + k * 30, 60 + k * 30] as [number, number, number]);
      ramps[`look${i}`] = [colours.length, LOOK_LEN];
      colours.push(...c);
    }
    px.setPalette(colours, ramps);
    paletteDirty = false;
  }


  // ---- live posing for solid units: the possessed one through keel/entity's animator (blended clips), the rest by their clip's phase.
  let hero: { unit: number; anim: Animator; attack: number } | null = null;
  const poseUnit = (mobs: Mobs, units: Units, i: number, dt: number, time: number): { world: RenderWorld; slots: number[]; paints: Array<LayerPaint | undefined> } => {
    const b = mobs.shapes.bodies[mobs.unitBody[i]!]! as BodyShape;
    const spec = b.spec;
    const g = units.gait[i]!;
    let skel: Skeleton;
    if (i === units.possessed) {
      if (!hero || hero.unit !== i) hero = { unit: i, anim: animator(spec), attack: 0 };
      const d = units.driven;
      const yaw = units.yaw[i]!;
      const v = units.speed[i]!;
      hero.anim.step(dt, { pos: [units.x[i]!, 0, units.z[i]!], vel: [Math.sin(yaw) * v, 0, Math.cos(yaw) * v], facing: yaw });
      // (An attack is laid over whatever the animator plays, faded in and out quickly.)
      const attacking = g === GAIT.attack;
      hero.attack = Math.max(0, Math.min(1, hero.attack + (attacking ? dt * 12 : -dt * 6)));
      let pose = hero.anim.pose;
      if (hero.attack > 0 && d) pose = blendPoses([[pose, 1 - hero.attack], [actionPose(spec, "attack", Math.min(0.999, units.actionT[i]! / ATTACK_TIME), time), hero.attack]]);
      skel = poseSkeleton(spec.rig, pose, { pos: [0, 0, 0], yaw: 0 });
    } else {
      const clip = g === GAIT.attack ? "attack" : g === GAIT.idle ? "idle" : g === GAIT.run ? (spec.plan === "quadruped" ? "trot" : "run") : "walk";
      const info = b.clipInfo[clip] ?? b.clip("walk");
      let phase: number;
      if (g === GAIT.attack) phase = Math.min(0.999, units.actionT[i]! / ATTACK_TIME);
      else if (info.cycle > 0) { phase = units.dist[i]! / info.cycle; phase -= Math.floor(phase); }
      else { phase = (time + i * 0.37) / info.period; phase -= Math.floor(phase); }
      // (Posed at 32 steps a cycle, and kept: a crowd of the same few bodies poses each step once.)
      const step = Math.min(POSE_STEPS - 1, Math.floor(phase * POSE_STEPS));
      const key = `${i}|${clip}|${step}`;
      const had = poseCache.get(key);
      if (had) return had;
      phase = (step + 0.5) / POSE_STEPS;
      const fn = clipOf(spec, clip)!;
      skel = poseSkeleton(spec.rig, fn(spec, phase * info.period, { phase, landT: 99 }, { speed: info.speed }), { pos: [0, 0, 0], yaw: 0 });
      const out = dress(mobs, i, b, skel);
      if (poseCache.size > 4000) poseCache.clear();
      poseCache.set(key, out);
      return out;
    }
    return dress(mobs, i, b, skel);
  };
  const poseCache = new Map<string, { world: RenderWorld; slots: number[]; paints: Array<LayerPaint | undefined> }>();
  /** A posed skeleton's solids: its skin by part (the slots its look paints), what's baked into it (boots), and what it wears, each on its socket. */
  const dress = (mobs: Mobs, i: number, b: BodyShape, skel: Skeleton): { world: RenderWorld; slots: number[]; paints: Array<LayerPaint | undefined> } => {
    const spec = b.spec;
    const capsules: Array<{ a: [number, number, number]; b: [number, number, number]; r: number; mat: number }> = [];
    const boxes: Array<{ c: [number, number, number]; h: [number, number, number]; yaw: number; mat: number }> = [];
    const slots: number[] = [];
    const paints: Array<LayerPaint | undefined> = [];
    const body = mobs.unitPaint[i];
    for (const c of skinOf(spec, skel)) { capsules.push({ a: c.a as [number, number, number], b: c.b as [number, number, number], r: c.r, mat: capsules.length + boxes.length }); slots.push(slotOfPart(c.part)); paints.push(body); }
    for (const w of b.worn) {
      const f = placeAttribute(skel, w.socket, w.design);
      for (const c of f.capsules) { capsules.push({ a: c.a as [number, number, number], b: c.b as [number, number, number], r: c.r, mat: capsules.length + boxes.length }); slots.push(wornSlotOf(c.role)); paints.push(body); }
      for (const x of f.boxes) { boxes.push({ c: x.c as [number, number, number], h: x.h as [number, number, number], yaw: x.yaw, mat: capsules.length + boxes.length }); slots.push(wornSlotOf(x.role)); paints.push(body); }
    }
    for (let j = 0; j < mobs.wearN[i]!; j += 1) {
      const a = mobs.shapes.attributes[mobs.wearShape[i * MAXW + j]!]!;
      const sock = b.sockets[a.socket];
      if (!sock) continue;
      const f = placeAttribute(skel, sock, a.design);
      const wp = mobs.wearPaint[i * MAXW + j];
      for (const c of f.capsules) { capsules.push({ a: c.a as [number, number, number], b: c.b as [number, number, number], r: c.r, mat: capsules.length + boxes.length }); slots.push(slotOfRole(c.role)); paints.push(wp); }
      for (const x of f.boxes) { boxes.push({ c: x.c as [number, number, number], h: x.h as [number, number, number], yaw: x.yaw, mat: capsules.length + boxes.length }); slots.push(slotOfRole(x.role)); paints.push(wp); }
    }
    return { world: { capsules, boxes }, slots, paints };
  };

  // A placed object's solids in the world, made once (it never moves): appended whole each frame it's solid.
  const statics = new Map<number, { b: Float32Array; w: Float32Array; c: Float32Array }>();
  const scratch = new RasterSolids(256);
  const appendStatic = (id: number, p: Placed, fade: number): void => {
    let blk = statics.get(id);
    if (!blk) {
      scratch.clear();
      pushWorld(scratch, designWorlds[p.design]!, { pos: [p.x, p.y, p.z], yaw: p.yaw, scale: p.scale, look: { id: 60 + (id % 110) } });
      blk = { b: scratch.boxes.snapshot(), w: scratch.wedges.snapshot(), c: scratch.capsules.snapshot() };
      statics.set(id, blk);
    }
    for (const [buf, data] of [[solids.boxes, blk.b], [solids.wedges, blk.w], [solids.capsules, blk.c]] as const) {
      if (!data.length) continue;
      const at = buf.append(data);
      if (fade < 1) for (let o = at + 12; o < at + data.length; o += 16) buf.data[o] = fade;
    }
  };
  const skip = { houses: false, objects: false, units: false, boards: false };
  const stats = { solids: 0, triangles: 0, meshes: 0, billboards: 0, solidUnits: 0, trees: 0, lookRamps: 0, ms: 0, parts: {} as Record<string, number>, meshList: "", gpuMs: null as number | null };
  const vis: number[] = [];
  const near: number[] = [], pending: number[] = [];
  // (The sky, and the fog it lends the distance: the biome's tint turns its hue and chroma -- a desert's haze is warmer,
  // a jungle's greener -- so far ground fades into the very colours the sky is made of.)
  const skyRamp = (tint?: SurfaceBiome["tint"]): Array<[number, number, number]> => Array.from({ length: 10 }, (_, i) => {
    const k = i / 9, h = (tint?.hue ?? 0) * 0.6, ch = Math.min(1.4, tint?.chroma ?? 1);
    const c = oklch(Math.min(0.97, (0.4 + 0.54 * k) * Math.min(1.08, tint?.light ?? 1)), (0.085 - 0.045 * k) * ch, 240 + h - 26 * k);
    return [c[0], c[1], c[2]];
  });

  const api: World3D = {
    px,
    setLevel(t, palette, extras, objects, placed, grid, ground = { gpu: () => null }) {
      terrain = t;
      groundOf = ground;
      // The palette: the ground's ramps, a sky, the look slots.
      baseColours = palette.colours.map((c) => [c[0], c[1], c[2]]);
      // (Named ramps only: a surface palette's per-biome ramps -- grass@0, grass@0+ -- are the GPU ground's, which writes
      // palette indices straight; the colours all come along, at the same indices.)
      rampNames = Object.fromEntries(Object.entries(palette.ramps).filter(([n]) => !n.includes("@")).map(([n, r]) => [n, [r[0], r[1]]]));
      rampNames["sky"] = [baseColours.length, 10];
      skyAt = [baseColours.length, 10];
      baseColours.push(...skyRamp(ground.biome?.tint));
      baseRamps = Object.keys(rampNames).length;
      for (let i = 0; i < LOOK_RAMPS; i += 1) { slotKey[i] = ""; slotColours[i] = []; slotUsed[i] = 0; }
      lookKey.clear();
      uploadPalette();
      // Materials: the objects' (their bake's order, 4 the water's and 5 the sky's), each terrain type's top and face, the houses' ramps, a unit's.
      const mats: Material[] = new Array<Material>(255).fill({ ramp: "stone" });
      MATS.forEach((m, i) => { mats[i] = { ramp: m === "-water" ? (palette.ramps["water.deep"] ? "water.deep" : "stone") : m === "-sky" ? "sky" : palette.ramps[m] ? m : "stone", light: m === "crystal" ? 1.15 : 1, ...(m === "crystal" ? { glow: 0.2 } : {}) }; });
      mats[WATER] = { ramp: palette.ramps["water.deep"] ? "water.deep" : "stone" };
      mats[SKY] = { ramp: "sky" };
      t.types.list.forEach((ty) => {
        // (Tops wear the grain pattern, cliff faces the strata: raster mode's patterns for a ground seen close.)
        if (T_TOP + ty.id < T_FACE) mats[T_TOP + ty.id] = { ramp: palette.ramps[ty.name] ? ty.name : "stone", light: 1.05, glow: ty.glow, pattern: 2 };
        if (T_FACE + ty.id < EXTRA) mats[T_FACE + ty.id] = { ramp: palette.ramps[ty.face] ? ty.face : "stone", light: 0.9, pattern: 3 };
      });
      extraMat = new Map();
      Object.keys(palette.ramps).forEach((name, i) => { if (EXTRA + i < UNIT_MAT) { mats[EXTRA + i] = { ramp: name }; extraMat.set(name, EXTRA + i); } });
      mats[UNIT_MAT] = { ramp: "stone" };
      px.setMaterials(mats);
      px.setStyle({ screen: 4, dither: 0.9, outline: 1 });
      px.setFx([{ name: "fog", ramp: "sky", near: fogNear, far: fogFar, amount: 1, light: 0.72 }]);
      // The terrain's chunks, once.
      for (const k of meshKeys) px.setMesh(k, null);
      meshKeys = []; meshBounds = [];
      const material = (type: number, part: "top" | "face") => (part === "top" ? T_TOP : T_FACE) + type;
      for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) {
        const m = terrainChunkMesh(t, c, { material, water: WATER });
        const key = `terrain:${c}`;
        px.setMesh(key, m);
        meshKeys.push(key); meshBounds.push(m.bounds);
      }
      // (The water's glow reaches up the walls from the river's level.)
      let wl = 0, wn = 0;
      for (let k = 0; k < t.water.length; k += 1) if (t.water[k]! > -32768) { wl += t.water[k]!; wn += 1; }
      // (Its glow is WALLRUN's -- a floor of water lighting the walls from below: here, only a little up a bank.)
      waterY = wn ? (wl / wn) * t.stepHeight - 1.2 : -100;
      houses = extras;
      designWorlds = objects.map((d) => d.pose("still", 0) as unknown as RenderWorld);
      statics.clear();
      designExtent = designWorlds.map(worldExtent);
      placedList = placed;
      objGrid = grid;
    },
    setTarget(w, h) { W = w; H = h; px.setTarget(w, h); px.gl.bindFramebuffer(px.gl.FRAMEBUFFER, null); },
    draw(shot, f) {
      const t0 = performance.now();
      if (!terrain) return;
      frameNo += 1;
      const { units, mobs, alpha, time } = f;
      const { forward: fw, right: rt, up } = cameraBasis(shot.eye, shot.target);
      const e = shot.eye;
      const tanH = Math.tan(shot.fov / 2), aspect = W / H;
      // (A sphere in the frustum and inside `range`: its centre's view depth -- negative when it straddles the eye -- or OUT.)
      const OUT = -1e9;
      const depthOf = (x: number, y: number, z: number, r: number, range: number): number => {
        const dx = x - e[0], dy = y - e[1], dz = z - e[2];
        const zz = dx * fw[0] + dy * fw[1] + dz * fw[2];
        if (zz < -r || zz > range + r) return OUT;
        const lim = Math.max(zz, 0) * tanH + r * 1.5;
        if (Math.abs(dx * up[0] + dy * up[1] + dz * up[2]) > lim || Math.abs(dx * rt[0] + dy * rt[1] + dz * rt[2]) > lim * aspect + r * 0.5) return OUT;
        return zz;
      };
      solids.clear();
      layers.clear();
      mobs.resetFrame();
      nCasters = 0;
      // (Does a sphere lie across the line from the eye to the target, nearer than the target?)
      const tx = shot.target[0] - e[0], ty = shot.target[1] - e[1], tz = shot.target[2] - e[2], tl = Math.hypot(tx, ty, tz) || 1;
      const occludes = (x: number, y: number, z: number, r: number): boolean => {
        const dx = x - e[0], dy = y - e[1], dz = z - e[2];
        const along = (dx * tx + dy * ty + dz * tz) / tl;
        if (along < 0 || along > tl - 0.5) return false;
        const px2 = dx - (tx / tl) * along, py2 = dy - (ty / tl) * along, pz2 = dz - (tz / tl) * along;
        return px2 * px2 + py2 * py2 + pz2 * pz2 < (r + 0.4) * (r + 0.4);
      };
      // Terrain chunks in view: the GPU ground's (houses and the bridge baked in), or the terrain meshes.
      const gpuT = groundOf.gpu();
      const meshes: string[] = [];
      if (!gpuT) meshBounds.forEach((b, i) => { const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2; const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; if (depthOf(cx, cy, cz, r, cull) !== OUT) meshes.push(meshKeys[i]!); });
      else gpuT.planAround(e, cull);
      // Houses and the bridge (the level's ground extras): boxes and wedges, ramps by name.
      for (const h of skip.houses || gpuT ? [] : houses) {
        if (depthOf(h.c[0], h.c[1], h.c[2], Math.hypot(h.h[0], h.h[1], h.h[2]), cull) === OUT) continue;
        // (The eye inside a box -- first person against a wall -- sees through it, not a screen of wall.)
        const lx = e[0] - h.c[0], lz = e[2] - h.c[2], cy = Math.cos(h.yaw ?? 0), sy = Math.sin(h.yaw ?? 0);
        if (Math.abs(cy * lx - sy * lz) < h.h[0] + 0.25 && Math.abs(e[1] - h.c[1]) < h.h[1] + 0.25 && Math.abs(sy * lx + cy * lz) < h.h[2] + 0.25) continue;
        // (A name the palette doesn't know is stone -- as the ground's bake has it.)
        const m = extraMat.get(h.mat) ?? extraMat.get("stone") ?? EXTRA;
        if (h.kind === "wedge") solids.wedge(h.c, h.h, h.yaw ?? 0, h.lo ?? 0, m, { id: 180 }); else solids.box(h.c, h.h, h.yaw ?? 0, m, { id: 180 });
      }
      const tA = performance.now();
      // Objects (trees, bushes, rocks, the bridge): solid near, billboards to the fog, dissolved between.
      let trees = 0;
      vis.length = 0;
      // (The ground under the view: the eye, and the far corners of the frustum at the cull distance -- not a square round the eye.)
      {
        const fx = fw[0], fz = fw[2], fl = Math.hypot(fx, fz) || 1, hx = fx / fl, hz = fz / fl;
        const side = Math.tan(shot.fov / 2) * aspect * cull * 1.1;
        const px0 = e[0] + hx * cull, pz0 = e[2] + hz * cull;
        const xs = [e[0], px0 + hz * side, px0 - hz * side], zs = [e[2], pz0 - hx * side, pz0 + hx * side];
        // (Looking steeply down, the frustum's footprint is round the eye: pad by what it sees below.)
        const pad = 8 + Math.max(0, -fw[1]) * cull * 0.6;
        objGrid.rect(Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad, vis);
      }
      const tb = { solid: treeSolid * 0.85, sprite: treeSolid * 1.15, cull };
      for (const id of skip.objects ? [] : vis) {
        const p = placedList[id]!;
        const [rad, hgt] = designExtent[p.design]!;
        // (Small things -- a tuft, a stone -- only near: past a few dozen metres they're a pixel under the fog.)
        const size = Math.max(rad, hgt) * p.scale;
        const z = depthOf(p.x, p.y + hgt * p.scale * 0.5, p.z, Math.max(rad, hgt * 0.5) * p.scale, size < 0.8 ? 36 : size < 2 ? 70 : cull);
        if (z === OUT) continue;
        const d = Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2]);
        // (Its blob shadow, near enough to see.)
        if (d < 48 && size > 0.8) caster(p.x, p.z, Math.max(0.6, rad * p.scale * 0.85), size > 3 ? 0.62 : 0.45);
        if (!trees3d) {
          // A pixel-art billboard at every distance (baked at the size it shows at: mobs' three sizes), facing the eye.
          const close = Math.hypot(p.x - e[0], p.z - e[2]) - rad * p.scale;
          if (close < 0.4 && e[1] < p.y + hgt * p.scale + 0.3) continue; // (the eye is in it)
          // (Near the eye a billboard is blown up past its bake: it thins out over the last few metres instead -- a sprite
          // two or three times its texels is blocks, not pixel art.)
          // (Right by the eye, or blown up past 1.6 times its largest bake -- 32 px/m, the eye lane's -- it isn't drawn at
          // all: the cutaway round the camera; a sprite that far past its texels, or a screen-door dissolve that big, is
          // blocks and noise, not a tree.)
          const shown = perspectiveScale(Math.max(z, 0.5), shot.fov, H) * p.scale;
          if (close < 2.5 || shown > 32 * 1.6) continue;
          let keep = 1;
          // (Between the eye and what it looks at: x-ray, dithered -- a small thing there just isn't drawn.)
          // (Between the eye and what it looks at: cut away cleanly -- a screen-door ghost of a tree is noise, not pixel art.)
          if (occludes(p.x, p.y + hgt * p.scale * 0.5, p.z, Math.max(rad, hgt * 0.5) * p.scale)) continue;
          if (keep <= 0) continue;
          mobs.pushObject(mobs.laneFor(Math.atan2(e[1] - p.y - hgt * p.scale * 0.5, Math.hypot(p.x - e[0], p.z - e[2]))), layers, p.design, p.x, p.y, p.z, perspectiveScale(Math.max(z, 0.5), shot.fov, H), p.scale, 1 - keep, true);
          trees += 1;
          continue;
        }
        const share = solidShare(d, tb);
        if (share.solid > 0) {
          // (A thing right by the eye -- a trunk the chase camera backs into -- thins out rather than filling the picture.)
          const close = Math.hypot(p.x - e[0], p.z - e[2]) - rad * p.scale;
          if (close < 0.4 && e[1] < p.y + hgt * p.scale + 0.3) continue; // (the eye is in it: not at all)
          let fade = close < 3.4 ? Math.round(((close - 0.4) / 3) * 16) / 16 : 1;
          // (Between the eye and what it looks at -- the unit the camera follows -- a tree thins out: x-ray, dithered.)
          if (occludes(p.x, p.y + hgt * p.scale * 0.5, p.z, Math.max(rad, hgt * 0.5) * p.scale)) fade = Math.min(fade, 5 / 16);
          if (fade <= 0) continue;
          appendStatic(id, p, Math.min(fade, share.solid));
          trees += 1;
        }
        if (share.sprite < 1) mobs.pushObject(mobs.laneFor(Math.atan2(e[1] - p.y - hgt * p.scale * 0.5, Math.hypot(p.x - e[0], p.z - e[2]))), layers, p.design, p.x, p.y, p.z, perspectiveScale(Math.max(z, 0.5), shot.fov, H), p.scale, share.sprite);
      }
      const tB = performance.now();
      // (solidBandFor's switch distance per metre of height, for this fov and picture.)
      const switchK = solidBandFor(1, shot.fov, H, { px: solidPx, cull, width: 0 }).solid;
      // Units: solid near (posed live), billboards past their switch, dissolved between. (The nearest MAX_SOLID_UNITS at
      // most are solid -- in a crowd the rest stay billboards -- and never past SOLID_MAX m, however narrow the fov.)
      let solidUnits = 0;
      near.length = 0;
      for (let i = 0; i < (skip.units ? 0 : units.n); i += 1) {
        const x = units.px[i]! + (units.x[i]! - units.px[i]!) * alpha, z = units.pz[i]! + (units.z[i]! - units.pz[i]!) * alpha, y = units.y[i]!;
        if (i === f.hide) continue;
        const bh = mobs.shapes.bodies[mobs.unitBody[i]!]!.height;
        const zz = depthOf(x, y + bh * 0.5, z, bh, cull);
        if (zz === OUT) continue;
        const d = Math.hypot(x - e[0], y + bh * 0.5 - e[1], z - e[2]);
        if (d < 30) caster(x, z, 0.3 + bh * 0.16, 0.72);
        const zs = bh * switchK;
        const bSolid = Math.min(zs * 0.825, SOLID_MAX * 0.85), bSprite = Math.min(zs * 1.175, SOLID_MAX);
        if (i === units.possessed) {
          if (!mobs.dressed) continue;
          const posed = poseUnit(mobs, units, i, f.dt, time);
          pushWorld(solids, posed.world, { pos: [x, y, z], yaw: units.yaw[i]!, mat: () => UNIT_MAT, look: (m) => ({ ramp: rampOf(posed.paints[m]?.[posed.slots[m]!]?.look), id: 245 }) });
          solidUnits += 1;
          continue;
        }
        // (solidShare, inline -- two thousand units a frame, no objects made: past the band a whole sprite, inside it solid.)
        if (d >= cull) continue;
        if (d >= bSprite) { pending.push(i, x, y, z, zz, 0); continue; }
        // (One that wants to be solid is sorted out below -- the nearest are -- and is a whole sprite until then.)
        near.push(i, d);
        pending.push(i, x, y, z, zz, 0);
      }
      const tC = performance.now();
      // The nearest of those that want to be solid are; their sprites dissolve by the same share; the rest are sprites.
      const order: number[] = [];
      for (let q = 0; q < near.length; q += 2) order.push(q);
      order.sort((a, b) => near[a + 1]! - near[b + 1]!);
      const solidNow = new Map<number, number>();
      for (let q = 0; q < Math.min(MAX_SOLID_UNITS, order.length); q += 1) {
        const i = near[order[q]!]!, d = near[order[q]! + 1]!;
        const bh = mobs.shapes.bodies[mobs.unitBody[i]!]!.height;
        const b0 = solidBandFor(bh, shot.fov, H, { px: solidPx, cull });
        const share0 = solidShare(d, { solid: Math.min(b0.solid, SOLID_MAX * 0.85), sprite: Math.min(b0.sprite, SOLID_MAX), cull });
        // (Legacy: a dithered cross-fade between solid and sprite. Now a clean switch at the band's middle -- one or the
        // other, never a screen-door blend of both.)
        const share = legacy ? share0 : share0.solid >= 0.5 ? { solid: 1, sprite: 1 } : { solid: 0, sprite: 0 };
        if (!mobs.dressed) continue;
        if (share.solid === 0) { solidNow.set(i, 0); continue; } // (past the switch: its sprite, whole)
        const x = units.px[i]! + (units.x[i]! - units.px[i]!) * alpha, z = units.pz[i]! + (units.z[i]! - units.pz[i]!) * alpha, y = units.y[i]!;
        const posed = poseUnit(mobs, units, i, f.dt, time);
        // (One right at the eye -- walking through the possessed unit -- thins out rather than filling the picture.)
        const close = Math.hypot(x - e[0], z - e[2]);
        const fade = legacy ? Math.min(share.solid, close < 1.6 ? Math.max(0, Math.round(((close - 0.35) / 1.25) * 16) / 16) : 1) : share.solid > 0 && close >= 0.9 ? 1 : 0;
        if (fade <= 0) { solidNow.set(i, 1); continue; }
        pushWorld(solids, posed.world, { pos: [x, y, z], yaw: units.yaw[i]!, mat: () => UNIT_MAT, look: (m) => ({ ramp: rampOf(posed.paints[m]?.[posed.slots[m]!]?.look), id: 200 + (i % 45), fade }) });
        solidNow.set(i, share.sprite);
        solidUnits += 1;
      }
      for (let q = 0; q < pending.length; q += 6) {
        const i = pending[q]!;
        const dissolve = solidNow.has(i) ? solidNow.get(i)! : pending[q + 5]!;
        if (dissolve >= 1) continue;
        // (The billboard looks at the unit from where the eye is: its direction is the eye's bearing, not the view's.)
        const x = pending[q + 1]!, y = pending[q + 2]!, z = pending[q + 3]!;
        const lane = mobs.laneFor(Math.atan2(e[1] - y - 0.8, Math.hypot(x - e[0], z - e[2])));
        mobs.pushBillboard(lane, layers, i, x, y, z, Math.atan2(x - e[0], z - e[2]), perspectiveScale(Math.max(pending[q + 4]!, 0.5), shot.fov, H), time, dissolve);
      }
      pending.length = 0;
      const tD = performance.now();
      // The held thing (first person): a short blade in the right hand, swung on an attack, bobbing with the view.
      if (f.held) {
        const at = (r: number, u: number, fwd: number): [number, number, number] => [e[0] + rt[0] * r + up[0] * u + fw[0] * fwd, e[1] + rt[1] * r + up[1] * u + fw[1] * fwd, e[2] + rt[2] * r + up[2] * u + fw[2] * fwd];
        const i = units.possessed;
        const swing = i >= 0 && units.gait[i] === GAIT.attack ? Math.sin(Math.min(1, units.actionT[i]! / ATTACK_TIME) * Math.PI) : 0;
        const hilt = at(0.34 - swing * 0.2, -0.3 + swing * 0.06, 0.62), tip = at(0.3 - swing * 0.45, -0.02 - swing * 0.26, 1.02 + swing * 0.15);
        solids.capsule(hilt, at(0.35 - swing * 0.2, -0.38 + swing * 0.06, 0.58), 0.035, 1, { id: 249 }); // (wood: the grip)
        solids.capsule(hilt, tip, 0.03, 12, { id: 249, light: 1.2 }); // (metal: the blade)
      }
      if (paletteDirty) uploadPalette();
      const tE = performance.now();
      // (The water is the terrain's own meshes: the raymarcher's endless plane is off -- under everything -- and its glow on
      // walls rises from the river's level.)
      // (The GPU ground paints its chunks into the same buffers, after the solids: its texels in texture space, palette indices straight.)
      // (The possessed unit's own shadow too -- it's drawn solid, or hidden in first person.)
      if (units.possessed >= 0) caster(units.x[units.possessed]!, units.z[units.possessed]!, 0.55, 0.72);
      if (gpuT) gpuT.gpu.setShadows(casters, nCasters, [e[0], e[2]], 64);
      const drawGround = legacy ? undefined : (ctx: RasterContext) => {
        if (gpuT) {
          if (!gpuT.ready) gpuT.upload(2);
          const st = gpuT.gpu.style;
          if (st.dither !== artDither) gpuT.gpu.style = { ...st, dither: artDither };
          gpuT.gpu.drawPerspective(ctx, { time, keys: gpuT.visible, sun: SUN, cull, art: artK });
          gpuT.gpu.style = st;
        }
        sky.draw(ctx, { ramp: skyAt, cover: 0.42 });
      };
      // (No raymarched world: everything here is raster, and the sky pass paints the background -- the full-screen march
      // was most of a 1080p frame.)
      px.render({ eye: shot.eye, target: shot.target, fov: shot.fov, time, sun: SUN, waterY: -1e4, fogNear: 900, fogFar: 1000, raster: { solids, meshes, waterY, draw: drawGround, world: legacy }, depthOut: true });
      const tF = performance.now();
      if (layers.count && sr.pageCount && !skip.boards) sr.drawBillboards({ eye: shot.eye, forward: fw, right: rt, up, fov: shot.fov }, layers, { screen: 4, dither: 0.9, outline: 3, far: FAR, lift: 0.5 });
      const rs = px.rasterStats;
      stats.solids = rs.instances; stats.triangles = rs.triangles; stats.meshes = rs.meshes; stats.billboards = layers.count; stats.solidUnits = solidUnits; stats.trees = trees;
      stats.lookRamps = lookKey.size; stats.ms = performance.now() - t0;
      stats.meshList = meshes.join(",");
      stats.gpuMs = px.gpuMs;
      stats.parts = { setup: +(tA - t0).toFixed(2), objects: +(tB - tA).toFixed(2), units: +(tC - tB).toFixed(2), solidsAndBoards: +(tD - tC).toFixed(2), palette: +(tE - tD).toFixed(2), render: +(tF - tE).toFixed(2), boards: +(performance.now() - tF).toFixed(2) };
    },
    stats,
    skip,
  };
  return api;
}

/** A dissolve between two pictures on one canvas: capture() the first, draw the second, then over(t) lays the first back over it through a 4x4 screen (t: how much of the SECOND shows). */
export function createDissolve(gl: WebGL2RenderingContext) {
  const vs = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const fs = `#version 300 es
precision highp float;
uniform sampler2D uPic; uniform float uT; out vec4 o;
float bayer4(ivec2 p) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
void main() { ivec2 p = ivec2(gl_FragCoord.xy); if (bayer4(p) < uT) discard; o = vec4(texelFetch(uPic, p, 0).rgb, 1.0); }`;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "dissolve"); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  const uPic = gl.getUniformLocation(prog, "uPic"), uT = gl.getUniformLocation(prog, "uT");
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const tex = gl.createTexture()!;
  let w = 0, h = 0;
  return {
    capture(width: number, height: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (w !== width || h !== height) {
        // (RGB: the canvas has no alpha, and a copy may not add components.)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        w = width; h = height;
      }
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    },
    over(t: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uPic, 0); gl.uniform1f(uT, t);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
  };
}
