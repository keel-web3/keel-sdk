/** The Gator release contract: one JSON response carries both complete views. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from 'viem';

export const GATOR_INLINE_ROOT = 'apps/desktop/artifacts/gator-inline-sepolia/3750-shared-prepared';

export function assertGatorInlineMetadata(bytes, {svg, html, original, layerCount}) {
  const metadata = JSON.parse(Buffer.from(bytes).toString('utf8'));
  assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Return one metadata object, not wrapped JSON.');
  assert.ok(/^data:image\/svg\+xml(?:;charset=utf-8)?,/.test(metadata.image ?? ''), 'Gator image must be the complete inline layered SVG.');
  assert.ok(/^data:text\/html(?:;charset=utf-8)?,/.test(metadata.animation_url ?? ''), 'animation_url must contain the complete verified HTML.');
  const decode = uri => Buffer.from(decodeURIComponent(uri.slice(uri.indexOf(',') + 1)));
  assert.deepEqual(decode(metadata.image), Buffer.from(svg), 'Returned SVG differs from the approved layered image.');
  assert.deepEqual(decode(metadata.animation_url), Buffer.from(html), 'Returned HTML differs from the prepared canonical viewer.');
  const source = Buffer.from(svg).toString('utf8');
  const images = [...source.matchAll(/<image\b[^>]*\bhref="([^"]+)"/g)];
  assert.equal(images.length, layerCount, 'SVG must include every selected layer.');
  for (const [, uri] of images) assert.match(uri, /^data:image\/(?:avif|webp);base64,/, 'SVG layers must be embedded AVIF/WebP, never a second web3 image call.');
  assert.doesNotMatch(source, /<(?:script|foreignObject)\b/i, 'The image must render without scripts.');
  const {image, animation_url, ...fields} = metadata;
  const {image: oldImage, animation_url: oldAnimation, ...originalFields} = original;
  assert.deepEqual(fields, originalFields, 'Original contract-selected metadata must remain exact.');
  assert.ok(bytes.length <= 2_000_000, 'Complete JSON exceeds the approved 2 MB ceiling.');
  return {metadata, proof: {jsonBytes: bytes.length, jsonDigest: sha256(bytes), imageType: 'image/svg+xml', animationType: 'text/html', embeddedLayers: images.length, mediaPointers: 0, originalMetadataExact: true, svgExact: true, verifiedHTMLExact: true}};
}

export async function loadGatorInlineMetadata(root = GATOR_INLINE_ROOT) {
  const [bytes, svg, html, source, graph, acceptance, audit] = await Promise.all([
    readFile(root + '/metadata-candidate.json'), readFile(root + '/image.svg'), readFile(root + '/viewer.html'),
    readFile('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json'),
    readFile(root + '/json-graph.json', 'utf8'), readFile(root + '/matrix-acceptance.json', 'utf8'),
    readFile('apps/desktop/artifacts/gator-ape-rebuild/layer-audit.json', 'utf8'),
  ]);
  const original = JSON.parse(source), layerCount = JSON.parse(audit).tokens.find(t => t.tokenId === 0).stack.length;
  const result = assertGatorInlineMetadata(bytes, {svg, html, original, layerCount});
  assert.equal(result.proof.jsonDigest, JSON.parse(graph).integrity.digest, 'Metadata must match the shared matrix graph.');
  assert.equal(result.proof.jsonDigest, JSON.parse(acceptance).jsonDigest, 'Metadata must match the local contract read proof.');
  return {...result, bytes, svg, html, original, layerCount, acceptance: JSON.parse(acceptance)};
}
