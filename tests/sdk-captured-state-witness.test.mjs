import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toRlp } from 'viem';
import { sha256, stable, encodeCapturedHeader, normalizeAssemblyCapture, REQUIRED_CASES } from '../scripts/lib/captured-publication-fixture.mjs';
import { CAPTURED_STATE_RPC as RPC, CAPTURED_STATE_LIMITS as LIMITS, collectCapturedStateWitness as collect,
  validateCapturedStateSeed, validateAdditionalWitnessRequests, verifyCapturedAccountProof, normalizeWitnessSlot } from '../scripts/lib/captured-state-witness.mjs';
import { main } from '../scripts/lib/captured-state-witness-cli.mjs';

const globalFetch = globalThis.fetch; let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('Offline test forbids network'); };
after(() => { globalThis.fetch = globalFetch; assert.equal(networkAttempts, 0); });
const CLOCK = 1_791_765_000_000, ACCOUNT = '0xe7f47a76d2887d0a54f7c40dcf7ffcc69e6f22be';
const SLOT = normalizeWitnessSlot('0x2'), hash = byte => `0x${byte.repeat(32)}`;
const emptyTrie = keccak256('0x80'), emptyCode = keccak256('0x');
const leaf = (key, value) => toRlp([`0x20${key.slice(2)}`, value]);
const scalar = value => BigInt(value) === 0n ? '0x' : `0x${BigInt(value).toString(16).padStart(Math.ceil(BigInt(value).toString(16).length / 2) * 2, '0')}`;
function seal(header) {
  const h = header;
  return { ...h, hash: keccak256(toRlp([h.parentHash, h.sha3Uncles, h.miner, h.stateRoot, h.transactionsRoot,
    h.receiptsRoot, h.logsBloom, ...[h.difficulty,h.number,h.gasLimit,h.gasUsed,h.timestamp].map(scalar),
    h.extraData,h.mixHash,h.nonce,scalar(h.baseFeePerGas),h.withdrawalsRoot,scalar(h.blobGasUsed),scalar(h.excessBlobGas),
    h.parentBeaconBlockRoot,h.requestsHash,h.blockAccessListHash,scalar(h.slotNumber)])) };
}
function syntheticState({ value = '0x2a', time = CLOCK } = {}) {
  const code = '0x60006000f3', codeHash = keccak256(code);
  const storage = leaf(keccak256(SLOT), toRlp(scalar(value))), storageHash = value === '0x0' ? emptyTrie : keccak256(storage);
  const accountNode = leaf(keccak256(ACCOUNT), toRlp(['0x01','0x05',storageHash,codeHash]));
  const header = seal({ parentHash:hash('01'),sha3Uncles:keccak256(toRlp([])),miner:`0x${'11'.repeat(20)}`,
    stateRoot:keccak256(accountNode),transactionsRoot:emptyTrie,receiptsRoot:emptyTrie,logsBloom:`0x${'00'.repeat(256)}`,
    difficulty:'0x0',number:'0xb58363',gasLimit:'0xbebc200',gasUsed:'0x0',timestamp:`0x${Math.floor(time/1000).toString(16)}`,
    extraData:'0x',mixHash:hash('02'),nonce:'0x0000000000000000',baseFeePerGas:'0x1',withdrawalsRoot:hash('03'),
    blobGasUsed:'0x0',excessBlobGas:'0x0',parentBeaconBlockRoot:hash('04'),requestsHash:hash('05'),blockAccessListHash:hash('06'),slotNumber:'0x1' });
  const proof = { address:ACCOUNT,codeHash,storageHash,balance:'0x5',nonce:'0x1',accountProof:[accountNode],
    storageProof:[{key:'0x2',value,proof:value === '0x0' ? [] : [storage]}] };
  return { header, code, proof };
}
function inputFor(state = syntheticState()) {
  const h = state.header, call = { from:`0x${'11'.repeat(20)}`,to:ACCOUNT,data:'0x12345678deadbeef',value:'0x0',gas:'0x2625a00' };
  const input = {chainId:11155111,blockNumber:{$keelDiagnosticBigInt:BigInt(h.number).toString()},preparationCalls:Array.from({length:45},()=>({...call})),
    metadataCall:{...call},observationCalls:[{...call}],expectedTokenURI:'data:application/json,{"name":"private fixture sentinel"}',reader:ACCOUNT,readerRuntimeCodeHash:state.proof.codeHash};
  const raw = { schema:'keel-private-full-plan-diagnostic@1',status:'exact-input-captured-no-simulation',assemblyOnly:true,databaseReadOnlyVerified:true,
    approval:false,signing:'not-performed',submission:'not-performed',expectedCaptureHalt:true,
    source:{siteCommit:'1'.repeat(40),sdkCommit:'2'.repeat(40)},scope:{...REQUIRED_CASES['retro-45'],artifactRevision:2,blockNumber:h.number,blockHash:h.hash},
    canonicalBefore:h,canonicalAfterAssembly:structuredClone(h),exactSimulationInput:input,completeInputSHA256:sha256(JSON.stringify(input)),
    preparationCallCount:45,completeUnallocatedCallCount:47,completeExpectedTokenURI:input.expectedTokenURI,
    completeTokenURIBytes:Buffer.byteLength(input.expectedTokenURI),completeTokenURIKeccak256:keccak256(`0x${Buffer.from(input.expectedTokenURI).toString('hex')}`) };
  const normalized = normalizeAssemblyCapture(raw);
  const captureBytes = Buffer.from(JSON.stringify(raw));
  const seed = {schema:'keel-private-fresh-retro-seeds@1',captureObjectSHA256:sha256(stable(raw)),captureSHA256:sha256(captureBytes),
    completeInputSHA256:raw.completeInputSHA256,sourceFingerprint:sha256(stable({identity:normalized.identity,source:normalized.source,completeInputSHA256:raw.completeInputSHA256})),
    pin:{number:h.number,hash:h.hash,stateRoot:h.stateRoot,timestamp:h.timestamp},headerRlp:encodeCapturedHeader(h),
    accounts:[{address:ACCOUNT,slots:[SLOT],expectedCodeHash:state.proof.codeHash}],closure:{complete:false}};
  return {capture:raw,seed,captureBytes};
}
function harness(state, input, transform = () => undefined) {
  const calls = [];
  const expected = [['eth_chainId',[]],['eth_getBlockByNumber',[state.header.number,false]]];
  for (const account of input.seed.accounts) expected.push(['eth_getProof',[account.address.toLowerCase(),account.slots.map(value => {
    try { return normalizeWitnessSlot(value); } catch { return value; }
  }),state.header.number]],['eth_getCode',[account.address.toLowerCase(),state.header.number]]);
  expected.push(['eth_getBlockByNumber',[state.header.number,false]]);
  const fetchImpl = async (url, options) => {
    assert.equal(url,RPC);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.method,'POST');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!options.body.includes('deadbeef') && !options.body.includes('private fixture sentinel'));
    const request = JSON.parse(options.body), index = calls.length; calls.push(request);
    assert.deepEqual([request.method,request.params],expected[index], 'Exact bounded sequence; no latest, calldata or expanded recipient');
    let result;
    if(request.method==='eth_chainId')result='0xaa36a7';
    else if(request.method==='eth_getBlockByNumber')result=state.header;
    else if(request.method==='eth_getCode')result=request.params[0]===ACCOUNT?state.code:'0x';
    else result=request.params[0]===ACCOUNT?state.proof:{address:request.params[0],nonce:'0x0',balance:'0x0',codeHash:emptyCode,storageHash:emptyTrie,accountProof:state.proof.accountProof,storageProof:request.params[1].map(key=>({key,value:'0x0',proof:[]}))};
    const changed = await transform({request,index,result,options});
    if(changed instanceof Response)return changed;
    if(changed?.response)return changed.response;
    if(changed?.error)return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:changed.error}));
    if(changed && Object.hasOwn(changed,'result'))result=changed.result;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  };
  return {calls,fetchImpl};
}
async function run({state=syntheticState(),input=inputFor(state),transform,now=()=>CLOCK,checkpoint}={}) {
  const h=harness(state,input,transform); return {report:await collect(input,{fetchImpl:h.fetchImpl,now,checkpoint}),calls:h.calls};
}
const blocked=(report,reason,count)=>{assert.equal(report.status,'blocked');assert.equal(report.error.reason,reason);assert.equal(report.seedComplete,false);assert.equal(report.fullWitnessComplete,false);if(count!==undefined)assert.equal(report.requests.length,count);};

test('same-pin full-header seed proofs retain exact public request/response evidence, without acceptance or project calldata',async()=>{
  const {report:r,calls}=await run();assert.equal(r.seedComplete,true);assert.equal(r.canonicalSnapshotRechecked,true);assert.equal(calls.length,5);
  for(const key of ['fullWitnessComplete','transitiveStateComplete','acceptance','gateAccepted','projectAcceptance','projectCalldataSent'])assert.equal(r[key],false);
  assert.equal(r.simulations,0);assert.equal(r.witness.accounts[0].balance,'0x5');assert.equal(r.witness.accounts[0].storageProof[0].value,'0x2a');
  for(const entry of r.requests){const raw=Buffer.from(entry.rawResponseBase64,'base64');assert.equal(raw.length,entry.capturedResponseBytes);assert.equal(sha256(raw),entry.capturedResponseSHA256);assert.equal(JSON.parse(raw).id,entry.request.id);assert.equal(sha256(entry.rawRequest),entry.requestSHA256);assert.equal(entry.responseComplete,true);}
});
test('explicit proved absent slot remains distinguishable from missing proof or assumed zero',async()=>{
  const {report}=await run({state:syntheticState({value:'0x0'})});assert.equal(report.seedComplete,true);assert.equal(report.witness.accounts[0].storageProof[0].value,'0x0');
  for(const field of ['nonce','balance','accountProof','storageProof']){const state=syntheticState();delete state.proof[field];blocked((await run({state})).report,'invalid-proof',4);}
});
test('all capture/file/source/header bindings are checked before any network read',async()=>{
  for(const mutate of [i=>i.seed.sourceFingerprint='0'.repeat(64),i=>i.seed.captureSHA256='0'.repeat(64),i=>delete i.captureBytes,
    i=>i.seed.captureObjectSHA256='0'.repeat(64),i=>i.seed.completeInputSHA256='0'.repeat(64),i=>i.seed.pin.hash=hash('aa'),
    i=>i.seed.headerRlp='0xc0',i=>i.capture.exactSimulationInput.preparationCalls[0].data='0x11',i=>i.capture.canonicalAfterAssembly.gasUsed='0x1',
    i=>i.capture.completeUnallocatedCallCount=45]){const input=inputFor();mutate(input);blocked((await run({input})).report,'invalid-binding',0);}
});
test('object-bound seed is explicit and cannot claim an unavailable file hash',async()=>{
  const input=inputFor();input.seed.captureSHA256=null;delete input.captureBytes;assert.equal((await run({input})).report.seedComplete,true);
});
test('old or future pins are refused locally with no head selection or repointing',async()=>{
  for(const seconds of [-181,31])blocked((await run({state:syntheticState({time:CLOCK+seconds*1000})})).report,'pin-not-recent',0);
});
test('account and normalized slot request bounds reject duplicates, invalid values and excess scope before RPC',async()=>{
  const changes=[i=>i.seed.accounts.push({...i.seed.accounts[0]}),i=>i.seed.accounts[0].slots=['0x2',SLOT],
    i=>i.seed.accounts[0].slots=['0x'+'1'.repeat(65)],i=>i.seed.accounts[0].address='0x1234',
    i=>i.seed.accounts[0].slots=Array.from({length:257},(_,n)=>`0x${n.toString(16)}`),
    i=>i.seed.accounts=Array.from({length:65},(_,n)=>({address:`0x${n.toString(16).padStart(40,'0')}`,slots:[]})),
    i=>i.seed.accounts=Array.from({length:5},(_,n)=>({address:`0x${n.toString(16).padStart(40,'0')}`,slots:Array.from({length:205},(_,j)=>`0x${j.toString(16)}`)}))];
  for(const change of changes){const input=inputFor();change(input);blocked((await run({input})).report,'invalid-binding',0);}
});
test('64 explicitly requested authenticated accounts use exactly131 reads with no expansion',async()=>{
  const input=inputFor();for(let n=1;n<64;n++)input.seed.accounts.push({address:`0x${n.toString(16).padStart(40,'0')}`,slots:[]});
  const {report}=await run({input});assert.equal(report.seedComplete,true);assert.equal(report.requests.length,LIMITS.maximumRequests);assert.equal(report.provedAccounts,64);
});
test('returned wrong account, omitted/duplicate/extra slot, forged state, code and malformed trie proofs fail closed',async()=>{
  for(const change of [p=>p.address=`0x${'ff'.repeat(20)}`,p=>p.storageProof=[],p=>p.storageProof.push(p.storageProof[0]),
    p=>p.storageProof[0].key='0x3',p=>p.storageProof[0].value='0x0',p=>p.nonce='0x0',p=>p.balance='0x0',p=>p.accountProof=['0xc0'],p=>p.storageProof[0].proof=[]]){
    const state=syntheticState();change(state.proof);blocked((await run({state})).report,'invalid-proof',4);
  }
  const state=syntheticState(),input=inputFor(state);state.code='0x6001';blocked((await run({state,input})).report,'invalid-proof',4);
});
test('valid proof still cannot override a captured runtime expectation',async()=>{
  const input=inputFor();input.seed.accounts[0].expectedCodeHash=emptyCode;blocked((await run({input})).report,'runtime-expectation-mismatch',4);
});
test('canonical mismatch before proof and final reorg retain partial evidence but never complete seed',async()=>{
  for(const index of [1,4]){
    const state=syntheticState();const {report}=await run({state,transform:({index:actual})=>actual===index?{result:seal({...state.header,extraData:'0x01'})}:undefined});
    blocked(report,'canonical-pin-mismatch',index+1);assert.equal(report.provedAccounts,index===4?1:0);
  }
  blocked((await run({transform:({index})=>index===1?{result:{number:'0x1'}}:undefined})).report,'invalid-header',2);
});
test('partial multi-account failure retains authenticated accounts and raw failed response, without retries',async()=>{
  const input=inputFor();input.seed.accounts.push({address:`0x${'ff'.repeat(20)}`,slots:[]});
  const {report}=await run({input,transform:({index})=>index===4?{error:{code:-32602,message:'proof window unavailable'}}:undefined});
  blocked(report,'rpc-error',5);assert.equal(report.error.rpcCode,-32602);assert.equal(report.provedAccounts,1);
});
test('wrong chain, bad envelope/JSON/id, null proof and unknown transport retain honest failure reasons',async()=>{
  blocked((await run({transform:()=>({result:'0x1'})})).report,'wrong-chain',1);
  for(const [body,reason] of [['{','invalid-json'],['{"jsonrpc":"2.0","id":99,"result":null}','invalid-rpc-envelope'],
    ['{"jsonrpc":"2.0","id":1}','missing-result'],['{"jsonrpc":"2.0","id":1,"result":null,"error":{}}','invalid-rpc-envelope']])
    blocked((await run({transform:()=>new Response(body)})).report,reason,1);
  blocked((await run({transform:({index})=>index===2?{result:null}:undefined})).report,'invalid-proof',4);
  const {report}=await run({transform:()=>{throw Error('secret unclassified cause');}});blocked(report,'transport-error',1);assert.ok(!JSON.stringify(report).includes('secret unclassified'));
});
test('HTTP errors retain exact bytes; redirects and changed recipients never follow',async()=>{
  const r=(await run({transform:()=>new Response('unavailable',{status:503})})).report;blocked(r,'http-error',1);assert.equal(Buffer.from(r.requests[0].rawResponseBase64,'base64').toString(),'unavailable');
  blocked((await run({transform:()=>new Response('',{status:302,headers:{location:'https://example.org'}})})).report,'redirect-rejected',1);
  blocked((await run({transform:()=>({response:{redirected:false,url:'https://example.org',status:200}})})).report,'recipient-changed',1);
});
test('oversized declared and streamed bodies preserve only bounded prefixes and never full response claims',async()=>{
  blocked((await run({transform:()=>new Response('{}',{headers:{'content-length':String(LIMITS.maximumResponseBytes+1)}})})).report,'response-too-large',1);
  const data=new Uint8Array(LIMITS.maximumResponseBytes+1).fill(32);
  const {report}=await run({transform:()=>new Response(new ReadableStream({start(c){c.enqueue(data);c.close();}}))});
  blocked(report,'response-too-large',1);assert.equal(report.requests[0].responseComplete,false);assert.equal(report.requests[0].capturedResponseBytes,LIMITS.maximumResponseBytes);assert.equal(report.requests[0].observedResponseBytes,LIMITS.maximumResponseBytes+1);
});
test('aggregate response limit is enforced independently of each response limit',async()=>{
  const input=inputFor();for(let n=1;n<6;n++)input.seed.accounts.push({address:`0x${n.toString(16).padStart(40,'0')}`,slots:[]});
  const {report}=await run({input,transform:({request,result,index})=>index<2?undefined:new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}).padEnd(LIMITS.maximumResponseBytes,' '))});
  blocked(report,'response-too-large');assert.equal(report.responseBytes,LIMITS.maximumTotalResponseBytes);assert.ok(report.requests.length<15);
});
test('body read deadline and full-operation deadline remain bounded without retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let entered;const bodyEntered=new Promise(r=>{entered=r;});
  const pending=run({transform:()=>({response:{status:200,ok:true,redirected:false,headers:new Headers(),body:{getReader(){entered();return{read:()=>new Promise(()=>{}),cancel:async()=>{}};}}}})});
  await bodyEntered;t.mock.timers.tick(LIMITS.perRequestTimeoutMs);blocked((await pending).report,'request-timeout',1);t.mock.timers.reset();
  let clock=CLOCK;const {report}=await run({now:()=>clock,transform:({index})=>{if(index===2)clock+=LIMITS.maximumDurationMs;}});blocked(report,'total-timeout',3);
});
test('checkpoint receives copies and cannot mutate collected scope or report acceptance',async()=>{
  const {report}=await run({checkpoint:copy=>{copy.fullWitnessComplete=true;copy.requests.length=0;}});assert.equal(report.seedComplete,true);assert.equal(report.fullWitnessComplete,false);assert.equal(report.requests.length,5);
  blocked((await run({checkpoint:()=>{throw Error('disk unavailable');}})).report,'checkpoint-failed',1);
});
test('native additional account/slot handoff is bound, bounded and explicitly non-executing',()=>{
  const input=inputFor(),scope=validateCapturedStateSeed(input);
  const request={schema:'keel-native-additional-witness-request@1',binding:scope.binding,nativeRequestSHA256:'a'.repeat(64),executeAutomatically:false,accounts:[{address:ACCOUNT,slots:['0x3']}]};
  const normalized=validateAdditionalWitnessRequests(input.seed,request);assert.equal(normalized.accounts[0].slots[0],normalizeWitnessSlot('0x3'));assert.equal(normalized.fullWitnessComplete,false);
  assert.equal(normalized.binding.seedObjectSHA256,sha256(stable(input.seed)));
  const changedSeed=structuredClone(input.seed);changedSeed.accounts[0].slots=['0x4'];
  assert.throws(()=>validateAdditionalWitnessRequests(changedSeed,request));
  for(const mutate of [r=>r.executeAutomatically=true,r=>r.binding.pin.number='0x1',r=>r.binding.sourceFingerprint='f'.repeat(64),r=>r.accounts[0].slots=['0x3','0x03']]){const copy=structuredClone(request);mutate(copy);assert.throws(()=>validateAdditionalWitnessRequests(input.seed,copy));}
});
test('actual positive public factory proof fixture independently verifies and replays offline at its original pin',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/captured-state-public-factory-proof.json',import.meta.url),'utf8'));
  assert.equal(encodeCapturedHeader(fixture.header),fixture.headerRlp);
  const account=fixture.account,state={header:fixture.header,code:account.code,proof:account},input=inputFor(state);
  assert.equal(verifyCapturedAccountProof(state.header,input.seed.accounts[0],account,account.code).codeHash,account.codeHash);
  const {report}=await run({state,input,now:()=>Date.parse(fixture.source.startedAt)});
  assert.equal(report.seedComplete,true);assert.equal(report.fullWitnessComplete,false);assert.equal(report.binding.pin.hash,fixture.source.pin.hash);
  // Synthetic local source program here binds an old retained public proof. It
  // is not a new live proof or a fresh/actual Retro project witness.
});
test('CLI import/help and malformed inputs never read RPC; output is private and existing files remain unchanged',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'keel-captured-witness-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const state=syntheticState(),input=inputFor(state),capture=join(directory,'capture.json'),seed=join(directory,'seed.json'),output=join(directory,'witness.json');
  writeFileSync(capture,input.captureBytes);writeFileSync(seed,JSON.stringify(input.seed));
  assert.equal(await main(['--help']),0);await assert.rejects(main(['--rpc','https://example.org']));
  const h=harness(state,input);assert.equal(await main(['--capture',capture,'--seed',seed,'--output',output],{fetchImpl:h.fetchImpl,now:()=>CLOCK}),0);
  assert.equal(statSync(output).mode&0o777,0o600);assert.equal(JSON.parse(readFileSync(output)).fullWitnessComplete,false);
  const before=readFileSync(output);await assert.rejects(main(['--capture',capture,'--seed',seed,'--output',output]));assert.deepEqual(readFileSync(output),before);
  const link=join(directory,'linked-capture.json');symlinkSync(capture,link);await assert.rejects(main(['--capture',link,'--seed',seed,'--output',join(directory,'unused.json')]));
});
