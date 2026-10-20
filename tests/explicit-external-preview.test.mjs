import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {
  buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlineRawPercentTokenURIGraph,
  buildKeelPreparedOneOfOneTokenURI, decodeKeelInlineGraphFragment,
  prepareKeelExplicitExternalPreview, snapshotKeelExplicitExternalPreview,
} from '../packages/sdk/dist/inline-viewer-graph.js';
import {auditKeelInlineTokenURI,assertKeelPreparedCollectorInlineMetadata} from '../packages/sdk/dist/inline-transport-audit.js';
import {assertKeelPreparedCopyRead} from '../packages/sdk/dist/prepared-copy-publication.js';
import {readKeelInlineTokenAudit} from '../packages/sdk/dist/inline-token-read.js';
import {createKeelPublishReviewPlan,verifyKeelPublishReviewPlan} from '../packages/sdk/dist/publish-plan.js';
import {createKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as profile} from '../packages/sdk/dist/inline-build-route.js';
import {createIntegrity} from '../packages/protocol/dist/index.js';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=','base64');
const integrity=bytes=>({algorithm:'sha256',digest:'0x'+createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length});
const store='0x1111111111111111111111111111111111111111', chainId=11155111;
const https='https://preview.example/art%20image.png?version=1', ipfs='ipfs://bafybeiexactcommitment/poster.png';
const proof=async(uri=https)=>prepareKeelExplicitExternalPreview({uri,mediaType:'image/png',sourceBytes:image,expectedSourceIntegrity:integrity(image)});
async function fixture(uri=https, nativeGzip=false) {
  let shell=await buildKeelInlineShellFragments(), binding;
  if(nativeGzip) {
    const frames=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
    const half=side=>decodeKeelInlineGraphFragment(Buffer.from(frames.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');
    shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:{bytes:half('prefix'),integrity:integrity(half('prefix'))},suffix:{bytes:half('suffix'),integrity:integrity(half('suffix'))}};
    binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(key=>[key,profile[key]]));
    Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:profile.metadataDigest,byteLength:profile.metadataByteLength}});
  }
  const source=new TextEncoder().encode('<!doctype html><html><body>Original 水 🐊'+(' exact resource '.repeat(50))+'</body></html>');
  const root=await buildKeelInlineLocalDocument({shell,modules:[],assets:[],entry:{id:'entry.html',mediaType:'text/html',source,compression:nativeGzip?'gzip':'none'}});
  const registeredNativeGzip=nativeGzip?createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes}):undefined;
  const graph=await buildKeelInlineRawPercentTokenURIGraph(root,{...(registeredNativeGzip?{registeredNativeGzip}:{})});
  const externalPreview=await proof(uri);
  const input={graph,chainId,collection:'0x2222222222222222222222222222222222222222',collectionName:'Exact 🐊',description:'Unchanged source',manifestURI:'web3://existing',manifestDigest:integrity(Buffer.from('manifest')).digest,imageURI:uri,presentationPolicy:'collector-inline',externalPreview,...(registeredNativeGzip?{registeredNativeGzip}:{})};
  const prepared=await buildKeelPreparedOneOfOneTokenURI(input);
  const bound={chainId,store:nativeGzip?profile.store:store,mediaType:graph.mediaType,graphBytes:graph.fragmentBytes,graphIntegrity:graph.fragmentIntegrity,expectedTokenURI:prepared.tokenURI,returnedTokenURI:prepared.tokenURI,callGasLimit:30_000_000n,blockGasLimit:60_000_000n,externalPreview,...(registeredNativeGzip?{registeredNativeGzip}:{})};
  return {root,source,graph,externalPreview,registeredNativeGzip,input,prepared,bound};
}
for(const uri of [https,ipfs]) test(`explicit exact ${new URL(uri).protocol} preview works through actual final compiler/audit/COPY with no SDK fetch`,async()=>{
  const originalFetch=globalThis.fetch;let fetched=0;
  globalThis.fetch=()=>{fetched++;throw new Error('SDK must not fetch external preview');};
  try{
    const f=await fixture(uri),metadata=JSON.parse(f.prepared.tokenJSON);
    assert.equal(metadata.image,uri);assert.match(metadata.animation_url,/^data:text\/html;charset=utf-8,/);
    assert.ok(decodeURIComponent(metadata.animation_url.split(',').slice(1).join(',')).startsWith(new TextDecoder().decode(f.root.rootBytes)));
    assert.equal(f.prepared.externalPreview.uri,uri);assert.notEqual(f.prepared.externalPreview,f.externalPreview);
    const audit=await auditKeelInlineTokenURI(f.prepared.tokenURI,{externalPreview:f.externalPreview});
    assert.equal(audit.imageBytes,0);assert.equal(audit.imageURIBytes,Buffer.byteLength(uri));
    assert.deepEqual(audit.externalPreview.sourceIntegrity,integrity(image));assert.equal(audit.externalPreviewAvailability,'not-inspected');
    assert.equal(audit.externalPreviewSourceBytesRevalidated,false);assert.equal(audit.uriCompatibility.image,null);
    assert.equal(audit.completeDocumentBase64Layers,0);assert.equal(audit.freshPayloadPolicySatisfied,true);assert.equal(audit.browserVerified,false);
    const copy=await assertKeelPreparedCopyRead(f.bound);assert.deepEqual(copy.externalPreview,f.externalPreview);assert.equal(copy.selectedChainReadAuthenticated,false);
    assert.equal(fetched,0);
  }finally{globalThis.fetch=originalFetch;}
});
test('default collector policy still rejects external images; exact URI, source and canonical animation remain mandatory',async()=>{
 const f=await fixture();
 const {externalPreview:_removed,...strict}=f.input;
 await assert.rejects(buildKeelPreparedOneOfOneTokenURI(strict),/Inline image URI|image.*self-contained|image URI/i);
 await assert.rejects(auditKeelInlineTokenURI(f.prepared.tokenURI),/data URI|inline data|data:image/i);
 await assert.rejects(assertKeelPreparedCopyRead({...f.bound,externalPreview:undefined}),/self-contained original collector image/);
 await assert.rejects(buildKeelPreparedOneOfOneTokenURI({...f.input,imageURI:ipfs}),/differs from the exact/);
 const metadata=JSON.parse(f.prepared.tokenJSON);
 for(const animation_url of ['https://host.example/shell','data:text/html;charset=utf-8,'+encodeURIComponent('<html>unregistered</html>'),'data:text/html;base64,'+Buffer.from('<html>verify-corner</html>').toString('base64')])
   assert.throws(()=>assertKeelPreparedCollectorInlineMetadata({...metadata,animation_url},{externalPreview:f.externalPreview}),/Inline|canonical|raw-percent/i);
 for(const input of [
   {...f.input,graph:{...f.graph,mediaType:'application/vnd.keel.token-uri-base64-fragment'}},
   {...f.input,presentationPolicy:'raw-artifact'}]) await assert.rejects(buildKeelPreparedOneOfOneTokenURI(input),/raw-percent canonical/);
 await assert.rejects(auditKeelInlineTokenURI('data:application/json;base64,'+Buffer.from(f.prepared.tokenJSON).toString('base64'),{externalPreview:f.externalPreview}),/raw-percent metadata/);
 await assert.rejects(assertKeelPreparedCopyRead({...f.bound,returnedTokenURI:f.prepared.tokenURI+'x'}),/differs from canonical/);
});
test('constructor validates exact saved bytes, MIME and safe URI without normalization',async()=>{
 for(const uri of ['http://preview.example/a.png','https://user:password@preview.example/a.png','https://preview.example/a.png#part','https://preview.example/white space','https://preview.example/%QQ','javascript:alert(1)','ipfs:///missing-host'])
   await assert.rejects(proof(uri),/preview|HTTPS|IPFS/i);
 for(const changed of [{mediaType:'text/html'},{mediaType:'image/jpeg'},{expectedSourceIntegrity:{...integrity(image),digest:'0x'+'1'.repeat(64)}},{expectedSourceIntegrity:{...integrity(image),byteLength:image.length+1}},{sourceBytes:Buffer.from('not image')}])
   await assert.rejects(prepareKeelExplicitExternalPreview({uri:https,mediaType:'image/png',sourceBytes:image,expectedSourceIntegrity:integrity(image),...changed}),/preview|image|PNG|JPEG|commitment/i);
 const selected='https://PREVIEW.example:443/art%2fimage.png';assert.equal((await proof(selected)).uri,selected);
});
test('commitment snapshots reject extra/getter/symbol/prototype fields without reading accessors and resist mutation during async hash',async()=>{
 const original=await proof();let accesses=0;
 const getters={...original};Object.defineProperty(getters,'uri',{enumerable:true,get(){accesses++;return https;}});
 const nested={...original,sourceIntegrity:{...original.sourceIntegrity}};Object.defineProperty(nested.sourceIntegrity,'digest',{enumerable:true,get(){accesses++;return original.sourceIntegrity.digest;}});
 for(const value of [{...original,unexpected:true},{...original,sourceIntegrity:{...original.sourceIntegrity,unexpected:true}},getters,nested,Object.setPrototypeOf({...original}, {}),{...original,[Symbol('hidden')]:true}])
   assert.throws(()=>snapshotKeelExplicitExternalPreview(value),/exact plain/);
 assert.equal(accesses,0);
 const mutable={...original,sourceIntegrity:{...original.sourceIntegrity}},snapshot=snapshotKeelExplicitExternalPreview(mutable);
 mutable.uri=ipfs;mutable.sourceIntegrity.digest='0x'+'0'.repeat(64);assert.equal(snapshot.uri,https);assert.deepEqual(snapshot.sourceIntegrity,integrity(image));
 assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.sourceIntegrity));
 const source=Uint8Array.from(image),expectedSourceIntegrity={...integrity(image)},promise=prepareKeelExplicitExternalPreview({uri:https,mediaType:'image/png',sourceBytes:source,expectedSourceIntegrity});
 source.fill(0);expectedSourceIntegrity.byteLength=1;assert.deepEqual((await promise).sourceIntegrity,integrity(image));
});
test('exact native Gzip recipe still required alongside an external preview',async()=>{
 const f=await fixture(https,true),audit=await auditKeelInlineTokenURI(f.prepared.tokenURI,{registeredNativeGzip:f.registeredNativeGzip,externalPreview:f.externalPreview});
 assert.equal(audit.freshPayloadPolicySatisfied,true);assert.deepEqual(audit.externalPreview.sourceIntegrity,integrity(image));
 await assertKeelPreparedCopyRead(f.bound);
 await assert.rejects(buildKeelPreparedOneOfOneTokenURI({...f.input,registeredNativeGzip:undefined}),/forbids new storedBase64/);
 const wrong=structuredClone(f.registeredNativeGzip);wrong.members[0].integrity.digest='0x'+'1'.repeat(64);
 await assert.rejects(auditKeelInlineTokenURI(f.prepared.tokenURI,{registeredNativeGzip:wrong,externalPreview:f.externalPreview}),/Gzip|gzip|digest|recipe|proof|member/);
});
async function chainPlan(f){
 const chunks=[];for(let at=0;at<f.graph.fragmentBytes.length;at+=23000){const data=f.graph.fragmentBytes.slice(at,at+23000);chunks.push({byteLength:data.length,integrity:await createIntegrity(data)});}
 const casts=[];for(let at=0;at<chunks.length;at+=3){const batch=chunks.slice(at,at+3);casts.push({kind:'castSlugs',function:'castSlugs(bytes[])',payloadEncoding:'raw-bytes-from-files',chunkCount:batch.length,chunkByteLengths:batch.map(c=>c.byteLength),chunkIntegrities:batch.map(c=>c.integrity),slugIds:'derived-keccak256-after-review'});}
 return {schema:'keel-chain-operation-plan@1',status:'review-only',materialized:true,descriptorMaterialized:true,chainReady:false,target:{family:'ethereum',chainId,address:store},sourcePlan:{schema:'keel-upload-plan@2',objectName:'viewer',mediaType:f.graph.mediaType,integrity:f.graph.fragmentIntegrity},operations:[...casts,{kind:'weldObject',function:'weldObject(bytes32[],bytes32,uint64,uint8,string)',slugIds:'from-preceding-castSlugs',digest:f.graph.fragmentIntegrity,byteLength:f.graph.fragmentBytes.length,compression:'none',mediaType:f.graph.mediaType}],encoding:'deferred-contract-abi',walletApproval:'required',signing:'not-performed',submission:'not-performed',caveat:'Local fixture only.'};
}
test('actual COPY review serializes exact external proof in plan digest; mutations and unknown/getter proof fail',async()=>{
 const f=await fixture(),input=await chainPlan(f),envelope=await createKeelPublishReviewPlan(input,{preparedCopy:f.bound});
 assert.deepEqual(envelope.plan.preparedCopy.externalPreview,f.externalPreview);assert.equal((await verifyKeelPublishReviewPlan(envelope)).valid,true);assert.equal(envelope.plan.chainReady,false);
 const changed=structuredClone(envelope);changed.plan.preparedCopy.externalPreview.uri=ipfs;assert.equal((await verifyKeelPublishReviewPlan(changed)).valid,false);
 const extra=structuredClone(envelope);extra.plan.preparedCopy.externalPreview.extra=true;assert.equal((await verifyKeelPublishReviewPlan(extra)).valid,false);
 let accesses=0;const accessor=structuredClone(envelope);Object.defineProperty(accessor.plan.preparedCopy.externalPreview,'uri',{enumerable:true,get(){accesses++;return https;}});
 assert.equal((await verifyKeelPublishReviewPlan(accessor)).valid,false);assert.equal(accesses,0);
});
test('bounded token readback threads exact external preview without fetching its URI',async()=>{
 const f=await fixture(),header={number:'0x2a',hash:'0x'+'ab'.repeat(32),gasLimit:'0x3938700'},methods=[];
 const encoded=Buffer.from(f.prepared.tokenURI),abi='0x'+(32n).toString(16).padStart(64,'0')+BigInt(encoded.length).toString(16).padStart(64,'0')+encoded.toString('hex').padEnd(Math.ceil(encoded.length/32)*64,'0');
 const fetcher=async(url,init)=>{assert.equal(new URL(url).origin,'https://rpc.example');const request=JSON.parse(init.body);methods.push(request.method);const result=request.method==='eth_chainId'?'0xaa36a7':request.method==='eth_getBlockByNumber'?header:request.method==='eth_getCode'?'0x6000':request.method==='eth_call'?abi:assert.fail(request.method);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200});};
 const audit=await readKeelInlineTokenAudit({rpcUrl:'https://rpc.example',chainId,collection:f.input.collection,tokenId:'1',externalPreview:f.externalPreview},fetcher);
 assert.equal(audit.audit.imageBytes,0);assert.equal(audit.audit.externalPreview.uri,https);assert.equal(audit.selectedChainReadAuthenticated,false);assert.equal(audit.publicationReady,false);assert.equal(audit.signing,'not-performed');assert.equal(methods.filter(m=>m==='eth_call').length,1);
 await assert.rejects(readKeelInlineTokenAudit({rpcUrl:'https://rpc.example',chainId,collection:f.input.collection,tokenId:'1',externalPreview:{...f.externalPreview,uri:ipfs}},fetcher),/differs from the exact/);
});
