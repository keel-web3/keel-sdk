import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {createKeelRpcClient}=await import(process.env.KEEL_TEST_GOVERNED_READER?pathToFileURL(process.env.KEEL_TEST_GOVERNED_READER).href:'../packages/protocol/dist/keel-rpc.js');
const urls=['https://one.example/rpc','https://two.example/rpc'];
const call={to:'0x'+'11'.repeat(20),data:'0x1234',block:'0x123'};
function fixture(handle,options={}){
  const calls=[];
  const client=createKeelRpcClient({family:'ethereum',chainId:31337,endpoints:urls,hostList:['one.example','two.example'],...options,
    fetchImpl:async(url,init)=>{const q=JSON.parse(init.body);calls.push({url,...q});const result=await handle(q,url,init);return result instanceof Response?result:Response.json({jsonrpc:'2.0',id:q.id,result});}});
  return {client,calls};
}
for(const status of [401,403])test(`governed SDK reader treats ${status} as sticky terminal without fallback`,async()=>{
  const f=fixture(()=>new Response('SECRET',{status}));
  await assert.rejects(f.client.call(call),e=>e.terminal===true&&!/SECRET/.test(e.message));
  await assert.rejects(f.client.call(call),e=>e.terminal===true);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,urls[0]);
});
for(const status of [200,503])test(`governed reader retains genuine nested revert inside HTTP ${status}`,async()=>{
  const f=fixture(q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'wrapper',cause:{code:3,message:'execution reverted SECRET'}}},{status}),{maxRetries:2,retryDelayMs:1});
  await assert.rejects(f.client.call(call),e=>e.terminal===true&&e.code==='rpc.execution-reverted');
  assert.equal(f.calls.length,1);
});
for(const cause of [{status:403},{status:503,cause:{code:3,message:'execution reverted SECRET'}}])test('governed thrown wrapper never becomes fallback: '+JSON.stringify(cause),async()=>{
  const f=fixture(()=>{throw Object.assign(Error('provider SECRET'),cause);});
  await assert.rejects(f.client.call(call),e=>e.terminal===true&&!/SECRET/.test(e.message));assert.equal(f.calls.length,1);
});
for(const body of [JSON.stringify({jsonrpc:'2.0',id:1,error:{code:3,message:'execution reverted',data:'0x'+'ab'.repeat(40_000)}}),'{"error":', 'x'.repeat(65_537)])test('governed incomplete/oversized error envelope fails closed without retry or another recipient: '+body.length,async()=>{
  const f=fixture(q=>new Response(body,{status:503}),{maxRetries:2,retryDelayMs:1});
  await assert.rejects(f.client.call(call),e=>e.terminal===true);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,urls[0]);
  await assert.rejects(f.client.call(call),e=>e.terminal===true);assert.equal(f.calls.length,1);
});
test('governed incomplete HTTP error stream times out fail-closed while preserving its physical lease',async t=>{
  let stream;const f=fixture((_q,url)=>url===urls[0]?new Response(new ReadableStream({start(c){stream=c;c.enqueue(new TextEncoder().encode('{"error":'));}}),{status:503}):'0x6000',{timeoutMs:15,maxConcurrentReads:4});
  t.after(()=>{try{stream.close();}catch{}});
  await assert.rejects(f.client.call(call),e=>e.terminal===true);
  assert.equal(f.calls.length,1);await assert.rejects(f.client.call(call));assert.equal(f.calls.length,1);
});
test('governed full plain-text transport bodies retain fallback below/at the unchanged 64KiB cap',async()=>{
  for(const bytes of [65_535,65_536]){
    const f=fixture((_q,url)=>url===urls[0]?new Response('x'.repeat(bytes),{status:503}):'0x6000');
    assert.equal(await f.client.call(call),'0x6000');assert.equal(f.calls.length,2);
  }
});
test('governed bounded malformed JSON media type and unknown RPC failures remain fail-closed',async()=>{
  for(const response of [()=>new Response('nope',{status:503,headers:{'content-type':'application/json'}}),()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-32000,message:'unknown custom failure',data:'0x4a11abec'}},{status:503}),()=>new Response(Uint8Array.of(255),{status:503})]){
    const f=fixture(()=>response());await assert.rejects(f.client.call(call),e=>e.terminal===true);assert.equal(f.calls.length,1);
  }
});
test('governed fully correlated rate-limit envelope retries only the same exact operation',async()=>{
  let reads=0;const f=fixture(q=>++reads===1?Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'rate limit'}},{status:429,headers:{'retry-after':'0'}}):'0x6000',{maxRetries:1,retryDelayMs:1});
  assert.equal(await f.client.call(call),'0x6000');assert.equal(f.calls.length,2);assert.ok(f.calls.every(q=>q.url===urls[0]));assert.deepEqual(f.calls[0].params,f.calls[1].params);
});
for(const error of [
  {code:-32000,message:'VM Exception while processing transaction: revert CustomError()',data:'0xdeadbeef'},
  {code:-32000,message:'opaque contract failure',data:'0xdeadbeef'},
  {code:-32005,message:'execution reverted',data:'0xdeadbeef'},
  {code:-32005,message:'rate limit',data:{cause:{code:3,message:'revert CustomError()'}}},
  {code:-32005,message:'x'.repeat(2049)},
  {code:403,message:'PRIVATE provider text'},
  'opaque failure',
])test('governed HTTP200 errors cannot fall through to successful alternate execution: '+JSON.stringify(error).slice(0,100),async()=>{
  const f=fixture((q,url)=>url===urls[0]?Response.json({jsonrpc:'2.0',id:q.id,error}):'0x6000',{maxRetries:2,retryDelayMs:1});
  await assert.rejects(f.client.call(call),e=>e.terminal===true&&!/PRIVATE|deadbeef|CustomError/.test(e.message));
  assert.equal(f.calls.length,1);await assert.rejects(f.client.call(call),e=>e.terminal===true);assert.equal(f.calls.length,1);
});
test('governed HTTP200 correlated capacity error retains bounded exact-operation retry',async()=>{
  let reads=0;const f=fixture(q=>++reads===1?Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'rate limit'}}):'0x6000',{maxRetries:1,retryDelayMs:1});
  assert.equal(await f.client.call(call),'0x6000');assert.equal(f.calls.length,2);assert.ok(f.calls.every(q=>q.url===urls[0]));assert.deepEqual(f.calls[0].params,f.calls[1].params);
});
test('governed unsupported-selector fallback is restricted to exact canonical hash reads',async()=>{
  const selector={blockHash:'0x'+'ab'.repeat(32),requireCanonical:true};
  for(const status of [200,400]){
    const f=fixture((q,url)=>q.method==='eth_chainId'?'0x7a69':url===urls[0]?Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported EIP-1898'}},{status}):'0x6000',{verifyChainId:true});
    assert.equal(await f.client.call({...call,block:selector}),'0x6000');const calls=f.calls.filter(q=>q.method==='eth_call');assert.equal(calls.length,2);assert.deepEqual(calls[0].params,calls[1].params);assert.deepEqual(calls[1].params[1],selector);
  }
  for(const extra of [{data:'0xdeadbeef'},{cause:{code:3}},{other:'unknown'}]){
    const f=fixture(q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported',...extra}}));
    await assert.rejects(f.client.call({...call,block:selector}),e=>e.terminal===true);assert.equal(f.calls.length,1);
  }
  for(const block of ['latest',{...selector,requireCanonical:false},{...selector,blockNumber:'0x1'},Object.create(selector)]){
    const f=fixture(q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported'}}));
    await assert.rejects(f.client.call({...call,block}),e=>e.terminal===true);assert.equal(f.calls.length,1);
  }
  const f=fixture(q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported'}}),{verifyChainId:true});
  await assert.rejects(f.client.call({...call,block:selector}),e=>e.terminal===true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'eth_chainId');
});
test('governed reader limits physical fanout and retries only transient failures with identical calls',async()=>{
  let active=0,maximum=0,attempt=0;
  const f=fixture(async()=>{active++;maximum=Math.max(active,maximum);await new Promise(r=>setTimeout(r,1));active--;return ++attempt===1?new Response('',{status:429,headers:{'retry-after':'0'}}):'0x6000';},{maxConcurrentReads:2,maxRetries:1,retryDelayMs:1});
  assert.deepEqual(await Promise.all(Array.from({length:60},()=>f.client.call(call))),Array(60).fill('0x6000'));
  assert.ok(maximum<=2);assert.equal(f.calls.length,61);
  assert.ok(f.calls.every(q=>q.url===urls[0]));
  assert.ok(f.calls.every(q=>JSON.stringify(q.params)===JSON.stringify([{to:call.to,data:call.data},call.block])));
});
test('governed reader cancellation rejects its queue and dispatches no hidden reads',async()=>{
  const controller=new AbortController();let entered;
  const started=new Promise(r=>entered=r);
  const f=fixture(async(_q,_url,init)=>{entered();return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));},{maxConcurrentReads:1,signal:controller.signal});
  const pending=Array.from({length:20},()=>f.client.call(call));
  const observed=Promise.all(pending.map(p=>assert.rejects(p)));
  await started;controller.abort();await observed;assert.equal(f.calls.length,1);
});
test('governed reader rejects a timed-out uncooperative fetch while retaining the physical lease',async()=>{
  let release;
  const late=new Promise(r=>release=r);let reads=0;
  const f=fixture(async()=>++reads===1?late:'0x6000',{maxConcurrentReads:1,timeoutMs:15});
  await assert.rejects(f.client.call(call),e=>e.code==='transport.timeout');
  await assert.rejects(f.client.call(call),e=>e.noFallback===true);
  assert.equal(reads,1);
  release('0x6001');await new Promise(r=>setImmediate(r));
  assert.equal(await f.client.call(call),'0x6000');assert.equal(reads,2);
});
