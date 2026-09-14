import test from 'node:test';import assert from 'node:assert/strict';
import {decodeFunctionData,encodeAbiParameters,keccak256,zeroAddress,zeroHash,encodeEventTopics} from 'viem';
import {ABIS} from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {normalizeOneMintNftCouponProof,oneMintNftCouponLeaf,oneMintNftCouponIdsDigest,decodeOneMintNftCoupon,oneMintCouponTypedData,quoteOneMintCouponTerms} from '../packages/sdk/dist/one-mint-coupons.js';
import {buildOneMintBatchCheckout,buildOneMintCouponMint,verifyOneMintBatchReceipt} from '../packages/sdk/dist/one-mint-batch.js';
const a=n=>`0x${n.toString(16).padStart(40,'0')}`,id=n=>`0x${n.toString(16).padStart(64,'0')}`;
const controller=a(1),buyer=a(2),collection=a(3),target=a(4),dropId=id(1),couponId=id(8),terms=1n|(10000n<<8n);
const nft={tokenIds:[1n,5n],proofs:[]};const coupon={couponId,revision:1n,nonce:0n,deadline:1000n,signature:'0x',nft};
const row={dropId,stageIndex:0,quantity:4n,mintData:'0x',stageKind:2,target,tokenId:1n,paymentAsset:zeroAddress,unitPrice:100n,capacityReserved:true,coupon,couponTerms:terms};
const input={chainId:31337,controller,buyer,rows:[row]};
const packed=BigInt(collection)|(200n<<160n)|(2n<<224n)|(1n<<248n);
test('NFT proof validates sorted full-width IDs and matching per-token proofs',()=>{
 assert.deepEqual(normalizeOneMintNftCouponProof(nft),nft);
 for(const tokenIds of [[],[2n,1n],[1n,1n],[-1n],[1n<<256n],Array.from({length:65},(_,i)=>BigInt(i))])assert.throws(()=>normalizeOneMintNftCouponProof({tokenIds,proofs:[]}));
 assert.throws(()=>normalizeOneMintNftCouponProof({...nft,proofs:[[]]}));
 assert.equal(normalizeOneMintNftCouponProof({tokenIds:[(1n<<256n)-1n],proofs:[]}).tokenIds.length,1);
});
test('NFT policy packing separates 200 source claims from 400 free outputs',()=>{
 const p=decodeOneMintNftCoupon(zeroHash,packed|(200n<<192n),1n,5n);
 assert.equal(p.maxClaims,200n);assert.equal(p.issued,200n);assert.equal(p.quantityPerToken,2n);assert.equal(p.singleUse,true);assert.equal(p.collection,collection);
});
test('NFT leaf and signed context bind collection and complete source ID selection',()=>{
 const leaf=oneMintNftCouponLeaf(collection,1n);
 assert.equal(leaf,keccak256(keccak256(encodeAbiParameters([{type:'address'},{type:'uint256'}],[collection,1n]))));
 assert.notEqual(leaf,oneMintNftCouponLeaf(a(9),1n));
 const base={chainId:31337,controller,buyer,paymentAsset:zeroAddress,dropId,stageIndex:0,quantity:4,mintData:'0x',terms,redemption:coupon};
 const hash=oneMintCouponTypedData(base).message.contextHash;
 assert.equal(hash,keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'}],[keccak256('0x'),oneMintNftCouponIdsDigest(nft.tokenIds)])));
 assert.notEqual(hash,oneMintCouponTypedData({...base,redemption:{...coupon,nft:{tokenIds:[1n,6n],proofs:[]}}}).message.contextHash);
});
test('single and mixed batch select NFT entrypoints without shifting proof associations',()=>{
 const plan=buildOneMintBatchCheckout({...input,rows:[{...row,dropId:id(2),tokenId:2n,coupon:undefined,couponTerms:undefined},row]});
 assert.equal(plan.usesNftCoupons,true);assert.equal(plan.total,400n);assert.deepEqual(plan.nftProofs,[nft,{tokenIds:[],proofs:[]}]);
 const decoded=decodeFunctionData({abi:ABIS.OneMintController,data:plan.call.data});assert.equal(decoded.functionName,'batchMintWithNftCoupons');
 assert.deepEqual(decoded.args[4][0].tokenIds,[1n,5n]);
 const single=buildOneMintCouponMint({chainId:31337,controller,buyer,row});assert.equal(decodeFunctionData({abi:ABIS.OneMintController,data:single.call.data}).functionName,'mintWithNftCoupon');
});
function fixture(){
 const reads=[];let word=packed,owner=buyer,used=0n,root=zeroHash;
 const client={readContract:async r=>{reads.push(r.blockNumber);switch(r.functionName){
 case 'coupons':return [terms,1000n<<64n|1000n<<128n,1n<<160n|3n<<240n];case 'couponWalletWord':return 0n;
 case 'nftCouponPolicies':return [root,word,1n,5n];case 'nftCouponUsedWords':return used;case 'ownerOf':return owner;default:throw Error(r.functionName);
 }}};
 return {client,reads,setWord:w=>word=w,setOwner:o=>owner=o,setUsed:u=>used=u,setRoot:r=>root=r};
}
const quote={controller,buyer,dropId,stageIndex:0,quantity:4n,coupon,blockNumber:9n,timestamp:10n};
test('pinned NFT quote checks live owner, bitmap use, range, quantity and source cap',async()=>{
 const f=fixture();const result=await quoteOneMintCouponTerms(f.client,quote);assert.deepEqual(result.coupon.nft,nft);assert.ok(f.reads.every(b=>b===9n));
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...quote,coupon:{couponId}}),/source NFTs/);
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...quote,quantity:5n}),/allowance/);
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...quote,coupon:{...coupon,nft:{tokenIds:[6n],proofs:[]}},quantity:1n}),/range/);
 f.setOwner(a(7));await assert.rejects(()=>quoteOneMintCouponTerms(f.client,quote),/does not own/);f.setOwner(buyer);
 f.setUsed(2n);await assert.rejects(()=>quoteOneMintCouponTerms(f.client,quote),/already redeemed/);f.setUsed(0n);
 f.setWord(packed|(199n<<192n));await assert.rejects(()=>quoteOneMintCouponTerms(f.client,quote),/cap/);
});
test('Merkle NFT quote verifies collection-ID leaf before wallet submission',async()=>{
 const f=fixture();f.setRoot(oneMintNftCouponLeaf(collection,1n));
 const q={...quote,quantity:1n,coupon:{...coupon,nft:{tokenIds:[1n],proofs:[[]]}}};
 await quoteOneMintCouponTerms(f.client,q);
 await assert.rejects(()=>quoteOneMintCouponTerms(f.client,{...q,coupon:{...coupon,nft:{tokenIds:[2n],proofs:[[]]}}}),/Merkle proof/);
});
test('NFT receipts require exact source digest and claim count',()=>{
 const plan=buildOneMintBatchCheckout(input);
 const event=(eventName,args,types,values)=>({address:controller,topics:encodeEventTopics({abi:ABIS.OneMintController,eventName,args}),data:encodeAbiParameters(types.map(type=>({type})),values)});
 const logs=[event('CouponRedeemed',{dropId,couponId,buyer},['uint32','uint64','uint64','uint256'],[4,0n,1n,400n]),
 event('NftCouponRedeemed',{dropId,couponId,buyer},['uint32','uint64','bytes32'],[2,1n,oneMintNftCouponIdsDigest(nft.tokenIds)]),
 event('DropMinted',{dropId,stageIndex:0,account:buyer},['uint32','uint256','uint8'],[4,0n,2])];
 // The exact correlated collection event is also mandatory; omission is rejected even with all coupon events.
 assert.throws(()=>verifyOneMintBatchReceipt(plan,logs),/missing/);
 const bad=[...logs];bad[1]=event('NftCouponRedeemed',{dropId,couponId,buyer},['uint32','uint64','bytes32'],[1,1n,zeroHash]);
 assert.throws(()=>verifyOneMintBatchReceipt(plan,bad),/NFT coupon receipt/);
});
