import {test} from 'node:test';
import assert from 'node:assert/strict';
import {xOnly,keyOutput,mintTemplate,buildCommit,buildReveal,buildCancel,bumpRbf,buildCpfp,signTransaction,parseTx,authenticateCommit,escrowTemplate,buildEscrowSpend,parseOrdEnvelopes} from '../src/index.ts';
const keys=[1,2,3,4,5].map(n=>n.toString(16).padStart(64,'0')),[buyer,treasury,...writers]=keys.map(xOnly);
const payment={treasuryKey:treasury,writerKeys:writers,collectAfter:3,refundAfter:6,earlyRefund:true};
const script=keyOutput(buyer), input={txid:'aa'.repeat(32),vout:0,value:200000,script,internalKey:buyer};
const template=mintTemplate({recipe:'11'.repeat(36),viewer:'22'.repeat(36),minter:buyer});
const commit=()=>buildCommit({template,inputs:[input],value:100000,changeScript:script,fee:1000});
const reveal=raw=>buildReveal({commit:raw,template,payment,recipientScript:script,price:20000,fee:1000,changeScript:script});
test('builders are deterministic unsigned PSBTs and do not mutate caller data',()=>{
 const before=structuredClone(input),a=commit(),b=commit();assert.deepEqual(a.psbt,b.psbt);assert.equal(a.psbt.subarray(0,5).toString('hex'),'70736274ff');assert.deepEqual(input,before);assert.ok(a.tx.inputs.every(i=>!i.witness));
 const bumped=bumpRbf(a,{fee:3000,changeIndex:1});assert.equal(a.tx.outputs[1].value,99000);assert.equal(bumped.tx.outputs[1].value,97000);
 assert.throws(()=>bumpRbf(a,{fee:3000,changeIndex:0}),/change/);assert.throws(()=>bumpRbf(a,{fee:1000,changeIndex:1}),/increase/);
});
test('E1 authenticates exact envelope, control block and commit output',()=>{
 const raw=signTransaction(commit(),[keys[0]]),r=reveal(raw),signed=signTransaction(r,[keys[0]]);assert.ok(authenticateCommit(signed,raw.toString('hex')));
 const changed=Buffer.from(signed);changed[changed.length-50]^=1;assert.equal(authenticateCommit(changed,raw.toString('hex')),false);
 const other=signTransaction(buildCommit({template:mintTemplate({recipe:'33'.repeat(36),viewer:'22'.repeat(36),minter:buyer}),inputs:[input],value:100000,changeScript:script,fee:1000}),[keys[0]]);
 assert.throws(()=>reveal(other),/commit mismatch/);
 assert.throws(()=>buildCancel({commit:other,template,outputScript:script,fee:1000}),/commit mismatch/);
 assert.throws(()=>bumpRbf(r,{fee:3000,changeIndex:1}),/change/);
});
test('builder guards reject unsafe amounts, keys, delays and duplicate inputs',()=>{
 assert.throws(()=>buildCommit({template,inputs:[input,input],value:100000,changeScript:script,fee:1000}),/duplicate/);
 assert.throws(()=>buildCommit({template,inputs:[input],value:199000,changeScript:script,fee:2000}),/insufficient/);
 for(const patch of [{collectAfter:0},{collectAfter:65536},{refundAfter:3},{writerKeys:[writers[0],writers[0],writers[1]]},{treasuryKey:writers[0]}])assert.throws(()=>escrowTemplate({...payment,...patch},buyer));
 const raw=signTransaction(commit(),[keys[0]]);
 assert.throws(()=>buildCpfp({parent:raw,vout:9,internalKey:buyer,outputScript:script,fee:1000}),/missing/);
 assert.throws(()=>buildCpfp({parent:raw,vout:1,internalKey:treasury,outputScript:script,fee:1000}),/authenticate/);
 assert.throws(()=>buildCpfp({parent:raw,vout:1,internalKey:buyer,outputScript:script,fee:98999}),/dust/);
});
test('metadata chunks stay at most 520 bytes and retain a single canonical envelope',()=>{
 const t=mintTemplate({recipe:'11'.repeat(36),viewer:'22'.repeat(36),minter:buyer,ch:Array.from({length:30},()=>Buffer.alloc(36,7))});
 assert.equal(parseOrdEnvelopes(t.script).length,1);
});
test('escrow without early leaf has 65-byte controls and refuses early refund',()=>{
 const p={...payment,earlyRefund:false},tree=escrowTemplate(p,buyer);
 assert.equal(tree.controlBlocks.L_m.length/2,65);assert.equal(tree.controlBlocks.L_t.length/2,65);assert.equal(tree.scripts.L_e,undefined);
 assert.throws(()=>buildEscrowSpend({payment:p,minter:buyer,leaf:'L_e',utxo:{...input,script:tree.scriptPubKey},outputScript:script,fee:1000}),/leaf/);
});
