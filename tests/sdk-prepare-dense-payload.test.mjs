import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {prepareKeelGzipDensePayload as prepareKeelDensePayload,decodeKeelDenseTransport} from '../packages/sdk/dist/index.js';
const digest=b=>'0x'+createHash('sha256').update(b).digest('hex');
const decode=p=>decodeKeelDenseTransport(p.storedDense,{profile:p.transportProfile,byteLength:p.storedIntegrity.byteLength});
test('automatic dense payload saver preserves source, selects deterministic gzip and URI81',()=>{
 const source=Buffer.from('NOCTURNES canonical resource\n'.repeat(3000));
 const a=prepareKeelDensePayload(source),b=prepareKeelDensePayload(source);
 assert.equal(a.compression,'gzip');assert.equal(a.transportProfile,'uri81-block-v1');
 assert.deepEqual(a,b);assert.deepEqual(Buffer.from(decode(a)),a.compressedBytes);
 assert.deepEqual(gunzipSync(decode(a)),source);
 assert.deepEqual(a.sourceIntegrity,{algorithm:'sha256',digest:digest(source),byteLength:source.length});
 assert.equal(a.storedIntegrity.digest,digest(a.compressedBytes));
 assert.ok(a.compressedBytes.length<source.length);
});
test('incompressible, tiny and empty payloads retain exact bytes and bounded carriage',()=>{
 for(const source of [Buffer.alloc(0),Buffer.from([0,255]),randomBytes(4096)]){
  const p=prepareKeelDensePayload(source);assert.equal(p.compression,'none');
  assert.deepEqual(Buffer.from(decode(p)),source);assert.equal(p.storedIntegrity.digest,digest(source));
 }
});
test('explicit no-compression is preserved and returned bytes do not alias caller memory',()=>{
 const source=new Uint8Array(4096).fill(7),p=prepareKeelDensePayload(source,{compression:'none'});
 source.fill(9);assert.equal(p.compression,'none');assert.equal(p.compressedBytes[0],7);
 assert.deepEqual(Buffer.from(decode(p)),Buffer.alloc(4096,7));
});
test('invalid byte bounds, compression and carriage fail closed',()=>{
 assert.throws(()=>prepareKeelDensePayload('binary'),/must be bytes/);
 assert.throws(()=>prepareKeelDensePayload(new Uint8Array(4*1024*1024+1)),/byte bound/);
 assert.throws(()=>prepareKeelDensePayload(new Uint8Array(1),{compression:'brotli'}),/compression/);
 assert.throws(()=>prepareKeelDensePayload(new Uint8Array(1),{transportProfile:'base64'}),/profile/);
});
