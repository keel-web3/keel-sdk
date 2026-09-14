// WORLDS: the engine's world generation, in pixel art.
//
//   1  OVERWORLD   an infinite Minecraft-style world (keel/worldgen's
//                  overworld: climate biomes, rivers, lakes, villages, ruins,
//                  dungeon entrances) streamed a chunk at a time -- generated,
//                  scattered and baked in the frame's spare time, visible
//                  chunks first. Pan forever.
//   2  DUNGEON     a Diablo-style floor: T cycles the generator (stitched
//                  rooms, BSP, cellular caves, drunkard walks, wave function
//                  collapse), A the act (its tile theme); torchlight baked in.
//   3  MIXED       one map from several generators: a noise world, a cave
//                  region, a WFC town, keel/level's valley as a stage, a
//                  dungeon, a desert re-skin, a pinned rock.
//
// The ground is chunk layers (palette-true, per-texel depth) with the new
// surface: corner-blended materials, dithered biome borders, macro variation,
// decals, AO. Plants are scattered by the biomes' rules and drawn as indexed
// sprites that sway in the sprite shader (gust waves; the cursor bends them).
//
// Keys: WASD / arrows / drag pan, wheel zoom, 1 2 3 mode, B swap the biome
// under the cursor, N next season, C creep spreading from the cursor, T next
// dungeon generator, A next act, G new seed, F plants on/off, V pixel / voxel
// ground, U GPU ground / CPU bake, H hide the overlay. URL: ?mode= ?seed= ?k= ?size=WxH ?season= ?x= ?z= ?algo= ?ground=cpu
//
// The ground is keel/terrain's GPU ground by default: each chunk's mesh and tiles uploaded once, the surface painted
// by a fragment shader at the view's scale -- a biome swap or creep re-packs a chunk's tiles (one small texture), a
// season is a palette. U switches to the CPU bake (the reference, and the voxel style's only path).
// globalThis.worlds measures and shoots (PUT /out/<name>.png).

import { createPixelRenderer } from "@keel/game-engine/render";
import type { RenderCanvas } from "@keel/game-engine/render";
import { SWAY_INSTANCE_FLOATS, SwayInstances, createFrameBudget, createSpriteCache, createSpriteRenderer, packSway, pixelView } from "@keel/game-engine/bake";
import type { IndexedBakeRenderer, PixelView } from "@keel/game-engine/bake";
import { createGpuGround, createGpuTerrain, createGroundBaker, createGroundRenderer, groundRectFor, groundSurface, spritePosition, surfacePalette, viewAxes } from "@keel/game-engine/terrain";
import type { GpuGround, GpuTerrain, GroundBaker, GroundPalette, GroundStyle, LayerToDraw, Terrain } from "@keel/game-engine/terrain";
import {
  DEFAULT_ACTS, DUNGEON_ALGORITHMS, createBiomePainter, createWorldBaker, createWorldStream, drawLayersFor, runPipeline, scatterIn, seasonPaletteFor, toTerrain,
} from "@keel/game-engine/worldgen";
import type { BiomePainter, BiomeTable, DungeonAlgorithm, PlantInstance, TileLayers, WorldBaker, WorldMap, WorldStream, WorldThing } from "@keel/game-engine/worldgen";
import { createCatalogue } from "./plants.ts";
import type { Catalogue, Species, SpriteRect } from "./plants.ts";
import { dungeonRecipe, mixedRecipe, overworldRecipe } from "./recipes.ts";
import { createCrawl } from "./crawl.ts";
import type { Crawl } from "./crawl.ts";

type Mode = "overworld" | "dungeon" | "mixed";
const PITCH = 0.6, YAW = 0;
const LADDER = [2, 3, 4, 6, 8, 12, 16];
const SEASON_LIST = ["summer", "autumn", "winter", "spring"];
const SWAPS = ["desert", "forest", "snowy-peaks", "corruption", "jungle", "badlands", "alien"];
const param = (name: string): string | null => (typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) : null);
const now = () => performance.now();

/** A plant or a thing ready to draw: its species, shape, look inputs, where. */
interface Drawn { s: Species; shape: number; biome: string; variant: number; x: number; y: number; z: number; sway: boolean; scale: number }

export function main(host: HTMLElement): void {
  host.style.cssText = "margin:0;overflow:hidden;background:#000;height:100vh";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;image-rendering:pixelated;touch-action:none;cursor:crosshair";
  const overlay = document.createElement("pre");
  overlay.style.cssText = "position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(8,9,14,.72);color:#d8dcf0;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre";
  host.append(canvas, overlay);

  let mode: Mode = (param("mode") as Mode) ?? "overworld";
  if (!["overworld", "dungeon", "mixed"].includes(mode)) mode = "overworld";
  let seed = param("seed") ?? "keel-1";
  let season = param("season") ?? "summer";
  let algo: DungeonAlgorithm = (param("algo") as DungeonAlgorithm) ?? "rooms";
  let actIndex = 0;
  let groundStyleName: "pixel" | "voxel" = param("style") === "voxel" ? "voxel" : "pixel";
  let plantsOn = true;
  // (Every foliage layer whatever the zoom -- the grass and flowers the view would fade out: for measuring.)
  let allLayers = param("layers") === "all";
  let windOn = param("wind") !== "off";
  const groundStyle = (): GroundStyle => (groundStyleName === "voxel" ? { name: "voxel", voxels: 4, outline: 2 } : { name: "pixel", screen: 4, dither: 0.9, outline: 2 });

  // ---------------------------------------------------------------- the view
  let pixel = Number(param("px") ?? 0) || (globalThis.devicePixelRatio || 1);
  let fixed: [number, number] | null = null;
  { const s = param("size"); const m = s && /^(\d+)x(\d+)$/.exec(s); if (m) fixed = [Number(m[1]), Number(m[2])]; }
  let W = 0, H = 0;
  let k = Number(param("k") ?? 8);
  if (!LADDER.includes(k)) k = 8;
  let center: [number, number, number] = [Number(param("x") ?? 0), 0, Number(param("z") ?? 0)];
  const sr = createSpriteRenderer(canvas, { width: 64, height: 64, capacity: 1 << 16 });
  const gl = sr.gl;
  const ground = createGroundRenderer(gl);
  let groundMode: "gpu" | "cpu" = param("ground") === "cpu" ? "cpu" : "gpu";
  let gpu: GpuGround | null = null;
  let gpuT: GpuTerrain | null = null;                       // (dungeon and mixed maps: one terrain)
  const gpuWorld = new Map<string, number>();                // (the overworld: chunk key -> the version uploaded)
  let gpuKeys: string[] = [];
  let lastPaintMs = 0, lastPaintChunks = 0, lastSeasonMs = 0;
  let footprints = true, onlyThings = false;
  // What the ground drew this frame (the checks redraw exactly it).
  let lastGround: { view: PixelView; gpu: boolean; keys: readonly string[]; layers: readonly LayerToDraw[]; time: number } | null = null;
  let refGpu: GpuGround | null = null, lastRefKeys = 0;
  const onGpu = (): boolean => groundMode === "gpu" && groundStyleName === "pixel" && !crawl;
  // (The dungeon's crawl: its own renderer on the same context, a close camera and a hero. ?dungeon=classic: the old baked view.)
  const crawlMode = () => mode === "dungeon" && param("dungeon") !== "classic";
  let crawl: Crawl | null = null;
  function fit() {
    const dpr = globalThis.devicePixelRatio || 1;
    if (crawlMode() && !param("px")) pixel = Math.max(2, Math.round((innerHeight * dpr) / 330));
    const [w, h] = fixed ?? [Math.max(64, Math.round((innerWidth * dpr) / pixel)), Math.max(48, Math.round((innerHeight * dpr) / pixel))];
    if (w !== W || h !== H) { W = w; H = h; sr.setTarget(W, H); }
    const s = Math.min(innerWidth / W, innerHeight / H);
    const cw = fixed ? W * s : innerWidth, ch = fixed ? H * s : innerHeight;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    canvas.style.left = `${(innerWidth - cw) / 2}px`; canvas.style.top = `${(innerHeight - ch) / 2}px`;
  }
  fit();
  addEventListener("resize", fit);
  const viewNow = (): PixelView => {
    const a = viewAxes({ yaw: YAW, pitch: PITCH, pixelsPerMetre: k });
    const gx = Math.round((center[0] * a.right[0] + center[2] * a.right[2]) * k) / k;
    const gy = Math.round((center[0] * a.up[0] + center[1] * a.up[1] + center[2] * a.up[2]) * k) / k;
    const f = center[0] * a.forward[0] + center[1] * a.forward[1] + center[2] * a.forward[2];
    const c: [number, number, number] = [a.right[0] * gx + a.up[0] * gy + a.forward[0] * f, a.up[1] * gy + a.forward[1] * f, a.right[2] * gx + a.up[2] * gy + a.forward[2] * f];
    return pixelView({ center: c, yaw: YAW, pitch: PITCH, pixelsPerMetre: k, width: W, height: H });
  };

  // ---------------------------------------------------------------- sprites: plants and things
  const bakeCanvas: RenderCanvas = typeof OffscreenCanvas !== "undefined" ? (new OffscreenCanvas(64, 64) as unknown as RenderCanvas) : document.createElement("canvas");
  const px = createPixelRenderer(bakeCanvas, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
  const cache = createSpriteCache();
  const cat: Catalogue = createCatalogue();
  let rects = new Map<string, SpriteRect>();
  let bakedAt = 0, bakedCount = -1, spritesMs = 0;
  let looks = cat.looks(season);
  let lookGen = 0, atlasGen = 0; // (what packed buckets are keyed by, with the scale)
  let looksUploaded = -1;
  const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
  function ensureSprites() {
    const n = cat.list.reduce((a, s) => a + s.shapes.length, 0);
    if (bakedAt === k && bakedCount === n) return;
    const r = cat.bake(px, cache, k, PITCH, maxTex);
    if (r.pages.length) sr.setPages(r.pages);
    rects = r.rects; bakedAt = k; bakedCount = n; spritesMs = r.ms; atlasGen += 1;
    // (Other scales' sprites go: zooming back bakes them again in a few milliseconds.)
    const keep = new Set([...rects.keys()]);
    void keep;
  }
  function ensureLooks() {
    if (looksUploaded === looks.table.count) return;
    sr.setLooks({ palette: looks.table.palette(), paints: looks.table.paintTexture(), looks: looks.table.texture() });
    looksUploaded = looks.table.count;
  }

  // ---------------------------------------------------------------- the world (three modes)
  let stream: WorldStream | null = null;
  let wb: WorldBaker | null = null;
  let map: WorldMap | null = null;
  let terrain: Terrain | null = null;
  let baker: GroundBaker | null = null;
  let painter: BiomePainter | null = null;
  let biomeMap: Uint8Array | null = null;
  let table: BiomeTable;
  let palette: GroundPalette;
  let genMs = 0;
  // Plants and things per 32-tile bucket (a chunk): what's drawn is the buckets in view.
  const buckets = new Map<string, { drawn: Drawn[]; version: number }>();
  const bucketVersion = new Map<string, number>();
  let plantCount = 0;
  const B = 32;

  const act = (): string => DEFAULT_ACTS[actIndex % DEFAULT_ACTS.length]!.id;
  function build() {
    const t0 = now();
    fit();
    if (crawlMode()) {
      const pk = Number(param("k") ?? 24);
      if (crawl) { crawl.setSeed(seed); } else crawl = createCrawl({ gl, px, maxTexture: maxTex, seed, algorithm: algo, act: param("act") ?? "crypt", k: [16, 24, 32, 48].includes(pk) ? pk : 24 });
      genMs = now() - t0;
      return;
    }
    crawl = null;
    buckets.clear(); bucketVersion.clear();
    stream = null; wb = null; map = null; terrain = null; baker = null; painter = null; biomeMap = null;
    if (mode === "overworld") {
      stream = createWorldStream(overworldRecipe(seed));
      table = stream.table;
      palette = seasonPaletteFor(stream.types, table, season);
      wb = createWorldBaker({ stream, palette, style: groundStyle(), prefetch: 1, floor: 2 });
    } else {
      const recipe = mode === "dungeon" ? dungeonRecipe(seed, algo, act()) : mixedRecipe(seed);
      map = runPipeline(recipe);
      const s0 = createWorldStream({ ...recipe, width: 0, depth: 0 });
      table = s0.table;
      terrain = toTerrain(map, { chunk: 32, id: `${mode}:${seed}` });
      biomeMap = map.biome.slice();
      const lit = map.light.some((v) => v !== 255);
      palette = seasonPaletteFor(terrain.types, table, season);
      baker = createGroundBaker({ terrain, palette, style: groundStyle(), surface: groundSurface({ biomes: table.surfaceBiomes(), biome: biomeMap, ...(lit ? { light: map.light } : {}) }), prefetch: 1, seed: 1, floor: 2 });
      baker.bakeFloor({ yaw: YAW, pitch: PITCH, pixelsPerMetre: 2 });
      painter = createBiomePainter({ terrain, biome: biomeMap, table, seed });
      // Start where it's worth looking: the dungeon's start, the map's middle.
      const start = map.things.find((t) => t.kind === "start");
      const at = start ? start.pos : [map.w, 0, map.d * 0.9] as const;
      if (param("x") === null) center = [at[0], 0, at[2]];
    }
    ground.setPalette(palette);
    // The GPU ground: the same palette; the overworld's chunks as they're generated, a map's through createGpuTerrain.
    gpuT?.dispose(); gpuT = null;
    for (const key of gpuWorld.keys()) gpu?.drop(key);
    gpuWorld.clear();
    gpu ??= createGpuGround(gl, { palette, style: groundStyle(), seed: 1 });
    gpu.setPalette(palette);
    if (baker && terrain) gpuT = createGpuTerrain(gpu, { terrain, auto: baker.auto, surface: baker.surface, prefetch: 1, seed: 1 });
    genMs = now() - t0;
  }
  // The overworld's chunks on the GPU: the visible ones (generated if they aren't yet), then a ring round them; a painted
  // chunk's tiles re-packed; chunks the world baker forgot, dropped. Returns the keys to draw.
  function gpuPlanWorld(view: PixelView, ms: number): string[] {
    const w = wb!;
    w.floor = null; // (the GPU ground draws: the CPU bake's floor isn't wanted)
    const vis = w.plan(view);
    const until = now() + ms;
    const want = vis.slice();
    if (vis.length) {
      const xs = vis.map((c) => c[0]), zs = vis.map((c) => c[1]);
      const a0 = Math.min(...xs) - 1, a1 = Math.max(...xs) + 1, b0 = Math.min(...zs) - 1, b1 = Math.max(...zs) + 1;
      for (let cz = b0; cz <= b1; cz += 1) for (let cx = a0; cx <= a1; cx += 1) if (cx === a0 || cx === a1 || cz === b0 || cz === b1) want.push([cx, cz]);
    }
    const keys: string[] = [];
    let n = 0;
    for (let q = 0; q < want.length; q += 1) {
      const [cx, cz] = want[q]!;
      const key = `${cx},${cz}`;
      const visible = q < vis.length;
      const s = w.chunks.get(key);
      const have = gpuWorld.get(key);
      if (s && have === s.version && gpu!.has(key)) { if (visible) keys.push(key); continue; }
      // (Everything on the picture, always -- a fast zoom out costs a frame some generating, never a hole; the ring
      // round it inside the budget.)
      if (!visible && now() > until) continue;
      const st = s ?? w.chunk(cx, cz);
      const L = st.layers, C = stream!.chunkSize;
      const lit = L.light.some((v) => v !== 255);
      const input = { terrain: st.terrain, chunk: 0, rect: [2, 2, 2 + C, 2 + C] as const, origin: [L.i0, L.j0] as const, surface: groundSurface({ biomes: table.surfaceBiomes(), biome: L.biome, ...(lit ? { light: L.light } : {}) }), seed: 1 };
      if (have !== undefined && gpu!.has(key)) gpu!.updateTiles(key, input); else gpu!.setChunk(key, input);
      gpuWorld.set(key, st.version);
      n += 1;
      if (visible) keys.push(key);
    }
    for (const key of [...gpuWorld.keys()]) if (!w.chunks.has(key)) { gpu!.drop(key); gpuWorld.delete(key); }
    return keys;
  }

  // Turn a chunk's plants and things into draw items.
  const thingSpecies = (th: WorldThing): Species | null => (th.pack && th.object ? cat.species(th.pack, th.object) : th.kind === "key" ? cat.species("packs/foliage", "crystal") : th.kind === "exit" ? cat.species("packs/buildings", "stairs") : th.kind === "boss" ? cat.species("packs/buildings", "pylon") : null);
  function drawnOf(plants: readonly PlantInstance[], things: readonly WorldThing[]): Drawn[] {
    const out: Drawn[] = [];
    for (const p of plants) {
      const s = cat.species(p.pack, p.object, p.pins ?? {});
      if (!s) continue;
      const shape = Math.min(s.shapes.length - 1, Math.floor(p.age * s.shapes.length));
      out.push({ s, shape, biome: table.list[p.biome]!.id, variant: p.seed % 3, x: p.x, y: p.y, z: p.z, sway: true, scale: 1 });
    }
    for (const th of things) {
      const s = thingSpecies(th);
      if (!s) continue;
      // (A thing's own scale -- a prop's rubble is a small rock -- in whole steps of the sprite: 1, 1/2 or 1/3.)
      const sc = th.scale >= 0.75 ? 1 : th.scale >= 0.42 ? 0.5 : 1 / 3;
      const n = s.shapes.length;
      out.push({ s, shape: ((Math.floor(th.pos[0] * 7 + th.pos[2] * 13) % n) + n) % n, biome: "plains", variant: 0, x: th.pos[0], y: th.pos[1], z: th.pos[2], sway: false, scale: sc });
    }
    return out;
  }
  // A bucket's plants: scattered from tiles with a margin (the scatter reads 4 tiles round).
  function bucket(bx: number, bz: number): Drawn[] {
    const key = `${bx},${bz}`;
    const version = bucketVersion.get(key) ?? 0;
    const have = buckets.get(key);
    if (have && have.version === version) return have.drawn;
    let L: TileLayers, things: readonly WorldThing[];
    if (stream && wb) {
      L = stream.block(bx * B - 4, bz * B - 4, B + 8, B + 8);
      things = wb.chunks.get(key)?.things ?? stream.chunk(bx, bz).things;
    } else {
      L = map!;
      things = map!.things.filter((t) => Math.floor(t.pos[0] / 2 / B) === bx && Math.floor(t.pos[2] / 2 / B) === bz);
    }
    const plants = scatterIn(L, [bx * B * 2, bz * B * 2, (bx + 1) * B * 2, (bz + 1) * B * 2], {
      seed, table, types: L === map ? map.types : stream!.types, density: 1,
      biomeOf: (i, j, b) => (wb ? wb.biomeAt(i, j) : biomeMap ? biomeMap[j * map!.w + i] ?? b : b),
    });
    const drawn = drawnOf(plants, things);
    buckets.set(key, { drawn, version });
    return drawn;
  }

  // ---------------------------------------------------------------- a frame
  const inst = new SwayInstances(1 << 17);
  let drawn = 0, lastPlantMs = 0;
  let cursor: [number, number, number] | null = null;
  function drawSprites(view: PixelView, time: number) {
    if (!plantsOn) return;
    const t0 = now();
    const a = viewAxes(view);
    const [x0, z0, x1, z1] = groundRectFor(view, -4, 20);
    const layers = new Set(allLayers ? ["canopy", "understory", "shrub", "grass", "flower", "rock"] : drawLayersFor(k));
    const b0 = Math.floor(x0 / (B * 2)), b1 = Math.floor(x1 / (B * 2)), c0 = Math.floor(z0 / (B * 2)), c1 = Math.floor(z1 / (B * 2));
    const lists: Drawn[][] = [];
    let budget = 3; // (new buckets scattered a frame: the rest next frame)
    for (let bz = c0; bz <= c1; bz += 1) for (let bx = b0; bx <= b1; bx += 1) {
      if (map && (bx < 0 || bz < 0 || bx * B >= map.w || bz * B >= map.d)) continue;
      const key = `${bx},${bz}`;
      const ready = buckets.get(key)?.version === (bucketVersion.get(key) ?? 0);
      if (!ready && budget-- <= 0) continue;
      lists.push(bucket(bx, bz));
    }
    ensureSprites();
    // Each bucket's instances are packed once per scale, season and atlas (positions, rects, looks, sways never change
    // between frames at a fixed view angle); a frame copies the visible buckets' floats in, whole.
    const D = inst.data;
    let n = 0;
    const layersKey = allLayers ? "all" : [...layers].join(",");
    for (const list of lists) {
      const p = packOf(list, a, layers, `${k}|${lookGen}|${atlasGen}|${layersKey}|${windOn ? 1 : 0}|${onlyThings ? 1 : 0}|${footprints ? 1 : 0}`);
      if (n + p.count > inst.capacity) break;
      D.set(p.data.subarray(0, p.count * SWAY_INSTANCE_FLOATS), n * SWAY_INSTANCE_FLOATS);
      n += p.count;
    }
    void x0; void z0; void x1; void z1;
    inst.count = n;
    drawn = n;
    ensureLooks();
    const benders: Array<[number, number, number, number]> = cursor ? [[cursor[0], cursor[2], 3, 3]] : [];
    if (n) sr.drawSway(view, inst, { clear: null, screen: 4, dither: 0.9, outline: 1, time, wind: 0.7, speed: 3.5, gust: 0.7, benders });
    lastPlantMs = now() - t0;
  }
  // A bucket's instance floats, packed (cached on the list itself by its key).
  const packs = new WeakMap<Drawn[], { key: string; data: Float32Array; count: number }>();
  function packOf(list: Drawn[], a: ReturnType<typeof viewAxes>, layers: ReadonlySet<string>, key: string): { key: string; data: Float32Array; count: number } {
    const have = packs.get(list);
    if (have && have.key === key) return have;
    const data = have && have.data.length >= list.length * SWAY_INSTANCE_FLOATS ? have.data : new Float32Array(list.length * SWAY_INSTANCE_FLOATS);
    const pos: [number, number, number] = [0, 0, 0];
    let n = 0;
    for (const d of list) {
      const sh = d.s.shapes[d.shape]!;
      if (d.s.foliage && !layers.has(layerOf(d.s.object))) continue;
      if (onlyThings && d.sway) continue;
      const r = rects.get(sh.design.key);
      if (!r) continue;
      pos[0] = d.x; pos[1] = d.y; pos[2] = d.z;
      // (Its depth at its footprint's front edge -- a building's whole base, a plant's stem -- so the ground under it
      // never sinks it: keel/terrain spritePosition's footprint.)
      spritePosition(a, pos, pos, footprints ? sh.design.radius * d.scale * (d.sway ? 0.4 : 1) : 0);
      const o = n * SWAY_INSTANCE_FLOATS;
      data[o] = pos[0]; data[o + 1] = pos[1]; data[o + 2] = pos[2]; data[o + 3] = r.x; data[o + 4] = r.y; data[o + 5] = r.w; data[o + 6] = r.h; data[o + 7] = r.ax; data[o + 8] = r.ay; data[o + 9] = r.page;
      data[o + 10] = looks.lookOf(d.s, d.biome, d.variant); data[o + 11] = 0; data[o + 12] = (k / r.k) * d.scale; data[o + 13] = 0;
      data[o + 14] = windOn && d.sway && sh.built.sway ? packSway(sh.built.sway, r.ay * (k / r.k), k) : 0; data[o + 15] = 0;
      n += 1;
    }
    const out = { key, data, count: n };
    packs.set(list, out);
    return out;
  }
  const layerOf = (object: string): "canopy" | "understory" | "shrub" | "grass" | "flower" | "rock" =>
    object === "grass" ? "grass" : object === "flowers" ? "flower" : object === "rock" ? "rock" : object === "bush" || object === "reeds" || object === "cactus" || object === "mushroom" || object === "crystal" ? "shrub" : object === "log" || object === "stump" ? "understory" : "canopy";

  function draw(view: PixelView, time: number) {
    if (crawl) { crawl.draw(W, H); return; }
    const clear: [number, number, number] = mode === "dungeon" ? [0.02, 0.02, 0.03] : [0.08, 0.1, 0.16];
    if (onGpu()) {
      if (wb) gpuKeys = gpuPlanWorld(view, 0);
      else { gpuKeys = gpuT!.plan(view); if (!gpuT!.ready) gpuT!.upload(2); }
      gpu!.draw(view, { time, clear, keys: gpuKeys });
      lastGround = { view, gpu: true, keys: gpuKeys.slice(), layers: [], time };
    } else {
      let layers: LayerToDraw[];
      if (wb) { wb.floor = 2; wb.plan(view); layers = wb.layers(); } else { baker!.plan(view); layers = baker!.layers(); }
      ground.draw(view, layers, { time, clear });
      lastGround = { view, gpu: false, keys: [], layers, time };
    }
    drawSprites(view, time);
  }
  const px1 = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);

  // ---------------------------------------------------------------- swaps, seasons, creep
  function setSeason(s: string) {
    season = s;
    palette = seasonPaletteFor(terrain?.types ?? stream!.types, table, season);
    ground.setPalette(palette);
    const s0 = now();
    gpu?.setPalette(palette);
    lastSeasonMs = now() - s0;
    if (wb) wb.palette = palette; else if (baker) baker.palette = palette;
    looks = cat.looks(season);
    looksUploaded = -1;
    lookGen += 1;
  }
  function touchBuckets(tiles: ReadonlyArray<readonly [number, number]>) {
    const keys = new Set(tiles.map(([i, j]) => `${Math.floor(i / B)},${Math.floor(j / B)}`));
    for (const key of keys) bucketVersion.set(key, (bucketVersion.get(key) ?? 0) + 1);
  }
  let swapN = 0;
  function swapAt(x: number, z: number, radius = 11, to?: string) {
    const biome = to ?? SWAPS[swapN++ % SWAPS.length]!;
    const ci = Math.floor(x / 2), cj = Math.floor(z / 2);
    const tiles: Array<[number, number]> = [];
    for (let dj = -radius; dj <= radius; dj += 1) for (let di = -radius; di <= radius; di += 1) {
      // (A ragged disc: the edge wobbles.)
      const r = radius * (0.8 + 0.4 * Math.sin(Math.atan2(dj, di) * 5 + ci));
      if (Math.hypot(di, dj) < r) tiles.push([ci + di, cj + dj]);
    }
    const t0 = now();
    paint(tiles, biome);
    return { biome, tiles: tiles.length, ms: now() - t0 };
  }
  function paint(tiles: ReadonlyArray<readonly [number, number]>, biome: string) {
    let touched: Array<[number, number]> = [];
    if (wb) touched = wb.paint(tiles, biome);
    else if (painter && terrain) painter.paint(tiles.filter(([i, j]) => terrain!.inside(i, j)).map(([i, j]) => j * terrain!.width + i), biome);
    touchBuckets(tiles);
    // (The GPU ground: only the touched chunks' tiles are re-packed -- one small texture each; the mesh is the same.)
    if (onGpu()) {
      const p0 = now();
      if (wb) {
        const C = stream!.chunkSize;
        for (const [cx, cz] of touched) {
          const key = `${cx},${cz}`, st = wb.chunks.get(key);
          if (!st || !gpu!.has(key)) continue;
          const L = st.layers, lit = L.light.some((v) => v !== 255);
          gpu!.updateTiles(key, { terrain: st.terrain, chunk: 0, rect: [2, 2, 2 + C, 2 + C], origin: [L.i0, L.j0], surface: groundSurface({ biomes: table.surfaceBiomes(), biome: L.biome, ...(lit ? { light: L.light } : {}) }), seed: 1 });
          gpuWorld.set(key, st.version);
        }
        lastPaintChunks = touched.length;
      } else if (gpuT && terrain) {
        const cs = new Set(tiles.filter(([i, j]) => terrain!.inside(i, j)).map(([i, j]) => terrain!.chunkOf(i, j)));
        gpuT.touch(cs);
        lastPaintChunks = gpuT.upload(50);
      }
      lastPaintMs = now() - p0;
    }
  }
  // Creep: a front spreading from where it was dropped, a ragged step every few tenths of a second.
  let creep: Set<string> | null = null, creepFront: Array<[number, number]> = [], creepT = 0;
  function dropCreep(x: number, z: number) { const i = Math.floor(x / 2), j = Math.floor(z / 2); creep = new Set([`${i},${j}`]); creepFront = [[i, j]]; paint([[i, j]], "corruption"); }
  function stepCreep() {
    if (!creep || !creepFront.length) return;
    const next: Array<[number, number]> = [];
    for (const [i, j] of creepFront) for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const) {
      const key = `${a},${b}`;
      if (creep.has(key)) continue;
      const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
      if (h - Math.floor(h) < 0.55) { creep.add(key); next.push([a, b]); }
    }
    creepFront = next.length ? next.concat(creepFront.filter((_, n) => n % 3 === 0)) : [];
    if (creep.size > 6000) creepFront = [];
    if (next.length) paint(next, "corruption");
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  const toPicture = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  let mouse: [number, number] = [0, 0];
  addEventListener("keydown", (e) => {
    if (crawl && !e.code.startsWith("Digit") && e.code !== "KeyH" && crawl.key(e.code, true)) { e.preventDefault(); return; }
    keys.add(e.code);
    const at = viewNow().ground(...mouse);
    if (e.code === "Digit1") { mode = "overworld"; build(); }
    if (e.code === "Digit2") { mode = "dungeon"; build(); }
    if (e.code === "Digit3") { mode = "mixed"; build(); }
    if (e.code === "KeyB") swapAt(at[0], at[2]);
    if (e.code === "KeyN") setSeason(SEASON_LIST[(SEASON_LIST.indexOf(season) + 1) % SEASON_LIST.length]!);
    if (e.code === "KeyC") dropCreep(at[0], at[2]);
    if (e.code === "KeyT" && mode === "dungeon") { algo = DUNGEON_ALGORITHMS[(DUNGEON_ALGORITHMS.indexOf(algo) + 1) % DUNGEON_ALGORITHMS.length]!; build(); }
    if (e.code === "KeyA" && mode === "dungeon") { actIndex += 1; build(); }
    if (e.code === "KeyG") { seed = `${seed}+`; build(); }
    if (e.code === "KeyF") plantsOn = !plantsOn;
    if (e.code === "KeyV") { groundStyleName = groundStyleName === "pixel" ? "voxel" : "pixel"; if (wb) wb.style = groundStyle(); if (baker) baker.style = groundStyle(); }
    if (e.code === "KeyH") overlay.hidden = !overlay.hidden;
    if (e.code === "KeyU") groundMode = groundMode === "gpu" ? "cpu" : "gpu";
  });
  addEventListener("keyup", (e) => { keys.delete(e.code); crawl?.key(e.code, false); });
  addEventListener("blur", () => keys.clear());
  let drag: [number, number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => { if (crawl) { crawl.click(...toPicture(e)); return; } canvas.setPointerCapture(e.pointerId); drag = viewNow().ground(...toPicture(e)); });
  canvas.addEventListener("pointermove", (e) => {
    mouse = toPicture(e);
    cursor = viewNow().ground(...mouse);
    if (!drag) return;
    const g = viewNow().ground(...mouse);
    center = [center[0] + drag[0] - g[0], 0, center[2] + drag[2] - g[2]];
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointerleave", () => { cursor = null; });
  let wheel = 0;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 50) return;
    const step = wheel > 0 ? -1 : 1;
    wheel = 0;
    if (crawl) { crawl.zoom(step); return; }
    setScale(LADDER[Math.max(0, Math.min(LADDER.length - 1, LADDER.indexOf(k) + step))]!, toPicture(e));
  }, { passive: false });
  function setScale(next: number, at: [number, number] = [W / 2, H / 2]) {
    if (next === k) return;
    const before = viewNow().ground(at[0], at[1]);
    k = next;
    const after = viewNow().ground(at[0], at[1]);
    center = [center[0] + before[0] - after[0], 0, center[2] + before[2] - after[2]];
  }
  function pan(dt: number) {
    let f = 0, s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    if (keys.has("KeyA") && mode !== "dungeon" || keys.has("ArrowLeft")) s -= 1;
    if (!f && !s) return;
    const v = (700 / k) * dt;
    center = [center[0] + s * v, 0, center[2] + f * v];
  }

  // ---------------------------------------------------------------- the loop
  build();
  const budget = createFrameBudget();
  let frames = 0, fpsT = now(), fps = 0, cpuMs = 0, frameNo = 0, overlayT = 0, last = now();
  const t0 = now();
  const finished: number[] = [];
  function frame() {
    const f0 = now();
    const dt = (f0 - last) / 1000;
    last = f0;
    if (crawl) {
      crawl.frame(Math.min(dt, 0.1));
      crawl.draw(W, H);
      const f1c = now();
      cpuMs = cpuMs * 0.95 + (f1c - f0) * 0.05;
      if (++frameNo % 30 === 0) { finish(); finished.push(now() - f0); if (finished.length > 21) finished.shift(); }
      frames += 1;
      if (f0 - fpsT >= 1000) { fps = (frames * 1000) / (f0 - fpsT); frames = 0; fpsT = f0; }
      if (f0 - overlayT > 250) { overlayT = f0; overlay.textContent = describe(); }
      return;
    }
    pan(dt);
    creepT += dt;
    if (creepT > 0.35) { creepT = 0; stepCreep(); }
    draw(viewNow(), (f0 - t0) / 1000);
    const f1 = now();
    cpuMs = cpuMs * 0.95 + (f1 - f0) * 0.05;
    budget.work(f1 - f0);
    if (++frameNo % 30 === 0) { finish(); finished.push(now() - f0); if (finished.length > 21) finished.shift(); }
    const b0 = now();
    if (onGpu()) {
      // (The GPU ground: generating and uploading chunks is the only work -- in the frame's spare time.)
      const slice = budget.slice({ hidden: document.hidden, loading: !gpuKeys.length });
      if (wb) gpuPlanWorld(viewNow(), slice); else gpuT!.upload(slice, 3);
    } else {
      const loading = !(wb ? wb.layers().length : baker!.layers().length);
      const slice = budget.slice({ hidden: document.hidden, loading });
      if (wb) wb.bake(slice); else baker!.bake(slice);
    }
    budget.spent(now() - b0);
    frames += 1;
    if (f0 - fpsT >= 1000) { fps = (frames * 1000) / (f0 - fpsT); frames = 0; fpsT = f0; }
    if (f0 - overlayT > 250) { overlayT = f0; overlay.textContent = describe(); }
  }
  const median = (l: number[]) => { const s = l.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : 0; };
  const crawlStats = () => ({ fps: Math.round(fps), cpuMs: +cpuMs.toFixed(2), finishedMs: +median(finished).toFixed(2), ...crawl!.stats() });
  const stats = () => (crawl ? crawlStats() : worldStats());
  const worldStats = () => {
    const g = wb ? wb.stats : baker!.stats;
    const at = viewNow().ground(W / 2, H / 2);
    const i = Math.floor(at[0] / 2), j = Math.floor(at[2] / 2);
    const here = wb ? table.list[wb.biomeAt(i, j)]!.id : map && i >= 0 && j >= 0 && i < map.w && j < map.d ? table.list[biomeMap![j * map.w + i]!]!.id : "-";
    return {
      fps: Math.round(fps), cpuMs: +cpuMs.toFixed(2), finishedMs: +median(finished).toFixed(2), plantMs: +lastPlantMs.toFixed(2), picture: `${W}x${H}`, k, mode, seed, season, algo, act: act(), biome: here,
      drawn, species: cat.list.length, spritesMs: +spritesMs.toFixed(0), genMs: +genMs.toFixed(0),
      ground: onGpu() && gpu ? `GPU · ${gpu.stats.chunks} chunks (${(gpu.stats.uploadMs / Math.max(1, gpu.stats.uploads)).toFixed(1)} ms an upload) · ${(gpu.stats.bytes / 1048576).toFixed(1)} MB · ${gpu.stats.draws} drawn${"generated" in g ? ` · ${g.generated} generated (${(g.genMs / Math.max(1, g.generated)).toFixed(1)} ms each)` : ""} · last paint ${lastPaintMs.toFixed(1)} ms (${lastPaintChunks} chunks) · season ${lastSeasonMs.toFixed(1)} ms (U: CPU bake)`
        : "generated" in g ? `${g.generated} chunks generated (${(g.genMs / Math.max(1, g.generated)).toFixed(1)} ms each) · ${g.baked} baked (${(g.bakeMs / Math.max(1, g.baked)).toFixed(0)} ms each, last ${g.lastBakeMs.toFixed(0)}) · ${g.queued} queued` : `${g.baked} chunk layers (${(g.ms / Math.max(1, g.baked)).toFixed(0)} ms each, last ${g.lastMs.toFixed(0)}) · ${g.queued} queued`,
    };
  };
  const describe = () => {
    if (crawl) { const c = crawlStats(); return `CRAWL  ${c.act} · ${c.algorithm} · depth ${c.depth}  seed ${c.seed}\n${c.fps} fps · ${c.cpuMs.toFixed(2)} ms cpu · ${c.finishedMs.toFixed(2)} ms gpu-finished\n${c.rooms} rooms (${c.kinds}) · ${c.props} props · ${c.lights} lights (${c.flames} flames) · ${c.mobs} mobs · ${c.sprites} sprites · ${c.particles} particles\n${c.quads} quads · light map ${c.renderer.lightmap} · ${c.picture} · ${c.k} px/m · cutaway ${c.cutaway} · fog ${c.fog ? "on" : "off"}${c.hasKey ? " · KEY" : ""}\nWASD / click walk · T generator · N act · G seed · X cutaway · L lights · F fog · R reveal · wheel zoom · H hide`; }
    const s = worldStats();
    return `WORLDS  ${s.mode}${s.mode === "dungeon" ? ` · ${s.algo} · ${s.act}` : ""}  seed ${s.seed}  ${s.season}\n${s.fps} fps · ${s.cpuMs.toFixed(2)} ms cpu · ${s.finishedMs.toFixed(2)} ms gpu-finished · sprites ${s.plantMs.toFixed(2)} ms\nground: ${s.ground}\n${s.drawn} sprites drawn (${s.species} species) · here: ${s.biome} · ${s.picture} · ${k} px/m\n1 2 3 mode · B biome swap · N season · C creep · T generator · A act · G seed · F plants · V style · U GPU/CPU ground · H hide`;
  };
  const loop = () => { frame(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- for measuring (and the curious)
  const api = {
    stats,
    setSize(w: number | null, h?: number) { fixed = w && h ? [w, h] : null; fit(); },
    setScale: (next: number) => setScale(next),
    setCenter(x: number, z: number) { center = [x, 0, z]; },
    setMode(m: Mode, s?: string) { mode = m; if (s) seed = s; build(); },
    setAlgo(a: DungeonAlgorithm) { algo = a; if (mode === "dungeon") build(); },
    setAct(n: number) { actIndex = n; if (mode === "dungeon") build(); },
    setSeason: (s: string) => setSeason(s),
    setPlants(on: boolean) { plantsOn = on; },
    setAllLayers(on: boolean) { allLayers = on; },
    setWind(on: boolean) { windOn = on; },
    swapAt: (x: number, z: number, radius?: number, to?: string) => swapAt(x, z, radius, to),
    dropCreep: (x: number, z: number) => dropCreep(x, z),
    stepCreep(n = 1) { for (let q = 0; q < n; q += 1) stepCreep(); },
    /** The ground's path: the GPU ground or the CPU bake (the reference). */
    setGround(m: "gpu" | "cpu") { groundMode = m; },
    setFootprints(on: boolean) { footprints = on; },
    /**
     * How much of the ground this frame should show it does: the frame's ground drawn again as it was, against a GPU
     * ground holding every chunk the view needs (generated and uploaded on the spot). 1 is all of it.
     */
    groundCoverage(): number {
      if (!lastGround || crawl) return 1;
      const g = lastGround, v = g.view;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (g.gpu) gpu!.draw(v, { time: g.time, clear: [0, 0, 0], keys: g.keys }); else ground.draw(v, g.layers, { time: g.time, clear: [0, 0, 0] });
      const a = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      refGpu ??= createGpuGround(gl, { palette, seed: 1 });
      refGpu.setPalette(palette);
      let keys: string[] = [];
      if (wb) {
        const C = stream!.chunkSize;
        for (const [cx, cz] of wb.plan(v)) {
          const key = `${cx},${cz}`, st = wb.chunk(cx, cz), L = st.layers, lit = L.light.some((x) => x !== 255);
          if (!refGpu.has(key)) refGpu.setChunk(key, { terrain: st.terrain, chunk: 0, rect: [2, 2, 2 + C, 2 + C], origin: [L.i0, L.j0], surface: groundSurface({ biomes: table.surfaceBiomes(), biome: L.biome, ...(lit ? { light: L.light } : {}) }), seed: 1 });
          keys.push(key);
        }
      } else if (terrain && baker) {
        for (let c = 0; c < terrain.chunksX * terrain.chunksZ; c += 1) { const key = `m${c}`; if (!refGpu.has(key)) refGpu.setChunk(key, { terrain, auto: baker.auto, chunk: c, surface: baker.surface, seed: 1 }); keys.push(key); }
      }
      refGpu.draw(v, { clear: [0, 0, 0], keys });
      lastRefKeys = keys.length;
      const b = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      let want = 0, got = 0;
      for (let o = 0; o < a.length; o += 4) { if (b[o]! + b[o + 1]! + b[o + 2]! === 0) continue; want += 1; if (a[o]! + a[o + 1]! + a[o + 2]! > 0) got += 1; }
      return want ? got / want : 1;
    },
    /** A fast zoom with REAL wheel input: `steps` notches out and back in, `perFrame` a frame, every frame's ground coverage. */
    async zoomSweep(steps = 8, perFrame = 1, dt = 1 / 120) {
      const out: Array<{ f: number; k: number; coverage: number; ms: number; shown: number; needed: number }> = [];
      const r = canvas.getBoundingClientRect();
      const wheelAt = (dir: number) => canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: dir * 120, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
      let f = 0;
      for (const dir of [-1, 1]) for (let n = 0; n < steps; n += perFrame) {
        for (let q = 0; q < perFrame; q += 1) wheelAt(dir);
        const f0 = now();
        frame(); void dt;
        const ms = now() - f0;
        await new Promise((res) => setTimeout(res, 0));
        const coverage = +api.groundCoverage().toFixed(4);
        out.push({ f: f++, k, coverage, ms: +ms.toFixed(1), shown: lastGround ? (lastGround.gpu ? lastGround.keys.length : lastGround.layers.length) : 0, needed: lastRefKeys });
      }
      return out;
    },
    /** Sprites (plants, buildings) this frame against the ground: with the depth test, and alone (the reference). */
    spriteCheck(): { pixels: number; hidden: number; sprites: number } {
      if (!lastGround || !inst.count) return { pixels: 0, hidden: 0, sprites: 0 };
      const g = lastGround, v = g.view;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      sr.drawSway(v, inst, { clear: [0, 0, 0], screen: 4, dither: 0.9, outline: 1, time: g.time, wind: 0, speed: 0, gust: 0, benders: [] });
      const ref = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ref);
      if (g.gpu) gpu!.draw(v, { time: g.time, clear: [0, 0, 0], keys: g.keys }); else ground.draw(v, g.layers, { time: g.time, clear: [0, 0, 0] });
      sr.drawSway(v, inst, { clear: null, screen: 4, dither: 0.9, outline: 1, time: g.time, wind: 0, speed: 0, gust: 0, benders: [] });
      const got = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, got);
      let pixels = 0, hidden = 0;
      for (let o = 0; o < ref.length; o += 4) { if (ref[o]! + ref[o + 1]! + ref[o + 2]! === 0) continue; pixels += 1; if (ref[o] !== got[o] || ref[o + 1] !== got[o + 1] || ref[o + 2] !== got[o + 2]) hidden += 1; }
      return { pixels, hidden, sprites: inst.count };
    },
    /** Only the structures' things (buildings) in the sprite layer (true), or everything. */
    setOnlyThings(on: boolean) { onlyThings = on; },
    ground: () => ({ mode: onGpu() ? "gpu" : "cpu", gpu: gpu?.stats ?? null, lastPaintMs, lastPaintChunks, lastSeasonMs }),
    /** Generate and bake everything the view needs (blocking), and scatter its plants: how long. */
    bakeAll() {
      const b0 = now();
      const v = viewNow();
      if (onGpu()) {
        for (let guard = 0; guard < 40; guard += 1) { if (wb) gpuPlanWorld(v, 500); else { gpuT!.plan(v); gpuT!.upload(500); if (gpuT!.ready) break; } }
        for (let q = 0; q < 20; q += 1) drawSprites(v, 0);
        return now() - b0;
      }
      for (let guard = 0; guard < 400; guard += 1) {
        if (wb) { wb.plan(v); if (wb.ready) break; wb.bake(200); } else { baker!.plan(v); if (baker!.ready) break; baker!.bake(200); }
      }
      for (let q = 0; q < 20; q += 1) drawSprites(v, 0);
      return now() - b0;
    },
    /** Run `count` frames back to back, each waited for on the GPU: ms per frame. */
    measure(count = 120) {
      const t: number[] = [], cpu: number[] = [];
      for (let q = 0; q < count; q += 1) {
        const f0 = now();
        draw(viewNow(), (f0 - t0) / 1000);
        const f1 = now();
        finish();
        t.push(now() - f0); cpu.push(f1 - f0);
      }
      t.sort((a, b) => a - b); cpu.sort((a, b) => a - b);
      return { median: +t[t.length >> 1]!.toFixed(3), p95: +t[Math.floor(t.length * 0.95)]!.toFixed(3), cpuMedian: +cpu[cpu.length >> 1]!.toFixed(3), drawn, picture: `${W}x${H}`, k, ground: onGpu() ? gpu!.stats.draws : ground.stats.draws, groundMode: onGpu() ? "gpu" : "cpu" };
    },
    /** Draw a frame (at `time` seconds) and save the picture to the dev server's out/ (PUT /out/<name>.png). */
    shoot(name: string, time?: number): Promise<number> {
      draw(viewNow(), time ?? (now() - t0) / 1000);
      return new Promise((done) => canvas.toBlob((b) => { void fetch(`/out/${name}.png`, { method: "PUT", body: b }).then((r) => done(r.status)); }, "image/png"));
    },
    map: () => map,
    get crawl() { return crawl; },
    /** The crawl: step `n` frames of `dt` seconds (the hidden pane stops requestAnimationFrame). */
    step(n = 1, dt = 1 / 60) { if (!crawl) return; for (let q = 0; q < n; q += 1) crawl.frame(dt); },
    /**
     * The crawl's screenshot set (PUT /out/dungeon-*.png): every act at 480x270 (x3) and at 1920x1080 (640x360 x3) in
     * its most telling room; the cutaway on / dither / off beside a front wall; lit (all revealed) and dark (the fog of
     * a hero just come in), and the ambient alone; a hero exploring -- to the key, then through the boss's door.
     */
    async crawlShots(prefix = "dungeon") {
      if (!crawl) return [];
      const c = crawl, done: string[] = [];
      const shot = async (name: string, w: number, h: number, scale: number) => { fixed = [w, h]; fit(); c.frame(1 / 30); await api.shootScaled(`${prefix}-${name}`, scale); done.push(name); };
      const at = (kinds: string[]) => { for (const k2 of kinds) { const p = c.roomOf(k2, true); if (p) return p; } return null; };
      const prefer: Record<string, string[]> = { crypt: ["crypt", "library", "hall"], cave: ["cavern", "garden", "storage"], forge: ["forge", "armoury", "prison"], ruin: ["garden", "library", "hall"] };
      for (const act2 of ["crypt", "cave", "forge", "ruin"]) {
        c.setAlgo(act2 === "cave" ? "cave" : "rooms"); c.setAct(act2); c.k = 24;
        const p = at(prefer[act2]!);
        if (p) c.setHero(p[0], p[1]);
        for (let q = 0; q < 45; q += 1) c.frame(1 / 30);
        await shot(`${act2}-480x270`, 480, 270, 3);
        await shot(`${act2}-1920x1080`, 640, 360, 3);
      }
      c.setAlgo("rooms"); c.setAct("crypt");
      const S = c.dressing();
      const lib = S.rooms.find((r) => r.kind === "library") ?? S.rooms.find((r) => r.kind === "crypt")!;
      const cand = lib.cells.filter((k2) => S.cells[k2 - 2 * S.w] === 0 && !S.blocked[k2]);
      const k0 = cand[Math.floor(cand.length / 2)] ?? lib.cells[0]!;
      c.setHero((k0 % S.w + 0.5) * 2, (Math.floor(k0 / S.w) + 0.5) * 2 - 0.5);
      c.reveal();
      for (let q = 0; q < 40; q += 1) c.frame(1 / 30);
      for (const cm of ["stub", "dither", "off"] as const) { c.setCutaway(cm); await shot(`cutaway-${cm === "stub" ? "on" : cm}`, 640, 360, 3); }
      c.setCutaway("stub");
      c.k = 16; c.setFog(false); await shot("lit", 640, 360, 3);
      c.setLights(false); await shot("ambient-only", 640, 360, 3); c.setLights(true);
      c.setFog(true); c.setSeed(seed); c.k = 16; for (let q = 0; q < 30; q += 1) c.frame(1 / 30); await shot("dark", 640, 360, 3);
      c.k = 24; c.setSeed(seed); for (let q = 0; q < 20; q += 1) c.frame(1 / 30);
      await shot("explore-1", 640, 360, 3);
      const S2 = c.dressing();
      if (S2.key) c.walkTo((S2.key[0] + 0.5) * 2, (S2.key[1] + 0.5) * 2);
      for (let q = 0; q < 2500; q += 1) { c.frame(1 / 30); if (q === 240) await shot("explore-2", 640, 360, 3); if (c.stats().hasKey) break; }
      await shot("explore-3", 640, 360, 3);
      const th = c.roomOf("throne");
      if (th) c.walkTo(th[0], th[1]);
      for (let q = 0; q < 3000; q += 1) { c.frame(1 / 30); if (!c.path.length && q > 30) break; }
      await shot("explore-4", 640, 360, 3);
      fixed = [480, 270]; fit();
      return done;
    },
    /** Draw a frame and save it upscaled nearest-neighbour by `scale` (PUT /out/<name>.png). */
    shootScaled(name: string, scale = 1): Promise<number> {
      draw(viewNow(), (now() - t0) / 1000);
      const c2 = document.createElement("canvas");
      c2.width = W * scale; c2.height = H * scale;
      const x = c2.getContext("2d")!;
      x.imageSmoothingEnabled = false;
      x.drawImage(canvas, 0, 0, W * scale, H * scale);
      return new Promise((done) => c2.toBlob((b) => { void fetch(`/out/${name}.png`, { method: "PUT", body: b }).then((r) => done(r.status)); }, "image/png"));
    },
    plantsIn: () => plantCount,
  };
  (globalThis as { worlds?: typeof api }).worlds = api;
}
