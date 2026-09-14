// CRAWL: the dungeon mode -- a generated floor dressed and lit as an
// action-RPG dungeon, walked by a small hero.
//
// keel/worldgen makes the floor (any of its five generators), dresses it in
// an act (crypt, cave, hell forge, overgrown ruin: room kinds, floors, props,
// lights, doors, stairs), builds its scene (walls with height, pillars,
// arches, stairs, bridges) and draws it (the light map with flickering
// torches, palette-true surfaces, the cutaway, fog of war, the abyss).
// packs/dungeon's props and the hero and his foes (packs/humans,
// packs/animals: a population) are baked as indexed sprites at the view's
// scale and lit per texel; keel/particles throws embers, smoke and the act's
// air (dust, drips, embers, spores).
//
// The hero: WASD (screen-relative) or click to walk (A* on the half-metre
// grid); doors open as he reaches them, the boss's only with the key; chests
// open; the stairs down take him to the next act. Keys: T generator, N act,
// G new floor, X cutaway (stub / dither / off), L lights, F fog, R reveal,
// wheel zoom (16 24 32 48 px/m).

import { bakeDesignOf, lookFor, placeContent } from "@keel/game-engine/object";
import type { BuiltObject, ContentPack, StyledBakeDesign } from "@keel/game-engine/object";
import {
  LOOKS_PER_ROW, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW, SLOTS, WORN_SLOT, createLookTable, createSpriteCache, directionFor, dressPopulation, paintRoles, paintSlots, pixelView, planBake,
  populateShapes, renderIndexedSprites,
} from "@keel/game-engine/bake";
import type { BodyShape, IndexedBakeRenderer, LookTable, Population, PixelView, SpriteJob } from "@keel/game-engine/bake";
import { ROOMS, pack as dungeonPack, shield, sword } from "@keel/game-engine/dungeon";
import { pack as humans } from "@keel/game-engine/humans";
import { pack as animals } from "@keel/game-engine/animals";
import { cape, hood } from "@keel/game-engine/cloth";
import { PRESETS, createParticlePool, createParticleRenderer, defineParticleRecipe, particlePalette } from "@keel/game-engine/particles";
import type { ParticlePool, ParticleRenderer } from "@keel/game-engine/particles";
import {
  CELL, CRAWL_ACTS, CRAWL_THEMES, DUNGEON_ALGORITHMS, FLOOR, LIT_SPRITE_FLOATS, ROOM_TEMPLATES, SUB, buildDungeonScene, createDungeonRenderer, createFog, dressDungeon, generateDungeon,
} from "@keel/game-engine/worldgen";
import type { RoomTemplate } from "@keel/game-engine/worldgen";

// (The engine's room templates and packs/dungeon's: libraries, crypt halls, armouries, prisons, colonnades, a throne hall.)
const TEMPLATES: readonly RoomTemplate[] = [...ROOM_TEMPLATES, ...(ROOMS as readonly RoomTemplate[])];
import type { DungeonAlgorithm, DungeonDressing, DungeonRenderer, DungeonScene, Fog } from "@keel/game-engine/worldgen";

export const CRAWL_YAW = Math.PI / 4;
export const CRAWL_PITCH = Math.asin(0.5); // (30°: floor tiles as 2:1 diamonds)
export const CRAWL_LADDER = [16, 24, 32, 48];
const TAU = Math.PI * 2;
const PACKS: readonly ContentPack[] = [dungeonPack];
const HANGS = new Set(["torch", "banner", "chains", "roots", "cobweb", "bookshelf", "weapon-rack", "statue", "furnace"]);
const now = () => performance.now();

interface PropShape { readonly key: string; readonly built: BuiltObject; readonly design: StyledBakeDesign; readonly dirs: number; readonly flames: ReadonlyArray<readonly [number, number, number]> }
interface Rect { x: number; y: number; w: number; h: number; ax: number; ay: number; page: number }
interface Mob { body: number; look: number; x: number; z: number; yaw: number; tx: number; tz: number; speed: number; dist: number; gait: 0 | 1 | 2; t: number; room: number; think: number; attackT: number }

export interface CrawlOptions {
  readonly gl: WebGL2RenderingContext;
  readonly px: IndexedBakeRenderer;
  readonly maxTexture: number;
  readonly seed: string;
  readonly algorithm: DungeonAlgorithm;
  readonly act: string;
  readonly k: number;
  readonly density?: number;
  readonly size?: readonly [number, number];
  readonly mobs?: number;
}

export function createCrawl(o: CrawlOptions) {
  const { gl, px } = o;
  let seed = o.seed, algorithm = o.algorithm, act = o.act, k = o.k, density = o.density ?? 1.35, size: readonly [number, number] = o.size ?? [84, 60], mobCount = o.mobs ?? 30;
  let depth = 0;
  const R = createDungeonRenderer(gl, { looks: { slots: SLOTS, looksPerRow: LOOKS_PER_ROW, lookTexels: LOOK_TEXELS, paintsPerRow: PAINTS_PER_ROW, paletteRow: PALETTE_ROW } });
  const cache = createSpriteCache();
  let parts: ParticleRenderer | null = null;
  try { parts = createParticleRenderer(gl, { capacity: 12000 }); const pp = particlePalette(); parts.setPalette(pp.colours, pp.ramps); } catch (e) { console.warn("particles off:", e); parts = null; }

  // ---------------------------------------------------------------- the floor
  let D = generateDungeon(seed, size[0], size[1], { algorithm, rooms: 12, templates: TEMPLATES });
  let S: DungeonDressing = dressDungeon(D, act, { seed, density });
  let scene: DungeonScene = buildDungeonScene(S);
  let fog: Fog = createFog(S, { remembered: S.theme.remembered });
  let genMs = 0;
  // Runtime state.
  let hero = { x: 0, z: 0, yaw: 0, dist: 0, gait: 0 as 0 | 1 | 2, attackT: 0 };
  let path: Array<[number, number]> = [];
  let doorAngle = new Float32Array(0), doorTarget = new Float32Array(0);
  let hasKey = false, keyProp = -1;
  const opened = new Set<number>();
  let mobs: Mob[] = [];
  let fogOn = true, lightsOn = true, cutaway: "stub" | "dither" | "off" = "stub";
  let pool: ParticlePool | null = null;
  let motes = -1;

  // ---------------------------------------------------------------- sprites: props and people
  const shapes = new Map<string, PropShape>();
  const propShape: number[] = []; // (per prop: an index into shapeList)
  let shapeList: PropShape[] = [];
  const shapeFor = (id: string, pins: Readonly<Record<string, string | number | boolean>>, seedN: number): PropShape => {
    const v = seedN % 3;
    const key = `${id}|${JSON.stringify(pins)}|${v}`;
    let s = shapes.get(key);
    if (!s) {
      const placed = placeContent(PACKS, { pack: "packs/dungeon", id, seed: `${key}`, style: "pixel", pins: { ...pins } });
      const design = bakeDesignOf(placed.built);
      const meta = (placed.built.def.meta ?? {}) as { flames?: Array<[number, number, number]> };
      s = { key, built: placed.built, design, dirs: design.symmetric ? 1 : 8, flames: meta.flames ?? [] };
      shapes.set(key, s);
    }
    return s;
  };
  // The people: the hero (a human) and his foes (rat-men, frog-men, bear-folk, hounds, bears, foxes).
  let pop: Population | null = null;
  const makePopulation = (): Population => {
    const pick = (list: readonly { id: string }[], ids: readonly string[]) => list.filter((e) => ids.includes(e.id));
    const clipsFor = () => [{ name: "idle", frames: 4, loop: true }, { name: "walk", frames: 8, loop: true }, { name: "attack", frames: 6, loop: true }];
    // (The hero is the only human: a swordsman in a dark blue jacket and boots, a crimson hood and cape, sword and
    // heater shield -- a silhouette that reads at 24 px/m. His foes are the anthro folk and beasts.)
    const HERO_SHAPE: Record<string, unknown> = { hair: "short", girth: 1.12, height: 1.04, arms: 1.04 };
    const HERO_COVER: Record<string, unknown> = { top: "jacket", hood: false, pants: "long", shoes: "boots", pack: "none", accessory: "none" };
    const HERO_LOOK: Record<string, unknown> = {
      profile: "analogous", "cloth.hue": 252, "cloth.chroma": 0.075, "cloth.light": 0.4, "cloth.pattern": "none", "clothAlt.hue": 45, "clothAlt.chroma": 0.045, "clothAlt.light": 0.3, "clothAlt.pattern": "none",
      "accent.hue": 78, "accent.chroma": 0.12, "accent.light": 0.66, "hair.hue": 45, "hair.light": 0.24, "dark.hue": 40, "dark.chroma": 0.03, "dark.light": 0.2,
    };
    // (His gear with its shape choices fixed: a hood, a long tattered cape with a mantle, a long sword, a heater shield.)
    const fixed = <T extends { choices?: unknown }>(def: T, choices: Record<string, readonly unknown[]>): T => ({ ...def, choices });
    const heroWear = [
      fixed(hood, { ears: ["none"], point: [true], drape: [0.8] }), fixed(cape, { length: ["long"], hem: ["tattered"], collar: ["mantle"] }),
      fixed(sword, { blade: ["long"], guard: ["cross"] }), fixed(shield, { form: ["heater"], boss: [true] }),
    ].map((def) => ({ defs: [def as never], chance: 1 }));
    const entities = [
      ...pick(humans.entities, ["human"]).map((def) => ({ def: def as never, pack: "packs/humans", pins: { ...HERO_SHAPE, ...HERO_COVER } as never, shapes: 1, weight: 0.001, wear: heroWear })),
      ...pick(humans.entities, ["anthro-mouse", "anthro-frog", "anthro-bear"]).map((def) => ({ def: def as never, pack: "packs/humans", pins: { pack: "none", accessory: "none" }, shapes: 1, weight: 1 })),
      ...pick(animals.entities, ["dog", "fox"]).map((def) => ({ def: def as never, pack: "packs/animals", shapes: 1, weight: 0.7 })),
    ];
    // (What he wears shares one look, in the worn slots only bodies with baked-in wear have: crimson cloth and paint, a
    // steel blade, boss and mantle, gold trim.)
    const WORN = {
      "primary.hue": 24, "primary.chroma": 0.15, "primary.light": 0.44, "primary.pattern": "none", "secondary.hue": 250, "secondary.chroma": 0.018, "secondary.light": 0.74, "secondary.pattern": "none",
      "trim.hue": 80, "trim.chroma": 0.11, "trim.light": 0.72, "trim.pattern": "none",
    };
    const shapesP = populateShapes({ seed: `crawl:${seed}`, count: mobCount + 1, entities, attributes: [], shapes: 1, wear: [0, 0], clipsFor, look: { pins: WORN }, pins: new Map([[0, { body: { entity: "human", coverage: HERO_COVER as never }, look: HERO_LOOK as never }]]) });
    return dressPopulation(shapesP);
  };
  let table: LookTable = createLookTable({ rampLength: 5 });
  let propLook: number[] = [];
  let unitLook: number[] = [];
  let rects = new Map<string, Rect>();
  let bakedK = 0, bakeMs = 0, bakeCount = 0;
  let packGen = 0;

  function bakeAll() {
    const t0 = now();
    // Every prop's shape (and the other state of anything that opens), their looks in the act's profile.
    shapeList = [];
    const index = new Map<string, number>();
    const idx = (s: PropShape) => { let i = index.get(s.key); if (i === undefined) { i = shapeList.length; index.set(s.key, i); shapeList.push(s); } return i; };
    propShape.length = 0;
    S.props.forEach((p) => { propShape.push(idx(shapeFor(p.id, p.pins, p.seed))); if (p.openable) idx(shapeFor(p.id, { ...p.pins, state: "open" }, p.seed)); });
    table = createLookTable({ rampLength: 5 });
    const profile = dungeonPack.profile(S.theme.profile);
    const lookCache = new Map<string, number>();
    propLook = S.props.map((p, i) => {
      const s = shapeList[propShape[i]!]!;
      const key = `${p.id}|${p.seed % 4}`;
      let at = lookCache.get(key);
      if (at === undefined) { at = table.add(paintRoles(lookFor(s.built, `${key}#${S.theme.id}`, profile ? { profile } : {}))); lookCache.set(key, at); }
      return at;
    });
    pop ??= makePopulation();
    unitLook = pop.units.map((u) => table.add(paintSlots(u.look, pop!.bodies[u.body]!.slotRoles(u.coverage), u.wornLook, WORN_SLOT)));
    // Bake: props from the directions they're seen from, bodies from all eight.
    const need = new Set<string>();
    S.props.forEach((p, i) => { const s = shapeList[propShape[i]!]!; need.add(`${s.design.key}|${s.dirs === 1 ? 0 : directionFor(p.yaw, CRAWL_YAW, 8)}`); });
    for (const s of shapeList) if (s.key.includes("state") || s.key.startsWith("chest")) for (let d = 0; d < s.dirs; d += 1) need.add(`${s.design.key}|${d}`);
    const designs = [...shapeList.map((s) => s.design), ...pop.bodies];
    const plan = planBake(designs as never, { directions: 8, pixelsPerMetre: k, pitch: CRAWL_PITCH, style: "crawl" });
    const bodyKeys = new Set(pop.bodies.map((b) => b.key));
    const jobs = plan.sprites.filter((j) => bodyKeys.has(j.design) || need.has(`${j.design}|${j.direction}`));
    // (The hero baked a size up -- 1.3x, whole texels still: he's the one you look for.)
    const heroBody = pop.bodies[pop.units[0]!.body]!;
    const heroJobs = planBake([heroBody] as never, { directions: 8, pixelsPerMetre: Math.round(k * 1.3), pitch: CRAWL_PITCH, style: "crawl-hero" }).sprites;
    jobs.push(...heroJobs);
    const sources = new Map<string, unknown>([...shapeList.map((s) => [s.design.key, s.design] as const), ...pop.bodies.map((b) => [b.key, b] as const)]);
    const todo = cache.missing(jobs);
    if (todo.length) cache.add(renderIndexedSprites(px, todo, sources as never).baked);
    const atlas = cache.atlas(jobs.map((j) => j.key), { size: o.maxTexture });
    rects = new Map();
    for (const j of jobs as readonly SpriteJob[]) { const r = atlas.sprites.get(j.key); if (r) rects.set(`${j.style === "crawl-hero" ? "hero|" : ""}${j.design}|${j.clip}|${j.frame}|${j.direction}`, { x: r.x, y: r.y, w: r.w, h: r.h, ax: r.ax, ay: r.ay, page: r.page }); }
    R.setPages(atlas.pages);
    R.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture() });
    bakedK = k; bakeMs = now() - t0; bakeCount = todo.length; packGen += 1;
  }

  // ---------------------------------------------------------------- building a floor
  function build() {
    const t0 = now();
    D = generateDungeon(seed, size[0], size[1], { algorithm, rooms: Math.round(12 * (size[0] * size[1]) / (84 * 60)), templates: TEMPLATES });
    S = dressDungeon(D, act, { seed, density });
    scene = buildDungeonScene(S);
    fog = createFog(S, { remembered: S.theme.remembered });
    R.setScene(scene, S);
    // Flames where the props really carry them (their design's meta), not the dressing's guess.
    S.props.forEach((p) => {
      if (p.light < 0) return;
      const s = shapeFor(p.id, p.pins, p.seed);
      const f = s.flames[0];
      if (!f) return;
      const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      R.moveLight(p.light, p.x + f[0] * c + f[2] * sn, f[1], p.z - f[0] * sn + f[2] * c);
    });
    doorAngle = new Float32Array(S.doors.length); doorTarget = new Float32Array(S.doors.length);
    refreshDoors();
    hasKey = false; opened.clear(); path = [];
    keyProp = S.props.findIndex((p) => p.id === "key");
    const [si, sj] = S.start;
    hero = { x: (si + 0.5) * S.tile, z: (sj + 0.5) * S.tile, yaw: CRAWL_YAW, dist: 0, gait: 0, attackT: 0 };
    if (S.stairsUp && S.stairsUp.i === si && S.stairsUp.j === sj) { hero.x -= Math.sin(hero.yaw) * S.tile; hero.z -= Math.cos(hero.yaw) * S.tile; }
    hero.yaw = CRAWL_YAW + Math.PI; // (come down the stairs toward us: his face, not his back)
    camera = [hero.x, hero.z];
    bakeAll();
    spawnMobs();
    startParticles();
    fog.look(hero.x, hero.z, closedAt);
    fog.ease(10);
    R.setFog(fogOn ? fog.shown : null);
    genMs = now() - t0;
  }

  // ---------------------------------------------------------------- walking
  const fsz = () => S.tile / SUB;
  const doorAtCell = new Map<number, number>();
  const refreshDoors = () => { doorAtCell.clear(); S.doors.forEach((d, i) => doorAtCell.set(d.cell, i)); };
  const closedAt = (cell: number): boolean => { const i = doorAtCell.get(cell); return i !== undefined && doorAngle[i]! < 0.9; };
  const canWalk = (x: number, z: number, forPath = false): boolean => {
    const f = fsz();
    const fx = Math.floor(x / f), fz = Math.floor(z / f);
    if (fx < 0 || fz < 0 || fx >= scene.fw || fz >= scene.fd || !scene.walk[fz * scene.fw + fx]) return false;
    const cell = Math.floor(z / S.tile) * S.w + Math.floor(x / S.tile);
    const di = doorAtCell.get(cell);
    if (di !== undefined) { const d = S.doors[di]!; if (d.locked && !hasKey) return false; if (!forPath && doorAngle[di]! < 1.0) return false; }
    return true;
  };
  let stuck = 0;
  // (A door he may open, opening: wait for it rather than turn back.)
  const doorAhead = (x: number, z: number): boolean => { const di = doorAtCell.get(Math.floor(z / S.tile) * S.w + Math.floor(x / S.tile)); return di !== undefined && (!S.doors[di]!.locked || hasKey); };
  const free = (x: number, z: number, r = 0.28): boolean => canWalk(x - r, z - r) && canWalk(x + r, z - r) && canWalk(x - r, z + r) && canWalk(x + r, z + r);
  // A* over the half-metre grid (8-way, no corner cutting); returns world waypoints, straightened by sight lines.
  function findPath(x0: number, z0: number, x1: number, z1: number): Array<[number, number]> {
    const f = fsz(), fw = scene.fw, fd = scene.fd;
    const s = Math.floor(z0 / f) * fw + Math.floor(x0 / f);
    let g = Math.floor(z1 / f) * fw + Math.floor(x1 / f);
    // (A cell he fits in: his whole body clear, as he walks it.)
    const ok = (q: number) => { const x = (q % fw + 0.5) * f, z = (Math.floor(q / fw) + 0.5) * f, r = 0.27; return canWalk(x - r, z - r, true) && canWalk(x + r, z - r, true) && canWalk(x - r, z + r, true) && canWalk(x + r, z + r, true); };
    if (!ok(g)) { let best = -1, bd = Infinity; const gx = g % fw, gz = Math.floor(g / fw); for (let dz = -4; dz <= 4; dz += 1) for (let dx = -4; dx <= 4; dx += 1) { const q = (gz + dz) * fw + gx + dx; if (gx + dx >= 0 && gz + dz >= 0 && gx + dx < fw && gz + dz < fd && ok(q) && Math.hypot(dx, dz) < bd) { bd = Math.hypot(dx, dz); best = q; } } if (best < 0) return []; g = best; }
    const N = fw * fd;
    const cost = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const heap: number[] = [], hk: number[] = [];
    const hpush = (q: number, key: number) => { heap.push(q); hk.push(key); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hk[p]! <= hk[i]!) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; [hk[p], hk[i]] = [hk[i]!, hk[p]!]; i = p; } };
    const hpop = (): number => { const top = heap[0]!; const lq = heap.pop()!, lk = hk.pop()!; if (heap.length) { heap[0] = lq; hk[0] = lk; let i = 0; for (;;) { const a = i * 2 + 1, b = a + 1; let m = i; if (a < heap.length && hk[a]! < hk[m]!) m = a; if (b < heap.length && hk[b]! < hk[m]!) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i]!, heap[m]!]; [hk[m], hk[i]] = [hk[i]!, hk[m]!]; i = m; } } return top; };
    const gx = g % fw, gz = Math.floor(g / fw);
    const hh = (q: number) => { const dx = Math.abs(q % fw - gx), dz = Math.abs(Math.floor(q / fw) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    cost[s] = 0; hpush(s, hh(s));
    let found = false, guard = 0;
    while (heap.length && guard++ < N * 2) {
      const q = hpop();
      if (closed[q]) continue;
      closed[q] = 1;
      if (q === g) { found = true; break; }
      const qx = q % fw, qz = Math.floor(q / fw);
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (!dx && !dz) continue;
        const x = qx + dx, z = qz + dz;
        if (x < 0 || z < 0 || x >= fw || z >= fd) continue;
        const n = z * fw + x;
        if (closed[n] || !ok(n)) continue;
        if (dx && dz && (!ok(qz * fw + x) || !ok(z * fw + qx))) continue;
        const c = cost[q]! + (dx && dz ? 1.414 : 1);
        if (c < cost[n]!) { cost[n] = c; prev[n] = q; hpush(n, c + hh(n)); }
      }
    }
    if (!found) return [];
    const cellsOut: number[] = [];
    for (let q = g; q >= 0; q = prev[q]!) cellsOut.push(q);
    cellsOut.reverse();
    const pts = cellsOut.map((q) => [(q % fw + 0.5) * f, (Math.floor(q / fw) + 0.5) * f] as [number, number]);
    // (String pulling: skip points while a straight walk stays clear.)
    const out: Array<[number, number]> = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !clearLine(pts[a]!, pts[b]!)) b -= 1;
      out.push(pts[b]!); a = b;
    }
    return out;
  }
  const clearLine = (p: readonly [number, number], q: readonly [number, number]): boolean => { const n = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.2); for (let i = 1; i < n; i += 1) { const x = p[0] + ((q[0] - p[0]) * i) / n, z = p[1] + ((q[1] - p[1]) * i) / n; if (!free(x, z, 0.3)) return false; } return true; };

  // ---------------------------------------------------------------- mobs
  function spawnMobs() {
    mobs = [];
    if (!pop) return;
    const rooms = S.rooms.filter((r) => r.kind !== "entry");
    let n = 0;
    for (let u = 1; u < pop.units.length && rooms.length; u += 1) {
      // (A room for each, a free spot in it: tried a few times, then any room.)
      let x = 0, z = 0, r = rooms[(u * 7) % rooms.length]!, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries += 1) {
        r = rooms[(u * 7 + tries * 3) % rooms.length]!;
        const cellsOk = r.cells.filter((c) => S.cells[c] !== CELL.WALL && !S.blocked[c]);
        const c = cellsOk[(u * 13 + tries * 5) % Math.max(1, cellsOk.length)];
        if (c === undefined) continue;
        x = (c % S.w + 0.5) * S.tile; z = (Math.floor(c / S.w) + 0.5) * S.tile;
        ok = free(x, z);
      }
      if (!ok) continue;
      mobs.push({ body: pop.units[u]!.body, look: u, x, z, yaw: (u * 1.3) % TAU, tx: x, tz: z, speed: 1 + (u % 5) * 0.12, dist: 0, gait: 0, t: 0, room: r.id, think: (u % 7) * 0.3, attackT: 0 });
      n += 1;
    }
    void n;
  }
  function stepMobs(dt: number) {
    for (const m of mobs) {
      m.think -= dt;
      const dh = Math.hypot(hero.x - m.x, hero.z - m.z);
      const cell = Math.floor(m.z / S.tile) * S.w + Math.floor(m.x / S.tile);
      const seen = !fogOn || fog.shown[cell]! > 200;
      if (dh < 7 && seen) { m.tx = hero.x; m.tz = hero.z; }
      else if (m.think <= 0) {
        m.think = 1.5 + ((m.look * 37) % 10) * 0.2;
        const r = S.rooms[m.room];
        if (r) { const c = r.cells[Math.floor(((m.t * 997 + m.look * 131) % 1) * r.cells.length)] ?? r.cells[0]!; m.tx = (c % S.w + 0.5) * S.tile + ((m.look % 3) - 1) * 0.4; m.tz = (Math.floor(c / S.w) + 0.5) * S.tile; }
      }
      m.t += dt;
      const dx = m.tx - m.x, dz = m.tz - m.z, d = Math.hypot(dx, dz);
      if (dh < 1.3) { m.gait = 2; m.attackT += dt; m.yaw = Math.atan2(hero.x - m.x, hero.z - m.z); continue; }
      m.attackT = 0;
      if (d < 0.2) { m.gait = 0; continue; }
      const sp = (dh < 7 ? 2.1 : m.speed) * dt;
      const nx = m.x + (dx / d) * sp, nz = m.z + (dz / d) * sp;
      if (free(nx, nz, 0.25)) { m.x = nx; m.z = nz; m.dist += sp; m.gait = 1; m.yaw = Math.atan2(dx, dz); }
      else if (free(nx, m.z, 0.25)) { m.x = nx; m.dist += sp; m.gait = 1; }
      else if (free(m.x, nz, 0.25)) { m.z = nz; m.dist += sp; m.gait = 1; }
      else { m.gait = 0; m.think = 0; }
    }
  }

  // ---------------------------------------------------------------- particles
  function startParticles() {
    try {
      pool = createParticlePool({ capacity: 12000, emitters: 1024, seed: 7, recipes: PRESETS });
      const air = S.theme.air.ambient;
      pool.define("motes", defineParticleRecipe({ mode: "continuous", shape: "area", area: [7, 1, 7], density: air === "dust" ? 0.1 : air === "spores" ? 0.12 : air === "embers" ? 0.035 : 0.09, speed: [0, 0.05], up: air === "drips" ? [0, 0] : [0.02, 0.12], velocity: air === "drips" ? [0, -5, 0] : [0.05, 0, 0.03], priority: 0, reach: 3, offset: [0, air === "drips" ? 3.2 : 0.8, 0],
        particle: { life: air === "drips" ? [0.5, 0.7] : [3, 6], size: [0.04, 0.07], light: air === "embers" ? [0.6, 1] : [0.5, 0.9], alpha: [0, 1, 1, 0], ramp: air === "embers" ? "ember" : air === "spores" ? "leaf" : air === "drips" ? "water" : "dust", drag: 0.4, gravity: air === "embers" ? -0.15 : air === "drips" ? 9 : 0.01, curl: 0.4, wind: 0.4, ...(air === "drips" ? { streak: 0.04 } : {}) } }));
      motes = pool.emit("motes", hero.x, 0, hero.z);
      pool.define("smoke", defineParticleRecipe({ mode: "continuous", rate: 4, shape: "disc", radius: 0.12, speed: [0.02, 0.08], up: [0.5, 0.8], priority: 1, budget: 14, reach: 4,
        particle: { life: [1.4, 2.2], size: [0.14, 0.26], sizeCurve: [0.6, 1, 1.5], light: [0.2, 0.36], alpha: [0.6, 0.45, 0.25, 0], ramp: "smoke", shade: 0.5, drag: 0.8, gravity: -0.2, wind: 0.6, curl: 0.3 } }));
      if (S.theme.air.fire) for (const L of S.lights) {
        if (L.kind === "brazier") { pool.emit("embers", L.x, L.y + 0.1, L.z); pool.emit("smoke", L.x, L.y + 0.5, L.z); }
        else if (L.kind === "torch" && (Math.floor(L.seed * 1000) % 3 === 0)) pool.emit("embers", L.x, L.y + 0.1, L.z);
      }
      for (const L of S.lights) { const k = Math.floor(L.z / S.tile) * S.w + Math.floor(L.x / S.tile); if (L.kind === "lava" && S.floor[k] === FLOOR.LAVA && (Math.floor(L.seed * 1000) % 2 === 0)) pool.emit("embers", L.x, 0.2, L.z); }
    } catch (e) { console.warn("particles:", e); pool = null; }
  }

  // ---------------------------------------------------------------- a frame
  let camera: [number, number] = [0, 0];
  const keys = new Set<string>();
  let time = 0;
  const inst = { data: new Float32Array(LIT_SPRITE_FLOATS * 4096), count: 0 };
  let propPack: { gen: number; count: number; data: Float32Array } | null = null;
  const visibleProps = new Uint8Array(4096).fill(1);
  const put = (i: number, x: number, y: number, z: number, r: Rect, look: number, flags = 0, fade = 0) => {
    const o = i * LIT_SPRITE_FLOATS, d = inst.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = r.x; d[o + 4] = r.y; d[o + 5] = r.w; d[o + 6] = r.h; d[o + 7] = r.ax; d[o + 8] = r.ay; d[o + 9] = r.page; d[o + 10] = look; d[o + 11] = flags; d[o + 12] = 1; d[o + 13] = fade;
  };
  function packProps(): number {
    if (propPack && propPack.gen === packGen) { inst.data.set(propPack.data.subarray(0, propPack.count * LIT_SPRITE_FLOATS)); return propPack.count; }
    let n = 0;
    S.props.forEach((p, i) => {
      if (!visibleProps[i]) return;
      let s = shapeList[propShape[i]!]!;
      if (opened.has(i)) s = shapeFor(p.id, { ...p.pins, state: "open" }, p.seed);
      const dir = s.dirs === 1 ? 0 : directionFor(p.yaw, CRAWL_YAW, 8);
      const r = rects.get(`${s.design.key}|still|0|${dir}`);
      if (!r) return;
      // (Hung on a wall the camera looks through -- one facing it, -x or -z of the room -- the cutaway takes it down with
      // the wall; what stands on the floor before it stays.)
      put(n, p.x, 0, p.z, r, propLook[i]!, (p.wall === 2 || p.wall === 3) && HANGS.has(p.id) ? 4 : 0);
      n += 1;
    });
    propPack = { gen: packGen, count: n, data: inst.data.slice(0, n * LIT_SPRITE_FLOATS) };
    return n;
  }
  const bodyFrame = (b: BodyShape, gait: number, dist: number, t: number, attackT: number): [string, number] => {
    const clip = gait === 1 ? "walk" : gait === 2 ? "attack" : "idle";
    const info = b.clip(clip);
    let u = gait === 1 && info.cycle > 0 ? dist / info.cycle : gait === 2 ? attackT / 0.62 : t / Math.max(0.1, info.period);
    u -= Math.floor(u);
    return [clip, Math.min(info.frames - 1, Math.floor(u * info.frames))];
  };
  // Contact shadows: under every character, and under the props that stand on the floor.
  const shadows = { data: new Float32Array(3 * 4096), count: 0 };
  let propShadows = { gen: -1, count: 0 };
  const SHADOW_R: Readonly<Record<string, number>> = { barrel: 0.42, crate: 0.5, urn: 0.32, chest: 0.6, table: 0.9, sarcophagus: 1.0, statue: 0.55, throne: 1.1, brazier: 0.45, cage: 0.6, anvil: 0.45, altar: 0.9, stalagmite: 0.45, crystals: 0.45, tombstone: 0.4, "weapon-rack": 0.6, bookshelf: 0.7 };
  function packShadows(): void {
    if (propShadows.gen !== packGen) {
      let n = 0;
      S.props.forEach((p, i) => { const r = SHADOW_R[p.id]; if (!r || !visibleProps[i]) return; shadows.data[n * 3] = p.x; shadows.data[n * 3 + 1] = p.z; shadows.data[n * 3 + 2] = r; n += 1; });
      propShadows = { gen: packGen, count: n };
    }
    let n = propShadows.count;
    const add = (x: number, z: number, r: number) => { if (n >= 4096) return; shadows.data[n * 3] = x; shadows.data[n * 3 + 1] = z; shadows.data[n * 3 + 2] = r; n += 1; };
    add(hero.x, hero.z, 0.42);
    for (const m of mobs) { const cell = Math.floor(m.z / S.tile) * S.w + Math.floor(m.x / S.tile); if (!fogOn || fog.shown[cell]! >= 200) add(m.x, m.z, pop && pop.bodies[m.body]!.spec.plan === "quadruped" ? 0.5 : 0.38); }
    shadows.count = n;
  }
  let heroSprite = -1;
  function packPeople(n: number): number {
    if (!pop) return n;
    const unit = (x: number, z: number, yaw: number, body: number, look: number, gait: number, dist: number, t: number, attackT: number, flags = 0) => {
      const b = pop!.bodies[body]!;
      const [clip, f] = bodyFrame(b, gait, dist, t, attackT);
      const dir = directionFor(yaw, CRAWL_YAW, 8);
      const pre = flags & 8 ? "hero|" : "";
      const r = rects.get(`${pre}${b.key}|${clip}|${f}|${dir}`) ?? rects.get(`${pre}${b.key}|idle|0|${dir}`);
      if (!r || n >= 4000) return;
      put(n, x, 0, z, r, unitLook[look]!, flags);
      n += 1;
    };
    heroSprite = n;
    unit(hero.x, hero.z, hero.yaw, pop.units[0]!.body, 0, hero.gait, hero.dist, time, hero.attackT, 8);
    for (const m of mobs) {
      const cell = Math.floor(m.z / S.tile) * S.w + Math.floor(m.x / S.tile);
      if (fogOn && fog.shown[cell]! < 200) continue;
      unit(m.x, m.z, m.yaw, m.body, m.look, m.gait, m.dist, m.t, m.attackT);
    }
    return n;
  }

  function stepHero(dt: number) {
    const a = viewAxesNow();
    let mx = 0, mz = 0;
    const upx = a.up[0], upz = a.up[2], ul = Math.hypot(upx, upz);
    if (keys.has("KeyW") || keys.has("ArrowUp")) { mx += upx / ul; mz += upz / ul; }
    if (keys.has("KeyS") || keys.has("ArrowDown")) { mx -= upx / ul; mz -= upz / ul; }
    if (keys.has("KeyD") || keys.has("ArrowRight")) { mx += a.right[0]; mz += a.right[2]; }
    if (keys.has("KeyA") || keys.has("ArrowLeft")) { mx -= a.right[0]; mz -= a.right[2]; }
    const speed = 3.4;
    if (mx || mz) path = [];
    else if (path.length) {
      const [px2, pz2] = path[0]!;
      const dx = px2 - hero.x, dz = pz2 - hero.z, d = Math.hypot(dx, dz);
      if (d < 0.12) path.shift(); else { mx = dx / d; mz = dz / d; }
    }
    const l = Math.hypot(mx, mz);
    if (l > 0) {
      mx /= l; mz /= l;
      const sx = mx * speed * dt, sz = mz * speed * dt;
      let moved = 0;
      if (free(hero.x + sx, hero.z + sz)) { hero.x += sx; hero.z += sz; moved = Math.hypot(sx, sz); }
      else if (free(hero.x + sx, hero.z)) { hero.x += sx; moved = Math.abs(sx); }
      else if (free(hero.x, hero.z + sz)) { hero.z += sz; moved = Math.abs(sz); }
      else if (path.length && !doorAhead(hero.x + mx * 0.8, hero.z + mz * 0.8)) {
        // (Stuck on a corner: find the way again from here, once a while.)
        stuck += dt;
        if (stuck > 0.25) { const goal = path[path.length - 1]!; const again = findPath(hero.x, hero.z, goal[0], goal[1]); if (again.length) path = again; stuck = 0; }
      }
      hero.yaw = Math.atan2(mx, mz);
      hero.dist += moved; hero.gait = moved > 0 ? 1 : 0;
    } else hero.gait = mobs.some((m) => Math.hypot(m.x - hero.x, m.z - hero.z) < 1.4) ? 2 : 0;
    if (hero.gait === 2) hero.attackT += dt; else hero.attackT = 0;
    // Doors open as he nears them (the boss's with the key); the key and chests as he reaches them.
    S.doors.forEach((d, i) => {
      const cx = (d.i + 0.5) * S.tile, cz = (d.j + 0.5) * S.tile;
      if (Math.hypot(cx - hero.x, cz - hero.z) < 3.2 && (!d.locked || hasKey)) doorTarget[i] = Math.PI * 0.5;
      doorAngle[i] = doorAngle[i]! + (doorTarget[i]! - doorAngle[i]!) * Math.min(1, dt * 5);
    });
    if (keyProp >= 0 && visibleProps[keyProp] && Math.hypot(S.props[keyProp]!.x - hero.x, S.props[keyProp]!.z - hero.z) < 1.1) {
      hasKey = true; visibleProps[keyProp] = 0; packGen += 1;
      const L = S.props[keyProp]!.light; if (L >= 0) R.moveLight(L, -100, 0, -100);
      pool?.emit("magic-swirl", hero.x, 1, hero.z);
    }
    S.props.forEach((p, i) => { if (p.openable && !opened.has(i) && Math.hypot(p.x - hero.x, p.z - hero.z) < 1.35) { opened.add(i); packGen += 1; pool?.emit("spark-shower", p.x, 0.6, p.z); } });
    // The stairs down: the next act.
    const cell = Math.floor(hero.z / S.tile) * S.w + Math.floor(hero.x / S.tile);
    if (S.floor[cell] === FLOOR.STAIRS_DOWN) { depth += 1; act = CRAWL_ACTS[(CRAWL_ACTS.indexOf(act) + 1) % CRAWL_ACTS.length]!; seed = `${seed}>`; build(); }
  }
  let lastCell = -1;
  function frame(dt: number) {
    time += dt;
    stepHero(dt);
    stepMobs(dt);
    // Smooth follow (critically damped toward the hero).
    const f = 1 - Math.exp(-dt * 7);
    camera = [camera[0] + (hero.x - camera[0]) * f, camera[1] + (hero.z - camera[1]) * f];
    const cell = Math.floor(hero.z / S.tile) * S.w + Math.floor(hero.x / S.tile);
    if (cell !== lastCell) { lastCell = cell; fog.look(hero.x, hero.z, closedAt); }
    if (fog.ease(dt) && fogOn) R.setFog(fog.shown);
    R.setHero(hero.x, hero.z);
    if (pool) { if (motes >= 0) pool.move(motes, hero.x, 0, hero.z); pool.step(Math.min(dt, 0.05)); }
  }
  let W = 480, H = 270;
  const viewAxesNow = () => viewOf().axes;
  function viewOf(): PixelView {
    const v0 = pixelView({ center: [camera[0], 0, camera[1]], yaw: CRAWL_YAW, pitch: CRAWL_PITCH, pixelsPerMetre: k, width: W, height: H });
    // (Snap the centre to whole pixels along the screen axes: nothing crawls as the camera glides.)
    const a = v0.axes;
    const gx = Math.round((camera[0] * a.right[0] + camera[1] * a.right[2]) * k) / k;
    const gy = Math.round((camera[0] * a.up[0] + camera[1] * a.up[2]) * k) / k;
    const fwd = camera[0] * a.forward[0] + camera[1] * a.forward[2];
    const c: [number, number, number] = [a.right[0] * gx + a.up[0] * gy + a.forward[0] * fwd, a.up[1] * gy + a.forward[1] * fwd, a.right[2] * gx + a.up[2] * gy + a.forward[2] * fwd];
    return pixelView({ center: c, yaw: CRAWL_YAW, pitch: CRAWL_PITCH, pixelsPerMetre: k, width: W, height: H });
  }
  let lastSprites = 0;
  function draw(width: number, height: number) {
    W = width; H = height;
    if (bakedK !== k) bakeAll();
    const v = viewOf();
    let n = packProps();
    n = packPeople(n);
    inst.count = n; lastSprites = n;
    packShadows();
    // (The x-ray only when walls may stand in front of him: in the stub cutaway none do, and a table's legs are no wall.)
    R.draw(v, { time, focus: [hero.x, hero.z], cutaway, fog: fogOn, lights: lightsOn, doors: doorAngle, sprites: inst, shadows, silhouette: cutaway === "stub" ? -1 : heroSprite, ring: [hero.x, hero.z] });
    if (parts && pool) { pool.setView(v); parts.draw(v, pool); }
  }

  // ---------------------------------------------------------------- input
  function key(code: string, down: boolean): boolean {
    if (down) keys.add(code); else { keys.delete(code); return false; }
    if (code === "KeyT") { algorithm = DUNGEON_ALGORITHMS[(DUNGEON_ALGORITHMS.indexOf(algorithm) + 1) % DUNGEON_ALGORITHMS.length]!; build(); return true; }
    if (code === "KeyN") { act = CRAWL_ACTS[(CRAWL_ACTS.indexOf(act) + 1) % CRAWL_ACTS.length]!; build(); return true; }
    if (code === "KeyG") { seed = `${seed}+`; pop = null; build(); return true; }
    if (code === "KeyX") { cutaway = cutaway === "stub" ? "dither" : cutaway === "dither" ? "off" : "stub"; return true; }
    if (code === "KeyL") { lightsOn = !lightsOn; return true; }
    if (code === "KeyF") { fogOn = !fogOn; R.setFog(fogOn ? fog.shown : null); return true; }
    if (code === "KeyR") { fog.revealAll(); R.setFog(fogOn ? fog.shown : null); return true; }
    return ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
  }
  function click(px2: number, py2: number) {
    const g = viewOf().ground(px2, py2);
    path = findPath(hero.x, hero.z, g[0], g[2]);
  }
  function zoom(step: number) { const i = CRAWL_LADDER.indexOf(k); k = CRAWL_LADDER[Math.max(0, Math.min(CRAWL_LADDER.length - 1, (i < 0 ? 1 : i) + step))]!; }

  build();
  const stats = () => ({
    act, algorithm, seed, depth, k, picture: `${W}x${H}`, genMs: +genMs.toFixed(0), bakeMs: +bakeMs.toFixed(0), baked: bakeCount, rooms: S.rooms.length, props: S.props.length, lights: S.lights.length,
    flames: scene.flames.length, quads: scene.count, mobs: mobs.length, sprites: lastSprites, particles: pool?.count ?? 0, cutaway, fog: fogOn, lightsOn, hasKey,
    seen: fog.counts.seen, kinds: [...new Set(S.rooms.map((r) => r.kind))].join(","), renderer: R.stats,
  });
  return {
    frame, draw, key, click, zoom, stats, build,
    get k() { return k; }, set k(v: number) { k = v; },
    get hero() { return hero; },
    /** Put the hero at (or the nearest clear spot to) a point. */
    setHero(x: number, z: number, yaw = hero.yaw) {
      let bx = x, bz = z;
      search: for (let r = 0; r <= 8; r += 1) for (let a = 0; a < Math.max(1, r * 6); a += 1) {
        const t = (a / Math.max(1, r * 6)) * TAU, px = x + Math.cos(t) * r * 0.25, pz = z + Math.sin(t) * r * 0.25;
        if (free(px, pz, 0.45)) { bx = px; bz = pz; break search; }
      }
      hero.x = bx; hero.z = bz; hero.yaw = yaw; camera = [bx, bz]; lastCell = -1;
    },
    setAct(a: string) { act = a; build(); }, setAlgo(a: DungeonAlgorithm) { algorithm = a; build(); }, setSeed(s: string) { seed = s; pop = null; build(); },
    setCutaway(c: "stub" | "dither" | "off") { cutaway = c; },
    /** Props a room (1: the act's own) and the floor's size in cells (a rebuild). */
    setDensity(d: number, w = size[0], h = size[1]) { density = d; size = [w, h]; build(); }, setFog(on: boolean) { fogOn = on; R.setFog(on ? fog.shown : null); }, setLights(on: boolean) { lightsOn = on; },
    reveal() { fog.revealAll(); R.setFog(fogOn ? fog.shown : null); },
    walkTo(x: number, z: number) { path = findPath(hero.x, hero.z, x, z); return path.length; },
    get path() { return path; },
    dressing: () => S, scene: () => scene,
    /** A room of a kind (its middle), for screenshots. */
    roomOf(kind: string, richest = false): [number, number] | null {
      const all = S.rooms.filter((q) => q.kind === kind);
      if (!all.length) return null;
      // (The richest: the room of that kind with the most props and lights in it.)
      const score = (q: (typeof all)[number]) => S.props.filter((p) => p.room === q.id).length + S.lights.filter((L) => S.roomOf[Math.floor(L.z / S.tile) * S.w + Math.floor(L.x / S.tile)] === q.id).length * 2;
      const r = richest ? all.reduce((a, b) => (score(b) > score(a) ? b : a)) : all[0]!;
      const c = r.cells[Math.floor(r.cells.length / 2)]!;
      return [(c % S.w + 0.5) * S.tile, (Math.floor(c / S.w) + 0.5) * S.tile];
    },
    time: (t: number) => { time = t; },
    get themes() { return Object.keys(CRAWL_THEMES); },
  };
}
export type Crawl = ReturnType<typeof createCrawl>;
