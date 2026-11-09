// Independent K3-T01 review (review/K3-T01 at 530784a). Findings: ordinals-orchestra/sprints/KOC1/K3/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId} from '../src/shell/index.mjs';
import {b,publicPoint,envelope,escrow,marker} from '../src/core.ts';
const key=publicPoint(6);

// R39/R48: preceding entries are all rechecked for <=1000 members. The shell decides whether to sample from the
// UNVERIFIED union, so one original writer outside the quorum can list >1000 unrelated (non-mint) inscriptions before
// a real token, force sampling, and keep most of its fake rows: the token is misnumbered.
test('R39/R48: fake rows from one non-quorum writer cannot force sampling or shift the token rank', async t => {
  const f=fixture({writers:2}), {mock,r}=f;
  const meta={p:'koc1',op:'mint',r:b(r.id),m:b(key)};
  const self=mock.add({metadata:meta,script:envelope(meta,r.art.viewer.id),height:101,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(r.payment,key).scriptPubKey},{value:0,script:marker(r.id)}]});
  mock.block(101,[self]);
  const junk=Array.from({length:1001},()=>mock.add({metadata:{p:'koc1',op:'note'},height:100}));
  const fake=[...f.rows,...junk.map((x,i)=>({txid:x.txid,height:100,txIndex:i+1,m:key,paymentOutpoint:x.txid+'00000001'}))];
  const first=addUpdate(mock,r,f.authorities[2].id,fake.slice(0,1000),{h:106});
  addUpdate(mock,r,f.authorities[2].id,fake,{prev:first.id,prevRoot:first.metadata.root,new:fake.slice(1000)});
  await mock.start(); t.after(()=>mock.close());
  const v=await verifyShell({fetcher:mock.fetcher,location:{pathname:'/content/'+inscriptionId(self.id)},checkWork:false});
  assert.ok(v.originals[2].accepted.length===2,'fixture: the third writer chain is accepted');
  assert.equal(v.entryAssurance,'exhaustive','two real members must be checked exhaustively');
  assert.equal(v.rank,2,`self is the second real mint, got rank ${v.rank}`);
});

// R39/R40 with merge's own rule "unknown evidence must never become a member": a row claimed by one non-quorum
// writer whose transaction does not exist is unknown, so it must be excluded. Today the 404 is rethrown as
// IncompleteEvidence and every later token stays "settling" forever; no challenge can remove it, because an invalid
// challenge needs evidence of invalidity.
test('R39/R40: one non-quorum writer listing a nonexistent txid cannot hold every later token in settling', async t => {
  const {createHash}=await import('node:crypto');
  const f=fixture({writers:2}), {mock,r}=f;
  const meta={p:'koc1',op:'mint',r:b(r.id),m:b(key)};
  const self=mock.add({metadata:meta,script:envelope(meta,r.art.viewer.id),height:101,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(r.payment,key).scriptPubKey},{value:0,script:marker(r.id)}]});
  mock.block(101,[self]);
  const ghost=createHash('sha256').update('ghost').digest('hex');
  addUpdate(mock,r,f.authorities[2].id,[...f.rows,{txid:ghost,height:100,txIndex:1,m:key,paymentOutpoint:ghost+'00000001'}],{h:106});
  await mock.start(); t.after(()=>mock.close());
  const v=await verifyShell({fetcher:mock.fetcher,location:{pathname:'/content/'+inscriptionId(self.id)},checkWork:false});
  assert.equal(v.status,'member',`got ${v.status}: ${v.reasons.join('; ')}`);
  assert.equal(v.rank,2);
});
