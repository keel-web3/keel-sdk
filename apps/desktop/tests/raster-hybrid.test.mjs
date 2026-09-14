import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareHybridCandidates, selectHybridCandidates, finalizeHybridCandidate } from '@keel/sdk/raster-hybrid';
import { newRegionCatalog, assembleRasterRegions } from '@keel/sdk/raster-regions';
import { verifyStripPNG } from '@keel/sdk/raster-strips';
test('hybrid transitions preserve PNG pixels and selection excludes unused alternatives', () => {
    const catalog = newRegionCatalog(), images = [0, 1].map(seed => ({ width: 128, height: 40, data: Uint8Array.from({ length: 128 * 40 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i + seed * (i > 128 * 20 * 4 ? 1 : 0)) % 251) }));
    const plans = images.map(image => prepareHybridCandidates(image, [image], catalog, 8));
    selectHybridCandidates(plans, catalog);
    for (let i = 0; i < plans.length; i++) {
        // Force transitions as well as exercising the optimizer's chosen layout.
        for (const selected of [plans[i].selected, plans[i].bands.map((_, b) => b % 2)]) {
            const p = { ...plans[i], selected }, refs = finalizeHybridCandidate(p, catalog);
            assert.equal(verifyStripPNG(assembleRasterRegions(refs, catalog), images[i]).exactRGBA, true);
            assert.ok(new Set(refs).size < catalog.chunks.length);
        }
    }
});
