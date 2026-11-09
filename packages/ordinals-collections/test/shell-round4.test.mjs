// K3-T01 round 4: the R53 sample seed is the block after the sample candidates were committed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate,load} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample,positionSeedHeight} from '../src/shell/index.mjs';
import {hex,reverse,sha,utf} from '../src/core.ts';

const blockHash=h=>hex(reverse(sha(utf(`block-${h}`)))); // display order, as /r/blockhash serves it
const seedOf=h=>hex(reverse(blockHash(h))); // internal order, as the shell seeds with it
// Two writers list rows 0..999 in an update confirmed at 106, then rows 1000..1001
// (row 1000 is a prior candidate, 1001 is self) in an update confirmed at `late`.
function lateCandidate({late=108,tip=110}={}) {
  const f=fixture({count:1002,writers:0});
  for(let h=108;h<=120;h++)f.mock.routes.set(`/r/blockhash/${h}`,blockHash(h));
  f.mock.routes.set('/r/blockheight',tip);
  const heads=[];
  for(let w=0;w<2;w++) {
    const first=addUpdate(f.mock,f.r,f.authorities[w].id,f.rows.slice(0,1000),{h:100});
    heads.push(addUpdate(f.mock,f.r,f.authorities[w].id,f.rows,{prev:first.id,prevRoot:first.metadata.root,new:f.rows.slice(1000),at:late}));
  }
  return {...f,heads};
}
async function sampleOf(f,t) {
  await f.mock.start();t.after(()=>f.mock.close());
  const fetched=new Set(), prior=f.mints.slice(0,-1);
  const routes=new Map(prior.map((m,i)=>['/r/inscription/'+inscriptionId(m.id),i]));
  const fetcher=(path,options)=>{if(routes.has(path))fetched.add(routes.get(path));return f.mock.fetcher(path,options);};
  const v=await verifyShell({fetcher,location:{pathname:'/content/'+inscriptionId(f.self)},checkWork:false});
  return {v,sample:[...fetched].sort((a,b)=>a-b),prior};
}

test('R53 seed is the block after the latest candidate commitment, not C or the tip',async t=>{
  const f=lateCandidate({late:108,tip:110});
  const {v,sample,prior}=await sampleOf(f,t);
  assert.equal(v.status,'member');assert.equal(v.entryAssurance,'sampled');
  assert.deepEqual(v.sampleSeed,{height:109,hash:seedOf(109)});
  assert.deepEqual(sample,positionSample(prior.map((_,i)=>i),1002,64,seedOf(109)));
});

test('R53 a sampled verdict stays settling until the seed block exists',async t=>{
  const f=lateCandidate({late:108,tip:108});
  const {v}=await sampleOf(f,t);
  assert.equal(v.status,'settling');assert.equal(v.final,false);
  assert.deepEqual(v.sampleSeed,{height:109,hash:null});
  assert.match(v.reasons.join(' '),/sample seed block/);
});

test('R53 later per-block updates that add no candidate do not move the seed',async t=>{
  const f=lateCandidate({late:108,tip:115});
  for(let w=0;w<2;w++) {
    let prev=f.heads[w];
    for(const [h,at] of [[107,111],[107,113]]) prev=addUpdate(f.mock,f.r,f.authorities[w].id,f.rows,{h,at,prev:prev.id,prevRoot:prev.metadata.root,new:[]});
  }
  const {v}=await sampleOf(f,t);
  assert.equal(v.status,'member');assert.equal(v.entryAssurance,'sampled');
  assert.equal(v.sampleSeed.height,109);
});

test('R53 positionSeedHeight agrees with the sample-seed vectors',()=>{
  const suite=load('sample-seed');
  assert.ok(suite.cases.length>=9);
  for(const c of suite.cases) assert.equal(positionSeedHeight(c.input.commitHeights,c.input.q),c.expected.height,c.id);
  assert.equal(positionSeedHeight([[106,108,115]],2),109);
  assert.equal(positionSeedHeight([[108]],2),null);
  assert.equal(positionSeedHeight([],2),null);
});
