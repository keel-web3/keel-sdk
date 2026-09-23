import nodeTest from 'node:test';
import { siblingTest } from "./sibling-repository.mjs";
const test = siblingTest(nodeTest, "keel-contracts");
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeFunctionData,encodeFunctionResult} from 'viem';
import {buildKeelSeedAction,readKeelSeedStatus} from '../packages/sdk/dist/mint-seed-lifecycle.js';
const collection='0x1111111111111111111111111111111111111111',adapter='0x2222222222222222222222222222222222222222';
const account='0x3333333333333333333333333333333333333333',archive='0x4444444444444444444444444444444444444444';
const hash=`0x${'ab'.repeat(32)}`,zero=`0x${'00'.repeat(32)}`;
const snapshot={chainId:31337,blockNumber:100n,blockHash:hash};
const abi=name=>JSON.parse(readFileSync(new URL(`../../keel-contracts/modules/keel-die/abi/${name}.json`,import.meta.url)));
const tokenAbi=abi('KeelCreatorSeeded721A'),vrfAbi=abi('KeelSeedVrfAdapter'),archiveAbi=abi('KeelSeedBlockArchive');
function fixture(overrides={}) {
 const responses={seedBatchId:0n,seedProfile:[true,true,0,0,adapter,1,1],seedDraws:1n<<65n,requests:0n,
  deliveries:[collection,0,false,false,zero],prepaid:true,claims:2n,claimPriceWei:7n,owner:account,
  access:1n,blockArchive:archive,hashOf:hash,tokenSeed:hash,...overrides};
 const calls=[];
 const call=async req=>{
  assert.equal(req.blockHash,snapshot.blockHash);assert.equal(req.blockNumber,snapshot.blockNumber);assert.equal(req.chainId,31337);
  calls.push(req);const a=req.to===collection?tokenAbi:req.to===adapter?vrfAbi:archiveAbi;
  const {functionName,args}=decodeFunctionData({abi:a,data:req.data});
  const value=typeof responses[functionName]==='function'?responses[functionName](args):responses[functionName];
  if(value instanceof Error)throw value;
  assert.notEqual(value,undefined,functionName);
  return encodeFunctionResult({abi:a,functionName,result:value});
 };
 return {calls,read:()=>readKeelSeedStatus({collection,tokenId:'1',account,snapshot},call),call};
}
test('all unsigned actions round trip against compiled contract ABIs',async()=>{
 const cases=[
  [{kind:'buy-credits',adapter,quantity:'3',priceWei:'7'},'buyClaims',[3n,7n],21n],
  [{kind:'request',adapter,collection,batchId:'0'},'request',[collection,0n],0n],
  [{kind:'reveal',collection,batchId:'0'},'revealSeedBatch',[0n],0n],
  [{kind:'deliver',adapter,requestId:'1'},'deliver',[1n],0n],
 ];
 for(const [action,functionName,args,value] of cases){
  const plan=await buildKeelSeedAction({chainId:31337,from:account,action});
  assert.equal(plan.status,'review-only');assert.equal(plan.from,account);assert.equal(plan.chainId,31337);
  assert.equal(plan.signing,'not-performed');assert.equal(plan.submission,'not-performed');
  assert.equal(BigInt(plan.call.value),value);assert.equal(plan.call.to,action.kind==='reveal'?collection:adapter);
  assert.deepEqual(decodeFunctionData({abi:action.kind==='reveal'?tokenAbi:vrfAbi,data:plan.call.data}),{functionName,args});
  assert.doesNotThrow(()=>JSON.stringify(plan));assert.ok(Object.isFrozen(plan.call));
 }
});
test('funding arithmetic, identifiers and malformed JS inputs fail before review',async()=>{
 const invalid=[{kind:'buy-credits',adapter,quantity:'0',priceWei:'1'},
  {kind:'buy-credits',adapter,quantity:'2',priceWei:((1n<<256n)-1n).toString()},
  {kind:'buy-credits',adapter,quantity:'01',priceWei:'1'},
  {kind:'request',adapter,collection,batchId:(1n<<32n)-2n},
  {kind:'request',adapter,collection,batchId:1},
  {kind:'deliver',adapter,requestId:'0'}, {kind:'deliver',adapter,requestId:(1n<<256n)-1n},
  {kind:'reroll',adapter},{kind:'reveal',collection:'0x'+'0'.repeat(40),batchId:'0'}];
 for(const action of invalid)await assert.rejects(()=>buildKeelSeedAction({chainId:31337,from:account,action}));
 await assert.rejects(()=>buildKeelSeedAction({chainId:0,from:account,action:{kind:'reveal',collection,batchId:'0'}}));
});
test('credit eligibility uses the caller balance and collection access bit',async()=>{
 assert.equal((await fixture().read()).requestEligibility,'eligible');
 assert.equal((await fixture({claims:0n}).read()).requestEligibility,'needs-credits');
 assert.equal((await fixture({access:2n}).read()).requestEligibility,'collection-disabled');
 const status=await fixture({claims:9007199254740993n}).read();assert.equal(status.credits,'9007199254740993');
 assert.equal(status.creditPriceWei,'7');assert.equal(status.funding,'personal-credits');
});
test('creator subscription requires owner or request-operator bit without buying credits',async()=>{
 const owner=await fixture({prepaid:false}).read();assert.equal(owner.requestEligibility,'eligible');assert.equal(owner.credits,undefined);
 const flags=args=>args[0]===collection?1n:2n;
 assert.equal((await fixture({prepaid:false,owner:archive,access:flags}).read()).requestEligibility,'eligible');
 assert.equal((await fixture({prepaid:false,owner:archive,access:1n}).read()).requestEligibility,'not-authorized');
});
test('existing requests wait or reveal; zero VRF word is a valid ready result',async()=>{
 const waiting=fixture({requests:9n});assert.equal((await waiting.read()).phase,'waiting-vrf');
 const ready=await fixture({requests:9n,deliveries:[collection,0,true,false,zero]}).read();
 assert.equal(ready.phase,'ready-to-reveal');assert.equal(ready.requestId,'9');
 // Never suggest buying another credit while an existing request is pending.
 assert.equal(ready.requestEligibility,undefined);assert.equal(ready.credits,undefined);
 const revealed=fixture({seedDraws:(1n<<65n)|(1n<<64n),tokenSeed:zero});
 assert.equal((await revealed.read()).seed,zero);assert.equal(revealed.calls.length,4);
});
test('future blocks distinguish not-yet-mined, recoverable missing history and ready',async()=>{
 const seedProfile=[false,false,1,0,'0x'+'0'.repeat(40),1,1];
 const waiting=await fixture({seedProfile,seedDraws:99n}).read();assert.equal(waiting.phase,'waiting-blocks');assert.equal(waiting.revealAfterBlock,'100');
 const ready=await fixture({seedProfile,seedDraws:98n}).read();assert.equal(ready.phase,'ready-to-reveal');assert.equal(ready.pendingTransfers,'allowed');
 assert.equal((await fixture({seedProfile,seedDraws:98n,hashOf:args=>args[0]===98n?zero:hash}).read()).phase,'history-required');
 const immediate=await fixture({seedProfile:[false,true,0,0,'0x'+'0'.repeat(40),1,1],seedDraws:0n}).read();
 assert.equal(immediate.phase,'revealed');assert.equal(immediate.entropy,'immediate');
});
test('wrong request bindings, impossible draw states and RPC errors never become waiting',async()=>{
 for(const overrides of [{requests:1n,deliveries:[archive,0,false,false,zero]},
  {requests:1n,deliveries:[collection,1,false,false,zero]},
  {requests:1n,deliveries:[collection,0,true,true,zero]},
  {requests:(1n<<256n)-1n},{seedDraws:0n},{seedDraws:(1n<<65n)|1n},
  {seedBatchId:new Error('missing token')},{claims:new Error('RPC failed')}]) await assert.rejects(()=>fixture(overrides).read());
});
test('snapshot and exact token identifiers are required before reading',async()=>{
 const call=async()=>{throw Error('must not call');};
 for(const invalid of [{...snapshot,chainId:-1},{...snapshot,blockNumber:100},{...snapshot,blockHash:zero}]){
  await assert.rejects(()=>readKeelSeedStatus({collection,account,tokenId:'1',snapshot:invalid},call),e=>e.message!=='must not call');
 }
 await assert.rejects(()=>readKeelSeedStatus({collection,account,tokenId:Number.MAX_SAFE_INTEGER+1,snapshot},call),e=>e.message!=='must not call');
});
