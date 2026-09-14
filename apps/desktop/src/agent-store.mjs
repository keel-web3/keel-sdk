import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const agentProvider = z.enum(['codex', 'claude', 'openai', 'anthropic']);
export const chatOptions = z.object({
  title: z.string().trim().min(1).max(160).default('New chat'),
  provider: agentProvider.default('codex'), model: z.string().trim().max(160).default(''),
  projectId: z.string().uuid().nullable().default(null),
  contextMode: z.enum(['auto', 'none']).default('auto'),
  allowEdits: z.boolean().default(true),
}).strict();
// A partial update must not materialize creation defaults (notably projectId=null).
export const chatPatch = z.object(Object.fromEntries(Object.entries(chatOptions.shape).map(([key,schema])=>[key,schema.unwrap().optional()]))).extend({archived:z.boolean().optional(),pinned:z.boolean().optional(),draft:z.string().max(16000).optional()}).strict();
const now = () => new Date().toISOString();
const decode = row => row ? JSON.parse(row.body) : null;

/** Chat and action journals are separate from exportable artwork and credentials. */
export class AgentStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS agent_chats (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_runs (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, chat_id TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_runs_chat ON agent_runs(chat_id, seq);
      CREATE TABLE IF NOT EXISTS agent_actions (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, run_id TEXT NOT NULL, body TEXT NOT NULL);`);
    this.migrate();
    for (const row of db.prepare("SELECT body FROM agent_runs WHERE json_extract(body,'$.status')='running'").all()) {
      const run = decode(row);
      this.saveRun({ ...run, status: 'interrupted', error: 'The app closed during this reply. Your work is saved; send a new message to continue.', endedAt: now() });
    }
    for (const row of db.prepare("SELECT body FROM agent_actions WHERE json_extract(body,'$.status')='applying'").all()) {
      this.saveAction({ ...decode(row), status: 'unknown', error: 'The app closed during this action. Check the project or wallet activity before trying again.' });
    }
  }
  migrate() {
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_turns'").get()) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of this.db.prepare('SELECT body FROM assistant_turns ORDER BY created_at, rowid').all()) {
        const old = decode(row);
        if (this.db.prepare('SELECT id FROM agent_runs WHERE id=?').get(old.id)) continue;
        let chat = decode(this.db.prepare("SELECT body FROM agent_chats WHERE json_extract(body,'$.legacyScope')=?").get(old.scope));
        if (!chat) {
          const projectId = old.scope.split(':').slice(1).join(':');
          // The old checkbox only attached a snapshot to that reply. Its default
          // false is not a request to deny the new agent's workspace tools.
          chat = { ...this.create({ title: old.prompt.slice(0, 90), provider: old.provider, projectId: z.string().uuid().safeParse(projectId).success ? projectId : null }), legacyScope: old.scope };
          this.saveChat(chat);
        }
        this.insertRun({ id: old.id, chatId: chat.id, provider: old.provider, model: '', prompt: old.prompt, reply: old.reply, status: old.status, error: old.error, context: null, events: [], createdAt: old.createdAt });
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  create(input = {}) {
    const chat = { id: randomUUID(), ...chatOptions.parse(input), archived: false, pinned: false, draft: '', createdAt: now(), updatedAt: now() };
    this.db.prepare('INSERT INTO agent_chats VALUES (?,?)').run(chat.id, JSON.stringify(chat));
    return chat;
  }
  chat(id) { const item = decode(this.db.prepare('SELECT body FROM agent_chats WHERE id=?').get(id)); if (!item) throw Error('Chat not found.'); return item; }
  saveChat(chat) { this.db.prepare('UPDATE agent_chats SET body=? WHERE id=?').run(JSON.stringify(chat), chat.id); return chat; }
  update(id, fields) {
    const allowed = chatPatch.parse(fields);
    const chat = this.chat(id);
    if (this.running(id) && Object.keys(allowed).some(key => key !== 'draft' && key !== 'pinned' && key !== 'title')) throw Error('Stop the running reply before changing its connection, context, or archive status.');
    if (allowed.projectId !== undefined && allowed.projectId !== chat.projectId && this.history(id).runs.length) throw Error('Start a new chat for a different project. This keeps project context separate.');
    return this.saveChat({ ...chat, ...allowed, updatedAt: Object.keys(allowed).some(key=>key!=='draft') ? now() : chat.updatedAt });
  }
  list({ archived = false, search = '', offset = 0 } = {}) {
    const words = search.trim().toLowerCase();
    const chats = this.db.prepare('SELECT body FROM agent_chats').all().map(decode).filter(chat => chat.archived === archived && (!words || chat.title.toLowerCase().includes(words) || this.search(chat.id, search).length > 0));
    chats.sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
    return { total: chats.length, chats: chats.slice(offset, offset + 100).map(chat => ({ ...chat, running: this.running(chat.id)?.id ?? null })) };
  }
  running(id) { return decode(this.db.prepare("SELECT body FROM agent_runs WHERE chat_id=? AND json_extract(body,'$.status')='running' LIMIT 1").get(id)); }
  history(id, before = Number.MAX_SAFE_INTEGER) {
    this.chat(id);
    const rows = this.db.prepare('SELECT seq,body FROM agent_runs WHERE chat_id=? AND seq<? ORDER BY seq DESC LIMIT 31').all(id, before);
    return { runs: rows.slice(0,30).reverse().map(row => ({ ...decode(row), seq: row.seq, actions: this.actions(decode(row).id) })), nextBefore: rows.length > 30 ? rows[29].seq : null };
  }
  search(id, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.db.prepare("SELECT body FROM agent_runs WHERE chat_id=? AND instr(lower(json_extract(body,'$.prompt') || ' ' || json_extract(body,'$.reply')),?)>0 ORDER BY seq DESC LIMIT 8").all(id, needle).map(decode);
  }
  insertRun(run) { this.db.prepare('INSERT INTO agent_runs(id,chat_id,body) VALUES (?,?,?)').run(run.id, run.chatId, JSON.stringify(run)); return run; }
  begin(id, prompt, context) {
    const chat = this.chat(id);
    if (chat.archived) throw Error('Restore this chat to continue.');
    if (this.running(id)) throw Error('This chat already has a running reply.');
    const run = this.insertRun({ id: randomUUID(), chatId: id, provider: chat.provider, model: chat.model, prompt, reply: '', status: 'running', error: null, context, events: [], createdAt: now() });
    this.saveChat({ ...chat, draft: '', title: chat.title === 'New chat' ? prompt.slice(0, 90) : chat.title, updatedAt: now() });
    return run;
  }
  run(id) { const value = decode(this.db.prepare('SELECT body FROM agent_runs WHERE id=?').get(id)); if (!value) throw Error('Reply not found.'); return value; }
  saveRun(run) { this.db.prepare('UPDATE agent_runs SET body=? WHERE id=?').run(JSON.stringify(run), run.id); return run; }
  action(run, kind, title, payload) {
    const item = { id: randomUUID(), chatId: run.chatId, runId: run.id, kind, title, payload, status: 'pending', createdAt: now() };
    this.db.prepare('INSERT INTO agent_actions VALUES (?,?,?,?)').run(item.id, item.chatId, item.runId, JSON.stringify(item));
    return item;
  }
  getAction(id) { const item = decode(this.db.prepare('SELECT body FROM agent_actions WHERE id=?').get(id)); if (!item) throw Error('Action not found.'); return item; }
  saveAction(item) { this.db.prepare('UPDATE agent_actions SET body=? WHERE id=?').run(JSON.stringify(item), item.id); return item; }
  actions(runId) { return this.db.prepare('SELECT body FROM agent_actions WHERE run_id=? ORDER BY rowid').all(runId).map(decode); }
}
