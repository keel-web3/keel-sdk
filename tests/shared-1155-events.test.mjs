import nodeTest from 'node:test';
import { siblingTest } from "./sibling-repository.mjs";
const test = siblingTest(nodeTest, "keel-contracts");
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeEventLog,encodeAbiParameters,keccak256,stringToHex,toHex} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-die.generated.js';

const abi=ABIS.KeelShared1155;
const previous='0x1111111111111111111111111111111111111111';
const creator='0x2222222222222222222222222222222222222222';
const topic=s=>keccak256(stringToHex(s));
const word=n=>toHex(n,{size:32});
const addressTopic=a=>`0x${'0'.repeat(24)}${a.slice(2)}`;
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));

test('shared1155 compiler, checked-in and SDK ABI match',()=>{
 const recorded=read('../../keel-contracts/modules/keel-die/abi/KeelShared1155.json');
 assert.deepEqual(abi,recorded);
 assert.deepEqual(recorded,read('../../keel-contracts/out/KeelShared1155.sol/KeelShared1155.json').abi);
});

test('shared collection creation decodes the reordered name and indexed owner',()=>{
 const e=decodeEventLog({abi,strict:true,topics:[topic('SharedCollectionCreated(string,uint128,address)'),word(9n),addressTopic(creator)],data:encodeAbiParameters([{type:'string'}],['Creator range'])});
 assert.deepEqual(e.args,{name:'Creator range',collectionId:9n,creator});
});

test('shared item creation distinguishes item index from collection id at full range width',()=>{
 const collectionId=(1n<<128n)-1n,itemIndex=5n,tokenId=(collectionId<<128n)|itemIndex,maxSupply=(1n<<128n)-1n;
 const e=decodeEventLog({abi,strict:true,topics:[topic('SharedItemCreated(uint128,uint128,uint256,uint256)'),word(itemIndex),word(collectionId),word(tokenId)],data:encodeAbiParameters([{type:'uint256'}],[maxSupply])});
 assert.deepEqual(e.args,{itemIndex,collectionId,tokenId,maxSupply});
});

test('shared creator handoff decodes the new creator before the previous creator',()=>{
 const e=decodeEventLog({abi,strict:true,topics:[topic('SharedCollectionCreatorTransferred(uint128,address,address)'),word(9n),addressTopic(creator),addressTopic(previous)],data:'0x'});
 assert.deepEqual(e.args,{collectionId:9n,creator,previousCreator:previous});
});

test('shared token standard and unchanged lifecycle schemas remain identical',()=>{
 const before=read('../../keel-contracts/benchmarks/evm-creator-review/shared-1155/before.json').abi;
 const changed=new Set(['SharedCollectionCreated','SharedItemCreated','SharedCollectionCreatorTransferred']);
 for (const entry of before.filter(x=>!changed.has(x.name))) assert.deepEqual(abi.find(x=>x.type===entry.type && x.name===entry.name),entry);
});
