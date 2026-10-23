import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment} from './packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,assertKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from './packages/sdk/dist/registered-native-gzip.js';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex'),integrity=b=>({algorithm:'sha256',digest:hash(b),byteLength:b.length});
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./tests/fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');return{bytes,integrity:integrity(bytes)}};
const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')};
const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
const source=readFileSync(new URL('./tests/fixtures/registered-native-none/normal-artwork.mp4',import.meta.url));
const display=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:readFileSync(new URL('./tests/fixtures/asset-display-1.1.0.js',import.meta.url)),execution:'classic',phase:'render',weight:0,compression:'gzip'});
const root=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'artwork.mp4',mediaType:'video/mp4',source}});
const original=JSON.parse('[null'+Buffer.from(root.rootBytes).toString().slice(p.prefixByteLength,-p.suffixByteLength)+']').slice(1);

import {inspectKeelInlinePayloadCarriage,assertKeelFreshPayloadCarriage} from './packages/sdk/dist/inline-transport-audit.js';
const proof=createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});
test('validated actual registered MP4 None recipe must pass the full fresh-carriage guard',t=>{
 const audit=inspectKeelInlinePayloadCarriage(root.rootBytes,{registeredNativeGzip:proof});
 t.diagnostic(JSON.stringify({documentBytes:root.rootBytes.length,documentSHA256:hash(root.rootBytes),sourceIntegrity:integrity(source),members:proof.members,payloads:audit.payloads}));
 assert.doesNotThrow(()=>assertKeelFreshPayloadCarriage(root.rootBytes,{registeredNativeGzip:proof}));
});
test('the same encoded MP4 without exact authenticated recipe remains rejected',()=>{
 assert.throws(()=>assertKeelFreshPayloadCarriage(root.rootBytes),/without the authenticated|Fresh Inline/);
});
