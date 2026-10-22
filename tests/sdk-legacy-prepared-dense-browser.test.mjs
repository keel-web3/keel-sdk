import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeelLegacyPreparedDenseDocument } from '../packages/sdk/dist/legacy-prepared-dense-copy.js';
import { buildKeelInlineTokenURIGraph, buildKeelPreparedOneOfOneTokenURI, buildKeelInlineModuleFragment } from '../packages/sdk/dist/inline-viewer-graph.js';
import { observeOfflineShell } from './support/offline-shell-browser.mjs';
const poster = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
async function actualFullReturn(shellBootCompression) {
  const data = await buildKeelInlineModuleFragment({ moduleId:'keel.data',version:'1',mediaType:'text/javascript',execution:'classic',phase:'data',decodedBytes:Buffer.from('globalThis.preservedData="data-before-render";') });
  const runtime = await buildKeelInlineModuleFragment({ moduleId:'keel.runtime',version:'1',mediaType:'text/javascript',execution:'classic',phase:'runtime',decodedBytes:Buffer.from('globalThis.preservedRuntime=globalThis.preservedData;') });
  const source = Buffer.from('<!doctype html><html><head></head><body><p>Exact preview🔥</p><img src="poster.png"><script>top.postMessage({keelOfflineProbe:globalThis.preservedRuntime+":"+__KEEL_CONTEXT__.tokenId+":"+__KEEL_CONTENT__.bytes("poster.png").length},"*")</script></body></html>'+'<!--beneficial-->' .repeat(100));
  const plan = await buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'index.html',posterResourceId:'poster.png',shellBootCompression,modules:[data,runtime],resources:[{id:'index.html',aliases:['index.html'],role:'entrypoint',mediaType:'text/html',bytes:source},{id:'poster.png',aliases:['poster.png'],role:'asset',mediaType:'image/png',bytes:poster}]});
  const graph = await buildKeelInlineTokenURIGraph(plan.document);
  const envelope = await buildKeelPreparedOneOfOneTokenURI({graph,chainId:11155111,collection:'0x'+'66'.repeat(20),collectionName:'Original release',description:'Original supply and sale unchanged',imageURI:'data:image/png;base64,'+poster.toString('base64'),manifestURI:'data:application/json,%7B%7D',manifestDigest:'0x'+'77'.repeat(32)});
  const metadata = await(await fetch(envelope.tokenURI)).json();
  return {html:await(await fetch(metadata.animation_url)).text(),plan,envelope};
}
for(const boot of ['gzip','none'])test(`retired full legacy metadata ${boot} boot rejects before offline publication can be prepared`,{timeout:120000},async()=>{
  await assert.rejects(actualFullReturn(boot),error=>error instanceof TypeError&&/^buildKeelLegacyPreparedDenseDocument is retired for fresh publication\. Use the registered canonical raw-percent resource pipeline\.$/u.test(error.message));
});
test('scriptless browser control retains every denied browser-service proxy request',{timeout:60000},async()=>{
  const proof=await observeOfflineShell('<!doctype html><html><body data-verification="verified"><p>Scriptless browser-service control</p></body></html>');
  assert.deepEqual(proof.externalRequests,[]);assert.deepEqual(proof.pageNetworkRequests,[]);assert.equal(proof.frames,0);
  console.log(JSON.stringify({scriptlessControl:true,artworkRequests:proof.externalRequests,pageNetworkRequests:proof.pageNetworkRequests,deniedProxyRequests:proof.proxyRequests}));
});
test('retired dense preparation cannot reach a changed-payload browser execution path',{timeout:120000},async()=>{
  await assert.rejects(actualFullReturn('gzip'),error=>error instanceof TypeError&&/^buildKeelLegacyPreparedDenseDocument is retired for fresh publication\. Use the registered canonical raw-percent resource pipeline\.$/u.test(error.message));
});
