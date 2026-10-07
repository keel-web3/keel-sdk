import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, stat, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudioConnection, completeStudioConnection, getStudioConnection, loadStudioAgentToken, createConnectedStudioDraftClient, importStudioAgentToken, studioConnectionOrigin } from '../dist/studio-connection-node.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-pair-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const token = `keel_agent_${'A'.repeat(48)}`, pollToken = `keel_pair_${'B'.repeat(43)}`;
  let outcome = 'pending', starts = 0, polls = 0, authorization;
  const fetchImplementation = async (url, options) => {
    url = String(url);
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/api/agent/pair')) {
      starts++;
      return Response.json({ code: 'ABCD-EFGH', pollToken, expiresAt: new Date(Date.now() + 600000).toISOString(), approveUrl: 'https://evil.example/ignored', pollUrl: 'https://evil.example/ignored' }, { status: 201 });
    }
    if (url.endsWith('/api/agent/pair/poll')) {
      assert.equal(JSON.parse(options.body).pollToken, pollToken); polls++;
      return outcome === 'approved' ? Response.json({ status: 'approved', token, grant: { scopes: ['drafts:read'], expiresAt: new Date(Date.now() + 86400000).toISOString() } }) : Response.json({ status: outcome }, { status: outcome === 'pending' ? 202 : 410 });
    }
    authorization = new Headers(options.headers).get('authorization');
    return Response.json({ projects: [], releases: [] });
  };
  const options = { workspace: root, credentialDirectory: join(root, 'credentials'), studioUrl: 'https://studio.example', fetchImplementation };
  return { options, root, token, pollToken, setOutcome: value => { outcome = value; }, counts: () => ({ starts, polls }), authorization: () => authorization };
}
test('approval saves the narrowed grant privately and SDK drafts work without environment setup', async t => {
  const f = await fixture(t);
  const pending = await startStudioConnection(f.options);
  assert.equal(pending.approveUrl, 'https://studio.example/studio/connect?code=ABCD-EFGH');
  assert.equal(pending.status, 'pending');
  assert.ok(!JSON.stringify(pending).includes(f.pollToken));
  await assert.rejects(loadStudioAgentToken(f.options), /keel-studio-connect/u);
  assert.equal((await completeStudioConnection(f.options)).status, 'pending');
  f.setOutcome('approved');
  const connected = await completeStudioConnection(f.options);
  assert.deepEqual(connected.scopes, ['drafts:read']);
  assert.ok(!JSON.stringify(connected).includes(f.token));
  assert.equal(connected.approveUrl, undefined);
  assert.equal(await loadStudioAgentToken(f.options), f.token);
  await (await createConnectedStudioDraftClient(f.options)).list();
  assert.equal(f.authorization(), `Bearer ${f.token}`);
  const file = (await readdir(f.options.credentialDirectory)).find(name => name.endsWith('.json'));
  if (process.platform !== 'win32') {
    assert.equal((await stat(f.options.credentialDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(f.options.credentialDirectory, file))).mode & 0o777, 0o600);
  }
  assert.equal((await startStudioConnection(f.options)).status, 'connected');
  assert.equal(f.counts().starts, 1);
  assert.equal((await getStudioConnection({ ...f.options, studioUrl: 'https://other.example' })).status, 'disconnected');
});
test('denied requests and duplicate collectors cannot expose or overwrite a key', async t => {
  const f = await fixture(t);
  await startStudioConnection(f.options); f.setOutcome('denied');
  assert.equal((await completeStudioConnection(f.options)).status, 'denied');
  await assert.rejects(loadStudioAgentToken(f.options));
  await startStudioConnection(f.options); f.setOutcome('approved');
  const [a,b] = await Promise.all([completeStudioConnection(f.options), completeStudioConnection(f.options)]);
  assert.equal(a.status, 'connected'); assert.deepEqual(a,b);
  assert.equal(f.counts().polls, 2);
});
test('expired records, unsafe permissions and symlinks fail closed', async t => {
  const f = await fixture(t);
  await startStudioConnection(f.options);
  const file = join(f.options.credentialDirectory, (await readdir(f.options.credentialDirectory))[0]);
  if (process.platform !== 'win32') {
    await chmod(file, 0o644); await assert.rejects(getStudioConnection(f.options), /private/u); await chmod(file, 0o600);
  }
  const record = JSON.parse(await readFile(file, 'utf8'));
  record.expiresAt = new Date(0).toISOString();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify(record));
  assert.equal((await getStudioConnection(f.options)).status, 'expired');
  await rm(file); await symlink(join(f.root, 'other'), file);
  await assert.rejects(getStudioConnection(f.options), /unsafe/u);
});
test('origin rules and terminal import never return the secret', async t => {
  for (const url of ['http://studio.example', 'https://user:pass@studio.example', 'https://studio.example/private', 'https://studio.example?key=x']) assert.throws(() => studioConnectionOrigin(url));
  assert.equal(studioConnectionOrigin('http://127.0.0.1:4350'), 'http://127.0.0.1:4350');
  const f = await fixture(t);
  const result = await importStudioAgentToken(f.token, f.options);
  assert.ok(!JSON.stringify(result).includes(f.token));
  assert.equal(await loadStudioAgentToken(f.options), f.token);
  await assert.rejects(importStudioAgentToken('wallet-private-key', f.options));
});
test('extra access permissions request fresh consent and denial preserves the existing connection', async t => {
 const f = await fixture(t); await startStudioConnection(f.options); f.setOutcome('approved'); await completeStudioConnection(f.options);
 const extra = await startStudioConnection({ ...f.options, scopes: ['drafts:read', 'access:read', 'access:write'] });
 assert.equal(extra.status, 'pending'); assert.ok(extra.scopes.includes('access:write')); assert.equal(await loadStudioAgentToken(f.options), f.token);
 f.setOutcome('denied'); assert.equal((await completeStudioConnection(f.options)).status, 'denied'); assert.equal((await getStudioConnection(f.options)).status, 'connected'); assert.equal(await loadStudioAgentToken(f.options), f.token);
});
