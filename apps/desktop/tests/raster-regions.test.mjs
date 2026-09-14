import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRasterRegions, newRegionCatalog, assembleRasterRegions } from '@keel/sdk/raster-regions';
import { decodeRasterPNG, verifyStripPNG } from '@keel/sdk/raster-strips';
test('adaptive spans preserve native PNG pixels across changing neighbours and deduplicate interiors', async () => {
    const width = 67, height = 3, bg = { width, height, data: new Uint8Array(width * height * 4) }, top = { width, height, data: new Uint8Array(width * height * 4) };
    for (let p = 0; p < bg.data.length; p += 4) {
        bg.data.set([p % 255, 80, 100, 255], p);
        if ((p / 4) % width < 32)
            top.data.set([140, 30, 80, 255], p);
    }
    const reference = { width, height, data: bg.data.slice() };
    for (let p = 0; p < top.data.length; p += 4)
        if (top.data[p + 3])
            reference.data.set(top.data.subarray(p, p + 4), p);
    const catalog = newRegionCatalog(), first = compileRasterRegions(reference, [bg, top], catalog, { minSpan: 4, maxSpan: 64 }), png = assembleRasterRegions(first.refs, catalog);
    assert.equal(verifyStripPNG(png, reference).exactRGBA, true);
    assert.deepEqual(new Uint8Array((await decodeRasterPNG(png)).data), reference.data);
    assert.equal(first.stats.sourcePixelMismatches, 0);
    const second = compileRasterRegions(reference, [bg, top], catalog, { minSpan: 4, maxSpan: 64 });
    assert.equal(second.newChunkBytes, 0);
    assert.equal(second.stats.newFragments, 0);
    // Fully hidden changed pixels must not invalidate the visible region.
    bg.data[0] = 99;
    const hidden = compileRasterRegions(reference, [bg, top], catalog, { minSpan: 4, maxSpan: 64 });
    assert.equal(hidden.newChunkBytes, 0);
});
test('partial alpha uses exact compositor results rather than pretending to be opaque', () => {
    const width = 8, height = 2, bg = { width, height, data: new Uint8Array(64).fill(255) }, top = { width, height, data: new Uint8Array(64) }, reference = { width, height, data: new Uint8Array(64) };
    for (let p = 0; p < 64; p += 4) {
        top.data.set([0, 0, 0, 128], p);
        reference.data.set([127, 127, 127, 255], p);
    }
    const catalog = newRegionCatalog(), result = compileRasterRegions(reference, [bg, top], catalog, { minSpan: 4, maxSpan: 64 });
    assert.equal(result.stats.mixedPixels, 16);
    assert.equal(verifyStripPNG(assembleRasterRegions(result.refs, catalog), reference).exactRGBA, true);
});
