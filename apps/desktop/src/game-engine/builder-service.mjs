// The editor's side of the KEEL builder: its own worker (so a long import or a
// streaming op list never holds up a game build), recycled with the engine's
// sources like the game engine's. While an op list streams, the worker posts a
// preview frame every few ops; the latest frame per build waits here for the
// editor, which asks for the next one as soon as it has drawn the last
// (gameBuilderFrame) -- a slow screen skips frames, it never queues them. Each
// build's op log is kept here too, so a recycled worker reopens it exactly.
import { GameEngineService } from './game-engine-service.mjs';
import { builderKey, sameOps } from './builder-project.mjs';

/** The builder preview document's headers: scripts and styles inline, pictures as data, nothing else (and sandboxed). */
export const BUILDER_PREVIEW_HEADERS = { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts" };

export class GameBuilderService extends GameEngineService {
  /** @param {{ workerPath: string; engine?: GameEngineService; root?: string | null; searched?: string[]; [key: string]: unknown }} options -- `engine`: use the game engine's checkout (its root, and where it looked). */
  constructor({ engine, ...options }) {
    super({ timeoutMs: 180_000, ...options, root: engine ? engine.root : options.root ?? null, searched: engine ? engine.searched : options.searched ?? [] });
    this.frames = new Map(); this.waiters = new Map(); this.logs = new Map(); this.openBuilds = new Map(); this.previewPage = null;
  }

  /** Where agent ops go when a project has a build open in the editor. */
  openBuildOf(projectId) { return this.openBuilds.get(projectId) ?? null; }

  /** Open (or re-sync) a build from its saved ops; `editor` marks it as the one the Builder shows. */
  async open(projectId, name, ops = [], { pace = false, reset = false, editor = false } = {}) {
    const key = builderKey(projectId, name);
    const result = await this.call('open', { key, ops, pace, reset });
    // (Unsaved work kept on top of the saved ops keeps its log; otherwise the build is now exactly the saved ops.)
    if (result.how !== 'kept-unsaved' || !this.logs.has(key)) this.logs.set(key, { log: [...ops], undone: [] });
    if (editor) this.openBuilds.set(projectId, name);
    this.publish(key, result.frame);
    return result;
  }

  /** Stream ops into an open build: per-op results, the final frame and the build's state. */
  async apply(projectId, name, ops, { pace = true, label = '' } = {}) {
    const key = builderKey(projectId, name);
    const result = await this.withBuild(key, () => this.call('apply', { key, ops, pace, label }));
    if (result.applied) this.mirror(key, ops.slice(0, result.applied));
    if (result.frame) this.publish(key, result.frame);
    return result;
  }

  /**
   * The build's op list as the builder's own history holds it (what a replay
   * rebuilds): a new op joins it and clears what could be redone, undo takes
   * ops off, redo puts them back -- the session's rules, mirrored.
   */
  mirror(key, ops) {
    const m = this.logs.get(key) ?? { log: [], undone: [] };
    for (const op of ops) {
      const steps = Number.isInteger(op.steps) && op.steps > 0 ? op.steps : 1;
      if (op.op === 'undo') for (let k = 0; k < steps && m.log.length; k += 1) m.undone.push(m.log.pop());
      else if (op.op === 'redo') for (let k = 0; k < steps && m.undone.length; k += 1) m.log.push(m.undone.pop());
      else { m.log.push(op); m.undone.length = 0; }
    }
    this.logs.set(key, m);
  }
  /** The open build's op list (as mirrored here; the worker's state({ log: true }) is the same list). */
  log(projectId, name) { return this.logs.get(builderKey(projectId, name))?.log ?? null; }

  state(projectId, name, { log = false } = {}) { const key = builderKey(projectId, name); return this.withBuild(key, () => this.call('state', { key, log })); }
  variants(projectId, name, count = 6) { const key = builderKey(projectId, name); return this.withBuild(key, () => this.call('variants', { key, count })); }
  poses(projectId, name, clip) { const key = builderKey(projectId, name); return this.withBuild(key, () => this.call('poses', { key, ...(clip ? { clip } : {}) })); }
  exportPack(projectId, name, { look = 'pixel' } = {}) { const key = builderKey(projectId, name); return this.withBuild(key, () => this.call('exportPack', { key, look })); }
  /** A variant (the Variants strip's index) as the ops that make the build into it. */
  variantOps(projectId, name, index, count = 6) { const key = builderKey(projectId, name); return this.withBuild(key, () => this.call('variantOps', { key, index, count })); }
  loadPack(code) { return this.call('loadPack', { code }); }
  validate(ops) { return this.call('validate', { ops }); }
  reference() { return this.cached('builder-reference', () => this.call('reference')); }
  importFile(input) { return this.call('importFile', input); }
  sample(name) { return this.call('sample', { name }); }
  async closeBuild(projectId, name) {
    const key = builderKey(projectId, name);
    this.logs.delete(key); this.frames.delete(key);
    if (this.openBuilds.get(projectId) === name) this.openBuilds.delete(projectId);
    return this.worker ? this.call('close', { key }) : { closed: false };
  }

  /** The sandboxed preview page (bundled once per engine fingerprint). */
  async preview() {
    const print = await this.current();
    if (this.previewPage?.print === print) return this.previewPage.html;
    const html = await this.call('preview');
    this.previewPage = { print, html };
    return html;
  }

  /** The latest frame after `after` for a build, waiting up to `waitMs` for one. */
  frame(projectId, name, after = 0, waitMs = 15_000) {
    const key = builderKey(projectId, name);
    const latest = this.frames.get(key);
    if (latest && latest.seq > after) return Promise.resolve(latest);
    return new Promise((resolve) => {
      const list = this.waiters.get(key) ?? [];
      const done = (value) => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { this.waiters.set(key, (this.waiters.get(key) ?? []).filter((item) => item !== done)); resolve({ seq: latest?.seq ?? after, frame: null }); }, waitMs);
      list.push(done); this.waiters.set(key, list);
    });
  }

  publish(key, frame) {
    if (!frame) return;
    const seq = (this.frames.get(key)?.seq ?? 0) + 1;
    const value = { seq, frame };
    this.frames.set(key, value);
    const list = this.waiters.get(key) ?? [];
    this.waiters.delete(key);
    for (const done of list) done(value);
  }

  /** Run against an open build; a recycled worker (the engine's sources changed) reopens it from its log first. */
  async withBuild(key, run) {
    try { return await run(); } catch (error) {
      if (!/^No open build /.test(error.message) || !this.logs.has(key)) throw error;
      await this.call('open', { key, ops: this.logs.get(key).log, pace: false, reset: true });
      return run();
    }
  }

  /** Is the saved op list what the open build did? (The Builder's "unsaved" badge.) */
  saved(projectId, name, ops) { const log = this.log(projectId, name); return !log || sameOps(log, ops); }

  // (The game engine's run, plus the worker's progress frames: forwarded to publish as they arrive.)
  run(op, input) {
    if (this.closed) return Promise.reject(new Error('The builder is closed.'));
    let worker;
    try { worker = this.spawn(); } catch (error) { return Promise.reject(error); }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', failed); worker.off('exit', exited); };
      const message = (reply) => {
        if (reply?.id !== id) return;
        if (reply.progress) { this.publish(reply.progress.key, reply.progress); return; }
        done(); if (reply.error) reject(new Error(reply.error)); else resolve(reply.result);
      };
      const failed = (error) => { done(); reject(error instanceof Error ? error : new Error(String(error))); };
      const exited = () => { done(); reject(new Error('The builder worker stopped. Try again.')); };
      const timer = setTimeout(() => { done(); if (this.worker === worker) this.recycle(); reject(new Error(`The builder didn't answer ${op} within ${Math.round(this.timeoutMs / 1000)} seconds. Your project is unchanged; try again.`)); }, this.timeoutMs);
      worker.on('message', message); worker.on('error', failed); worker.on('exit', exited);
      worker.postMessage({ id, op, input });
    });
  }
}
