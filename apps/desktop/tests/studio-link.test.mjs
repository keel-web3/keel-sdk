import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceStore } from '../src/workspace.mjs';
import { StudioLink, agentSetupCommands, studioAddress, studioContractUrl } from '../src/studio-link.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { createAgentTools } from '../src/agent-tools.mjs';

const ORIGIN = 'http://localhost:3000';
const TOKEN = `keel_agent_${'Ab3_'.repeat(10)}`;
const POLL_TOKEN = 'poll-secret-0123456789abcdefghij';
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function keychain() {
  const value = { on: true, available: () => value.on, encrypt: (text) => Buffer.from(`os-wrapped:${[...text].reverse().join('')}`), decrypt: (bytes) => { const text = Buffer.from(bytes).toString(); if (!text.startsWith('os-wrapped:')) throw new Error('bad'); return [...text.slice(11)].reverse().join(''); } };
  return value;
}

/** A fake Studio: answers pairing, polling and MCP calls, and records every request. */
function studio({ origin = ORIGIN, start = {}, polls = [], tools = {}, mcpStatus = 200 } = {}) {
  const calls = [];
  const queue = [...polls];
  const fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, init, body });
    assert.equal(init.redirect, 'error', 'the editor never follows redirects with Studio secrets');
    if (url === `${origin}/api/agent/pair`) return typeof start === 'function' ? start() : json(start.status ?? 201, start.body ?? { code: 'ABCD-EFGH', pollToken: POLL_TOKEN, expiresAt: new Date(Date.now() + 600_000).toISOString(), interval: 2, approveUrl: `${origin}/studio/connect?code=ABCD-EFGH`, pollUrl: `${origin}/api/agent/pair/poll` });
    if (url.endsWith('/api/agent/pair/poll')) return queue.shift() ?? json(202, { status: 'pending' });
    if (url === `${origin}/api/mcp`) {
      if (mcpStatus !== 200) return json(mcpStatus, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
      const tool = tools[body.params.name];
      if (!tool) return json(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `Unknown tool: ${body.params.name}.` }], isError: true } });
      return json(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(tool(body.params.arguments)) }], isError: false } });
    }
    throw new Error(`Unexpected request to ${url}`);
  };
  return { fetch, calls };
}

const approved = (scopes = ['drafts:read', 'contracts:read']) => json(200, { status: 'approved', token: TOKEN, grant: { id: 'grant-1', label: 'KEEL editor on test-mac', scopes, expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString() }, studioUrl: ORIGIN, mcpUrl: `${ORIGIN}/api/mcp`, bridgeQueue: '/api/bridge/jobs' });

function setup(fake, options = {}) {
  const store = new WorkspaceStore(':memory:');
  const opened = [];
  const link = new StudioLink({ db: store.db, keychain: options.keychain ?? keychain(), fetch: fake.fetch, openExternal: async (url) => { opened.push(url); }, hostname: 'test-mac', sleep: options.sleep ?? (async () => {}), now: options.now ?? Date.now });
  return { store, link, opened };
}

test('pairing shows a code, opens Studio’s approval page, and keeps the key wrapped by the OS keychain', async () => {
  const fake = studio({ polls: [json(202, { status: 'pending' }), json(202, { status: 'pending' }), approved()] });
  const { store, link, opened } = setup(fake);
  try {
    const started = await link.start(ORIGIN);
    assert.equal(started.pairing.code, 'ABCD-EFGH');
    assert.equal(started.pairing.state, 'waiting');
    assert.deepEqual(opened, [`${ORIGIN}/studio/connect?code=ABCD-EFGH`]);
    assert.deepEqual(fake.calls[0].body, { client: 'keel-editor', label: 'KEEL editor on test-mac', scopes: ['drafts:read', 'drafts:create', 'contracts:read'] });
    await link.pairing.done;
    const status = link.status();
    assert.equal(status.pairing.state, 'connected');
    assert.deepEqual(status.connection.scopes, ['drafts:read', 'contracts:read'], 'the creator may narrow what the editor asked for');
    assert.equal(status.connection.label, 'KEEL editor on test-mac');
    assert.equal(status.connection.mcpUrl, `${ORIGIN}/api/mcp`);
    const polls = fake.calls.filter((call) => call.url.endsWith('/poll'));
    assert.equal(polls.length, 3);
    for (const call of polls) assert.deepEqual(call.body, { pollToken: POLL_TOKEN });

    const visible = JSON.stringify(status);
    assert.ok(!visible.includes(TOKEN) && !visible.includes(POLL_TOKEN), 'the renderer never sees the key or the poll token');
    const row = store.db.prepare('SELECT wrapped FROM studio_link').get();
    assert.match(Buffer.from(row.wrapped).toString(), /^os-wrapped:/u);
    const everywhere = [store.db.prepare('SELECT body FROM workspace').get().body, ...store.db.prepare('SELECT * FROM studio_link').all().map((item) => JSON.stringify({ ...item, wrapped: Buffer.from(item.wrapped).toString() }))].join('\n');
    assert.ok(!everywhere.includes(TOKEN), 'the key is stored only wrapped');
    assert.ok(!store.db.prepare('SELECT body FROM workspace').get().body.includes('studio_link'));
  } finally { store.close(); }
});

test('addresses Studio sends are only opened or posted to on the same Studio origin', async () => {
  assert.equal(studioAddress(`${ORIGIN}/studio/connect?code=X`, ORIGIN), `${ORIGIN}/studio/connect?code=X`);
  assert.throws(() => studioAddress('https://evil.example/studio/connect', ORIGIN), /different site/);
  assert.throws(() => studioAddress('http://studio.example/x', 'http://studio.example'), /different site/, 'plain http only on this computer');
  assert.throws(() => studioAddress('https://user:pass@studio.example/x', 'https://studio.example'), /different site/);
  assert.equal(studioContractUrl('https://studio.example', 8453, '0xABCDEFabcdef0123456789012345678901234567', 'rules'), 'https://studio.example/studio/contracts?contract=8453:0xabcdefabcdef0123456789012345678901234567&tab=rules');
  assert.throws(() => studioContractUrl('https://studio.example', 1, '0x1234567890123456789012345678901234567890', 'wallet'), /Unknown Studio contract tab/);

  // A foreign approval page is not opened; the code is still shown with plain instructions.
  const foreignApprove = studio({ start: { body: { code: 'WXYZ-2345', pollToken: POLL_TOKEN, expiresAt: new Date(Date.now() + 60_000).toISOString(), interval: 2, approveUrl: 'https://evil.example/approve', pollUrl: `${ORIGIN}/api/agent/pair/poll` } }, polls: [json(410, { status: 'denied' })] });
  const one = setup(foreignApprove);
  try {
    const started = await one.link.start(ORIGIN);
    assert.deepEqual(one.opened, []);
    assert.equal(started.pairing.opened, false);
    assert.match(started.pairing.message, /studio\/connect in your browser and enter the code/);
    await one.link.pairing.done;
  } finally { one.store.close(); }

  // A foreign poll address would receive the poll token, so the pairing is refused outright.
  const foreignPoll = studio({ start: { body: { code: 'WXYZ-2345', pollToken: POLL_TOKEN, expiresAt: new Date(Date.now() + 60_000).toISOString(), interval: 2, approveUrl: `${ORIGIN}/studio/connect`, pollUrl: 'https://evil.example/poll' } } });
  const two = setup(foreignPoll);
  try {
    await assert.rejects(two.link.start(ORIGIN), /different site/);
    assert.equal(foreignPoll.calls.length, 1);
    assert.equal(two.link.status().pairing, null);
  } finally { two.store.close(); }
});

test('denied, expired, cancelled, rate-limited and offline pairings stop with plain messages', async () => {
  const denied = setup(studio({ polls: [json(410, { status: 'denied' })] }));
  try {
    await denied.link.start(ORIGIN); await denied.link.pairing.done;
    assert.equal(denied.link.status().pairing.state, 'denied');
    assert.match(denied.link.status().pairing.message, /declined/);
    assert.equal(denied.link.connection(), null);
  } finally { denied.store.close(); }

  let clock = Date.now();
  const expiringFake = studio();
  const expiring = setup(expiringFake, { now: () => clock, sleep: async () => { clock += 700_000; } });
  try {
    await expiring.link.start(ORIGIN); await expiring.link.pairing.done;
    assert.equal(expiring.link.status().pairing.state, 'expired');
    assert.ok(expiringFake.calls.filter((call) => call.url.endsWith('/poll')).length <= 1, 'polling stops at the expiry');
  } finally { expiring.store.close(); }

  let release;
  const cancelledFake = studio();
  const cancelled = setup(cancelledFake, { sleep: () => new Promise((resolve) => { release = resolve; }) });
  try {
    await cancelled.link.start(ORIGIN);
    cancelled.link.cancel();
    release(); await cancelled.link.pairing.done;
    assert.equal(cancelled.link.status().pairing.state, 'cancelled');
    assert.equal(cancelledFake.calls.filter((call) => call.url.endsWith('/poll')).length, 0, 'no poll after cancelling');
  } finally { cancelled.store.close(); }

  const limited = setup(studio({ start: { status: 429, body: { error: 'Too many requests.' } } }));
  try { await assert.rejects(limited.link.start(ORIGIN), /limiting connection requests/); } finally { limited.store.close(); }

  const offline = setup({ fetch: async () => { throw new TypeError('fetch failed'); } });
  try { await assert.rejects(offline.link.start(ORIGIN), /Couldn’t reach Studio/); } finally { offline.store.close(); }

  const noKeychain = keychain(); noKeychain.on = false;
  const locked = setup(studio(), { keychain: noKeychain });
  try { await assert.rejects(locked.link.start(ORIGIN), /keychain isn’t available/); } finally { locked.store.close(); }

  const badKey = setup(studio({ polls: [json(200, { status: 'approved', token: 'not-a-key', grant: { id: 'g', label: 'x', scopes: ['drafts:read'], expiresAt: new Date(Date.now() + 1e6).toISOString() } })] }));
  try {
    await badKey.link.start(ORIGIN); await badKey.link.pairing.done;
    assert.equal(badKey.link.status().pairing.state, 'failed');
    assert.equal(badKey.link.connection(), null);
  } finally { badKey.store.close(); }
});

test('Studio is read through its MCP endpoint with the saved key; results never carry the key', async () => {
  const contracts = [{ chainId: 11155111, address: '0x3333333333333333333333333333333333333333', name: 'Night Seeds', family: 'creator-collection', standard: 'erc721', category: 'Drops', tags: ['seeds'], archived: false, collections: [{ key: 'factory:4', name: 'Night Seeds', kind: 'factory-collection', id: '4', tokenIds: null }], reviewUrl: `${ORIGIN}/studio/contracts?contract=11155111:0x3333333333333333333333333333333333333333` },
    { chainId: 1, address: '0x4444444444444444444444444444444444444444', name: 'Elsewhere', tags: [], collections: [], reviewUrl: 'https://evil.example/x' }];
  const fake = studio({ polls: [approved(['drafts:read', 'contracts:read'])], tools: {
    keel_workspace: () => ({ projects: [{ id: 'p1', name: 'Spring drop', status: 'draft', chainId: 8453, kind: 'collection', reviewUrl: `${ORIGIN}/studio/projects` }], releases: [{ id: 'r1', slug: 'spring', title: 'Spring', type: 'edition', status: 'draft', chainId: 8453, reviewUrl: `${ORIGIN}/release/spring` }] }),
    keel_contracts: (args) => ({ count: contracts.length, contracts: args.query ? contracts.filter((item) => item.name.toLowerCase().includes(args.query)) : contracts }),
  } });
  const { store, link } = setup(fake);
  try {
    await link.start(ORIGIN); await link.pairing.done;
    const overview = await link.overview();
    const mcp = fake.calls.filter((call) => call.url === `${ORIGIN}/api/mcp`);
    assert.equal(mcp.length, 2);
    for (const call of mcp) {
      assert.equal(call.init.headers.authorization, `Bearer ${TOKEN}`);
      assert.equal(call.body.jsonrpc, '2.0'); assert.equal(call.body.method, 'tools/call');
    }
    assert.deepEqual(overview.projects.map((item) => item.name), ['Spring drop']);
    assert.equal(overview.releases[0].reviewUrl, `${ORIGIN}/release/spring`);
    assert.equal(overview.contracts[0].reviewUrl, contracts[0].reviewUrl);
    assert.equal(overview.contracts[1].reviewUrl, undefined, 'links to other sites are dropped');
    assert.ok(!JSON.stringify(overview).includes(TOKEN));
    assert.deepEqual((await link.overview({ query: 'night' })).contracts.map((item) => item.name), ['Night Seeds']);
    await assert.rejects(link.tool('keel_create_draft'), /Unknown tool/);

    const revealed = link.revealToken();
    assert.equal(revealed.token, TOKEN);
    assert.ok(revealed.commands.some((step) => step.code === `claude mcp add --transport http keel ${ORIGIN}/api/mcp --header "Authorization: Bearer ${TOKEN}"`));
    assert.ok(revealed.commands.some((step) => step.code === `codex mcp add keel --url ${ORIGIN}/api/mcp --bearer-token-env-var KEEL_AGENT_TOKEN`));
    assert.throws(() => agentSetupCommands(`${ORIGIN}/api/mcp`, 'nope'), /isn’t a KEEL agent key/);

    // The assistant reads the same overview through a read-only tool, with contract identities kept.
    const chats = new AgentStore(store.db);
    const chat = chats.create({});
    const hooks = { workRoot: '/tmp/keel-agent-test-tools', view: () => ({ page: 'Connections' }), networks: () => [], wallets: () => [], readKey: () => { throw Error('no'); }, studioOverview: (query) => link.overview(query ? { query } : {}) };
    const tools = createAgentTools({ workspace: store, chats, chat, run: chats.begin(chat.id, 'What is in my Studio?', null), hooks, signal: new AbortController().signal, emit: () => {} });
    assert.ok(!tools.some((tool) => /send|approve|sign/.test(tool.name)));
    const read = JSON.parse(await tools.find((tool) => tool.name === 'keel_studio_workspace').invoke({}));
    assert.equal(read.contracts[0].studioContract, '11155111:0x3333333333333333333333333333333333333333');
    assert.ok(!JSON.stringify(read).includes(TOKEN));

    link.disconnect();
    assert.equal(link.connection(), null);
    await assert.rejects(link.overview(), /Connect to Studio first/);
  } finally { store.close(); }
});

test('a revoked key, a missing permission and an unavailable keychain are explained, not guessed around', async () => {
  const revoked = studio({ polls: [approved(['drafts:read'])], mcpStatus: 401 });
  const one = setup(revoked);
  try {
    await one.link.start(ORIGIN); await one.link.pairing.done;
    const overview = await one.link.overview();
    assert.match(overview.workspaceUnavailable, /revoked or expired/);
    assert.match(overview.contractsUnavailable, /wasn’t given “See your contracts and collections”/);
    assert.equal(revoked.calls.filter((call) => call.url.endsWith('/api/mcp')).length, 1, 'no call is made for a permission the connection lacks');
  } finally { one.store.close(); }

  const keys = keychain();
  const two = setup(studio({ polls: [approved()] }), { keychain: keys });
  try {
    await two.link.start(ORIGIN); await two.link.pairing.done;
    keys.on = false;
    assert.throws(() => two.link.revealToken(), /keychain isn’t available/);
    keys.on = true;
    two.store.db.prepare('UPDATE studio_link SET wrapped=?').run(Buffer.from('garbage'));
    assert.throws(() => two.link.revealToken(), /couldn’t be unwrapped/);
  } finally { two.store.close(); }
});
