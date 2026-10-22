import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {launchCspBrowser} from './marketplace-csp-browser.mjs';
const require=createRequire(new URL('../../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
export const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** Actual canonical shell + sandboxed child through installed Chromium/CDP. */
export async function withNativeMediaBrowser(document,run){
  const binary=process.env.KEEL_CHROME_HEADLESS_SHELL??process.env.CHROMIUM_PATH;
  assert.ok(binary,'Installed Chromium is required; native decode/playback evidence never skips');
  const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(document.rootBytes)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,browser=await launchCspBrowser(binary,{fixtureMode:'dom-dump'}),contexts=new Map(),errors=[],external=[],failed=[],tasks=[];
  browser.on(message=>{
    if(message.method==='Target.attachedToTarget'){const id=message.params.sessionId;tasks.push(Promise.all([browser.send('Runtime.enable',{},id),browser.send('Network.enable',{},id)]).catch(error=>errors.push(String(error))))}
    if(message.method==='Runtime.executionContextCreated'&&message.params.context.auxData?.isDefault)contexts.set(`${message.sessionId}:${message.params.context.id}`,{sessionId:message.sessionId,contextId:message.params.context.id});
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')errors.push(message.params.args.map(a=>a.value??a.description).join(' '));
    if(message.method==='Network.loadingFailed')failed.push(message.params.errorText);
    if(message.method==='Network.requestWillBeSent'&&/^https?:/.test(message.params.request.url)&&new URL(message.params.request.url).origin!==origin)external.push(message.params.request.url);
  });
  try{
    const{targetId}=await browser.send('Target.createTarget',{url:'about:blank'}),{sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
    await Promise.all([browser.send('Runtime.enable',{},sessionId),browser.send('Page.enable',{},sessionId),browser.send('Network.enable',{},sessionId),browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId)]);
    await browser.send('Emulation.setDeviceMetricsOverride',{width:400,height:400,deviceScaleFactor:1,mobile:false},sessionId);await browser.send('Page.navigate',{url:origin},sessionId);
    const evaluate=async(expression,context)=>{const reply=await browser.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(context?{contextId:context.contextId}:{})},context?.sessionId??sessionId);if(reply.exceptionDetails)throw Error(reply.exceptionDetails.exception?.description??reply.exceptionDetails.text);return reply.result.value};
    let child;const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      if(errors.length)throw Error(errors.join('\n'));
      for(const context of contexts.values()){try{if(await evaluate('typeof __KEEL_ENTRY__!=="undefined"&&!!document.querySelector("#keel-asset-display img,#keel-asset-display audio")',context)){child=context;break}}catch{}}
      if(child&&await evaluate('document.body.dataset.verification==="verified"&&document.querySelector("#keel-status").hidden'))break;
      await wait(20);
    }
    assert.ok(child,'The actual canonical sandbox must mount the exact native media');assert.equal(await evaluate('document.body.dataset.verification'),'verified');assert.equal(await evaluate('!!document.querySelector("#verify-seal")'),true);
    const childEvaluate=expression=>evaluate(expression,child),rect=async selector=>{
      const parent=await evaluate('(()=>{const r=document.querySelector("iframe[title=\\"Verified KEEL work\\"]").getBoundingClientRect();return{x:r.x,y:r.y}})()');
      const target=await childEvaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
      return{x:parent.x+target.x,y:parent.y+target.y,width:target.width,height:target.height};
    };
    const result=await run({evaluate,childEvaluate,capture:async selector=>{
      const clip=await rect(selector),png=Buffer.from((await browser.send('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1}},sessionId)).data,'base64');
      const{data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}),center=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*4;
      return{centerRGBA:[...data.subarray(center,center+4)],width:info.width,height:info.height};
    },clickNativeAudioPlay:async()=>{
      const r=await rect('audio'),x=r.x+22,y=r.y+r.height/2;
      await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1},sessionId);await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1},sessionId);
    }});
    await Promise.all(tasks);browser.assertHealthy();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(failed,[]);assert.equal(await evaluate('document.body.dataset.verification'),'verified');return{...result,consoleErrors:errors,externalRequests:external,failedRequests:failed};
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
}
