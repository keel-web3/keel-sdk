// The editor's side of the Sound tab: its own worker (music and sfx through the
// engine's audio and codec, recycled with the engine's sources like the other
// game-engine workers), and each project's live sound doc -- what the Sound tab
// shows, edited by sound ops from the tab and the assistant alike, saved to the
// project's sound/sound.json by the creator. The tab waits here for the next
// change (gameSoundDoc), so ops the assistant sends show up as they land, and
// so do its auditions: a request to play something, which the tab's sandboxed
// page plays and reports back (the assistant reads the report).
import { GameEngineService } from './game-engine-service.mjs';
import { applySoundOps, emptySoundDoc, validateSoundOps } from './sound-project.mjs';

/** The audition page's headers: its scripts inline (Tone, keel-audio, the engine's audio), Tone's blob-worker clock (a hidden pane keeps time), nothing else, sandboxed. */
export const SOUND_PREVIEW_HEADERS = { 'content-type': 'text/html', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; worker-src blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts" };

export class GameSoundService extends GameEngineService {
  /** @param {{ workerPath: string; engine?: GameEngineService; root?: string | null; searched?: string[]; [key: string]: unknown }} options */
  constructor({ engine, ...options }) {
    super({ timeoutMs: 120_000, ...options, root: engine ? engine.root : options.root ?? null, searched: engine ? engine.searched : options.searched ?? [] });
    this.docs = new Map(); this.waiters = new Map(); this.reports = new Map(); this.previewPage = null; this.auditions = 0; this.openTabs = new Set();
  }

  catalogue() { return this.cached('sound-catalogue', () => this.call('catalogue')); }
  music(input) { return this.call('music', input); }
  variations(recipe, count = 6) { return this.call('variations', { recipe, count }); }
  sfx(settings) { return this.call('sfx', { settings }); }
  describe(doc) { return this.call('describe', { doc }); }
  encode(doc) { return this.call('encodeSound', { doc }); }
  decode(content) { return this.call('decodeSound', { content }); }

  /** A project's live doc: { seq, doc, saved (the file content it was opened from), content (the doc as a file now), audition }. */
  live(projectId) { return this.docs.get(projectId) ?? null; }
  /** Has the Sound tab got this project open? (Where the assistant's auditions play.) */
  isOpen(projectId) { return this.openTabs.has(projectId); }

  /**
   * Open (or re-sync) a project's doc from its saved file content. The same saved content keeps what's open
   * (unsaved work too); a different one -- a review card applied, another save -- reloads it.
   */
  async open(projectId, content = '', { editor = false } = {}) {
    if (editor) this.openTabs.add(projectId);
    const have = this.docs.get(projectId);
    if (have && have.saved === content) return { how: 'unchanged', ...this.view(have) };
    const { doc } = content ? await this.decode(content) : { doc: emptySoundDoc() };
    const entry = { seq: (have?.seq ?? 0) + 1, doc, saved: content, content, audition: have?.audition ?? null, did: [] };
    this.docs.set(projectId, entry);
    this.notify(projectId);
    return { how: have ? 'reloaded' : 'opened', ...this.view(entry) };
  }
  closeDoc(projectId) { this.openTabs.delete(projectId); return { closed: this.docs.delete(projectId) }; }

  /**
   * Music ops as the tab and the assistant write them -- `{ op: "music", id, recipe | bytes, store }` -- encoded by
   * the worker into `{ op: "music", id, kind, bytes, recipe }`; every other op as it is.
   */
  async encodeOps(ops) {
    const out = [];
    for (const op of ops) {
      if (op?.op !== 'music' || (op.bytes && op.kind)) { out.push(op); continue; }
      const made = await this.music({ ...(op.recipe !== undefined ? { recipe: op.recipe } : {}), ...(op.bytes ? { bytes: op.bytes } : {}), store: op.store ?? 'recipe', plan: false });
      out.push({ op: 'music', id: op.id, ...(op.title ? { title: op.title } : {}), kind: made.kind, bytes: made.bytes, ...(made.recipe !== undefined ? { recipe: made.recipe } : {}) });
    }
    return out;
  }

  /** Check ops against a doc without applying them: the encoded ops, the doc they'd make, its file content. */
  async preview(projectId, ops) {
    const entry = this.docs.get(projectId);
    const doc = entry?.doc ?? emptySoundDoc();
    const encoded = await this.encodeOps(ops);
    const checked = validateSoundOps(encoded);
    if (!checked.ok) return { ok: false, errors: checked.errors, ops: encoded, doc };
    let result;
    try { result = applySoundOps(doc, encoded); } catch (error) { return { ok: false, errors: [{ index: -1, op: '', message: error.message }], ops: encoded, doc }; }
    if (result.doc.sfx) await this.sfx(result.doc.sfx);
    const { content } = await this.encode(result.doc);
    return { ok: true, ops: encoded, doc: result.doc, did: result.did, content };
  }

  /** Apply ops to the open doc: the tab (and whoever waits on it) sees the change. */
  async apply(projectId, ops) {
    if (!this.docs.has(projectId)) await this.open(projectId, '');
    let r;
    try { r = await this.preview(projectId, ops); } catch (error) { return { ok: false, errors: [{ index: -1, op: '', message: error.message }] }; }
    if (!r.ok) return { ok: false, errors: r.errors };
    const entry = this.docs.get(projectId);
    Object.assign(entry, { seq: entry.seq + 1, doc: r.doc, content: r.content, did: r.did });
    this.notify(projectId);
    return { ok: true, did: r.did, ...this.view(entry) };
  }

  /** The creator saved the doc (its content is now the project's file). */
  saved(projectId, content) { const entry = this.docs.get(projectId); if (entry) { entry.saved = content; entry.seq += 1; this.notify(projectId); } return { saved: true }; }

  view(entry) { return { seq: entry.seq, doc: entry.doc, content: entry.content, saved: entry.saved, unsaved: entry.content !== entry.saved, audition: entry.audition, did: entry.did ?? [] }; }

  /** The doc after `after`, waiting up to `waitMs` for a change. */
  wait(projectId, after = 0, waitMs = 15_000) {
    const entry = this.docs.get(projectId);
    if (entry && entry.seq > after) return Promise.resolve(this.view(entry));
    return new Promise((resolve) => {
      const list = this.waiters.get(projectId) ?? [];
      const done = (value) => { clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => { this.waiters.set(projectId, (this.waiters.get(projectId) ?? []).filter((item) => item !== done)); const now = this.docs.get(projectId); resolve(now ? { ...this.view(now), seq: now.seq, idle: true } : { seq: after, idle: true }); }, waitMs);
      list.push(done); this.waiters.set(projectId, list);
    });
  }
  notify(projectId) {
    const entry = this.docs.get(projectId);
    const list = this.waiters.get(projectId) ?? [];
    this.waiters.delete(projectId);
    for (const done of list) done(this.view(entry));
  }

  /**
   * Ask the open Sound tab to play something (`{ music: id | plan, intensity }` or `{ sfx: name, params }`); resolves
   * with the page's report (context state, playing, what it played), or a note when no tab reported in time.
   */
  async audition(projectId, request, waitMs = 12_000) {
    if (!this.docs.has(projectId)) await this.open(projectId, '');
    const entry = this.docs.get(projectId);
    const id = ++this.auditions;
    entry.audition = { id, ...request };
    entry.seq += 1;
    const reported = new Promise((resolve) => {
      const timer = setTimeout(() => { this.reports.delete(id); resolve({ id, reported: false, note: 'The Sound tab did not report back in time: open the project\'s Sound tab to hear it.' }); }, waitMs);
      this.reports.set(id, (report) => { clearTimeout(timer); resolve({ id, reported: true, ...report }); });
    });
    this.notify(projectId);
    return reported;
  }
  /** The page's report for an audition (the tab forwards it). */
  report(id, report) { const done = this.reports.get(id); this.reports.delete(id); done?.(report); return { received: !!done }; }

  /** The audition page (bundled once per engine fingerprint). */
  async page() {
    const print = await this.current();
    if (this.previewPage?.print === print) return this.previewPage.html;
    const html = await this.call('preview');
    this.previewPage = { print, html };
    return html;
  }
}
