import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {prepareKeelStamp,keelStampControllerAbi,keelStampRegistryAbi} from '../packages/sdk/dist/stamps.js';
const common={chainId:31337,registry:'0x'+'11'.repeat(20),saleId:1n,releaseId:1n,objectId:'0x'+'aa'.repeat(32),priceWei:0n,borderId:1,background:'0x112233',transferable:true,name:'Artist'};
test('direct and shared controller setup preserve the same source and style',()=>{
 for(const controllerAdapter of [undefined,'0x'+'22'.repeat(20)]) {
  const tx=prepareKeelStamp({...common,controllerAdapter});
  assert.equal(tx.value,0n);assert.equal(tx.status,'review-only');
  const decoded=decodeFunctionData({abi:controllerAdapter?keelStampControllerAbi:keelStampRegistryAbi,data:tx.data});
  assert.equal(decoded.functionName,'configureKeel');assert.equal(decoded.args.at(-1),common.objectId);
 }
});
test('bad IDs, fees and source values are rejected before a wallet call',()=>{
 for(const patch of [{saleId:0n},{saleId:1n<<64n},{releaseId:0n},{priceWei:-1n},{objectId:'0x'+'00'.repeat(32)},{borderId:0},{background:'blue'},{name:'bad"name'}])
  assert.throws(()=>prepareKeelStamp({...common,...patch}));
});
