import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseAbi, keccak256, encodeFunctionResult, decodeFunctionData, toHex, stringToHex } from 'viem';
const knownStrictRuntime = readFileSync(new URL('./fixtures/uri81-strict-reader-runtime.hex', import.meta.url), 'utf8').trim();
const sdk = await import(process.env.KEEL_READER_GRAMMAR_TEST_SDK ? pathToFileURL(process.env.KEEL_READER_GRAMMAR_TEST_SDK) : new URL('../packages/sdk/dist/index.js', import.meta.url));
const { createKeelManagedObjectPlan } = await import('../packages/sdk/dist/native-managed.js');
const poster = { mediaType: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64') };
const resources = [{ id: 'index.html', aliases: ['index.html', 'source?x=1&y=2'], role: 'entrypoint', mediaType: 'text/html', bytes: Buffer.from('<!doctype html><p>Exact UTF8 🌊 ?\'&</p>' + '<!--source-->'.repeat(80)) }];
const publication = { resources, poster, compression: 'auto' };
const mask = 0x47fffffe87ffffff2fffff1200000000n;
function oldReaderAccepts(bytes) {
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 37) { if (!/^[0-9A-F]{2}$/u.test(String.fromCharCode(...bytes.slice(i + 1, i + 3)))) return false; i += 2; }
    else if (byte >= 128 || !(mask & (1n << BigInt(byte)))) return false;
  }
  return true;
}
const htmlOf = plan => Buffer.concat([plan.shell.prefix, ...plan.objects.filter(o => plan.request.bodyObjectIds.includes(o.objectId)), plan.shell.suffix].map(o => Buffer.from(sdk.decodeKeelPreparedDenseCopyFragment(o.bytes))));
test('high-level strict URI81 preparation authenticates every fragment and replays exact original sources', async () => {
  const args = { ...publication, chainId: 11155111, store: '0xD820e337692A6Eb7a4878e42ce88CBCFF49B55CF' };
  const standard = await sdk.prepareKeelCreatorInline(args), strict = await sdk.prepareKeelCreatorInline({ ...args, readerGrammar: 'legacy-strict' });
  assert.ok([standard.shell.prefix, ...standard.objects.filter(o => o.mediaType.endsWith('raw-percent-fragment')), standard.shell.suffix].some(o => !oldReaderAccepts(o.bytes)));
  for (const object of [strict.shell.prefix, ...strict.objects.filter(o => o.mediaType.endsWith('raw-percent-fragment')), strict.shell.suffix]) assert.equal(oldReaderAccepts(object.bytes), true, object.id);
  assert.deepEqual(strict.resources.map(r => r.sourceIntegrity), standard.resources.map(r => r.sourceIntegrity));
  assert.equal(strict.resources[0].encoding, 'uri81-block-v1'); assert.equal(strict.resources[0].compression, 'brotli');
  const replay = await sdk.readKeelPreparedInlineSources({ htmlBytes: htmlOf(strict), chainId: args.chainId, store: strict.store, tableDigest: strict.table.digest });
  assert.equal(replay.transportProfile, 'uri81-block-v1'); assert.deepEqual(Buffer.from(replay.resources[0].bytes), resources[0].bytes);
});
test('payload comparisons use the selected grammar without changing compression or compressed bytes', () => {
  const bytes = Uint8Array.from({ length: 2048 }, (_, i) => (i * 59 + Math.floor(i / 256)) & 255);
  for (const compression of ['none', 'auto', 'brotli']) {
    const standard = sdk.prepareKeelDensePayload(bytes, { compression }), strict = sdk.prepareKeelDensePayload(bytes, { compression, readerGrammar: 'legacy-strict' });
    assert.equal(oldReaderAccepts(strict.preparedBytes), true);
    assert.deepEqual(strict.compressedBytes, standard.compressedBytes); assert.deepEqual(strict.decodedIntegrity, standard.decodedIntegrity);
    assert.equal(strict.transportProfile, 'uri81-block-v1'); assert.equal(strict.preparedIntegrity.byteLength, strict.preparedBytes.length);
  }
});

const names = ['KeelHold', 'KeelCreatorFactory', 'KeelArtifactTokenRenderer', 'KeelMintRouteRegistry', 'KeelRawTokenURIBuilder', 'KeelRawInlineShellRegistry', 'KeelRawFragmentValidationRegistry', 'KeelArtifactRegistry'];
const address = n => '0x' + n.toString(16).padStart(40, '0'), hash = n => '0x' + n.toString(16).padStart(64, '0');
const addresses = Object.fromEntries(names.map((n, i) => [n, address(i + 1)])), code = '0x60006000', blockHash = hash(999);
const deployments = names.map((contract, i) => ({ contract, address: addresses[contract], chainId: 31337, module: 'unit-adapter', instance: 'reader-grammar-unit', runtimeCodeHash: keccak256(code), txHash: hash(i + 1), block: '1' }));
const index = sdk.buildKeelNetworkIndex(deployments, { defaultChainId: 31337, networks: [{ chainId: 31337, name: 'unit adapter', environment: 'local', defaultInstance: 'reader-grammar-unit', rpcUrls: [] }] });
const abi = parseAbi([...sdk.keelHoldAbi, 'function requireRegistration(bytes32) view', 'function shellLatestRevision(bytes32) view returns(uint64)', 'function metadataRenderer() view returns(address)', 'function preparedCopyBuilder() view returns(address)', 'function preparedCopyShellRegistry() view returns(address)', 'function preparedCopyValidationRegistry() view returns(address)', 'function artifactRegistry() view returns(address)', 'function manager() view returns(address)', 'function platformAuthority() view returns(address)', 'function rawFragmentValidationRegistry() view returns(address)', 'function RAW_INLINE_PROTECTION_SHELL_ID() view returns(bytes32)', 'function creatorManagedShell(bytes32) view returns(bool)', 'function shellRevision(bytes32,uint64) view returns(bytes32,bytes32,uint8,bool,bytes32)', 'function builder() view returns(address)', 'function verifiedDigest(bytes32) view returns(bytes32)', 'function keelHold() view returns(address)']);
async function fixture(bad = {}) {
  const plan = await sdk.prepareKeelCreatorInline({ ...publication, chainId: 31337, store: addresses.KeelHold, readerGrammar: 'legacy-strict' });
  const selectedIndex=structuredClone(index), builderCode=bad.knownReader?knownStrictRuntime:code;
  selectedIndex.networks[0].deployments.find(d=>d.contract==='KeelRawTokenURIBuilder').runtimeCodeHash=keccak256(builderCode);
  const profile = { protocol: 'keel.prepared-reader-profile@1', chainId: 31337, store: addresses.KeelHold, reader: addresses.KeelRawTokenURIBuilder, runtimeCodeHash: keccak256(builderCode), transportProfile: 'uri81-block-v1', readerGrammar: 'legacy-strict', ...bad.profile };
  const bytes = Buffer.from(JSON.stringify(bad.metadata ?? { readerProfile: profile }));
  const metadata = { bytes, ...await createKeelManagedObjectPlan(bytes, { hold: addresses.KeelHold, mediaType: 'application/json', compression: 'none' }) };
  const objects = new Map([plan.shell.prefix, plan.shell.suffix, metadata].map(o => [o.objectId, o])), requests = [];
  const pool = { status: () => [], request: async req => {
    requests.push(req);
    if (req.method === 'eth_chainId') return '0x7a69'; if (req.method === 'eth_blockNumber') return '0x2';
    if (req.method === 'eth_getBlockByNumber') return { number: '0x2', hash: blockHash };
    if (req.method === 'eth_getCode') return req.params[0].toLowerCase()===addresses.KeelRawTokenURIBuilder.toLowerCase()?builderCode:code;
    if (req.method === 'eth_getTransactionReceipt') { const entry = deployments.find(d => d.txHash === req.params[0]); return { status: '0x1', transactionHash: entry.txHash, contractAddress: entry.address, blockNumber: '0x1', blockHash }; }
    assert.equal(req.method, 'eth_call'); assert.equal(req.params[1], '0x2');
    const call = decodeFunctionData({ abi, data: req.params[0].data }), name = call.functionName; let result;
    const bindings = { metadataRenderer: 'KeelArtifactTokenRenderer', keelHold: 'KeelHold', preparedCopyBuilder: 'KeelRawTokenURIBuilder', preparedCopyShellRegistry: 'KeelRawInlineShellRegistry', preparedCopyValidationRegistry: 'KeelRawFragmentValidationRegistry', artifactRegistry: 'KeelArtifactRegistry', rawFragmentValidationRegistry: 'KeelRawFragmentValidationRegistry', builder: 'KeelRawTokenURIBuilder' };
    if (bindings[name]) result = addresses[bindings[name]];
    else if (name === 'manager' || name === 'platformAuthority') result = address(999);
    else if (name === 'RAW_INLINE_PROTECTION_SHELL_ID') result = keccak256(stringToHex('keel.shell.inline-raw-percent-protection@1'));
    else if (name === 'creatorManagedShell') result = false;
    else if (name === 'shellLatestRevision') result = 1n;
    else if (name === 'shellRevision') result = [plan.shell.prefix.objectId, plan.shell.suffix.objectId, 3, true, metadata.objectId];
    else { const object = objects.get(call.args[0]); assert.ok(object);
      if (name === 'requireRegistration') result = undefined;
      if (name === 'verifiedDigest') result = object.digest;
      if (name === 'haulObject') result = toHex(bad.corruptMetadata && object.objectId === metadata.objectId ? Uint8Array.of(1) : object.bytes);
      if (name === 'getObject') result = { digest: object.digest, indexDigest: hash(0), descriptorPointer: address(1), byteLength: BigInt(object.bytes.length), storedByteLength: BigInt(object.bytes.length), chunkCount: 1, compression: 0, composite: false, exists: true, mediaType: object.mediaType };
    }
    return encodeFunctionResult({ abi, functionName: name, result });
  } };
  return { pool, requests, metadata, index:selectedIndex };
}
test('authenticated route takes strict grammar from registered, SHA-verified, deployment-bound metadata', async () => {
  const f = await fixture(), result = await sdk.prepareKeelAuthenticatedCreatorInline({ pool: f.pool, index:f.index, publication });
  assert.equal(result.readerGrammar, 'legacy-strict'); assert.equal(result.route.readerGrammar, 'legacy-strict');
  assert.equal(result.route.readerProfileMetadataObjectId, f.metadata.objectId); assert.equal(result.route.readerProfileMetadataDigest, f.metadata.digest);
  assert.ok(result.objects.filter(o => o.mediaType.endsWith('raw-percent-fragment')).every(o => oldReaderAccepts(o.bytes)));
  assert.ok(f.requests.every(r => !['eth_sendTransaction', 'eth_sendRawTransaction'].includes(r.method)));
});
test('missing/corrupt/wrong chain, store, reader, runtime or transport profile rejects before funding', async () => {
  for (const bad of [{ metadata: {} }, { corruptMetadata: true }, { profile: { chainId: 1 } }, { profile: { store: address(888) } }, { profile: { reader: address(888) } }, { profile: { runtimeCodeHash: hash(888) } }, { profile: { transportProfile: 'base90-v1' } }, { profile: { readerGrammar: 'guessed' } }]) {
    const f = await fixture(bad);
    await assert.rejects(sdk.prepareKeelAuthenticatedCreatorInline({ pool: f.pool, index:f.index, publication }), /reader|profile|digest/i);
    assert.ok(f.requests.every(r => !['eth_sendTransaction', 'eth_sendRawTransaction'].includes(r.method)));
  }
});
test('old registered Base90 metadata retains the explicit fresh-carriage mismatch', async () => {
  const f = await fixture({ metadata: { transport: 'base90-v1' } });
  await assert.rejects(sdk.prepareKeelAuthenticatedCreatorInline({ pool: f.pool, index:f.index, publication }), { code: 'KEEL_REGISTERED_CARRIAGE_MISMATCH' });
});
test('authenticated callers cannot override registered grammar', async () => {
  const f = await fixture();
  await assert.rejects(sdk.prepareKeelAuthenticatedCreatorInline({ pool: f.pool, index:f.index, publication: { ...publication, readerGrammar: 'uri81' } }), /cannot override/);
  assert.equal(f.requests.length, 0);
});

test('metadata cannot relabel the actual code-qualified1AB immutable reader as the wider grammar', async () => {
  const f=await fixture({knownReader:true,profile:{readerGrammar:'uri81'}});
  assert.equal(keccak256(knownStrictRuntime),'0x4751a10e95fce5b2c195cf16dac31b4b3bbce11bc8b8671feb6ef11c2977ae44');
  await assert.rejects(sdk.prepareKeelAuthenticatedCreatorInline({pool:f.pool,index:f.index,publication}),/conflicts with its immutable bytecode/);
});
