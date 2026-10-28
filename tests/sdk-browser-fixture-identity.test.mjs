import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {KEEL_CREATIVE_RUNTIME_CATALOG} from '../packages/sdk/dist/creative-runtime-catalog.js';
import {assertKeelInlineNoExternalDependencies,buildKeelInlineModuleFragment,buildKeelInlineLocalDocument,verifyKeelPublishedInlineModuleFragment} from '../packages/sdk/dist/inline-viewer-graph.js';

const catalog=KEEL_CREATIVE_RUNTIME_CATALOG.flatMap(entry=>entry.resources);
async function actualPinned(id) {
  const resource=catalog.find(entry=>entry.id===id);
  assert.ok(resource?.integrity);
  let bytes=await readFile(resource.localPath);
  if(resource.localTransform) {
    assert.equal(resource.localTransform.kind,'replace-text');
    bytes=Buffer.from(bytes.toString('utf8').replaceAll(resource.localTransform.from,resource.localTransform.to));
  }
  assert.equal(bytes.byteLength,resource.integrity.byteLength);
  assert.equal('0x'+createHash('sha256').update(bytes).digest('hex'),resource.integrity.digest);
  return {resource,bytes};
}
async function fragment(resource,bytes,moduleId=resource.id) {
  return await buildKeelInlineModuleFragment({moduleId,version:resource.version,mediaType:resource.mediaType,decodedBytes:bytes,compression:'gzip',execution:resource.format==='classic-script'?'classic':'module'});
}

test('exact catalog p5 bytes accept the supported versioned binding and canonical identity',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  assert.match(bytes.toString('utf8'),/http:\/\/a/u);
  const built=await fragment(resource,bytes);
  assert.equal(built.moduleId,resource.id);
  assert.equal((await fragment(resource,bytes,'p5.js')).moduleId,'p5.js');
  assert.ok(Object.isFrozen(resource.moduleIdAliases));
});

test('p5 binding and canonical identities reject wrong versions, changed bytes, and unknown aliases',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  for(const moduleId of ['p5.js',resource.id]) {
    await assert.rejects(()=>fragment({...resource,version:'1.11.4'},bytes,moduleId),/exact pinned version/u);
    const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
    await assert.rejects(()=>fragment(resource,changed,moduleId),/differs from its pinned artifact/u);
    await assert.rejects(()=>fragment(resource,Buffer.concat([bytes,Buffer.from(';fetch("https://blocked.invalid/runtime")')]),moduleId),/differs from its pinned artifact/u);
  }
  await assert.rejects(()=>fragment(resource,bytes,'p5.unknown'),/external resource locator/u);
});

test('p5 alias does not admit missing, blank, case-changed or historical versions and incomplete bytes',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  const input={moduleId:'p5.js',mediaType:resource.mediaType,decodedBytes:bytes,compression:'none',execution:'classic'};
  for(const version of [undefined,'','V1.11.3','1.7.0']) {
    await assert.rejects(()=>buildKeelInlineModuleFragment({...input,...(version===undefined?{}:{version})}));
  }
  await assert.rejects(()=>buildKeelInlineModuleFragment({...input,version:resource.version,decodedBytes:bytes.subarray(0,-1)}),/pinned artifact/u);
  const old=await actualPinned('p5-1-7-0');
  await assert.rejects(()=>fragment(old.resource,old.bytes,'p5.js'),/exact pinned version/u);
});

test('published p5 storedText and retained gzip reuse keep exact version, identity, aliases and byte commitments',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  for(const moduleId of [resource.id,'p5.js']) for(const compression of ['none','gzip']) {
    const aliases=['p5.min.js'];
    const module=await buildKeelInlineModuleFragment({moduleId,version:resource.version,mediaType:resource.mediaType,decodedBytes:bytes,compression,execution:'classic',aliases});
    const encodeFragment=bytes=>{const encoded=Buffer.from(encodeURIComponent(encodeURIComponent(Buffer.from(bytes).toString('utf8'))));return {bytes:encoded,integrity:{algorithm:'sha256',digest:'0x'+createHash('sha256').update(encoded).digest('hex'),byteLength:encoded.length},carrier:{chainId:11155111,store:'0x'+'11'.repeat(20),objectId:'0x'+'22'.repeat(32),mediaType:'application/vnd.keel.token-uri-raw-percent-fragment',compression:'none',storedByteLength:encoded.length}};};
    const published=encodeFragment(module.bytes);
    const input={fragment:published,moduleId,version:resource.version,mediaType:resource.mediaType,aliases,decodedBytes:bytes};
    await assert.doesNotReject(()=>verifyKeelPublishedInlineModuleFragment(input));
    const {version:_,...withoutVersion}=input;
    if(moduleId===resource.id) await assert.doesNotReject(()=>verifyKeelPublishedInlineModuleFragment(withoutVersion));
    else await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment(withoutVersion),/exact pinned version/u);
    for(const version of ['','1.11.4','V1.11.3']) await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,version}),/exact pinned version/u);
    await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,aliases:['different.js']}),/metadata does not match/u);
    await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,fragment:{...published,carrier:{...published.carrier,storedByteLength:published.bytes.length+1}}}),/exact uncompressed reusable fragment object/u);
    await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,decodedBytes:bytes.subarray(0,-1)}),/metadata does not match/u);
    if(compression==='none') {
      const item=JSON.parse(Buffer.from(module.bytes).toString('utf8').slice(1));
      assert.equal(typeof item.embedded.storedText,'string');
      item.embedded.storedText+=' ';
      await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,fragment:encodeFragment(Buffer.from(','+JSON.stringify(item)))}),/pinned artifact/u);
    }
  }
});

test('published p5 binding requires exact version, reusable fragment commitment and decoded bytes',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  const module=await buildKeelInlineModuleFragment({moduleId:'p5.js',version:resource.version,mediaType:resource.mediaType,decodedBytes:bytes,compression:'gzip',execution:'classic',aliases:['p5.min.js']});
  const encoded=Buffer.from(encodeURIComponent(encodeURIComponent(Buffer.from(module.bytes).toString('utf8'))));
  const published={bytes:encoded,integrity:{algorithm:'sha256',digest:'0x'+createHash('sha256').update(encoded).digest('hex'),byteLength:encoded.length},carrier:{chainId:11155111,store:'0x'+'11'.repeat(20),objectId:'0x'+'22'.repeat(32),mediaType:'application/vnd.keel.token-uri-raw-percent-fragment',compression:'none',storedByteLength:encoded.length}};
  const input={fragment:published,moduleId:'p5.js',version:resource.version,mediaType:resource.mediaType,aliases:['p5.min.js'],decodedBytes:bytes};
  await assert.doesNotReject(()=>verifyKeelPublishedInlineModuleFragment(input));
  await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,version:'1.11.4'}),/exact pinned version/u);
  const {version:_,...missingVersion}=input;
  await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment(missingVersion),/exact pinned version/u);
  await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,fragment:{...published,integrity:{...published.integrity,digest:'0x'+'00'.repeat(32)}}}),/reusable object commitment/u);
  const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
  await assert.rejects(()=>verifyKeelPublishedInlineModuleFragment({...input,decodedBytes:changed}),/payload does not match/u);
});

test('exact catalog Three main/core admit namespace syntax and prescribed local import transform',async()=>{
  for(const id of ['three-r180-core','three-r180-module']) {
    const {resource,bytes}=await actualPinned(id);
    assert.equal((await fragment(resource,bytes)).moduleId,id);
  }
  const {resource,bytes}=await actualPinned('three-r180-core');
  assert.match(bytes.toString('utf8'),/http:\/\/www\.w3\.org\/1999\/xhtml/u);
  await assert.rejects(()=>fragment(resource,bytes,'three.r180.core'),/external resource locator/u);
});

test('a pinned resource ID never authorizes modified library bytes or an appended remote executable',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  const changed=Buffer.from(bytes);changed[changed.length-1]^=1;
  await assert.rejects(()=>fragment(resource,changed),/differs from its pinned artifact/u);
  await assert.rejects(()=>fragment(resource,Buffer.concat([bytes,Buffer.from(';fetch("https://blocked.invalid/runtime")')])),/differs from its pinned artifact/u);
});

test('creator remote executable locators remain rejected and the SVG namespace remains syntax',()=>{
  for(const source of ['fetch("https://blocked.invalid/asset")','<script src="https://blocked.invalid/executable.js"></script>','import "https://blocked.invalid/module.mjs"','<img src="http://blocked.invalid/poster">','new URL("http://a")']) {
    assert.throws(()=>assertKeelInlineNoExternalDependencies(Buffer.from(source)),/external resource locator/u);
  }
  assert.doesNotThrow(()=>assertKeelInlineNoExternalDependencies(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
  const packed=gzipSync(Buffer.from('fetch("https://blocked.invalid/nested.js")'));
  assert.throws(()=>assertKeelInlineNoExternalDependencies(Buffer.from(JSON.stringify({embedded:{compression:'gzip',storedBase64:packed.toString('base64')}}))),/external resource locator/u);
});

test('a real pinned p5 module never authorizes creator fetch or import URLs in a project',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  const module=await fragment(resource,bytes);
  // Negative-input compiler controls only: this shell is never accepted,
  // published or presented as canonical/runtime evidence.
  const part=()=>{const bytes=Buffer.from('unpublished test shell');return {bytes,integrity:{algorithm:'sha256',digest:'0x'+createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length}};};
  const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:part(),suffix:part()};
  for(const source of ['fetch("https://blocked.invalid/asset")','import "https://blocked.invalid/module.mjs"']) {
    await assert.rejects(()=>buildKeelInlineLocalDocument({shell,modules:[module],entry:{id:'creator.js',mediaType:'text/javascript',source:Buffer.from(source)}}),/external resource locator/u);
  }
});
