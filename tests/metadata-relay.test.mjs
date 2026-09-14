import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {prepareKeelMetadataDependency,keelMetadataConsumerAbi,runKeelMetadataRelayCycle} from '../packages/sdk/dist/metadata-relay.js';
const address='0x'+'11'.repeat(20), key=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture() {
 const sent=[],saved=[]; let uncertain=false;
 const ports={watches:async()=>[key(1)],followerCount:async()=>1n,followerAt:async()=>1n,
 subscription:async()=>({active:true,complete:true}),submit:async work=>{sent.push(work);return key(sent.length)},
 confirm:async()=>{if(uncertain)throw new Error('RPC uncertain');},save:async state=>{saved.push(structuredClone(state));}};
 return {ports,sent,saved,state:{cursors:{},pending:[]},setUncertain:value=>{uncertain=value}};
}
test('resolver discovery preserves sparse token and exact matrix block bounds',async()=>{
 const tx=await prepareKeelMetadataDependency({source:address,tokenId:7n,readDependency:async()=>[address,'0x12345678',0n,7n]});
 const decoded=decodeFunctionData({abi:keelMetadataConsumerAbi,data:tx.data});
 assert.deepEqual(decoded.args,[address,'0x12345678',100000,0n,7n]);
});
test('uncertain receipt resumes the same transaction hash',async()=>{
 const f=fixture();f.setUncertain(true);
 await assert.rejects(runKeelMetadataRelayCycle(f.ports,f.state),/uncertain/);
 assert.equal(f.sent.length,1);assert.equal(f.state.inFlight.hash,key(1));
 f.setUncertain(false);f.ports.watches=async()=>[];
 await runKeelMetadataRelayCycle(f.ports,f.state);assert.equal(f.sent.length,1);assert.equal(f.state.inFlight,undefined);
});
test('bounded cycles rotate across watches rather than starving later sources',async()=>{
 const f=fixture();f.ports.watches=async()=>Array.from({length:10},(_,n)=>key(n+1));
 for(let i=0;i<5;i++)await runKeelMetadataRelayCycle(f.ports,f.state,2);
 assert.equal(new Set(f.sent.filter(x=>x.kind==='sync').map(x=>x.watchId)).size,10);
});
test('bad dependency simulation does not stop healthy dependencies',async()=>{
 const f=fixture();f.ports.watches=async()=>[key(1),key(2)];
 f.ports.submit=async work=>{if(work.watchId===key(1))throw new Error('bad getter');f.sent.push(work);return key(10)};
 const result=await runKeelMetadataRelayCycle(f.ports,f.state,2);
 assert.equal(result.errors.length,1);assert.equal(f.sent[0].watchId,key(2));
});
test('confirmed revert clears in-flight state and allows later work',async()=>{
 const f=fixture();f.ports.confirm=async()=> 'reverted';
 const result=await runKeelMetadataRelayCycle(f.ports,f.state,2);
 assert.equal(result.errors.length,1);assert.equal(f.state.inFlight,undefined);
});
test('pinned dependencies do not accidentally follow latest revisions',async()=>{
 const {keelMetadataRevisionQuery}=await import('../packages/sdk/dist/metadata-relay.js');
 assert.equal(keelMetadataRevisionQuery({kind:'artifact',id:key(1),pinned:true}),undefined);
 assert.match(keelMetadataRevisionQuery({kind:'harness',id:key(1)}),/^0x[0-9a-f]{72}$/);
});
