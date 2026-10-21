import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildKeelLegacyPreparedDenseDocument} from '../packages/sdk/dist/legacy-prepared-dense-copy.js';
import {validateKeelPreparedContext} from '../packages/sdk/dist/prepared-context.js';
import {buildKeelInlineTokenURIGraph,buildKeelPreparedOneOfOneTokenURI,buildKeelInlineLocalDocument,buildKeelInlineModuleFragment} from '../packages/sdk/dist/inline-viewer-graph.js';
import {auditKeelInlineTokenURI,assertKeelFreshPayloadCarriage,readKeelInlineJSONArray} from '../packages/sdk/dist/inline-transport-audit.js';
import {currentCanonicalShell,currentNativeGzipProof} from './support/current-canonical-fixture.mjs';
const sha=value=>'0x'+createHash('sha256').update(value).digest('hex');
const poster=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
const html=Buffer.from('<!doctype html><html><head></head><body><p>Hello🔥%#?</p><img src="poster.png"></body></html>'+'<!-- original exact source -->'.repeat(100));
const resource=(id,bytes,role='asset',mediaType='application/octet-stream')=>({id,aliases:[id],role,mediaType,bytes});
const publication=extra=>({chainId:11155111,entryId:'index.html',posterResourceId:'poster.png',resources:[resource('index.html',html,'entrypoint','text/html'),resource('poster.png',poster,'asset','image/png')],...extra});
const document=(extra={})=>buildKeelInlineLocalDocument({shell:currentCanonicalShell(),modules:[],entry:{id:'index.html',mediaType:'text/html',source:html,compression:'none'},assets:[{id:'poster.png',mediaType:'image/png',source:poster,compression:'none'}],...extra});
async function finish(root,registeredNativeGzip){
 const graph=await buildKeelInlineTokenURIGraph(root,registeredNativeGzip?{registeredNativeGzip}:{});
 const envelope=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip,chainId:11155111,collection:'0x'+'66'.repeat(20),collectionName:'Original public release',description:'Original sale terms',imageURI:'data:image/png;base64,'+poster.toString('base64'),manifestURI:'data:application/json,%7B%7D',manifestDigest:'0x'+'77'.repeat(32)});
 const metadata=JSON.parse(decodeURIComponent(envelope.tokenURI.slice(envelope.tokenURI.indexOf(',')+1)));
 const actual=Buffer.from(decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',')+1)));
 return{graph,envelope,metadata,actual};
}

test('retired Compact Dense request rejects every explicit codec without changing original sources',async()=>{
 for(const compression of ['auto','brotli','gzip','deflate','none']){
  const input=publication({compression}),before=input.resources.map(r=>sha(r.bytes));
  await assert.rejects(buildKeelLegacyPreparedDenseDocument(input),/retired for fresh publication/);
  assert.deepEqual(input.resources.map(r=>sha(r.bytes)),before);
 }
});

test('current canonical None preserves exact source/poster and complete raw-percent COPY output',async()=>{
 const root=await document(),full=await finish(root),items=readKeelInlineJSONArray(Buffer.from(root.rootBytes).toString(),'globalThis.__KEEL_ITEMS__=').filter(Boolean);
 assert.equal(full.envelope.requiredBuilder,'KeelRawTokenURIBuilder');assert.deepEqual(full.graph.htmlBytes,root.rootBytes);
 assert.deepEqual(Buffer.from(items.find(r=>r.id==='index.html').embedded.storedText),html);
 assert.deepEqual(Buffer.from(items.find(r=>r.id==='poster.png').embedded.storedBase64,'base64'),poster);
 const audit=await auditKeelInlineTokenURI(full.envelope.tokenURI);assert.equal(audit.completeDocumentBase64Layers,0);
 assert.equal(full.metadata.image,'data:image/png;base64,'+poster.toString('base64'));
 assert.equal(JSON.parse(full.envelope.contextJSON).protocol,'keel-context@1');assert.equal(Object.keys(JSON.parse(full.envelope.contextJSON)).length,6);
});

test('retired descriptor packing cannot be selected by resource counts or expanded limits',async()=>{
 for(const count of [40,41,128,129,256,1024]){
  const resources=[resource('index.html',Buffer.from('<p>capacity</p>'),'entrypoint','text/html'),...Array.from({length:count-1},(_,i)=>resource('file-'+i,Buffer.from([i&255])))];
  await assert.rejects(buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',resources,sourceLimits:{maximumResources:count,maximumDecodedSourceBytes:128*1024*1024}}),/retired/);
  assert.deepEqual(resources.map(r=>r.id),['index.html',...Array.from({length:count-1},(_,i)=>'file-'+i)]);
 }
});

test('oversized original source does not revive retired segmentation',async()=>{
 const source=Buffer.concat([Buffer.from('<!doctype html><p>large exact source</p><!--'),Buffer.alloc(32*1024*1024+1,65),Buffer.from('-->')]),before=sha(source);
 await assert.rejects(buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',resources:[resource('index.html',source,'entrypoint','text/html')],brotliQuality:0}),/retired/);
 assert.equal(sha(source),before);
});

test('current registered Gzip rejects changed execution, context impersonation and namespace conflicts',async()=>{
 const root=await document({entry:{id:'index.html',mediaType:'text/html',source:html,compression:'gzip'}}),proof=currentNativeGzipProof(root),full=await finish(root,proof);
 for(const changed of [Buffer.concat([root.rootBytes,Buffer.from('<script>globalThis.evil=true</script>')]),Buffer.from(Buffer.from(root.rootBytes).toString().replace('"compression":"gzip"','"compression":"brotli"'))])assert.throws(()=>assertKeelFreshPayloadCarriage(changed,{registeredNativeGzip:proof}));
 const context=JSON.parse(full.envelope.contextJSON);validateKeelPreparedContext({...context,tokenId:'128'},11155111);
 for(const altered of [{...context,chainId:'1'},{...context,composerAddress:'0x'+'88'.repeat(20)},{...context,protocol:'keel-context@3'},{...context,tokenId:'01'}])assert.throws(()=>validateKeelPreparedContext(altered,11155111));
 await assert.rejects(document({assets:[{id:'index.html',mediaType:'image/png',source:poster,compression:'none'}]}),/duplicate resource/);
});

test('current registered text modules retain exact fragment bytes and data/module playback order',async()=>{
 const data=await buildKeelInlineModuleFragment({moduleId:'keel.data',version:'1',mediaType:'text/javascript',decodedBytes:Buffer.from('globalThis.exactData="<original>";'),execution:'classic',phase:'data'});
 const runtime=await buildKeelInlineModuleFragment({moduleId:'keel.runtime',version:'1',mediaType:'text/javascript',decodedBytes:Buffer.from('globalThis.exactRuntime=globalThis.exactData;'),execution:'classic',phase:'runtime'});
 const root=await document({modules:[data,runtime]}),parts=root.parts.filter(p=>p.role==='module');
 assert.deepEqual(parts.map(p=>Buffer.from(p.bytes)),[Buffer.from(data.bytes),Buffer.from(runtime.bytes)]);
 assert.deepEqual(parts.map(p=>p.moduleId),['keel.data','keel.runtime']);
 await finish(root);
});

test('current native Gzip is deterministic and rejects unsupported stored-source overrides',async()=>{
 const root=await document({entry:{id:'index.html',mediaType:'text/html',source:html,compression:'gzip'}});
 const items=readKeelInlineJSONArray(Buffer.from(root.rootBytes).toString(),'globalThis.__KEEL_ITEMS__=').filter(Boolean),entry=items.find(item=>item.id==='index.html');
 const again=await document({entry:{id:'index.html',mediaType:'text/html',source:html,compression:'gzip'}});
 assert.equal(entry.embedded.compression,'gzip');assert.deepEqual(again.rootBytes,root.rootBytes);
 const stored=Buffer.from(entry.embedded.storedBase64,'base64');assert.equal(sha(stored),entry.embedded.storedIntegrity.digest);
 const full=await finish(root,currentNativeGzipProof(root));assert.equal((await auditKeelInlineTokenURI(full.envelope.tokenURI,{registeredNativeGzip:currentNativeGzipProof(root)})).freshPayloadPolicySatisfied,true);
 for(const supplied of [stored,Buffer.from('corrupt')])await assert.rejects(document({entry:{id:'index.html',mediaType:'text/html',source:html,compression:'gzip',storedBytes:supplied}}),/only for declared LZMA/);
});
