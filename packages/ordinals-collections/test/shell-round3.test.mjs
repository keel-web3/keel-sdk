import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample} from '../src/shell/index.mjs';
import {hex,reverse} from '../src/core.ts';

test('S9 rows after self cannot enable sampling, including at the 1000-member boundary',async t=>{
  const f=fixture({count:1002});
  await f.mock.start();t.after(()=>f.mock.close());
  // Even real, q-corroborated later members cannot weaken checking for an
  // earlier token. The independent review also covers colluding non-mint rows.
  for (const rank of [200,1000]) {
    const v=await verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(f.mints[rank-1].id)},checkWork:false});
    assert.equal(v.status,'member');assert.equal(v.final,true);
    assert.equal(v.rank,rank);assert.equal(v.checkedPrior,rank-1);
    assert.equal(v.entryAssurance,'exhaustive');assert.equal(v.merged.entries.length,1002);
  }
});

test('S9 sampled positions are unique, repeatable per block hash, and change with that hash',()=>{
  const rows=Array.from({length:1200},(_,i)=>i), a='11'.repeat(32), b='22'.repeat(32);
  const first=positionSample(rows,1201,64,a), second=positionSample(rows,1201,64,b);
  assert.equal(first.length,64);assert.equal(new Set(first).size,64);
  assert.deepEqual(first,positionSample([...rows],1201,64,a));
  assert.notDeepEqual(first,second);
  assert.deepEqual(first,[...first].sort((a,b)=>a-b));
  assert.ok(first.every(i=>rows.includes(i)));
  assert.equal(positionSample(rows,1000,64,a),rows);
  assert.throws(()=>positionSample(rows,1201,64,'bad hash'),/block hash/);
});

test('S9 uses the post-update block hash for the actual fetch sample, independent of C and a later host tip',async t=>{
  const samples=[];
  for (const hash of ['11'.repeat(32),'22'.repeat(32)]) {
    const f=fixture({count:1002,writers:0});
    f.mock.routes.set('/r/blockhash/107',hex(reverse(hash)));
    f.mock.routes.set('/r/blockheight',108);
    f.mock.routes.set('/r/blockhash/108','33'.repeat(32));
    for(let w=0;w<2;w++) {
      const first=addUpdate(f.mock,f.r,f.authorities[w].id,f.rows.slice(0,1000),{h:100});
      addUpdate(f.mock,f.r,f.authorities[w].id,f.rows,{prev:first.id,prevRoot:first.metadata.root,new:f.rows.slice(1000)});
    }
    await f.mock.start();t.after(()=>f.mock.close());
    const fetched=new Set(), prior=f.mints.slice(0,-1);
    const routes=new Map(prior.map((m,i)=>['/r/inscription/'+inscriptionId(m.id),i]));
    const fetcher=(path,options)=>{
      if (routes.has(path)) fetched.add(routes.get(path));
      return f.mock.fetcher(path,options);
    };
    const v=await verifyShell({fetcher,location:{pathname:'/content/'+inscriptionId(f.self)},checkWork:false});
    assert.equal(v.C,106);assert.equal(v.status,'member');assert.equal(v.rank,1002);
    assert.equal(v.entryAssurance,'sampled');assert.equal(v.checkedPrior,64);
    const sample=[...fetched].sort((a,b)=>a-b);
    assert.deepEqual(sample,positionSample(prior.map((_,i)=>i),1002,64,hash));
    samples.push(sample);
  }
  assert.notDeepEqual(samples[0],samples[1]);
});
