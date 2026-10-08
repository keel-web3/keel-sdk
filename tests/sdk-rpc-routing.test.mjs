import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { createKeelRpcPool, createKeelRpcFetch, KeelRpcSetupError, KeelRpcResponseError, resolveKeelRpcConfiguration } from '../packages/sdk/dist/rpc.js';
import { parseKeelRpcConfiguration } from '../packages/sdk/dist/rpc-node.js';
import { createKeelRpcReadManifest } from '../packages/sdk/dist/rpc-read-manifest.js';

const urls = ['https://a.example/private-key?token=secret', 'https://b.example/key', 'https://c.example'];
const number = '0x12', hash = '0x'+'ab'.repeat(32), address = '0x'+'11'.repeat(20);
const fail = (body, code, message, options) => Response.json({jsonrpc:'2.0',id:body.id,error:{code,message}},options);
function fixture(handler, options={}) {
  const calls=[]; let time=10_000;
  const pool=createKeelRpcPool({rpcUrls:urls,chainId:1,minIntervalMs:0,now:()=>time,random:()=>0,...options,fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body); calls.push({url,...body});
    const value=await handler(url,body,calls);
    return value instanceof Response ? value : Response.json({jsonrpc:'2.0',id:body.id,result:value});
  }});
  return {pool,calls,tick:ms=>{time+=ms;}};
}
const record=(url, extra={})=>({url,chainId:1,basis:'declared',observedAtMs:1,validUntilMs:999999,source:'Fixture',...extra});
const read={method:'eth_call',params:[{to:address,data:'0x',gas:'0x100'},number]};

test('unsupported trace is permanent per method, falls back and never throttles ordinary reads',async()=>{
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':b.method.startsWith('debug_')?fail(b,-32601,'debug method not supported private-key'):'0xbeef');
  for(let i=0;i<2;i++) await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash]}),e=>{
    assert.ok(e instanceof KeelRpcResponseError);assert.equal(e.code,-32601);assert.equal(e.diagnosis,'unknown');
    assert.ok(e.providers.every(s=>s.method==='debug_traceTransaction'&&s.supported===false));
    assert.doesNotMatch(JSON.stringify(e),/private-key|token=secret/);return true;
  });
  assert.equal(f.calls.filter(c=>c.method==='debug_traceTransaction').length,3);
  assert.equal(await f.pool.request(read),'0xbeef');
  assert.ok(f.pool.status('eth_call').every(s=>s.retryAfterMs===0));
});

test('503 jitter is method scoped and bounded; supported ordinary calls can proceed immediately',async()=>{
  const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':b.method==='debug_traceTransaction'?new Response('secret',{status:503}):'0xbeef',{rpcUrls:[urls[0]]});
  await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash]}),KeelRpcSetupError);
  assert.equal(f.pool.status('debug_traceTransaction')[0].retryAfterMs,750);
  assert.equal(await f.pool.request(read),'0xbeef');
  assert.equal(f.pool.status('eth_call')[0].retryAfterMs,0);
  const count=f.calls.length;
  await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash]}));assert.equal(f.calls.length,count);
  f.tick(750);await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash]}));
  assert.equal(f.pool.status('debug_traceTransaction')[0].retryAfterMs,1500);
});

test('long Retry-After is retained without waiting or contacting a shared quota mirror',async()=>{
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':url===urls[0]?new Response('',{status:429,headers:{'retry-after':'3600'}}):'0xbeef',{
    endpoints:[record(urls[0],{quotaGroup:'account'}),record(urls[1],{quotaGroup:'account'})]});
  assert.equal(await f.pool.request(read),'0xbeef');
  assert.equal(f.calls.some(c=>c.url===urls[1]),false);
  assert.equal(f.pool.status('eth_call')[0].retryAfterMs,3600000);
  assert.equal(f.pool.status('eth_getCode')[1].retryAfterMs,3600000);
  f.tick(3_599_999);assert.equal(f.pool.status('eth_call')[0].retryAfterMs,1);
});

test('HTTP date Retry-After and JSON rate limits share cooldown across methods',async()=>{
  const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':fail(b,-32005,'quota',{headers:{'retry-after':new Date(70_000).toUTCString()}}),{rpcUrls:[urls[0]]});
  await assert.rejects(f.pool.request(read),e=>e.retryAfterMs===60_000);
  assert.equal(f.pool.status('eth_blockNumber')[0].retryAfterMs,60_000);
  const count=f.calls.length;await assert.rejects(f.pool.request({method:'eth_blockNumber'}));assert.equal(f.calls.length,count);
});

test('401/403 stop the read and disable the shared authorization scope without rotating identity',async()=>{
  for(const status of [401,403]){
    const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':new Response('',{status}),{
      endpoints:[record(urls[0],{authorizationScope:'same-account'}),record(urls[1],{authorizationScope:'same-account'})]});
    await assert.rejects(f.pool.request(read),e=>e.reason==='access-denied');
    assert.equal(f.calls.some(c=>c.url!==urls[0]),false);
    assert.deepEqual(f.pool.status().map(s=>s.disabled),[true,true,false]);
  }
});

test('learned estimateGas cap never lowers eth_call; lower provider caps skip unchanged high-gas request',async()=>{
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':url===urls[0]&&b.method==='eth_estimateGas'?fail(b,-32000,'gas cap: 100 private-key'):'0x100',{
    endpoints:[record(urls[1],{methods:[{method:'eth_estimateGas',maxGas:80}]}),record(urls[2],{methods:[{method:'eth_estimateGas',maxGas:1000}]})]});
  assert.equal(await f.pool.request({...read,method:'eth_estimateGas'}),'0x100');
  assert.equal(f.calls.some(c=>c.url===urls[1]),false);
  assert.equal(f.pool.status('eth_estimateGas')[0].maxGas,'100');
  assert.equal(f.pool.status('eth_call')[0].maxGas,undefined);
  assert.deepEqual(f.calls.filter(c=>c.method==='eth_estimateGas').map(c=>c.params),[read.params,read.params]);
  const isolated=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':b.method==='eth_estimateGas'?fail(b,-32000,'gas cap: 100'):'0xbeef',{rpcUrls:[urls[0]]});
  await assert.rejects(isolated.pool.request({...read,method:'eth_estimateGas'}));
  assert.equal(await isolated.pool.request(read),'0xbeef');
});

test('declared unsupported methods and stale evidence are distinguished without blanket disable',async()=>{
  const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':'0xbeef',{
    endpoints:[record(urls[0],{methods:[{method:'eth_call',supported:false}]}),record(urls[1],{validUntilMs:100,methods:[{method:'eth_call',supported:false}]})]});
  assert.equal(await f.pool.request(read),'0xbeef');
  assert.equal(f.calls[0].url,urls[1]);
  assert.equal(f.pool.status('eth_getCode')[0].disabled,false);
});

test('response capacities are endpoint/method specific and enforce transport bytes',async()=>{
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':url===urls[1]?'x'.repeat(2000):'0xbeef',{
    endpoints:[record(urls[0],{methods:[{method:'eth_call',maxResponseBytes:100}]}),record(urls[1],{methods:[{method:'eth_call',maxResponseBytes:1024}]})]});
  assert.equal(await f.pool.request({...read,requiredResponseBytes:500}),'0xbeef');
  assert.equal(f.calls.some(c=>c.url===urls[0]),false);
  assert.equal(f.pool.status('eth_call')[1].reason,'response-capacity');
  assert.equal(f.pool.status('eth_getCode')[1].maxResponseBytes,16*1024*1024);
});

test('wrong chain and changed pinned block/runtime cannot supply simulation evidence',async()=>{
  const pin={blockNumber:number,blockHash:hash,runtimes:[{address,codeHash:keccak256('0x6000')}]};
  const f=fixture((url,b)=>b.method==='eth_chainId'?url===urls[0]?'0x2':'0x1':b.method==='eth_getBlockByNumber'?{number,hash:url===urls[1]?'0x'+'cd'.repeat(32):hash}:b.method==='eth_getCode'?'0x6000':'0xbeef');
  assert.equal(await f.pool.request({...read,params:[read.params[0],'latest'],pin}),'0xbeef');
  assert.equal(f.calls.filter(c=>c.method==='eth_call').length,1);
  assert.equal(f.calls.find(c=>c.method==='eth_call').params[1],number);
  assert.equal(f.pool.status()[0].reason,'wrong-chain');
  const reorg=fixture((_url,b,calls)=>b.method==='eth_chainId'?'0x1':b.method==='eth_getBlockByNumber'?{number,hash:calls.some(c=>c.method==='eth_call')?'0x'+'cd'.repeat(32):hash}:b.method==='eth_getCode'?'0x6000':'0xbeef',{rpcUrls:[urls[0]]});
  await assert.rejects(reorg.pool.request({...read,pin}),e=>e.reason==='pin-mismatch');
  const wrongRuntime=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':b.method==='eth_getBlockByNumber'?{number,hash}:'0x6001',{rpcUrls:[urls[0]]});
  await assert.rejects(wrongRuntime.pool.request({...read,pin}),e=>e.reason==='pin-mismatch');
  assert.equal(wrongRuntime.calls.some(c=>c.method==='eth_call'),false);
});

test('bounded fallback preserves historical block and exact simulation payload across providers',async()=>{
  const payload={blockStateCalls:[{calls:[{to:address,data:'0x',gas:'0x100'}]}],validation:true,traceTransfers:false,returnFullTransactions:false};
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':b.method==='eth_getBlockByNumber'?{number,hash}:url===urls[0]?fail(b,-32601,'method unsupported'):[{number}],{maxAttempts:2});
  assert.deepEqual(await f.pool.request({method:'eth_simulateV1',params:[payload,number],pin:{blockNumber:number,blockHash:hash}}),[{number}]);
  assert.deepEqual(f.calls.filter(c=>c.method==='eth_simulateV1').map(c=>c.params),[[payload,number],[payload,number]]);
  const all=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':new Response('',{status:503}),{maxAttempts:2});
  await assert.rejects(all.pool.request(read));assert.equal(all.calls.some(c=>c.url===urls[2]),false);
});

test('deadlines also bound transports ignoring abort signals and queued requests',async()=>{
  const f=fixture(()=>new Promise(()=>{}),{rpcUrls:[urls[0]],timeoutMs:100,deadlineMs:200});
  const start=Date.now();
  const result=await Promise.allSettled([f.pool.request(read),f.pool.request(read)]);
  assert.ok(result.every(r=>r.status==='rejected'));assert.ok(Date.now()-start<1000);
  assert.equal(f.calls.length,1);
});

test('trace options, pins and writes reject before network; malformed configuration fails closed',async()=>{
  const f=fixture(()=>{throw Error('must not contact');});
  for(const request of [{method:'eth_sendRawTransaction',params:['0x']},{method:'debug_traceTransaction',params:[hash,{tracer:'function(){}'}]},
    {...read,pin:{blockNumber:'0x99',blockHash:hash}},{...read,requiredGas:-1n}])await assert.rejects(f.pool.request(request));
  assert.equal(f.calls.length,0);
  const good={chainId:1,rpcUrls:[urls[0]],endpoints:[record(urls[0],{quotaGroup:'shared',methods:[{method:'eth_call',maxGas:1000}]})]};
  assert.equal(parseKeelRpcConfiguration(good).endpoints[0].methods[0].maxGas,1000);
  for(const endpoints of [[record(urls[0],{chainId:2})],[record(urls[1])],[record(urls[0],{methods:[{method:'eth_call',maxGas:0}]})]])assert.throws(()=>resolveKeelRpcConfiguration({...good,endpoints}));
  const manifest=createKeelRpcReadManifest({...good,rpcUrls:['https://sepolia.drpc.org'],endpoints:[record('https://sepolia.drpc.org',{methods:[{method:'eth_estimateGas',maxGas:123}]})]});
  assert.equal(manifest.endpoints[0].methods[0].maxGas,123);
});

test('missing trace is explicitly unknown and an API-key quota message remains a quota cooldown',async()=>{
  const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':null,{rpcUrls:[urls[0]]});
  await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash]}),e=>e.reason==='history-unavailable'&&e.diagnosis==='unknown');
  const q=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':fail(b,-32005,'API key quota exceeded'),{rpcUrls:[urls[0]]});
  await assert.rejects(q.pool.request(read),e=>e.reason==='rate-limited');
  assert.equal(q.pool.status()[0].disabled,false);
});

test('MCP uses the same selected capability records and retained method health',async()=>{
  const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');
  const {mcpRpc}=await import('../packages/mcp/dist/rpc-tools.js');
  const workspace={root:await mkdtemp('/tmp/keel-method-rpc-')};const prior=globalThis.fetch;
  const calls=[];
  try{
    await mkdir(workspace.root+'/.keel');
    await writeFile(workspace.root+'/.keel/rpc.json',JSON.stringify({chainId:1,rpcUrls:urls,minIntervalMs:0,endpoints:[record(urls[0],{observedAtMs:Date.now()-1000,validUntilMs:Date.now()+60_000,methods:[{method:'eth_call',maxGas:100}]})]}));
    globalThis.fetch=async(url,init)=>{const b=JSON.parse(init.body);calls.push({url,...b});return Response.json({jsonrpc:'2.0',id:b.id,result:b.method==='eth_chainId'?'0x1':'0xbeef'});};
    const context={workspace},one=await mcpRpc(context,{chainId:1}),two=await mcpRpc(context,{chainId:1});
    assert.equal(one.pool,two.pool);assert.equal(await one.pool.request(read),'0xbeef');
    assert.equal(calls.some(c=>c.url===urls[0]),false);
    assert.equal(one.pool.status()[0].methods.find(value=>value.method==='eth_call').maxGas,'100');
  }finally{globalThis.fetch=prior;await rm(workspace.root,{recursive:true,force:true});}
});

test('transaction trace failover keeps the exact mined transaction block/hash pin',async()=>{
  const f=fixture((url,b)=>b.method==='eth_chainId'?'0x1':b.method==='eth_getBlockByNumber'?{number,hash}:b.method==='eth_getTransactionReceipt'?{transactionHash:hash,blockNumber:number,blockHash:url===urls[0]?'0x'+'cd'.repeat(32):hash}:{type:'CALL'});
  const result=await f.pool.request({method:'debug_traceTransaction',params:[hash],pin:{blockNumber:number,blockHash:hash}});
  assert.equal(result.type,'CALL');assert.equal(f.calls.find(c=>c.method==='debug_traceTransaction').url,urls[1]);
  assert.equal(f.calls.filter(c=>c.method==='debug_traceTransaction').length,1);
});

test('Studio callTracer serialization is accepted exactly without enabling custom tracers or log expansion',async()=>{
 const options={tracer:'callTracer',timeout:'5s',tracerConfig:{onlyTopCall:false,withLog:false}};
 const f=fixture((_url,b)=>b.method==='eth_chainId'?'0x1':{type:'CALL',calls:[]},{rpcUrls:[urls[0]]});
 await f.pool.request({method:'debug_traceTransaction',params:[hash,options]});
 assert.deepEqual(f.calls.find(c=>c.method==='debug_traceTransaction').params,[hash,options]);
 for(const tracerConfig of [{onlyTopCall:false,withLog:true},{onlyTopCall:true,withLog:false},{onlyTopCall:false,withLog:false,custom:'code'}]){
  const before=f.calls.length;await assert.rejects(f.pool.request({method:'debug_traceTransaction',params:[hash,{...options,tracerConfig}]}));assert.equal(f.calls.length,before);
 }
});
