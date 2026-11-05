import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
const { selectKeelRegisteredInlineCandidate, keelRegisteredInlineRecipeDigest } = await import('../packages/sdk/dist/registered-inline-candidates.js');
const { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlineRawPercentTokenURIGraph } = await import('../packages/sdk/dist/inline-viewer-graph.js');
const enc = new TextEncoder(), hash = (v) => `0x${createHash('sha256').update(v).digest('hex')}`, id = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const original = enc.encode('<p>original bytes</p>'), derived = enc.encode('<p>deterministic presentation</p>'), image = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64'));
async function run(mode) {
    const shell = await buildKeelInlineShellFragments();
    const make = async (tamper) => {
        const bytes = tamper && mode === 'bytes' ? enc.encode('<p>injected presentation</p>') : derived;
        const assets = [{
                id: 'presentation', mediaType: tamper && mode === 'mime' ? 'text/plain' : 'text/html', source: bytes, compression: 'none'
            }, ...(tamper && mode === 'extra' ? [{
                    id: 'unbound', mediaType: 'text/plain', source: enc.encode('extra'), compression: 'none'
                }] : [])];
        const doc = await buildKeelInlineLocalDocument({
            shell, modules: [], assets: tamper && mode === 'missing-original' ? [] : tamper && mode === 'missing-derived' ? [] : assets, entry: {
                id: tamper && mode === 'missing-original' ? 'presentation' : 'original', mediaType: 'text/html', source: tamper && mode === 'missing-original' ? derived : original, compression: 'none'
            }
        });
        return buildKeelInlineRawPercentTokenURIGraph(doc);
    };
    const expected = await make(false);
    const recipe = {
        profile: 'local-test', chainId: 1, store: `0x${'1'.repeat(40)}`, registry: `0x${'2'.repeat(40)}`, reader: `0x${'3'.repeat(40)}`, readerRuntimeCodeHash: id(1), registrationDigest: id(2), revision: 1, codec: 'none', sourceReader: 'canonical-items', registeredParts: expected.parts.flatMap((p, i) => p.sourceKind === 'existing' ? [{
                objectId: id(i + 10), digest: hash(p.bytes), byteLength: p.bytes.length, role: 'boot-and-decoder'
            }] : []), derivedSources: [{
                id: 'presentation', mediaType: 'text/html', digest: hash(derived), byteLength: derived.length
            }]
    };
    if (mode === 'overlap')
        recipe.derivedSources[0].id = 'original';
    return selectKeelRegisteredInlineCandidate({
        sources: [{
                id: 'original', mediaType: 'text/html', bytes: original
            }], collectorImage: { mediaType: 'image/png', bytes: image }, metadataFields: { name: 'same' }, measurementScope: { kind: 'provisional-template', templateDigest: id(3) }, candidates: [{
                id: 'test', status: 'registered-recipe', recipe, build: async () => {
                    const graph = await make(true);
                    const metadata = {
                        name: 'same', image: `data:image/png;base64,${Buffer.from(image).toString('base64')}`, animation_url: `data:text/html;base64,${Buffer.from(graph.htmlBytes).toString('base64')}`
                    };
                    return {
                        recipeDigest: keelRegisteredInlineRecipeDigest(recipe), tokenURI: `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString('base64')}`, documentParts: graph.parts.map((p, i) => ({
                            objectId: p.sourceKind === 'existing' ? recipe.registeredParts.find((r) => r.digest === hash(p.bytes)).objectId : id(i + 100), bytes: p.bytes, disposition: p.sourceKind === 'existing' ? 'reused' : 'new', role: p.sourceKind === 'existing' ? 'boot-and-decoder' : 'payload'
                        }))
                    };
                }
            }]
    });
}
test('committed deterministic presentation passes without changing originals', async () => {
    await run('normal');
});
for (const [mode, match] of [['bytes', /derived presentation/], ['mime', /derived presentation/], ['extra', /unregistered source/], ['missing-original', /omitted an original/], ['missing-derived', /omitted a derived/], ['overlap', /cannot replace an original/]])
    test(`reject ${mode}`, async () => {
        await assert.rejects(run(mode), match);
    });
