import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createProofBackedSimulationTransport} from '../native/proof-executor/transport.mjs';

const hash='0x'+'11'.repeat(32),root='0x'+'22'.repeat(32),address='0x'+'33'.repeat(20);
const header={hash,stateRoot:root,number:'0x0',timestamp:'0x1',parentHash:'0x'+'44'.repeat(32)};
const input={method:'eth_simulateV1',params:[{blockStateCalls:[{calls:[{from:address,to:address,data:'0xdeadbeef',gas:'0x100000',value:'0x0'}]}],validation:true,returnFullTransactions:true},'0x0']};
async function fixture(t,{hangRead=false,runnerReady=true,observer,walkReads=1,wallTimeMs=60}={}) {
 const directory=await mkdtemp(join(tmpdir(),'keel-deadline-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const binaryPath=join(directory,'double');await writeFile(binaryPath,'double');
 const events=[],reads=[],signals=[];let child;
 const options={binaryPath,binarySha256:createHash('sha256').update('double').digest('hex'),block:{number:0n,hash},now:()=>1000,
  limits:{gasBudget:2000000,requests:10000,witnessBytes:100000,responseBytes:100000,wallTimeMs},
  onProgress:event=>{events.push(event);observer?.(event);},
  stateReader:{request:async({method,signal})=>{
   reads.push(method);signals.push(signal);if(method==='eth_chainId')return '0xaa36a7';if(method==='eth_getBlockByNumber')return structuredClone(header);
   if(hangRead)return new Promise(()=>{});return '0x';
  }},spawnExecutor:()=>{
   child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
   child.kill=()=>{child.killed=true;return true;};
   child.stdin.once('data',()=>queueMicrotask(()=>{
    if(!runnerReady)return;
    child.emit('runner-ready');
    for(let id=1;id<=walkReads;id++)child.stdout.write(JSON.stringify({type:'read',id,method:'eth_getCode',params:[address,{blockHash:hash,requireCanonical:true}]})+'\n');
   }));return child;
  }};
 const transport=await createProofBackedSimulationTransport(options);
 t.after(()=>transport.close());
 return {transport,events,reads,signals,child:()=>child};
}
test('local deadline identifies a pending state read without calling it completed program work',async t=>{
 const f=await fixture(t,{hangRead:true});
 await assert.rejects(f.transport.request(input),error=>{
  assert.equal(error.diagnostic.nativeStage,'state-read');
  assert.equal(error.diagnostic.nativePendingMethod,'eth_getCode');
  assert.equal(error.diagnostic.nativeStateReads,1);assert.equal(error.diagnostic.nativeCompletedStateReads,0);
  assert.equal(error.diagnostic.transportFailure,'timeout');return true;
 });
 assert.equal(f.child().killed,true);
 assert.equal(f.signals.at(-1).aborted,true);
 assert.ok(f.events.some(e=>e.type==='runner-ready'));assert.ok(f.events.some(e=>e.type==='state-read-start'));
 assert.doesNotMatch(JSON.stringify(f.events),/deadbeef|333333333333333333333333|params|https?:/);
});
test('large native read sequences retain bounded telemetry and full final counters',async t=>{
 const f=await fixture(t,{walkReads:300,wallTimeMs:200});
 await assert.rejects(f.transport.request(input),error=>{
  assert.equal(error.diagnostic.nativeStage,'native-execution');assert.equal(error.diagnostic.nativeStateReads,300);
  assert.equal(error.diagnostic.nativeCompletedStateReads,300);assert.match(error.diagnostic.nativeRequestSha256,/^[a-f0-9]{64}$/);return true;
 });
 assert.ok(f.events.length<64);assert.equal(f.events.at(-1).type,'failed');
});
test('no runner handshake is distinguished from provider delay',async t=>{
 const f=await fixture(t,{runnerReady:false});
 await assert.rejects(f.transport.request(input),error=>{
  assert.equal(error.diagnostic.nativeStage,'runner-start');assert.equal(error.diagnostic.nativeStateReads,0);return true;
 });
 assert.deepEqual(f.reads,['eth_chainId','eth_getBlockByNumber']);assert.equal(f.child().killed,true);
});
test('observer exceptions cannot change native timeout or cancellation',async t=>{
 const f=await fixture(t,{hangRead:true,observer:()=>{throw Error('observer credential');}});
 await assert.rejects(f.transport.request(input),/Local simulation deadline exceeded/);assert.equal(f.child().killed,true);
});
test('closing a pending native read cancels both the source and the runner before its deadline',async t=>{
 let reachedRead;const ready=new Promise(resolve=>{reachedRead=resolve;});
 const f=await fixture(t,{hangRead:true,wallTimeMs:5000,observer:event=>{if(event.type==='state-read-start')reachedRead();}});
 const pending=f.transport.request(input);const rejected=assert.rejects(pending,/Local simulation cancelled/);
 await ready;await new Promise(resolve=>setImmediate(resolve));assert.equal(f.reads.at(-1),'eth_getCode');
 await f.transport.close();await rejected;
 assert.equal(f.child().killed,true);assert.equal(f.signals.at(-1).aborted,true);
 assert.equal(f.events.some(e=>e.type==='complete'),false);
});
