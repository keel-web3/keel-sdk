import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {KEEL_CREATIVE_RUNTIME_CATALOG} from '../packages/sdk/dist/creative-runtime-catalog.js';
import {assertKeelInlineNoExternalDependencies,buildKeelInlineModuleFragment} from '../packages/sdk/dist/inline-viewer-graph.js';

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

test('exact catalog p5 bytes admit their non-network URL-polyfill vectors only under their pinned identity',async()=>{
  const {resource,bytes}=await actualPinned('p5-1-11-3');
  assert.match(bytes.toString('utf8'),/http:\/\/a/u);
  const built=await fragment(resource,bytes);
  assert.equal(built.moduleId,resource.id);
  await assert.rejects(()=>fragment(resource,bytes,'p5.js'),/external resource locator/u);
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
  for(const source of ['fetch("https://blocked.invalid/asset")','<script src="https://blocked.invalid/executable.js"></script>','import "https://blocked.invalid/module.mjs"','<img src="http://blocked.invalid/poster">']) {
    assert.throws(()=>assertKeelInlineNoExternalDependencies(Buffer.from(source)),/external resource locator/u);
  }
  assert.doesNotThrow(()=>assertKeelInlineNoExternalDependencies(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')));
});
