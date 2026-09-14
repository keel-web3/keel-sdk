// LEVEL DEMO: a generated valley, through everything the terrain and level
// packages do -- and now close enough to touch. The level (@keel-engine/level)
// is generated from a seed -- heights, cliffs and ramps, a river and the bridge
// a road needs over it, roads between the towns, houses along them, foliage by
// biome -- and drawn the fast way: the GROUND baked per chunk into static
// layers (palette-true, dithered, outlined at cliffs, water cycling in the
// shader) with per-texel depth, so the units and trees drawn over it hide
// behind cliffs and houses and stand in front of them.
//
// Its people and animals are a population (cast.ts): every character from the
// humans and animals packs, dressed from the cloth pack, every one different,
// walking flow fields between the towns, standing about, sparring.
//
// VIEWS (keel/view):
//   overview   a continuous zoom from 2 px/m (the whole valley) to 128 px/m (one
//              unit filling the picture): it eases between baked scales and
//              lands on one, where every sprite is re-baked texel for pixel
//              (the streams: nearest baked scale meanwhile, never a box). Close
//              in, the camera tilts lower (a pitch bucket), units get 16
//              directions, every clip and everything they wear.
//   possess    click a unit, F (or Enter): the overview glides onto it, swaps to
//              a perspective camera that matches it and dollies down behind it.
//              WASD / arrows / a pad move it, Shift runs, space / left click /
//              pad A strikes, the mouse (drag, or click for pointer lock) turns
//              the camera, the wheel moves it in and out. It's driven through a
//              command stream (move / face / act per tick). Esc gives it back.
//   first      V (or C) from the chase: its eyes, mouse-look, head bob, a blade.
//
// Also: 1-5 unit counts, G a new level, T pixel / voxel style, H the overlay,
// [ ] pixel size. ?seed= ?units= ?k= ?size=WxH ?workers= ?locks=scene/level.biome=desert
// globalThis.levelDemo measures and shoots (PUT /out/<name>.png).

import { createPixelRenderer } from "@keel/game-engine/render";
import type { RenderCanvas } from "@keel/game-engine/render";
import {
  LAYER_INSTANCE_FLOATS, LayerInstances, bakeSlice, createBakeWorkers, createFrameBudget, createGrid, createLookTable, createSpriteRenderer, pixelView, serveBakes,
} from "@keel/game-engine/bake";
import type { BakeSource, BakeWorkers, BakedSprite, Grid, IndexedBakeRenderer, IndexedSource, PixelView, StreamJob } from "@keel/game-engine/bake";
import { GROUND_MATERIALS, createGpuGround, createGpuTerrain, createGroundBaker, createGroundRenderer, groundPalette, groundRectFor, groundSurface, spritePosition, surfacePalette, viewAxes } from "@keel/game-engine/terrain";
import type { GpuGround, GpuTerrain, GroundBaker, GroundExtra, GroundPalette, GroundStyle, GroundSurface, SurfaceBiome } from "@keel/game-engine/terrain";
import { fairness, generateLevel, groundExtrasOf, levelInstances } from "@keel/game-engine/level";
import type { Level, LevelInstances, Style } from "@keel/game-engine/level";
import { ACT, createCommandStream, createViewModes, createZoom, sampleCommand, terrainDistance, zoomLadder } from "@keel/game-engine/view";
import type { OrthoShot, PerspShot, ViewFrame, ViewModes, Zoom } from "@keel/game-engine/view";
import { levelContent } from "./content.ts";
import { OBJECT_RAMPS, bakeKeyOf, objectDesign, objectLook } from "./designs.ts";
import type { Design } from "./designs.ts";
import { valleyShapes } from "./cast.ts";
import { STREAMS, createMobs, screenFor } from "./mobs.ts";
import type { Mobs } from "./mobs.ts";
import { GAIT, createUnits } from "./units.ts";
import type { Units } from "./units.ts";
import { createDissolve, createWorld3D } from "./view3d.ts";
import type { Placed, World3D } from "./view3d.ts";

const YAW = 0;
const COUNTS = [500, 2000, 5000, 10000, 20000];
const DT = 1 / 20; // (the sim's fixed step: docs/RTS.md's 20 Hz)
const DEFAULT_LOCKS = "scene/level.template=valley;scene/level.biome=temperate;scene/level.towns=3";
/** The zoom: 2..128 px/m, a rung every quarter octave; the far bucket's steep angle to 16 px/m, the near bucket's lower one past it. */
export const LADDER = zoomLadder(2, 128);
export const BUCKETS = [{ upTo: 16, pitch: STREAMS[0]!.pitch }, { upTo: Infinity, pitch: STREAMS[1]!.pitch }];
/** The CPU bake's ground layers bake up to this scale (a 64 m chunk at 48 px/m is 3072 px, ~0.7 s to bake; at 64 it was 6 s and 24 MB a chunk); closer, they're drawn scaled. The GPU ground has no such cap: it's painted at the view's own scale. */
export const GROUND_MAX_K = 32;
const LOOK_SPEED = 0.0028; // (radians a mouse pixel)
/** The eye stream's scale: a unit 1.7 m tall turns to a billboard at 56 px (view3d's solidPx), about 32 px/m. */
const EYE_K = 32;

const param = (name: string): string | null => (typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) : null);
const now = () => performance.now();
// (This module's own URL on a plain page: the bake worker imports it.)
const moduleUrl = (): string | undefined => (import.meta as { url?: string }).url;

export interface DemoStats {
  fps: number; cpuMs: number; finishedMs: number; simMs: number; picture: string; k: number; style: Style; units: number; foliage: number; drawn: number;
  ground: string; objects: string; level: string; mode: string; bake: string;
}

/** The demo's level (also what the test builds headless). */
export function demoLevel(seed: string, locks = DEFAULT_LOCKS, size = 128): Level {
  return generateLevel({ seed, width: size, depth: size, players: 1, chunk: 32, settings: locks }).level;
}

/** The level's one biome as the ground's surface sees it: its tint over every land ramp. */
export function demoBiome(level: Level): SurfaceBiome {
  const m = (level.meta["palette"] ?? {}) as { hue?: number; chroma?: number; light?: number };
  return { name: String(level.meta["biome"] ?? "valley"), tint: { hue: m.hue ?? 0, chroma: m.chroma ?? 1, light: m.light ?? 1 } };
}

/**
 * The ground palette for a generated level: its biome's tint, and the ramps the objects want. With `surface` (the
 * default) it's a surfacePalette -- the blended ground's (corner blending, macro tint, decals) -- else the classic one.
 */
export function demoPalette(level: Level, surface = true): GroundPalette {
  const m = (level.meta["palette"] ?? {}) as { hue?: number; chroma?: number; light?: number; waterHue?: number; waterChroma?: number };
  const opts = { biome: { hue: m.hue ?? 0, chroma: m.chroma ?? 1, light: m.light ?? 1 }, water: { hue: m.waterHue ?? 222, chroma: m.waterChroma ?? 0.1 }, materials: { ...GROUND_MATERIALS, ...OBJECT_RAMPS } };
  return surface ? surfacePalette(level.terrain.types, [demoBiome(level)], opts) : groundPalette(level.terrain.types, opts);
}

/** The level's ground surface (one biome, no biome map). */
export const demoSurface = (level: Level): GroundSurface => groundSurface({ biomes: [demoBiome(level)], biome: null });

/** The level's objects as bake designs (one per distinct shape and style), and each placed one's design. */
export function demoObjects(inst: LevelInstances, palette: GroundPalette): { designs: Design[]; index: number[] } {
  const byKey = new Map<string, number>();
  const designs: Design[] = [];
  const look = objectLook(palette);
  const index = inst.sprites.map((s) => {
    const key = bakeKeyOf(s.def);
    let d = byKey.get(key);
    if (d === undefined) { d = designs.length; designs.push(objectDesign(s.def, palette, look)); byKey.set(key, d); }
    return d;
  });
  return { designs, index };
}

/** Everything a bake worker bakes from: the population's shapes (from the seed) and the level's objects (from its seed and locks). */
export function demoSources(seed: string, count: number, locks = DEFAULT_LOCKS): { indexed: Map<string, IndexedSource>; plain: Map<string, BakeSource> } {
  const level = demoLevel(seed, locks);
  const pal = demoPalette(level);
  const { designs } = demoObjects(levelInstances(level, levelContent()), pal);
  const shapes = valleyShapes(seed, count);
  return { indexed: new Map<string, IndexedSource>([...shapes.bodies, ...shapes.attributes].map((d) => [d.key, d])), plain: new Map<string, BakeSource>(designs.map((d) => [d.key, d])) };
}

/** The bake worker's entry: the same code, started again in a worker (createBakeWorkers finds it). */
export function bakeWorker(): void {
  serveBakes({
    renderer: (canvas) => createPixelRenderer(canvas as unknown as RenderCanvas, { width: 64, height: 64, bakeOnly: true }) as unknown as IndexedBakeRenderer,
    sources: (payload) => { const { seed, count, locks } = payload as { seed: string; count: number; locks: string }; return demoSources(seed, count, locks); },
  });
}

export function main(host: HTMLElement): void {
  let seed = param("seed") ?? "valley-3";
  const locks = param("locks") ?? DEFAULT_LOCKS;
  host.style.cssText = "margin:0;overflow:hidden;background:#000;height:100vh";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;image-rendering:pixelated;touch-action:none;cursor:grab";
  const overlay = document.createElement("pre");
  overlay.style.cssText = "position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(8,9,14,.72);color:#d8dcf0;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre;z-index:2";
  const marker = document.createElement("div");
  marker.style.cssText = "position:fixed;pointer-events:none;border:1px solid #ffe28a;box-shadow:0 0 0 1px #000;display:none;z-index:1";
  host.append(canvas, overlay, marker);

  // ---------------------------------------------------------------- the view
  let pixel = Number(param("px") ?? 0) || (globalThis.devicePixelRatio || 1);
  let fixed: [number, number] | null = null;
  { const s = param("size"); const m = s && /^(\d+)x(\d+)$/.exec(s); if (m) fixed = [Number(m[1]), Number(m[2])]; }
  let W = 0, H = 0;
  const zoom: Zoom = createZoom({ ladder: LADDER, k: Number(param("k") ?? 8) || 8, buckets: BUCKETS });
  const sr = createSpriteRenderer(canvas, { width: 64, height: 64, capacity: 1 << 16 });
  const gl = sr.gl;
  const ground = createGroundRenderer(gl);
  // The GPU ground (keel/terrain createGpuGround): painted at the view's own scale, 2 px/m or 128, uploaded a chunk at a
  // time; B switches to the CPU bake (the reference) and back. The voxel style is the CPU bake's only.
  let groundMode: "gpu" | "cpu" = param("ground") === "cpu" || param("legacy3d") === "1" ? "cpu" : "gpu";
  const useSurface = param("surface") !== "0";
  let gpu: GpuGround | null = null;
  let gpuT: GpuTerrain | null = null;
  const onGpu = (): boolean => groundMode === "gpu" && style === "pixel" && gpuT !== null;
  let refGpu: GpuGround | null = null, refT: GpuTerrain | null = null;
  // (To the CPU bake: its floor layers for both pitch buckets first -- the stand-ins that never leave a chunk empty.)
  function setGroundMode(m: "gpu" | "cpu") {
    groundMode = m;
    if (m === "cpu") bakers.forEach((b, i) => b.bakeFloor({ yaw: YAW, pitch: BUCKETS[i]!.pitch, pixelsPerMetre: 2 }));
  }
  // The GPU ground's art is no finer than 48 px/m -- the trees' and props' largest bake -- and closer in its pixels are
  // whole blocks of the picture's (2 x 2 at 64-96, 3 x 3 to 128): one pixel size for the ground and what stands on it,
  // and never the CPU bake's uneven blow-up. ?groundArt=0: the view's own scale all the way (an art pixel a picture pixel).
  let groundArt = param("groundArt") === null ? 48 : Number(param("groundArt")) || 0;
  const table = createLookTable({ rampLength: 5 });
  const layers = new LayerInstances(1 << 17);
  const boards = new LayerInstances(1 << 15);
  // (?legacy3d=1: the perspective views as they were before the GPU ground -- terrain meshes, trees as 3D parts, the
  // raymarched sky, the streams' old cadence -- for comparing; ?trees3d=1: only the trees.)
  const legacy3d = param("legacy3d") === "1";
  const world3d: World3D = createWorld3D(canvas as unknown as RenderCanvas, sr, boards, { trees3d: legacy3d || param("trees3d") === "1", legacy: legacy3d, ...(param("art") ? { art: Number(param("art")) } : {}), ...(param("pdither") ? { dither: Number(param("pdither")) } : {}) });
  const dissolve = createDissolve(gl);
  let modes!: ViewModes;
  function fit() {
    const dpr = globalThis.devicePixelRatio || 1;
    const [w, h] = fixed ?? [Math.max(64, Math.round((innerWidth * dpr) / pixel)), Math.max(48, Math.round((innerHeight * dpr) / pixel))];
    if (w !== W || h !== H) { W = w; H = h; sr.setTarget(W, H); world3d.setTarget(W, H); modes?.setPicture(W, H); }
    const s = Math.min(innerWidth / W, innerHeight / H);
    const cw = fixed ? W * s : innerWidth, ch = fixed ? H * s : innerHeight;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    canvas.style.left = `${(innerWidth - cw) / 2}px`; canvas.style.top = `${(innerHeight - ch) / 2}px`;
  }
  fit();
  addEventListener("resize", fit);
  // An orthographic shot as keel/bake's pixel view: the centre snapped to the global pixel grid along the view's forward (the ground's layers and the sprites land on the same pixels).
  const viewOf = (s: OrthoShot): PixelView => {
    const k = s.k;
    const a = viewAxes({ yaw: s.yaw, pitch: s.pitch, pixelsPerMetre: k });
    const c = s.center;
    const gx = Math.round((c[0] * a.right[0] + c[2] * a.right[2]) * k) / k;
    const gy = Math.round((c[0] * a.up[0] + c[1] * a.up[1] + c[2] * a.up[2]) * k) / k;
    const f = c[0] * a.forward[0] + c[1] * a.forward[1] + c[2] * a.forward[2];
    const cc: [number, number, number] = [a.right[0] * gx + a.up[0] * gy + a.forward[0] * f, a.up[1] * gy + a.forward[1] * f, a.right[2] * gx + a.up[2] * gy + a.forward[2] * f];
    return pixelView({ center: cc, yaw: s.yaw, pitch: s.pitch, pixelsPerMetre: k, width: W, height: H });
  };
  const overviewShot = (): OrthoShot => ({ kind: "ortho", center: [...modes.center] as [number, number, number], yaw: modes.yaw, pitch: zoom.pitch, k: zoom.k });
  const viewNow = (): PixelView => viewOf(overviewShot());

  // ---------------------------------------------------------------- the level
  const content = levelContent();
  let level!: Level, palette!: GroundPalette, inst!: LevelInstances, ge!: ReturnType<typeof groundExtrasOf>;
  let style: Style = param("style") === "voxel" ? "voxel" : "pixel";
  let genMs = 0, fairText = "";
  const groundStyle = (s: Style): GroundStyle => (s === "voxel" ? { name: "voxel", voxels: 4, outline: 2 } : { name: "pixel", screen: 4, dither: 0.9, outline: 2 });
  // Ground bakers, one per pitch bucket (a layer is baked for one pitch: the far bucket's, the near bucket's).
  let bakers: GroundBaker[] = [];
  const budget = createFrameBudget();

  // Objects: bake designs, where each is placed, a grid over them.
  let objDesigns: Design[] = [];
  let placed: Placed[] = [];
  let objGrid: Grid = createGrid({ cell: 8, capacity: 1 });

  // ---------------------------------------------------------------- units and their bake
  let units!: Units;
  let mobs!: Mobs;
  let nUnits = Number(param("units") ?? 2000) || 2000;
  let shapesMs = 0, dressMs = 0;
  const wantWorkers = param("workers");
  let workers: BakeWorkers<StreamJob> | null = null;
  const arrived: Array<[StreamJob, BakedSprite]> = [];
  let bakedWorker = 0, bakedMain = 0, bakeMainMs = 0, msPerSprite = 0.4;
  let mainPx: IndexedBakeRenderer | null = null;
  const bakeOnMain = (): IndexedBakeRenderer => {
    if (mainPx) return mainPx;
    const bc: RenderCanvas = typeof OffscreenCanvas !== "undefined" ? (new OffscreenCanvas(64, 64) as unknown as RenderCanvas) : (document.createElement("canvas") as unknown as RenderCanvas);
    return (mainPx = createPixelRenderer(bc, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer);
  };
  const laneOfJob = (j: StreamJob): number => STREAMS.findIndex((s) => Math.abs(s.pitch - j.pitch) < 1e-6);

  function makeUnits() {
    const grid = level.pathGrid();
    const goals: Array<readonly [number, number]> = [];
    for (const th of level.things.values()) if (th.layer === "buildings" || th.layer === "bridges") goals.push(level.terrain.tileAt(th.pos[0], th.pos[2]));
    for (const s of level.spawns) goals.push(s.at);
    if (goals.length < 2) goals.push([Math.floor(level.terrain.width / 2), Math.floor(level.terrain.depth / 2)]);
    const t0 = now();
    const shapes = valleyShapes(seed, nUnits);
    shapesMs = now() - t0;
    const walk = shapes.bodies.map((b) => b.clip("walk").speed), run = shapes.bodies.map((b) => b.clip(b.spec.plan === "quadruped" ? "trot" : "run").speed);
    units = createUnits(seed, level.terrain, grid, goals, nUnits, 1, { walk: (u) => walk[shapes.units[u]!.body]! * shapes.units[u]!.anim.speed, run: (u) => Math.min(6.5, run[shapes.units[u]!.body]!) * shapes.units[u]!.anim.speed });
    mobs = createMobs({ shapes, objects: objDesigns }, units, table, sr);
    for (let li = 0; li < STREAMS.length; li += 1) mobs.setScale(li, li === 2 ? EYE_K : zoom.rung, now());
    arrived.length = 0;
    if (workers) workers.reinit({ seed, count: nUnits, locks });
    const d0 = now();
    mobs.dress();
    dressMs = now() - d0;
  }

  function build() {
    const t0 = now();
    level = demoLevel(seed, locks);
    genMs = now() - t0;
    level.settings.set("scene", "style", style);
    palette = demoPalette(level, useSurface);
    const surface = useSurface ? demoSurface(level) : null;
    ground.setPalette(palette);
    inst = levelInstances(level, content);
    ge = groundExtrasOf(inst);
    const objs = demoObjects(inst, palette);
    objDesigns = objs.designs;
    placed = inst.sprites.map((s, i) => ({ design: objs.index[i]!, x: s.pos[0], y: s.pos[1], z: s.pos[2], scale: s.scale, yaw: s.yaw }));
    objGrid = createGrid({ cell: 8, capacity: Math.max(1, placed.length) });
    placed.forEach((p, i) => objGrid.set(i, p.x, p.z, 1.2));
    // (The CPU bake, the fallback: a floor of 2 px/m layers for every chunk, baked now for both pitch buckets, stands in
    // wherever a chunk's own scale isn't baked yet -- a fast zoom or a pitch change never shows a chunk with nothing.)
    bakers = STREAMS.slice(0, 2).map(() => createGroundBaker({ terrain: level.terrain, palette, style: groundStyle(style), extras: (c) => ge.extras(c), extrasKey: (c) => ge.extrasKey(c), prefetch: 1, seed: 1, surface, floor: 2 }));
    if (groundMode === "cpu") bakers.forEach((b, i) => b.bakeFloor({ yaw: YAW, pitch: BUCKETS[i]!.pitch, pixelsPerMetre: 2 }));
    gpuT?.dispose();
    refT?.dispose(); refGpu?.dispose(); refGpu = null; refT = null;
    gpu ??= createGpuGround(gl, { palette, style: groundStyle("pixel"), seed: 1 });
    gpu.setPalette(palette);
    gpuT = createGpuTerrain(gpu, { terrain: level.terrain, auto: bakers[0]!.auto, surface, extras: (c) => ge.extras(c), extrasKey: (c) => ge.extrasKey(c), prefetch: 1, seed: 1 });
    const extras: GroundExtra[] = [...inst.ground.values()].flat();
    world3d.setLevel(level.terrain, palette, extras, objDesigns, placed, objGrid, { gpu: () => (onGpu() ? gpuT : null), biome: demoBiome(level) });
    makeUnits();
    fairness(level);
    fairText = `${level.spawns.length} spawn, ${level.resources.length} resources`;
    const start = level.markers.find((m) => m.id === "camera-start")?.pos ?? level.terrain.centre(level.terrain.width >> 1, level.terrain.depth >> 1);
    // (Start over the first bridge, if the level has one: the river crossing is the demo's centrepiece.)
    const bridge = [...level.things.values()].find((th) => th.layer === "bridges");
    const c: [number, number, number] = bridge ? [bridge.pos[0], 0, bridge.pos[2]] : [start[0], 0, start[2]];
    // What the chase camera's arm keeps out of: the ground, and the houses' and the bridge's boxes (those near the unit, each frame).
    solidBoxes = extras.filter((x) => x.kind !== "wedge").map((x) => ({ c: [x.c[0], x.c[1], x.c[2]] as [number, number, number], h: [x.h[0], x.h[1], x.h[2]] as [number, number, number], yaw: x.yaw ?? 0 }));
    cameraWorld.boxes = [];
    cameraWorld.distance = terrainDistance(level.terrain);
    if (!modes) {
      modes = createViewModes({
        zoom, center: c, yaw: YAW, picture: [W, H], world: cameraWorld, enterK: 40,
        chase: { distance: 5.5, pitch: -0.4, above: 0.5, recenter: 1.2 }, fps: { eyeHeight: 0.93, bob: 0.04 },
      });
    } else { modes.release(); modes.center = c; }
    selected = -1;
  }

  function setStyle(s: Style) {
    if (s === style) return;
    style = s;
    level.settings.set("scene", "style", style);
    for (const b of bakers) b.style = groundStyle(style);
  }

  type Box = { c: [number, number, number]; h: [number, number, number]; yaw: number };
  const cameraWorld: { boxes?: Box[]; distance?: (p: ArrayLike<number>) => number } = {};
  let solidBoxes: Box[] = [];
  /** The boxes near the possessed unit -- not any it stands in (a porch, a fence it's beside): its arm would have nowhere to go. */
  function nearBoxes(x: number, y: number, z: number): Box[] {
    const inside = (b: Box, px: number, py: number, pz: number, m: number) => { const lx = px - b.c[0], lz = pz - b.c[2], c = Math.cos(b.yaw), s = Math.sin(b.yaw); return Math.abs(c * lx - s * lz) < b.h[0] + m && Math.abs(py - b.c[1]) < b.h[1] + m && Math.abs(s * lx + c * lz) < b.h[2] + m; };
    // (Within the arm's reach, and not the thin things on a wall -- trims, panes: the wall behind them stops the arm.)
    const reach = modes.camera.rigs.orbit.opt.distance + 2.5;
    return solidBoxes.filter((b) => Math.min(b.h[0], b.h[1], b.h[2]) > 0.12 && Math.hypot(b.c[0] - x, b.c[2] - z) < reach + Math.hypot(b.h[0], b.h[2]) && !inside(b, x, y + 1, z, 0.8) && !inside(b, x, y + 2.2, z, 0.8));
  }

  // ---------------------------------------------------------------- the sim and the command stream
  const commands = createCommandStream({ delay: 0 });
  let acc = 0, tick = 0, simMs = 0, frozen = false;
  function simulate(dt: number) {
    if (frozen) return;
    acc += Math.min(0.25, dt);
    while (acc >= DT) {
      units.step(DT, commands.take(tick));
      simMs = units.stepMs;
      tick += 1; acc -= DT;
    }
  }

  // ---------------------------------------------------------------- a frame
  const vis: number[] = [];
  const pos: [number, number, number] = [0, 0, 0];
  let drawn = 0, foliageDrawn = 0, cutAway = 0;
  let lastFrame: ViewFrame | null = null;
  let updates = 0, planKey = "", plannedAt = -99;
  let groundK = 0;
  let unitsShown = true;
  // (Sprites' depth at their footprint's front edge -- off only to compare with the old way.)
  let footprints = true;
  // (Each layer instance's ground point, for the sprite check.)
  const instBase = new Float32Array((1 << 17) * 3);
  let faultList: unknown[] = [];
  // What the ground drew this frame (the checks redraw exactly it).
  let lastGround: { view: PixelView; gpu: boolean; keys: readonly string[]; layers: ReturnType<GroundBaker["layers"]>; time: number } | null = null;

  /** The overview (or any orthographic shot): the ground's layers, then the objects and units over them in one draw. */
  function drawOrtho(s: OrthoShot, time: number) {
    const li = Math.abs(s.pitch - STREAMS[0]!.pitch) < 1e-6 ? 0 : 1;
    const view = viewOf(s);
    // (The pixel renderer leaves its own framebuffer bound after a resize: the overview draws to the canvas.)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const q0 = now();
    if (onGpu()) {
      // The GPU ground: at the view's own scale (easing between rungs too), the chunks the view needs uploaded first.
      groundK = s.k;
      gpuT!.plan({ ...view, width: W + 96, height: H + 96 });
      if (!gpuT!.ready) gpuT!.upload(3);
      const q1 = now();
      gpu!.draw(view, { time, clear: [0.06, 0.07, 0.1], keys: gpuT!.visible, ...(groundArt ? { artScale: groundArt } : {}) });
      lastGround = { view, gpu: true, keys: gpuT!.visible.slice(), layers: [], time };
      prof.plan += q1 - q0; prof.ground += now() - q1;
    } else {
    // (The ground plans for a rung -- never a scale in between -- and no finer than GROUND_MAX_K: past it, drawn scaled.)
    groundK = Math.min(GROUND_MAX_K, zoom.rung);
    // (keel/terrain's plan is a hash of every chunk the view touches: re-planned when the view has moved, at most every
    // fourth frame -- for a picture a little larger than the canvas, so a pan never shows an edge the plan hasn't seen.)
    const pk = `${li}|${groundK}|${Math.round((view.center[0] * view.axes.right[0] + view.center[2] * view.axes.right[2]) * s.k / 16)}|${Math.round((view.center[0] * view.axes.up[0] + view.center[1] * view.axes.up[1] + view.center[2] * view.axes.up[2]) * s.k / 16)}|${W}|${H}`;
    const force = pk.split("|").slice(0, 2).join("|") !== planKey.split("|").slice(0, 2).join("|");
    if (pk !== planKey && (force || updates - plannedAt >= 4)) {
      // (The plan's picture is the SHOWN one at the bake's scale: zooming in, the target rung is finer than the eased k
      // on screen -- planned at the rung's scale with the picture's own size, the edges of the picture had no chunks.)
      const f = Math.max(1, groundK / s.k);
      bakers[li]!.plan({ ...view, width: Math.ceil((W + 96) * f), height: Math.ceil((H + 96) * f), pixelsPerMetre: groundK });
      planKey = pk; plannedAt = updates;
    }
    const q1 = now();
    const shown = bakers[li]!.layers();
    ground.draw(view, shown, { time, clear: [0.06, 0.07, 0.1] });
    lastGround = { view, gpu: false, keys: [], layers: shown, time };
    prof.plan += q1 - q0; prof.ground += now() - q1;
    }
    const q2 = now();
    mobs.setScale(li, zoom.rung, now());
    const a = viewAxes(view);
    layers.clear();
    const [x0, z0, x1, z1] = groundRectFor(view, -2, 16);
    vis.length = 0;
    objGrid.rect(x0, z0, x1, z1, vis);
    const onScreenObj = (px: number, py: number, pz: number, h: number, r: number): boolean => {
      const R = view.axes.right, U = view.axes.up, C = view.center, k = s.k;
      const dx = px - C[0], dy = py - C[1], dz = pz - C[2];
      const sx = W / 2 + (dx * R[0] + dz * R[2]) * k, sy = H / 2 - (dx * U[0] + dy * U[1] + dz * U[2]) * k;
      return sx > -r * k - 4 && sx < W + r * k + 4 && sy > -r * k - 4 && sy < H + h * k + 4;
    };
    // (Close in, a tree in front of the middle of the picture is cut away -- the units behind it are what a close zoom is for.)
    const cut = s.k >= 40;
    cutAway = 0;
    const cx0 = W * 0.22, cx1 = W * 0.78, cy1 = H * 0.8;
    for (let v = 0; v < vis.length && layers.count < layers.capacity; v += 1) {
      const p = placed[vis[v]!]!;
      const dd = objDesigns[p.design]!;
      pos[0] = p.x; pos[1] = p.y; pos[2] = p.z;
      // (Its depth is its base's front edge's -- a trunk, a rock's foot: keel/terrain spritePosition's footprint -- so the
      // ground under it never sinks it; the canopy over units in front of the trunk still doesn't hide them.)
      spritePosition(a, pos, pos, footprints ? dd.radius * p.scale * 0.5 : 0);
      if (!onScreenObj(pos[0], pos[1], pos[2], dd.height * p.scale, dd.radius * p.scale)) continue;
      if (cut) {
        const d = objDesigns[p.design]!;
        const [sx, sy, depth] = view.project(pos);
        const hw = (d.radius * 1.4 + 0.3) * s.k * p.scale, top = sy - d.height * p.scale * Math.cos(s.pitch) * s.k;
        // (Nearer the camera than the middle of the picture, over its middle band, tall enough to hide someone.)
        if (depth > 0.3 && sx + hw > cx0 && sx - hw < cx1 && top < cy1 && d.height * p.scale > (s.k >= 64 ? 0.5 : 1.2)) { cutAway += 1; continue; }
      }
      const n0 = layers.count;
      mobs.pushObject(li, layers, p.design, pos[0], pos[1], pos[2], s.k, p.scale);
      for (let q = n0; q < layers.count; q += 1) { instBase[q * 3] = p.x; instBase[q * 3 + 1] = p.y; instBase[q * 3 + 2] = p.z; }
    }
    foliageDrawn = layers.count;
    const q3 = now();
    prof.objects += q3 - q2;
    const alpha = acc / DT;
    const t = units.time + alpha * DT;
    // (On the picture or not, by its anchor's pixel and its size: close in, the ground rectangle a view covers holds far more than it shows.)
    const R = view.axes.right, U = view.axes.up, C = view.center, k = s.k;
    const onScreen = (px: number, py: number, pz: number, h: number, r: number): boolean => {
      const dx = px - C[0], dy = py - C[1], dz = pz - C[2];
      const sx = W / 2 + (dx * R[0] + dz * R[2]) * k, sy = H / 2 - (dx * U[0] + dy * U[1] + dz * U[2]) * k;
      return sx > -r * k - 4 && sx < W + r * k + 4 && sy > -r * k - 4 && sy < H + h * k + 4;
    };
    for (let u = 0; u < (unitsShown ? units.n : 0) && layers.count < layers.capacity - 4; u += 1) {
      const ux = units.px[u]! + (units.x[u]! - units.px[u]!) * alpha, uz = units.pz[u]! + (units.z[u]! - units.pz[u]!) * alpha;
      if (ux < x0 || ux > x1 || uz < z0 || uz > z1) continue;
      pos[0] = ux; pos[1] = units.y[u]!; pos[2] = uz;
      spritePosition(a, pos, pos, footprints ? 0.45 : 0); // (a stride: the front foot is ~0.4 m ahead)
      if (!onScreen(pos[0], pos[1], pos[2], 2.4, 1.2)) continue;
      const n0 = layers.count;
      mobs.pushOrtho(li, layers, u, pos[0], pos[1], pos[2], s.yaw, s.k, t);
      for (let q = n0; q < layers.count; q += 1) { instBase[q * 3] = ux; instBase[q * 3 + 1] = units.y[u]!; instBase[q * 3 + 2] = uz; }
    }
    drawn = layers.count;
    const q4 = now();
    if (layers.count && sr.pageCount) sr.drawLayers(view, layers, { clear: null, screen: screenFor(s.k), dither: 0.9, outline: 3 });
    const q5 = now();
    prof.units += q4 - q3; prof.submit += q5 - q4;
    placeMarker(view);
  }
  /** A perspective shot: the world solid near, billboards far (view3d.ts). */
  function drawPersp(s: PerspShot, time: number, dt: number, hide: boolean) {
    const alpha = acc / DT;
    const subj = modes.subject ?? -1;
    world3d.draw(s, { units, mobs, alpha, time, dt, hide: hide ? subj : -1, held: hide && modes.mode === "fps" });
    drawn = world3d.stats.solidUnits + world3d.stats.billboards;
    marker.style.display = "none";
  }
  function drawShot(s: OrthoShot | PerspShot, time: number, dt: number, hide: boolean) {
    if (s.kind === "ortho") drawOrtho(s, time); else drawPersp(s, time, dt, hide);
  }
  const prof = { sim: 0, draw: 0, update: 0, pump: 0, n: 0, plan: 0, ground: 0, objects: 0, units: 0, submit: 0, modes: 0, drive: 0 };
  function draw(f: ViewFrame, time: number, dt: number) {
    mobs.begin(now());
    mobs.resetFrame();
    // (The eye stream bakes at the scale a unit shows at where it turns to a billboard.)
    if (f.shot.kind === "persp" || f.blend) mobs.setScale(2, EYE_K, now());
    if (f.blend) {
      // A swap: the first shot captured, the second drawn, the first laid back over it through the screen.
      drawShot(f.shot, time, dt, f.hideSubject);
      dissolve.capture(W, H);
      drawShot(f.blend.shot, time, dt, f.hideSubject);
      dissolve.over(f.blend.t);
    } else drawShot(f.shot, time, dt, f.hideSubject);
    const u0 = now();
    // (The lanes this picture draws from re-order every frame while something on screen is missing, else every fourth;
    // the others now and then -- they only prefetch.)
    const persp = f.shot.kind === "persp" || !!f.blend;
    // (A perspective picture draws billboards from every lane, by the angle each is seen at: one lane re-orders a frame.)
    // (A perspective picture draws from every lane; each re-orders every fourth frame while it's missing something on
    // screen, else every 24th -- a re-order walks every slot, and a quiet lane's order is still good.)
    // (A re-order walks every slot of a lane -- ~3 ms for 51k slots -- so in perspective, where the frame is dearest, at most
    // one lane a frame: a lane missing something on screen every 12th frame, a quiet one every 48th.)
    if (persp && legacy3d) mobs.lanes.forEach((l, li) => { if ((l.stream.missingVisible > 0 && (updates + li) % 4 === 0) || updates % 24 === li * 8) l.stream.update(now()); });
    else if (persp) { const li = updates % 3, l = mobs.lanes[li]!; if ((l.stream.missingVisible > 0 && updates % 12 < 3) || updates % 48 === li) l.stream.update(now()); }
    else {
      const active = f.shot.kind === "ortho" && Math.abs(f.shot.pitch - STREAMS[0]!.pitch) < 1e-6 ? 0 : 1;
      mobs.lanes.forEach((l, li) => { if (li === active ? (l.stream.missingVisible > 0 && updates % 2 === 0) || updates % 6 === 0 : updates % 12 === li * 4 + 1) l.stream.update(now()); });
    }
    updates += 1;
    prof.update += now() - u0;
    lastFrame = f;
  }
  const px1 = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);

  // ---------------------------------------------------------------- the bake: the streams' jobs to the worker (or this thread)
  function startWorkers() {
    workers = createBakeWorkers<StreamJob>({ entry: { module: "examples/level-demo", run: "bakeWorker", url: moduleUrl() }, payload: { seed, count: nUnits, locks }, ...(wantWorkers !== null ? { count: Number(wantWorkers) } : {}) });
    workers.onBaked = (jobs, sprites) => {
      const byKey = new Map(sprites.map((s) => [s.key, s]));
      for (const j of jobs) { const s = byKey.get(j.key); if (s) arrived.push([j, s]); else mobs.lanes[laneOfJob(j)]?.stream.cancel(j); }
      bakedWorker += sprites.length;
    };
    workers.onReturned = (jobs) => { for (const j of jobs) mobs.lanes[laneOfJob(j)]?.stream.cancel(j); };
  }
  let sliceMs = 0, groundError: string | null = null;
  // (keel/terrain's chunk bake, guarded: a throw in it -- another agent's work in progress -- mustn't stop the frame loop.)
  function groundBake(li: number, ms: number) {
    try { bakers[li]!.bake(ms); } catch (e) { if (!groundError) { groundError = String((e as Error)?.stack ?? e); console.warn("ground bake:", groundError); } }
  }
  let quiet = false;
  function pump(gap: number) {
    if (quiet) return;
    const t0 = now();
    const slice = budget.slice({ hidden: document.hidden && gap > 250, loading: false });
    sliceMs = slice;
    // (The lanes the picture draws from first, then the others: a zoom's next bucket, the eye's billboards.)
    const persp = (lastFrame?.shot.kind === "persp" || !!lastFrame?.blend) && !legacy3d;
    // Baked sprites into the atlas (texture uploads): in a perspective view at most 1.5 ms and 24 a frame -- an upload
    // burst there was a 13-15 ms frame.
    let puts = 0;
    while (arrived.length && now() - t0 < (persp ? Math.min(slice, 1.5) : slice) && (!persp || puts < 24)) {
      const [job, sprite] = arrived.shift()!;
      mobs.lanes[laneOfJob(job)]?.stream.put(job, sprite);
      puts += 1;
    }
    const active = persp ? [2, zoom.bucket] : [zoom.bucket, 2];
    const order = [...active, ...[0, 1, 2].filter((l) => !active.includes(l))];
    const take = (n: number) => { for (const li of order) { const jobs = mobs.lanes[li]!.stream.take(n); if (jobs.length) return jobs; } return []; };
    // (Nothing on screen missing: only prefetch -- every other frame, so the worker's GPU work, sharing the GPU with the
    // picture, doesn't cost the picture its frame rate. Measured at 64-128 px/m: 13-15 ms frames prefetching every frame.)
    const idle = mobs.lanes.every((l) => l.stream.missingVisible === 0);
    // (In perspective the worker's bakes -- on the same GPU -- come at a lower priority: every third frame, smaller
    // batches; what's missing on screen still comes first.)
    const every = persp ? (idle ? 6 : 3) : idle ? 2 : 1;
    if (workers && workers.ready && updates % every === 0) {
      const perBatch = Math.max(idle ? 4 : 8, Math.min(persp ? 48 : 256, Math.round((persp ? (idle ? 3 : 6) : idle ? 6 : 12) / Math.max(0.03, workers.msPerSprite))));
      while (workers.free() > 0) { const jobs = take(perBatch); if (!jobs.length) break; workers.send(jobs); }
      workers.cancel((b) => b.jobs.every((j) => !mobs.lanes[laneOfJob(j)]?.stream.wanted(j)));
    } else if (!workers || workers.mode === "none" || !workers.ready) {
      const left = slice - (now() - t0);
      if (left > 0.5) {
        const jobs = take(Math.max(2, Math.min(200, Math.round(left / msPerSprite))));
        if (jobs.length) {
          const r = bakeSlice(bakeOnMain(), jobs, { indexed: mobs.sources.indexed, plain: mobs.sources.plain });
          const byKey = new Map(r.baked.map((s) => [s.key, s]));
          for (const j of jobs) { const s = byKey.get(j.key); const st = mobs.lanes[laneOfJob(j)]!.stream; if (s) st.put(j, s); else st.cancel(j); }
          bakedMain += r.baked.length; bakeMainMs += r.ms;
          msPerSprite = msPerSprite * 0.7 + (r.ms / jobs.length) * 0.3;
        }
      }
    }
    // The ground bakes in what's left (the near bucket's too as the zoom nears it: its layers are ready when the pitch changes).
    const b0 = now();
    const leftMs = Math.max(0.5, slice - (b0 - t0));
    const li = zoom.bucket;
    if (onGpu()) {
      // (The GPU ground: chunk uploads -- mesh and tiles, a few ms each -- in what's left, at most two a frame.)
      gpuT!.upload(Math.min(leftMs, 4), 2);
      budget.spent(now() - t0);
      return;
    }
    if (lastFrame?.shot.kind !== "persp") groundBake(li, bakers[li]!.ready ? leftMs * 0.4 : leftMs);
    const other = 1 - li;
    const nearEdge = li === 0 ? zoom.k > BUCKETS[0]!.upTo * 0.72 : zoom.k < BUCKETS[0]!.upTo * 1.4;
    if (nearEdge && lastFrame?.shot.kind === "ortho") {
      if (updates % 8 === 0) { const v = viewOf({ ...overviewShot(), pitch: BUCKETS[other]!.pitch }); const gk = Math.min(GROUND_MAX_K, zoom.rung), f = Math.max(1, gk / zoom.k); bakers[other]!.plan({ ...v, width: Math.ceil((W + 96) * f), height: Math.ceil((H + 96) * f), pixelsPerMetre: gk }); }
      groundBake(other, Math.max(0.5, slice - (now() - t0)));
    }
    budget.spent(now() - t0);
  }

  // ---------------------------------------------------------------- selection
  let selected = -1;
  function pick(px: number, py: number): number {
    const view = viewNow();
    const a = viewAxes(view);
    let best = -1, bd = Infinity;
    for (let u = 0; u < units.n; u += 1) {
      pos[0] = units.x[u]!; pos[1] = units.y[u]!; pos[2] = units.z[u]!;
      spritePosition(a, pos, pos);
      const [sx, sy] = view.project(pos);
      const h = mobs.shapes.bodies[mobs.unitBody[u]!]!.height * Math.cos(view.pitch) * view.pixelsPerMetre;
      const dx = px - sx, dy = py - (sy - h * 0.5);
      const d = Math.hypot(dx, dy * 0.7);
      if (d < Math.max(6, h * 0.7) && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  function placeMarker(view: PixelView) {
    if (selected < 0 || modes.mode !== "overview") { marker.style.display = "none"; return; }
    const a = viewAxes(view);
    pos[0] = units.x[selected]!; pos[1] = units.y[selected]!; pos[2] = units.z[selected]!;
    spritePosition(a, pos, pos);
    const [sx, sy] = view.project(pos);
    const h = Math.max(6, mobs.shapes.bodies[mobs.unitBody[selected]!]!.height * Math.cos(view.pitch) * view.pixelsPerMetre);
    const r = canvas.getBoundingClientRect();
    const s = r.width / W;
    marker.style.display = "block";
    marker.style.left = `${r.left + (sx - h * 0.45) * s}px`; marker.style.top = `${r.top + (sy - h * 1.05) * s}px`;
    marker.style.width = `${h * 0.9 * s}px`; marker.style.height = `${h * 1.15 * s}px`;
  }
  const subjectOf = (u: number) => {
    const v = units.speed[u]!, y = units.yaw[u]!;
    return { pos: [units.x[u]!, units.y[u]!, units.z[u]!] as [number, number, number], yaw: y, vel: [Math.sin(y) * v, 0, Math.cos(y) * v] as [number, number, number], height: mobs.shapes.bodies[mobs.unitBody[u]!]!.height, radius: 0.35 };
  };
  function possess(u: number) {
    if (u < 0 || u >= units.n) return;
    selected = u;
    units.possess(u);
    // (The arm's length by the unit's size: a fox is followed closer than a person.)
    modes.setChaseDistance(2.4 + mobs.shapes.bodies[mobs.unitBody[u]!]!.height * 2);
    modes.possess(u, subjectOf(u));
  }
  function release() {
    if (modes.subject === null) return;
    const u = modes.subject;
    units.release();
    modes.release();
    selected = u;
    if (document.pointerLockElement) void document.exitPointerLock();
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  let look: [number, number] = [0, 0];
  let actPressed = 0;
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    const possessed = modes.subject !== null;
    if (e.code === "Escape") release();
    if ((e.code === "KeyF" || e.code === "Enter") && !possessed) possess(selected >= 0 ? selected : pickCentre());
    if ((e.code === "KeyV" || e.code === "KeyC") && possessed) modes.toggleFirstPerson();
    if (e.code === "Space" && possessed) { actPressed |= ACT.attack; e.preventDefault(); }
    if (e.code === "KeyE" && possessed) actPressed |= ACT.use;
    if (e.code === "KeyT") setStyle(style === "pixel" ? "voxel" : "pixel");
    if (e.code === "KeyB") setGroundMode(groundMode === "gpu" ? "cpu" : "gpu");
    if (e.code === "KeyH") overlay.hidden = !overlay.hidden;
    if (e.code === "KeyG" && !possessed) { seed = `${seed}+`; build(); }
    if (e.code === "BracketLeft") { pixel = Math.max(0.5, pixel / 2); fit(); }
    if (e.code === "BracketRight") { pixel = Math.min(8, pixel * 2); fit(); }
    const digit = /^Digit([1-5])$/.exec(e.code);
    if (digit && !possessed) { nUnits = COUNTS[Number(digit[1]) - 1]!; makeUnits(); }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  const pickCentre = (): number => pick(W / 2, H / 2);
  const toPicture = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  let drag: { at: [number, number, number]; x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (modes.subject !== null) {
      // (Possessed: the left button strikes; a click takes the pointer for mouse-look.)
      if (e.button === 0) actPressed |= ACT.attack;
      if (!document.pointerLockElement) { try { void canvas.requestPointerLock(); } catch { /* not allowed here */ } }
      drag = { at: [0, 0, 0], x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { at: viewNow().ground(...toPicture(e)), x: e.clientX, y: e.clientY, moved: false };
    canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (e) => {
    if (modes.subject !== null) {
      if (document.pointerLockElement === canvas) { look[0] += e.movementX * LOOK_SPEED; look[1] -= e.movementY * LOOK_SPEED; }
      else if (drag) { look[0] += (e.clientX - drag.x) * LOOK_SPEED; look[1] -= (e.clientY - drag.y) * LOOK_SPEED; drag.x = e.clientX; drag.y = e.clientY; }
      return;
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true;
    if (!drag.moved) return;
    const g = viewNow().ground(...toPicture(e));
    modes.center = [modes.center[0] + drag.at[0] - g[0], 0, modes.center[2] + drag.at[2] - g[2]];
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && !drag.moved && modes.subject === null) { const u = pick(...toPicture(e)); selected = u; }
    drag = null; canvas.style.cursor = "grab";
  });
  canvas.addEventListener("dblclick", (e) => { if (modes.subject === null) { const u = pick(...toPicture(e)); if (u >= 0) possess(u); } });
  let wheel = 0;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (modes.subject !== null) { modes.setChaseDistance(modes.camera.rigs.orbit.opt.distance * (e.deltaY > 0 ? 1.12 : 1 / 1.12)); return; }
    wheel += e.deltaY;
    if (Math.abs(wheel) < 40) return;
    const step = wheel > 0 ? -1 : 1;
    wheel = 0;
    zoomAt(step, toPicture(e));
  }, { passive: false });
  /** Zoom by rungs about a picture point (the point under it stays put as the zoom eases). */
  let zoomPoint: { at: [number, number]; ground: [number, number, number] } | null = null;
  function zoomAt(steps: number, at: [number, number] = [W / 2, H / 2]) {
    zoomPoint = { at, ground: viewNow().ground(at[0], at[1]) };
    zoom.wheel(steps);
  }
  function holdZoomPoint() {
    if (!zoomPoint) return;
    const g = viewNow().ground(zoomPoint.at[0], zoomPoint.at[1]);
    modes.center = [modes.center[0] + zoomPoint.ground[0] - g[0], 0, modes.center[2] + zoomPoint.ground[2] - g[2]];
    if (zoom.settled) zoomPoint = null;
  }
  function pan(dt: number) {
    let f = 0, s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    if (!f && !s) return;
    const v = (600 / zoom.k) * dt;
    modes.center = [modes.center[0] + s * v, 0, modes.center[2] + f * v];
  }
  // The possessed unit's command for this tick: keys and a pad, turned by the camera's yaw.
  const pad = () => (typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) ?? null : null);
  let padWas = 0;
  function drive() {
    const u = modes.subject;
    if (u === null || modes.moving && modes.phase !== "dolly") { actPressed = 0; return; }
    let f = 0, s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    let act = actPressed | (keys.has("ShiftLeft") || keys.has("ShiftRight") ? ACT.run : 0);
    const g = pad();
    if (g) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      s += dz(g.axes[0] ?? 0); f -= dz(g.axes[1] ?? 0);
      look[0] += dz(g.axes[2] ?? 0) * 0.05; look[1] -= dz(g.axes[3] ?? 0) * 0.04;
      const btn = (i: number) => !!g.buttons[i]?.pressed;
      if (btn(0)) act |= ACT.attack;
      if (btn(2)) act |= ACT.use;
      if (btn(10) || btn(6)) act |= ACT.run;
      const pressed = (btn(1) ? 1 : 0) | (btn(3) ? 2 : 0);
      if (pressed & 1 && !(padWas & 1)) release();
      if (pressed & 2 && !(padWas & 2)) modes.toggleFirstPerson();
      padWas = pressed;
    }
    const fps = modes.mode === "fps";
    commands.push(sampleCommand(tick, u, { forward: Math.max(-1, Math.min(1, f)), strafe: Math.max(-1, Math.min(1, s)), act, facing: fps ? "camera" : "move" }, modes.camera.yaw, units.yaw[u]!));
    actPressed = 0;
  }

  // ---------------------------------------------------------------- the loop
  let last = now(), frames = 0, fpsT = now(), fps = 0, cpuMs = 0, frameNo = 0, overlayT = 0, t0 = now();
  const finished: number[] = [];
  function frame(dtIn?: number) {
    const f0 = now();
    const gap = f0 - last;
    const dt = dtIn ?? Math.min(0.1, gap / 1000);
    last = f0;
    if (modes.subject === null) { pan(dt); holdZoomPoint(); }
    const dv0 = now();
    drive();
    prof.drive += now() - dv0;
    const s0 = now();
    simulate(dt);
    prof.sim += now() - s0;
    const m0 = now();
    const subj = modes.subject !== null ? subjectOf(modes.subject) : null;
    if (subj && (updates % 4 === 0 || !cameraWorld.boxes?.length)) cameraWorld.boxes = modes.mode === "fps" ? [] : nearBoxes(subj.pos[0], subj.pos[1], subj.pos[2]);
    const f = modes.step(dt, subj, { look });
    prof.modes += now() - m0;
    look = [0, 0];
    // (A release finished: the unit is its AI's again.)
    if (modes.subject === null && units.possessed >= 0) units.release();
    const d0 = now();
    draw(f, (f0 - t0) / 1000, dt);
    const f1 = now();
    prof.draw += f1 - d0;
    cpuMs = cpuMs * 0.95 + (f1 - f0) * 0.05;
    budget.work(f1 - f0);
    if (++frameNo % 30 === 0) { finish(); finished.push(now() - f0); if (finished.length > 21) finished.shift(); }
    const p0 = now();
    pump(gap);
    prof.pump += now() - p0; prof.n += 1;
    frames += 1;
    if (f0 - fpsT >= 1000) { fps = (frames * 1000) / (f0 - fpsT); frames = 0; fpsT = f0; }
    if (f0 - overlayT > 250) { overlayT = f0; overlay.textContent = describe(); }
  }
  const median = (l: number[]) => { const s = l.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : 0; };
  const streamText = () => mobs.stats().map((s) => `${s.lane} ${s.target}px/m ${s.queued}q ${(s.used / 1048576).toFixed(0)}/${(s.bytes / 1048576).toFixed(0)}MB`).join(" · ");
  const stats = (): DemoStats => {
    const g = bakers[zoom.bucket]!.stats;
    const w3 = world3d.stats;
    return {
      fps: Math.round(fps), cpuMs: +cpuMs.toFixed(2), finishedMs: +median(finished).toFixed(2), simMs: +simMs.toFixed(2), picture: `${W}x${H}`, k: +zoom.k.toFixed(2), style, units: units.n, foliage: inst.sprites.length, drawn,
      ground: onGpu() && gpu
        ? `GPU · ${gpu.stats.chunks} chunks (${(gpu.stats.uploadMs / Math.max(1, gpu.stats.uploads)).toFixed(1)} ms an upload) · ${(gpu.stats.bytes / 1048576).toFixed(1)} MB · ${gpu.stats.draws} drawn · painted at ${groundK.toFixed(1)} px/m (B: CPU bake)`
        : `CPU bake · ${g.baked} chunk layers (${(g.ms / Math.max(1, g.baked)).toFixed(1)} ms each, last ${g.lastMs.toFixed(1)}) · ${g.queued} queued · ${(g.bytes / 1048576).toFixed(1)} MB · baked at ${groundK} px/m (B: GPU)`,
      objects: `${objDesigns.length} designs · ${mobs.B} body shapes · ${mobs.A} wearable shapes · ${table.count} looks`,
      level: `population ${shapesMs.toFixed(0)} + looks ${dressMs.toFixed(0)} ms · ${String(level.meta["template"])} · ${String(level.meta["biome"])} · ${level.terrain.width}x${level.terrain.depth} tiles · ${level.things.size} things · generated in ${genMs.toFixed(0)} ms · ${fairText}`,
      mode: `${modes.mode} (${modes.phase})${modes.subject !== null ? ` · unit ${modes.subject}` : ""}${lastFrame?.shot.kind === "persp" ? ` · 3D: ${w3.meshes} chunks, ${w3.solids} solids (${w3.solidUnits} units, ${w3.trees} trees), ${Math.round(w3.triangles / 1000)}k tris, ${w3.billboards} billboards, ${w3.lookRamps} look ramps` : ""}`,
      bake: `${workers ? `workers ${workers.mode} x${workers.ready}` : "main thread"} · ${bakedWorker} by worker, ${bakedMain} here · ${streamText()}`,
    };
  };
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
  const describe = () => {
    const s = stats();
    const fr = mobs.frame;
    const help = modes.subject !== null
      ? "WASD move · Shift run · Space/click strike · E use · mouse look (click: lock) · wheel in/out · V/C first person · Esc release"
      : "WASD/drag pan · wheel zoom · click select · F/Enter/double-click possess · B GPU/CPU ground · T style · 1-5 units · G new level · H hide";
    return `LEVEL DEMO  seed ${seed}\n${s.fps} fps   frame ${s.cpuMs.toFixed(2)} ms cpu · ${s.finishedMs.toFixed(2)} ms gpu-finished · sim ${s.simMs.toFixed(2)} ms\n${s.level}\nground: ${s.ground}\nobjects: ${s.objects} · ${s.foliage} plants · ${foliageDrawn} drawn\n${s.units} units · ${s.drawn} layers · ${s.picture} · ${s.k} px/m (rung ${zoom.rung}, pitch ${zoom.pitch}) · ${style}\nview: ${s.mode}\nbake: ${pct(fr.crisp, fr.wanted)}% crisp · ${pct(fr.drawn, fr.wanted)}% drawn · ${s.bake}\n${help}`;
  };
  let paused = false;
  const loop = () => { if (!paused) frame(); requestAnimationFrame(loop); };

  build();
  startWorkers();
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- for measuring (and the curious)
  const waitFrames = async (n: number, dt = 1 / 120) => { for (let i = 0; i < n; i += 1) { frame(dt); await new Promise((r) => setTimeout(r, 0)); } };
  const api = {
    stats: () => stats(),
    /** Where a frame's time went (ms, averaged since the last call). */
    profile() {
      const n = Math.max(1, prof.n);
      const r = (v: number) => +(v / n).toFixed(2);
      const out = { sim: r(prof.sim), draw: r(prof.draw - prof.update), update: r(prof.update), pump: r(prof.pump), frames: prof.n, groundPlan: r(prof.plan), groundDraw: r(prof.ground), objects: r(prof.objects), units: r(prof.units), submit: r(prof.submit), modes: r(prof.modes), drive: r(prof.drive) };
      for (const k of Object.keys(prof) as Array<keyof typeof prof>) prof[k] = 0;
      return out;
    },
    level: () => level,
    streams: () => mobs.stats(),
    frameCounts: () => ({ ...mobs.frame, cutAway, foliageDrawn }),
    world3d: () => ({ ...world3d.stats }),
    groundError: () => groundError,
    mobs: () => mobs,
    /** The level's objects: x, z, height (for finding open ground). */
    objects: () => placed.map((p) => [p.x, p.z, objDesigns[p.design]!.height * p.scale] as const),
    skip3d: (what: Partial<World3D["skip"]>) => Object.assign(world3d.skip, what),
    /** The perspective picture's fx list (keel/render's): e.g. [] to see it without the fog. */
    fx3d: (list: Parameters<World3D["px"]["setFx"]>[0]) => world3d.px.setFx(list),
    camera: () => ({ eye: [...modes.camera.eye], target: [...modes.camera.target], fov: modes.camera.fov, yaw: modes.camera.yaw, pitch: modes.camera.pitch }),
    ground: () => ({ mode: onGpu() ? "gpu" : "cpu", gpu: gpu ? { ...gpu.stats, ready: gpuT?.ready ?? false } : null, bakers: bakers.map((b) => ({ layers: b.layers().map((l) => l.k), ready: b.ready, stats: b.stats })) }),
    /** The ground's path: the GPU ground or the CPU bake (the reference). */
    setGround(m: "gpu" | "cpu") { setGroundMode(m); },
    /** Sprites' depth at their footprint's front edge (true) or at their middle (the old way). */
    setFootprints(on: boolean) { footprints = on; },
    /**
     * How much of the ground this frame should show it does show: the frame's ground drawn again exactly as it was (the
     * GPU ground's chunks, or the CPU bake's layers and stand-ins), against every chunk on the GPU. 1 is all of it.
     */
    groundCoverage(): number {
      if (!lastGround) return 0;
      const g = lastGround, v = g.view;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (g.gpu) gpu!.draw(v, { time: g.time, clear: [0, 0, 0], keys: g.keys, ...(groundArt ? { artScale: groundArt } : {}) });
      else ground.draw(v, g.layers, { time: g.time, clear: [0, 0, 0] });
      const a = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      if (!refGpu) { refGpu = createGpuGround(gl, { palette, seed: 1 }); refT = createGpuTerrain(refGpu, { terrain: level.terrain, auto: bakers[0]!.auto, surface: useSurface ? demoSurface(level) : null, extras: (c) => ge.extras(c), extrasKey: (c) => ge.extrasKey(c), prefetch: 0, seed: 1 }); refT.preload(); }
      refGpu.draw(v, { clear: [0, 0, 0], ...(g.gpu && groundArt ? { artScale: groundArt } : {}) });
      const b = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      let want = 0, got = 0;
      for (let o = 0; o < a.length; o += 4) { if (b[o]! + b[o + 1]! + b[o + 2]! === 0) continue; want += 1; if (a[o]! + a[o + 1]! + a[o + 2]! > 0) got += 1; }
      return want ? got / want : 1;
    },
    /**
     * A fast zoom with REAL wheel input: `steps` wheel notches out (a rung each) and back in, `perFrame` a frame, frames
     * of `dt` s -- through every rung and both pitch buckets -- and every frame's ground coverage. Returns the frames.
     */
    async zoomSweep(steps = 24, perFrame = 1, dt = 1 / 120) {
      const out: Array<{ f: number; k: number; pitch: number; coverage: number }> = [];
      const r = canvas.getBoundingClientRect();
      const wheelAt = (dir: number) => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * 120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      let f = 0;
      const run = async (dir: number) => {
        for (let n = 0; n < steps; n += perFrame) {
          for (let q = 0; q < perFrame; q += 1) wheelAt(dir);
          frame(dt); await new Promise((res) => setTimeout(res, 0));
          out.push({ f: f++, k: +zoom.k.toFixed(2), pitch: zoom.pitch, coverage: +api.groundCoverage().toFixed(4) });
        }
        // (Then the easing lands: frames until the zoom settles.)
        for (let q = 0; q < 240 && !zoom.settled; q += 1) { frame(dt); await new Promise((res) => setTimeout(res, 0)); out.push({ f: f++, k: +zoom.k.toFixed(2), pitch: zoom.pitch, coverage: +api.groundCoverage().toFixed(4) }); }
      };
      await run(-1);
      await run(1);
      return out;
    },
    /**
     * Sprites (trees, props, units) against the ground this frame: drawn over the frame's ground with the depth test,
     * and alone (no ground: the reference). Pixels of theirs the ground hides -- a cliff in front may; their own
     * footprint never should.
     */
    /**
     * Sprite by sprite (up to `max`), over the GPU ground at the view's own scale: each drawn alone with the depth test
     * and without (the reference), and every pixel of it the ground hides looked up in the ground's own pass -- hidden
     * by a top at or below the sprite's own level (its footprint, the ground just in front of its base) is a FAULT;
     * by a cliff face, a house or higher ground in front, an occluder. Needs the GPU ground.
     */
    spriteCheckStrict(max = 400): { sprites: number; pixels: number; hidden: number; faults: number; occluders: number } {
      if (!lastGround || !onGpu()) return { sprites: 0, pixels: 0, hidden: 0, faults: 0, occluders: 0 };
      const v = lastGround.view, t = level.terrain;
      const one = new LayerInstances(1);
      const drawGround = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gpu!.draw(v, { time: lastGround!.time, clear: [0, 0, 0], keys: lastGround!.keys }); };
      drawGround();
      const pass = gpu!.readPass()!;
      const ref = new Uint8Array(W * H * 4), got = new Uint8Array(W * H * 4);
      let sprites = 0, pixels = 0, hidden = 0, faults = 0, occluders = 0;
      faultList = [];
      const n = Math.min(layers.count, max);
      for (let i = 0; i < n; i += 1) {
        one.data.set(layers.data.subarray(i * LAYER_INSTANCE_FLOATS, (i + 1) * LAYER_INSTANCE_FLOATS)); one.count = 1;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        sr.drawLayers(v, one, { clear: [0, 0, 0], screen: 0, outline: 0 });
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ref);
        drawGround();
        sr.drawLayers(v, one, { clear: null, screen: 0, outline: 0 });
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, got);
        const [bi, bj] = t.tileAt(instBase[i * 3]!, instBase[i * 3 + 2]!);
        const base = t.height[t.index(bi, bj)]!;
        sprites += 1;
        for (let o = 0; o < ref.length; o += 4) {
          if (ref[o]! + ref[o + 1]! + ref[o + 2]! === 0) continue;
          pixels += 1;
          if (ref[o] === got[o] && ref[o + 1] === got[o + 1] && ref[o + 2] === got[o + 2]) continue;
          hidden += 1;
          const q = o, kind = (pass.data[q]! >>> 26) & 7, tile = pass.data[q + 3]!;
          const ti = tile & 0xffff, tj = tile >>> 16;
          if (kind === 1 && t.inside(ti, tj) && t.height[t.index(ti, tj)]! <= base) { faults += 1; if (faultList.length < 40) faultList.push({ i, x: +instBase[i * 3]!.toFixed(2), z: +instBase[i * 3 + 2]!.toFixed(2), base, tile: [ti, tj], th: t.height[t.index(ti, tj)]!, ramp: (t.flags[t.index(bi, bj)]! & 1) !== 0, rampAt: (t.flags[t.index(ti, tj)]! & 1) !== 0, row: Math.floor(o / 4 / W) }); } else occluders += 1;
        }
      }
      return { sprites, pixels, hidden, faults, occluders };
    },
    faults: () => faultList,
    spriteCheck(): { pixels: number; hidden: number } {
      if (!lastGround || !layers.count) return { pixels: 0, hidden: 0 };
      const g = lastGround, v = g.view;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      sr.drawLayers(v, layers, { clear: [0, 0, 0], screen: screenFor(v.pixelsPerMetre), dither: 0.9, outline: 3 });
      const ref = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ref);
      if (g.gpu) gpu!.draw(v, { time: g.time, clear: [0, 0, 0], keys: g.keys, ...(groundArt ? { artScale: groundArt } : {}) });
      else ground.draw(v, g.layers, { time: g.time, clear: [0, 0, 0] });
      sr.drawLayers(v, layers, { clear: null, screen: screenFor(v.pixelsPerMetre), dither: 0.9, outline: 3 });
      const got = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, got);
      let pixels = 0, hidden = 0;
      for (let o = 0; o < ref.length; o += 4) { if (ref[o]! + ref[o + 1]! + ref[o + 2]! === 0) continue; pixels += 1; if (ref[o] !== got[o] || ref[o + 1] !== got[o + 1] || ref[o + 2] !== got[o + 2]) hidden += 1; }
      return { pixels, hidden };
    },
    /** The GPU ground's largest art scale (0: the view's own). */
    setGroundArt(k: number) { groundArt = k; },
    setSize(w: number | null, h?: number) { fixed = w && h ? [w, h] : null; fit(); },
    /** Zoom to a scale now (snapped to the ladder; no easing). */
    setScale(next: number) { zoom.set(next, true); },
    zoomTo(next: number) { zoom.set(next); },
    setCenter(x: number, zz: number) { modes.center = [x, 0, zz]; },
    setStyle: (s: Style) => setStyle(s),
    setUnits(count: number) { nUnits = count; makeUnits(); },
    pause(on = true) { paused = on; },
    /** No baking at all while on (the prefetch a stream does forever, in a worker sharing the GPU): a frame's own cost. */
    quiet(on = true) { quiet = on; },
    /** Run frames here (not from rAF: a hidden page's rAF stops), `dt` seconds each, letting worker messages in between. */
    advance: (n = 1, dt = 1 / 120) => waitFrames(n, dt),
    /** Run frames until every layer of the picture is at its baked scale (and, in the overview, the ground's layers too, if `ground`), or `ms` pass: how long it took. */
    async untilCrisp(ms = 8000, groundToo = false) {
      const a = now();
      let ok = 0;
      while (now() - a < ms) {
        frame(1 / 120); await new Promise((r) => setTimeout(r, 0));
        const f = mobs.frame;
        const g = !groundToo || lastFrame?.shot.kind !== "ortho" || (onGpu() ? gpuT!.ready : bakers[zoom.bucket]!.ready);
        if (f.wanted && f.crisp === f.wanted && f.drawn === f.wanted && g) { if (++ok > 3) break; } else ok = 0;
      }
      return +(now() - a).toFixed(0);
    },
    units: () => units,
    select(u: number) { selected = u; },
    possess: (u: number) => possess(u),
    release: () => release(),
    toggleFps: () => modes.toggleFirstPerson(),
    /** Turn the chase / first-person camera (radians). */
    look(dyaw: number, dpitch = 0) { look = [look[0] + dyaw, look[1] + dpitch]; },
    /** Hold keys down (a scripted drive): e.g. ["KeyW"]. */
    hold(codes: string[]) { keys.clear(); for (const c of codes) keys.add(c); },
    strike() { actPressed |= ACT.attack; },
    mode: () => ({ mode: modes.mode, phase: modes.phase, subject: modes.subject, k: zoom.k, pitch: zoom.pitch }),
    /** Units near the view's centre, nearest first (for picking a group to shoot). */
    near(count = 10) { const c = modes.center; return Array.from({ length: units.n }, (_, u) => u).sort((a, b) => Math.hypot(units.x[a]! - c[0], units.z[a]! - c[2]) - Math.hypot(units.x[b]! - c[0], units.z[b]! - c[2])).slice(0, count); },
    /** Every unit stands still (the sim paused), or walks again. */
    freeze(on = true) { frozen = on; },
    /**
     * The ground alone, `count` times back to back, each waited for on the GPU (the view as it is; the CPU path draws its
     * baked layers): ms a draw. Nothing else is drawn, nothing bakes.
     */
    benchGround(count = 60) {
      const view = viewNow();
      const li = zoom.bucket;
      const t: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const f0 = now();
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (onGpu()) gpu!.draw(view, { time: i / 60, clear: [0.06, 0.07, 0.1], keys: gpuT!.visible });
        else ground.draw(view, bakers[li]!.layers(), { time: i / 60, clear: [0.06, 0.07, 0.1] });
        finish();
        t.push(now() - f0);
      }
      t.sort((a, b) => a - b);
      return { mode: onGpu() ? "gpu" : "cpu", median: +t[t.length >> 1]!.toFixed(3), p95: +t[Math.floor(t.length * 0.95)]!.toFixed(3), k: +zoom.k.toFixed(2), picture: `${W}x${H}`, draws: onGpu() ? gpu!.stats.draws : ground.stats.draws };
    },
    /** Run `count` frames back to back, each waited for on the GPU: ms per frame. */
    measure(count = 120) {
      const t: number[] = [], cpu: number[] = [];
      for (let i = 0; i < count; i += 1) {
        const f0 = now();
        frame(1 / 120);
        const f1 = now();
        finish();
        t.push(now() - f0); cpu.push(f1 - f0);
      }
      t.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
      return { median: +t[t.length >> 1]!.toFixed(3), p95: +t[Math.floor(t.length * 0.95)]!.toFixed(3), cpuMedian: +cpu[cpu.length >> 1]!.toFixed(3), drawn, units: units.n, picture: `${W}x${H}`, k: +zoom.k.toFixed(2), mode: modes.mode, phase: modes.phase, world3d: { ...world3d.stats } };
    },
    /** The overview without its units (to look at the ground). */
    showUnits(on = true) { unitsShown = on; },
    /** Draw a frame and save it upscaled nearest-neighbour by `scale` (PUT /out/<name>.png). */
    shootScaled(name: string, scale = 4): Promise<number> {
      frame(1 / 120);
      const c2 = document.createElement("canvas");
      c2.width = W * scale; c2.height = H * scale;
      const x = c2.getContext("2d")!;
      x.imageSmoothingEnabled = false;
      x.drawImage(canvas, 0, 0, W * scale, H * scale);
      return new Promise((done) => c2.toBlob((b) => { void fetch(`/out/${name}.png`, { method: "PUT", body: b }).then((r) => done(r.status)); }, "image/png"));
    },
    /** Draw a frame and save the picture to the dev server's out/ (PUT /out/<name>.png). */
    shoot(name: string): Promise<number> {
      frame(1 / 120);
      return new Promise((done) => canvas.toBlob((b) => { void fetch(`/out/${name}.png`, { method: "PUT", body: b }).then((r) => done(r.status)); }, "image/png"));
    },
  };
  (globalThis as { levelDemo?: typeof api }).levelDemo = api;
}
