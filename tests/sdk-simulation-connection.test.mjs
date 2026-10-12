import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {encodeAbiParameters,keccak256,createPublicClient,webSocket,http} from 'viem';
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
    await rejectedQualification({ negativeError }, negativeError.code === -32601 ? 'unsupported-simulation' : negativeError.code === -38013 ? 'configuration-invalid' : 'rpc-unavailable');
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

test('a disconnected retained socket automatically requalifies before sending the saved simulation', async()=>{
  const nodes=[socket(),socket()];let attempts=0;
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[attempts++]);
  await t.request({method:'eth_chainId',params:[]});nodes[0].socket.readyState=3;
  await t.request(program);
  assert.equal(attempts,2);assert.equal(hasProgram(nodes[0]),false);assert.equal(nodes[0].closed,1);
  assert.equal(hasProgram(nodes[1]),true);await t.close();
});

test('unknown provider errors expose only the failed public capability stage', async () => {
  const node = socket({ probeError: { code: 403, message: 'https://private-secret/' } });
  const t = createPinnedKeelSepoliaSimulationTransport(async () => node);
  await assert.rejects(t.request(program), error => {
    assert.equal(error.kind,'rpc-unavailable');assert.equal(error.diagnostic.stage,'read-capacity');
    assert.equal(error.diagnostic.rpcMethod,'eth_simulateV1');assert.equal(error.diagnostic.rpcCode,403);
    assert.equal(error.diagnostic.phase,'public-qualification');assert.equal(error.diagnostic.socketReadyState,1);
    assert.doesNotMatch(JSON.stringify(error),/private-secret|https:/);return true;
  });
  assert.equal(node.closed, 1); assert.equal(hasProgram(node), false);
});

test('post-qualification program clamping is bounded, never lowers gas, and remains blocked if every connection clamps', async () => {
  const nodes=[];const t=createPinnedKeelSepoliaSimulationTransport(async()=>{const node=socket({programCap:'0x2faf080',revert:true});nodes.push(node);return node;});
  await assert.rejects(t.request(program),e=>e.kind==='provider-limit'&&e.diagnostic.providerGasCap==='50000000'&&e.diagnostic.connectionAttempts===3);
  assert.equal(nodes.length,3);for(const n of nodes){assert.equal(n.closed,1);assert.deepEqual(simulationRequests(n).at(-1).params,[{...program.params[0],returnFullTransactions:true},'0x12']);}
  await t.close();
});

test('unknown project RPC failures retain socket diagnostics and require a new fully qualified saved check', async()=>{
 for(const failingMethod of ['eth_getBlockByNumber','eth_simulateV1']){
  const nodes=[socket(),socket()];const request=nodes[0].requestAsync.bind(nodes[0]);let count=0;
  let blockReads=0;
  nodes[0].requestAsync=async args=>(failingMethod==='eth_getBlockByNumber'&&args.body.method===failingMethod&&++blockReads===3)||(failingMethod==='eth_simulateV1'&&args.body.method===failingMethod&&args.body.params[0].blockStateCalls[0].calls[0].data==='0x1234')
    ? {error:{code:-32098,message:'PRIVATE https://secret.invalid/0x1234',cause:{code:'ECONNRESET'}}} : request(args);
  const t=createPinnedKeelSepoliaSimulationTransport(async()=>nodes[count++]);
  await assert.rejects(t.request(program),error=>{
    assert.equal(error.kind,'rpc-unavailable');assert.equal(error.diagnostic.rpcCode,-32098);assert.equal(error.diagnostic.transportCode,'ECONNRESET');
    assert.equal(error.diagnostic.rpcMethod,failingMethod);assert.equal(error.diagnostic.phase,'project-request');assert.equal(error.diagnostic.socketReadyState,1);
    assert.doesNotMatch(JSON.stringify(error),/PRIVATE|secret.invalid|0x1234/);return true;
  });
  assert.equal(count,1);assert.equal(nodes[0].closed,1);await t.request(program);assert.equal(count,2);assert.equal(hasProgram(nodes[1]),true);await t.close();
 }
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

test('an actual program revert stays a revert without connection replacement', async () => {
  const node = socket({ revert: true }); let count = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { count++; return node; });
  assert.equal((await t.request(program))[0].calls[0].status, '0x0');
  assert.equal(count, 1); assert.equal(simulationRequests(node).length, 4);
  await t.close();
});

test('raw intrinsic rejection does not retry, replace a qualified connection or become a nonce proof', async () => {
  const node = socket(); const request = node.requestAsync.bind(node); let connections = 0, projects = 0;
  node.requestAsync = async args => {
    if (args.body.method === 'eth_simulateV1' && args.body.params[0].blockStateCalls[0].calls[0].data === '0x1234') {
      projects++; return { error: { code: -38013, message: 'intrinsic gas too low PRIVATE' } };
    }
    return request(args);
  };
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return node; });
  await assert.rejects(transport.request(program), error => error.kind === 'configuration-invalid' && error.diagnostic.transactionValidation === 'intrinsic-gas');
  assert.equal(projects, 1); assert.equal(connections, 1); assert.equal(node.closed, 0);
  await transport.close();
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

 test('full preflight after capacity or closed-socket recovery still requires strict execution and complete exact metadata', async () => {
  const owner='0x'+'11'.repeat(20),target='0x'+'22'.repeat(20),reader='0x'+'33'.repeat(20),expected='data:application/json,{"name":"Exact recovered fixture"}';
  for(const recovery of ['capacity','closed-socket']) for(const failure of [undefined,'metadata','revert','nonce','maximum']) {
    const nodes=[];
    const t=createPinnedKeelSepoliaSimulationTransport(async()=>{
      const index=nodes.length,n=socket(index===0&&recovery==='capacity'?{programCap:incidentCap}:{});
      if(index===0&&recovery==='closed-socket')closeDuringProgram(n);
      const original=n.requestAsync.bind(n);nodes.push(n);
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


// The real event supplies only the error class/method/state, not a cause for
// closure. Close codes/reasons below are synthetic privacy and recovery cases.
const closedIncident = JSON.parse(readFileSync(new URL('./fixtures/retro-closed-simulation-socket-20261010.json', import.meta.url), 'utf8'));
function closeDuringProgram(node, { code = 1006, reason = '', mutate } = {}) {
  const original = node.requestAsync.bind(node), listeners = new Set();
  node.socket.addEventListener = (type, listener) => { assert.equal(type, 'close'); listeners.add(listener); };
  node.socket.removeEventListener = (_type, listener) => { listeners.delete(listener); };
  node.requestAsync = async args => {
    const response = await original(args);
    if (args.body.method === closedIncident.diagnostic.rpcMethod && args.body.params[0].blockStateCalls[0].calls[0].data !== '0x') {
      node.socket.readyState = closedIncident.diagnostic.socketReadyState;
      for (const listener of listeners) listener({ code, reason });
      mutate?.();
      throw Object.assign(new Error('PRIVATE request and provider URL must not escape'), { name: closedIncident.diagnostic.errorClass });
    }
    return response;
  };
  return node;
}

test('live closed-socket incident automatically requalifies and repeats the exact immutable simulation within one check', async () => {
  for (const validation of [false, true]) {
    const request = structuredClone(program); request.params[0].validation = validation;
    Object.assign(request.params[0].blockStateCalls[0].calls[0], { nonce: '0x6', maxFeePerGas: '0x1000000', maxPriorityFeePerGas: '0xf4240', value: '0x0' });
    const expected = structuredClone(request); expected.params[0].returnFullTransactions = true;
    const first = closeDuringProgram(socket(), { mutate: () => { request.params[0].blockStateCalls[0].calls[0].data = '0xffff'; request.params[1] = 'latest'; request.method = 'eth_sendTransaction'; } }), second = socket();
    let connections = 0;
    const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return first.closed ? second : first; });
    try {
      assert.equal((await transport.request(request))[0].calls[0].status, '0x1');
      assert.equal(connections, 2); assert.equal(first.closed, 1);
      for (const node of [first, second]) assert.deepEqual(simulationRequests(node).at(-1), expected);
      assert.equal(simulationRequests(second).length, 4, 'both public modes and strict-nonce rejection precede the replay');
      assert.deepEqual(second.requests.at(-2), { method: 'eth_getBlockByNumber', params: ['0x12', false] });
    } finally { await transport.close(); }
  }
});

test('confirmed 1009 without an approved alternate transport stops without repeating the same oversized request', async () => {
  const nodes = [];
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { const node = closeDuringProgram(socket(), { code: 1009, reason: 'message too big PRIVATE https://secret.invalid/artwork' }); nodes.push(node); return node; });
  await assert.rejects(transport.request(program), error => {
    assert.equal(error.kind, 'provider-limit'); assert.equal(error.diagnostic.connectionAttempts, 1);
    assert.equal(error.diagnostic.socketCloseCode, 1009); assert.equal(error.diagnostic.socketCloseReason, 'message-too-large');
    assert.equal(error.diagnostic.rpcMethod, 'eth_simulateV1'); assert.equal(error.diagnostic.socketReadyState, 3);
    assert.equal(error.diagnostic.providerGasCap, undefined); assert.equal(error.diagnostic.rpcCode, undefined);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|https:|secret.invalid|artwork|0x1234/); return true;
  });
  assert.equal(nodes.length, 1); assert.ok(nodes.every(node => node.closed === 1));
  await transport.close();
});

test('closed-socket retry rejects changed snapshots and symbolic tags before any unsafe replay', async () => {
  for (const symbolic of [false, true]) {
    const first = closeDuringProgram(socket()), second = socket(); let connections = 0, reads = 0;
    const original = second.requestAsync.bind(second);
    second.requestAsync = async args => { const response = await original(args); if (args.body.method === 'eth_getBlockByNumber' && ++reads === 3) return { result: { ...response.result, hash: hash(777) } }; return response; };
    const transport = createPinnedKeelSepoliaSimulationTransport(async () => [first, second][connections++]);
    await assert.rejects(transport.request(symbolic ? { ...program, params: [program.params[0], 'latest'] } : program), error => error.kind === (symbolic ? 'rpc-unavailable' : 'chain-reorganized'));
    assert.equal(connections, symbolic ? 1 : 2); assert.equal(hasProgram(second), false); await transport.close();
  }
});


test('closed-socket recovery never admits writes/signing or turns an uncertain timeout into a replay', async () => {
  let connections = 0;
  const node = socket(), original = node.requestAsync.bind(node);
  node.requestAsync = async args => {
    if (args.body.method === 'eth_simulateV1' && args.body.params[0].blockStateCalls[0].calls[0].data !== '0x') throw { name: 'TimeoutError' };
    return original(args);
  };
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connections++; return node; });
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls', 'eth_sign', 'personal_sign'])
    await assert.rejects(transport.request({ method, params: [] }), error => error.kind === 'configuration-invalid');
  assert.equal(connections, 0);
  await assert.rejects(transport.request(program), error => error.kind === 'rpc-unavailable' && error.diagnostic.transportFailure === 'timeout');
  assert.equal(connections, 1); await transport.close();
  // An ordinary read is snapshotted too: mutation while connecting must never
  // turn its allowlisted method into a write after the admission check.
  const read = { method: 'eth_chainId', params: [] }; let connected;
  const fresh = socket(), immutable = createPinnedKeelSepoliaSimulationTransport(() => new Promise(resolve => { connected = resolve; }));
  const pending = immutable.request(read); read.method = 'eth_sendTransaction'; connected(fresh);
  assert.equal(await pending, '0xaa36a7'); assert.ok(fresh.requests.every(r => r.method !== 'eth_sendTransaction')); await immutable.close();
});

test('actual viem socket close events recover within one request and preserve only classified close evidence on exhaustion', { timeout: 10000 }, async () => {
  // Exercise the installed viem/isows implementation against loopback only.
  const viemRequire = createRequire(import.meta.resolve('viem'));
  const { WebSocketServer } = createRequire(viemRequire.resolve('isows'))('ws');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let connections = 0, closeEveryProject = false;
  const nodes = [];
  server.on('connection', peer => {
    const index = connections++, node = socket(); nodes.push(node);
    peer.on('message', async raw => {
      const body = JSON.parse(String(raw));
      const response = await node.requestAsync({ body });
      if (body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x' && (index === 0 || closeEveryProject)) {
        peer.close(closeEveryProject ? 1009 : 1013, closeEveryProject ? 'message too big PRIVATE secret' : 'try again later'); return;
      }
      peer.send(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...response }));
    });
  });
  const url = `ws://127.0.0.1:${server.address().port}`;
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => createPublicClient({ transport: webSocket(url, { retryCount: 0, reconnect: false, keepAlive: false }) }).transport.getRpcClient());
  try {
    assert.equal((await transport.request(program))[0].calls[0].status, '0x1'); assert.equal(connections, 2);
    assert.deepEqual(simulationRequests(nodes[0]).at(-1).params, simulationRequests(nodes[1]).at(-1).params);
    closeEveryProject = true;
    await assert.rejects(transport.request(program), error => {
      assert.equal(error.kind, 'provider-limit'); assert.equal(error.diagnostic.connectionAttempts, 1);
      assert.equal(error.diagnostic.socketCloseCode, 1009); assert.equal(error.diagnostic.socketCloseReason, 'message-too-large');
      assert.equal(error.diagnostic.socketReadyState, 3); assert.equal(error.diagnostic.errorClass, 'SocketClosedError');
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE|secret|127\.0\.0\.1|0x1234/); return true;
    });
    assert.equal(connections, 2, 'the retained oversized socket is not reopened');
  } finally { await transport.close(); for (const peer of server.clients) peer.terminate(); await new Promise(resolve => server.close(resolve)); }
});


test('concurrent closed-socket simulations share one replacement after the cached socket drains', { timeout: 5000 }, async () => {
  const first = closeDuringProgram(socket()), next = socket(), original = first.requestAsync.bind(first);
  let connects = 0, release, started;
  const entered = new Promise(resolve => { started = resolve; });
  first.requestAsync = async args => {
    if (args.body.method === 'eth_getCode' && args.body.params[0] === 'fixture-concurrent-reader') { started(); await new Promise(resolve => { release = resolve; }); }
    return original(args);
  };
  const transport = createPinnedKeelSepoliaSimulationTransport(async () => { connects++; return first.closed ? next : first; });
  await transport.request({ method: 'eth_chainId', params: [] });
  const reader = transport.request({ method: 'eth_getCode', params: ['fixture-concurrent-reader', '0x12'] }); await entered;
  const recovering = Promise.all([transport.request(program), transport.request(program)]); recovering.catch(() => {});
  try { await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(connects, 1); assert.equal(first.closed, 0); }
  finally { release(); }
  await reader; assert.ok((await recovering).every(result => result[0].calls[0].status === '0x1'));
  assert.equal(connects, 2); assert.equal(first.closed, 1); await transport.close();
});

test('closed-socket replacement must qualify its chain and execution evidence before receiving project calls', async () => {
  for (const change of [{ chain: '0x1' }, { ignoreNonce: true }, { mutate: result => { delete result[0].calls[0].maxUsedGas; } }]) {
    const first = closeDuringProgram(socket()), second = socket(change); let connections = 0;
    const transport = createPinnedKeelSepoliaSimulationTransport(async () => [first, second][connections++]);
    await assert.rejects(transport.request(program), error => ['wrong-chain', 'unsupported-simulation'].includes(error.kind));
    assert.equal(connections, 2); assert.equal(hasProgram(second), false); await transport.close();
  }
});

const sizeIncident = JSON.parse(readFileSync(new URL('./fixtures/retro-message-size-20261010.json', import.meta.url), 'utf8'));
function httpConnection(node) {
  return { protocol: 'https', requestAsync: args => node.requestAsync(args), close: () => node.close() };
}

test('production 1009 routes the whole immutable numbered request to qualified HTTP on the same approved recipient', async () => {
  for (const validation of [false, true]) {
    const request = structuredClone(program); request.params[0].validation = validation;
    Object.assign(request.params[0].blockStateCalls[0].calls[0], { data: '0x' + 'ab'.repeat(600_000), nonce: '0x6', value: '0x12', gasPrice: '0x30' });
    const exact = structuredClone(request); exact.params[0].returnFullTransactions = true;
    const first = closeDuringProgram(socket(), { code: sizeIncident.diagnostic.socketCloseCode, reason: '', mutate: () => { request.params[1] = 'latest'; request.params[0].blockStateCalls[0].calls[0].data = '0x'; } });
    const next = socket(), attempts = []; let ws = 0, https = 0;
    const t = createPinnedKeelSepoliaSimulationTransport(async () => { ws++; return first; }, {
      messageSizeFallback: async () => { https++; return httpConnection(next); }, onAttempt: d => attempts.push(d),
    });
    try {
      await t.request(request);
      assert.equal(ws, 1); assert.equal(https, 1); assert.equal(first.closed, 1);
      assert.deepEqual(simulationRequests(first).at(-1), exact); assert.deepEqual(simulationRequests(next).at(-1), exact);
      assert.deepEqual(simulationRequests(next).slice(0, 2).map(r => r.params[0].blockStateCalls[0].calls[0].gas), [gas, gas]);
      assert.equal(attempts[0].socketCloseCode, 1009); assert.equal(attempts[0].requestPayloadBytes, Buffer.byteLength(JSON.stringify(exact)));
      assert.equal(attempts[0].blockCount, 1); assert.equal(attempts[0].callCount, 1); assert.equal(attempts[0].transport, 'websocket');
      assert.equal(attempts[0].requiredProgramGas, '200000000'); assert.equal(attempts[0].connectionAttempts, 1);
      await t.request(exact); assert.equal(ws, 1); assert.equal(https, 1, 'later phases retain HTTP and never repeat the rejected WebSocket exchange');
    } finally { await t.close(); }
  }
});

test('message-size recovery blocks HTTP capacity, qualification, 413, timeout, missing envelope and changed snapshot without lowering or splitting', async () => {
  for (const fault of ['capacity', 'chain', 'nonce', '413', 'timeout', 'envelope', 'snapshot']) {
    const first = closeDuringProgram(socket(), { code: 1009 }); const nodes = [], attempts = [];
    const t = createPinnedKeelSepoliaSimulationTransport(async () => first, {
      onAttempt: d => attempts.push(d),
      messageSizeFallback: async () => {
        const n = socket(fault === 'capacity' ? { cap: incidentCap } : fault === 'chain' ? { chain: '0x1' } : fault === 'nonce' ? { ignoreNonce: true } : {});
        nodes.push(n); const original = n.requestAsync.bind(n); let reads = 0;
        n.requestAsync = async args => {
          const response = await original(args);
          if (args.body.method === 'eth_getBlockByNumber' && ++reads === 3 && fault === 'snapshot') response.result.hash = hash(777);
          if (args.body.method === 'eth_simulateV1' && args.body.params[0].blockStateCalls[0].calls[0].data !== '0x') {
            if (fault === '413') throw { name: 'HttpRequestError', status: 413, message: 'PRIVATE body' };
            if (fault === 'timeout') throw { name: 'TimeoutError' };
            if (fault === 'envelope') delete response.result[0].transactions;
          }
          return response;
        }; return httpConnection(n);
      },
    });
    try {
      await assert.rejects(t.request(program), e => {
        assert.equal(e.kind, ({ capacity: 'provider-limit', chain: 'wrong-chain', nonce: 'unsupported-simulation', '413': 'provider-limit', timeout: 'rpc-unavailable', envelope: 'unsupported-simulation', snapshot: 'chain-reorganized' })[fault]);
        assert.equal(e.diagnostic.transport, 'https'); assert.equal(e.diagnostic.socketReadyState, undefined);
        assert.doesNotMatch(JSON.stringify(e), /PRIVATE|0x1234/); return true;
      });
      assert.equal(nodes.length, fault === 'capacity' ? 2 : 1);
      if (['capacity', 'chain', 'nonce', 'snapshot'].includes(fault)) assert.ok(nodes.every(n => !hasProgram(n)));
      if (fault === 'capacity') {
        assert.deepEqual(attempts.map(a => [a.connectionAttempts, a.transport]), [[1, 'websocket'], [2, 'https'], [3, 'https']]);
        assert.equal(attempts[2].stage, 'read-capacity'); assert.equal(attempts[2].providerGasCap, '50000000'); assert.equal(attempts[2].requestedGasLimit, '200000000');
      }
    } finally { await t.close(); }
  }
});

test('1009 recovery will not switch transports for symbolic state or after explicit close', async () => {
  let fallback = 0;
  const t = createPinnedKeelSepoliaSimulationTransport(async () => closeDuringProgram(socket(), { code: 1009 }), { messageSizeFallback: async () => { fallback++; return httpConnection(socket()); } });
  await assert.rejects(t.request({ ...program, params: [program.params[0], 'latest'] }), e => e.kind === 'provider-limit');
  await t.close(); await assert.rejects(t.request(program), e => e.kind === 'rpc-unavailable'); assert.equal(fallback, 0);
});

test('installed viem carries a large unchanged request from real WS 1009 to real HTTP with raw strict-nonce evidence', { timeout: 10000 }, async () => {
  const viemRequire = createRequire(import.meta.resolve('viem'));
  const { WebSocketServer } = createRequire(viemRequire.resolve('isows'))('ws');
  const ws = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(ws, 'listening');
  const wsNode = socket(), httpNode = socket(), wire = []; let wsCount = 0;
  ws.on('connection', peer => { wsCount++; peer.on('message', async raw => {
    const body = JSON.parse(String(raw)); const response = await wsNode.requestAsync({ body });
    if (body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x') { wire.push({ transport: 'websocket', body, bytes: Buffer.byteLength(raw) }); peer.close(1009, ''); return; }
    peer.send(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...response }));
  }); });
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part); const raw = Buffer.concat(parts), body = JSON.parse(raw);
    if (body.method === 'eth_simulateV1' && body.params[0].blockStateCalls[0].calls[0].data !== '0x') wire.push({ transport: 'https', body, bytes: raw.length });
    const response = await httpNode.requestAsync({ body }); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...response }));
  }).listen(0, '127.0.0.1'); await once(server, 'listening');
  const t = createPinnedKeelSepoliaSimulationTransport(async () => createPublicClient({ transport: webSocket(`ws://127.0.0.1:${ws.address().port}`, { retryCount: 0, reconnect: false, keepAlive: false }) }).transport.getRpcClient(), {
    messageSizeFallback: async () => {
      const client = createPublicClient({ transport: http(`http://127.0.0.1:${server.address().port}`, { raw: true, batch: false, retryCount: 0 }) });
      return { protocol: 'https', close() {}, requestAsync: ({ body }) => client.request(body) };
    },
  });
  try {
    const request = structuredClone(program); request.params[0].blockStateCalls[0].calls[0].data = '0x' + 'cd'.repeat(600_000);
    const result = await t.request(request); assert.equal(result[0].transactions[0].gas, gas);
    assert.equal(wsCount, 1); assert.equal(wire.length, 2); assert.deepEqual(wire[0].body.params, wire[1].body.params);
    assert.ok(wire.every(w => w.bytes > 1_200_000));
    assert.equal(simulationRequests(httpNode).length, 4, 'read/strict capacity and negative nonce run before the full project');
  } finally { await t.close(); for (const peer of ws.clients) peer.terminate(); await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => server.close(resolve)); }
});

test('concurrent 1009 failures share the qualified HTTP replacement after the cached socket drains', { timeout: 5000 }, async () => {
  const first = closeDuringProgram(socket(), { code: 1009 }), next = socket(), original = first.requestAsync.bind(first);
  let ws = 0, https = 0, release, started;
  const entered = new Promise(resolve => { started = resolve; });
  first.requestAsync = async args => {
    if (args.body.method === 'eth_getCode' && args.body.params[0] === 'fixture-concurrent-reader') { started(); await new Promise(resolve => { release = resolve; }); }
    return original(args);
  };
  const t = createPinnedKeelSepoliaSimulationTransport(async () => { ws++; return first; }, { messageSizeFallback: async () => { https++; return httpConnection(next); }, onAttempt() { throw Error('observer cannot influence proof'); } });
  await t.request({ method: 'eth_chainId', params: [] });
  const read = t.request({ method: 'eth_getCode', params: ['fixture-concurrent-reader', '0x12'] }); await entered;
  const simulations = Promise.all([t.request(program), t.request(program)]); simulations.catch(() => {});
  try { await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(https, 0); assert.equal(first.closed, 0); }
  finally { release(); }
  await read; await simulations; assert.equal(ws, 1); assert.equal(https, 1);
  const count = next.requests.length;
  for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls', 'eth_sign']) await assert.rejects(t.request({ method, params: [] }), e => e.kind === 'configuration-invalid');
  assert.equal(next.requests.length, count); await t.close();
});

test('explicit close during HTTP replay cannot release a late proof or reconnect', async () => {
  const first = closeDuringProgram(socket(), { code: 1009 }), next = socket(), original = next.requestAsync.bind(next);
  let release, started, httpCount = 0;
  const entered = new Promise(resolve => { started = resolve; });
  next.requestAsync = async args => { if (args.body.method === 'eth_simulateV1' && args.body.params[0].blockStateCalls[0].calls[0].data !== '0x') { started(); await new Promise(resolve => { release = resolve; }); } return original(args); };
  const t = createPinnedKeelSepoliaSimulationTransport(async () => first, { messageSizeFallback: async () => { httpCount++; return httpConnection(next); } });
  const pending = t.request(program); await entered; await t.close(); release();
  await assert.rejects(pending, e => e.kind === 'rpc-unavailable'); assert.equal(httpCount, 1); assert.equal(next.closed, 1);
});
