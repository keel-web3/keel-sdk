/** Dataset-aware, deterministic hybrid selection. This is a bounded heuristic, not
 * a claim of globally optimal partitioning. Discarded candidates never count as uploads. */
import { inflateRawSync } from 'node:zlib';
import { compileRasterRegions, registerRasterChunk, type RegionCatalog } from './raster-regions.js';
import { preparePNGStrip, pngAdler, combinePNGAdler, pngChunk, pngHeader, type RasterPixels } from './raster-strips.js';
type Choice = {
    mode: 'regions' | 'strip';
    refs: number[];
    unique: number[];
};
export type HybridCandidate = {
    width: number;
    height: number;
    bands: Choice[][];
    selected: number[];
};
export function prepareHybridCandidates(reference: RasterPixels, layers: RasterPixels[], catalog: RegionCatalog, bandRows = 16): HybridCandidate {
    if (![8, 16, 32, 64].includes(bandRows))
        throw Error('Choose a supported hybrid band height.');
    const regional = compileRasterRegions(reference, layers, catalog, { filter: 'up' }), bands: Choice[][] = [];
    for (let y = 0; y < reference.height; y += bandRows) {
        const height = Math.min(bandRows, reference.height - y), strip = preparePNGStrip({ width: reference.width, height, data: reference.data.subarray(y * reference.width * 4, (y + height) * reference.width * 4) }), spanRefs = regional.refs.slice(regional.rowRanges[y]![0], regional.rowRanges[y + height - 1]![1]);
        const stripRef = registerRasterChunk(catalog, strip.bytes);
        bands.push([{ mode: 'regions', refs: spanRefs, unique: [...new Set(spanRefs)] }, { mode: 'strip', refs: [stripRef], unique: [stripRef] }]);
    }
    return { width: reference.width, height: reference.height, bands, selected: [] };
}
export function selectHybridCandidates(projects: HybridCandidate[], catalog: RegionCatalog) {
    const potential = new Map<number, number>(), used = new Map<number, number>(), cost = (id: number) => catalog.chunks[id]!.length + 24;
    for (const p of projects)
        for (const band of p.bands)
            for (const id of new Set(band.flatMap(c => c.unique)))
                potential.set(id, (potential.get(id) ?? 0) + 1);
    const change = (c: Choice, delta: number) => { for (const id of c.unique)
        used.set(id, (used.get(id) ?? 0) + delta); };
    for (const p of projects)
        p.selected = p.bands.map(band => { const scores = band.map(c => c.refs.length * 4 + c.unique.reduce((n, id) => n + cost(id) / potential.get(id)!, 0)), pick = scores[1]! <= scores[0]! ? 1 : 0; change(band[pick]!, 1); return pick; });
    // Re-evaluate using actual selected references. Accept only a strict decrease in
    // stored chunks + fixed-width catalog records + token maps, so every pass is monotonic.
    let changes = 0;
    for (let pass = 0; pass < 4; pass++) {
        let changed = 0;
        for (const p of projects)
            for (let i = 0; i < p.bands.length; i++) {
                const band = p.bands[i]!, current = p.selected[i]!;
                change(band[current]!, -1);
                const marginal = (c: Choice) => c.refs.length * 4 + c.unique.reduce((n, id) => n + ((used.get(id) ?? 0) > 0 ? 0 : cost(id)), 0);
                const other = 1 - current, pick = marginal(band[other]!) < marginal(band[current]!) ? other : current;
                p.selected[i] = pick;
                change(band[pick]!, 1);
                if (pick !== current)
                    changed++;
            }
        changes += changed;
        if (!changed)
            break;
    }
    const score = (baseline: boolean) => { const ids = new Set<number>(); let maps = 0; for (const p of projects)
        for (let i = 0; i < p.bands.length; i++) {
            const c = p.bands[i]![baseline ? 1 : p.selected[i]!]!;
            maps += c.refs.length * 4;
            c.unique.forEach(id => ids.add(id));
        } return maps + [...ids].reduce((n, id) => n + cost(id), 0); };
    const baselineScore = score(true);
    let fallback = false;
    if (score(false) > baselineScore) {
        fallback = true;
        for (const p of projects)
            p.selected = p.bands.map(() => 1);
    }
    const selected = projects.flatMap(p => p.selected.map((v, i) => p.bands[i]![v]!.mode));
    return { regionBands: selected.filter(v => v === 'regions').length, stripBands: selected.filter(v => v === 'strip').length, improvements: changes, baselineFallback: fallback, selectedScore: score(false), baselineScore, objective: 'raw fragment bytes + 24-byte catalog entries + 4-byte references' };
}
export function finalizeHybridCandidate(project: HybridCandidate, catalog: RegionCatalog, summaries = new Map<number, {
    adler: number;
    length: number;
}>()) {
    if (project.selected.length !== project.bands.length)
        throw Error('Select hybrid candidates first.');
    const body = project.bands.flatMap((band, i) => band[project.selected[i]!]!.refs);
    let checksum = 1, total = 0;
    for (const id of body) {
        let summary = summaries.get(id);
        if (!summary) {
            const b = catalog.chunks[id]!;
            if (Buffer.from(b.subarray(4, 8)).toString() !== 'IDAT')
                throw Error('Hybrid body contains a non-IDAT chunk.');
            const raw = inflateRawSync(Buffer.concat([b.subarray(8, b.length - 4), Buffer.from([3, 0])]), { maxOutputLength: project.width * 4 * 64 + 64 });
            summary = { adler: pngAdler(raw), length: raw.length };
            summaries.set(id, summary);
        }
        checksum = combinePNGAdler(checksum, summary.adler, summary.length);
        total += summary.length;
    }
    if (total !== (project.width * 4 + 1) * project.height)
        throw Error('Hybrid scanlines do not cover the image.');
    const tail = Buffer.alloc(6);
    tail[0] = 3;
    tail.writeUInt32BE(checksum, 2);
    const refs = [registerRasterChunk(catalog, Buffer.concat([pngHeader(project.width, project.height), pngChunk('IDAT', Buffer.from([0x78, 0x9c]))])), ...body, registerRasterChunk(catalog, Buffer.concat([pngChunk('IDAT', tail), pngChunk('IEND', Buffer.alloc(0))]))];
    return refs;
}
