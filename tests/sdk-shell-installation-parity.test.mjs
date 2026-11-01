import assert from 'node:assert/strict';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import test from 'node:test';

const sdk = fileURLToPath(new URL('../packages/sdk/', import.meta.url));
const golden = {
  native: '0x4563ddef14b137836280a0ea06d76aefe703d2aed51ef3547d4b32f6b81eb50f',
  'lzma-js': '0x39c29bddc34a195c81d15c607a34a5ffa9f45b308a4b538948de4d5caacfc940',
};

test('installed SDK retains exact canonical native/LZMA bytes outside the workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'keel-sdk-install-parity-'));
  try {
    // A real copy under node_modules reproduces npm's module classification.
    // Keep the already-installed pinned dependencies; this test uses no network.
    const installed = path.join(root, 'node_modules/@keel/sdk');
    await cp(path.join(sdk, 'dist'), path.join(installed, 'dist'), { recursive: true });
    await cp(path.join(sdk, 'package.json'), path.join(installed, 'package.json'));
    await symlink(path.join(sdk, 'node_modules'), path.join(installed, 'node_modules'), 'dir');
    const workspace = await import(pathToFileURL(path.join(sdk, 'dist/verification-shell.js')).href);
    const packaged = await import(pathToFileURL(path.join(installed, 'dist/verification-shell.js')).href);
    for (const codecProfile of ['native', 'lzma-js']) {
      const before = await workspace.buildCompactInlineKeelShell({ codecProfile });
      const after = await packaged.buildCompactInlineKeelShell({ codecProfile });
      assert.equal(before.suffixIntegrity.digest, golden[codecProfile]);
      assert.equal(after.suffixIntegrity.digest, golden[codecProfile]);
      assert.deepEqual(after.prefix, before.prefix);
      assert.deepEqual(after.suffix, before.suffix);
    }
    const reader = await packaged.buildPublishedViewReaderModule();
    assert.equal(reader.source.length, 251050);
    assert.equal(reader.integrity.digest, '0x978e5fed29103cc72a2272f908421f14a587009d959aa40d3a1853af130bae1a');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
