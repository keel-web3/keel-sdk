// Independent K3-T01 round-2 review (ticket/K3-T01 at 77e2902). Findings: ordinals-orchestra/sprints/KOC1/K3/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample} from '../src/shell/index.mjs';
import {publicPoint} from '../src/core.ts';
const key=publicPoint(6);

// R48: all preceding entries are rechecked when there are <=1000 members. Round 2 decides sampling from rows that q
// writers corroborate, but never verifies the corroborated rows placed AFTER self. Exactly q writers can list 1001
// non-mint inscriptions after a token to force sampling, then hide fake prior rows at positions the deterministic
// evenly spaced sample skips. 200 real members: the token is misnumbered 203 and reported final.
test('R48: q-corroborated junk after self cannot force sampling and hide fake prior rows', async t => {
  const f=fixture({count:200,writers:0}), self=f.mints.at(-1);
  const priorLen=199+3, skip=new Set(positionSample(Array.from({length:priorLen},(_,i)=>i),1001));
  const block=f.mints.slice(0,-1);
  const slots=[];for(let k=1;slots.length<3;k++) if(!skip.has(k)) slots.push(k);
  for(const k of slots) block.splice(k,0,f.mock.add({metadata:{p:'koc1',op:'note'},height:100}));
  block.push(self);f.mock.block(100,block);
  const after=Array.from({length:1001},()=>f.mock.add({metadata:{p:'koc1',op:'note'},height:101}));
  f.mock.block(101,after);
  const rows=[...block.map((x,i)=>({txid:x.txid,height:100,txIndex:i})),...after.map((x,i)=>({txid:x.txid,height:101,txIndex:i}))]
    .map(x=>({...x,m:key,paymentOutpoint:x.txid+'00000001'}));
  for(let w=0;w<2;w++) {
    const first=addUpdate(f.mock,f.r,f.authorities[w].id,rows.slice(0,1000),{h:101});
    addUpdate(f.mock,f.r,f.authorities[w].id,rows,{prev:first.id,prevRoot:first.metadata.root,new:rows.slice(1000)});
  }
  await f.mock.start();t.after(()=>f.mock.close());
  const v=await verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(self.id)},checkWork:false});
  assert.equal(v.status,'member');
  assert.equal(v.entryAssurance,'exhaustive','200 real members must be checked exhaustively');
  assert.equal(v.rank,200,'fake prior rows shift the token rank');
  assert.ok(v.merged.entries.length<=200,'non-mint notes are merged as members');
});
