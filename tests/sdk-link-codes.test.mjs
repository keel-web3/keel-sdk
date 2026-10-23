import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import { KEEL_TEZOS_MODULES, KeelDigestAlgorithm, KeelFidelity, KeelLinkCompression, KeelLocatorScheme } from '../packages/sdk/dist/index.js';

const siblingFixture = siblingTest(nodeTest, 'keel-contracts');
const names = (enumeration) => Object.keys(enumeration).filter((key) => Number.isNaN(Number(key)))
  .sort((a, b) => enumeration[a] - enumeration[b]);

nodeTest('one set of link codes serves both chains, and Tezos exposes the presentation rule', () => {
  // EVM KeelLinkRegistry enum order; the Tezos registry uses the same numbers since Batch 33.
  assert.deepEqual(names(KeelFidelity), ['Preview', 'HybridMirror', 'HighResolution']);
  assert.deepEqual(names(KeelLocatorScheme), ['Ipfs', 'Ipns', 'Https', 'Arweave']);
  assert.deepEqual(names(KeelDigestAlgorithm), ['Sha256', 'Keccak256']);
  assert.deepEqual(names(KeelLinkCompression), ['None', 'Gzip', 'Brotli', 'Deflate']);
  const artifacts = KEEL_TEZOS_MODULES.find((module) => module.id === 'keel-artifacts');
  for (const view of ['fidelity_link', 'link_uri', 'link_for_presentation']) {
    assert.ok(artifacts.views.KeelLinkRegistry.includes(view), view);
  }
});

siblingFixture('the shared link vectors use the SDK codes', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/links.json', import.meta.url)));
  assert.deepEqual(fixture.codes.fidelity, names(KeelFidelity));
  assert.deepEqual(fixture.codes.scheme, names(KeelLocatorScheme));
  assert.deepEqual(fixture.codes.digestAlgorithm, names(KeelDigestAlgorithm));
  assert.deepEqual(fixture.codes.compression, names(KeelLinkCompression));
});
