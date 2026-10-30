import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeelRpcPool, KeelRpcQueueFullError, KeelRpcQueueTimeoutError, KeelRpcResponseError } from '../packages/sdk/dist/rpc.js';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';

const chain='0xaa36a7', url='https://public.example', paid='https://paid.example/private', hash='0x'+'ab'.repeat(32), address='0x'+'cd'.repeat(20), slot='0x'+'00'.repeat(32), anchor={blockHash:hash,requireCanonical:true};
const proof={address,accountProof:['0xc0'],storageProof:[{key:slot,value:'0x0',proof:['0xc0']}]};
const reply=(q,result)=>Response.json({jsonrpc:'2.0',id:q.id,result});
const error=(q,status,code,message,headers={})=>new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code,message}}),{status,headers:{'content-type':'application/json',...headers}});
const fetchFixture=handler=>{const calls=[];return {calls,fetchImpl:async(u,init)=>{const q=JSON.parse(init.body);calls.push({url:u,...q});return handler(u,q,init)}}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('structured HTTP 429 quota cools down and never permanently disables the source',async t=>{
 let now=Date.now(),first=true;t.mock.method(Date,'now',()=>now);
 const f=fetchFixture((_u,q)=>q.method==='eth_chainId'?reply(q,chain):first?(first=false,error(q,429,-32029,'API key quota exceeded',{ 'retry-after':'3' })):reply(q,'0x6000'));
 const p=createKeelRpcPool({rpcUrls:[url],chainId:11155111,minIntervalMs:0,fetchImpl:f.fetchImpl});
 await assert.rejects(p.request({method:'eth_getCode',params:[address,'latest']}),e=>e.reason==='rate-limited'&&e.diagnostic.httpStatus===429);
 assert.equal(p.status()[0].disabled,false);assert.ok(p.status()[0].retryAfterMs>=3000);const count=f.calls.length;
 await assert.rejects(p.request({method:'eth_getCode',params:[address,'latest']}));assert.equal(f.calls.length,count);
 now+=3001;assert.equal(await p.request({method:'eth_getCode',params:[address,'latest']}),'0x6000');
 assert.doesNotMatch(JSON.stringify(p.status()),/quota|private/u);
});

for(const [status,code,message] of [[403,-32029,'API key quota exceeded'],[429,403,'rate limit'],[429,-32029,'API key is not authorized']]) test(`explicit denial remains terminal with HTTP ${status}`,async()=>{
 const f=fetchFixture((_u,q)=>q.method==='eth_chainId'?reply(q,chain):error(q,status,code,message));
 const p=createKeelRpcPool({rpcUrls:[url],chainId:11155111,minIntervalMs:0,fetchImpl:f.fetchImpl});
 await assert.rejects(p.pin(0).request({method:'eth_getCode',params:[address,'latest']}),e=>e.reason==='access-denied');
 assert.equal(p.status()[0].disabled,true);const count=f.calls.length;await assert.rejects(p.pin(0).request({method:'eth_getCode',params:[address,'latest']}));assert.equal(f.calls.length,count);
});

test('deterministic revert does not become retryable because its prose mentions a quota',async()=>{
 const f=fetchFixture((_u,q)=>q.method==='eth_chainId'?reply(q,chain):error(q,429,3,'execution reverted: API key quota exceeded'));
 const p=createKeelRpcPool({rpcUrls:[url],chainId:11155111,minIntervalMs:0,fetchImpl:f.fetchImpl});
 await assert.rejects(p.pin(0).request({method:'eth_call',params:[{},'latest']}),e=>e instanceof KeelRpcResponseError&&e.code===3);assert.equal(p.status()[0].disabled,false);
});

test('per-provider queue is bounded, cancellations remove waiters, and local overflow does not poison health',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});let first=true;
 const f=fetchFixture(async(_u,q)=>{if(q.method==='eth_chainId')return reply(q,chain);if(first){first=false;await gate;}return reply(q,'0x6000')});
 const p=createKeelRpcPool({rpcUrls:[url],chainId:11155111,minIntervalMs:0,maximumQueuedRequests:2,fetchImpl:f.fetchImpl});await p.request({method:'eth_chainId'});
 const one=p.request({method:'eth_getCode',params:[address,'latest']});await tick();const ac=new AbortController(),two=p.request({method:'eth_getCode',params:[address,'latest'],signal:ac.signal});const cancelled=assert.rejects(two);const three=p.request({method:'eth_getCode',params:[address,'latest']});await tick();
 await assert.rejects(p.request({method:'eth_getCode',params:[address,'latest']}),KeelRpcQueueFullError);assert.equal(p.status()[0].disabled,false);ac.abort();await cancelled;
 const four=p.request({method:'eth_getCode',params:[address,'latest']});release();assert.deepEqual(await Promise.all([one,three,four]),['0x6000','0x6000','0x6000']);assert.equal(p.status()[0].disabled,false);
});

test('queue wait deadline removes work without dispatching or marking the provider unhealthy',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});let first=true;
 const f=fetchFixture(async(_u,q)=>{if(q.method==='eth_chainId')return reply(q,chain);if(first){first=false;await gate;}return reply(q,'0x6000')});
 const p=createKeelRpcPool({rpcUrls:[url],chainId:11155111,minIntervalMs:0,maximumQueueWaitMs:25,fetchImpl:f.fetchImpl});await p.request({method:'eth_chainId'});
 const active=p.request({method:'eth_getCode',params:[address,'latest']});await tick();const before=f.calls.length;
 await assert.rejects(p.request({method:'eth_getCode',params:[address,'latest']}),KeelRpcQueueTimeoutError);assert.equal(f.calls.length,before);assert.equal(p.status()[0].disabled,false);
 release();assert.equal(await active,'0x6000');assert.equal(await p.request({method:'eth_getCode',params:[address,'latest']}),'0x6000');
});

test('identical proof requests with one cancellation owner share a physical read and return independent copies',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});const f=fetchFixture(async(_u,q)=>{if(q.method==='eth_chainId')return reply(q,chain);if(q.method==='eth_getBlockByNumber')return reply(q,{number:'0x4',hash});if(q.method==='eth_getProof'){await gate;return reply(q,proof)}throw Error('unexpected')});
 const reader=createApprovedProofStateReader({rpcUrls:[url],approvedStateRpcUrls:[url],block:{number:4n,hash},minIntervalMs:0,fetchImpl:f.fetchImpl});
 try{const query={method:'eth_getProof',params:[address,[slot],anchor]},a=reader.request(query),b=reader.request(structuredClone(query));await tick();release();const [x,y]=await Promise.all([a,b]);x.accountProof.push('0xff');assert.deepEqual(y,proof);assert.equal(f.calls.filter(v=>v.method==='eth_getProof').length,1);}finally{reader.close()}
});

test('different cancellation owners do not share a read or cancel one another',async()=>{
 let entered,started=new Promise(resolve=>{entered=resolve}),first=true;
 const f=fetchFixture(async(_u,q,init)=>{if(q.method==='eth_chainId')return reply(q,chain);if(q.method==='eth_getBlockByNumber')return reply(q,{number:'0x4',hash});if(q.method==='eth_getProof'&&first){first=false;entered();return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}if(q.method==='eth_getProof')return reply(q,proof);throw Error('unexpected')});
 const reader=createApprovedProofStateReader({rpcUrls:[url],approvedStateRpcUrls:[url],block:{number:4n,hash},minIntervalMs:0,fetchImpl:f.fetchImpl});const a=new AbortController(),b=new AbortController();
 try{const query={method:'eth_getProof',params:[address,[slot],anchor]},one=reader.request({...query,signal:a.signal}),failed=assert.rejects(one),two=reader.request({...query,signal:b.signal});await started;a.abort();await failed;assert.deepEqual(await two,proof);assert.equal(b.signal.aborted,false);assert.equal(f.calls.filter(v=>v.method==='eth_getProof').length,2);}finally{reader.close()}
});

test('approved public source is first; fallback must match the same pinned block',async()=>{
 const f=fetchFixture((u,q)=>q.method==='eth_chainId'?reply(q,chain):q.method==='eth_getBlockByNumber'?reply(q,{number:'0x4',hash:u===paid?'0x'+'ff'.repeat(32):hash}):u===url?error(q,429,-32029,'quota exceeded',{'retry-after':'30'}):reply(q,proof));
 const reader=createApprovedProofStateReader({rpcUrls:[url,paid],approvedStateRpcUrls:[url,paid],block:{number:4n,hash},minIntervalMs:0,fetchImpl:f.fetchImpl});
 try{await assert.rejects(reader.request({method:'eth_getProof',params:[address,[slot],anchor]}),e=>e.kind==='chain-reorganized');assert.equal(f.calls.filter(v=>v.url===paid&&v.method==='eth_getProof').length,0);assert.equal(f.calls.find(v=>v.method==='eth_getProof').url,url);}finally{reader.close()}
});

test('one short sole-source rate limit is retried once after cooldown without changing the pin',async()=>{
 let faults=0,draws=0;const f=fetchFixture((_u,q)=>q.method==='eth_chainId'?reply(q,chain):q.method==='eth_getBlockByNumber'?reply(q,{number:'0x4',hash}):faults++===0?error(q,429,-32029,'API key quota exceeded',{'retry-after':'0'}):reply(q,proof));
 const reader=createApprovedProofStateReader({rpcUrls:[url],approvedStateRpcUrls:[url],block:{number:4n,hash},minIntervalMs:0,fetchImpl:f.fetchImpl,random:()=>{draws++;return 0}});
 try{assert.deepEqual(await reader.request({method:'eth_getProof',params:[address,[slot],anchor]}),proof);assert.equal(f.calls.filter(v=>v.method==='eth_getProof').length,2);assert.ok(f.calls.filter(v=>v.method==='eth_getBlockByNumber').length>=2);assert.equal(draws,1);}finally{reader.close()}
});

test('aborting a short cooldown prevents a second provider request',async()=>{
 let limited;const observed=new Promise(resolve=>{limited=resolve});const f=fetchFixture((_u,q)=>q.method==='eth_chainId'?reply(q,chain):q.method==='eth_getBlockByNumber'?reply(q,{number:'0x4',hash}):(limited(),error(q,429,-32029,'quota exceeded',{'retry-after':'0'})));
 const reader=createApprovedProofStateReader({rpcUrls:[url],approvedStateRpcUrls:[url],block:{number:4n,hash},minIntervalMs:0,fetchImpl:f.fetchImpl});const ac=new AbortController();
 try{const p=reader.request({method:'eth_getProof',params:[address,[slot],anchor],signal:ac.signal}),failed=assert.rejects(p);await observed;await tick();ac.abort();await failed;await new Promise(r=>setTimeout(r,30));assert.equal(f.calls.filter(v=>v.method==='eth_getProof').length,1);}finally{reader.close()}
});
