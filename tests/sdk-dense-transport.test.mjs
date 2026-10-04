import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createContext,runInContext} from 'node:vm';
import {randomBytes} from 'node:crypto';
import {encodeKeelDenseTransport as encode,decodeKeelDenseTransport as decode,KEEL_BASE90_ALPHABET,KEEL_BASE91_ALPHABET} from '../packages/sdk/dist/dense-transport.js';
import {buildKeelDenseTransportDecoder} from '../packages/sdk/dist/verification-shell.js';
const profiles=['base90-v1','base91-v1'];
test('standard basE91 known vector and distinct versioned Base90 alphabet',()=>{
 assert.equal(encode(Buffer.from('Hello World!'),'base91-v1'),'>OwJh>Io0Tv!8PE');
 assert.equal(KEEL_BASE90_ALPHABET.length,90);assert.equal(new Set(KEEL_BASE90_ALPHABET).size,90);
 assert.equal(KEEL_BASE91_ALPHABET.length,91);assert.doesNotMatch(KEEL_BASE90_ALPHABET,/["\\%#\s]/);
});
test('all single-byte values, all pairs and variable-bit tail lengths round-trip',()=>{
 for(const profile of profiles){
  for(let v=0;v<256;v++){const b=Uint8Array.of(v);assert.deepEqual(decode(encode(b,profile),{profile,byteLength:1}),b);}
  for(let v=0;v<65536;v++){const b=Uint8Array.of(v&255,v>>>8);assert.deepEqual(decode(encode(b,profile),{profile,byteLength:2}),b);}
  for(let n=0;n<512;n++){const b=Uint8Array.from({length:n},(_,i)=>(i*97+n*53)&255);assert.deepEqual(decode(encode(b,profile),{profile,byteLength:n}),b);}
  const b=randomBytes(262144);assert.deepEqual(Buffer.from(decode(encode(b,profile),{profile,byteLength:b.length})),b);
 }
});
test('foreign characters, invalid profiles, truncated/oversized output and dirty tail fail closed',()=>{
 for(const profile of profiles){
  const text=encode(Buffer.from('bounded bytes'),profile);
  for(const c of [' ','\n','\\','é'])assert.throws(()=>decode(text+c,{profile,byteLength:13}),/character|bound/);
  assert.throws(()=>decode(text.slice(0,-2),{profile,byteLength:13}),/length|tail/);
  assert.throws(()=>decode(text,{profile,byteLength:1}),/bound|length/);
  for(const byteLength of [-1,NaN,4*1024*1024+1])assert.throws(()=>decode('',{profile,byteLength}),/bound/);
  assert.throws(()=>decode('!',{profile,byteLength:0}),/bound/);
 }
 assert.throws(()=>encode(Uint8Array.of(1),'base90'),/profile/);
 assert.throws(()=>decode('',{profile:'base90',byteLength:0}),/profile/);
 assert.throws(()=>decode('~~',{profile:'base90-v1',byteLength:1}),/tail|length/);
});
test('optional browser module reconstructs bytes without Buffer, atob or compression dependencies',async()=>{
 const module=await buildKeelDenseTransportDecoder();assert.ok(module.integrity.byteLength<4000);
 assert.doesNotMatch(module.javascript,/atob|Buffer|fetch\(|DecompressionStream|encodeKeelDenseTransport/);
 const context=createContext({Uint8Array,Int16Array});runInContext(module.javascript,context);
 for(const profile of profiles){const b=randomBytes(4097);assert.deepEqual(Buffer.from(context.KEEL_DENSE_TRANSPORT.decodeKeelDenseTransport(encode(b,profile),{profile,byteLength:b.length})),b);}
});

const {serializeKeelDenseTransportJSON,toKeelDenseTransportDataURL}=await import('../packages/sdk/dist/dense-transport.js');
test('paired wrapper survives both URI/JSON layers, closes script sentinels and preserves Unicode',async()=>{
 const payload={text:'</ScRiPt><script><!-- & > " \u2028 flame 🔥 # %',binary:"'`[]{}<>?&"};
 const serialized=serializeKeelDenseTransportJSON(payload);assert.deepEqual(JSON.parse(serialized),payload);assert.doesNotMatch(serialized,/<\/?script|<!--/i);
 const html='<!doctype html><script>const payload='+serialized+';</script>';
 const animation=toKeelDenseTransportDataURL('html',html),uri=toKeelDenseTransportDataURL('metadata',JSON.stringify({name:'Test 🔥',animation_url:animation}));
 const metadata=JSON.parse(await(await fetch(uri)).text());assert.equal(metadata.animation_url,animation);assert.equal(await(await fetch(metadata.animation_url)).text(),html);
 assert.throws(()=>toKeelDenseTransportDataURL('svg',html),/input/);assert.throws(()=>serializeKeelDenseTransportJSON(undefined),/serializable/);
});

// A data URL body includes its query according to WHATWG Fetch. Escaping ?
// costs four bytes through nested metadata/HTML layers with no decoding benefit.
test('Base90 punctuation remains direct through two data URI layers',async()=>{
 const body='?'+KEEL_BASE90_ALPHABET.repeat(64);
 const html='<script type="application/json">'+serializeKeelDenseTransportJSON({body})+'</script>';
 const animation=toKeelDenseTransportDataURL('html',html);
 const uri=toKeelDenseTransportDataURL('metadata',JSON.stringify({animation_url:animation}));
 assert.doesNotMatch(animation,/%3[fF]/);assert.doesNotMatch(uri,/%3[fF]/);
 const metadata=await(await fetch(uri)).json();assert.equal(metadata.animation_url,animation);
 assert.equal(await(await fetch(metadata.animation_url)).text(),html);
 const sensitive='?%23#%3F\n\t🔥';
 assert.equal(await(await fetch(toKeelDenseTransportDataURL('html',sensitive))).text(),sensitive);
});
