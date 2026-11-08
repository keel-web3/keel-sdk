import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writerChain,merge} from '../src/merge/index.mjs';
import {validateChallenge,applyChallenge} from '../src/challenge/index.mjs';
import {indexRoot} from '../src/index/root.mjs';
const load=name=>JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`,import.meta.url)));
const resolve=entries=>id=>{const entry=entries[id];return entry ? {entry,validity:entry.valid===true?'valid':entry.valid===false?'invalid':'unknown'} : null};
test('challenge vectors',()=>{
 for(const {id,input,expected} of load('challenges').cases) {
  const get=resolve(input.entries), valid=validateChallenge(input.challenge,input.cache,get,input.hostHashes);
  assert.equal(valid,expected.valid,id);
  const rows=valid ? applyChallenge(input.cache.entries,input.challenge,get) : input.cache.entries;
  const cap=input.recipe.end.max ?? rows.length;
  let root;
  try { root=indexRoot({recipe:input.recipe.id,height:input.cache.h,blockhash:input.cache.hash,members:rows.slice(0,cap),refunds:rows.slice(cap)}); }
  catch (error) { assert.equal(valid,false,id); continue; }
  assert.equal(root.indexRoot,expected.patchedRoot,id);
 }
});
test('writer and quorum vectors',()=>{
 for(const {id,input,expected} of load('writers').cases) {
  const originals=input.writers.map((w,i)=>writerChain(w.updates,{authority:w.authority,recipe:input.recipe,hostHashes:input.hostHashes,pins:input.pins.filter(p=>p.writerIndex===i),cap:input.cap,resolveCorrection:cid=>{const c=input.corrections?.[cid];return c?.valid ? {valid:true,challenge:c.challenge,resolveEntry:resolve(c.entries)} : null}}));
  assert.deepEqual(originals.map(({entries,...rest})=>rest),expected.chains,id);
  assert.deepEqual(merge({originals,registry:input.registry,self:input.self,challenges:input.challenges,ch:input.ch,q:input.q,W:input.W,unresolved:input.unresolved,verifyEntry:x=>x.valid!==false}),expected.merged,id);
 }
});
