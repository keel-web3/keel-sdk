import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,encodeEventTopics,encodeAbiParameters,parseAbi,hashTypedData,zeroAddress,zeroHash} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {packKeelMintDiscount} from '../packages/sdk/dist/mint-pricing.js';
import {oneMintCouponId,oneMintCouponTypedData,decodeOneMintCoupon,quoteOneMintCouponTerms} from '../packages/sdk/dist/one-mint-coupons.js';
import {buildOneMintBatchCheckout,buildOneMintCouponMint,quoteOneMintBatch,verifyOneMintBatchReceipt} from '../packages/sdk/dist/one-mint-batch.js';
const controller='0x1111111111111111111111111111111111111111',buyer='0x2222222222222222222222222222222222222222',target='0x3333333333333333333333333333333333333333',treasury='0x4444444444444444444444444444444444444444';
const id=n=>'0x'+n.toString(16).padStart(64,'0');
const terms=packKeelMintDiscount({kind:'percentage',value:5000n});
const coupon={couponId:oneMintCouponId('KEEL-HALF'),signature:'0x',nonce:0n,revision:1n,deadline:500n};
const row=(n,discount=true)=>({dropId:id(n),stageIndex:0,quantity:2,mintData:'0x',target,tokenId:BigInt(n),paymentAsset:zeroAddress,unitPrice:100n,stageKind:2,reserved:true,platformFeeBps:1000,feeTreasury:treasury,...(discount?{coupon,couponTerms:terms}:{})});
const input=()=>({controller,buyer,chainId:31337,rows:[row(2,false),row(1)]});
test('coupon batch sorts attached redemptions and includes exact fee split',()=>{
 const plan=buildOneMintBatchCheckout(input());
 assert.equal(plan.total,300n);assert.equal(plan.discount,100n);assert.equal(plan.platformFee,30n);assert.equal(plan.creatorProceeds,270n);
 const decoded=decodeFunctionData({abi:ABIS.OneMintController,data:plan.call.data});
 assert.equal(decoded.functionName,'batchMintWithCoupons');assert.equal(decoded.args[3][0].couponId,coupon.couponId);assert.equal(decoded.args[3][1].couponId,zeroHash);
 assert.equal(plan.value,300n);
});
test('single coupon calldata works for a non-itemized target and token payment',()=>{
 const r={...row(1),tokenId:0n,paymentAsset:target};
 const plan=buildOneMintCouponMint({...input(),row:r});
 assert.equal(plan.value,0n);assert.equal(plan.approval.amount,100n);
 const d=decodeFunctionData({abi:ABIS.OneMintController,data:plan.call.data});assert.equal(d.functionName,'mintWithCoupon');assert.equal(d.args[2],100n);
});
test('reject terms without redemption, reserved bits and inconsistent fee policy',()=>{
 for(const patch of [{coupon:undefined,couponTerms:terms},{couponTerms:terms|(1n<<255n)},{platformFeeBps:10001},{feeTreasury:zeroAddress},{coupon:{...coupon,nonce:1n<<64n}},{couponTerms:0n}]) {
  assert.throws(()=>buildOneMintBatchCheckout({...input(),rows:[{...row(1),...patch}]}));
 }
 assert.throws(()=>buildOneMintBatchCheckout({...input(),rows:[row(1),{...row(2),platformFeeBps:999}]}));
});
test('packed campaign boundaries and stale wallet revisions',()=>{
 const max=(1n<<64n)-1n,authority=BigInt(buyer)|(max<<160n)|(65535n<<224n)|(1n<<240n);
 const limits=max|(max<<64n)|(max<<128n)|(max<<192n),wallet=max|(max<<64n)|(max<<128n);
 const c=decodeOneMintCoupon(terms,limits,authority,wallet);
 assert.equal(c.used,max);assert.equal(c.maxTotal,max);assert.equal(c.maxPerWallet,max);assert.equal(c.expiry,max);assert.equal(c.walletUsed,max);assert.equal(c.nonce,max);assert.equal(c.stageIndex,65535);assert.equal(c.signer,buyer);
 assert.equal(decodeOneMintCoupon(terms,limits,authority,1n<<128n).walletUsed,0n);
});
test('typed coupons bind every domain and payload field',()=>{
 const data={chainId:31337,controller,buyer,paymentAsset:zeroAddress,dropId:id(1),stageIndex:0,quantity:2,mintData:'0x',terms,redemption:coupon};
 const hash=hashTypedData(oneMintCouponTypedData(data));
 for(const change of [{chainId:1},{controller:target},{buyer:target},{paymentAsset:target},{dropId:id(2)},{stageIndex:1},{quantity:3},{mintData:'0x01'},{terms:terms+256n},{redemption:{...coupon,revision:2n}},{redemption:{...coupon,nonce:1n}},{redemption:{...coupon,deadline:499n}}]) assert.notEqual(hashTypedData(oneMintCouponTypedData({...data,...change})),hash);
 assert.throws(()=>oneMintCouponId(' X '));assert.equal(oneMintCouponId(id(1)),id(1));
});
function fixture(signed=false){
 let wallet=0n,used=0n,active=true;const seen=[];
 const client={getChainId:async()=>31337,getBlock:async()=>({number:99n,hash:id(99),timestamp:20n}),readContract:async r=>{
 seen.push(r.blockNumber);
 if(r.functionName==='platformFeeBps')return 1000;if(r.functionName==='feeTreasury')return treasury;
 if(r.functionName==='coupons')return [terms,used|(20n<<64n)|(10n<<128n),BigInt(signed?buyer:zeroAddress)|(1n<<160n)|(active?1n<<240n:0n)];
 if(r.functionName==='couponWalletWord')return wallet;
 if(r.functionName==='mintedBy')return 0n;
 if(r.functionName==='getStage')return {startTime:0n,endTime:1000n,maxPerTransaction:10,maxPerWallet:10,unitPrice:100n,kind:2,paymentAsset:zeroAddress};
 return {exists:true,closed:false,paused:false,itemized:true,supply:20n,minted:0n,target,targetTokenId:BigInt(r.args[0]),capacityReserved:true,defaultMaxPerTransaction:10,defaultMaxPerWallet:10};
 }};return {client,seen,setWallet:n=>wallet=n,setUsed:n=>used=n,disable:()=>active=false};
}
test('pinned quote fills public coupon nonce, discounts and fee policy',async()=>{
 const f=fixture();const p=await quoteOneMintBatch(f.client,{...input(),selections:[{...row(1),coupon:{couponId:coupon.couponId}}]});
 assert.equal(p.total,100n);assert.equal(p.platformFee,10n);assert.equal(p.redemptions[0].nonce,0n);assert.ok(f.seen.every(n=>n===99n));
 f.setWallet(2n|(1n<<64n)|(1n<<128n));
 await assert.rejects(()=>quoteOneMintBatch(f.client,{...input(),selections:[row(1)]}),/stale/);
 f.setUsed(20n);await assert.rejects(()=>quoteOneMintBatch(f.client,{...input(),selections:[row(1)]}),/allowance/);
 f.disable();await assert.rejects(()=>quoteOneMintBatch(f.client,{...input(),selections:[row(1)]}),/unavailable/);
});
test('signed coupons require complete immutable authorization fields',async()=>{
 const f=fixture(true);const i={controller,buyer,dropId:id(1),stageIndex:0,quantity:2n,blockNumber:99n,timestamp:20n};
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...i,coupon:{couponId:coupon.couponId}}),/signed/);
 const result=await quoteOneMintCouponTerms(f.client,{...i,coupon:{...coupon,signature:'0xaabb'}});assert.equal(result.coupon.signature,'0xaabb');
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...i,coupon:{...coupon,deadline:19n}}),/expired/);
});
test('receipts require coupon use, exact aggregate fee and discounted mint amounts',()=>{
 const p=buildOneMintBatchCheckout(input());
 const event=(name,args,types,values)=>({address:controller,topics:encodeEventTopics({abi:ABIS.OneMintController,eventName:name,args}),data:encodeAbiParameters(types.map(type=>({type})),values)});
 const logs=[event('CouponRedeemed',{dropId:id(1),couponId:coupon.couponId,buyer},['uint32','uint64','uint64','uint256'],[2,0n,1n,100n]),event('MintPlatformFeePaid',{asset:zeroAddress,treasury},['uint256'],[30n])];
 for(let i=0;i<p.rows.length;++i){const r=p.rows[i];logs.push(event('DropMinted',{dropId:r.dropId,stageIndex:0,account:buyer},['uint32','uint256','uint8'],[2,p.prices[i].paid,2]));}
 const ta=parseAbi(['event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)']);
 logs.push({address:target,topics:encodeEventTopics({abi:ta,eventName:'TransferBatch',args:{operator:controller,from:zeroAddress,to:buyer}}),data:encodeAbiParameters([{type:'uint256[]'},{type:'uint256[]'}],[[1n,2n],[2n,2n]])});
 assert.equal(verifyOneMintBatchReceipt(p,logs).drops.length,2);
 for(let i=0;i<logs.length;++i)assert.throws(()=>verifyOneMintBatchReceipt(p,logs.filter((_,j)=>i!==j)),/missing/);
 assert.throws(()=>verifyOneMintBatchReceipt(p,[...logs,logs[0]]),/match/);
 assert.throws(()=>verifyOneMintBatchReceipt(p,logs.map((l,i)=>i===1?{...l,data:encodeAbiParameters([{type:'uint256'}],[31n])}:l)),/match/);
});

test('one-item ERC1155 batch accepts only its exact TransferSingle',()=>{
 const p=buildOneMintBatchCheckout({...input(),rows:[{...row(1,false),platformFeeBps:0,feeTreasury:zeroAddress}]});
 const logs=[{address:controller,topics:encodeEventTopics({abi:ABIS.OneMintController,eventName:'DropMinted',args:{dropId:id(1),stageIndex:0,account:buyer}}),data:encodeAbiParameters([{type:'uint32'},{type:'uint256'},{type:'uint8'}],[2,200n,2])}];
 const abi=parseAbi(['event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)']);
 logs.push({address:target,topics:encodeEventTopics({abi,eventName:'TransferSingle',args:{operator:controller,from:zeroAddress,to:buyer}}),data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[1n,2n])});
 assert.equal(verifyOneMintBatchReceipt(p,logs).drops.length,1);
 assert.throws(()=>verifyOneMintBatchReceipt(p,[...logs,logs[1]]),/match/);
 const wrong=[logs[0],{...logs[1],data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[2n,2n])}];
 assert.throws(()=>verifyOneMintBatchReceipt(p,wrong),/match/);
});
