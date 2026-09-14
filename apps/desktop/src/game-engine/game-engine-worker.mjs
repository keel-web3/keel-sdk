// The KEEL game engine, off the editor's main thread. Node runs the engine's
// TypeScript directly, so this worker imports the engine checkout's own build
// (packages/keel) and runtime (packages/runtime) and answers with plain JSON.
// Only trusted main-process requests arrive here; module code a game ships is
// bundled, never executed (pack builders only draw sample sockets).
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = workerData.root;
let loaded;
async function engine() {
  if (!loaded) {
    const [keel, runtime] = await Promise.all([
      import(pathToFileURL(join(root, 'packages', 'keel', 'src', 'index.ts')).href),
      import(pathToFileURL(join(root, 'packages', 'runtime', 'src', 'index.ts')).href),
    ]);
    // (The engine's modules, and the projects built with it: the SDK's examples, a creator's folders.)
    const workspace = await keel.readWorkspace(root, { projects: workerData.projects ?? [] });
    loaded = { keel, runtime, workspace, packs: new Map() };
  }
  return loaded;
}

// (A tiny seeded stream, the same shape the engine's builders draw from: sample sockets only.)
function stream(seed) {
  let a = seed >>> 0 || 1;
  const f = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: (list) => list[Math.floor(f() * list.length)], chance: (p) => f() < p };
}

/** A pack's definitions (entities and attributes with their builders): its module.ts or index.ts exports `pack`. */
async function packOf(mod) {
  const { packs } = await engine();
  if (packs.has(mod.manifest.id)) return packs.get(mod.manifest.id);
  let result = { pack: null, error: '' };
  try {
    for (const file of ['module.ts', 'index.ts']) {
      const path = join(mod.dir, 'src', file);
      if (!existsSync(path)) continue;
      const exported = await import(pathToFileURL(path).href);
      if (exported.pack?.entities && exported.pack?.attributes) { result = { pack: exported.pack, error: '' }; break; }
    }
    if (!result.pack) result.error = 'This pack does not export `pack` from src/module.ts or src/index.ts, so only its table of contents is shown.';
  } catch (error) { result = { pack: null, error: String(error?.message ?? error) }; }
  packs.set(mod.manifest.id, result);
  return result;
}

const clean = (value) => JSON.parse(JSON.stringify(value ?? null));
function entityInfo(entity) {
  let sockets = [];
  try {
    const design = entity.build(stream(1), {});
    sockets = Object.entries(entity.sockets(design) ?? {}).map(([name, socket]) => ({ name, size: clean(socket.size), pos: clean(socket.pos) }));
  } catch { /* A builder that needs a real stream or page still lists its contract. */ }
  return { id: entity.id, body: entity.body, ...(entity.title ? { title: entity.title } : {}), tags: clean(entity.tags ?? []), choices: clean(entity.choices ?? {}), sockets };
}
const attributeInfo = (attribute) => ({ id: attribute.id, slot: attribute.slot, ...(attribute.title ? { title: attribute.title } : {}), tags: clean(attribute.tags ?? []), targets: clean(attribute.targets), choices: clean(attribute.choices ?? {}) });

async function modules() {
  const { workspace } = await engine();
  const out = [];
  for (const mod of workspace) {
    const m = mod.manifest;
    const item = { id: m.id, version: m.version, kind: m.kind, phase: m.phase, weight: m.weight, needs: [...m.needs], provides: [...m.provides], compatible: [...m.compatible],
      ...(m.title ? { title: m.title } : {}), ...(m.description ? { description: m.description } : {}),
      packageName: mod.packageName, group: basename(dirname(mod.dir)), dir: relative(root, mod.dir), contents: clean(m.contents ?? null) };
    if (m.kind === 'pack') {
      const { pack, error } = await packOf(mod);
      if (pack) item.pack = { entities: pack.entities.map(entityInfo), attributes: pack.attributes.map(attributeInfo) };
      if (error) item.packError = error;
    }
    out.push(item);
  }
  return { root, modules: out };
}

async function graph({ gameId }) {
  const { keel, workspace } = await engine();
  const closure = keel.closureOf(gameId, workspace);
  const resolution = keel.resolveModules(closure.map((m) => m.manifest));
  return {
    gameId, ok: resolution.ok, order: [...resolution.order], problems: clean(resolution.problems), edges: clean(resolution.edges),
    modules: closure.map(({ manifest: m }) => ({ id: m.id, version: m.version, kind: m.kind, phase: m.phase, weight: m.weight, needs: [...m.needs], provides: [...m.provides], ...(m.title ? { title: m.title } : {}) })),
  };
}

async function build({ gameId, minify = true }) {
  const { keel, workspace } = await engine();
  const doc = await keel.buildGameDocument(gameId, workspace, { minify, ...(workerData.shell ? { shell: workerData.shell } : {}) });
  const sdk = await import('@keel/sdk/inline-viewer-graph');
  // The game module and its entry are the creator's new work; engine modules and the shell are shared.
  const creatorModules = new Set([gameId]);
  const measured = { ...doc.document, parts: doc.document.parts.map((part) => creatorModules.has(part.moduleId) ? { ...part, kind: 'creator' } : part) };
  const saver = sdk.measureKeelInlineCompactGraph(measured);
  const entryPart = doc.document.parts.find((part) => part.kind === 'creator' && !part.moduleId);
  const entryBytes = entryPart?.bytes.byteLength ?? 0;
  const game = doc.modules.filter((m) => creatorModules.has(m.id));
  const shared = doc.modules.filter((m) => !creatorModules.has(m.id));
  const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
  const entryStored = entryPart ? gzipSync(entryPart.bytes, { level: 9 }).byteLength : 0;
  const uploads = {
    creatorByteLength: sum(game, 'bytes') + entryBytes, creatorCompressedByteLength: sum(game, 'stored') + entryStored,
    creatorPublicationBytes: saver.creatorPublicationBytes,
    sharedOriginalByteLength: sum(shared, 'bytes'), sharedCompressedByteLength: sum(shared, 'stored'),
    sharedPublicationBytes: saver.graphByteLength - saver.creatorPublicationBytes,
    modules: shared.map(({ id, version, bytes }) => ({ id, version, byteLength: bytes })),
    reuseStatus: 'selected-network-verification-required',
  };
  const html = new Uint8Array(doc.html);
  return {
    result: {
      gameId, html, byteLength: html.byteLength, order: [...doc.resolution.order], problems: clean(doc.resolution.problems), modules: clean(doc.modules),
      saver, uploads, totals: { originalByteLength: sum(doc.modules, 'bytes') + entryBytes, compressedByteLength: sum(doc.modules, 'stored') + entryStored },
    },
    transfer: [html.buffer],
  };
}

async function placed(ref) {
  const { workspace } = await engine();
  const mod = workspace.find((m) => m.manifest.id === ref.pack);
  if (!mod) throw new Error(`No module ${ref.pack} in the engine workspace.`);
  if (mod.manifest.kind !== 'pack') throw new Error(`${ref.pack} is a ${mod.manifest.kind} module, not a pack.`);
  const { pack, error } = await packOf(mod);
  if (!pack) throw new Error(error);
  return { mod, pack };
}
async function fit({ attribute, entity }) {
  const { runtime } = await engine();
  const a = await placed(attribute); const e = await placed(entity);
  const def = a.pack.attributes.find((item) => item.id === attribute.id);
  if (!def) throw new Error(`${attribute.pack} has no attribute ${attribute.id}.`);
  const body = e.pack.entities.find((item) => item.id === entity.id);
  if (!body) throw new Error(`${entity.pack} has no entity ${entity.id}.`);
  const verdict = runtime.fits({ def, pack: a.mod.manifest }, { def: body, pack: e.mod.manifest });
  return { ok: verdict.ok, why: verdict.why, attribute: { ...attribute, slot: def.slot }, entity: { ...entity, body: body.body }, socket: entityInfo(body).sockets.some((s) => s.name === def.slot) ? def.slot : null };
}

// Plain-language search over every pack's contents: "a hat that fits a dog".
const STOP = new Set(['a', 'an', 'the', 'that', 'which', 'fits', 'fit', 'fitting', 'for', 'on', 'onto', 'with', 'to', 'of', 'and', 'or', 'any', 'some', 'can', 'go', 'goes', 'wear', 'wears', 'worn', 'by', 'find', 'me', 'i', 'want', 'need', 'is', 'are', 'anything', 'something', 'thing', 'things', 'asset', 'assets', 'item', 'items']);
const words = (text) => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !STOP.has(word));
const stem = (word) => word.replace(/(es|s)$/, '');
const hay = (...values) => values.flat().filter(Boolean).join(' ').toLowerCase();
async function find({ query = '', kind = 'any', slot, body, tag, fitsEntity, limit = 30 }) {
  const { workspace, runtime } = await engine();
  const lower = String(query).toLowerCase();
  // Words after "fits"/"for"/"on" name who wears it; the rest describe the asset.
  const split = /\b(?:fits?|fitting|for|on|onto|worn by)\b/.exec(lower);
  const wanted = words(split ? lower.slice(0, split.index) : lower).map(stem);
  const wearer = split ? words(lower.slice(split.index + split[0].length)).map(stem) : [];
  const assets = [];
  for (const mod of workspace.filter((m) => m.manifest.kind === 'pack')) {
    const { pack } = await packOf(mod);
    if (!pack) continue;
    for (const e of pack.entities) assets.push({ type: 'entity', pack: mod.manifest.id, def: e, mod, text: hay(e.id, e.title, e.tags, e.body, mod.manifest.id, mod.manifest.title) });
    for (const a of pack.attributes) assets.push({ type: 'attribute', pack: mod.manifest.id, def: a, mod, text: hay(a.id, a.title, a.tags, a.slot, a.targets.map((t) => t.body), mod.manifest.id, mod.manifest.title) });
  }
  const matches = (asset, list) => list.filter((word) => asset.text.includes(word)).length;
  let wearers = [];
  if (fitsEntity) {
    const found = assets.find((asset) => asset.type === 'entity' && asset.pack === fitsEntity.pack && asset.def.id === fitsEntity.id);
    if (!found) throw new Error(`${fitsEntity.pack} has no entity ${fitsEntity.id}.`);
    wearers = [found];
  } else if (wearer.length) wearers = assets.filter((asset) => asset.type === 'entity' && matches(asset, wearer) > 0);
  const results = [];
  for (const asset of assets) {
    if (kind !== 'any' && asset.type !== kind) continue;
    if (slot && asset.def.slot !== slot) continue;
    if (body && !(asset.type === 'entity' ? asset.def.body.startsWith(body) : asset.def.targets.some((t) => t.body.startsWith(body)))) continue;
    if (tag && !(asset.def.tags ?? []).includes(tag)) continue;
    const score = wanted.length ? matches(asset, wanted) : 1;
    if (!score) continue;
    const item = { type: asset.type, pack: asset.pack, id: asset.def.id, score, ...(asset.type === 'entity' ? { body: asset.def.body } : { slot: asset.def.slot, targets: clean(asset.def.targets) }), tags: clean(asset.def.tags ?? []), ...(asset.def.title ? { title: asset.def.title } : {}) };
    if (asset.type === 'attribute' && wearers.length) {
      item.fits = wearers.map((w) => ({ entity: { pack: w.pack, id: w.def.id }, ...runtime.fits({ def: asset.def, pack: asset.mod.manifest }, { def: w.def, pack: w.mod.manifest }) }));
      if (!item.fits.some((verdict) => verdict.ok)) continue;
    }
    results.push(item);
  }
  results.sort((x, y) => y.score - x.score || x.pack.localeCompare(y.pack) || x.id.localeCompare(y.id));
  return { query, wearer: wearers.map((w) => ({ pack: w.pack, id: w.def.id, body: w.def.body })), unmatchedWearer: !!wearer.length && !wearers.length, ...(wearer.length && !wearers.length ? { note: `No entity in the installed packs matches "${wearer.join(' ')}", so these results aren't checked against a wearer.` } : {}), results: results.slice(0, limit), total: results.length };
}

// ---------------------------------------------------------------- publishing (the practice chain; Sepolia plans)
// The SDK's chain code (packages/game-engine/chain) runs here with THIS worker's
// engine and the editor's canonical shell, so what is published is what the
// editor previews. Loaded from the SDK checkout at run time, never bundled.
async function chain() {
  const dir = workerData.chainDir;
  if (!dir || !existsSync(join(dir, 'flows.mjs'))) throw new Error('The SDK\'s publishing code (packages/game-engine/chain) isn\'t beside this editor.');
  const load = (name) => import(pathToFileURL(join(dir, name)).href);
  const [flows, build, publication, local] = await Promise.all([load('flows.mjs'), load('build.mjs'), load('publication.mjs'), load('local-chain.mjs')]);
  const { keel, workspace } = await engine();
  void workspace; // (read once, so the engine's own modules load before any build)
  return { flows, builds: build.engineBuilds({ keel, root }), publication, local };
}
const bigints = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));

/** Publish a game to the practice chain (only what the chain doesn't have), read it back, and return its links. */
async function publish({ gameId, rpc, deployment, context = {}, includeEngine = false }) {
  const { flows, builds } = await chain();
  const log = [];
  const { result } = await flows.publishGame({ rpc, deployment, projects: workerData.projects ?? [], gameId, builds, shell: workerData.shell, includeEngine, context, log: (line) => log.push(line) });
  return bigints({ ...result, log: log.slice(-40) });
}

/** Publish the engine release (the shell and every engine module) to the practice chain. */
async function publishEngine({ rpc, deployment }) {
  const { flows, builds } = await chain();
  const release = await flows.publishEngineRelease({ rpc, deployment, builds, shell: workerData.shell });
  return bigints({ objects: release.objects.length, gas: release.gas, totals: release.totals, failed: release.failed });
}

/**
 * The engine on a chain, against this editor's engine: every shared object
 * (the shell and each engine module, by id@version) as the local build makes
 * it, whether the chain has it, and whether it matches a release record.
 */
async function engineOnChain({ rpc, hold, record }) {
  const { builds, publication, local } = await chain();
  const release = await builds.buildEngineRelease({ shell: workerData.shell });
  const plan = await publication.planGame({ doc: release.doc, engineModuleIds: release.engineModuleIds, hold, gameId: 'keel-engine/release' });
  const { publicClient } = await local.clientsFor(rpc, { account: '0x0000000000000000000000000000000000000001' });
  const missing = await publication.missingOnChain({ publicClient, plan });
  // The resolver's view, when the chain has a pinned release record: each module's object against the catalog's
  // digest, this engine's own verified build against the release, and where the readable source is.
  let resolver = null;
  if (record?.release?.pin && typeof (await engine()).keel.loadEngineRelease === 'function') {
    const { keel, workspace } = await engine();
    const releases = await import(pathToFileURL(join(workerData.chainDir, 'engine-release.mjs')).href);
    resolver = await releases.checkEngineRelease({ keel, root, workspace, pin: record.release.pin, publicClient }).catch((error) => ({ error: String(error?.message ?? error) }));
  }
  const recorded = new Map((record?.objects ?? []).map((item) => [item.moduleId ?? item.role, item]));
  const objects = missing.parts.filter(({ part }) => part.share !== 'game').map(({ part, exists }) => {
    const key = part.moduleId ?? part.role; const had = recorded.get(key);
    return { key, role: part.role, moduleId: part.moduleId ?? null, version: part.version ?? null, objectId: part.objectId, onChain: exists, recorded: !!had, matchesRecord: had ? had.objectId === part.objectId && (had.version ?? null) === (part.version ?? null) : null };
  });
  return bigints({ objects, failed: release.failed, allOnChain: objects.every((item) => item.onChain), anyOnChain: objects.some((item) => item.onChain), mismatched: objects.filter((item) => item.recorded && item.matchesRecord === false).map((item) => item.key), resolver });
}

/**
 * A game's Sepolia publication, prepared up to the signature: the plan against
 * Sepolia's KeelHold, what Sepolia already holds (read-only calls), and the
 * transactions a wallet would sign, in order. Nothing is signed or sent.
 */
async function planPublication({ gameId, rpc, hold, chainId }) {
  const { builds, publication, local } = await chain();
  const { doc, engineModuleIds } = await builds.buildGame({ projects: workerData.projects ?? [], gameId, shell: workerData.shell });
  const plan = await publication.planGame({ doc, engineModuleIds, hold, gameId });
  const { publicClient, chainId: seen } = await local.clientsFor(rpc, { account: '0x0000000000000000000000000000000000000001' });
  if (seen !== chainId) throw new Error(`${rpc} is chain ${seen}, not ${chainId}.`);
  const missing = await publication.missingOnChain({ publicClient, plan });
  const absent = publication.missingShared(missing);
  const txs = publication.transactionsFor({ plan, missing, shares: absent.length ? ['shell', 'engine', 'game'] : ['game'] });
  return bigints({
    gameId, chainId, hold, root: plan.root.objectId, digest: plan.root.digest, documentBytes: plan.htmlByteLength,
    own: publication.planTotals(plan, ['game']), shared: publication.planTotals(plan, ['shell', 'engine']), sharedMissing: absent,
    transactions: txs.map((tx) => ({ label: tx.label, kind: tx.kind, share: tx.share, to: tx.to, bytes: tx.bytes, data: tx.data })),
  });
}

const operations = { modules, graph, build, fit, find, publish, publishEngine, engineOnChain, planPublication };
parentPort.on('message', async ({ id, op, input }) => {
  try {
    const run = operations[op];
    if (!run) throw new Error(`Unknown game engine operation ${op}.`);
    const value = await run(input ?? {});
    if (value && value.transfer) parentPort.postMessage({ id, result: value.result }, value.transfer);
    else parentPort.postMessage({ id, result: value });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message ?? error).slice(0, 4000) });
  }
});
