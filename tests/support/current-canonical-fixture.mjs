import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decodeKeelInlineGraphFragment} from '../../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as profile} from '../../packages/sdk/dist/registered-native-gzip.js';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const raw='application/vnd.keel.token-uri-raw-percent-fragment';
export const currentIntegrity=bytes=>({algorithm:'sha256',digest:'0x'+createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length});
// Recorded public registered frames, not new reference assets or proof of a
// live creator publication. The maintained proof constructor authenticates
// their exact registered digest, metadata and reader profile below.
export function currentCanonicalShell(){
 const part=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),raw);return{bytes,integrity:currentIntegrity(bytes)};};
 return{schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:part('prefix'),suffix:part('suffix')};
}
export function withCurrentCanonicalFrames(document){
 const shell=currentCanonicalShell(),parts=document.parts.map((part,index)=>{
  const fragment=index===0?shell.prefix:index===document.parts.length-1?shell.suffix:undefined;
  return fragment?{...part,bytes:fragment.bytes,integrity:fragment.integrity,byteLength:fragment.bytes.length}:part;
 });
 const rootBytes=Uint8Array.from(Buffer.concat(parts.map(p=>p.bytes)));
 return{...document,parts,rootBytes,rootIntegrity:currentIntegrity(rootBytes),byteLength:rootBytes.length};
}
export function currentNativeGzipProof(document){
 const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(key=>[key,profile[key]]));
 Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:profile.metadataDigest,byteLength:profile.metadataByteLength}});
 return createKeelRegisteredNativeGzipProof({binding,documentBytes:document.rootBytes});
}
