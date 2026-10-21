// Replays the actual old module bytes; this is deliberately a reproduced failure.
// New synthetic fixtures only. No chain, wallet, production session or network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {launchCspBrowser} from '../../../tests/helpers/marketplace-csp-browser.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const moduleBytes=await readFile(new URL('./evidence/baseline-asset-display-1.2.0.js',import.meta.url));
assert.equal(moduleBytes.length,7810);assert.equal(sha(moduleBytes),'9db2505b726d6c0b9821ce2c90df96c4e37b6c1607fe4dd565f883b3531bed8b');
const binary=process.env.KEEL_CHROME_HEADLESS_SHELL??process.env.CHROMIUM_PATH;assert.ok(binary,'An installed Chromium is required');
const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><style>html,body,#keel-asset-display{width:100%;height:100%;margin:0}</style><main id="keel-asset-display"></main>')});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await launchCspBrowser(binary,{fixtureMode:'dom-dump'}),errors=[],external=[],results=[];
browser.on(message=>{if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url)&&new URL(message.params.request.url).origin!==origin)external.push(message.params.request.url)});
try{
 for(const format of ['webp','avif']){
  const bytes=await readFile(new URL(`../../../tests/fixtures/media-viewers/animation.${format}`,import.meta.url));
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  await Promise.all([browser.send('Page.enable',{},sessionId),browser.send('Runtime.enable',{},sessionId),browser.send('Network.enable',{},sessionId)]);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:256,height:256,deviceScaleFactor:1,mobile:false},sessionId);await browser.send('Page.navigate',{url:origin},sessionId);
  const evaluate=async expression=>{const result=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value};
  while(!await evaluate('document.readyState==="complete"'))await new Promise(resolve=>setTimeout(resolve,10));
  const input={format,source:bytes.toString('base64')};
  const decoded=await evaluate(`(async()=>{const {format,source}=${JSON.stringify(input)},bytes=Uint8Array.from(atob(source),x=>x.charCodeAt(0)),decoder=new ImageDecoder({data:bytes,type:'image/'+format});await decoder.tracks.ready;const track=decoder.tracks.selectedTrack,frames=[];for(let frameIndex=0;frameIndex<track.frameCount;frameIndex++){const {image}=await decoder.decode({frameIndex}),c=document.createElement('canvas');c.width=image.displayWidth;c.height=image.displayHeight;const x=c.getContext('2d');x.drawImage(image,0,0);frames.push({duration:image.duration,center:[...x.getImageData(8,8,1,1).data]});image.close()}decoder.close();return{frameCount:track.frameCount,repetitionCount:String(track.repetitionCount),frames}})()`);
  assert.ok(decoded.frameCount>=3);assert.equal(new Set(decoded.frames.map(f=>f.center.slice(0,3).join(','))).size,3);
  await evaluate(`(()=>{const {format,source}=${JSON.stringify(input)},bytes=Uint8Array.from(atob(source),x=>x.charCodeAt(0));Object.defineProperty(globalThis,'__KEEL_ENTRY__',{value:Object.freeze({id:'original-artwork',mediaType:'image/'+format,url:'data:image/'+format+';base64,'+source})});Object.defineProperty(globalThis,'__KEEL_CONTENT__',{value:Object.freeze({bytes:id=>{if(id!=='original-artwork')throw Error('undeclared fixture resource');return bytes.slice()}})});})()`);
  await evaluate(new TextDecoder().decode(moduleBytes));
  const deadline=Date.now()+5000;while(!await evaluate('!!document.querySelector("#keel-asset-display canvas")')){assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10))}
  const screenshots=[];for(const delay of [0,160,300,400]){if(delay)await new Promise(resolve=>setTimeout(resolve,delay));const png=await browser.send('Page.captureScreenshot',{format:'png'},sessionId);screenshots.push(sha(Buffer.from(png.data,'base64')))}
  assert.equal(new Set(screenshots).size,1,'the old module freezes despite distinct encoded frames');
  results.push({format,source:{bytes:bytes.length,sha256:sha(bytes)},decoded,renderedElement:'canvas',elapsedSampleMs:[0,160,460,860],screenshotSHA256:screenshots,verdict:'REPRODUCED_FAIL',scope:'exact baseline module, genuine synthetic animation, module-only Chromium; not private GIF or registered/deployed proof'});
  await browser.send('Target.closeTarget',{targetId});
 }
 browser.assertHealthy();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
const report={commit:'7730e3150b7ec6da69913a779273fdb981d7fff3',module:{bytes:moduleBytes.length,sha256:sha(moduleBytes)},environment:{node:process.version,chromium:binary},results};
if(process.env.KEEL_MEDIA_BASELINE_REPORT)await writeFile(process.env.KEEL_MEDIA_BASELINE_REPORT,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
