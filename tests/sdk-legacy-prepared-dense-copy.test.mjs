import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { buildKeelLegacyPreparedDenseDocument, readKeelLegacyPreparedDenseSources, KEEL_LEGACY_PREPARED_DENSE_SHELL_ID } from '../packages/sdk/dist/legacy-prepared-dense-copy.js';
import { createKeelLegacyPreparedDenseReader, validateKeelLegacyPreparedContext } from '../packages/sdk/dist/legacy-prepared-dense-reader.js';
import { buildKeelInlineTokenURIGraph, buildKeelPreparedOneOfOneTokenURI, buildKeelInlineLocalDocument, buildKeelInlineShellFragments, buildKeelInlineModuleFragment } from '../packages/sdk/dist/inline-viewer-graph.js';
import { auditKeelInlineTokenURI, assertKeelFreshPayloadAudit, inspectKeelPreparedDenseCopyDocument, assertKeelFreshPayloadCarriage, readKeelInlineJSONArray } from '../packages/sdk/dist/inline-transport-audit.js';
import { buildKeelPreparedDenseCopyShell } from '../packages/sdk/dist/prepared-dense-copy.js';
import { decodeKeelDenseTransport } from '../packages/sdk/dist/dense-transport.js';
const sha = value => '0x' + createHash('sha256').update(value).digest('hex');
const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
const html = Buffer.from('<!doctype html><html><head></head><body><p>Hello🔥%#?</p><img src="poster.png"></body></html>' + '<!-- original exact source -->'.repeat(100));
const resource = (id, bytes, role='asset', mediaType='application/octet-stream') => ({ id, aliases:[id], role, mediaType, bytes });
const publication = extra => ({ chainId:11155111, entryId:'index.html', posterResourceId:'poster.png', resources:[resource('index.html', html,'entrypoint','text/html'),resource('poster.png',poster,'asset','image/png')],...extra });
async function finish(document) {
  const graph = await buildKeelInlineTokenURIGraph(document);
  const envelope = await buildKeelPreparedOneOfOneTokenURI({graph, chainId:11155111, collection:'0x'+'66'.repeat(20), collectionName:'Original public release', description:'Original sale terms', imageURI:'data:image/png;base64,'+poster.toString('base64'), manifestURI:'data:application/json,%7B%7D', manifestDigest:'0x'+'77'.repeat(32)});
  const metadata = await (await fetch(envelope.tokenURI)).json();
  const actual = Buffer.from(await (await fetch(metadata.animation_url)).arrayBuffer());
  return {graph,envelope,metadata,actual};
}
test('default Compact uses actual compatible Brotli/Dense legacy envelope and preserves exact source/poster',async()=>{
  const plan = await buildKeelLegacyPreparedDenseDocument(publication());
  const full = await finish(plan.document), replay = await readKeelLegacyPreparedDenseSources({htmlBytes:full.actual});
  assert.equal(plan.document.schema,'keel-inline-local-document@1');
  assert.equal(plan.shellRegistration.shellId,KEEL_LEGACY_PREPARED_DENSE_SHELL_ID);
  assert.equal(plan.shellRegistration.selectedChainRegistrationVerified,false);
  assert.equal(plan.shellRegistration.contextSchema,'keel-context@1:legacy-six-fields');
  assert.equal(full.envelope.requiredBuilder,'KeelRawTokenURIBuilder');
  assert.deepEqual(Buffer.from(replay.resources.find(r=>r.id==='index.html').bytes),html);
  assert.deepEqual(Buffer.from(replay.resources.find(r=>r.id==='poster.png').bytes),poster);
  const audit = await auditKeelInlineTokenURI(full.envelope.tokenURI);
  assert.equal(audit.completeDocumentBase64Layers,0);assert.equal(audit.carriage.preparedDenseCopy.legacyPreparedProfile,'keel.legacy-prepared-dense-copy@1');
  assert.doesNotThrow(()=>assertKeelFreshPayloadAudit(JSON.parse(JSON.stringify(audit.carriage))));
  assert.equal(replay.reader.members,2);assert.equal(replay.selectedChainBindingVerified,false);
  assert.ok(plan.optimization.compressedPayloadBytes<html.length+poster.length);
  assert.equal(full.metadata.image,'data:image/png;base64,'+poster.toString('base64'));
  assert.equal(JSON.parse(full.envelope.contextJSON).protocol,'keel-context@1');
  assert.equal(Object.keys(JSON.parse(full.envelope.contextJSON)).length,6);
});
test('auto keeps nonbeneficial exact bytes; explicit codec choices and Raw are preserved',async()=>{
  const random=randomBytes(4096);
  const plan=await buildKeelLegacyPreparedDenseDocument(publication({resources:[resource('index.html',html,'entrypoint','text/html'),resource('noise.bin',random)],posterResourceId:undefined}));
  const inspected=inspectKeelPreparedDenseCopyDocument(new TextDecoder().decode(plan.document.rootBytes));
  const packs=readKeelInlineJSONArray(inspected.html,'globalThis.__KEEL_EMBEDDED_CONTAINERS__=');
  assert.equal(packs.find(p=>p.integrity.digest===sha(random)).compression,'none');
  for(const compression of ['brotli','gzip','deflate','none']){
    const chosen=await buildKeelLegacyPreparedDenseDocument(publication({compression}));
    const replay=await readKeelLegacyPreparedDenseSources({htmlBytes:chosen.document.rootBytes});
    assert.deepEqual(Buffer.from(replay.resources[0].bytes),html);
    const rows=readKeelInlineJSONArray(inspectKeelPreparedDenseCopyDocument(new TextDecoder().decode(chosen.document.rootBytes)).html,'globalThis.__KEEL_EMBEDDED_CONTAINERS__=');
    assert.ok(rows.every(row=>row.compression===compression));
  }
  await assert.rejects(buildKeelLegacyPreparedDenseDocument(publication({payloadStorage:'raw'})),/Explicit Raw/);
  const raw=await buildKeelInlineLocalDocument({payloadStorage:'raw',shell:await buildKeelInlineShellFragments(),modules:[],entry:{id:'index.html',mediaType:'text/html',source:html}});
  const full=await finish(raw); const rawItems=readKeelInlineJSONArray(new TextDecoder().decode(full.actual),'globalThis.__KEEL_ITEMS__='); assert.equal(rawItems.find(item=>item?.id==='index.html').embedded.storedText,html.toString());
});
test('40/41,128/129,256 and configured1024 logical resources retain IDs/order without expanding the64-part root',async()=>{
  for(const count of [40,41,128,129,256,1024]){
    const resources=[resource('index.html',Buffer.from('<p>capacity</p>'),'entrypoint','text/html'),...Array.from({length:count-1},(_,i)=>resource('file-'+i,Buffer.from([i&255])))];
    const plan=await buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',resources,sourceLimits:{maximumResources:count,maximumDecodedSourceBytes:128*1024*1024}});
    assert.ok(plan.document.parts.length<=64);assert.equal(plan.resources.length,count);
    assert.equal(plan.optimization.descriptorGroups.reduce((sum,size)=>sum+size,0),count);assert.ok(plan.optimization.descriptorGroups.every(size=>size<=128));
    const replay=await readKeelLegacyPreparedDenseSources({htmlBytes:plan.document.rootBytes});assert.deepEqual(replay.resources.map(r=>r.id),resources.map(r=>r.id));
    const full=await finish(plan.document); assert.ok(Buffer.byteLength(full.envelope.tokenURI)<=2_000_000);
  }
  await assert.rejects(buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',resources:Array.from({length:257},(_,i)=>resource(i?'file-'+i:'index.html',Buffer.from('x'),i?'asset':'entrypoint',i?'application/octet-stream':'text/html'))}),/configured upload file/);
});
test('large sources are segmented without changing original identity or adding an aggregate32MiB limit',async()=>{
  const source=Buffer.concat([Buffer.from('<!doctype html><p>large exact source</p><!--'),Buffer.alloc(32*1024*1024+1,65),Buffer.from('-->')]);
  const plan=await buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',resources:[resource('index.html',source,'entrypoint','text/html')],brotliQuality:0});
  assert.ok(plan.resources[0].preparedCopy.segments.length>1);
  const replay=await readKeelLegacyPreparedDenseSources({htmlBytes:plan.document.rootBytes});assert.equal(sha(replay.resources[0].bytes),sha(source));assert.equal(replay.resources[0].bytes.length,source.length);
});
test('new profile rejects changed outer execution, missing/context impersonation and conflicting namespaces',async()=>{
  const plan=await buildKeelLegacyPreparedDenseDocument(publication());const full=await finish(plan.document);
  for(const changed of [Buffer.concat([plan.document.rootBytes,Buffer.from('<script>globalThis.evil=true</script>')]),Buffer.from(new TextDecoder().decode(plan.document.rootBytes).replace('];queueMicrotask',' ];globalThis.evil=true;queueMicrotask'))]) assert.throws(()=>assertKeelFreshPayloadCarriage(changed));
  const context=JSON.parse(full.envelope.contextJSON);validateKeelLegacyPreparedContext({...context,tokenId:'128'},11155111);
  for(const altered of [{...context,chainId:'1'},{...context,composerAddress:'0x'+'88'.repeat(20)},{...context,protocol:'keel-context@3'},{...context,tokenId:'01'}])assert.throws(()=>validateKeelLegacyPreparedContext(altered,11155111));
  await assert.rejects(buildKeelLegacyPreparedDenseDocument(publication({resources:[resource('index.html',html,'entrypoint','text/html'),{...resource('other',poster),aliases:['index.html']}],posterResourceId:undefined})),/alias/);
  await assert.rejects(buildKeelPreparedDenseCopyShell({legacyPreparedDenseDelivery:{chainId:11155111},context}),/actual appended/);
  const wrongAudit=await auditKeelInlineTokenURI(full.envelope.tokenURI);const altered=structuredClone(wrongAudit.carriage);altered.preparedDenseCopy.legacyPreparedProfile='keel.legacy-prepared-dense-copy@999';assert.throws(()=>assertKeelFreshPayloadAudit(altered));
});
test('existing registered text modules keep exact fragment bytes and data/module playback order',async()=>{
  const data=await buildKeelInlineModuleFragment({moduleId:'keel.data',version:'1',mediaType:'text/javascript',decodedBytes:Buffer.from('globalThis.exactData="<original>";'),execution:'classic',phase:'data'});
  const runtime=await buildKeelInlineModuleFragment({moduleId:'keel.runtime',version:'1',mediaType:'text/javascript',decodedBytes:Buffer.from('globalThis.exactRuntime=globalThis.exactData;'),execution:'classic',phase:'runtime'});
  const plan=await buildKeelLegacyPreparedDenseDocument(publication({modules:[data,runtime]}));
  const parts=plan.document.parts.filter(p=>p.role==='module');assert.deepEqual(parts.map(p=>Buffer.from(p.bytes)),[Buffer.from(data.bytes),Buffer.from(runtime.bytes)]);
  const replay=await readKeelLegacyPreparedDenseSources({htmlBytes:plan.document.rootBytes});assert.deepEqual(replay.resources.slice(0,2).map(r=>r.id),['keel.data','keel.runtime']);
  assert.deepEqual(Buffer.from(replay.resources[0].bytes),Buffer.from(data.item.embedded.storedText));
  const compressed=await buildKeelInlineModuleFragment({moduleId:'keel.old',version:'1',mediaType:'text/javascript',decodedBytes:Buffer.from('original'),compression:'gzip'});
  await assert.rejects(buildKeelLegacyPreparedDenseDocument(publication({modules:[compressed]})),/receipt-aware/);
});
test('existing compressed bytes stay exact and new512KiB leaves retain mixed none/Brotli selection',async()=>{
  const {brotliCompressSync,constants}=await import('node:zlib');
  const stored=brotliCompressSync(html,{params:{[constants.BROTLI_PARAM_QUALITY]:4}});
  const original=await buildKeelLegacyPreparedDenseDocument(publication({resources:[{...resource('index.html',html,'entrypoint','text/html'),compression:'brotli',storedBytes:stored}],posterResourceId:undefined}));
  const rows=readKeelInlineJSONArray(inspectKeelPreparedDenseCopyDocument(new TextDecoder().decode(original.document.rootBytes)).html,'globalThis.__KEEL_EMBEDDED_CONTAINERS__=');
  assert.equal(rows[0].storedIntegrity.digest,sha(stored));assert.equal(rows[0].compression,'brotli');
  assert.deepEqual(Buffer.from((await readKeelLegacyPreparedDenseSources({htmlBytes:original.document.rootBytes})).resources[0].bytes),html);
  const changed=Buffer.from(stored);changed[0]^=1;
  await assert.rejects(buildKeelLegacyPreparedDenseDocument(publication({resources:[{...resource('index.html',html,'entrypoint','text/html'),compression:'brotli',storedBytes:changed}],posterResourceId:undefined})));
  const source=Buffer.concat([randomBytes(512*1024),Buffer.alloc(512*1024,65)]);
  const mixed=await buildKeelLegacyPreparedDenseDocument(publication({resources:[resource('index.html',html,'entrypoint','text/html'),resource('mixed.bin',source)],posterResourceId:undefined}));
  assert.equal(mixed.optimization.leafDecodedBytes,512*1024);
  const descriptor=mixed.resources.find(r=>r.id==='mixed.bin');assert.equal(descriptor.preparedCopy.segments.length,2);
  const packs=readKeelInlineJSONArray(inspectKeelPreparedDenseCopyDocument(new TextDecoder().decode(mixed.document.rootBytes)).html,'globalThis.__KEEL_EMBEDDED_CONTAINERS__=');
  assert.deepEqual(descriptor.preparedCopy.segments.map(s=>packs.find(p=>p.id===s.packId).compression),['none','brotli']);
  const replay=await readKeelLegacyPreparedDenseSources({htmlBytes:mixed.document.rootBytes});assert.equal(sha(replay.resources.find(r=>r.id==='mixed.bin').bytes),sha(source));
});
