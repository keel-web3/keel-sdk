import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { encodeAbiParameters } from 'viem';
import { selectKeelRegisteredInlineCandidate, keelRegisteredInlineRecipeDigest } from '../packages/sdk/dist/inline-build-route.js';
import { buildKeelInlineShellFragments, buildKeelInlineLocalDocument, buildKeelInlineRawPercentTokenURIGraph } from '../packages/sdk/dist/inline-viewer-graph.js';
import { buildKeelPreparedDenseCopyShell, prepareKeelDensePayload, prepareKeelGzipDensePayload } from '../packages/sdk/dist/prepared-dense-copy.js';
import { buildKeelOnchainContainerBinding } from '../packages/sdk/dist/verification-shell.js';
import { prepareKeelDenseCopyFragment, serializeKeelDenseTransportJSON, toKeelDenseTransportDataURL } from '../packages/sdk/dist/dense-transport.js';

const sha = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
const address = '0x1111111111111111111111111111111111111111';
const chainId = 11155111;
const hash = number => '0x' + number.toString(16).padStart(64, '0');
const encoder = new TextEncoder();
const exactDirectory=process.env.KEEL_GATORRR_EXACT_SOURCE_DIRECTORY;
const sources = exactDirectory ? [
  {id:'Gatorrr-0.3.html',mediaType:'text/html',bytes:readFileSync(path.join(exactDirectory,'9761586c1f904925743521d3cba30e4c32f591ebb8f017864e2f34427a02bff1'))},
  {id:'home-preview.png',mediaType:'image/png',bytes:readFileSync(path.join(exactDirectory,'884f889b56e371694e58e79e781568691448c3a0bac2ee23588cb04ae2a83ab7'))},
] : [
  { id:'game.html', mediaType:'text/html', bytes:Buffer.from('<!doctype html><html><head></head><body><p>Exact 水</p><script>globalThis.artReady=true;</script></body></html>' + '<!-- unchanged -->'.repeat(600)) },
  { id:'poster.png', mediaType:'image/png', bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=', 'base64') },
];
if(exactDirectory){
  assert.equal(sources[0].bytes.length,530981);assert.equal(sha(sources[0].bytes),'0x9761586c1f904925743521d3cba30e4c32f591ebb8f017864e2f34427a02bff1');
  assert.equal(sources[1].bytes.length,5801);assert.equal(sha(sources[1].bytes),'0x884f889b56e371694e58e79e781568691448c3a0bac2ee23588cb04ae2a83ab7');
}
const metadataFields = { name:'Exact comparison', description:'Same metadata 水', properties:{source:'same project'} };
const collectorImage = { mediaType:'image/png', bytes:sources[1].bytes };
const scope = { kind:'provisional-template', templateDigest:sha(Buffer.from(JSON.stringify(metadataFields))) };
const imageURI = 'data:image/png;base64,' + Buffer.from(collectorImage.bytes).toString('base64');
const tokenURI = (html, fields=metadataFields, image=imageURI, style='compact') => {
  const metadata = { ...fields, image, animation_url:toKeelDenseTransportDataURL('html',html) };
  return style === 'compact' ? toKeelDenseTransportDataURL('metadata',JSON.stringify(metadata))
    : 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(metadata));
};
function recipe(id, codec, sourceReader, parts) {
  return { profile:'named-local-builder-fixture:' + id, chainId, store:address, registry:address, reader:address,
    readerRuntimeCodeHash:hash(1), registrationDigest:hash(2), revision:5, codec, sourceReader,
    registeredParts:parts.filter(part=>part.disposition==='reused').map(({objectId,role,bytes})=>({objectId,role,digest:sha(bytes),byteLength:bytes.length})) };
}
function candidate(id, recipe, built) {
  return {id,status:'registered-recipe',recipe,build:async()=>({...built,recipeDigest:keelRegisteredInlineRecipeDigest(recipe)})};
}
let canonical;
async function noneCandidate(id='none', style='compact') {
  canonical ??= (async()=>{
    const shell=await buildKeelInlineShellFragments({codecProfile:'native'});
    const document=await buildKeelInlineLocalDocument({shell,modules:[],entry:{id:sources[0].id,mediaType:'text/html',source:sources[0].bytes,compression:'none'},
      assets:[{id:sources[1].id,mediaType:sources[1].mediaType,source:sources[1].bytes,compression:'none'}]});
    const graph=await buildKeelInlineRawPercentTokenURIGraph(document);
    const parts=graph.parts.map((part,index)=>({objectId:sha(Buffer.concat([Buffer.from('local-object-'+index),part.bytes])),bytes:part.bytes,
      disposition:part.sourceKind==='existing'?'reused':'new',role:part.sourceKind==='existing'?'boot-and-decoder':'payload'}));
    return {document,parts};
  })();
  const {document,parts}=await canonical;
  const r=recipe(id,'none','canonical-items',parts);
  return candidate(id,r,{tokenURI:tokenURI(Buffer.from(document.rootBytes).toString(),metadataFields,imageURI,style),documentParts:parts});
}
// Uses the maintained native Gzip/Dense preparation, exact container binding,
// shell and ABI packtable. Identities are explicitly local fixture commitments,
// not fabricated public-chain receipts or registration proof.
async function denseCandidate(codec,id=codec) {
  const shell=await buildKeelPreparedDenseCopyShell({codecProfile:codec==='gzip'?'native':'brotli-js',embeddedContainerDelivery:{chainId,store:address}});
  const packs=[],descriptors=[];
  for(const [index,source] of sources.entries()) {
    const payload=codec==='gzip'?prepareKeelGzipDensePayload(source.bytes):prepareKeelDensePayload(source.bytes,{compression:'brotli'});
    const objectId=hash(100+index);
    const binding=await buildKeelOnchainContainerBinding({chainId,store:address,objectId,compression:payload.compression,bytes:source.bytes,storedBytes:payload.compressedBytes});
    const storedIntegrity=payload.storedIntegrity;
    packs.push({containerId:binding.id,objectId,storedIntegrity,storedDense:payload.storedDense});
    descriptors.push({id:source.id,aliases:[source.id],role:index===0?'entrypoint':'asset',mediaType:source.mediaType,
      integrity:{algorithm:'sha256',digest:sha(source.bytes),byteLength:source.bytes.length},onchain:{containerId:binding.id,offset:0},containerBindings:[binding]});
  }
  const bridge=Buffer.from(shell.containerBridge).toString();
  const body=packs.map(serializeKeelDenseTransportJSON).join(',')+bridge+','+descriptors.map(serializeKeelDenseTransportJSON).join(',');
  const html=Buffer.from(shell.prefix).toString()+body+Buffer.from(shell.suffix).toString();
  const parts=[{objectId:hash(20),bytes:prepareKeelDenseCopyFragment(Buffer.from(shell.prefix).toString()),disposition:'reused',role:'boot-and-decoder'},
    {objectId:hash(21),bytes:prepareKeelDenseCopyFragment(body),disposition:'new',role:'payload'},
    {objectId:hash(22),bytes:prepareKeelDenseCopyFragment(Buffer.from(shell.suffix).toString()),disposition:'reused',role:'boot-and-decoder'}];
  const rows=packs.map(pack=>({byteLength:BigInt(pack.storedIntegrity.byteLength),digest:pack.storedIntegrity.digest,objectId:pack.objectId,containerId:pack.containerId}));
  const table=Buffer.from(encodeAbiParameters([{type:'tuple[]',components:[{name:'byteLength',type:'uint256'},{name:'digest',type:'bytes32'},{name:'objectId',type:'bytes32'},{name:'containerId',type:'bytes32'}]}],[rows]).slice(2),'hex');
  const r=recipe(id,codec,'uri81-containers',parts);
  return candidate(id,r,{tokenURI:tokenURI(html),documentParts:parts,tableDigest:sha(table),auxiliaryObjects:[
    {objectId:hash(30),bytes:table,disposition:'new',role:'table'},
    {objectId:hash(31),bytes:Buffer.from(imageURI),disposition:'new',role:'image'},
  ]});
}
const select = async (candidates,options={})=>selectKeelRegisteredInlineCandidate({sources,collectorImage,metadataFields,measurementScope:scope,candidates,...options});

test('actual None and maintained native-Gzip/URI81 builds compare complete metadata, decoder/boot and source bytes',async t=>{
  const candidates=[await noneCandidate(),await denseCandidate('gzip'),await denseCandidate('brotli')];
  const result=await select(candidates);
  assert.equal(result.candidates.length,3); assert.equal(result.publicationReady,false); assert.equal(result.walletApprovalAuthorized,false);
  assert.equal(result.selectionStatus,'provisional-do-not-adopt'); assert.equal(result.requiresFullSimulation,true);
  assert.deepEqual(result.candidates.map(c=>c.completeTokenURIBytes),result.candidates.map(c=>c.completeTokenURIBytes).sort((a,b)=>a-b));
  assert.equal(result.selected.tokenURICommitment.digest,sha(Buffer.from(result.selected.tokenURI)));
  const gzip=result.candidates.find(c=>c.codec==='gzip'); assert.equal(gzip.nativeBrowserGzip,true); assert.equal(gzip.javascriptCodecDecoderBytes,0);
  assert.ok(gzip.combinedBootDecoderObjectBytes>0,'native gzip still counts actual transport and shell boot/glue');
  assert.ok(result.candidates.every(c=>c.sourceByteIdentity==='verified-exact'&&c.imageBytes===collectorImage.bytes.length));
  assert.ok(result.candidates.find(c=>c.codec==='brotli').combinedBootDecoderObjectBytes>gzip.combinedBootDecoderObjectBytes);
  t.diagnostic(JSON.stringify({actualRetainedGatorrr:!!exactDirectory,registrationEvidence:'named-local-fixture-not-live-proof',candidates:result.candidates.map(({tokenURI,...measurement})=>measurement)}));
});

test('actual returned UTF8 footprint wins over smaller compressed bytes; stable-ID tie and explicit codec are deterministic',async()=>{
  const a=await noneCandidate('z-compact'),b=await noneCandidate('a-escaped','escaped');
  const result=await select([b,a]); assert.equal(result.selected.id,'z-compact');
  const tie=await select([await noneCandidate('z'),await noneCandidate('a')]); assert.equal(tie.selected.id,'a');
  const explicit=await select([await noneCandidate(),{id:'gzip-unavailable',codec:'gzip',status:'unavailable',reason:'No actual native-gzip profile on selected chain'}],{requestedCompression:'gzip'});
  assert.equal(explicit.selected,undefined); assert.equal(explicit.candidates.length,0);
  assert.equal(explicit.filtered.find(c=>c.id==='none').reason,'explicit-codec-preserved');
});

test('same reused boot object is charged once even when used twice; conflicting identity rejects',async()=>{
  const c=await noneCandidate('shared'),oldBuild=c.build;
  const repeated={objectId:hash(90),bytes:prepareKeelDenseCopyFragment(' '),disposition:'reused',role:'boot'};
  c.recipe.registeredParts.push({objectId:repeated.objectId,role:repeated.role,digest:sha(repeated.bytes),byteLength:repeated.bytes.length});
  c.build=async input=>{const b=await oldBuild(input);return {...b,documentParts:[repeated,repeated,...b.documentParts],
    tokenURI:tokenURI('  '+Buffer.from((await canonical).document.rootBytes).toString())};};
  const result=await select([c]);
  assert.equal(result.selected.uniqueObjects,(await canonical).parts.length+1);
  assert.equal(result.selected.bootObjectBytes,repeated.bytes.length);
  assert.equal(result.selected.reusedStoredBytes,repeated.bytes.length+(await canonical).parts.filter(p=>p.disposition==='reused').reduce((n,p)=>n+p.bytes.length,0));
  const bad=await noneCandidate('bad'),run=bad.build;
  bad.build=async input=>{const b=await run(input);return {...b,documentParts:[...b.documentParts,{...b.documentParts[0],bytes:Buffer.from('%41')}]};};
  await assert.rejects(select([bad]),/Conflicting same-object/);
});

for(const kind of ['metadata','image','source-membership','coverage','recipe','registered-bytes','auxiliary-table'])test(`corrupt ${kind} stops selection instead of hiding behind another successful candidate`,async()=>{
  const c=kind==='auxiliary-table'?await denseCandidate('gzip','bad'):await noneCandidate('bad'),run=c.build;
  c.build=async input=>{
    const b=await run(input);
    if(kind==='metadata')return {...b,tokenURI:tokenURI(Buffer.from((await canonical).document.rootBytes).toString(),{...metadataFields,name:'changed'})};
    if(kind==='image')return {...b,tokenURI:tokenURI(Buffer.from((await canonical).document.rootBytes).toString(),metadataFields,'data:image/png;base64,AA==')};
    if(kind==='source-membership')return {...b,tokenURI:b.tokenURI.replace(sources[0].id,'other.html')};
    if(kind==='coverage')return {...b,documentParts:b.documentParts.slice(1)};
    if(kind==='recipe')return {...b,recipeDigest:hash(99)};
    if(kind==='registered-bytes')return {...b,documentParts:b.documentParts.map((p,i)=>i? p:{...p,bytes:Buffer.from('%41')})};
    return {...b,auxiliaryObjects:b.auxiliaryObjects.map(p=>p.role==='table'?{...p,bytes:Buffer.from('wrong')}:p)};
  };
  await assert.rejects(select([c,await noneCandidate('good')]));
});

test('denial, timeout and malformed build remain terminal, with no retries or fallback',async()=>{
  for(const error of [new Error('HTTP 403 denied'),new Error('timeout'),new Error('malformed response')]){
    let later=0;const c=await noneCandidate('bad'),good=await noneCandidate('good');
    c.build=async()=>{throw error};good.build=async()=>{later++;throw new Error('must not continue')};
    await assert.rejects(select([c,good]),error);assert.equal(later,0);
  }
  const hanging=await noneCandidate('deadline');hanging.build=async()=>new Promise(()=>{});
  await assert.rejects(select([hanging],{maximumBuildMilliseconds:10}),/deadline exceeded/);
  await assert.rejects(select([await noneCandidate()],{maximumTotalReturnedBytes:1}),/memory bound/);
});

test('abort, builder mutation, external source mutation, recipe drift and bounded intake cannot authorize a plan',async()=>{
  const abort=new AbortController(),c=await noneCandidate('abort'),run=c.build;
  c.build=async input=>{const b=await run(input);abort.abort(new Error('cancelled'));return b};
  await assert.rejects(select([c],{signal:abort.signal}),/cancelled/);
  const mut=await noneCandidate('mut');mut.build=async input=>{input.sources[0].bytes[0]^=1;return run(input)};
  await assert.rejects(select([mut]),/mutated its source/);
  const originalSources=sources.map(s=>({...s,bytes:Buffer.from(s.bytes)})),external=await noneCandidate('external'),externalRun=external.build;
  external.build=async input=>{const b=await externalRun(input);originalSources[0].bytes[0]^=1;return b};
  await assert.rejects(select([external],{sources:originalSources}),/Source changed/);
  const drift=await noneCandidate('drift'),driftRun=drift.build;
  drift.build=async input=>{drift.recipe.revision++;return driftRun(input)};
  await assert.rejects(select([drift]),/changed recipe/);
  await assert.rejects(select([await noneCandidate()],{maximumDecodedSourceBytes:1}),/oversized source/);
  await assert.rejects(select(Array.from({length:9},(_,i)=>({id:String(i),status:'unavailable',codec:'none',reason:'not registered'}))),/count exceeds/);
});

test('final exact context identity is measured separately and never becomes funding authority',async()=>{
  const result=await select([await noneCandidate()],{measurementScope:{kind:'final-project-release',projectId:'same-project',releaseId:'same-release',sourceRevision:1,releaseRevision:13,contextDigest:hash(10)}});
  assert.equal(result.selectionStatus,'measured-final-inputs');assert.equal(result.publicationReady,false);assert.equal(result.walletApprovalAuthorized,false);
  const other=await select([await noneCandidate()],{measurementScope:{...scope,templateDigest:hash(11)}});
  assert.notEqual(result.measurementDigest,other.measurementDigest);
});

test('explicit external collector URI is measured exactly without network/authentication claims',async()=>{
 const base=await noneCandidate(),built=await base.build({sources});
 const externalURI='https://example.test/exact-poster.png';
 const metadata=JSON.parse(Buffer.from(decodeURIComponent(built.tokenURI.slice(built.tokenURI.indexOf(',')+1))).toString());metadata.image=externalURI;
 const alternative=candidate('external',base.recipe,{...built,tokenURI:toKeelDenseTransportDataURL('metadata',JSON.stringify(metadata))});
 const result=await selectKeelRegisteredInlineCandidate({sources,collectorImage:{...collectorImage,externalURI},metadataFields,measurementScope:scope,candidates:[alternative]});
 assert.equal(result.selected.imageDelivery,'explicit-external');assert.equal(result.selected.imageURIBytes,Buffer.byteLength(externalURI));assert.equal(result.selected.imageBytes,collectorImage.bytes.length);assert.equal(result.selected.externalPreviewReadAuthenticated,false);
 await assert.rejects(selectKeelRegisteredInlineCandidate({sources,collectorImage:{...collectorImage,externalURI:'http://example.test/a'},metadataFields,measurementScope:scope,candidates:[alternative]}),/HTTPS or IPFS/);
 await assert.rejects(selectKeelRegisteredInlineCandidate({sources,collectorImage:{...collectorImage,externalURI:'https://example.test/different.png'},metadataFields,measurementScope:scope,candidates:[alternative]}),/exact collector image/);
});
test('reused creator objects require distinct receipt-bound attribution; count each once',async()=>{
 const base=await noneCandidate(),built=await base.build({sources}),part=built.documentParts.find(x=>x.disposition==='new');assert.ok(part);
 const parts=built.documentParts.map(x=>x===part?{...x,disposition:'reused'}:x);
 const proof={objectId:part.objectId,digest:sha(part.bytes),byteLength:part.bytes.length,role:part.role,sourceIds:[sources[0].id],transactionHash:hash(90),blockHash:hash(91),evidenceDigest:hash(92)};
 const r={...base.recipe,reusedSourceObjects:[proof]},value=candidate('paid-fixture',r,{...built,documentParts:parts});
 const input={sources,collectorImage,metadataFields,measurementScope:scope,candidates:[value]};
 const result=await selectKeelRegisteredInlineCandidate(input);assert.equal(result.selected.reusedStoredBytes,part.bytes.length+built.documentParts.filter(x=>x.disposition==='reused').reduce((n,x)=>n+x.bytes.length,0));
 await assert.rejects(selectKeelRegisteredInlineCandidate({...input,candidates:[candidate('missing-proof',base.recipe,{...built,documentParts:parts})]}),/reuse|registered|unverified/i);
 await assert.rejects(selectKeelRegisteredInlineCandidate({...input,candidates:[candidate('wrong-proof',{...r,reusedSourceObjects:[{...proof,sourceIds:['invented-source']}]},{...built,documentParts:parts})]}),/attribution|source/i);
});
