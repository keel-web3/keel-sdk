import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,toRlp,fromRlp,stringToHex} from 'viem';
import {syntheticCapture} from './fixtures/fresh-publication-seed-input.mjs';
import {normalizeAssemblyCapture,encodeCapturedHeader,sha256,stable} from '../scripts/lib/captured-publication-fixture.mjs';
import {createCapturedNativeWitnessResolver,assertCapturedProgram,mergeCanonicalWitnessAccounts,NATIVE_WITNESS_RESOLUTION_LIMITS} from '../scripts/lib/native-witness-resolver.mjs';
import {CAPTURED_STATE_RPC} from '../scripts/lib/captured-state-witness.mjs';
const originalFetch=globalThis.fetch;let ambient=0;globalThis.fetch=async()=>{ambient++;throw Error('Offline resolver qualification');};after(()=>{globalThis.fetch=originalFetch;assert.equal(ambient,0);});
const empty=keccak256('0x80'),emptyCode=keccak256('0x'),addr=n=>'0x'+n.toString(16).padStart(40,'0'),slot=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture({history=false}={}){
 const raw=syntheticCapture({stateRoot:empty}),h=raw.canonicalBefore,ancestors=[];
 if(history){
  const rebuild=head=>{const fields=fromRlp(encodeCapturedHeader(h));fields[0]=head.parentHash;fields[8]=BigInt(head.number)===0n?'0x':'0x'+BigInt(head.number).toString(16).padStart(2,'0');fields[11]='0x'+BigInt(head.timestamp).toString(16);head.hash=keccak256(toRlp(fields));return head;};
  const grandparent=rebuild({...h,number:'0x28',timestamp:'0x'+(BigInt(h.timestamp)-24n).toString(16)});
  const parent=rebuild({...h,number:'0x29',timestamp:'0x'+(BigInt(h.timestamp)-12n).toString(16),parentHash:grandparent.hash});
  const changed=rebuild({...h,parentHash:parent.hash});Object.assign(h,changed);ancestors.push(parent,grandparent);
  raw.scope.blockHash=h.hash;raw.canonicalAfterAssembly=structuredClone(h);
 }
 const capture=normalizeAssemblyCapture(raw),bytes=Buffer.from(JSON.stringify(raw));
 const seed={schema:'keel-private-fresh-retro-seeds@1',captureSHA256:sha256(bytes),captureObjectSHA256:sha256(stable(raw)),completeInputSHA256:raw.completeInputSHA256,
  sourceFingerprint:sha256(stable({identity:capture.identity,source:capture.source,completeInputSHA256:raw.completeInputSHA256})),pin:{number:h.number,hash:h.hash,stateRoot:h.stateRoot,timestamp:h.timestamp},headerRlp:encodeCapturedHeader(h),accounts:[{address:addr(1),slots:[]}]};
 const program={blockStateCalls:capture.exactSimulationInput.preparationCalls.map(call=>({calls:[call]})),validation:false,traceTransfers:false,returnFullTransactions:true};
 const context={program,programDigest:keccak256(stringToHex(JSON.stringify(program))),canonicalHash:h.hash,signal:new AbortController().signal};
 const calls=[],native=[];let time=Number(BigInt(h.timestamp))*1000;
 const fetchImpl=async(url,options)=>{assert.equal(url,CAPTURED_STATE_RPC);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  const request=JSON.parse(options.body);calls.push(request);let result;
  if(request.method==='eth_chainId')result='0xaa36a7';
  else if(request.method==='eth_getBlockByNumber'){result=[h,...ancestors].find(header=>header.number===request.params[0]);assert.ok(result,'Unknown synthetic header');}
  else if(request.method==='eth_getCode')result='0x';
  else {assert.equal(request.method,'eth_getProof');result={address:request.params[0],nonce:'0x0',balance:'0x0',codeHash:emptyCode,storageHash:empty,accountProof:[],storageProof:request.params[1].map(key=>({key,value:'0x0',proof:[]}))};}
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));};
 const input={capture:raw,captureBytes:bytes,seed};
 const options={fetchImpl,now:()=>time,newNativeClient:async state=>{native.push(state);return {request:async()=>{throw Error('No synthetic acceptance');},close:async()=>{}};}};
 return {input,raw,capture,context,calls,native,options,ancestors,clock:()=>time,setTime:value=>time=value};
}
const missing=(ctx,address,slot)=>({...ctx,dependency:{kind:'missing-witness',stage:0,access:{kind:slot===undefined?'GetCode':'GetState',address,...(slot===undefined?{}:{slot})}}});
test('missing account and then slot expand authenticated canonical witness without changing source calls',async()=>{
 const f=fixture(),before=stable(f.input),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);
 await r.witnessResolution.resolve(missing(f.context,addr(2)));await r.witnessResolution.resolve(missing(f.context,addr(2),slot(9)));
 const client=await r.createClient();assert.equal(f.native[0].accounts.length,2);assert.deepEqual(f.native[0].accounts[1].storageProof.map(p=>p.key),[slot(9)]);
 assert.equal(r.evidence.rounds.length,2);assert.equal(f.calls.length,15);assert.equal(stable(f.input),before);assert.equal(r.evidence.acceptance,false);assert.equal(r.evidence.fullWitnessComplete,false);
 assert.ok(f.calls.every(c=>!['eth_call','eth_simulateV1','eth_estimateGas'].includes(c.method)));await client.close();await r.close();
});
test('unchanged strict/full replay reuses proofs but checks the canonical header again',async()=>{
 const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);const before=f.calls.length;
 const strict={...f.context.program,validation:true},ctx={...f.context,program:strict,programDigest:keccak256(stringToHex(JSON.stringify(strict)))};
 await r.witnessResolution.prepare(ctx);assert.equal(f.calls.length,before+1);assert.equal(f.calls.at(-1).method,'eth_getBlockByNumber');await r.close();
});
test('altered calldata, value, recipient, stage count, atomic boundary or digest refuses before proof collection',async()=>{
 for(const alter of [c=>c.program.blockStateCalls[0].calls[0].data='0xdead',c=>c.program.blockStateCalls[0].calls[0].value='0x1',c=>c.program.blockStateCalls[0].calls[0].to=addr(99),c=>c.program.blockStateCalls.pop(),c=>c.program.blockStateCalls[0].calls.push(c.program.blockStateCalls[0].calls[0]),c=>c.programDigest=slot(99)]){
  const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options),ctx=structuredClone({...f.context,signal:undefined});ctx.signal=f.context.signal;alter(ctx);
  await assert.rejects(r.witnessResolution.prepare(ctx));assert.equal(f.calls.length,0);await r.close();
 }
});
test('wrong canonical binding or program identity cannot request additional state',async()=>{
 const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);
 for(const key of ['programDigest','canonicalHash']){const ctx={...missing(f.context,addr(2)),[key]:slot(99)},before=f.calls.length;await assert.rejects(r.witnessResolution.resolve(ctx));assert.equal(f.calls.length,before);}await r.close();
});
test('already-proved or repeated dependency stops instead of looping or treating uncertainty as success',async()=>{
 const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);
 await assert.rejects(r.witnessResolution.resolve(missing(f.context,addr(1))),/already proved/);assert.equal(f.calls.length,5);assert.equal(r.evidence.fullWitnessComplete,false);await r.close();
});
test('global account, slot, request and round budgets refuse expansion before any excessive query',async()=>{
 for(const budget of [{maximumAccounts:1},{maximumRequests:5},{maximumRounds:1},{maximumSlots:1}]){
  const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,{...f.options,budget});await r.witnessResolution.prepare(f.context);
  if(budget.maximumRounds||budget.maximumSlots)await r.witnessResolution.resolve(missing(f.context,addr(2),slot(1)));
  const before=f.calls.length;await assert.rejects(r.witnessResolution.resolve(missing(f.context,addr(3),slot(2))));assert.equal(f.calls.length,before);await r.close();
 }
});
test('one clock/deadline and stale pin apply across rounds without selecting latest',async()=>{
 const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);const before=f.calls.length;
 f.setTime(f.clock()+120001);await assert.rejects(r.witnessResolution.resolve(missing(f.context,addr(2))),/total-timeout/);assert.equal(f.calls.length,before);await r.close();
 const stale=fixture();stale.setTime(stale.clock()+181000);const r2=createCapturedNativeWitnessResolver(stale.input,stale.options);await assert.rejects(r2.witnessResolution.prepare(stale.context),/pin-not-recent/);assert.equal(stale.calls.length,0);await r2.close();
});
test('cancellation and concurrent mutation cannot open a new native process or produce closure evidence',async()=>{
 const f=fixture(),controller=new AbortController(),r=createCapturedNativeWitnessResolver(f.input,{...f.options,signal:controller.signal});await r.witnessResolution.prepare(f.context);controller.abort();await assert.rejects(r.createClient(),/cancelled/);await assert.rejects(r.witnessResolution.resolve(missing(f.context,addr(2))),/cancelled/);assert.equal(f.native.length,0);await r.close();
});
test('runtime/proof corruption is never installed or converted into empty state',async()=>{
 const f=fixture(),fetchImpl=async(url,options)=>{const response=await f.options.fetchImpl(url,options),body=await response.json();if(JSON.parse(options.body).method==='eth_getCode')body.result='0x01';return new Response(JSON.stringify(body));};
 const r=createCapturedNativeWitnessResolver(f.input,{...f.options,fetchImpl});await assert.rejects(r.witnessResolution.prepare(f.context),/incomplete/);await assert.rejects(r.createClient(),/Prepare canonical/);assert.equal(r.evidence.fullWitnessComplete,false);await r.close();
});
test('complete bound native evidence is separate from publication acceptance and cleared for another request',async()=>{
 const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);
 r.onSession({canonicalHash:f.context.canonicalHash,programDigest:f.context.programDigest,fullWitnessComplete:true,headerHistoryComplete:true,stickyStateError:false,acceptance:false});
 assert.equal(r.evidence.fullWitnessComplete,true);assert.equal(r.evidence.acceptance,false);await r.witnessResolution.prepare(f.context);assert.equal(r.evidence.fullWitnessComplete,false);await r.close();
});
test('unproved header targets outside lookback and ambiguous diagnostics refuse without fetching',async()=>{
 for(const dependency of [{kind:'missing-header',stage:0,ancestorNumber:'0x1000'},{kind:'missing-header',stage:0,ancestorNumber:'0x1',ancestorHash:slot(1)},{kind:'missing-header',stage:0}]){
  const f=fixture(),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);const before=f.calls.length;await assert.rejects(r.witnessResolution.resolve({...f.context,dependency}));assert.equal(f.calls.length,before);await r.close();
 }
});
test('budget overrides only tighten fixed reviewed bounds',()=>{
 const f=fixture();for(const [key,value] of Object.entries(NATIVE_WITNESS_RESOLUTION_LIMITS))assert.throws(()=>createCapturedNativeWitnessResolver(f.input,{...f.options,budget:{[key]:value+1}}),/only tighten/);
});
test('missing ancestor collection verifies every contiguous header hash and canonical pin before replay',async()=>{
 for(const identity of ['number','hash']){
  const f=fixture({history:true}),r=createCapturedNativeWitnessResolver(f.input,f.options);await r.witnessResolution.prepare(f.context);
  const dependency={kind:'missing-header',stage:3,...(identity==='number'?{ancestorNumber:'0x28'}:{ancestorHash:f.ancestors[1].hash})};
  await r.witnessResolution.resolve({...f.context,dependency});const client=await r.createClient();
  assert.deepEqual(f.native[0].ancestorHeaders,f.ancestors.map(encodeCapturedHeader));
  assert.deepEqual(r.evidence.headerReads.map(x=>x.request.params[0]),['0x2a','0x29','0x28','0x2a']);
  assert.ok(r.evidence.headerReads.every(x=>x.responseComplete&&sha256(Buffer.from(x.rawResponseBase64,'base64'))===x.responseSHA256));await client.close();await r.close();
 }
});
test('wrong ancestor link or changed final canonical header cannot create a new verified session',async()=>{
 const f=fixture({history:true});let parentRead=false;
 const r=createCapturedNativeWitnessResolver(f.input,{...f.options,fetchImpl:async(url,options)=>{
  const response=await f.options.fetchImpl(url,options),body=await response.json(),request=JSON.parse(options.body);
  if(request.params[0]==='0x29')parentRead=true;
  if(parentRead&&request.params[0]==='0x2a')body.result={...body.result,hash:slot(55)};
  return new Response(JSON.stringify(body));}});
 await r.witnessResolution.prepare(f.context);await assert.rejects(r.witnessResolution.resolve({...f.context,dependency:{kind:'missing-header',stage:1,ancestorNumber:'0x29'}}));
 assert.equal(r.evidence.fullWitnessComplete,false);assert.equal(f.native.length,0);await r.close();
});
