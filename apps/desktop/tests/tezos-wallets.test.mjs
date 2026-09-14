import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { getPkhfromPk } from '@taquito/utils';
import { TezosWallets, TEZOS_MAINNET, beaconNetwork, tezosAccount, tezosMessage, matchTezosReceipt, normalizeTezosOperation } from '../src/tezos-wallets.mjs';
import { tezosHandoff } from '../src/wallet-pages.mjs';
const publicKey='edpkuNjKKT48xBoT5asPrWdmuM1Yw8D93MwgFgVvtca8jb5pstzaCh';
const account={address:getPkhfromPk(publicKey),publicKey,accountIdentifier:'fixture',network:{type:'mainnet'},scopes:['operation_request','sign']};
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close()); const calls=[];
 const state={account:structuredClone(account),reject:false};
 const bridge=async(id,method,input)=>{calls.push({id,method,input});if(method==='account'||method==='connect')return state.account;if(method==='operation')throw Object.assign(Error('Declined'),{code:state.reject?'ABORTED_ERROR':'DISCONNECTED'});};
 const toolkit={estimate:{transfer:async()=>({gasLimit:100,storageLimit:5,suggestedFeeMutez:300,burnFeeMutez:1250}),originate:async()=>({gasLimit:200,storageLimit:9,suggestedFeeMutez:500,burnFeeMutez:2250})}};
 const encryption={encrypt:s=>Buffer.from(s),decrypt:b=>Buffer.from(b).toString()};
 const wallets=new TezosWallets(db,bridge,()=>TEZOS_MAINNET,encryption,async p=>{assert.equal(p.network,TEZOS_MAINNET.network)},()=>toolkit);
 return {wallets,state,calls,db,bridge,encryption,toolkit};
}
test('Tezos network and account identities are checked; handoffs stay in the supported wallet boundary',()=>{
 assert.equal(tezosAccount(account,TEZOS_MAINNET).address,account.address);
 assert.throws(()=>tezosAccount({...account,address:'tz1invalid'},TEZOS_MAINNET));
 assert.throws(()=>tezosAccount({...account,network:{type:'ghostnet'}},TEZOS_MAINNET),/different network/);
 const profile={...TEZOS_MAINNET,network:'NetXfixture',rpcUrl:'http://127.0.0.1:8732'};
 assert.equal(beaconNetwork(profile).type,'custom');
 assert.throws(()=>tezosAccount({...account,network:{type:'custom',rpcUrl:'http://127.0.0.1:9999'}},profile),/different network/);
 assert.equal(tezosHandoff('https://wallet.kukai.app/?type=tzip10&data=example'),'window');
 assert.equal(tezosHandoff('umami://?type=tzip10&data=example'),'external');
 for(const url of ['https://wallet.kukai.app.evil.com','file:///tmp/a','javascript:alert(1)','https://user:secret@wallet.kukai.app','evil://'])assert.equal(tezosHandoff(url),null);
 const message=tezosMessage(account.address,TEZOS_MAINNET.network,'fixture');
 assert.equal(parseInt(message.payload.slice(4,12),16),Buffer.byteLength(message.text));assert.equal(Buffer.from(message.payload.slice(12),'hex').toString(),message.text);
});
test('Tezos review simulates without signing, reserves once, and treats rejection separately from uncertainty',async t=>{
 const f=fixture(t);await f.wallets.connect('beacon','tezos-mainnet');
 const input={walletId:'beacon',label:'Fixture',destination:account.address,amountMutez:'0'};
 const review=await f.wallets.prepare(input);assert.deepEqual(review.estimate,{gas:'100',storage:'5',feeMutez:'300',storageBurnMutez:'1250'});assert.equal(f.calls.filter(c=>c.method==='operation').length,0);
 f.state.reject=true;await assert.rejects(f.wallets.send(review.id),/Declined/);assert.equal(f.wallets.get(review.id).record.status,'rejected');await assert.rejects(f.wallets.send(review.id),/already been used/);
 const second=await f.wallets.prepare(input);f.state.reject=false;await assert.rejects(f.wallets.send(second.id));assert.equal(f.wallets.get(second.id).record.status,'unknown');assert.equal(f.calls.filter(c=>c.method==='operation').length,2);
});
test('staged origination reviews use public estimation and retain the exact Beacon operation',async t=>{
 const f=fixture(t);await f.wallets.connect('beacon','tezos-mainnet');
 const operation={kind:'origination',balance:'0',script:{code:[{prim:'parameter',args:[{prim:'unit'}]},{prim:'storage',args:[{prim:'unit'}]},{prim:'code',args:[{prim:'CAR'}]}],storage:[{prim:'Unit'}]}};
 const review=await f.wallets.prepareOperation({walletId:'beacon',label:'Keel hold origination',operation});
 assert.deepEqual(review.operation,operation);assert.deepEqual(review.estimate,{gas:'200',storage:'9',feeMutez:'500',storageBurnMutez:'2250'});assert.equal(f.calls.filter(c=>c.method==='operation').length,0);
 assert.throws(()=>normalizeTezosOperation({...operation,privateKey:'no'}),/Secret-bearing field/);
 assert.throws(()=>normalizeTezosOperation({...operation,fee:'1'}),/Remove source/);
 const actual={...operation,source:account.address,metadata:{operation_result:{status:'applied'}}};
 assert.equal(matchTezosReceipt([actual],{address:account.address,publicKey,operation}),true);
 assert.equal(matchTezosReceipt([{kind:'transaction',source:account.address,destination:account.address,amount:'0'},actual],{address:account.address,publicKey,operation}),false);
});
test('changed Tezos identity and expired reviews cannot reach wallet approval',async t=>{
 const f=fixture(t);await f.wallets.connect('beacon','tezos-mainnet');const input={walletId:'beacon',label:'Fixture',destination:account.address,amountMutez:'1'};
 const review=await f.wallets.prepare(input);f.state.account.network={type:'custom',rpcUrl:'https://example.com'};await assert.rejects(f.wallets.send(review.id),/different network/);assert.equal(f.calls.filter(c=>c.method==='operation').length,0);
 f.state.account=structuredClone(account);const expired=await f.wallets.prepare(input);f.wallets.save({...expired,expiresAt:'2000-01-01'});await assert.rejects(f.wallets.send(expired.id),/expired/);
 const pending=await f.wallets.prepare(input);f.wallets.save({...pending,status:'awaiting-wallet'});const restored=new TezosWallets(f.db,f.bridge,()=>TEZOS_MAINNET,f.encryption);assert.equal(restored.get(pending.id).record.status,'unknown');assert.equal(f.calls.filter(c=>c.method==='operation').length,0);
});
test('Tezos receipt matching rejects extra transfers, swapped accounts, and changed parameters',()=>{
 const operation={kind:'transaction',destination:account.address,amount:'1',parameters:{entrypoint:'default',value:{prim:'Unit'}}};const record={address:account.address,publicKey,operation};const actual={...operation,source:account.address};
 assert.equal(matchTezosReceipt([actual],record),true);
 assert.equal(matchTezosReceipt([{kind:'reveal',source:account.address,public_key:publicKey},actual],record),true);
 assert.equal(matchTezosReceipt([actual,actual],record),false);
 assert.equal(matchTezosReceipt([{...actual,amount:'2'}],record),false);
 assert.equal(matchTezosReceipt([{...actual,parameters:{entrypoint:'burn',value:{prim:'Unit'}}}],record),false);
 assert.equal(matchTezosReceipt([{kind:'delegation'},actual],record),false);
});
test('Tezos receipt records inclusion, internal failure and reorganization without resubmitting',async t=>{
 const f=fixture(t);await f.wallets.connect('beacon','tezos-mainnet');const review=await f.wallets.prepare({walletId:'beacon',label:'Fixture',destination:account.address,amountMutez:'1'});
 f.wallets.save({...review,status:'submitted',hash:'fixture-operation'});
 const actual={...review.operation,source:review.address,metadata:{operation_result:{status:'applied'}}};
 let block={hash:'fixture-block',operations:[[{hash:'fixture-operation',contents:[actual]}]]};
 f.toolkit.rpc={getBlockHeader:async()=>({level:20}),getBlock:async()=>block,getBlockHash:async()=>block.hash};
 const included=await f.wallets.receipt(review.id);assert.equal(included.status,'included');assert.equal(included.receipt.confirmations,1);
 actual.metadata.internal_operation_results=[{result:{status:'failed'}}];assert.equal((await f.wallets.receipt(review.id)).status,'failed');
 block={hash:'replacement-block',operations:[[]]};const missing=await f.wallets.receipt(review.id);assert.equal(missing.status,'submitted');assert.equal(missing.receipt,undefined);assert.equal(f.calls.filter(c=>c.method==='operation').length,0);
});
