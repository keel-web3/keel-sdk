import test from 'node:test';
import assert from 'node:assert/strict';
import {zeroAddress,zeroHash} from 'viem';
import {processMintAccessEntropy} from '../tools/keel/lib/mint-access-entropy.mjs';
const consumer='0x0000000000000000000000000000000000000001',source='0x0000000000000000000000000000000000000002',provider='0x0000000000000000000000000000000000000003',archive='0x0000000000000000000000000000000000000004';
function fixture(future=false){
 const state={request:0n,delivery:[consumer,7n,true,false,false,zeroHash],pending:true,allowed:true,writes:[],fail:false,providerRequest:0n,ready:false,block:100n,hash:zeroHash};
 const client={async getBlockNumber(){return state.block;},async readContract(c){
  if(c.functionName==='allowed')return state.allowed;
  if(c.functionName==='requested')return state.request;
  if(c.functionName==='draws')return [consumer,1,state.pending];
  if(c.functionName==='deliveries'){const delivery=[...state.delivery];if(!future)delivery[3]=state.ready;return delivery;}
  if(c.functionName==='seedProvider')return future?zeroAddress:provider;
  if(c.functionName==='blockArchive')return archive;
  if(c.functionName==='hashOf')return state.hash;
  if(c.functionName==='requests')return state.providerRequest;
  if(c.functionName==='batchEntropy')return [state.ready,zeroHash];
  throw new Error('unexpected read '+c.functionName);
 }};
 const transact=async(address,abi,name,args)=>{
  state.writes.push({address,name,args});if(state.fail)throw new Error('receiver failed');
  if(name==='request'&&address===source)state.request=future?(102n<<32n)|1n:1n;
  if(name==='request'&&address===provider)state.providerRequest=123n;
  if(name==='fulfill')state.delivery[3]=true;
  if(name==='deliver')state.delivery[4]=true;
 };
 return {state,run:()=>processMintAccessEntropy({client,source,consumer,id:'7',reward:true,transact})};
}
test('reward entropy uses the existing seed provider and accepts a zero word',async()=>{
 const f=fixture();assert.equal((await f.run()).status,'requested');assert.deepEqual(f.state.writes[0].args,[consumer,7n,true]);
 assert.equal((await f.run()).status,'seed-requested');assert.equal(f.state.writes[1].address,provider);assert.deepEqual(f.state.writes[1].args,[source,1n]);
 assert.equal((await f.run()).status,'awaiting-randomness');assert.equal(f.state.writes.length,2);
 f.state.ready=true;assert.equal((await f.run()).done,true);
 assert.equal((await f.run()).status,'delivered');assert.equal(f.state.writes.length,3);
});
test('a failed receiver retries the same request without rerolling or spending credits',async()=>{
 const f=fixture();f.state.request=123n;f.state.delivery[3]=true;f.state.ready=true;f.state.fail=true;
 await assert.rejects(f.run(),/receiver failed/);assert.equal(f.state.delivery[4],false);
 f.state.fail=false;await f.run();assert.deepEqual(f.state.writes.map(w=>[w.name,w.args]),[['deliver',[123n]],['deliver',[123n]]]);
});
test('mismatched records fail closed and completed draws never request entropy',async()=>{
 const f=fixture();f.state.pending=false;assert.equal((await f.run()).status,'no-pending-draw');assert.equal(f.state.writes.length,0);
 f.state.request=123n;f.state.delivery[2]=false;await assert.rejects(f.run(),/binding mismatch/);assert.equal(f.state.writes.length,0);
});
test('future blocks use the fixed target and await archive recovery rather than reroll',async()=>{
 const f=fixture(true);await f.run();assert.equal((await f.run()).status,'awaiting-blocks');
 f.state.block=1000n;const missing=await f.run();assert.equal(missing.status,'awaiting-block-proof');assert.equal(missing.target,102n);assert.equal(f.state.writes.length,1);
 f.state.hash='0x'+'11'.repeat(32);assert.equal((await f.run()).status,'delivered');assert.equal((await f.run()).status,'delivered');
 assert.deepEqual(f.state.writes.map(w=>w.name),['request','deliver']);
 assert.ok(f.state.writes.every(w=>w.address===source));
});
test('failed seed funding retries the same program request before resolution',async()=>{
 const f=fixture();await f.run();f.state.fail=true;await assert.rejects(f.run());f.state.fail=false;await f.run();
 assert.deepEqual(f.state.writes.slice(1).map(w=>[w.address,w.args]),[[provider,[source,1n]],[provider,[source,1n]]]);
});

test('revocation blocks new commitments but allows delivery of an existing seed',async()=>{
 const f=fixture();f.state.allowed=false;assert.equal((await f.run()).status,'awaiting-authorization');assert.equal(f.state.writes.length,0);
 f.state.request=1n;f.state.ready=true;assert.equal((await f.run()).status,'delivered');assert.deepEqual(f.state.writes.map(w=>w.name),['deliver']);
});
