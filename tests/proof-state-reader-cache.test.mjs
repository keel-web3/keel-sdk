import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApprovedProofStateReader} from '../native/proof-executor/state-reader.mjs';

const rpc='https://cache.example',paid='https://second.example',hash=`0x${'a1'.repeat(32)}`,otherHash=`0x${'b2'.repeat(32)}`,address=`0x${'c3'.repeat(20)}`,slot=`0x${'00'.repeat(32)}`;
const header={number:'0x4',hash},anchor={blockHash:hash,requireCanonical:true};
const query={method:'eth_getProof',params:[address,[slot],anchor]};
const proof=(account=address,slots=[slot])=>({address:account,accountProof:['0xc0'],storageProof:slots.map(key=>({key,value:'0x0',proof:['0xc0']}))});
function fixture(handle){
 const calls=[];
 const fetchImpl=async(url,init)=>{
  const request=JSON.parse(init.body);calls.push({url,...request});
  const response=await handle?.(request,url,init);
  if(response instanceof Response)return response;
  const result=response===undefined?(request.method==='eth_chainId'?'0xaa36a7':request.method.startsWith('eth_getBlock')?header:request.method==='eth_getCode'?'0x6000':proof(request.params[0],request.params[1])):response;
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
 };
 const options={rpcUrls:[rpc,paid],approvedStateRpcUrls:[rpc,paid],block:{number:4n,hash},fetchImpl,minIntervalMs:0};
 return {calls,options,reader:createApprovedProofStateReader(options)};
}
const count=(f,method)=>f.calls.filter(q=>q.method===method).length;

test('immutable queries reuse one successful response and deep-copy caller-owned arrays',async()=>{
 const f=fixture();try{
  const first=await f.reader.request(query);first.accountProof.push('0xff');first.storageProof[0].proof[0]='0xff';
  const next=await f.reader.request(structuredClone(query));assert.deepEqual(next,proof());assert.equal(count(f,'eth_getProof'),1);
  next.storageProof[0].proof.push('0xee');assert.deepEqual(await f.reader.request(query),proof());assert.equal(count(f,'eth_getProof'),1);
 }finally{f.reader.close();}
});

test('method/address/slot/hash keys are exact and case normalization does not change outgoing params',async()=>{
 const f=fixture();try{
  const upper=structuredClone(query);upper.params[0]=upper.params[0].toUpperCase();upper.params[2].blockHash=upper.params[2].blockHash.toUpperCase();
  await f.reader.request(upper);await f.reader.request(query);assert.equal(count(f,'eth_getProof'),1);assert.deepEqual(f.calls.find(q=>q.method==='eth_getProof').params,upper.params);
  await f.reader.request({...query,params:[address,[],anchor]});
  await f.reader.request({...query,params:[`0x${'d4'.repeat(20)}`,[slot],anchor]});
  await f.reader.request({method:'eth_getCode',params:[address,anchor]});
  assert.equal(count(f,'eth_getProof'),3);assert.equal(count(f,'eth_getCode'),1);
  await assert.rejects(f.reader.request({...query,params:[address,[slot],{...anchor,blockHash:otherHash}]}));assert.equal(count(f,'eth_getProof'),3);
 }finally{f.reader.close();}
});

test('chain/header/ancestor checks remain live while empty code is cached exactly',async()=>{
 const f=fixture(q=>q.method==='eth_getCode'?'0x':undefined);try{
  for(let i=0;i<2;i++){
   assert.equal(await f.reader.request({method:'eth_getCode',params:[address,anchor]}),'0x');
   await f.reader.request({method:'eth_chainId',params:[]});
   await f.reader.request({method:'eth_getBlockByNumber',params:[header.number,false]});
   await f.reader.request({method:'eth_getBlockByHash',params:[hash,false]});
  }
  assert.equal(count(f,'eth_getCode'),1);assert.equal(count(f,'eth_getBlockByHash'),2);assert.ok(count(f,'eth_getBlockByNumber')>=2);assert.ok(count(f,'eth_chainId')>=2);
 }finally{f.reader.close();}
});

for(const status of [401,403])test(`warmed response cannot bypass observed HTTP${status} or shop another approved recipient`,async()=>{
 let deny=false;const f=fixture(q=>deny&&q.method==='eth_getBlockByNumber'?new Response('',{status}):undefined);
 try{
  await f.reader.request(query);deny=true;
  await assert.rejects(f.reader.request({method:'eth_getBlockByNumber',params:[header.number,false]}));
  await assert.rejects(f.reader.request(query));assert.ok(f.calls.every(q=>q.url===rpc));assert.equal(count(f,'eth_getProof'),1);
 }finally{f.reader.close();}
});

test('warmed response cannot bypass an observed canonical reorg',async()=>{
 let reorg=false;const f=fixture(q=>reorg&&q.method==='eth_getBlockByNumber'?{...header,hash:otherHash}:undefined);
 try{
  await f.reader.request(query);reorg=true;
  await assert.rejects(f.reader.request({method:'eth_getBlockByNumber',params:[header.number,false]}),e=>e.kind==='chain-reorganized');
  await assert.rejects(f.reader.request(query),e=>e.kind==='chain-reorganized');assert.equal(count(f,'eth_getProof'),1);
 }finally{f.reader.close();}
});

test('separate readers never share response data even when their scheduler is shared',async()=>{
 const f=fixture(),second=createApprovedProofStateReader(f.options);
 try{await f.reader.request(query);await second.request(query);assert.equal(count(f,'eth_getProof'),2);}finally{f.reader.close();second.close();}
});

test('malformed proof/code result containers are never retained',async()=>{
 const f=fixture(q=>q.method==='eth_getProof'?{address:3,accountProof:['0xc0'],storageProof:[]}:q.method==='eth_getCode'?'not hex':undefined);
 try{
  for(let i=0;i<2;i++){await f.reader.request(query);await f.reader.request({method:'eth_getCode',params:[address,anchor]});}
  assert.equal(count(f,'eth_getProof'),2);assert.equal(count(f,'eth_getCode'),2);
 }finally{f.reader.close();}
});

test('close aborts a held response and prevents any late success',async()=>{
 let release;const hold=new Promise(resolve=>release=resolve);const f=fixture(q=>q.method==='eth_getProof'?hold:undefined);
 const pending=f.reader.request(query),rejected=assert.rejects(pending);
 while(!count(f,'eth_getProof'))await new Promise(resolve=>setImmediate(resolve));
 f.reader.close();release(proof());await rejected;
 await assert.rejects(f.reader.request(query));assert.equal(count(f,'eth_getProof'),1);
});

test('one canceled request cannot poison another in-flight caller or populate a stale cache epoch',async()=>{
 let first=true,release;const hold=new Promise(resolve=>release=resolve);
 const f=fixture(q=>q.method==='eth_getProof'&&first?(first=false,hold):undefined),controller=new AbortController();
 try{
  const pending=f.reader.request({...query,signal:controller.signal}),rejected=assert.rejects(pending);
  while(!count(f,'eth_getProof'))await new Promise(resolve=>setImmediate(resolve));
  controller.abort();release(proof());await rejected;
  assert.deepEqual(await f.reader.request(query),proof());assert.equal(count(f,'eth_getProof'),2);
 }finally{f.reader.close();}
});
