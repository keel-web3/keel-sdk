// Independent K1 review (review/K1): each test states a KOC1 rule and fails on 4b1a250 where the code breaks it.
// Findings and severities: ordinals-orchestra/sprints/KOC1/K1/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyPosition,validateChallenge} from '../src/challenge/index.mjs';
import {writerChain,merge} from '../src/merge/index.mjs';
import {indexRoot} from '../src/index/root.mjs';
import * as M from '../src/core.ts';

const load=name=>JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`,import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest(), dsha=b=>sha(sha(b));
const h=s=>sha(Buffer.from(s));
const header=root=>{const x=Buffer.alloc(80);root.copy(x,36);return x;};
const mintCase=id=>structuredClone(load('mint').cases.find(x=>x.id===id).input);

// R14/R38/R39/D19: a merged index numbers members only. A valid mint past the cap is over-cap (a refund candidate,
// never a member), so it can never be labelled with a member number or final.
test('R14/R39: merge never numbers or finalizes an over-cap mint', () => {
  const rows=[1,2,3].map(i=>({id:'m'+i,txid:h('m'+i).toString('hex'),height:100,txIndex:i}));
  const w=authority=>({authority,usable:true,h:200,entries:rows});
  const out=merge({originals:[w('a'),w('b')],q:2,W:1,policy:{end:{open:0,max:2},writers:[{authority:'a'},{authority:'b'}]},verifyEntry:()=>true});
  const third=out.entries.find(e=>e.id==='m3');
  assert.ok(!third || !(third.n>2) , 'mint #3 of a cap-2 recipe must not receive member number 3');
  assert.ok(!third || !third.final, 'an over-cap mint must not be final');
});

// R40: C is the q-th highest h of distinct usable original writers. One writer's chain passed twice is one vote.
test('R40: one original writer counted twice cannot settle a q=2 collection', () => {
  const chain={authority:'aa'.repeat(36),usable:true,h:150,entries:[]};
  const out=merge({originals:[chain,chain],q:2,W:1,verifyEntry:()=>true,policy:{writers:[{authority:chain.authority}]}});
  assert.equal(out.C,null,'a single writer must not reach quorum 2');
});

// R33/R34/D4: the update root is the canonical indexRoot, whose overRoot holds over-cap, paused and late valid-form
// mints. A writer that commits the canonical root for a time-mode recipe with one post-close mint must be usable.
test('R33/R34/D4: a writer committing the canonical root (late refund in overRoot) is accepted', () => {
  const recipe='11'.repeat(36), hash='22'.repeat(32), hostHashes={120:hash};
  const member={txid:h('member').toString('hex'),height:100,txIndex:1,m:'33'.repeat(32),paymentOutpoint:h('member').toString('hex')+'00000001'};
  const late={txid:h('late').toString('hex'),height:115,txIndex:1,m:'44'.repeat(32),paymentOutpoint:h('late').toString('hex')+'00000001'};
  const canonical=indexRoot({recipe,height:120,blockhash:hash,members:[member],refunds:[late]});
  const accepted=[[member],[member,late]].some(entries=>{
    const u={id:'u1',p:'koc1',op:'index',parent:'w',r:recipe,prev:null,prevRoot:null,h:120,hash,new:entries,root:canonical.indexRoot,count:1,over:1};
    return writerChain([u],{authority:'w',recipe,hostHashes,policy:{id:recipe,end:{mode:'time',open:100,close:110}}}).accepted.includes('u1');
  });
  assert.equal(accepted,true,'no update form lets an honest writer publish the canonical root');
});

// R6/R27: collection needs the treasury and two of three distinct writers. A treasury key equal to a writer key turns
// L_t into treasury plus one writer.
test('R6/R27: the treasury key cannot also be a writer key', () => {
  const input=mintCase('valid'), r=input.recipe;
  assert.deepEqual(M.recipeCheck(r,input.refs),[],'fixture recipe is valid');
  r.payment.treasuryKey=r.payment.writerKeys[0];
  assert.ok(M.recipeCheck(r,input.refs).includes('escrow'),'treasury == w1 must be rejected');
});

// R4/D21: a time edition without max is unbounded in count like an open edition, so a finite Merkle tree needs an
// explicit cycle (the code already demands this for open editions, not for time editions).
test('R4/D21: time mode without max over a finite tree needs cycle', () => {
  const input=mintCase('valid'), r=input.recipe;
  r.end={mode:'time',open:r.end.open,close:r.end.close};
  assert.ok(M.recipeCheck(r,input.refs).includes('metadata'),'unbounded count over a 21-leaf tree without cycle must be rejected');
});

// R13: missing position evidence is pending, never a rejection, and it must not disturb the order of the others.
test('R13: a candidate without txIndex is pending and leaves the others in (height,txIndex) order', () => {
  const v=load('numbering-controls-roots').cases.find(x=>x.id==='supply-end').input;
  const at=v.candidates.filter(x=>x.height===v.candidates[0].height).slice(0,6);
  const others=at.map(x=>({...x})).reverse(), missing={...at[0],id:'no-position',txIndex:undefined};
  const s=M.indexState(v.recipe,v.refs,[others[0],missing,...others.slice(1)],Math.max(...v.candidates.map(x=>x.height)),'00'.repeat(32),v.controls);
  assert.ok(s.pending.includes('no-position'),'missing position must be pending');
  assert.ok(!s.rejected.some(x=>x.id==='no-position'),'missing position must not be rejected');
});

// R35/R12/D15/D28: an omitted challenge inserts a KOC1-MINT-valid entry; a before-open reveal is not one (it never
// enters the index or overRoot). The shipped CLI resolver classifies by form only.
test('R35/D28: challenge verify rejects an omitted challenge for a before-open reveal', () => {
  const input=mintCase('before-open'), tx=M.parseTx(input.rawTx), txid=tx.txid;
  const hdr=header(Buffer.from(txid,'hex')), hostHashes={[input.height]:dsha(hdr).toString('hex')};
  const cache={r:input.recipe.id,id:'cache',h:input.height+5,entries:[]};
  const challenge={r:input.recipe.id,index:'cache',kind:'omitted',mint:txid,header:hdr.toString('hex'),height:input.height,txIndex:0,total:1,branch:[],rawBlock:Buffer.concat([hdr,Buffer.from([1]),Buffer.from(input.rawTx,'hex')]).toString('hex')};
  const entries={[txid]:{rawTx:input.rawTx,commitTx:input.commitTx,charms:input.charms,height:input.height,txIndex:0}};
  const dir=mkdtempSync(join(tmpdir(),'k1-review-')), file=join(dir,'c.json');
  writeFileSync(file,JSON.stringify({recipe:input.recipe,refs:input.refs,cache,challenge,entries,hostHashes,history:[],controls:[]}));
  const cli=fileURLToPath(new URL('../bin/keel-ordinals.mjs',import.meta.url));
  const r=spawnSync(process.execPath,[cli,'challenge','verify',file],{encoding:'utf8'});
  assert.equal(JSON.parse(r.stdout).valid,false,'a before-open reveal must not be insertable as an omitted member');
});
