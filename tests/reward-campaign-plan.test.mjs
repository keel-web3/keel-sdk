import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,encodeAbiParameters,concatHex} from 'viem';
import {rewardPlan} from '../tools/keel/lib/reward-plan.mjs';
const claims='0x0000000000000000000000000000000000000011',wallet='0x0000000000000000000000000000000000000022';
const context={chainId:31337,claims,nextId:3};
const base={gate:'public',start:0,end:9999999999,walletClaims:1,supply:100,pool:[{benefit:1}]};
test('campaign plan preserves limits and supplies default or custom rarity weights',()=>{
 const p=rewardPlan({...base,random:true,noDuplicates:true,pool:[{benefit:1},{benefit:2,weight:1},{benefit:3,weight:0}]},context);
 assert.deepEqual(p.weights,[100,1,100]);assert.equal(p.terms.supply,100);assert.equal(p.terms.walletClaims,1);assert.equal(p.terms.issued,0);
});
test('Merkle proofs are bound to chain, contract and reviewed campaign ID',()=>{
 const wallets=[wallet,'0x0000000000000000000000000000000000000033','0x0000000000000000000000000000000000000044'];
 const p=rewardPlan({...base,gate:'merkle',wallets},context);
 for(const account of wallets){
  let hash=keccak256(keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint32'},{type:'address'}],[31337n,claims,3,account])));
  for(const sibling of p.proofs[account])hash=keccak256(concatHex(hash<sibling?[hash,sibling]:[sibling,hash]));
  assert.equal(hash,p.terms.root);
 }
 assert.notEqual(rewardPlan({...base,gate:'merkle',wallets},{...context,nextId:4}).terms.root,p.terms.root);
 assert.notEqual(rewardPlan({...base,gate:'merkle',wallets},{...context,chainId:1}).terms.root,p.terms.root);
});
test('invalid eligibility and ambiguous pools are rejected before any chain call',()=>{
 for(const input of [
  {...base,gate:'unknown'},
  {...base,source:claims},
  {...base,gate:'wallets',source:claims,paused:true,wallets:[wallet]},
  {...base,gate:'merkle',source:claims,wallets:[wallet]},
  {...base,gate:'token'},
  {...base,gate:'achievement',source:claims},
  {...base,gate:'wallets',wallets:[]},
  {...base,gate:'wallets',paused:false,wallets:[wallet]},
  {...base,gate:'merkle',wallets:['0x0000000000000000000000000000000000000000']},
  {...base,gate:'wallets',paused:true,wallets:['0x0000000000000000000000000000000000000000']},
  {...base,end:0},
  {...base,walletClaims:0},
  {...base,random:true,noDuplicates:true,walletClaims:2,pool:[{benefit:1}]},
  {...base,pool:[{benefit:1},{benefit:2}]},
  {...base,random:true,pool:[{benefit:1},{benefit:1}]},
  {...base,random:'yes'}
 ])assert.throws(()=>rewardPlan(input,context));
});
test('wallet-list plan exposes mutable setup policy and bounded batches',()=>{
 const wallets=Array.from({length:257},(_,i)=>`0x${(i+1).toString(16).padStart(40,'0')}`);
 const p=rewardPlan({...base,gate:'wallets',paused:true,wallets},context);
 assert.deepEqual(p.walletBatches.map(b=>b.length),[256,1]);assert.equal(Object.keys(p.proofs).length,0);
 assert.deepEqual(p.walletListPolicy,{mutable:true,initialPaused:true});
 assert.throws(()=>rewardPlan({...base,gate:'wallets',wallets:[wallet,wallet]},context));
});
test('recipient lists are bounded for both mutable wallet setup and Merkle proofs',()=>{
 const wallets=Array.from({length:4097},(_,i)=>`0x${(i+1).toString(16).padStart(40,'0')}`);
 assert.throws(()=>rewardPlan({...base,gate:'wallets',paused:true,wallets},context),/4096/u);
 assert.throws(()=>rewardPlan({...base,gate:'merkle',wallets},context),/4096/u);
});
