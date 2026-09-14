import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, zeroAddress, zeroHash } from 'viem';
import { buildOneMintBatchCheckout, quoteOneMintBatch } from '../packages/sdk/dist/one-mint-batch.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
const controller='0x1111111111111111111111111111111111111111',buyer='0x2222222222222222222222222222222222222222',target='0x3333333333333333333333333333333333333333';
const id=n=>'0x'+n.toString(16).padStart(64,'0');
const row=n=>({dropId:id(n),stageIndex:0,quantity:2,mintData:'0xaabb',target,tokenId:BigInt(n),paymentAsset:zeroAddress,unitPrice:3n,stageKind:2,reserved:true});
const input=()=>({controller,buyer,chainId:31337,rows:[row(2),row(1)]});
test('sorts entire purchases, exact ETH, maxTotal and no mutation',()=>{
 const source=input(),plan=buildOneMintBatchCheckout(source);
 assert.equal(source.rows[0].tokenId,2n);assert.equal(plan.total,12n);assert.equal(plan.value,12n);
 const d=decodeFunctionData({abi:ABIS.OneMintController,data:plan.call.data});
 assert.equal(d.functionName,'batchMint');assert.equal(d.args[1],12n);assert.equal(d.args[2][0].authorization.dropId,id(1));
 assert.equal(plan.approval,null);assert.equal(d.args[2][0].authorization.account,buyer);
});
test('token payment is one exact approval and zero native value; free token has no approval',()=>{
 const a=input();a.rows=a.rows.map(r=>({...r,paymentAsset:target}));
 const plan=buildOneMintBatchCheckout(a);assert.equal(plan.value,0n);assert.deepEqual(plan.approval,{token:target,spender:controller,amount:12n});
 a.rows=a.rows.map(r=>({...r,unitPrice:0n}));assert.equal(buildOneMintBatchCheckout(a).approval,null);
});
test('rejects empty, duplicate, mixed and invalid integer inputs',()=>{
 assert.throws(()=>buildOneMintBatchCheckout({...input(),rows:[]}));
 for(const patch of [{tokenId:2n},{target:buyer},{paymentAsset:buyer},{reserved:false},{quantity:0},{quantity:2**32},{quantity:1.5},{quantity:'-1'},{mintData:'0xa'},{dropId:zeroHash},{stageKind:9},{unitPrice:1n<<96n}]){
  const a=input();a.rows[1]={...a.rows[1],...patch};assert.throws(()=>buildOneMintBatchCheckout(a),JSON.stringify(patch,(_,v)=>typeof v==='bigint'?v.toString():v));
 }
});
test('preserves signed contexts and rejects spoofed buyer or quantity',()=>{
 const a=input();a.rows[0]={...a.rows[0],stageKind:1,signed:{account:buyer,quantity:2,nonce:9n,deadline:1000n,contextHash:id(33),signature:'0xcafe'}};
 const plan=buildOneMintBatchCheckout(a);assert.equal(plan.purchases[1].authorization.nonce,9n);assert.equal(plan.purchases[1].signature,'0xcafe');
 a.rows[0].signed={...a.rows[0].signed,account:target};assert.throws(()=>buildOneMintBatchCheckout(a));
 a.rows[0].signed={...a.rows[0].signed,account:buyer,quantity:3};assert.throws(()=>buildOneMintBatchCheckout(a));
});
test('Merkle and claim shape validation',()=>{
 const a=input();a.rows[0]={...a.rows[0],stageKind:12,allowance:1};assert.throws(()=>buildOneMintBatchCheckout(a));
 a.rows[0].allowance=2;assert.equal(buildOneMintBatchCheckout(a).purchases[1].allowance,2);
 a.rows[0]={...a.rows[0],stageKind:8,entitlementIds:[255n,256n],signed:{account:buyer,quantity:2,nonce:0n,deadline:100n,contextHash:id(11),signature:'0x'}};
 assert.deepEqual(buildOneMintBatchCheckout(a).purchases[1].entitlementIds,[255n,256n]);
 a.rows[0].entitlementIds=[255n,255n];assert.throws(()=>buildOneMintBatchCheckout(a));
});
test('live quote pins all reads and rejects wrong chain or insufficient allocation',async()=>{
 const seen=[];let minted=0n;
 const client={getChainId:async()=>31337,getBlock:async()=>({number:99n,hash:id(99),timestamp:20n}),readContract:async r=>{
 seen.push(r.blockNumber);if(r.functionName==='platformFeeBps')return 0;if(r.functionName==='feeTreasury')return zeroAddress;if(r.functionName==='mintedBy')return minted;
 if(r.functionName==='getStage')return {startTime:0n,endTime:100n,maxPerTransaction:5,maxPerWallet:5,unitPrice:3n,kind:2,paymentAsset:zeroAddress};
 return {exists:true,closed:false,paused:false,itemized:true,supply:10n,minted:0n,target,targetTokenId:BigInt(r.args[0]),capacityReserved:true,defaultMaxPerTransaction:5,defaultMaxPerWallet:5};
 }};
 const q=await quoteOneMintBatch(client,{...input(),selections:input().rows});assert.equal(q.blockNumber,99n);assert.ok(seen.every(n=>n===99n));
 minted=4n;await assert.rejects(()=>quoteOneMintBatch(client,{...input(),selections:input().rows}),/limit/);
 await assert.rejects(()=>quoteOneMintBatch(client,{...input(),chainId:1,selections:input().rows}),/chain/);
});

test('receipt proof requires exact controller and collection identities, all quantities, and all drops',async()=>{
 const {verifyOneMintBatchReceipt}=await import('../packages/sdk/dist/one-mint-batch.js');
 const {encodeEventTopics,encodeAbiParameters,parseAbi}=await import('viem');
 const plan=buildOneMintBatchCheckout(input());
 const logs=plan.rows.map(r=>({address:controller,topics:encodeEventTopics({abi:ABIS.OneMintController,eventName:'DropMinted',args:{dropId:r.dropId,stageIndex:0,account:buyer}}),data:encodeAbiParameters([{type:'uint32'},{type:'uint256'},{type:'uint8'}],[Number(r.quantity),r.quantity*r.unitPrice,2])}));
 const transferAbi=parseAbi(['event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)']);
 logs.push({address:target,topics:encodeEventTopics({abi:transferAbi,eventName:'TransferBatch',args:{operator:controller,from:zeroAddress,to:buyer}}),data:encodeAbiParameters([{type:'uint256[]'},{type:'uint256[]'}],[[1n,2n],[2n,2n]])});
 assert.deepEqual(verifyOneMintBatchReceipt(plan,logs).tokenIds,[1n,2n]);
 assert.throws(()=>verifyOneMintBatchReceipt(plan,logs.slice(1)),/missing/);
 assert.throws(()=>verifyOneMintBatchReceipt(plan,logs.map(l=>({...l,address:buyer}))),/missing/);
 assert.throws(()=>verifyOneMintBatchReceipt(plan,[...logs,logs[0]]),/match/);
 const wrong=[...logs];wrong[2]={...wrong[2],data:encodeAbiParameters([{type:'uint256[]'},{type:'uint256[]'}],[[1n,2n],[2n,3n]])};
 assert.throws(()=>verifyOneMintBatchReceipt(plan,wrong),/match/);
});
