import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { prepareHybridCandidates, selectHybridCandidates, finalizeHybridCandidate } from '../../../packages/sdk/dist/raster-hybrid.js';
import { newRegionCatalog, assembleRasterRegions } from '../../../packages/sdk/dist/raster-regions.js';
import { decodeRasterPNG, verifyStripPNG, compilePNGStrips, rasterHash } from '../../../packages/sdk/dist/raster-strips.js';
const size = Number(process.env.KEEL_RASTER_SIZE || 1080), limit = Number(process.env.KEEL_REGION_COUNT || 128), root = `apps/desktop/artifacts/gator-raster-study/adaptive-${size}`, output = `${root}/hybrid-${limit}-v2`;
const inputs = JSON.parse(await readFile(`${root}/inputs.json`, 'utf8')).slice(0, limit), catalog = newRegionCatalog(), cache = new Map(), plans = [], sourceSizes = new Map(), fixed = new Map();
let fixedMaps = 0;
const started = Date.now();
await mkdir(output, { recursive: true });
async function layer(id) { if (cache.has(id)) {
    const p = cache.get(id);
    cache.delete(id);
    cache.set(id, p);
    return p;
} const b = await readFile(`${root}/assets/${id}.png`), p = await decodeRasterPNG(b); sourceSizes.set(id, b.length); cache.set(id, p); if (cache.size > 24)
    cache.delete(cache.keys().next().value); return p; }
for (const [i, input] of inputs.entries()) {
    const sources = [];
    for (const id of input.sources)
        sources.push(await layer(id));
    const reference = await decodeRasterPNG(await readFile(`${root}/references/${input.tokenId}.png`));
    const plan = prepareHybridCandidates(reference, sources, catalog);
    plans.push(plan);
    const baseline = compilePNGStrips(reference, 16);
    fixedMaps += baseline.recipe.strips.length * 4;
    for (const [id, c] of baseline.chunks)
        fixed.set(id, c.bytes.length);
    if ((i + 1) % 8 === 0)
        console.log(JSON.stringify({ phase: 'candidates', tokens: i + 1, seconds: (Date.now() - started) / 1000 }));
}
cache.clear();
catalog.fragments.clear();
const decisions = selectHybridCandidates(plans, catalog), summaries = new Map(), recipes = plans.map(p => finalizeHybridCandidate(p, catalog, summaries)), active = [...new Set(recipes.flat())].sort((a, b) => a - b), dense = new Map(), physical = new Map();
await mkdir(`${output}/pages`, { recursive: true });
const locations = [];
let page = 0, parts = [], pageBytes = 0;
async function flush() { if (!pageBytes)
    return; await writeFile(`${output}/pages/${page}.bin`, Buffer.concat(parts)); page++; parts = []; pageBytes = 0; }
for (const id of active) {
    const bytes = catalog.chunks[id], ids = [];
    for (let at = 0; at < bytes.length; at += 23000) {
        const piece = bytes.subarray(at, at + 23000), key = rasterHash(piece);
        let n = physical.get(key);
        if (n === undefined) {
            if (pageBytes + piece.length > 23000)
                await flush();
            n = locations.length;
            physical.set(key, n);
            locations.push([page, pageBytes, piece.length]);
            parts.push(piece);
            pageBytes += piece.length;
        }
        ids.push(n);
    }
    dense.set(id, ids);
}
await flush();
await writeFile(`${output}/catalog.json`, JSON.stringify(locations));
const results = [];
let mapBytes = 0;
for (const [i, refs] of recipes.entries()) {
    const input = inputs[i], png = assembleRasterRegions(refs, catalog), reference = await decodeRasterPNG(await readFile(`${root}/references/${input.tokenId}.png`));
    verifyStripPNG(png, reference);
    const decoded = await decodeRasterPNG(png);
    if (Buffer.compare(Buffer.from(decoded.data), Buffer.from(reference.data)))
        throw Error('Independent PNG decoder mismatch');
    const expanded = refs.flatMap(id => dense.get(id)), packed = Buffer.alloc(expanded.length * 4);
    expanded.forEach((id, j) => packed.writeUInt32BE(id, j * 4));
    await writeFile(`${output}/token-${input.tokenId}.map`, packed);
    mapBytes += packed.length;
    if (i === 0 || i === inputs.length - 1)
        await writeFile(`${output}/token-${input.tokenId}.png`, png);
    results.push({ tokenId: input.tokenId, pngBytes: png.length, references: expanded.length, mapBytes: packed.length, regionBands: plans[i].selected.filter(v => v === 0).length, stripBands: plans[i].selected.filter(v => v === 1).length });
}
const imageBytes = locations.reduce((n, loc) => n + loc[2], 0), baselineBytes = [...fixed.values()].reduce((a, b) => a + b, 0) + fixed.size * 24 + fixedMaps;
const report = { schema: 'keel-hybrid-raster-study@1', size, tokens: inputs.length, decisions, uniqueFragments: locations.length, logicalFragments: active.length, imageBytes, catalogBytes: locations.length * 24, mapBytes, preparedBytes: imageBytes + locations.length * 24 + mapBytes, sourceLayerBytes: [...sourceSizes.values()].reduce((a, b) => a + b, 0), baselineSamePixels16RowStripsBytes: baselineBytes, improvementFraction: 1 - (imageBytes + locations.length * 24 + mapBytes) / baselineBytes, exactRGBA: true, independentDecoder: 'squoosh-png', seconds: (Date.now() - started) / 1000, carrierPages: page, results, publicChainPublished: false, scope: 'Sample; storage includes binary fragments, 24-byte catalog records and uint32 token references. Source layer archival is extra.' };
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, results: undefined }));
