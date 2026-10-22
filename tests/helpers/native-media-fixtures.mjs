import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
export const nativeFixtureRoot=new URL('../fixtures/native-media/',import.meta.url);
export const nativeManifest=JSON.parse(await readFile(new URL('manifest.json',nativeFixtureRoot),'utf8'));
export const sha=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
export async function nativeFixture(name){
  const bytes=new Uint8Array(await readFile(new URL(name,nativeFixtureRoot)));
  const identity=nativeManifest.files.find(row=>row.path===name);
  assert.ok(identity,`Committed input identity required: ${name}`);
  assert.equal(bytes.length,identity.byteLength);assert.equal(sha(bytes),'0x'+identity.sha256);
  return bytes;
}
export const audioCases=Object.freeze([
  {name:'tone.wav',mediaType:'audio/wav'}, {name:'tone.mp3',mediaType:'audio/mpeg'},
  {name:'tone.ogg',mediaType:'audio/ogg'}, {name:'tone.flac',mediaType:'audio/flac'},
  {name:'tone.aac',mediaType:'audio/aac'}, {name:'tone.m4a',mediaType:'audio/mp4'},
]);
/** Retained public revision-5 frame fixture, authenticated against maintained
 * hashes. This is local recipe evidence, never an RPC registration substitute. */
export async function currentNativeMediaRecipe(){
  const{gunzipSync}=await import('node:zlib'),{decodeKeelInlineGraphFragment}=await import('../../packages/sdk/dist/inline-viewer-graph.js'),{KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE:p}=await import('../../packages/sdk/dist/registered-native-gzip.js');
  const fixture=JSON.parse(gunzipSync(await readFile(new URL('../fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
  const half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');assert.equal(bytes.length,p[side+'ByteLength']);assert.equal(sha(bytes),p[side+'Digest']);return{bytes,integrity:{algorithm:'sha256',digest:sha(bytes),byteLength:bytes.length}}};
  const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')};
  const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));
  Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
  return{shell,registeredNativeGzipBinding:binding};
}
