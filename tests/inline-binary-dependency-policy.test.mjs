import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeelInlineBuildRoute as route, keelInlineDependencyRequiresNativeGzip as requires } from '../packages/sdk/dist/inline-build-route.js';
const bytes = new Uint8Array([0, 255, 1, 2, 0, 128]);
const base = { entrypointMediaType: 'text/javascript', freshReaderCompressions: ['none', 'gzip'], resources: [{ id: 'main', bytes: new TextEncoder().encode('console.log(1)'), role: 'entrypoint', mediaType: 'text/javascript' }, { id: 'dep', bytes, role: 'asset', mediaType: 'font/woff2' }] };
for (const mime of ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/wasm', 'application/octet-stream'])
    for (const entry of ['text/javascript', 'application/javascript', 'text/html'])
        test('Auto narrow compatibility ' + entry + ' ' + mime, () => {
            const input = { ...base, entrypointMediaType: entry, resources: [base.resources[0], { ...base.resources[1], mediaType: mime }] };
            const r = route(input);
            assert.deepEqual(r.resources.map(x => x.compression), ['none', 'gzip']);
            assert.equal(r.compression, 'auto');
            assert.equal(r.resources[1].selection, 'auto');
            assert.deepEqual(input.resources[1].bytes, bytes);
            assert.equal(r.readerSelection, 'reader-compatible');
        });
for (const compression of ['none', 'gzip'])
    test('explicit ' + compression, () => assert.deepEqual(route({ ...base, compression }).resources.map(x => x.compression), [compression, compression]));
test('Raw remains None', () => assert.deepEqual(route({ ...base, payloadStorage: 'raw' }).resources.map(x => x.compression), ['none', 'none']));
test('Raw rejects Auto', () => assert.throws(() => route({ ...base, payloadStorage: 'raw', compression: 'auto' }), /Raw/));
test('No authenticated gzip retains None', () => assert.deepEqual(route({ ...base, freshReaderCompressions: ['none'] }).resources.map(x => x.compression), ['none', 'none']));
test('Unqualified planner unchanged', () => {
    const { freshReaderCompressions, ...input } = base;
    assert.deepEqual(route(input), route({ ...input, entrypointMediaType: undefined, resources: input.resources.map(({ id, bytes }) => ({ id, bytes })) }));
});
for (const field of [{ entrypointMediaType: 'model/gltf+json' }, { entrypointMediaType: 'application/octet-stream' }, { entrypointMediaType: undefined }])
    test('Non HTML/JS context ' + field.entrypointMediaType, () => assert.deepEqual(route({ ...base, ...field }).resources.map(x => x.compression), ['none', 'none']));
for (const mediaType of ['text/css', 'application/json', 'video/mp4', 'image/png', 'audio/mpeg', 'application/zip', 'font/unknown', 'FONT/WOFF2'])
    test('No broad default ' + mediaType, () => assert.equal(route({ ...base, resources: [{ ...base.resources[1], mediaType }] }).resources[0].compression, 'none'));
test('Entrypoint/missing role never exempted', () => {
    for (const role of ['entrypoint', undefined])
        assert.equal(route({ ...base, resources: [{ ...base.resources[1], role }] }).resources[0].compression, 'none');
});
test('Malformed capability cannot authorize', () => {
    for (const freshReaderCompressions of [['gzip'], ['none', 'gzip', 'gzip'], ['none', 'deflate']])
        assert.throws(() => route({ ...base, freshReaderCompressions }), /Fresh reader/);
});
test('Capability with Brotli preserves existing Auto planner', () => assert.equal(route({ ...base, freshReaderCompressions: ['none', 'gzip', 'brotli'] }).resources[1].compression, 'none'));
test('data role allowed only under qualified context', () => assert.equal(requires({ entrypointMediaType: 'text/html', role: 'data', mediaType: 'application/wasm' }), true));
