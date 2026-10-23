import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,assertKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from '../packages/sdk/dist/registered-native-gzip.js';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const integrity=b=>({algorithm:'sha256',digest:hash(b),byteLength:b.length});
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');assert.equal(bytes.length,p[side+'ByteLength']);assert.equal(hash(bytes),p[side+'Digest']);return{bytes,integrity:integrity(bytes)}};
const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')};
const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));
Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
const mp4=readFileSync(new URL('./fixtures/registered-native-none/normal-artwork.mp4',import.meta.url));
assert.equal(mp4.length,1786);assert.equal(hash(mp4),'0xa421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561');
const displaySource=readFileSync(new URL('./fixtures/asset-display-1.1.0.js',import.meta.url));
assert.equal(displaySource.length,6172);assert.equal(hash(displaySource),'0x53957405312b1fe3b187a5c49b13d13a08fd6e960953c815c6e49b53637d97f4');
const display=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:displaySource,execution:'classic',phase:'render',weight:0,compression:'gzip'});
async function document(source=mp4,mediaType='video/mp4') {return buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'artwork.mp4',mediaType,source}})}
const proof=root=>createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});
const entries=root=>JSON.parse('[null'+Buffer.from(root.rootBytes).toString().slice(p.prefixByteLength,-p.suffixByteLength)+']').slice(1);
const fromEntries=items=>({rootBytes:Buffer.concat([shell.prefix.bytes,Buffer.from(items.map(item=>','+JSON.stringify(item).replaceAll('<','\\u003c')).join('')),shell.suffix.bytes])});
function changeSource(item,bytes) {item.integrity=integrity(bytes);item.embedded={compression:'none',storedBase64:Buffer.from(bytes).toString('base64'),storedIntegrity:integrity(bytes)}}
async function assetDocument(source,mediaType) {return buildKeelInlineLocalDocument({shell,modules:[display],assets:[{id:'native-original',role:'asset',mediaType,source,compression:'none'}],entry:{id:'probe.html',mediaType:'text/html',source:Buffer.from('<!doctype html><html><body>verified original asset</body></html>'),compression:'gzip'}})}
test('exact normal1786-byte MP4 default None survives the actual registered rev5 proof',async()=>{
 const root=await document(),item=JSON.parse(Buffer.from(root.parts.find(x=>x.role==='entrypoint').bytes).toString().slice(1));
 assert.equal(item.role,'entrypoint');assert.equal(item.mediaType,'video/mp4');assert.equal(item.embedded.compression,'none');
 assert.deepEqual(Buffer.from(item.embedded.storedBase64,'base64'),mp4);assert.deepEqual(item.embedded.storedIntegrity,integrity(mp4));assert.deepEqual(item.integrity,integrity(mp4));
 const result=proof(root);assert.equal(result.members.length,1);assert.equal(result.members[0].id,'keel.asset-display');
 assert.deepEqual(assertKeelRegisteredNativeGzipProof(result,root.rootBytes),result);
});

test('complete native WebM video and existing PCM/AAC/MP3/Ogg/FLAC audio and GLB survive exact None identity proof',async t=>{
 const webm=readFileSync(new URL('./fixtures/registered-native-none/synthetic-video.webm',import.meta.url));
 const video=await document(webm,'video/webm');assertKeelRegisteredNativeGzipProof(proof(video),video.rootBytes);
 for(const [name,mime]of [['tone.wav','audio/wav'],['tone.aac','audio/aac'],['tone.mp3','audio/mpeg'],['tone.ogg','audio/ogg'],['tone.flac','audio/flac'],['tone.m4a','audio/mp4'],['../model-viewers/complete.glb','model/gltf-binary']])await t.test(mime,async()=>{
  const source=readFileSync(new URL('./fixtures/native-media/'+name,import.meta.url)),root=await assetDocument(source,mime),native=entries(root).find(item=>item.id==='native-original');
  assert.equal(native.role,'asset');assert.equal(native.embedded.compression,'none');assert.deepEqual(Buffer.from(native.embedded.storedBase64,'base64'),source);
  assert.deepEqual(native.integrity,integrity(source));assert.deepEqual(native.embedded.storedIntegrity,integrity(source));assertKeelRegisteredNativeGzipProof(proof(root),root.rootBytes);
 });
});

test('native None proof rejects spoofed types, encoded text/scripts, malformed container bytes and wrong roles',async t=>{
 const original=entries(await document());
 const cases={
  'unknown MIME':item=>{item.mediaType='application/octet-stream'},
  'encoded HTML':item=>{item.mediaType='text/html';changeSource(item,Buffer.from('<html>encoded copy</html>'))},
  'encoded JavaScript':item=>{item.mediaType='text/javascript';changeSource(item,Buffer.from('globalThis.bad=true'))},
  'MIME-spoofed text':item=>changeSource(item,Buffer.from('<html>not a video</html>')),
  'module role':item=>{item.role='module'},
  'missing role':item=>{delete item.role},
  'truncated movie':item=>changeSource(item,mp4.subarray(0,mp4.length-1)),
  'incomplete box':item=>{const b=Buffer.from(mp4);b.writeUInt32BE(0x7fffffff,0);changeSource(item,b)},
  'wrong handler':item=>{const b=Buffer.from(mp4);const at=b.indexOf('hdlr')+12;assert.equal(b.subarray(at,at+4).toString(),'vide');b.write('soun',at);changeSource(item,b)},
  'external media range':item=>{const b=Buffer.from(mp4);const at=b.indexOf('stco');assert.ok(at>0);b.writeUInt32BE(b.length+1,at+12);changeSource(item,b)},
  'wrong sample count':item=>{const b=Buffer.from(mp4);const at=b.indexOf('stsz');assert.ok(at>0);b.writeUInt32BE(999,at+12);changeSource(item,b)},
  'double encoded movie':item=>changeSource(item,Buffer.from(mp4.toString('base64'))),
  'bad canonical Base64':item=>{item.embedded.storedBase64+='\n'},
  'decoded digest mismatch':item=>{item.integrity.digest=hash(Buffer.from('different'))},
  'stored digest mismatch':item=>{item.embedded.storedIntegrity.digest=hash(Buffer.from('different'))},
  'ambiguous text sibling':item=>{item.embedded.storedText='also here'},
 };
 for(const [name,mutate]of Object.entries(cases))await t.test(name,()=>{
  const items=structuredClone(original);mutate(items.find(item=>item.id==='artwork.mp4'));assert.throws(()=>proof(fromEntries(items)));
 });
 // Existing compressed recipes retain their exact compression/decoded binding.
 const items=structuredClone(original),module=items.find(item=>item.id==='keel.asset-display');module.embedded.compression='none';module.integrity=module.embedded.storedIntegrity;
 assert.throws(()=>proof(fromEntries(items)),/Native None/);
});

test('native None cannot bypass immutable frame/binding or the mandatory genuine Gzip member',async()=>{
 const root=await document();
 const wrong=Buffer.from(root.rootBytes);wrong[0]^=1;assert.throws(()=>proof({rootBytes:wrong}),/exact authenticated/);
 assert.throws(()=>createKeelRegisteredNativeGzipProof({binding:{...binding,chainId:1},documentBytes:root.rootBytes}),/maintained selected-chain/);
 assert.throws(()=>proof(fromEntries(entries(root).filter(item=>item.role!=='module'))),/No exact native Gzip member/);
 const items=entries(root),movie=items.find(item=>item.id==='artwork.mp4');movie.embedded.compression='brotli';assert.throws(()=>proof(fromEntries(items)),/only exact per-resource native Gzip/);
});

test('None external glTF buffers require the exact complete referenced model resource graph',async t=>{
 const load=name=>readFileSync(new URL('./fixtures/model-viewers/'+name,import.meta.url));
 const assets=[
  {id:'original-model',mediaType:'model/gltf+json',aliases:['model/complete.gltf'],source:load('complete.gltf'),compression:'none'},
  {id:'original-buffer',mediaType:'application/octet-stream',aliases:['model/scene.bin'],source:load('scene.bin'),compression:'none'},
  {id:'original-texture',mediaType:'image/png',aliases:['model/textures/checker.png'],source:load('textures/checker.png'),compression:'none'},
 ];
 const root=await buildKeelInlineLocalDocument({shell,modules:[display],assets,entry:{id:'probe.html',mediaType:'text/html',source:Buffer.from('<html>exact model inventory proof</html>'),compression:'gzip'}});
 const result=proof(root);assert.deepEqual(assertKeelRegisteredNativeGzipProof(result,root.rootBytes),result);
 const original=entries(root);
 const cases={
  'unreferenced extra buffer':items=>{const extra=structuredClone(items.find(item=>item.id==='original-buffer'));extra.id='extra';extra.aliases=['model/extra.bin'];items.push(extra)},
  'missing model':items=>{items.splice(items.findIndex(item=>item.id==='original-model'),1)},
  'missing actual buffer':items=>{items.splice(items.findIndex(item=>item.id==='original-buffer'),1)},
  'ambiguous alias':items=>{items.find(item=>item.id==='original-buffer').aliases=['model/complete.gltf']},
  'path escape':items=>{items.find(item=>item.id==='original-buffer').aliases=['../scene.bin']},
  'module masquerading as buffer':items=>{items.find(item=>item.id==='original-buffer').role='module'},
  'script MIME masquerading as buffer':items=>{items.find(item=>item.id==='original-buffer').mediaType='text/javascript'},
  'truncated actual buffer':items=>{const item=items.find(item=>item.id==='original-buffer');changeSource(item,Buffer.from([1,2,3]))},
  'external dependency':items=>{const item=items.find(item=>item.id==='original-model'),value=JSON.parse(item.embedded.storedText);value.buffers[0].uri='https://invalid.test/scene.bin';const bytes=Buffer.from(JSON.stringify(value));item.integrity=integrity(bytes);item.embedded={compression:'none',storedText:bytes.toString(),storedIntegrity:integrity(bytes)}}
 };
 for(const[name,mutate]of Object.entries(cases))await t.test(name,()=>{const items=structuredClone(original);mutate(items);assert.throws(()=>proof(fromEntries(items)))});
});
