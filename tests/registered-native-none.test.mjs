import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment,buildKeelInlineRawPercentTokenURIGraph,buildKeelPreparedOneOfOneTokenURI} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,assertKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from '../packages/sdk/dist/registered-native-gzip.js';
import {inspectKeelInlinePayloadCarriage,assertKeelFreshPayloadCarriage,assertKeelFreshPayloadAudit,auditKeelInlineTokenURI} from '../packages/sdk/dist/inline-transport-audit.js';
import {createKeelPublishReviewPlan,verifyKeelPublishReviewPlan} from '../packages/sdk/dist/publish-plan.js';
import {inferMediaType,normalizeAssets} from '../packages/studio-core/dist/media.js';
import {keelAssetDisplayKind} from '../packages/sdk/dist/asset-display.js';
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
 assert.equal(result.nativeNoneMembers.length,1);assert.deepEqual(result.nativeNoneMembers[0],{id:'artwork.mp4',role:'entrypoint',mediaType:'video/mp4',integrity:integrity(mp4),storedIntegrity:integrity(mp4)});
 assert.deepEqual(assertKeelRegisteredNativeGzipProof(result,root.rootBytes),result);
 assert.doesNotThrow(()=>assertKeelFreshPayloadCarriage(root.rootBytes,{registeredNativeGzip:result}));
 assert.doesNotThrow(()=>assertKeelFreshPayloadAudit(JSON.parse(JSON.stringify(inspectKeelInlinePayloadCarriage(root.rootBytes,{registeredNativeGzip:result})))));
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

test('registered native None proof and serialized audit reject malformed roles and one-to-one identity drift',async t=>{
 const root=await document(),current=proof(root),audit=inspectKeelInlinePayloadCarriage(root.rootBytes,{registeredNativeGzip:current});
 for(const role of [['entrypoint'],['asset'],['data'],{},null,7])await t.test('descriptor role '+JSON.stringify(role),()=>{
  const items=entries(root);items.find(item=>item.id==='artwork.mp4').role=role;assert.throws(()=>proof(fromEntries(items)),/role|descriptor|Native None/);
 });
 const proofCases={
  'None array null':value=>{value.nativeNoneMembers=null},
  'None array empty':value=>{value.nativeNoneMembers=[]},
  'missing member':value=>{delete value.nativeNoneMembers},
  'duplicate member':value=>{value.nativeNoneMembers.push({...value.nativeNoneMembers[0]})},
  'cross Gzip duplicate':value=>{value.nativeNoneMembers[0].id=value.members[0].id},
  'extra member':value=>{value.nativeNoneMembers.push({...value.nativeNoneMembers[0],id:'not-in-source'})},
  'unknown member field':value=>{value.nativeNoneMembers[0].compression='gzip'},
  'coerced member role':value=>{value.nativeNoneMembers[0].role=['entrypoint']},
  'script member MIME':value=>{value.nativeNoneMembers[0].mediaType='text/javascript'},
  'original drift':value=>{value.nativeNoneMembers[0].integrity.digest=hash(Buffer.from('wrong'))},
  'stored drift':value=>{value.nativeNoneMembers[0].storedIntegrity.digest=hash(Buffer.from('wrong'))},
 };
 for(const[name,mutate]of Object.entries(proofCases))await t.test('full proof '+name,()=>{const value=structuredClone(current);mutate(value);assert.throws(()=>assertKeelRegisteredNativeGzipProof(value,root.rootBytes))});
 const auditCases={
  'proof removed':value=>{delete value.registeredNativeGzip},
  'None evidence removed':value=>{delete value.registeredNativeGzip.nativeNoneMembers},
  'missing witness':(_value,payload)=>{delete payload.nativeNone},
  'extra witness field':(_value,payload)=>{payload.nativeNone.other=true},
  'witness role array':(_value,payload)=>{payload.nativeNone.role=['entrypoint']},
  'witness role drift':(_value,payload)=>{payload.nativeNone.role='asset'},
  'wrong payload ID':(_value,payload)=>{payload.id='different'},
  'wrong MIME':(_value,payload)=>{payload.mediaType='video/webm'},
  'wrong encoding':(_value,payload)=>{payload.encoding='hex'},
  'wrong compression':(_value,payload)=>{payload.compression='gzip'},
  'wrong original digest':(_value,payload)=>{payload.nativeNone.integrity.digest=hash(Buffer.from('wrong'))},
  'wrong stored digest':(_value,payload)=>{payload.nativeNone.storedIntegrity.digest=hash(Buffer.from('wrong'))},
  'wrong byte count':(_value,payload)=>{payload.binaryBytes++},
  'wrong Base64 length':(_value,payload)=>{payload.textCarriageBytes++},
  'duplicate payload':(value,payload)=>{value.payloads.push(structuredClone(payload));value.payloadCount++},
  'missing payload':value=>{value.payloads=value.payloads.filter(payload=>!payload.nativeNone);value.payloadCount=value.payloads.length},
  'witness on Gzip':value=>{value.payloads.find(payload=>payload.compression==='gzip').nativeNone=structuredClone(value.payloads.find(payload=>payload.nativeNone).nativeNone)},
  'null witness':(_value,payload)=>{payload.nativeNone=null},
  'unknown payload field':(_value,payload)=>{payload.other=true},
  'foreign transport profile':(_value,payload)=>{payload.transportProfile='uri81-block-v1'},
 };
 for(const[name,mutate]of Object.entries(auditCases))await t.test('serialized audit '+name,()=>{const value=structuredClone(audit);mutate(value,value.payloads.find(payload=>payload.nativeNone));assert.throws(()=>assertKeelFreshPayloadAudit(value))});
 let called=false;const getter=structuredClone(audit);Object.defineProperty(getter.payloads.find(payload=>payload.nativeNone).nativeNone,'role',{enumerable:true,get(){called=true;return'entrypoint'}});assert.throws(()=>assertKeelFreshPayloadAudit(getter));assert.equal(called,false);
 const arrayGetter=structuredClone(current);Object.defineProperty(arrayGetter.nativeNoneMembers,0,{get(){called=true;return current.nativeNoneMembers[0]}});assert.throws(()=>assertKeelRegisteredNativeGzipProof(arrayGetter));assert.equal(called,false);
 const hidden=structuredClone(current);Object.defineProperty(hidden.nativeNoneMembers[0],'other',{value:true});assert.throws(()=>assertKeelRegisteredNativeGzipProof(hidden));
 const symbolic=structuredClone(audit);symbolic.payloads.find(payload=>payload.nativeNone).nativeNone[Symbol('extra')]=true;assert.throws(()=>assertKeelFreshPayloadAudit(symbolic));
});

test('actual native None full metadata audit and COPY review survive JSON recovery without changing Gzip membership',async()=>{
 const root=await document(),registeredNativeGzip=proof(root),graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip});
 const image=readFileSync(new URL('./fixtures/media-viewers/still.png',import.meta.url));
 const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip,chainId:p.chainId,collection:'0x1111111111111111111111111111111111111111',collectionName:'Native original video',description:'Exact retained original',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'',manifestDigest:hash(Buffer.from('manifest'))});
 const audit=await auditKeelInlineTokenURI(prepared.tokenURI,{registeredNativeGzip});assert.equal(audit.freshPayloadPolicySatisfied,true);assertKeelFreshPayloadAudit(JSON.parse(JSON.stringify(audit.carriage)));
 const chunks=[];for(let at=0;at<graph.fragmentBytes.length;at+=23000){const bytes=graph.fragmentBytes.subarray(at,at+23000);chunks.push({byteLength:bytes.length,integrity:integrity(bytes)})}
 const operations=[];for(let at=0;at<chunks.length;at+=3){const batch=chunks.slice(at,at+3);operations.push({kind:'castSlugs',function:'castSlugs(bytes[])',payloadEncoding:'raw-bytes-from-files',chunkCount:batch.length,chunkByteLengths:batch.map(chunk=>chunk.byteLength),chunkIntegrities:batch.map(chunk=>chunk.integrity),slugIds:'derived-keccak256-after-review'})}
 operations.push({kind:'weldObject',function:'weldObject(bytes32[],bytes32,uint64,uint8,string)',slugIds:'from-preceding-castSlugs',digest:graph.fragmentIntegrity,byteLength:graph.fragmentBytes.length,compression:'none',mediaType:graph.mediaType});
 const chainPlan={schema:'keel-chain-operation-plan@1',status:'review-only',materialized:true,descriptorMaterialized:true,chainReady:false,target:{family:'ethereum',chainId:p.chainId,address:p.store},sourcePlan:{schema:'keel-upload-plan@2',objectName:'video-viewer',mediaType:graph.mediaType,integrity:graph.fragmentIntegrity},operations,encoding:'deferred-contract-abi',walletApproval:'required',signing:'not-performed',submission:'not-performed',caveat:'Local byte-bound COPY/recovery validation only.'};
 const envelope=await createKeelPublishReviewPlan(chainPlan,{preparedCopy:{registeredNativeGzip,graphBytes:graph.fragmentBytes,expectedTokenURI:prepared.tokenURI,returnedTokenURI:prepared.tokenURI,callGasLimit:30_000_000n,blockGasLimit:60_000_000n}});
 const recovered=JSON.parse(JSON.stringify(envelope));assert.equal((await verifyKeelPublishReviewPlan(recovered)).valid,true);
 const carriage=recovered.plan.preparedCopy.payloadCarriage;assert.equal(carriage.registeredNativeGzip.members.length,1);assert.equal(carriage.registeredNativeGzip.members[0].id,'keel.asset-display');assert.equal(carriage.registeredNativeGzip.nativeNoneMembers.length,1);assert.equal(carriage.payloads.find(payload=>payload.id==='artwork.mp4').nativeNone.role,'entrypoint');
 delete carriage.payloads.find(payload=>payload.id==='artwork.mp4').nativeNone;assert.equal((await verifyKeelPublishReviewPlan(recovered)).valid,false);
});


test('actual M4V native file retains exact source and MIME through default None proof and fresh COPY carriage',async t=>{
 for(const [name,mime,size,digest,brand]of [
  ['normal-artwork.m4v','video/x-m4v',1775,'eb417767725dbb6fc81fd5e88313f1c2d2a6e91206d2bc8d88075854d5d2f719','M4V '],
 ])await t.test(mime,async()=>{
  const source=readFileSync(new URL('./fixtures/registered-native-none/'+name,import.meta.url));assert.equal(source.length,size);assert.equal(hash(source),'0x'+digest);assert.equal(source.subarray(4,8).toString(),'ftyp');assert.equal(source.subarray(8,12).toString(),brand);assert.notDeepEqual(source,mp4);
  for(const declared of [undefined,'application/octet-stream',mime]){
   const normalized=normalizeAssets([{fileName:name,bytes:source,...(declared?{mediaType:declared}:{})}]);assert.equal(normalized[0].mediaType,mime);assert.equal(normalized[0].role,'video');assert.deepEqual(normalized[0].bytes,source);assert.equal(inferMediaType(name,declared),mime);
  }
  assert.equal(keelAssetDisplayKind(mime),'video');
  const root=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:name,mediaType:mime,source}}),item=entries(root).find(item=>item.id===name);assert.equal(item.mediaType,mime);assert.equal(item.embedded.compression,'none');assert.deepEqual(Buffer.from(item.embedded.storedBase64,'base64'),source);
  const current=proof(root);assert.equal(current.members.length,1);assert.equal(current.nativeNoneMembers.length,1);assert.equal(current.nativeNoneMembers[0].mediaType,mime);assert.deepEqual(assertKeelRegisteredNativeGzipProof(current,root.rootBytes),current);
  const audit=inspectKeelInlinePayloadCarriage(root.rootBytes,{registeredNativeGzip:current});assertKeelFreshPayloadAudit(JSON.parse(JSON.stringify(audit)));
  const graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip:current});assert.equal(graph.htmlIntegrity.digest,hash(root.rootBytes));
  const wrongBrand=Buffer.from(source);wrongBrand.write('NOPE',8);
  for(const compression of ['none','gzip']){
   const valid=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:name,mediaType:mime,source,compression}});assert.doesNotThrow(()=>proof(valid));
   for(const [badName,bytes,badMime]of [['HTML renamed',Buffer.from('<html>not a video</html>'),mime],['truncated source',source.subarray(0,-1),mime],['wrong major brand',wrongBrand,mime],['audio-only MOV',readFileSync(new URL('./fixtures/registered-native-none/audio-only.mov',import.meta.url)),mime],['unknown video type',source,'video/x-invented']]){
    if(badMime==='video/x-invented'){assert.throws(()=>keelAssetDisplayKind(badMime));continue}
    const forged=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:name,mediaType:badMime,source:bytes,compression}});assert.throws(()=>proof(forged),undefined,badName+' '+compression);
   }
  }
 });
});


test('QuickTime inference preserves the original but direct playback fails with actionable derivative guidance',async()=>{
 const source=readFileSync(new URL('./fixtures/registered-native-none/normal-artwork.mov',import.meta.url));assert.equal(source.length,1732);assert.equal(hash(source),'0xfe333b7dcd494dc0a7fbc755defb9fceb97aaa3aff960cdac77a570986c0d05f');assert.equal(source.subarray(8,12).toString(),'qt  ');
 const resource=normalizeAssets([{fileName:'original.mov',bytes:source}])[0];assert.equal(resource.mediaType,'video/quicktime');assert.deepEqual(resource.bytes,source);
 assert.throws(()=>keelAssetDisplayKind(resource.mediaType),/Keep the original.*separate MP4 playback derivative/);
 await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:resource.id,mediaType:resource.mediaType,source}}),/Keep the original.*separate MP4 playback derivative/);
 const safe=await document();
 for(const compression of ['none','gzip']){const items=entries(safe),item=items.find(item=>item.id==='artwork.mp4');item.mediaType='video/quicktime';item.integrity=integrity(source);const stored=compression==='gzip'?gzipSync(source):source;item.embedded={compression,storedBase64:stored.toString('base64'),storedIntegrity:integrity(stored)};assert.throws(()=>proof(fromEntries(items)),/Native None/)}
});
