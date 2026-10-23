import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCommand, connectionWindow } from '../dist/connection-cli.js';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer } from '../dist/server.js';
import { importStudioAgentToken } from '../../sdk/dist/studio-connection-node.js';

test('browser launch uses direct platform arguments with no shell', () => {
  const url = 'https://studio.example/studio/connect?code=ABCD-EFGH';
  assert.deepEqual(browserCommand(url, 'darwin'), ['open', [url]]);
  assert.deepEqual(browserCommand(url, 'win32'), ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, 'linux'), ['xdg-open', [url]]);
});
test('local connection window contains public metadata, checks Host and Origin, and never receives the key', async t => {
  const window = await connectionWindow({ status: 'pending', studioUrl: 'https://studio.example', code: 'ABCD-EFGH', approveUrl: 'https://studio.example/studio/connect?code=ABCD-EFGH' });
  t.after(() => window.close());
  const response = await fetch(window.url);
  assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
  const html = await response.text(); assert.doesNotMatch(html, /keel_agent_|pollToken/u);
  assert.match(html, /popup,width=560,height=780/u);
  assert.equal((await fetch(`${window.url}/status`, { headers: { origin: 'https://evil.example' } })).status, 404);
  const badHost = await new Promise(resolve => {
    request(`${window.url}/status`, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).end();
  });
  assert.equal(badHost, 404);
  window.update({ status: 'connected', studioUrl: 'https://studio.example' });
  assert.deepEqual(await (await fetch(`${window.url}/status`)).json(), { status: 'connected', studioUrl: 'https://studio.example' });
});

test('local MCP drafts load the saved connection without a token in environment or tool arguments', async t => {
  const root = await mkdtemp(join(tmpdir(), 'keel-mcp-connect-'));
  const old = { fetch: globalThis.fetch, directory: process.env.KEEL_STUDIO_CREDENTIAL_DIR, token: process.env.KEEL_STUDIO_AGENT_TOKEN, fray: process.env.FRAY_STUDIO_AGENT_TOKEN };
  t.after(async () => {
    globalThis.fetch = old.fetch;
    for (const [key,value] of [['KEEL_STUDIO_CREDENTIAL_DIR',old.directory],['KEEL_STUDIO_AGENT_TOKEN',old.token],['FRAY_STUDIO_AGENT_TOKEN',old.fray]]) { if(value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(root,{recursive:true,force:true});
  });
  delete process.env.KEEL_STUDIO_AGENT_TOKEN; delete process.env.FRAY_STUDIO_AGENT_TOKEN;
  process.env.KEEL_STUDIO_CREDENTIAL_DIR = join(root, 'private');
  const token = `keel_agent_${'C'.repeat(48)}`;
  await importStudioAgentToken(token, { workspace: root });
  let authorization;
  globalThis.fetch = async (url, options) => { authorization = new Headers(options.headers).get('authorization'); return Response.json({ projects: [], releases: [] }); };
  const server = await createMcpServer({workspaceRoot:root,pluginConfig:false});
  await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'fixture',version:'1'}}});
  await server.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const status = await server.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'keel-studio-connect',arguments:{operation:'status'}}});
  assert.ok(!JSON.stringify(status).includes(token));
  const drafts = await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'keel-studio-draft',arguments:{operation:'list'}}});
  assert.equal(drafts.result.isError,undefined);
  assert.equal(authorization,`Bearer ${token}`);
  assert.ok(!JSON.stringify(drafts).includes(token));
});
