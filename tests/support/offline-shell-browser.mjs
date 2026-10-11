import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';

export function pageRequestsFromNetLog(log,origin) {
  const type=log.constants?.logEventTypes?.URL_REQUEST_START_JOB;
  assert.equal(typeof type,'number','Chromium must supply the network event schema');
  return log.events.filter(event=>event.type===type&&typeof event.params?.url==='string')
    .map(event=>event.params)
    .filter(params=>/^https?:/u.test(params.url)&&new URL(params.url).origin!==origin&&params.initiator!=='not an origin')
    .map(params=>params.url);
}

/** Isolated browser, loopback fixture only. External page requests are blocked
 * before transmission and recorded, so a negative control tests the observer. */
export async function observeOfflineShell(html, terminalState='verified', expectedSignal) {
  let binary;
  for (const candidate of [process.env.KEEL_CHROME_HEADLESS_SHELL,process.env.CHROMIUM_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean)) {
    if(await stat(candidate).then(s=>s.isFile(),()=>false)){binary=candidate;break;}
  }
  assert.ok(binary,'An installed Chromium is required; this check must not skip');
  const profile=await mkdtemp(path.join(tmpdir(),'keel-offline-shell-'));
  const server=createServer((_request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');response.end(html);});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  // A deny-only loopback proxy covers every renderer, including requests
  // started before a child target's CDP interception can be installed.
  const proxyRequests=[];
  const proxy=createServer((request,response)=>{proxyRequests.push(request.url);response.writeHead(502);response.end();});
  proxy.on('connect',(request,socket)=>{proxyRequests.push(`CONNECT ${request.url}`);socket.end('HTTP/1.1 502 Blocked\r\nConnection: close\r\n\r\n');});
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  // Browser services use the default network context, separate from the
  // artwork's isolated context below. Block those without filtering domains
  // out of the artwork observer or relying on startup timing.
  const browserProxy=createServer((_request,response)=>{response.writeHead(502);response.end();});
  browserProxy.on('connect',(_request,socket)=>socket.end('HTTP/1.1 502 Blocked\r\nConnection: close\r\n\r\n'));
  browserProxy.listen(0,'127.0.0.1');await once(browserProxy,'listening');
  const netlogPath=path.join(profile,'network.json');
  const child=spawn(binary,['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--disable-domain-reliability','--disable-sync','--disable-default-apps','--disable-extensions','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',`--proxy-server=http://127.0.0.1:${browserProxy.address().port}`,'--remote-debugging-port=0',`--log-net-log=${netlogPath}`,`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let socket,sequence=0;const pending=new Map(),attempts=[],errors=[];
  try {
    const endpoint=await new Promise((resolve,reject)=>{
      let stderr='';const timer=setTimeout(()=>reject(new Error('Chromium debugging endpoint timed out')),10000);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.stderr.on('data',chunk=>{stderr+=chunk.toString();const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/u.exec(stderr);if(match){clearTimeout(timer);resolve(match[1]);}});
      child.on('exit',code=>{clearTimeout(timer);reject(new Error(`Chromium exited before qualification: ${code}`));});
    });
    socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
      const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out`));},10000);
      pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
      socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
    });
    const observeTarget=async sessionId=>{
      await command('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]},sessionId);
      await command('Runtime.enable',{},sessionId);
      // Opaque artwork frames may run in a separate renderer. Install
      // interception on every child and request paused startup for new targets.
      await command('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},sessionId);
      await command('Runtime.runIfWaitingForDebugger',{},sessionId);
    };
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request?.reject(new Error(message.error.message)):request?.resolve(message.result);return;}
      if(message.method==='Target.attachedToTarget'&&message.sessionId){
        void observeTarget(message.params.sessionId).catch(error=>errors.push(error.message));
      }
      if(message.method==='Fetch.requestPaused'){
        const {requestId,request}=message.params;
        const allowed=new URL(request.url).origin===origin;
        if(!allowed)attempts.push(request.url);
        void command(allowed?'Fetch.continueRequest':'Fetch.failRequest',{requestId,...(allowed?{}:{errorReason:'BlockedByClient'})},message.sessionId).catch(error=>errors.push(error.message));
      }
      if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    });
    const {browserContextId}=await command('Target.createBrowserContext',{disposeOnDetach:true,proxyServer:`http://127.0.0.1:${proxy.address().port}`});
    const {targetId}=await command('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await command('Target.attachToTarget',{targetId,flatten:true});
    await command('Page.enable',{},sessionId);await observeTarget(sessionId);
    await command('Page.addScriptToEvaluateOnNewDocument',{source:'window.__keelOfflineSignals=[];window.addEventListener("message",event=>{if(event.data?.keelOfflineProbe)window.__keelOfflineSignals.push(event.data.keelOfflineProbe);});'},sessionId);
    await command('Page.navigate',{url:origin},sessionId);
    const expression=`({state:document.body?.dataset.verification,signals:window.__keelOfflineSignals,frames:document.querySelectorAll('iframe').length,loading:!!document.querySelector('#keel-status'),seal:!!document.querySelector('#verify-seal'),opaque:[...document.querySelectorAll('iframe')].every(f=>f.sandbox.contains('allow-scripts')&&!f.sandbox.contains('allow-same-origin'))})`;
    let result;
    const deadline=Date.now()+15000;
    do {
      result=(await command('Runtime.evaluate',{expression,returnByValue:true},sessionId)).result.value;
      if(result?.state===terminalState&&(!expectedSignal||result.signals?.includes(expectedSignal)))break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<deadline);
    assert.equal(result?.state,terminalState,'The complete shell must reach the expected verification outcome');
    if(expectedSignal)assert.ok(result.signals?.includes(expectedSignal),'The mounted artwork must execute its committed module');
    await new Promise(resolve=>setTimeout(resolve,100));
    const observedErrors=[...errors];
    const exited=once(child,'exit');
    await command('Browser.close');
    await exited;
    const netlog=JSON.parse(await readFile(netlogPath,'utf8'));
    return {...result,externalRequests:attempts,proxyRequests,pageNetworkRequests:pageRequestsFromNetLog(netlog,origin),errors:observedErrors};
  }finally{
    for(const request of pending.values())request.reject(new Error('Browser qualification closed'));
    socket?.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit').catch(()=>{});}
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));
    browserProxy.closeAllConnections();await new Promise(resolve=>browserProxy.close(resolve));
    await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
