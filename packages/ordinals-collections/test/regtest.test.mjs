import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,statfs} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';
import {xOnly,keyOutput,buildCommit,buildReveal,mintTemplate,buildCancel,bumpRbf,buildCpfp,signTransaction,parseTx,authenticateCommit,escrowTemplate,buildEscrowSpend,unsignedPsbt,formCheck} from '../src/index.ts';
const keys=[1,2,3,4,5].map(n=>n.toString(16).padStart(64,'0'));
const [buyer,treasury,...writers]=keys.map(xOnly);
const payment={treasuryKey:treasury,writerKeys:writers,collectAfter:3,refundAfter:6,earlyRefund:true};
const script=keyOutput(buyer),tree=escrowTemplate(payment,buyer);
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
test('isolated regtest consensus and mempool matrix',{timeout:120000},async t=>{
 const disk=await statfs(tmpdir());assert.ok(Number(disk.bavail)*Number(disk.bsize)>30*1024**3,'30 GiB free required');
 const dir=await mkdtemp(join(tmpdir(),'koc1-K2-T01-')),port=await freePort();
 const daemon=spawn('/usr/local/bin/bitcoind',['-regtest',`-datadir=${dir}`,`-rpcport=${port}`,'-rpcbind=127.0.0.1','-rpcallowip=127.0.0.1','-listen=0','-connect=0','-dnsseed=0','-discover=0','-server=1','-txindex=1','-fallbackfee=0.00002','-printtoconsole=0']);
 let exited=false,cookie;const done=new Promise(resolve=>{daemon.on('exit',()=>{exited=true;resolve();});daemon.on('error',resolve);});
 async function rpc(method,params=[],wallet=false){const res=await fetch(`http://127.0.0.1:${port}/${wallet?'wallet/koc1':''}`,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(cookie).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const data=await res.json();if(data.error)throw Error(`${method}: ${data.error.message}`);return data.result;}
 t.after(async()=>{if(!exited){try{await rpc('stop');}catch{daemon.kill('SIGTERM');}await Promise.race([done,pause(5000)]);if(!exited){daemon.kill('SIGKILL');await done;}}await rm(dir,{recursive:true,force:true});});
 let ready=false;for(let i=0;i<200;i++){try{cookie=await readFile(join(dir,'regtest/.cookie'),'utf8');await rpc('getblockchaininfo');ready=true;break;}catch{if(exited)throw Error('private regtest exited');await pause(50);}}
 assert.ok(ready);assert.equal((await rpc('getblockchaininfo')).chain,'regtest');
 await rpc('createwallet',['koc1']);const mining=await rpc('getnewaddress',[],true),mine=n=>rpc('generatetoaddress',[n,mining]);await mine(101);
 async function address(key){const d=await rpc('getdescriptorinfo',[`rawtr(${key})`]);return(await rpc('deriveaddresses',[d.descriptor]))[0];}
 const buyerAddress=await address(script.slice(4)),escrowAddress=await address(tree.outputKey);
 const accept=async raw=>(await rpc('testmempoolaccept',[[Buffer.from(raw).toString('hex')]]))[0],send=raw=>rpc('sendrawtransaction',[Buffer.from(raw).toString('hex')]);
 async function fund(addr,s,value=100000){const id=await rpc('sendtoaddress',[addr,value/1e8],true),raw=(await rpc('gettransaction',[id],true)).hex,tx=parseTx(raw),vout=tx.outputs.findIndex(o=>o.script===s);assert.ok(vout>=0);return{txid:tx.txid,vout,...tx.outputs[vout],internalKey:buyer};}
 async function coin(){const u=await fund(escrowAddress,tree.scriptPubKey);await mine(1);return u;}
 const spend=(utxo,leaf,signers)=>signTransaction(buildEscrowSpend({payment,minter:buyer,leaf,utxo,outputScript:script,fee:1000}),signers);
 for(const[a,b]of[[2,3],[2,4],[3,4]])await t.test(`L_t writers ${a-1}+${b-1}: refused h+collectAfter-1, accepted h+collectAfter`,async()=>{const u=await coin(),raw=spend(u,'L_t',[keys[1],keys[a],keys[b]]);await mine(1);const before=await accept(raw);assert.equal(before.allowed,false);assert.match(before['reject-reason'],/non-BIP68-final/);await mine(1);assert.equal((await accept(raw)).allowed,true);await send(raw);await mine(1);});
 await t.test('L_m buyer only: refused h+refundAfter-1, accepted h+refundAfter',async()=>{const u=await coin(),raw=spend(u,'L_m',[keys[0]]);await mine(4);const before=await accept(raw);assert.equal(before.allowed,false);assert.match(before['reject-reason'],/non-BIP68-final/);await mine(1);assert.equal((await accept(raw)).allowed,true);await send(raw);await mine(1);});
 await t.test('L_t each single writer fails at maturity',async()=>{const u=await coin();await mine(2);for(const w of keys.slice(2)){const r=await accept(spend(u,'L_t',[keys[1],w]));assert.equal(r.allowed,false);assert.match(r['reject-reason'],/script/);}assert.equal((await accept(spend(u,'L_t',keys.slice(2)))).allowed,false);});
 await t.test('L_e each writer pair succeeds before refundAfter; missing writers or buyer fails',async()=>{const u=await coin();for(const pair of[[2,3],[2,4],[3,4]])assert.equal((await accept(spend(u,'L_e',[keys[0],...pair.map(i=>keys[i])]))).allowed,true);for(const signers of[[keys[0]],[keys[0],keys[2]],keys.slice(2)])assert.equal((await accept(spend(u,'L_e',signers))).allowed,false);await send(spend(u,'L_e',[keys[0],keys[2],keys[3]]));await mine(1);});
 const template=mintTemplate({recipe:'11'.repeat(32)+'00000000',viewer:'22'.repeat(32)+'00000000',minter:buyer});
 async function commitPlan(){const u=await fund(buyerAddress,script,200000);await mine(1);return buildCommit({template,inputs:[u],value:100000,changeScript:script,fee:1000});}
 await t.test('Core walletprocesspsbt independently signs and broadcasts a builder commit',async()=>{
   const addr=await rpc('getnewaddress',['','bech32m'],true), info=await rpc('getaddressinfo',[addr],true);
   const pub=info.pubkey ?? info.desc.match(/(?:\]|tr\()([0-9a-f]{64,66})\)/)?.[1];
   assert.ok(pub,'wallet internal key from descriptor');
   const internalKey=pub.slice(-64);assert.equal(keyOutput(internalKey),info.scriptPubKey);
   const u=await fund(addr,info.scriptPubKey,200000);u.internalKey=internalKey;await mine(1);
   const plan=buildCommit({template,inputs:[u],value:100000,changeScript:info.scriptPubKey,fee:1000});
   const signed=await rpc('walletprocesspsbt',[plan.psbt.toString('base64'),true,'DEFAULT',true],true);
   assert.equal(signed.complete,true);const final=await rpc('finalizepsbt',[signed.psbt]);assert.equal(final.complete,true);
   const tx=parseTx(final.hex);assert.ok(tx.inputs[0].witness[0].length>=128);
   assert.equal((await accept(Buffer.from(final.hex,'hex'))).allowed,true);await send(Buffer.from(final.hex,'hex'));await mine(1);
 });
 const revealPlan=commit=>buildReveal({commit,template,payment,recipientScript:script,price:20000,fee:1000,changeScript:script});
 await t.test('mint commit/reveal authenticates E1; PSBTs decode; reveal accepted',async()=>{const c=await commitPlan();assert.equal((await rpc('decodepsbt',[c.psbt.toString('base64')])).inputs.length,1);const raw=signTransaction(c,[keys[0]]);await send(raw);const r=revealPlan(raw);await rpc('decodepsbt',[r.psbt.toString('base64')]);const rr=signTransaction(r,[keys[0]]);assert.equal(authenticateCommit(rr,raw.toString('hex')),true);assert.equal((await accept(rr)).allowed,true);await send(rr);await mine(1);});
 await t.test('cancelled commit cannot reveal',async()=>{const raw=signTransaction(await commitPlan(),[keys[0]]);await send(raw);await mine(1);const reveal=signTransaction(revealPlan(raw),[keys[0]]),cancel=signTransaction(buildCancel({commit:raw,template,outputScript:script,fee:2000}),[keys[0]]);assert.equal((await accept(cancel)).allowed,true);await send(cancel);await mine(1);const r=await accept(reveal);assert.equal(r.allowed,false);assert.match(r['reject-reason'],/missing|spent/);});
 await t.test('RBF commit and reveal accepted; CPFP child accepted',async()=>{const c=await commitPlan(),raw=signTransaction(c,[keys[0]]);await send(raw);const bumped=signTransaction(bumpRbf(c,{fee:3000,changeIndex:1}),[keys[0]]);assert.equal((await accept(bumped)).allowed,true);await send(bumped);const r=revealPlan(bumped),reveal=signTransaction(r,[keys[0]]);await send(reveal);const plain=unsignedPsbt(r.tx,r.prevouts,r.paths);
 for(const changeIndex of [0,1,2])assert.throws(()=>bumpRbf(plain,{fee:4000,changeIndex}));
 const rr=signTransaction(bumpRbf(plain,{fee:4000,changeIndex:3}),[keys[0]]);
 const outBytes=o=>{const amount=Buffer.alloc(8);amount.writeBigUInt64LE(BigInt(o.value));const script=Buffer.from(o.script,'hex');return Buffer.concat([amount,Buffer.from([script.length]),script]);};
 for(const i of [0,1,2])assert.deepEqual(outBytes(parseTx(rr).outputs[i]),outBytes(r.tx.outputs[i]),`output ${i} bytes preserved`);
 assert.ok(authenticateCommit(rr,bumped.toString('hex')));
 const checked=formCheck({rawTx:rr,commitTx:bumped.toString('hex'),charms:[],recipe:{id:template.recipe,art:{viewer:{id:'22'.repeat(32)+'00000000'}},payment:{mode:'escrow',...payment},price:20000}});
 assert.equal(checked.error,undefined);
 assert.equal((await accept(rr)).allowed,true);await send(rr);for(const vout of [0,1,2])assert.throws(()=>buildCpfp({parent:rr,vout,anchorVout:vout,internalKey:buyer,outputScript:script,fee:30}));const child=signTransaction(buildCpfp({parent:rr,vout:3,internalKey:buyer,outputScript:script,fee:5000}),[keys[0]]);assert.equal((await accept(child)).allowed,true);await send(child);await mine(1);});
 await t.test('reveal-created L_m rejects a non-buyer and refunds at CSV maturity',async()=>{
   const commit=signTransaction(await commitPlan(),[keys[0]]);await send(commit);
   const raw=signTransaction(revealPlan(commit),[keys[0]]);await send(raw);await mine(1);
   const tx=parseTx(raw),utxo={txid:tx.txid,vout:1,...tx.outputs[1]};
   const refund=spend(utxo,'L_m',[keys[0]]);await mine(4);assert.equal((await accept(refund)).allowed,false);
   await mine(1);assert.equal((await accept(spend(utxo,'L_m',[keys[1]]))).allowed,false);
   assert.equal((await accept(refund)).allowed,true);await send(refund);await mine(1);
 });
 await t.test('L_t and L_e with all writer keys select two and are accepted by Core',async()=>{
   for(const leaf of ['L_t','L_e']){const u=await coin();if(leaf==='L_t')await mine(2);
     const raw=spend(u,leaf,keys);assert.equal(parseTx(raw).inputs[0].witness.slice(0,3).filter(Boolean).length,2);
     assert.equal((await accept(raw)).allowed,true);await send(raw);await mine(1);}
 });
});
