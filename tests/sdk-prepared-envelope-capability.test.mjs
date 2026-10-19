import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, padHex, stringToBytes, toHex } from 'viem';
import { qualifyKeelPreparedEnvelope, KeelPreparedEnvelopeCapabilityError } from '../packages/sdk/dist/prepared-envelope-capability.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/prepared-envelope-capability.json', import.meta.url)));
const clone = name => structuredClone(fixtures[name]);
const replace = (code, start, replacement) => code.slice(0, 2 + start * 2) + replacement.slice(2) + code.slice(2 + start * 2 + replacement.length - 2);
function setup(fixture = clone('legacy'), options = {}) {
  const requests = [], block = { number: BigInt(fixture.block.number), hash: fixture.block.hash };
  let pins = 0;
  const record = (kind, request = {}) => { requests.push({ kind, ...request }); options.onRead?.(requests); };
  const read = {
    async getChainId(request) { record('chain', request); return options.providerChain ?? (options.wrongChain ? 1 : 11155111); },
    async getBlock(number, request) {
      record('block', { number, ...request }); pins++;
      return { ...block, ...(options.reorg && pins === 2 ? { hash: `0x${'ab'.repeat(32)}` } : {}) };
    },
    async getCode(request) { record('code', request); return fixture.codeByAddress[request.address.toLowerCase()] ?? '0x'; },
    async call(request) {
      record('call', request);
      if (options.readError) throw new Error('https://user:secret@example.invalid/rpc?apiKey=private');
      if (request.to.toLowerCase() === fixture.factory.toLowerCase()) return padHex(fixture.deployer, { size: 32 });
      if (request.to.toLowerCase() === fixture.deployer.toLowerCase()) return fixture.creationHash;
      throw new Error('unexpected call target');
    },
  };
  return { fixture, requests, input: { chainId: 11155111, factory: fixture.factory, block: { ...block },
    encodedPrefix: new Uint8Array(256001), encodedSuffix: new Uint8Array(2042), read, ...options.input } };
}
const rejects = (promise, code, reason) => assert.rejects(promise, error => {
  assert.ok(error instanceof KeelPreparedEnvelopeCapabilityError);
  assert.equal(error.code, code);
  if (reason) assert.match(error.details.reason, reason);
  return true;
});

test('actual legacy deployment rejects original256001/2042-byte envelope with actionable exact identity', async () => {
  const { input } = setup();
  await assert.rejects(qualifyKeelPreparedEnvelope(input), error => {
    assert.equal(error.code, 'KEEL_PREPARED_ENVELOPE_LIMIT');
    assert.equal(error.phase, 'prepared-presentation');
    assert.equal(error.details.prefixBytes, 256001); assert.equal(error.details.suffixBytes, 2042);
    assert.equal(error.details.limitBytes, 32768); assert.equal(error.details.collectionCreationCodeHash, fixtures.legacy.creationHash);
    assert.match(error.message, /factory .*256001 bytes.*2042 bytes.*32768-byte/s);
    return true;
  });
});
test('legacy below/at/above boundaries count exact binary, hex and UTF8 bytes', async () => {
  for (const size of [32767, 32768]) {
    const { input } = setup(undefined, { input: { encodedPrefix: `0x${'80'.repeat(size)}`, encodedSuffix: new Uint8Array(size) } });
    const result = await qualifyKeelPreparedEnvelope(input);
    assert.equal(result.prefixBytes, size); assert.equal(result.suffixBytes, size);
    assert.equal(result.requiresFullSimulation, true); assert.deepEqual(result.capability, { prefixMaxBytes: 32768, suffixMaxBytes: 32768 });
  }
  const exact = new TextEncoder().encode('🌊'.repeat(8192));
  assert.equal(exact.length, 32768);
  await qualifyKeelPreparedEnvelope(setup(undefined, { input: { encodedPrefix: exact, encodedSuffix: '0x01' } }).input);
  for (const field of ['encodedPrefix', 'encodedSuffix']) {
    await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { encodedPrefix: '0x01', encodedSuffix: '0x01', [field]: new Uint8Array(32769) } }).input), 'KEEL_PREPARED_ENVELOPE_LIMIT');
  }
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { encodedPrefix: new TextEncoder().encode('🌊'.repeat(8193)), encodedSuffix: '0x01' } }).input), 'KEEL_PREPARED_ENVELOPE_LIMIT');
});
test('source-qualified maintained template accepts exact large envelope only as capability, never full simulation proof', async () => {
  const result = await qualifyKeelPreparedEnvelope(setup(clone('maintained')).input);
  assert.equal(result.prefixBytes, 256001); assert.equal(result.suffixBytes, 2042);
  assert.equal(result.capability.prefixMaxBytes, null); assert.equal(result.requiresFullSimulation, true);
});
function maintainedOnChain(chainId) {
  const fixture = clone('maintained'), key = fixture.factory.toLowerCase();
  const domain = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }], [
    keccak256(stringToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
    keccak256(stringToBytes('Keel Factory')), keccak256(stringToBytes('1')), BigInt(chainId), fixture.factory,
  ]));
  fixture.codeByAddress[key] = replace(replace(fixture.codeByAddress[key], 3848, padHex(toHex(chainId), { size: 32 })), 3665, domain);
  return fixture;
}
test('exact maintained constructor templates qualify local31337 and mainnet1 with their actual domain and provider', async () => {
  for (const chainId of [31337, 1]) {
    const result = await qualifyKeelPreparedEnvelope(setup(maintainedOnChain(chainId), { providerChain: chainId, input: { chainId } }).input);
    assert.equal(result.chainId, chainId); assert.equal(result.capability.prefixMaxBytes, null); assert.equal(result.requiresFullSimulation, true);
  }
});
test('cross-chain constructor/provider/domain mismatches and unsafe chain numbers reject', async () => {
  await rejects(qualifyKeelPreparedEnvelope(setup(maintainedOnChain(31337), { input: { chainId: 31337 } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /provider chain/);
  await rejects(qualifyKeelPreparedEnvelope(setup(maintainedOnChain(1), { providerChain: 31337, input: { chainId: 31337 } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /immutable mismatch/);
  await rejects(qualifyKeelPreparedEnvelope(setup(clone('legacy'), { providerChain: 1, input: { chainId: 1 } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /cached chain\/domain mismatch/);
  for (const chainId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { chainId } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /chain identity/);
  }
});
test('other authenticated historical factory versions retain the same real small-envelope boundary', async () => {
  for (const fixture of fixtures.otherLegacy) {
    const result = await qualifyKeelPreparedEnvelope(setup(structuredClone(fixture), { input: { encodedPrefix: new Uint8Array(32768) } }).input);
    assert.equal(result.capability.prefixMaxBytes, 32768);
    await rejects(qualifyKeelPreparedEnvelope(setup(structuredClone(fixture)).input), 'KEEL_PREPARED_ENVELOPE_LIMIT');
  }
});
test('each deployed byte outside declared immutable/link ranges is authenticated', async () => {
  for (const name of ['legacy', 'maintained']) {
    for (const which of ['factory', 'deployer', 'carrier']) {
      const fixture = clone(name);
      const key = which === 'carrier' ? Object.keys(fixture.codeByAddress).find(a => fixture.codeByAddress[a].length > 2 + 13000 * 2) : fixture[which].toLowerCase();
      fixture.codeByAddress[key] = replace(fixture.codeByAddress[key], 0, '0xfe');
      await rejects(qualifyKeelPreparedEnvelope(setup(fixture).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED');
    }
  }
});
test('mask cannot hide wrong factory domain/address/chain immutable or deployer copy lengths', async () => {
  for (const [which, offset] of [['factory', 3611], ['factory', 3848], ['factory', 3665], ['deployer', 941], ['deployer', 981]]) {
    const fixture = clone('maintained'), key = fixture[which].toLowerCase();
    fixture.codeByAddress[key] = replace(fixture.codeByAddress[key], offset, `0x${'11'.repeat(32)}`);
    await rejects(qualifyKeelPreparedEnvelope(setup(fixture).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /immutable mismatch|length or digest mismatch/);
  }
});
test('linked metadata library must have exact stateless runtime bytes', async () => {
  const fixture = clone('maintained');
  const key = Object.keys(fixture.codeByAddress).find(a => fixture.codeByAddress[a].length === 2 + 4683 * 2);
  fixture.codeByAddress[key] = replace(fixture.codeByAddress[key], 1, '0xff');
  await rejects(qualifyKeelPreparedEnvelope(setup(fixture).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /metadata library runtime/);
});
test('masked creation link slots must all identify the same authenticated library', async () => {
  const fixture = clone('maintained');
  const carriers = Object.keys(fixture.codeByAddress).filter(a => fixture.codeByAddress[a].length === 2 + 13181 * 2);
  const second = carriers[1];
  fixture.codeByAddress[second] = replace(fixture.codeByAddress[second], 20381 - 13181, `0x${'11'.repeat(20)}`);
  fixture.creationHash = keccak256(fixture.codeByAddress[carriers[0]] + fixture.codeByAddress[second].slice(2));
  fixture.codeByAddress[fixture.deployer.toLowerCase()] = replace(fixture.codeByAddress[fixture.deployer.toLowerCase()], 84, fixture.creationHash);
  await rejects(qualifyKeelPreparedEnvelope(setup(fixture).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /inconsistent metadata library links/);
});
test('creation getter alone cannot approve changed or missing immutable carrier bytes', async () => {
  const fixture = clone('legacy'); fixture.creationHash = `0x${'01'.repeat(32)}`;
  await rejects(qualifyKeelPreparedEnvelope(setup(fixture).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /carriers/);
});
test('wrong chain, unknown factory, empty bytes and malformed hex never claim capability', async () => {
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { wrongChain: true }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /chain/);
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { chainId: 1 } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /chain/);
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { factory: '0x1111111111111111111111111111111111111111' } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /factory runtime/);
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { encodedSuffix: '0x' } }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /empty/);
  await assert.rejects(qualifyKeelPreparedEnvelope(setup(undefined, { input: { encodedPrefix: '0x1' } }).input), /even-length hex/);
});
test('reads use caller signal and immutable pin; final reorg recheck rejects', async () => {
  const controller = new AbortController();
  const { input, requests } = setup(undefined, { input: { encodedPrefix: '0x01', signal: controller.signal } });
  const original = { ...input.block };
  input.read.getChainId = async request => { requests.push({ kind: 'chain', ...request }); input.block.number++; return 11155111; };
  const result = await qualifyKeelPreparedEnvelope(input);
  assert.deepEqual(result.block, original);
  for (const request of requests) {
    assert.equal(request.signal, controller.signal);
    if (request.blockNumber !== undefined) assert.equal(request.blockNumber, original.number);
    if (request.number !== undefined) assert.equal(request.number, original.number);
  }
  await rejects(qualifyKeelPreparedEnvelope(setup(undefined, { reorg: true }).input), 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED', /pinned block changed/);
});
test('pre-abort and abort during reads stop immediately and retain AbortError', async () => {
  const before = new AbortController(); before.abort('private reason');
  const first = setup(undefined, { input: { signal: before.signal } });
  await assert.rejects(qualifyKeelPreparedEnvelope(first.input), { name: 'AbortError' }); assert.equal(first.requests.length, 0);
  const during = new AbortController();
  const second = setup(undefined, { input: { signal: during.signal }, onRead: requests => { if (requests.length === 3) during.abort(); } });
  await assert.rejects(qualifyKeelPreparedEnvelope(second.input), { name: 'AbortError' }); assert.equal(second.requests.length, 3);
});
test('provider error credentials and payload are never copied into capability diagnostics', async () => {
  await assert.rejects(qualifyKeelPreparedEnvelope(setup(undefined, { readError: true }).input), error => {
    assert.equal(error.code, 'KEEL_PREPARED_ENVELOPE_UNQUALIFIED');
    assert.doesNotMatch(JSON.stringify(error) + error.message, /secret|apiKey|https:|private/);
    return true;
  });
});
