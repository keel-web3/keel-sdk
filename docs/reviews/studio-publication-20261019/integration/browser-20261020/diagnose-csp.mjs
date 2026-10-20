import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';
import {buildKeelInlineShellFragments,buildKeelInlineModuleFragment,buildKeelInlineLocalDocument} from '/Users/ravonus/dev/wt/studio-browser-integration-20261020/keel-sdk/packages/sdk/dist/inline-viewer-graph.js';
async function launch(binary) {
  const profile = await mkdtemp(join(tmpdir(), "keel-audio-chrome-"));
  const child = spawn(binary, [
    "--headless",
    "--mute-audio",
    "--autoplay-policy=document-user-activation-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools: ${stderr}`)), 15_000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/u.exec(stderr);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.on("error", reject);
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    } else for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}, sessionId = undefined) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }));
  });
  return {
    send,
    on: (listener) => listeners.push(listener),
    close: async () => {
      socket.close();
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
      await rm(profile, { recursive: true, force: true });
    },
  };
}

const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});const module=await buildKeelInlineModuleFragment({moduleId:'keel.csp-proof',version:'1.0.0',mediaType:'text/javascript',aliases:['keel-csp-proof.js'],decodedBytes:new TextEncoder().encode('top.postMessage({protocol:"keel-csp-proof",state:"ran"},"*")'),compression:'gzip',execution:'classic'});const local=await buildKeelInlineLocalDocument({shell,modules:[module],entry:{id:'index.html',mediaType:'text/html',source:new TextEncoder().encode('<!doctype html><html><head><script src="keel-csp-proof.js"></script></head><body>art</body></html>')}});
const host=`<!doctype html><html><body><output id="result">waiting</output><iframe id="marketplace" sandbox="allow-scripts"></iframe><script>addEventListener('message',e=>{document.querySelector('#result').textContent=JSON.stringify(e.data)});document.querySelector('#marketplace').srcdoc=atob(${JSON.stringify(Buffer.from(local.rootBytes).toString('base64'))});</script></body></html>`;
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('content-security-policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; frame-src 'self' data:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");res.end(host)});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await launch('/Users/ravonus/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell');const events=[];const contexts=[];
browser.on(msg=>{if(msg.method==='Target.attachedToTarget'){const s=msg.params.sessionId;void Promise.all([browser.send('Runtime.enable',{},s),browser.send('Log.enable',{},s),browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},s)]).catch(e=>events.push({error:String(e)}))}if(['Runtime.exceptionThrown','Log.entryAdded','Runtime.consoleAPICalled','Page.frameStoppedLoading'].includes(msg.method))events.push(msg);if(msg.method==='Runtime.executionContextCreated')contexts.push({session:msg.sessionId,id:msg.params.context.id,origin:msg.params.context.origin,auxData:msg.params.context.auxData})});
try{const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});await Promise.all([browser.send('Runtime.enable',{},sessionId),browser.send('Log.enable',{},sessionId),browser.send('Page.enable',{},sessionId),browser.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sessionId)]);await browser.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port},sessionId);await new Promise(r=>setTimeout(r,4000));const states=[];for(const c of contexts){try{states.push({...c,result:await browser.send('Runtime.evaluate',{expression:'JSON.stringify({href:location.href,origin:location.origin,result:document.querySelector("#result")?.textContent,stage:document.querySelector("#keel-status")?.textContent,frames:document.querySelectorAll("iframe").length,html:document.documentElement.outerHTML.slice(0,300)})',contextId:c.id,returnByValue:true},c.session)})}catch{}}await writeFile('/tmp/keel-browser-integration-20261020/csp-cdp-baseline.json',JSON.stringify({events,states},null,2));console.log(JSON.stringify({events,states},null,2))}finally{await browser.close();await new Promise(r=>server.close(r))}
