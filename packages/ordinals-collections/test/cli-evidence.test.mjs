import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {serializeTx,parseTx} from '../src/tx.ts';
import {indexState} from '../src/end.ts';
const sha=b=>createHash('sha256').update(b).digest();
test('CLI proves an invalid marker from a transaction bound to a header',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'koc1-cli-'));
 try{
  const raw=serializeTx({inputs:[{txid:'00'.repeat(32),vout:0,scriptSig:'',witness:[]}],outputs:[{value:330,script:'51'}]}).toString('hex');
  const txid=parseTx(raw).txid,header=Buffer.alloc(80);Buffer.from(txid,'hex').copy(header,36);
  const fixture=JSON.parse((await import('node:fs')).readFileSync(new URL('../spec/vectors/numbering-controls-roots.json',import.meta.url))).cases[0].input;
  const hash=sha(sha(header)).toString('hex'),recipe=fixture.recipe.id,index='02'.repeat(36);
  const c={r:recipe,index,kind:'invalid',mint:txid,height:100,txIndex:0,total:1,branch:[],header:header.toString('hex'),rawBlock:Buffer.concat([header,Buffer.from([1]),Buffer.from(raw,'hex')]).toString('hex')};
  const payload={recipe:fixture.recipe,refs:fixture.refs,cache:{r:recipe,id:index,entries:[{txid,height:100,txIndex:0}]},entries:{[txid]:{rawTx:raw,height:100,txIndex:0}},hostHashes:{100:hash},challenge:c};
  const path=join(dir,'evidence.json');writeFileSync(path,JSON.stringify(payload));
  const run=()=>spawnSync(process.execPath,[new URL('../bin/keel-ordinals.mjs',import.meta.url).pathname,'challenge','verify',path],{encoding:'utf8'});
  let r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).valid,true);
  payload.hostHashes[100]='ff'.repeat(32);writeFileSync(path,JSON.stringify(payload));r=run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).valid,false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('CLI validates an omitted mint and refuses a forged branch',async()=>{
 const {readFileSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'koc1-cli-'));
 try{
  const read=n=>JSON.parse(readFileSync(new URL(`../spec/vectors/${n}.json`,import.meta.url)));
  const input=read('challenges').cases[0].input, state=read('numbering-controls-roots').cases[0].input;
  const candidates=Object.fromEntries(state.candidates.map(c=>[parseTx(c.rawTx).txid,c]));
  const item=candidates[input.challenge.mint], tx=parseTx(item.rawTx), header=Buffer.alloc(80);Buffer.from(tx.txid,'hex').copy(header,36);
  const proof={...input.challenge,header:header.toString('hex'),rawBlock:Buffer.concat([header,Buffer.from([1]),Buffer.from(item.rawTx,'hex')]).toString('hex'),total:1,txIndex:0,branch:[]};
  item.txIndex=0;const hostHashes={...input.hostHashes,[item.height]:sha(sha(header)).toString('hex')};
  const payload={...input,refs:state.refs,entries:candidates,history:[],challenge:proof,hostHashes};const path=join(dir,'evidence.json');writeFileSync(path,JSON.stringify(payload));
  const run=()=>spawnSync(process.execPath,[new URL('../bin/keel-ordinals.mjs',import.meta.url).pathname,'challenge','verify',path],{encoding:'utf8'});
  let r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).valid,true);
  const over=structuredClone(payload), earlier=state.candidates.find(x=>x.height===item.height&&parseTx(x.rawTx).txid!==tx.txid&&!x.charms.length);
  const other=structuredClone(earlier);other.txIndex=0;over.entries[tx.txid].txIndex=1;other.id='earlier';over.history=[other];over.recipe.end.max=1;
  const otherId=parseTx(other.rawTx).txid, pair=sha(sha(Buffer.concat([Buffer.from(otherId,'hex'),Buffer.from(tx.txid,'hex')]))), header2=Buffer.alloc(80);pair.copy(header2,36);
  over.challenge={...over.challenge,txIndex:1,total:2,branch:[otherId],header:header2.toString('hex'),rawBlock:Buffer.concat([header2,Buffer.from([2]),Buffer.from(other.rawTx,'hex'),Buffer.from(item.rawTx,'hex')]).toString('hex')};
  over.hostHashes[item.height]=sha(sha(header2)).toString('hex');writeFileSync(path,JSON.stringify(over));r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).valid,true);
  const overState=indexState(over.recipe,state.refs,[other,{...over.entries[tx.txid],id:tx.txid}],over.cache.h,over.cache.hash,[]);
  assert.ok(overState.refund.some(x=>x.txid===tx.txid&&x.reason==='over-cap'));assert.ok(!overState.members.some(x=>x.txid===tx.txid));
  payload.controls=[{id:'pause',p:'koc1',op:'control',r:input.recipe.id,parent:input.recipe.id,height:item.height-2,action:'pause',at:item.height}];
  writeFileSync(path,JSON.stringify(payload));r=run();assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).valid,true);
  const projected=indexState(input.recipe,state.refs,[{...item,id:tx.txid}],input.cache.h,input.cache.hash,payload.controls);
  assert.ok(projected.refund.some(x=>x.txid===tx.txid && x.reason==='paused'));assert.equal(projected.members.length,0);
  payload.controls=[];payload.challenge.rawBlock=payload.challenge.rawBlock.slice(0,-2)+'ff';writeFileSync(path,JSON.stringify(payload));r=run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).valid,false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
