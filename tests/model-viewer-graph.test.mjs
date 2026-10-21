import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {getAddress} from 'viem';
import {modelFixture,completeModelDocument,modelFixtureBytes,currentRecipeModelDocument} from './helpers/model-viewer-fixtures.mjs';
import {inspectKeelModelMedia,resolveKeelModelResourcePath} from '../packages/sdk/dist/model-media.js';
import {keelModelDisplayModuleBytes,KEEL_MODEL_DISPLAY_REVISION,KEEL_MODEL_VENDOR_MODULES} from '../packages/sdk/dist/model-viewer-module.js';
import {buildKeelInlineLocalDocument,buildKeelInlineNormalMediaDocument,buildKeelInlineModelMediaDocument,buildKeelInlineRawPercentTokenURIGraph,buildKeelRegisteredInlineModelMediaTokenURIGraph} from '../packages/sdk/dist/inline-viewer-graph.js';
test('model renderer and maintained loader descriptors pin complete exact licensed source bytes',()=>{
 new Script(new TextDecoder().decode(keelModelDisplayModuleBytes()).replace('export function createModelViewer','function createModelViewer'));
 for(const profile of [{...KEEL_MODEL_DISPLAY_REVISION,source:new TextDecoder().decode(keelModelDisplayModuleBytes())},...KEEL_MODEL_VENDOR_MODULES]){const bytes=new TextEncoder().encode(profile.source);assert.equal(bytes.length,profile.byteLength);assert.equal('0x'+createHash('sha256').update(bytes).digest('hex'),profile.digest);if(profile.version==='0.180.0')assert.match(profile.source,/The MIT License/)}
});
async function syntheticReadContext(){
 const input=await currentRecipeModelDocument('glb'),graph=await buildKeelInlineRawPercentTokenURIGraph(input.document,{registeredNativeGzip:input.document.registeredNativeGzip}),scope={blockNumber:1n,blockHash:'0x'+'12'.repeat(32)},binding=structuredClone(input.registeredNativeGzipBinding),store=binding.store,builder=binding.reader,calls=[];
 const existingParts=graph.parts.filter(p=>p.sourceKind==='existing').map((p,index)=>({bytes:p.bytes.slice(),integrity:{...p.integrity},carrier:{chainId:11155111,store,objectId:index===0?binding.prefixObjectId:index===6?binding.suffixObjectId:'0x'+String(index+1).padStart(64,'0'),mediaType:graph.mediaType,compression:'none',storedByteLength:p.bytes.length}})),objects=new Map(existingParts.map(p=>[p.carrier.objectId,p.bytes.slice()]));
 return {input:{...input,chainId:11155111,store,builder,readScope:{...scope},existingParts,readCurrentNativeGzipBinding:async readScope=>{assert.deepEqual(readScope,scope);calls.push({kind:'reader-binding'});return structuredClone(binding)},readObject:async(carrier,readScope)=>{assert.deepEqual(readScope,scope);calls.push({kind:'object',id:carrier.objectId});return objects.get(carrier.objectId).slice()},readRegistration:async(request)=>{assert.deepEqual({blockNumber:request.blockNumber,blockHash:request.blockHash},scope);assert.equal(request.builder,getAddress(builder));assert.equal(request.chainId,11155111);assert.equal(request.store,store);calls.push({kind:'registration',id:request.objectId});return true},readBlockHash:async number=>{assert.equal(number,scope.blockNumber);return scope.blockHash}},calls};
}
test('synthetic selected-chain model reuse requires exact pinned-block object and registry reads for every reusable fragment',async()=>{
 const {input,calls}=await syntheticReadContext(),result=await buildKeelRegisteredInlineModelMediaTokenURIGraph(input);
 assert.equal(calls.filter(c=>c.kind==='reader-binding').length,2);assert.equal(calls.filter(c=>c.kind==='object').length,7);assert.equal(calls.filter(c=>c.kind==='registration').length,7);assert.equal(result.registeredNativeGzip.binding.reader,input.registeredNativeGzipBinding.reader);assert.equal(result.registeredNativeGzip.documentIntegrity.digest,result.htmlIntegrity.digest);assert.equal(result.modelPresentation.originalEntry.id,'original-model');assert.equal(result.modelPresentation.generatedEntry.kind,'derived-presentation');assert.equal(result.parts.filter(p=>p.sourceKind==='existing').length,7);
});
test('synthetic wrong chain, absent registration, altered read-back and changed block never qualify model reuse',async()=>{
 for(const mode of ['chain','registration','read','block']){const {input,calls}=await syntheticReadContext();if(mode==='chain')input.existingParts[0].carrier.chainId=1;if(mode==='registration')input.readRegistration=async()=>false;if(mode==='read')input.readObject=async carrier=>new Uint8Array([1,2,3]);if(mode==='block')input.readBlockHash=async()=>'0x'+'ff'.repeat(32);await assert.rejects(buildKeelRegisteredInlineModelMediaTokenURIGraph(input),mode==='chain'?/selected chain/:mode==='registration'?/not registered/:mode==='read'?/read-back differs/:/block changed/);if(mode==='chain'||mode==='registration')assert.equal(calls.filter(c=>c.kind==='object').length,0)}
});
test('model preparation snapshots original bytes, module closure, ordered reuse and block assumptions before asynchronous reads',async()=>{
 const {input}=await syntheticReadContext(),before=input.document.modelPresentation.originalEntry.integrity.digest,originalRead=input.readRegistration;let changed=false;
 input.readRegistration=async request=>{if(!changed){changed=true;input.entry.source[0]^=255;input.modules[0].bytes[0]^=255;input.existingParts.pop();input.readScope.blockHash='0x'+'ff'.repeat(32);input.registeredNativeGzipBinding.reader='0x'+'ff'.repeat(20)}return await originalRead(request)};
 // Caller-owned scope changed deliberately; callbacks still receive the frozen original scope.
 input.readBlockHash=async()=>'0x'+'12'.repeat(32);
 const result=await buildKeelRegisteredInlineModelMediaTokenURIGraph(input);assert.equal(result.modelPresentation.originalEntry.integrity.digest,before);assert.equal(result.parts.filter(p=>p.sourceKind==='existing').length,7);
});
test('local source profiles cannot become registered model authority without the exact current reader contract',async()=>{
 const {input}=await syntheticReadContext();
 for(const key of ['registeredNativeGzipBinding','readCurrentNativeGzipBinding']){const missing={...input};delete missing[key];await assert.rejects(buildKeelRegisteredInlineModelMediaTokenURIGraph(missing));}
 for(const changed of [{chainId:1},{store:'0x'+'ab'.repeat(20)},{builder:'0x'+'ab'.repeat(20)}])await assert.rejects(buildKeelRegisteredInlineModelMediaTokenURIGraph({...input,...changed}),/selected chain, store and deployed reader/);
 const local=await completeModelDocument('glb');await assert.rejects(buildKeelRegisteredInlineModelMediaTokenURIGraph({...input,shell:local.shell}),/exact authenticated current native Gzip frames/);
});
test('stale current-reader reauthentication and swapped shell object IDs reject before assembly',async()=>{
 for(const mode of ['before','after','shell']){const{input,calls}=await syntheticReadContext();let reads=0;
  if(mode==='shell')input.existingParts.at(-1).carrier.objectId='0x'+'ab'.repeat(32);
  else input.readCurrentNativeGzipBinding=async()=>{reads++;return reads===(mode==='before'?1:2)?{...input.registeredNativeGzipBinding,revision:4}:structuredClone(input.registeredNativeGzipBinding)};
  await assert.rejects(buildKeelRegisteredInlineModelMediaTokenURIGraph(input),mode==='shell'?/shell object differs/:/exact maintained selected-chain registered reader/);if(mode==='before')assert.equal(calls.length,0);
 }
});
test('current model recipe counts complete source descriptors and explicitly retains binary Gzip rather than an inadmissible None body',async()=>{
 const input=await currentRecipeModelDocument('glb'),storage=input.document.modelPresentation.sourceStorage;
 assert.equal(storage.find(r=>r.id==='original-model').compression,'gzip');assert.equal(storage.find(r=>r.id==='original-model').decodedByteLength,input.entry.source.length);
 assert.equal(storage.reduce((n,r)=>n+r.descriptorByteLength,0),input.document.parts.filter(p=>p.kind==='creator').reduce((n,p)=>n+p.byteLength,0));
 assert.equal(input.document.modelPresentation.byteCounts.completeHTML,input.document.rootBytes.length);assert.equal(input.document.modelPresentation.byteCounts.sharedDecodedModules,input.modules.reduce((n,m)=>n+m.item.integrity.byteLength,0));
 await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(input.document),/forbids new storedBase64/);
 const result=await buildKeelInlineRawPercentTokenURIGraph(input.document,{registeredNativeGzip:input.document.registeredNativeGzip});assert.equal(result.htmlIntegrity.digest,input.document.rootIntegrity.digest);
});
for(const format of ['glb','gltf','obj'])test(`complete ${format} originals use an exact typed loader graph and retain every original dependency`,async()=>{
 const input=await completeModelDocument(format),profile=inspectKeelModelMedia(input.entry,input.assets);
 assert.equal(profile.format,format==='obj'?'obj':'gltf');assert.equal(input.document.parts.filter(p=>p.role==='module').length,5);assert.deepEqual(input.document.parts.filter(p=>p.kind==='creator').map(p=>p.role),['asset',...input.assets.map(()=> 'asset'),'entrypoint']);
 for(const asset of [input.entry,...input.assets])assert.equal(asset.source.length,(await modelFixtureBytes(asset===input.entry?`complete.${format}`:asset.id==='original-buffer'?'scene.bin':asset.id==='original-texture'?'textures/checker.png':'materials.mtl')).length);
 assert.equal(input.document.modelPresentation.originalEntry.id,input.entry.id);assert.equal(input.document.modelPresentation.generatedEntry.kind,'derived-presentation');assert.equal(input.document.modelPresentation.originalEntry.integrity.digest,'0x'+createHash('sha256').update(input.entry.source).digest('hex'));assert.equal(input.modules.some(m=>m.moduleId==='keel.asset-display'),false);assert.equal(input.modules.at(-1).moduleId,'keel.model-display');
});
test('the exact original four-byte GLB placeholder fails before preparation and never selects the prototype',async()=>{
 const input=await completeModelDocument('glb'),asset={id:'scene.glb',mediaType:'model/gltf-binary',source:new Uint8Array([0x67,0x6c,0x54,0x46])};
 assert.throws(()=>inspectKeelModelMedia(asset),/Malformed GLB/);await assert.rejects(buildKeelInlineNormalMediaDocument({shell:input.shell,asset}),/Malformed GLB/);
});
test('missing, extra, reordered and aliased model modules fail the exact graph',async()=>{
 const input=await completeModelDocument('glb');
 for(const modules of [input.modules.slice(1),[...input.modules,input.modules[0]],[input.modules[1],input.modules[0],...input.modules.slice(2)],input.modules.map((m,i)=>i?m:{...m,version:'0.179.0'})])await assert.rejects(buildKeelInlineModelMediaDocument({...input,modules}),/closure|identity|Duplicate/);
 const altered=input.modules.map((m,i)=>i?m:{...m,bytes:m.bytes.slice()});altered[0].bytes[10]^=1;await assert.rejects(buildKeelInlineModelMediaDocument({...input,modules:altered}),/canonical closed graph/);
});
test('missing, extra, ambiguous, external and escaping model dependencies fail closed',async()=>{
 const input=await completeModelDocument('gltf');
 for(const assets of [input.assets.slice(1),[...input.assets,{...input.assets[0],id:'extra-buffer',aliases:['extra.bin']}],input.assets.map((a,i)=>i?a:{...a,aliases:['model/textures/checker.png']})])await assert.rejects(buildKeelInlineModelMediaDocument({...input,assets}),/Missing|Extra|Ambiguous/);
 for(const uri of ['https://example.org/model.bin','//example.org/model.bin','../../escape.bin','%2fmodel.bin','textures\\checker.png','scene.bin?b=1','scene.bin#b'])assert.throws(()=>resolveKeelModelResourcePath('model/complete.gltf',uri),/relative|escape|Ambiguous/);
});
test('unsupported required decoders and truncated model buffers never degrade to a partial success',async()=>{
 const input=await modelFixture('gltf'),json=JSON.parse(new TextDecoder().decode(input.entry.source));
 for(const extension of ['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu','UNKNOWN_required_renderer']){const changed={...json,extensionsUsed:[extension],extensionsRequired:[extension]},entry={...input.entry,source:new TextEncoder().encode(JSON.stringify(changed))};assert.throws(()=>inspectKeelModelMedia(entry,input.assets),/exact registered decoder/)}
 const assets=input.assets.map((a,i)=>i?a:{...a,source:a.source.slice(0,-1)});assert.throws(()=>inspectKeelModelMedia(input.entry,assets),/buffer length/);
});
