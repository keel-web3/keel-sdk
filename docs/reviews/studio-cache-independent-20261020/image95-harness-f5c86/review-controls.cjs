const fs=require('node:fs');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const ts=require('/Users/ravonus/dev/wt/studio-outstanding-sdk-20261020/keel-site/apps/studio/node_modules/typescript/lib/typescript.js');
const root=__dirname,read=n=>fs.readFileSync(root+'/'+n,'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const parse=s=>ts.createSourceFile('fixture.mjs',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const oldWorker=read('qualify-final-image.mjs.before'),newWorker=read('qualify-final-image.mjs'),oldHTTP=read('discovery-http.mjs.before'),newHTTP=read('discovery-http.mjs');
function assertions(s){const a=parse(s),out=[];assert.equal(a.parseDiagnostics.length,0);function walk(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.expression.getText(a)==='assert')out.push(n.getText(a));ts.forEachChild(n,walk)}walk(a);return out}
assert.deepEqual(oldWorker.split('\n').sort(),newWorker.split('\n').sort());
assert.deepEqual(parse(oldWorker).statements.map(n=>n.getText()).sort(),parse(newWorker).statements.map(n=>n.getText()).sort());
assert.deepEqual(assertions(oldWorker).sort(),assertions(newWorker).sort());
assert.deepEqual(assertions(oldHTTP),assertions(newHTTP));
assert.ok(newWorker.indexOf('const probe=')<newWorker.indexOf('const caps='));
assert.ok(oldWorker.indexOf('const probe=')>oldWorker.indexOf('const codecs='));
assert.equal(assertions(newWorker).length,32);assert.equal(assertions(newHTTP).length,15);
const loop=newHTTP.slice(newHTTP.indexOf(' let ready=false;'),newHTTP.indexOf(" for(const method of ['GET','HEAD'])"));
const fetchOne=newHTTP.match(/^async function fetchOne.*$/m)[0];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const start=new AsyncFunction('assert','DOMException','Date','setTimeout','child','fetch','AbortSignal','origin','logBytes',fetchOne+'\n'+loop+'\nreturn true;');
const post=new AsyncFunction('assert','fetch','AbortSignal','origin','logBytes',fetchOne+"\nreturn fetchOne('/.well-known/keel.json');");
const results=[];
async function run(name,sequence,expectedError){let now=0,requests=[],signals=[],i=0;const context={now:()=>now};const fakeAbort={timeout:ms=>{assert.ok(ms>0&&ms<=5000);signals.push(ms);return {ms}}};const fakeFetch=async(url,opts)=>{requests.push({url,timeout:opts.signal.ms});const step=sequence[Math.min(i++,sequence.length-1)];now+=Math.min(step.ms??0,opts.signal.ms);if(step.error)throw step.error;return{status:step.status??200,json:async()=>{if(step.bodyError)throw step.bodyError;return{mode:step.mode??'private-preview'}}}};let error;try{await start(assert,DOMException,context,(f,ms)=>{assert.ok(ms<=100);now+=ms;f()},{exitCode:null},fakeFetch,fakeAbort,'http://synthetic',0)}catch(e){error=e}if(expectedError){assert.ok(error,name+' should reject');assert.match(String(error),expectedError)}else assert.equal(error,undefined);assert.ok(now<=30000,name+' startup bound');results.push({name,requests:requests.length,elapsedMs:now,signalTimeouts:signals,status:expectedError?'EXPECTED_REJECTION':'PASS'});return{requests,now,error};}
(async()=>{
 await run('cold-start-one-timeout-then-ready',[{ms:5000,error:new DOMException('deadline','TimeoutError')},{}]);
 const d=await run('all-timeouts-stop-at-original-deadline',[{ms:5000,error:new DOMException('deadline','TimeoutError')}],/server readiness deadline/);assert.equal(d.now,30000);assert.equal(d.requests.length,6);assert.equal(d.requests.at(-1).timeout,4500);
 await run('connection-refused-then-ready',[{error:Object.assign(new Error('fetch failed'),{cause:{code:'ECONNREFUSED'}})},{}]);
 for(const [name,step,expected] of [
 ['health-401-is-terminal',{status:401},/401/],
 ['health-403-is-terminal',{status:403},/403/],
 ['health-503-is-terminal',{status:503},/503/],
 ['bad-json-is-terminal',{bodyError:new SyntaxError('bad-json')},/bad-json/],
 ['wrong-mode-is-terminal',{mode:'wrong-mode'},/wrong-mode/],
 ['ordinary-Error-named-TimeoutError-is-terminal',{error:Object.assign(new Error('ordinary-timeout'),{name:'TimeoutError'})},/ordinary-timeout/],
 ['socket-reset-is-terminal',{error:Object.assign(new Error('socket-reset'),{cause:{code:'ECONNRESET'}})},/socket-reset/]
 ]){const r=await run(name,[step],expected);assert.equal(r.requests.length,1)}
 let postCalls=0;await assert.rejects(()=>post(assert,async()=>{postCalls++;throw new DOMException('postready-timeout','TimeoutError')},{timeout:ms=>{assert.equal(ms,5000);return{ms}}},'http://synthetic',0),/postready-timeout/);assert.equal(postCalls,1);results.push({name:'post-readiness-timeout-remains-terminal',requests:postCalls,status:'EXPECTED_REJECTION'});
 const output={schema:'keel.independent-image95-harness-review-controls@1',node:process.version,typescript:ts.version,worker:{oldSHA256:sha(oldWorker),newSHA256:sha(newWorker),topLevelStatements:parse(newWorker).statements.length,statementMultisetIdentical:true,lineMultisetIdentical:true,assertions:32},http:{oldSHA256:sha(oldHTTP),newSHA256:sha(newHTTP),assertions:15,allAssertionsByteIdentical:true,cases:results},imageExecuted:false,productionActions:false};fs.writeFileSync(root+'/controls-result.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
})().catch(e=>{console.error(e);process.exitCode=1});
