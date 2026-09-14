import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readBitcoinAttachment,submitBitcoinAttachment} from '../packages/sdk/dist/bitcoin-proof.js';
const hex=n=>'0x'+n.repeat(64),adapter='0x'+'11'.repeat(20),anchorId=hex('a');
test('wrong RPC network is rejected before reading an attachment',async()=>{
 let reads=0;await assert.rejects(readBitcoinAttachment({publicClient:{getChainId:async()=>1,readContract:async()=>{reads++;}},expectedChainId:31337,adapter,anchorId}),/Wrong network/);assert.equal(reads,0);
});
test('all authoritative attachment reads use one block snapshot',async()=>{
 const calls=[];const reader={getChainId:async()=>31337,getBlock:async()=>({number:42n,timestamp:1000n}),readContract:async args=>{calls.push(args);switch(args.functionName){case 'anchorRegistry':case 'proofController':return adapter;case 'proofProfileId':return hex('b');case 'receipts':return [10,999n,1n,hex('c'),hex('d'),hex('e'),hex('f')];case 'sourceStatus':return 3;case 'isAdmitted':return false;case 'anchorState':return {objectId:hex('1'),artifactRevision:2n,status:2};}}};
 const result=await readBitcoinAttachment({publicClient:reader,expectedChainId:31337,adapter,anchorId});assert.equal(result.recordedAcceptance,true);assert.equal(result.profileAdmitted,false);assert.equal(result.sourceStatus,3);assert.equal(calls.length,7);assert.ok(calls.every(c=>c.blockNumber===42n));
});
test('wrong wallet network cannot reach signing',async()=>{
 let signed=false;await assert.rejects(submitBitcoinAttachment({publicClient:{getChainId:async()=>31337},walletClient:{getChainId:async()=>1,sendTransaction:async()=>{signed=true;}},expectedChainId:31337,adapter,anchorId}),/wrong network/);assert.equal(signed,false);
});
