import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,decodeEventLog} from 'viem';
import {ABIS} from '../packages/sdk/src/abis/keel-stake.generated.ts';
const abi=ABIS.KeelStakeObjectManager;
test('stake object exposes frozen state and explicit admission controls',()=>{
 const get=abi.find(x=>x.type==='function'&&x.name==='stakeObject');
 assert.deepEqual(get.outputs[0].components.slice(-3).map(x=>[x.name,x.type]),[['enabled','bool'],['exists','bool'],['frozen','bool']]);
 for(const name of ['freezeStakeObject','setStakeObjectEnabled'])assert.ok(abi.some(x=>x.type==='function'&&x.name===name));
 assert.ok(abi.some(x=>x.type==='error'&&x.name==='ConfigurationFrozen'));
});
test('all shared stake events decode named fields without losing indexed values',()=>{
 for(const event of abi.filter(x=>x.type==='event')){
  const args=Object.fromEntries(event.inputs.map((x,i)=>[x.name,x.type==='bool'?true:x.type==='address'?'0x'+(i+10).toString(16).padStart(40,'0'):x.type==='bytes32'?'0x'+(i+10).toString(16).padStart(64,'0'):x.type==='uint256'?BigInt(i+10):i+10]));
  const topics=encodeEventTopics({abi,eventName:event.name,args});
  const plain=event.inputs.filter(x=>!x.indexed);
  const data=encodeAbiParameters(plain,plain.map(x=>args[x.name]));
  const decoded=decodeEventLog({abi,topics,data,strict:true});
  assert.equal(decoded.eventName,event.name);
  for(const [key,value] of Object.entries(args))assert.equal(String(decoded.args[key]).toLowerCase(),String(value).toLowerCase(),event.name+'.'+key);
 }
});
test('stake receipt field order follows the shared schema',()=>{
 const event=abi.find(x=>x.type==='event'&&x.name==='StakeRecorded');
 assert.deepEqual(event.inputs.map(x=>x.name),['stakeObjectId','runtimeDigest','staker','hostCollection','stakedCollection','tokenId','hostTokenId','tokenActive','objectActive','globalActive','tokenLifetime','objectLifetime','globalLifetime','objectTokenLifetime']);
 assert.deepEqual(event.inputs.filter(x=>x.indexed).map(x=>x.name),['stakeObjectId','stakedCollection','tokenId']);
});
