import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createIntegrity } from '@keel/protocol';
import { slotProgram } from '../packages/game-engine/chain/reuse.mjs';
import { readFile } from 'node:fs/promises';
import { KEEL_CREATIVE_RUNTIME_CATALOG } from '@keel/sdk/creative-runtime-catalog';
import { buildKeelInlineModuleFragment } from '@keel/sdk/inline-viewer-graph';

test('shared library identity allows exact installed bytes but rejects a name-only substitution', async () => {
  const resource = KEEL_CREATIVE_RUNTIME_CATALOG.flatMap(r => r.resources).find(r => r.id === 'three-r180-core');
  const bytes = await readFile(new URL('../' + resource.localPath, import.meta.url));
  const input = { moduleId: resource.id, version: resource.version, mediaType: resource.mediaType, decodedBytes: bytes };
  await buildKeelInlineModuleFragment(input);
  await assert.rejects(buildKeelInlineModuleFragment({ ...input, decodedBytes: Buffer.concat([bytes, Buffer.from('\nfetch("https://evil.example")')]) }), /pinned artifact/);
  await assert.rejects(buildKeelInlineModuleFragment({ ...input, moduleId: 'creator/custom', decodedBytes: Buffer.from('fetch("https://evil.example")') }), /external resource/);
});

test('shared slots compare decoded code despite different valid gzip streams', async () => {
  const source = Buffer.from('const generator = seed => seed * 7;\n'.repeat(100));
  const make = async level => {
    const stored = gzipSync(source, { level });
    return Buffer.from(',' + JSON.stringify({ id: 'test/generator', role: 'module', mediaType: 'text/javascript', integrity: await createIntegrity(source), embedded: { compression: 'gzip', storedBase64: stored.toString('base64'), storedIntegrity: await createIntegrity(stored) } }));
  };
  const first = await make(1), second = await make(9);
  assert.notDeepEqual(first, second);
  const a = await slotProgram(first), b = await slotProgram(second);
  assert.equal(a.metadata, b.metadata);
  assert.deepEqual(a.decoded, b.decoded);
  const corrupt = JSON.parse(first.toString().slice(1));
  corrupt.integrity.digest = '0x' + '0'.repeat(64);
  await assert.rejects(slotProgram(Buffer.from(',' + JSON.stringify(corrupt))), /integrity mismatch/);
  corrupt.integrity = await createIntegrity(source);
  corrupt.embedded.storedBase64 = corrupt.embedded.storedBase64.replace(/=+$/, '');
  if (corrupt.embedded.storedBase64 !== JSON.parse(first.toString().slice(1)).embedded.storedBase64) await assert.rejects(slotProgram(Buffer.from(',' + JSON.stringify(corrupt))), /Base64/);
});
