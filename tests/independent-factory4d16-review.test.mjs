import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, padHex, stringToBytes, toHex } from 'viem';
import { qualifyKeelPreparedEnvelope, qualifyKeelRouted721Factory, KeelPreparedEnvelopeCapabilityError } from '../packages/sdk/dist/prepared-envelope-capability.js';

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


const old=await import('/Users/ravonus/dev/wt/studio-publication-20261019/review-sdk-aa792/packages/sdk/dist/prepared-envelope-capability.js');
const observed=async(fn,input)=>{try{return {result:await fn(input)}}catch(e){return {error:{name:e.name,code:e.code,message:e.message,details:e.details}}}};
test('independent old public envelope API retains exact outputs errors and physical read sequence',async t=>{
 let count=0;
 for(const type of ['legacy','maintained'])for(const size of [0,1,32767,32768,32769,256001]){const x=setup(clone(type),{input:{encodedPrefix:new Uint8Array(size),encodedSuffix:'0x01'}}),y=setup(clone(type),{input:{encodedPrefix:new Uint8Array(size),encodedSuffix:'0x01'}});assert.deepEqual(await observed(old.qualifyKeelPreparedEnvelope,x.input),await observed(qualifyKeelPreparedEnvelope,y.input));assert.deepEqual(x.requests,y.requests);count++;}
 for(const option of [{wrongChain:true},{reorg:true},{readError:true}]){const x=setup(clone('maintained'),option),y=setup(clone('maintained'),option);assert.deepEqual(await observed(old.qualifyKeelPreparedEnvelope,x.input),await observed(qualifyKeelPreparedEnvelope,y.input));assert.deepEqual(x.requests,y.requests);count++;}
 t.diagnostic(JSON.stringify({publicWrapperVectors:count,exactOutputsErrorsAndReadSequencePreserved:true}));
});
test('independent native API rejects unknown code even when all getters would lie correctly',async()=>{
 const fixture=clone('maintained');fixture.codeByAddress[fixture.factory.toLowerCase()]='0x60006000';const f=setup(fixture);const {encodedPrefix,encodedSuffix,...input}=f.input;
 await assert.rejects(qualifyKeelRouted721Factory(input),e=>e.code==='KEEL_PREPARED_ENVELOPE_UNQUALIFIED'&&e.details.reason==='unknown factory runtime');assert.equal(f.requests.filter(q=>q.kind==='call').length,0);assert.deepEqual(f.requests.filter(q=>q.kind==='code').map(q=>q.address.toLowerCase()),[fixture.factory.toLowerCase()]);
});
test('independent native output has no fabricated envelope budget and authenticates all dependencies',async()=>{
 const f=setup(clone('maintained'));const {encodedPrefix,encodedSuffix,...input}=f.input;const value=await qualifyKeelRouted721Factory(input);
 assert.deepEqual(Object.keys(value).sort(),['block','carriers','chainId','collectionCreationCodeHash','collectionDeployer','factory','moduleHooks','requiresFullSimulation','scope'].sort());assert.equal(value.scope,'routed721-factory');assert.equal(value.moduleHooks,true);assert.equal(value.requiresFullSimulation,true);assert.deepEqual(new Set(f.requests.filter(q=>q.kind==='code').map(q=>q.address.toLowerCase())),new Set(Object.keys(f.fixture.codeByAddress)));
});
