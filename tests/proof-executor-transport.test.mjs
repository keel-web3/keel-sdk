import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProofBackedSimulationTransport } from '../native/proof-executor/transport.mjs';

// Protocol guard tests use a process double. They do not prove EVM execution.
const directory=mkdtempSync(join(tmpdir(),'keel-native-protocol-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
const binaryPath=join(directory,'process-double'),binaryBytes='protocol test double';
writeFileSync(binaryPath,binaryBytes);
const binarySha256=createHash('sha256').update(binaryBytes).digest('hex');
const hash=`0x${'11'.repeat(32)}`,root=`0x${'22'.repeat(32)}`,address=`0x${'33'.repeat(20)}`;
const header={hash,stateRoot:root,parentHash:`0x${'44'.repeat(32)}`,number:'0x0',timestamp:'0x1'};
const input={method:'eth_simulateV1',params:[{blockStateCalls:[{calls:[{from:address,to:address,gas:'0x100000',data:'0x',value:'0x0'}]}],validation:true,returnFullTransactions:true},'0x0']};
function harness(run) {
  const reads=[],proofs=[],processes=[];
  const options={binaryPath,binarySha256,block:{number:0n,hash},now:()=>1000,
    limits:{gasBudget:2000000,requests:10,witnessBytes:100000,responseBytes:100000,wallTimeMs:5000},
    stateReader:{request:async({method,params})=>{reads.push({method,params});if(method==='eth_chainId')return '0xaa36a7';if(method==='eth_getBlockByNumber')return structuredClone(header);throw new Error('Unexpected source read');}},
    onEvidence:e=>proofs.push(e),
    spawnExecutor:()=>{
      const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;
      child.kill=()=>{child.killed=true;return true;};processes.push(child);
      child.stdin.once('data',raw=>queueMicrotask(()=>run({child,request:JSON.parse(raw.toString()),digest:createHash('sha256').update(raw.subarray(0,-1)).digest('hex')})));
      return child;
    }};
  return {options,reads,proofs,processes};
}
const emit=(child,value)=>child.stdout.write(`${JSON.stringify(value)}\n`);
function success(request,digest) {
  return {type:'result',result:[{stateRoot:root}],evidence:{schema:'keel-proof-executor-evidence@1',gethCommit:'a579077007b98217c3e253a66e4b452ca0c32b96',requestSha256:digest,chainId:11155111,gasBudget:request.limits.gasBudget,blockHash:hash,baseStateRoot:root,signing:'not-performed',submission:'not-performed',readRequests:0}};
}

test('binary digest mismatch performs neither state acquisition nor spawn',async()=>{
  const h=harness(()=>assert.fail('spawned'));await assert.rejects(createProofBackedSimulationTransport({...h.options,binarySha256:'0'.repeat(64)}),/checksum/);assert.deepEqual(h.reads,[]);
});

for(const [name,message] of [
  ['execution forwarding',{type:'read',id:1,method:'eth_call',params:[]}],
  ['unapproved ancestor',{type:'read',id:1,method:'eth_getBlockByHash',params:[hash,false]}],
  ['unpinned proof',{type:'read',id:1,method:'eth_getProof',params:[address,[],'latest']}],
  ['noncanonical proof',{type:'read',id:1,method:'eth_getProof',params:[address,[],{blockHash:hash,requireCanonical:false}]}],
  ['unbounded slots',{type:'read',id:1,method:'eth_getProof',params:[address,[root,root],{blockHash:hash,requireCanonical:true}]}],
  ['out of order read',{type:'read',id:2,method:'eth_getCode',params:[address,{blockHash:hash,requireCanonical:true}]}],
]) test(`${name} is rejected before forwarding`,async()=>{
  const h=harness(({child})=>emit(child,message)),t=await createProofBackedSimulationTransport(h.options);
  await assert.rejects(t.request(input));assert.deepEqual(h.reads.map(r=>r.method),['eth_chainId','eth_getBlockByNumber']);assert.deepEqual(h.proofs,[]);assert.equal(h.processes[0].killed,true);await t.close();
});

for(const [name,change] of [
  ['input digest',m=>m.evidence.requestSha256='0'.repeat(64)],
  ['chain',m=>m.evidence.chainId=1],
  ['engine',m=>m.evidence.gethCommit='0'.repeat(40)],
  ['gas budget',m=>m.evidence.gasBudget=1],
  ['base state',m=>m.evidence.baseStateRoot=hash],
  ['read count',m=>m.evidence.readRequests=1],
  ['block count',m=>m.result=[]],
  ['zero root',m=>m.result[0].stateRoot=`0x${'00'.repeat(32)}`],
]) test(`mismatched ${name} produces no proof`,async()=>{
  const h=harness(({child,request,digest})=>{const m=success(request,digest);change(m);emit(child,m);child.emit('close',0);});
  const t=await createProofBackedSimulationTransport(h.options);await assert.rejects(t.request(input));assert.deepEqual(h.proofs,[]);await t.close();
});

for(const tail of ['partial','second-result'])test(`native ${tail} after result is rejected`,async()=>{
  const h=harness(({child,request,digest})=>{const result=success(request,digest);emit(child,result);if(tail==='partial')child.stdout.write('{');else emit(child,result);child.emit('close',0);});
  const t=await createProofBackedSimulationTransport(h.options);await assert.rejects(t.request(input));assert.deepEqual(h.proofs,[]);await t.close();
});

test('a result is held until successful native process exit and canonical recheck',async()=>{
  let ready;const waiting=new Promise(resolve=>{ready=resolve;});
  const h=harness(({child,request,digest})=>{emit(child,success(request,digest));ready(child);});
  const t=await createProofBackedSimulationTransport(h.options);let done=false;
  const pending=t.request(input).then(value=>{done=true;return value;});const child=await waiting;
  await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.deepEqual(h.proofs,[]);
  child.emit('close',0);await pending;assert.equal(h.reads.filter(r=>r.method==='eth_getBlockByNumber').length,2);assert.equal(h.proofs.length,1);await t.close();
});

test('initial options are snapshotted before asynchronous binary verification',async()=>{
  const h=harness(({child,request,digest})=>{assert.equal(request.blockHash,hash);assert.equal(request.limits.gasBudget,2000000);emit(child,success(request,digest));child.emit('close',0);});
  const building=createProofBackedSimulationTransport(h.options);h.options.block.hash=root;h.options.limits.gasBudget=1;
  const t=await building;await t.request(input);await t.close();
});
