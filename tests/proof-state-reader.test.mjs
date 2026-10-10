import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createApprovedProofStateReader } from '../native/proof-executor/state-reader.mjs';

const urls=['https://public.example','https://paid.example/SECRET?key=PRIVATE'],hash=`0x${'11'.repeat(32)}`,address=`0x${'22'.repeat(20)}`,slot=`0x${'00'.repeat(32)}`;
const block={number:4n,hash},snapshot={number:'0x4',hash};
const read={method:'eth_getProof',params:[address,[slot],{blockHash:hash,requireCanonical:true}]};
function fixture(faults=[{},{}],approved=urls){
  const requests=[],attempts=[];
  const fetchImpl=async(url,init)=>{
    const index=urls.indexOf(url),request=JSON.parse(init.body);requests.push({index,...request});assert.notEqual(index,-1);
    const fault=faults[index],reply=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
    if(request.method==='eth_chainId')return reply(fault.chain??'0xaa36a7');
    if(request.method==='eth_getBlockByNumber')return reply(fault.reorg?{...snapshot,hash:`0x${'ff'.repeat(32)}`}:snapshot);
    if(fault.wait)return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    if(fault.status)return new Response('',{status:fault.status,headers:{'retry-after':'30'}});
    if(fault.code)return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:fault.code,message:'SECRET provider payload'}}));
    if(fault.large)return reply('X'.repeat(2*1024*1024));
    return reply({proof:'synthetic protocol sentinel'});
  };
  const options={rpcUrls:urls,approvedStateRpcUrls:approved,block,fetchImpl,minIntervalMs:0,onAttempt:value=>attempts.push(value)};
  return {options,requests,attempts,reader:createApprovedProofStateReader(options)};
}
test('public overload selects an already-approved paid proof source without remote execution',async()=>{
  const f=fixture([{status:429},{}]);assert.deepEqual(await f.reader.request(read),{proof:'synthetic protocol sentinel'});
  assert.deepEqual(f.requests.filter(r=>r.method==='eth_getProof').map(r=>r.index),[0,1]);
  assert.ok(f.requests.every(r=>['eth_chainId','eth_getBlockByNumber','eth_getProof'].includes(r.method)));
  const before=f.requests.filter(r=>r.index===0).length;f.reader.close();
  const retry=createApprovedProofStateReader(f.options);await retry.request(read);assert.equal(f.requests.filter(r=>r.index===0).length,before,'reload respects public Retry-After');retry.close();
});
test('configured paid credentials do not authorize disclosure to that recipient',async()=>{
  const f=fixture([{status:429},{}],[urls[0]]);await assert.rejects(f.reader.request(read));assert.ok(f.requests.every(r=>r.index===0));f.reader.close();
});
for(const status of [403,429])test(`paid HTTP ${status} stops within one attempt and retains restriction/cooldown`,async()=>{
  const f=fixture([{status:429},{status}]);await assert.rejects(f.reader.request(read));const before=f.requests.length;
  const serialized=JSON.stringify({status:f.reader.status(),attempts:f.attempts});assert.ok(!serialized.includes('SECRET')&&!serialized.includes('PRIVATE')&&!serialized.includes('paid.example'));
  f.reader.close();const retry=createApprovedProofStateReader(f.options);await assert.rejects(retry.request(read));assert.equal(f.requests.length,before);retry.close();
});
test('wrong-chain paid source never receives address/key reads',async()=>{
  const f=fixture([{status:429},{chain:'0x1'}]);await assert.rejects(f.reader.request(read));assert.ok(f.requests.filter(r=>r.index===1).every(r=>r.method==='eth_chainId'));f.reader.close();
});
test('source snapshot mismatch is terminal instead of shopping another provider',async()=>{
  const f=fixture([{reorg:true},{}]);await assert.rejects(f.reader.request(read),e=>e.kind==='chain-reorganized');assert.ok(f.requests.every(r=>r.index===0));f.reader.close();
});
test('invalid proof request is terminal, while unsupported proof method may use an approved alternative',async()=>{
  const invalid=fixture([{code:-32602},{}]);await assert.rejects(invalid.reader.request(read));assert.ok(invalid.requests.every(r=>r.index===0));invalid.reader.close();
  const unsupported=fixture([{code:-32601},{}]);await unsupported.reader.request(read);assert.deepEqual(unsupported.requests.filter(r=>r.method==='eth_getProof').map(r=>r.index),[0,1]);unsupported.reader.close();
});
test('bounded response failure can select only an eligible alternative',async()=>{
  const f=fixture([{large:true},{}]);await f.reader.request(read);assert.deepEqual(f.requests.filter(r=>r.method==='eth_getProof').map(r=>r.index),[0,1]);f.reader.close();
});
test('cancel stops a pending read without selecting paid; fresh retry retains the exact query',async()=>{
  const f=fixture([{wait:true},{}]),controller=new AbortController();
  const pending=f.reader.request({...read,signal:controller.signal}),rejected=assert.rejects(pending);
  while(!f.requests.some(r=>r.method==='eth_getProof'))await new Promise(resolve=>setImmediate(resolve));
  controller.abort();await rejected;assert.ok(f.requests.every(r=>r.index===0));f.reader.close();
  const next=fixture();await next.reader.request(read);assert.deepEqual(next.requests.find(r=>r.method==='eth_getProof').params,read.params);next.reader.close();
});
test('wallet, execution, unpinned and overscoped reads are rejected before any network request',async()=>{
  const f=fixture();
  for(const request of [{method:'eth_sendRawTransaction',params:['0x']},{method:'eth_call',params:[{data:'0xSECRET'},'latest']},{method:'eth_simulateV1',params:[]},{...read,params:[address,[slot],'latest']},{...read,params:[address,[slot,slot],read.params[2]]}])await assert.rejects(f.reader.request(request));
  assert.deepEqual(f.requests,[]);f.reader.close();
});

const publicFixture=JSON.parse(readFileSync(new URL('./fixtures/sepolia-public-proof-20261010.json',import.meta.url),'utf8'));
for(const method of ['eth_getProof','eth_getCode','eth_getBlockByHash'])test(`captured public null response for ${method} fails closed without another recipient or latest fallback`,async()=>{
  const calls=[],h=publicFixture.header;
  const fetchImpl=async(url,init)=>{
    const q=JSON.parse(init.body);calls.push({url,...q});
    const result=q.method==='eth_chainId'?'0xaa36a7':q.method==='eth_getBlockByNumber'?h:null;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  };
  const reader=createApprovedProofStateReader({rpcUrls:urls,approvedStateRpcUrls:urls,block:{number:BigInt(h.number),hash:h.hash},fetchImpl,minIntervalMs:0});
  const anchor={blockHash:h.hash,requireCanonical:true};
  const params=method==='eth_getProof'?[publicFixture.address,[publicFixture.slot],anchor]:method==='eth_getCode'?[publicFixture.address,anchor]:[h.hash,false];
  try{
    await assert.rejects(reader.request({method,params}),e=>e.kind==='rpc-unavailable');
    assert.ok(calls.every(c=>c.url===urls[0]));
    assert.equal(calls.filter(c=>c.method===method).length,1);
    assert.ok(calls.every(c=>!c.params.includes('latest')));
  }finally{reader.close();}
});
test('the captured public header, proof and code survive approved-reader framing without dropping Amsterdam fields',async()=>{
  const h=publicFixture.header,calls=[];
  const fetchImpl=async(url,init)=>{
    const q=JSON.parse(init.body);calls.push(q);
    const result=q.method==='eth_chainId'?'0xaa36a7':q.method==='eth_getProof'?publicFixture.proof:q.method==='eth_getCode'?publicFixture.code:h;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
  };
  const reader=createApprovedProofStateReader({rpcUrls:[urls[0]],approvedStateRpcUrls:[urls[0]],block:{number:BigInt(h.number),hash:h.hash},fetchImpl,minIntervalMs:0});
  const anchor={blockHash:h.hash,requireCanonical:true};
  try{
    assert.deepEqual(await reader.request({method:'eth_getBlockByNumber',params:[h.number,false]}),h);
    assert.deepEqual(await reader.request({method:'eth_getProof',params:[publicFixture.address,[publicFixture.slot],anchor]}),publicFixture.proof);
    assert.equal(await reader.request({method:'eth_getCode',params:[publicFixture.address,anchor]}),publicFixture.code);
    assert.ok(h.blockAccessListHash&&h.slotNumber);
    assert.ok(calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getProof','eth_getCode'].includes(c.method)));
  }finally{reader.close();}
});
