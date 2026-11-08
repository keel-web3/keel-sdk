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
