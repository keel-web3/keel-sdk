/** Experimental deterministic authoring compiler. Inputs are the existing renderer's
 * placed/masked RGBA layers and its exact composited reference. No agent or new trait sampler.
 * Opaque regions reuse source pixels; mixed regions preserve the reference compositor's pixels.
 */
import { constants, deflateRawSync } from 'node:zlib';
import { pngHeader, pngChunk, pngAdler, combinePNGAdler, rasterHash, type RasterPixels } from './raster-strips.js';
type Fragment = {
    first: Uint8Array;
    last: Uint8Array;
    body: number;
    adler: number;
    length: number;
};
export type RegionCatalog = {
    chunks: Uint8Array[];
    ids: Map<string, number>;
    fragments: Map<string, Fragment>;
    bytes: number;
};
export const newRegionCatalog = (): RegionCatalog => ({ chunks: [], ids: new Map(), fragments: new Map(), bytes: 0 });
function add(catalog: RegionCatalog, bytes: Uint8Array) { const digest = rasterHash(bytes), exists = catalog.ids.get(digest); if (exists !== undefined)
    return exists; const id = catalog.chunks.length; if (id >= 0xffffffff)
    throw Error('Region catalog exceeds uint32 IDs.'); catalog.ids.set(digest, id); catalog.chunks.push(bytes); catalog.bytes += bytes.length; return id; }
export { add as registerRasterChunk };
const same = (a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);
export function compileRasterRegions(reference: RasterPixels, layers: RasterPixels[], catalog: RegionCatalog, options: {
    minSpan?: number;
    maxSpan?: number;
    filter?: 'sub' | 'up';
} = {}) {
    const { width, height } = reference, minSpan = options.minSpan ?? 16, maxSpan = options.maxSpan ?? 256, filter = options.filter ?? 'up';
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 33554432 || reference.data.length !== width * height * 4 || !layers.length || layers.length > 256 || layers.some(l => l.width !== width || l.height !== height || l.data.length !== reference.data.length))
        throw Error('Region inputs must be matching placed RGBA canvases.');
    if (![4, 8, 16, 32, 64].includes(minSpan) || ![64, 128, 256, 512].includes(maxSpan) || minSpan > maxSpan)
        throw Error('Invalid region span budget.');
    const stats = { opaquePixels: 0, mixedPixels: 0, spans: 0, opaqueSpans: 0, mixedSpans: 0, reusedFragments: 0, newFragments: 0, sourcePixelMismatches: 0 };
    const refs: number[] = [], rowRanges: [
        number,
        number
    ][] = [], startBytes = catalog.bytes, startChunks = catalog.chunks.length;
    let checksum = 1, previousOwner = new Int16Array(width).fill(-1);
    refs.push(add(catalog, Buffer.concat([pngHeader(width, height), pngChunk('IDAT', Buffer.from([0x78, 0x9c]))])));
    for (let y = 0; y < height; y++) {
        const rowRefStart = refs.length;
        const owner = new Int16Array(width).fill(-1), sealed = new Uint8Array(width), rowStart = y * width * 4;
        for (let k = layers.length - 1; k >= 0; k--) {
            const data = layers[k]!.data;
            for (let x = 0; x < width; x++) {
                if (sealed[x])
                    continue;
                const a = data[rowStart + x * 4 + 3]!;
                if (!a)
                    continue;
                owner[x] = owner[x] === -1 ? k : -2;
                if (a === 255)
                    sealed[x] = 1;
            }
        }
        for (let x = 0; x < width; x++) {
            if (owner[x]! >= 0 && sealed[x])
                stats.opaquePixels++;
            else {
                stats.mixedPixels++;
                owner[x] = -2;
            }
        }
        const partition = owner.slice();
        if (filter === 'up' && y > 0)
            for (let x = 0; x < width; x++)
                if (partition[x] !== previousOwner[x])
                    partition[x] = -2;
        previousOwner = owner;
        if (filter === 'up') {
            const marker = Buffer.from([2]);
            refs.push(add(catalog, pngChunk('IDAT', Buffer.from([0, 1, 0, 254, 255, 2]))));
            checksum = combinePNGAdler(checksum, pngAdler(marker), 1);
        }
        let previous: Uint8Array = new Uint8Array(4);
        const emit = (x: number, count: number, source: number) => {
            const begin = rowStart + x * 4, end = begin + count * 4, expected = reference.data.subarray(begin, end);
            let pixels: Uint8Array | Uint8ClampedArray = expected;
            if (source >= 0) {
                const original = layers[source]!.data.subarray(begin, end);
                if (same(original, expected)) {
                    pixels = original;
                    stats.opaqueSpans++;
                }
                else {
                    stats.sourcePixelMismatches++;
                    stats.mixedSpans++;
                }
            }
            else
                stats.mixedSpans++;
            if (filter === 'up') {
                const raw = new Uint8Array(pixels.length);
                for (let i = 0; i < pixels.length; i++)
                    raw[i] = (pixels[i]! - (y ? reference.data[begin - width * 4 + i]! : 0)) & 255;
                const key = 'up:' + rasterHash(raw);
                let fragment = catalog.fragments.get(key);
                stats.spans++;
                if (fragment)
                    stats.reusedFragments++;
                else {
                    fragment = { first: new Uint8Array(0), last: new Uint8Array(0), body: add(catalog, pngChunk('IDAT', deflateRawSync(raw, { level: 9, finishFlush: constants.Z_SYNC_FLUSH }))), adler: pngAdler(raw), length: raw.length };
                    catalog.fragments.set(key, fragment);
                    stats.newFragments++;
                }
                refs.push(fragment.body);
                checksum = combinePNGAdler(checksum, fragment.adler, fragment.length);
                return;
            }
            stats.spans++;
            const key = rasterHash(pixels);
            let fragment = catalog.fragments.get(key);
            if (fragment) {
                stats.reusedFragments++;
            }
            else {
                const interior = new Uint8Array(pixels.length - 4);
                for (let i = 4; i < pixels.length; i++)
                    interior[i - 4] = (pixels[i]! - pixels[i - 4]!) & 255;
                const compressed = deflateRawSync(interior, { level: 9, finishFlush: constants.Z_SYNC_FLUSH });
                fragment = { first: Uint8Array.from(pixels.subarray(0, 4)), last: Uint8Array.from(pixels.subarray(pixels.length - 4)), body: add(catalog, pngChunk('IDAT', compressed)), adler: pngAdler(interior), length: interior.length };
                catalog.fragments.set(key, fragment);
                stats.newFragments++;
            }
            // Four predictor bytes are the only dependency across span boundaries. Encode them
            // separately so the large interior stays identical when an adjacent trait changes.
            const prefix = new Uint8Array(x === 0 ? 5 : 4);
            if (x === 0)
                prefix[0] = 1;
            for (let c = 0; c < 4; c++)
                prefix[prefix.length - 4 + c] = (fragment.first[c]! - previous[c]!) & 255;
            const stored = Buffer.from([0, prefix.length, 0, 255 - prefix.length, 255, ...prefix]);
            refs.push(add(catalog, pngChunk('IDAT', stored)), fragment.body);
            checksum = combinePNGAdler(checksum, pngAdler(prefix), prefix.length);
            checksum = combinePNGAdler(checksum, fragment.adler, fragment.length);
            previous = fragment.last;
        };
        const visit = (x: number, count: number) => {
            const first = partition[x]!;
            let uniform = first >= 0;
            for (let i = x + 1; uniform && i < x + count; i++)
                uniform = partition[i] === first;
            if (uniform || count <= minSpan) {
                emit(x, count, uniform ? first : -2);
                return;
            }
            const left = Math.floor(count / 2);
            visit(x, left);
            visit(x + left, count - left);
        };
        for (let x = 0; x < width; x += maxSpan)
            visit(x, Math.min(maxSpan, width - x));
        rowRanges.push([rowRefStart, refs.length]);
    }
    const end = Buffer.alloc(6);
    end[0] = 3;
    end.writeUInt32BE(checksum, 2);
    refs.push(add(catalog, Buffer.concat([pngChunk('IDAT', end), pngChunk('IEND', Buffer.alloc(0))])));
    const packed = Buffer.alloc(refs.length * 4);
    refs.forEach((ref, i) => packed.writeUInt32BE(ref, i * 4));
    return { schema: 'keel-raster-regions@1' as const, width, height, minSpan, maxSpan, filter, refs, rowRanges, packed, pixelDigest: rasterHash(reference.data), stats, newChunkBytes: catalog.bytes - startBytes, newChunks: catalog.chunks.length - startChunks, pngBytes: refs.reduce((n, id) => n + catalog.chunks[id]!.length, 0), publicationReady: false as const };
}
export function assembleRasterRegions(refs: number[], catalog: RegionCatalog) { if (refs.some(id => !Number.isInteger(id) || id < 0 || !catalog.chunks[id]))
    throw Error('Unknown region chunk.'); return Buffer.concat(refs.map(id => catalog.chunks[id]!)); }
