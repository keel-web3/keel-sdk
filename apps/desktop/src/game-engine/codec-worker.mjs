// The codec inspector, off the editor's main thread: a registry holding the
// engine's schemas (codec's own, the hybrid population, the level document,
// the builder's op lists and asset data) and every schema a workspace module's
// manifest declares (contents.schemas, bytes embedded), and explainBits over
// any document -- the tree, the bit spans the hex view paints, what's big, the
// JSON view (editable: fromJSON + encode gives canonical bytes back, or the
// field path of what's wrong), and the Solidity decoder for fixed layouts.
// Node runs the engine's TypeScript directly, like the game engine's worker;
// only trusted main-process requests arrive here. Nothing here writes a file.
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = workerData.root;
const src = (name) => join(root, 'packages', name, 'src', 'index.ts');
const JSON_EDIT_LIMIT = 500_000;
const SCHEMA_TREE_LIMIT = 400_000;
const VALUE_TEXT = 160;
const PER_PARENT = 400;

let loaded;
/** The codec (required) and the packages whose schemas it registers (each optional: a missing one is a problem, not a failure). */
async function engine() {
  if (loaded) return loaded;
  const codec = await import(pathToFileURL(src('codec')).href);
  const optional = async (name) => { try { return existsSync(src(name)) ? await import(pathToFileURL(src(name)).href) : null; } catch (error) { problems.push({ module: `keel/${name}`, id: '', detail: `Could not load @keel-engine/${name}: ${String(error?.message ?? error).slice(0, 300)}` }); return null; } };
  const [builder, level, audio, keel, worldgen] = await Promise.all(['builder', 'level', 'audio', 'keel', 'worldgen'].map(optional));
  const registry = codec.createRegistry();
  const sources = new Map();
  const add = (schema, source, alias) => {
    try { const id = registry.register(schema, alias); if (!sources.has(id)) sources.set(id, source); return id; } catch (error) { problems.push({ module: source, id: alias ?? '', detail: String(error?.message ?? error) }); return null; }
  };
  codec.registerEngineSchemas(registry);
  for (const entry of registry.list()) sources.set(entry.id, 'engine');
  // (The hybrid population record isn't in every checkout's ENGINE_SCHEMAS: registered by hand, a no-op when it is.)
  if (codec.HYBRID_POPULATION) add(codec.HYBRID_POPULATION, 'engine');
  if (level?.LEVEL) add(level.LEVEL, 'keel/level');
  // (World generation's records -- recipes, biome tables, tileset rules, room templates: what a level file carries next to its LEVEL.)
  for (const schema of [worldgen?.WORLD_RECIPE, worldgen?.BIOME_TABLE, worldgen?.TILESET_RULES, worldgen?.ROOM_TEMPLATES_SCHEMA]) if (schema) add(schema, 'keel/worldgen');
  // (The builder's stored forms: op lists made from its own OPS table, and asset data as a dyn -- docs aren't hashed.)
  if (builder?.OPS) add(codec.opListSchema(builder.OPS), 'keel/builder');
  add(codec.named('keel/builder/data', codec.dyn()), 'keel/builder');
  // (Every workspace module's manifest, as the KEEL build lists them: src/schemas.ts exports, bytes embedded.)
  const modules = [];
  const pending = [];
  if (keel?.readWorkspace) {
    try {
      const workspace = await keel.readWorkspace(root, { projects: workerData.projects ?? [] });
      for (const mod of workspace) {
        const entries = mod.manifest.contents?.schemas ?? [];
        if (!entries.length) continue;
        const ids = [];
        for (const entry of entries) {
          if (entry.schema === undefined) { if (!registry.has(entry.id)) pending.push({ module: mod.manifest.id, id: entry.id }); continue; }
          try {
            const [id] = codec.registerEntries([entry], registry);
            if (!sources.has(id)) sources.set(id, mod.manifest.id);
            ids.push(entry.id);
          } catch (error) { problems.push({ module: mod.manifest.id, id: entry.id, detail: String(error?.message ?? error) }); }
        }
        modules.push({ id: mod.manifest.id, version: mod.manifest.version, schemas: ids });
      }
    } catch (error) { problems.push({ module: 'workspace', id: '', detail: `The workspace's manifests could not be read: ${String(error?.message ?? error).slice(0, 400)}` }); }
  }
  loaded = { codec, builder, level, audio, registry, sources, modules, pending, carried: new Map() };
  return loaded;
}
const problems = [];

/** A schema by id, short id, "name@version" or bare name (its newest version), from the registry or a document that carried it. */
function lookup(e, key) {
  const k = String(key ?? '').trim();
  if (!k) return null;
  const hit = e.registry.get(k) ?? e.carried.get(k);
  if (hit) return hit;
  const named = e.registry.list().filter((item) => item.name === k).sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  return named[0] ?? null;
}
function remember(e, schema) {
  const id = e.codec.schemaId(schema);
  const named = e.codec.schemaName(schema);
  const entry = { id, short: id.slice(0, 8), schema, name: named?.name ?? null, version: named?.version ?? null, aliases: [] };
  for (const k of [id, entry.short, ...(named ? [`${named.name}@${named.version}`] : [])]) e.carried.set(k, entry);
  // (A bounded memory of carried schemas: the editor re-encodes and asks for Solidity by id.)
  while (e.carried.size > 192) e.carried.delete(e.carried.keys().next().value);
  return entry;
}
const describe = (e, entry) => ({ id: entry.id, short: entry.short, name: entry.name, version: entry.version, source: e.sources.get(entry.id) ?? 'document', aliases: [...(entry.aliases ?? [])] });

async function schemas() {
  const e = await engine();
  const list = e.registry.list().map((entry) => describe(e, entry)).sort((a, b) => (a.source === b.source ? 0 : a.source === 'engine' ? -1 : b.source === 'engine' ? 1 : a.source.localeCompare(b.source)) || String(a.name).localeCompare(String(b.name)) || (a.version ?? 0) - (b.version ?? 0));
  return { schemas: list, modules: e.modules, problems: [...problems], pending: e.pending };
}

// ---------------------------------------------------------------- explain

const clip = (text, n = VALUE_TEXT) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
function valueText(value) {
  if (value === undefined) return undefined;
  let text;
  try { text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v)); } catch { text = String(value); }
  return clip(text ?? 'undefined');
}
/** A BitNode without its value's bulk. */
const slim = (n) => ({ label: n.label, path: n.path, kind: n.kind, type: n.type, role: n.role, bit: n.bit, bits: n.bits, ...(n.value !== undefined ? { value: valueText(n.value) } : {}), ...(n.note ? { note: n.note } : {}) });

/** The tree, breadth first so the top levels are always whole, at most maxNodes nodes ("… N more" markers stand for the rest). */
function compact(rootNode, maxNodes) {
  let used = 1;
  const top = slim(rootNode);
  const queue = [[rootNode, top]];
  while (queue.length) {
    const [from, to] = queue.shift();
    const kids = from.children ?? [];
    if (!kids.length) continue;
    const avail = maxNodes - used;
    // (No room left even for a marker: the node says how many parts aren't listed.)
    if (avail <= 0) { to.note = `${to.note ? `${to.note} · ` : ''}${kids.length.toLocaleString()} parts not listed`; to.more = kids.length; continue; }
    const keep = kids.length <= Math.min(avail, PER_PARENT) ? kids.length : Math.max(0, Math.min(PER_PARENT, avail - 1));
    to.children = [];
    for (let i = 0; i < keep; i++) { const c = slim(kids[i]); to.children.push(c); used++; queue.push([kids[i], c]); }
    if (keep < kids.length) {
      let start = Infinity, end = -Infinity;
      for (let i = keep; i < kids.length; i++) { start = Math.min(start, kids[i].bit); end = Math.max(end, kids[i].bit + kids[i].bits); }
      const rest = kids.length - keep;
      to.children.push({ label: `… ${rest.toLocaleString()} more`, path: `${from.path}#more`, kind: 'more', type: `${rest} nodes not listed`, role: 'container', bit: start, bits: end - start, more: rest });
      used++;
    }
  }
  return { tree: top, nodes: used };
}

function headerOf(bytes, e) {
  try { return e.codec.readHeader(bytes); } catch (error) { throw new Error(`The header can't be read: ${error.message}`); }
}

function jsonReplacer(_key, value) {
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'bigint') return `0x${value.toString(16)}`;
  return value;
}

/** Take a document apart for the inspector (see the top of this file). */
async function explain({ bytes, schema: key, maxNodes = 4000, maxHexBytes = 4096 }) {
  const e = await engine();
  const { codec } = e;
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!buf.length) throw new Error('There are no bytes to read.');
  const h = headerOf(buf, e);
  let entry = null, resolved;
  if (key) {
    entry = lookup(e, key);
    if (!entry) throw new Error(`No schema ${key} in the registry. Pick one from the registered schemas (an id, short id or name@version).`);
    resolved = { from: 'given', source: e.sources.get(entry.id) ?? 'document' };
  }
  if (h.mode === 'none' && !entry) throw new Error('This data has no codec header (0xB1 or 0xB2 first): it is a bare body, so say which schema it is.');
  if (!entry && h.mode === 'self') { entry = remember(e, h.schema); resolved = { from: 'document', source: e.sources.get(entry.id) ?? 'document' }; }
  if (!entry && h.mode === 'id') {
    entry = lookup(e, h.id);
    if (!entry) throw new Error(`Schema ${h.id} isn't in the registry (the engine's schemas and every workspace module's manifest). Its pack may not be installed, or the document came from a newer engine.`);
    resolved = { from: 'registry', source: e.sources.get(entry.id) ?? 'document' };
  }
  const x = codec.explainBits(buf, { schema: entry.schema, registry: e.registry, raw: h.mode === 'none' });
  // (explainBits reads what it can; decoding checks the rest: canonical, nothing trailing.)
  let check = null;
  try { if (h.mode === 'none') codec.decodeRaw(entry.schema, buf); else codec.decode(entry.schema, buf, { registry: e.registry }); } catch (error) { check = String(error?.message ?? error); }
  const { tree, nodes } = compact(x.root, Math.max(16, Math.min(20000, maxNodes)));
  const hexBytes = Math.max(0, Math.min(buf.length, maxHexBytes));
  const spans = [];
  for (const s of x.spans) { if (s.bit >= hexBytes * 8) break; spans.push({ bit: s.bit, bits: s.bits, role: s.role, path: s.path }); }
  let json = null, jsonText = '', jsonTooLarge = false;
  try { json = codec.toJSON(entry.schema, x.value); jsonText = JSON.stringify(json); } catch (error) { check ??= `The JSON view failed: ${error.message}`; }
  const gz = (b) => gzipSync(b, { level: 9 }).byteLength;
  const jsonBytes = Buffer.byteLength(jsonText, 'utf8');
  const sizes = { bytes: buf.length, gzip: gz(buf), json: jsonBytes, jsonGz: jsonBytes ? gz(Buffer.from(jsonText, 'utf8')) : 0 };
  let edit = null;
  if (json !== null) {
    const pretty = JSON.stringify(json, null, 2);
    if (pretty.length > JSON_EDIT_LIMIT) jsonTooLarge = true; else edit = pretty;
  }
  let schemaTree = null, schemaTreeTooLarge = false;
  try { const text = JSON.stringify(codec.toRecord(entry.schema), jsonReplacer); if (text.length > SCHEMA_TREE_LIMIT) schemaTreeTooLarge = true; else schemaTree = JSON.parse(text); } catch { /* A schema that can't be written as data has no tree view. */ }
  let solidity;
  try { codec.solidityDecoder(entry.schema); solidity = { available: true }; } catch (error) { solidity = { available: false, reason: String(error?.message ?? error) }; }
  return {
    schema: { ...describe(e, entry), resolved: resolved.from },
    header: { mode: h.mode, id: h.id, bytes: h.bodyByte },
    bytes: x.bytes, totalBits: x.totalBits, textBit: x.textBit,
    tree, nodes, headerNode: x.header ? slim(x.header) : null, padding: x.padding ? slim(x.padding) : null,
    spans, spansTotal: x.spans.length, spansTruncated: spans.length < x.spans.length,
    costs: codec.costs(x).slice(0, 24),
    json: edit, jsonTooLarge, sizes, schemaTree, schemaTreeTooLarge,
    hex: Buffer.from(buf.subarray(0, hexBytes)).toString('base64'), hexBytes, hexTruncated: hexBytes < buf.length,
    solidity, check,
  };
}

// ---------------------------------------------------------------- edit, solidity, ops

const errorPath = (codec, error) => (Array.isArray(error?.path) && error.path.length ? codec.pathText(error.path) : null);

/** The JSON view back to canonical bytes (fromJSON checks every field; the error names the path), in the original's header mode. */
async function reencode({ schema: key, json, header = 'id', maxNodes = 4000, maxHexBytes = 4096 }) {
  const e = await engine();
  const { codec } = e;
  const entry = lookup(e, key);
  if (!entry) return { ok: false, error: `No schema ${key} in the registry.`, path: null };
  let value;
  if (typeof json === 'string') {
    try { value = JSON.parse(json); } catch (error) { return { ok: false, error: `That isn't JSON: ${error.message}`, path: null }; }
  } else value = json;
  let bytes;
  try {
    const typed = codec.fromJSON(entry.schema, value);
    bytes = codec.encode(entry.schema, typed, { header: header === 'self' || header === 'none' ? header : 'id' });
  } catch (error) {
    return { ok: false, error: String(error?.why ?? error?.message ?? error), message: String(error?.message ?? error), path: errorPath(codec, error) };
  }
  const buf = Buffer.from(bytes);
  return { ok: true, base64: buf.toString('base64'), base64url: buf.toString('base64url'), bytes: bytes.length, explain: await explain({ bytes, schema: header === 'none' ? entry.id : undefined, maxNodes, maxHexBytes }) };
}

async function solidity({ schema: key, name }) {
  const e = await engine();
  const entry = lookup(e, key);
  if (!entry) throw new Error(`No schema ${key} in the registry.`);
  try { return { ok: true, schema: describe(e, entry), code: e.codec.solidityDecoder(entry.schema, name ? { name } : {}) }; } catch (error) { return { ok: false, schema: describe(e, entry), reason: String(error?.message ?? error) }; }
}

/** A builder op list as its packed form (keel/builder/ops@1), so a build file can be inspected as what is stored. */
async function encodeOps({ ops }) {
  const e = await engine();
  if (!e.builder?.storeOps) throw new Error('The builder package is not in this engine checkout, so op lists can’t be packed.');
  return { bytes: e.builder.storeOps(ops) };
}

// ---------------------------------------------------------------- samples

/** Sample documents (the tests and the inspector's "Try a sample"). */
async function sample({ kind = 'sfx' }) {
  const e = await engine();
  const { codec } = e;
  const out = (label, bytes, extra = {}) => ({ kind, label, bytes: Buffer.from(bytes).toString('base64url'), byteLength: bytes.length, ...extra });
  switch (kind) {
    case 'sfx': return out('Sound effects settings (keel/audio/sfx)', codec.encode(codec.SFX_SETTINGS, { seed: 7, style: 'lofi', volume: 0.8, body: { wind: true, gain: 1, surfaces: { stone: 'stone', steel: 'metal' }, events: { jump: 'jump', land: 'land' } }, sounds: { jump: { gain: 1.2, pan: -0.25 }, land: { rate: 0.9, jitter: 0.1 } } }));
    case 'recipe': {
      if (!e.audio?.musicRecipe) throw new Error('The audio package is not in this engine checkout.');
      return out('Music recipe (keel/audio/recipe)', e.audio.storeMusic(e.audio.musicRecipe(e.audio.moodFor({ energy: 0.6, darkness: 0.4, name: 'Codec' }), 7)));
    }
    case 'song': {
      if (!e.audio?.planOfRecipe) throw new Error('The audio package is not in this engine checkout.');
      return out('Song (keel/audio/song)', e.audio.storeMusic(e.audio.planOfRecipe(e.audio.musicRecipe(e.audio.moodFor({ energy: 0.5, name: 'Codec' }), 3))));
    }
    case 'voxels': {
      if (!e.builder?.generate) throw new Error('The builder package is not in this engine checkout.');
      const g = e.builder.generate('crate', '3');
      const text = e.builder.storeVoxelsText(g.model);
      return out('Voxels: a generated crate (keel/builder/voxels, KC1: text)', e.builder.storeVoxels(g.model), { text });
    }
    case 'ops': {
      if (!e.builder?.storeOps) throw new Error('The builder package is not in this engine checkout.');
      return out('Builder op list (keel/builder/ops)', e.builder.storeOps([{ op: 'new', name: 'hut', unit: 0.12 }, { op: 'box', from: [0, 0, -4], to: [5, 6, 4], role: 'primary', hollow: true }, { op: 'box', from: [-1, 0, 4], to: [0, 3, 4], role: 'dark' }, { op: 'group', name: 'door', from: [-1, 0, 4], to: [0, 3, 4] }, { op: 'target', as: 'object', id: 'hut' }]));
    }
    case 'level': {
      if (!e.level?.createLevel) throw new Error('The level package is not in this engine checkout.');
      return out('An empty 24×24 level (keel/level)', e.level.encodeLevel(e.level.createLevel({ id: 'sample', name: 'Codec sample', seed: '1', width: 24, depth: 24 }).toDocument()));
    }
    case 'tile': {
      // (A fixed-layout schema the document carries itself: the Solidity decoder's subset.)
      const TILE = codec.named('keel/codec/sample-tile', codec.struct({ x: codec.uint(10), y: codec.uint(10), kind: codec.enumOf(['grass', 'rock', 'water', 'sand']), height: codec.fixed(0, 25.5, 0.1), solid: codec.bool(), tint: codec.int(8) }), { doc: 'A tile on a grid: fixed width, every field at a known bit.' });
      return out('A fixed-layout tile, carrying its schema (header "self")', codec.encode(TILE, { x: 37, y: 512, kind: 'rock', height: 3.4, solid: true, tint: -12 }, { header: 'self' }));
    }
    default: throw new Error(`No sample ${kind} (samples: sfx, recipe, song, voxels, ops, level, tile).`);
  }
}

const operations = { schemas, explain, reencode, solidity, encodeOps, sample };
parentPort.on('message', async ({ id, op, input }) => {
  try {
    const run = operations[op];
    if (!run) throw new Error(`Unknown codec operation ${op}.`);
    parentPort.postMessage({ id, result: await run(input ?? {}) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error).slice(0, 4000) });
  }
});
