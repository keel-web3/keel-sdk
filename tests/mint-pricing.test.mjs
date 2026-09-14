import test from 'node:test';
import assert from 'node:assert/strict';
import {packKeelMintDiscount,unpackKeelMintDiscount,calculateKeelMintPrice,keelMintSubtotal} from '../packages/sdk/dist/mint-pricing.js';
const max=(bits)=>(1n<<BigInt(bits))-1n;
test('canonical one-word terms preserve maximum fields and reject reserved bits',()=>{
 const config={kind:'fixedPerToken',value:max(128),buyQuantity:Number(max(32)),discountQuantity:Number(max(32))};
 const word=packKeelMintDiscount(config);assert.equal(word>>200n,0n);assert.deepEqual(unpackKeelMintDiscount(word),config);
 assert.throws(()=>unpackKeelMintDiscount(word|(1n<<200n)),/reserved/);
});
test('default price has no coupon or platform share',()=>{
 assert.deepEqual(calculateKeelMintPrice({unitPrice:11n,quantity:3n}),{gross:33n,paid:33n,discount:0n,platformFee:0n,creatorProceeds:33n,eligibleQuantity:0n});
});
test('buy two discount next two includes partially selected discounted units',()=>{
 const terms=packKeelMintDiscount({kind:'percentage',value:10000n,buyQuantity:2,discountQuantity:2});
 const expected=[0n,0n,0n,1n,2n,2n,2n,3n];
 for(let i=0;i<expected.length;i++)assert.equal(calculateKeelMintPrice({unitPrice:100n,quantity:BigInt(i),terms}).discount,expected[i]*100n);
});
test('fixed per-token and fixed line discounts clamp, while fees use discounted proceeds',()=>{
 let terms=packKeelMintDiscount({kind:'fixedPerToken',value:300n,buyQuantity:2,discountQuantity:1});
 let q=calculateKeelMintPrice({unitPrice:100n,quantity:3n,terms,platformFeeBps:1000});
 assert.equal(q.paid,200n);assert.equal(q.discount,100n);assert.equal(q.platformFee,20n);assert.equal(q.creatorProceeds,180n);
 terms=packKeelMintDiscount({kind:'fixedTotal',value:7n,buyQuantity:1,discountQuantity:1});
 q=calculateKeelMintPrice({unitPrice:100n,quantity:10n,terms});assert.equal(q.discount,7n);
});
test('percentage rounding belongs to the line, never reapply it over combined batch totals',()=>{
 const terms=packKeelMintDiscount({kind:'percentage',value:3333n});
 const row=calculateKeelMintPrice({unitPrice:1n,quantity:3n,terms,platformFeeBps:1000});assert.equal(row.discount,0n);assert.equal(row.platformFee,0n);
 assert.notEqual(2n*row.paid,calculateKeelMintPrice({unitPrice:1n,quantity:6n,terms}).paid);
});
test('full-width arithmetic matches Solidity bounds without float conversion',()=>{
 const terms=packKeelMintDiscount({kind:'percentage',value:10000n});
 assert.equal(calculateKeelMintPrice({unitPrice:max(256),quantity:1n,terms,platformFeeBps:10000}).paid,0n);
 assert.equal(calculateKeelMintPrice({unitPrice:max(256),quantity:1n,platformFeeBps:10000}).platformFee,max(256));
 assert.equal(keelMintSubtotal(max(256),0n),0n);assert.throws(()=>keelMintSubtotal(max(256),2n),/Subtotal/);
 assert.throws(()=>keelMintSubtotal(-1n,0n),/Unit price/);
});
test('unknown kinds, noncanonical fields and excessive fees fail closed',()=>{
 for(const config of [{kind:'alien',value:1n},{kind:'none',value:1n},{kind:'percentage',value:0n},{kind:'percentage',value:10001n},{kind:'percentage',value:1n,buyQuantity:2},{kind:'fixedTotal',value:1n,discountQuantity:2},{kind:'fixedTotal',value:1n,buyQuantity:0.5,discountQuantity:1}])assert.throws(()=>packKeelMintDiscount(config));
 for(const word of [4n,1n,1n<<8n,max(256)])assert.throws(()=>unpackKeelMintDiscount(word));
 assert.throws(()=>calculateKeelMintPrice({unitPrice:0n,quantity:0n,platformFeeBps:10001}));
});
test('promotion count conserves quantity through maximum uint256',()=>{
 const terms=packKeelMintDiscount({kind:'percentage',value:10000n,buyQuantity:Number(max(32)),discountQuantity:Number(max(32))});
 const q=calculateKeelMintPrice({unitPrice:1n,quantity:max(256),terms});assert.equal(q.paid+q.discount,max(256));assert(q.eligibleQuantity<=max(256));
});
