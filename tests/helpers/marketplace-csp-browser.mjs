// Observe the complete original 4,000ms window, including after art readiness.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const STARTUP_MS=10_000;
const COMMAND_MS=1_000;
const CLEANUP_MS=2_000;
const OBSERVATION_MS=4_000;

function bounded(operation,ms,label) {
  let timer;
  return Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)),ms);
  })]).finally(()=>clearTimeout(timer));
}

/** Test-harness CDP session. Exported to exercise timeout/disconnect handling. */
export function createCspCdpSession(socket,{commandTimeoutMs=COMMAND_MS}={}) {
  if(!Number.isSafeInteger(commandTimeoutMs)||commandTimeoutMs<1||commandTimeoutMs>COMMAND_MS) {
    throw new TypeError('CDP command timeout must be positive and at most 1000ms');
  }
  let sequence=0,failure,disposed=false;
  const pending=new Map(),listeners=new Set();
  const fail=error=>{
    failure??=error;
    for(const entry of pending.values()) {clearTimeout(entry.timer);entry.reject(failure);}
    pending.clear();
  };
  const onMessage=({data})=>{
    let message;
    try {message=JSON.parse(data);}catch {fail(new Error('Malformed CDP message'));return;}
    if(message===null||typeof message!=='object'||Array.isArray(message)) {fail(new Error('Malformed CDP message'));return;}
    if(message.id!==undefined) {
      const entry=pending.get(message.id);
      // A timed-out command may still receive a late reply. It has no authority.
      if(!entry)return;
      pending.delete(message.id);clearTimeout(entry.timer);
      if(message.error)entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    for(const listener of listeners) {
      try {listener(message);}catch(error) {fail(error instanceof Error?error:new Error(String(error)));}
    }
  };
  const onClose=()=>{if(!disposed)fail(new Error('Chrome CDP socket closed during observation'));};
  const onError=()=>{if(!disposed)fail(new Error('Chrome CDP socket failed during observation'));};
  socket.addEventListener('message',onMessage);
  socket.addEventListener('close',onClose);
  socket.addEventListener('error',onError);
  if(typeof socket.readyState==='number'&&socket.readyState!==1)fail(new Error('Chrome CDP socket is not open'));
  return {
    send(method,params={},sessionId) {
      if(failure)return Promise.reject(failure);
      if(disposed)return Promise.reject(new Error('CDP session is closed'));
      return new Promise((resolve,reject)=>{
        const id=++sequence;
        const timer=setTimeout(()=>{
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out after ${commandTimeoutMs}ms`));
        },commandTimeoutMs);
        pending.set(id,{method,resolve,reject,timer});
        try {socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));}
        catch(error) {fail(error instanceof Error?error:new Error(String(error)));}
      });
    },
    on(listener) {listeners.add(listener);},
    assertHealthy() {if(failure)throw failure;},
    dispose() {
      if(disposed)return;
      disposed=true;fail(new Error('CDP session closed'));
      socket.removeEventListener('message',onMessage);
      socket.removeEventListener('close',onClose);
      socket.removeEventListener('error',onError);
      listeners.clear();
    },
  };
}

function readEndpoint(child) {
  return new Promise((resolve,reject)=>{
    let stderr='',settled=false;
    const finish=(error,value)=>{
      if(settled)return;settled=true;
      clearTimeout(timer);
      child.stderr.removeListener('data',onData);
      child.removeListener('error',onError);
      child.removeListener('exit',onExit);
      error?reject(error):resolve(value);
    };
    const onData=chunk=>{
      stderr=(stderr+chunk).slice(-16_384);
      const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/u.exec(stderr);
      if(match)finish(undefined,match[1]);
    };
    const onError=error=>finish(error);
    const onExit=(code,signal)=>finish(new Error(`Chrome exited before DevTools (code ${code}, signal ${signal}): ${stderr}`));
    const timer=setTimeout(()=>finish(new Error(`Chrome DevTools startup timed out after ${STARTUP_MS}ms: ${stderr}`)),STARTUP_MS);
    child.stderr.setEncoding('utf8');child.stderr.on('data',onData);
    child.once('error',onError);child.once('exit',onExit);
    if(child.exitCode!==null||child.signalCode!==null)onExit(child.exitCode,child.signalCode);
  });
}

async function connectSocket(endpoint) {
  const socket=new WebSocket(endpoint);
  try {
    await bounded(new Promise((resolve,reject)=>{
      const cleanup=()=>{
        socket.removeEventListener('open',onOpen);
        socket.removeEventListener('error',onError);
        socket.removeEventListener('close',onClose);
      };
      const onOpen=()=>{cleanup();resolve();};
      const onError=()=>{cleanup();reject(new Error('Chrome CDP connection failed'));};
      const onClose=()=>{cleanup();reject(new Error('Chrome CDP closed before connection'));};
      socket.addEventListener('open',onOpen,{once:true});
      socket.addEventListener('error',onError,{once:true});
      socket.addEventListener('close',onClose,{once:true});
    }),COMMAND_MS,'Chrome CDP connection');
    return socket;
  } catch(error) {socket.close();throw error;}
}

/** Startup failures and observation failures use the same owned-child cleanup. */
export async function launchCspBrowser(binary) {
  const profile=await mkdtemp(join(tmpdir(),'keel-marketplace-csp-'));
  let child,socket,session,exitPromise,closePromise,childError;
  const close=()=>closePromise??=(async()=>{
    let closeError;
    // Let Chrome shut down its own renderer/cache writers before removing the
    // profile. A failed protocol close remains a failure, even after cleanup.
    if(session) {
      try {await session.send('Browser.close');}
      catch(error) {
        if(!/Chrome CDP socket closed during observation/u.test(String(error)))closeError=error;
      }
    }
    session?.dispose();socket?.close();
    try {
      if(child?.pid!==undefined) {
        if(!session||closeError) {
          if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
        }
        try {await bounded(exitPromise,CLEANUP_MS,'Owned Chrome exit');}
        catch(error) {
          if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
          await bounded(exitPromise,CLEANUP_MS,'Forced owned Chrome exit');
          throw error;
        }
      }
    } finally {await bounded(rm(profile,{recursive:true,force:true}),CLEANUP_MS,'Owned Chrome profile cleanup');}
    if(closeError)throw closeError;
  })();
  try {
    child=spawn(binary,['--headless','--mute-audio','--autoplay-policy=document-user-activation-required','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
    // Attach before any await or kill, so an early exit cannot race cleanup.
    exitPromise=new Promise(resolve=>child.once('exit',resolve));
    child.on('error',error=>{childError=error;});
    const endpoint=await readEndpoint(child);
    socket=await connectSocket(endpoint);
    session=createCspCdpSession(socket);
    return {...session,profile,close,assertHealthy(){session.assertHealthy();if(childError)throw childError;}};
  } catch(error) {
    try {await close();}catch(cleanupError) {throw new AggregateError([error,cleanupError],'Chrome startup and cleanup failed');}
    throw error;
  }
}

export async function observeMarketplaceCsp(binary,url,protocol) {
  const browser=await launchCspBrowser(binary),events=[],requests=[],contexts=new Map();
  const instrumentation=new Set();
  browser.on(({method,params,sessionId})=>{
    if(method==='Target.attachedToTarget') {
      const child=params.sessionId;
      const task=Promise.all([
        browser.send('Runtime.enable',{},child),browser.send('Log.enable',{},child),
        browser.send('Network.enable',{},child),
        browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},child),
      ]).catch(error=>events.push({kind:'instrumentation',text:String(error)}));
      instrumentation.add(task);void task.finally(()=>instrumentation.delete(task));
    }
    if(method==='Runtime.executionContextCreated')contexts.set(`${sessionId}:${params.context.id}`,{sessionId,contextId:params.context.id});
    if(method==='Runtime.executionContextDestroyed')contexts.delete(`${sessionId}:${params.executionContextId}`);
    if(method==='Runtime.exceptionThrown')events.push({kind:'exception',text:params.exceptionDetails.exception?.description??params.exceptionDetails.text});
    if(method==='Log.entryAdded')events.push({kind:params.entry.source,level:params.entry.level,text:params.entry.text});
    if(method==='Network.requestWillBeSent')requests.push(params.request.url);
  });
  let observationError;
  try {
    const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
    await Promise.all([
      browser.send('Runtime.enable',{},sessionId),browser.send('Log.enable',{},sessionId),
      browser.send('Page.enable',{},sessionId),browser.send('Network.enable',{},sessionId),
      browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId),
    ]);
    const started=Date.now(),deadline=started+OBSERVATION_MS;
    await browser.send('Page.navigate',{url},sessionId);
    let state,readinessAtMs;
    // Readiness is evidence, not permission to stop observing later errors.
    do {
      browser.assertHealthy();
      const result=await browser.send('Runtime.evaluate',{expression:'JSON.stringify({state:document.querySelector("#result")?.dataset.state,text:document.querySelector("#result")?.textContent,protocol:document.querySelector("#result")?.dataset.protocol})',returnByValue:true},sessionId);
      if(typeof result.result?.value==='string')state=JSON.parse(result.result.value);
      if(state?.state==='passed'&&readinessAtMs===undefined)readinessAtMs=Date.now()-started;
      const remaining=deadline-Date.now();
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.min(25,remaining)));
    } while(Date.now()<deadline);
    const snapshot=await browser.send('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true},sessionId);
    const frames=[];
    for(const context of contexts.values()) {
      try {
        const result=await browser.send('Runtime.evaluate',{expression:'JSON.stringify({origin:location.origin,html:document.documentElement.tagName,sandbox:frameElement?.getAttribute("sandbox")??null,image:(()=>{const image=document.querySelector("#keel-asset-display img");return image?{complete:image.complete,width:image.naturalWidth,height:image.naturalHeight}:null})()})',contextId:context.contextId,returnByValue:true},context.sessionId);
        if(typeof result.result?.value==='string')frames.push(JSON.parse(result.result.value));
      } catch(error) {
        // Navigation may destroy a previously observed context. Other command
        // errors (timeout/disconnect/malformed responses) must fail the observer.
        if(!/Cannot find context with specified id|Execution context was destroyed/u.test(String(error)))throw error;
      }
    }
    await Promise.all([...instrumentation]);browser.assertHealthy();
    const stderr=events.filter(event=>event.kind==='exception'||event.kind==='security').map(event=>event.text).join('\n');
    return {stdout:snapshot.result.value,stderr,events,requests,frames,state,protocol,observedMs:Date.now()-started,readinessAtMs};
  } catch(error) {observationError=error;throw error;}
  finally {
    try {await browser.close();}catch(cleanupError) {
      if(observationError)throw new AggregateError([observationError,cleanupError],'Chrome observation and cleanup failed');
      throw cleanupError;
    }
  }
}
