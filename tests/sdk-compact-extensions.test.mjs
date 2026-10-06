import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{gzipSync}from'node:zlib';import{runInNewContext}from'node:vm';
import{decodePpmd}from'../packages/sdk/dist/decoders/index.js';
import{packKeelInlineDescriptors,unpackKeelInlineDescriptors,buildKeelPreparedDenseCopyShell,inspectKeelPreparedDenseCopyDocument,serializeKeelDenseTransportJSON}from'../packages/sdk/dist/index.js';
const packed=await readFile(new URL('./fixtures/ppmd/byte-ramp.k7',import.meta.url)),source=Buffer.from(Array.from({length:256*1024},(_,i)=>i&255)),opts={decodedByteLength:source.length,maxDictionaryBytes:1024*1024,workPerYield:8192};
test('bounded PPMd yields and restores exact binary; cancellation does not poison queued jobs',async()=>{
 let ticks=0;const timer=setInterval(()=>ticks++,0);try{assert.deepEqual(Buffer.from(await decodePpmd(packed,opts)),source);assert.ok(ticks>0)}finally{clearInterval(timer)}
 const signal=new AbortController();const cancelled=decodePpmd(packed,{...opts,signal:signal.signal,yieldTask:async()=>signal.abort(new Error('cancelled'))});const queued=decodePpmd(packed,opts);await assert.rejects(cancelled,/cancelled/);assert.deepEqual(Buffer.from(await queued),source);
});
test('PPMd rejects foreign headers, excessive models, truncated ranges and exhausted work',async()=>{
 for(const index of [0,1,2,3]){const bad=Buffer.from(packed);bad[index]=255;await assert.rejects(decodePpmd(bad,opts));}
 await assert.rejects(decodePpmd(packed,{...opts,maxDictionaryBytes:1024}));await assert.rejects(decodePpmd(packed,{...opts,maxWork:1}),/work/);await assert.rejects(decodePpmd(packed.subarray(0,30),opts));await assert.rejects(decodePpmd(packed,{...opts,decodedByteLength:33*1024*1024}));
});
const delivery={chainId:11155111,store:'0x'+'11'.repeat(20)},hash='0x'+'22'.repeat(32),integrity={algorithm:'sha256',byteLength:12,digest:hash};
const binding={...delivery,compression:'ppmd',integrity,objectId:hash,storedIntegrity:integrity,id:hash};
const items=[{aliases:['example','example.js'],id:'example',integrity,mediaType:'text/javascript',onchain:{containerId:hash,offset:0},role:'module',containerBindings:[binding]}];
test('descriptor columns preserve every field and reject unsupported fields and indices',()=>{
 const e=packKeelInlineDescriptors(items);assert.deepEqual(unpackKeelInlineDescriptors([null,e],delivery.chainId,delivery.store).slice(1),items);
 assert.throws(()=>packKeelInlineDescriptors([{...items[0],hiddenField:'must survive'}]),/omit|change/);
 const changed=structuredClone(e);changed.rows[0][5]=7;assert.throws(()=>unpackKeelInlineDescriptors([null,changed],delivery.chainId,delivery.store),/member/);
 assert.throws(()=>unpackKeelInlineDescriptors([null,{...e,format:'unknown'}],delivery.chainId,delivery.store));
});
test('column bootstrap and inspected document are identical; gzip hook cannot alter shell bytes',async()=>{
 const shell=await buildKeelPreparedDenseCopyShell({codecProfile:'ppmd-js',embeddedContainerDelivery:delivery,itemDescriptorCarriage:'columns-v1',gzipCompressor:b=>gzipSync(b,{level:9})});
 const pack={containerId:hash,storedDense:'fixture'},body=Buffer.from(shell.prefix).toString()+serializeKeelDenseTransportJSON(pack)+Buffer.from(shell.containerBridge).toString()+','+serializeKeelDenseTransportJSON(packKeelInlineDescriptors(items))+Buffer.from(shell.suffix).toString();
 const expected=inspectKeelPreparedDenseCopyDocument(body).html;let task,actual;
 runInNewContext(body.slice(body.indexOf('<script>')+8,body.lastIndexOf('</script>')),{document:{open(){},write(s){actual=s},close(){}},queueMicrotask:fn=>{task=fn},TextDecoder,Uint8Array,atob,Blob,Response,DecompressionStream});await task();assert.equal(actual,expected);
 await assert.rejects(buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:delivery,gzipCompressor:()=>gzipSync('changed')}),/canonical bytes|output length/);
});
