import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument,buildKeelInlineLocalDocument,buildKeelInlineAssetDisplayModuleFragment,buildKeelInlineModuleFragment,buildKeelInlineTokenURIGraph,buildKeelRegisteredInlineNormalMediaTokenURIGraph} from '../packages/sdk/dist/inline-viewer-graph.js';
import {nativeFixture,audioCases,sha,currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});
const nativeRecipe=await currentNativeMediaRecipe();
const slot=part=>JSON.parse(new TextDecoder().decode(part.bytes).slice(1));
const unpack=item=>{const stored=item.embedded.storedText===undefined?Buffer.from(item.embedded.storedBase64,'base64'):new TextEncoder().encode(item.embedded.storedText);return item.embedded.compression==='gzip'?gunzipSync(stored):stored};
function carriers(graph){return graph.parts.filter(part=>part.sourceKind==='existing').map((part,index)=>({bytes:part.bytes,integrity:part.integrity,carrier:{chainId:11155111,store:'0x'+'ab'.repeat(20),objectId:'0x'+String(index+1).padStart(64,'0'),mediaType:graph.mediaType,compression:'none',storedByteLength:part.bytes.length}}))}
for(const audio of audioCases)test(`actual canonical ${audio.mediaType} graph retains the original once and builds exact derived presentation`,async()=>{
  const source=await nativeFixture(audio.name),before=source.slice(),document=await buildKeelInlineNormalMediaDocument({...nativeRecipe,asset:{id:'original-audio',...audio,source}});
  assert.deepEqual(document.parts.map(p=>p.role),['shell-prefix','module','asset','entrypoint','shell-suffix']);
  const creator=document.parts.filter(p=>p.kind==='creator').map(slot),original=creator.find(p=>p.id==='original-audio');
  assert.equal(creator.filter(item=>item.mediaType===audio.mediaType).length,1);assert.deepEqual(new Uint8Array(unpack(original)),source);assert.equal(original.integrity.digest,sha(source));
  assert.equal(document.declaration.creatorAsset.integrity.digest,sha(source));assert.equal(document.nativeMediaPresentation.original.integrity.digest,sha(source));
  assert.equal(document.nativeMediaPresentation.byteCounts.originalSources,source.length);assert.ok(document.nativeMediaPresentation.byteCounts.generatedHTML<1500);assert.deepEqual(source,before);
  const graph=await buildKeelInlineTokenURIGraph(document,{registeredNativeGzip:document.registeredNativeGzip}),registered=await buildKeelRegisteredInlineNormalMediaTokenURIGraph({document,existingParts:carriers(graph)});
  assert.deepEqual(registered.htmlBytes,graph.htmlBytes);assert.equal(registered.parts.filter(p=>p.sourceKind==='creator'&&p.role==='asset').length,1);
});
test('native audio exact cover is separate source, never a duplicate encoded artwork',async()=>{
  const source=await nativeFixture('tone.wav'),cover=new Uint8Array(await readFile(new URL('./fixtures/media-viewers/still.png',import.meta.url)));
  const document=await buildKeelInlineNormalMediaDocument({shell,payloadStorage:'raw',preview:{id:'cover',mediaType:'image/png',source:cover},asset:{id:'audio',mediaType:'audio/wav',source}});
  const originals=document.parts.filter(p=>p.role==='asset').map(slot);assert.equal(originals.length,2);assert.equal(originals[0].embedded.compression,'none');assert.deepEqual(new Uint8Array(unpack(originals[0])),source);assert.deepEqual(new Uint8Array(unpack(originals[1])),cover);
  assert.equal(document.nativeMediaPresentation.preview.integrity.digest,sha(cover));assert.equal(document.nativeMediaPresentation.byteCounts.originalSources,source.length+cover.length);
  await assert.rejects(buildKeelInlineTokenURIGraph(document),/authenticated current resource recipe/,'Raw binary audio does not authorize retired encoded None publication');
  const current=await buildKeelInlineNormalMediaDocument({...nativeRecipe,preview:{id:'cover',mediaType:'image/png',source:cover},asset:{id:'audio',mediaType:'audio/wav',source}}),graph=await buildKeelInlineTokenURIGraph(current,{registeredNativeGzip:current.registeredNativeGzip});
  await buildKeelRegisteredInlineNormalMediaTokenURIGraph({document:current,existingParts:carriers(graph)});
  const changed=structuredClone(current);changed.nativeMediaPresentation.original.integrity.digest='0x'+'00'.repeat(32);
  await assert.rejects(buildKeelRegisteredInlineNormalMediaTokenURIGraph({document:changed,existingParts:carriers(graph)}),/deterministic canonical/);
});
test('native graph snapshots originals before asynchronous preparation and rejects source/plan substitutions',async()=>{
  const original=await nativeFixture('tone.wav'),source=original.slice(),promise=buildKeelInlineNormalMediaDocument({...nativeRecipe,asset:{id:'audio',mediaType:'audio/wav',source}});source.fill(0);
  const document=await promise;assert.deepEqual(new Uint8Array(unpack(slot(document.parts.find(p=>p.role==='asset')))),original);
  const graph=await buildKeelInlineTokenURIGraph(document,{registeredNativeGzip:document.registeredNativeGzip}),changed=structuredClone(document);changed.parts.find(p=>p.role==='entrypoint').bytes[30]^=1;
  await assert.rejects(buildKeelRegisteredInlineNormalMediaTokenURIGraph({document:changed,existingParts:carriers(graph)}));
  await assert.rejects(buildKeelInlineNormalMediaDocument({shell,asset:{id:'keel-native-audio-presentation',mediaType:'audio/wav',source:original}}),/conflict/);
});
test('passive SVG exact bytes stay the direct verified source, executable SVG is never silently flattened',async()=>{
  const source=await nativeFixture('smil.svg'),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'original-svg',mediaType:'image/svg+xml',source}});
  assert.deepEqual(document.parts.map(p=>p.role),['shell-prefix','module','entrypoint','shell-suffix']);assert.deepEqual(new Uint8Array(unpack(slot(document.parts[2]))),source);
  const script=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),before=script.slice();
  await assert.rejects(buildKeelInlineNormalMediaDocument({shell,asset:{id:'original',mediaType:'image/svg+xml',source:script}}),/execution profile/);assert.deepEqual(script,before);
});
test('new media rejects old/counterfeit display and unsupported runtime MIME rather than parsing binary HTML',async()=>{
  const source=await nativeFixture('tone.wav'),old=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.4.0',mediaType:'text/javascript',decodedBytes:new Uint8Array(await readFile(new URL('./fixtures/asset-display-1.4.0.js',import.meta.url))),execution:'classic',phase:'render',compression:'none'});
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[old],entry:{id:'audio',mediaType:'audio/wav',source}}),/audio-capable/);
  const display=await buildKeelInlineAssetDisplayModuleFragment(),changed=structuredClone(display);changed.bytes[30]^=1;
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[changed],entry:{id:'audio',mediaType:'audio/wav',source}}),/canonical|exact/);
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'unsupported',mediaType:'audio/x-unknown',source}}),/no qualified current viewer/);
});

test('registered audio preparation snapshots the exact approved document before async validation',async()=>{
  const document=await buildKeelInlineNormalMediaDocument({...nativeRecipe,asset:{id:'audio',mediaType:'audio/wav',source:await nativeFixture('tone.wav')}}),expected=await buildKeelInlineTokenURIGraph(document,{registeredNativeGzip:document.registeredNativeGzip}),existingParts=carriers(expected);
  const pending=buildKeelRegisteredInlineNormalMediaTokenURIGraph({document,existingParts});document.parts.find(p=>p.role==='asset').bytes.fill(0);existingParts[0].bytes.fill(0);
  assert.deepEqual((await pending).htmlBytes,expected.htmlBytes);
});
test('a caller cannot forge a normal-media SVG declaration to suppress executable source',async()=>{
  const source=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const display=await buildKeelInlineAssetDisplayModuleFragment(),{buildEmbeddedKeelViewerSlot}=await import('../packages/sdk/dist/verification-shell.js');
  const document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'svg',mediaType:'image/svg+xml',source:await nativeFixture('still.svg')}}),replacement=await buildEmbeddedKeelViewerSlot({id:'svg',role:'entrypoint',mediaType:'image/svg+xml',bytes:source,compression:'none'});
  document.parts[2]={kind:'creator',role:'entrypoint',bytes:replacement.fragment,byteLength:replacement.fragment.length,integrity:replacement.fragmentIntegrity};
  document.declaration.creatorAsset.integrity=replacement.item.integrity;document.rootBytes=Buffer.concat(document.parts.map(p=>p.bytes));document.rootIntegrity={algorithm:'sha256',digest:sha(document.rootBytes),byteLength:document.rootBytes.length};document.byteLength=document.rootBytes.length;
  const graph=await buildKeelInlineTokenURIGraph(document);
  await assert.rejects(buildKeelRegisteredInlineNormalMediaTokenURIGraph({document,existingParts:carriers(graph)}),/execution profile/);
  assert.equal(display.moduleId,'keel.asset-display');
});
