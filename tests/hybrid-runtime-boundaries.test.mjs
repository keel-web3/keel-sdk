import test from 'node:test';
import assert from 'node:assert/strict';
import {createKeelChain} from '../packages/viewer/src/keel-rpc-view.js';
const urls=['https://one.example/rpc','https://two.example/rpc'];
const store='0x'+'11'.repeat(20),block={number:'0x123',hash:'0x'+'ab'.repeat(32)};
function setup(handle,options={}) {
  const calls=[];
  const chain=createKeelChain({rpc:urls,hosts:['one.example','two.example'],keelHold:store,expectedChainId:31337,...options,
    fetchImpl:async(url,init)=>{const q=JSON.parse(init.body);calls.push({url,...q});const v=await handle(q,url,init);return v instanceof Response?v:Response.json({jsonrpc:'2.0',id:q.id,result:v});}});
  return {chain,calls};
}
for(const status of [401,403])test(`HTTP ${status} is sticky terminal and never reaches another recipient`,async()=>{
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':new Response('private',{status}));
  await assert.rejects(f.chain.call(store,'0x'),error=>error.terminal===true);
  const count=f.calls.length;
  await assert.rejects(f.chain.call(store,'0x'),error=>error.terminal===true);
  assert.equal(f.calls.length,count);
  assert.ok(f.calls.every(q=>q.url===urls[0]));
});
test('a genuine contract revert is terminal, never retried or switched to a provider returning success',async()=>{
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':Response.json({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted SECRET',data:'0x12345678'}}));
  await assert.rejects(f.chain.call(store,'0x'),error=>error.terminal===true&&!/SECRET/.test(error.message));
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);
  assert.ok(f.calls.every(q=>q.url===urls[0]));
});
for(const cause of [{status:403},{status:503,cause:{code:3,message:'execution reverted SECRET'}}])test('thrown HTTP wrappers retain terminal denial/revert semantics: '+JSON.stringify(cause),async()=>{
  const f=setup(q=>{if(q.method==='eth_chainId')return '0x7a69';throw Object.assign(Error('provider SECRET'),cause);});
  await assert.rejects(f.chain.call(store,'0x'),e=>e.terminal===true&&!/SECRET/.test(e.message));
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
});
for(const body of [JSON.stringify({jsonrpc:'2.0',id:1,error:{code:3,message:'execution reverted',data:'0x'+'ab'.repeat(40_000)}}),'{"error":','x'.repeat(65_537)])test('browser incomplete/oversized error envelope fails closed without retry or another recipient: '+body.length,async()=>{
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':new Response(body,{status:503}),{maxRetries:2,retryDelayMs:1});
  await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);
  const before=f.calls.length;await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);
  assert.equal(f.calls.length,before);assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
});
test('browser incomplete HTTP error stream times out fail-closed without another dispatch',async t=>{
  let stream;const f=setup((q,url)=>q.method==='eth_chainId'?'0x7a69':url===urls[0]?new Response(new ReadableStream({start(c){stream=c;c.enqueue(new TextEncoder().encode('{"error":'));}}),{status:503}):'0x6000',{timeoutMs:15,maxConcurrentReads:4});
  t.after(()=>{try{stream.close();}catch{}});
  await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
});
test('browser full plain-text transport bodies retain fallback below/at the unchanged 64KiB cap',async()=>{
  for(const bytes of [65_535,65_536]){
    const f=setup((q,url)=>q.method==='eth_chainId'?'0x7a69':url===urls[0]?new Response('x'.repeat(bytes),{status:503}):'0x6000');
    assert.equal(await f.chain.call(store,'0x1234'),'0x6000');assert.equal(f.calls.filter(q=>q.method==='eth_call').length,2);
  }
});
test('browser bounded malformed JSON media type and unknown RPC failures remain fail-closed',async()=>{
  for(const response of [()=>new Response('nope',{status:503,headers:{'content-type':'application/json'}}),q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'unknown custom failure',data:'0x4a11abec'}},{status:503}),()=>new Response(Uint8Array.of(255),{status:503})]){
    const f=setup(q=>q.method==='eth_chainId'?'0x7a69':response(q));await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
  }
});
test('browser fully correlated rate-limit envelope retries the same pinned operation',async()=>{
  let reads=0;const f=setup(q=>q.method==='eth_chainId'?'0x7a69':q.method==='eth_getBlockByNumber'?block:++reads===1?Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'rate limit'}},{status:429,headers:{'retry-after':'0'}}):'0x6000',{maxRetries:1,retryDelayMs:1});
  await f.chain.pinBlock();assert.equal(await f.chain.call(store,'0x1234'),'0x6000');const calls=f.calls.filter(q=>q.method==='eth_call');assert.equal(calls.length,2);assert.ok(calls.every(q=>q.url===urls[0]));assert.deepEqual(calls[0].params,calls[1].params);
});
for(const error of [
  {code:-32000,message:'VM Exception while processing transaction: revert CustomError()',data:'0xdeadbeef'},
  {code:-32000,message:'opaque contract failure',data:'0xdeadbeef'},
  {code:-32005,message:'execution reverted',data:'0xdeadbeef'},
  {code:-32005,message:'rate limit',data:{cause:{code:3,message:'revert CustomError()'}}},
  {code:-32005,message:'x'.repeat(2049)},
  {code:403,message:'PRIVATE provider text'},
  'opaque failure',
])test('browser HTTP200 errors cannot fall through to successful alternate execution: '+JSON.stringify(error).slice(0,100),async()=>{
  const f=setup((q,url)=>q.method==='eth_chainId'?'0x7a69':url===urls[0]?Response.json({jsonrpc:'2.0',id:q.id,error}):'0x6000',{maxRetries:2,retryDelayMs:1});
  await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true&&!/PRIVATE|deadbeef|CustomError/.test(e.message));
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));const before=f.calls.length;await assert.rejects(f.chain.call(store,'0x1234'));assert.equal(f.calls.length,before);
});
test('browser HTTP200 correlated capacity error retains bounded exact pinned retry',async()=>{
  let reads=0;const f=setup(q=>q.method==='eth_chainId'?'0x7a69':q.method==='eth_getBlockByNumber'?block:++reads===1?Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32005,message:'rate limit'}}):'0x6000',{maxRetries:1,retryDelayMs:1});
  await f.chain.pinBlock();assert.equal(await f.chain.call(store,'0x1234'),'0x6000');const calls=f.calls.filter(q=>q.method==='eth_call');assert.equal(calls.length,2);assert.ok(calls.every(q=>q.url===urls[0]));assert.deepEqual(calls[0].params,calls[1].params);
});
test('browser unsupported-selector exception cannot cover unrelated, unpinned or augmented RPC errors',async()=>{
  for(const extra of [{data:'0xdeadbeef'},{cause:{code:3}},{other:'unknown'}]){
    const f=setup(q=>q.method==='eth_chainId'?'0x7a69':q.method==='eth_getBlockByNumber'?block:Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported',...extra}}));
    await f.chain.pinBlock();await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
  }
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported'}}));
  await assert.rejects(f.chain.call(store,'0x1234'),e=>e.terminal===true);assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);assert.ok(f.calls.every(q=>q.url===urls[0]));
  const identity=setup(q=>Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32602,message:'unsupported'}}));
  await assert.rejects(identity.chain.call(store,'0x1234'),e=>e.terminal===true);assert.equal(identity.calls.length,1);assert.equal(identity.calls[0].method,'eth_chainId');
});
test('pinned cache and in-flight identity include every execution argument and snapshot mutable inputs before awaiting',async()=>{
  const slot='0x'+'00'.repeat(32),value=n=>'0x'+n.toString(16).padStart(64,'0');
  const override=n=>({[store]:{stateDiff:{[slot]:value(n)}}});
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':q.method==='eth_getBlockByNumber'?block:q.params[3]?.number??q.params[2][store].stateDiff[slot]);
  await f.chain.pinBlock();
  const params=[{to:store,data:'0x1234'},'latest',override(1)];
  const pending=f.chain.request('eth_call',params);
  params[0].data='0x9999';params[2][store].stateDiff[slot]=value(9);
  assert.equal(await pending,value(1));
  assert.deepEqual(await Promise.all([f.chain.request('eth_call',[{to:store,data:'0x1234'},'latest',override(2)]),f.chain.request('eth_call',[{to:store,data:'0x1234'},'latest',override(3)])]),[value(2),value(3)]);
  assert.equal(await f.chain.request('eth_call',[{to:store,data:'0x1234'},'latest',override(1)]),value(1));
  assert.equal(await f.chain.request('eth_call',[{to:store,data:'0x1234'},'latest',override(1),{number:'0x1235'}]),'0x1235');
  const calls=f.calls.filter(q=>q.method==='eth_call');assert.equal(calls.length,4);
  assert.equal(calls[0].params[0].data,'0x1234');assert.equal(calls[0].params[2][store].stateDiff[slot],value(1));
  assert.ok(calls.every(q=>q.params[1].blockHash===block.hash&&q.params[1].requireCanonical===true));
});
test('a large logical sequence dispatches only a bounded physical active window',async()=>{
  let active=0,maximum=0;
  const f=setup(async q=>{active++;maximum=Math.max(active,maximum);await new Promise(r=>setTimeout(r,1));active--;return q.method==='eth_chainId'?'0x7a69':'0x6000';},{maxConcurrentReads:3});
  await Promise.all(Array.from({length:120},(_,i)=>f.chain.call(store,'0x'+i.toString(16).padStart(4,'0'))));
  assert.ok(maximum<=3,`observed ${maximum} physical requests`);
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,120);
});
test('Retry-After retries the same pinned read and completed identical reads resume from bounded cache',async()=>{
  let reads=0;
  const f=setup(q=>q.method==='eth_chainId'?'0x7a69':q.method==='eth_getBlockByNumber'?block:++reads===1?new Response('',{status:429,headers:{'retry-after':'0'}}):'0x6000',{maxRetries:2,retryDelayMs:1});
  await f.chain.pinBlock();
  assert.deepEqual(await Promise.all([f.chain.call(store,'0x12'),f.chain.call(store,'0x12')]),['0x6000','0x6000']);
  assert.equal(await f.chain.call(store,'0x12'),'0x6000');
  assert.equal(reads,2);
  const calls=f.calls.filter(q=>q.method==='eth_call');
  assert.equal(calls.length,2);assert.ok(calls.every(q=>q.url===urls[0]));
  assert.ok(calls.every(q=>q.params[1].blockHash===block.hash&&q.params[1].requireCanonical===true));
});
test('cancellation rejects queued work without dispatching it',async()=>{
  const controller=new AbortController();let entered;
  const started=new Promise(r=>entered=r);
  const f=setup(async(q,_url,init)=>{if(q.method==='eth_chainId')return '0x7a69';entered();await new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});},{signal:controller.signal,maxConcurrentReads:1});
  const a=f.chain.call(store,'0x01'),b=f.chain.call(store,'0x02');
  const assertions=Promise.all([assert.rejects(a),assert.rejects(b)]);
  await started;controller.abort();await assertions;
  assert.equal(f.calls.filter(q=>q.method==='eth_call').length,1);
});
test('a timed-out uncooperative physical read retains its slot, fails boundedly and ignores its late success',async()=>{
  let complete,entered;
  const started=new Promise(r=>entered=r),late=new Promise(r=>complete=r);
  let attempt=0;
  const f=setup(async q=>{if(q.method==='eth_chainId')return '0x7a69';if(++attempt===1){entered();return late;}return '0x6000';},{maxConcurrentReads:1,timeoutMs:15});
  const first=assert.rejects(f.chain.call(store,'0x12'),e=>e.code==='timeout');await started;await first;
  await assert.rejects(f.chain.call(store,'0x12'),e=>e.noFallback===true);
  assert.equal(attempt,1);assert.equal(f.chain.disclosure().servedBy,null);
  complete('0x6001');await new Promise(r=>setImmediate(r));
  assert.equal(await f.chain.call(store,'0x12'),'0x6000');assert.equal(attempt,2);
});
