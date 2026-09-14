// The editor's side of the KEEL game engine: one lazy worker, requests run one
// at a time from a bounded queue, and results cached until the engine's
// sources change (the worker is recycled then, since Node caches the modules
// it imported). The engine is a local keel-engine checkout, so this is a
// development feature: without one every request says how to point at it.
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { planKeelAssetPresentation } from '@keel/sdk/presentation';

export const GAME_ENGINE_ROOT_ENV = 'KEEL_GAME_ENGINE_ROOT';
const ENTRY = ['packages', 'keel', 'src', 'index.ts'];
const GROUPS = ['packages', 'packs', 'ai', 'systems'];
export const GAME_PROJECTS_ENV = 'KEEL_GAME_PROJECTS';

/**
 * Projects built with the engine, outside it -- the SDK's examples, a creator's own folders:
 * KEEL_GAME_PROJECTS (path-delimited) when set, otherwise the candidates that exist.
 */
export function findGameProjects(candidates = []) {
  const env = process.env[GAME_PROJECTS_ENV];
  const list = env ? env.split(path.delimiter).filter(Boolean) : candidates;
  return [...new Set(list.map((item) => path.resolve(item)))].filter((item) => existsSync(item));
}

/**
 * The engine checkout: KEEL_GAME_ENGINE_ROOT when set, otherwise the first candidate that holds packages/keel;
 * then the fallbacks (the pinned engine release `pnpm game:engine` clones), which are searched either way.
 * `source` says which it was: "env", "checkout" or "release".
 */
export function findGameEngineRoot(candidates = [], fallbacks = []) {
  const env = process.env[GAME_ENGINE_ROOT_ENV];
  const extra = fallbacks.filter(Boolean).map((item) => path.resolve(item));
  const searched = [...new Set([...(env ? [env] : candidates).map((item) => path.resolve(item)), ...extra])];
  const root = searched.find((item) => existsSync(path.join(item, ...ENTRY))) ?? null;
  const source = !root ? null : env && path.resolve(env) === root ? 'env' : extra.includes(root) ? 'release' : 'checkout';
  return { root, searched, fromEnv: !!env, source };
}

/** A token seed as KEEL's shell accepts it (bytes32 hex): hex as is, integers padded, other text hashed. */
export function gameSeed(seed) {
  const value = String(seed ?? '').trim();
  if (!value) return undefined;
  if (/^0x[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
  if (/^\d{1,78}$/.test(value) && BigInt(value) < 2n ** 256n) return `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  return `0x${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/** What a game reads from __KEEL_CONTEXT__ (KEEL_SEED comes from its seed). */
export function gameContext(game = {}) {
  const seed = gameSeed(game.seed);
  return { ...(seed ? { seed } : {}), ...(game.pixels ? { pixels: game.pixels } : {}) };
}

/**
 * The token context appended after the document, the way a KEEL tokenURI appends
 * its context tail. Without a seed or pixel size the preview is the document's
 * exact bytes.
 */
export function gameContextTail(game) {
  const context = gameContext(game);
  if (!Object.keys(context).length) return '';
  const json = JSON.stringify(context).replaceAll('<', '\\u003c');
  return `<script>Object.defineProperty(globalThis,"__KEEL_CONTEXT__",{value:Object.freeze(${json}),enumerable:true,writable:false,configurable:false})</script>`;
}

/**
 * Only pointer lock and fullscreen, and only for games in the project preview
 * (a keel-preview: frame, or a sandboxed frame the shell opens inside one).
 * Everything else stays denied. Chromium reports pointer lock as coming from
 * the main frame, so the frame holding focus is the one that asked.
 */
export const GAME_PERMISSIONS = new Set(['pointerLock', 'fullscreen']);
const isPreviewUrl = (value) => { try { return new URL(value ?? '').protocol === 'keel-preview:'; } catch { return false; } };
export function allowGamePermission(permission, details, webContents) {
  if (!GAME_PERMISSIONS.has(permission)) return false;
  if (isPreviewUrl(details?.requestingUrl)) return true;
  let frame = null;
  try { frame = webContents?.focusedFrame ?? null; } catch { return false; }
  for (let depth = 0; frame && depth < 16; depth++, frame = frame.parent) if (isPreviewUrl(frame.url)) return true;
  return false;
}

export class GameEngineService {
  /** @param {{ workerPath: string; root: string | null; searched?: string[]; shell?: unknown; timeoutMs?: number; maxPending?: number; maxEntries?: number; maxBytes?: number; fingerprintMs?: number; [key: string]: unknown }} options */
  constructor({ workerPath, root, projects = [], searched = [], shell, timeoutMs = 120_000, maxPending = 8, maxEntries = 8, maxBytes = 64 * 1024 * 1024, fingerprintMs = 750, chainDir = null, source = null }) {
    Object.assign(this, { workerPath, root, projects, searched, shell, timeoutMs, maxPending, maxEntries, maxBytes, fingerprintMs, chainDir, source });
    this.worker = null; this.chain = Promise.resolve(); this.pending = 0; this.seq = 0; this.closed = false;
    this.print = null; this.printAt = 0; this.printing = null; this.workerPrint = null; this.cache = new Map(); this.cacheBytes = 0; this.inflight = new Map();
  }

  status() {
    return this.root
      ? { available: true, root: this.root, devOnly: true, env: GAME_ENGINE_ROOT_ENV, source: this.source ?? 'checkout' }
      : { available: false, root: null, devOnly: true, env: GAME_ENGINE_ROOT_ENV, searched: this.searched, source: null,
        reason: `The KEEL game engine isn't here yet${this.searched.length ? ` (looked in ${this.searched.join(', ')})` : ''}. Get the pinned engine release (the Get the engine button, or pnpm game:engine in a terminal), or set ${GAME_ENGINE_ROOT_ENV} to a keel-engine checkout; then restart the editor.` };
  }

  modules() { return this.cached('modules', () => this.call('modules')); }
  graph(gameId) { return this.cached(`graph:${gameId}`, () => this.call('graph', { gameId })); }
  build(gameId, { minify = true } = {}) { return this.cached(`build:${gameId}:${minify}`, () => this.call('build', { gameId, minify }), (result) => result.html.byteLength); }
  fit(attribute, entity) { return this.call('fit', { attribute, entity }); }
  // (Publishing: never cached. The practice chain's publish, the engine on a chain, a Sepolia plan.)
  publish(input) { return this.call('publish', input); }
  publishEngine(input) { return this.call('publishEngine', input); }
  engineOnChain(input) { return this.call('engineOnChain', input); }
  planPublication(input) { return this.call('planPublication', input); }
  find(input) { return this.call('find', input); }

  /** The build without its bytes: what the editor and agents read. */
  async report(gameId) {
    const { html: _html, ...report } = await this.build(gameId);
    return report;
  }

  /** The preview document for a game project: the built game, plus its token context. */
  async document(project) {
    if (!project.game?.id) throw new Error('Choose the game this project plays in its Game tab to preview it.');
    const built = await this.build(project.game.id);
    const tail = gameContextTail(project.game);
    return tail ? Buffer.concat([built.html, Buffer.from(tail)]) : Buffer.from(built.html);
  }

  /** The same shape the canonical preview reports, so the Viewing tab measures a game like any other work. */
  async presentation(project) {
    if (!project.game?.id) throw new Error('Choose the game this project plays in its Game tab to measure it.');
    const built = await this.build(project.game.id);
    return {
      byteLength: built.byteLength, saver: built.saver, uploads: built.uploads, game: { gameId: built.gameId, order: built.order, modules: built.modules },
      plan: planKeelAssetPresentation({ originalByteLength: built.totals.originalByteLength, compressedByteLength: built.totals.compressedByteLength, graphByteLength: built.saver.graphByteLength, mode: project.presentation?.delivery ?? 'auto' }),
      evidence: 'local-byte-verification-only', published: false,
    };
  }

  async cached(key, load, size = () => 0) {
    this.assertOpen();
    const print = await this.current();
    for (const [name, entry] of this.cache) if (entry.print !== print) { this.cacheBytes -= entry.bytes; this.cache.delete(name); }
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit.value; }
    // (One build at a time per key: the preview and the Game tab often ask together.)
    const flight = `${print}:${key}`;
    if (this.inflight.has(flight)) return this.inflight.get(flight);
    const loading = load();
    this.inflight.set(flight, loading);
    let value;
    try { value = await loading; } finally { this.inflight.delete(flight); }
    // (Don't keep a result that raced an engine edit.)
    if (await this.current() === print) {
      const bytes = size(value);
      if (bytes <= this.maxBytes) {
        this.cache.set(key, { print, value, bytes }); this.cacheBytes += bytes;
        while (this.cache.size > this.maxEntries || this.cacheBytes > this.maxBytes) {
          const oldest = this.cache.keys().next().value; this.cacheBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest);
        }
      }
    }
    return value;
  }

  call(op, input) {
    this.assertOpen();
    if (this.pending >= this.maxPending) return Promise.reject(new Error('The game engine is still working on earlier requests. Try again in a moment.'));
    this.pending++;
    const job = this.chain.then(async () => {
      // (Serial requests: nothing is running when a stale worker is dropped.)
      const print = await this.current();
      if (print !== this.workerPrint) { this.recycle(); this.workerPrint = print; }
      return this.run(op, input);
    }).finally(() => { this.pending--; });
    this.chain = job.catch(() => {});
    return job;
  }

  assertOpen() {
    if (this.closed) throw new Error('The game engine is closed.');
    if (!this.root) throw new Error(this.status().reason);
  }

  /** Re-read the fingerprint on the next request (a project was just created or changed on disk). */
  invalidate() { this.printAt = 0; }

  /** The engine sources' fingerprint (sizes and mtimes), re-read at most every fingerprintMs. A change drops the worker, whose imports are stale, and every cached result. */
  async current() {
    if (this.print && Date.now() - this.printAt < this.fingerprintMs) return this.print;
    this.printing ??= this.fingerprint().then((print) => { this.print = print; this.printAt = Date.now(); return print; }).finally(() => { this.printing = null; });
    return this.printing;
  }

  async fingerprint() {
    const hash = createHash('sha256');
    const files = [path.join(this.root, 'package.json')];
    for (const group of GROUPS) {
      const base = path.join(this.root, group);
      let names = [];
      try { names = (await readdir(base, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name).sort(); } catch { continue; }
      for (const name of names) {
        files.push(path.join(base, name, 'package.json'));
        try {
          for (const item of await readdir(path.join(base, name, 'src'), { recursive: true, withFileTypes: true })) if (item.isFile()) files.push(path.join(item.parentPath ?? item.path, item.name));
        } catch { /* A package without src contributes only its package.json. */ }
      }
    }
    // (Projects outside the engine: every source file under them, their own builds and installs aside.)
    for (const project of this.projects) {
      try {
        for (const item of await readdir(project, { recursive: true, withFileTypes: true })) {
          const dir = item.parentPath ?? item.path;
          if (item.isFile() && !/(^|[\\/])(node_modules|out)([\\/]|$)/.test(path.relative(project, dir))) files.push(path.join(dir, item.name));
        }
      } catch { /* A project that's gone contributes nothing. */ }
    }
    for (const file of files.sort()) {
      try { const info = await stat(file); hash.update(`${file}\0${info.size}\0${info.mtimeMs}\n`); } catch { hash.update(`${file}\0missing\n`); }
    }
    return hash.digest('hex');
  }

  spawn() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, { workerData: { root: this.root, projects: this.projects, shell: this.shell, chainDir: this.chainDir } });
    worker.unref();
    worker.on('error', () => { if (this.worker === worker) this.worker = null; });
    worker.on('exit', () => { if (this.worker === worker) this.worker = null; });
    this.worker = worker;
    return worker;
  }

  recycle() {
    const worker = this.worker; this.worker = null;
    void worker?.terminate();
  }

  run(op, input) {
    if (this.closed) return Promise.reject(new Error('The game engine is closed.'));
    let worker;
    try { worker = this.spawn(); } catch (error) { return Promise.reject(error); }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited); };
      const message = (reply) => { if (reply?.id !== id) return; done(); if (reply.error) reject(new Error(reply.error)); else resolve(reply.result); };
      const failed = (error) => { done(); reject(error instanceof Error ? error : new Error(String(error))); };
      const exited = () => { done(); reject(new Error('The game engine worker stopped. Try again.')); };
      // (The timer holds the process open while a request runs; an idle worker never does.)
      const timer = setTimeout(() => { done(); if (this.worker === worker) this.recycle(); reject(new Error(`The game engine didn't answer ${op} within ${Math.round(this.timeoutMs / 1000)} seconds. Your project is unchanged; try again.`)); }, this.timeoutMs);
      worker.on('message', message); worker.on('error', failed); worker.on('exit', exited);
      worker.postMessage({ id, op, input });
    });
  }

  close() {
    this.closed = true;
    this.recycle();
    this.cache.clear(); this.cacheBytes = 0;
  }
}
