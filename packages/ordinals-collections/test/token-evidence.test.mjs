import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseTx} from '../src/tx.ts';
import {formCheck} from '../src/mint.ts';
import {indexRoot} from '../src/index/root.mjs';
import {verifyTokenEvidence} from '../src/verify/token.mjs';
const load=n=>JSON.parse(readFileSync(new URL(`../spec/vectors/${n}.json`,import.meta.url)));
test('checks own form, proof and index but leaves external evidence pending',()=>{
 const c=load('challenges').cases[0].input, n=load('numbering-controls-roots').cases[0].input;
 const candidate=n.candidates.find(x=>parseTx(x.rawTx).txid===c.challenge.mint);
 const entry=formCheck({...candidate,recipe:c.recipe,refs:n.refs});assert.ok(!entry.error);
 const height=c.challenge.height,hash=c.hostHashes[height];
 const root=indexRoot({recipe:c.recipe.id,height,blockhash:hash,members:[entry],refunds:[]});
 const input={recipe:c.recipe,refs:n.refs,index:{height,hash,members:[entry],refunds:[],root:root.indexRoot},entries:{[entry.txid]:{...candidate,position:c.challenge}},hostHashes:c.hostHashes,token:entry.txid,tip:height+c.recipe.finality};
 const result=verifyTokenEvidence(input);assert.equal(result.evidenceValid,true);assert.equal(result.verified,false);assert.equal(result.rank,1);
 const forged=structuredClone(input);forged.entries[entry.txid].position.branch[0]='00'.repeat(32);
 assert.equal(verifyTokenEvidence(forged).checks.ownPosition,false);
});
