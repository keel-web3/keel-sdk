import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionData, getContractAddress, toHex } from 'viem';
import { deriveFreshRetroSeeds } from '../scripts/lib/fresh-publication-witness-seeds.mjs';
import { validateCapturedStateSeed } from '../scripts/lib/captured-state-witness.mjs';
import { sha256 } from '../scripts/lib/captured-publication-fixture.mjs';
import { syntheticCapture, syntheticHoldProof, jobAbi, JOB, HOLD, FACTORY, slot } from './fixtures/fresh-publication-seed-input.mjs';

const oldFetch = globalThis.fetch; let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('Offline seed test forbids network'); };
after(() => { globalThis.fetch = oldFetch; assert.equal(requests,0); });
const bind = raw => { raw.completeInputSHA256 = sha256(JSON.stringify(raw.exactSimulationInput)); return raw; };
const getter = raw => raw.readEvidence.find(item => item.request.method === 'eth_call' && item.request.params[0].data === '0xb0c2aa5e');

test('synthetic complete47 input derives runtime-bound slots and CREATE2 target without claiming freshness or proof', () => {
  const raw = syntheticCapture(), bytes = Buffer.from(JSON.stringify(raw)), frozen = structuredClone(raw);
  const seed = deriveFreshRetroSeeds(raw,{captureBytes:bytes});
  assert.equal(seed.program.nextJobId,'17'); assert.equal(seed.program.preparationCalls,45); assert.equal(seed.program.completeCalls,47);
  assert.equal(seed.program.chunks,29); assert.equal(seed.program.weldOperations,8);
  assert.equal(seed.factory.computedTarget,seed.factory.plannedTarget);
  assert.equal(seed.currentFreshnessEstablished,false); assert.equal(seed.approvalReady,false); assert.equal(seed.closure.complete,false);
  assert.deepEqual(raw,frozen); assert.equal(seed.captureSHA256,sha256(bytes));
  assert.doesNotThrow(() => validateCapturedStateSeed({capture:raw,seed,captureBytes:bytes}));
});
test('nextJobId is read at the exact pin; changing it recomputes every per-job slot', () => {
  const first = deriveFreshRetroSeeds(syntheticCapture()), second = deriveFreshRetroSeeds(syntheticCapture({nextJobId:42n}));
  const slots = seed => seed.accounts.find(item=>item.address===JOB).slots;
  assert.equal(slots(first).length,slots(second).length);
  assert.deepEqual(slots(first).filter(value=>slots(second).includes(value)),[slot(0n)]);
  assert.equal(second.program.nextJobId,'42');
});
test('one stale job ID or opening return assertion cannot be hidden by a new input digest', () => {
  const raw=syntheticCapture(), call=raw.exactSimulationInput.preparationCalls[3], decoded=decodeFunctionData({abi:jobAbi,data:call.data});
  call.data=encodeFunctionData({abi:jobAbi,functionName:decoded.functionName,args:[42n,...decoded.args.slice(1)]});
  assert.throws(()=>deriveFreshRetroSeeds(bind(raw)),/stale job ID/);
  const assertion=syntheticCapture(); assertion.exactSimulationInput.assertions[0].returnData=slot(999n);
  assert.throws(()=>deriveFreshRetroSeeds(bind(assertion)),/openJob assertion/);
});
test('latest, another pin, or conflicting reads cannot supply the next job identity', () => {
  for(const pin of ['latest','0x1']) { const raw=syntheticCapture();getter(raw).request.params[1]=pin;assert.throws(()=>deriveFreshRetroSeeds(raw),/Missing same-pin nextJobId/); }
  const raw=syntheticCapture(), extra=structuredClone(getter(raw));extra.rawResponse=JSON.stringify({result:slot(8n)});raw.readEvidence.push(extra);
  assert.throws(()=>deriveFreshRetroSeeds(raw),/Conflicting nextJobId/);
});
test('unexpected job/factory runtime never reuses the matched layout', () => {
  for(const address of [JOB,FACTORY]) { const raw=syntheticCapture();raw.readEvidence.find(item=>item.request.method==='eth_getCode'&&item.request.params[0]===address).rawResponse=JSON.stringify({result:'0x00'});assert.throws(()=>deriveFreshRetroSeeds(raw),/runtime changed/); }
});
test('missing Hold nonce leaves CREATE targets unknown rather than inventing nonce or absence', () => {
  const seed=deriveFreshRetroSeeds(syntheticCapture());assert.deepEqual(seed.possibleHoldCreateTargets,[]);
  assert.equal(seed.pendingDerivations.find(item=>item.kind==='hold-nonce-proof').maximumPossibleCreates,37);
  assert.ok(seed.accounts.every(item=>item.canonicalAccountProofValidated===false));
});
test('authenticated synthetic Hold nonce derives conditional CREATE superset; no target absence is fabricated', () => {
  const {stateRoot,witness}=syntheticHoldProof(7n),raw=syntheticCapture({stateRoot});
  const seed=deriveFreshRetroSeeds(raw,{witness});assert.equal(seed.possibleHoldCreateTargets.length,37);
  assert.equal(seed.possibleHoldCreateTargets[0].address,getContractAddress({from:HOLD,nonce:7n}).toLowerCase());
  assert.equal(seed.possibleHoldCreateTargets.at(-1).address,getContractAddress({from:HOLD,nonce:43n}).toLowerCase());
  assert.ok(seed.possibleHoldCreateTargets.every(item=>item.conditional));
  assert.equal(seed.accounts.filter(item=>item.canonicalAccountProofValidated).length,1);assert.equal(seed.closure.complete,false);
  const invalid=structuredClone(witness);invalid.accounts[0].nonce='0x8';assert.throws(()=>deriveFreshRetroSeeds(raw,{witness:invalid}));
});
test('missing deployer bytes keep CREATE2 arithmetic pending; a tampered carrier fails its commitment', () => {
  const seed=deriveFreshRetroSeeds(syntheticCapture({includeCreationCode:false}));assert.equal(seed.factory.computedTarget,null);
  assert.ok(seed.pendingDerivations.some(item=>item.kind==='runtime'));
  const raw=syntheticCapture(), carrier=raw.readEvidence.find(item=>item.request.method==='eth_getCode'&&item.request.params[0]==='0x444ee9979d46473eebfc057cc71fbf087cd89eb8');
  const response=JSON.parse(carrier.rawResponse);response.result=response.result.slice(0,-2)+(response.result.endsWith('00')?'01':'00');carrier.rawResponse=JSON.stringify(response);
  assert.throws(()=>deriveFreshRetroSeeds(raw),/Creation-code bytes differ/);
});
test('complete input and exact capture byte binding reject mutation without invoking any network', () => {
  const raw=syntheticCapture(),bytes=Buffer.from(JSON.stringify(raw));raw.source.sdkCommit='f'.repeat(40);
  assert.throws(()=>deriveFreshRetroSeeds(raw,{captureBytes:bytes}),/capture bytes differ/);
  const changed=syntheticCapture();changed.exactSimulationInput.metadataCall.data='0xbeef';assert.throws(()=>deriveFreshRetroSeeds(changed),/digest mismatch/);
});
