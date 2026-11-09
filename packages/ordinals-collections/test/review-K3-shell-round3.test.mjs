// Independent K3-T01 round-3 review (ticket/K3-T01 at ff26091). Findings: ordinals-orchestra/sprints/KOC1/K3/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample} from '../src/shell/index.mjs';
import {b,hex,reverse,publicPoint,envelope,escrow,marker} from '../src/core.ts';
const key=publicPoint(6);

// R48: the sample seed is hashes[C], but C is the height the writers themselves cover, so the seed is known (and
// choosable) when they write their rows. The member count still comes from unverified corroborated claims. Exactly q
// writers can therefore pad 200 real prior members with 801 non-mint rows, read the seed, and lay the rows out so the
// 64 sampled positions all land on real mints: 1001 claimed prior rows, sampled, nothing invalid is ever checked.
test('R48: a seed known to the writers at write time cannot let q writers pad 200 real members past 1000', async t => {
  const f=fixture({count:200,writers:0}), N=1001, real=200;
  const seed=hex(reverse(f.mock.routes.get('/r/blockhash/106')));
  const S=new Set(positionSample(Array.from({length:N},(_,i)=>i),N+1,64,seed));
  const isReal=new Set(S);for(let k=0;isReal.size<real;k++) isReal.add(k);
  let next=0;const block=[];
  for(let k=0;k<N;k++) block.push(isReal.has(k)?f.mints[next++]:f.mock.add({metadata:{p:'koc1',op:'note'},height:100}));
  f.mock.block(100,block);
  const metadata={p:'koc1',op:'mint',r:b(f.r.id),m:b(key)};
  const self=f.mock.add({metadata,script:envelope(metadata,f.r.art.viewer.id),height:101,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(f.r.payment,key).scriptPubKey},{value:0,script:marker(f.r.id)}]});
  f.mock.block(101,[self]);
  const rows=block.map((x,i)=>({txid:x.txid,height:100,txIndex:i,m:key,paymentOutpoint:x.txid+'00000001'}));
  for(let w=0;w<2;w++) {
    const first=addUpdate(f.mock,f.r,f.authorities[w].id,rows.slice(0,1000),{h:100});
    addUpdate(f.mock,f.r,f.authorities[w].id,rows,{prev:first.id,prevRoot:first.metadata.root,new:rows.slice(1000)});
  }
  await f.mock.start();t.after(()=>f.mock.close());
  const v=await verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(self.id)},checkWork:false});
  assert.equal(v.status,'member');
  assert.equal(v.entryAssurance,'exhaustive','201 real members must be checked exhaustively');
  assert.equal(v.rank,201,'unchecked non-mint rows shift the token rank');
});
