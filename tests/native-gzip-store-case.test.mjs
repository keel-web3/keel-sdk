import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildKeelInlineLocalDocument,decodeKeelInlineGraphFragment,buildKeelInlineRawPercentTokenURIGraph,buildKeelPreparedOneOfOneTokenURI} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,assertKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p,resolveKeelInlineBuildRoute} from '../packages/sdk/dist/inline-build-route.js';
import {assertKeelFreshPayloadCarriage,auditKeelInlineTokenURI,assertKeelFreshPayloadAudit} from '../packages/sdk/dist/inline-transport-audit.js';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const integrity=b=>({algorithm:'sha256',digest:hash(b),byteLength:b.length});
const half=side=>decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');
const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:{bytes:half('prefix'),integrity:integrity(half('prefix'))},suffix:{bytes:half('suffix'),integrity:integrity(half('suffix'))}};
const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));
Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
const original=Buffer.from('<!doctype html><html><body>水'+(' exact input '.repeat(100))+'</body></html>');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=','base64');
const document=()=>buildKeelInlineLocalDocument({shell,modules:[],assets:[{id:'poster.png',mediaType:'image/png',source:image,compression:'none'}],entry:{id:'entry.html',mediaType:'text/html',source:original,compression:'gzip'}});
const proof=root=>createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});

import {assertKeelPreparedCopyRead} from '../packages/sdk/dist/prepared-copy-publication.js';
async function capture(bindingValue) {
 const root=await document();
 const registeredNativeGzip=createKeelRegisteredNativeGzipProof({binding:bindingValue,documentBytes:root.rootBytes});
 const graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip});
 const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip,chainId:p.chainId,collection:'0x1111111111111111111111111111111111111111',collectionName:'x',description:'x',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'x',manifestDigest:hash(image)});
 return {chainId:p.chainId,store:p.store,mediaType:graph.mediaType,graphBytes:graph.fragmentBytes,graphIntegrity:graph.fragmentIntegrity,expectedTokenURI:prepared.tokenURI,returnedTokenURI:prepared.tokenURI,callGasLimit:10000000n,blockGasLimit:60000000n,registeredNativeGzip};
}
test('unchanged authentic native gzip frame and lower-case store pass actual COPY readback',async()=>{
 const input=await capture(binding);
 const checked=await assertKeelPreparedCopyRead(input);
 assert.equal(checked.store,p.store.toLowerCase());
 assert.equal(checked.selectedChainReadAuthenticated,false);
});
test('same valid registered store with case-only spelling retains actual COPY readback',async()=>{
 const mixed='0x'+p.store.slice(2).toUpperCase();
 assert.notEqual(mixed,p.store);assert.equal(mixed.toLowerCase(),p.store.toLowerCase());
 const input=await capture({...binding,store:mixed});
 assert.equal(input.registeredNativeGzip.binding.store,mixed);
 assert.equal(input.registeredNativeGzip.binding.store.toLowerCase(),input.store.toLowerCase());
 const checked=await assertKeelPreparedCopyRead(input);
 assert.equal(checked.store,p.store.toLowerCase());
});
test('wrong store remains rejected before a COPY readback can qualify',async()=>{
 const input=await capture(binding);
 await assert.rejects(assertKeelPreparedCopyRead({...input,store:'0x1111111111111111111111111111111111111111'}),/selected chain\/store/);
});
