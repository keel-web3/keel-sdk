import assert from 'node:assert/strict';
import test from 'node:test';
import { inferMediaType, normalizeAssets } from '../packages/studio-core/dist/media.js';
for (const [fileName, declared, canonical] of [
    ['song.wav', 'audio/vnd.wave', 'audio/wav'],
    ['song.flac', 'audio/x-flac', 'audio/flac'],
    ['song.m4a', 'audio/x-m4a', 'audio/mp4'],
    ['animation.apng', 'image/apng', 'image/png'],
    ...['js', 'mjs', 'cjs'].map(extension => [`main.${extension}`, 'application/javascript', 'text/javascript']),
]) {
    test(`${declared} normalizes to ${canonical} without changing source bytes`, () => {
        const bytes = new TextEncoder().encode('original source bytes');
        assert.equal(inferMediaType(fileName, declared), canonical);
        assert.equal(inferMediaType(fileName, canonical), canonical);
        const [asset] = normalizeAssets([{ id: 'original', fileName, mediaType: declared, bytes }]);
        assert.equal(asset.mediaType, canonical);
        assert.deepEqual(asset.bytes, bytes);
    });
}
for (const declared of ['text/plain', 'constructor', '__proto__']) {
    test(`unrelated explicit MIME remains unchanged: ${declared}`, () => {
        assert.equal(inferMediaType('main.js', declared), declared);
    });
}
for (const [fileName, canonical] of [
    ['song.aac', 'audio/aac'],
    ['animation.apng', 'image/png'],
    ['song.flac', 'audio/flac'],
    ['song.m4a', 'audio/mp4'],
    ['song.oga', 'audio/ogg'],
    ['song.opus', 'audio/ogg'],
]) {
    test(`${fileName} infers canonical MIME without a specific declaration`, () => {
        assert.equal(inferMediaType(fileName), canonical);
        assert.equal(inferMediaType(fileName, 'application/octet-stream'), canonical);
        const bytes = new TextEncoder().encode('original source bytes');
        const [asset] = normalizeAssets([{ fileName, bytes }]);
        assert.equal(asset.mediaType, canonical);
        assert.deepEqual(asset.bytes, bytes);
        assert.equal(inferMediaType(fileName, 'text/plain'), 'text/plain');
    });
}
