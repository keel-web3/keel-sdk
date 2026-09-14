import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters } from 'viem';
import { checkPublishedMetadata, checkLocalProject, decodeMetadataUri, mediaEndpoint, boundedResponse, projectFingerprint } from '../src/project-checks.mjs';
import { newProject } from '../src/workspace.mjs';
const profile = { family: 'ethereum', chainId: 1, rpcUrl: 'https://rpc.example.test' };
const publication = { chainId: 1, contractAddress: '0x' + '1'.repeat(40), tokenId: '7', standard: 'erc721' };
function rpcFixture(uri, chain = '0x1') {
  const calls = [];
  return { calls, fetcher: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const result = { eth_chainId: chain, eth_blockNumber: '0x2a', eth_getCode: '0x6000', eth_call: encodeAbiParameters([{ type: 'string' }], [uri]) }[body.method];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { headers: { 'content-type': 'application/json' } });
  } };
}
test('onchain checker pins code and metadata to one block and never claims full artwork proof', async () => {
  const metadata = { name: 'An onchain work', image: 'data:image/png;base64,YQ==' };
  const fixture = rpcFixture('data:application/json,' + encodeURIComponent(JSON.stringify(metadata)));
  const result = await checkPublishedMetadata(profile, publication, fixture.fetcher);
  assert.deepEqual(result.document, metadata); assert.equal(result.block, '42'); assert.equal(result.metadataLocation, 'embedded');
  assert.equal(result.checks.find((item) => item.id === 'full-artwork').status, 'unknown');
  for (const call of fixture.calls.filter((item) => ['eth_getCode', 'eth_call'].includes(item.method))) assert.equal(call.params[1], '0x2a');
  assert.deepEqual(new Set(fixture.calls.map((call) => call.method)), new Set(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call']));
});
test('onchain checker rejects mismatched and unsupported networks without retargeting', async () => {
  const fixture = rpcFixture('x', '0x2');
  await assert.rejects(checkPublishedMetadata(profile, publication, fixture.fetcher), /RPC chain changed/);
  await assert.rejects(checkPublishedMetadata({ ...profile, family: 'tezos' }, publication, fixture.fetcher), /Tezos/);
  await assert.rejects(checkPublishedMetadata(profile, { ...publication, chainId: 2 }, fixture.fetcher), /another network/);
});
test('ERC-1155 URI substitution is padded hex and external metadata remains external', async () => {
  const fixture = rpcFixture('ipfs://example/{id}.json'); let requested;
  const result = await checkPublishedMetadata(profile, { ...publication, standard: 'erc1155', tokenId: '255' }, async (url, options) => {
    if (options.body) return fixture.fetcher(url, options);
    requested = url; return new Response(JSON.stringify({ name: 'Edition' }));
  });
  assert.equal(requested, `https://ipfs.io/ipfs/example/${'ff'.padStart(64, '0')}.json`);
  assert.equal(result.metadataLocation, 'distributed');
  assert.equal(result.checks.find((item) => item.id === 'chain-metadata').status, 'attention');
});
test('unavailable external JSON produces unknown evidence and a specific failure', async () => {
  const fixture = rpcFixture('https://example.test/meta.json');
  const result = await checkPublishedMetadata(profile, publication, async (url, options) => options.body ? fixture.fetcher(url, options) : new Response('gone', { status: 404 }));
  assert.equal(result.document, null); assert.match(result.retrievalError, /404/);
  assert.equal(result.checks.find((item) => item.id === 'metadata-readable').status, 'unknown');
});
test('metadata fetches block local protocols, credentials and unsafe endpoints', () => {
  for (const url of ['file:///tmp/key', 'http://example.com/image', 'https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://user:secret@example.test/a']) assert.throws(() => mediaEndpoint(url));
  assert.equal(mediaEndpoint('ipfs://abc'), 'https://ipfs.io/ipfs/abc');
});
test('bounded responses stop large checks without changing the saved original', async () => {
  await assert.rejects(boundedResponse(new Response('larger than budget'), 3), /paged contract retrieval/);
  assert.deepEqual(decodeMetadataUri('data:application/json;base64,' + Buffer.from('{"name":"Kept"}').toString('base64')), { name: 'Kept' });
});
test('file checks expose corrupt originals and a changed draft invalidates earlier evidence', async () => {
  const project = { ...newProject('Integrity'), objectIds: ['a'.repeat(64), 'b'.repeat(64)] };
  const result = await checkLocalProject(project, [], async (id) => { if (id.startsWith('b')) throw new Error('Digest mismatch'); });
  assert.equal(result.failures.length, 1); assert.equal(result.checks.at(-1).status, 'attention');
  assert.notEqual(result.fingerprint, projectFingerprint({ ...project, metadata: { name: 'Changed' } }));
  assert.notEqual(result.fingerprint, projectFingerprint({ ...project, files: [] }));
});
