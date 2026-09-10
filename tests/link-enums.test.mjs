import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KeelCompression, KeelLinkCompression, KeelFidelity, KeelLocatorScheme,
  keelCompressionName, keelLinkCompressionName, validateKeelFidelityLinks,
} from '../packages/sdk/dist/index.js';

const input = {
  fidelity: KeelFidelity.Preview, scheme: KeelLocatorScheme.Https,
  digestAlgorithm: 1, compression: KeelLinkCompression.None,
  uri: 'https://example.test/art', mediaType: 'image/png',
  decodedDigest: `0x${'11'.repeat(32)}`, provenanceDigest: `0x${'22'.repeat(32)}`, byteLength: 10n,
};

test('link compression and stored-object compression keep distinct tag meanings', () => {
  assert.equal(keelCompressionName(KeelCompression.Deflate), 'deflate');
  assert.equal(keelCompressionName(KeelCompression.Brotli), 'brotli');
  assert.equal(keelLinkCompressionName(KeelLinkCompression.Deflate), 'deflate');
  assert.equal(keelLinkCompressionName(KeelLinkCompression.Brotli), 'brotli');
  assert.equal(KeelCompression.Deflate, 2);
  assert.equal(KeelCompression.Brotli, 3);
  assert.equal(KeelLinkCompression.Brotli, 2);
  assert.equal(KeelLinkCompression.Deflate, 3);
  for (const invalid of [-1, 4, 255]) assert.throws(() => keelLinkCompressionName(invalid));
});

test('all locator schemes accept only their matching URI prefix', () => {
  const choices = [[KeelLocatorScheme.Ipfs,'ipfs://key'], [KeelLocatorScheme.Ipns,'ipns://key'],
    [KeelLocatorScheme.Https,'https://example.test/art'], [KeelLocatorScheme.Arweave,'ar://transaction']];
  for (const [scheme, uri] of choices) {
    assert.equal(validateKeelFidelityLinks([{...input,scheme,uri}])[0].scheme, scheme);
    for (const [otherScheme, otherUri] of choices) {
      if (otherScheme !== scheme) assert.throws(() => validateKeelFidelityLinks([{...input,scheme,uri:otherUri}]), /scheme/);
    }
  }
});

test('fidelity commitments use the registry order and still reject duplicates', () => {
  const sorted = [KeelFidelity.Preview, KeelFidelity.HybridMirror, KeelFidelity.HighResolution];
  assert.deepEqual(validateKeelFidelityLinks(sorted.map(fidelity => ({...input,fidelity}))).map(x => x.fidelity), [0,1,2]);
  assert.throws(() => validateKeelFidelityLinks([KeelFidelity.Preview,KeelFidelity.HighResolution,KeelFidelity.HybridMirror].map(fidelity => ({...input,fidelity}))), /ordered/);
  assert.throws(() => validateKeelFidelityLinks([input,input]), /ordered/);
});
