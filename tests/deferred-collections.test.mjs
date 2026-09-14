import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeFunctionData,encodeFunctionData,zeroHash} from 'viem';
import {prepareKeelDeferredCollection,keelDeferredCollectionCommitment,keelDeferredCollectionId,keelDeferredCollectionAbi} from '../packages/sdk/dist/deferred-collections.js';
const creator='0x1111111111111111111111111111111111111111';
const factory='0x2222222222222222222222222222222222222222';
const resolver='0x3333333333333333333333333333333333333333';
const config={name:'Work',symbol:'WORK',maxSupply:1n,royaltyReceiver:creator,royaltyBps:500n,metadataDigest:`0x${'ab'.repeat(32)}`};
const common={chainId:31337n,factory,resolver,creator,salt:`0x${'cd'.repeat(32)}`,bidder:{standard:'ERC721',config},patrons:{standard:'ERC1155',config}};

test('reservation does not prepare NFT deployment until separate fulfillment',()=>{
 const p=prepareKeelDeferredCollection(common);
 assert.equal(p.reservation.account,creator); assert.equal(p.reservation.value,0n);
 const reservation=decodeFunctionData({abi:keelDeferredCollectionAbi,data:p.reservation.data});
 assert.equal(reservation.functionName,'reserveDeferredCollection');
 assert.deepEqual(reservation.args,[resolver,common.salt,p.bidder.commitment,p.patrons.commitment]);
 for(const [key,other,isPatron,fn] of [['bidder','patrons',false,'createDeferredERC721'],['patrons','bidder',true,'createDeferredERC1155']]) {
  const call=decodeFunctionData({abi:keelDeferredCollectionAbi,data:p[key].data});
  assert.equal(call.functionName,fn);
  assert.deepEqual(call.args[0],{patrons:isPatron,creator,resolver,salt:common.salt,otherCommitment:p[other].commitment});
 }
});

test('one-of-one edition remains ERC1155 and single outcome omits the alternative',()=>{
 const p=prepareKeelDeferredCollection({...common,bidder:common.patrons,patrons:undefined});
 assert.equal(p.patrons,undefined);
 assert.equal(decodeFunctionData({abi:keelDeferredCollectionAbi,data:p.bidder.data}).functionName,'createDeferredERC1155');
 assert.equal(decodeFunctionData({abi:keelDeferredCollectionAbi,data:p.reservation.data}).args[3],zeroHash);
});

test('commitments bind metadata, royalties, supply and implementation',()=>{
 const original=keelDeferredCollectionCommitment(common.bidder);
 for(const changed of [{...config,maxSupply:2n},{...config,name:'Changed'},{...config,royaltyBps:600n},{...config,metadataDigest:common.salt}])
  assert.notEqual(keelDeferredCollectionCommitment({...common.bidder,config:changed}),original);
 assert.notEqual(keelDeferredCollectionCommitment({...common.bidder,implementation:'ERC721'}),original);
 assert.throws(()=>keelDeferredCollectionCommitment({...common.bidder,implementation:'Seeded721A'}));
});

test('reservation identity separates chains, factories, creators, resolvers and sales',()=>{
 const original=keelDeferredCollectionId(common);
 for(const changed of [{chainId:1n},{factory:creator},{creator:factory},{resolver:factory},{salt:zeroHash}])
  assert.notEqual(keelDeferredCollectionId({...common,...changed}),original);
 assert.throws(()=>keelDeferredCollectionId({...common,chainId:0n}));
 assert.throws(()=>keelDeferredCollectionId({...common,salt:'0x12'}));
});

test('prepared calls round trip the compiled factory ABI',async()=>{
 const canonical=JSON.parse(await readFile(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreatorFactory.json',import.meta.url),'utf8'));
 const plan=prepareKeelDeferredCollection(common);
 for(const tx of [plan.reservation,plan.bidder,plan.patrons]) {
  const decoded=decodeFunctionData({abi:canonical,data:tx.data});
  assert.equal(encodeFunctionData({abi:canonical,...decoded}),tx.data);
 }
});
