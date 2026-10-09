import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {encodeAbiParameters,keccak256} from 'viem';
import {encodeKeelAtomicWalletBatch} from '../packages/sdk/dist/release-wallet-batch.js';
import {simulateKeelPublicationBeforeFunding} from '../packages/sdk/dist/publication-preflight.js';
const { createPinnedKeelSepoliaSimulationTransport, assertKeelSimulationEnvelopes } = await import(process.env.KEEL_TEST_SIMULATION_CONNECTION_MODULE ? pathToFileURL(process.env.KEEL_TEST_SIMULATION_CONNECTION_MODULE).href : '../packages/sdk/dist/simulation-connection.js');
const incident = JSON.parse(readFileSync(new URL('./fixtures/gatorrr-simulator-cap-20261009.json',import.meta.url),'utf8'));
const incidentCap = '0x'+BigInt(incident.providerGasCap).toString(16);

const gas = '0x'+BigInt(incident.requestedGasLimit).toString(16);
const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const program = { method: 'eth_simulateV1', params: [{ blockStateCalls: [{ calls: [{ gas, data: '0x1234' }] }], validation: true }, '0x12'] };
const snapshot = { number: '0x12', hash: hash(99), timestamp: '0x6ac79200', gasLimit: gas, baseFeePerGas: '0xf', slotNumber: '0xa' };

function socket(change = {}) {
  const requests = [];
  let closed = 0, blockReads = 0, probes = 0;
  return {
    requests, get closed() { return closed; }, socket: { readyState: 1 },
    close() { closed++; this.socket.readyState = 3; },
    async requestAsync({ body }) {
      requests.push(body);
      if (body.method === 'web3_clientVersion') return { result: change.version ?? 'reth/v2.7.0-3d592ec/test' };
      if (body.method === 'eth_chainId') return { result: change.chain ?? '0xaa36a7' };
      if (body.method === 'eth_getBlockByNumber') {
        const block = { ...snapshot, ...change.snapshot };
        return { result: ++blockReads > 1 && change.reorganized ? { ...block, hash: hash(100) } : block };
      }
      if (body.method === 'eth_getTransactionCount') return { result: change.nonce ?? '0x0' };
      if (body.method === 'eth_getBalance') return { result: change.balance ?? `0x${'f'.repeat(64)}` };
      if (body.method === 'eth_getCode') return { result: change.code ?? '0x' };
      if (body.method === 'eth_simulateV1') {
        const payload = body.params[0];
        const isProgram = payload.blockStateCalls[0].calls[0].data !== '0x';
        const negative = !isProgram && payload.blockStateCalls.length === 1 && BigInt(payload.blockStateCalls[0].calls[0].nonce) === BigInt(change.nonce ?? '0x0') + 1n;
        if (negative && !change.ignoreNonce) return { error: change.negativeError ?? { code: -38011, message: 'nonce too high' } };
        if (!isProgram && change.probeError) return { error: change.probeError };
        if (!isProgram) probes++;
        const result = payload.blockStateCalls.map((b, index) => ({
          number: `0x${(BigInt(snapshot.number) + BigInt(index + 1)).toString(16)}`,
          timestamp: `0x${(BigInt(snapshot.timestamp) + BigInt(12 * (index + 1))).toString(16)}`,
          hash: hash(index + 1), parentHash: index ? hash(index) : snapshot.hash,
          blockAccessListHash: hash(index + 10), slotNumber: `0x${(11 + index).toString(16)}`,
          transactions: b.calls.map(c => { const cap=isProgram?change.programCap??change.cap:change.cap;return { ...c, gas: cap&&BigInt(cap)<BigInt(c.gas)?cap:c.gas }; }),
          calls: b.calls.map(() => ({ status: isProgram && change.revert ? '0x0' : '0x1', gasUsed: '0x2ee0', maxUsedGas: '0x2ee0', returnData: '0x' })),
        }));
        if (!isProgram && change.mutate && (!change.pass || probes === change.pass)) change.mutate(result, body);
        return { result };
      }
      throw new Error('Unexpected method');
    },
  };
}
const simulationRequests = node => node.requests.filter(r => r.method === 'eth_simulateV1');
const hasProgram = node => simulationRequests(node).some(r => r.params[0].blockStateCalls[0].calls[0].data === '0x1234');

async function rejectedQualification(change, kind = 'unsupported-simulation') {
  const node = socket(change); let connections = 0;
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return connections === 1 ? node : socket(change); });
  await assert.rejects(transport.request(program), error => error.kind === kind);
  // Unsupported evidence stays blocked. Transport unavailability permits a
  // fresh qualification on the next check, never a project attempt without it.
  const requests = node.requests.length;
  await assert.rejects(transport.request(program), error => error.kind === kind);
  assert.equal(connections, kind === 'rpc-unavailable' ? 2 : 1); assert.equal(node.requests.length, requests);
  assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
  await transport.close();
  return node;
}

test('qualifies capabilities on one retained socket without admitting or rejecting by client brand', async () => {
  for (const version of ['reth/v2.7.0-3d592ec/test', 'Geth/v1.17.7-stable/test', 'unknown-client']) {
    const node = socket({ version }); let connections = 0;
    const t = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return node; });
    assert.equal(t.qualifiedProbeGas, undefined);
    await t.request(program);
    assert.equal(t.qualifiedProbeGas, 200_000_000n);
    assert.equal(connections, 1);
    assert.ok(node.requests.every(r => r.method !== 'web3_clientVersion'));
    assert.deepEqual(simulationRequests(node).map(r => r.params[0].validation), [false, true, true, true]);
    assert.deepEqual(simulationRequests(node).at(-1).params, [{ ...program.params[0], returnFullTransactions: true }, '0x12']);
    await t.close(); assert.equal(node.closed, 1);
  }
});

test('qualification contains only public empty calls without any state or block overrides', async () => {
  const node = socket(); const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await t.request(program);
  for (const r of simulationRequests(node).slice(0, 3)) {
    assert.equal(r.params[1], snapshot.number);
    assert.equal(r.params[0].returnFullTransactions, true);
    assert.equal(r.params[0].traceTransfers, false);
    for (const b of r.params[0].blockStateCalls) {
      assert.deepEqual(Object.keys(b), ['calls']);
      for (const c of b.calls) {
      assert.equal(c.data, '0x'); assert.equal(c.value, '0x0');
      assert.equal(c.from, '0x0000000000000000000000000000000000000000');
      assert.equal(c.to, c.from);
      }
    }
  }
  assert.equal(simulationRequests(node).at(-1).params[0].blockStateCalls[0].stateOverrides, undefined);
  assert.equal(program.params[0].returnFullTransactions, undefined);
  assert.equal(node.requests.at(-2).method, 'eth_getBlockByNumber');
  assert.deepEqual(node.requests.at(-2).params, [snapshot.number, false]);
  await t.close();
});

test('public capacity qualification retries at most three connections, without project data, and a fresh read can retry', async () => {
  const nodes=[];const t=createPinnedKeelSepoliaSimulationTransport(async()=>{const node=socket({cap:'0x2faf080'});nodes.push(node);return node;});
  for(let read=1;read<=2;read++){
    await assert.rejects(t.request(program),e=>e.kind==='provider-limit'&&e.diagnostic.providerGasCap==='50000000'&&e.diagnostic.connectionAttempts===3);
    assert.equal(nodes.length,read*3);assert.ok(nodes.every(n=>n.closed===1&&!hasProgram(n)));
  }
  await t.close();
});

test('a client name and success status cannot replace exact full gas, nonce and fee envelopes', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].transactions; },
    r => { r[0].transactions = [hash(1)]; },
    r => { r[0].transactions[0].gas = '0xbebc201'; },
    r => { r[1].transactions[0].gas = '0x05208'; },
    r => { delete r[0].transactions[0].nonce; },
    r => { r[1].transactions[0].nonce = '0x2'; },
    r => { delete r[0].transactions[0].gasPrice; },
    r => { r[1].transactions[0].gasPrice = '0x0'; },
  ]) await rejectedQualification({ version: 'Geth/v1.17.7', pass, mutate });
});

test('both qualification modes require linked current-fork headers for every block', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].blockAccessListHash; },
    r => { r[0].parentHash = hash(5); },
    r => { r[1].parentHash = snapshot.hash; },
    r => { r[1].number = r[0].number; },
    r => { r[1].timestamp = r[0].timestamp; },
    r => { r[1].slotNumber = r[0].slotNumber; },
    r => { r[0].hash = '0x'; },
  ]) await rejectedQualification({ pass, mutate });
});

test('both qualification modes require valid pre-refund gas and success evidence', async () => {
  for (const pass of [1, 2]) for (const mutate of [
    r => { delete r[0].calls[0].maxUsedGas; },
    r => { r[1].calls[0].maxUsedGas = '0x1'; },
    r => { r[0].calls[0].maxUsedGas = '0xbebc201'; },
    r => { r[0].calls[0].gasUsed = '0x0'; },
    r => { r[1].calls[0].status = '0x0'; },
    r => { r[0].calls[0].error = { code: 3 }; },
    r => { r[0].calls[0].returnData = '0x01'; },
    r => { r[1].calls = []; },
  ]) await rejectedQualification({ pass, mutate });
});

test('validation:true success must be corroborated by nonce-too-high rejection', async () => {
  await rejectedQualification({ ignoreNonce: true });
  for (const negativeError of [{ code: -32601 }, { code: -38013 }, { code: 403, message: 'private-url' }])
    await rejectedQualification({ negativeError }, negativeError.code === -32601 ? 'unsupported-simulation' : 'rpc-unavailable');
});

test('wrong chain, invalid snapshot, reorg and missing method fail closed with no reconnect', async () => {
  await rejectedQualification({ chain: '0x1' }, 'wrong-chain');
  for (const snapshot of [{ hash: '0x' }, { timestamp: undefined }, { gasLimit: '0x0' }, { baseFeePerGas: undefined }])
    await rejectedQualification({ snapshot });
  await rejectedQualification({ reorganized: true }, 'chain-reorganized');
  await rejectedQualification({ probeError: { code: -32601, message: 'private-url' } });
});

test('a fresh saved-plan check requalifies after an initial connection outage instead of caching its rejected promise', async()=>{
  let attempts=0;const node=socket();
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>{if(++attempts===1)throw Error('synthetic temporary connection failure');return node;});
  await assert.rejects(t.request(program),e=>e.kind==='rpc-unavailable'&&e.diagnostic.stage==='connection');
  assert.equal(attempts,1);assert.equal(node.requests.length,0);
  await t.request(program);assert.equal(attempts,2);assert.equal(hasProgram(node),true);await t.close();
});

test('unavailable public qualification never sends project data and a later check must fully qualify a new socket', async()=>{
  const nodes=[socket({probeError:{code:-32000,message:'synthetic unavailable'}}),socket()];let attempts=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[attempts++]);
  await assert.rejects(t.request(program),e=>e.kind==='rpc-unavailable');
  assert.equal(attempts,1);assert.equal(nodes[0].closed,1);assert.equal(hasProgram(nodes[0]),false);
  await t.request(program);assert.equal(attempts,2);assert.equal(simulationRequests(nodes[1]).length,4);await t.close();
});

test('a disconnected retained socket fails the current check and permits a fully qualified fresh check', async()=>{
  const nodes=[socket(),socket()];let attempts=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[attempts++]);
  await t.request({method:'eth_chainId',params:[]});nodes[0].socket.readyState=3;
  await assert.rejects(t.request(program),e=>e.kind==='rpc-unavailable');
  assert.equal(attempts,1);assert.equal(hasProgram(nodes[0]),false);assert.equal(nodes[0].closed,1);
  await t.request(program);assert.equal(attempts,2);assert.equal(hasProgram(nodes[1]),true);await t.close();
});

test('unknown provider errors expose only the failed public capability stage', async () => {
  const node = socket({ probeError: { code: 403, message: 'https://private-secret/' } });
  const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await assert.rejects(t.request(program), error => error.kind === 'rpc-unavailable' && error.diagnostic.stage === 'read-capacity' && !error.message.includes('private-secret'));
  assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
});

test('post-qualification program clamping is bounded, never lowers gas, and remains blocked if every connection clamps', async () => {
  const nodes=[];const t=createPinnedKeelSepoliaSimulationTransport(async()=>{const node=socket({programCap:'0x2faf080',revert:true});nodes.push(node);return node;});
  await assert.rejects(t.request(program),e=>e.kind==='provider-limit'&&e.diagnostic.providerGasCap==='50000000'&&e.diagnostic.connectionAttempts===3);
  assert.equal(nodes.length,3);for(const n of nodes){assert.equal(n.closed,1);assert.deepEqual(simulationRequests(n).at(-1).params,[{...program.params[0],returnFullTransactions:true},'0x12']);}
  await t.close();
});

test('the incident 50m provider cap selects a compatible connection before sending the unchanged 200m program', async () => {
  const nodes=[socket({cap:incidentCap}),socket()];let count=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[count++]);
  assert.equal((await t.request(program))[0].calls[0].status,'0x1');
  assert.equal(count,2);assert.equal(hasProgram(nodes[0]),false);assert.equal(nodes[0].closed,1);
  assert.deepEqual(simulationRequests(nodes[1]).at(-1).params,[{...program.params[0],returnFullTransactions:true},'0x12']);
  assert.equal(t.qualifiedProbeGas,200_000_000n);await t.close();assert.equal(nodes[1].closed,1);
});

test('a retained low-cap connection is replaced before replaying only the identical read-only simulation on the same snapshot', async () => {
  const nodes=[socket({programCap:'0x2faf080'}),socket()];let count=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[count++]);
  await t.request({method:'eth_chainId',params:[]});assert.equal(count,1);assert.equal(nodes[0].closed,0);
  assert.equal((await t.request(program))[0].calls[0].status,'0x1');assert.equal(count,2);
  const sent=nodes.map(n=>simulationRequests(n).at(-1));assert.deepEqual(sent[0],sent[1]);
  assert.ok(nodes.every(n=>!n.requests.some(r=>/send|sign/i.test(r.method))));
  await t.close();assert.ok(nodes.every(n=>n.closed===1));
});

test('capacity recovery rejects a changed project snapshot and never sends the program to it', async () => {
  const first=socket({programCap:'0x2faf080'}),other=socket();const original=other.requestAsync.bind(other);let reads=0;
  other.requestAsync=async args=>{const response=await original(args);if(args.body.method==='eth_getBlockByNumber'&&++reads===3)return{result:{...response.result,hash:hash(777)}};return response;};
  let count=0;const t=createPinnedKeelSepoliaSimulationTransport(async()=>[first,other][count++]);
  await assert.rejects(t.request(program),e=>e.kind==='chain-reorganized');assert.equal(hasProgram(other),false);assert.equal(count,2);await t.close();
});

test('a symbolic latest snapshot cannot be replayed after project gas clamping', async () => {
  const node=socket({programCap:'0x2faf080'});let count=0;const t=createPinnedKeelSepoliaSimulationTransport(async()=>{count++;return node;});
  await assert.rejects(t.request({...program,params:[program.params[0],'latest']}),e=>e.kind==='provider-limit');assert.equal(count,1);assert.equal(node.closed,1);await t.close();
});

test('concurrent clamped reads share replacement qualification and do not close a socket while another read is in flight', async () => {
  const nodes=[socket({programCap:'0x2faf080'}),socket()];let count=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[count++]);
  const results=await Promise.all([t.request(program),t.request(program)]);
  assert.ok(results.every(r=>r[0].calls[0].status==='0x1'));assert.equal(count,2);assert.equal(nodes[0].closed,1);
  await t.close();assert.equal(nodes[1].closed,1);
});

test('an actual program revert stays a revert and a disconnected socket fails the current check without replay', async () => {
  const node = socket({ revert: true }); let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return node; });
  assert.equal((await t.request(program))[0].calls[0].status, '0x0');
  node.socket.readyState = 3;
  await assert.rejects(t.request(program), e => e.kind === 'rpc-unavailable');
  assert.equal(count, 1); assert.equal(simulationRequests(node).length, 4);
  await t.close();
});

test('explicit close prevents new selection and close during selection does not leak a socket', async () => {
  let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return socket(); });
  await t.close();
  await assert.rejects(t.request(program), e => e.kind === 'rpc-unavailable');
  assert.equal(count, 0);
  let resolve; const node = socket();
  const pending = createPinnedKeelSepoliaSimulationTransport(() => new Promise(r => { resolve = r; }));
  const request = pending.request(program);
  const closing = pending.close(); resolve(node);
  await assert.rejects(request, e => e.kind === 'rpc-unavailable');
  await closing; assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
});

test('missing or enlarged envelopes are unavailable evidence', () => {
  assert.throws(() => assertKeelSimulationEnvelopes(program, [{ calls: [] }]), e => e.kind === 'unsupported-simulation');
  assert.throws(() => assertKeelSimulationEnvelopes(program, [{ transactions: [{ gas: '0xbebc201' }] }]), e => e.kind === 'unsupported-simulation');
});

test('public account state must qualify without funding or synthetic overrides', async () => {
  for (const change of [{ nonce: '0x00' }, { nonce: '0xffffffffffffffff' }, { balance: '0x0' }, { code: '0x6000' }])
    await rejectedQualification(change);
});

test('public qualification uses observed nonzero nonce and records the exact selected-chain transaction ceiling', async () => {
  const node = socket({ nonce: '0x7' }); const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await t.request(program);
  const probes = simulationRequests(node).slice(0, 3);
  assert.deepEqual(probes.map(r => r.params[0].blockStateCalls[0].calls[0].nonce), ['0x7', '0x7', '0x8']);
  assert.deepEqual(probes.slice(0, 2).map(r => r.params[0].blockStateCalls[0].calls[0].gas), [gas, gas]);
  assert.equal(t.qualifiedProbeGas, 200_000_000n);
  assert.equal(simulationRequests(node).at(-1).params[0].blockStateCalls[0].calls[0].gas, gas);
  await t.close(); assert.equal(t.qualifiedProbeGas, undefined);
});

 test('capacity qualification follows the observed block limit without increasing it', async () => {
  const bounded='0x5f5e100';const node=socket({snapshot:{gasLimit:bounded}});const t=createPinnedKeelSepoliaSimulationTransport(async()=>node);
  const request={...program,params:[{...program.params[0],blockStateCalls:[{calls:[{gas:bounded,data:'0x1234'}]}]},'0x12']};
  await t.request(request);assert.equal(t.qualifiedProbeGas,100_000_000n);
  for(const r of simulationRequests(node))for(const b of r.params[0].blockStateCalls)for(const c of b.calls)assert.ok(BigInt(c.gas)<=100_000_000n);
  await t.close();
});

 test('full preflight after retained-socket capacity recovery still requires strict execution and complete exact metadata', async () => {
  const owner='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),reader='0x'+'33'.repeat(20),expected='data:application/json,{"name":"Exact recovered fixture"}';
  for(const failure of [undefined,'metadata','revert','nonce','maximum']) {
    const nodes=[];
    const t=createPinnedKeelSepoliaSimulationTransport(async()=>{
      const index=nodes.length,n=socket(index===0?{programCap:incidentCap}:{}),original=n.requestAsync.bind(n);nodes.push(n);
      n.requestAsync=async args=>{
        const {body}=args;
        if(body.method==='eth_getCode'&&body.params[0]===reader)return{result:'0x6000'};
        const response=await original(args);
        if(body.method==='eth_simulateV1'&&body.params[0].blockStateCalls[0].calls[0].data!=='0x'){
          for(const [i,block] of response.result.entries()){
            const metadata=body.params[0].blockStateCalls[i].calls[0].to===reader;
            const used=metadata?'0x186a0':'0x'+BigInt(incident.successfulPreRefundGasUsed).toString(16);
            block.calls=[{status:index===1&&failure==='revert'?'0x0':'0x1',gasUsed:used,maxUsedGas:used,returnData:metadata?encodeAbiParameters([{type:'string'}],[index===1&&failure==='metadata'?'wrong':expected]):'0x'}];
            if(index===1&&failure==='nonce'&&!metadata)block.transactions[0].nonce='0x7';
            if(index===1&&failure==='maximum')delete block.calls[0].maxUsedGas;
          }
        }
        return response;
      };return n;
    });
    await t.request({method:'eth_chainId',params:[]});assert.equal(nodes.length,1);
    const prep={from:owner,to:owner,data:encodeKeelAtomicWalletBatch([{to:target,data:'0x1234',value:'0x0'}]),value:'0x0',nonce:'0x6',gas,maxFeePerGas:'0x1000000',maxPriorityFeePerGas:'0xf4240'};
    const job={transactionContext:'atomic-wallet',planFingerprint:'0x'+'aa'.repeat(32),chainId:11155111,blockNumber:18n,reader,readerRuntimeCodeHash:keccak256('0x6000'),preparationCalls:[prep],metadataCall:{from:owner,to:reader,data:'0x1234',value:'0x0',gas:'0xf4240'},expectedTokenURI:expected,maximumTokenUriBytes:2_000_000,maximumReadGas:1_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:200_000_000n};
    if(failure)await assert.rejects(simulateKeelPublicationBeforeFunding(job,t),e=>e.kind===({metadata:'metadata-mismatch',revert:'execution-reverted',nonce:'unsupported-simulation',maximum:'unsupported-simulation'})[failure]);
    else {const proof=await simulateKeelPublicationBeforeFunding(job,t);assert.equal(proof.completeTokenUriBytes,Buffer.byteLength(expected));assert.equal(proof.transactionGasLimits[0],incident.successfulTransactionGasLimit);assert.equal(proof.validatedTransactionCalls,1);assert.equal(proof.signing,'not-performed');assert.equal(proof.submission,'not-performed');}
    assert.equal(nodes.length,2);assert.ok(nodes.every(n=>n.requests.every(r=>['eth_chainId','eth_getBlockByNumber','eth_getTransactionCount','eth_getBalance','eth_getCode','eth_simulateV1'].includes(r.method))));
    await t.close();assert.ok(nodes.every(n=>n.closed===1));
  }
});
 test('closing during an in-flight simulation cannot release a late proof or reconnect', async () => {
  const n=socket(),original=n.requestAsync.bind(n);let release,started;
  const entered=new Promise(resolve=>{started=resolve});
  n.requestAsync=async args=>{if(args.body.method==='eth_simulateV1'&&args.body.params[0].blockStateCalls[0].calls[0].data!=='0x'){started();await new Promise(resolve=>{release=resolve});}return original(args)};
  let count=0;const t=createPinnedKeelSepoliaSimulationTransport(async()=>{count++;return n});const pending=t.request(program);await entered;await t.close();release();
  await assert.rejects(pending,e=>e.kind==='rpc-unavailable');assert.equal(count,1);assert.equal(n.closed,1);
});

 test('caller mutation cannot change calldata or gas between capacity-recovery attempts', async () => {
  const request=structuredClone(program),first=socket({programCap:incidentCap}),next=socket(),original=first.requestAsync.bind(first);let count=0;
  first.requestAsync=async args=>{const result=await original(args);if(args.body.method==='eth_simulateV1'&&args.body.params[0].blockStateCalls[0].calls[0].data==='0x1234'){request.params[0].blockStateCalls[0].calls[0].gas='0x1';request.params[0].blockStateCalls[0].calls[0].data='0xffff';request.params[1]='latest';}return result;};
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>[first,next][count++]);await t.request(request);
  for(const n of [first,next])assert.deepEqual(simulationRequests(n).at(-1).params,[{...program.params[0],returnFullTransactions:true},'0x12']);
  assert.equal(count,2);await t.close();
});

 test('small valid plans do not require full block capacity from a 50m provider', async () => {
  const n=socket({cap:incidentCap});let count=0;const t=createPinnedKeelSepoliaSimulationTransport(async()=>{count++;return n});
  const request=structuredClone(program);request.params[0].blockStateCalls[0].calls[0].gas='0x493e0';await t.request(request);
  assert.equal(count,1);assert.equal(t.qualifiedProbeGas,300_000n);assert.equal(simulationRequests(n).at(-1).params[0].blockStateCalls[0].calls[0].gas,'0x493e0');await t.close();
});

test('endpoint-cached socket factories cannot reselect the capped socket while another read is draining', {timeout:5000}, async () => {
  const first=socket({programCap:incidentCap}),next=socket(),original=first.requestAsync.bind(first);let connections=0,releaseRead,entered;
  const started=new Promise(resolve=>{entered=resolve});
  first.requestAsync=async args=>{if(args.body.method==='eth_getCode'&&args.body.params[0]==='fixture-concurrent-reader'){entered();await new Promise(resolve=>{releaseRead=resolve});}return original(args)};
  // viem's cache retains the socket until its close() deletes the cache entry.
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>{connections++;return first.closed?next:first;});
  await t.request({method:'eth_chainId',params:[]});
  const reader=t.request({method:'eth_getCode',params:['fixture-concurrent-reader','0x12']});await started;
  const recovering=t.request(program);recovering.catch(()=>{});
  try {await new Promise(resolve=>setTimeout(resolve,30));assert.equal(connections,1);assert.equal(first.closed,0);}
  finally {releaseRead();}
  await reader;assert.equal((await recovering)[0].calls[0].status,'0x1');assert.equal(connections,2);assert.equal(first.closed,1);await t.close();assert.equal(next.closed,1);
});
