import assert from 'node:assert/strict';
import test from 'node:test';
import {brotliCompressSync} from 'node:zlib';
import {decodeBrotli,decodeLzma} from '../packages/sdk/dist/decoders/index.js';
const text=Buffer.from('水🔥 Pokémon Pikachu 世界\u0000 café 😀'.repeat(200));
const lzma=Buffer.from('5d00004000ffffffffffffffff00732c128f0547c025e5f60ea58c23438240b2d61003acfca78a3ec03339e06c3f814421a8b06628b1c69c08c0499022e4a50ef1a531f4c0f4d991fd81ee280f0b86f575c10e6978a1338cd2a1a97ebbeb63f84ab9f1fa81fff5060800','hex');
const emptyLzma=Buffer.from('5d00004000ffffffffffffffff0083fffbffffc0000000','hex');
const immediate={yieldTask:async()=>{}};
test('pinned decode-only adapters return exact binary, Unicode, and empty bytes',async()=>{
 assert.deepEqual(Buffer.from(await decodeLzma(lzma,{decodedByteLength:text.length,...immediate})),text);
 assert.deepEqual(Buffer.from(await decodeLzma(emptyLzma,{decodedByteLength:0,...immediate})),Buffer.alloc(0));
 for(const bytes of [Buffer.alloc(0),text,Buffer.from(Array.from({length:65536},(_,i)=>i&255))])assert.deepEqual(Buffer.from(await decodeBrotli(brotliCompressSync(bytes),{decodedByteLength:bytes.length,...immediate})),bytes);
});
test('decode allocation, dictionaries, probability models, and work are bounded',async()=>{
 for(const decode of [decodeBrotli,decodeLzma]){
  const bytes=decode===decodeBrotli?brotliCompressSync(text):lzma;
  await assert.rejects(decode(bytes,{decodedByteLength:text.length-1,...immediate}));
  await assert.rejects(decode(bytes,{decodedByteLength:text.length+1,...immediate}));
  await assert.rejects(decode(bytes,{decodedByteLength:text.length,maxDecodedBytes:100,...immediate}));
  await assert.rejects(decode(bytes,{decodedByteLength:text.length,maxWork:1,...immediate}));
  await assert.rejects(decode(bytes,{decodedByteLength:text.length,workPerYield:0,...immediate}));
  for(const n of [0,1,Math.floor(bytes.length/2),bytes.length-1])await assert.rejects(decode(bytes.subarray(0,n),{decodedByteLength:text.length,...immediate}));
 }
 const oversized=Buffer.from(lzma);oversized[4]=255;
 await assert.rejects(decodeLzma(oversized,{decodedByteLength:text.length,...immediate}),/dictionary/);
 const probabilities=Buffer.from(lzma);probabilities[0]=44;
 await assert.rejects(decodeLzma(probabilities,{decodedByteLength:text.length,...immediate}),/probability/);
 assert.throws(()=>decodeBrotli(brotliCompressSync(text),{decodedByteLength:text.length,dictionary:text}),/dictionary|dictionaries/);
});
test('cooperative tasks let browser-style event tasks run and preserve independent state',async()=>{
 const bytes=Buffer.from(Array.from({length:65536},(_,i)=>(i*31+Math.floor(i/1024))&255));const packed=brotliCompressSync(bytes);
 let ticks=0;const timer=setInterval(()=>ticks++,0);
 try{const decoded=await decodeBrotli(packed,{decodedByteLength:bytes.length,workPerYield:8});assert.deepEqual(Buffer.from(decoded),bytes);assert.ok(ticks>0);}finally{clearInterval(timer);}
 const aborted=new AbortController();
 await assert.rejects(decodeBrotli(packed,{decodedByteLength:bytes.length,workPerYield:1,signal:aborted.signal,yieldTask:async()=>aborted.abort(new Error('cancelled'))}),/cancelled/);
 const outputs=await Promise.all([decodeBrotli(packed,{decodedByteLength:bytes.length,workPerYield:8}),decodeLzma(lzma,{decodedByteLength:text.length,workPerYield:8})]);assert.deepEqual(Buffer.from(outputs[0]),bytes);assert.deepEqual(Buffer.from(outputs[1]),text);
});
