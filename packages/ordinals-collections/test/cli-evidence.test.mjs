import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {serializeTx,parseTx} from '../src/tx.ts';
const sha=b=>createHash('sha256').update(b).digest();
test('CLI proves an invalid marker from a transaction bound to a header',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'koc1-cli-'));
 try{
  const raw=serializeTx({inputs:[{txid:'00'.repeat(32),vout:0,scriptSig:'',witness:[]}],outputs:[{value:330,script:'51'}]}).toString('hex');
  const txid=parseTx(raw).txid,header=Buffer.alloc(80);Buffer.from(txid,'hex').copy(header,36);
  const fixture=JSON.parse((await import('node:fs')).readFileSync(new URL('../spec/vectors/numbering-controls-roots.json',import.meta.url))).cases[0].input;
  const hash=sha(sha(header)).toString('hex'),recipe=fixture.recipe.id,index='02'.repeat(36);
  const c={r:recipe,index,kind:'invalid',mint:txid,height:100,txIndex:0,total:1,branch:[],header:header.toString('hex')};
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
  const payload={...input,refs:state.refs,entries:candidates};const path=join(dir,'evidence.json');writeFileSync(path,JSON.stringify(payload));
  const run=()=>spawnSync(process.execPath,[new URL('../bin/keel-ordinals.mjs',import.meta.url).pathname,'challenge','verify',path],{encoding:'utf8'});
  let r=run();assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).valid,true);
  payload.challenge.branch[0]='00'.repeat(32);writeFileSync(path,JSON.stringify(payload));r=run();assert.equal(r.status,1);assert.equal(JSON.parse(r.stdout).valid,false);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
