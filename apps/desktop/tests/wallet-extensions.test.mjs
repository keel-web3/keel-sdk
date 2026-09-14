import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WalletExtensionPackages } from '../src/wallet-extensions.mjs';

async function fixture(t, manifest = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'keel-extension-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(source, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Test wallet (no keys)', version: '1.0.0', action: { default_popup: 'popup.html' }, permissions: ['storage'], host_permissions: ['https://example.com/*'], ...manifest }));
  await writeFile(path.join(source, 'popup.html'), '<p>Fixture only</p>');
  return { source, packages: new WalletExtensionPackages(path.join(root, 'packages')), root };
}
test('extension review binds copied bytes; installed identity and profile path survive a restart', async (t) => {
  const { source, packages, root } = await fixture(t);
  const review = await packages.stage(source);
  assert.deepEqual(review.permissions, ['storage']);
  assert.deepEqual(review.hostPermissions, ['https://example.com/*']);
  assert.equal(review.compatibility, 'unverified');
  await writeFile(path.join(source, 'popup.html'), 'Changed source');
  await assert.rejects(packages.install(review.token, '0'.repeat(64)), /reviewed/);
  const record = await packages.install(review.token, review.digest);
  assert.equal(await readFile(path.join(packages.directory(record.installationId), 'popup.html'), 'utf8'), '<p>Fixture only</p>');
  const restored = new WalletExtensionPackages(path.join(root, 'packages'));
  assert.equal((await restored.verify(record)).digest, review.digest);
  assert.equal(restored.directory(record.installationId), packages.directory(record.installationId));
  await writeFile(path.join(restored.directory(record.installationId), 'popup.html'), 'Tampered install');
  await assert.rejects(restored.verify(record), /blocked.*preserved/);
});
test('extension imports reject links, traversing pages, malformed permissions and changed review bytes', async (t) => {
  const { source, packages } = await fixture(t);
  await symlink('/etc/hosts', path.join(source, 'linked'));
  await assert.rejects(packages.stage(source), /symbolic/);
  await rm(path.join(source, 'linked'));
  const review = await packages.stage(source);
  await writeFile(path.join(packages.root, 'reviews', review.token, 'popup.html'), 'Changed review');
  await assert.rejects(packages.install(review.token, review.digest), /changed after review/);
  await packages.discard(review.token);
  await assert.rejects(packages.install(review.token, review.digest), /reviewed/);
  const bad = await fixture(t, { action: { default_popup: '../outside.html' } });
  await assert.rejects(bad.packages.stage(bad.source), /start page/);
  const permissions = await fixture(t, { permissions: '*' });
  await assert.rejects(permissions.packages.stage(permissions.source), /permission list/);
});
