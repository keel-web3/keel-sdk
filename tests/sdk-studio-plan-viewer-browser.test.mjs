import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {prepareKeelCreatorInline, decodeKeelPreparedDenseCopyFragment, readKeelPreparedInlineSources, toKeelDenseTransportDataURL} from '../packages/sdk/dist/index.js';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';

const store='0x'+'11'.repeat(20), hash=n=>'0x'+n.repeat(32),address=n=>'0x'+n.repeat(20);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const pngDigest=createHash('sha256').update(png).digest('hex');
const resources=[
 {id:'index.html',role:'entrypoint',mediaType:'text/html',aliases:['./index.html'],bytes:Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="./style.css"></head><body><p id="work">Modular🔥%#</p><img id="poster" src="./art.png"><img id="copy" src="./copy.png"><script type="module" src="./game.js"></script></body></html>'+ '<!-- source preserved -->'.repeat(100))},
 {id:'game.js',role:'module',mediaType:'text/javascript',aliases:['./game.js'],bytes:Buffer.from('import {answer} from "./math.js";addEventListener("load",async()=>{const img=document.getElementById("poster"),copy=document.getElementById("copy");await Promise.all([img.decode(),copy.decode()]);const source=Object.fromEntries(globalThis.__KEEL_VERIFICATION__.checks.map(c=>[c.id,c.digest]));if(answer===42 && img.naturalWidth===1 && copy.naturalWidth===1 && getComputedStyle(document.getElementById("work")).color==="rgb(17, 34, 51)" && source["art.png"]==="0x'+pngDigest+'" && source["copy.png"]===source["art.png"])top.postMessage({keelOfflineProbe:"modular-bytes-played"},"*");});'+ '\n// exact source'.repeat(100))},
 {id:'math.js',role:'module',mediaType:'text/javascript',aliases:['./math.js'],bytes:Buffer.from('export const answer=42;')},
 {id:'art.png',role:'asset',mediaType:'image/png',aliases:['./art.png'],bytes:png},
 {id:'copy.png',role:'asset',mediaType:'image/png',aliases:['./copy.png'],bytes:png},
 {id:'style.css',role:'asset',mediaType:'text/css',aliases:['./style.css'],bytes:Buffer.from('#work{color:rgb(17,34,51)}'+ '/* source intact */'.repeat(100))},
];
const document=plan=>Buffer.concat([plan.shell.prefix,...plan.objects.slice(0,plan.request.bodyObjectIds.length),plan.shell.suffix].map(o=>Buffer.from(decodeKeelPreparedDenseCopyFragment(o.bytes)))).toString('utf8');
const context=plan=>({protocol:'keel-context@3',chainId:'31337',collection:address('22'),tokenId:'1',composerAddress:address('33'),composerCodeHash:hash('44'),composerRevision:'1',containerTableObjectId:plan.table.objectId,containerTableDigest:plan.table.digest,presentationDigest:hash('55'),presentationDigestType:'keccak256:keel.creator-prepared-copy-presentation@1'});

test('actual Chromium replays none and Brotli modular bytes through the complete metadata data URI with network denied', {timeout:120000},async()=>{
 for(const compression of ['none','auto']){
  const plan=await prepareKeelCreatorInline({chainId:31337,store,resources,poster:{mediaType:'image/png',bytes:png},compression});
  assert.deepEqual(plan.resources.map(resource=>resource.id),resources.map(resource=>resource.id));
  assert.deepEqual(plan.playbackModuleOrder,['math.js','game.js']);
  assert.equal(plan.optimization.physicalPayloadCount,resources.length-1);
  assert.equal(plan.resources.find(r=>r.id==='art.png').carrier.objectId,plan.resources.find(r=>r.id==='copy.png').carrier.objectId);
  const html=document(plan)+ '<script>globalThis.__KEEL_CONTEXT__='+JSON.stringify(context(plan))+'</script>';
  const animation=toKeelDenseTransportDataURL('html',html);
  const tokenURI=toKeelDenseTransportDataURL('metadata',JSON.stringify({name:'Local modular byte fixture',image:plan.posterURI,animation_url:animation}));
  assert.ok(Buffer.byteLength(tokenURI)<=2_000_000);
  const metadata=await (await fetch(tokenURI)).json();
  const returned=Buffer.from(await (await fetch(metadata.animation_url)).arrayBuffer());
  assert.deepEqual(returned,Buffer.from(html));
  const read=await readKeelPreparedInlineSources({htmlBytes:returned,chainId:31337,store:plan.store,tableDigest:plan.table.digest});
  assert.equal(read.resources.length,resources.length);
  for(const r of read.resources){const original=resources.find(resource=>resource.id===r.id);assert.ok(original);assert.deepEqual(Buffer.from(r.bytes),original.bytes);}
  const result=await observeOfflineShell(returned.toString(),'verified','modular-bytes-played',{retainSignalsAcrossDocumentOpen:true});
  assert.deepEqual(result.externalRequests,[]);assert.deepEqual(result.pageNetworkRequests,[]);assert.deepEqual(result.errors,[]);
  // Proxy records also include browser-service preconnects on a scriptless
  // control page. Keep every record visible; CDP and origin-attributed netlog
  // independently assert that the artwork attempted no external request.
  console.log(JSON.stringify({compression,artworkRequests:result.externalRequests,pageNetworkRequests:result.pageNetworkRequests,deniedProxyRequests:result.proxyRequests}));
  assert.equal(result.frames,1);assert.equal(result.opaque,true);
 }
});

test('a changed prepared payload never executes the artwork in the actual offline browser', {timeout:60000},async()=>{
 const plan=await prepareKeelCreatorInline({chainId:31337,store,resources,poster:{mediaType:'image/png',bytes:png}});
 const pack=plan.resources[0].pack, changed=(pack.storedDense[0]==='A'?'B':'A')+pack.storedDense.slice(1);
 const html=document(plan).replace(pack.storedDense,changed)+'<script>globalThis.__KEEL_CONTEXT__='+JSON.stringify(context(plan))+'</script>';
 const result=await observeOfflineShell(html,'failed');
 assert.equal(result.frames,0);assert.deepEqual(result.signals,[]);assert.deepEqual(result.externalRequests,[]);assert.deepEqual(result.pageNetworkRequests,[]);
});

test('unsupported cyclic module imports reject during preparation before storage or browser execution',async()=>{
 const cyclic=resources.map(resource=>resource.id==='game.js'
  ? {...resource,bytes:Buffer.from('import {answer} from "./math.js";export const boot=answer;')}
  : resource.id==='math.js'
    ? {...resource,bytes:Buffer.from('import {boot} from "./game.js";export const answer=boot;')}
    : resource);
 let objectReads=0;
 await assert.rejects(prepareKeelCreatorInline({chainId:31337,store,resources:cyclic,poster:{mediaType:'image/png',bytes:png},readSlug:async()=>{objectReads++;return null;}}),/Cyclic.*unsupported/);
 assert.equal(objectReads,0);
});
