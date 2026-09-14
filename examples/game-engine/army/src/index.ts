// ARMY: the bake step's demo -- thousands of units, every one a different
// character. A population (designs.ts: every character from packs/humans and
// packs/animals, dressed from packs/cloth) is drawn from a few body shapes and
// a few hundred wearable shapes; each shape is baked ONCE as indexed sprites
// (slot, shade, surface coordinate per texel -- no colours), and every unit
// wears a look of its own that the sprite shader paints at draw time: one
// baked shape, any number of looks, zero bake cost per look. Wearables are
// their own sprite layers, placed on their body's socket for the frame being
// shown, a hair in front or behind. Everything visible is one instanced draw
// through an orthographic pixel view; the pixel scale is a real setting (the
// wheel steps pixels per metre: 4 to 128 -- a unit a good part of the picture).
//
// The bake streams (@keel-engine/bake's sprite stream): a loading screen bakes
// what the opening needs -- the view's exact sprites, the heroes and banner
// carriers (MAIN) complete, every body's first frames and every wearable in
// every direction -- then play starts with nothing missing, and the rest bakes
// in the background, re-ordered every frame by what's on screen, what's near
// it, what's likely next and the zoom levels either side, in bake workers when
// the page allows them (else in the frame's spare time). A zoom shows the
// nearest baked scale (larger preferred) until its own lands; never a box.
//
// Controls: WASD / arrows / drag pan, wheel zooms, Q/E turn the view, 1-5 unit
// count, [ ] pixel size, H hides the overlay, B the bake lines, L a line-up.
// globalThis.army measures. ?workers=0 bakes on the main thread; ?preload=0 skips the loading screen.

import { createPixelRenderer } from "@keel/game-engine/render";
import type { RenderCanvas } from "@keel/game-engine/render";
import {
  LAYER_INSTANCE_FLOATS, LayerInstances, STREAM_LUT, bakeCost, bakeSlice, createBakeWorkers, createFrameBudget, createGrid, createLookTable, createSpriteRenderer, createSpriteStream,
  IDLE_PERIOD, dressPopulation, paintRoles, paintSlots, pixelView, planBake, recordBytes, recordOf, renderIndexedSprites, serveBakes, WORN_SLOT,
} from "@keel/game-engine/bake";
import type { BakedSprite, BakeSource, BakeWorkers, DesignSpec, Grid, IndexedBakeRenderer, IndexedSource, PixelView, Population, PopulationShapes, SocketRecords, SpriteJob, SpriteStream, StreamDesign, StreamJob } from "@keel/game-engine/bake";
import { createArmy } from "./army.ts";
import type { Army, UnitKind } from "./army.ts";
import { HERO, armyShapes, armySources, groundLook, propDesigns, storedRecord } from "./designs.ts";
import { createLoadingScreen } from "./loading.ts";
import type { LoadingScreen } from "./loading.ts";

const DIRS = 8;
const PITCH = 0.6;
// (To 128 px/m: a unit a good part of the picture. Close in, props are drawn from their 48 px/m bake -- maxScale -- and the
// bodies and wearables bake at the view's own scale, as everywhere else.)
const LADDER = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
const COUNTS = [500, 2000, 5000, 10000, 20000];
const DT = 1 / 30; // (the sim's fixed step; the picture draws between steps)
const MAXC = 4, MAXF = 8; // (clips, frames a body, in the socket records)
const MAXW = 3; // (wearables a unit)
const SOCK = 12; // (sockets a body, at most, in the lookup)
const TAU = Math.PI * 2;
const HEROES = 4, BANNERS = 8; // (the MAIN tier: the population's first units, and its first banner carriers)
// The dither screen by scale: tiny sprites want the 2x2 screen (core's rule), bigger ones 4x4.
const screenFor = (k: number) => (k <= 12 ? 2 : 4);
const propStyle = (k: number) => ({ screen: screenFor(k), dither: 0.9, outline: 1 });

// What the bake draws: indexed shapes (bodies, wearables) and plain props.
type Design = { readonly spec: DesignSpec; readonly indexed: IndexedSource | null; readonly plain: BakeSource | null };

export interface ArmyStats {
  fps: number; cpuMs: number; finishedMs: number; simMs: number; visible: number; units: number; k: number; picture: string; baking: string; atlas: string; layers: number;
}

function seedOf(): string {
  const g = (globalThis as { KEEL_SEED?: unknown }).KEEL_SEED;
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  return String(g ?? q.get("seed") ?? "1");
}
const param = (name: string): string | null => (typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) : null);
const now = () => performance.now();
// (This module's own URL on a plain page -- a module worker imports it; in a KEEL document the bake finds the page's module scripts instead.)
const moduleUrl = (): string | undefined => (import.meta as { url?: string }).url;

/** The bake worker's entry: the same code, started again in a worker (createBakeWorkers finds it). */
export function bakeWorker(): void {
  serveBakes({
    renderer: (canvas) => createPixelRenderer(canvas as unknown as RenderCanvas, { width: 64, height: 64, bakeOnly: true }) as unknown as IndexedBakeRenderer,
    sources: (payload) => { const { seed, count } = payload as { seed: string; count: number }; return armySources(seed, count); },
    // (Depth sprites: every texel at the depth of the point it shows -- keel/bake depth.ts.)
    heights: true,
  });
}

export function main(host: HTMLElement): void {
  const T0 = now();
  const seed = seedOf();
  host.style.cssText = "margin:0;overflow:hidden;background:#000;height:100vh";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;left:0;top:0;image-rendering:pixelated;touch-action:none;cursor:grab";
  const overlay = document.createElement("pre");
  overlay.style.cssText = "position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(8,9,14,.72);color:#d8dcf0;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre;z-index:3";
  host.append(canvas, overlay);

  let n = Number(param("units") ?? 4000) || 4000;
  const wantWorkers = param("workers");
  const usePreload = param("preload") !== "0";
  const mainBakes = param("mainbake") !== "0";
  const events: Array<{ what: string; t: number; k?: number; ms?: number }> = [{ what: "main", t: 0 }];
  const mark = (what: string, extra: { k?: number; ms?: number } = {}) => events.push({ what, t: now() - T0, ...extra });

  // The bake workers start first: they build their designs while the page builds its population.
  const workers: BakeWorkers<StreamJob> = createBakeWorkers<StreamJob>({
    entry: { module: "examples/army", run: "bakeWorker", url: moduleUrl() }, payload: { seed, count: n },
    ...(wantWorkers !== null ? { count: Number(wantWorkers) } : {}),
  });

  let stream: SpriteStream | null = null;
  // The loading screen, from the first frame.
  let loading: LoadingScreen | null = usePreload ? createLoadingScreen(host) : null;
  let phase = "GENERATING THE ARMY";
  const drawLoading = () => {
    if (!loading) return;
    const p = stream ? stream.preloading : { done: 0, total: 0 };
    loading.draw({ title: "ARMY", subtitle: `${n} UNITS · EVERY ONE DIFFERENT`, phase, done: p.done, total: p.total, footer: `${workers.ready ? `${workers.ready} WORKER${workers.ready === 1 ? "" : "S"}` : workers.mode === "none" ? "MAIN THREAD" : "WORKERS STARTING"} · ${Math.round(now() - T0)} MS` }, now());
  };
  drawLoading();

  // ---------------------------------------------------------------- the population, its looks, the sim
  let shapes!: PopulationShapes;
  let pop: Population | null = null;
  let popMs = 0, shapesMs = 0;
  const props = propDesigns(seed);
  const look = groundLook(seed);
  const table = createLookTable({ rampLength: 5 });
  // Designs by index: bodies, then wearable shapes, then props (the stream's design index).
  let designs: Design[] = [];
  let sources = new Map<string, IndexedSource>();
  let plainSources = new Map<string, BakeSource>();
  let B = 0, A = 0; // (bodies, wearable shapes)
  let records: SocketRecords[] = [];
  let rec = new Float32Array(0); // (every body's socket records, flat: [right, up] per (body, clip, frame, direction, socket))
  let lift = new Float32Array(0);
  // Per unit: its body, its look, and its wearables (shape, look, socket).
  let unitBody = new Uint16Array(0), unitLook = new Uint32Array(0), wearN = new Uint8Array(0), wearShape = new Int32Array(0), wearLook = new Uint32Array(0), wearSocket = new Uint8Array(0);
  // Per unit, its animation layer: its stride (metres a cycle, as a factor), its idle's period factor and phase.
  let unitStride = new Float32Array(0), unitIdle = new Float32Array(0), unitPhase = new Float32Array(0);
  let recordSize = 0, fromRecord = false; // (the population's hybrid record: bytes, and whether it was read from the stored one)
  let kinds: UnitKind[] = [];
  let clipIndex = new Int8Array(0), cyc = new Float32Array(0), per = new Float32Array(0), nfr = new Uint8Array(0);
  let gaitSlot = new Int32Array(0); // (per body and gait: the stream slot of its clip's frame 0, direction 0)
  let maxHeight = 2;
  let heroes: number[] = [];

  /** The population's shapes: everything the scene and the bake need -- designs, the sim's kinds, who wears what where. */
  function adoptShapes(p: PopulationShapes) {
    shapes = p;
    B = p.bodies.length; A = p.attributes.length;
    designs = [
      ...p.bodies.map((b): Design => ({ spec: b, indexed: b, plain: null })),
      ...p.attributes.map((a): Design => ({ spec: a, indexed: a, plain: null })),
      ...props.map((d): Design => ({ spec: d, indexed: null, plain: d })),
    ];
    sources = new Map(designs.filter((d) => d.indexed).map((d) => [d.spec.key, d.indexed!]));
    plainSources = new Map(designs.filter((d) => d.plain).map((d) => [d.spec.key, d.plain!]));
    records = p.bodies.map((b) => b.records(DIRS, PITCH));
    if (Math.max(...records.map((r) => r.sockets.length)) > SOCK) throw new Error("More sockets than the lookup has room for.");
    rec = new Float32Array(B * MAXC * MAXF * DIRS * SOCK * 2);
    records.forEach((r, bi) => { for (let c = 0; c < Math.min(MAXC, p.bodies[bi]!.clips.length); c += 1) for (let f = 0; f < Math.min(MAXF, p.bodies[bi]!.clips[c]!.frames); f += 1) for (let d = 0; d < DIRS; d += 1) for (let sk = 0; sk < r.sockets.length; sk += 1) {
      const from = r.at(c, f, d, sk), to = (((((bi * MAXC + c) * MAXF + f) * DIRS) + d) * SOCK + sk) * 2;
      rec[to] = r.data[from]!; rec[to + 1] = r.data[from + 1]!;
    } });
    lift = Float32Array.from(p.attributes, (a) => a.lift);
    const quad = p.bodies.map((b) => b.spec.plan === "quadruped");
    // Gait -> clip: idle, walk, run (two legs: run twice) / idle, walk, trot, gallop.
    const gaitClips = p.bodies.map((_, i) => (quad[i] ? ["idle", "walk", "trot", "gallop"] : ["idle", "walk", "run", "run"]));
    clipIndex = new Int8Array(B * MAXC).fill(-1); cyc = new Float32Array(B * MAXC); per = new Float32Array(B * MAXC).fill(1); nfr = new Uint8Array(B * MAXC).fill(1);
    p.bodies.forEach((d, i) => gaitClips[i]!.forEach((name, g) => {
      const info = d.clip(name);
      clipIndex[i * MAXC + g] = d.clips.findIndex((c) => c.name === name);
      cyc[i * MAXC + g] = info.cycle; per[i * MAXC + g] = info.period; nfr[i * MAXC + g] = info.frames;
    }));
    kinds = p.bodies.map((d, i) => ({ speeds: [0, d.clip("walk").speed, d.clip(gaitClips[i]![2]!).speed, d.clip(gaitClips[i]![3]!).speed], radius: Math.max(0.15, d.radius * 0.45) }));
    maxHeight = Math.max(...designs.map((d) => d.spec.height));
    // Who wears what, where (in socket order, as the dressed population lists them).
    const N = p.units.length;
    unitBody = new Uint16Array(N); unitLook = new Uint32Array(N); wearN = new Uint8Array(N);
    unitStride = Float32Array.from(p.units, (u) => u.anim.stride);
    unitIdle = Float32Array.from(p.units, (u) => IDLE_PERIOD[u.anim.idle] ?? 1);
    unitPhase = Float32Array.from(p.units, (u) => u.anim.phase);
    wearShape = new Int32Array(N * MAXW).fill(-1); wearLook = new Uint32Array(N * MAXW); wearSocket = new Uint8Array(N * MAXW);
    p.units.forEach((u, i) => {
      unitBody[i] = u.body;
      const worn = u.wears.slice().sort((x, y) => (p.attributes[x.shape]!.socket < p.attributes[y.shape]!.socket ? -1 : 1));
      wearN[i] = Math.min(MAXW, worn.length);
      worn.slice(0, MAXW).forEach((w, j) => {
        wearShape[i * MAXW + j] = w.shape;
        wearSocket[i * MAXW + j] = records[u.body]!.sockets.indexOf(p.attributes[w.shape]!.socket);
      });
    });
    // MAIN: the heroes (the population's first units) and its first banner carriers -- their bodies and what they wear.
    const flag = p.attributes.map((a) => a.attribute === "flag");
    const carriers: number[] = [];
    for (let i = 0; i < N && carriers.length < BANNERS; i += 1) if (p.units[i]!.wears.some((w) => flag[w.shape])) carriers.push(i);
    heroes = [...new Set([...Array.from({ length: Math.min(HEROES, N) }, (_, i) => i), ...carriers])];
  }

  /** The looks: every unit's into the table -- the body's paint (each slot its role for its coverage), each wearable's. */
  function dress(p: Population) {
    pop = p;
    recordSize = recordBytes(recordOf(p)).length;
    p.units.forEach((u, i) => {
      const body = p.bodies[u.body]!;
      unitLook[i] = table.add(paintSlots(u.look, body.slotRoles(u.coverage), u.wornLook, WORN_SLOT));
      u.wears.slice(0, MAXW).forEach((w, j) => { wearLook[i * MAXW + j] = table.add(paintRoles(w.look)); });
    });
    sr.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture() });
  }

  // The stream's designs: tiers (mains: what the heroes and banner carriers are made of; props: background, inferred), weights by how many wear them.
  function streamDesigns(): StreamDesign[] {
    const mainB = new Set(heroes.map((i) => shapes.units[i]!.body));
    const mainA = new Set(heroes.flatMap((i) => shapes.units[i]!.wears.map((w) => w.shape)));
    const bodyN = new Float64Array(B), wearCount = new Float64Array(A);
    for (const u of shapes.units) { bodyN[u.body] = bodyN[u.body]! + 1; for (const w of u.wears) wearCount[w.shape] = wearCount[w.shape]! + 1; }
    const maxB = Math.max(1, ...bodyN), maxA = Math.max(1, ...wearCount);
    return designs.map((d, i): StreamDesign => {
      if (i < B) return { spec: d.spec, weight: bodyN[i]! / maxB, hints: { kind: "entity" }, ...(mainB.has(i) ? { tier: "main" as const } : {}) };
      if (i < B + A) return { spec: d.spec, weight: wearCount[i - B]! / maxA, hints: { kind: "attribute" }, upscale: 1.5, ...(mainA.has(i - B) ? { tier: "main" as const } : {}) };
      return { spec: d.spec, hints: { kind: "prop" }, maxScale: 48 };
    });
  }

  let army: Army;
  let props0 = 0;
  let propGrid: Grid;
  let propX = new Float32Array(0), propZ = new Float32Array(0), propD = new Uint16Array(0);
  function populate(count: number) {
    // (A population's first units are the same whatever its size: grow it only when asked for more.)
    if (!shapes || count > shapes.units.length) {
      const t0 = now();
      fromRecord = storedRecord(seed, count) !== null;
      adoptShapes(armyShapes(seed, count));
      shapesMs = now() - t0;
      // (Once playing, a bigger army is dressed at once; at the start the looks wait until the bake is under way.)
      if (stream) { dress(dressPopulation(shapes)); popMs = now() - t0; newStream(); workers.reinit({ seed, count }); }
    }
    const map = Math.round(Math.sqrt(count / 0.08)); // (about 0.08 units a square metre)
    army = createArmy(seed, kinds, count, map, (i) => unitBody[i]!, (i) => shapes.units[i]!.anim.speed);
    const m = Math.round(map * map * 0.03);
    propGrid = createGrid({ cell: 8, capacity: Math.max(1, m) });
    propX = new Float32Array(m); propZ = new Float32Array(m); propD = new Uint16Array(m);
    let a = 0x9e3779b9 ^ count;
    const f = () => { a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return a / 4294967296; };
    for (let i = 0; i < m; i += 1) { propX[i] = f() * map; propZ[i] = f() * map; propD[i] = B + A + Math.floor(f() * props.length); propGrid.set(i, propX[i]!, propZ[i]!, 0.3); }
    props0 = m;
    // (The opening view is on the first hero: the player's unit is on screen at the start.)
    const h = heroes[0] ?? 0;
    center = h < army.n ? [army.x[h]!, 0, army.z[h]!] : [map / 2, 0, map / 2];
  }

  // ---------------------------------------------------------------- the view
  let pixel = Number(param("px") ?? 0) || (globalThis.devicePixelRatio || 1); // (screen pixels per picture pixel)
  let fixed: [number, number] | null = null;
  { const s = param("size"); const m = s && /^(\d+)x(\d+)$/.exec(s); if (m) fixed = [Number(m[1]), Number(m[2])]; }
  let W = 0, H = 0;
  let k = Number(param("k") ?? 24);
  if (!LADDER.includes(k)) k = 24;
  let camYaw = 0;
  let center: [number, number, number] = [0, 0, 0];

  const sr = createSpriteRenderer(canvas, { width: 64, height: 64, capacity: 1024 });
  const gl = sr.gl;
  function fit() {
    const dpr = globalThis.devicePixelRatio || 1;
    const [w, h] = fixed ?? [Math.max(64, Math.round((innerWidth * dpr) / pixel)), Math.max(48, Math.round((innerHeight * dpr) / pixel))];
    if (w !== W || h !== H) { W = w; H = h; sr.setTarget(W, H); }
    const s = Math.min(innerWidth / W, innerHeight / H);
    const cw = fixed ? W * s : innerWidth, ch = fixed ? H * s : innerHeight;
    canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
    canvas.style.left = `${(innerWidth - cw) / 2}px`; canvas.style.top = `${(innerHeight - ch) / 2}px`;
  }
  fit();
  addEventListener("resize", fit);
  const viewNow = (): PixelView => pixelView({ center, yaw: camYaw, pitch: PITCH, pixelsPerMetre: k, width: W, height: H });

  // ---------------------------------------------------------------- the bake: a stream over every scale, workers, the budget
  let px: IndexedBakeRenderer | null = null; // (the main thread's own baker: made only when it bakes)
  const mainPx = (): IndexedBakeRenderer => {
    if (px) return px;
    const bakeCanvas: RenderCanvas = typeof OffscreenCanvas !== "undefined" ? (new OffscreenCanvas(64, 64) as unknown as RenderCanvas) : document.createElement("canvas");
    px = createPixelRenderer(bakeCanvas, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
    return px;
  };
  const arrived: Array<[StreamJob, BakedSprite]> = []; // (baked in a worker, waiting to be uploaded)
  let msPerSprite = 0.3; // (the main thread's, smoothed)
  let bakedMain = 0, bakedWorker = 0, bakeMainMs = 0, uploads = 0, uploadMs = 0, returned = 0;
  function newStream() {
    stream = createSpriteStream({
      designs: streamDesigns(), ladder: LADDER, directions: DIRS, pitch: PITCH,
      // (Indexed shapes carry no style -- the look paints them -- but props bake their colours: theirs does.)
      style: (spec, s) => (plainSources.has(spec.key) ? JSON.stringify(propStyle(s)) : "indexed"),
      onPages: (pages, size) => sr.reservePages(pages, size, { heights: true }),
      onWrite: (r, rgba, heights) => sr.writeSprite(r.page, r.x, r.y, r.w, r.h, rgba, heights),
    });
    stream.setScale(k, now());
    arrived.length = 0;
    // (Per body and gait: its clip's first slot.)
    gaitSlot = new Int32Array(B * MAXC);
    for (let b = 0; b < B; b += 1) for (let g = 0; g < MAXC; g += 1) { const c = clipIndex[b * MAXC + g]!; gaitSlot[b * MAXC + g] = c >= 0 ? stream.clipBase(b, c) : stream.base[b]!; }
  }
  workers.onBaked = (jobs, sprites) => {
    const byKey = new Map(sprites.map((s) => [s.key, s]));
    for (const j of jobs) { const s = byKey.get(j.key); if (s) arrived.push([j, s]); else stream?.cancel(j); }
    bakedWorker += sprites.length;
  };
  workers.onReturned = (jobs) => { returned += jobs.length; for (const j of jobs) stream?.cancel(j); };
  const budget = createFrameBudget();
  let sliceMs = 0, lastPhaseRank = 99;

  /** One frame's bake: upload what the workers sent, keep them fed, bake on this thread if they can't. */
  function pump(isLoading: boolean, gap: number) {
    if (!stream) return;
    const st = stream;
    const t0 = now();
    // (Hidden: the page says so AND frames have slowed -- an embedded view can report hidden while it draws at full rate.)
    const slice = budget.slice({ hidden: document.hidden && gap > 250, loading: isLoading });
    sliceMs = slice;
    // (Up to the next preload rank while loading: nothing else competes with the opening.)
    const maxRank = isLoading ? 4 : undefined;
    // Uploads: a few at a time within the slice (the atlas takes each sprite as it comes).
    while (arrived.length && now() - t0 < slice) {
      const t1 = now();
      const [job, sprite] = arrived.shift()!;
      if (st.put(job, sprite)) uploads += 1;
      uploadMs += now() - t1;
    }
    if (slice <= 0) return;
    // Keep every ready worker busy: small batches, so the order stays fresh.
    if (workers.ready) {
      // (Loading: big batches -- a bake's fixed costs, its staging and its read-back, spread over many sprites. Playing:
      // ~10 ms of work a batch, so what's wanted next is never far back in the worker's queue.)
      // A backlog of what's on screen (a zoom out) is bulk too: a worker's batch size costs this thread nothing.
      const bulk = isLoading || st.missingVisible > 200;
      const perBatch = Math.max(8, Math.min(bulk ? 1024 : 128, Math.round((isLoading ? 120 : bulk ? 60 : 10) / Math.max(0.03, workers.msPerSprite))));
      while (workers.free() > 0) {
        const jobs = maxRank === undefined ? st.take(perBatch) : st.take(perBatch, maxRank);
        if (!jobs.length) break;
        noteRank(jobs);
        workers.send(jobs);
      }
      // (Batches still waiting for things that left the view, or a scale that was left: dropped.)
      workers.cancel((b) => b.jobs.every((j) => !st.wanted(j)));
    }
    // The main thread bakes too when no worker can (or, while loading, alongside them: nothing to keep smooth).
    // (One GPU: a second context baking beside a worker's slows both, so the main thread bakes only while no worker is ready.)
    if (!workers.ready && (workers.mode === "none" || mainBakes)) {
      const left = slice - (now() - t0);
      if (left > 0.5) {
        const nJobs = Math.max(4, Math.min(400, Math.round(left / msPerSprite)));
        const jobs = maxRank === undefined ? st.take(nJobs) : st.take(nJobs, maxRank);
        if (jobs.length) {
          noteRank(jobs);
          const r = bakeSlice(mainPx(), jobs, { indexed: sources, plain: plainSources }, { heights: true });
          const byKey = new Map(r.baked.map((s) => [s.key, s]));
          for (const j of jobs) { const s = byKey.get(j.key); if (s) st.put(j, s); else st.cancel(j); }
          bakedMain += r.baked.length; bakeMainMs += r.ms;
          msPerSprite = msPerSprite * 0.7 + (r.ms / jobs.length) * 0.3;
        }
      }
    }
    budget.spent(now() - t0);
  }
  // (What the loading screen says it's doing: the kind of the last batch taken.)
  function noteRank(jobs: readonly StreamJob[]) {
    const j = jobs[0]!;
    const d = designs.findIndex((x) => x.spec.key === j.design);
    lastPhaseRank = j.rank;
    phase = j.rank <= 2 ? "BAKING THE OPENING VIEW" : d >= 0 && stream!.tierOf(d).tier === "main" ? "HEROES AND BANNER CARRIERS" : d >= B + A ? "THE GROUND" : d >= B ? "DRESSING THE ARMY" : "BODIES, EVERY DIRECTION";
  }

  // ---------------------------------------------------------------- a frame
  const inst = new LayerInstances(1 << 17);
  const vis: number[] = [];
  let visible = 0;
  let acc = 0;
  let last = now();
  const clear = look.ground;
  const cosP = Math.cos(PITCH);
  // What the frame showed: layers wanted, drawn at the view's scale (crisp), exactly the right sprite, drawn at all.
  let wanted = 0, crisp = 0, exactN = 0, drawn = 0;

  let simMs = 0;
  function simulate(dt: number) {
    acc += Math.min(0.25, dt);
    while (acc >= DT) { const t0 = now(); army.step(DT); simMs = now() - t0; acc -= DT; }
  }
  /** One unit's layers: its body, and each wearable on its socket for the frame shown. (Hot: plain arithmetic, no calls.) */
  function pushUnit(i: number, x: number, z: number, yaw: number, g: number, dist: number, t: number) {
    const st = stream!;
    const seen = st.seen, lut = st.lut, ex = st.exact, stamp = st.stamp, wb = st.base;
    const b = unitBody[i]!;
    const ci = b * MAXC + g;
    const c = cyc[ci]!;
    // (Its own stride over the ground; its own idle style and phase on the spot.)
    const u = c > 0 ? dist / (c * unitStride[i]!) : t / (per[ci]! * unitIdle[i]!) + unitPhase[i]!;
    const frames = nfr[ci]!;
    let f = Math.floor((u - Math.floor(u)) * frames);
    if (f >= frames) f = frames - 1;
    // (directionFor, inlined.)
    let rel = (yaw - camYaw - Math.PI) / TAU;
    rel -= Math.floor(rel);
    const dir = Math.round(rel * DIRS) % DIRS;
    const slot = gaitSlot[ci]! + f * DIRS + dir;
    seen[slot] = stamp;
    const nw = wearN[i]!;
    const w0 = i * MAXW;
    for (let j = 0; j < nw; j += 1) seen[wb[B + wearShape[w0 + j]!]! + dir] = stamp;
    wanted += 1 + nw;
    const o = slot * STREAM_LUT;
    const s = lut[o + 7]!;
    // (No bake of this body at any scale it may be drawn from: the unit waits a frame. Never a box.)
    if (!s || inst.count + 1 + nw > inst.capacity) return;
    if (s === k) { crisp += 1; if (ex[slot]) exactN += 1; }
    drawn += 1;
    const D = inst.data;
    let p = inst.count * LAYER_INSTANCE_FLOATS;
    D[p] = x; D[p + 1] = 0; D[p + 2] = z; D[p + 3] = lut[o]!; D[p + 4] = lut[o + 1]!; D[p + 5] = lut[o + 2]!; D[p + 6] = lut[o + 3]!; D[p + 7] = lut[o + 4]!; D[p + 8] = lut[o + 5]!;
    D[p + 9] = lut[o + 6]!; D[p + 10] = unitLook[i]!; D[p + 11] = 0; D[p + 12] = k / s; D[p + 13] = 0;
    inst.count += 1;
    // (Sockets where the frame DRAWN has them: a stand-in frame carries its hats with it.)
    const r0 = ((((b * MAXC + clipIndex[ci]!) * MAXF + lut[o + 8]!) * DIRS) + dir) * SOCK;
    for (let j = 0; j < nw; j += 1) {
      const a = wearShape[w0 + j]!;
      const ws = wb[B + a]! + dir;
      const q = ws * STREAM_LUT;
      const ka = lut[q + 7]!;
      // (Not baked at a scale it may be drawn from: the unit goes without it for now. Never a box.)
      if (!ka) continue;
      if (ka === k) { crisp += 1; if (ex[ws]) exactN += 1; }
      drawn += 1;
      const r = (r0 + wearSocket[w0 + j]!) * 2;
      // (The wearable's socket texel lands on the body's socket for this frame; its texels behind the socket a hair
      // behind the body, the rest a hair in front.)
      p += LAYER_INSTANCE_FLOATS;
      D[p] = x; D[p + 1] = 0; D[p + 2] = z; D[p + 3] = lut[q]!; D[p + 4] = lut[q + 1]!; D[p + 5] = lut[q + 2]!; D[p + 6] = lut[q + 3]!;
      D[p + 7] = lut[q + 4]! - rec[r]! * ka; D[p + 8] = lut[q + 5]! - lift[a]! * cosP * ka + rec[r + 1]! * ka;
      D[p + 9] = lut[q + 6]!; D[p + 10] = wearLook[w0 + j]!; D[p + 11] = 0.05 + 0.01 * j; D[p + 12] = k / ka; D[p + 13] = 0;
      inst.count += 1;
    }
  }
  /** Mark the units just outside the view -- wider toward where the camera is heading -- as near (every few frames). */
  let camV: [number, number] = [0, 0], lastCenter: [number, number] = [0, 0], nearT = 0;
  function markNear(view: PixelView, dt: number) {
    const st = stream!;
    camV = [camV[0] * 0.8 + ((center[0] - lastCenter[0]) / Math.max(1e-3, dt)) * 0.2, camV[1] * 0.8 + ((center[2] - lastCenter[1]) / Math.max(1e-3, dt)) * 0.2];
    lastCenter = [center[0], center[2]];
    if (++nearT % 4) return;
    const [x0, z0, x1, z1] = view.groundRect(maxHeight / Math.tan(PITCH) + 1);
    const mx = (x1 - x0) * 0.25, mz = (z1 - z0) * 0.25;
    const ahead = 0.8; // (seconds of camera motion to look ahead)
    const ex0 = x0 - mx + Math.min(0, camV[0] * ahead), ex1 = x1 + mx + Math.max(0, camV[0] * ahead);
    const ez0 = z0 - mz + Math.min(0, camV[1] * ahead), ez1 = z1 + mz + Math.max(0, camV[1] * ahead);
    vis.length = 0;
    army.grid.rect(ex0, ez0, ex1, ez1, vis);
    if (vis.length > 6000) return; // (the view is most of the map: everything's visible anyway)
    const { x, z, yaw, gait } = army;
    const nearA = st.near, stamp = st.stamp, wb = st.base;
    for (const i of vis) {
      if (x[i]! >= x0 && x[i]! <= x1 && z[i]! >= z0 && z[i]! <= z1) continue;
      let rel = (yaw[i]! - camYaw - Math.PI) / TAU;
      rel -= Math.floor(rel);
      const dir = Math.round(rel * DIRS) % DIRS;
      const b = unitBody[i]!;
      nearA[gaitSlot[b * MAXC + gait[i]!]! + dir] = stamp;
      for (let j = 0; j < wearN[i]!; j += 1) nearA[wb[B + wearShape[i * MAXW + j]!]! + dir] = stamp;
    }
  }
  function cull(view: PixelView, present: boolean) {
    fillT = now();
    const alpha = acc / DT;
    const [x0, z0, x1, z1] = view.groundRect(maxHeight / Math.tan(PITCH) + 1);
    inst.clear();
    wanted = 0; crisp = 0; exactN = 0; drawn = 0;
    const t = army.time + alpha * DT;
    vis.length = 0;
    army.grid.rect(x0, z0, x1, z1, vis);
    const { x, z, px: ox, pz: oz, yaw, gait, dist, phase: ph } = army;
    for (let v = 0; v < vis.length; v += 1) {
      const i = vis[v]!;
      pushUnit(i, ox[i]! + (x[i]! - ox[i]!) * alpha, oz[i]! + (z[i]! - oz[i]!) * alpha, yaw[i]!, gait[i]!, dist[i]!, t + ph[i]!);
    }
    visible = vis.length;
    vis.length = 0;
    propGrid.rect(x0, z0, x1, z1, vis);
    const st = stream!;
    const lut = st.lut, seen = st.seen, stamp = st.stamp, wb = st.base;
    for (let v = 0; v < vis.length; v += 1) {
      const i = vis[v]!;
      const slot = wb[propD[i]!]!;
      seen[slot] = stamp;
      wanted += 1;
      const o = slot * STREAM_LUT;
      const s = lut[o + 7]!;
      if (!s) continue;
      if (s === k) { crisp += 1; if (st.exact[slot]) exactN += 1; }
      drawn += 1;
      inst.push(propX[i]!, 0, propZ[i]!, lut[o]!, lut[o + 1]!, lut[o + 2]!, lut[o + 3]!, lut[o + 4]!, lut[o + 5]!, lut[o + 6]!, -1, 0, k / s);
    }
    if (present) presentFrame(view);
  }
  let fillMs = 0, submitMs = 0, fillT = 0; // (where a frame's CPU time goes: filling instances, handing them to GL)
  function presentFrame(view: PixelView) {
    const t0 = now();
    fillMs = t0 - fillT;
    if (inst.count && sr.pageCount) sr.drawLayers(view, inst, { clear, screen: screenFor(k), dither: 0.9, outline: 3 });
    else { gl.viewport(0, 0, W, H); gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    submitMs = now() - t0;
  }
  const px1 = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); // (waits for the GPU)

  // ---------------------------------------------------------------- the line-up: units side by side, standing, facing the camera
  let lineup: { count: number; dir: number; units: number[] } | null = null;
  /** A line-up's units: the population's first, taking every kind in turn (so a 64-unit line-up shows all of them). */
  function lineupOf(count: number, dir: number) {
    const byKind = new Map<number, number[]>();
    shapes.units.forEach((u, i) => { if (i < army.n) (byKind.get(u.entity) ?? byKind.set(u.entity, []).get(u.entity)!).push(i); });
    const lists = [...byKind.values()];
    const units: number[] = [];
    for (let r = 0; units.length < count && lists.some((l) => l.length > r); r += 1) for (const l of lists) if (units.length < count && l[r] !== undefined) units.push(l[r]!);
    return { count: units.length, dir, units };
  }
  function drawLineup(view: PixelView) {
    if (!lineup) return;
    inst.clear();
    wanted = 0; crisp = 0; exactN = 0; drawn = 0;
    const cols = Math.ceil(Math.sqrt(lineup.count));
    const rows = Math.ceil(lineup.count / cols);
    const gx = 2.4, gz = 2.6;
    const yaw0 = camYaw + Math.PI + (lineup.dir / DIRS) * Math.PI * 2; // (directionFor's direction `dir`)
    lineup.units.forEach((u, m) => {
      const c = m % cols, r = Math.floor(m / cols);
      const lx = (c - (cols - 1) / 2) * gx, lz = ((rows - 1) / 2 - r) * gz;
      // (Columns across the screen, rows back from the camera: the view's right, and the ground under its forward.)
      pushUnit(u, center[0] + Math.cos(camYaw) * lx + Math.sin(camYaw) * lz, center[2] - Math.sin(camYaw) * lx + Math.cos(camYaw) * lz, yaw0, 0, 0, 0);
    });
    presentFrame(view);
  }

  // ---------------------------------------------------------------- input
  const keys = new Set<string>();
  let showBake = true;
  addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (e.code === "KeyQ") camYaw -= Math.PI / 4;
    if (e.code === "KeyE") camYaw += Math.PI / 4;
    if (e.code === "BracketLeft") { pixel = Math.max(0.5, pixel / 2); fit(); }
    if (e.code === "BracketRight") { pixel = Math.min(8, pixel * 2); fit(); }
    if (e.code === "KeyH") overlay.hidden = !overlay.hidden;
    if (e.code === "KeyB") showBake = !showBake;
    if (e.code === "KeyL") lineup = lineup ? null : lineupOf(64, 1);
    const digit = /^Digit([1-5])$/.exec(e.code);
    if (digit) { n = COUNTS[Number(digit[1]) - 1]!; populate(n); }
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());
  const toPicture = (e: { clientX: number; clientY: number }): [number, number] => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
  let drag: [number, number, number] | null = null;
  canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); drag = viewNow().ground(...toPicture(e)); canvas.style.cursor = "grabbing"; });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const g = viewNow().ground(...toPicture(e));
    center = [center[0] + drag[0] - g[0], 0, center[2] + drag[2] - g[2]];
  });
  canvas.addEventListener("pointerup", () => { drag = null; canvas.style.cursor = "grab"; });
  let wheel = 0;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 50) return;
    const step = wheel > 0 ? -1 : 1;
    wheel = 0;
    setScale(LADDER[Math.max(0, Math.min(LADDER.length - 1, LADDER.indexOf(k) + step))]!, toPicture(e));
  }, { passive: false });
  // (Time-to-crisp after a zoom: armed by setScale, met by the first frame whose every layer is at the new scale.)
  let waitCrisp: { k: number; t: number; crisp: boolean; exact: boolean } | null = null;
  /** The one place the scale changes: zoom about a picture point, tell the stream (it debounces). */
  function setScale(next: number, at: [number, number] = [W / 2, H / 2]) {
    if (next === k) return;
    const before = viewNow().ground(at[0], at[1]);
    k = next;
    const after = viewNow().ground(at[0], at[1]);
    center = [center[0] + before[0] - after[0], 0, center[2] + before[2] - after[2]];
    stream?.setScale(k, now());
    mark(`zoom->${k}`, { k });
    waitCrisp = { k, t: now(), crisp: false, exact: false };
  }
  function pan(dt: number) {
    let f = 0, s = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) f += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) f -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) s += 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) s -= 1;
    if (!f && !s) return;
    const v = (700 / k) * dt;
    center = [center[0] + (Math.sin(camYaw) * f + Math.cos(camYaw) * s) * v, 0, center[2] + (Math.cos(camYaw) * f - Math.sin(camYaw) * s) * v];
  }

  // ---------------------------------------------------------------- start: the population, the scene scan, the preload
  let started = false, loadDone = false, scanT = 0, preloadN = 0;
  function start() {
    populate(n); // (the shapes: who is where, wearing what -- the looks come after the bake has started)
    mark("shapes", { ms: shapesMs });
    newStream();
    // The scene scan: one pass over the opening view marks every sprite it shows -- the stream bakes exactly those first.
    stream!.begin(now());
    cull(viewNow(), false);
    stream!.update(now());
    scanT = now();
    mark("scan", { ms: scanT - T0 });
    if (usePreload) preloadN = stream!.preload({ full: ["main"], designs: "all", frames: "first", visibleClips: true });
    // The opening view's jobs go to the worker as soon as it's ready, so it bakes while this thread paints ten thousand looks.
    phase = "PAINTING EVERY UNIT'S LOOK";
    drawLoading();
    void Promise.race([workers.whenReady, new Promise((r) => setTimeout(r, 300))]).then(() => {
      // (A head start: the opening view and as much of the preload as the looks will take to paint, queued at once.)
      if (workers.ready) for (let i = 0; i < 6; i += 1) { const jobs = stream!.take(400, 4); if (!jobs.length) break; noteRank(jobs); workers.send(jobs, true); }
      else pump(true, 0);
      mark("first jobs out");
    }).then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
      const t0 = now();
      dress(dressPopulation(shapes));
      popMs = shapesMs + now() - t0;
      mark("looks", { ms: now() - t0 });
      phase = "BAKING THE OPENING VIEW";
      started = true;
    });
  }

  // ---------------------------------------------------------------- the loop
  let frames = 0, fpsT = now(), fps = 0, cpuMs = 0, frameNo = 0, overlayT = 0, updateMs = 0;
  const finished: number[] = [];
  const frameGaps: number[] = [], idleGaps: number[] = [];
  const hitches: Array<Record<string, number | boolean>> = []; // (frames over 20 ms of this thread's work, and why) // (rAF intervals while the stream has work, for the streaming frame-time report)
  let lastRaf = now();
  function frame() {
    const t0 = now();
    const gap = t0 - lastRaf;
    lastRaf = t0;
    const dt = (t0 - last) / 1000;
    last = t0;
    const st = stream!;
    st.begin(t0);
    const isLoading = !!loading;
    if (isLoading) {
      // (The sim waits while loading: the opening view holds still, and is baked exactly.)
      cull(viewNow(), false);
    } else {
      pan(dt);
      simulate(dt);
      const view = viewNow();
      if (lineup) drawLineup(view); else cull(view, true);
      markNear(view, dt);
    }
    const t1 = now();
    budget.work(t1 - t0);
    st.update(t1);
    updateMs = updateMs * 0.95 + (now() - t1) * 0.05;
    const tp = now();
    const up0 = uploads, pages0 = sr.pageCount;
    pump(isLoading, gap);
    const tq = now();
    if (!isLoading && tq - t0 > 20 && hitches.length < 40) hitches.push({ at: Math.round(t0 - T0), frame: +(tq - t0).toFixed(1), work: +(t1 - t0).toFixed(1), update: +(tp - t1).toFixed(1), pump: +(tq - tp).toFixed(1), uploads: uploads - up0, pagesGrew: sr.pageCount !== pages0, gap: +gap.toFixed(1) });
    if (isLoading) {
      const p = st.preloading;
      if (!events.some((e) => e.what === "view ready") && st.missingVisible === 0) mark("view ready", { ms: now() - scanT });
      if (!loadDone && pop && p.done >= p.total && st.missingVisible === 0) {
        loadDone = true;
        mark("preload", { ms: now() - T0 });
        loading!.remove(); loading = null;
        last = now(); acc = 0;
      } else drawLoading();
    }
    const t2 = now();
    cpuMs = cpuMs * 0.95 + (t1 - t0) * 0.05;
    if (!isLoading) {
      if (!events.some((e) => e.what === "crisp load") && wanted && crisp === wanted) mark("crisp load", { ms: now() - T0, k });
      if (!events.some((e) => e.what === "exact load") && wanted && exactN === wanted) mark("exact load", { ms: now() - T0, k });
      if (waitCrisp && waitCrisp.k === k && wanted) {
        if (!waitCrisp.crisp && crisp === wanted) { waitCrisp.crisp = true; mark(`crisp zoom->${k}`, { k, ms: now() - waitCrisp.t }); }
        if (!waitCrisp.exact && exactN === wanted) { waitCrisp.exact = true; mark(`exact zoom->${k}`, { k, ms: now() - waitCrisp.t }); }
        if (waitCrisp.crisp && waitCrisp.exact) waitCrisp = null;
      }
      if (st.backlog > 0 || st.missingVisible > 0 || arrived.length) { frameGaps.push(gap); if (frameGaps.length > 600) frameGaps.shift(); }
      else { idleGaps.push(gap); if (idleGaps.length > 600) idleGaps.shift(); }
    }
    if (++frameNo % 30 === 0 && !isLoading) { finish(); finished.push(now() - t0); if (finished.length > 21) finished.shift(); }
    frames += 1;
    if (t0 - fpsT >= 1000) { fps = (frames * 1000) / (t0 - fpsT); frames = 0; fpsT = t0; }
    if (t2 - overlayT > 250) { overlayT = t2; overlay.textContent = describe(); }
  }
  const median = (l: number[]) => { const s = l.slice().sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : 0; };
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 100);
  const stats = (): ArmyStats => {
    const s = stream!.stats();
    return {
      fps: Math.round(fps), cpuMs: +cpuMs.toFixed(2), finishedMs: +median(finished).toFixed(2), simMs: +simMs.toFixed(2), visible, units: army.n, k, picture: `${W}x${H}`, layers: inst.count,
      baking: `${s.queued ? `streaming: ${s.queued} queued, ${s.inFlight} in flight` : "idle"} · ${bakedWorker} by workers, ${bakedMain} on the main thread (${msPerSprite.toFixed(2)} ms/sprite)`,
      atlas: `${s.pages} page${s.pages === 1 ? "" : "s"} ${2048}² · ${(s.used / 1048576).toFixed(1)} of ${(s.bytes / 1048576).toFixed(0)} MB · ${s.evictions} evictions`,
    };
  };
  const describe = () => {
    const s = stats();
    const lines = [`ARMY  seed ${seed}`, `${s.fps} fps   frame ${s.cpuMs.toFixed(2)} ms cpu · ${s.finishedMs.toFixed(2)} ms gpu-finished · sim step ${s.simMs.toFixed(2)} ms`,
      `${s.units} units, every one different · ${s.visible} in view · ${s.layers} layers drawn · ${props0} props`, `${B} body shapes · ${A} wearable shapes · ${table.count} looks · ${table.colours} colours`,
      `stored as a hybrid record: ${(recordSize / 1024).toFixed(1)} KB (${fromRecord ? "read from the stored record" : "made from the recipe"}) · unit ${HERO}: a voxel hero`,
      `${s.picture} picture · ${k} px/m · pixel ${pixel}`];
    if (showBake) {
      const q = stream!.stats();
      lines.push(`bake  ${pct(crisp, wanted)}% crisp · ${pct(exactN, wanted)}% exact · ${pct(drawn, wanted)}% drawn · target ${q.target} px/m${q.pending !== q.target ? ` (settling on ${q.pending})` : ""}`,
        `      ${q.queued} queued · ${q.visibleMissing} visible missing · ${q.inFlight} in flight · ${arrived.length} to upload`,
        `      budget ${sliceMs.toFixed(1)} ms/frame · ${(budget.used * 100).toFixed(0)}% used · frame cost ${budget.cost.toFixed(2)} ms · re-order ${updateMs.toFixed(2)} ms`,
        `      workers ${workers.mode}${workers.mode !== "none" ? ` ×${workers.ready} (${workers.msPerSprite.toFixed(2)} ms/sprite)` : ` (${workers.failure ?? ""})`} · ${s.baking}`,
        `      ${s.atlas}`);
    }
    lines.push("WASD/drag pan · wheel zoom · Q/E turn · 1-5 units · [ ] pixel · L line-up · B bake · H hide");
    return lines.join("\n");
  };
  let paused = false;
  const loop = () => { if (started && !paused) frame(); requestAnimationFrame(loop); };
  // (A frame for the loading screen to show, then the population: the page never looks stuck.)
  // (A timer, not a frame: a page opened behind another still gets its population made.)
  // (After the workers have loaded and made their GL contexts -- both need this thread, which the population keeps busy -- or 400 ms.)
  void Promise.race([workers.booted, new Promise((r) => setTimeout(r, 400))]).then(() => setTimeout(() => {
    mark("workers booted");
    try { start(); } catch (e) { overlay.textContent = String((e as Error)?.stack ?? e); throw e; }
    if (!usePreload) mark("preload", { ms: now() - T0 });
    requestAnimationFrame(loop);
  }, 0));

  // ---------------------------------------------------------------- for measuring (and the curious)
  const api = {
    stats: () => stats(),
    stream: () => stream!.stats(),
    /** What the load and each zoom took: events with times from main() (t) and durations (ms). */
    timeline: () => events.slice(),
    /** Is every layer of the picture at the view's scale (and so is the load done)? */
    crisp: () => loadDone || !usePreload ? wanted > 0 && crisp === wanted && (!waitCrisp || waitCrisp.crisp) : false,
    exact: () => wanted > 0 && exactN === wanted,
    frame: () => ({ wanted, crisp, exact: exactN, drawn }),
    bake: () => ({ updateMs: +updateMs.toFixed(3), sliceMs: +sliceMs.toFixed(2), budgetUsed: +budget.used.toFixed(2), workers: workers.mode, ready: workers.ready, workerReadyMs: workers.readyMs.map((x) => Math.round(x)), workerSetup: workers.setupParts, failure: workers.failure, bakedWorker, bakedMain, bakeMainMs: Math.round(bakeMainMs), uploads, uploadMs: +uploadMs.toFixed(1), returned, preload: stream!.preloading, preloadMarked: preloadN, workerMsPerSprite: +workers.msPerSprite.toFixed(3), mainMsPerSprite: +msPerSprite.toFixed(3) }),
    /** rAF intervals while the stream had work: median, p95, max (ms). */
    streamingFrames: () => gapStats(frameGaps),
    /** The same with nothing to bake, to compare. */
    idleFrames: () => gapStats(idleGaps),
    /** Distinct sprites the view shows now: bodies (clip frame x direction) and wearables (shape x direction). */
    visibleSprites: () => { const st = stream!; let bodies = 0, wear = 0, other = 0; for (let s = 0; s < st.slots; s += 1) if (st.seen[s] === st.stamp) { const d = designs.length ? designIndexOf(s) : 0; if (d < B) bodies += 1; else if (d < B + A) wear += 1; else other += 1; } return { bodies, wearables: wear, props: other }; },
    population: () => (!pop ? null : { units: pop.units.length, ...pop.stats, record: recordSize, fromRecord, shapesMs: +shapesMs.toFixed(0), ms: +popMs.toFixed(0), looksInTable: table.count, colours: table.colours, ramps: table.ramps, cost: bakeCost(pop, DIRS), distinct: new Set(pop.units.map((u) => u.signature)).size, heroes }),
    hitches: () => hitches.slice(),
    /** Stop (true) or restart the frame loop -- for timing a bake alone. */
    pause(on = true) { paused = on; },
    setUnits(count: number) { n = count; populate(n); },
    setSize(w: number | null, h?: number) { fixed = w && h ? [w, h] : null; fit(); },
    setScale: (next: number) => setScale(next),
    setCenter(x: number, zz: number) { center = [x, 0, zz]; },
    setYaw(y: number) { camYaw = y; },
    /** Show a line-up of the first `count` units (all different), standing, from direction `dir`; null to go back. */
    lineup(count: number | null = 64, dir = 1) { lineup = count ? lineupOf(count, dir) : null; return lineup ? lineup.units.map((i) => shapes.entities[shapes.units[i]!.entity]!.def.id) : []; },
    /** Time a bake of every shape at scale `s` on this thread without keeping it: bodies and wearables apart. */
    bakeSplit(s = k) {
      const plan = (list: DesignSpec[]) => planBake(list, { directions: DIRS, pixelsPerMetre: s, pitch: PITCH, style: "bench" }).sprites;
      const time = (jobs: readonly SpriteJob[]) => { const t0 = now(); const r = renderIndexedSprites(mainPx(), jobs, sources); return { sprites: jobs.length, ms: +(now() - t0).toFixed(0), perSprite: +((now() - t0) / Math.max(1, jobs.length)).toFixed(3), kept: r.stats.kept, drawMs: +r.stats.drawMs.toFixed(0), readMs: +r.stats.readMs.toFixed(0), trimMs: +r.stats.trimMs.toFixed(0) }; };
      return { k: s, bodies: time(plan([...shapes.bodies])), wearables: time(plan([...shapes.attributes])) };
    },
    /** Run `count` frames back to back, each one waited for on the GPU: ms per frame. */
    measure(count = 120) {
      const t: number[] = [], drawT: number[] = [], cpuT: number[] = [];
      let vsum = 0;
      for (let i = 0; i < count; i += 1) {
        const t0 = now();
        stream!.begin(t0);
        simulate(1 / 120);
        const t1 = now();
        if (lineup) drawLineup(viewNow()); else cull(viewNow(), true);
        const tc = now();
        finish();
        const t2 = now();
        t.push(t2 - t0); drawT.push(t2 - t1); cpuT.push(tc - t1);
        vsum += inst.count;
      }
      cpuT.sort((a, b) => a - b);
      const parts = { fill: +fillMs.toFixed(2), submit: +submitMs.toFixed(2) };
      const mean = t.reduce((a, b) => a + b, 0) / t.length;
      t.sort((a, b) => a - b);
      drawT.sort((a, b) => a - b);
      return { parts, cpuMedian: +cpuT[cpuT.length >> 1]!.toFixed(3), drawMedian: +drawT[drawT.length >> 1]!.toFixed(3), drawMax: +drawT[drawT.length - 1]!.toFixed(3), mean: +mean.toFixed(3), median: +t[t.length >> 1]!.toFixed(3), p95: +t[Math.floor(t.length * 0.95)]!.toFixed(3), max: +t[t.length - 1]!.toFixed(3), layers: Math.round(vsum / count), units: army.n, visible, picture: `${W}x${H}`, k };
    },
    /** Draw a frame and save the picture to the dev server's out/ (PUT /out/<name>.png); the loading screen if it's up. */
    shoot(name: string): Promise<number> {
      const src: HTMLCanvasElement = loading ? loading.element : canvas;
      if (!loading) { if (lineup) drawLineup(viewNow()); else cull(viewNow(), true); }
      return new Promise((done) => src.toBlob((b) => { void fetch(`/out/${name}.png`, { method: "PUT", body: b }).then((r) => done(r.status)); }, "image/png"));
    },
  };
  const gapStats = (l: number[]) => { const s = l.slice().sort((a, b) => a - b); return s.length ? { n: s.length, median: +s[s.length >> 1]!.toFixed(2), p95: +s[Math.floor(s.length * 0.95)]!.toFixed(2), max: +s[s.length - 1]!.toFixed(2) } : null; };
  const designIndexOf = (slot: number) => { const b = stream!.base; let lo = 0, hi = designs.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid]! <= slot) lo = mid; else hi = mid - 1; } return lo; };
  (globalThis as { army?: typeof api }).army = api;
  addEventListener("message", (e: MessageEvent) => {
    const m = e.data as { army?: string; args?: unknown[]; id?: unknown } | null;
    if (!m || typeof m.army !== "string" || m.army === "reply" || !(m.army in api)) return;
    void Promise.resolve((api as unknown as Record<string, (...a: unknown[]) => unknown>)[m.army]!(...(m.args ?? []))).then((result) => (e.source as Window | null)?.postMessage({ army: "reply", id: m.id, result }, { targetOrigin: "*" }));
  });
}
