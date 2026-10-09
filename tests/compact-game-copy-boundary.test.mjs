import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// Run against the built validation checkout; this test creates no build/output files.
// KEEL_STORAGE_SDK_ROOT=/path/to/sdk node --test compact-game-copy-boundary.test.mjs
const taskDirectory = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(process.env.KEEL_STORAGE_SDK_ROOT ?? path.join(taskDirectory, '..'));
const fileURL = relative => pathToFileURL(path.join(sdkRoot, relative)).href;
const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const requireSDK = createRequire(path.join(sdkRoot, 'package.json'));

test('Compact game COPY rejects encoded module bytes before object/chunk planning; Raw provides the positive control', async context => {
  const { build } = await import(pathToFileURL(requireSDK.resolve('esbuild')).href);
  const sdk = await import(fileURL('packages/sdk/dist/inline-viewer-graph.js'));

  // Compile a deterministic classic game module with real esbuild, entirely in memory.
  // The literal is intentionally compressible and survives compilation as creator data.
  const input = `globalThis.__KEEL_GAME_COPY_FIXTURE__={main(){return ${JSON.stringify('KEEL copy boundary '.repeat(512))};}};`;
  const compiled = await build({
    stdin: { contents: input, loader: 'ts', sourcefile: 'compact-game-copy-boundary-fixture.ts' },
    bundle: false, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    minify: false, legalComments: 'none', logLevel: 'silent',
  });
  const bytes = new Uint8Array(compiled.outputFiles[0].contents);
  const packedBytes = gzipSync(bytes, { level: 9 }).length;
  assert.ok(packedBytes < bytes.length, 'fixture must follow the engine Compact branch selecting gzip');

  // Observe actual SDK object/composite planners. Only the dependency import is
  // redirected; planGame and all its control flow execute the repository source.
  const observedNativeSource = `
    import {createKeelManagedObjectPlan as objectPlan,createKeelManagedCompositePlan as compositePlan} from ${JSON.stringify(fileURL('packages/sdk/dist/native-publication.js'))};
    export const calls={objects:0,composites:0,chunkBytes:0};
    export async function createKeelManagedObjectPlan(...args){calls.objects++;const plan=await objectPlan(...args);calls.chunkBytes+=plan.chunks.reduce((n,c)=>n+c.bytes.length,0);return plan;}
    export function createKeelManagedCompositePlan(...args){calls.composites++;return compositePlan(...args);}
  `;
  const observedNativeURL = dataURL(observedNativeSource);
  const observation = await import(observedNativeURL);
  const publicationPath = path.join(sdkRoot, 'packages/game-engine/chain/publication.mjs');
  const publicationSource = await readFile(publicationPath, 'utf8');
  const replacements = new Map([
    ['"@keel/sdk/inline-viewer-graph"', JSON.stringify(fileURL('packages/sdk/dist/inline-viewer-graph.js'))],
    ['"@keel/sdk/native-publication"', JSON.stringify(observedNativeURL)],
    ['"viem"', JSON.stringify(pathToFileURL(requireSDK.resolve('viem').replace('/_cjs/', '/_esm/')).href)],
    ['"./contracts.mjs"', JSON.stringify(fileURL('packages/game-engine/chain/contracts.mjs'))],
  ]);
  let instrumented = publicationSource;
  for (const [before, after] of replacements) {
    assert.equal(instrumented.split(before).length - 1, 1, `publication dependency changed: ${before}`);
    instrumented = instrumented.replace(before, after);
  }
  const { planGame } = await import(dataURL(instrumented));
  const shell = await sdk.buildKeelInlineShellFragments();
  const gameId = 'fixtures.copy-boundary';
  const buildDocument = async payloadStorage => {
    const compression = payloadStorage === 'raw' || packedBytes >= bytes.length ? 'none' : 'gzip';
    const module = await sdk.buildKeelInlineModuleFragment({
      moduleId: gameId, version: '1', mediaType: 'text/javascript', decodedBytes: bytes,
      compression, payloadStorage, execution: 'classic', phase: 'runtime', weight: 0,
    });
    const document = await sdk.buildKeelInlineLocalDocument({
      shell, payloadStorage, modules: [module],
      entry: { id: 'fixtures.copy-boundary.entry', mediaType: 'text/html', source: new TextEncoder().encode('<!doctype html><html><body>Copy boundary fixture</body></html>') },
    });
    return { module, doc: { document, modules: [{ id: gameId, version: '1' }] } };
  };
  const parameters = { engineModuleIds: new Set(), hold: `0x${'0'.repeat(39)}1`, gameId };
  const compact = await buildDocument('compact');
  assert.equal(compact.module.item.embedded.compression, 'gzip');
  assert.deepEqual(new Uint8Array(Buffer.from(compact.module.item.embedded.storedBase64, 'base64')), new Uint8Array(gzipSync(bytes, { level: 9 })));
  await assert.rejects(planGame({ ...parameters, doc: compact.doc }), /Fresh Inline forbids new storedBase64\/storedHex body copies/);
  assert.deepEqual(observation.calls, { objects: 0, composites: 0, chunkBytes: 0 });

  // The control proves both the planner observation and COPY path execute normally.
  const raw = await buildDocument('raw');
  assert.equal(raw.module.item.embedded.compression, 'none');
  assert.equal(raw.module.item.embedded.storedBase64, undefined);
  assert.deepEqual(new TextEncoder().encode(raw.module.item.embedded.storedText), bytes);
  const plan = await planGame({ ...parameters, doc: raw.doc });
  assert.equal(plan.schema, 'keel-game-publication-plan@1');
  assert.equal(observation.calls.objects, raw.doc.document.parts.length);
  assert.equal(observation.calls.composites, 1);
  assert.ok(observation.calls.chunkBytes > 0);
  context.diagnostic(JSON.stringify({
    fixture: 'classic game main() returning "KEEL copy boundary " repeated 512 times',
    compiledBytes: bytes.length, selectedGzipBytes: packedBytes,
    publicationSourceSha256: createHash('sha256').update(publicationSource).digest('hex'),
    compact: { result: 'rejected-before-object-planning', objectPlans: 0, compositePlans: 0, plannedChunkBytes: 0 },
    raw: { result: 'local-review-plan-only', ...observation.calls },
    signing: 'not-performed', submission: 'not-performed',
  }));
});

test('maintained fresh game and release producers use the same exact UTF-8 COPY slots', async () => {
  const { build } = await import(pathToFileURL(requireSDK.resolve('esbuild')).href);
  const sdk = await import(fileURL('packages/sdk/dist/inline-viewer-graph.js'));
  const { engineBuilds } = await import(fileURL('packages/game-engine/chain/build.mjs'));
  const { slotProgram } = await import(fileURL('packages/game-engine/chain/reuse.mjs'));
  const { planGame, planEngineRelease } = await import(fileURL('packages/game-engine/chain/publication.mjs'));
  const compiled = await build({
    stdin: { contents: `globalThis.fixture=${JSON.stringify('UTF-8 🔥 % # ? & </script> '.repeat(400))};`, loader: 'ts' },
    bundle: false, write: false, format: 'iife', platform: 'browser', target: 'es2022',
    minify: false, legalComments: 'none', logLevel: 'silent',
  });
  const bytes = new Uint8Array(compiled.outputFiles[0].contents);
  const manifest = { id: 'fixtures.copy-producer', version: '1', kind: 'runtime', phase: 'runtime', weight: 0 };
  const shell = await sdk.buildKeelInlineShellFragments();
  const legacyModule = await sdk.buildKeelInlineModuleFragment({
    moduleId: manifest.id, version: manifest.version, mediaType: 'text/javascript',
    decodedBytes: bytes, compression: 'gzip', execution: 'classic', phase: manifest.phase, weight: manifest.weight,
  });
  const legacyDocument = await sdk.buildKeelInlineLocalDocument({ shell, modules: [legacyModule],
    entry: { id: 'fixtures.copy-producer.entry', mediaType: 'text/html', source: Buffer.from('<main>fixture</main>') },
  });
  const legacy = { document: legacyDocument, html: legacyDocument.rootBytes,
    modules: [{ ...manifest, bytes: bytes.length, stored: gzipSync(bytes).length }],
  };
  const original = legacy.html.slice();
  const root = await mkdtemp(path.join(tmpdir(), 'keel-copy-producer-'));
  try {
    // The pinned engine builds gzip local-preview slots even when a caller
    // supplies payloadStorage. Its output remains valid as an explicit codec
    // fixture; only the maintained fresh publisher chooses the COPY text lane.
    const builds = engineBuilds({ root, keel: {
      closureOf: () => [],
      buildGameDocument: async () => legacy,
      bundleModule: async () => ({ manifest, bytes }),
    } });
    const workspace = [{ origin: 'engine', manifest }];
    const compact = await builds.buildGame({ workspace, gameId: manifest.id });
    const raw = await builds.buildGame({ workspace, gameId: manifest.id, payloadStorage: 'raw' });
    const release = await builds.buildEngineRelease({ workspace, shell });
    assert.deepEqual(release.failed, []);
    assert.deepEqual(legacy.html, original, 'preparation must not mutate the input or any published fixture');
    assert.equal(legacyModule.item.embedded.compression, 'gzip', 'explicit SDK codec remains unchanged');
    for (const doc of [compact.doc, raw.doc, release.doc]) {
      const part = doc.document.parts.find(part => part.role === 'module');
      const item = JSON.parse(Buffer.from(part.bytes).toString().slice(1));
      assert.equal(item.embedded.compression, 'none');
      assert.equal(item.embedded.storedBase64, undefined);
      assert.equal(item.embedded.storedHex, undefined);
      assert.deepEqual(Buffer.from(item.embedded.storedText), Buffer.from(bytes));
      assert.deepEqual(item.integrity, legacyModule.item.integrity);
      assert.deepEqual((await slotProgram(part.bytes)).decoded, Buffer.from(bytes));
      const plan = await planGame({ doc, engineModuleIds: new Set([manifest.id]), hold: `0x${'1'.repeat(40)}`, gameId: manifest.id });
      assert.equal(plan.parts.filter(part => part.role === 'module').length, 1);
      assert.equal(plan.parts.length, doc.document.parts.length, 'only the chosen representation enters object planning');
    }
    const moduleBytes = doc => doc.document.parts.find(part => part.role === 'module').bytes;
    assert.deepEqual(moduleBytes(compact.doc), moduleBytes(release.doc), 'release and game must share one object identity');
    assert.deepEqual(compact.doc.html, raw.doc.html, 'explicit Raw must retain the exact UTF-8 path');
    for (const role of ['shell-prefix', 'entrypoint', 'shell-suffix']) {
      assert.deepEqual(compact.doc.document.parts.find(part => part.role === role).bytes,
        legacyDocument.parts.find(part => part.role === role).bytes, `${role} must remain unchanged`);
    }
    assert.equal(compact.doc.modules[0].stored, bytes.length);
    const parameters = { hold: `0x${'1'.repeat(40)}`, engineModuleIds: release.engineModuleIds };
    const inventory = await planEngineRelease({ ...parameters, ...release });
    const full = await planGame({ ...parameters, doc: release.doc, gameId: 'keel-engine/release' });
    assert.equal(inventory.root, undefined, 'the release never publishes an all-catalogue token root');
    assert.deepEqual(inventory.parts.map(part => part.objectId), full.parts.filter(part => part.share !== 'game').map(part => part.objectId));
    await assert.rejects(planEngineRelease({ ...parameters, shell, doc: legacy }), /Fresh Inline forbids/,
      'existing encoded slots must not be silently migrated or exempted from the publication guard');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('release catalogue plans independent slots while complete game limits remain enforced', async () => {
  const sdk = await import(fileURL('packages/sdk/dist/inline-viewer-graph.js'));
  const { planEngineRelease, planGame } = await import(fileURL('packages/game-engine/chain/publication.mjs'));
  const shell = await sdk.buildKeelInlineShellFragments();
  const modules = await Promise.all([0, 1, 2].map(index => sdk.buildKeelInlineModuleFragment({
    moduleId: `fixtures.catalogue-${index}`, version: '1', mediaType: 'text/javascript',
    decodedBytes: Buffer.from(`globalThis.fixture${index}="${'A'.repeat(700_000)}";`), compression: 'none', execution: 'classic',
  })));
  const document = await sdk.buildKeelInlineLocalDocument({ shell, modules,
    entry: { id: 'keel-engine/release', mediaType: 'text/javascript', source: Buffer.from('void 0;\n') },
  });
  const doc = { document, modules: modules.map(module => ({ id: module.moduleId, version: module.version })) };
  const parameters = { doc, shell, hold: `0x${'1'.repeat(40)}`, engineModuleIds: new Set(modules.map(module => module.moduleId)) };
  assert.ok(document.byteLength > 2_000_000);
  await assert.rejects(planGame({ ...parameters, gameId: 'oversized-game' }), /inspection limit|public-read ceiling/);
  const release = await planEngineRelease(parameters);
  assert.equal(release.parts.length, modules.length + 2);
  assert.equal(release.root, undefined);
  assert.equal(release.parts.filter(part => part.role === 'entrypoint').length, 0);
  for (const module of modules) assert.equal(release.parts.filter(part => part.moduleId === module.moduleId).length, 1);
});
