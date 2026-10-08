import assert from 'node:assert/strict';
import test from 'node:test';
import { brotliCompressSync, constants } from 'node:zlib';
import { prepareStudioArtifact, verifyPreparedStudioArtifact } from '../packages/studio-core/dist/index.js';
const bytes = new TextEncoder().encode('ordinary native payload repeated without losing any bytes\n'.repeat(2000));
const options = { id: 'settings', name: 'Settings', payloadStorage: 'compact', assets: [
  { id: 'entry', fileName: 'index.html', mediaType: 'text/html', bytes: new TextEncoder().encode('<html>Creator shell</html>'), entrypoint: true },
  { id: 'asset', fileName: 'data.bin', mediaType: 'application/octet-stream', bytes },
] };
test('Compact plus explicit Off preserves all native bytes without relabeling Raw', async () => {
  const prepared = await prepareStudioArtifact({ ...options, compression: 'none' });
  for (const resource of prepared.resources) assert.equal(resource.compression, 'none');
  assert.equal(prepared.manifest.extensions['keel:payload-storage'].mode, 'compact');
  assert.equal(prepared.resources.find(resource => resource.resource.id === 'asset').storedByteLength, bytes.length);
  assert.deepEqual(prepared.resources.find(resource => resource.resource.id === 'asset').storedBytes, bytes);
  assert.equal((await verifyPreparedStudioArtifact(prepared)).valid, true);
});
test('Brotli quality is honored and Raw or contract-readable HTML always remain uncompressed', async () => {
  for (const brotliQuality of [0, 5, 11]) {
    const prepared = await prepareStudioArtifact({ ...options, compression: 'brotli', brotliQuality });
    const asset = prepared.resources.find(resource => resource.resource.id === 'asset');
    const expected = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: brotliQuality, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC } });
    assert.equal(asset.compression, 'brotli'); assert.equal(asset.storedByteLength, expected.byteLength); assert.deepEqual(asset.storedBytes, new Uint8Array(expected));
    assert.equal(prepared.resources.find(resource => resource.resource.id === 'entry').compression, 'none');
    assert.equal((await verifyPreparedStudioArtifact(prepared)).valid, true);
  }
  const raw = await prepareStudioArtifact({ ...options, payloadStorage: 'raw', compression: 'brotli' });
  assert.ok(raw.resources.every(resource => resource.compression === 'none'));
  await assert.rejects(prepareStudioArtifact({ ...options, brotliQuality: 12 }), /quality/);
});
