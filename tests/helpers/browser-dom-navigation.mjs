import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {launchCspBrowser} from './marketplace-csp-browser.mjs';

const identity=value=>({sha256:createHash('sha256').update(value,'utf8').digest('hex'),utf8Bytes:Buffer.byteLength(value,'utf8')});

/** Same browser navigation and virtual-time budget as --dump-dom, without
 * placing a multi-MB data URI in a Linux process argument (MAX_ARG_STRLEN).
 * No file/HTTP replacement, decoding, URI normalization or policy fallback. */
export async function dumpBrowserDom(binary,url,{virtualTimeBudgetMs,fixtureMode='dom-dump'}={}) {
  assert.equal(typeof url,'string');
  assert.ok(virtualTimeBudgetMs===2500||virtualTimeBudgetMs===5000,'Retain the original fixture virtual-time budget');
  assert.ok(fixtureMode==='dom-dump'||fixtureMode==='link-dom-dump');
  const requested=identity(url),deadline=Date.now()+20_000;
  const browser=await launchCspBrowser(binary,{fixtureMode});
  const errors=[],events=[],tasks=new Set();
  let observationError;
  try {
    const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
    let resolveBudget,resolveLoaded,observedUrl;
    const budgetExpired=new Promise(resolve=>{resolveBudget=resolve;});
    const loaded=new Promise(resolve=>{resolveLoaded=resolve;});
    browser.on(message=>{
      const {method,params,sessionId:source}=message;
      if(method==='Emulation.virtualTimeBudgetExpired'&&source===sessionId)resolveBudget();
      if(method==='Page.loadEventFired'&&source===sessionId)resolveLoaded();
      if(method==='Page.frameNavigated'&&source===sessionId&&params.frame.parentId===undefined)observedUrl=params.frame.url;
      if(method==='Runtime.exceptionThrown')errors.push('Uncaught '+(params.exceptionDetails.exception?.description??params.exceptionDetails.text));
      if(method==='Log.entryAdded')errors.push(params.entry.text);
      if(method==='Target.attachedToTarget') {
        const child=params.sessionId;
        const task=Promise.all([
          browser.send('Runtime.enable',{},child),browser.send('Log.enable',{},child),
          browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},child),
        ]).catch(error=>{errors.push(String(error));events.push({kind:'instrumentation',error:String(error)});});
        tasks.add(task);void task.finally(()=>tasks.delete(task));
      }
    });
    await Promise.all([
      browser.send('Page.enable',{},sessionId),browser.send('Runtime.enable',{},sessionId),browser.send('Log.enable',{},sessionId),
      browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId),
    ]);
    const beforeDeadline=async operation=>{
      let timer;
      try {await Promise.race([operation,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Browser timed out')),Math.max(1,deadline-Date.now()));
      })]);}finally{clearTimeout(timer);}
    };
    // Start the original virtual-time budget only after navigation has loaded
    // its document; a pre-navigation budget can expire on the blank document.
    const navigation=await browser.send('Page.navigate',{url},sessionId);
    if(navigation.errorText)throw new Error(`Browser navigation failed: ${navigation.errorText}`);
    await beforeDeadline(loaded);
    await browser.send('Emulation.setVirtualTimePolicy',{policy:'pauseIfNetworkFetchesPending',budget:virtualTimeBudgetMs},sessionId);
    await beforeDeadline(budgetExpired);
    const snapshot=await browser.send('Runtime.evaluate',{expression:'(document.doctype?new XMLSerializer().serializeToString(document.doctype)+"\\n":"")+document.documentElement.outerHTML',returnByValue:true},sessionId);
    if(snapshot.exceptionDetails)throw new Error('Browser DOM snapshot failed: '+(snapshot.exceptionDetails.exception?.description??snapshot.exceptionDetails.text));
    await Promise.all([...tasks]);browser.assertHealthy();
    assert.deepEqual(events,[],'Every child target must be observed');
    if(url.startsWith('data:'))assert.equal(observedUrl,url,'Chrome must navigate the exact original data URI');
    const result={stdout:snapshot.result.value,stderr:errors.join('\n'),navigation:{transport:'cdp',argvDocument:'about:blank',requested,observed:identity(observedUrl??''),virtualTimeBudgetMs,fixtureMode}};
    if(process.env.KEEL_BROWSER_NAVIGATION_EVIDENCE) {
      const {appendFile}=await import('node:fs/promises');
      await appendFile(process.env.KEEL_BROWSER_NAVIGATION_EVIDENCE,JSON.stringify(result.navigation)+'\n');
    }
    return result;
  } catch(error) {observationError=error;throw error;}
  finally {
    try {await browser.close();}catch(cleanupError) {
      if(observationError)throw new AggregateError([observationError,cleanupError],'Browser observation and cleanup failed');
      throw cleanupError;
    }
  }
}
