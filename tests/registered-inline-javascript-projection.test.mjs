import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
const { selectKeelRegisteredInlineCandidate, keelRegisteredInlineRecipeDigest, replayKeelJavaScriptProjection } = await import('../packages/sdk/dist/registered-inline-candidates.js');
const { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlineModuleFragment, buildKeelInlineRawPercentTokenURIGraph } = await import('../packages/sdk/dist/inline-viewer-graph.js');
const { KEEL_THREE_R180 } = await import('../packages/sdk/dist/three-module.js');
const enc = new TextEncoder(), sha = (v) => `0x${createHash('sha256').update(v).digest('hex')}`, id = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const source = enc.encode('globalThis.answer = 42;'), image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
const commitment = (bytes) => ({ digest: sha(bytes), byteLength: bytes.length });
async function fixture(mode = 'normal', withModules = false) {
    const source = enc.encode((mode === 'bom' ? '\uFEFF' : '') + 'globalThis.answer = 42;');
    const shell = await buildKeelInlineShellFragments();
    const modules = withModules ? await Promise.all(['test-alpha', 'test-beta'].map((moduleId, i) => buildKeelInlineModuleFragment({
        moduleId, version: '1.0.0', decodedBytes: enc.encode(`globalThis.fixture${i}=true;`), mediaType: 'text/javascript', execution: 'classic', phase: 'runtime', compression: 'none'
    }))) : [];
    const moduleRecords = modules.map((m, i) => ({
        id: m.moduleId, objectId: id(i + 20), mediaType: 'text/javascript', ...commitment(enc.encode(`globalThis.fixture${i}=true;`)), execution: m.execution, phase: m.phase, weight: m.weight
    }));
    const output = enc.encode('<div id="stage"></div>' + moduleRecords.map(m => `<script src="${m.id}"></script>`).join('') + `<script type="module">${new TextDecoder().decode(source)}</script>`);
    const projection = {
        schema: 'keel-javascript-entry-projection@1', source: {
            id: 'original', mediaType: 'text/javascript', ...commitment(source)
        }, output: { mediaType: 'text/html', ...commitment(output) }, modules: moduleRecords
    };
    const make = async (tamper = false) => {
        const entry = mode === 'wrapper' && tamper ? {
            id: 'original', mediaType: 'text/html', source: enc.encode(new TextDecoder().decode(output) + '<p>injected</p>')
        } : mode === 'missing' && tamper ? {
            id: 'other', mediaType: 'text/javascript', source
        } : mode === 'mime' && tamper ? {
            id: 'original', mediaType: 'text/javascript', source: enc.encode('changed source')
        } : {
            id: 'original', mediaType: 'text/javascript', source: mode === 'bom' ? enc.encode(new TextDecoder().decode(source)) : source
        };
        const assets = mode === 'extra' && tamper ? [{
                id: 'unbound', mediaType: 'text/plain', source: enc.encode('extra')
            }] : [];
        return buildKeelInlineRawPercentTokenURIGraph(await buildKeelInlineLocalDocument({
            shell, modules, assets, entry: entry
        }));
    };
    const expected = await make();
    const modulePart = (p) => p.role === 'module' ? moduleRecords.find(m => m.id === JSON.parse(new TextDecoder().decode(p.decodedHtmlBytes).slice(1)).id) : undefined;
    const recipe = {
        profile: 'local-test', chainId: 1, store: `0x${'1'.repeat(40)}`, registry: `0x${'2'.repeat(40)}`, reader: `0x${'3'.repeat(40)}`, readerRuntimeCodeHash: id(1), registrationDigest: id(2), revision: 1, codec: 'none', sourceReader: 'canonical-items', registeredParts: expected.parts.flatMap((p, i) => p.sourceKind === 'existing' ? [{
                objectId: modulePart(p)?.objectId ?? id(i + 10), digest: sha(p.bytes), byteLength: p.bytes.length, role: modulePart(p) ? 'module' : 'boot-and-decoder'
            }] : []), sharedSources: moduleRecords.map(({ id, mediaType, digest, byteLength }) => ({
            id, mediaType, digest, byteLength
        })), javascriptProjection: projection
    };
    if (mode === 'input-digest')
        projection.source.digest = id(99);
    if (mode === 'input-mime')
        projection.source.mediaType = 'text/html';
    if (mode === 'output-digest')
        projection.output.digest = id(99);
    if (mode === 'output-mime')
        projection.output.mediaType = 'text/javascript';
    if (mode === 'module-order')
        projection.modules.reverse();
    if (mode === 'module-digest')
        projection.modules[0].digest = id(99);
    if (mode === 'module-execution')
        projection.modules[0].execution = 'module';
    if (mode === 'module-extra')
        projection.modules.push({ ...moduleRecords[0], id: 'extra-module' });
    if (mode === 'unknown-schema')
        projection.schema = 'caller-arbitrary-projection';
    if (mode === 'overlap')
        recipe.derivedSources = [{
                id: 'original', mediaType: 'text/html', ...commitment(output)
            }];
    const actualSource = mode === 'original' ? enc.encode('globalThis.answer = 43;') : source;
    const result = await selectKeelRegisteredInlineCandidate({
        sources: [{
                id: 'original', mediaType: 'text/javascript', bytes: actualSource
            }], collectorImage: { mediaType: 'image/png', bytes: image }, metadataFields: { name: 'same' }, measurementScope: { kind: 'provisional-template', templateDigest: id(3) }, candidates: [{
                id: 'test', status: 'registered-recipe', recipe, build: async () => {
                    const graph = await make(true);
                    return {
                        recipeDigest: keelRegisteredInlineRecipeDigest(recipe), tokenURI: `data:application/json;base64,${Buffer.from(JSON.stringify({
                            name: 'same', image: `data:image/png;base64,${image.toString('base64')}`, animation_url: `data:text/html;base64,${Buffer.from(graph.htmlBytes).toString('base64')}`
                        })).toString('base64')}`, documentParts: graph.parts.map((p, i) => ({
                            objectId: p.sourceKind === 'existing' ? recipe.registeredParts.find((r) => r.digest === sha(p.bytes)).objectId : id(i + 100), bytes: p.bytes, disposition: p.sourceKind === 'existing' ? 'reused' : 'new', role: p.sourceKind === 'existing' ? (modulePart(p) ? 'module' : 'boot-and-decoder') : 'payload'
                        }))
                    };
                }
            }]
    });
    assert.equal(result.selected.sourceByteIdentity, 'verified-original-and-deterministic-javascript-projection');
    return result;
}
test('exact original to wrapper replay, truthful projection identity, no modules', () => fixture());
test('exact ordered authenticated classic-module wrapper replay', () => fixture('normal', true));
for (const mode of ['original', 'wrapper', 'mime', 'input-digest', 'input-mime', 'output-digest', 'output-mime', 'extra', 'missing', 'unknown-schema', 'overlap'])
    test(`reject ${mode}`, async () => {
        await assert.rejects(fixture(mode));
    });
for (const mode of ['module-order', 'module-digest', 'module-execution', 'module-extra'])
    test(`reject ${mode}`, async () => {
        await assert.rejects(fixture(mode, true));
    });
test('closing script remains rejected by independent projection replay', () => {
    const bytes = enc.encode('console.log("</script><script>bad</script>")');
    assert.throws(() => replayKeelJavaScriptProjection({
        id: 'original', mediaType: 'text/javascript', bytes
    }, {
        schema: 'keel-javascript-entry-projection@1', source: {
            id: 'original', mediaType: 'text/javascript', ...commitment(bytes)
        }, output: {
            mediaType: 'text/html', digest: id(9), byteLength: 1
        }, modules: []
    }), /closing script/);
});
test('exact maintained Three identities permit only the existing deterministic import rewrite', () => {
    const bytes = enc.encode("import * as THREE from 'three';\nimport('three.js');"), output = enc.encode("<div id=\"stage\"></div><script type=\"module\">import * as THREE from 'three.module.min.js';\nimport('three.module.min.js');</script>");
    const modules = [KEEL_THREE_R180.core, KEEL_THREE_R180.main].map((p, i) => ({
        id: p.id, objectId: id(50 + i), mediaType: 'text/javascript', digest: p.digest.replace('sha256:', '0x'), byteLength: p.byteLength, execution: 'module', phase: 'runtime', weight: 0
    }));
    const p = {
        schema: 'keel-javascript-entry-projection@1', source: {
            id: 'original', mediaType: 'text/javascript', ...commitment(bytes)
        }, output: { mediaType: 'text/html', ...commitment(output) }, modules
    };
    assert.deepEqual(replayKeelJavaScriptProjection({
        id: 'original', mediaType: 'text/javascript', bytes
    }, p), output);
    assert.throws(() => replayKeelJavaScriptProjection({
        id: 'original', mediaType: 'text/javascript', bytes
    }, { ...p, modules: modules.slice(1) }), /output commitment/);
    assert.throws(() => replayKeelJavaScriptProjection({
        id: 'original', mediaType: 'text/javascript', bytes
    }, { ...p, modules: modules.map((m, i) => i ? m : { ...m, digest: id(99) }) }), /exact maintained/);
});
test('BOM is retained in original commitment but stripped in canonical projected output', () => fixture('bom'));
