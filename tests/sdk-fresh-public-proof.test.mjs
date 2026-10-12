import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak256, toRlp } from 'viem';
const originalFetch=globalThis.fetch;let unexpectedNetworkReads=0;
globalThis.fetch=async()=>{unexpectedNetworkReads++;throw new Error('Offline test forbids network');};
after(()=>{globalThis.fetch=originalFetch;assert.equal(unexpectedNetworkReads,0,'All tests and imports must remain offline');});
const helper = await import(new URL(process.env.KEEL_PROOF_HELPER_MODULE ?? '../scripts/lib/fresh-public-proof.mjs', import.meta.url));
const { captureFreshProofCapability: capture, RPC, ACCOUNT, SLOT, LIMITS, main } = helper;
const CLOCK = 1_791_760_000_000;
const hash = octet => `0x${octet.repeat(32)}`;
const scalar = x => x === '0x0' ? '0x' : `0x${x.slice(2).padStart(Math.ceil((x.length - 2) / 2) * 2, '0')}`;
function seal(h) {
  const fields = [h.parentHash,h.sha3Uncles,h.miner,h.stateRoot,h.transactionsRoot,h.receiptsRoot,h.logsBloom,
    ...[h.difficulty,h.number,h.gasLimit,h.gasUsed,h.timestamp].map(scalar),h.extraData,h.mixHash,h.nonce,
    scalar(h.baseFeePerGas),h.withdrawalsRoot,scalar(h.blobGasUsed),scalar(h.excessBlobGas),h.parentBeaconBlockRoot,h.requestsHash,h.blockAccessListHash,scalar(h.slotNumber)];
  return { ...h, hash: keccak256(toRlp(fields)) };
}
function fixture({ nonzero = false } = {}) {
  const leaf = (key,value) => toRlp([`0x20${key.slice(2)}`,value]);
  const code='0x60006000f3', codeHash=keccak256(code);
  const storageNode=leaf(keccak256(SLOT),toRlp('0x2a'));
  const storageHash=nonzero ? keccak256(storageNode) : keccak256('0x80');
  const accountNode=leaf(keccak256(ACCOUNT),toRlp(['0x01','0x',storageHash,codeHash]));
  const header=seal({ parentHash:hash('01'),sha3Uncles:keccak256(toRlp([])),miner:`0x${'11'.repeat(20)}`,
    stateRoot:keccak256(accountNode),transactionsRoot:keccak256('0x80'),receiptsRoot:keccak256('0x80'),
    logsBloom:`0x${'00'.repeat(256)}`,difficulty:'0x0',number:'0xb58000',gasLimit:'0xbebc200',gasUsed:'0x0',
    timestamp:`0x${(CLOCK/1000).toString(16)}`,extraData:'0x',mixHash:hash('02'),nonce:'0x0000000000000000',
    baseFeePerGas:'0x1',withdrawalsRoot:hash('03'),blobGasUsed:'0x0',excessBlobGas:'0x0',
    parentBeaconBlockRoot:hash('04'),requestsHash:hash('05'),blockAccessListHash:hash('06'),slotNumber:'0x1' });
  const proof={address:ACCOUNT,balance:'0x0',nonce:'0x1',codeHash,storageHash,accountProof:[accountNode],
    storageProof:[{key:'0x2',value:nonzero?'0x2a':'0x0',proof:nonzero?[storageNode]:[]}]};
  return {header,proof,code};
}
function harness({ transform = () => undefined, data = fixture() } = {}) {
  const calls=[];
  const fetchImpl=async (url,options) => {
    const request=JSON.parse(options.body); calls.push(request);
    assert.equal(url,RPC); assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit');
    assert.equal(options.method,'POST'); assert.ok(options.signal instanceof AbortSignal);
    const expected=[['eth_chainId',[]],['eth_getBlockByNumber',['latest',false]],
      ['eth_getProof',[ACCOUNT,[SLOT],data.header.number]],['eth_getCode',[ACCOUNT,data.header.number]],
      ['eth_getBlockByNumber',[data.header.number,false]]][calls.length-1];
    assert.deepEqual([request.method,request.params],expected,'No extra or broadened public read');
    let result=[ '0xaa36a7',data.header,data.proof,data.code,data.header ][calls.length-1];
    const changed=await transform({request,index:calls.length-1,data,result,options});
    if (changed instanceof Response) return changed;
    if (changed?.customResponse) return changed.customResponse;
    if (changed?.error) return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:changed.error}));
    if (changed && Object.hasOwn(changed,'result')) result=changed.result;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  };
  return { calls, fetchImpl };
}
const run = async opts => {const h=harness(opts); return {report:await capture({fetchImpl:h.fetchImpl,now:()=>CLOCK}),calls:h.calls};};
function blocked(r,reason,count) {
  assert.equal(r.status,'blocked'); assert.equal(r.error.reason,reason);
  assert.equal(r.acceptance,false); assert.equal(r.capabilityVerified,false);
  if(count!==undefined)assert.equal(r.requests.length,count);
}

test('exact five public reads verify authenticated account and explicit absent slot; never acceptance',async()=>{
  const {report:r,calls}=await run();
  assert.equal(r.capabilityVerified,true); assert.equal(r.proofVerified,true); assert.equal(r.canonicalSnapshotRechecked,true);
  assert.equal(r.acceptance,false);assert.equal(r.gateAccepted,false);assert.equal(r.projectAcceptance,false);
  assert.equal(r.fullWitnessComplete,false);assert.equal(r.transitiveStateComplete,false);assert.equal(r.simulations,0);
  assert.equal(r.projectCalldataSent,false);assert.equal(calls.filter(x=>x.params[0]==='latest').length,1);
  assert.equal(r.witness.accounts[0].storageProof[0].key,SLOT);assert.equal(r.witness.accounts[0].storageProof[0].value,'0x0');
  for(const entry of r.requests){const raw=Buffer.from(entry.rawResponseBase64,'base64');assert.equal(raw.length,entry.capturedResponseBytes);assert.equal(entry.responseComplete,true);assert.equal(JSON.parse(raw).id,entry.request.id);}
});
test('nonzero raw control slot is authenticated, never replaced by assumed zero',async()=>{
  const {report:r}=await run({data:fixture({nonzero:true})});assert.equal(r.capabilityVerified,true);assert.equal(r.witness.accounts[0].storageProof[0].value,'0x2a');
});
test('invalid account proof cannot use provider supplied account fields',async()=>{
  const data=fixture();data.proof.accountProof=['0xc0'];blocked((await run({data})).report,'invalid-proof',4);
});
test('missing storage proof is not filled with zero',async()=>{
  const data=fixture();data.proof.storageProof=[];blocked((await run({data})).report,'invalid-proof',4);
});
test('wrong or duplicate storage proof slots rejected',async()=>{
  for(const mutate of [p=>{p.storageProof[0].key='0x3';},p=>{p.storageProof.push(p.storageProof[0]);}]){
    const data=fixture();mutate(data.proof);blocked((await run({data})).report,'invalid-proof',4);
  }
});
test('runtime must match the authenticated code hash',async()=>{
  const data=fixture();data.code='0x6001';blocked((await run({data})).report,'invalid-proof',4);
});
test('canonical reorg after valid proof rejects capability while preserving observed proof',async()=>{
  const {report:r}=await run({transform:({index,data})=>index===4?{result:seal({...data.header,extraData:'0x01'})}:undefined});
  blocked(r,'canonical-recheck-mismatch',5);assert.equal(r.proofVerified,true);assert.equal(r.canonicalSnapshotRechecked,false);
});
test('missing and tampered header commitments reject before proof request',async()=>{
  for(const header of [null,{number:'0x1'}, {...fixture().header,stateRoot:hash('ff')}]){
    blocked((await run({transform:({index})=>index===1?{result:header}:undefined})).report,'invalid-header',2);
  }
});
test('stale latest and future header reject before proof request',async()=>{
  for(const seconds of [-181,31]){
    const data=fixture();data.header=seal({...data.header,timestamp:`0x${(CLOCK/1000+seconds).toString(16)}`});
    blocked((await run({data})).report,'head-not-fresh',2);
  }
});
test('wrong chain stops before selecting latest',async()=>{
  blocked((await run({transform:({index})=>index===0?{result:'0x1'}:undefined})).report,'wrong-chain',1);
});
test('RPC proof-window error preserves bounded raw bytes and code, without retry',async()=>{
  const {report:r}=await run({transform:({index})=>index===2?{error:{code:-32602,message:'distance to target block exceeds maximum proof window'}}:undefined});
  blocked(r,'rpc-error',3);assert.equal(r.error.rpcCode,-32602);
  assert.equal(JSON.parse(Buffer.from(r.requests[2].rawResponseBase64,'base64')).error.code,-32602);
});
test('HTTP failure preserves exact public error body without retry',async()=>{
  const {report:r}=await run({transform:()=>new Response('service unavailable',{status:503})});
  blocked(r,'http-error',1);assert.equal(r.requests[0].httpStatus,503);assert.equal(Buffer.from(r.requests[0].rawResponseBase64,'base64').toString(),'service unavailable');
});
test('invalid JSON and incorrect RPC id reject',async()=>{
  for(const [body,reason] of [['no JSON','invalid-json'],['{"jsonrpc":"2.0","id":999,"result":"0xaa36a7"}','invalid-rpc-envelope']])
    blocked((await run({transform:()=>new Response(body)})).report,reason,1);
});
test('oversized stream preserves bounded prefix and records that response is incomplete',async()=>{
  const {report:r}=await run({transform:()=>new Response(new Uint8Array(LIMITS.maximumResponseBytes+17))});
  blocked(r,'response-too-large',1);assert.equal(r.requests[0].capturedResponseBytes,LIMITS.maximumResponseBytes);
  assert.equal(r.requests[0].observedResponseBytes,LIMITS.maximumResponseBytes+17);assert.equal(r.requests[0].responseComplete,false);
});
test('oversized declared response is refused before consuming body',async()=>{
  const {report:r}=await run({transform:()=>new Response('tiny',{headers:{'content-length':String(LIMITS.maximumResponseBytes+1)}})});
  blocked(r,'response-too-large',1);assert.equal(r.requests[0].capturedResponseBytes,0);assert.equal(r.requests[0].responseComplete,false);
});
test('redirect status, redirected flag, and alternate response recipient are rejected',async()=>{
  for(const response of [new Response('redirect',{status:302,headers:{location:'https://unapproved.invalid'}}),
    {status:200,redirected:true,url:RPC}, {status:200,redirected:false,url:'https://unapproved.invalid'}]) {
    const reason=response.url==='https://unapproved.invalid'?'recipient-changed':'redirect-rejected';
    blocked((await run({transform:()=>({customResponse:response})})).report,reason,1);
  }
});
test('unknown transport failure remains unknown and never retries',async()=>{
  let count=0;const r=await capture({now:()=>CLOCK,fetchImpl:async()=>{count++;throw new Error('arbitrary untrusted provider text');}});
  blocked(r,'transport-error',1);assert.equal(count,1);assert.ok(!JSON.stringify(r).includes('arbitrary untrusted'));
});
test('request timeout includes stalled body reads and preserves received prefix',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let entered;const started=new Promise(resolve=>{entered=resolve;});
  const h=harness({transform:()=>new Response(new ReadableStream({start(controller){controller.enqueue(Buffer.from('{'));entered();}}))});
  const pending=capture({fetchImpl:h.fetchImpl,now:()=>CLOCK});await started;await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(LIMITS.perRequestTimeoutMs);const r=await pending;
  blocked(r,'request-timeout',1);assert.equal(r.requests[0].capturedResponseBytes,1);assert.equal(r.requests[0].responseComplete,false);
});
test('global deadline cannot be restarted for the next public read',async()=>{
  let time=CLOCK;const h=harness({transform:({index})=>{if(index===0)time+=LIMITS.maximumDurationMs+1;}});
  const r=await capture({fetchImpl:h.fetchImpl,now:()=>time});blocked(r,'total-timeout',1);
});
test('import, help, invalid CLI scope and existing output perform no network reads',async()=>{
  let reads=0;const dependencies={fetchImpl:async()=>{reads++;throw new Error('NETWORK FORBIDDEN');}};
  assert.equal(await main(['--help'],dependencies),0);
  await assert.rejects(main(['--url',RPC],dependencies));await assert.rejects(main(['--output','relative.json'],dependencies));
  const dir=mkdtempSync(join(tmpdir(),'keel-proof-no-network-')),path=join(dir,'preserved.json');writeFileSync(path,'original');
  await assert.rejects(main(['--output',path],dependencies));assert.equal(readFileSync(path,'utf8'),'original');assert.equal(reads,0);
});
test('CLI produces private new diagnostic output with no project input',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'keel-proof-cli-')),path=join(dir,'proof.json'),h=harness();
  assert.equal(await main(['--output',path],{fetchImpl:h.fetchImpl,now:()=>CLOCK}),0);
  const r=JSON.parse(readFileSync(path));assert.equal(r.capabilityVerified,true);assert.equal(r.acceptance,false);assert.equal(statSync(path).mode&0o777,0o600);
});
