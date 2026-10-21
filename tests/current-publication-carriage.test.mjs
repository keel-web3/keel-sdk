import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';

// The same unchanged cases can target the preserved predecessor for RED proof.
const root = process.env.KEEL_CURRENT_PUBLICATION_TEST_ROOT ?? path.resolve(import.meta.dirname, '..');
const load = name => import(pathToFileURL(path.join(root, 'packages/sdk/dist', name + '.js')));
const graph = await load('inline-viewer-graph');
const presentation = await load('presentation');
const audit = await load('inline-transport-audit');
const copy = await load('prepared-copy-publication');
const candidates = await load('registered-inline-candidates');
const defaults = await load('studio-project-defaults');
const sha = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => ({ algorithm:'sha256', digest:sha(bytes), byteLength:bytes.length });
const address = '0x1111111111111111111111111111111111111111';
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const rawMedia = 'application/vnd.keel.token-uri-raw-percent-fragment';
const oldMedia = ['application/vnd.keel.token-uri-percent-fragment', 'application/vnd.keel.token-uri-base64-fragment', 'application/vnd.keel.token-uri-base64-body-fragment'];
const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz', import.meta.url))));
const half = side => graph.decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-' + side].base64, 'base64'), rawMedia);
const shell = {schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:{bytes:half('prefix'),integrity:integrity(half('prefix'))},suffix:{bytes:half('suffix'),integrity:integrity(half('suffix'))}};
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=', 'base64');
const source = Buffer.from('<!doctype html><html><body>Exact 水</body></html>');
const makeDocument = () => graph.buildKeelInlineLocalDocument({shell,modules:[],assets:[{id:'poster.png',mediaType:'image/png',source:image,compression:'none'}],entry:{id:'entry.html',mediaType:'text/html',source,compression:'none'}});
const prepare = (part,options={}) => graph.buildKeelPreparedOneOfOneTokenURI({graph:part,chainId:11155111,collection:address,collectionName:'Current',description:'Exact source',imageURI:'data:image/png;base64,'+image.toString('base64'),manifestURI:'web3://existing',manifestDigest:hash(1),...options});

test('fresh SDK exposes only compact/raw-percent carriage selectors', () => {
  assert.deepEqual(presentation.KEEL_INLINE_CARRIAGES, ['compact','raw-percent']);
  for (const value of ['pinned','percent','follow-latest']) assert.throws(() => presentation.resolveKeelInlineCarriage(value));
});

test('current source creates raw-percent metadata and HTML while preserving exact media Base64', async () => {
  const document = await makeDocument();
  const compiled = await graph.buildKeelInlineTokenURIGraph(document);
  assert.equal(compiled.mediaType, rawMedia);
  assert.deepEqual(compiled.htmlBytes, document.rootBytes);
  const prepared = await prepare(compiled);
  assert.equal(prepared.requiredBuilder, 'KeelRawTokenURIBuilder');
  assert.match(prepared.tokenURI, /^data:application\/json;charset=utf-8,/);
  const metadata = JSON.parse(decodeURIComponent(prepared.tokenURI.slice(prepared.tokenURI.indexOf(',')+1)));
  assert.equal(metadata.image, 'data:image/png;base64,'+image.toString('base64'));
  assert.match(metadata.animation_url, /^data:text\/html;charset=utf-8,/);
  assert.equal((await audit.auditKeelInlineTokenURI(prepared.tokenURI)).completeDocumentBase64Layers, 0);
});

test('acknowledgement and environment cannot revive a retired fresh constructor', async () => {
  const document = await makeDocument();
  const before = process.env.KEEL_LEGACY_CARRIAGE;
  process.env.KEEL_LEGACY_CARRIAGE = 'allow';
  try {
    for (const name of ['buildKeelInlinePreEncodedTokenURIGraph','buildKeelInlineEscapedTokenURIGraph','buildKeelInlineFollowLatestTokenURIBodyGraph']) {
      await assert.rejects(graph[name](document,{legacyCarriage:'acknowledged'}), /retired/);
    }
    for (const carriage of ['pinned','percent','follow-latest']) await assert.rejects(graph.buildKeelInlineTokenURIGraph(document,{carriage,legacyCarriage:'acknowledged'}));
    await assert.rejects(graph.buildKeelInlineTokenURIGraph(document,{legacyCarriage:'acknowledged'}), /retired/);
    await assert.rejects(graph.buildKeelPreparedTokenURIFragment(source), /retired/);
    await assert.rejects(graph.compareKeelInlineTokenURICarriages(document), /retired/);
  } finally { if(before===undefined) delete process.env.KEEL_LEGACY_CARRIAGE; else process.env.KEEL_LEGACY_CARRIAGE=before; }
});

test('prepared composer and COPY readback cannot select retired graph media under an explicit policy', async () => {
  for (const mediaType of oldMedia) {
    let html='<html><body>old</body></html>';while(Buffer.byteLength(html)%9)html+=' ';
    let payload=mediaType.includes('percent')?encodeURIComponent(html):Buffer.from(html).toString('base64');
    while(payload.length%3)payload+='.';
    const fragmentBytes=Buffer.from(Buffer.from(payload).toString('base64'));
    await assert.rejects(prepare({mediaType,fragmentBytes},{presentationPolicy:'raw-artifact'}), /retired/);
    assert.equal(copy.isKeelPreparedCopyMediaType(mediaType), false);
    assert.throws(() => copy.keelPreparedCopyBuilder(mediaType), /current raw-percent/);
  }
  assert.equal(copy.keelPreparedCopyBuilder(rawMedia), 'KeelRawTokenURIBuilder');
});

test('exact raw object reuse stays zero-publication; historical byte encodings cannot be inferred', async () => {
  const texts = ['<main>   ','Water    ','</main>  '];
  const scope = {mode:'assembly-only',chainId:11155111,store:address};
  const parts = mediaType => texts.map((text,i) => {
    const bytes = mediaType===rawMedia ? Buffer.from(encodeURIComponent(encodeURIComponent(text)))
      : mediaType.includes('percent') ? Buffer.from(Buffer.from(encodeURIComponent(text)).toString('base64'))
      : Buffer.from(Buffer.from(Buffer.from(text).toString('base64')).toString('base64'));
    return {role:['shell-prefix','entrypoint','shell-suffix'][i],bytes,integrity:integrity(bytes),carrier:{chainId:11155111,store:address,objectId:hash(i+10),mediaType,compression:'none',storedByteLength:bytes.length}};
  });
  const accepted = await graph.inspectKeelInlineExistingObjectReuse({existingObjectReuse:scope,existingParts:parts(rawMedia)});
  assert.equal(accepted.carriage,'raw-percent');assert.equal(accepted.newSourcePublicationBytes,0);
  assert.equal(accepted.selectedChainBindingVerified,false);
  assert.deepEqual(Buffer.from(accepted.root.rootBytes),Buffer.from(texts.join('')));
  for(const mediaType of oldMedia) await assert.rejects(graph.inspectKeelInlineExistingObjectReuse({existingObjectReuse:scope,existingParts:parts(mediaType)}));
});

test('registered candidate source ABI is canonical-items only, never a Dense compatibility profile', () => {
  const recipe={profile:'current-local-shape-only',chainId:11155111,store:address,registry:address,reader:address,readerRuntimeCodeHash:hash(1),registrationDigest:hash(2),revision:5,codec:'none',sourceReader:'canonical-items',registeredParts:[{objectId:hash(3),digest:hash(4),byteLength:1,role:'boot'}]};
  assert.match(candidates.keelRegisteredInlineRecipeDigest(recipe),/^0x[0-9a-f]{64}$/);
  for(const sourceReader of ['legacy-dense','uri81-containers']) assert.throws(()=>candidates.keelRegisteredInlineRecipeDigest({...recipe,sourceReader}));
});

test('current context validator retains exact ABI, all security guards, immutable copy and no getters', async () => {
  const {validateKeelPreparedContext:validate}=await load('prepared-context');
  const value={protocol:'keel-context@1',chainId:'11155111',collection:address,tokenId:'1',derivedTokenSeed:hash(1),manifestDigest:hash(2)};
  const captured=validate(value,11155111);assert.notEqual(captured,value);assert.equal(Object.isFrozen(captured),true);
  value.tokenId='2';assert.equal(captured.tokenId,'1');
  for(const bad of [null,[],Object.create(null),Object.assign(Object.create({}),captured),{...captured,extra:true},{...captured,protocol:'new-context'}, {...captured,chainId:'1'}, {...captured,collection:'0x'+'0'.repeat(40)}, {...captured,collection:'0x'+'A'.repeat(40)}, {...captured,tokenId:'01'}, {...captured,tokenId:'-1'}, {...captured,tokenId:(1n<<256n).toString()}, {...captured,derivedTokenSeed:'0x1'}, {...captured,manifestDigest:'0x'+'A'.repeat(64)}]) assert.throws(()=>validate(bad,11155111));
  for(const chain of [0,-1,NaN,Number.MAX_SAFE_INTEGER+1,1]) assert.throws(()=>validate(captured,chain));
  const hidden={...captured};Object.defineProperty(hidden,'extra',{value:true});assert.throws(()=>validate(hidden,11155111));
  const symbol={...captured,[Symbol('extra')]:true};assert.throws(()=>validate(symbol,11155111));
  const nonenumerable={...captured};Object.defineProperty(nonenumerable,'tokenId',{value:'1',enumerable:false});assert.throws(()=>validate(nonenumerable,11155111));
  let reads=0;const getter={...captured};Object.defineProperty(getter,'tokenId',{enumerable:true,get(){reads++;return '1';}});
  assert.throws(()=>validate(getter,11155111));assert.equal(reads,0);
});

test('retained Base90/91 build choices cannot silently override the current fresh transport', () => {
  const profile=defaults.createKeelStudioDefaultProfile(),current=defaults.resolveKeelBuildDefaults(profile);
  assert.equal(current.values.transportProfile,'uri81-block-v1');
  for(const transportProfile of ['base90-v1','base91-v1','base64']) {
    assert.throws(()=>defaults.assertKeelRetainedBuildDefaultsCurrent(profile,{retained:{...current,values:{...current.values,transportProfile}}}));
    assert.throws(()=>defaults.resolveKeelRetainedBuildReadPolicy(profile,{retained:{...current,values:{...current.values,transportProfile}}}));
  }
});

test('actual MCP raw reuse remains review-only and rejects historical media without writes', async t => {
  const {createMcpServer}=await import(pathToFileURL(path.join(root,'packages/mcp/dist/index.js')));
  const directory=await mkdtemp('/tmp/keel-current-reuse-');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const server=await createMcpServer({workspaceRoot:directory});
  await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'current-carriage-test',version:'1'}}});
  let id=2;
  for(const lane of ['raw','base64','percent','follow-latest']) {
    const parts=[];
    for(const [index,text] of ['<main>   ','Water    ','</main>  '].entries()) {
      const bytes=lane==='raw'?Buffer.from(encodeURIComponent(encodeURIComponent(text))):lane==='percent'?Buffer.from(Buffer.from(encodeURIComponent(text)).toString('base64')):Buffer.from(Buffer.from(Buffer.from(text).toString('base64')).toString('base64'));
      const mediaType=lane==='raw'?rawMedia:lane==='percent'?oldMedia[0]:lane==='follow-latest'&&index===1?oldMedia[2]:oldMedia[1];
      const bytesPath=`${lane}-${index}.bin`;await writeFile(path.join(directory,bytesPath),bytes);
      parts.push({id:`part-${index}`,role:['shell-prefix','entrypoint','shell-suffix'][index],objectId:hash(index+10),mediaType,compression:'none',bytesPath,digest:sha(bytes),byteLength:bytes.length,transactionHash:hash(index+20)});
    }
    const before=(await readdir(directory)).sort();
    const response=await server.handle({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name:'keel-inline-reuse-plan',arguments:{chainId:11155111,store:address,builder:address,readback:{blockNumber:'11800000',blockHash:hash(3),orderedObjectIds:parts.map(p=>p.objectId)},parts}}});
    assert.deepEqual((await readdir(directory)).sort(),before);
    if(lane==='raw') {
      assert.equal(response.result.isError,undefined,JSON.stringify(response));
      const result=response.result.structuredContent;
      assert.equal(result.status,'review-only');assert.equal(result.assembly.carriage,'raw-percent');
      assert.equal(result.assembly.selectedChainBindingVerified,false);assert.equal(result.bytes.newStoredBytes,0);
      assert.deepEqual(result.objectWrites,[]);assert.equal(result.uploadPlan,null);assert.equal(result.submission,'not-performed');
    } else assert.equal(response.result.isError,true,JSON.stringify(response));
  }
});
