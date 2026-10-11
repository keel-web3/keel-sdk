import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapInVerificationShell} from '../packages/sdk/dist/verification-shell.js';
import {observeOfflineShell} from './support/offline-shell-browser.mjs';

test('maintained wrapper renders committed modules without external requests and rejects tampering before mounting', {timeout:60000}, async()=>{
  const result=await wrapInVerificationShell({repositoryRoot:process.cwd(),title:'Offline wrapper assurance',
    entry:{mediaType:'text/html',source:'<!doctype html><html><body><canvas></canvas><script type="module">import {color} from "/content/palette.js";document.body.style.background=color;parent.postMessage({keelOfflineProbe:"palette-loaded"},"*");</script></body></html>'},
    assets:[{id:'palette',mediaType:'text/javascript',aliases:['/content/palette.js'],bytes:new TextEncoder().encode('export const color="#d7ff63";')}]});
  const valid=await observeOfflineShell(result.html,'verified','palette-loaded');
  assert.deepEqual(valid.externalRequests,[]);assert.deepEqual(valid.proxyRequests,[]);assert.deepEqual(valid.errors,[]);
  assert.equal(valid.frames,1);assert.equal(valid.opaque,true);assert.equal(valid.seal,true);assert.equal(valid.loading,true);
  const match=/<script id="keel-verification-envelope" type="application\/json">([^<]+)<\/script>/u.exec(result.html);
  assert.ok(match);const envelope=JSON.parse(match[1]);envelope.items[0].integrity.digest=`0x${'00'.repeat(32)}`;
  const tampered=result.html.replace(match[1],()=>JSON.stringify(envelope).replaceAll("<", "\\u003c"));
  const rejected=await observeOfflineShell(tampered,'failed');
  assert.equal(rejected.frames,0);assert.deepEqual(rejected.externalRequests,[]);assert.deepEqual(rejected.proxyRequests,[]);
  // The network observer must catch a real attempted request, not merely count
  // literal URLs. Fetch interception prevents this negative control leaving CI.
  const probe=await observeOfflineShell(result.html.replace(/<\/body><\/html>$/u,'<img src="https://blocked.invalid/offline-control"></body></html>'));
  assert.deepEqual(probe.externalRequests,['https://blocked.invalid/offline-control']);
  // Separate opaque renderer targets must be observed too, before execution.
  const frameHtml='<img src="https://blocked.invalid/frame-control" onerror="parent.postMessage({keelOfflineProbe:\'frame-blocked\'},\'*\')">';
  const frameProbe=await observeOfflineShell(`<!doctype html><body data-verification="verified"><iframe sandbox="allow-scripts" srcdoc="${frameHtml.replaceAll('"','&quot;')}"></iframe></body>`,'verified','frame-blocked');
  assert.deepEqual(frameProbe.errors,[]);
  assert.ok(frameProbe.externalRequests.includes('https://blocked.invalid/frame-control')||frameProbe.proxyRequests.includes('CONNECT blocked.invalid:443'),'The child-frame request must be observed and blocked');
});
