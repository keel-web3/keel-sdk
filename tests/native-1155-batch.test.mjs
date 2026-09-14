import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {buildKeelERC1155BatchMintCall} from '../packages/sdk/dist/mint-batch.js';
import {ABIS} from '../packages/sdk/dist/abis/keel-mint-access.generated.js';

const target='0x1111111111111111111111111111111111111111';
const registry='0x2222222222222222222222222222222222222222';
const recipient='0x3333333333333333333333333333333333333333';
const input=()=>({routeRegistryAddress:registry,recipient,mode:'reserved',items:[
 {target,tokenId:'340282366920938463463374607431768211461',routeId:9,quantity:2,allocationId:'0x'+'01'.repeat(32),data:'0xaabb'},
 {target,tokenId:1,routeId:3,quantity:4,allocationId:'0x'+'02'.repeat(32),data:'0xcc'},
]});

for(const mode of ['reserved','immediate'])test(`native1155 ${mode} call sorts whole entries without mutating input`,()=>{
 const value={...input(),mode};const original=structuredClone(value);
 const result=buildKeelERC1155BatchMintCall(value);
 assert.deepEqual(value,original);
 assert.equal(result.execution,'approved-controller-only');assert.equal(result.status,'review-only');
 assert.equal(result.target,target);assert.equal(result.call.to,registry);assert.equal(result.call.value,'0x0');
 const decoded=decodeFunctionData({abi:ABIS.KeelMintRouteRegistry,data:result.call.data});
 assert.equal(decoded.functionName,mode==='reserved'?'mintReservedBatch':'mintUnreservedBatch');
 assert.equal(decoded.args[0],recipient);
 assert.deepEqual(decoded.args[1].map(x=>[x.routeId,x.quantity,x.data,x.allocationId]),[[3n,4n,'0xcc',value.items[1].allocationId],[9n,2n,'0xaabb',value.items[0].allocationId]]);
 assert.equal(result.items[1].tokenId,value.items[0].tokenId);
});

test('native1155 rejects mixed targets, repeated IDs and repeated routes',()=>{
 for(const mutate of [x=>x.items[1].target=recipient,x=>x.items[1].tokenId=x.items[0].tokenId,x=>x.items[1].routeId=x.items[0].routeId]){
  const x=input();mutate(x);assert.throws(()=>buildKeelERC1155BatchMintCall(x));
 }
});

test('native1155 validates mode, addresses, empty arrays and complete payload bytes',()=>{
 for(const mutate of [x=>x.mode='unknown',x=>x.recipient='0x'+'0'.repeat(40),x=>x.routeRegistryAddress='bad',x=>x.items=[],x=>x.items[0].allocationId='0x'+'0'.repeat(64),x=>x.items[0].data='0xa']){
  const x=input();mutate(x);assert.throws(()=>buildKeelERC1155BatchMintCall(x));
 }
});

test('native1155 preserves full uint256 quantities and rejects overflow or unsafe numbers',()=>{
 const x=input();x.items[0].quantity=(1n<<256n)-1n;
 assert.equal(buildKeelERC1155BatchMintCall(x).items[1].quantity,x.items[0].quantity.toString());
 for(const value of [0,-1,1n<<256n,Number.MAX_SAFE_INTEGER+1,'1.5']){
  x.items[0].quantity=value;assert.throws(()=>buildKeelERC1155BatchMintCall(x));
 }
});

test('native1155 accepts token ID zero for compatible external targets',()=>{
 const x=input();x.items[1].tokenId=0;assert.equal(buildKeelERC1155BatchMintCall(x).items[0].tokenId,'0');
});
