import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {verifyShell,inscriptionId,positionSample} from '../src/shell/index.mjs';
import {b,hex,sha,utf,reverse,publicPoint,envelope,escrow,marker,parseTx} from '../src/core.ts';

const key=publicPoint(6);
const run=async(f,t)=>{
  await f.mock.start();t.after(()=>f.mock.close());
  return verifyShell({fetcher:f.mock.fetcher,location:{pathname:'/content/'+inscriptionId(f.self)},checkWork:false});
};
const laterMint=f=>{
  const metadata={p:'koc1',op:'mint',r:b(f.r.id),m:b(key)};
  const mint=f.mock.add({metadata,script:envelope(metadata,f.r.art.viewer.id),height:101,outputs:[{value:330,script:'5120'+key},{value:1000,script:escrow(f.r.payment,key).scriptPubKey},{value:0,script:marker(f.r.id)}]});
  f.mock.block(101,[mint]);f.self=mint.id;
};

for (const compact of [false,true]) for (const support of [1,2]) {
  test(`S9 ${compact?'compact triple':'full row'} unknown: ${support} writer(s), q=2`,async t=>{
    const f=fixture();laterMint(f);
    const txid=hex(sha(utf('round-2 nonexistent mint')));
    const ghost={txid,height:100,txIndex:1,m:key,paymentOutpoint:txid+'00000001'};
    // Keep the two existing accepted chains and their C=106. Unverifiable
    // compact extensions must not erase the prefix or fabricate root fields.
    for(let w=0;w<support;w++) {
      const rows=[...f.rows,ghost];
      addUpdate(f.mock,f.r,f.authorities[w].id,rows,{prev:f.updates[w].id,prevRoot:f.updates[w].metadata.root,new:compact?[[txid,100,1]]:[ghost]});
    }
    const v=await run(f,t);
    assert.equal(v.C,106);assert.equal(v.rank,2);
    assert.equal(v.incomplete,support===2);
    assert.equal(v.status,support===2?'settling':'member');
    assert.equal(v.final,support!==2);
    assert.ok(!v.merged.entries.some(row=>row.txid===txid),'unknown evidence never becomes a member');
    assert.ok(v.merged.entries.every(row=>row.final===(support!==2)));
    if(compact) for(let w=0;w<support;w++) assert.deepEqual(v.originals[w].accepted,[f.updates[w].id]);
  });
}

test('S9 a first-writer minority variant cannot hide exactly q corroborated unknown rows',async t=>{
  const f=fixture();laterMint(f);
  const txid=hex(sha(utf('round-2 conflicting unknown mint')));
  for(let w=0;w<3;w++) {
    const ghost={txid,height:100,txIndex:w===0?1:2,m:key,paymentOutpoint:txid+'00000001'};
    const previous=f.updates[w];
    addUpdate(f.mock,f.r,f.authorities[w].id,[...f.rows,ghost],previous?{prev:previous.id,prevRoot:previous.metadata.root,new:[ghost]}:{});
  }
  const v=await run(f,t);
  assert.equal(v.C,106);assert.equal(v.rank,2);assert.equal(v.status,'settling');
  assert.equal(v.incomplete,true);assert.equal(v.final,false);
  assert.ok(!v.merged.entries.some(row=>row.txid===txid));
});

test('S9 exactly q matching writers permit sampling; a sampled invalid row forces exhaustive checking',async t=>{
  const f=fixture({count:1002,writers:0});
  const sample=positionSample(f.rows.slice(0,-1),1002,64,hex(reverse(f.mock.routes.get('/r/blockhash/106'))));
  const sampledBad=f.mints.find(m=>sample.some(row=>row.txid===m.txid));
  const unsampledBad=f.mints.slice(0,-1).find(m=>!sample.some(row=>row.txid===m.txid));
  // Both quorum writers commit these rows, but two authenticated mint reveals
  // fail form checks. Only one of those rows is in the normal sample.
  const badRows=[];
  for(const old of [sampledBad,unsampledBad]) {
    const tx=parseTx(old.rawTx);tx.outputs[1].value=999;
    const bad=f.mock.add({metadata:old.metadata,script:tx.inputs[0].witness[1],outputs:tx.outputs,height:100});
    const i=f.mints.indexOf(old);f.mints[i]=bad;
    f.rows[i]={...f.rows[i],id:bad.id,txid:bad.txid,paymentOutpoint:bad.txid+'00000001'};
    badRows.push(f.rows[i]);
  }
  f.mock.block(100,f.mints);
  // The fallback must check rows placed after self as well: their claimed
  // positions are no more trustworthy than those of the exposed sample.
  const note=f.mock.add({metadata:{p:'koc1',op:'note'},height:101});
  f.mock.block(101,[note]);
  f.rows.push({txid:note.txid,height:101,txIndex:0,m:key,paymentOutpoint:note.txid+'00000001'});
  for(let w=0;w<2;w++) {
    const first=addUpdate(f.mock,f.r,f.authorities[w].id,f.rows.slice(0,1000),{h:100});
    addUpdate(f.mock,f.r,f.authorities[w].id,f.rows,{prev:first.id,prevRoot:first.metadata.root,new:f.rows.slice(1000)});
  }
  const v=await run(f,t);
  assert.equal(v.status,'member');assert.equal(v.final,true);assert.equal(v.incomplete,false);
  assert.equal(v.entryAssurance,'exhaustive');assert.equal(v.checkedPrior,1001);assert.equal(v.rank,1000);
  assert.equal(v.originals[0].accepted.length,2);assert.equal(v.originals[1].accepted.length,2);
  assert.equal(v.originals[2].h,null);
  for(const bad of badRows) assert.ok(!v.merged.entries.some(row=>row.txid===bad.txid));
  assert.ok(!v.merged.entries.some(row=>row.txid===note.txid));
  assert.equal(v.merged.entries.length,1000);
});

test('S9 an invalid claimed position in the sample also forces exhaustive checking',async t=>{
  const f=fixture({count:1002});
  // An authentic mint can contradict a writer's row without failing formCheck.
  // Insert a non-mint before the real reveals: both writers' committed
  // coordinates are now wrong, while every mint remains authentic and valid.
  const note=f.mock.add({metadata:{p:'koc1',op:'note'},height:100});
  f.mock.block(100,[note,...f.mints]);
  // Update the covered block hash used by the first page in each chain, since
  // the fixture's first page covers height 100. Rebuild those commitments.
  for(let w=0;w<2;w++) {
    f.mock.children.set(f.authorities[w].id,[]);
    const first=addUpdate(f.mock,f.r,f.authorities[w].id,f.rows.slice(0,1000),{h:100});
    addUpdate(f.mock,f.r,f.authorities[w].id,f.rows,{prev:first.id,prevRoot:first.metadata.root,new:f.rows.slice(1000)});
  }
  const v=await run(f,t);
  assert.equal(v.status,'member');assert.equal(v.entryAssurance,'exhaustive');
  assert.equal(v.checkedPrior,1001);assert.equal(v.rank,1002);
});
