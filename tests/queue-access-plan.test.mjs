import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData,keccak256,concatHex} from 'viem';
import {planQueueAccess,queueAccessLeaf,queueAccessPlanAbi} from '../tools/keel/lib/queue-access-plan.mjs';
const address=n=>`0x${BigInt(n).toString(16).padStart(40,'0')}`;
const base={chainId:11155111,queue:address(1),access:address(2),policyId:3,gate:'wallet',skip:true,end:2000000000,recipients:[{account:address(3),weight:10}]};
test('wallet plan batches bounded calldata and leaves activation separate',()=>{
 const plan=planQueueAccess({...base,recipients:Array.from({length:129},(_,i)=>({account:address(i+100),weight:1+i%100}))});
 assert.equal(plan.calls.length,3);assert.equal(plan.signed,false);assert.equal(plan.submitted,false);
 const created=decodeFunctionData({abi:queueAccessPlanAbi,data:plan.calls[0].data});assert.equal(created.functionName,'createAt');assert.equal(created.args[0],3);assert.equal(created.args[1].maxQuantity,1);
 assert.equal(decodeFunctionData({abi:queueAccessPlanAbi,data:plan.calls[1].data}).args[1].length,128);
 assert.equal(decodeFunctionData({abi:queueAccessPlanAbi,data:plan.activationAfterReadback.data}).functionName,'setPaused');
});
test('weighted Merkle proofs verify odd-sized trees and bind queue, policy, wallet and weight',()=>{
 const plan=planQueueAccess({...base,gate:'merkle',recipients:[3,4,5].map((n,i)=>({account:address(n),weight:i+1}))});
 for(const row of plan.proofs){let hash=queueAccessLeaf({chainId:plan.chainId,queue:plan.queue,access:plan.access,policy:plan.policyId,...row});
  for(const sibling of row.proof)hash=keccak256(concatHex(hash.toLowerCase()<sibling.toLowerCase()?[hash,sibling]:[sibling,hash]));assert.equal(hash,plan.policy.root);
 }
 const row=plan.proofs[0],fields={chainId:plan.chainId,queue:plan.queue,access:plan.access,policy:plan.policyId,...row};
 const leaf=queueAccessLeaf(fields);for(const change of [{queue:address(99)},{policy:4},{account:address(99)},{weight:100},{chainId:1}])assert.notEqual(queueAccessLeaf({...fields,...change}),leaf);
});
test('NFT token policies preserve cross-wallet token usage and exact token conditions',()=>{
 const plan=planQueueAccess({...base,gate:'erc721-exact-token',source:address(9),requiredTokenId:'42',tokenUses:1,recipients:[{account:address(3),weight:10,tokenId:'42'}]});
 assert.equal(plan.policy.requiredTokenId,42n);assert.equal(plan.policy.tokenUses,1);assert.equal(plan.proofs.length,1);
 assert.throws(()=>planQueueAccess({...base,gate:'erc721-balance',source:address(9),tokenUses:1,recipients:[]}));
});
test('rejects malformed, contradictory and oversized campaigns',()=>{
 for(const change of [{weight:101},{maxQuantity:0},{walletUses:-1},{end:0},{skip:'true'},{recipients:[{account:address(3)},{account:address(3)}]},{recipients:Array.from({length:4097},(_,i)=>({account:address(i+10)}))},{gate:'erc721-token',source:address(9),recipients:[{account:address(3),weight:99,tokenId:1}]}])assert.throws(()=>planQueueAccess({...base,...change}));
});
