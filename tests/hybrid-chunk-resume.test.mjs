import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {createKeelHoldObjectReader}=await import(process.env.KEEL_TEST_CHUNK_READER?pathToFileURL(process.env.KEEL_TEST_CHUNK_READER).href:'../packages/viewer/dist/chunk-store.js');
const hash=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
const id=n=>'0x'+n.toString(16).padStart(64,'0'),address=n=>'0x'+n.toString(16).padStart(40,'0');
const request={chainId:31337,store:address(1),objectId:id(1)},pin='0x'+'ab'.repeat(32);
const record=(bytes,composite=false,count=1)=>({digest:hash(bytes),byteLength:bytes.length,storedByteLength:bytes.length,chunkCount:count,compression:0,composite,descriptorPointer:address(99)});
for(const failure of [{status:401},{cause:{httpStatus:403}},{cause:{code:3}},{terminal:true}])test('terminal page failure cannot trigger descriptor or alternate read: '+JSON.stringify(failure),async()=>{
  let fallbacks=0;
  const reader=createKeelHoldObjectReader({getObject:async()=>record(Uint8Array.of(1)),getObjectSlugPointers:async()=>{throw Object.assign(Error('private'),failure);},getObjectPartIds:async()=>[],getCode:async()=>{fallbacks++;return Uint8Array.of(0);}});
  await assert.rejects(reader(request,new AbortController().signal));assert.equal(fallbacks,0);
});
test('failed traversal resumes completed verified children only at the same pin and commitment; outputs never alias cache',async()=>{
  const reads=new Map();let failRight=true,variant=false;
  const left=Uint8Array.of(1),right=Uint8Array.of(2),joined=Uint8Array.of(1,2);
  const client={
    getObject:async({objectId})=>record(objectId===id(1)?joined:objectId===id(2)?(variant?Uint8Array.of(9):left):right,objectId===id(1),objectId===id(1)?2:1),
    getObjectPartIds:async()=>[id(2),id(3)],getObjectSlugPointers:async({objectId})=>[objectId===id(2)?address(2):address(3)],
    getCode:async({address:target})=>{reads.set(target,(reads.get(target)??0)+1);if(target===address(3)&&failRight)throw Error('transient');return Uint8Array.of(0,...(target===address(2)?(variant?Uint8Array.of(9):left):right));},
  };
  const progress=[];
  const reader=createKeelHoldObjectReader(client,{cacheBlockHash:pin,maxCacheBytes:10_000,onProgress:p=>progress.push(p)});
  await assert.rejects(reader(request,new AbortController().signal),/transient/);
  assert.equal(reads.get(address(2)),1);failRight=false;
  const bytes=await reader(request,new AbortController().signal);assert.deepEqual(bytes,joined);assert.equal(reads.get(address(2)),1);
  bytes[0]=99;assert.deepEqual(await reader(request,new AbortController().signal),joined);
  assert.ok(progress.some(p=>p.completedObjects===1));
  const otherPin=createKeelHoldObjectReader(client,{cacheBlockHash:'0x'+'cd'.repeat(32),maxCacheBytes:10_000});
  await otherPin(request,new AbortController().signal);assert.equal(reads.get(address(2)),2);
  // Same object ID with another authenticated digest must never reuse stale bytes.
  // Parent's old digest rejects the changed child; no integrity fallback occurs.
  variant=true;
  const withoutRootCache=createKeelHoldObjectReader(client,{cacheBlockHash:pin,maxCacheBytes:1000});
  await assert.rejects(withoutRootCache(request,new AbortController().signal),/digest mismatch/);
});
test('cache storage/metadata is bounded and cancellation of one traversal cannot poison a later consumer',async()=>{
  const bytes=Uint8Array.of(7),controller=new AbortController();let readCount=0;
  const reader=createKeelHoldObjectReader({getObject:async()=>record(bytes),getObjectPartIds:async()=>[],getObjectSlugPointers:async()=>[address(7)],getCode:async()=>{readCount++;return Uint8Array.of(0,...bytes);}},{cacheBlockHash:pin,maxCacheBytes:0});
  controller.abort('caller-cancelled');await assert.rejects(reader(request,controller.signal),e=>e==='caller-cancelled');
  await reader(request,new AbortController().signal);await reader(request,new AbortController().signal);assert.equal(readCount,2);
  assert.throws(()=>createKeelHoldObjectReader({}, {cacheBlockHash:'latest'}),/pinned/);
  assert.throws(()=>createKeelHoldObjectReader({}, {maxDecodedBytes:10,maxCacheBytes:11}),/budget/);
});
test('one failed worker stops sibling dispatch while another traversal remains usable',async()=>{
  let release;const late=new Promise(r=>release=r),reads=[];
  const reader=createKeelHoldObjectReader({
    getObject:async r=>record(r.objectId===id(99)?Uint8Array.of(7):Uint8Array.of(1,1,1,1),false,r.objectId===id(99)?1:4),
    getObjectPartIds:async()=>[],getObjectSlugPointers:async r=>r.objectId===id(99)?[address(99)]:[address(1),address(2),address(3),address(4)],
    getCode:async r=>{reads.push(r.address);if(r.address===address(1))throw Error('first worker failed');if(r.address===address(2))return late;return Uint8Array.of(0,r.address===address(99)?7:1);},
  },{maxConcurrentReads:2,cacheBlockHash:pin});
  const failed=assert.rejects(reader(request,new AbortController().signal),/first worker failed/);
  const independent=reader({...request,objectId:id(99)},new AbortController().signal);
  await failed;assert.deepEqual(await independent,Uint8Array.of(7));
  release(Uint8Array.of(0,1));await new Promise(r=>setImmediate(r));
  assert.ok(!reads.includes(address(3))&&!reads.includes(address(4)));
});
