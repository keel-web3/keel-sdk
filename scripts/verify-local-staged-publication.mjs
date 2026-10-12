#!/usr/bin/env node
// Mandatory local qualification. Synthetic state only; no live project acceptance.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build,version as esbuildVersion} from 'esbuild';
import {encodeAbiParameters,encodeFunctionData,parseAbi,keccak256,stringToHex} from 'viem';
import {createNativeProcessClient} from './lib/native-session-process.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const args=process.argv.slice(2),options={};
if(args.length===1&&args[0]==='--help') {
 console.log('node scripts/verify-local-staged-publication.mjs --native-build ABS --fixtures ABS --output NEW_ABS_DIRECTORY\nCloud local qualification only. Requires verified native build and synthetic fixture receipts; no network, signing, project capture, or production activation.');process.exit(0);
}
for(let i=0;i<args.length;i+=2) {
 assert.ok(['--native-build','--fixtures','--output'].includes(args[i])&&!options[args[i]]&&isAbsolute(args[i+1]??''),'Explicit unique absolute paths required');options[args[i]]=args[i+1];
}
assert.equal(Object.keys(options).length,3,'All three paths required');
assert.ok(Number(process.versions.node.split('.')[0])>=22,'Node22 or newer required');
const root=options['--output'],fixture=options['--fixtures'],nativeBuild=options['--native-build'];
const buildReceiptBytes=readFileSync(join(nativeBuild,'build-receipt.json')),buildReceipt=JSON.parse(buildReceiptBytes);
assert.equal(buildReceipt.schema,'keel-canonical-native-engine-build@1');
const sourceManifestSHA256=sha(readFileSync(join(repo,'scripts/native/canonical-state-engine/source-manifest.json')));
assert.equal(buildReceipt.sourceManifestSHA256,sourceManifestSHA256);
const binaryPath=join(nativeBuild,'keel-sparse'),binarySHA256=buildReceipt.binarySHA256;
assert.equal(sha(readFileSync(binaryPath)),binarySHA256);
const fixtureReceiptBytes=readFileSync(join(fixture,'fixture-receipt.json')),fixtureReceipt=JSON.parse(fixtureReceiptBytes);
assert.equal(fixtureReceipt.schema,'keel-local-staged-fixture-build@1');assert.equal(fixtureReceipt.synthetic,true);assert.equal(fixtureReceipt.projectAcceptance,false);
assert.equal(fixtureReceipt.nativeBuildReceiptSHA256,sha(buildReceiptBytes));assert.equal(fixtureReceipt.binarySHA256,binarySHA256);
assert.equal(fixtureReceipt.sourceManifestSHA256,sourceManifestSHA256);
assert.equal(fixtureReceipt.builderSHA256,sha(readFileSync(join(repo,'scripts/build-local-staged-fixtures.mjs'))));
for(const [name,expected] of Object.entries(fixtureReceipt.files)) {assert.match(name,/^[a-zA-Z0-9.-]+$/);const bytes=readFileSync(join(fixture,name));assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256);}
mkdirSync(root,{mode:0o700});
assert.equal(esbuildVersion,'0.28.2');
const bundlePath=join(root,'qualified-sdk-entry.mjs');
await build({stdin:{contents:'export { createKeelLocalSimulationTransport } from "./packages/sdk/src/local-simulation-session.ts"; export { simulateKeelPublicationBeforeFunding } from "./packages/sdk/src/publication-preflight.ts";',resolveDir:repo,sourcefile:'local-qualification-entry.mjs'},outfile:bundlePath,bundle:true,platform:'node',format:'esm',target:'node22'});
const {createKeelLocalSimulationTransport,simulateKeelPublicationBeforeFunding}=await import(pathToFileURL(bundlePath).href);
const inputPath=join(fixture,'input.json'),inputBytes=readFileSync(inputPath);
const prerequisites=[];
function requiredTest(name,file,env) {
 const result=spawnSync(process.execPath,[file],{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,...env}});
 const log=(result.stdout??'')+(result.stderr??'');writeFileSync(join(root,name+'.log'),log,{flag:'wx',mode:0o600});
 assert.equal(result.status,0,result.error?.message??name+' failed');
 const count=Number(log.match(/^# tests (\d+)$/m)?.[1]);assert.ok(count>1,'Require individual test cases, not a single outer file result');assert.match(log,/^# fail 0$/m);assert.match(log,/^# skipped 0$/m);
 prerequisites.push({name,tests:count,logSHA256:sha(log),sourceSHA256:sha(readFileSync(file))});
}
requiredTest('sdk-session-controls',join(repo,'tests/sdk-local-simulation-session.test.mjs'),{KEEL_LOCAL_SESSION_MODULE:pathToFileURL(bundlePath).href});
requiredTest('native-process-controls',join(repo,'scripts/native/native-session-process.test.mjs'),{
 KEEL_NATIVE_SESSION_BINARY:binaryPath,KEEL_NATIVE_SESSION_BINARY_SHA256:binarySHA256,KEEL_NATIVE_SESSION_INPUT:inputPath,KEEL_NATIVE_SESSION_INPUT_SHA256:sha(inputBytes),
 KEEL_NATIVE_SESSION_PROGRAM:join(fixture,'program.json'),KEEL_NATIVE_SESSION_EVIDENCE:join(root,'native-process-evidence.json')
});
const input=JSON.parse(inputBytes),header=JSON.parse(readFileSync(inputPath+'.header.json'));
const manifest=JSON.parse(readFileSync(join(fixture,'manifest.json')));
assert.equal(manifest.sourceHashes.StateSequence,sha(readFileSync(join(repo,'tests/fixtures/native-geth-publication/StateSequence.sol'))));
assert.equal(manifest.sourceHashes.SyntheticAtomicExecutor,sha(readFileSync(join(repo,'tests/fixtures/native-geth-publication/SyntheticAtomicExecutor.sol'))));
const original=JSON.parse(readFileSync(join(fixture,'program.json')));
const calls=original.blockStateCalls.map(b=>b.calls[0]),reader=calls[0].to;
assert.equal(calls.length,47);assert.equal(header.hash.toLowerCase(),input.headerHash.toLowerCase());
const abi=parseAbi(['function write(uint256) returns(uint256)','function read() view returns(uint256)','function tokenURIForCount(uint256) view returns(string)']);
const budgetPath=join(root,'synthetic-50m-stage-input.json');writeFileSync(budgetPath,JSON.stringify({...input,stageGasCap:50_000_000},null,2)+'\n');writeFileSync(budgetPath+'.header.json',readFileSync(inputPath+'.header.json'));
const report={schema:'keel-native-sdk-staged-integration@1',synthetic:true,actualRetroAcceptance:false,actualPaidAcceptance:false,
  signing:'not-performed',submission:'not-performed',network:'isolated-no-routes',binarySHA256,
  originalSyntheticInputSHA256:sha(inputBytes),adapterSourceSHA256:sha(readFileSync(join(repo,'packages/sdk/src/local-simulation-session.ts'))),
  preflightSourceSHA256:sha(readFileSync(join(repo,'packages/sdk/src/publication-preflight.ts'))),runnerSHA256:sha(readFileSync(fileURLToPath(import.meta.url))),sourceManifestSHA256,buildReceiptSHA256:sha(buildReceiptBytes),fixtureReceiptSHA256:sha(fixtureReceiptBytes),sdkBundleSHA256:sha(readFileSync(bundlePath)),processClientSHA256:sha(readFileSync(join(repo,'scripts/lib/native-session-process.mjs'))),prerequisites,checks:[],runs:[]};
const record=(name,details={})=>{report.checks.push({name,...details});console.log(`PASS ${name}`);};
function plan(count=1n) {
 const final=42n+45n*count;
 const {nonce:readerNonce,...readerCall}=calls[45],{nonce:metadataNonce,...metadataCall}=calls[46];
 return {planFingerprint:keccak256(stringToHex(`synthetic-47-write-${count}`)),chainId:11155111,blockNumber:BigInt(header.number),reader,
  readerRuntimeCodeHash:manifest.runtimeHash,preparationCalls:calls.slice(0,45).map((call,index)=>({...call,data:encodeFunctionData({abi,functionName:'write',args:[count]})})),
  assertions:calls.slice(0,45).map((_,index)=>({callIndex:index,returnData:encodeAbiParameters([{type:'uint256'}],[42n+BigInt(index+1)*count])})),
  requiredReaderCalls:[{call:readerCall,expectedReturn:encodeAbiParameters([{type:'uint256'}],[final]),gasMargin:10_000n}],
  metadataCall:{...metadataCall,data:encodeFunctionData({abi,functionName:'tokenURIForCount',args:[final]})},expectedTokenURI:manifest.expectedURI,
  maximumTokenUriBytes:2_000_000,maximumReadGas:16_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:200_000_000n};
}
async function run(label,planned,{file=inputPath,lostReply=false,reorg=false,cancelAtStage,expectedKind,rawProgram}={}) {
 const currentInputBytes=readFileSync(file),currentInput=JSON.parse(currentInputBytes),header=JSON.parse(readFileSync(file+'.header.json')),processes=[],sessions=[],wire=[];let lost=false,completed=0;
 const control=new AbortController();
 const transport=createKeelLocalSimulationTransport({block:{number:BigInt(header.number),hash:header.hash,stateRoot:header.stateRoot},signal:control.signal,
  readTransport:{async request({method,params}){
   if(method==='eth_chainId'){assert.deepEqual(params,[]);return '0xaa36a7';}
   if(method==='eth_getBlockByNumber'){assert.deepEqual(params,[header.number,false]);return reorg&&completed>0?{...header,hash:`0x${'ff'.repeat(32)}`}:header;}
   if(method==='eth_getCode'){assert.equal(params[1],header.number);const account=currentInput.accounts.find(a=>a.address.toLowerCase()===params[0].toLowerCase());assert.ok(account,'Missing synthetic public account');return account.code;}
   throw new Error('Unexpected synthetic read '+method);
  }},async createClient(){
   const client=await createNativeProcessClient({binaryPath,binarySHA256,inputPath:file,inputSHA256:sha(currentInputBytes)});processes.push(client.evidence);
   return {close:()=>client.close(),async request(command,options){
    const response=await client.request(command,options);wire.push({command:structuredClone(command),response});
    if(command.type==='finish'&&response.result)completed++;
    if(command.type==='stage'&&command.index===cancelAtStage){control.abort();}
    if(lostReply&&!lost&&command.type==='stage'&&command.index===1){lost=true;throw Object.assign(new Error('Injected loss after actual native committed stage reply'),{code:'LOCAL_RESPONSE_LOST'});}
    return response;
   }};
  },onSession:e=>sessions.push(e)});
 let proof,failure,rawResult;
 try {if(rawProgram)rawResult=await transport.request({method:'eth_simulateV1',params:[rawProgram,header.number]});else proof=await simulateKeelPublicationBeforeFunding(planned,transport);if(expectedKind)assert.fail('Expected complete validator to reject');}
 catch(error){if(!expectedKind)throw error;assert.equal(error.kind,expectedKind);failure={kind:error.kind,diagnostic:error.diagnostic};}
 finally {await transport.close();assert.ok(processes.every(p=>p.isolated&&p.exitConfirmed),'Every native process must exit in isolation');}
 const requests=wire.filter(item=>item.command.type==='begin').map(item=>{const program=JSON.parse(item.command.programJSON);return {sessionId:item.command.sessionId,programDigest:item.command.programDigest,validation:program.validation,blockCount:program.blockStateCalls.length,exactProgram:program};});
 const metrics=requests.map(req=>{const stages=wire.filter(item=>item.command.type==='stage'&&item.command.sessionId===req.sessionId&&item.response.result).filter((item,index,items)=>items.findIndex(x=>x.command.index===item.command.index)===index);
  return {sessionId:req.sessionId,validation:req.validation,stages:stages.map(item=>{const block=item.response.result.result,tx=block.transactions[0],call=block.calls[0],requested=req.exactProgram.blockStateCalls[item.command.index].calls[0];
   assert.equal(tx.gas,requested.gas);return {index:item.command.index,requestedGas:requested.gas,returnedGas:tx.gas,gasUsed:call.gasUsed,maxUsedGas:call.maxUsedGas,status:call.status,returnDataHash:keccak256(call.returnData),returnDataBytes:(call.returnData.length-2)/2,blockHash:block.hash,parentHash:block.parentHash,checkpoint:item.response.result.checkpoint};}),
   aggregateGasUsed:stages.reduce((sum,item)=>sum+BigInt(item.response.result.result.calls[0].gasUsed),0n).toString()};});
 const result={label,inputSHA256:sha(currentInputBytes),stageGasCap:currentInput.stageGasCap,proof,failure,rawResult,sessions,processes,requests,metrics};report.runs.push(result);
 writeFileSync(join(root,`${label}.wire.json`),JSON.stringify(wire,null,2)+'\n');result.wireSHA256=sha(readFileSync(join(root,`${label}.wire.json`)));
 return result;
}
try {
 const basic=await run('synthetic47-original',plan());assert.equal(basic.proof.simulatedCalls,47);assert.equal(basic.proof.validatedTransactionCalls,45);assert.equal(basic.proof.completeTokenUriBytes,Buffer.byteLength(manifest.expectedURI));assert.equal(basic.proof.abiReturnDigest,keccak256(manifest.metadataABI));
 assert.deepEqual(basic.requests.map(r=>[r.validation,r.blockCount]),[[false,45],[true,45],[false,47]]);
 record('47-stage native result passes unchanged SDK strict and full-URI checks',{sessions:basic.sessions.length,fullURIBytes:basic.proof.completeTokenUriBytes});
 const capacity=await run('synthetic47-over-50m-aggregate',plan(100n),{file:budgetPath});
 const strict=capacity.metrics.find(m=>m.validation);assert.ok(BigInt(strict.aggregateGasUsed)>50_000_000n);assert.ok(strict.stages.every(s=>BigInt(s.maxUsedGas)<50_000_000n));
 assert.equal(capacity.proof.simulatedCalls,47);assert.equal(capacity.proof.abiReturnDigest,keccak256(manifest.metadataABI));
 record('separate native stages exceed50M aggregate with exact individual envelopes and full metadata',{strictAggregateGasUsed:strict.aggregateGasUsed,stageGasCap:50_000_000});
 const mismatch=await run('synthetic47-full-uri-mismatch',{...plan(),expectedTokenURI:manifest.expectedURI+' '},{expectedKind:'metadata-mismatch'});
 assert.equal(mismatch.proof,undefined);record('full URI byte mismatch rejected after actual native replay');
 const retry=await run('synthetic47-lost-native-reply',plan(),{lostReply:true});assert.equal(retry.proof.abiReturnDigest,basic.proof.abiReturnDigest);
 record('lost committed stage response retries idempotently and retains exact full metadata');
 const stale=await run('synthetic47-canonical-reorg',plan(),{reorg:true,expectedKind:'chain-reorganized'});assert.equal(stale.proof,undefined);
 record('changed canonical pin rejects actual complete native result');
 const cancelled=await run('synthetic47-cancelled',plan(),{cancelAtStage:1,expectedKind:'rpc-unavailable'});assert.equal(cancelled.proof,undefined);assert.equal(cancelled.requests.length,1);
 record('cancellation discards actual partial native state and confirms process exit');
 const reload=await run('synthetic47-after-cancel-reload',plan());assert.equal(reload.proof.abiReturnDigest,basic.proof.abiReturnDigest);
 record('new session after cancellation starts from canonical input and completes full validator');
 const atomicFile=join(fixture,'atomic-input.json'),atomicHeader=JSON.parse(readFileSync(atomicFile+'.header.json'));
 const outer=JSON.parse(readFileSync(join(fixture,'atomic-program.json'))).blockStateCalls[0].calls[0];
 const base=plan();const atomicPlan={...base,blockNumber:BigInt(atomicHeader.number),transactionContext:'atomic-wallet',planFingerprint:keccak256(stringToHex('synthetic-six-inner-one-outer')),
  preparationCalls:[outer],assertions:[{callIndex:0,returnData:'0x'}],requiredReaderCalls:[{...base.requiredReaderCalls[0],expectedReturn:encodeAbiParameters([{type:'uint256'}],[48n])}],
  metadataCall:{...base.metadataCall,data:encodeFunctionData({abi,functionName:'tokenURIForCount',args:[48n]})}};
 const atomic=await run('synthetic-7702-six-inner-atomic',atomicPlan,{file:atomicFile});
 assert.equal(atomic.proof.validatedTransactionCalls,1);assert.equal(atomic.proof.simulatedCalls,3);
 assert.deepEqual(atomic.requests.map(r=>[r.validation,r.blockCount]),[[true,1],[true,1],[false,3]]);
 for(const request of atomic.requests) assert.equal(request.exactProgram.blockStateCalls[0].calls[0].data,outer.data);
 assert.equal(atomic.proof.abiReturnDigest,basic.proof.abiReturnDigest);
 record('six synthetic7702 inner calls execute inside one unchanged outer atomic stage',{outerCalls:1,innerCalls:6,fullURIBytes:atomic.proof.completeTokenUriBytes});
 const badInner=Array.from({length:6},(_,index)=>({target:reader,value:0n,callData:encodeFunctionData({abi,functionName:index===2?'tokenURIForCount':'write',args:[index===2?999n:1n]})}));
 const badOuter={...outer,data:encodeFunctionData({abi:parseAbi(['function execute(bytes32 mode, bytes executionCalldata) payable']),functionName:'execute',args:[
  '0x01'+'00'.repeat(31),encodeAbiParameters([{type:'tuple[]',components:[{name:'target',type:'address'},{name:'value',type:'uint256'},{name:'callData',type:'bytes'}]}],[badInner])
 ]})};
 const rejectedAtomic=await run('synthetic-7702-inner-revert',{...atomicPlan,preparationCalls:[badOuter]},{file:atomicFile,expectedKind:'execution-reverted'});
 assert.equal(rejectedAtomic.proof,undefined);assert.equal(rejectedAtomic.requests.length,1);assert.equal(rejectedAtomic.requests[0].blockCount,1);
 record('actual atomic inner revert is rejected without splitting or accepting partial writes');
 const rollback=await run('synthetic-7702-revert-state-observation',undefined,{file:atomicFile,rawProgram:{
  blockStateCalls:[{calls:[badOuter]},{calls:[{...base.requiredReaderCalls[0].call,nonce:'0x1'}]}],validation:true,traceTransfers:false,returnFullTransactions:true
 }});
 assert.equal(rollback.rawResult[0].calls[0].status,'0x0');assert.equal(rollback.rawResult[1].calls[0].status,'0x1');
 assert.equal(rollback.rawResult[1].calls[0].returnData,encodeAbiParameters([{type:'uint256'}],[42n]));
 assert.equal(rollback.proof,undefined);
 record('native atomic revert restores pre-batch storage while preserving outer transaction nonce semantics');
 report.status='synthetic-native-sdk-integration-passed';
} finally {
 writeFileSync(join(root,'native-sdk-integration-evidence.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({checks:report.checks.length,status:report.status??'incomplete',evidenceSHA256:sha(readFileSync(join(root,'native-sdk-integration-evidence.json'))),actualRetroAcceptance:false,actualPaidAcceptance:false}));
}
