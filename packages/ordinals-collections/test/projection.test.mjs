import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formCheck,indexState} from '../src/core.ts';
import {classifyEntries} from '../src/index/classify.mjs';
import {indexRoot} from '../src/index/root.mjs';
import {writerChain,merge} from '../src/merge/index.mjs';
const data=JSON.parse(readFileSync(new URL('../spec/vectors/numbering-controls-roots.json',import.meta.url)));
test('canonical projection agrees with validated state on control, cap and window vectors',()=>{
 for(const {id,input} of data.cases){
  const {recipe,refs,candidates,controls}=structuredClone(input);
  if(recipe.end.mode === "time" && recipe.end.max === undefined)recipe.metadata.cycle=true;
  const entries=candidates.map(x=>({...formCheck({...x,recipe,refs}),id:x.id})).filter(x=>!x.error&&x.height!==null);
  for(const {height,hash} of input.heights){
   const canonical=indexState(recipe,refs,candidates,height,hash,controls);
   const projected=classifyEntries(entries,recipe,controls,height);
   const root=indexRoot({recipe:recipe.id,height,blockhash:hash,members:projected.members,refunds:projected.refund});
   assert.equal(root.indexRoot,canonical.indexRoot,`${id} ${height}`);
  }
 }
});
test('writer requires recipe policy and accepts late-refund canonical root',()=>{
 const recipe='11'.repeat(36),hash='22'.repeat(32),mk=(txid,height)=>({txid:txid.repeat(32),height,txIndex:1,m:'33'.repeat(32),paymentOutpoint:txid.repeat(32)+'00000001'});
 const entries=[mk('01',100),mk('02',115)],root=indexRoot({recipe,height:120,blockhash:hash,members:[entries[0]],refunds:[entries[1]]});
 const u={id:'u1',p:'koc1',op:'index',parent:'w',r:recipe,prev:null,prevRoot:null,h:120,hash,new:entries,root:root.indexRoot,count:1,over:1};
 assert.deepEqual(writerChain([u],{authority:'w',recipe,hostHashes:{120:hash}}).accepted,[]);
 assert.deepEqual(writerChain([u],{authority:'w',recipe,hostHashes:{120:hash},policy:{id:recipe,end:{mode:'time',open:100,close:110}}}).accepted,['u1']);
});
test('quorum needs distinct writers and rejects q=1',()=>{
 assert.throws(()=>merge({originals:[],q:1,W:1,verifyEntry:()=>true}));
 const w={authority:'writer',usable:true,h:10,entries:[]};
 assert.equal(merge({originals:[w,w],q:2,W:1,verifyEntry:()=>true,policy:{writers:[{authority:'writer'}]}}).C,null);
});
test('merge retains only eligible member numbers under pause, close and cap',()=>{
 const recipe='11'.repeat(36),policy={id:recipe,end:{mode:'first',open:100,close:103,max:2},controls:{notice:1,pausable:true},writers:[{authority:'a'},{authority:'b'}]};
 const row=(n,height)=>({id:`m${n}`,txid:n.toString(16).padStart(64,'0'),height,txIndex:n});
 const rows=[row(1,100),row(2,101),row(3,102),row(4,103),row(5,104)];
 const controls=[{id:'p',p:'koc1',op:'control',r:recipe,parent:recipe,height:99,action:'pause',at:101},{id:'r',p:'koc1',op:'control',r:recipe,parent:recipe,height:99,action:'resume',at:102}];
 const w=(authority)=>({authority,usable:true,h:110,entries:rows});
 const out=merge({originals:[w('a'),w('b')],q:2,W:1,verifyEntry:()=>true,policy,controls});
 assert.deepEqual(out.entries.map(x=>x.id),['m1','m3']);
 assert.deepEqual(out.refund.map(x=>[x.id,x.reason]),[['m2','paused'],['m4','late'],['m5','late']]);
});
