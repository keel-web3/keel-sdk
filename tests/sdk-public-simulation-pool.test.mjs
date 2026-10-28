import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256 } from 'viem';
import { createKeelRpcPool } from '../packages/sdk/dist/rpc.js';
import { createKeelSepoliaSimulationTransport } from '../packages/sdk/dist/sepolia-simulation-transport.js';
const { createKeelPublicSepoliaSimulationPool, createKeelPublicSimulationPool, createKeelScheduledReadTransport } = await import(process.env.KEEL_TEST_PUBLIC_SIMULATION_POOL_MODULE ?? '../packages/sdk/dist/public-simulation-pool.js');
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
  const responses=[]; const requests=[]; const privateRequests=()=>requests.filter(r=>r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls[0].calls[0].data!=='0x');
  const fetchImpl=async(url,init)=>{
    const index=urls.indexOf(url), fault=faults[index], body=JSON.parse(init.body);
    requests.push({index,body,wire:init.body});
    const respond=(result)=>Response.json({jsonrpc:'2.0',id:body.id,result});
    const error=(code,message='SECRET provider error')=>Response.json({jsonrpc:'2.0',id:body.id,error:{code,message,...(fault.errorData === undefined ? {} : { data: fault.errorData })}});
    if(fault.rate) return new Response('',{status:429,headers:{'retry-after':'30'}});
    if(body.method==='eth_chainId') return respond(fault.chain?'0x1':'0xaa36a7');
    if(body.method==='eth_getBlockByNumber') return respond(fault.stale?{...snapshot,timestamp:'0x68f00000'}:fault.future?{...snapshot,timestamp:`0x${(BigInt(snapshot.timestamp)+600n).toString(16)}`}:fault.pin&&body.params[0]!=='latest'?{...snapshot,hash:hash(1000)}:snapshot);
    if(body.method==='eth_getBalance') return respond(fault.balance??`0x${'f'.repeat(32)}`);
    if(body.method==='eth_getTransactionCount') return respond('0x0');
    if(body.method==='eth_getCode') return respond(body.params[0]===zero?'0x':'0x6000');
    if(body.method==='eth_estimateGas') return fault.error ? error(fault.error,fault.message) : respond(fault.estimate ?? '0x3d0900');
    assert.equal(body.method,'eth_simulateV1');
    const blocks=body.params[0].blockStateCalls, privateCall=blocks[0].calls[0].data!=='0x';
    if(privateCall && fault.maximumRequestBytes !== undefined && Buffer.byteLength(init.body)>fault.maximumRequestBytes)
      return new Response('Synthetic request body size limit reached.',{status:503});
    if(!privateCall&&fault.publicHttp) return new Response('',{status:fault.publicHttp});
    if(!privateCall&&fault.unsupported) return error(-32601);
    if(!privateCall&&blocks.length===1&&blocks[0].calls[0].nonce==='0x1'&&!fault.ignoreNonce) return error(-38011);
    if(privateCall&&fault.error) return error(fault.error,fault.message);
    if(privateCall&&fault.httpResponse) return fault.httpResponse(body,init);
    if(privateCall&&fault.http) return fault.httpCode === undefined ? new Response('',{status:fault.http}) : Response.json({jsonrpc:'2.0',id:body.id,error:{code:fault.httpCode,message:'SECRET private payload'}},{status:fault.http});
    if(privateCall&&fault.wait) { fault.started?.(); await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})); }
    // Synthetic contract values follow the original operation ordinal, never
    // the simulated block grouping chosen for discovery versus strict replay.
    const offsets=[];let ordinal=0;
    for(const block of blocks){offsets.push(ordinal);ordinal+=block.calls.length;}
    const result=blocks.map((b,i)=>({number:`0x${(19+i).toString(16)}`,timestamp:`0x${(BigInt(snapshot.timestamp)+12n*BigInt(i+1)).toString(16)}`,hash:hash(i+1),parentHash:i?hash(i):snapshot.hash,
      blockAccessListHash:hash(i+10),slotNumber:`0x${(11+i).toString(16)}`,
      transactions:b.calls.map(c=>({...c,gas:fault.cap&&BigInt(c.gas)>(fault.capacityGas??50000000n)?`0x${(fault.capacityGas??50000000n).toString(16)}`:!privateCall&&fault.sequenceCap&&blocks.length>=5&&i===4?'0x1':privateCall&&fault.aggregate&&i===4?'0x1':c.gas})),
      calls:b.calls.map((c,j)=>({status:privateCall&&fault.revert?'0x0':'0x1',gasUsed:fault.baseGas??(!privateCall?'0x2ee0':'0x5208'),...(!privateCall&&fault.noPreRefund?{}:{maxUsedGas:fault.baseGas??(!privateCall?'0x2ee0':'0x5208')}),returnData:!privateCall?'0x':c.data==='0xeeee'?encodeAbiParameters([{type:'string'}],[fault.metadata??tokenURI]):encodeAbiParameters([{type:'uint256'}],[c.data==='0xdddd'?500n:BigInt((offsets[i]+j+1)*100)])}))}));
    if(fault.sharedBudget!==undefined) {
      // Geth's gasBudget is shared across blocks, and consumes used gas after
      // each call. These are synthetic responses, not captured project bytes.
      let remaining=privateCall&&body.params[0].validation&&fault.strictBudget!==undefined?fault.strictBudget:fault.sharedBudget;
      for(const [i,b] of blocks.entries()) for(const [j,c] of b.calls.entries()) {
        const requested=BigInt(c.gas),allowed=requested<remaining?requested:remaining;
        const demand=privateCall?(fault.projectGasByCall?.[offsets[i]+j]??fault.projectGas??21000n):12000n,used=demand<allowed?demand:allowed;
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
      if(fault.longGas) result[39].transactions[0].gas='0x5209';
      if(fault.longPreRefund) delete result[39].calls[0].maxUsedGas;
    }
    if(privateCall) responses.push(structuredClone(result));
    return respond(result);
  };
  const readTransport={request:async r=>r.method==='eth_chainId'?'0xaa36a7':r.method==='eth_getBlockByNumber'?snapshot:'0x6000'};
  // A synthetic whole-request measurement is explicit. `sharedBudget` alone
  // only changes fake execution and never authenticates a reusable capacity fact.
  const providerCapabilities=faults.flatMap((fault,index)=>fault.measuredRequestGasCap===undefined?[]:[{
    chainId:11155111,rpcUrl:urls[index],measuredAt:new Date().toISOString(),limits:{requestGasCap:fault.measuredRequestGasCap},
  }]);
  const options={rpcUrls:urls.slice(0,faults.length),approvedProjectRpcUrls:approved,readTransport,block:{number:18n,hash:snapshot.hash},fetchImpl,minIntervalMs:0,
    ...(providerCapabilities.length?{providerCapabilities}:{}),};
  return {requests,responses,privateRequests,options,transport:createKeelPublicSepoliaSimulationPool(options)};
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

test('explicit configured primary reads share candidate admission without rerouting or adding retries', async () => {
  const f = fixture([{}]), events = [];
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const primary = createKeelScheduledReadTransport({ request: async exact => { assert.equal(exact.method, 'eth_getCode'); entered(); await gate; return '0x6000'; } },
    { chainId: 11155111, rpcUrl: urls[0], minIntervalMs: 0, fetchImpl: f.options.fetchImpl, observe: event => events.push(event) });
  const read = primary.request({ method: 'eth_getCode', params: [reader, snapshot.number] }); await started;
  const simulation = f.transport.request(program()); void simulation.catch(() => undefined);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.requests.length, 0);
  release(); assert.equal(await read, '0x6000'); assert.equal((await simulation).length, 5);
  assert.ok(events.some(event => event.type === 'request-start'));
  await assert.rejects(primary.request(program()), /read-only methods/);
  const original = Object.assign(new Error('private execution revert'), { code: 3 }); let calls = 0;
  const failing = createKeelScheduledReadTransport({ request: async () => { calls++; throw original; } }, { chainId: 11155111, rpcUrl: urls[0], minIntervalMs: 0, fetchImpl: f.options.fetchImpl });
  await assert.rejects(failing.request({ method: 'eth_getCode', params: [reader, snapshot.number] }), error => error === original); assert.equal(calls, 1);
  await f.transport.close();
});

test('duplicate in-progress requests share one exact program and settled results are never cached', async () => {
  const f = fixture([{}]);
  try {
    const input = program(), before = structuredClone(input);
    const first = f.transport.request(input), second = f.transport.request(structuredClone(input));
    assert.equal(first, second);
    await Promise.all([first, second]); assert.equal(f.privateRequests().length, 1);
    assert.deepEqual(input, before);
    await f.transport.request(input); assert.equal(f.privateRequests().length, 2);
    for (const sent of f.privateRequests()) assert.deepEqual(sent.body.params, before.params);
  } finally { await f.transport.close(); }
});

test('distinct queued programs have an explicit bound and cancellation drains them without more dispatch', async () => {
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  const f = fixture([{ wait: true, started: () => reached() }]);
  const first = f.transport.request(program());
  // Install rejection handlers before cancelling the active request.
  const pending = [first];
  const outcomes = first.catch(() => undefined);
  await entered;
  for (let index = 1; index < 16; index++) {
    const exact = program(); exact.params[0].blockStateCalls[0].calls[0].data = `0x${index.toString(16).padStart(4, '0')}`;
    const request = f.transport.request(exact); void request.catch(() => undefined); pending.push(request);
  }
  const extra = program(); extra.params[0].blockStateCalls[0].calls[0].data = '0xffff';
  await assert.rejects(f.transport.request(extra), error => error.name === 'KeelProviderQueueFullError');
  await f.transport.close(); await outcomes;
  assert.ok((await Promise.allSettled(pending)).every(outcome => outcome.status === 'rejected'));
  assert.equal(f.privateRequests().length, 1);
});

test('private provider evidence preserves original RPC payload while public errors remain redacted', async () => {
  const f = fixture([{ error: -32602, message: 'owner-private exact rejection SECRET', errorData: { reason: 'owner-private exact diagnostic data', callIndex: 2 } }]);
  const events = [], attempts = [], transport = createKeelPublicSepoliaSimulationPool({ ...f.options, observe(event) {
    events.push(event);
    // Deliberate observer mutation affects only an evidence snapshot.
    if (event.rawResponse?.error) event.rawResponse.error.code = 123456;
    return Promise.reject(new Error('private persistence unavailable'));
  }, onAttempt: diagnostic => attempts.push(diagnostic) });
  try {
    await assert.rejects(transport.request(program()), error => {
      assert.equal(error.diagnostic.rpcCode, -32602); assert.doesNotMatch(JSON.stringify(error), /SECRET|owner-private|https:/); return true;
    });
    const failure = events.find(event => event.type === 'rpc-error' && event.rawResponse?.error?.message === 'owner-private exact rejection SECRET');
    assert.ok(failure); assert.equal(failure.method, 'eth_simulateV1');
    assert.deepEqual(failure.rawResponse.error.data, { reason: 'owner-private exact diagnostic data', callIndex: 2 });
    assert.deepEqual(failure.request.params, program().params);
    assert.equal(failure.requestWireBytes, Buffer.byteLength(f.privateRequests()[0].wire));
    assert.ok(failure.requestWireBytes > Buffer.byteLength(JSON.stringify(failure.request)));
    assert.doesNotMatch(JSON.stringify(events.map(({ request, rawResponse, error, ...safe }) => safe)), /SECRET|https:/);
    assert.doesNotMatch(JSON.stringify(attempts), /SECRET|https:/);
  } finally { await transport.close(); await f.transport.close(); }
});

test('private raw provider responses never cross observer ownership through shared negative capability cache', async () => {
  const f = fixture([{}]), ownerA = [], ownerB = [];
  let wireCalls = 0;
  const fetchImpl = async (url, init) => {
    wireCalls++; const body = JSON.parse(init.body);
    if (body.method === 'eth_simulateV1') return new Response('OWNER_A_ONLY_RAW_DENIAL', { status: 403 });
    return f.options.fetchImpl(url, init);
  };
  const a = createKeelPublicSepoliaSimulationPool({ ...f.options, fetchImpl, observe: event => ownerA.push(event) });
  const b = createKeelPublicSepoliaSimulationPool({ ...f.options, fetchImpl, observe: event => ownerB.push(event) });
  try {
    await assert.rejects(a.request(program())); const before = wireCalls;
    await assert.rejects(b.request(program())); assert.equal(wireCalls, before);
    assert.ok(ownerA.some(event => event.rawResponse?.body === 'OWNER_A_ONLY_RAW_DENIAL'));
    assert.doesNotMatch(JSON.stringify(ownerB), /OWNER_A_ONLY/);
    assert.ok(ownerB.some(event => event.type === 'capability-cache'));
  } finally { await a.close(); await b.close(); await f.transport.close(); }
});

test('an observed429 retries only after cooldown and full public qualification, preserving every call', async () => {
  const f = fixture([{}]), events = []; let failures = 0;
  const transport = createKeelPublicSepoliaSimulationPool({ ...f.options, observe: event => events.push(event), fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body), privateCall = body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x';
    if (privateCall && failures++ === 0) { f.requests.push({ index: 0, body, wire: init.body }); return new Response('owner-private rate body', { status: 429, headers: { 'Retry-After': '0.01' } }); }
    return f.options.fetchImpl(url, init);
  } });
  try {
    const exact = program(); assert.equal((await transport.request(exact)).length, 5);
    const requests = f.privateRequests(); assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body.params, requests[1].body.params);
    const between = f.requests.slice(f.requests.indexOf(requests[0]) + 1, f.requests.indexOf(requests[1]));
    assert.ok(between.some(request => request.body.method === 'eth_simulateV1' && request.body.params[0].blockStateCalls.length === 1 && request.body.params[0].validation));
    assert.ok(events.some(event => event.type === 'retry-wait' && event.retryAfterMs >= 900));
    assert.ok(events.some(event => event.type === 'rpc-error' && event.httpStatus === 429 && event.rawResponse.body === 'owner-private rate body'));
  } finally { await transport.close(); await f.transport.close(); }
});

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

test('a recovered request shares its original deadline and cannot receive a second full timeout budget', async (t) => {
  // Both clocks and timer delivery describe one deterministic request lifetime.
  // Real CI qualification must not consume the tiny recovery-eligibility margin
  // between the 1s cooldown, 1s minimum remaining budget and this 2.2s deadline.
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Number(BigInt(snapshot.timestamp)) * 1000 });
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed);
  const advance = async ms => { elapsed += ms; t.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve)); };
  let release, reached, recovering;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { reached = resolve; });
  const retrying = new Promise(resolve => { recovering = resolve; });
  let recoveryWait;
  const f = singleRecipientTransient({ fault: 503, requestTimeoutMs: 2_200,
    onAttempt: diagnostic => { if (diagnostic.sameRecipientRetry === 1) { recoveryWait = diagnostic.recoveryWaitMs; recovering(); } },
    beforeResponse: async () => { reached(); await gate; } });
  const input = program(); let settled = false;
  // Handle an unexpected early outcome immediately; waiting for a request that
  // never started must not leave an assertion rejection unobserved.
  const outcome = f.transport.request(input).then(value => ({ value }), error => ({ error })).then(result => { settled = true; return result; });
  const requireGate = async signal => assert.equal(await Promise.race([signal.then(() => true), outcome.then(() => false)]), true, 'request ended before the expected recovery boundary');
  try {
    await requireGate(retrying);
    assert.equal(recoveryWait, 1_000);
    await advance(recoveryWait - 1); assert.equal(f.privateAttempts(), 1);
    await advance(1); await requireGate(entered);
    assert.equal(f.privateAttempts(), 2);
    await advance(2_199 - elapsed); assert.equal(settled, false, 'original deadline has not elapsed');
    await advance(1);
    const result = await outcome;
    assert.equal(result.error?.kind, 'rpc-unavailable');
    assert.equal(result.error.diagnostic.transportFailure, 'timeout');
    assert.equal(elapsed, 2_200, 'recovery must not restart the complete-request clock');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.privateRequests().map(request => request.body.params), [input.params, input.params]);
    await assert.rejects(f.transport.request(program()), error => /cancelled/.test(error.message));
    assert.equal(f.privateAttempts(), 2);
  } finally { release(); await f.transport.close(); }
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
      assert.ok(probes.length>=4);assert.ok(probes.every(r=>r.body.params[0].blockStateCalls.reduce((n,b)=>n+BigInt(b.calls[0].gas),0n)===BigInt(count)*12_000n));
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
    assert.equal(item.observedPublicGasUsedSum,'480000');assert.equal(item.observedPublicMaxUsedGasSum,'480000');
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
  const f = fixture([{cap:true,capacityGas:40000000n}]);
  try {
    const input = fullPlan();
    for (const call of input.preparationCalls) call.gas = '0x989680';
    input.maximumReadGas = 50000000n; input.metadataCall.gas = '0x2faf080';
    const proof = await simulateKeelPublicationBeforeFunding(input, f.transport);
    assert.equal(proof.requestedReadGasLimit, '50000000');
    assert.equal(proof.effectiveReadGasLimit, '40000000');
    assert.deepEqual(proof.readBoundaryAttempts, [{requestedGas:'50000000', providerGasCap:'40000000'}]);
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
      assert.ok(proof.transactionGasLimits.every(g=>BigInt(g)<=50000000n));
      assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
      assert.ok(f.privateRequests().every(r=>r.index===0),'only the existing approved recipient receives project data');
      assert.deepEqual(f.privateRequests().map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,5],[true,5],[false,7]]);
      const strict=f.privateRequests()[1].body.params[0].blockStateCalls;
      assert.deepEqual(f.privateRequests()[2].body.params[0].blockStateCalls.slice(0,5),strict);
      assert.ok(f.requests.some(r=>r.index===0&&r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls.length===5&&r.body.params[0].blockStateCalls[0].calls[0].data==='0x'&&r.body.params[0].blockStateCalls[0].calls[0].gas==='0x2ee0'));
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
  // Synthetic demands exercise allocation; this is not actual-program or native-execution evidence.
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,projectGasByCall:[2000000n,150000n,5500000n]}]);
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
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,projectGasByCall:[9000000n]}]);
  try{
    const proof=await simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport);
    assert.equal(proof.discoveryGas.allocationAttempts[0].callIndex,0);
    assert.equal(proof.discoveryGas.allocationAttempts[0].strategy,'remaining-budget');
    assert.ok(BigInt(proof.discoveryGas.allocationAttempts[0].nextGasLimit)<=50000000n);
    assert.equal(proof.validatedTransactionCalls,14);
  }finally{await f.transport.close();}
});
test('a genuine contract revert still refuses approval after bounded same-program allocation checks',async()=>{
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,revert:true}]);
  try{
    await assert.rejects(simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport),e=>e.kind==='execution-reverted');
    const sent=f.privateRequests();assert.equal(sent.length,2);
    assert.ok(sent.every(r=>r.body.params[0].validation===false));
  }finally{await f.transport.close();}
});
test('later calls recover from reserved intrinsic floors through bounded complete discovery replays',async()=>{
  const demands=[9000000n,1000000n,8000000n,1000000n,6000000n,...Array(9).fill(100000n)];
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,projectGasByCall:demands}]);
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
    const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,projectGasByCall:[2000000n,150000n,5500000n],...fault}]);
    try{
      await assert.rejects(simulateKeelPublicationBeforeFunding(sharedBudgetPlan(),f.transport),e=>e.kind===kind);
      if(fault.missingProjectMaximumAt!==undefined)assert.equal(f.privateRequests().length,1);
      else assert.ok(f.privateRequests().some(r=>r.body.params[0].validation));
    }finally{await f.transport.close();}
  }
});
test('cancellation during budget redistribution discards late results and never reaches strict approval',async()=>{
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,projectGasByCall:[2000000n,150000n,5500000n]}]);
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
test('an explicit measured whole-request budget bounds every complete 14-call discovery replay', async()=>{
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n}],[urls[0]]),source=sharedBudgetPlan(),before=structuredClone(source);
  try {
    const proof=await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.deepEqual(source,before);
    assert.deepEqual(proof.discoveryGas.capacityAttempts,[{requestedGas:'200000000',providerGasCap:'50000000',
      programGasBudget:'50000000',perCallGasLimit:'3571428'}]);
    assert.ok(proof.discoveryGas.effectiveGasLimits.every(g=>g==='3571428'));
    const sent=f.privateRequests();assert.deepEqual(sent.map(r=>[r.body.params[0].validation,r.body.params[0].blockStateCalls.length]),[[false,14],[true,14],[false,16]]);
    const calls=r=>r.body.params[0].blockStateCalls.map(b=>b.calls[0]);
    const withoutGas=({gas,gasPrice,maxFeePerGas,maxPriorityFeePerGas,...c})=>c;
    for(const r of sent)assert.deepEqual(calls(r).slice(0,14).map(withoutGas),source.preparationCalls.map(withoutGas));
    assert.deepEqual(calls(sent[2]).slice(0,14),calls(sent[1]));
    assert.ok(calls(sent[1]).every(c=>BigInt(c.gas)>21000n),'measured margin is retained');
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
    assert.equal(proof.signing,'not-performed');assert.equal(proof.submission,'not-performed');
    // A later check uses the same explicit measured whole-request profile, but still
    // replays discovery, strict validation and exact complete metadata.
    await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.equal(f.privateRequests().length,6);
  } finally {await f.transport.close();}
});
test('an unprofiled later envelope remainder cannot authorize whole-request allocation',async()=>{
  const f=fixture([{sharedBudget:50000000n}],[urls[0]]),source=sharedBudgetPlan(),before=structuredClone(source);
  try{
    await assert.rejects(simulateKeelPublicationBeforeFunding(source,f.transport),e=>e.kind==='provider-limit'
      &&e.diagnostic.stage==='discovery-capacity-scope'&&e.diagnostic.gasCapacityScope==='envelope'
      &&e.diagnostic.blockIndex===1&&e.diagnostic.providerGasCap==='49979000'&&e.diagnostic.phase==='project-request'
      &&e.diagnostic.capacitySource!=='measured-profile');
    assert.deepEqual(source,before);assert.equal(f.privateRequests().length,1);
  }finally{await f.transport.close();}
});
test('project multi-block clamp diagnostics retain the exact request and cumulative position',async()=>{
  const seen=[],f=fixture([{sharedBudget:50000000n}],[urls[0]]);
  const transport=createKeelPublicSepoliaSimulationPool({...f.options,onAttempt:d=>seen.push(d)});
  try {
    const request=program();request.params[0].blockStateCalls=Array.from({length:14},(_,i)=>({calls:[{...call(i),gas:'0x2fa92c0'}]}));
    assert.equal(BigInt(request.params[0].blockStateCalls[0].calls[0].gas),49976000n);
    await assert.rejects(transport.request(request),e=>e.kind==='provider-limit'&&e.diagnostic.phase==='project-request'
      &&e.diagnostic.blockIndex===2&&e.diagnostic.callIndex===0&&e.diagnostic.requestedGasLimit==='49976000'&&e.diagnostic.providerGasCap==='49958000');
    assert.equal(f.privateRequests().length,1);assert.equal(seen.at(-1).phase,'project-request');assert.equal(seen.at(-1).blockIndex,2);
    assert.equal(seen.at(-1).requiredProgramGas,'699664000');
  }finally{await transport.close();await f.transport.close();}
});
test('shared discovery never reduces a measured margin, accepts a strict clamp or ignores complete metadata',async()=>{
  for(const [fault,kind] of [[{projectGas:3500000n},'provider-limit'],[{projectGas:4000000n},'execution-reverted'],[{strictBudget:25000n},'provider-limit'],[{metadata:'different'},'metadata-mismatch']]) {
    const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n,...fault}],[urls[0]]),source=sharedBudgetPlan(),before=structuredClone(source);
    try {await assert.rejects(simulateKeelPublicationBeforeFunding(source,f.transport),e=>e.kind===kind);assert.deepEqual(source,before);
      assert.ok(f.privateRequests().filter(r=>r.body.params[0].validation).length<=1);
      if(fault.projectGas)for(const request of f.privateRequests().filter(r=>r.body.params[0].validation))
        assert.ok(request.body.params[0].blockStateCalls.every(block=>BigInt(block.calls[0].gas)>fault.projectGas), 'strict replay preserves every measured margin');
    }finally{await f.transport.close();}
  }
});
test('shared discovery and a rejected 50M public-read ceiling preserve the strictly measured transactions',async()=>{
  const f=fixture([{sharedBudget:50000000n,measuredRequestGasCap:50000000n}],[urls[0]]),source=sharedBudgetPlan();
  source.maximumReadGas=50000000n;source.metadataCall={...source.metadataCall,gas:'0x2faf080'};
  const before=structuredClone(source);
  try {
    const proof=await simulateKeelPublicationBeforeFunding(source,f.transport);
    assert.deepEqual(source,before);assert.equal(proof.readBoundaryAttempts.length,1); // No extra adjustment for an oversized empty public control.
    assert.equal(proof.effectiveReadGasLimit,'49685000');
    const sent=f.privateRequests(),strict=sent.find(r=>r.body.params[0].validation).body.params[0].blockStateCalls;
    const replay=sent.filter(r=>r.body.params[0].blockStateCalls.length===16);
    assert.equal(replay.length,2);
    for(const request of replay)assert.deepEqual(request.body.params[0].blockStateCalls.slice(0,14),strict);
    assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(tokenURI));
  }finally{await f.transport.close();}
});

const capability = (index, limits, chainId = 11155111) => ({ chainId, rpcUrl: urls[index], measuredAt: new Date().toISOString(), limits });
const variableProgram = (count, envelope = 4450000n, size = 2) => {
  const input = program();
  input.params[0].blockStateCalls = Array.from({ length: count }, (_, i) => ({ calls: [{ ...call(i), gas: `0x${envelope.toString(16)}`, data: `0x${'ab'.repeat(size + i % 3)}` }] }));
  return input;
};

test('chain-keyed configured pool qualifies Ethereum and Sepolia without sharing a chain identity', async () => {
  for (const chainId of [1, 11155111]) {
    const f = fixture([{}]), chainHex = `0x${chainId.toString(16)}`;
    const transport = createKeelPublicSimulationPool({ ...f.options, chainId,
      readTransport: { request: async request => request.method === 'eth_chainId' ? chainHex : f.options.readTransport.request(request) },
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body);
        if (body.method === 'eth_chainId') { f.requests.push({ index: 0, body, wire: init.body }); return Response.json({ jsonrpc: '2.0', id: body.id, result: chainHex }); }
        return f.options.fetchImpl(url, init);
      },
    });
    const input = variableProgram(7, 2000000n), before = structuredClone(input);
    try {
      assert.equal((await transport.request(input)).length, 7);
      assert.deepEqual(f.privateRequests()[0].body.params, before.params);
      assert.deepEqual(input, before);
      assert.ok(f.requests.filter(r => r.body.method === 'eth_simulateV1' && r.body.params[0].blockStateCalls[0].calls[0].data === '0x').some(r => r.body.params[0].validation));
    } finally { await transport.close(); await f.transport.close(); }
  }
  const f = fixture([{}]);
  try {
    assert.throws(() => createKeelPublicSimulationPool({ ...f.options, chainId: 8453 }), /explicitly registered/);
    assert.throws(() => createKeelPublicSepoliaSimulationPool({ ...f.options, chainId: 1 }), /chain-keyed/);
    assert.equal(f.requests.length, 0);
  } finally { await f.transport.close(); }
});

test('measured profiles prefer approved request headroom while retaining every dependent call and byte', async () => {
  const f = fixture([{ sharedBudget: 50000000n, projectGas: 2000000n }, { sharedBudget: 100000000n, projectGas: 2000000n }]);
  const metrics = [], transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    providerCapabilities: [capability(0, { requestGasCap: 50000000n }), capability(1, { requestGasCap: 100000000n })],
    onMeasurement: value => { assert.equal(Object.isFrozen(value), true); metrics.push(value); },
  });
  const input = variableProgram(30), before = structuredClone(input);
  try {
    assert.equal((await transport.request(input)).length, 30);
    assert.deepEqual(f.privateRequests().map(r => r.index), [1]);
    assert.deepEqual(f.privateRequests()[0].body.params, before.params); assert.deepEqual(input, before);
    assert.equal(metrics[0].requestedEnvelopeGas, '133500000');
    assert.equal(metrics[1].gasMeasurement, 'simulation-response');
    assert.equal(metrics[1].measuredGasUsed, '60000000'); assert.equal(metrics[1].requiredRequestGas, '62450000');
    assert.doesNotMatch(JSON.stringify(metrics), /SECRET|PRIVATE|0xabab|https/);
  } finally { await transport.close(); await f.transport.close(); }
});

test('selected capacity failure keeps its originating provider rather than the last failed candidate', async () => {
  const f = fixture([{ cap: true, capacityGas: 50000000n }, { cap: true, capacityGas: 40000000n }]);
  const attempts = [], events = [], transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    onAttempt: value => attempts.push(value), observe: event => events.push(event),
  });
  try {
    await assert.rejects(transport.request(program()), error => {
      assert.equal(error.kind, 'provider-limit');
      assert.equal(attempts.at(-1).candidateIndex, 1);
      const safe = error.diagnostic;
      assert.equal(safe.candidateIndex, 0); assert.equal(safe.candidateCount, 2);
      assert.equal(safe.providerId, attempts[0].providerId);
      assert.ok(events.some(event => event.providerId === safe.providerId));
      assert.equal(safe.providerGasCap, '50000000'); assert.equal(safe.returnedGasLimit, '50000000');
      assert.equal(safe.requestedGasLimit, '200000000'); assert.equal(safe.requestedEnvelopeGas, '1000000000');
      assert.equal(safe.phase, 'public-qualification'); assert.equal(safe.gasCapacityScope, 'envelope');
      assert.doesNotMatch(JSON.stringify(safe), /SECRET|PRIVATE|https:\/\//);
      return true;
    });
    assert.equal(f.privateRequests().length, 0);
  } finally { await transport.close(); await f.transport.close(); }
});

test('measured capacity rejection identifies its selected provider without inventing a returned envelope', async () => {
  const f = fixture([{}, {}]), attempts = [];
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    providerCapabilities: [capability(0, { transactionGasCap: 4000000n }), capability(1, { transactionGasCap: 3000000n })],
    onAttempt: value => attempts.push(value),
  });
  try {
    await assert.rejects(transport.request(variableProgram(7)), error => {
      assert.equal(error.kind, 'provider-limit'); assert.equal(attempts.at(-1).candidateIndex, 1);
      assert.equal(error.diagnostic.candidateIndex, 0); assert.equal(error.diagnostic.candidateCount, 2);
      assert.equal(error.diagnostic.providerId, attempts[0].providerId);
      assert.match(error.diagnostic.providerId, /^provider-[1-9]\d*$/);
      assert.equal(error.diagnostic.phase, 'publication-preflight');
      assert.equal(error.diagnostic.capacitySource, 'measured-profile');
      assert.equal(error.diagnostic.returnedGasLimit, undefined);
      return true;
    });
    assert.equal(f.requests.length, 0);
  } finally { await transport.close(); await f.transport.close(); }
});

test('cumulative exhaustion falls back as a complete ordered program despite each call fitting the request cap', async () => {
  for (const count of [7, 29, 30, 31, 65]) {
    const f = fixture([{ sharedBudget: 10000000n, projectGas: 2000000n }, { sharedBudget: 200000000n, projectGas: 2000000n }]);
    const attempts = [], transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, onAttempt: d => attempts.push(d) });
    const input = variableProgram(count, 4450000n, count * 11), before = structuredClone(input);
    try {
      assert.equal((await transport.request(input)).length, count);
      const projects = f.privateRequests(); assert.deepEqual(projects.map(r => r.index), [0, 1]);
      for (const r of projects) assert.deepEqual(r.body.params, before.params);
      assert.deepEqual(input, before); assert.equal(attempts[0].blockCount, count);
      assert.equal(attempts[0].largestTransactionGas, '4450000'); assert.equal(attempts[0].requestedEnvelopeGas, String(BigInt(count) * 4450000n));
      assert.equal(attempts[0].phase, 'project-request'); assert.equal(attempts[0].gasCapacityScope, 'envelope');
    } finally { await transport.close(); await f.transport.close(); }
  }
});

test('a gas-envelope sum above a measured Geth request cap still permits a cheap complete program', async () => {
  const f = fixture([{ sharedBudget: 50000000n }]), transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    providerCapabilities: [capability(0, { requestGasCap: 50000000n, transactionGasCap: 5000000n, blockGasCap: 10000000n })],
  });
  try { assert.equal((await transport.request(variableProgram(65))).length, 65); assert.equal(f.privateRequests().length, 1); }
  finally { await transport.close(); await f.transport.close(); }
});

test('distinct provider transaction, block, byte and block-count limits select another approved full-program validator', async () => {
  for (const limits of [{ transactionGasCap: 4000000n }, { blockGasCap: 4000000n }, { maximumRequestBytes: 1000 }, { maximumBlocks: 6 }]) {
    const f = fixture([{}, {}]), attempts = [], transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
      providerCapabilities: [capability(0, limits)], onAttempt: d => attempts.push(d),
    });
    const input = variableProgram(7, 4450000n, 500);
    try {
      assert.equal((await transport.request(input)).length, 7); assert.deepEqual(f.privateRequests().map(r => r.index), [1]);
      assert.deepEqual(f.privateRequests()[0].body.params, input.params);
      assert.equal(attempts[0].capacitySource, 'measured-profile'); assert.equal(attempts[0].callCount, 7);
      assert.doesNotMatch(JSON.stringify(attempts), /SECRET|PRIVATE|https|0xabab/);
    } finally { await transport.close(); await f.transport.close(); }
  }
});

test('profiles cannot approve an indexed recipient or silently change chain or mutable limits', async () => {
  const f = fixture([{ sharedBudget: 10000000n, projectGas: 2000000n }, {}], [urls[0]]);
  const limits = { requestGasCap: 200000000n }, profiles = [capability(1, limits)];
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, providerCapabilities: profiles });
  limits.requestGasCap = 1n; profiles[0].chainId = 1; profiles[0].rpcUrl = 'https://private-recipient.example';
  f.options.approvedProjectRpcUrls.push(urls[1]);
  try {
    await assert.rejects(transport.request(variableProgram(30)), error => error.kind === 'provider-limit' || error.diagnostic.recipientApprovalRequired === 1);
    assert.deepEqual(f.privateRequests().map(r => r.index), [0]);
  } finally { await transport.close(); await f.transport.close(); }
  const clean = fixture([{}]);
  try {
    for (const providerCapabilities of [[capability(0, {}, 1)], [{ ...capability(0, {}), rpcUrl: 'https://not-configured.example' }],
      [capability(0, {}), capability(0, {})], [{ ...capability(0, {}), measuredAt: 'bad date' }]])
      assert.throws(() => createKeelPublicSimulationPool({ ...clean.options, chainId: 11155111, providerCapabilities }), /capacity|Capacity|capabilities|capability/);
  } finally { await clean.transport.close(); }
});

test('a measured high-capacity backend still refuses stale heads, changed pins and wrong chain before project disclosure', async () => {
  for (const fault of [{ stale: true }, { pin: true }, { chain: true }]) {
    const f = fixture([fault]), transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
      providerCapabilities: [capability(0, { requestGasCap: 200000000n })],
    });
    try { await assert.rejects(transport.request(variableProgram(30))); assert.equal(f.privateRequests().length, 0); }
    finally { await transport.close(); await f.transport.close(); }
  }
});

test('no compatible validator reports an honest infrastructure failure and leaves large content and strict gas intact', async () => {
  const f = fixture([{ sharedBudget: 50000000n, projectGas: 2000000n }]);
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, providerCapabilities: [capability(0, { requestGasCap: 50000000n })] });
  const input = variableProgram(30, 4450000n, 32768), before = structuredClone(input);
  try {
    await assert.rejects(transport.request(input), error => error.kind === 'provider-limit' && error.diagnostic.capacitySource === 'measured-profile'
      && error.diagnostic.gasCapacityScope === 'request' && BigInt(error.diagnostic.intrinsicProgramGas) > 50000000n
      && error.diagnostic.callCount === 30 && error.diagnostic.largestTransactionGas === '4450000');
    assert.deepEqual(input, before);
    assert.ok(Buffer.byteLength(JSON.stringify(input)) > 1900000); assert.equal(f.privateRequests().length, 0);
    assert.equal(f.requests.length, 0, 'A verified intrinsic lower bound avoids every impossible provider sequence');
  } finally { await transport.close(); await f.transport.close(); }
});

test('a later cumulative remainder does not disable the same provider for a smaller unchanged program', async () => {
  const f = fixture([{ sharedBudget: 10000000n, projectGas: 2000000n }]);
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111 });
  try {
    await assert.rejects(transport.request(variableProgram(7)), error => error.kind === 'provider-limit' && error.diagnostic.blockIndex > 0);
    const smaller = variableProgram(2);
    assert.equal((await transport.request(smaller)).length, 2);
    assert.deepEqual(f.privateRequests().at(-1).body.params, smaller.params);
  } finally { await transport.close(); await f.transport.close(); }
});

test('explicit request-budget exhaustion falls back without guessing the cap or splitting dependent state', async () => {
  for (const code of [-32000, -38026]) {
  const f = fixture([{}, {}]), attempts = [];
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, onAttempt: d => attempts.push(d),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url === urls[0] && body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x') {
        f.requests.push({ index: 0, body, wire: init.body });
        return Response.json({ jsonrpc: '2.0', id: body.id, error: { code, message: 'SECRET RPC gas cap exhausted: need 2000000, remaining 0' } });
      }
      return f.options.fetchImpl(url, init);
    },
  });
  const input = variableProgram(30), before = structuredClone(input);
  try {
    assert.equal((await transport.request(input)).length, 30);
    assert.deepEqual(f.privateRequests().map(r => r.index), [0, 1]);
    for (const r of f.privateRequests()) assert.deepEqual(r.body.params, before.params);
    assert.equal(attempts[0].gasCapacityScope, 'request'); assert.equal(attempts[0].remainingRequestGas, '0');
    assert.equal(attempts[0].providerGasCap, undefined); assert.doesNotMatch(JSON.stringify(attempts), /SECRET|PRIVATE|https?:\/\//);
  } finally { await transport.close(); await f.transport.close(); }
  }
});

test('stale measured capacity does not disable an intrinsically valid program after a provider upgrade', async () => {
  const f = fixture([{}]);
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, providerCapabilities: [{
    ...capability(0, { transactionGasCap: 1n, requestGasCap: 1n, maximumRequestBytes: 1, maximumBlocks: 1 }),
    measuredAt: new Date(Date.now() - 300001).toISOString(),
  }] });
  const input = variableProgram(30), before = structuredClone(input);
  try { assert.equal((await transport.request(input)).length, 30); assert.deepEqual(f.privateRequests()[0].body.params, before.params); }
  finally { await transport.close(); await f.transport.close(); }
  const clean = fixture([{}]);
  try {
    assert.throws(() => createKeelPublicSimulationPool({ ...clean.options, chainId: 11155111,
      providerCapabilities: [{ ...capability(0, {}), measuredAt: new Date(Date.now() + 60000).toISOString() }],
    }), /observation time/);
    for (const capabilityMaximumAgeMs of [-1, 300001, Infinity])
      assert.throws(() => createKeelPublicSimulationPool({ ...clean.options, chainId: 11155111, capabilityMaximumAgeMs }), /expire/);
  } finally { await clean.transport.close(); }
});

test('profiles that expire during a reused transport cause fresh exact qualification on the next phase', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Number(BigInt(snapshot.timestamp)) * 1000 });
  const f = fixture([{}]), transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    providerCapabilities: [capability(0, { transactionGasCap: 1000000n })], capabilityMaximumAgeMs: 1000,
  });
  try {
    await assert.rejects(transport.request(variableProgram(7)), error => error.kind === 'provider-limit' && error.diagnostic.capacitySource === 'measured-profile');
    assert.equal(f.privateRequests().length, 0); t.mock.timers.tick(1001);
    assert.equal((await transport.request(variableProgram(7))).length, 7); assert.equal(f.privateRequests().length, 1);
  } finally { await transport.close(); await f.transport.close(); }
});

test('fallback replays dependent state from the beginning, never a successful-prefix continuation', async () => {
  const count = 7, f = fixture([{ sharedBudget: 10000000n, projectGas: 2000000n }, {}]);
  const input = variableProgram(count);
  input.params[0].blockStateCalls.forEach((block, i) => { block.calls[0].data = `0xab${i.toString(16).padStart(2, '0')}`; });
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body), blocks = body.params[0]?.blockStateCalls;
      if (body.method === 'eth_simulateV1' && blocks[0].calls[0].data !== '0x') {
        // One fresh ephemeral fixture state per request. Every call consumes
        // state created by its predecessor; a suffix or reorder is a revert.
        let state = 0;
        for (const block of blocks) {
          if (block.calls[0].data !== `0xab${state.toString(16).padStart(2, '0')}`)
            return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'fixture dependent state missing' } });
          state++;
        }
        assert.equal(state, count);
      }
      return f.options.fetchImpl(url, init);
    },
  });
  try {
    assert.equal((await transport.request(input)).length, count); assert.deepEqual(f.privateRequests().map(r => r.index), [0, 1]);
    for (const r of f.privateRequests()) assert.deepEqual(r.body.params, input.params);
  } finally { await transport.close(); await f.transport.close(); }
});

test('an observed earlier provider cap also expires and requalifies after infrastructure recovery', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Number(BigInt(snapshot.timestamp)) * 1000 });
  const fault = { cap: true }, f = fixture([fault]), transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111, capabilityMaximumAgeMs: 1000 });
  try {
    await assert.rejects(transport.request(program()), error => error.kind === 'provider-limit');
    assert.equal(f.privateRequests().length, 0); fault.cap = false; t.mock.timers.tick(1001);
    assert.equal((await transport.request(program())).length, 5); assert.equal(f.privateRequests().length, 1);
  } finally { await transport.close(); await f.transport.close(); }
});

test('only typed request-capacity evidence permits -38026 fallback; transaction validation and ambiguous client errors remain terminal', async () => {
  for (const fault of [
    { error: -38026, message: 'too many blocks SECRET' },
    { error: -38026, message: 'maximum allowed gas: 50000000 SECRET' },
    { error: -38011, message: 'RPC gas cap: 50000000 SECRET' },
    { error: -38013, message: 'RPC gas cap: 50000000 SECRET' },
  ]) {
    const f = fixture([fault, {}]), transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111 });
    try {
      await assert.rejects(transport.request(variableProgram(30)), error => error.diagnostic.rpcCode === fault.error);
      assert.deepEqual(f.privateRequests().map(r => r.index), [0]); assert.ok(f.requests.every(r => r.index === 0));
    } finally { await transport.close(); await f.transport.close(); }
  }
  const f = fixture([{ error: -38026, message: 'RPC gas cap: 50000000 SECRET' }, {}]);
  const transport = createKeelPublicSimulationPool({ ...f.options, chainId: 11155111 });
  const input = variableProgram(30);
  try {
    assert.equal((await transport.request(input)).length, 30); assert.deepEqual(f.privateRequests().map(r => r.index), [0, 1]);
    for (const r of f.privateRequests()) assert.deepEqual(r.body.params, input.params);
  } finally { await transport.close(); await f.transport.close(); }
});


test('configured reader standalone estimates require explicit admission and never enable stateful simulation', async () => {
  const calls = [], transport = { request: async exact => { calls.push(structuredClone(exact)); return '0x5208'; } };
  const options = { chainId: 11155111, rpcUrl: 'https://existing-reader-estimate.example/rpc', minIntervalMs: 0 };
  const estimate = { method: 'eth_estimateGas', params: [{ to: reader, data: '0x1234' }, snapshot.number] };
  await assert.rejects(createKeelScheduledReadTransport(transport, options).request(estimate), /read-only methods/);
  assert.equal(calls.length, 0);
  const admitted = createKeelScheduledReadTransport(transport, { ...options, allowEstimateGas: true });
  assert.equal(await admitted.request(estimate), '0x5208');
  assert.deepEqual(calls, [estimate]);
  await assert.rejects(admitted.request(program()), /read-only methods/);
  assert.equal(calls.length, 1);
});


test('existing configured loopback and full reader calldata require explicit bounded admission without rerouting', async () => {
  const calls = [], transport = { request: async exact => { calls.push(structuredClone(exact)); return '0x'; } };
  const options = { chainId: 31337, rpcUrl: 'http://127.0.0.1:8545', minIntervalMs: 0 };
  assert.throws(() => createKeelScheduledReadTransport(transport, options), /HTTPS/);
  const small = createKeelScheduledReadTransport(transport, { ...options, allowLoopback: true });
  const request = { method: 'eth_call', params: [{ to: reader, data: '0x' + 'ab'.repeat(270000) }, 'latest'] };
  await assert.rejects(small.request(request), /bounded read request/);
  assert.equal(calls.length, 0);
  const admitted = createKeelScheduledReadTransport(transport, { ...options, allowLoopback: true, maximumRequestBytes: 16 * 1024 * 1024 });
  assert.equal(await admitted.request(request), '0x');
  assert.deepEqual(calls, [request]);
  assert.throws(() => createKeelScheduledReadTransport(transport, { ...options, allowLoopback: true, rpcUrl: 'http://unapproved-remote.example/rpc' }), /HTTPS/);
  assert.throws(() => createKeelScheduledReadTransport(transport, { ...options, allowLoopback: true, maximumRequestBytes: 32 * 1024 * 1024 + 1 }), /bounded request size/);
});


test('explicit existing server transport identities preserve private HTTP reads without opening or disclosing a route', async () => {
  const events = [], calls = [], request = { method: 'eth_getCode', params: [reader, snapshot.number] };
  const options = { chainId: 31337, rpcUrl: 'http://USER_SENTINEL:PASS_SENTINEL@anvil:8545/rpc?token=TOKEN_SENTINEL', minIntervalMs: 0 };
  const existing = { request: async exact => { calls.push(structuredClone(exact)); return '0x6000'; } };
  assert.throws(() => createKeelScheduledReadTransport(existing, options), /HTTPS/);
  const admitted = createKeelScheduledReadTransport(existing, { ...options, configuredRecipient: true, observe: event => events.push(event),
    fetchImpl: async () => { throw new Error('admission must not open another transport'); } });
  assert.equal(await admitted.request(request), '0x6000');
  assert.deepEqual(calls, [request]);
  assert.doesNotMatch(JSON.stringify(events), /anvil|http:|USER_SENTINEL|PASS_SENTINEL|TOKEN_SENTINEL/);
  await assert.rejects(admitted.request(program()), /read-only methods/);
  assert.equal(calls.length, 1);
});


test('configured root URLs keep distinct credential identities without exposing them to observers', async () => {
  const identifiers = [];
  for (const user of ['USER_A', 'USER_B']) {
    const events = [];
    const admitted = createKeelScheduledReadTransport({ request: async () => '0x1' }, { chainId: 31337,
      rpcUrl: `http://${user}:PASS_SENTINEL@anvil:8545/`, configuredRecipient: true, minIntervalMs: 0, observe: event => events.push(event) });
    assert.equal(await admitted.request({ method: 'eth_chainId', params: [] }), '0x1');
    identifiers.push(events.find(event => event.providerId)?.providerId);
    assert.doesNotMatch(JSON.stringify(events), /USER_A|USER_B|PASS_SENTINEL|anvil/);
  }
  assert.ok(identifiers.every(Boolean));
  assert.notEqual(identifiers[0], identifiers[1]);
});
// Captured operator categories, synthetic data only. Library evidence
// libfile_bf7ede842b2081919bc7c130c019a4d6 (2026-10-10 10:29–10:34 UTC).
test('rate/access diagnostics survive approved whole-program failover without shopping deterministic rejections',async()=>{
  for(const fault of [{http:429,httpCode:-32005},{http:403},{error:-32005},{error:403}]) {
    const f=fixture([fault,{}]), attempts=[];
    const transport=createKeelPublicSepoliaSimulationPool({...f.options,onAttempt:d=>attempts.push(d)});
    try {
      const input=program();await transport.request(input);
      assert.deepEqual(f.privateRequests().map(r=>r.body.params),[input.params,input.params]);
      assert.equal(attempts.length,1);assert.equal(attempts[0].failureReason,fault.http===403||fault.error===403?'access-denied':'rate-limited');
      assert.equal(attempts[0].httpStatus,fault.http??200);assert.equal(attempts[0].rpcCode,fault.httpCode??fault.error);
      assert.doesNotMatch(JSON.stringify(attempts),/SECRET|PRIVATE|first.example/);
      await transport.request(input);assert.equal(f.privateRequests().filter(r=>r.index===0).length,1);
    }finally{await transport.close();await f.transport.close();}
  }
  for(const code of [-32602,-38011,3,-32000,-32603]) {
    const f=fixture([{http:429,httpCode:code},{}]);try{
      await assert.rejects(f.transport.request(program()),e=>e.diagnostic.rpcCode===code&&e.diagnostic.httpStatus===429);
      assert.ok(f.requests.every(r=>r.index===0),'explicit invalid-request evidence is terminal even on HTTP429');
    }finally{await f.transport.close();}
  }
});

test('public probes use bounded Amsterdam base gas without lowering exact project envelopes',async()=>{
  const fixedPrice=31n;
  for(const envelope of [12_000n,200_000_000n]) {
    const sequenceGas=5n*12_000n;
    // The existing single-capacity qualifier also includes its 21k follow-up call.
    const capacityProbeGas=envelope+21_000n;
    const exactBalance=(capacityProbeGas>sequenceGas?capacityProbeGas:sequenceGas)*fixedPrice;
    const f=fixture([{balance:`0x${exactBalance.toString(16)}`,baseGas:'0x2ee0'}]);try{
      const input=program();for(const b of input.params[0].blockStateCalls)b.calls[0].gas=`0x${envelope.toString(16)}`;
      await f.transport.request(input);assert.deepEqual(f.privateRequests()[0].body.params,input.params);
    }finally{await f.transport.close();}
    const low=fixture([{balance:`0x${(exactBalance-1n).toString(16)}`,baseGas:'0x2ee0'}]);try{
      const input=program();for(const b of input.params[0].blockStateCalls)b.calls[0].gas=`0x${envelope.toString(16)}`;
      await assert.rejects(low.transport.request(input));assert.equal(low.privateRequests().length,0);
    }finally{await low.transport.close();}
  }
});

// Synthetic HTTP boundaries only. These limits do not claim a live provider cap.
test('200 small calls succeed while a fixed 45-call program fails only after its serialized bytes cross the synthetic HTTP boundary', async () => {
  const f = fixture([{ maximumRequestBytes: 262_144 }]);
  const padded = (count, bytes = 0) => {
    const exact = program();
    exact.params[0].blockStateCalls = Array.from({ length: count }, (_, index) => ({ calls: [{ ...call(index), gas: '0xf4240' }] }));
    exact.params[0].blockStateCalls[0].calls[0].data = '0xbeef' + '00'.repeat(bytes);
    return exact;
  };
  try {
    assert.equal((await f.transport.request(padded(200))).length, 200);
    assert.equal((await f.transport.request(padded(45, 110_000))).length, 45);
    const smaller = f.privateRequests().at(-1);
    assert.ok(Buffer.byteLength(smaller.wire) < 262_144);
    const large = padded(45, 524_288), original = structuredClone(large);
    await assert.rejects(f.transport.request(large), error => {
      const oversized = f.privateRequests().filter(request => Buffer.byteLength(request.wire) > 262_144);
      console.info(JSON.stringify({ kind: 'synthetic-production-size-path', failureKind: error.kind,
        httpStatus: error.diagnostic.httpStatus, gasCapacityScope: error.diagnostic.gasCapacityScope,
        projectAttempts: oversized.length, requestBytes: oversized.map(request => Buffer.byteLength(request.wire)),
        callsPerAttempt: oversized.map(request => request.body.params[0].blockStateCalls.length) }));
      assert.equal(error.kind, 'provider-limit');
      assert.equal(error.diagnostic.httpStatus, 503);
      assert.equal(error.diagnostic.gasCapacityScope, 'request-bytes');
      assert.ok(error.diagnostic.requestPayloadBytes > 1_048_576);
      assert.doesNotMatch(error.message, /SECRET|PRIVATE|https:/);
      return true;
    });
    assert.deepEqual(large, original);
    const attempts = f.privateRequests().filter(request => Buffer.byteLength(request.wire) > 262_144);
    assert.equal(attempts.length, 1, 'An explicit body-size rejection must not retry the same oversized request as a transient outage');
    for (const attempt of attempts) {
      assert.equal(attempt.body.params[0].blockStateCalls.length, 45);
      assert.deepEqual(attempt.body.params, original.params);
      assert.ok(Buffer.byteLength(attempt.wire) > 1_048_576);
    }
    assert.ok(f.requests.every(request => !request.body.method.includes('send')));
  } finally { await f.transport.close(); }
});

test('exact serialized HTTP boundary keeps every dependent call and permits only approved identical-program failover', async () => {
  const f = fixture([{}, {}]);
  const exact = program(), before = structuredClone(exact), wires = [];
  let limit;
  const pool = createKeelPublicSepoliaSimulationPool({ ...f.options, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x') {
      const size = Buffer.byteLength(init.body);
      wires.push({ url, size, body });
      // The first actual serialized wire sets this synthetic boundary one byte below itself.
      if (limit === undefined) limit = size - 1;
      if (url === urls[0] && size > limit) return new Response('', { status: 413 });
    }
    return f.options.fetchImpl(url, init);
  } });
  try {
    assert.equal((await pool.request(exact)).length, 5);
    assert.equal(wires.length, 2);
    assert.equal(wires[0].size, limit + 1);
    assert.equal(wires[1].url, urls[1]);
    for (const wire of wires) assert.deepEqual(wire.body.params, before.params);
    assert.deepEqual(exact, before);
  } finally { await pool.close(); await f.transport.close(); }
});


test('HTTP503 byte capacity permits only approved identical 45-call fallback and never a same-recipient retry', async () => {
  for (const rpcCode of [undefined,-32000,-38026]) {
    const f=fixture([{httpResponse:body=>rpcCode===undefined?new Response('request body too large',{status:503}):Response.json({jsonrpc:'2.0',id:body.id,error:{code:rpcCode,message:'request body too large'}},{status:503})},{},{}],[urls[0],urls[2]]);
    const attempts=[],pool=createKeelPublicSepoliaSimulationPool({...f.options,onAttempt:d=>attempts.push(d)});
    const input=program(); input.params[0].blockStateCalls=Array.from({length:45},(_,i)=>({calls:[{...call(i),gas:'0xf4240'}]}));
    const before=structuredClone(input);
    try {
      assert.equal((await pool.request(input)).length,45);
      assert.deepEqual(f.privateRequests().map(r=>r.index),[0,2]);
      for(const r of f.privateRequests())assert.deepEqual(r.body.params,before.params);
      assert.deepEqual(input,before);assert.equal(attempts.length,1);
      assert.equal(attempts[0].gasCapacityScope,'request-bytes');assert.equal(attempts[0].httpStatus,503);
      assert.equal(attempts[0].sameRecipientRetry,undefined);
    } finally {await pool.close();await f.transport.close();}
  }
});

test('HTTP503 deterministic RPC rejections never shop for another provider despite capacity prose', async () => {
  for(const code of [3,-32602,-38011,-38013]) {
    const f=fixture([{httpResponse:body=>Response.json({jsonrpc:'2.0',id:body.id,error:{code,message:'request body too large'}},{status:503})},{}]);
    try {
      await assert.rejects(f.transport.request(program()),error=>error.diagnostic.rpcCode===code&&error.diagnostic.gasCapacityScope===undefined);
      assert.deepEqual(f.privateRequests().map(r=>r.index),[0]);
      assert.ok(f.requests.every(r=>r.index===0));
    }finally{await f.transport.close();}
  }
});

test('cancelling after a body-capacity rejection prevents fallback dispatch', async () => {
  const f=fixture([{httpResponse:()=>new Response('request body too large',{status:503})},{}]);
  let pool;pool=createKeelPublicSepoliaSimulationPool({...f.options,onAttempt:()=>{void pool.close();}});
  try {
    await assert.rejects(pool.request(program()),error=>/cancelled/.test(error.message));
    assert.deepEqual(f.privateRequests().map(r=>r.index),[0]);
  }finally{await pool.close();await f.transport.close();}
});

test('body-capacity fallback shares the complete-request deadline and discards a late unchanged response', async () => {
  let entered;
  const secondStarted=new Promise(resolve=>{entered=resolve;});
  const f=fixture([{httpResponse:()=>new Response('request body too large',{status:503})},{}]);
  const pool=createKeelPublicSepoliaSimulationPool({...f.options,requestTimeoutMs:150,fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body),privateCall=body.method==='eth_simulateV1'&&body.params[0].blockStateCalls[0].calls[0].data!=='0x';
    if(url===urls[1]&&privateCall){entered();await new Promise(resolve=>setTimeout(resolve,200));}
    return f.options.fetchImpl(url,init);
  }});
  const input=program(),before=structuredClone(input),started=performance.now();
  try {
    const refusal=assert.rejects(pool.request(input),error=>/exceeded its bounded time budget/.test(error.message));
    await secondStarted;await refusal;assert.ok(performance.now()-started<300);
    await new Promise(resolve=>setTimeout(resolve,220));
    assert.deepEqual(f.privateRequests().map(r=>r.index),[0,1]);
    for(const r of f.privateRequests())assert.deepEqual(r.body.params,before.params);
  }finally{await pool.close();await f.transport.close();}
});

// Synthetic protocol boundaries only: the real native EVM/witness integration
// is qualified separately by verify-local-staged-publication.mjs. No reply here
// is a captured project result or evidence of actual native execution.
function authenticatedLocalFixture(f, { root = hash(808), finishIncomplete = false, pauseStage, nativeFault = {} } = {}) {
  const clients = [], programs = [], sessions = [], witnessPrograms = [], stageEntered = {};
  let entered;
  stageEntered.promise = new Promise(resolve => { entered = resolve; });
  const ordinary = fixture([nativeFault]);
  const previousRead = f.options.readTransport;
  const options = { ...f.options, readTransport: { request: async input => input.method === 'eth_getBlockByNumber'
    ? { ...snapshot, stateRoot: hash(808) } : previousRead.request(input) } };
  const capability = { stateRoot: root,
    witnessResolution: { async prepare(input) { witnessPrograms.push(structuredClone(input)); }, async resolve() { assert.fail('No missing synthetic witness expected'); } },
    onSession: value => sessions.push(value),
    async createClient() {
      const state = { closed: 0, next: 0, stages: [], program: undefined, results: undefined }; clients.push(state);
      return { async close() { state.closed++; }, async request(body, { signal }) {
        const binding = { sessionId: body.sessionId, canonicalHash: body.canonicalHash, programDigest: body.programDigest };
        if (body.type === 'begin') {
          state.program = JSON.parse(body.programJSON); programs.push(structuredClone(state.program));
          const response = await ordinary.options.fetchImpl(urls[0], { body: JSON.stringify({ jsonrpc: '2.0', id: 1,
            method: 'eth_simulateV1', params: [state.program, snapshot.number] }) });
          state.results = (await response.json()).result;
          return { id: body.id, result: { ...binding, status: 'open', nextIndex: 0, stageCount: state.program.blockStateCalls.length, checkpoint: snapshot.hash, acceptance: false } };
        }
        if (body.type === 'stage') {
          assert.equal(body.index, state.next, 'Never run a suffix without its original complete prefix');
          assert.equal(body.expectedCheckpoint, state.next ? hash(900 + state.next - 1) : snapshot.hash);
          if (body.index === pauseStage) {
            entered();
            await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('synthetic cancelled native stage')), { once: true }));
          }
          const result = { ...binding, index: state.next, previousCheckpoint: body.expectedCheckpoint,
            checkpoint: hash(900 + state.next), result: state.results[state.next] };
          state.next++; state.stages.push(result);
          return { id: body.id, result };
        }
        assert.equal(body.type, 'finish');
        return { id: body.id, result: { ...binding, status: 'completed', acceptance: false,
          stageCount: state.next, checkpoint: state.stages.at(-1).checkpoint, results: state.results,
          fullWitnessComplete: !finishIncomplete, headerHistoryComplete: true, stickyStateError: false } };
      } };
    },
  };
  return { options: { ...options, authenticatedLocalSession: capability }, clients, programs, sessions, witnessPrograms, stageEntered };
}


test('authenticated local capacity: exact45-call discovery, strict replay and complete metadata use fresh same-pin full native sessions', async () => {
  const f = fixture([{ cap: true }]), local = authenticatedLocalFixture(f);
  const transport = createKeelPublicSimulationPool({ ...local.options, chainId: 11155111 });
  const input = { ...fullPlan(), preparationCalls: Array.from({ length: 45 }, (_, i) => call(i)), assertions: [] }, before = structuredClone(input);
  try {
    const proof = await simulateKeelPublicationBeforeFunding(input, transport);
    assert.equal(proof.validatedTransactionCalls, 45);
    assert.equal(proof.simulatedCalls, 47);
    assert.equal(proof.completeTokenUriBytes, Buffer.byteLength(tokenURI));
    assert.deepEqual(local.programs.map(p => [p.validation, p.blockStateCalls.length]), [[false,45],[true,45],[false,47]]);
    assert.equal(new Set(local.sessions.map(s => s.programDigest)).size, 3);
    for (const program of local.programs) {
      for (let i = 0; i < 45; i++) for (const field of ['from','to','data','value'])
        assert.equal(program.blockStateCalls[i].calls[0][field], before.preparationCalls[i][field]);
      assert.ok(program.blockStateCalls.every(block => Object.keys(block).join(',') === 'calls'));
    }
    assert.ok(local.clients.every(c => c.closed === 1 && c.next === c.program.blockStateCalls.length));
    assert.ok(local.sessions.every(s => s.fullWitnessComplete && s.headerHistoryComplete && !s.stickyStateError));
    assert.equal(local.witnessPrograms.length, 3);
    assert.deepEqual(input, before);
    assert.equal(f.privateRequests().length, 0, 'Approved capacity refusal precedes private provider disclosure');
  } finally { await transport.close(); await f.transport.close(); }
});

test('authenticated local capacity: absent or incomplete capability never bypasses provider capacity or missing authenticated witness', async () => {
  const f = fixture([{cap:true}]);
  await assert.rejects(f.transport.request(program()), e => e.kind === 'provider-limit');
  assert.throws(() => createKeelPublicSimulationPool({ ...f.options, chainId:11155111,
    authenticatedLocalSession: { stateRoot:hash(808), createClient:async()=>assert.fail('No client'), witnessResolution:{} } }), /complete witness resolver/);
  const local = authenticatedLocalFixture(f, { finishIncomplete:true });
  const transport = createKeelPublicSimulationPool({ ...local.options, chainId:11155111 });
  try { await assert.rejects(transport.request(program()),e=>e.kind==='unsupported-simulation');
    assert.equal(local.sessions.length,0); assert.equal(local.clients.length,1); assert.equal(local.clients[0].closed,1);
  } finally { await transport.close(); await f.transport.close(); }
});

test('authenticated local capacity: unauthorized recipients and ambiguous limits do not activate native capability', async () => {
  for (const [fault, approved] of [[{cap:true},[]],[{error:-38026},[urls[0]]]]) {
    const f=fixture([fault],approved),local=authenticatedLocalFixture(f),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
    try { await assert.rejects(transport.request(program())); assert.equal(local.clients.length,0); }
    finally { await transport.close(); await f.transport.close(); }
  }
});

test('authenticated local capacity: genuine primary execution failure and metadata mismatch remain terminal with no native replay',async()=>{
  for(const [fault,kind] of [[{revert:true},'execution-reverted'],[{metadata:tokenURI+' changed'},'metadata-mismatch']]) {
    const f=fixture([fault]),local=authenticatedLocalFixture(f),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
    try {await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),transport),e=>e.kind===kind);assert.equal(local.clients.length,0);}
    finally {await transport.close();await f.transport.close();}
  }
});

test('authenticated local capacity: canonical state-root mismatch fails before creating a native process',async()=>{
  const f=fixture([{cap:true}]),local=authenticatedLocalFixture(f,{root:hash(809)}),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
  try {await assert.rejects(transport.request(program()),e=>e.kind==='chain-reorganized');assert.equal(local.clients.length,0);}
  finally {await transport.close();await f.transport.close();}
});

test('authenticated local capacity: cancellation while primary request waits never activates local replay',async()=>{
  let entered;const started=new Promise(resolve=>{entered=resolve;});
  const f=fixture([{wait:true,started:entered}]),local=authenticatedLocalFixture(f),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
  const pending=transport.request(program());await started;await transport.close();
  await assert.rejects(pending,e=>e.kind==='rpc-unavailable');assert.equal(local.clients.length,0);await f.transport.close();
});

test('authenticated local capacity: cancellation closes a pending native stage and publishes no completed session',async()=>{
  const f=fixture([{cap:true}]),local=authenticatedLocalFixture(f,{pauseStage:1}),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
  const pending=transport.request(program());await local.stageEntered.promise;await transport.close();
  await assert.rejects(pending);assert.equal(local.clients.length,1);assert.equal(local.clients[0].closed,1);assert.equal(local.sessions.length,0);await f.transport.close();
});

test('authenticated local capacity: one atomic wallet outer call remains one indivisible stage per complete check',async()=>{
  const f=fixture([{cap:true}]),local=authenticatedLocalFixture(f),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
  const input=program();input.params[0].blockStateCalls.splice(1);
  try {await transport.request(input);assert.equal(local.programs.length,1);assert.deepEqual(local.programs[0],input.params[0]);assert.equal(local.clients[0].next,1);}
  finally {await transport.close();await f.transport.close();}
});

test('authenticated local capacity: native revert and wrong complete metadata fail existing validators without returning to a provider',async()=>{
  for(const [nativeFault,kind] of [[{revert:true},'execution-reverted'],[{metadata:tokenURI+' changed'},'metadata-mismatch']]) {
    const f=fixture([{cap:true}]),local=authenticatedLocalFixture(f,{nativeFault}),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111});
    try {await assert.rejects(simulateKeelPublicationBeforeFunding(fullPlan(),transport),e=>e.kind===kind);
      assert.ok(local.clients.length>0);assert.ok(local.clients.every(c=>c.closed===1));assert.equal(f.privateRequests().length,0);}
    finally {await transport.close();await f.transport.close();}
  }
});

test('authenticated local capacity: original bounded request deadline closes native execution and cannot yield a session proof',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture([{cap:true}]),local=authenticatedLocalFixture(f,{pauseStage:1}),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111,requestTimeoutMs:100});
  const pending=transport.request(program());await local.stageEntered.promise;
  const rejected=assert.rejects(pending,e=>e.kind==='rpc-unavailable');t.mock.timers.tick(100);await rejected;await transport.close();
  assert.equal(local.clients.length,1);assert.equal(local.clients[0].closed,1);assert.equal(local.sessions.length,0);await f.transport.close();
});

test('authenticated local capacity: verified whole-request cap rejects impossible exact intrinsic floor before any provider sequence',async()=>{
  const f=fixture([{}]),local=authenticatedLocalFixture(f),transport=createKeelPublicSimulationPool({...local.options,chainId:11155111,
    providerCapabilities:[{chainId:11155111,rpcUrl:urls[0],measuredAt:new Date().toISOString(),limits:{requestGasCap:50_000_000n}}]});
  const input=program();input.params[0].blockStateCalls=Array.from({length:45},(_,i)=>({calls:[{...call(i),gas:'0x2faf080',data:`0x${'00'.repeat(20_000)}`}]}));
  try{const result=await transport.request(input);assert.equal(result.length,45);assert.equal(f.requests.length,0,'No expensive public or project sequence can fit this authenticated lower bound');
    assert.equal(local.clients.length,1);assert.deepEqual(local.programs[0],input.params[0]);}
  finally{await transport.close();await f.transport.close();}
});

test('a publication over 256 calls reaches the pool as shared blocks, and the public probe uses the same layout',async()=>{
  const f=fixture([{}]);
  const preparationCalls=Array.from({length:300},(_,i)=>({...call(i),gas:'0x989680'}));
  try {
    const proof=await simulateKeelPublicationBeforeFunding({...fullPlan(),preparationCalls,assertions:[]},f.transport);
    // The layout changes as measured envelopes shrink. Synthetic execution
    // still returns the exact same ordered contract results on every replay.
    assert.equal(f.responses[0].length,15);
    assert.equal(f.responses[1].length,1);
    assert.deepEqual(f.responses[0].flatMap(b=>b.calls).map(c=>c.returnData),f.responses[1].flatMap(b=>b.calls).map(c=>c.returnData));
    assert.equal(proof.validatedTransactionCalls,300);
    const projects=f.privateRequests().map(r=>r.body.params[0].blockStateCalls);
    assert.ok(projects.length>=3 && projects.every(blocks=>blocks.length<=256 && blocks.some(b=>b.calls.length>1)));
    assert.deepEqual(projects[0].flatMap(b=>b.calls).map(c=>c.nonce),preparationCalls.map(c=>c.nonce));
    const probes=f.requests.filter(r=>r.body.method==='eth_simulateV1'&&r.body.params[0].blockStateCalls[0].calls[0].data==='0x'&&r.body.params[0].blockStateCalls.flatMap(b=>b.calls).length>1)
      .map(r=>r.body.params[0].blockStateCalls.map(b=>b.calls.length));
    assert.ok(projects.every(blocks=>probes.some(layout=>JSON.stringify(layout)===JSON.stringify(blocks.map(b=>b.calls.length)))));
  } finally {await f.transport.close();}
});
