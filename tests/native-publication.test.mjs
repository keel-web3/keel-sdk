import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeelNativeObjectPlan, createKeelChunkPlan } from '../packages/sdk/dist/native-publication.js';
import { keccak256 } from 'viem';
const opts={objectName:'original',mediaType:'application/octet-stream',keccak256};
test('canonical KEEL chunks preserve raw binary and are resumable from exact chain bytes',async()=>{
 const raw=Uint8Array.from({length:69017},(_,i)=>i%251), canonical=await createKeelChunkPlan(raw,opts);
 const first=await createKeelNativeObjectPlan(raw,opts);assert.equal(first.carrierBatches.length,2);assert.equal(first.carrierBatches[0].length,3);
 assert.deepEqual(first.slugIds,canonical.chunks.map(x=>x.slugId));assert.equal(first.compression,0);assert.equal(first.storageMode,'keel-hold');
 const uploaded=new Map(first.slugIds.slice(0,2).map((id,i)=>[id,first.chunks[i]]));
 const resumed=await createKeelNativeObjectPlan(raw,{...opts,readSlug:async id=>uploaded.get(id)??null});
 assert.equal(resumed.chunks.length,2);assert.equal(resumed.reusedBytes,46000);assert.equal(resumed.storedBytes,23017);
 assert.deepEqual(resumed.slugIds,first.slugIds);assert.equal(resumed.digest,first.digest);
});
test('SDK refuses failed or forged reuse evidence',async()=>{
 await assert.rejects(createKeelNativeObjectPlan(new Uint8Array([0,255,1]),{...opts,readSlug:async()=>new Uint8Array([0,254,1])}),/differs/);
 await assert.rejects(createKeelNativeObjectPlan(new Uint8Array([1]),{...opts,readSlug:async()=>{throw Error('RPC unavailable')}}),/RPC unavailable/);
});
test('deduplicates repeated chunks and snapshots source bytes before asynchronous work',async()=>{
 const raw=new Uint8Array(46000).fill(13),pending=createKeelNativeObjectPlan(raw,opts);raw.fill(0);
 const plan=await pending;assert.equal(plan.chunks.length,1);assert.equal(plan.chunks[0][0],13);assert.equal(plan.slugIds[0],plan.slugIds[1]);
});
test('bounded concurrent reads cannot reorder upload payloads',async()=>{
 const raw=Uint8Array.from({length:23000*10},(_,i)=>i%251);let active=0,max=0;
 const plan=await createKeelNativeObjectPlan(raw,{...opts,readSlug:async id=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,Number(BigInt(id)%7n)));active--;return null}});
 assert(max<=8);assert.deepEqual(plan.chunks.map(keccak256),plan.slugIds);
});
