/** Prepare separate reusable objects and metadata-driven token references. No signing. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {gzipSync, brotliCompressSync} from 'node:zlib';
import {connectKeelEditor} from '@keel/sdk/editor-client';
import {gatorStack} from '@keel/sdk/gator-assembly';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {createKeelManagedObjectPlan} from '../../../packages/sdk/dist/native-managed.js';

const output = path.resolve(process.env.KEEL_GATOR_OBJECT_OUTPUT??'apps/desktop/artifacts/gator-inline-sepolia/separate-objects');
const evidence = path.resolve('apps/desktop/artifacts/gator-ape-rebuild');
const hold = '0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267';
const tokenId = 0;
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
await mkdir(path.join(output, 'chunks'), {recursive: true});

const snapshot = process.env.KEEL_OFFLINE_PROJECT_SNAPSHOT
  ? await json(process.env.KEEL_OFFLINE_PROJECT_SNAPSHOT)
  : await (await connectKeelEditor('apps/desktop/artifacts/manual-test-workspace/workspace-connection.json')).readProject('1f1e37b1-87fa-4bcf-a869-e9219c2ad898');
const assembly = snapshot.project.layered.assembly;
assert.equal(assembly.kind, 'token-gators@1');
const audit = (await json(path.join(evidence, 'layer-audit.json'))).tokens.find(token => token.tokenId === tokenId);
const metadataBytes = await readFile(path.join(evidence, 'metadata', tokenId + '.json'));
const metadataProof = await json(path.join(evidence, 'metadata', tokenId + '.json.proof.json'));
assert.equal(digest(metadataBytes), metadataProof.sha256);
assert.equal(metadataProof.sha256, audit.metadataSHA256);
assert.equal(metadataProof.uri, audit.sourceURI);
const metadata = JSON.parse(metadataBytes);
assert.equal(metadata.image, audit.sourceImage);

// Public labels are authoritative. The CID-joined source record maps historical
// file names and supplies the background omitted from public attributes.
const aliases = {Skin: 'body', Body: 'body', Eyes: 'eyes', Mouth: 'mouth', Hat: 'hat', Outfit: 'costume', Costume: 'costume', Background: 'background'};
const publicTraits = new Map();
for (const {trait_type: label, value} of metadata.attributes) {
  const trait = aliases[label];
  if (!trait) continue;
  assert.ok(!publicTraits.has(trait), 'Duplicate rendering trait: ' + trait);
  assert.equal(value, audit.traits[trait], 'Metadata changed; rerun the CID join');
  publicTraits.set(trait, value);
}
const resolved = gatorStack(assembly, audit.assetTraits);
assert.deepEqual(resolved.stack.map(piece => piece.path), audit.stack);
const originals = await json(path.join(evidence, 'webp-token-0.json'));
const candidates = process.env.KEEL_CODEC_SELECTION ? await json(process.env.KEEL_CODEC_SELECTION) : originals;
const layerObjects = new Map();
const chunkBytes = new Map();
const operations = [];

async function prepare(bytes, mediaType) {
  const planned = await createKeelManagedObjectPlan(bytes, {hold, mediaType, compression: 'none'});
  assert.equal(planned.digest, '0x' + digest(bytes));
  for (const chunk of planned.chunks) {
    const prior = chunkBytes.get(chunk.id);
    if (prior) assert.deepEqual(prior, chunk.bytes);
    else {
      chunkBytes.set(chunk.id, chunk.bytes);
      await writeFile(path.join(output, 'chunks', chunk.id.slice(2)), chunk.bytes);
    }
  }
  operations.push(...planned.operations.map(operation => ({...operation, value: String(operation.value)})));
  return {
    objectId: planned.objectId, sha256: planned.digest, byteLength: bytes.length,
    mediaType, chunkIds: planned.chunks.map(chunk => chunk.id),
    state: 'predicted-not-published',
  };
}

const pieces = [];
for (const [slot, piece] of resolved.stack.entries()) {
  const original = originals.find(row => row.path === piece.path);
  assert.ok(original, 'Missing lossless WebP: ' + piece.path);
  assert.equal(original.objectId, piece.objectId, 'Editor layer differs from verified WebP');
  const candidate = candidates.find(row => row.path === piece.path);
  assert.ok(candidate, 'Missing candidate: '+piece.path);
  assert.equal(candidate.sourceDigest, original.sourceDigest, 'Candidate source differs');
  if (!layerObjects.has(candidate.objectId)) {
    const bytes = await readFile(candidate.file);
    assert.equal(digest(bytes), candidate.objectId);
    layerObjects.set(candidate.objectId, {
      ...await prepare(bytes, candidate.type??'image/webp'),
      sourceSHA256: original.sourceDigest,
      codecs: {none: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length},
    });
  }
  pieces.push({slot, path: piece.path, sourceAssetId: piece.objectId, objectId: layerObjects.get(candidate.objectId).objectId});
}
const runtimeBytes = await readFile(LAYERED_RUNTIME.localPath);
assert.equal('0x' + digest(runtimeBytes), LAYERED_RUNTIME.integrity.digest);
const renderer = {...await prepare(runtimeBytes, 'text/javascript'), moduleId: LAYERED_RUNTIME.id, version: LAYERED_RUNTIME.version};
const metadataObject = await prepare(metadataBytes, 'application/json');
const tokenRecord = {
  schema: 'keel-gator-token-references@1', tokenId: String(tokenId),
  source: {chainId: 33139, collection: '0xd33edec311f8769c71f132a77f0c0796c22af1c5', metadataURI: metadataProof.uri, metadataSHA256: metadataProof.sha256},
  metadataObjectId: metadataObject.objectId,
  width: candidates[0].width, height: candidates[0].height,
  rendererObjectId: renderer.objectId, sourceTraits: audit.assetTraits, pieces,
};
const recordBytes = Buffer.from(JSON.stringify(tokenRecord));
const recordObject = await prepare(recordBytes, 'application/json');
await save('token-0.json', tokenRecord);
await save('objects.json', {layers: [...layerObjects.values()], renderer, metadata: metadataObject, token: recordObject});
await save('registration-operations.json', operations);
const report = {
  schema: 'keel-gator-separate-object-preparation@1', chainId: 11155111, hold,
  collection: '0xab2e21bffafdae462e9392375a413d36ea7c247c', tokenId,
  workspaceRevision: snapshot.revision, selection: 'SDK gatorStack with contract-referenced metadata and CID-joined source traits',
  pieces: pieces.length, uniqueLayers: layerObjects.size,
  layerBytes: [...layerObjects.values()].reduce((total, layer) => total + layer.byteLength, 0),
  tokenReferenceBytes: recordBytes.length, rendererBytes: runtimeBytes.length,
  uniqueChunkBytes: [...chunkBytes.values()].reduce((total, chunk) => total + chunk.length, 0),
  uniqueChunks: chunkBytes.size,
  originalDimensions: [tokenRecord.width, tokenRecord.height],
  originalsModified: false, optimizedCandidates: Boolean(process.env.KEEL_CODEC_SELECTION), generatedPNGUploaded: false, embeddedBase64Uploaded: false,
  tokenURIReadGasLimit: 60_000_000, tokenURIReadGas: null,
  tokenURIReadIncludes: 'Complete returned metadata, image, selected layer bytes and HTML; reference size alone is not a read measurement.',
  published: false, selectedChainReuseChecked: false, catalogBindingVerified: false,
  remaining: ['Validate selected-chain object and module reuse', 'Implement and measure the metadata-driven tokenURI adapter', 'Publish and read back before updating the test collection'],
};
await save('report.json', report);
console.log(JSON.stringify(report, null, 2));
