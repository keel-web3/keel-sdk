import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodeFunctionData,decodeAbiParameters,parseAbiParameters} from 'viem';
import {prepareKeelAuctionSettlement,prepareKeelDeferredAuction,prepareKeelAuctionPublication,keelDeferredAuctionIssuerAbi,keelDeferredAuctionHouseAbi} from '../packages/sdk/dist/deferred-auctions.js';
import {decodeKeelAuctionSalePolicy} from '../packages/sdk/dist/auction-sales.js';
const creator='0x1111111111111111111111111111111111111111',factory='0x2222222222222222222222222222222222222222',issuer='0x3333333333333333333333333333333333333333';
const objectId=`0x${'ab'.repeat(32)}`;
const config={name:'Auction',symbol:'AUC',maxSupply:1n,royaltyReceiver:creator,royaltyBps:500n,metadataDigest:objectId};
const common={chainId:31337n,factory,issuer,creator,auctionId:7n,objectId,executor:creator,chunkCount:1,funding:'proceeds',publicationBudgetWei:30n,bidder:{standard:'ERC721',config,supply:1},patrons:{standard:'ERC1155',config,supply:3}};
const planType=parseAbiParameters('(uint8 fundingMode,uint32 chunkCount,uint32 bidderSupply,uint32 patronSupply,uint128 publicationBudget,address executor,bytes32 objectId,(uint8 kind,bytes configuration) bidder,(uint8 kind,bytes configuration) patrons)');

test('all three policies encode the exact object and winning collection alternatives',()=>{
 for(const [funding,mode] of [['creator-upfront',0],['proceeds',1],['claimant',2]]) {
  const p=prepareKeelDeferredAuction({...common,funding,publicationBudgetWei:mode===1?30n:0n});
  const [decoded]=decodeAbiParameters(planType,p.encodedPlan);
  assert.equal(decoded.fundingMode,mode);assert.equal(decoded.objectId,objectId);assert.equal(decoded.bidderSupply,1);assert.equal(decoded.patronSupply,3);
  assert.equal(decoded.bidder.kind,0);assert.equal(decoded.patrons.kind,2);
 }
});
test('editions of one and a bidder-only sale do not imply ERC721',()=>{
 const p=prepareKeelDeferredAuction({...common,bidder:{...common.patrons,supply:1},patrons:undefined});
 assert.equal(p.plan.bidder.kind,2);assert.equal(p.plan.patronSupply,0);assert.equal(p.patrons,undefined);
});
test('invalid budgets, supplies, object bindings and unknown policy fail before a wallet call',()=>{
 for(const input of [{publicationBudgetWei:0n},{publicationBudgetWei:1n<<128n},{funding:'unknown'},{chunkCount:0},{chunkCount:2**32},{auctionId:0n},
  {bidder:{...common.bidder,supply:2}},{objectId:`0x${'cd'.repeat(32)}`}])assert.throws(()=>prepareKeelDeferredAuction({...common,...input}));
 assert.equal(decodeKeelAuctionSalePolicy(1n|(1n<<34n)).deferred,true);
});
test('funding quote pins its reads and sends only the remaining amount',async()=>{
 const calls=[];const block={number:10n,hash:objectId};
 const client={getChainId:async()=>31337,getBlock:async()=>block,readContract:async input=>{calls.push(input);return [objectId,30n,20n,1,true];}};
 const quote=await prepareKeelAuctionPublication({client,issuer,auctionId:7n,chainId:31337});
 assert.equal(quote.transaction.value,10n);assert.equal(calls[0].blockNumber,10n);
 assert.deepEqual(decodeFunctionData({abi:keelDeferredAuctionIssuerAbi,data:quote.transaction.data}).args,[7n]);
 await assert.rejects(()=>prepareKeelAuctionPublication({client,issuer,auctionId:7n,chainId:1}),/wrong chain/);
 let n=0;client.getBlock=async()=>({...block,hash:n++?`0x${'cd'.repeat(32)}`:objectId});
 await assert.rejects(()=>prepareKeelAuctionPublication({client,issuer,auctionId:7n,chainId:31337}),/reorganized/);
});
test('deferred house ABI matches the compiled canonical house',async()=>{
 const source=await readFile(new URL('../../fun-art/packages/abi/src/generated/patrons-auction-house.ts',import.meta.url),'utf8');
 const compiled=JSON.parse(source.slice(source.indexOf('['),source.lastIndexOf(' as const;')));
 const normalize=x=>JSON.parse(JSON.stringify(x,(k,v)=>k==='internalType'||k==='name'&&v===''?undefined:v));
 for(const entry of keelDeferredAuctionHouseAbi)assert.deepEqual(normalize(entry),normalize(compiled.find(x=>x.type===entry.type&&x.name===entry.name)));
});

test('settlement routes explicit stamp choice without main NFT delivery or attached payment',()=>{
 for(const claimStamp of [false,true]) {
  const tx=prepareKeelAuctionSettlement({house:issuer,auctionId:7n,chainId:31337,claimStamp});
  assert.equal(tx.status,'review-only');assert.equal(tx.value,0n);
  const decoded=decodeFunctionData({abi:keelDeferredAuctionHouseAbi,data:tx.data});
  assert.equal(decoded.functionName,claimStamp?'settlePositionWithStamp':'settlePosition');
  assert.deepEqual(decoded.args,[7n]);
 }
 for(const patch of [{chainId:0},{auctionId:0n},{auctionId:1n<<256n},{house:'0x'+'00'.repeat(20)}])
  assert.throws(()=>prepareKeelAuctionSettlement({house:issuer,auctionId:7n,chainId:31337,...patch}));
});
