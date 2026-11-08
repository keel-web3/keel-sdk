import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBlock} from '../indexer/block.mjs';
import {esploraSource,recursionSource,rpcSource} from '../indexer/sources.mjs';
import {scanBlocks} from '../indexer/loop.mjs';
const v=JSON.parse(readFileSync(new URL('../spec/vectors/testnet4-block.json',import.meta.url))).cases[0];
const raw=Buffer.from(v.input.raw,'hex'), block=parseBlock(raw), h=v.input.height;
test('public block fixture validates header and Merkle root',()=>{
 assert.equal(block.hash, v.expected.hash);
 const bad=Buffer.from(raw);bad[bad.length-1]^=1;assert.throws(()=>parseBlock(bad));
});
test('RPC, esplora and recursion adapters give the same verified block',async()=>{
 const genesis='00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043';
 const reply=async(url,opts)=>{
  if(opts?.method==='POST') {const x=JSON.parse(opts.body);return Response.json({result:x.method==='getblockhash'?(x.params[0]===0?genesis:block.hash):raw.toString('hex')})}
  if(url.includes('/block-height/')||url.includes('/r/blockhash/')) return new Response(url.endsWith('/0')?genesis:block.hash);
  if(url.includes('/r/block/')) return new Response(raw.toString('hex'));
  return new Response(raw);
 };
 const sources=[rpcSource('https://fixture.invalid',{fetcher:reply}),esploraSource('https://fixture.invalid',{fetcher:reply}),recursionSource('https://fixture.invalid',{fetcher:reply})];
 const results=await Promise.all(sources.map(source=>scanBlocks({source,from:h,to:h,state:[],reduceBlock:(state,b)=>[...state,b.transactions.map(t=>t.txid)]})));
 assert.deepEqual(results[0],results[1]);assert.deepEqual(results[1],results[2]);
});

test('cached snapshot replays with no network and rejects corruption',async()=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {blockCache}=await import('../indexer/cache.mjs');
 const dir=await mkdtemp(join(tmpdir(),'koc1-cache-test-'));
 try {
  const cache=blockCache(dir), genesis='00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043';
  const source={blockHash:async height=>height===0?genesis:block.hash,rawBlock:async()=>raw};
  const options={from:h,to:h,state:[],reduceBlock:(s,b)=>[...s,b.internalHash],cache};
  const first=await scanBlocks({...options,source});
  const second=await scanBlocks({...options,offline:true,source:new Proxy({}, {get(){throw Error('network used')}})});
  assert.deepEqual(second,first);
  await writeFile(join(dir,'koc1-blocks-v1',`${block.hash}.blk`),'bad');
  await assert.rejects(scanBlocks({...options,offline:true}),/block/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('RPC retries an HTTP 429 with backoff',async()=>{
 let calls=0;
 const source=rpcSource('https://fixture.invalid',{fetcher:async()=>{
  calls++;
  return calls===1?new Response('',{status:429,headers:{'retry-after':'0.001'}}):Response.json({result:block.hash});
 }});
 assert.equal(await source.blockHash(h),block.hash);assert.equal(calls,2);
});

test('RPC source never exceeds two simultaneous requests',async()=>{
 let active=0,peak=0;
 const source=rpcSource('https://fixture.invalid',{fetcher:async()=>{
  peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,3));active--;return Response.json({result:block.hash});
 }});
 await Promise.all(Array.from({length:9},(_,i)=>source.blockHash(i)));assert.equal(peak,2);
});
