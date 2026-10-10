import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, keccak256 } from 'viem';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { createKeelPublicSepoliaSimulationPool } from '../packages/sdk/dist/public-simulation-pool.js';
import { simulateKeelPublicationBeforeFunding } from '../packages/sdk/dist/publication-preflight.js';

const hash = n => `0x${BigInt(n).toString(16).padStart(64,'0')}`;
const zero = `0x${'0'.repeat(40)}`, owner = `0x${'11'.repeat(20)}`, reader = `0x${'22'.repeat(20)}`;
const gas = '0xbebc200', snapshot = { number:'0x12', hash:hash(99), timestamp:'0x6ac79200', gasLimit:gas, baseFeePerGas:'0xf', slotNumber:'0xa' };
const urls = ['https://first.example/SECRET','https://second.example/PRIVATE','https://third.example'];
const tokenURI = 'data:application/json,{"name":"Pool fixture"}';
const call = (i=0) => ({from:owner,to:reader,data:'0xbeef',value:'0x0',gas,nonce:`0x${i.toString(16)}`,gasPrice:'0x30'});
const program = () => ({method:'eth_simulateV1',params:[{blockStateCalls:[0,1,2,3,4].map(i=>({calls:[call(i)]})),validation:false,traceTransfers:false,returnFullTransactions:true},snapshot.number]});
const fullPlan = () => ({chainId:11155111,blockNumber:18n,reader,readerRuntimeCodeHash:keccak256('0x6000'),planFingerprint:hash(700),
  preparationCalls:[0,1,2,3,4].map(call),assertions:[0,1,2,3,4].map(i=>({callIndex:i,returnData:encodeAbiParameters([{type:'uint256'}],[BigInt((i+1)*100)])})),
  requiredReaderCalls:[{call:{...call(),nonce:undefined,data:'0xdddd',gas:'0xf4240'},expectedReturn:encodeAbiParameters([{type:'uint256'}],[500n]),gasMargin:10000n}],
  metadataCall:{...call(),nonce:undefined,data:'0xeeee',gas:'0xf4240'},expectedTokenURI:tokenURI,maximumTokenUriBytes:2000000,maximumReadGas:1000000n,collectionOverheadGas:10000n,maximumTransactionGas:200000000n});
function fixture(faults=[{},{}], approved=urls.slice(0,faults.length)) {
  const requests=[]; const privateRequests=()=>requests.filter(r=>r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls[0].calls[0].data!=='0x');
  const fetchImpl=async(url,init)=>{
    const index=urls.indexOf(url), fault=faults[index], body=JSON.parse(init.body);
    requests.push({index,body,wire:init.body});
    const respond=(result)=>Response.json({jsonrpc:'2.0',id:body.id,result});
    const error=(code,message='SECRET provider error')=>Response.json({jsonrpc:'2.0',id:body.id,error:{code,message}});
    if(fault.rate) return new Response('',{status:429,headers:{'retry-after':'30'}});
    if(body.method==='eth_chainId') return respond(fault.chain?'0x1':'0xaa36a7');
    if(body.method==='eth_getBlockByNumber') return respond(fault.pin&&body.params[0]!=='latest'?{...snapshot,hash:hash(1000)}:snapshot);
    if(body.method==='eth_getBalance') return respond(`0x${'f'.repeat(32)}`);
    if(body.method==='eth_getTransactionCount') return respond('0x0');
    if(body.method==='eth_getCode') return respond(body.params[0]===zero?'0x':'0x6000');
    assert.equal(body.method,'eth_simulateV1');
    const blocks=body.params[0].blockStateCalls, privateCall=blocks[0].calls[0].data!=='0x';
    if(!privateCall&&fault.unsupported) return error(-32601);
    if(!privateCall&&blocks.length===1&&blocks[0].calls[0].nonce==='0x1'&&!fault.ignoreNonce) return error(-38011);
    if(privateCall&&fault.error) return error(fault.error);
    if(privateCall&&fault.http) return new Response('',{status:fault.http});
    if(privateCall&&fault.wait) { fault.started?.(); await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})); }
    const result=blocks.map((b,i)=>({number:`0x${(19+i).toString(16)}`,timestamp:`0x${(BigInt(snapshot.timestamp)+12n*BigInt(i+1)).toString(16)}`,hash:hash(i+1),parentHash:i?hash(i):snapshot.hash,
      blockAccessListHash:hash(i+10),slotNumber:`0x${(11+i).toString(16)}`,
      transactions:b.calls.map(c=>({...c,gas:!privateCall&&fault.cap&&BigInt(c.gas)>50000000n?'0x2faf080':!privateCall&&fault.sequenceCap&&blocks.length>=5&&i===4?'0x1':privateCall&&fault.aggregate&&i===4?'0x1':c.gas})),
      calls:b.calls.map(c=>({status:privateCall&&fault.revert?'0x0':'0x1',gasUsed:'0x5208',...(!privateCall&&fault.noPreRefund?{}:{maxUsedGas:'0x5208'}),returnData:!privateCall?'0x':c.data==='0xeeee'?encodeAbiParameters([{type:'string'}],[fault.metadata??tokenURI]):encodeAbiParameters([{type:'uint256'}],[c.data==='0xdddd'?500n:BigInt((i+1)*100)])}))}));
    return respond(result);
  };
  const readTransport={request:async r=>r.method==='eth_chainId'?'0xaa36a7':r.method==='eth_getBlockByNumber'?snapshot:'0x6000'};
  const options={rpcUrls:urls.slice(0,faults.length),approvedProjectRpcUrls:approved,readTransport,block:{number:18n,hash:snapshot.hash},fetchImpl,minIntervalMs:0};
  return {requests,privateRequests,options,transport:createKeelPublicSepoliaSimulationPool(options)};
}

test('pinned pool candidate cannot silently fail over during qualification; strict nonce and balance errors retain codes',async()=>{
  for(const code of [-38011,-38014,-38010]) {
    const seen=[];
    const pool=createKeelRpcPool({rpcUrls:urls.slice(0,2),chainId:11155111,minIntervalMs:0,fetchImpl:async(url,init)=>{
      seen.push(url);const body=JSON.parse(init.body);return Response.json({jsonrpc:'2.0',id:body.id,...body.method==='eth_chainId'?{result:'0xaa36a7'}:{error:{code,message:'PRIVATE secret'}}});}});
    await assert.rejects(pool.pin(0).request(program()),e=>e.code===code&&!/PRIVATE|secret/.test(e.message));
    assert.ok(seen.every(url=>url===urls[0]));assert.throws(()=>pool.pin(3),RangeError);
  }
});
test('public capacity or unsupported candidate swaps before any private data; complete SDK proof survives selection',async()=>{
  for(const fault of [{cap:true},{unsupported:true},{ignoreNonce:true},{noPreRefund:true},{rate:true},{chain:true},{pin:true}]) {
    const f=fixture([fault,{}]);
    try { const proof=await simulateKeelPublicationBeforeFunding(fullPlan(),f.transport);
      assert.equal(proof.schema,'keel-publication-simulation@1');assert.equal(proof.signing,'not-performed');assert.equal(proof.submission,'not-performed');
      assert.ok(f.privateRequests().every(r=>r.index===1));
      assert.deepEqual(f.privateRequests().map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,5],[true,5],[false,7]]);
    } finally {await f.transport.close();}
  }
});
test('aggregate clamp after successful empty probes swaps the WHOLE unchanged request, never a continuation',async()=>{
  const f=fixture([{aggregate:true},{}]);
  try { const input=program();await f.transport.request(input);
    const sent=f.privateRequests();assert.equal(sent.length,2);assert.deepEqual(sent.map(r=>r.index),[0,1]);
    assert.deepEqual(sent[0].body.params,input.params);assert.deepEqual(sent[1].body.params,input.params);
    assert.ok(sent.every(r=>r.body.params[0].blockStateCalls.length===5));
    await f.transport.request(input);assert.equal(f.privateRequests().at(-1).index,1,'successful candidate stays selected');
  } finally {await f.transport.close();}
});
test('a larger aggregate sequence is publicly requalified even when its largest envelope is unchanged',async()=>{
  const f=fixture([{sequenceCap:true},{}]);try{
    const small=program();small.params[0].blockStateCalls.length=2;await f.transport.request(small);
    await f.transport.request(program());
    assert.deepEqual(f.privateRequests().map(r=>[r.index,r.body.params[0].blockStateCalls.length]),[[0,2],[1,5]]);
    assert.ok(f.requests.some(r=>r.index===0&&r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls.length===5&&r.body.params[0].blockStateCalls[0].calls[0].data==='0x'));
  }finally{await f.transport.close();}
});
test('body limit and transport outage swap complete programs; specific capacity evidence survives pool exhaustion',async()=>{
  for(const http of [413,503]) {const f=fixture([{http},{}]);try{await f.transport.request(program());assert.deepEqual(f.privateRequests().map(r=>r.index),[0,1]);}finally{await f.transport.close();}}
  const f=fixture([{http:413},{unsupported:true}]);try{await assert.rejects(f.transport.request(program()),e=>e.kind==='provider-limit'&&e.diagnostic.httpStatus===413);}finally{await f.transport.close();}
});
test('public qualification never grants disclosure to another indexed recipient',async()=>{
  const f=fixture([{cap:true},{}],[urls[0]]);
  try {await assert.rejects(f.transport.request(program()),e=>e.kind==='configuration-invalid'&&e.diagnostic.recipientApprovalRequired===1);
    assert.equal(f.privateRequests().length,0);assert.ok(f.requests.some(r=>r.index===1&&r.body.method==='eth_simulateV1'));
  }finally{await f.transport.close();}
});
test('contract revert, transaction validation failure and exact metadata mismatch never search for a passing backend',async()=>{
  for(const fault of [{error:3},{error:-38011},{error:-38014},{revert:true},{metadata:'wrong'}]) {
    const f=fixture([fault,{}]);try{await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),f.transport));assert.ok(f.requests.every(r=>r.index===0));}finally{await f.transport.close();}
  }
});
test('cancel stops an in-flight request without another recipient; a fresh saved-plan retry can pass',async()=>{
  let started;const begin=new Promise(resolve=>{started=resolve});const f=fixture([{wait:true,started},{}]);
  const pending=f.transport.request(program());await begin;await f.transport.close();await assert.rejects(pending,e=>e.kind==='rpc-unavailable');
  assert.ok(f.requests.every(r=>r.index===0));const fresh=fixture([{},{}]);try{await fresh.transport.request(program());}finally{await fresh.transport.close();}
});
test('input mutation, overrides, symbolic blocks and signing cannot alter or escape the bounded program',async()=>{
  const f=fixture([{},{}]);try{const input=program(),expected=structuredClone(input);const pending=f.transport.request(input);input.params[0].blockStateCalls[0].calls[0].data='0xffff';await pending;
    assert.deepEqual(f.privateRequests()[0].body.params,expected.params);
    for(const change of [p=>{p.params[1]='latest'},p=>{p.params[0].stateOverrides={}},p=>{p.params[0].blockStateCalls[0].stateOverrides={}},p=>{p.method='eth_sendRawTransaction'}]) {
      const p=program();change(p);const count=f.requests.length;await assert.rejects(f.transport.request(p),e=>e.kind==='configuration-invalid');assert.equal(f.requests.length,count);
    }
  }finally{await f.transport.close();}
});
