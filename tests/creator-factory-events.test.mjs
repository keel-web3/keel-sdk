import nodeTest from 'node:test';
import { siblingTest } from "./sibling-repository.mjs";
const test = siblingTest(nodeTest, "keel-contracts");
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeEventLog,encodeAbiParameters,keccak256,stringToHex,toHex} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-die.generated.js';
const abi=ABIS.KeelCreatorFactory;
const creator='0x1111111111111111111111111111111111111111';
const previousCreator='0x2222222222222222222222222222222222222222';
const token='0x3333333333333333333333333333333333333333';
const topic=s=>keccak256(stringToHex(s));
const addr=a=>`0x${'0'.repeat(24)}${a.slice(2)}`;
const digest=`0x${'ab'.repeat(32)}`;
const encode=(types,values)=>encodeAbiParameters(types.map(type=>({type})),values);

test('factory generated SDK ABI matches compiled and recorded schemas',()=>{
 const recorded=JSON.parse(readFileSync(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreatorFactory.json',import.meta.url)));
 const compiled=JSON.parse(readFileSync(new URL('../../keel-contracts/out/KeelCreatorFactory.sol/KeelCreatorFactory.json',import.meta.url))).abi;
 assert.deepEqual(abi,recorded);assert.deepEqual(recorded,compiled);
});
test('registration decodes every field for dedicated, shared and external collections',()=>{
 for(const [standard,deployment,sharedCollectionId,mintCompatible] of [[0,0,0n,true],[1,1,9n,true],[0,2,0n,false]]){
 const log=decodeEventLog({abi,strict:true,topics:[topic('CreatorCollectionRegistered(bool,uint8,uint8,string,uint256,address,address,uint128,bytes32)'),toHex(7n,{size:32}),addr(creator),addr(token)],data:encode(['bool','uint8','uint8','string','uint128','bytes32'],[mintCompatible,standard,deployment,'Collection',sharedCollectionId,digest])});
 assert.equal(log.eventName,'CreatorCollectionRegistered');assert.deepEqual(log.args,{collectionId:7n,creator,tokenContract:token,mintCompatible,standard,deployment,name:'Collection',sharedCollectionId,metadataDigest:digest});
 }
});
test('ownership event keeps the new and previous creator in their named topics',()=>{
 const log=decodeEventLog({abi,strict:true,topics:[topic('CreatorCollectionTransferred(uint256,address,address)'),toHex(7n,{size:32}),addr(creator),addr(previousCreator)],data:'0x'});
 assert.deepEqual(log.args,{collectionId:7n,creator,previousCreator});
});
test('closure and implementation selection preserve flags and enum ordinals',()=>{
 for(const enforcedOnToken of [false,true]){
 const log=decodeEventLog({abi,strict:true,topics:[topic('CreatorCollectionClosed(bool,uint256,address,uint128)'),toHex(7n,{size:32}),addr(token)],data:encode(['bool','uint128'],[enforcedOnToken,9n])});
 assert.deepEqual(log.args,{collectionId:7n,tokenContract:token,enforcedOnToken,sharedCollectionId:9n});
 }
 for(const kind of [0,1,2]){
 const log=decodeEventLog({abi,strict:true,topics:[topic('CreatorERC721ImplementationSelected(uint8,uint256,address)'),toHex(7n,{size:32}),addr(token)],data:encode(['uint8'],[kind])});
 assert.deepEqual(log.args,{collectionId:7n,tokenContract:token,kind});
 }
});
