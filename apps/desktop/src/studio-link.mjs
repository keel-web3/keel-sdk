// "Connect to Studio": device-style pairing with a KEEL Studio, then read-only
// use of Studio's remote MCP endpoint (POST {studio}/api/mcp, JSON-RPC 2.0).
//
// The Studio agent key is returned exactly once when the creator approves. It
// is wrapped by the operating system (Electron safeStorage) and kept in the
// workspace database's studio_link table: never in the workspace JSON, an
// export, a log or assistant context. It leaves the main process only when
// the creator explicitly asks to see it (to set up Claude Code or Codex).
// Nothing here logs.
import { randomUUID } from 'node:crypto';
import { hostname as osHostname } from 'node:os';

export const STUDIO_LINK_SCOPES = ['drafts:read', 'drafts:create', 'contracts:read'];
/** Studio's own words for each permission (keel-site lib/agent-draft-scope). */
export const STUDIO_SCOPE_LABELS = {
  'drafts:read': 'See your projects and drafts',
  'drafts:create': 'Create new drafts',
  'drafts:write': 'Edit drafts',
  'contracts:read': 'See your contracts and collections',
  'bridge:serve': 'Answer Studio’s AI requests with your own Claude or Codex',
};
export const STUDIO_CONTRACT_TABS = ['overview', 'collections', 'rules', 'admin', 'signers'];

const TOKEN = /^keel_agent_[A-Za-z0-9_-]{20,180}$/u;
const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/u;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
const MCP_PROTOCOL_VERSION = '2025-06-18';

/** An address the editor may open or send to: https, or http on this computer, on exactly the Studio origin. */
export function studioAddress(value, origin) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('Studio sent an address the editor can’t use.'); }
  const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL.has(url.hostname));
  if (!allowed || url.username || url.password || url.origin !== origin) throw new Error('Studio sent an address on a different site; the editor won’t follow it.');
  return url.href;
}

/** Studio's contracts page for one contract, on a given tab. */
export function studioContractUrl(origin, chainId, address, tab = 'overview') {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !/^0x[0-9a-fA-F]{40}$/u.test(String(address))) throw new TypeError('A chain id and contract address are required.');
  if (!STUDIO_CONTRACT_TABS.includes(tab)) throw new TypeError('Unknown Studio contract tab.');
  return `${origin}/studio/contracts?contract=${chainId}:${String(address).toLowerCase()}&tab=${tab}`;
}

/** The copy-and-paste setup Studio shows for Claude Code and Codex (keel-site lib/agent-connect-commands). */
export function agentSetupCommands(mcpUrl, token) {
  if (!TOKEN.test(token)) throw new TypeError('That isn’t a KEEL agent key.');
  return [
    { client: 'Claude Code', title: 'Run this in your terminal', code: `claude mcp add --transport http keel ${mcpUrl} --header "Authorization: Bearer ${token}"` },
    { client: 'Claude Code', title: 'Then check it’s connected', code: 'claude mcp list' },
    { client: 'Codex', title: 'Save the key where Codex can read it', code: `export KEEL_AGENT_TOKEN=${token}`, note: 'Add this line to your shell profile (~/.zshrc or ~/.bashrc) to keep it.' },
    { client: 'Codex', title: 'Add KEEL to Codex', code: `codex mcp add keel --url ${mcpUrl} --bearer-token-env-var KEEL_AGENT_TOKEN` },
  ];
}

async function readJson(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error('Studio sent more data than expected.'); }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { throw new Error('Studio sent an answer the editor couldn’t read.'); }
}

const plainError = (body, fallback) => typeof body?.error === 'string' ? body.error.slice(0, 300) : fallback;
const OFFLINE = 'Couldn’t reach Studio. Check that it is running at this address and try again.';
const ENDED = {
  denied: 'You declined this connection in Studio. Nothing was connected.',
  expired: 'The code expired before it was approved. Start again to get a new code.',
  collected: 'This approval was already used. Start again to connect.',
};

/**
 * @typedef {{ available(): boolean, encrypt(text: string): Uint8Array, decrypt(bytes: Uint8Array): string }} Keychain
 */
export class StudioLink {
  /**
   * @param {{ db: import('node:sqlite').DatabaseSync, keychain: Keychain, fetch?: typeof fetch, openExternal?: (url: string) => Promise<unknown>, hostname?: string, now?: () => number, sleep?: (ms: number) => Promise<void> }} options
   */
  constructor({ db, keychain, fetch: fetcher = globalThis.fetch, openExternal = async () => {}, hostname = osHostname(), now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.db = db;
    this.keychain = keychain;
    this.fetch = fetcher;
    this.openExternal = openExternal;
    this.hostname = hostname;
    this.now = now;
    this.sleep = sleep;
    this.pairing = undefined;
    this.requestId = 0;
    db.exec('CREATE TABLE IF NOT EXISTS studio_link (id INTEGER PRIMARY KEY CHECK (id=1), origin TEXT NOT NULL, wrapped BLOB NOT NULL, grant_json TEXT NOT NULL, mcp_url TEXT NOT NULL, studio_url TEXT NOT NULL, bridge_queue TEXT, connected_at TEXT NOT NULL)');
  }

  keychainAvailable() {
    try { return Boolean(this.keychain?.available()); } catch { return false; }
  }

  /** What the renderer may know: the code while waiting, and the connection's public facts. Never a token. */
  status() {
    const pairing = this.pairing && { code: this.pairing.code, studio: this.pairing.origin, approveUrl: this.pairing.approveUrl, opened: this.pairing.opened, expiresAt: this.pairing.expiresAt, state: this.pairing.state, ...(this.pairing.message ? { message: this.pairing.message } : {}) };
    return { keychain: this.keychainAvailable(), pairing: pairing ?? null, connection: this.connection() };
  }

  connection() {
    const row = this.db.prepare('SELECT origin, grant_json, mcp_url, studio_url, bridge_queue, connected_at FROM studio_link WHERE id=1').get();
    if (!row) return null;
    const grant = JSON.parse(row.grant_json);
    return { studio: row.origin, studioUrl: row.studio_url, mcpUrl: row.mcp_url, label: grant.label, scopes: grant.scopes, scopeLabels: grant.scopes.map((scope) => STUDIO_SCOPE_LABELS[scope] ?? scope), grantId: grant.id, expiresAt: grant.expiresAt, expired: Date.parse(grant.expiresAt) <= this.now(), connectedAt: row.connected_at };
  }

  /**
   * Asks Studio for a pairing code, opens its approval page in the browser
   * and starts polling in the background. The poll token stays in memory.
   * @param {string} origin the configured Studio origin
   */
  async start(origin) {
    if (!this.keychainAvailable()) throw new Error('This computer’s keychain isn’t available, so the editor can’t keep a Studio key safely. Connect your AI agent from Studio instead.');
    this.cancel();
    let response;
    try {
      response = await this.fetch(`${origin}/api/agent/pair`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client: 'keel-editor', label: `KEEL editor on ${this.hostname}`.slice(0, 80), scopes: STUDIO_LINK_SCOPES }) });
    } catch { throw new Error(OFFLINE); }
    const body = await readJson(response, 64_000).catch(() => undefined);
    if (response.status === 429) throw new Error('Studio is limiting connection requests. Wait a minute and try again.');
    if (response.status !== 201 || !body) throw new Error(plainError(body, `Studio couldn’t start a connection (HTTP ${response.status}).`));
    if (typeof body.code !== 'string' || !CODE.test(body.code) || typeof body.pollToken !== 'string' || body.pollToken.length < 16 || body.pollToken.length > 512) throw new Error('Studio sent a connection code the editor can’t use.');
    const expiresAt = Date.parse(body.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error('Studio sent a code that has already expired.');
    // The poll token goes only to Studio's own poll address.
    const pollUrl = studioAddress(body.pollUrl, origin);
    let approveUrl;
    try { approveUrl = studioAddress(body.approveUrl, origin); } catch { approveUrl = undefined; }
    const interval = Math.min(30, Math.max(1, Number.isFinite(body.interval) ? Math.round(body.interval) : 2));
    const pairing = { id: randomUUID(), origin, code: body.code, pollToken: body.pollToken, pollUrl, approveUrl: approveUrl ?? `${origin}/studio/connect`, opened: false, expiresAt: new Date(expiresAt).toISOString(), interval, state: 'waiting' };
    this.pairing = pairing;
    if (approveUrl) {
      try { await this.openExternal(approveUrl); pairing.opened = true; } catch { pairing.opened = false; }
    } else pairing.message = `Open ${origin}/studio/connect in your browser and enter the code.`;
    pairing.done = this.#poll(pairing);
    return this.status();
  }

  cancel() {
    if (this.pairing?.state === 'waiting') { this.pairing.state = 'cancelled'; this.pairing.message = 'Cancelled. Nothing was connected.'; }
    if (this.pairing) delete this.pairing.pollToken;
  }

  #finish(pairing, state, message) {
    pairing.state = state;
    if (message) pairing.message = message; else delete pairing.message;
    delete pairing.pollToken;
  }

  async #poll(pairing) {
    let failures = 0;
    while (this.pairing === pairing && pairing.state === 'waiting') {
      if (this.now() >= Date.parse(pairing.expiresAt)) return this.#finish(pairing, 'expired', ENDED.expired);
      await this.sleep(pairing.interval * 1000);
      if (this.pairing !== pairing || pairing.state !== 'waiting') return;
      let response;
      try {
        response = await this.fetch(pairing.pollUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ pollToken: pairing.pollToken }) });
      } catch {
        failures += 1;
        pairing.message = failures >= 3 ? 'Can’t reach Studio right now; still trying until the code expires.' : undefined;
        continue;
      }
      failures = 0;
      const body = await readJson(response, 64_000).catch(() => undefined);
      if (this.pairing !== pairing || pairing.state !== 'waiting') return;
      if (response.status === 202) { delete pairing.message; continue; }
      if (response.status === 429) { await this.sleep(pairing.interval * 1000); continue; }
      if (response.status === 410) return this.#finish(pairing, ENDED[body?.status] ? body.status : 'expired', ENDED[body?.status] ?? ENDED.expired);
      if (response.status === 200 && body?.status === 'approved') {
        try { this.#save(pairing.origin, body); } catch (error) { return this.#finish(pairing, 'failed', error instanceof Error ? error.message : 'Studio’s approval couldn’t be saved.'); }
        return this.#finish(pairing, 'connected');
      }
      return this.#finish(pairing, 'failed', plainError(body, `Studio answered HTTP ${response.status}. Start again.`));
    }
  }

  #save(origin, body) {
    if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw new Error('Studio’s approval didn’t include a usable key. Start again.');
    const grant = body.grant ?? {};
    const scopes = Array.isArray(grant.scopes) ? grant.scopes.filter((scope) => typeof scope === 'string' && scope.length <= 32).slice(0, 8) : [];
    if (typeof grant.id !== 'string' || !grant.id || !scopes.length || !Number.isFinite(Date.parse(grant.expiresAt))) throw new Error('Studio’s approval was incomplete. Start again.');
    const mcpUrl = studioAddress(body.mcpUrl ?? `${origin}/api/mcp`, origin);
    const studioUrl = studioAddress(body.studioUrl ?? origin, origin);
    const bridgeQueue = typeof body.bridgeQueue === 'string' && /^\/[A-Za-z0-9/_-]{0,199}$/u.test(body.bridgeQueue) ? body.bridgeQueue : null;
    const wrapped = this.keychain.encrypt(body.token);
    const record = { id: grant.id.slice(0, 120), label: String(grant.label ?? '').slice(0, 120), scopes, expiresAt: new Date(Date.parse(grant.expiresAt)).toISOString() };
    this.db.prepare('INSERT INTO studio_link VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET origin=excluded.origin, wrapped=excluded.wrapped, grant_json=excluded.grant_json, mcp_url=excluded.mcp_url, studio_url=excluded.studio_url, bridge_queue=excluded.bridge_queue, connected_at=excluded.connected_at')
      .run(origin, Buffer.from(wrapped), JSON.stringify(record), mcpUrl, studioUrl, bridgeQueue, new Date(this.now()).toISOString());
  }

  /** Forgets the key on this computer. Revoking it is done in Studio. */
  disconnect() {
    this.cancel();
    this.db.prepare('DELETE FROM studio_link WHERE id=1').run();
    return { disconnected: true };
  }

  #token() {
    const row = this.db.prepare('SELECT wrapped FROM studio_link WHERE id=1').get();
    if (!row) throw new Error('Connect to Studio first.');
    if (!this.keychainAvailable()) throw new Error('This computer’s keychain isn’t available, so the Studio key can’t be used right now.');
    let token;
    try { token = this.keychain.decrypt(new Uint8Array(row.wrapped)); } catch { throw new Error('The saved Studio key couldn’t be unwrapped. Disconnect and connect again.'); }
    if (!TOKEN.test(token)) throw new Error('The saved Studio key is damaged. Disconnect and connect again.');
    return token;
  }

  /** Only when the creator asks: the key and Studio's setup commands for Claude Code and Codex. */
  revealToken() {
    const connection = this.connection();
    if (!connection) throw new Error('Connect to Studio first.');
    const token = this.#token();
    return { token, mcpUrl: connection.mcpUrl, commands: agentSetupCommands(connection.mcpUrl, token) };
  }

  /** One JSON-RPC call to Studio's MCP endpoint with the saved key. */
  async rpc(method, params = {}) {
    const connection = this.connection();
    if (!connection) throw new Error('Connect to Studio first.');
    if (connection.expired) throw new Error('This Studio connection has expired. Disconnect and connect again.');
    const token = this.#token();
    let response;
    try {
      response = await this.fetch(connection.mcpUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': MCP_PROTOCOL_VERSION }, body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }) });
    } catch { throw new Error(OFFLINE); }
    const body = await readJson(response, 4_000_000);
    if (response.status === 401 || response.status === 403) throw new Error('Studio no longer accepts this connection (it was revoked or expired). Disconnect and connect again.');
    if (response.status === 429) throw new Error('Studio is limiting requests. Try again in a few seconds.');
    if (!response.ok || !body) throw new Error(typeof body?.error?.message === 'string' ? body.error.message.slice(0, 300) : `Studio answered HTTP ${response.status}.`);
    if (body.error) throw new Error(typeof body.error.message === 'string' ? body.error.message.slice(0, 300) : 'Studio refused the request.');
    return body.result;
  }

  /** Calls one Studio tool and returns its JSON result. */
  async tool(name, args = {}) {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const text = result?.content?.find?.((item) => item?.type === 'text')?.text;
    if (result?.isError) throw new Error(typeof text === 'string' ? text.slice(0, 300) : `Studio’s ${name} failed.`);
    if (typeof text !== 'string') throw new Error(`Studio’s ${name} returned nothing readable.`);
    try { return JSON.parse(text); } catch { return { text: text.slice(0, 20_000) }; }
  }

  /**
   * The creator's Studio at a glance, read-only: projects and releases
   * (drafts:read) and contracts (contracts:read), each with its review link.
   * Parts the connection may not read are reported, not guessed.
   */
  async overview({ query } = {}) {
    const connection = this.connection();
    if (!connection) throw new Error('Connect to Studio first.');
    const can = (scope) => connection.scopes.includes(scope);
    const part = async (scope, read) => {
      if (!can(scope)) return { unavailable: `This connection wasn’t given “${STUDIO_SCOPE_LABELS[scope]}”.` };
      try { return await read(); } catch (error) { return { unavailable: error instanceof Error ? error.message : String(error) }; }
    };
    const [workspace, contracts] = await Promise.all([
      part('drafts:read', () => this.tool('keel_workspace')),
      part('contracts:read', () => this.tool('keel_contracts', query ? { query: String(query).slice(0, 120) } : {})),
    ]);
    const safeLink = (value) => { try { return studioAddress(value, connection.studio); } catch { return undefined; } };
    const projects = (workspace.projects ?? []).slice(0, 100).map((item) => ({ id: String(item.id), name: String(item.name ?? ''), status: item.status ?? null, chainId: item.chainId ?? null, kind: item.kind ?? null, reviewUrl: safeLink(item.reviewUrl) }));
    const releases = (workspace.releases ?? []).slice(0, 100).map((item) => ({ id: String(item.id), title: String(item.title ?? ''), slug: item.slug ?? null, type: item.type ?? null, status: item.status ?? null, chainId: item.chainId ?? null, reviewUrl: safeLink(item.reviewUrl) }));
    const contractList = (contracts.contracts ?? []).slice(0, 200).map((item) => ({ chainId: item.chainId, address: item.address, name: String(item.name ?? ''), family: item.family ?? null, standard: item.standard ?? null, category: item.category ?? null, tags: Array.isArray(item.tags) ? item.tags.slice(0, 24) : [], archived: item.archived === true, collections: Array.isArray(item.collections) ? item.collections.slice(0, 50).map((collection) => ({ key: collection.key, name: collection.name, kind: collection.kind, id: collection.id ?? null, tokenIds: collection.tokenIds ?? null })) : [], reviewUrl: safeLink(item.reviewUrl) }));
    return {
      studio: connection.studio,
      readAt: new Date(this.now()).toISOString(),
      projects, releases, contracts: contractList,
      ...(workspace.unavailable ? { workspaceUnavailable: workspace.unavailable } : {}),
      ...(contracts.unavailable ? { contractsUnavailable: contracts.unavailable } : {}),
    };
  }

  /** Opens a Studio page in the browser, only on the connected (or configured) Studio origin. */
  async open(url, origin = this.connection()?.studio) {
    if (!origin) throw new Error('Connect to Studio first.');
    await this.openExternal(studioAddress(url, origin));
    return { opened: true };
  }
}
