import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from '../packages/sdk/dist/registered-native-gzip.js';
import {launchCspBrowser} from './helpers/marketplace-csp-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('actual registered rev5 frame decodes and plays exact default-None normal MP4 with verification and no external artwork requests',{timeout:30_000},async()=>{
 const source=await readFile(new URL('./fixtures/registered-native-none/normal-artwork.mp4',import.meta.url));assert.equal(source.length,1786);assert.equal(sha(source),'a421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561');
 const fixture=JSON.parse(gunzipSync(await readFile(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
 const half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');assert.equal(bytes.length,p[side+'ByteLength']);assert.equal('0x'+sha(bytes),p[side+'Digest']);return{bytes,integrity:{algorithm:'sha256',digest:'0x'+sha(bytes),byteLength:bytes.length}}};
 const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')};
 const display=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:await readFile(new URL('./fixtures/asset-display-1.1.0.js',import.meta.url)),compression:'gzip',execution:'classic',phase:'render',weight:0});
 const root=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'artwork.mp4',mediaType:'video/mp4',source}});
 const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));
 Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
 createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});
 const server=createServer((_req,response)=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(root.rootBytes)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,binary=process.env.KEEL_CHROME_HEADLESS_SHELL??process.env.CHROMIUM_PATH;assert.ok(binary,'An installed Chromium is mandatory; no browser skip');
 const browser=await launchCspBrowser(binary,{fixtureMode:'dom-dump'}),contexts=new Map(),errors=[],external=[],tasks=[];
 browser.on(message=>{
  if(message.method==='Target.attachedToTarget'){const session=message.params.sessionId;tasks.push(Promise.all([browser.send('Runtime.enable',{},session),browser.send('Network.enable',{},session)]).catch(error=>errors.push(String(error))))}
  if(message.method==='Runtime.executionContextCreated'&&message.params.context.auxData?.isDefault)contexts.set(`${message.sessionId}:${message.params.context.id}`,{sessionId:message.sessionId,contextId:message.params.context.id});
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  if(message.method==='Network.requestWillBeSent'&&/^https?:/u.test(message.params.request.url)&&new URL(message.params.request.url).origin!==origin)external.push(message.params.request.url);
 });
 try{
  const{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  await Promise.all([browser.send('Runtime.enable',{},sessionId),browser.send('Network.enable',{},sessionId),browser.send('Page.enable',{},sessionId),browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId)]);
  const evaluate=async(expression,context)=>{const r=await browser.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,...(context?{contextId:context.contextId}:{})},context?.sessionId??sessionId);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value};
  await browser.send('Page.navigate',{url:origin},sessionId);let child;const deadline=Date.now()+12_000;
  while(Date.now()<deadline){for(const context of contexts.values()){try{if(await evaluate('typeof __KEEL_CONTENT__!=="undefined"&&!!document.querySelector("#keel-asset-display video")&&document.querySelector("video").readyState>=2',context)){child=context;break}}catch{}}
   if(child&&await evaluate('document.body.dataset.verification==="verified"'))break;if(errors.length)break;await delay(25);
  }
  assert.ok(child,'Actual native video must decode in the opaque verified child');assert.equal(await evaluate('document.body.dataset.verification'),'verified');assert.equal(await evaluate('!!document.querySelector("#verify-seal")'),true);
  assert.equal(await evaluate('[...document.querySelectorAll("iframe")].every(frame=>frame.sandbox.contains("allow-scripts")&&!frame.sandbox.contains("allow-same-origin"))'),true);
  const identity=await evaluate('(async()=>{const b=__KEEL_CONTENT__.bytes("artwork.mp4"),v=document.querySelector("video"),digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",b))].map(n=>n.toString(16).padStart(2,"0")).join("");return{digest,bytes:b.length,width:v.videoWidth,height:v.videoHeight,duration:v.duration,src:v.src}})()',child);
  assert.equal(identity.digest,sha(source));assert.equal(identity.bytes,source.length);assert.equal(identity.width,32);assert.equal(identity.height,24);assert.ok(identity.duration>0);assert.equal(identity.src,'data:video/mp4;base64,'+source.toString('base64'));
  const sample=async time=>evaluate(`(async()=>{const v=document.querySelector('video');v.pause();if(Math.abs(v.currentTime-${time})>0.000001)await new Promise((resolve,reject)=>{v.addEventListener('seeked',resolve,{once:true});v.addEventListener('error',reject,{once:true});v.currentTime=${time}});const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;const x=c.getContext('2d');x.drawImage(v,0,0);return [...x.getImageData(16,12,1,1).data]})()`,child);
  const first=await sample(0),second=await sample(Math.min(.4,identity.duration*.75));assert.notDeepEqual(first,second,'Native encoded video frames must change at their actual source times');
  await Promise.all(tasks);browser.assertHealthy();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  if(process.env.KEEL_NATIVE_NONE_BROWSER_EVIDENCE){await mkdir(process.env.KEEL_NATIVE_NONE_BROWSER_EVIDENCE,{recursive:true});await writeFile(process.env.KEEL_NATIVE_NONE_BROWSER_EVIDENCE+'/mp4.json',JSON.stringify({identity,documentBytes:root.rootBytes.length,documentSHA256:sha(root.rootBytes),samples:[first,second],errors,external,scope:'Actual local byte-authenticated retained registered rev5 frame and native MP4 decode/seek. No fresh chain authentication, live Studio, wallet or publication proof.'},null,2)+'\n')}
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
});
