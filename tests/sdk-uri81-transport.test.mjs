import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {encodeKeelDenseTransport as encode, decodeKeelDenseTransport as decode,
 KEEL_URI81_ALPHABET as alphabet, toKeelDenseTransportDataURL,
 inspectKeelDataURICompatibility, buildKeelDenseTransportDecoder} from '../packages/sdk/dist/index.js';
const profile='uri81-block-v1';
function reference(bytes) {let text='';for(let offset=0;offset<bytes.length;offset+=19){const count=Math.min(19,bytes.length-offset);let value=0n,capacity=1n,size=0;for(let i=0;i<count;i++)value=(value<<8n)|BigInt(bytes[offset+i]);while(capacity<(1n<<BigInt(count*8))){size++;capacity*=81n;}for(let i=0;i<size;i++){text+=alphabet[Number(value%81n)];value/=81n;}}return text;}
test('URI81 alphabet is unique, literal-safe in both URI layers, and has pinned zero vectors',async()=>{
 assert.equal(alphabet.length,81);assert.equal(new Set(alphabet).size,81);
 assert.equal(encode(new Uint8Array(19),profile),'!'.repeat(24));
 assert.equal(encode(new Uint8Array(1),profile),'!!');
 const inner=toKeelDenseTransportDataURL('html',alphabet.repeat(128));
 assert.equal(inner.slice(inner.indexOf(',')+1),alphabet.repeat(128));
 const outer=toKeelDenseTransportDataURL('metadata',JSON.stringify({animation_url:inner}));
 assert(inspectKeelDataURICompatibility(inner).strictURICompatible);
 assert(inspectKeelDataURICompatibility(outer).strictURICompatible);
 assert.equal(await(await fetch(JSON.parse(await(await fetch(outer)).text()).animation_url)).text(),alphabet.repeat(128));
});
test('uint32 URI81 implementation matches independent BigInt reference across tails and byte pairs',()=>{
 const pairs=Uint8Array.from({length:131072},(_,i)=>(i&1)?(i>>1)&255:(i>>9)&255);
 assert.deepEqual(decode(encode(pairs,profile),{profile,byteLength:pairs.length}),pairs);
 for(let length=0;length<100;length++)for(const bytes of [randomBytes(length),new Uint8Array(length).fill(255)]){
  const text=encode(bytes,profile);assert.equal(text,reference(bytes));
  assert.deepEqual(Buffer.from(decode(text,{profile,byteLength:length})),Buffer.from(bytes));
 }
 const bytes=randomBytes(262144);assert.equal(encode(bytes,profile),reference(bytes));
 assert.deepEqual(Buffer.from(decode(encode(bytes,profile),{profile,byteLength:bytes.length})),bytes);
});
test('URI81 rejects foreign digits, wrong lengths, overflow and allocation bounds',()=>{
 for(const text of ['é!',' !','<~','!!?'])assert.throws(()=>decode(text,{profile,byteLength:1}),/character|bound/);
 assert.throws(()=>decode('~~',{profile,byteLength:1}),/overflow/);
 assert.throws(()=>decode('~'.repeat(24),{profile,byteLength:19}),/overflow/);
 for(const byteLength of [-1,NaN,Infinity,0.5,4*1024*1024+1])assert.throws(()=>decode('',{profile,byteLength}),/bound/);
 assert.throws(()=>decode('!',{profile,byteLength:0}),/bound/);
});
test('URI81 shell decoder ships only its selected format and needs no BigInt, Base64 or network',async()=>{
 const module=await buildKeelDenseTransportDecoder(profile);
 assert.doesNotMatch(module.javascript,/BigInt|atob|Buffer|fetch\(|base90-v1|base91-v1|base90-block-v2/);
 assert.ok(module.javascriptBytes.length<4000);
 const context={Uint8Array,Uint32Array,Int16Array};runInNewContext(module.javascript,context);
 const bytes=randomBytes(4097);
 assert.deepEqual(Buffer.from(context.KEEL_DENSE_TRANSPORT.decodeKeelDenseTransport(encode(bytes,profile),{profile,byteLength:bytes.length})),bytes);
 assert.throws(()=>context.KEEL_DENSE_TRANSPORT.decodeKeelDenseTransport('!!',{profile:'base90-v1',byteLength:1}),/profile/);
});
