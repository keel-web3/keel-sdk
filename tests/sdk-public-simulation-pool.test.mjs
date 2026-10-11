import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256 } from 'viem';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { createKeelSepoliaSimulationTransport } from '../packages/sdk/dist/sepolia-simulation-transport.js';
const { createKeelPublicSepoliaSimulationPool } = await import(process.env.KEEL_TEST_PUBLIC_SIMULATION_POOL_MODULE ?? '../packages/sdk/dist/public-simulation-pool.js');
const { simulateKeelPublicationBeforeFunding } = await import(process.env.KEEL_TEST_PUBLICATION_PREFLIGHT_MODULE ?? '../packages/sdk/dist/publication-preflight.js');
import { APPROVED_PUBLICNODE_SEPOLIA_URL, probePublicSimulationCandidates, publicProbeOptions, publicProbeExitCode } from '../scripts/check-public-simulation-pool.mjs';

const hash = n => `0x${BigInt(n).toString(16).padStart(64,'0')}`;
const zero = `0x${'0'.repeat(40)}`, owner = `0x${'11'.repeat(20)}`, reader = `0x${'22'.repeat(20)}`;
const gas = '0xbebc200', snapshot = { number:'0x12', hash:hash(99), timestamp:`0x${Math.floor(Date.now()/1000).toString(16)}`, gasLimit:gas, baseFeePerGas:'0xf', slotNumber:'0xa' };
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
    if(body.method==='eth_getBlockByNumber') return respond(fault.stale?{...snapshot,timestamp:'0x68f00000'}:fault.future?{...snapshot,timestamp:`0x${(BigInt(snapshot.timestamp)+600n).toString(16)}`}:fault.pin&&body.params[0]!=='latest'?{...snapshot,hash:hash(1000)}:snapshot);
    if(body.method==='eth_getBalance') return respond(`0x${'f'.repeat(32)}`);
    if(body.method==='eth_getTransactionCount') return respond('0x0');
    if(body.method==='eth_getCode') return respond(body.params[0]===zero?'0x':'0x6000');
    if(body.method==='eth_estimateGas') return fault.error ? error(fault.error,fault.message) : respond(fault.estimate ?? '0x3d0900');
    assert.equal(body.method,'eth_simulateV1');
    const blocks=body.params[0].blockStateCalls, privateCall=blocks[0].calls[0].data!=='0x';
    if(!privateCall&&fault.publicHttp) return new Response('',{status:fault.publicHttp});
    if(!privateCall&&fault.unsupported) return error(-32601);
    if(!privateCall&&blocks.length===1&&blocks[0].calls[0].nonce==='0x1'&&!fault.ignoreNonce) return error(-38011);
    if(privateCall&&fault.error) return error(fault.error,fault.message);
    if(privateCall&&fault.http) return new Response('',{status:fault.http});
    if(privateCall&&fault.wait) { fault.started?.(); await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})); }
    const result=blocks.map((b,i)=>({number:`0x${(19+i).toString(16)}`,timestamp:`0x${(BigInt(snapshot.timestamp)+12n*BigInt(i+1)).toString(16)}`,hash:hash(i+1),parentHash:i?hash(i):snapshot.hash,
      blockAccessListHash:hash(i+10),slotNumber:`0x${(11+i).toString(16)}`,
      transactions:b.calls.map(c=>({...c,gas:fault.cap&&BigInt(c.gas)>(fault.capacityGas??50000000n)?`0x${(fault.capacityGas??50000000n).toString(16)}`:!privateCall&&fault.sequenceCap&&blocks.length>=5&&i===4?'0x1':privateCall&&fault.aggregate&&i===4?'0x1':c.gas})),
      calls:b.calls.map(c=>({status:privateCall&&fault.revert?'0x0':'0x1',gasUsed:'0x5208',...(!privateCall&&fault.noPreRefund?{}:{maxUsedGas:'0x5208'}),returnData:!privateCall?'0x':c.data==='0xeeee'?encodeAbiParameters([{type:'string'}],[fault.metadata??tokenURI]):encodeAbiParameters([{type:'uint256'}],[c.data==='0xdddd'?500n:BigInt((i+1)*100)])}))}));
    if(fault.sharedBudget!==undefined) {
      // Geth's gasBudget is shared across blocks, and consumes used gas after
      // each call. These are synthetic responses, not captured project bytes.
      let remaining=privateCall&&body.params[0].validation&&fault.strictBudget!==undefined?fault.strictBudget:fault.sharedBudget;
      for(const [i,b] of blocks.entries()) for(const [j,c] of b.calls.entries()) {
        const requested=BigInt(c.gas),allowed=requested<remaining?requested:remaining;
        const demand=privateCall?(fault.projectGasByCall?.[i]??fault.projectGas??21000n):12000n,used=demand<allowed?demand:allowed;
        result[i].transactions[j].gas=`0x${allowed.toString(16)}`;
        Object.assign(result[i].calls[j],{gasUsed:`0x${used.toString(16)}`,maxUsedGas:`0x${used.toString(16)}`});
        if(demand>allowed) Object.assign(result[i].calls[j],{status:'0x0',returnData:'0x',error:{code:-32000,message:'synthetic out of gas'}});
        remaining-=used;
      }
    }
    if(privateCall&&fault.missingProjectMaximumAt!==undefined)delete result[fault.missingProjectMaximumAt].calls[0].maxUsedGas;
    if(!privateCall&&blocks.length===40) {
      if(fault.longStatus) result[39].calls[0].status='0x0';
      if(fault.longHeader) result[39].parentHash=hash(500);
      if(fault.longNonce) result[39].transactions[0].nonce='0x0';
      if(fault.longFee) result[39].transactions[0].gasPrice='0x1';
      if(fault.longGas) result[39].transactions[0].gas='0x5208';
      if(fault.longPreRefund) delete result[39].calls[0].maxUsedGas;
    }
    return respond(result);
  };
  const readTransport={request:async r=>r.method==='eth_chainId'?'0xaa36a7':r.method==='eth_getBlockByNumber'?snapshot:'0x6000'};
  const options={rpcUrls:urls.slice(0,faults.length),approvedProjectRpcUrls:approved,readTransport,block:{number:18n,hash:snapshot.hash},fetchImpl,minIntervalMs:0};
  return {requests,privateRequests,options,transport:createKeelPublicSepoliaSimulationPool(options)};
}

function singleRecipientTransient({ fault, repeat = false, requestTimeoutMs, onAttempt, beforeResponse } = {}) {
  const f = fixture([{}]);
  let privateAttempts = 0;
  const transport = createKeelPublicSepoliaSimulationPool({ ...f.options,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }), ...(onAttempt ? { onAttempt } : {}),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      const project = body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x';
      if (project) {
        privateAttempts++;
        if (fault && (privateAttempts === 1 || repeat)) {
          f.requests.push({ index: 0, body, wire: init.body });
          if (fault instanceof Error) throw fault;
          return new Response('SECRET transport body', { status: fault });
        }
        await beforeResponse?.({ body, init });
      }
      return f.options.fetchImpl(url, init);
    },
  });
  return { ...f, transport, privateAttempts: () => privateAttempts };
}

test('one approved recipient automatically recovers an observed transient failure with fresh qualification and the complete immutable program', async () => {
  for (const fault of [502, 503, 504, Object.assign(new Error('SECRET socket timeout'), { code: 'ETIMEDOUT' }), Object.assign(new Error('SECRET socket reset'), { code: 'ECONNRESET' })]) {
    const f = singleRecipientTransient({ fault }), input = fullPlan(), before = structuredClone(input);
    try {
      const proof = await simulateKeelPublicationBeforeFunding(input, f.transport);
      assert.equal(proof.state, 'ephemeral-simulation'); assert.equal(proof.submission, 'not-performed');
      assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(tokenURI));
      assert.deepEqual(input, before); assert.equal(f.privateAttempts(), 4);
      const projects = f.privateRequests();
      assert.deepEqual(projects[0].body.params, projects[1].body.params);
      assert.deepEqual(projects.map(request => request.index), [0, 0, 0, 0]);
      const between = f.requests.slice(f.requests.indexOf(projects[0]) + 1, f.requests.indexOf(projects[1]));
      assert.ok(between.some(request => request.body.method === 'eth_chainId'));
      assert.ok(between.some(request => request.body.method === 'eth_simulateV1' && request.body.params[0].validation
        && request.body.params[0].blockStateCalls.length === 1 && request.body.params[0].blockStateCalls[0].calls[0].nonce === '0x1'));
    } finally { await f.transport.close(); }
  }
});

test('same-recipient recovery is attempted at most once and never infers an outage from an unknown failure', async () => {
  const repeat = singleRecipientTransient({ fault: 503, repeat: true });
  try {
    await assert.rejects(repeat.transport.request(program()), error => error.kind === 'rpc-unavailable' && error.diagnostic.httpStatus === 503);
    assert.equal(repeat.privateAttempts(), 2);
  } finally { await repeat.transport.close(); }
  for (const fault of [new Error('SECRET unknown'), Object.assign(new Error('SECRET dns'), { code: 'ENOTFOUND' }), 500, 400, 422]) {
    const f = singleRecipientTransient({ fault });
    try { await assert.rejects(f.transport.request(program())); assert.equal(f.privateAttempts(), 1); }
    finally { await f.transport.close(); }
  }
});

test('a cooldown that cannot fit the whole-request deadline returns the observed failure without retry', async () => {
  const f = singleRecipientTransient({ fault: 503, requestTimeoutMs: 100 });
  try {
    await assert.rejects(f.transport.request(program()), error => error.kind === 'rpc-unavailable' && error.diagnostic.httpStatus === 503);
    assert.equal(f.privateAttempts(), 1);
  } finally { await f.transport.close(); }
  for (const requestTimeoutMs of [0, 99, 120001, NaN, Infinity])
    assert.throws(() => createKeelPublicSepoliaSimulationPool({ ...fixture([{}]).options, requestTimeoutMs }), /bounded deadline/);
});

test('cancellation during the recovery cooldown prevents fresh qualification and a second project request', async () => {
  let reached;
  const retrying = new Promise(resolve => { reached = resolve; });
  const f = singleRecipientTransient({ fault: 503, onAttempt: diagnostic => { if (diagnostic.sameRecipientRetry === 1) reached(); } });
  const run = f.transport.request(program());
  const refused = assert.rejects(run, error => error.kind === 'rpc-unavailable' && /cancelled/.test(error.message));
  await retrying; const count = f.requests.length;
  await f.transport.close(); await refused;
  assert.equal(f.privateAttempts(), 1); assert.equal(f.requests.length, count);
});

test('the complete request deadline discards a late response even when the provider ignores abort', async () => {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  const f = singleRecipientTransient({ requestTimeoutMs: 100, beforeResponse: async () => { reached(); await gate; } });
  const run = f.transport.request(program());
  const refused = assert.rejects(run, error => error.kind === 'rpc-unavailable' && error.diagnostic.transportFailure === 'timeout');
  await entered; await refused; release();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.transport.request(program()), error => error.kind === 'rpc-unavailable' && /cancelled/.test(error.message));
  assert.equal(f.privateAttempts(), 1); await f.transport.close();
});

test('a recovered request shares its original deadline and cannot receive a second full timeout budget', async () => {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  const f = singleRecipientTransient({ fault: 503, requestTimeoutMs: 2_200,
    beforeResponse: async () => { reached(); await gate; } });
  const run = f.transport.request(program());
  const refused = assert.rejects(run, error => error.kind === 'rpc-unavailable' && error.diagnostic.transportFailure === 'timeout');
  await entered; await refused;
  assert.equal(f.privateAttempts(), 2);
  release(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.transport.request(program()), error => /cancelled/.test(error.message));
  assert.equal(f.privateAttempts(), 2); await f.transport.close();
});

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
  for(const fault of [{cap:true},{unsupported:true},{ignoreNonce:true},{noPreRefund:true},{rate:true},{chain:true},{pin:true},{stale:true},{future:true}]) {
    const f=fixture([fault,{}]);
    try { const proof=await simulateKeelPublicationBeforeFunding(fullPlan(),f.transport);
      assert.equal(proof.schema,'keel-publication-simulation@1');assert.equal(proof.signing,'not-performed');assert.equal(proof.submission,'not-performed');
      assert.ok(f.privateRequests().every(r=>r.index===1));
      assert.deepEqual(f.privateRequests().map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,5],[true,5],[false,7]]);
    } finally {await f.transport.close();}
  }
});
test('rate-limit cooldown persists across new review transports without sharing private proof state',async()=>{
  const f=fixture([{rate:true},{cap:true}]), previous=globalThis.fetch;
  globalThis.fetch=f.options.fetchImpl;
  const options={...f.options,fetchImpl:undefined};
  const first=createKeelPublicSepoliaSimulationPool(options);
  try {await assert.rejects(first.request(program()));const before=f.requests.filter(r=>r.index===0).length;
    const retry=createKeelPublicSepoliaSimulationPool(options);
    try{await assert.rejects(retry.request(program()));assert.equal(f.requests.filter(r=>r.index===0).length,before,'a new review must honor the same Retry-After');}finally{await retry.close();}
  }finally{globalThis.fetch=previous;await first.close();await f.transport.close();}
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
test('Retro-sized synthetic 34/40-call requests keep every byte on aggregate-capacity replay',async()=>{
  for(const count of [34,40]) {
    const f=fixture([{aggregate:true},{}]);try{
      const input=program();input.params[0].blockStateCalls=Array.from({length:count},(_,i)=>({calls:[{...call(i),data:`0x${'ab'.repeat(Math.ceil(1_928_493/count))}`}]}));
      assert.ok(Buffer.byteLength(JSON.stringify(input))>3_856_986,'reproduce the authorized storage-prefix size lower bound with synthetic bytes');
      const before=structuredClone(input);await f.transport.request(input);
      assert.deepEqual(input,before);assert.deepEqual(f.privateRequests().map(r=>r.body.params),[before.params,before.params]);
      const probes=f.requests.filter(r=>r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls.length===count&&r.body.params[0].blockStateCalls[0].calls[0].data==='0x');
      assert.ok(probes.length>=4);assert.ok(probes.every(r=>r.body.params[0].blockStateCalls.reduce((n,b)=>n+BigInt(b.calls[0].gas),0n)===BigInt(count)*200_000_000n));
    }finally{await f.transport.close();}
  }
});
test('body limit and transport outage swap complete programs; specific capacity evidence survives pool exhaustion',async()=>{
  for(const http of [413,503]) {const f=fixture([{http},{}]);try{await f.transport.request(program());assert.deepEqual(f.privateRequests().map(r=>r.index),[0,1]);}finally{await f.transport.close();}}
  const f=fixture([{http:413},{unsupported:true}]);try{await assert.rejects(f.transport.request(program()),e=>e.kind==='provider-limit'&&e.diagnostic.httpStatus===413);}finally{await f.transport.close();}
});
test('public qualification never grants disclosure to another indexed recipient',async()=>{
  const f=fixture([{cap:true},{}],[urls[0]]);
  try {await assert.rejects(f.transport.request(program()),e=>e.kind==='provider-limit'&&e.diagnostic.providerGasCap==='50000000');
    assert.equal(f.privateRequests().length,0);assert.ok(f.requests.some(r=>r.index===1&&r.body.method==='eth_simulateV1'));
  }finally{await f.transport.close();}
});
test('contract revert, transaction validation failure and exact metadata mismatch never search for a passing backend',async()=>{
  for(const fault of [{error:3},{error:-38011},{error:-38014},{revert:true},{metadata:'wrong'}]) {
    const f=fixture([fault,{}]);try{await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),f.transport));assert.ok(f.requests.every(r=>r.index===0));}finally{await f.transport.close();}
  }
});
test('invalid parameters, common server validation errors and ambiguous simulation rejections are terminal',async()=>{
  for(const fault of [
    {error:-32602,kind:'configuration-invalid'},
    {error:-38013,kind:'configuration-invalid'},
    {error:-32000,message:'insufficient funds for gas * price + value SECRET',kind:'insufficient-balance'},
    {error:-32000,message:'insufficient balance SECRET',kind:'insufficient-balance'},
    {error:-32000,message:'nonce too low SECRET',kind:'configuration-invalid'},
    {error:-32000,message:'nonce too high SECRET',kind:'configuration-invalid'},
    {error:-32000,message:'intrinsic gas too low SECRET',kind:'configuration-invalid'},
    {error:-32000,message:'max fee per gas less than block base fee SECRET',kind:'configuration-invalid'},
    {error:-32000,message:'unknown server rejection SECRET',kind:'rpc-unavailable'},
    {error:-32603,kind:'rpc-unavailable'},
  ]) {
    const f=fixture([fault,{}]);try{
      await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),f.transport),e=>e.kind===fault.kind&&e.diagnostic.rpcCode===fault.error&&!/SECRET|PRIVATE|first.example/.test(JSON.stringify(e)));
      assert.deepEqual(f.privateRequests().map(r=>r.index),[0],'a candidate that would pass must receive no project request');
      assert.ok(f.requests.every(r=>r.index===0),'terminal rejection must stop selection entirely');
    }finally{await f.transport.close();}
  }
});
test('HTTP bad or unprocessable project requests are terminal without inventing an RPC error code',async()=>{
  for(const http of [400,422]) {
    const f=fixture([{http},{}]);try{
      await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),f.transport),e=>e.kind==='configuration-invalid'&&e.diagnostic.httpStatus===http&&e.diagnostic.rpcCode===undefined);
      assert.deepEqual(f.privateRequests().map(r=>r.index),[0]);assert.ok(f.requests.every(r=>r.index===0));
    }finally{await f.transport.close();}
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
test('public qualification report uses production complete-sequence checks and states its capacity limits',async()=>{
  const f=fixture([{}]);try{
    const report=await probePublicSimulationCandidates({rpcUrls:[urls[0]],fetchImpl:f.options.fetchImpl,minIntervalMs:0});
    const item=report.candidates[0];
    assert.equal(report.publicationVerified,false);assert.equal(report.privateProjectDataSent,false);
    assert.equal(item.publicQualification,'passed');assert.equal(item.requestedEnvelopeSum,'8000000000');
    assert.equal(item.observedPublicGasUsedSum,'840000');assert.equal(item.observedPublicMaxUsedGasSum,'840000');
    assert.equal(item.largeRequestBodyCapacity,'not-tested');assert.equal(item.privateExecutionCapacity,'not-tested');
    assert.ok(item.largestAcceptedPublicRequestBytes<3_856_986);
    assert.deepEqual(item.publicProbes.map(p=>[p.blockCount,p.validation]),[[2,false],[2,true],[1,true],[40,false],[40,true]]);
    assert.equal(f.privateRequests().length,0);
  }finally{await f.transport.close();}
});
test('public report refuses stale heads and invalid full-sequence evidence, and stops after access or rate restrictions',async()=>{
  for(const fault of [{stale:true},{future:true},{ignoreNonce:true},{longStatus:true},{longHeader:true},{longNonce:true},{longFee:true},{longGas:true},{longPreRefund:true},{publicHttp:429},{publicHttp:403}]) {
    const f=fixture([fault]);try{
      const report=await probePublicSimulationCandidates({rpcUrls:[urls[0]],fetchImpl:f.options.fetchImpl,minIntervalMs:0});
      const item=report.candidates[0];assert.ok(item.failure);assert.equal(item.publicQualification,undefined);assert.equal(item.observedPublicGasUsedSum,undefined);
      assert.equal(f.privateRequests().length,0);
      if(fault.stale||fault.future) assert.equal(item.publicProbes.length,0);
      if(fault.publicHttp) {assert.equal(item.publicProbes.length,1);assert.equal(item.publicProbes[0].httpStatus,fault.publicHttp);}
    }finally{await f.transport.close();}
  }
});

test('the approved CLI pins PublicNode and rejects URL overrides before probing', () => {
  assert.deepEqual(publicProbeOptions(['--public-only', '--approved-publicnode-only', '--require-qualified']), {
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], requireQualified: true,
  });
  assert.equal(APPROVED_PUBLICNODE_SEPOLIA_URL, 'https://ethereum-sepolia-rpc.publicnode.com');
  assert.deepEqual(publicProbeOptions(['--public-only']), { requireQualified: false });
  for (const args of [[], ['--approved-publicnode-only'], ['--public-only', '--public-only'],
    ['--public-only', '--rpc-url=https://unapproved.invalid'], ['--public-only', 'https://unapproved.invalid']]) {
    assert.throws(() => publicProbeOptions(args));
  }
});
test('live gate fails on unavailable or incomplete qualification while retaining public-only evidence', async () => {
  for (const fault of [{}, { publicHttp: 403 }, { publicHttp: 429 }, { longGas: true }, { longNonce: true }]) {
    const f = fixture([fault]);
    try {
      const report = await probePublicSimulationCandidates({ rpcUrls: [urls[0]], fetchImpl: f.options.fetchImpl, minIntervalMs: 0 });
      assert.equal(publicProbeExitCode(report, true), Object.keys(fault).length ? 1 : 0);
      assert.equal(publicProbeExitCode(report, false), 0);
      assert.equal(report.publicationVerified, false);
      assert.equal(report.privateProjectDataSent, false);
      assert.equal(f.privateRequests().length, 0);
    } finally { await f.transport.close(); }
  }
  assert.equal(publicProbeExitCode({ candidates: [] }, true), 1);
  assert.equal(publicProbeExitCode({ candidates: [{ publicQualification: 'passed', failure: { kind: 'rpc-unavailable' } }] }, true), 1);
});
test('the recorded 2026-10-11 PublicNode clamp remains a failed capability gate, not publication evidence', async () => {
  const evidence = JSON.parse(await readFile(new URL('./fixtures/publicnode-sepolia-capacity-20261011.json', import.meta.url), 'utf8'));
  assert.equal(publicProbeExitCode(evidence.report, true), 1);
  assert.equal(evidence.report.candidates.length, 1);
  const candidate = evidence.report.candidates[0];
  assert.equal(candidate.endpoint, APPROVED_PUBLICNODE_SEPOLIA_URL);
  assert.equal(candidate.publicProbes.length, 1);
  assert.equal(candidate.publicProbes[0].validation, false);
  assert.equal(candidate.publicProbes[0].requestedGas[0], '199804689');
  assert.equal(candidate.publicProbes[0].returnedGas[0], '50000000');
  assert.equal(candidate.failure.kind, 'provider-limit');
  assert.equal(evidence.privatePlanVerified, false);
  assert.equal(evidence.report.publicationVerified, false);
  assert.equal(evidence.canonicalPublicationReceipt, null);
  assert.equal(evidence.deployedCollection, null);
});

test('a lower explicit envelope requalifies after a larger cap rejection without rewriting any calls', async () => {
  const f = fixture([{cap:true}]);
  try {
    const tooLarge = program();
    await assert.rejects(f.transport.request(tooLarge), error => error.kind === 'provider-limit' && error.diagnostic.providerGasCap === '50000000');
    assert.equal(f.privateRequests().length, 0);
    const requestsAfterFailure = f.requests.length;
    await assert.rejects(f.transport.request(tooLarge), error => error.kind === 'provider-limit');
    assert.equal(f.requests.length, requestsAfterFailure, 'same oversized request stays rejected');
    const smaller = program();
    for (const block of smaller.params[0].blockStateCalls) block.calls[0].gas = '0x2faf080';
    await f.transport.request(smaller);
    assert.equal(f.privateRequests().length, 1);
    assert.deepEqual(f.privateRequests()[0].body.params, smaller.params);
    const publicRequalification = f.requests.slice(requestsAfterFailure).filter(request => request.body.method === 'eth_simulateV1' && request.body.params[0].blockStateCalls[0].calls[0].data === '0x');
    assert.ok(publicRequalification.some(request => request.body.params[0].validation === true));
    assert.ok(publicRequalification.some(request => request.body.params[0].blockStateCalls.length === smaller.params[0].blockStateCalls.length));
  } finally { await f.transport.close(); }
});

test('the complete metadata read adapts its rejected ceiling while preserving exact transactions', async () => {
  const f = fixture([{cap:true}]);
  try {
    const input = fullPlan();
    for (const call of input.preparationCalls) call.gas = '0x989680';
    input.maximumReadGas = 60000000n; input.metadataCall.gas = '0x3938700';
    const proof = await simulateKeelPublicationBeforeFunding(input, f.transport);
    assert.equal(proof.requestedReadGasLimit, '60000000');
    assert.equal(proof.effectiveReadGasLimit, '50000000');
    assert.deepEqual(proof.readBoundaryAttempts, [{requestedGas:'60000000', providerGasCap:'50000000'}]);
    const requests = f.privateRequests();
    assert.deepEqual(requests.map(request => request.body.params[0].blockStateCalls.length), [5,5,7]);
    const validated = requests[1].body.params[0].blockStateCalls;
    assert.deepEqual(requests[2].body.params[0].blockStateCalls.slice(0,5), validated);
    assert.equal(proof.verification, 'collector-metadata');
    assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(tokenURI));
  } finally { await f.transport.close(); }
});

const estimateRequest = () => ({ method:'eth_estimateGas', params:[{from:owner,to:reader,data:'0xbeef',value:'0x0',nonce:'0x5',maxFeePerGas:'0x30',maxPriorityFeePerGas:'0x1'},snapshot.number] });
test('complete-transaction estimates disclose only to an approved pinned recipient and grant no capacity proof', async () => {
  const f = fixture([{}, {cap:true}], [urls[1]]);
  f.options.readTransport.request = async () => { throw Error('ordinary read provider must receive no estimate'); };
  try {
    const request=estimateRequest(), before=structuredClone(request);
    assert.equal(await f.transport.request(request), '0x3d0900');
    assert.deepEqual(request,before);
    assert.ok(f.requests.every(r=>r.index===1));
    assert.deepEqual(f.requests.at(-1).body.params,before.params);
    assert.equal(f.requests.some(r=>r.body.method==='eth_simulateV1'),false);
    await assert.rejects(f.transport.request(program()), e=>e.kind==='configuration-invalid'||e.kind==='provider-limit');
    assert.equal(f.privateRequests().length,0,'successful estimate cannot bypass exact simulation capacity or recipient approval');
  } finally { await f.transport.close(); }
});
test('estimation rejects an unapproved recipient, changed snapshot, wrong chain and stale head before any project calldata', async () => {
  for(const [fault,approved] of [[{},[]],[{pin:true},[urls[0]]],[{chain:true},[urls[0]]],[{stale:true},[urls[0]]]]) {
    const f=fixture([fault],approved);
    try {await assert.rejects(f.transport.request(estimateRequest()));assert.equal(f.requests.some(r=>r.body.method==='eth_estimateGas'),false);}
    finally {await f.transport.close();}
  }
});
test('estimate reverts and malformed results never fall through to a different recipient or fallback gas', async () => {
  for(const fault of [{error:3},{error:-32601},{estimate:'0x0'},{estimate:'0x00'}]) {
    const f=fixture([fault,{}]);
    try {await assert.rejects(f.transport.request(estimateRequest()));assert.ok(f.requests.every(r=>r.index===0));}
    finally {await f.transport.close();}
  }
});
test('estimation accepts only exact fee-bound numbered-block requests without state overrides or a caller gas clamp', async () => {
  for(const mutate of [r=>r.params.push({}),r=>r.params[1]='latest',r=>r.params[0].gas='0x2faf080',r=>delete r.params[0].nonce,r=>r.params[0].gasPrice='0x1',r=>r.params[0].data='0x123']) {
    const f=fixture();try {const r=estimateRequest();mutate(r);await assert.rejects(f.transport.request(r),e=>e.kind==='configuration-invalid');assert.equal(f.requests.length,0);}
    finally {await f.transport.close();}
  }
});

test('cancellation discards a late estimate even when the provider ignores abort', async () => {
  const f=fixture([{}]); let release, started;
  const gate=new Promise(resolve=>{started=resolve;});
  const original=f.options.fetchImpl;
  const rpc=createKeelPublicSepoliaSimulationPool({...f.options,fetchImpl:async(url,init)=>{
    if(JSON.parse(init.body).method==='eth_estimateGas') { started(); await new Promise(resolve=>{release=resolve;}); }
    return original(url,init);
  }});
  try {
    const pending=rpc.request(estimateRequest()); await gate; await rpc.close(); release();
    await assert.rejects(pending,e=>e.kind==='rpc-unavailable');
    await assert.rejects(rpc.request(estimateRequest()),e=>e.kind==='rpc-unavailable');
  } finally {await rpc.close();await f.transport.close();}
});


test('initial-storage capacity discovery requalifies the existing approved provider and validates the whole program without a new recipient', async () => {
  for (const faults of [[{cap:true}], [{cap:true},{}]]) {
    const f=fixture(faults,[urls[0]]), input={...fullPlan(),discoveryGasPolicy:'provider-capacity'}, before=structuredClone(input);
    try {
      const proof=await simulateKeelPublicationBeforeFunding(input,f.transport);
      assert.deepEqual(input,before);
      assert.deepEqual(proof.discoveryGas.capacityAttempts,[{requestedGas:'200000000',providerGasCap:'50000000'}]);
      assert.ok(proof.discoveryGas.effectiveGasLimits.every(g=>'50000000'===g));
      assert.ok(proof.transactionGasLimits.every(g=>BigInt(g)<50000000n));
      assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
      assert.ok(f.privateRequests().every(r=>r.index===0),'only the existing approved recipient receives project data');
      assert.deepEqual(f.privateRequests().map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,5],[true,5],[false,7]]);
      const strict=f.privateRequests()[1].body.params[0].blockStateCalls;
      assert.deepEqual(f.privateRequests()[2].body.params[0].blockStateCalls.slice(0,5),strict);
      assert.ok(f.requests.some(r=>r.index===0&&r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls.length===5&&r.body.params[0].blockStateCalls[0].calls[0].data==='0x'&&r.body.params[0].blockStateCalls[0].calls[0].gas==='0x2faf080'));
    } finally {await f.transport.close();}
  }
});
test('dynamic discovery never turns unsupported approved methods into approval for another recipient', async () => {
  const f=fixture([{unsupported:true},{}],[urls[0]]);
  try {
    await assert.rejects(simulateKeelPublicationBeforeFunding({...fullPlan(),discoveryGasPolicy:'provider-capacity'},f.transport),e=>e.kind==='configuration-invalid'&&e.diagnostic.recipientApprovalRequired===1);
    assert.equal(f.privateRequests().length,0);
  } finally {await f.transport.close();}
});

test('discovery chooses the largest approved reported capacity and cached rejection describes the current request', async () => {
  const f=fixture([{cap:true},{cap:true,capacityGas:80000000n}]);
  try {
    await assert.rejects(f.transport.request(program()),e=>e.kind==='provider-limit'&&e.diagnostic.requestedGasLimit==='200000000'&&e.diagnostic.providerGasCap==='80000000');
    const input=fullPlan(); input.maximumTransactionGas=100000000n;
    input.preparationCalls=input.preparationCalls.map(c=>({...c,gas:'0x5f5e100'}));input.discoveryGasPolicy='provider-capacity';
    const proof=await simulateKeelPublicationBeforeFunding(input,f.transport);
    assert.deepEqual(proof.discoveryGas.capacityAttempts,[{requestedGas:'100000000',providerGasCap:'80000000'}]);
    assert.ok(f.privateRequests().every(r=>r.index===1));
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
  } finally {await f.transport.close();}
});

test('cancelling adapted discovery discards late success without strict replay or a wallet proof', async () => {
  const f=fixture([{cap:true}]);let started,release;
  const gate=new Promise(resolve=>{started=resolve;});const original=f.options.fetchImpl;
  const rpc=createKeelPublicSepoliaSimulationPool({...f.options,fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);
    if(body.method==='eth_simulateV1'&&body.params[0].blockStateCalls[0].calls[0].data!=='0x') {started();await new Promise(resolve=>{release=resolve;});}
    return original(url,init);
  }});
  try {
    const pending=simulateKeelPublicationBeforeFunding({...fullPlan(),discoveryGasPolicy:'provider-capacity'},rpc);
    await gate;await rpc.close();release();await assert.rejects(pending,e=>e.kind==='rpc-unavailable');
    assert.equal(f.privateRequests().length,1);assert.equal(f.privateRequests()[0].body.params[0].validation,false);
  } finally {await rpc.close();await f.transport.close();}
});

const sharedBudgetPlan=()=>{const source=fullPlan();return {...source,discoveryGasPolicy:'provider-capacity',preparationCalls:Array.from({length:14},(_,i)=>call(i)),assertions:[]};};
test('uneven carrier demand reuses measured prefix allowance and fully replays the same program',async()=>{
  // Deliberately uneven synthetic demands; native Geth separately checks EVM execution.
  const f=fixture([{sharedBudget:50000000n,projectGasByCall:[2000000n,150000n,5500000n]}]);
  const input=sharedBudgetPlan(),before=structuredClone(input);
  try {
    const proof=await simulateKeelPublicationBeforeFunding(input,f.transport);
    assert.deepEqual(input,before);
    assert.equal(proof.discoveryGas.allocationAttempts.length,1);
    assert.equal(proof.discoveryGas.allocationAttempts[0].callIndex,2);
    assert.equal(proof.discoveryGas.allocationAttempts[0].strategy,'prefix-reuse');
    assert.ok(BigInt(proof.discoveryGas.effectiveGasLimits[2])>5500000n);
    assert.ok(BigInt(proof.transactionGasLimits[2])>5500000n);
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
    const sent=f.privateRequests();
    assert.deepEqual(sent.map(r=>r.body.params[0].validation),[false,false,true,false]);
    const identity=c=>{const {gas,gasPrice,maxFeePerGas,maxPriorityFeePerGas,...rest}=c;return rest;};
    for(const r of sent)assert.deepEqual(r.body.params[0].blockStateCalls.slice(0,14).map(b=>identity(b.calls[0])),before.preparationCalls.map(identity));
    assert.deepEqual(sent.at(-1).body.params[0].blockStateCalls.slice(0,14),sent.at(-2).body.params[0].blockStateCalls);
  }finally{await f.transport.close();}
});
test('a first-call demand larger than its equal share can borrow only observed remaining discovery capacity',async()=>{
  const f=fixture([{sharedBudget:50000000n,projectGasByCall:[9000000n]}]);
  try{
    const proof=await simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport);
    assert.equal(proof.discoveryGas.allocationAttempts[0].callIndex,0);
    assert.equal(proof.discoveryGas.allocationAttempts[0].strategy,'remaining-budget');
    assert.ok(BigInt(proof.discoveryGas.allocationAttempts[0].nextGasLimit)<=50000000n);
    assert.equal(proof.validatedTransactionCalls,14);
  }finally{await f.transport.close();}
});
test('a genuine contract revert still refuses approval after bounded same-program allocation checks',async()=>{
  const f=fixture([{sharedBudget:50000000n,revert:true}]);
  try{
    await assert.rejects(simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport),e=>e.kind==='execution-reverted');
    const sent=f.privateRequests();assert.equal(sent.length,2);
    assert.ok(sent.every(r=>r.body.params[0].validation===false));
  }finally{await f.transport.close();}
});
test('later calls recover from reserved intrinsic floors through bounded complete discovery replays',async()=>{
  const demands=[9000000n,1000000n,8000000n,1000000n,6000000n,...Array(9).fill(100000n)];
  const f=fixture([{sharedBudget:50000000n,projectGasByCall:demands}]);
  try{
    const proof=await simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport);
    assert.ok(proof.discoveryGas.allocationAttempts.length>1);
    assert.ok(proof.discoveryGas.allocationAttempts.length<=28);
    assert.equal(proof.validatedTransactionCalls,14);
    for(const [i,gas] of proof.transactionGasLimits.entries())assert.ok(BigInt(gas)>demands[i]);
    for(const request of f.privateRequests().filter(r=>!r.body.params[0].validation).slice(1,-1)){
      assert.equal(request.body.params[0].blockStateCalls.length,14);
      const total=request.body.params[0].blockStateCalls.reduce((sum,b)=>sum+BigInt(b.calls[0].gas),0n);
      assert.ok(total<=50000000n);
    }
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
  }finally{await f.transport.close();}
});
test('missing pre-refund evidence prevents allocation and a later metadata mismatch still blocks it',async()=>{
  for(const [fault,kind] of [[{missingProjectMaximumAt:1},'execution-reverted'],[{metadata:'wrong whole URI'},'metadata-mismatch']]){
    const f=fixture([{sharedBudget:50000000n,projectGasByCall:[2000000n,150000n,5500000n],...fault}]);
    try{
      await assert.rejects(simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport),e=>e.kind===kind);
      if(fault.missingProjectMaximumAt!==undefined)assert.equal(f.privateRequests().length,1);
      else assert.ok(f.privateRequests().some(r=>r.body.params[0].validation));
    }finally{await f.transport.close();}
  }
});
test('cancellation during budget redistribution discards late results and never reaches strict approval',async()=>{
  const f=fixture([{sharedBudget:50000000n,projectGasByCall:[2000000n,150000n,5500000n]}]);
  let count=0,started,release;const gate=new Promise(resolve=>{started=resolve;});
  const transport=createKeelPublicSepoliaSimulationPool({...f.options,fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);
    if(body.method==='eth_simulateV1'&&body.params[0].blockStateCalls[0].calls[0].data!=='0x'&&++count===2){started();await new Promise(resolve=>{release=resolve;});}
    return f.options.fetchImpl(url,init);
  }});
  try{
    const pending=simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),transport);
    await gate;await transport.close();release();
    await assert.rejects(pending,e=>e.kind==='rpc-unavailable');
    assert.equal(f.privateRequests().length,2);assert.ok(f.privateRequests().every(r=>r.body.params[0].validation===false));
  }finally{await transport.close();await f.transport.close();}
});
test('paid estimate uses the explicit approved pool entry point, not the legacy simulation-only factory',async()=>{
  const legacy=createKeelSepoliaSimulationTransport(),f=fixture([{}],[urls[0]]),request=estimateRequest();
  try {
    await assert.rejects(legacy.request(request),e=>e.kind==='configuration-invalid'&&/read-only qualification and simulation methods/u.test(e.message));
    assert.equal(await f.transport.request(request),'0x3d0900');
    const sent=f.requests.filter(r=>r.body.method==='eth_estimateGas');assert.equal(sent.length,1);assert.equal(sent[0].index,0);
    assert.deepEqual(sent[0].body.params,request.params);
    assert.equal(f.privateRequests().length,0,'an estimate is not a simulation proof');
  }finally{await legacy.close();await f.transport.close();}
});
test('a shared cross-block budget cannot masquerade as a fresh per-call ceiling during 14-call discovery', async()=>{
  const f=fixture([{sharedBudget:50000000n}],[urls[0]]),source=sharedBudgetPlan(),before=structuredClone(source);
  try {
    const proof=await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.deepEqual(source,before);
    assert.deepEqual(proof.discoveryGas.capacityAttempts,[{requestedGas:'200000000',providerGasCap:'50000000'},
      {requestedGas:'50000000',providerGasCap:'49988000',programGasBudget:'49988000',perCallGasLimit:'3570571'}]);
    assert.ok(proof.discoveryGas.effectiveGasLimits.every(g=>g==='3570571'));
    const sent=f.privateRequests();assert.deepEqual(sent.map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,14],[true,14],[false,16]]);
    const calls=r=>r.body.params[0].blockStateCalls.map(b=>b.calls[0]);
    const withoutGas=({gas,gasPrice,maxFeePerGas,maxPriorityFeePerGas,...c})=>c;
    for(const r of sent)assert.deepEqual(calls(r).slice(0,14).map(withoutGas),source.preparationCalls.map(withoutGas));
    assert.deepEqual(calls(sent[2]).slice(0,14),calls(sent[1]));
    assert.ok(calls(sent[1]).every(c=>BigInt(c.gas)>21000n),'measured margin is retained');
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
    assert.equal(proof.signing,'not-performed');assert.equal(proof.submission,'not-performed');
    // A later read on the same pool uses cached remaining capacity, but still
    // replays discovery, strict validation and exact complete metadata.
    await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.equal(f.privateRequests().length,6);
  } finally {await f.transport.close();}
});
test('public multi-block clamp diagnostics identify the probe and position, before any private disclosure',async()=>{
  const seen=[],f=fixture([{sharedBudget:50000000n}],[urls[0]]);
  const transport=createKeelPublicSepoliaSimulationPool({...f.options,onAttempt:d=>seen.push(d)});
  try {
    const request=program();request.params[0].blockStateCalls=Array.from({length:14},(_,i)=>({calls:[{...call(i),gas:'0x2fa92c0'}]}));
    assert.equal(BigInt(request.params[0].blockStateCalls[0].calls[0].gas),49976000n);
    await assert.rejects(transport.request(request),e=>e.kind==='provider-limit'&&e.diagnostic.phase==='public-qualification'
      &&e.diagnostic.blockIndex===3&&e.diagnostic.callIndex===0&&e.diagnostic.requestedGasLimit==='49976000'&&e.diagnostic.providerGasCap==='49964000');
    assert.equal(f.privateRequests().length,0);assert.equal(seen.at(-1).phase,'public-qualification');assert.equal(seen.at(-1).blockIndex,3);
    assert.equal(seen.at(-1).requiredProgramGas,'699664000');
  }finally{await transport.close();await f.transport.close();}
});
test('shared discovery never reduces a measured margin, accepts a strict clamp or ignores complete metadata',async()=>{
  for(const [fault,kind] of [[{projectGas:3500000n},'provider-limit'],[{projectGas:4000000n},'execution-reverted'],[{strictBudget:25000n},'provider-limit'],[{metadata:'different'},'metadata-mismatch']]) {
    const f=fixture([{sharedBudget:50000000n,...fault}],[urls[0]]),source=sharedBudgetPlan(),before=structuredClone(source);
    try {await assert.rejects(simulateKeelPublicationBeforeFunding(source,f.transport),e=>e.kind===kind);assert.deepEqual(source,before);
      assert.ok(f.privateRequests().filter(r=>r.body.params[0].validation).length<=1);
      if(fault.projectGas)for(const request of f.privateRequests().filter(r=>r.body.params[0].validation))
        assert.ok(request.body.params[0].blockStateCalls.every(block=>BigInt(block.calls[0].gas)>fault.projectGas), 'strict replay preserves every measured margin');
    }finally{await f.transport.close();}
  }
});
test('shared discovery and a rejected 60M public-read ceiling preserve the strictly measured transactions',async()=>{
  const f=fixture([{sharedBudget:50000000n}],[urls[0]]),source=sharedBudgetPlan();
  source.maximumReadGas=60000000n;source.metadataCall={...source.metadataCall,gas:'0x3938700'};
  const before=structuredClone(source);
  try {
    const proof=await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.deepEqual(source,before);assert.equal(proof.readBoundaryAttempts.length,3);
    assert.equal(proof.effectiveReadGasLimit,'49685000');
    const sent=f.privateRequests(),strict=sent.find(r=>r.body.params[0].validation).body.params[0].blockStateCalls;
    const replay=sent.filter(r=>r.body.params[0].blockStateCalls.length===16);
    assert.equal(replay.length,2);
    for(const request of replay)assert.deepEqual(request.body.params[0].blockStateCalls.slice(0,14),strict);
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
  }finally{await f.transport.close();}
});
