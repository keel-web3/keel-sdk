import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {launchCspBrowser} from './helpers/marketplace-csp-browser.mjs';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument,buildKeelInlineLocalDocument,buildKeelInlineModuleFragment} from '../packages/sdk/dist/inline-viewer-graph.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
const fixtureRoot=new URL('./fixtures/media-viewers/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureRoot),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function original(name){const bytes=await readFile(new URL(name,fixtureRoot)),identity=manifest.files.find(f=>f.path===name);assert.ok(identity);assert.equal(bytes.length,identity.bytes);assert.equal(sha(bytes),identity.sha256);return bytes;}
async function mounted(html,run){
 const binary=process.env.KEEL_CHROME_HEADLESS_SHELL??process.env.CHROMIUM_PATH;assert.ok(binary,'Set the installed Chromium path; this browser gate does not skip');
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`,browser=await launchCspBrowser(binary,{fixtureMode:'dom-dump'}),contexts=new Map(),errors=[],requests=[],tasks=[];
 browser.on(message=>{
  if(message.method==='Target.attachedToTarget'){const id=message.params.sessionId;tasks.push(Promise.all([browser.send('Runtime.enable',{},id),browser.send('Network.enable',{},id)]).catch(error=>errors.push(String(error))));}
  if(message.method==='Runtime.executionContextCreated'&&message.params.context.auxData?.isDefault)contexts.set(`${message.sessionId}:${message.params.context.id}`,{sessionId:message.sessionId,contextId:message.params.context.id});
  if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
  if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url)&&new URL(message.params.request.url).origin!==origin)requests.push(message.params.request.url);
 });
 try{
  const{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  await Promise.all([browser.send('Runtime.enable',{},sessionId),browser.send('Page.enable',{},sessionId),browser.send('Network.enable',{},sessionId),browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId)]);
  await browser.send('Emulation.setDeviceMetricsOverride',{width:256,height:256,deviceScaleFactor:1,mobile:false},sessionId);await browser.send('Page.navigate',{url:origin},sessionId);
  const evaluate=async(expression,context)=>{const reply=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(context?{contextId:context.contextId}:{})},context?.sessionId??sessionId);if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description??reply.exceptionDetails.text);return reply.result.value;};
  let child;const deadline=Date.now()+15000;
  while(Date.now()<deadline){for(const context of contexts.values()){try{if(await evaluate('typeof __KEEL_ENTRY__!=="undefined"&&!!document.querySelector("#keel-asset-display > img,#keel-asset-display > canvas")',context)){child=context;break}}catch{}}if(child&&await evaluate('document.body.dataset.verification===\"verified\"&&document.querySelector(\"#keel-status\").hidden'))break;await delay(25)}
  assert.ok(child,'the complete canonical shell must mount its verified original media');assert.equal(await evaluate('document.body.dataset.verification'),'verified');assert.equal(await evaluate('!!document.querySelector("#verify-seal")'),true);
  const childEvaluate=expression=>evaluate(expression,child);
  await run({evaluate,childEvaluate,capture:async()=>{
   const parent=await evaluate('(()=>{const r=document.querySelector("iframe[title=\\"Verified KEEL work\\"]").getBoundingClientRect();return{x:r.x,y:r.y}})()');
   const rect=await childEvaluate('(()=>{const r=document.querySelector("#keel-asset-display > img,#keel-asset-display > canvas").getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()');
   const png=Buffer.from((await browser.send('Page.captureScreenshot',{format:'png',clip:{x:parent.x+rect.x,y:parent.y+rect.y,width:rect.width,height:rect.height,scale:1}},sessionId)).data,'base64');
   const{data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});const center=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*4;return{sha256:sha(png),rgba:[...data.subarray(0,4)],centerRGBA:[...data.subarray(center,center+4)],width:info.width,height:info.height};
  }});await Promise.all(tasks);browser.assertHealthy();assert.deepEqual(errors,[]);assert.deepEqual(requests,[],'the actual shell and renderer must not fetch external dependencies');
 }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
for(const format of ['webp','avif'])test(`canonical shell preserves every distinct native ${format} animation color and looping`,{timeout:30000},async()=>{
 const bytes=await original(`animation.${format}`),shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'original-artwork',mediaType:`image/${format}`,source:bytes}});
 assert.equal(document.parts.filter(p=>p.kind==='creator').length,1);const samples=[];
 await mounted(new TextDecoder().decode(document.rootBytes),async({childEvaluate,capture})=>{
  assert.equal(await childEvaluate('document.querySelector("#keel-asset-display").firstElementChild.tagName'),'IMG');assert.equal(await childEvaluate('document.querySelector("#keel-asset-display img").src'),`data:image/${format};base64,${bytes.toString('base64')}`);
  const background=await childEvaluate('getComputedStyle(document.querySelector("#keel-asset-display img")).backgroundColor');const backgroundRGB=background.match(/\d+/g).slice(0,3).map(Number);
  const start=Date.now();while(Date.now()-start<1800){samples.push({elapsedMs:Date.now()-start,...await capture()});await delay(20)}
  for(const sample of samples){const alpha=format==='webp'?96:255;const expected=sample.rgba.slice(0,3).map((channel,index)=>Math.round(channel*alpha/255+backgroundRGB[index]*(255-alpha)/255));assert.deepEqual(sample.centerRGBA,[...expected,255],'native alpha compositing must preserve the exact source center alpha');}
  const colors=samples.map(p=>p.rgba.slice(0,3).join(',')),distinct=[...new Set(colors)];assert.deepEqual(distinct.slice().sort(),['0,0,255','0,255,0','255,0,0'].sort(),'actual displayed pixels must include all three exact encoded colors');
  const transitions=colors.filter((value,index)=>index===0||value!==colors[index-1]);assert.ok(transitions.join(';').includes('255,0,0;0,0,255;0,255,0;255,0,0'),'complete native sequence must return to its first frame after the last frame');
 });
 if(process.env.KEEL_MEDIA_VIEWER_EVIDENCE_DIR){await mkdir(process.env.KEEL_MEDIA_VIEWER_EVIDENCE_DIR,{recursive:true});await writeFile(`${process.env.KEEL_MEDIA_VIEWER_EVIDENCE_DIR}/native-${format}.json`,JSON.stringify({input:manifest.files.find(f=>f.path===`animation.${format}`),moduleDocumentBytes:document.byteLength,samples,scope:'actual canonical local shell; no selected-chain registration or deployed claim'},null,2)+'\n')}
 assert.equal(sha(await original(`animation.${format}`)),sha(bytes));
});
for(const format of ['webp','avif'])test(`canonical still ${format} retains original PNG-export canvas and exact source commitment`,{timeout:30000},async()=>{
 const bytes=await original(`still.${format}`),shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'original-artwork',mediaType:`image/${format}`,source:bytes}});
 await mounted(new TextDecoder().decode(document.rootBytes),async({childEvaluate,capture})=>{
  assert.equal(await childEvaluate('document.querySelector("#keel-asset-display").firstElementChild.tagName'),'CANVAS');
  assert.deepEqual(await childEvaluate('(()=>{const c=document.querySelector("#keel-asset-display canvas");return{title:c.title,width:c.width,height:c.height,pixel:[...c.getContext("2d").getImageData(8,8,1,1).data],png:c.toDataURL().startsWith("data:image/png;base64,")}})()'),{title:'Right-click to save this verified image as PNG',width:16,height:16,pixel:[255,0,0,format==='webp'?96:255],png:true});
  const first=await capture();await delay(200);assert.equal((await capture()).sha256,first.sha256);
 });assert.equal(sha(await original(`still.${format}`)),sha(bytes));
});

for(const version of ['1.1.0','1.3.0','1.4.0'])test(`canonical GIF motion remains native with exact catalog module profile ${version}`,{timeout:30000},async()=>{
 const source=await original('animation.gif'),shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});
 const decoded=version!=='1.4.0'?new Uint8Array(await readFile(new URL(`./fixtures/asset-display-${version}.js`,import.meta.url))):new Uint8Array(await import('../packages/sdk/dist/asset-display.js').then(m=>m.keelAssetDisplayModuleBytes()));
 const display=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version,mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:decoded,compression:'none',execution:'classic',phase:'render'});
 const document=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'original-artwork',mediaType:'image/gif',source}});
 await mounted(new TextDecoder().decode(document.rootBytes),async({childEvaluate,capture})=>{
  assert.equal(await childEvaluate('document.querySelector("#keel-asset-display").firstElementChild.tagName'),'IMG');assert.equal(await childEvaluate('document.querySelector("#keel-asset-display img").src'),`data:image/gif;base64,${source.toString('base64')}`);
  const colors=[],start=Date.now();while(Date.now()-start<1800){colors.push((await capture()).rgba.slice(0,3).join(','));await delay(20)}
  assert.deepEqual([...new Set(colors)].sort(),['0,0,255','0,255,0','255,0,0'].sort());const transitions=colors.filter((value,index)=>index===0||value!==colors[index-1]);assert.ok(transitions.join(';').includes('255,0,0;0,0,255;0,255,0;255,0,0'));
 });assert.equal(sha(await original('animation.gif')),sha(source));
});
