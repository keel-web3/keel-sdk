import test from 'node:test';
import assert from 'node:assert/strict';
import { packHarnessChildren, unpackHarnessChildren, resolveHarnessTree, decodeHarnessTreeMetadata, decodeHarnessTreeControl, planHarnessTree, packHarnessBuildNode } from '../packages/sdk/dist/harness-tree.js';
const object = n => ({objectId:`0x${BigInt(n).toString(16).padStart(64,'0')}`, revision:1n});
const leaf = ids => ({metadata:0n,children:[],objects:ids.map(object)});
const branch = (refs, count, depth=2) => ({metadata:BigInt(refs.length)|(BigInt(depth)<<8n)|(BigInt(count)<<16n), children:packHarnessChildren(refs),objects:[]});

test('four children per word preserve every boundary and uint32 maximum', () => {
  for (const count of [1,2,3,4,5,127,128]) {
    const refs = Array.from({length:count},(_,i)=>({key:i+1,revision:0xffffffff-i}));
    const words = packHarnessChildren(refs);
    assert.equal(words.length,Math.ceil(count/4));
    assert.deepEqual(unpackHarnessChildren(count,words),refs);
  }
  assert.throws(()=>packHarnessChildren([{key:1,revision:2**32}]));
  assert.throws(()=>packHarnessChildren([{key:0,revision:1}]));
  assert.throws(()=>unpackHarnessChildren(1,[packHarnessChildren([{key:1,revision:1}])[0]|1n<<64n]));
  assert.throws(()=>unpackHarnessChildren(5,[1n]));
  assert.throws(()=>decodeHarnessTreeMetadata(1n<<80n));
});

test('iterative traversal keeps order, pins revisions, and fetches shared children once', async () => {
  const refs = [{key:1,revision:2},{key:2,revision:1},{key:1,revision:2}];
  const calls=[];
  const out = await resolveHarnessTree(branch(refs,6,3),async ref=>{
    calls.push(ref);
    if(ref.key===2) return branch([{key:3,revision:1}],2);
    return ref.key===1 ? leaf([1,2]) : leaf([3,4]);
  });
  assert.deepEqual(out.map(o=>o.objectId),[1,2,3,4,1,2].map(n=>object(n).objectId));
  assert.deepEqual(calls,[refs[0],refs[1],{key:3,revision:1}]);
});

test('thousand objects resolve with eight leaf reads', async()=>{
  const refs=Array.from({length:8},(_,i)=>({key:i+1,revision:1}));let calls=0;
  const out=await resolveHarnessTree(branch(refs,1000),async({key})=>{calls++;return leaf(Array.from({length:125},(_,i)=>(key-1)*125+i+1));});
  assert.equal(out.length,1000);assert.equal(calls,8);assert.equal(out.at(-1).objectId,object(1000).objectId);
});

test('malicious nodes, cycles and resource exhaustion fail closed', async()=>{
  const refs=[{key:1,revision:1}], root=branch(refs,1,3);
  await assert.rejects(resolveHarnessTree(root,async()=>branch(refs,1)),/Cyclic/);
  await assert.rejects(resolveHarnessTree(branch(refs,2),async()=>leaf([1])),/counts/);
  await assert.rejects(resolveHarnessTree(branch(refs,1,3),async()=>leaf([1])),/counts/);
  await assert.rejects(resolveHarnessTree(branch(refs,2),async()=>leaf([1,2]),{maxObjects:1}),/bounds/);
  await assert.rejects(resolveHarnessTree(branch([{key:1,revision:1},{key:2,revision:1}],2),async()=>leaf([1]),{maxNodeReads:1}),/read budget/);
  await assert.rejects(resolveHarnessTree(branch(refs,1),async()=>leaf([1]),{maxVisits:1}),/visit budget/);
  await assert.rejects(resolveHarnessTree(branch(refs,1),async()=>leaf([1]),{maxDepth:1}),/bounds/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(resolveHarnessTree(branch(refs,1),async()=>leaf([1]),{signal:controller.signal}));
});

test('build plans reuse unchanged nodes and schedule only changed ancestors',()=>{
  const objects=Array.from({length:1000},(_,i)=>object(i+1));
  const first=planHarnessTree(objects);
  assert.equal(first.root.objectCount,1000);
  assert.equal(first.writes.length,33);
  const published=first.writes.map((node,i)=>({fingerprint:node.fingerprint,key:i+1,revision:1}));
  assert.equal(planHarnessTree(objects,{published}).writes.length,0);
  const changed=[...objects];changed[2]={...changed[2],revision:2n};
  const update=planHarnessTree(changed,{published});
  assert.equal(update.writes.length,2);
  assert.equal(update.writes[0].kind,'leaf');assert.equal(update.writes[1].kind,'branch');
  const receipt=new Map([[update.writes[0].fingerprint,{key:1,revision:2}]]);
  assert.equal(packHarnessBuildNode(update.root,receipt).length,8);
  assert.throws(()=>packHarnessBuildNode(update.root,new Map()),/not been published/);
  assert.throws(()=>planHarnessTree(objects,{fanout:1}));
  assert.throws(()=>planHarnessTree(objects,{maxObjects:999}));
  assert.throws(()=>planHarnessTree(objects,{maxDepth:1}));
});

test('control decoding preserves the complete counter, depth and object bounds', () => {
  const count=(1n<<64n)-1n;
  assert.deepEqual(decodeHarnessTreeControl(0xffffffffn|(255n<<32n)|(count<<40n)),{nextKey:0xffffffff,maxDepth:255,maxObjects:count});
  assert.equal(decodeHarnessTreeControl((16n<<32n)|(1000000n<<40n)).nextKey,0);
  assert.throws(()=>decodeHarnessTreeControl(1n<<104n));
});

test('leaf update plans reuse IDs, preserve ordering, and respect packed source bounds', async () => {
  const {planHarnessLeafUpdate, HARNESS_SLOT_SOURCE_MAX} = await import('../packages/sdk/dist/harness-tree.js');
  const input={harnessId:object(77).objectId,expectedParent:1n,slotSourceRevision:0n,currentObjectIds:[object(1).objectId,object(2).objectId],objects:[{...object(1),revision:2n},object(2)],manifestDigest:object(9).objectId,seedSetDigest:object(10).objectId};
  const reuse=planHarnessLeafUpdate(input);
  assert.equal(reuse.functionName,'appendHarnessSelections');
  assert.deepEqual(planHarnessLeafUpdate({...input,slotSourceRevision:0}),reuse);
  assert.equal(planHarnessLeafUpdate({...input,expectedParent:HARNESS_SLOT_SOURCE_MAX+1n,slotSourceRevision:0}).functionName,'appendHarnessRevision');
  assert.equal(planHarnessLeafUpdate({...input,expectedParent:HARNESS_SLOT_SOURCE_MAX+1n,slotSourceRevision:Number(HARNESS_SLOT_SOURCE_MAX)}).functionName,'appendHarnessSelections');
  assert.throws(()=>planHarnessLeafUpdate({...input,slotSourceRevision:0.5}),RangeError);
  assert.deepEqual(reuse.args,[input.harnessId,1n,[2n,1n],input.manifestDigest,input.seedSetDigest]);
  assert.equal(planHarnessLeafUpdate({...input,objects:[object(2),object(1)]}).functionName,'appendHarnessRevision');
  assert.equal(planHarnessLeafUpdate({...input,objects:[object(1)]}).functionName,'appendHarnessRevision');
  assert.equal(planHarnessLeafUpdate({...input,currentObjectIds:[]}).functionName,'appendHarnessRevision');
  assert.equal(planHarnessLeafUpdate({...input,expectedParent:HARNESS_SLOT_SOURCE_MAX}).functionName,'appendHarnessSelections');
  assert.equal(planHarnessLeafUpdate({...input,expectedParent:HARNESS_SLOT_SOURCE_MAX+1n}).functionName,'appendHarnessRevision');
  assert.equal(planHarnessLeafUpdate({...input,expectedParent:HARNESS_SLOT_SOURCE_MAX+1n,slotSourceRevision:1n}).functionName,'appendHarnessSelections');
  for (const changes of [{expectedParent:0n},{expectedParent:(1n<<64n)-1n},{slotSourceRevision:2n},{slotSourceRevision:HARNESS_SLOT_SOURCE_MAX+1n},{objects:[]},{objects:Array(129).fill(object(1))},{objects:[object(0)]},{objects:[{...object(1),revision:0n}]},{objects:[{...object(1),revision:1n<<64n}]},{manifestDigest:object(0).objectId}]) assert.throws(()=>planHarnessLeafUpdate({...input,...changes}),RangeError);
});

test('key batch plans deduplicate in order, split at 128 and never invent key numbers', async () => {
  const {planHarnessKeyBatches}=await import('../packages/sdk/dist/harness-tree.js');
  assert.deepEqual(planHarnessKeyBatches([]),[]);
  const ids=Array.from({length:257},(_,i)=>object(i+1).objectId);
  const calls=planHarnessKeyBatches([...ids,ids[0],ids[128],ids[256]]);
  assert.deepEqual(calls.map(c=>c.functionName),Array(3).fill('registerHarnessKeys'));
  assert.deepEqual(calls.map(c=>c.args[0].length),[128,128,1]);
  assert.deepEqual(calls.flatMap(c=>c.args[0]),ids);
  assert.throws(()=>planHarnessKeyBatches([object(0).objectId]),RangeError);
  assert.throws(()=>planHarnessKeyBatches(['0x12']),RangeError);
});

test('the measured default stays explicit and custom group sizes remain available', async () => {
  const {DEFAULT_HARNESS_FANOUT} = await import('../packages/sdk/dist/harness-tree.js');
  assert.equal(DEFAULT_HARNESS_FANOUT,32);
  const objects=Array.from({length:1000},(_,i)=>object(i+1));
  for(const fanout of [8,16,32,64,128]) {
    const plan=planHarnessTree(objects,{fanout});
    assert.equal(plan.root.objectCount,1000);
    for(const node of plan.writes) assert.ok((node.kind==='leaf'?node.objects.length:node.children.length)<=fanout);
  }
});
