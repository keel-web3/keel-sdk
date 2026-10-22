import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createIntegrity} from '../../packages/protocol/dist/index.js';
import {assertKeelThreeR180OfficialBytes} from '../../packages/sdk/dist/three-module.js';
export async function publishedThreeFixture(){
 const packed=await readFile(new URL('../fixtures/authored-published-three.json.gz',import.meta.url));assert.equal(createHash('sha256').update(packed).digest('hex'),'7b6f7c399a28fb1b7abb48987a6b10e2608b24e5223802b64a55e3857d04f2f3');const fixture=JSON.parse(gunzipSync(packed));
 const core=new Uint8Array(await readFile(new URL('../../examples/demos/vendor/three.core.min.js',import.meta.url)));
 const main=new TextEncoder().encode((await readFile(new URL('../../examples/demos/vendor/three.min.js',import.meta.url),'utf8')).replaceAll('from"/content/three.core.min.js"','from"./three.core.min.js"'));
 await assertKeelThreeR180OfficialBytes({core,main});
 const publishedModules=fixture.modules.map((item,index)=>({binding:{moduleId:item.entry.moduleId,version:item.entry.version,digest:'sha256:'+item.entry.source.digest.slice(2),objectId:item.entry.source.objectId,store:fixture.store,chain:'eip155:'+fixture.chainId},source:index?main:core}));
 for(const item of fixture.modules){const bytes=Buffer.from(item.fragmentBase64,'base64');assert.equal((await createIntegrity(bytes)).digest,item.entry.digest);assert.equal(bytes.length,item.entry.byteLength)}
 return{...fixture,publishedModules};
}

export async function authoredRuntimeResolutionFixture(){
 const fixture=await publishedThreeFixture();const {currentNativeMediaRecipe}=await import('./native-media-fixtures.mjs');const {registeredNativeGzipBinding:reader}=await currentNativeMediaRecipe();
 return{schema:'keel-authored-runtime-resolution@1',runtime:'three',version:'0.180.0',chainId:11155111,pin:{blockNumber:'11967301',blockHash:fixture.readbackBlock.hash},reader:{...reader,builderDeploymentTransactionHash:reader.readerDeploymentTransactionHash},
 modules:await Promise.all(fixture.publishedModules.map(async(module,index)=>({binding:module.binding,sourceIntegrity:await createIntegrity(module.source),sourceBase64:Buffer.from(module.source).toString('base64'),license:'MIT',execution:'module',aliases:fixture.modules[index].entry.aliases,dependencies:index?['three-r180-core']:[],fragment:{objectId:fixture.modules[index].entry.objectId,integrity:{algorithm:'sha256',digest:fixture.modules[index].entry.digest,byteLength:fixture.modules[index].entry.byteLength},mediaType:fixture.modules[index].entry.mediaType,compression:'none'}}))),publicationReady:false,signing:'not-performed',submission:'not-performed'};
}
