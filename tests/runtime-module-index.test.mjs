import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKeelRuntimeModules} from '../packages/sdk/dist/runtime-module-index.js';

test('discovers a deployment hash across paged verification entries without trusting it', async () => {
  const calls=[];
  const result=await searchKeelRuntimeModules({query:'0xabcdef', fetch:async url=>{
    calls.push(String(url));
    if(url.pathname==='/api/modules') return Response.json({modules:[]});
    if(!url.searchParams.has('cursor')) return Response.json({modules:[{id:'unrelated'}],nextCursor:'next'});
    return Response.json({modules:[{id:'encoder',verified:false,deployments:[{hold:{objectId:'0xabcdef'}}]}]});
  }});
  assert.equal(result.complete,true);
  assert.equal(result.modules.length,1);
  assert.equal(result.modules[0].entry.verified,false);
  assert.match(result.execution,/sandbox/);
  assert.equal(calls.length,3);
});
test('a failed feed preserves matches and exposes incomplete coverage',async()=>{
 const result=await searchKeelRuntimeModules({query:'encoder',fetch:async url=>url.pathname==='/api/modules'?Response.json({modules:[{id:'encoder'}]}):new Response('',{status:503})});
 assert.equal(result.complete,false);assert.equal(result.modules.length,1);assert.match(result.sources[1].error,/503/);
});
test('repeated cursors and exhausted page budgets are incomplete, never absence',async()=>{
 for(const maxPages of [1,3]){
 const result=await searchKeelRuntimeModules({query:'encoder',maxPages,fetch:async()=>Response.json({modules:[],nextCursor:'same'})});
 assert.equal(result.complete,false);assert.equal(result.modules.length,0);
 }
});
test('malformed catalog is not an empty successful index',async()=>{
 const result=await searchKeelRuntimeModules({query:'encoder',fetch:async()=>Response.json({error:'unavailable'})});
 assert.equal(result.complete,false);
});

test('unreviewed JavaScript uses the existing opaque sandbox and rejects hash changes', async()=>{
 const {createKeelRuntimeModuleSandbox}=await import('../packages/sdk/dist/runtime-module-index.js');
 const {createHash}=await import('node:crypto');
 const bytes=new TextEncoder().encode('globalThis.testModuleLoaded = true;');
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const result=await createKeelRuntimeModuleSandbox({bytes,sha256});
 assert.deepEqual(result.document.sandboxTokens,['allow-scripts']);
 assert.equal(result.reviewStatus,'unverified');
 assert.match(result.document.csp,/connect-src blob:;/);
 assert.equal(globalThis.testModuleLoaded,undefined);
 await assert.rejects(createKeelRuntimeModuleSandbox({bytes,sha256:'0'.repeat(64)}),/digest mismatch/);
 await assert.rejects(createKeelRuntimeModuleSandbox({bytes,sha256,maxBytes:1}),/byte budget/);
});
