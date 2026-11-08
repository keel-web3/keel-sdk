// Independent K1 review, round 2 (review/K1 against c57bafc). Findings: ordinals-orchestra/sprints/KOC1/K1/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyPosition} from '../src/challenge/index.mjs';
import {merge} from '../src/merge/index.mjs';
import * as M from '../src/core.ts';

const load=name=>JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`,import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest(), dsha=b=>sha(sha(b));
const h=s=>sha(Buffer.from(s));
const header=root=>{const x=Buffer.alloc(80);root.copy(x,36);return x;};
const mintCase=id=>structuredClone(load('mint').cases.find(x=>x.id===id).input);

// R6/R40: only the recipe's original writer authorities vote. An authority label that is not in recipe.writers must
// not count toward C (it is at most a registry writer, which cannot vote).
test('R6/R40: merge counts only authorities named by the recipe', () => {
  const recipe=mintCase('valid').recipe, [w1]=recipe.writers.map(w=>w.authority);
  const chain=authority=>({authority,usable:true,h:150,entries:[]});
  const out=merge({originals:[chain(w1),chain('ff'.repeat(36))],q:2,W:1,verifyEntry:()=>true,policy:recipe});
  assert.equal(out.C,null,'one recipe writer plus an outsider must not reach quorum 2');
});

// R13: an unconfirmed candidate (height missing) is pending, like a missing txIndex, and never ranks.
test('R13: a candidate with no height is pending, not ranked', () => {
  const v=load('numbering-controls-roots').cases.find(x=>x.id==='supply-end').input;
  const last=Math.max(...v.candidates.map(x=>x.height));
  const hash=v.heights.find(x=>x.height===last)?.hash ?? '00'.repeat(32);
  const missing={...v.candidates[0],id:'no-height',height:undefined};
  const s=M.indexState(v.recipe,v.refs,[missing,...v.candidates.slice(1)],last,hash,v.controls);
  assert.ok(s.pending.includes('no-height'),'missing height must be pending');
  assert.ok(!s.members.some(x=>x.id==='no-height') && !s.refund.some(x=>x.id==='no-height'),'missing height must not rank');
});

// R35/R47: 64-byte transactions are consensus-valid today (BIP54 is not active). With the full block parsed, the
// inner-node ambiguity is already gone, so another 64-byte transaction in the block must not make an honest mint's
// position unprovable (a miner could otherwise make an omission unchallengeable).
test('R35/R47: a 64-byte transaction elsewhere in the block does not block an honest position proof', () => {
  const input=mintCase('valid'), mint=Buffer.from(input.rawTx,'hex'), mintTx=M.parseTx(mint);
  const small=M.serializeTx({inputs:[{txid:'11'.repeat(32),vout:0,scriptSig:'',sequence:0xffffffff,witness:[]}],outputs:[{value:1,script:'51515151'}],version:2,locktime:0},false);
  assert.equal(small.length,64);
  const smallId=M.parseTx(small).txid;
  const ids=[mintTx.txid,smallId].map(x=>Buffer.from(x,'hex'));
  const hdr=header(dsha(Buffer.concat(ids)));
  const proof={mint:mintTx.txid,height:7,txIndex:0,total:2,branch:[smallId],header:hdr.toString('hex'),rawBlock:Buffer.concat([hdr,Buffer.from([2]),mint,small]).toString('hex')};
  assert.equal(verifyPosition(proof,{txid:mintTx.txid,height:7,txIndex:0},{7:dsha(hdr).toString('hex')}),true);
});

test('R6/R40: merge fails without recipe writers and deduplicates authorized voters',()=>{
  assert.throws(()=>merge({originals:[],q:2,W:1,verifyEntry:()=>true}),/writers/);
  assert.throws(()=>merge({originals:[],q:2,W:1,verifyEntry:()=>true,policy:{writers:[]}}),/writers/);
  const policy={writers:[{authority:'a'},{authority:'b'}]};
  const chain=authority=>({authority,usable:true,h:150,entries:[]});
  assert.equal(merge({originals:[chain('a'),chain('a'),chain('outside')],q:2,W:1,verifyEntry:()=>true,policy}).C,null);
  assert.equal(merge({originals:[chain('a'),chain('b'),chain('outside')],q:2,W:1,verifyEntry:()=>true,policy}).C,150);
});
