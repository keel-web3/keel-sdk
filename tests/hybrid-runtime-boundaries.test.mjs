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
