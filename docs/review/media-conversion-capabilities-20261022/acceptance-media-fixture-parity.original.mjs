import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const base = fileURLToPath(new URL('../packages', import.meta.url));
const { prepareMediaCandidate, compareMediaFrames, getMediaPreparationCapabilities } = await import(base + '/builder/dist/media-preparation.js');
const { prepareStudioArtifact, inferMediaType, inferRole } = await import(base + '/studio-core/dist/index.js');
const { createIntegrity } = await import(base + '/protocol/dist/index.js');
const { decompressBytes } = await import(base + '/builder/dist/index.js');
const { planKeelMediaSlots, assertKeelMediaSlotReadFit } = await import(base + '/builder/dist/media-slot-plan.js');
const { createMcpServer } = await import(base + '/mcp/dist/index.js');
const req = createRequire(base + '/builder/dist/media-preparation.js');
let sharp, ffmpeg, unavailable;
try {
    sharp = req('sharp');
    ffmpeg = req('ffmpeg-static');
    const capabilities = await getMediaPreparationCapabilities();
    if (!capabilities.image.available || !capabilities.movie.available || !ffmpeg) {
        unavailable = 'The pinned Sharp and reviewed bundled FFmpeg adapters are required: ' + (capabilities.movie.reason ?? 'encoder unavailable');
    }
}
catch (error) {
    unavailable = 'Media fixture dependencies are unavailable: ' + error.message;
}
if (unavailable) {
    if (process.env.KEEL_REQUIRE_MEDIA_FIXTURES === '1')
        throw new Error(unavailable);
    test('media fixture preparation dependencies', { skip: unavailable }, () => {
    });
}
else {
    const original = { schema: 'keel-media-edit@1', mode: 'original', format: 'original', quality: 82, noSound: false };
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'keel-acceptance-media-'));
    const fixtures = [];
    function add(name, mime, bytes, role) {
        fixtures.push({ name, mime, bytes: new Uint8Array(bytes), role });
    }
    const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 101, g: 52, b: 203 } } }).png().toBuffer();
    for (const [extension, format, mime] of [['png', 'png', 'image/png'], ['jpg', 'jpeg', 'image/jpeg'], ['gif', 'gif', 'image/gif'], ['webp', 'webp', 'image/webp'], ['avif', 'avif', 'image/avif']])
        add('fixture.' + extension, mime, await sharp(png).toFormat(format).toBuffer(), 'image');
    add('fixture.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="12"><rect width="16" height="12" fill="red"/></svg>'), 'image');
    for (const [extension, mime, codec] of [['mp4', 'video/mp4', 'libx264rgb'], ['mov', 'video/quicktime', 'libx264rgb'], ['webm', 'video/webm', 'libvpx-vp9']]) {
        const filename = path.join(temp, 'fixture.' + extension);
        execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=16x12:rate=5', '-t', '0.4', '-an', '-c:v', codec, '-crf', '0', '-threads', '2', '-y', filename]);
        add('fixture.' + extension, mime, await fs.readFile(filename), 'video');
    }
    const audio = path.join(temp, 'fixture.wav');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=8000', '-t', '0.1', '-c:a', 'pcm_s16le', '-y', audio]);
    add('fixture.wav', 'audio/wav', await fs.readFile(audio), 'audio');
    add('fixture.html', 'text/html', Buffer.from('<!doctype html><html><meta charset="utf-8"><body>Original π<script>window.keelFixture=1</script></body></html>'), 'entrypoint');
    add('module.wasm', 'application/wasm', Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]), 'script');
    assert.equal(WebAssembly.validate(fixtures.at(-1).bytes), true);
    const fontFixture = JSON.parse(await fs.readFile(new URL('./fixtures/acceptance-media/font.json', import.meta.url), 'utf8'));
    const fontBytes = Buffer.from(fontFixture.bytesBase64, 'base64');
    assert.equal((await createIntegrity(fontBytes)).digest, '0x' + fontFixture.sha256);
    add('typeface.ttf', 'font/ttf', fontBytes, 'font');
    const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }] };
    const jb = Buffer.from(JSON.stringify(gltf));
    const pad = Buffer.concat([jb, Buffer.alloc((4 - jb.length % 4) % 4, 32)]);
    const glb = Buffer.alloc(20 + pad.length);
    glb.writeUInt32LE(0x46546c67, 0);
    glb.writeUInt32LE(2, 4);
    glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(pad.length, 12);
    glb.writeUInt32LE(0x4e4f534a, 16);
    pad.copy(glb, 20);
    add('model.glb', 'model/gltf-binary', glb, 'model');
    add('model.gltf', 'model/gltf+json', jb, 'model');
    for (const [name, mime, text, role] of [['style.css', 'text/css', 'body { color: red; }', 'style'], ['main.js', 'text/javascript', 'globalThis.fixture = "π";', 'script'], ['data.json', 'application/json', '{"fixture":true}', 'data'], ['notes.txt', 'text/plain', 'Original Unicode π🌊\r\n', 'data']])
        add(name, mime, Buffer.from(text), role);
    add('opaque.bin', 'application/octet-stream', Uint8Array.from([0, 255, 13, 10, 127, 128]), 'other');
    for (const f of fixtures)
        await fs.writeFile(path.join(temp, f.name), f.bytes);
    const server = await createMcpServer({ workspaceRoot: temp });
    await server.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'acceptance-media-parity', version: '1' } } });
    let id = 1;
    async function call(name, args) {
        return server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } });
    }
    async function accepted(name, args) {
        const response = await call(name, args);
        assert.equal(response.error, undefined, JSON.stringify(response));
        assert.notEqual(response.result.isError, true, response.result.content?.[0]?.text);
        return response.result.structuredContent;
    }
    test.after(async () => fs.rm(temp, { recursive: true, force: true }));
    for (const f of fixtures)
        test(`fixture ${f.mime}: Original SDK/MCP exact parity, inferred role, Raw/Compact reconstruction`, async () => {
            const snapshot = f.bytes.slice();
            const direct = await prepareMediaCandidate({ bytes: f.bytes, mediaType: f.mime, recipe: original });
            const remote = await accepted('keel-media-candidate', { inputPath: f.name, mediaType: f.mime, recipe: original });
            assert.deepEqual(direct.bytes, f.bytes);
            assert.deepEqual(Buffer.from(remote.bytesBase64, 'base64'), Buffer.from(f.bytes));
            assert.deepEqual(remote.sourceIntegrity, direct.sourceIntegrity);
            assert.deepEqual(remote.outputIntegrity, direct.outputIntegrity);
            assert.equal(remote.verification.completeDecode, false);
            assert.equal(remote.publication, 'not-performed');
            assert.equal(inferMediaType(f.name, f.mime), f.mime);
            assert.equal(inferRole(f.mime, f.name), f.role);
            for (const mode of ['raw', 'compact']) {
                const artifact = await prepareStudioArtifact({ id: 'fixture', name: 'Fixture', createdAt: '2026-10-09T00:00:00Z', payloadStorage: mode, assets: [{ id: 'entry', fileName: 'index.html', mediaType: 'text/html', role: 'entrypoint', entrypoint: true, bytes: Buffer.from('<html>Fixture</html>') }, { id: 'payload', fileName: f.name, mediaType: f.mime, role: f.mime === 'text/html' ? 'data' : f.role, bytes: f.bytes, entrypoint: false }] });
                const r = artifact.resources.find(r => r.resource.id === 'payload');
                assert.ok(r);
                assert.deepEqual(await decompressBytes(r.compression, r.storedBytes), f.bytes);
                if (mode === 'raw') {
                    assert.equal(r.compression, 'none');
                    assert.deepEqual(r.storedBytes, f.bytes);
                }
                else
                    assert.ok(r.storedBytes.length <= f.bytes.length);
            }
            assert.deepEqual(f.bytes, snapshot);
            assert.deepEqual(await fs.readFile(path.join(temp, f.name)), Buffer.from(snapshot));
        });
    for (const format of ['webp', 'avif', 'mp4', 'mov', 'webm'])
        test(`encoded ${format}: SDK/MCP decoded parity, measured output integrity and source preservation`, async () => {
            const f = fixtures.find(f => f.name === 'fixture.mov');
            const recipe = { ...original, mode: 'lossless', format, noSound: true };
            const direct = await prepareMediaCandidate({ bytes: f.bytes, mediaType: f.mime, recipe });
            const remote = await accepted('keel-media-candidate', { inputPath: f.name, mediaType: f.mime, recipe });
            const remoteBytes = new Uint8Array(Buffer.from(remote.bytesBase64, 'base64'));
            assert.deepEqual(remote.outputIntegrity, await createIntegrity(remoteBytes));
            assert.deepEqual(remote.candidateInfo, direct.candidateInfo);
            for (const timeMs of [0, 200]) {
                const a = await compareMediaFrames({ bytes: direct.bytes, recipe: original, timeMs });
                const b = await compareMediaFrames({ bytes: remoteBytes, recipe: original, timeMs });
                assert.deepEqual(a.originalFrame, b.originalFrame);
            }
            assert.equal(remote.verification.losslessPixelsVerified, true);
            assert.equal(direct.verification.losslessPixelsVerified, true);
            assert.equal(remote.candidateInfo.frameCount, 2);
            assert.equal(remote.candidateInfo.width, 16);
            assert.deepEqual(remote.recipe, recipe);
            assert.deepEqual(await fs.readFile(path.join(temp, f.name)), Buffer.from(f.bytes));
        });
    test('SDK/MCP synchronized compare parity on exact image frame', async () => {
        const f = fixtures.find(f => f.name === 'fixture.png'), recipe = { ...original, mode: 'lossless', format: 'webp' };
        const direct = await compareMediaFrames({ bytes: f.bytes, recipe, timeMs: 0 });
        const remote = await accepted('keel-media-compare', { inputPath: f.name, recipe, timeMs: 0 });
        assert.deepEqual(Buffer.from(remote.originalFrame, 'base64'), Buffer.from(direct.originalFrame));
        assert.deepEqual(Buffer.from(remote.processedFrame, 'base64'), Buffer.from(direct.processedFrame));
        assert.equal(remote.sourceFrameTimeMs, direct.sourceFrameTimeMs);
    });
    test('SDK/MCP capability parity reports conditional decode, not universal publication', async () => {
        const direct = await getMediaPreparationCapabilities();
        const remote = await accepted('keel-media-capabilities', {});
        assert.deepEqual(remote.image, direct.image);
        assert.deepEqual(remote.movie, direct.movie);
        assert.equal(remote.original.bytePreserving, true);
        assert.equal(remote.browserDecode, 'requires-runtime-check');
    });
    for (const bad of [{ name: 'corrupt.png', mime: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71, 0, 0]) }, { name: 'truncated.mp4', mime: 'video/mp4', bytes: fixtures.find(f => f.name === 'fixture.mp4').bytes.subarray(0, 20) }, { name: 'unsupported.wasm', mime: 'application/wasm', bytes: fixtures.find(f => f.name === 'module.wasm').bytes }, { name: 'playlist.m3u8', mime: 'application/vnd.apple.mpegurl', bytes: Buffer.from('#EXTM3U\nhttps://example.invalid/video.ts') }])
        test(`bad-format ${bad.name}: edit rejected SDK/MCP, original retained without decode claim`, async () => {
            await fs.writeFile(path.join(temp, bad.name), bad.bytes);
            const recipe = { ...original, mode: 'lossless', format: 'webp' };
            await assert.rejects(prepareMediaCandidate({ bytes: bad.bytes, mediaType: bad.mime, recipe }));
            const response = await call('keel-media-candidate', { inputPath: bad.name, mediaType: bad.mime, recipe });
            assert.equal(response.result.isError, true);
            const kept = await accepted('keel-media-candidate', { inputPath: bad.name, mediaType: bad.mime, recipe: original });
            assert.deepEqual(Buffer.from(kept.bytesBase64, 'base64'), Buffer.from(bad.bytes));
            assert.equal(kept.verification.completeDecode, false);
            assert.deepEqual(await fs.readFile(path.join(temp, bad.name)), Buffer.from(bad.bytes));
        });
    test('media slots preserve explicit shell-off across every fixture MIME and reject full-read boundary violations', () => {
        for (const f of fixtures) {
            const plan = planKeelMediaSlots({ sourceResourceId: 'original', mediaType: f.mime, explicit: { image: null, animation_url: { resourceId: 'original', presentation: 'direct', delivery: 'onchain' } } });
            assert.equal(plan.viewer, 'none');
            assert.equal(plan.animation_url.resourceId, 'original');
            for (const size of [1999999, 2000000])
                assert.doesNotThrow(() => assertKeelMediaSlotReadFit(plan, { planKey: plan.planKey, completeTokenUriBytes: size, maxTokenUriBytes: 2000000, selectedChainReadPassed: true }));
            for (const size of [0, 2000001])
                assert.throws(() => assertKeelMediaSlotReadFit(plan, { planKey: plan.planKey, completeTokenUriBytes: size, maxTokenUriBytes: 2000000, selectedChainReadPassed: true }));
            assert.throws(() => assertKeelMediaSlotReadFit(plan, { planKey: plan.planKey, completeTokenUriBytes: 1, maxTokenUriBytes: 2000000, selectedChainReadPassed: false }));
        }
    });
    test('MCP invalid quality, traversal, unexpected operations and negative time reject without source writes', async () => {
        for (const args of [{ inputPath: '../outside.png', recipe: original }, { inputPath: 'fixture.png', recipe: { ...original, quality: 101 } }, { inputPath: 'fixture.png', recipe: original, timeMs: -1 }, { inputPath: 'fixture.png', recipe: original, force: true }]) {
            const r = await call('keel-media-candidate', args);
            assert.equal(r.result.isError, true);
        }
        assert.deepEqual(await fs.readFile(path.join(temp, 'fixture.png')), Buffer.from(fixtures.find(f => f.name === 'fixture.png').bytes));
    });
}
