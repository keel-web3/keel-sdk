import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeFunctionData,encodeAbiParameters,encodeEventTopics,decodeEventLog,toFunctionSelector} from 'viem';
import {keelPreparedOwnershipAbi,buildKeelPreparedOwnershipSetupCall} from '../packages/sdk/dist/selected-token-ids.js';
const collection='0x1111111111111111111111111111111111111111';
test('prepared ownership setup is exactly one owner-authorized call with no signing',()=>{
 const call=buildKeelPreparedOwnershipSetupCall(collection);
 assert.equal(call.to,collection);assert.equal(call.value,'0');assert.equal(decodeFunctionData({abi:keelPreparedOwnershipAbi,data:call.data}).functionName,'enablePreparedOwnership');
 assert.equal(call.authority,'owner-or-lifecycle-manager');assert.equal(call.capability,'requires-selected-chain-readback');
 assert.equal(call.signing,'not-performed');assert.equal(call.submission,'not-performed');assert.ok(Object.isFrozen(call));
 assert.throws(()=>buildKeelPreparedOwnershipSetupCall('not-an-address'));
});
test('prepared ownership receipt preserves the finite bound',()=>{
 const topics=encodeEventTopics({abi:keelPreparedOwnershipAbi,eventName:'PreparedOwnershipEnabled'});
 const event=decodeEventLog({abi:keelPreparedOwnershipAbi,topics,data:encodeAbiParameters([{type:'uint256'}],[256n])});
 assert.equal(event.eventName,'PreparedOwnershipEnabled');assert.equal(event.args.maxSupply,256n);
});
test('prepared ownership wire selectors and event match the compiled KEEL ABI',()=>{
 const abi=JSON.parse(fs.readFileSync(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreator721.json',import.meta.url)));
 for(const name of ['enablePreparedOwnership','preparedOwnership'])assert.equal(toFunctionSelector(keelPreparedOwnershipAbi.find(x=>x.type==='function'&&x.name===name)),toFunctionSelector(abi.find(x=>x.type==='function'&&x.name===name)));
 for(const name of ['OwnershipPreparationLocked','PreparedOwnershipEnabled']){const select=x=>({type:x.type,name:x.name,inputs:x.inputs.map(i=>({name:i.name,type:i.type,indexed:!!i.indexed}))});assert.deepEqual(select(keelPreparedOwnershipAbi.find(x=>x.name===name)),select(abi.find(x=>x.name===name)));}
});
