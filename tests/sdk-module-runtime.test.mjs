import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrity, sealKeelContent, describeKeelSealed, openKeelContent } from '../packages/protocol/dist/index.js';
import { prepareKeelModuleRuntime, decodeKeelModuleRuntime } from '../packages/sdk/dist/module-runtime.js';

test('new module runtime defaults to Brotli plus Base90, exposes actual transport, and reconstructs its exact output', async () => {
  const bytes = Buffer.from('export const value="</script> % # 🌊";\n'.repeat(100));
  const digest = (await createIntegrity(bytes)).digest;
  const runtime = await prepareKeelModuleRuntime(bytes, { format: 'esm', entry: 'src/index.ts' });
  assert.equal(runtime.encoding, 'base90');
  assert.equal(runtime.compression, 'brotli');
  assert.equal(runtime.encryption, 'none');
  assert.deepEqual(Buffer.from(await decodeKeelModuleRuntime(JSON.parse(JSON.stringify(runtime)), digest)), bytes);
  await assert.rejects(decodeKeelModuleRuntime({ ...runtime, data: runtime.data.slice(0, -1) }, digest));
  await assert.rejects(decodeKeelModuleRuntime({ ...runtime, compression: 'none' }, digest));
  await assert.rejects(decodeKeelModuleRuntime({ ...runtime, encryption: 'AES-256-GCM' }, digest));
  await assert.rejects(decodeKeelModuleRuntime(runtime, '0x' + '0'.repeat(64)));
});

test('no-gain compression is recorded as none; exact legacy catalogs remain readable', async () => {
  const bytes = Buffer.from([0, 255, 1, 254]);
  const runtime = await prepareKeelModuleRuntime(bytes, { format: 'esm', entry: 'index.js' });
  assert.equal(runtime.compression, 'none');
  const digest = (await createIntegrity(bytes)).digest;
  assert.deepEqual(Buffer.from(await decodeKeelModuleRuntime({ encoding: 'base64', data: bytes.toString('base64'), format: 'esm', entry: 'index.js' }, digest)), bytes);
  await assert.rejects(decodeKeelModuleRuntime({ encoding: 'base64', data: bytes.toString('base64') + '\n', format: 'esm', entry: 'index.js' }, digest));
});

test('sealed encryption metadata names the symmetric primitives without attesting the unlock secret', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await sealKeelContent('private package '.repeat(100), { slots: [{ kind: 'raw-key', key }] });
  const description = describeKeelSealed(sealed.envelope);
  assert.equal(description.encoding, 'native-binary');
  assert.equal(description.encryption.cipher, 'AES-256-GCM');
  assert.equal(description.encryption.keyBits, 256);
  assert.equal(description.encryption.keyEstablishment, 'symmetric-only');
  assert.equal(description.encryption.unlockSecretStrength, 'not-attested');
  assert.deepEqual(description.keyDerivation, ['HKDF-SHA-256']);
  assert.equal((await openKeelContent(sealed.envelope, { kind: 'raw-key', key })).text, 'private package '.repeat(100));
  const corrupted = sealed.envelope.slice(); corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(openKeelContent(corrupted, { kind: 'raw-key', key }));
});
