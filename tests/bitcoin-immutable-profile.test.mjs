import test from 'node:test';
import assert from 'node:assert/strict';
import {readBitcoinAttachment} from '../packages/sdk/dist/bitcoin-proof.js';
const zero='0x'+'00'.repeat(20),address='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
test('immutable readback never calls a governance contract',async()=>{
 for(const locked of [true,false]) {
  const calls=[];
  const publicClient={getChainId:async()=>31337,getBlock:async()=>({number:1n,timestamp:1n}),readContract:async({functionName})=>{
   calls.push(functionName);
   switch(functionName){
    case 'anchorRegistry':return address;
    case 'proofController':return zero;
    case 'proofProfileId':return hash;
    case 'receipts':return [1,1n,1n,hash,hash,hash,hash];
    case 'sourceStatus':return 1;
    case 'configLocked':return locked;
    case 'anchorState':return {objectId:hash,objectRevision:1n};
    default:throw new Error('Unexpected authority lookup');
   }
  }};
  const receipt=await readBitcoinAttachment({publicClient,expectedChainId:31337,adapter:address,anchorId:hash});
  assert.equal(receipt.admissionMode,'immutable');assert.equal(receipt.profileAdmitted,locked);
  assert.equal(receipt.recordedAcceptance,true);assert.equal(calls.includes('isAdmitted'),false);
 }
});
