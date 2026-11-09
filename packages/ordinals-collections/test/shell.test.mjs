import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixture,addUpdate,load} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,Recursion,walk,positionSample,shellPolicy,headerHasWork} from '../src/shell/index.mjs';
import {b,hex,parseTx,serializeTx,formCheck,reverse,sha,utf,envelope} from '../src/core.ts';
const run=async(f,t,options={})=>{
  await f.mock.start();t.after(()=>f.mock.close());
  return verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(f.self)},checkWork:false,...options});
};
const replaceRaw=(mock,record,raw)=>mock.routes.set('/r/tx/'+hex(reverse(record.txid)),raw);

test('two agreeing writers settle; the stopped third writer casts no vote',async t=>{
  const f=fixture(),v=await run(f,t);
  assert.equal(v.status,'member');assert.equal(v.C,106);assert.equal(v.rank,1);assert.equal(v.final,true);
  assert.equal(v.originals[2].h,null);assert.equal(v.scope,'S1-S9');assert.deepEqual(v.stats,f.mock.stats);
});
test('one writer alone cannot settle; q is not lowered',async t=>{
  const v=await run(fixture({writers:1}),t);assert.equal(v.status,'settling');assert.equal(v.C,null);
});
test('a writer claiming a nonexistent future height casts no vote',async t=>{
  const f=fixture();f.mock.add({metadata:{...f.updates[0].metadata,h:0xffffffff},height:106,parent:f.authorities[2].id});
  const v=await run(f,t);assert.equal(v.status,'member');assert.equal(v.originals[2].h,null);assert.equal(v.C,106);
});
test('an unavailable writer does not block the other two',async t=>{
  const f=fixture();f.mock.children.delete(f.authorities[2].id);
  const v=await run(f,t);assert.equal(v.status,'member');assert.equal(v.C,106);
});
test('equivocating sibling is ignored, first valid child remains (R31)',async t=>{
  const f=fixture(),bad=addUpdate(f.mock,f.r,f.authorities[0].id,f.rows);
  const v=await run(f,t);assert.equal(v.status,'member');
  assert.deepEqual(v.originals[0].equivocations,[[f.updates[0].id,bad.id]]);
  assert.ok(v.originals[0].ignored.includes(bad.id));assert.deepEqual(v.originals[0].accepted,[f.updates[0].id]);
});
test('a non-extending root is ignored',async t=>{
  const f=fixture(),bad=addUpdate(f.mock,f.r,f.authorities[0].id,f.rows,{prev:f.updates[0].id,prevRoot:'11'.repeat(32)});
  const v=await run(f,t);assert.ok(v.originals[0].ignored.includes(bad.id));assert.deepEqual(v.originals[0].accepted,[f.updates[0].id]);
});
test('authenticated pin ratchet rejects a writer and removes its quorum vote',async t=>{
  const f=fixture();
  f.mock.add({metadata:{p:'koc1',op:'koc1-pin',seen:[[0,b('ab'.repeat(36)),b(f.updates[0].metadata.root)]]},parent:f.self});
  const v=await run(f,t);assert.equal(v.originals[0].usable,false);assert.equal(v.originals[0].h,null);assert.deepEqual(v.originals[0].entries,[]);assert.equal(v.C,null);assert.equal(v.status,'settling');
});
test('ratchet passes only through the exact seen root; every pin is required',async t=>{
  const f=fixture();f.mock.add({metadata:{p:'koc1',op:'koc1-pin',pins:[[0,b(f.updates[0].id),b(f.updates[0].metadata.root)],[0,b(f.updates[0].id),b('ff'.repeat(32))]]},parent:f.self});
  const v=await run(f,t);assert.equal(v.originals[0].usable,false);assert.equal(v.C,null);
});
test('mint-carried seen rejects a writer whose chain skips the recorded update',async t=>{
  const f=fixture(),old=f.mints[0],metadata={...old.metadata,seen:[[0,b('ab'.repeat(36)),b(f.updates[0].metadata.root)]]};
  const tx=parseTx(old.rawTx),record=f.mock.add({metadata,script:envelope(metadata,f.r.art.viewer.id),outputs:tx.outputs,height:100});
  f.self=record.id;f.mock.block(100,[old,record]);
  const v=await run(f,t);assert.equal(v.originals[0].usable,false);assert.equal(v.C,null);assert.equal(v.status,'settling');
});
test('S1 rejects a location without an inscription ID',async t=>{
  const v=await run(fixture(),t,{location:{pathname:'/viewer'}});assert.equal(v.status,'invalid');assert.match(v.reasons[0],/S1/);assert.equal(v.stats.fetches,0);
});
test('S2 rejects a forged reveal with a different stripped txid',async t=>{
  const f=fixture(),tx=parseTx(f.mints[0].rawTx);tx.outputs[0].value++;
  replaceRaw(f.mock,f.mints[0],hex(serializeTx(tx)));
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/txid mismatch/);
});
test('S2/S3 rejects forged witness even when stripped txid is unchanged',async t=>{
  const f=fixture(),tx=parseTx(f.mints[0].rawTx);tx.inputs[0].witness[1]+='00';
  replaceRaw(f.mock,f.mints[0],hex(serializeTx(tx)));
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/commit-authentication/);
});
test('S3 rejects a genuinely committed mint with a wrong payment',async t=>{
  const f=fixture(),old=f.mints[0],tx=parseTx(old.rawTx);tx.outputs[1].value=999;
  const bad=f.mock.add({metadata:old.metadata,script:tx.inputs[0].witness[1],outputs:tx.outputs,height:100});f.self=bad.id;f.mock.block(100,[bad]);
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/payment/);
});
test('S4 rejects reinscription charms',async t=>{
  const f=fixture();f.mints[0].info.charms=['reinscription'];
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/charms/);
});
test('S5 rejects wrong reference body bytes',async t=>{
  const f=fixture();f.r.art.viewer.sha256='ff'.repeat(32);
  // Authentic recipe bytes are immutable; corrupting returned reference witness
  // fails commit authentication rather than trusting a metadata assertion.
  const record=f.mock.records.get(f.r.art.viewer.id),tx=parseTx(record.rawTx);tx.inputs[0].witness[1]+='00';replaceRaw(f.mock,record,hex(serializeTx(tx)));
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/commit-authentication/);
});
test('S7/S8 rejects a bad block header',async t=>{
  const f=fixture(),path='/r/block/100',raw=f.mock.routes.get(path);f.mock.routes.set(path,'ff'+raw.slice(2));
  const v=await run(f,t);assert.equal(v.status,'invalid');assert.match(v.reasons[0],/bad header/);
});
test('missing recursion evidence stays settling, never invalid or complete',async t=>{
  const f=fixture();f.mock.routes.delete('/r/tx/'+hex(reverse(parseTx(f.mints[0].commitTx).txid)));
  const v=await run(f,t);assert.equal(v.status,'settling');assert.equal(v.final,false);
});
test('controls use actual receipt height; a late backdated pause is ineffective',async t=>{
  const f=fixture();const late=f.mock.add({metadata:{p:'koc1',op:'control',r:f.r.id,action:'pause',at:100,height:90},height:103,parent:f.r.id});
  const v=await run(f,t);assert.equal(v.status,'member');assert.deepEqual(v.controls.ignored,[late.id]);
});
test('a timely pause excludes self through the existing control classifier',async t=>{
  const f=fixture({writers:0});const recipeRecord=f.mock.records.get(f.r.id);recipeRecord.info.height=97;f.mock.block(97,[recipeRecord]);f.mock.add({metadata:{p:'koc1',op:'control',r:f.r.id,action:'pause',at:100},height:98,parent:f.r.id});
  const v=await run(f,t);assert.equal(v.status,'not member');assert.ok(v.reasons.includes('paused'));
});
test('S9 rechecks all preceding entries and removes an invalid reveal',async t=>{
  const f=fixture({count:4}),tx=parseTx(f.mints[1].rawTx);tx.inputs[0].witness[1]+='00';replaceRaw(f.mock,f.mints[1],hex(serializeTx(tx)));
  const v=await run(f,t);assert.equal(v.status,'member');assert.equal(v.rank,3);assert.equal(v.checkedPrior,3);assert.equal(v.entryAssurance,'exhaustive');
});
test('S9 above 1000 combines sampling with an invalid challenge outside the sample',async t=>{
  const f=fixture({count:1002,writers:0}),old=f.mints[1],tx=parseTx(old.rawTx);tx.outputs[1].value=999;
  const bad=f.mock.add({metadata:old.metadata,script:tx.inputs[0].witness[1],outputs:tx.outputs,height:100});
  f.mints[1]=bad;f.rows[1]={...f.rows[1],id:bad.id,txid:bad.txid,paymentOutpoint:bad.txid+'00000001'};f.mock.block(100,f.mints);
  for(let i=0;i<2;i++){
    const first=addUpdate(f.mock,f.r,f.authorities[i].id,f.rows.slice(0,1000),{h:100});
    const last=addUpdate(f.mock,f.r,f.authorities[i].id,f.rows,{prev:first.id,prevRoot:first.metadata.root,new:f.rows.slice(1000)});
    if(i===0)f.mock.add({metadata:{p:'koc1',op:'challenge',r:f.r.id,index:last.id,kind:'invalid',mint:bad.txid},parent:f.authorities[i].id});
  }
  assert.ok(!positionSample(f.rows.slice(0,-1),1002,64,hex(reverse(f.mock.routes.get('/r/blockhash/106')))).some(row=>row.txid===bad.txid));
  const v=await run(f,t);assert.equal(v.entryAssurance,'sampled');assert.equal(v.ownEntryAssurance,'full');assert.equal(v.checkedPrior,64);assert.equal(v.rank,1001);assert.equal(v.status,'settling');assert.equal(v.deferred.challenges.length,1);
});
test('S9 threshold: exhaustive through 1000, sampled above; own is never part of the sample',()=>{
  const rows=Array.from({length:1200},(_,i)=>({id:i}));
  assert.equal(positionSample(rows.slice(0,999),1000).length,999);
  const sample=positionSample(rows,1201);assert.equal(sample.length,64);assert.equal(new Set(sample).size,64);assert.ok(sample.every(row=>rows.includes(row)));
});
test('bounded child paging is incomplete, and non-/r/ fetches are refused',async t=>{
  const f=fixture();for(let i=0;i<101;i++)f.mock.add({metadata:{p:'koc1',op:'noise'},parent:f.r.id});
  const v=await run(f,t,{limits:{maxPages:1}});assert.equal(v.status,'settling');assert.match(v.reasons[0],/page budget/);
  assert.throws(()=>new Recursion().get('https://example.com/r/blockheight'),/refused/);
});
test('all applicable shell-policy vector fields (S6/S9, own form, W, and incomplete seams)',()=>{
  for(const {id,input,expected} of load('shell-policy').cases){
    const ownValid=!formCheck(input.self).error;
    const p=shellPolicy({...input,ownValid,incomplete:input.pageEntries>1000||input.challenges>32});
    assert.equal(p.depth,expected.depth,id);assert.equal(p.entryAssurance,expected.entryAssurance,id);assert.equal(p.ownEntryAssurance,expected.ownEntryAssurance,id);
    if(id!=='burned-no-badge'){assert.equal(p.eligible,expected.verified,id);assert.equal(p.final,expected.final,id);}
    // Burn/owner, art, metadata, scan, bridge and spent fields are S10–S14.
  }
});
test('S7 work check accepts the pinned real testnet4 header and rejects a mutation',()=>{
  const raw=load('testnet4-block').cases[0].input.raw;
  assert.ok(raw,'pinned real block raw hex');assert.equal(headerHasWork(raw.slice(0,160)),true);
  const header=b(raw.slice(0,160));header[76]^=1;assert.equal(headerHasWork(header),false);
});
test('browser bundle runs without Node globals, makes recursion requests only',async t=>{
  const bundle=await build({entryPoints:[new URL('../src/shell/index.mjs',import.meta.url).pathname],bundle:true,platform:'browser',format:'iife',globalName:'KOC1Shell',write:false,metafile:true});
  assert.ok(Object.keys(bundle.metafile.inputs).every(path=>!path.includes('node:')));
  assert.doesNotMatch(bundle.outputFiles[0].text,/\brequire\(["'](?:node:|crypto|buffer)/);
  // Run the browser-targeted output in an isolated V8 context without Buffer,
  // process or require, backed by the exact same mock recursion transport.
  const {runInNewContext}=await import('node:vm'),f=fixture();await f.mock.start();t.after(()=>f.mock.close());
  const context={TextEncoder,TextDecoder,Uint8Array,DataView,AbortSignal,URL,console,btoa,fetch:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(f.self)}};
  runInNewContext(bundle.outputFiles[0].text,context);
  const verdict=await context.KOC1Shell.verifyShell({checkWork:false});assert.equal(verdict.status,'member');
});
