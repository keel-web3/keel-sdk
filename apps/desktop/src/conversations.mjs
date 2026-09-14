import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const turn = z.object({ id: z.string().uuid(), scope: z.string().max(200), prompt: z.string().min(1).max(16000), reply: z.string().max(2_000_000), provider: z.enum(['codex','claude','openai','anthropic']), status: z.enum(['running','completed','failed','interrupted']), error: z.string().max(1000).nullable(), includedContext: z.boolean(), createdAt: z.string().datetime() }).strict();

export class ConversationStore {
  constructor(db) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS assistant_turns (id TEXT PRIMARY KEY, scope TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL)');
    // An interrupted run must remain visible, never silently replayed or billed again.
    for (const row of db.prepare('SELECT body FROM assistant_turns').all()) {
      const item = turn.parse(JSON.parse(row.body));
      if (item.status === 'running') this.put({ ...item, status: 'interrupted', error: 'The app closed before this request finished. Retry only if you want another request.' });
    }
  }
  scope(provider, projectId) { return `${provider}:${projectId ?? 'workspace'}`; }
  list(scope) { return this.db.prepare('SELECT body FROM assistant_turns WHERE scope=? ORDER BY created_at DESC, rowid DESC LIMIT 50').all(scope).map((row) => turn.parse(JSON.parse(row.body))).reverse(); }
  put(item) {
    const parsed = turn.parse(item);
    this.db.prepare('INSERT INTO assistant_turns VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(parsed.id, parsed.scope, parsed.createdAt, JSON.stringify(parsed));
    return parsed;
  }
  begin(provider, projectId, prompt, includedContext) {
    const scope = this.scope(provider, projectId);
    if (this.list(scope).some((item) => item.status === 'running')) throw new Error('This conversation already has a running request.');
    return this.put({ id: randomUUID(), scope, provider, prompt, includedContext, reply: '', status: 'running', error: null, createdAt: new Date().toISOString() });
  }
  finish(item, result, error) { return this.put({ ...item, reply: result?.text ?? '', status: error ? 'failed' : 'completed', error: error ? String(error.message ?? error).slice(0, 1000) : null }); }
  context(scope) {
    const selected = []; let length = 0;
    for (const item of this.list(scope).filter((turn) => turn.status === 'completed').reverse()) {
      const text = `Creator: ${item.prompt}\nAssistant: ${item.reply}`;
      if (selected.length >= 10 || length + text.length > 32_000) break;
      selected.unshift(text); length += text.length;
    }
    return selected.join('\n\n');
  }
}
