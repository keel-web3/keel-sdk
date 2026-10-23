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
test('unchanged generic fresh guard rejects actual rev5 gzip descriptor; exact recipe admits raw-percent only',async()=>{
 const root=await document(); await assert.rejects(buildKeelInlineRawPercentTokenURIGraph(root),/forbids new storedBase64/);
 const registeredNativeGzip=proof(root),graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip});
 assert.deepEqual(graph.htmlBytes,root.rootBytes);assert.deepEqual(graph.registeredNativeGzip,registeredNativeGzip);
 assert.equal(registeredNativeGzip.members.length,1);assert.equal(registeredNativeGzip.members[0].integrity.digest,hash(original));
 const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip,chainId:p.chainId,collection:'0x1111111111111111111111111111111111111111',collectionName:'Native gzip',description:'Unchanged input',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'web3://existing',manifestDigest:hash(Buffer.from('manifest'))});
 const audit=await auditKeelInlineTokenURI(prepared.tokenURI,{registeredNativeGzip});
 assert.equal(audit.completeDocumentBase64Layers,0);assert.equal(audit.freshPayloadPolicySatisfied,true);assertKeelFreshPayloadAudit(audit.carriage);
});
test('wrong chain/registration/frame/runtime cannot reuse native recipe',async()=>{
 const root=await document();for(const [key,value] of [['chainId',1],['revision',4],['reader','0x1111111111111111111111111111111111111111'],['metadataObjectId','0x'+'1'.repeat(64)],['readerRuntimeCodeHash','0x'+'2'.repeat(64)],['prefixObjectId','0x'+'3'.repeat(64)]])assert.throws(()=>createKeelRegisteredNativeGzipProof({binding:{...binding,[key]:value},documentBytes:root.rootBytes}));
 const changed=Uint8Array.from(root.rootBytes);changed[0]^=1;assert.throws(()=>createKeelRegisteredNativeGzipProof({binding,documentBytes:changed}),/exact authenticated/);
});
test('changed compressed or decoded commitment, extra code and another codec remain rejected',async()=>{
 const root=await document(),text=Buffer.from(root.rootBytes).toString(),originalProof=proof(root);
 for(const changed of [text.replace('"compression":"gzip"','"compression":"brotli"'),text.replace(hash(original),'0x'+'0'.repeat(64)),text+'<script>other()</script>']){
  assert.throws(()=>assertKeelRegisteredNativeGzipProof(originalProof,Buffer.from(changed)));
  assert.throws(()=>createKeelRegisteredNativeGzipProof({binding,documentBytes:Buffer.from(changed)}));
 }
 const item=/"storedBase64":"([A-Za-z0-9+/=]+)"/g;const all=[...text.matchAll(item)];const compressed=all.at(-1)[1];
 assert.throws(()=>createKeelRegisteredNativeGzipProof({binding,documentBytes:Buffer.from(text.replace(compressed,compressed.replace(/^./,'A')))}));
});
test('whole HTML Base64 carriage cannot reuse per-resource allowance',async()=>{
 const root=await document();const html='data:text/html;base64,'+Buffer.from(root.rootBytes).toString('base64');
 const token='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({name:'x',image:'data:image/png;base64,'+image.toString('base64'),animation_url:html}));
 await assert.rejects(auditKeelInlineTokenURI(token,{registeredNativeGzip:proof(root)}),/complete-HTML Base64/);
 // Proof binds the raw document only; collector policy still rejects full HTML Base64.
 const graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip:proof(root)});
 await assert.rejects(buildKeelPreparedOneOfOneTokenURI({graph:{...graph,mediaType:'application/vnd.keel.token-uri-base64-fragment'},registeredNativeGzip:proof(root),chainId:p.chainId,collection:'0x1111111111111111111111111111111111111111',collectionName:'x',description:'x',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'x',manifestDigest:hash(image)}));
});
test('proof and source snapshots reject mutations; explicitgzip eligible only when selected reader allows it',async()=>{
 const root=await document(),v=proof(root);root.rootBytes[100]^=1;assert.throws(()=>assertKeelRegisteredNativeGzipProof(v,root.rootBytes));
 assert.throws(()=>resolveKeelInlineBuildRoute({compression:'gzip',freshReaderCompressions:['none'],resources:[{id:'x',bytes:original}]}),/Explicit Gzip/);
 assert.equal(resolveKeelInlineBuildRoute({compression:'gzip',freshReaderCompressions:['none','gzip'],resources:[{id:'x',bytes:original}]}).resources[0].compression,'gzip');
});

test('actual public rev5 nativeGzip whole-output candidate competes by returned URI, never source bytes alone',async t=>{
 const {selectKeelRegisteredInlineCandidate,keelRegisteredInlineRecipeDigest}=await import('../packages/sdk/dist/inline-build-route.js');
 const {toKeelDenseTransportDataURL}=await import('../packages/sdk/dist/dense-transport.js');
 const exact=process.env.KEEL_GATORRR_EXACT_SOURCE_DIRECTORY;
 const html=exact?readFileSync(exact+'/9761586c1f904925743521d3cba30e4c32f591ebb8f017864e2f34427a02bff1'):original;
 const png=exact?readFileSync(exact+'/884f889b56e371694e58e79e781568691448c3a0bac2ee23588cb04ae2a83ab7'):image;
 if(exact){assert.equal(html.length,530981);assert.equal(hash(html),'0x9761586c1f904925743521d3cba30e4c32f591ebb8f017864e2f34427a02bff1');assert.equal(png.length,5801);}
 const sources=[{id:'Gatorrr-0.3.html',mediaType:'text/html',bytes:html},{id:'home-preview.png',mediaType:'image/png',bytes:png}],fields={name:'Gatorrr',description:'Local measured registered-frame comparison'};
 const candidates=[];
 for(const codec of ['none','gzip']){
  const root=await buildKeelInlineLocalDocument({shell,modules:[],assets:[{id:sources[1].id,mediaType:'image/png',source:png,compression:'none'}],entry:{id:sources[0].id,mediaType:'text/html',source:html,compression:codec}});
  const native=codec==='gzip'?proof(root):undefined,graph=await buildKeelInlineRawPercentTokenURIGraph(root,native?{registeredNativeGzip:native}:{});
  const parts=graph.parts.map((part,index)=>({objectId:part.sourceKind==='existing'?index===0?p.prefixObjectId:p.suffixObjectId:hash(part.bytes),bytes:part.bytes,role:part.sourceKind==='existing'?'boot':'payload',disposition:part.sourceKind==='existing'?'reused':'new'}));
  const recipe={profile:codec==='gzip'?'keel.canonical-native-gzip@1':'keel.canonical-text-copy@1',chainId:p.chainId,store:p.store,registry:p.registry,reader:p.reader,readerRuntimeCodeHash:p.readerRuntimeCodeHash,registrationDigest:hash(Buffer.from(JSON.stringify(binding))),revision:5,codec,sourceReader:'canonical-items',registeredParts:parts.filter(x=>x.disposition==='reused').map(({objectId,bytes,role})=>({objectId,digest:hash(bytes),byteLength:bytes.length,role}))};
  const tokenURI=toKeelDenseTransportDataURL('metadata',JSON.stringify({...fields,image:'data:image/png;base64,'+png.toString('base64'),animation_url:toKeelDenseTransportDataURL('html',Buffer.from(root.rootBytes).toString())}));
  candidates.push({id:codec,status:'registered-recipe',recipe,build:async()=>({recipeDigest:keelRegisteredInlineRecipeDigest(recipe),tokenURI,documentParts:parts,...native?{registeredNativeGzip:native}:{}})});
 }
 const result=await selectKeelRegisteredInlineCandidate({sources,collectorImage:{mediaType:'image/png',bytes:png},metadataFields:fields,measurementScope:{kind:'provisional-template',templateDigest:hash(Buffer.from(JSON.stringify(fields)))},candidates});
 assert.equal(result.selected.id,'gzip');assert.equal(result.selected.javascriptGzipDecoderBytes,0);assert.equal(result.selected.nativeBrowserGzip,true);
 assert.equal(result.publicationReady,false);assert.equal(result.walletApprovalAuthorized,false);assert.equal(result.selectionStatus,'provisional-do-not-adopt');
 t.diagnostic(JSON.stringify({scope:'PROVISIONAL_TEMPLATE_NOT_ADOPTION_OR_FULL_SIMULATION',actualGatorrr:!!exact,source:sources.map(x=>integrity(x.bytes)),candidates:result.candidates.map(({tokenURI,...x})=>x)}));
});

test('typed proof reaches COPY/readback audit; wrong chain and stale returned bytes reject',async()=>{
 const {assertKeelPreparedCopyRead}=await import('../packages/sdk/dist/prepared-copy-publication.js');
 const {readKeelInlineTokenAudit}=await import('../packages/sdk/dist/inline-token-read.js');
 const {encodeAbiParameters}=await import('viem');
 const root=await document(),registeredNativeGzip=proof(root),graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip});
 const collection='0x1111111111111111111111111111111111111111';
 const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip,chainId:p.chainId,collection,collectionName:'x',description:'x',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'x',manifestDigest:hash(image)});
 const args={chainId:p.chainId,store:p.store,mediaType:graph.mediaType,graphBytes:graph.fragmentBytes,graphIntegrity:graph.fragmentIntegrity,expectedTokenURI:prepared.tokenURI,returnedTokenURI:prepared.tokenURI,callGasLimit:10000000n,blockGasLimit:60000000n,registeredNativeGzip};
 const check=await assertKeelPreparedCopyRead(args);assert.equal(check.payloadCarriage.requiresExistingPreparedReuse,false);assertKeelFreshPayloadAudit(check.payloadCarriage);
 await assert.rejects(assertKeelPreparedCopyRead({...args,chainId:1}),/selected chain/);
 await assert.rejects(assertKeelPreparedCopyRead({...args,returnedTokenURI:prepared.tokenURI+'x'}),/differs/);
 const fetcher=async(_url,request)=>{const {id,method}=JSON.parse(request.body);const result=method==='eth_chainId'?'0xaa36a7':method==='eth_getBlockByNumber'?{number:'0x10',hash:'0x'+'1'.repeat(64),gasLimit:'0x3938700'}:method==='eth_getCode'?'0x6000':encodeAbiParameters([{type:'string'}],[prepared.tokenURI]);return new Response(JSON.stringify({jsonrpc:'2.0',id,result}));};
 const read=await readKeelInlineTokenAudit({chainId:p.chainId,collection,tokenId:'1',registeredNativeGzip,rpcUrl:'https://rpc.sepolia.ethpandaops.io'},fetcher);
 assert.equal(read.audit.freshPayloadPolicySatisfied,true);assert.equal(read.selectedChainReadAuthenticated,false);assert.equal(read.publicationReady,false);
 await assert.rejects(readKeelInlineTokenAudit({chainId:1,collection,tokenId:'1',registeredNativeGzip},fetcher),/selected chain/);
});

test('explicitgzip is deterministic for incompressible URI81 payloads and never coerces to Brotli/None',async()=>{
 const {prepareKeelGzipDensePayload}=await import('../packages/sdk/dist/prepared-dense-copy.js');
 const {decodeKeelPreparedDenseCopyFragment,serializeKeelDenseTransportJSON}=await import('../packages/sdk/dist/dense-transport.js');
 const {prepareKeelCreatorInline}=await import('../packages/sdk/dist/creator-prepared-inline.js');
 const bytes=Buffer.concat(Array.from({length:16},(_,i)=>createHash('sha256').update('fixed-incompressible-'+i).digest()));
 for(const readerGrammar of ['uri81','legacy-strict']){
  const a=prepareKeelGzipDensePayload(bytes,{compression:'gzip',readerGrammar}),b=prepareKeelGzipDensePayload(bytes,{compression:'gzip',readerGrammar});
  assert.equal(a.compression,'gzip');assert.deepEqual(gunzipSync(a.compressedBytes),bytes);assert.deepEqual(a.preparedBytes,b.preparedBytes);
  assert.equal(a.decodedIntegrity.digest,hash(bytes));assert.equal(Buffer.from(decodeKeelPreparedDenseCopyFragment(a.preparedBytes)).toString(),serializeKeelDenseTransportJSON(a.storedDense).slice(1,-1));
  if(readerGrammar==='legacy-strict')assert.doesNotMatch(Buffer.from(a.preparedBytes).toString(),/[?&']/);
 }
 const plan=await prepareKeelCreatorInline({chainId:p.chainId,store:p.store,compression:'gzip',poster:{bytes:image,mediaType:'image/png'},resources:[{id:'entry.html',role:'entrypoint',mediaType:'text/html',bytes:original}]});
 assert.equal(plan.resources[0].compression,'gzip');assert.deepEqual(gunzipSync(plan.resources[0].payload.compressedBytes),original);
 assert.equal(plan.resources[0].payload.decodedIntegrity.digest,hash(original));
});
test('Studio core explicitgzip stores exact deterministic gzip bytes, not its old Brotli else branch',async()=>{
 const {prepareStudioArtifact}=await import('../packages/studio-core/dist/index.js');
 const source=Buffer.from('Exact original source. '.repeat(200));
 const input={id:'gzip-core',name:'gzip core',creator:'0x1111111111111111111111111111111111111111',createdAt:'2026-10-19T00:00:00.000Z',compression:'gzip',assets:[{id:'entry',fileName:'index.html',mediaType:'text/html',role:'entrypoint',entrypoint:true,executable:true,bytes:original},{id:'data',fileName:'exact.bin',mediaType:'application/octet-stream',role:'data',bytes:source},{id:'poster',fileName:'poster.png',mediaType:'image/png',role:'image',bytes:image}]};
 const prepared=await prepareStudioArtifact(input),resource=prepared.resources.find(row=>row.resource.id==='data');
 assert.equal(resource.compression,'gzip');assert.deepEqual(gunzipSync(resource.storedBytes),source);assert.equal(resource.decodedIntegrity.digest,hash(source));
 await assert.rejects(prepareStudioArtifact({...input,compression:'bad-codec'}),/Unsupported lossless/);
});
