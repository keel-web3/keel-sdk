// The Level tab's preview frame: the level as the engine draws a world -- the
// ground baked per chunk into palette-true layers by the terrain's baker (the
// surface: corner-blended materials, dithered biome borders, decals, AO,
// torchlight), plants scattered by the biomes' rules and things from every
// content pack as indexed sprites that sway -- panned and zoomed, and for an
// infinite world streamed a chunk at a time. Tools turn pointer strokes into
// dabs, paths, rectangles and clicks the editor makes level ops of; overlays
// draw lock regions, spawns, resources, markers and each dungeon's room graph.
// It runs sandboxed (a keel-preview frame: scripts only, no network) and knows
// nothing of the project: it draws the snapshots the editor posts and answers
// only the editor window that holds it. Bundled by the level worker with the
// engine checkout's own source and packs.
import { createPixelRenderer } from '@keel-engine/render';
import { SWAY_INSTANCE_FLOATS, SwayInstances, createLookTable, createSpriteCache, createSpriteRenderer, packSway, paintRoles, pixelView, planBake, renderIndexedSprites } from '@keel-engine/bake';
import { createGroundBaker, createGroundRenderer, createTerrain, groundRectFor, groundSurface, importTileset, spritePosition, terrainTypes, tilesetPalette, tilesetStyle, viewAxes } from '@keel-engine/terrain';
import { createBiomeTable, createWorldBaker, createWorldStream, drawLayersFor, foliageProfile, reskin, scatterIn, seasonPaletteFor } from '@keel-engine/worldgen';
import { createRoll, deriveSeed, stream as rollStream } from '@keel-engine/core';
import { bakeDesignOf, lookFor, placeContent, shapeGrid } from '@keel-engine/object';

const PITCH = 0.6, YAW = 0;
const LADDER = [1, 2, 3, 4, 6, 8, 12, 16];
const B = 32; // (plant buckets: tiles a side)
const PLAYER = ['#f05050', '#5096ff', '#5adc78', '#fad246', '#c86ef0', '#50e6e6', '#fa963c', '#e6e6e6'];
const RESOURCE = { mass: '#4ee2ff', crystal: '#b58cff', flux: '#ff9c4a', fertile: '#7ddc6e', wreck: '#a0a4b0' };
const ROOM = { start: '#5adc78', key: '#fad246', boss: '#f05050', exit: '#4ee2ff', treasure: '#c86ef0', room: '#8a90a8', cave: '#8a90a8' };
const ALIASES = { tree: 'oak', house: 'cottage', barn: 'workshop', shrine: 'tower', hut: 'cottage', tuft: 'grass', boulder: 'rock' };
const now = () => performance.now();
const send = (message) => parent.postMessage(message, '*');
const disc = ([ci, cj], r) => { const out = []; const R = Math.ceil(r); for (let j = cj - R; j <= cj + R; j += 1) for (let i = ci - R; i <= ci + R; i += 1) if (Math.hypot(i - ci, j - cj) <= r + 0.001) out.push([i, j]); return out; };

export function start(PACKS) {
  const canvas = document.getElementById('view');
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const noteEl = document.getElementById('note');
  const o = overlay.getContext('2d');
  const S = {
    snap: null, finite: false, k: 4, center: [0, 0, 0], W: 64, H: 64, pixel: 2, season: 'summer', swap: '', style: 'pixel', plants: true,
    overlays: { locks: true, graph: true, markers: true, grid: false }, tool: { tool: 'pan', radius: 3 }, hover: null, drawing: null,
    frames: 0, drawn: 0, baked: 0, ready: false, error: null, applied: 0, lastSnap: '', tileset: null, stats: {},
  };
  globalThis.levelPreview = S;
  let sr, gl, ground;
  try {
    sr = createSpriteRenderer(canvas, { width: 64, height: 64, capacity: 1 << 16 });
    gl = sr.gl; ground = createGroundRenderer(gl);
  } catch (error) { S.error = `The preview needs WebGL2: ${error.message}`; noteEl.textContent = S.error; send({ type: 'ready', webgl: false }); return; }
  const table = createBiomeTable();
  const types = terrainTypes();

  // ---------------------------------------------------------------- the view
  function fit() {
    const w = Math.max(64, Math.ceil(innerWidth / S.pixel)), h = Math.max(48, Math.ceil(innerHeight / S.pixel));
    if (w !== S.W || h !== S.H) { S.W = w; S.H = h; sr.setTarget(w, h); }
    canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
    overlay.width = Math.round(innerWidth * devicePixelRatio); overlay.height = Math.round(innerHeight * devicePixelRatio);
    overlay.style.width = `${innerWidth}px`; overlay.style.height = `${innerHeight}px`;
    dirty = true;
  }
  const viewNow = () => {
    const a = viewAxes({ yaw: YAW, pitch: PITCH, pixelsPerMetre: S.k });
    const c = S.center, k = S.k;
    const gx = Math.round((c[0] * a.right[0] + c[2] * a.right[2]) * k) / k;
    const gy = Math.round((c[0] * a.up[0] + c[1] * a.up[1] + c[2] * a.up[2]) * k) / k;
    const f = c[0] * a.forward[0] + c[1] * a.forward[1] + c[2] * a.forward[2];
    const cc = [a.right[0] * gx + a.up[0] * gy + a.forward[0] * f, a.up[1] * gy + a.forward[1] * f, a.right[2] * gx + a.up[2] * gy + a.forward[2] * f];
    return pixelView({ center: cc, yaw: YAW, pitch: PITCH, pixelsPerMetre: k, width: S.W, height: S.H });
  };
  const sx = () => innerWidth / S.W, sy = () => innerHeight / S.H;
  const tileSize = () => S.snap?.tileSize ?? S.snap?.recipe?.tileSize ?? 2;
  const stepHeight = () => S.snap?.stepHeight ?? 1;
  /** The height (metres) of the ground at a world tile. */
  function heightAt(i, j) {
    if (terrain) return terrain.inside(i, j) ? terrain.height[terrain.index(i, j)] * terrain.stepHeight : 0;
    if (wb) { const s = wb.chunks.get(`${Math.floor(i / 32)},${Math.floor(j / 32)}`); if (s) { const L = s.layers; const k = (j - L.j0) * L.w + (i - L.i0); if (k >= 0 && k < L.w * L.d) return L.height[k] * stepHeight(); } }
    return 0;
  }
  /** The tile under a CSS point: the ray met at the ground's own height (three passes). */
  function pick(cssX, cssY) {
    const v = viewNow(), px = cssX / sx(), py = cssY / sy(), up1 = v.axes.up[1] * S.k, T = tileSize();
    let g = v.ground(px, py), h = 0;
    for (let n = 0; n < 4; n += 1) { const i = Math.floor(g[0] / T), j = Math.floor(g[2] / T); h = heightAt(i, j); g = v.ground(px, py + h * up1); }
    return { at: [Math.floor(g[0] / T), Math.floor(g[2] / T)], pos: [g[0], h, g[2]] };
  }
  /** Where a world point is on the page (CSS pixels). */
  const cssOf = (p, v = viewNow()) => { const q = v.project(p); return [q[0] * sx(), q[1] * sy()]; };
  const cssOfTile = (i, j) => { const T = tileSize(); return cssOf([(i + 0.5) * T, heightAt(i, j), (j + 0.5) * T]); };

  // ---------------------------------------------------------------- sprites: plants and things (baked indexed, painted by looks)
  const bakeCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(64, 64) : document.createElement('canvas');
  const px = createPixelRenderer(bakeCanvas, { width: 64, height: 64 });
  const cache = createSpriteCache();
  const species = new Map(), list = [];
  function speciesOf(packId, object, pins = {}) {
    const pack = PACKS.find((p) => p.id === packId);
    const id = pack?.get(object) ? object : ALIASES[object] && pack?.get(ALIASES[object]) ? ALIASES[object] : null;
    const key = `${packId}/${id ?? object}${Object.keys(pins ?? {}).length ? `|${JSON.stringify(pins)}` : ''}`;
    if (species.has(key)) return species.get(key);
    if (!pack || !id) { species.set(key, null); return null; }
    const def = pack.get(id), shapes = [];
    const count = id === 'grass' || id === 'flowers' || id === 'reeds' ? 5 : 4;
    for (let n = 0; n < count; n += 1) {
      try {
        const grid = shapeGrid(def, rollStream(createRoll(deriveSeed(key, n)), 0), { steps: 2 });
        const placed = placeContent(PACKS, { pack: packId, id, seed: `${key}#${n}`, style: 'pixel', pins: { ...grid, ...(pins ?? {}) } });
        const design = bakeDesignOf(placed.built);
        if (shapes.some((s) => s.design.key === design.key)) continue;
        shapes.push({ built: placed.built, design, height: design.height });
      } catch { /* (a pin the object can't take: that shape is skipped) */ }
    }
    if (!shapes.length) { species.set(key, null); return null; }
    shapes.sort((a, b) => a.height - b.height);
    const s = { index: list.length, key, pack, object: id, shapes, foliage: packId === 'packs/foliage' };
    list.push(s); species.set(key, s);
    return s;
  }
  let rects = new Map(), bakedAt = 0, bakedCount = -1, atlasGen = 0;
  const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  function ensureSprites() {
    const n = list.reduce((a, s) => a + s.shapes.length, 0);
    if (bakedAt === S.k && bakedCount === n) return;
    const designs = list.flatMap((s) => s.shapes.map((sh) => sh.design));
    if (!designs.length) return;
    const plan = planBake(designs, { directions: 1, pixelsPerMetre: S.k, pitch: PITCH, style: 'level.indexed' });
    const sources = new Map(designs.map((d) => [d.key, d]));
    const todo = cache.missing(plan.sprites);
    if (todo.length) cache.add(renderIndexedSprites(px, todo, sources).baked);
    const atlas = cache.atlas(plan.sprites.map((j) => j.key), { size: maxTex });
    rects = new Map();
    for (const j of plan.sprites) { const r = atlas.sprites.get(j.key); if (r) rects.set(j.design, { x: r.x, y: r.y, w: r.w, h: r.h, ax: r.ax, ay: r.ay, page: r.page, k: S.k }); }
    if (atlas.pages.length) sr.setPages(atlas.pages);
    bakedAt = S.k; bakedCount = n; atlasGen += 1;
  }
  let looks = null, looksUploaded = -1, lookGen = 0;
  function looksFor(season) {
    const lt = createLookTable({ rampLength: 5 });
    const memo = new Map();
    return {
      table: lt,
      lookOf(s, biome, variant) {
        const profileId = s.foliage ? foliageProfile(biome, season) : undefined;
        const key = `${s.index}|${profileId ?? '-'}|${variant}`;
        let at = memo.get(key);
        if (at !== undefined) return at;
        const def = s.pack.get(s.object);
        const profile = profileId ? s.pack.profile(profileId) : (def.look.profiles?.[0] ? s.pack.profile(def.look.profiles[0]) : undefined);
        at = lt.add(paintRoles(lookFor(s.shapes[0].built, `${s.key}~${variant}`, profile ? { profile } : {})));
        memo.set(key, at);
        return at;
      },
    };
  }
  looks = looksFor(S.season);
  function ensureLooks() { if (looksUploaded === looks.table.count) return; sr.setLooks({ palette: looks.table.palette(), paints: looks.table.paintTexture(), looks: looks.table.texture() }); looksUploaded = looks.table.count; }

  // ---------------------------------------------------------------- the ground (a finite level, or an infinite world's stream)
  let terrain = null, baker = null, biomeArr = null, lightArr = null, layersL = null, lit = false;
  let stream = null, wb = null;
  let palette = seasonPaletteFor(types, table, S.season);
  let tilesetTs = null;
  let dirty = true;
  const groundStyle = () => (S.style === 'voxel' ? { name: 'voxel', voxels: 4, outline: 2 } : { name: 'pixel', screen: 4, dither: 0.9, outline: 2 });
  function applyLook() {
    palette = seasonPaletteFor(types, table, S.season);
    let pal = palette, style = groundStyle();
    if (tilesetTs && terrain) { pal = tilesetPalette(palette, tilesetTs); style = tilesetStyle(tilesetTs, terrain); }
    ground.setPalette(pal);
    if (baker) { baker.palette = pal; baker.style = style; }
    if (wb) { wb.palette = pal; wb.style = groundStyle(); }
    dirty = true;
  }
  const thingsDrawn = { list: [], version: 0 };
  const buckets = new Map(), bucketVersion = new Map();
  let bucketGen = 0;

  function gunzip(b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  /** A snapshot in: new ground where the size changed; otherwise the changed tiles written (the baker rebakes just the chunks they reach). */
  async function applySnapshot(snap) {
    const t0 = now();
    if (snap.kind === 'infinite') { buildInfinite(snap); S.snap = snap; S.lastSnap = snap.key; S.applied += 1; return; }
    stream = null; wb = null;
    const buf = await gunzip(snap.tiles);
    const n = snap.w * snap.d;
    const height = new Int16Array(buf, 0, n), water = new Int16Array(buf, n * 2, n), deck = new Int16Array(buf, n * 4, n);
    let type = new Uint8Array(buf, n * 6, n);
    const flags = new Uint8Array(buf, n * 7, n), dir = new Uint8Array(buf, n * 8, n), biome = new Uint8Array(buf, n * 9, n), light = new Uint8Array(buf, n * 10, n);
    // (Types by name onto this engine's table: the same list, unless the snapshot came from another checkout.)
    if (snap.types.some((name, id) => types.list[id]?.name !== name)) { const map = snap.types.map((name) => (types.has(name) ? types.id(name) : 0)); type = type.map((v) => map[v] ?? 0); }
    const fresh = !terrain || terrain.width !== snap.w || terrain.depth !== snap.d || terrain.tileSize !== snap.tileSize || terrain.stepHeight !== snap.stepHeight;
    let changed = null;
    if (fresh) {
      terrain = createTerrain({ width: snap.w, depth: snap.d, tileSize: snap.tileSize, stepHeight: snap.stepHeight, chunk: snap.chunk, types });
      terrain.height.set(height); terrain.water.set(water); terrain.deck.set(deck); terrain.type.set(type); terrain.flags.set(flags); terrain.dir.set(dir);
      biomeArr = biome.slice(); lightArr = light.slice(); lit = snap.lit;
      baker = createGroundBaker({ terrain, palette, style: groundStyle(), surface: groundSurface({ biomes: table.surfaceBiomes(), biome: biomeArr, ...(lit ? { light: lightArr } : {}) }), prefetch: 1, seed: 1 });
      layersL = { i0: 0, j0: 0, w: snap.w, d: snap.d, height: terrain.height, type: terrain.type, water: terrain.water, flags: terrain.flags, dir: terrain.dir, biome: biomeArr, light: lightArr, under: new Uint8Array(n), ore: new Uint8Array(n), zone: new Uint8Array(n) };
      buckets.clear(); bucketVersion.clear(); bucketGen += 1;
      if (!S.snap || S.snap.kind !== 'finite' || S.snap.w !== snap.w || S.snap.d !== snap.d) S.center = [snap.w * snap.tileSize / 2, 0, snap.d * snap.tileSize / 2];
      applyLook();
    } else {
      // The changed rectangle: every layer compared.
      let i0 = Infinity, j0 = Infinity, i1 = -1, j1 = -1;
      const t = terrain;
      for (let k = 0; k < n; k += 1) {
        if (t.height[k] !== height[k] || t.type[k] !== type[k] || t.water[k] !== water[k] || t.flags[k] !== flags[k] || t.dir[k] !== dir[k] || t.deck[k] !== deck[k] || biomeArr[k] !== biome[k] || lightArr[k] !== light[k]) {
          const i = k % snap.w, j = (k - i) / snap.w;
          if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
        }
      }
      if (i1 >= 0) {
        const w = i1 - i0 + 1, d = j1 - j0 + 1;
        const sub = (arr, C) => { const out = new C(w * d); for (let j = 0; j < d; j += 1) out.set(arr.subarray((j0 + j) * snap.w + i0, (j0 + j) * snap.w + i0 + w), j * w); return out; };
        t.write({ i0, j0, w, d, height: sub(height, Int16Array), type: sub(type, Uint8Array), flags: sub(flags, Uint8Array), dir: sub(dir, Uint8Array), water: sub(water, Int16Array), deck: sub(deck, Int16Array) });
        biomeArr.set(biome); lightArr.set(light);
        if (snap.lit !== lit) { lit = snap.lit; baker.surface = groundSurface({ biomes: table.surfaceBiomes(), biome: biomeArr, ...(lit ? { light: lightArr } : {}) }); }
        changed = [i0, j0, i1 + 1, j1 + 1];
        touchBuckets(changed);
        if (tilesetTs) applyLook();
      }
    }
    S.snap = snap; S.finite = true; S.lastSnap = snap.key; S.applied += 1;
    if (S.swap) applySwap();
    buildThings(snap);
    S.stats.snapshotMs = Math.round(now() - t0); S.stats.changed = changed;
    dirty = true;
  }
  function touchBuckets(r) {
    for (let bz = Math.floor((r[1] - 4) / B); bz <= Math.floor((r[3] + 4) / B); bz += 1) for (let bx = Math.floor((r[0] - 4) / B); bx <= Math.floor((r[2] + 4) / B); bx += 1) bucketVersion.set(`${bx},${bz}`, (bucketVersion.get(`${bx},${bz}`) ?? 0) + 1);
  }
  /** Preview a biome swap: the whole map re-skinned (never saved; the next snapshot or clearing it puts the level back). */
  function applySwap() {
    if (!terrain || !S.swap || !table.has(S.swap)) return;
    reskin(layersL, table, types, S.swap, () => true, { seed: S.snap?.seed ?? 'swap', keepPaved: true });
    terrain.write(terrain.read(0, 0, terrain.width, terrain.depth));
    touchBuckets([0, 0, terrain.width, terrain.depth]);
    baker.refresh();
    dirty = true;
  }
  function buildInfinite(snap) {
    terrain = null; baker = null; layersL = null; S.finite = false;
    const same = S.snap?.kind === 'infinite' && JSON.stringify(S.snap.recipe) === JSON.stringify(snap.recipe);
    if (!same || !wb) {
      stream = createWorldStream(snap.recipe);
      wb = createWorldBaker({ stream, palette, style: groundStyle(), prefetch: 1 });
      buckets.clear(); bucketVersion.clear(); bucketGen += 1;
      if (S.snap?.kind !== 'infinite') S.center = [0, 0, 0];
      wb.painted = 0;
    }
    // (Biome paint the world hasn't had yet, in order: the overlay every chunk it reaches takes.)
    const edits = snap.edits ?? [];
    if (wb.painted > edits.length) { stream = createWorldStream(snap.recipe); wb = createWorldBaker({ stream, palette, style: groundStyle(), prefetch: 1 }); wb.painted = 0; buckets.clear(); }
    for (const op of edits.slice(wb.painted)) {
      const seen = new Map();
      for (const c of op.path ?? [op.at]) for (const t of disc(c, op.radius ?? 4)) seen.set(`${t[0]},${t[1]}`, t);
      const tiles = [...seen.values()];
      if (table.has(op.biome)) wb.paint(tiles, op.biome);
      const xs = tiles.map((t) => t[0]), zs = tiles.map((t) => t[1]);
      touchBuckets([Math.min(...xs), Math.min(...zs), Math.max(...xs) + 1, Math.max(...zs) + 1]);
    }
    wb.painted = edits.length;
    thingsDrawn.list = []; thingsDrawn.version += 1;
    applyLook();
  }
  function buildThings(snap) {
    const out = [];
    for (const th of snap.things ?? []) {
      const s = speciesOf(th.pack, th.object, th.layer === 'bridges' ? {} : th.pins);
      if (!s) continue;
      const n = s.shapes.length;
      const sc = th.scale >= 0.75 ? 1 : th.scale >= 0.42 ? 0.5 : 1 / 3;
      out.push({ s, shape: ((Math.floor(th.pos[0] * 7 + th.pos[2] * 13) % n) + n) % n, biome: 'plains', variant: 0, x: th.pos[0], y: th.pos[1], z: th.pos[2], sway: false, scale: sc, id: th.id });
    }
    thingsDrawn.list = out; thingsDrawn.version += 1;
  }
  const exclude = (i, j) => {
    const sn = S.snap;
    if (!sn || sn.kind !== 'finite') return false;
    for (const s of sn.spawns ?? []) if (Math.abs(s.at[0] - i) <= 4 && Math.abs(s.at[1] - j) <= 4) return true;
    for (const r of sn.resources ?? []) if (Math.abs(r.at[0] - i) <= 1 && Math.abs(r.at[1] - j) <= 1) return true;
    return false;
  };
  function bucket(bx, bz) {
    const key = `${bx},${bz}`, version = `${bucketGen}.${bucketVersion.get(key) ?? 0}`;
    const have = buckets.get(key);
    if (have && have.version === version) return have.drawn;
    let L;
    if (wb) L = stream.block(bx * B - 4, bz * B - 4, B + 8, B + 8);
    else L = layersL;
    const plants = scatterIn(L, [bx * B * tileSize(), bz * B * tileSize(), (bx + 1) * B * tileSize(), (bz + 1) * B * tileSize()], {
      seed: S.snap?.seed ?? 'level', table, types, tileSize: tileSize(), stepHeight: stepHeight(), density: 1, exclude,
      biomeOf: wb ? (i, j) => wb.biomeAt(i, j) : null,
    });
    const drawn = [];
    for (const p of plants) {
      const s = speciesOf(p.pack, p.object, p.pins ?? {});
      if (!s) continue;
      drawn.push({ s, shape: Math.min(s.shapes.length - 1, Math.floor(p.age * s.shapes.length)), biome: table.list[p.biome].id, variant: p.seed % 3, x: p.x, y: p.y, z: p.z, sway: true, scale: 1 });
    }
    buckets.set(key, { drawn, version });
    return drawn;
  }
  const layerOf = (object) => object === 'grass' ? 'grass' : object === 'flowers' ? 'flower' : object === 'rock' ? 'rock' : ['bush', 'reeds', 'cactus', 'mushroom', 'crystal'].includes(object) ? 'shrub' : ['log', 'stump'].includes(object) ? 'understory' : 'canopy';
  const inst = new SwayInstances(1 << 17);
  const packs = new WeakMap();
  function packOf(items, a, layers, key) {
    const have = packs.get(items);
    if (have && have.key === key) return have;
    const data = have && have.data.length >= items.length * SWAY_INSTANCE_FLOATS ? have.data : new Float32Array(Math.max(1, items.length) * SWAY_INSTANCE_FLOATS);
    const pos = [0, 0, 0];
    let n = 0;
    for (const d of items) {
      const sh = d.s.shapes[d.shape];
      if (d.s.foliage && d.sway && !layers.has(layerOf(d.s.object))) continue;
      const r = rects.get(sh.design.key);
      if (!r) continue;
      pos[0] = d.x; pos[1] = d.y; pos[2] = d.z;
      spritePosition(a, pos, pos);
      const q = n * SWAY_INSTANCE_FLOATS;
      data[q] = pos[0]; data[q + 1] = pos[1]; data[q + 2] = pos[2]; data[q + 3] = r.x; data[q + 4] = r.y; data[q + 5] = r.w; data[q + 6] = r.h; data[q + 7] = r.ax; data[q + 8] = r.ay; data[q + 9] = r.page;
      data[q + 10] = looks.lookOf(d.s, d.biome, d.variant); data[q + 11] = 0; data[q + 12] = (S.k / r.k) * d.scale; data[q + 13] = 0;
      data[q + 14] = d.sway && sh.built.sway ? packSway(sh.built.sway, r.ay * (S.k / r.k), S.k) : 0; data[q + 15] = 0;
      n += 1;
    }
    const out = { key, data, count: n };
    packs.set(items, out);
    return out;
  }
  function drawSprites(v, time) {
    const a = viewAxes(v);
    const [x0, z0, x1, z1] = groundRectFor(v, -4, 20);
    const T = tileSize();
    const lists = [];
    if (S.plants) {
      let budget = 3;
      for (let bz = Math.floor(z0 / (B * T)); bz <= Math.floor(z1 / (B * T)); bz += 1) for (let bx = Math.floor(x0 / (B * T)); bx <= Math.floor(x1 / (B * T)); bx += 1) {
        if (terrain && (bx < 0 || bz < 0 || bx * B >= terrain.width || bz * B >= terrain.depth)) continue;
        const key = `${bx},${bz}`;
        const ready = buckets.get(key)?.version === `${bucketGen}.${bucketVersion.get(key) ?? 0}`;
        if (!ready && budget-- <= 0) { dirty = true; continue; }
        lists.push(bucket(bx, bz));
      }
    }
    lists.push(thingsDrawn.list);
    ensureSprites();
    if (!rects.size) return;
    const layers = new Set(drawLayersFor(S.k));
    let n = 0;
    const key = `${S.k}|${lookGen}|${atlasGen}|${[...layers].join(',')}|${thingsDrawn.version}`;
    for (const items of lists) {
      const p = packOf(items, a, layers, key);
      if (n + p.count > inst.capacity) break;
      inst.data.set(p.data.subarray(0, p.count * SWAY_INSTANCE_FLOATS), n * SWAY_INSTANCE_FLOATS);
      n += p.count;
    }
    inst.count = n; S.drawn = n;
    ensureLooks();
    if (n) sr.drawSway(v, inst, { clear: null, screen: 4, dither: 0.9, outline: 1, time, wind: 0.6, speed: 3, gust: 0.6, benders: [] });
  }

  // ---------------------------------------------------------------- overlays
  function paintOverlay(v) {
    const k = devicePixelRatio;
    o.setTransform(k, 0, 0, k, 0, 0);
    o.clearRect(0, 0, innerWidth, innerHeight);
    const sn = S.snap;
    const T = tileSize();
    const tileQuad = (r) => [cssOfTile(r[0], r[1]), cssOfTile(r[2] - 1, r[1]), cssOfTile(r[2] - 1, r[3] - 1), cssOfTile(r[0], r[3] - 1)];
    const poly = (pts, stroke, fill, dash = []) => { o.beginPath(); pts.forEach((p, i) => (i ? o.lineTo(p[0], p[1]) : o.moveTo(p[0], p[1]))); o.closePath(); if (fill) { o.fillStyle = fill; o.fill(); } o.setLineDash(dash); o.strokeStyle = stroke; o.lineWidth = 1.5; o.stroke(); o.setLineDash([]); };
    const label = (x, y, text, colour = '#e8ebf7') => { o.font = '10px ui-monospace, Menlo, monospace'; o.fillStyle = '#000a'; o.fillText(text, x + 1, y + 1); o.fillStyle = colour; o.fillText(text, x, y); };
    if (sn?.kind === 'finite') {
      if (S.overlays.locks) for (const r of sn.regions ?? []) if (r.kind === 'lock') { const q = tileQuad(r.rect); poly(q, '#ffd36e', '#ffd36e14', [5, 4]); label(q[0][0] + 4, q[0][1] + 12, `LOCK ${r.id}`, '#ffd36e'); }
      if (S.overlays.graph) for (const d of sn.dungeons ?? []) {
        const centre = (r) => cssOfTile(r.x + (r.w >> 1), r.y + (r.h >> 1));
        for (const e of d.edges) { const a = centre(d.rooms[e.from]), b = centre(d.rooms[e.to]); if (!a || !b) continue; o.setLineDash(e.locked ? [4, 3] : []); o.strokeStyle = e.locked ? '#f05050' : '#ffffffb0'; o.lineWidth = 1.5; o.beginPath(); o.moveTo(a[0], a[1]); o.lineTo(b[0], b[1]); o.stroke(); o.setLineDash([]); }
        for (const r of d.rooms) { const c = centre(r); o.fillStyle = ROOM[r.kind] ?? '#8a90a8'; o.beginPath(); o.arc(c[0], c[1], r.kind === 'room' ? 3.5 : 6, 0, Math.PI * 2); o.fill(); if (r.kind !== 'room') label(c[0] + 8, c[1] + 4, r.kind.toUpperCase(), ROOM[r.kind]); }
        for (const [name, p] of [['START', d.start], ['KEY', d.key], ['BOSS', d.boss], ['EXIT', d.exit]]) if (p && !d.rooms.length) { const c = cssOfTile(p[0], p[1]); o.fillStyle = ROOM[name.toLowerCase()]; o.beginPath(); o.arc(c[0], c[1], 6, 0, Math.PI * 2); o.fill(); label(c[0] + 8, c[1] + 4, name, ROOM[name.toLowerCase()]); }
      }
      if (S.overlays.markers) {
        for (const r of sn.resources ?? []) { const c = cssOfTile(r.at[0], r.at[1]); o.fillStyle = RESOURCE[r.kind] ?? '#fff'; o.beginPath(); o.moveTo(c[0], c[1] - 5); o.lineTo(c[0] + 4, c[1]); o.lineTo(c[0], c[1] + 5); o.lineTo(c[0] - 4, c[1]); o.closePath(); o.fill(); o.strokeStyle = '#000a'; o.stroke(); }
        for (const s of sn.spawns ?? []) {
          const c = cssOfTile(s.at[0], s.at[1]), col = PLAYER[s.player % PLAYER.length];
          o.fillStyle = col; o.beginPath(); o.arc(c[0], c[1], 9, 0, Math.PI * 2); o.fill(); o.strokeStyle = '#000'; o.lineWidth = 2; o.stroke();
          o.font = 'bold 11px ui-monospace, Menlo, monospace'; o.fillStyle = '#000'; o.textAlign = 'center'; o.fillText(String(s.player + 1), c[0], c[1] + 4); o.textAlign = 'left';
          if (s.natural) { const n = cssOfTile(s.natural[0], s.natural[1]); o.strokeStyle = col; o.lineWidth = 2; o.beginPath(); o.arc(n[0], n[1], 7, 0, Math.PI * 2); o.stroke(); }
        }
        for (const m of sn.markers ?? []) {
          if (m.kind === 'door' || m.kind === 'light') continue;
          const c = cssOf(m.pos);
          const col = ROOM[m.kind] ?? (m.kind === 'entrance' ? '#c86ef0' : '#e8ebf7');
          o.fillStyle = col; o.fillRect(c[0] - 3, c[1] - 3, 6, 6);
          if (S.k >= 3 || ['start', 'exit', 'boss', 'key', 'entrance'].includes(m.kind)) label(c[0] + 6, c[1] + 3, m.kind, col);
        }
      }
    }
    // The tool: the brush under the cursor, a path or rectangle being drawn.
    const tool = S.tool.tool;
    if (S.hover && tool !== 'pan') {
      const r = S.tool.radius ?? 0;
      if (['raise', 'lower', 'flatten', 'material', 'biome'].includes(tool)) {
        const pts = [];
        for (let n = 0; n < 32; n += 1) { const a = n / 32 * Math.PI * 2; const i = S.hover.at[0] + 0.5 + Math.cos(a) * (r + 0.5), j = S.hover.at[1] + 0.5 + Math.sin(a) * (r + 0.5); pts.push(cssOf([i * T, heightAt(Math.floor(i), Math.floor(j)), j * T])); }
        poly(pts, '#4ee2ff', '#4ee2ff18');
      } else { const q = tileQuad([S.hover.at[0], S.hover.at[1], S.hover.at[0] + 1, S.hover.at[1] + 1]); poly(q, '#4ee2ff', '#4ee2ff30'); }
    }
    if (S.drawing?.tiles?.length) { o.strokeStyle = S.tool.tool === 'river' ? '#5096ff' : '#e0c080'; o.lineWidth = 3; o.beginPath(); S.drawing.tiles.forEach((t, n) => { const c = cssOfTile(t[0], t[1]); if (n) o.lineTo(c[0], c[1]); else o.moveTo(c[0], c[1]); }); o.stroke(); }
    if (S.drawing?.rect) poly(tileQuad(S.drawing.rect), '#ffd36e', '#ffd36e22', [5, 4]);
  }

  // ---------------------------------------------------------------- a frame
  let t0 = now(), lastDraw = 0;
  function draw(time = (now() - t0) / 1000) {
    const v = viewNow();
    let layers = [];
    if (wb) { wb.plan(v); layers = wb.layers(); } else if (baker) { baker.plan(v); layers = baker.layers(); }
    ground.draw(v, layers, { time, clear: [0.045, 0.05, 0.075] });
    if (terrain || wb) drawSprites(v, time);
    paintOverlay(v);
    S.frames += 1;
    return v;
  }
  function frame() {
    const f0 = now();
    try {
      if (dirty || f0 - lastDraw > 90) { dirty = false; draw(); lastDraw = f0; }
      const budget = document.hidden ? 40 : 12;
      const done = wb ? wb.bake(budget) : baker ? baker.bake(budget) : 0;
      if (done) { S.baked += done; dirty = true; }
      S.ready = !!(wb ? wb.ready : baker?.ready) && !!rects.size;
      if (f0 - statusAt > 200) status();
    } catch (error) { S.error = String(error?.stack ?? error); noteEl.textContent = `Preview error: ${error.message}`; }
    // (A timer, not requestAnimationFrame: a hidden pane stops rAF and the level still has to draw.)
    setTimeout(frame, dirty ? 0 : 33);
  }
  let statusAt = 0;
  function status() {
    statusAt = now();
    const g = wb ? wb.stats : baker?.stats;
    const h = S.hover;
    const hereType = h && terrain?.inside(h.at[0], h.at[1]) ? types.get(terrain.type[terrain.index(h.at[0], h.at[1])]).name : '';
    const hereBiome = h && terrain?.inside(h.at[0], h.at[1]) ? table.list[biomeArr[terrain.index(h.at[0], h.at[1])]]?.id : h && wb ? table.list[wb.biomeAt(h.at[0], h.at[1])]?.id : '';
    statusEl.textContent = `${S.finite ? `${terrain?.width} x ${terrain?.depth}` : wb ? 'infinite world' : 'no level'} · ${S.k} px/m · ${S.drawn} sprites · ${g ? `${g.baked} chunks baked${g.queued ? ` (${g.queued} queued)` : ''}` : ''}${h ? ` · tile ${h.at[0]},${h.at[1]} h${Math.round(heightAt(h.at[0], h.at[1]) / stepHeight())} ${hereType} ${hereBiome ?? ''}` : ''}`;
    S.stats = { ...S.stats, ground: g ? { baked: g.baked, queued: g.queued } : null, sprites: S.drawn, species: list.length };
  }

  // ---------------------------------------------------------------- input: pan, zoom, and the tools' strokes
  let down = null, strokeN = 0;
  const DAB = ['raise', 'lower', 'flatten', 'material', 'biome'];
  const PATH = ['road', 'river'];
  const RECT = ['lock', 'drain'];
  const cssPoint = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* A synthetic pointer has nothing to capture. */ }
    const [x, y] = cssPoint(e);
    const p = pick(x, y);
    const panning = e.button !== 0 || S.tool.tool === 'pan' || e.altKey;
    down = { x, y, center: S.center.slice(), panning, moved: false, start: p, last: p.at, stroke: `s${Date.now().toString(36)}${(strokeN += 1)}` };
    if (panning) return;
    const tool = S.tool.tool;
    if (DAB.includes(tool)) send({ type: 'dab', tool, at: p.at, stroke: down.stroke });
    else if (PATH.includes(tool)) S.drawing = { tiles: [p.at] };
    else if (RECT.includes(tool)) S.drawing = { rect: [p.at[0], p.at[1], p.at[0] + 1, p.at[1] + 1] };
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = cssPoint(e);
    const p = pick(x, y);
    const moved = !S.hover || S.hover.at[0] !== p.at[0] || S.hover.at[1] !== p.at[1];
    S.hover = p;
    if (moved) { dirty = true; if (now() - hoverAt > 90) { hoverAt = now(); send({ type: 'hover', at: p.at }); } }
    if (!down) return;
    if (Math.hypot(x - down.x, y - down.y) > 3) down.moved = true;
    if (down.panning) {
      const v = viewNow(), g0 = v.ground(down.x / sx(), down.y / sy()), g1 = v.ground(x / sx(), y / sy());
      S.center = [down.center[0] + g0[0] - g1[0], 0, down.center[2] + g0[2] - g1[2]];
      // (The view moved: re-anchor so the next move is relative to where the ground is now.)
      down.x = x; down.y = y; down.center = S.center.slice();
      dirty = true; return;
    }
    const tool = S.tool.tool;
    if (DAB.includes(tool)) {
      const gap = Math.max(1, (S.tool.radius ?? 1) * 0.6);
      if (Math.hypot(p.at[0] - down.last[0], p.at[1] - down.last[1]) >= gap) { down.last = p.at; send({ type: 'dab', tool, at: p.at, stroke: down.stroke }); }
    } else if (PATH.includes(tool) && S.drawing?.tiles) {
      const last = S.drawing.tiles[S.drawing.tiles.length - 1];
      if (last[0] !== p.at[0] || last[1] !== p.at[1]) S.drawing.tiles.push(p.at);
    } else if (RECT.includes(tool) && S.drawing?.rect) {
      const a = down.start.at;
      S.drawing.rect = [Math.min(a[0], p.at[0]), Math.min(a[1], p.at[1]), Math.max(a[0], p.at[0]) + 1, Math.max(a[1], p.at[1]) + 1];
    }
  });
  let hoverAt = 0;
  canvas.addEventListener('pointerup', (e) => {
    const was = down; down = null;
    if (!was || was.panning) return;
    const [x, y] = cssPoint(e);
    const p = pick(x, y);
    const tool = S.tool.tool;
    if (PATH.includes(tool) && S.drawing?.tiles) { if (S.drawing.tiles.length >= 2) send({ type: 'path', tool, tiles: S.drawing.tiles, stroke: was.stroke }); S.drawing = null; }
    else if (RECT.includes(tool) && S.drawing?.rect) { send({ type: 'rect', tool, rect: S.drawing.rect, stroke: was.stroke }); S.drawing = null; }
    else if (!DAB.includes(tool)) send({ type: 'click', tool, at: p.at, pos: p.pos, hit: hitAt(p.at), stroke: was.stroke });
    dirty = true;
  });
  canvas.addEventListener('pointerleave', () => { if (!down) { S.hover = null; dirty = true; } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let wheel = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheel += e.deltaY;
    if (Math.abs(wheel) < 40) return;
    const step = wheel > 0 ? -1 : 1; wheel = 0;
    setScale(LADDER[Math.max(0, Math.min(LADDER.length - 1, LADDER.indexOf(S.k) + step))], cssPoint(e));
  }, { passive: false });
  function setScale(next, at = [innerWidth / 2, innerHeight / 2]) {
    if (!LADDER.includes(next) || next === S.k) return;
    const before = viewNow().ground(at[0] / sx(), at[1] / sy());
    S.k = next;
    const after = viewNow().ground(at[0] / sx(), at[1] / sy());
    S.center = [S.center[0] + before[0] - after[0], 0, S.center[2] + before[2] - after[2]];
    dirty = true;
  }
  /** The nearest thing, spawn, resource, marker or lock region at a tile (what the erase tool takes away). */
  function hitAt([i, j]) {
    const sn = S.snap;
    if (!sn || sn.kind !== 'finite') return null;
    const T = sn.tileSize;
    let best = null, bd = 2.2;
    const consider = (id, kind, ti, tj) => { const d = Math.hypot(ti - i, tj - j); if (d < bd) { bd = d; best = { id, kind }; } };
    for (const th of sn.things ?? []) consider(th.id, 'thing', Math.floor(th.pos[0] / T), Math.floor(th.pos[2] / T));
    for (const s of sn.spawns ?? []) consider(s.id, 'spawn', s.at[0], s.at[1]);
    for (const r of sn.resources ?? []) consider(r.id, 'resource', r.at[0], r.at[1]);
    for (const m of sn.markers ?? []) if (!['door', 'light'].includes(m.kind)) consider(m.id, 'marker', Math.floor(m.pos[0] / T), Math.floor(m.pos[2] / T));
    if (!best) for (const r of sn.regions ?? []) if (r.kind === 'lock' && i >= r.rect[0] && j >= r.rect[1] && i < r.rect[2] && j < r.rect[3]) return { id: r.id, kind: 'lock' };
    return best;
  }
  addEventListener('resize', fit);
  addEventListener('keydown', (e) => {
    const step = (40 / S.k) * (e.shiftKey ? 4 : 1);
    if (e.key === 'ArrowLeft') S.center[0] -= step; else if (e.key === 'ArrowRight') S.center[0] += step; else if (e.key === 'ArrowUp') S.center[2] -= step; else if (e.key === 'ArrowDown') S.center[2] += step;
    else if (e.key === '+' || e.key === '=') setScale(LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(S.k) + 1)]); else if (e.key === '-') setScale(LADDER[Math.max(0, LADDER.indexOf(S.k) - 1)]);
    else return;
    dirty = true;
  });

  // ---------------------------------------------------------------- messages from the editor
  function fitView() {
    if (terrain) {
      const T = terrain.tileSize, wm = terrain.width * T, dm = terrain.depth * T;
      S.center = [wm / 2, 0, dm / 2];
      const k = Math.min(S.W / (wm * 1.04), S.H / (dm * Math.sin(PITCH) * 1.1 + 8));
      S.k = LADDER.filter((x) => x <= Math.max(1, k)).pop() ?? 1;
    } else { S.center = [0, 0, 0]; S.k = 3; }
    dirty = true;
  }
  let queue = Promise.resolve();
  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'snapshot' && m.snap) {
      // (Snapshots apply in order: each waits for the one before it to land.)
      queue = queue.then(() => applySnapshot(m.snap)).then(() => { if (m.fit) fitView(); send({ type: 'applied', key: m.snap.key }); }).catch((error) => { S.error = String(error?.message ?? error); send({ type: 'error', message: S.error }); });
      return;
    }
    try {
      if (m.type === 'view') {
        const before = { season: S.season, swap: S.swap, style: S.style };
        for (const key of ['season', 'swap', 'style', 'plants', 'pixel']) if (m[key] !== undefined) S[key] = m[key];
        if (m.overlays) S.overlays = { ...S.overlays, ...m.overlays };
        if (m.pixel) fit();
        if (before.season !== S.season) { looks = looksFor(S.season); looksUploaded = -1; lookGen += 1; }
        if (before.season !== S.season || before.style !== S.style) applyLook();
        if (before.swap !== S.swap) { if (S.swap) applySwap(); else if (S.snap) { const sn = S.snap; S.snap = null; queue = queue.then(() => applySnapshot(sn)); } }
        dirty = true;
      } else if (m.type === 'tool') { S.tool = { ...S.tool, ...m }; delete S.tool.type; canvas.style.cursor = S.tool.tool === 'pan' ? 'grab' : 'crosshair'; dirty = true; }
      else if (m.type === 'camera') { if (m.fit) fitView(); if (m.k) setScale(m.k); if (m.center) { S.center = [m.center[0], 0, m.center[1]]; dirty = true; } }
      else if (m.type === 'tileset') {
        if (!m.tileset) tilesetTs = null;
        else { const bin = atob(m.tileset.rgba.replaceAll('-', '+').replaceAll('_', '/')); const rgba = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) rgba[i] = bin.charCodeAt(i); tilesetTs = m.apply === false ? null : importTileset({ width: m.tileset.width, height: m.tileset.height, rgba }, m.tileset.rules); }
        applyLook();
        send({ type: 'tileset', id: m.id, applied: !!tilesetTs, materials: tilesetTs?.materials ?? [] });
      } else if (m.type === 'shot') { draw(); send({ type: 'shot', id: m.id, url: canvas.toDataURL('image/png') }); }
      else if (m.type === 'tile-css') send({ type: 'tile-css', id: m.id, css: cssOfTile(m.at[0], m.at[1]) });
    } catch (error) { send({ type: 'error', id: m.id, message: String(error?.message ?? error) }); }
  });
  S.cssOfTile = cssOfTile; S.pick = pick; S.setScale = setScale; S.fitView = fitView;
  fit(); applyLook();
  setTimeout(frame, 0);
  send({ type: 'ready', webgl: true, packs: PACKS.map((p) => p.id) });
}
