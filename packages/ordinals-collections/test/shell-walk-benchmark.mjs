import assert from 'node:assert/strict';
import {fixture,addUpdate} from './mock-recursion.mjs';
import {Recursion,walk} from '../src/shell/index.mjs';
import {writerChain} from '../src/merge/index.mjs';
import {hex,reverse} from '../src/core.ts';
const f=fixture({writers:0});
let prev=null,prevRoot=null;
for(let i=0;i<1000;i++){
  const update=addUpdate(f.mock,f.r,f.authorities[0].id,[],{prev,prevRoot});
  prev=update.id;prevRoot=update.metadata.root;
}
await f.mock.start();
try {
  const client=new Recursion({fetcher:f.mock.fetcher}),start=performance.now();
  const walked=await walk(f.authorities[0].id,{client});
  const wallMs=performance.now()-start;
  assert.equal(walked.records.length,1000);assert.deepEqual(client.stats,f.mock.stats);
  const chain=writerChain(walked.records.map(r=>({...r.metadata,id:r.id,parent:f.authorities[0].id})),{authority:f.authorities[0].id,recipe:f.r.id,hostHashes:{106:hex(reverse(f.mock.routes.get('/r/blockhash/106')))},policy:f.r});
  assert.equal(chain.accepted.length,1000);
  console.log(JSON.stringify({updates:1000,pages:10,...client.stats,wallMs:Number(wallMs.toFixed(2)),transport:'localhost HTTP; response body bytes; cold per-load cache; commit authentication on every update',accepted:chain.accepted.length},null,2));
} finally {await f.mock.close();}
