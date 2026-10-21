import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildKeelInlineShellFragments,buildKeelInlineModelViewerModules,buildKeelInlineModelMediaDocument,decodeKeelInlineGraphFragment} from '../../packages/sdk/dist/inline-viewer-graph.js';
import {KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from '../../packages/sdk/dist/inline-build-route.js';
const root=new URL('../fixtures/model-viewers/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
export async function modelFixtureBytes(path){const bytes=await readFile(new URL(path,root)),pin=manifest.files.find(p=>p.path===path);assert.ok(pin);assert.equal(bytes.length,pin.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256);return new Uint8Array(bytes)}
export async function modelFixture(format){
 const mime={glb:'model/gltf-binary',gltf:'model/gltf+json',obj:'model/obj'},entry={id:'original-model',mediaType:mime[format],aliases:[`model/complete.${format}`],source:await modelFixtureBytes(`complete.${format}`)};
 const assets=format==='glb'?[]:format==='gltf'?[{id:'original-buffer',mediaType:'application/octet-stream',aliases:['model/scene.bin'],source:await modelFixtureBytes('scene.bin')},{id:'original-texture',mediaType:'image/png',aliases:['model/textures/checker.png'],source:await modelFixtureBytes('textures/checker.png')}]:[{id:'original-materials',mediaType:'text/plain',aliases:['model/materials.mtl'],source:await modelFixtureBytes('materials.mtl')},{id:'original-texture',mediaType:'image/png',aliases:['model/textures/checker.png'],source:await modelFixtureBytes('textures/checker.png')}];
 return {entry,assets};
}
export async function completeModelDocument(format){
 const fixture=await modelFixture(format),[main,core]=await Promise.all([readFile(new URL('../../examples/demos/vendor/three.min.js',import.meta.url),'utf8'),readFile(new URL('../../examples/demos/vendor/three.core.min.js',import.meta.url))]);
 const modules=await buildKeelInlineModelViewerModules({format:format==='obj'?'obj':'gltf',materialLibraries:format==='obj',three:{main:new TextEncoder().encode(main.replaceAll('from"/content/three.core.min.js"','from"./three.core.min.js"')),core:new Uint8Array(core)}}),shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineModelMediaDocument({shell,modules,...fixture});
 return {shell,modules,document,...fixture};
}
/** Retained public current-frame fixture; this is byte qualification, NOT live authentication. */
export async function currentRecipeModelDocument(format){
 const input=await completeModelDocument(format),fixture=JSON.parse(gunzipSync(await readFile(new URL('../fixtures/registered-native-gzip-revision5.json.gz',import.meta.url)))),integrity=bytes=>({algorithm:'sha256',digest:'0x'+createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length}),half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');assert.equal(bytes.length,p[side+'ByteLength']);assert.equal(integrity(bytes).digest,p[side+'Digest']);return{bytes,integrity:integrity(bytes)}};
 const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')},binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
 const document=await buildKeelInlineModelMediaDocument({...input,shell,registeredNativeGzipBinding:binding});return{...input,shell,document,registeredNativeGzipBinding:binding};
}
