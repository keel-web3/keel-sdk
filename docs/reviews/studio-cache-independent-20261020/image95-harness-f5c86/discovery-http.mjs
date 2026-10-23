import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const app='/app/web/apps/studio',origin='http://127.0.0.1:4321',sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.getuid(),999);
const expected="0125ca589421e9c3e0b449556158aa00e5fb5d0ec0e0ac2d1aeb8e7825e483d9";
const document=await readFile(app+'/public/.well-known/keel.json');assert.equal(sha(document),expected);
const child=spawn(process.execPath,[app+'/server.js'],{cwd:app,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:'/tmp',NODE_ENV:'production',HOSTNAME:'127.0.0.1',PORT:'4321',STUDIO_WALLET_ACCESS_ENABLED:'1',STUDIO_ACCESS_WALLETS:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic',KEEL_PUBLICATION_WORKER_PAUSED:'1',KEEL_CHAIN_ID:'11155111',NEXT_PUBLIC_CHAIN_ID:'11155111',NEXT_PUBLIC_APP_URL:'https://studio.onkeel.io',KEEL_RPC_URL:'http://127.0.0.1:1'}});
let logBytes=0;child.stdout.on('data',b=>{logBytes+=b.length});child.stderr.on('data',b=>{logBytes+=b.length});
const hard=setTimeout(()=>child.kill('SIGKILL'),45000),checks=[];
async function fetchOne(path,method='GET',timeoutMs=5000){assert.ok(logBytes<=65536,'server log output bound');return fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)})}
try{
 let ready=false;const start=Date.now();
 while(Date.now()-start<30000){
  assert.equal(child.exitCode,null,'server exited before readiness');
  try{const response=await fetchOne('/api/health','GET',Math.min(5000,Math.max(1,30000-(Date.now()-start))));assert.equal(response.status,200);assert.equal((await response.json()).mode,'private-preview');ready=true;break}catch(error){if(error.cause?.code!=='ECONNREFUSED'&&!(error instanceof DOMException&&error.name==='TimeoutError'))throw error;if(Date.now()-start>=30000)break;await new Promise(r=>setTimeout(r,Math.min(100,30000-(Date.now()-start))))}
 }
 assert.ok(ready,'server readiness deadline');
 for(const method of ['GET','HEAD']){
  const response=await fetchOne('/.well-known/keel.json',method),body=Buffer.from(await response.arrayBuffer());
  assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/^application\/json/u);
  assert.equal(body.length,method==='GET'?document.length:0);
  if(method==='GET')assert.equal(sha(body),expected);
  checks.push({path:'/.well-known/keel.json',method,status:response.status,bodyBytes:body.length,contentType:response.headers.get('content-type'),...(method==='GET'?{sha256:sha(body)}:{})});
 }
 for(const path of ['/.well-known/private.json','/.well-known/keel.json/other','/.well-known/keel-capabilities','/api/mcp','/api/studio/projects','/api/agent/drafts']){
  const response=await fetchOne(path);assert.equal(response.status,401,path);assert.equal((await response.json()).code,'studio_sign_in_required');checks.push({path,method:'GET',status:response.status});
 }
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
  const response=await fetchOne('/.well-known/keel.json',method);assert.equal(response.status,401,method);assert.equal((await response.json()).code,'studio_sign_in_required');checks.push({path:'/.well-known/keel.json',method,status:response.status});
 }
 console.log(JSON.stringify({schema:'keel.actual-packaged-private-gate-discovery-http@1',result:'PASS',siteCommit:'4002803ccfcb20c39ffe5c555b68d8e197f379f8',buildId:'jtZVm1JMsE-biSFoBQzjQ',checks,actualPackagedStandaloneServer:true,walletGateEnabled:true,authenticationSent:false,externalNetwork:'none',database:'unreachable-synthetic',workerPaused:true,signing:false,transactionSubmission:false,productionActivated:false}));
}finally{
 clearTimeout(hard);child.kill('SIGTERM');
 await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(()=>{child.kill('SIGKILL');r()},2000))]);
}
