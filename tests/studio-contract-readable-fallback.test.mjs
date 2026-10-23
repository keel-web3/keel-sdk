import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { canonicalJson, createIntegrity, manifestIntegrity } from '../packages/protocol/dist/index.js';
import { prepareStudioArtifact, prepareContractReadableStudioFallback, selectStudioCollectorImageResourceId, verifyPreparedStudioArtifact } from '../packages/studio-core/dist/index.js';
const require = createRequire(new URL('../packages/studio-core/dist/prepare.js', import.meta.url));
const sharp = require('sharp');
const nativeBytes = new TextEncoder().encode('exact native payload including unchanged whitespace\n'.repeat(2000));
const imageBytes = Uint8Array.from({ length: 4096 }, (_, i) => i % 32);
const fixture = {
  id: 'fallback-fixture', name: 'Fallback fixture', createdAt: '2026-10-09T00:00:00.000Z', payloadStorage: 'compact',
  assets: [
    { id: 'entry', fileName: 'index.html', mediaType: 'text/html', bytes: new TextEncoder().encode('<main>Exact</main>'), entrypoint: true },
    { id: 'preview', fileName: 'preview.webp', mediaType: 'image/webp', role: 'preview', bytes: imageBytes },
    { id: 'other-image', fileName: 'other.webp', mediaType: 'image/webp', role: 'image', bytes: imageBytes },
    { id: 'data', fileName: 'data.bin', mediaType: 'application/octet-stream', role: 'data', bytes: nativeBytes },
  ],
};
const resource = (prepared, id) => prepared.resources.find(value => value.resource.id === id);
const replan = (prepared, extra = {}) => ({ mode: 'unfunded-replan', expectedManifestDigest: prepared.manifestIntegrity.digest, revision: 2, parentRevision: 1, ...extra });
async function assertConsistent(prepared) {
  assert.equal((await verifyPreparedStudioArtifact(prepared)).valid, true);
  assert.deepEqual(await manifestIntegrity(prepared.manifest), prepared.manifestIntegrity);
  assert.deepEqual(prepared.manifest.resources, prepared.resources.map(item => item.resource));
  assert.deepEqual(prepared.manifest.extensions.studio.stats, prepared.stats);
  assert.equal(prepared.stats.storedByteLength, prepared.resources.reduce((n, item) => n + item.storedBytes.length, 0));
}

test('opt-in forces only the selected image raw with auto, explicit Brotli, or disabled compression', async () => {
  for (const compression of ['auto', 'brotli', 'none']) {
    const original = await prepareStudioArtifact({ ...fixture, compression });
    const prepared = await prepareStudioArtifact({ ...fixture, compression, contractReadableFallback: true });
    assert.equal(prepared.manifest.fallback.image, original.manifest.fallback.image);
    const selected = resource(prepared, 'preview');
    assert.equal(selected.compression, 'none');
    assert.deepEqual(selected.decodedBytes, imageBytes);
    assert.deepEqual(selected.storedBytes, imageBytes);
    assert.deepEqual(selected.decodedIntegrity, resource(original, 'preview').decodedIntegrity);
    assert.deepEqual(selected.storedIntegrity, await createIntegrity(imageBytes));
    assert.equal(selected.compressionRatio, 1);
    assert.equal(selected.resource.role, 'preview');
    assert.equal(selected.resource.mediaType, 'image/webp');
    assert.deepEqual(selected.resource.sources, resource(original, 'preview').resource.sources);
    for (const id of ['entry', 'other-image', 'data']) assert.deepEqual(resource(prepared, id), resource(original, id));
    assert.equal(prepared.manifest.extensions['keel:payload-storage'].mode, 'compact');
    if (compression !== 'none') assert.notEqual(prepared.manifestIntegrity.digest, original.manifestIntegrity.digest);
    await assertConsistent(prepared);
  }
});

test('helper honors an explicitly selected fallback and preserves every other prepared resource', async () => {
  const first = await prepareStudioArtifact(fixture);
  const manifest = { ...first.manifest, fallback: { ...first.manifest.fallback, image: 'other-image' } };
  const original = { ...first, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  const snapshot = structuredClone(original);
  const next = await prepareContractReadableStudioFallback(original, replan(original));
  assert.deepEqual(original, snapshot);
  assert.equal(next.manifest.fallback.image, 'other-image');
  assert.equal(resource(next, 'other-image').compression, 'none');
  assert.notEqual(resource(next, 'preview').compression, 'none');
  for (const id of ['entry', 'preview', 'data']) assert.equal(resource(next, id), resource(original, id));
  assert.deepEqual(next.manifest.revision, { ...original.manifest.revision, number: 2, parent: 1, parentDigest: original.manifestIntegrity, compatibility: { min: 1, max: 2 } });
  assert.notEqual(next.manifestIntegrity.digest, original.manifestIntegrity.digest);
  await assertConsistent(next);
});

test('no preview uses the selected ordinary image and never substitutes a different resource', async () => {
  const noPreview = { ...fixture, assets: fixture.assets.filter(asset => asset.id !== 'preview') };
  const prepared = await prepareStudioArtifact({ ...noPreview, contractReadableFallback: true });
  assert.equal(prepared.manifest.fallback.image, 'other-image');
  assert.equal(resource(prepared, 'other-image').compression, 'none');
  assert.notEqual(resource(prepared, 'data').compression, 'none');
  const noImage = { ...fixture, assets: fixture.assets.filter(asset => !asset.mediaType.startsWith('image/')) };
  const ordinaryNoImage = await prepareStudioArtifact(noImage);
  assert.deepEqual(await prepareStudioArtifact({ ...noImage, contractReadableFallback: true }), ordinaryNoImage);
  await assert.rejects(prepareContractReadableStudioFallback(ordinaryNoImage, replan(ordinaryNoImage)), /exact selected image/);
  const direct = await prepareStudioArtifact({ ...fixture, assets: [{ ...fixture.assets[2], entrypoint: true }], contractReadableFallback: true });
  assert.equal(direct.manifest.fallback.image, 'other-image');
  assert.deepEqual(direct.resources[0].storedBytes, imageBytes);
});

test('animated preview retains complete container bytes, all frame pixels, delays, loop and capture metadata', async () => {
  const pixels = Buffer.alloc(8 * 8 * 4 * 2);
  for (let p = 0; p < 128; p++) { pixels[p * 4 + (p < 64 ? 0 : 1)] = 255; pixels[p * 4 + 3] = 255; }
  const bytes = new Uint8Array(await sharp(pixels, { raw: { width: 8, height: 16, channels: 4, pageHeight: 8 } }).webp({ lossless: true, delay: [120, 240], loop: 2 }).toBuffer());
  const capture = { mode: 'loop', delayMs: 25, durationMs: 360, frameRate: 25, label: 'Exact capture' };
  const original = await prepareStudioArtifact({ ...fixture, thumbnailCapture: capture, assets: fixture.assets.map(asset => asset.id === 'preview' ? { ...asset, bytes } : asset) });
  const next = await prepareContractReadableStudioFallback(original, replan(original));
  const selected = resource(next, 'preview');
  assert.deepEqual(selected.storedBytes, bytes);
  assert.deepEqual(selected.decodedBytes, bytes);
  assert.deepEqual(next.manifest.thumbnail, original.manifest.thumbnail);
  const before = await sharp(bytes, { animated: true }).metadata();
  const after = await sharp(selected.storedBytes, { animated: true }).metadata();
  assert.equal(before.pages, 2);
  assert.deepEqual(after.delay, [120, 240]);
  assert.equal(after.loop, 2);
  assert.deepEqual(after, before);
  assert.deepEqual(await sharp(selected.storedBytes, { animated: true }).raw().toBuffer(), await sharp(bytes, { animated: true }).raw().toBuffer());
});

test('explicit unfunded initial revision preserves immutable intent and predicted sources without treating them as receipts', async () => {
  const base = await prepareStudioArtifact({ ...fixture, immutable: true });
  const source = { kind: 'onchain', chainId: 11155111, store: `0x${'11'.repeat(20)}`, objectId: `0x${'22'.repeat(32)}`, integrity: resource(base, 'preview').decodedIntegrity };
  const resources = base.resources.map(item => item.resource.id === 'preview' ? { ...item, resource: { ...item.resource, sources: [source, ...item.resource.sources] } } : item);
  const manifest = { ...base.manifest, resources: resources.map(item => item.resource) };
  const prepared = { ...base, resources, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  const next = await prepareContractReadableStudioFallback(prepared, replan(prepared, { revision: 1, parentRevision: undefined }));
  assert.deepEqual(next.manifest.revision, prepared.manifest.revision);
  assert.equal(next.manifest.revision.frozen, true);
  assert.deepEqual(resource(next, 'preview').resource.sources, resource(prepared, 'preview').resource.sources);
  assert.notEqual(next.manifestIntegrity.digest, prepared.manifestIntegrity.digest);
  await assertConsistent(next);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, replan(prepared)), /frozen or published/);
});

test('helper rejects stale digest, missing intent/revision, mismatched bytes/descriptors and known publication metadata', async () => {
  const prepared = await prepareStudioArtifact(fixture);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, { ...replan(prepared), mode: undefined }), /unfunded replan/);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, replan(prepared, { expectedManifestDigest: `0x${'00'.repeat(32)}` })), /exact expected/);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, replan(prepared, { revision: 4 })), /explicit initial draft revision or next/);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, { mode: 'unfunded-replan', expectedManifestDigest: prepared.manifestIntegrity.digest, revision: 1 }), /explicit initial draft revision or next/);
  const corrupted = structuredClone(prepared);
  resource(corrupted, 'preview').decodedBytes[0] ^= 1;
  await assert.rejects(prepareContractReadableStudioFallback(corrupted, replan(corrupted)), /decoded bytes/);
  const descriptorMismatch = structuredClone(prepared);
  resource(descriptorMismatch, 'preview').resource = { ...resource(descriptorMismatch, 'preview').resource, role: 'other' };
  await assert.rejects(prepareContractReadableStudioFallback(descriptorMismatch, replan(descriptorMismatch)), /descriptors/);
  const manifest = { ...prepared.manifest, provenance: { ...prepared.manifest.provenance, collection: `0x${'33'.repeat(20)}` } };
  const published = { ...prepared, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  await assert.rejects(prepareContractReadableStudioFallback(published, replan(published)), /published/);
  await assert.rejects(prepareStudioArtifact({ ...fixture, contractReadableFallback: 'yes' }), /boolean/);
});


test('replan removes or replaces only the exact caller-identified predicted fallback binding', async () => {
  const base = await prepareStudioArtifact(fixture);
  const integrity = resource(base, 'preview').decodedIntegrity;
  const expected = { kind: 'onchain', chainId: 11155111, store: `0x${'11'.repeat(20)}`, objectId: `0x${'22'.repeat(32)}`, integrity };
  const unrelated = { ...expected, chainId: 1, objectId: `0x${'44'.repeat(32)}` };
  const resources = base.resources.map(item => item.resource.id === 'preview' ? { ...item, resource: { ...item.resource, sources: [expected, ...item.resource.sources, unrelated] } } : item);
  const manifest = { ...base.manifest, resources: resources.map(item => item.resource) };
  const prepared = { ...base, resources, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  const removed = await prepareContractReadableStudioFallback(prepared, replan(prepared, { replacePredictedFallbackSource: { expected } }));
  assert.deepEqual(resource(removed, 'preview').resource.sources, [resource(base, 'preview').resource.sources[0], unrelated]);
  const replacement = { ...expected, objectId: `0x${'55'.repeat(32)}`, compression: 'none' };
  const replaced = await prepareContractReadableStudioFallback(prepared, replan(prepared, { replacePredictedFallbackSource: { expected, replacement } }));
  assert.deepEqual(resource(replaced, 'preview').resource.sources, [replacement, resource(base, 'preview').resource.sources[0], unrelated]);
  await assertConsistent(removed);
  await assertConsistent(replaced);
  await assert.rejects(prepareContractReadableStudioFallback(prepared, replan(prepared, { replacePredictedFallbackSource: { expected: { ...expected, objectId: `0x${'66'.repeat(32)}` } } })), /missing or ambiguous/);
  for (const invalid of [{ ...replacement, compression: 'deflate' }, { ...replacement, chainId: 1 }, { ...replacement, integrity: { ...integrity, byteLength: 1 } }]) {
    await assert.rejects(prepareContractReadableStudioFallback(prepared, replan(prepared, { replacePredictedFallbackSource: { expected, replacement: invalid } })), /retain chain, store and decoded commitment/);
  }
});

test('ordinary prepare opt-in preserves existing raw and unknown chain-bound fallback representations', async () => {
  const integrity = await createIntegrity(imageBytes);
  const additionalSources = [{ kind: 'onchain', chainId: 11155111, store: `0x${'11'.repeat(20)}`, objectId: `0x${'22'.repeat(32)}`, integrity }];
  for (const payloadStorage of ['compact', 'raw']) {
    const input = { ...fixture, payloadStorage, assets: fixture.assets.map(asset => asset.id === 'preview' ? { ...asset, additionalSources } : asset) };
    const before = await prepareStudioArtifact(input);
    const after = await prepareStudioArtifact({ ...input, contractReadableFallback: true });
    assert.deepEqual(after, before);
    assert.equal(resource(after, 'preview').compression === 'none', payloadStorage === 'raw');
  }
});


const derivativeId = 'derivative:preview-webp-512-v1';
const derivativeAsset = { id: derivativeId, fileName: 'collector.webp', mediaType: 'image/webp', role: 'image', bytes: Uint8Array.from({ length: 2048 }, (_, i) => i % 16) };
const collectorOptions = (prepared) => ({
  payloadStorage: prepared.manifest.extensions['keel:payload-storage'].mode,
  fallbackImageResourceId: prepared.manifest.fallback.image,
  resources: prepared.resources.map(item => ({ resourceId: item.resource.id, mediaType: item.resource.mediaType })),
});

test('shared collector selector matches Compact derivative preference, Raw, missing and misleading MIME cases', () => {
  const base = { fallbackImageResourceId: 'explicit-image', resources: [{ resourceId: 'explicit-image', mediaType: 'image/png' }] };
  assert.equal(selectStudioCollectorImageResourceId(base), 'explicit-image');
  assert.equal(selectStudioCollectorImageResourceId({ ...base, resources: [...base.resources, { resourceId: derivativeId, mediaType: 'image/webp' }] }), derivativeId);
  assert.equal(selectStudioCollectorImageResourceId({ ...base, payloadStorage: 'raw', resources: [...base.resources, { resourceId: derivativeId, mediaType: 'image/webp' }] }), 'explicit-image');
  for (const mediaType of ['image/png', 'image/avif', 'text/html', 'IMAGE/WEBP']) {
    assert.equal(selectStudioCollectorImageResourceId({ ...base, resources: [...base.resources, { resourceId: derivativeId, mediaType }] }), 'explicit-image');
  }
  assert.equal(selectStudioCollectorImageResourceId({ fallbackImageResourceId: null, resources: [] }), null);
  assert.equal(selectStudioCollectorImageResourceId({ fallbackImageResourceId: 'entry', resources: [{ resourceId: 'entry', mediaType: 'text/html' }] }), 'entry');
});

test('Compact preparation and repair target the already-selected derivative without changing manifest fallback or other resources', async () => {
  const input = { ...fixture, assets: [...fixture.assets, derivativeAsset] };
  const original = await prepareStudioArtifact(input);
  const switched = await prepareStudioArtifact({ ...input, contractReadableFallback: true });
  const repaired = await prepareContractReadableStudioFallback(original, replan(original));
  assert.equal(original.manifest.fallback.image, 'preview');
  for (const prepared of [switched, repaired]) {
    assert.equal(selectStudioCollectorImageResourceId(collectorOptions(prepared)), derivativeId);
    assert.deepEqual(prepared.manifest.fallback, original.manifest.fallback);
    assert.equal(resource(prepared, derivativeId).compression, 'none');
    assert.deepEqual(resource(prepared, derivativeId).decodedIntegrity, resource(original, derivativeId).decodedIntegrity);
    assert.deepEqual(resource(prepared, derivativeId).storedBytes, derivativeAsset.bytes);
    for (const item of original.resources.filter(item => item.resource.id !== derivativeId)) {
      assert.deepEqual(resource(prepared, item.resource.id), item);
    }
    assert.notEqual(resource(prepared, 'preview').compression, 'none');
    await assertConsistent(prepared);
  }
});

test('Raw and misleading derivative MIME preserve ordinary collector selection and the unselected derivative', async () => {
  for (const variant of [{ payloadStorage: 'raw', mediaType: 'image/webp' }, { payloadStorage: 'compact', mediaType: 'image/png' }]) {
    const input = { ...fixture, payloadStorage: variant.payloadStorage, assets: [...fixture.assets, { ...derivativeAsset, mediaType: variant.mediaType }] };
    const original = await prepareStudioArtifact(input);
    const switched = await prepareStudioArtifact({ ...input, contractReadableFallback: true });
    const repaired = await prepareContractReadableStudioFallback(original, replan(original));
    for (const prepared of [switched, repaired]) {
      assert.equal(selectStudioCollectorImageResourceId(collectorOptions(prepared)), 'preview');
      assert.deepEqual(prepared.manifest.fallback, original.manifest.fallback);
      assert.equal(resource(prepared, 'preview').compression, 'none');
      assert.deepEqual(resource(prepared, derivativeId), resource(original, derivativeId));
      assert.deepEqual(resource(prepared, 'other-image'), resource(original, 'other-image'));
      await assertConsistent(prepared);
    }
  }
});

test('an explicit ordinary fallback remains committed while Compact continues selecting the existing derivative', async () => {
  const base = await prepareStudioArtifact({ ...fixture, assets: [...fixture.assets, derivativeAsset] });
  const manifest = { ...base.manifest, fallback: { ...base.manifest.fallback, image: 'other-image' } };
  const original = { ...base, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  const repaired = await prepareContractReadableStudioFallback(original, replan(original));
  assert.equal(repaired.manifest.fallback.image, 'other-image');
  assert.equal(selectStudioCollectorImageResourceId(collectorOptions(repaired)), derivativeId);
  assert.equal(resource(repaired, 'other-image'), resource(original, 'other-image'));
  assert.equal(resource(repaired, 'preview'), resource(original, 'preview'));
  assert.equal(resource(repaired, derivativeId).compression, 'none');
});

test('a selected chain-bound derivative is preserved by ordinary preparation instead of converting the unselected fallback', async () => {
  const integrity = await createIntegrity(derivativeAsset.bytes);
  const additionalSources = [{ kind: 'onchain', chainId: 11155111, store: `0x${'11'.repeat(20)}`, objectId: `0x${'22'.repeat(32)}`, integrity }];
  const input = { ...fixture, assets: [...fixture.assets, { ...derivativeAsset, additionalSources }] };
  const original = await prepareStudioArtifact(input);
  const switched = await prepareStudioArtifact({ ...input, contractReadableFallback: true });
  assert.equal(selectStudioCollectorImageResourceId(collectorOptions(switched)), derivativeId);
  assert.deepEqual(switched, original);
  assert.notEqual(resource(switched, 'preview').compression, 'none');
});

test('derivative repair rejects a source binding for the unselected ordinary fallback and replaces the selected source only', async () => {
  const base = await prepareStudioArtifact({ ...fixture, assets: [...fixture.assets, derivativeAsset] });
  const oldPreview = { kind: 'onchain', chainId: 11155111, store: `0x${'11'.repeat(20)}`, objectId: `0x${'33'.repeat(32)}`, integrity: resource(base, 'preview').decodedIntegrity };
  const oldDerivative = { ...oldPreview, objectId: `0x${'44'.repeat(32)}`, integrity: resource(base, derivativeId).decodedIntegrity };
  const resources = base.resources.map(item => ['preview', derivativeId].includes(item.resource.id)
    ? { ...item, resource: { ...item.resource, sources: [item.resource.id === derivativeId ? oldDerivative : oldPreview, ...item.resource.sources] } } : item);
  const manifest = { ...base.manifest, resources: resources.map(item => item.resource) };
  const original = { ...base, resources, manifest, manifestIntegrity: await manifestIntegrity(manifest) };
  await assert.rejects(prepareContractReadableStudioFallback(original, replan(original, { replacePredictedFallbackSource: { expected: oldPreview } })), /exact decoded image/);
  const replacement = { ...oldDerivative, objectId: `0x${'55'.repeat(32)}` };
  const repaired = await prepareContractReadableStudioFallback(original, replan(original, { replacePredictedFallbackSource: { expected: oldDerivative, replacement } }));
  assert.equal(resource(repaired, 'preview'), resource(original, 'preview'));
  assert.deepEqual(resource(repaired, derivativeId).resource.sources, [replacement, ...resource(base, derivativeId).resource.sources]);
  assert.deepEqual(repaired.manifest.fallback, original.manifest.fallback);
  await assertConsistent(repaired);
});
