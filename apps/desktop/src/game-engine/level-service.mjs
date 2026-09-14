// The editor's side of the Level tab: its own worker (world generation and a
// level session per open project, recycled with the engine's sources like the
// other game-engine workers), and each project's live level -- what the Level
// tab shows, edited by level ops from the tab and the assistant alike, saved
// to the project's levels/<name>.level by the creator. The tab waits here for
// the next change (gameLevelDoc), so ops the assistant streams in show up as
// they land: a batch at a time, each with the snapshot the preview draws.
// What a recycled worker lost is rebuilt from the mirror kept here (the saved
// content, then the ops applied since).
import { GameEngineService } from './game-engine-service.mjs';
import { LEVEL_PRESETS, opKind } from './level-project.mjs';

/** The level preview's headers: its script inline, pictures as data, nothing else (and sandboxed). */
export const LEVEL_PREVIEW_HEADERS = { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts" };
const keyOf = (projectId, name) => `${projectId}/${name}`;
/** Ops a streamed batch holds (the assistant's paint lands a few at a time, so the creator watches it happen). */
const STREAM_BATCH = 6;

export class GameLevelService extends GameEngineService {
  /** @param {{ workerPath: string; engine?: GameEngineService; root?: string | null; searched?: string[]; [key: string]: unknown }} options */
  constructor({ engine, ...options }) {
    super({ timeoutMs: 180_000, ...options, root: engine ? engine.root : options.root ?? null, searched: engine ? engine.searched : options.searched ?? [] });
    this.docs = new Map(); this.waiters = new Map(); this.previewPage = null; this.openTabs = new Set(); this.paceMs = 45;
  }

  catalogue() { return this.cached('level-catalogue', () => this.call('catalogue')); }
  variations(recipe, players = 0, count = 6) { return this.call('variations', { recipe, players, count }); }
  thumb(recipe, players = 0) { return this.call('thumb', { recipe, players }); }
  decode(content) { return this.call('decode', { content }); }
  tileset(bytes, rules) { return this.call('tileset', { bytes, rules }); }

  /** A project's live level: { name, seq, state, snapshot, saved (the content it was opened from), unsaved }. */
  live(projectId) { return this.docs.get(projectId) ?? null; }
  isOpen(projectId) { return this.openTabs.has(projectId); }

  /**
   * Open (or re-sync) a project's level from its saved content (or a preset / recipe for a new one). The same
   * name and saved content keep what's open (unsaved work too); anything else reopens it.
   * @param {string} projectId @param {string} name @param {{ content?: string; preset?: string; recipe?: Record<string, unknown>; players?: number; editor?: boolean }} [options]
   */
  async open(projectId, name, { content = '', preset, recipe, players, editor = false } = {}) {
    if (editor) this.openTabs.add(projectId);
    const have = this.docs.get(projectId);
    if (have && have.name === name && have.saved === content && !preset && !recipe) return { how: 'unchanged', ...this.view(have) };
    let input = { key: keyOf(projectId, name), name, content };
    if (!content) {
      const p = LEVEL_PRESETS[preset ?? 'mixed'] ?? LEVEL_PRESETS.mixed;
      input = { ...input, recipe: recipe ?? p.recipe(), players: players ?? (recipe ? 0 : p.players) };
    }
    if (have && have.name !== name) void this.call('close', { key: keyOf(projectId, have.name) }).catch(() => {});
    const r = await this.call('open', input);
    const entry = { name, seq: (have?.seq ?? 0) + 1, state: r.state, snapshot: r.snapshot, saved: content, mirror: { content, recipe: input.recipe ?? null, players: input.players ?? 0, ops: [] }, dirty: !content, did: [], errors: [] };
    this.docs.set(projectId, entry);
    this.notify(projectId);
    return { how: have ? 'reloaded' : 'opened', ...this.view(entry) };
  }
  async closeDoc(projectId) {
    this.openTabs.delete(projectId);
    const have = this.docs.get(projectId);
    this.docs.delete(projectId);
    if (have && this.worker) await this.call('close', { key: keyOf(projectId, have.name) }).catch(() => {});
    return { closed: !!have };
  }

  /** Run against the open level; a recycled worker (the engine's sources changed) reopens it from the mirror first. */
  async withLevel(projectId, run) {
    const entry = this.docs.get(projectId);
    if (!entry) throw Error('Open a level first (the Level tab, or keel_game_level_state).');
    const key = keyOf(projectId, entry.name);
    try { return await run(key, entry); } catch (error) {
      if (!/^No open level /.test(error.message)) throw error;
      const m = entry.mirror;
      await this.call('open', { key, name: entry.name, content: m.content, recipe: m.recipe, players: m.players });
      if (m.ops.length) await this.call('apply', { key, ops: m.ops, snapshot: false });
      if (m.tileset !== undefined) await this.call('setTileset', { key, tileset: m.tileset });
      return run(key, entry);
    }
  }

  /**
   * Apply level ops to the open level: the tab (and whoever waits on it) sees each batch land. `stream`: a few ops
   * at a time with a short pause between (the assistant's), else one call. Stops at the first op that fails.
   */
  async apply(projectId, ops, { stream = false } = {}) {
    const batches = [];
    if (stream) { let batch = []; for (const op of ops) { batch.push(op); if (opKind(op) !== 'edit' || batch.length >= STREAM_BATCH) { batches.push(batch); batch = []; } } if (batch.length) batches.push(batch); }
    else batches.push(ops);
    const did = [];
    let applied = 0;
    for (const [n, batch] of batches.entries()) {
      const r = await this.withLevel(projectId, (key) => this.call('apply', { key, ops: batch }));
      const entry = this.docs.get(projectId);
      if (r.applied) { entry.mirror.ops.push(...batch.slice(0, r.applied)); entry.dirty = true; }
      applied += r.applied; did.push(...r.did);
      Object.assign(entry, { seq: entry.seq + 1, state: r.state, snapshot: r.snapshot, did: r.did, errors: r.errors.map((e) => ({ ...e, index: e.index + (applied - r.applied) })) });
      this.notify(projectId);
      if (!r.ok) return { ok: false, applied, did, errors: entry.errors, ...this.view(entry) };
      if (stream && n < batches.length - 1) await new Promise((resolve) => setTimeout(resolve, this.paceMs));
    }
    return { ok: true, applied, did, errors: [], ...this.view(this.docs.get(projectId)) };
  }

  /** Ops tried on a copy (the live level untouched): what they'd do and the file they'd save. */
  dryRun(projectId, ops) { return this.withLevel(projectId, (key) => this.call('dryRun', { key, ops })); }
  /** The open level as its file content and the sizes of its records. */
  encode(projectId) { return this.withLevel(projectId, (key) => this.call('encode', { key })); }
  /** The open level's state (a thumbnail of its ground on request). */
  state(projectId, { thumb = false } = {}) { return this.withLevel(projectId, (key) => this.call('state', { key, thumb })); }
  async setTileset(projectId, tileset) {
    const r = await this.withLevel(projectId, (key) => this.call('setTileset', { key, tileset }));
    const entry = this.docs.get(projectId);
    Object.assign(entry, { seq: entry.seq + 1, state: r.state, dirty: true });
    entry.mirror.tileset = tileset;
    this.notify(projectId);
    return this.view(entry);
  }

  /** The creator saved the level (its content is now the project's file). */
  saved(projectId, name, content) {
    const entry = this.docs.get(projectId);
    if (entry && entry.name === name) { entry.saved = content; entry.dirty = false; entry.mirror = { content, recipe: null, players: 0, ops: [] }; entry.seq += 1; this.notify(projectId); }
    return { saved: true };
  }

  view(entry) { return { name: entry.name, seq: entry.seq, state: entry.state, snapshot: entry.snapshot, saved: entry.saved, unsaved: !!entry.dirty, did: entry.did ?? [], errors: entry.errors ?? [] }; }

  /** The level after `after`, waiting up to `waitMs` for a change. */
  wait(projectId, after = 0, waitMs = 15_000) {
    const entry = this.docs.get(projectId);
    if (entry && entry.seq > after) return Promise.resolve(this.view(entry));
    return new Promise((resolve) => {
      const list = this.waiters.get(projectId) ?? [];
      const done = (value) => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { this.waiters.set(projectId, (this.waiters.get(projectId) ?? []).filter((item) => item !== done)); const now = this.docs.get(projectId); resolve(now ? { ...this.view(now), idle: true } : { seq: after, idle: true }); }, waitMs);
      list.push(done); this.waiters.set(projectId, list);
    });
  }
  notify(projectId) {
    const entry = this.docs.get(projectId);
    const list = this.waiters.get(projectId) ?? [];
    this.waiters.delete(projectId);
    for (const done of list) done(this.view(entry));
  }

  /** The preview page (bundled once per engine fingerprint). */
  async page() {
    const print = await this.current();
    if (this.previewPage?.print === print) return this.previewPage.html;
    const html = await this.call('preview');
    this.previewPage = { print, html };
    return html;
  }
}
