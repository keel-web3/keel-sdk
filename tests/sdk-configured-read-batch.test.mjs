import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeelScheduledReadTransport as create } from '../packages/sdk/dist/public-simulation-pool.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = (method = 'eth_call', n = 0) => ({ method, params: [{ to: `0x${'11'.repeat(20)}`, data: `0x${n.toString(16).padStart(2,'0')}` }, 'latest'] });
const scope = () => async () => { throw new Error('No network in this fixture'); };
function fixture(extra = {}, behavior = () => undefined) {
  const batches = [], singles = [], fetchImpl = scope();
  const options = { chainId: 11155111, rpcUrl: 'https://configured.example/PRIVATE', minIntervalMs: 0, batch: true, fetchImpl, ...extra };
  const transport = { request: async exact => { singles.push(exact); return exact; }, requestBatch: async exact => { batches.push(exact); return exact.map((item,index) => behavior(item,index) ?? { status: 'fulfilled', value: item }); } };
  return { ...transport, options, batches, singles, reader: create(transport, options) };
}
test('same-turn logical reads use one bounded physical admission without caching latest', async () => {
  const f = fixture(); const exact = Array.from({length:5},(_,n)=>input(n ? 'eth_call' : 'eth_getCode',n));
  assert.deepEqual(await Promise.all(exact.map(value=>f.reader.request(value))),exact);
  assert.equal(f.batches.length,1); assert.equal(f.singles.length,0);
  assert.deepEqual(await Promise.all(exact.map(value=>f.reader.request(value))),exact);assert.equal(f.batches.length,2);
});
test('single-read defaults remain unchanged and batch support must be explicit', async () => {
  const f=fixture(); const original=create(f,f.options.batch ? {...f.options,batch:false} : f.options);
  await Promise.all([original.request(input()),original.request(input())]);assert.equal(f.singles.length,2);assert.equal(f.batches.length,0);
  assert.throws(()=>create({request:async()=>1},{...f.options,batch:true}),/existing same-recipient/);
});
test('40 members split 16/16/8 while preserving exact per-item order and outcomes',async()=>{
 const f=fixture(), exact=Array.from({length:40},(_,n)=>input('eth_call',n));
 assert.deepEqual(await Promise.all(exact.map(value=>f.reader.request(value))),exact);assert.deepEqual(f.batches.map(b=>b.length),[16,16,8]);
});
test('aggregate budget counts UTF-8 and full envelope; large existing reads remain singleton',async()=>{
 const f=fixture({maximumRequestBytes:128*1024});const a={method:'eth_call',params:['界'.repeat(14000),'latest']};
 assert.deepEqual(await Promise.all([f.reader.request(a),f.reader.request(a)]),[a,a]);assert.equal(f.batches.length,0);assert.equal(f.singles.length,2);
});
test('request inputs are snapshotted before microtask batching',async()=>{
 const f=fixture(),a=input(),b=input('eth_getCode');const before=structuredClone(a);const pending=Promise.all([f.reader.request(a),f.reader.request(b)]);a.params[0].data='0xffff';
 assert.deepEqual((await pending)[0],before);assert.deepEqual(f.batches[0][0],before);
});
test('genuine contract revert remains its original member error and never retries',async()=>{
 const revert=Object.assign(new Error('execution reverted'),{code:3});const f=fixture({},(_item,index)=>index?{status:'rejected',reason:revert}:undefined);
 const results=await Promise.allSettled([f.reader.request(input()),f.reader.request(input('eth_call',1))]);assert.equal(results[0].status,'fulfilled');assert.equal(results[1].reason,revert);assert.equal(f.batches.length,1);
});
for(const code of [401,403])test(`HTTP200 JSON-RPC${code} outranks another revert and closes all queued provider reads`,async()=>{
 const revert=Object.assign(new Error('execution reverted'),{code:3}), denial=Object.assign(new Error('denied'),{code});const f=fixture({},(_item,index)=>({status:'rejected',reason:index?denial:revert}));
 const results=await Promise.allSettled([f.reader.request(input()),f.reader.request(input('eth_getCode'))]);assert.ok(results.every(item=>item.status==='rejected'&&item.reason===denial));
 await assert.rejects(f.reader.request(input('eth_chainId')),error=>error.reason==='access-denied');assert.equal(f.batches.length,1);assert.equal(f.singles.length,0);
});
test('unsupported member restricts only its actual method',async()=>{
 const missing=Object.assign(new Error('unsupported'),{code:-32601});const f=fixture({},item=>item.method==='eth_getCode'?{status:'rejected',reason:missing}:undefined);
 const result=await Promise.allSettled([f.reader.request(input('eth_chainId')),f.reader.request(input('eth_getCode'))]);assert.equal(result[0].status,'fulfilled');assert.equal(result[1].reason,missing);
 assert.deepEqual(await f.reader.request(input('eth_chainId')),input('eth_chainId'));await assert.rejects(f.reader.request(input('eth_getCode')),/rejected the required method/);assert.equal(f.singles.length,1);
});
test('429 member keeps original error and records unchanged shared cooldown without retry',async()=>{
 const rate=Object.assign(new Error('rate limited'),{status:429,retryAfterMs:20}),events=[];const f=fixture({observe:event=>events.push(event)},()=>({status:'rejected',reason:rate}));
 const result=await Promise.allSettled([f.reader.request(input()),f.reader.request(input('eth_getCode'))]);assert.ok(result.every(item=>item.reason===rate));assert.equal(f.batches.length,1);assert.ok(events.some(event=>event.type==='retry-wait'&&event.status==='cooldown'));
});
test('incomplete batch result cannot expose any success',async()=>{
 const f=fixture();const reader=create({...f,requestBatch:async()=>[{status:'fulfilled',value:'wrong member'}]},f.options);
 const results=await Promise.allSettled([reader.request(input()),reader.request(input('eth_getCode'))]);assert.ok(results.every(item=>item.status==='rejected'&&/incomplete member/.test(item.reason.message)));
});
test('pre-aborted owner batch never dispatches; another owner remains independent',async()=>{
 const controller=new AbortController();const f=fixture({signal:controller.signal});controller.abort(new Error('owner ended'));
 const outcomes=await Promise.allSettled([f.reader.request(input()),f.reader.request(input('eth_getCode'))]);assert.ok(outcomes.every(item=>item.status==='rejected'));assert.equal(f.batches.length+f.singles.length,0);
 const other=create(f,{...f.options,signal:new AbortController().signal});assert.deepEqual(await other.request(input('eth_chainId')),input('eth_chainId'));
});
test('noncooperative cancelled batch retains its one physical slot until settlement',async()=>{
 const controller=new AbortController(),f=fixture({signal:controller.signal});let release;const gate=new Promise(resolve=>{release=resolve;});let started;const began=new Promise(resolve=>{started=resolve;});
 const slow=create({...f,requestBatch:async exact=>{started();await gate;return exact.map(value=>({status:'fulfilled',value}));}},f.options);
 const rejected=Promise.allSettled([slow.request(input()),slow.request(input('eth_getCode'))]);await began;
 const other=create(f,{...f.options,signal:new AbortController().signal});const pending=other.request(input('eth_chainId'));controller.abort(new Error('cancelled owner'));
 assert.ok((await rejected).every(item=>item.status==='rejected'));await tick();assert.equal(f.singles.length,0,'Independent owner cannot overlap a physical noncooperative batch');release();assert.deepEqual(await pending,input('eth_chainId'));
});
test('bounded logical queue rejects excess before allocating unbounded batches',async()=>{
 const f=fixture();const outcomes=await Promise.allSettled(Array.from({length:65},(_,n)=>f.reader.request(input('eth_call',n))));
 assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,64);assert.equal(outcomes[64].reason.name,'KeelProviderQueueFullError');assert.deepEqual(f.batches.map(b=>b.length),[16,16,16,16]);
});
test('observed denial survives concurrent owner cancellation in shared admission state',async()=>{
 const controller=new AbortController(),denial=Object.assign(new Error('denied'),{status:403}),f=fixture({signal:controller.signal});
 const denied=create({...f,requestBatch:async()=>{controller.abort(new Error('owner cancelled'));return[{status:'rejected',reason:denial},{status:'fulfilled',value:1}];}},f.options);
 await Promise.allSettled([denied.request(input()),denied.request(input('eth_getCode'))]);const fresh=create(f,{...f.options,signal:new AbortController().signal});await assert.rejects(fresh.request(input('eth_chainId')),error=>error.reason==='access-denied');assert.equal(f.singles.length,0);
});

test('all unsupported members restrict their own actual methods even when another member is rate limited',async()=>{
 const missing=Object.assign(new Error('unsupported'),{code:-32601}),rate=Object.assign(new Error('rate'),{status:429,retryAfterMs:1});
 const f=fixture({},item=>({status:'rejected',reason:item.method==='eth_chainId'?rate:missing}));
 await Promise.allSettled([f.reader.request(input('eth_chainId')),f.reader.request(input('eth_getCode')),f.reader.request(input('eth_getProof'))]);
 await assert.rejects(f.reader.request(input('eth_getCode')),/rejected the required method/);await assert.rejects(f.reader.request(input('eth_getProof')),/rejected the required method/);assert.equal(f.singles.length,0);
});
for(const code of [401,403])test(`already observed ${code} in an incomplete result remains provider-wide terminal`,async()=>{
 const f=fixture(),denial=Object.assign(new Error('denied'),{code});const reader=create({...f,requestBatch:async()=>[{status:'rejected',reason:denial}]},f.options);
 const results=await Promise.allSettled([reader.request(input()),reader.request(input('eth_getCode'))]);assert.ok(results.every(item=>item.status==='rejected'&&item.reason===denial));
 await assert.rejects(f.reader.request(input('eth_chainId')),error=>error.reason==='access-denied');assert.equal(f.singles.length,0);
});
