// Independent K3-T01 round-4 review (ticket/K3-T01 at 03ed16c). Findings: ordinals-orchestra/sprints/KOC1/K3/reports/claude-review.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample} from '../src/shell/index.mjs';
import {b,hex,reverse,sha,utf,publicPoint,envelope,escrow,marker} from '../src/core.ts';
const key=publicPoint(6);

// R53 says the candidate list, its order and its size are fixed before block H* exists. They are not: candidates are
// read through the union, which keeps the FIRST writer's variant of each txid. After hash(H*) is public, writer 0 lists
// a different variant (claimed coordinates after its own last row) of real rows it never listed. Those rows stop being corroborated, leave
// the candidate list (they are checked and stay members), and no candidate is added, so H* does not move. The attacker
// searches subsets offline until the same seed's sample misses every fake: 50 non-mint rows corroborated by writers 0
// and 1 become final members of a sampled verdict that was exhaustive (and caught them) one block earlier.
test('R53: a first-writer variant listed after hash(H*) cannot re-roll the sample on the same seed', async t => {
  const R=1000, K=50, N=R+K, f=fixture({count:R,writers:0});
  const [A,B,C]=f.authorities.map(a=>a.id);
  f.mock.routes.set('/r/blockhash/108',hex(reverse(sha(utf('block-108')))));f.mock.routes.set('/r/blockheight',108);
  const seed=hex(reverse(f.mock.routes.get('/r/blockhash/107'))); // honest updates confirm at 106, so H* = 107
  const all=Array.from({length:N},(_,i)=>i), S0=positionSample(all,N+1,64,seed);
  const fake=new Set(S0.slice(0,K));
  let next=0;const block=all.map(i=>fake.has(i)?f.mock.add({metadata:{p:'koc1',op:'note'},height:100}):f.mints[next++]);
  f.mock.block(100,block);
  const row=(x,i)=>({txid:x.txid,height:100,txIndex:i,m:key,paymentOutpoint:x.txid+'00000001'});
  const rows=block.map(row), reals=rows.filter((_,i)=>!fake.has(i)), fakes=rows.filter((_,i)=>fake.has(i));
  const metadata={p:'koc1',op:'mint',r:b(f.r.id),m:b(key)};
  const self=f.mock.add({metadata,script:envelope(metadata,f.r.art.viewer.id),height:101,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(f.r.payment,key).scriptPubKey},{value:0,script:marker(f.r.id)}]});
  f.mock.block(101,[self]);
  const headA=addUpdate(f.mock,f.r,A,fakes);                            // colluder, writer 0
  const firstB=addUpdate(f.mock,f.r,B,rows.slice(0,1000),{h:100});       // colluder, writer 1
  addUpdate(f.mock,f.r,B,rows,{prev:firstB.id,prevRoot:firstB.metadata.root,new:rows.slice(1000)});
  addUpdate(f.mock,f.r,C,reals);                                         // honest, writer 2
  await f.mock.start();t.after(()=>f.mock.close());
  const load=()=>verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(self.id)},checkWork:false});
  const before=await load();
  assert.equal(before.sampleSeed.height,107);
  assert.equal(before.entryAssurance,'exhaustive');assert.equal(before.rank,R+1); // the sample caught a fake
  // Offline search over the now-public seed for real rows to shadow.
  let s=1,X;const rnd=()=>(s=(s*48271)%2147483647)/2147483647;
  const realIdx=all.filter(i=>!fake.has(i));
  for(let tries=0;tries<100000&&!X;tries++) {
    const pick=new Set(Array.from({length:20},()=>realIdx[Math.floor(rnd()*realIdx.length)]));
    const left=all.filter(i=>!pick.has(i));
    if(positionSample(left,left.length+1,64,seed).every(i=>!fake.has(i))) X=pick;
  }
  assert.ok(X,'search found a shadow set');
  // Writer chains append in position order, so the variants claim positions after every row writer 0 listed.
  const variants=[...X].sort((a,b)=>a-b).map((i,j)=>({...rows[i],txIndex:N+j}));
  addUpdate(f.mock,f.r,A,[...fakes,...variants],{at:108,prev:headA.id,prevRoot:headA.metadata.root,new:variants});
  const after=await load();
  assert.equal(after.sampleSeed.height,107,'no candidate was added, so H* did not move');
  assert.equal(after.entryAssurance,'exhaustive','the same seed must not yield a fake-free sample after re-rolling');
  assert.equal(after.rank,R+1,'fake prior rows shift the token rank');
});
