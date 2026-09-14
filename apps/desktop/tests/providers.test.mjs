import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { AGENT_REPLY_TIMEOUT_MS, advisoryCodexConfig, runApiAgent, runLocalAgent } from '../src/providers.mjs';
test('API request uses fixed provider endpoint, sends no tools and does not retain OpenAI response', async () => {
  const result = await runApiAgent('openai', 'chosen-model', 'test-key', 'Explain my collection', { fetcher: async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.model, 'chosen-model'); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: 'An explanation.' }] }] }));
  } });
  assert.equal(result.text, 'An explanation.');
  await assert.rejects(runApiAgent('untrusted-host', 'm', 'key', 'prompt'), /Unknown API/);
  await assert.rejects(runApiAgent('openai', '', 'key', 'prompt'), /Choose a model/);
});
test('provider errors do not reveal response bodies or credentials', async () => {
  await assert.rejects(runApiAgent('anthropic', 'chosen-model', 'secret', 'prompt', { fetcher: async () => new Response('secret-response', { status: 401 }) }), (error) => /HTTP 401/.test(error.message) && !error.message.includes('secret'));
});
test('local Codex transport handles initialization, streaming and completion without granting approvals', async () => {
  const sent = []; let proc;
  const result = await runLocalAgent('codex', 'Help with this work', '/tmp', { spawnProcess: (command, args, options) => {
    assert.equal(command, 'codex'); assert.deepEqual(args, ['app-server']); assert.equal(options.shell, false);
    proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.stdin = new PassThrough(); proc.exitCode = null; proc.kill = () => { proc.exitCode = 0; return true; };
    proc.stdin.on('data', (chunk) => {
      const msg = JSON.parse(chunk.toString()); sent.push(msg);
      if (msg.id === 1) queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
      if (msg.id === 4) queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: 4, result: { config: { mcp_servers: { mail: { enabled: true } } } } }) + '\n'));
      if (msg.id === 2) { assert.equal(msg.params.sandbox, 'read-only'); assert.equal(msg.params.approvalPolicy, 'never'); assert.equal(msg.params.config['mcp_servers.mail.enabled'], false); assert.equal(msg.params.config['features.shell_tool'], false); queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: 2, result: { thread: { id: 'test' } } }) + '\n')); }
      if (msg.id === 5) queueMicrotask(() => proc.stdout.write(JSON.stringify({ id: 5, result: { data: [], nextCursor: null } }) + '\n'));
      if (msg.id === 3) queueMicrotask(() => {
        proc.stdout.write(JSON.stringify({ id: 99, method: 'item/commandExecution/requestApproval', params: {} }) + '\n');
        proc.stdout.write(JSON.stringify({ method: 'item/agentMessage/delta', params: { delta: 'Reviewable advice.' } }) + '\n');
        proc.stdout.write(JSON.stringify({ method: 'turn/completed', params: { turn: { status: 'completed' } } }) + '\n');
      });
    }); return proc;
  } });
  assert.equal(result.text, 'Reviewable advice.');
  assert.equal(sent.find((item) => item.id === 99).error.code, -32601);
});
test('advisory overrides disable inherited servers and plugins without copying credentials', () => {
  const config = advisoryCodexConfig({ mcp_servers: { team_mail: { http_headers: { authorization: 'secret' } } }, plugins: { 'example@store': { enabled: true } } });
  assert.equal(config['mcp_servers.team_mail.enabled'], false);
  assert.equal(config['plugins.example@store.enabled'], false);
  assert.equal(config['apps._default.enabled'], false);
  assert.ok(!JSON.stringify(config).includes('secret'));
  assert.throws(() => advisoryCodexConfig(null), /configuration/);
});
test('code generation can pass three minutes and still stops at the shared deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let killed = false;
  const result = runLocalAgent('codex', 'Create an artwork', '/tmp', { spawnProcess: () => {
    const proc = new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();proc.exitCode=null;
    proc.kill=()=>{killed=true;proc.exitCode=0;return true;};return proc;
  } });
  const rejected = assert.rejects(result, /timed out after 10 minutes/);
  t.mock.timers.tick(180000);await Promise.resolve();assert.equal(killed,false);
  t.mock.timers.tick(AGENT_REPLY_TIMEOUT_MS-180000);await rejected;assert.equal(killed,true);
});
