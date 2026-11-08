// Relevant F1 and F5 regressions from review/K1 (57333e9); F1 now requires a full block.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifyPosition,validateChallenge} from '../src/challenge/index.mjs';
import * as M from '../src/core.ts';
const load=name=>JSON.parse(readFileSync(new URL(`../spec/vectors/${name}.json`,import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest(), dsha=b=>sha(sha(b));
const h=s=>sha(Buffer.from(s));
const header=root=>{const x=Buffer.alloc(80);root.copy(x,36);return x;};
const mintCase=id=>structuredClone(load('mint').cases.find(x=>x.id===id).input);

// R13/R47/D14: a txid branch proves the transaction's position. Bitcoin's odd-node duplication must not let the last
// transaction of an odd level be "proven" one index further on (CVE-2012-2459 shape): its sibling equals itself.
test('R13/R47/D14: a duplicated odd node cannot prove a second, later txIndex', () => {
  const [a,b,c]=[h('a'),h('b'),h('c')], ab=dsha(Buffer.concat([a,b])), cc=dsha(Buffer.concat([c,c]));
  const hdr=header(dsha(Buffer.concat([ab,cc]))), hostHashes={7:dsha(hdr).toString('hex')};
  const entry={txid:c.toString('hex'),height:7};
  const real={header:hdr.toString('hex'),mint:entry.txid,height:7,txIndex:2,total:3,branch:[c.toString('hex'),ab.toString('hex')]};
  assert.equal(verifyPosition(real,{...entry,txIndex:2},hostHashes),false,'a branch without authenticated total is insufficient');
  const forged={...real,txIndex:3,total:4};
  assert.equal(verifyPosition(forged,{...entry,txIndex:3},hostHashes),false,'the same transaction at txIndex 3 must not verify');
});

// R36/R47: the consequence of the same forgery. Position evidence is all that separates a real mint from an
// "invalid: wrong position" claim, so a forged index must not let a challenge delete a correctly placed member.
test('R36/R47: a forged duplicate-node position cannot challenge a correctly indexed mint out', () => {
  const [a,b,c]=[h('a'),h('b'),h('c')], ab=dsha(Buffer.concat([a,b])), cc=dsha(Buffer.concat([c,c]));
  const hdr=header(dsha(Buffer.concat([ab,cc]))), hostHashes={7:dsha(hdr).toString('hex')}, txid=c.toString('hex');
  const cache={r:'r',id:'idx',h:9,entries:[{txid,height:7,txIndex:2}]};
  const challenge={r:'r',index:'idx',kind:'invalid',mint:txid,header:hdr.toString('hex'),height:7,txIndex:3,total:4,branch:[txid,ab.toString('hex')]};
  const resolve=()=>({entry:{txid,height:7,txIndex:3},validity:'valid'});
  assert.equal(validateChallenge(challenge,cache,resolve,hostHashes),false,'a real member at txIndex 2 must not be removable');
});

// R6/R27: collection needs the treasury and two of three distinct writers. A treasury key equal to a writer key turns
// L_t into treasury plus one writer.
test('R6/R27: the treasury key cannot also be a writer key', () => {
  const input=mintCase('valid'), r=input.recipe;
  assert.deepEqual(M.recipeCheck(r,input.refs),[],'fixture recipe is valid');
  r.payment.treasuryKey=r.payment.writerKeys[0];
  assert.ok(M.recipeCheck(r,input.refs).includes('escrow'),'treasury == w1 must be rejected');
});


test('F1: full block binds count, transaction and non-mutated Merkle tree', () => {
  const v=load('transaction-order').cases[0].input;
  const entry=v.entries[2];
  const base={...entry.proof,rawBlock:v.blocks[entry.height]};
  const vectors=JSON.parse(readFileSync(new URL('./vectors/review-K1.json',import.meta.url)));
  for (const c of vectors.position) {
    if (c.mutation === '64-byte-transaction') continue;
    const p=structuredClone(base), e={...entry};
    if(c.mutation==='missing-block') delete p.rawBlock;
    if(c.mutation==='forged-last') { p.total=4; p.txIndex=3; e.txIndex=3; }
    if(c.mutation==='duplicate-real-sibling') { p.txIndex=0; e.txIndex=0; p.mint=e.txid=v.entries[0].txid; p.branch=structuredClone(v.entries[0].proof.branch); p.branch[0]=p.mint; }
    if(c.mutation==='duplicated-last-block') {
      const raw=Buffer.from(p.rawBlock,'hex'); let cursor=81, last;
      for(let i=0;i<3;i++) { const parsed=M.parseTx(raw,cursor); last=raw.subarray(cursor,parsed.end); cursor=parsed.end; }
      p.rawBlock=Buffer.concat([raw.subarray(0,80),Buffer.from([4]),raw.subarray(81),last]).toString('hex');
      p.total=4; p.txIndex=3; e.txIndex=3;
    }
    if(c.mutation==='altered-block') p.rawBlock=p.rawBlock.slice(0,-2)+(p.rawBlock.endsWith('00')?'01':'00');
    assert.equal(verifyPosition(p,e,v.hostHashes),c.valid,c.id);
  }
});

test('F5: all treasury and writer keys must be distinct', () => {
  const vectors=JSON.parse(readFileSync(new URL('./vectors/review-K1.json',import.meta.url)));
  for (const c of vectors.escrow) {
    const {recipe:r,refs}=mintCase('valid');
    if(c.mutation.startsWith('treasury-writer-')) r.payment.treasuryKey=r.payment.writerKeys[Number(c.mutation.at(-1))];
    if(c.mutation==='duplicate-writers') r.payment.writerKeys[1]=r.payment.writerKeys[0];
    assert.equal(!M.recipeCheck(r,refs).includes('escrow'),c.valid,c.id);
  }
});

test('F1: rejects a 64-byte stripped transaction even with a matching header', () => {
  const tx={inputs:[{txid:'11'.repeat(32),vout:0,scriptSig:'',sequence:0xffffffff,witness:[]}],outputs:[{value:1,script:'51515151'}],version:2,locktime:0};
  const bytes=M.serializeTx(tx,false);
  assert.equal(bytes.length,64);
  const txid=M.parseTx(bytes).txid, hdr=header(Buffer.from(txid,'hex'));
  const proof={mint:txid,height:7,txIndex:0,total:1,branch:[],header:hdr.toString('hex'),rawBlock:Buffer.concat([hdr,Buffer.from([1]),bytes]).toString('hex')};
  assert.equal(verifyPosition(proof,{txid,height:7,txIndex:0},{7:dsha(hdr).toString('hex')}),false);
});

test('F1: authenticated omitted challenge passes but forged position cannot remove a member', () => {
  const v=load('transaction-order').cases[0].input, entry=v.entries[2];
  const proof={...entry.proof,rawBlock:v.blocks[entry.height]};
  const cache={r:'r',id:'idx',h:101,entries:[]};
  const resolve=()=>({entry,validity:'valid'});
  assert.equal(validateChallenge({...proof,r:'r',index:'idx',kind:'omitted'},cache,resolve,v.hostHashes),true);
  const forged={...proof,r:'r',index:'idx',kind:'invalid',txIndex:3,total:4};
  const original={...cache,entries:[entry]};
  assert.equal(validateChallenge(forged,original,()=>({entry:{...entry,txIndex:3},validity:'valid'}),v.hostHashes),false);
});
