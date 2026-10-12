import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { keccak256 } from 'viem';
import { syntheticCapture, syntheticHoldProof } from './fixtures/fresh-publication-seed-input.mjs';
import { deriveFreshRetroSeeds } from '../scripts/lib/fresh-publication-witness-seeds.mjs';
import { normalizeAssemblyCapture, encodeCapturedHeader, sha256, stable } from '../scripts/lib/captured-publication-fixture.mjs';
import { CAPTURED_STATE_RPC as RPC, CAPTURED_STATE_LIMITS as PAGE, CAPTURED_STATE_INVENTORY_LIMITS as LIMITS,
  validateCapturedStateSeed, collectCapturedStateWitness } from '../scripts/lib/captured-state-witness.mjs';
import { planCapturedStateInventory as plan, collectCapturedStateInventory as collect,
  mergeCapturedStateWitnessPages as merge } from '../scripts/lib/captured-state-inventory.mjs';
import { main } from '../scripts/lib/captured-state-inventory-cli.mjs';

const ambientFetch = globalThis.fetch; let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('Offline inventory tests forbid network'); };
after(() => { globalThis.fetch = ambientFetch; assert.equal(networkAttempts, 0); });
const EMPTY = keccak256('0x80'), EMPTY_CODE = keccak256('0x');
const address = n => `0x${n.toString(16).padStart(40,'0')}`;
const slot = n => `0x${n.toString(16).padStart(64,'0')}`;

// Synthetic empty-trie proofs exercise inventory coverage only. The source
// shape has 45/47 calls; none is executed and no acceptance is claimed.
function fixture(count = 105, slots = [105,95,1]) {
  const capture = syntheticCapture({ stateRoot: EMPTY }), h = capture.canonicalBefore;
  const normalized = normalizeAssemblyCapture(capture), captureBytes = Buffer.from(JSON.stringify(capture));
  const seed = { schema:'keel-private-fresh-retro-seeds@1', captureSHA256:sha256(captureBytes),
    captureObjectSHA256:sha256(stable(capture)), completeInputSHA256:capture.completeInputSHA256,
    sourceFingerprint:sha256(stable({identity:normalized.identity,source:normalized.source,completeInputSHA256:capture.completeInputSHA256})),
    pin:{number:h.number,hash:h.hash,stateRoot:h.stateRoot,timestamp:h.timestamp},headerRlp:encodeCapturedHeader(h),
    accounts:Array.from({length:count},(_,i)=>({address:address(i+1),slots:Array.from({length:slots[i]??0},(_,j)=>slot(j)),expectedCodeHash:EMPTY_CODE})),
    pendingDerivations:[{kind:'native-access-closure',reason:'Synthetic inventory is not execution'}],closure:{complete:false} };
  return {input:{capture,captureBytes,seed},clock:Number(BigInt(h.timestamp))*1000};
}
function harness(input, transform) {
  const calls=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(url,RPC);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    const request=JSON.parse(options.body);calls.push(request);
    assert.ok(['eth_chainId','eth_getBlockByNumber','eth_getProof','eth_getCode'].includes(request.method));
    assert.ok(!options.body.includes(input.capture.completeExpectedTokenURI));
    let result;
    if(request.method==='eth_chainId')result='0xaa36a7';
    else if(request.method==='eth_getBlockByNumber'){assert.deepEqual(request.params,[input.seed.pin.number,false]);result=input.capture.canonicalBefore;}
    else if(request.method==='eth_getCode')result='0x';
    else result={address:request.params[0],nonce:'0x0',balance:'0x0',codeHash:EMPTY_CODE,storageHash:EMPTY,accountProof:[],
      storageProof:request.params[1].map(key=>({key,value:'0x0',proof:[]}))};
    const changed=await transform?.({request,result,options,index:calls.length-1});
    if(changed instanceof Response)return changed;
    if(changed!==undefined)result=changed;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  };
  return {calls,fetchImpl};
}
async function run({input,clock,...options}={...fixture()}) {
  const h=harness(input,options.transform);
  return {report:await collect(input,{fetchImpl:h.fetchImpl,now:()=>clock,...options}),calls:h.calls};
}

test('105-account/201-slot Retro-sized inventory keeps every account, uses two bounded pages and never claims execution',async()=>{
  const f=fixture(),before=stable(f.input),p=plan(f.input);
  assert.equal(p.accountCount,105);assert.equal(p.slotCount,201);assert.equal(p.pages.length,2);assert.equal(p.requestCount,216);
  assert.deepEqual(p.pages.map(x=>x.accounts.length),[64,41]);
  assert.deepEqual(p.pages.flatMap(x=>x.accounts),validatePlanAccounts(f.input));
  assert.throws(()=>validateCapturedStateSeed(f.input),'Legacy one-page limit is preserved');
  const {report:r,calls}=await run(f);assert.equal(r.status,'inventory-verified-full-witness-incomplete');
  assert.equal(r.inventoryComplete,true);assert.equal(calls.length,216);assert.equal(r.merged.provedAccounts,105);assert.equal(r.merged.provedSlots,201);
  assert.ok(r.pages.every(p=>p.report.requests.length<=PAGE.maximumRequests));
  for(const key of ['fullWitnessComplete','transitiveStateComplete','projectAcceptance','acceptance','gateAccepted','projectCalldataSent','originalPlanChanged']){
    assert.equal(r[key],false);assert.equal(r.merged[key],false);
  }
  assert.equal(r.merged.nativeAccessClosure,'not-executed');assert.equal(r.merged.unresolvedSourceDependencies.length,1);
  assert.equal(stable(f.input),before);
});
function validatePlanAccounts(input){return input.seed.accounts.map(a=>({address:a.address,slots:a.slots,expectedCodeHash:a.expectedCodeHash}));}

test('saved Retro geometry derives all93 conditional CREATE accounts from a proved synthetic Hold nonce and partitions without dropping any',()=>{
  const hold=syntheticHoldProof(7n),capture=syntheticCapture({stateRoot:hold.stateRoot,chunkCount:85});
  const captureBytes=Buffer.from(JSON.stringify(capture)),before=stable(capture);
  const seed=deriveFreshRetroSeeds(capture,{captureBytes,witness:hold.witness});
  assert.equal(seed.program.chunks,85);assert.equal(seed.program.weldOperations,8);assert.equal(seed.program.preparationCalls,45);
  assert.equal(seed.possibleHoldCreateTargets.length,93);assert.equal(seed.closure.complete,false);
  const p=plan({capture,captureBytes,seed});assert.equal(p.pages.length,2);
  assert.deepEqual(p.pages.flatMap(page=>page.accounts.map(a=>a.address)),seed.accounts.map(a=>a.address));
  for(const target of seed.possibleHoldCreateTargets)assert.ok(p.pages.some(page=>page.accounts.some(a=>a.address===target.address)));
  assert.equal(stable(capture),before);assert.equal(seed.currentFreshnessEstablished,false);assert.equal(seed.approvalReady,false);
});

test('explicit account and slot maxima fit bounded original-sized pages without increasing any page bounds',async()=>{
  const f=fixture(256,Array(16).fill(256)),p=plan(f.input);
  assert.equal(p.pages.length,7);assert.equal(p.slotCount,4096);assert.equal(p.requestCount,533);
  assert.ok(p.pages.every(page=>page.accounts.length<=64&&page.slotCount<=1024));
  const {report:r}=await run(f);assert.equal(r.inventoryComplete,true);assert.equal(r.requestCount,533);
  assert.equal(r.merged.provedSlots,4096);assert.equal(r.merged.provedAccounts,256);
});

test('missing, duplicate, reordered or altered pages cannot be declared complete',async()=>{
  const f=fixture(),r=(await run(f)).report;
  for(const change of [pages=>pages.pop(),pages=>pages.push(pages[0]),pages=>pages.reverse(),pages=>{pages[1]=structuredClone(pages[0]);},
    pages=>{pages[1].page.accountOffset--;},pages=>{pages[0].page.accounts[0].slots.pop();},pages=>{pages[1].page.pageSHA256='0'.repeat(64);}]){
    const pages=structuredClone(r.pages);change(pages);assert.throws(()=>merge(f.input,r.plan,pages,{now:()=>f.clock}));
  }
});

test('saved success flags cannot hide wrong source, inventory, raw response, proof, code or canonical header',async()=>{
  const f=fixture(),r=(await run(f)).report;
  const changes=[p=>p.report.binding.completeInputSHA256='0'.repeat(64),p=>p.report.binding.seedObjectSHA256='0'.repeat(64),
    p=>p.report.binding.pin.hash='0x'+'00'.repeat(32),p=>p.report.requestedAccounts.pop(),p=>p.report.witness.accounts.pop(),
    p=>p.report.witness.accounts[0].balance='0x1',p=>p.report.canonicalAfter.number='0x2b',p=>p.report.requests.pop(),
    p=>p.report.requests[2].rawResponseBase64='AA==',p=>p.report.requests[2].responseComplete=false,
    p=>p.report.requests[2].request.params[1].pop(),p=>p.report.status='blocked',p=>p.report.fullWitnessComplete=true,
    p=>p.report.provedSlots++,p=>p.report.responseBytes++];
  for(const change of changes){const pages=structuredClone(r.pages);change(pages[0]);assert.throws(()=>merge(f.input,r.plan,pages,{now:()=>f.clock}));}
  const pages=structuredClone(r.pages),entry=pages[0].report.requests[2];
  const response=JSON.parse(Buffer.from(entry.rawResponseBase64,'base64'));response.result.balance='0x1';
  const raw=Buffer.from(JSON.stringify(response));Object.assign(entry,{rawResponseBase64:raw.toString('base64'),capturedResponseBytes:raw.length,observedResponseBytes:raw.length,capturedResponseSHA256:sha256(raw)});
  assert.throws(()=>merge(f.input,r.plan,pages,{now:()=>f.clock}),/invalid-proof/);
});

test('changed whole input, page limits, or account order cannot reuse old pages',async()=>{
  const f=fixture(),r=(await run(f)).report;
  const input=structuredClone(f.input);input.seed.accounts.reverse();assert.throws(()=>merge(input,r.plan,r.pages,{now:()=>f.clock}));
  const p=structuredClone(r.plan);p.pageLimits.maximumAccounts=65;assert.throws(()=>merge(f.input,p,r.pages,{now:()=>f.clock}));
  f.input.capture.exactSimulationInput.preparationCalls[0].data='0x';assert.throws(()=>merge(f.input,r.plan,r.pages,{now:()=>f.clock}));
});

test('stored pages cannot bypass whole-operation age or a backward merge clock',async()=>{
  const f=fixture(1,[1]),r=(await run(f)).report;
  assert.throws(()=>merge(f.input,r.plan,r.pages,{now:()=>f.clock+120000}),/merge deadline/);
  let reads=0;assert.throws(()=>merge(f.input,r.plan,r.pages,{now:()=>f.clock-reads++}),/clock moved backward/);
  const pages=structuredClone(r.pages);pages[0].report.finishedAt=new Date(f.clock+1).toISOString();
  assert.throws(()=>merge(f.input,r.plan,pages,{now:()=>f.clock}),/Future page/);
});

test('second-page wrong pin retains partial evidence and makes zero completeness claims',async()=>{
  const f=fixture();let headerReads=0;
  const {report:r}=await run({...f,transform:({request,result})=>{
    if(request.method==='eth_getBlockByNumber'&&++headerReads===3)return {...result,number:'0x2b'};
  }});
  assert.equal(r.status,'blocked');assert.equal(r.pages.length,2);assert.equal(r.pages[0].report.seedComplete,true);
  assert.equal(r.pages[1].report.seedComplete,false);assert.equal(r.inventoryComplete,false);assert.equal(r.error.pageIndex,1);assert.equal(r.merged,undefined);
});

test('stale pin, changed inventory bounds and duplicate accounts refuse before any network request',async()=>{
  for(const f of [fixture(257),fixture(17,Array(17).fill(256)),fixture(1,[257])])assert.equal((await run(f)).calls.length,0);
  const f=fixture();f.input.seed.accounts[1].address=f.input.seed.accounts[0].address;assert.equal((await run(f)).calls.length,0);
  const old=fixture();old.clock+=181000;const r=await run(old);assert.equal(r.calls.length,0);assert.equal(r.report.inventoryComplete,false);
});

test('one shared deadline cannot restart at the next page',async()=>{
  const f=fixture();let clock=f.clock;
  const {report:r,calls}=await run({...f,now:()=>clock,budget:{maximumDurationMs:1500},transform:()=>{clock+=10;}});
  assert.equal(r.status,'blocked');assert.equal(r.inventoryComplete,false);assert.ok(r.pages.length===2);
  assert.ok(calls.length<216);assert.equal(r.error.pageError.reason,'total-timeout');
});

test('one shared response budget cannot restart at the next page',async()=>{
  const f=fixture(65,[]),baseline=(await run(f)).report;
  const cap=baseline.pages[0].report.responseBytes+20;
  const {report:r,calls}=await run({...f,budget:{maximumTotalResponseBytes:cap}});
  assert.equal(r.status,'blocked');assert.equal(r.pages.length,2);assert.equal(r.inventoryComplete,false);
  assert.equal(r.error.pageError.reason,'response-too-large');assert.ok(r.responseBytes<=cap);assert.ok(calls.length<baseline.requestCount);
});

test('budgets may tighten but never enlarge reviewed whole-inventory bounds',async()=>{
  const f=fixture();for(const budget of [{maximumDurationMs:LIMITS.maximumDurationMs+1},{maximumTotalResponseBytes:LIMITS.maximumTotalResponseBytes+1},{maximumDurationMs:0}])
    await assert.rejects(collect(f.input,{budget}),/only tighten/);
});

test('cancellation after one completed page prevents the next page and preserves originals',async()=>{
  const f=fixture(),before=stable(f.input),controller=new AbortController();
  const r=await run({...f,signal:controller.signal,checkpoint:value=>{
    if(value.pages[0]?.report?.seedComplete)controller.abort();
  }});
  assert.equal(r.report.status,'blocked');assert.equal(r.report.error.reason,'cancelled');assert.equal(r.calls.length,131);
  assert.equal(r.report.inventoryComplete,false);assert.equal(stable(f.input),before);
  const again=await run(f);assert.equal(again.report.inventoryComplete,true);assert.equal(again.calls.length,216);
});

test('abort interrupts a pending read rather than waiting for its request timeout',async()=>{
  const f=fixture(),controller=new AbortController();let sent=0,aborted=false;
  const pending=collect(f.input,{now:()=>f.clock,signal:controller.signal,fetchImpl:async(_url,{signal})=>{
    sent++;queueMicrotask(()=>controller.abort());return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}));
  }});
  const r=await pending;assert.equal(sent,1);assert.equal(aborted,true);assert.equal(r.inventoryComplete,false);assert.equal(r.error.pageError.reason,'cancelled');
});

test('checkpoint failure cannot publish a completed inventory',async()=>{
  const f=fixture();const r=await run({...f,checkpoint:value=>{if(value.inventoryComplete)throw Error('cannot save');}});
  assert.equal(r.report.status,'blocked');assert.equal(r.report.inventoryComplete,false);assert.equal(r.report.merged,undefined);
});

test('one-page legacy collector retains its original bound and output contract',async()=>{
  const f=fixture(1,[2]),h=harness(f.input);const r=await collectCapturedStateWitness(f.input,{now:()=>f.clock,fetchImpl:h.fetchImpl});
  assert.equal(r.seedComplete,true);assert.equal(r.schema,'keel-captured-state-seed-witness@1');assert.equal(r.requests.length,5);
});

test('CLI accepts explicit full inventory, refuses overwrite and new endpoints, and writes only a private diagnostic',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'keel-inventory-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const f=fixture(),capture=join(dir,'capture.json'),seed=join(dir,'seed.json'),output=join(dir,'report.json');
  writeFileSync(capture,f.input.captureBytes);writeFileSync(seed,JSON.stringify(f.input.seed));
  const h=harness(f.input),args=['--capture',capture,'--seed',seed,'--output',output];
  assert.equal(await main(args,{fetchImpl:h.fetchImpl,now:()=>f.clock}),0);assert.equal(statSync(output).mode&0o777,0o600);
  assert.equal(JSON.parse(readFileSync(output)).inventoryComplete,true);const before=h.calls.length;
  await assert.rejects(main(args,{fetchImpl:h.fetchImpl,now:()=>f.clock}),/EEXIST/);assert.equal(h.calls.length,before);
  await assert.rejects(main([...args,'--rpc','https://unapproved.invalid']));
});
