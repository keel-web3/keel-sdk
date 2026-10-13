import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gunzipSync} from 'node:zlib';
import{createHash}from'node:crypto';
import {buildKeelPreparedPpmdCopyShell,prepareKeelDensePayload} from '../packages/sdk/dist/index.js';
const run=promisify(execFile),tool=process.env.KEEL_PPMD_PACK;
const binding={id:'0x'+'22'.repeat(32),chainId:11155111,store:'0x'+'33'.repeat(20),objectId:'0x'+'44'.repeat(32),compression:'ppmd',integrity:{algorithm:'sha256',byteLength:1,digest:'0x'+'11'.repeat(32)},storedIntegrity:{algorithm:'sha256',byteLength:1,digest:'0x'+'11'.repeat(32)}};
const item={id:'fixture',aliases:['fixture','fixture.html'],role:'entrypoint',mediaType:'text/html',integrity:binding.integrity,onchain:{containerId:binding.id,offset:0},containerBindings:[binding]};
test('shared PPMd boot rejects unsupported or ambiguous resource codecs before preparation',async()=>{
 for(const resourceCodecs of [[],['brotli'],['ppmd','ppmd'],['ppmd','lzma'],['ppmd','brotli','none']])await assert.rejects(buildKeelPreparedPpmdCopyShell({embeddedContainerDelivery:{chainId:11155111,store:'0x'+'33'.repeat(20)},items:[item],resourceCodecs,ppmdCompressor:async()=>new Uint8Array()}),/resource codecs/);
});
test('one registered boot can decode unchanged PPMd and fresh Brotli without migrating either',{skip:!tool},async()=>{
 const dir=await mkdtemp('/private/tmp/keel-mixed-codec-');let n=0;
 const compress=async bytes=>{const stem=dir+'/'+n++;await writeFile(stem,bytes);await run(tool,[stem,stem+'.ppmd','16','26']);return readFile(stem+'.ppmd');};
 try{
  const base={embeddedContainerDelivery:{chainId:11155111,store:'0x'+'33'.repeat(20)},items:[item],descriptorSource:'body-or-fallback',ppmdCompressor:compress};
  const old=await buildKeelPreparedPpmdCopyShell(base);
  const revised=await buildKeelPreparedPpmdCopyShell({...base,resourceCodecs:['brotli','ppmd']});
  assert.deepEqual(revised.prefix,old.prefix);
  assert.deepEqual(revised.resourceCodecs,['ppmd','brotli']);
  assert.ok(revised.supportedCodecs.includes('brotli'));
  const module=gunzipSync(Buffer.from(revised.boot.decoder64,'base64'));
  Function(module.toString())();const decoder=globalThis.__KEEL_PREPARED_BOOT_API__;delete globalThis.__KEEL_PREPARED_BOOT_API__;
  const vector=Buffer.from('canonical SHA-256 without Web Crypto');assert.equal(Buffer.from(decoder.digest(vector)).toString('hex'),createHash('sha256').update(vector).digest('hex'));
  assert.ok(!Buffer.from(revised.suffix).toString().includes('await import(u)'));assert.ok(!Buffer.from(revised.suffix).toString().includes('crypto.subtle.digest'));
  assert.equal(globalThis.__KEEL_PREPARED_BOOT_API__,undefined);
  assert.equal(typeof decoder.codecs.decodeBrotli,'function');
  assert.equal(typeof decoder.codecs.decodePpmd,'function');
  const engine=Buffer.from('unchanged published engine bytes '.repeat(100));
  const existing=await compress(engine);
  assert.deepEqual(Buffer.from(await decoder.codecs.decodePpmd(existing,{decodedByteLength:engine.length,maxDictionaryBytes:67108864})),engine);
  const scene=Buffer.from('fresh scene configuration '.repeat(100));
  const payload=prepareKeelDensePayload(scene);
  assert.equal(payload.compression,'brotli');
  const returned=decoder.wire.decodeKeelDenseTransport(payload.storedDense,{profile:payload.transportProfile,byteLength:payload.compressedBytes.length});
  assert.deepEqual(Buffer.from(returned),Buffer.from(payload.compressedBytes));
  assert.deepEqual(Buffer.from(await decoder.codecs.decodeBrotli(returned,{decodedByteLength:scene.length})),scene);
  await assert.rejects(decoder.codecs.decodeBrotli(returned,{decodedByteLength:scene.length-1}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
