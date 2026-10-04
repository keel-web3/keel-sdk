import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAbi} from 'viem';
import {keelEquipmentInventoryAbi,keelDirectReadPolicy,isKeelDirectReadAllowed} from '../packages/sdk/dist/index.js';
test('equipment read policy exposes only real read-only ABI functions',()=>{
 const abi=parseAbi(keelEquipmentInventoryAbi);
 for(const name of keelDirectReadPolicy['keel-equipment-inventory']){
  const item=abi.find(x=>x.type==='function'&&x.name===name);
  assert.ok(item,name);assert.ok(['view','pure'].includes(item.stateMutability),name);
 }
 for(const item of abi.filter(x=>x.type==='function'&&!['view','pure'].includes(x.stateMutability)))
  assert.equal(isKeelDirectReadAllowed('keel-equipment-inventory',item.name),false,item.name);
 assert.equal(isKeelDirectReadAllowed('keel-equipment-inventory','unknownFunction'),false);
});
