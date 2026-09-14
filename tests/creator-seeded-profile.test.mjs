import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeFunctionData} from 'viem';
import {buildKeelCreatorSeedProfile,decodeKeelSeedDraw,buildKeelCreatorCollectionWalletBatch,createKeelCreatorOperationEnvelope,parseKeelCreatorOperationEnvelope} from '../packages/sdk/dist/index.js';
const creator='0x1111111111111111111111111111111111111111';
const factory='0x2222222222222222222222222222222222222222';
const renderer='0x3333333333333333333333333333333333333333';
const config={name:'Future',symbol:'KEEL',maxSupply:100,metadataDigest:`0x${'ab'.repeat(32)}`};
function batch(seedProfile={},implementation='erc721a') {return buildKeelCreatorCollectionWalletBatch({chainId:31337,creator,creatorNonce:0,
 deployment:{chainId:31337,instance:'local',factoryAddress:factory,rendererAddress:renderer},operation:{kind:'dedicated-erc721',implementation,config,seedProfile}});}
test('default seed profile commits two future blocks and locks trades',()=>{
 assert.deepEqual(buildKeelCreatorSeedProfile(),{useVrf:false,lockUntilReveal:true,futureBlockDelay:'1',sourceGas:'0',source:'0x0000000000000000000000000000000000000000',transferStorage:1,mode:1});
 assert.equal(buildKeelCreatorSeedProfile({futureBlockReveal:false,sealedTransfers:'allowed',storageOnTransfer:'reference'}).futureBlockDelay,'0');
});
test('seed policy is encoded and retained in the durable wallet review',()=>{
 const b=batch({sealedTransfers:'allowed',futureBlockDelay:2});
 const abi=JSON.parse(readFileSync(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreatorFactory.json',import.meta.url)));
 const decoded=decodeFunctionData({abi,data:b.factoryCall.data});
 assert.equal(decoded.functionName,'createSeededERC721');
 assert.equal(decoded.args[1].lockUntilReveal,false);
 assert.equal(Number(decoded.args[1].futureBlockDelay),2);
 const envelope=createKeelCreatorOperationEnvelope({batch:b});
 assert.deepEqual(parseKeelCreatorOperationEnvelope(JSON.stringify(envelope)),envelope);
});
test('contradictory and unsupported profiles fail before wallet encoding',()=>{
 for(const input of [{futureBlockReveal:true,futureBlockDelay:0},{futureBlockReveal:false,futureBlockDelay:1},{mode:'linear'},{sourceGas:100},{sealedTransfers:'reroll'},{futureBlockDelay:2**32}]) assert.throws(()=>buildKeelCreatorSeedProfile(input));
 assert.throws(()=>batch({},'erc721'));
});
test('draw decoding preserves target blocks and finalized status',()=>{
 assert.deepEqual(decodeKeelSeedDraw(101n),{vrf:false,future:true,firstBlock:101n,secondBlock:102n,revealed:false});
 assert.equal(decodeKeelSeedDraw((1n<<64n)|101n).revealed,true);
 assert.equal(decodeKeelSeedDraw(0n).future,false);
 for(const bad of [-1n,1n<<66n,1n<<64n])assert.throws(()=>decodeKeelSeedDraw(bad));
});

test('VRF policy binds the adapter and separates it from future blocks',()=>{
 const profile=buildKeelCreatorSeedProfile({chainlinkVrf:true,source:renderer});
 assert.equal(profile.useVrf,true);
 assert.equal(profile.futureBlockDelay,'0');
 assert.equal(profile.sourceGas,'0');
 const abi=JSON.parse(readFileSync(new URL('../../keel-contracts/modules/keel-die/abi/KeelCreatorFactory.json',import.meta.url)));
 const decoded=decodeFunctionData({abi,data:batch({chainlinkVrf:true,source:renderer}).factoryCall.data});
 assert.equal(decoded.args[1].useVrf,true);
 assert.equal(decoded.args[1].source.toLowerCase(),renderer);
 for(const input of [{chainlinkVrf:true},{chainlinkVrf:true,source:renderer,futureBlockReveal:true},{chainlinkVrf:true,source:renderer,sourceGas:100}]) assert.throws(()=>buildKeelCreatorSeedProfile(input));
 const pending=decodeKeelSeedDraw(1n<<65n);
 assert.equal(pending.vrf,true);assert.equal(pending.future,false);assert.equal(pending.revealed,false);
 assert.equal(decodeKeelSeedDraw((1n<<65n)|(1n<<64n)).revealed,true);
 assert.throws(()=>decodeKeelSeedDraw((1n<<65n)|1n));
});
