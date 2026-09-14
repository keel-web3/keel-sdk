import test from 'node:test';
import assert from 'node:assert/strict';
import {zeroAddress} from 'viem';
import {rewardCapabilities} from '../tools/keel/lib/reward-capabilities.mjs';
const claims='0x0000000000000000000000000000000000000001',receiver='0x0000000000000000000000000000000000000002';
function fixture(binding=claims){
 const calls=[];
 return {calls,client:{getCode:async args=>{calls.push(args);return '0x6000';},readContract:async args=>{
  calls.push(args);if(args.functionName==='rewardClaims'){if(binding===null)throw new Error('no getter');return binding;}
  if(args.functionName==='owner')return claims;
  if(args.functionName==='unlocked')return false;
  throw new Error('unknown token');
 }}};
}
const base={plan:{claims,pool:[1],terms:{source:zeroAddress,gate:0}},benefits:[[receiver,7n,1]],entropySource:zeroAddress,blockNumber:25n};
test('capability evidence pins all reads and distinguishes a binding from redemption proof',async()=>{
 const f=fixture(),r=await rewardCapabilities(f.client,base);
 assert.equal(r.receivers[0].authorization,'bound');assert.match(r.receivers[0].redemption,/Not exercised/);
 assert.ok(f.calls.every(c=>c.blockNumber===25n));assert.equal(r.entropy.status,'disabled');
});
test('known wrong receiver authority rejects while absent introspection remains explicitly unknown',async()=>{
 await assert.rejects(rewardCapabilities(fixture(receiver).client,base),/another claims/);
 const r=await rewardCapabilities(fixture(null).client,base);assert.equal(r.receivers[0].authorization,'unknown');
});
test('eligibility probes distinguish false eligibility from broken collection calls',async()=>{
 const achievement={...base,plan:{...base.plan,terms:{source:receiver,gate:4,achievement:1}}};
 const f=fixture(),unverified=await rewardCapabilities(f.client,achievement);
 assert.equal(unverified.eligibility.status,'unverified');assert.equal(unverified.eligibility.interface,'read');
 assert.deepEqual(f.calls.find(c=>c.functionName==='unlocked').args,[zeroAddress,1]);
 const player='0x0000000000000000000000000000000000000003',p=fixture();
 const verified=await rewardCapabilities(p.client,{...achievement,probeAccount:player});
 assert.equal(verified.eligibility.status,'read');assert.equal(verified.eligibility.value,false);assert.equal(verified.eligibility.account,player);
 assert.deepEqual(p.calls.find(c=>c.functionName==='unlocked').args,[player,1]);
 assert.match(verified.eligibility.scope,/limits and redemption are not exercised/);
 await assert.rejects(rewardCapabilities(fixture().client,{...achievement,probeAccount:'not-an-address'}));
 const token={...base,plan:{...base.plan,terms:{source:receiver,gate:3}}};
 assert.equal((await rewardCapabilities(fixture().client,token)).eligibility.status,'unverified');
 await assert.rejects(rewardCapabilities(fixture().client,{...token,probeTokenId:'1'}),/ownership probe failed/);
});
test('achievement probes preserve an unlocked player result and reject an unreadable registry',async()=>{
 const input={...base,probeAccount:receiver,plan:{...base.plan,terms:{source:receiver,gate:4,achievement:8}}};
 const f=fixture(),read=f.client.readContract;
 f.client.readContract=async args=>args.functionName==='unlocked'?true:read(args);
 const result=await rewardCapabilities(f.client,input);
 assert.equal(result.eligibility.value,true);assert.equal(result.eligibility.account,receiver);
 f.client.readContract=async args=>{if(args.functionName==='unlocked')throw new Error('registry unavailable');return read(args);};
 await assert.rejects(rewardCapabilities(f.client,input),/Achievement interface probe failed/);
});
