import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import { encodeFunctionData, encodeAbiParameters, keccak256, toHex } from 'viem';
import { createProofBackedSimulationTransport } from '../native/proof-executor/transport.mjs';
import { encodeKeelAtomicWalletBatch } from '../packages/sdk/dist/release-wallet-batch.js';
import { simulateKeelPublicationBeforeFunding } from '../packages/sdk/dist/publication-preflight.js';
const image='ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd';
const runnerImage='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const build=process.env.KEEL_NATIVE_BUILD_DIR??'/tmp/keel-proof-executor-build';
const binary=join(build,'keel-proof-executor'),binarySha256=createHash('sha256').update(readFileSync(binary)).digest('hex');
const receipt=JSON.parse(readFileSync(join(build,'receipt.json'),'utf8'));assert.equal(receipt.binarySha256,binarySha256);
const tmp=mkdtempSync(join(tmpdir(),'keel-proof-state-')),container=`keel-proof-state-${process.pid}`;
const owner=`0x${'11'.repeat(20)}`,reader=`0x${'22'.repeat(20)}`,delegated=`0x${'44'.repeat(20)}`,contexts=`0x${'55'.repeat(20)}`,batchImplementation=`0x${'66'.repeat(20)}`,batchOwner=`0x${'77'.repeat(20)}`;
const expectedTokenURI='data:application/json,{"name":"Synthetic state sequence"}';
const evidence={schema:'keel-proof-executor-differential@1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),receipt,synthetic:true,externalNetwork:'none',productionStateUsed:false,signing:'not-performed',submission:'not-performed',checks:[],executions:[]};
const record=(name,data={})=>{evidence.checks.push({name,...data});console.log(`PASS ${name}`);};
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:40*1024*1024,stdio:['ignore','pipe','pipe']});
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:Object.fromEntries(['StateSequence.sol','ProofContexts.sol'].map(name=>[name,{content:readFileSync(`tests/fixtures/native-geth-publication/${name}`,'utf8')}])),settings:{evmVersion:'osaka',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}})));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=compiled.contracts['StateSequence.sol'].StateSequence,runtime=`0x${artifact.evm.deployedBytecode.object}`;
const contextArtifact=compiled.contracts['ProofContexts.sol'].ProofContexts;
const genesis=JSON.parse(readFileSync('tests/fixtures/native-geth-publication/genesis.json','utf8'));
genesis.alloc[reader.slice(2)]={balance:'0x0',code:runtime};genesis.alloc[delegated.slice(2)]={balance:genesis.alloc[owner.slice(2)].balance,code:`0xef0100${reader.slice(2)}`};
genesis.alloc[contexts.slice(2)]={balance:'0x0',code:`0x${contextArtifact.evm.deployedBytecode.object}`,storage:{[toHex(10000n,{size:32})]:toHex(1n,{size:32}),[toHex(10001n,{size:32})]:toHex(2n,{size:32})}};
genesis.alloc[batchImplementation.slice(2)]={balance:'0x0',code:`0x${compiled.contracts['ProofContexts.sol'].ProofBatch.evm.deployedBytecode.object}`};
genesis.alloc[batchOwner.slice(2)]={balance:genesis.alloc[owner.slice(2)].balance,code:`0xef0100${batchImplementation.slice(2)}`};
writeFileSync(join(tmp,'genesis.json'),JSON.stringify(genesis));
const data=(name,args=[])=>encodeFunctionData({abi:artifact.abi,functionName:name,args});
const calls=Array.from({length:5},(_,i)=>({from:owner,to:reader,data:data('write',[100n]),value:'0x0',gas:toHex(200_000_000n),nonce:toHex(i),gasPrice:'0x30'}));
const contextData=(name,args=[])=>encodeFunctionData({abi:contextArtifact.abi,functionName:name,args});
const payload=(program,validation=true)=>({blockStateCalls:program.map(c=>({calls:[c]})),validation,traceTransfers:false,returnFullTransactions:true});
const allowed=new Set(['web3_clientVersion','eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getProof','eth_getBalance','eth_getTransactionCount','eth_getStorageAt','eth_simulateV1']);
function rpc(method,params=[]){assert.ok(allowed.has(method));writeFileSync(join(tmp,'request.json'),JSON.stringify({jsonrpc:'2.0',id:1,method,params}));const r=JSON.parse(docker('exec',container,'wget','-Y','off','-q','-O','-','--header=Content-Type: application/json','--post-file=/fixture/request.json','http://127.0.0.1:8545'));if(r.error)throw Object.assign(new Error(r.error.message),{code:r.error.code});return r.result;}
let started=false,processCount=0,base,lastNativeDiagnostic='';
const upstream=[];
const stateReader={request:async({method,params})=>{assert.ok(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getProof','eth_getCode'].includes(method),'upstream execution forbidden');upstream.push({method,params});return rpc(method,params);}};
function isolatedRunner(){processCount++;lastNativeDiagnostic='';const childName=`${container}-executor-${processCount}`,child=spawn('docker',['run','--name',childName,'--pull=never','--rm','-i','--network','none','--memory','768m','--cpus','2','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid()}:${process.getgid()}`,'-e','GOMEMLIMIT=512MiB','-e','GOMAXPROCS=2','-v',`${binary}:/executor:ro`,'--entrypoint','/executor',runnerImage],{stdio:['pipe','pipe','pipe']});child.stderr.on('data',chunk=>{lastNativeDiagnostic=(lastNativeDiagnostic+chunk.toString()).slice(-8000);});const kill=child.kill.bind(child);child.kill=signal=>{try{docker('rm','-f',childName);}catch{}return kill(signal);};return child;}
const options=()=>({now:()=>Number(BigInt(base.timestamp))*1000,binaryPath:binary,binarySha256,spawnExecutor:isolatedRunner,stateReader,block:{number:BigInt(base.number),hash:base.hash},onEvidence:e=>evidence.executions.push(e),limits:{gasBudget:500_000_000,requests:5000,witnessBytes:32*1024*1024,responseBytes:128*1024*1024,wallTimeMs:180000}});
try{
 docker('image','inspect',image);docker('image','inspect',runnerImage);
 docker('run','--pull=never','--rm','--network','none','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,image,'--datadir','/fixture/data','--state.scheme','hash','--gcmode','archive','init','/fixture/genesis.json');
 const fixtureBinary=join(build,'keel-proof-fixture');
 const fixtureBlocks=execFileSync('docker',['run','--pull=never','--rm','-i','--network','none','--memory','768m','--cpus','2','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${fixtureBinary}:/fixture-generator:ro`,'--entrypoint','/fixture-generator',runnerImage],{input:readFileSync(join(tmp,'genesis.json')),timeout:60000,maxBuffer:8*1024*1024});
 writeFileSync(join(tmp,'empty-chain.rlp'),fixtureBlocks);
 docker('run','--pull=never','--rm','--network','none','--memory','768m','--cpus','2','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,image,'--datadir','/fixture/data','--state.scheme','hash','--gcmode','archive','--cache','64','import','/fixture/empty-chain.rlp');
 docker('run','--pull=never','-d','--name',container,'--network','none','--memory','768m','--cpus','2','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,image,'--datadir','/fixture/data','--state.scheme','hash','--gcmode','archive','--networkid','31337','--nodiscover','--maxpeers','0','--cache','64','--ipcdisable','--http','--http.addr','127.0.0.1','--http.vhosts','localhost','--http.api','eth,net,web3','--rpc.gascap','500000000','--rpc.evmtimeout','30s','--rpc.http-body-limit','40');started=true;
 for(let n=0;;n++){try{rpc('eth_chainId');break;}catch(e){if(n>=60)throw e;await delay(100);}}
 base=rpc('eth_getBlockByNumber',['0x0',false]);evidence.base=base;evidence.compiler=solc.version();
 const transport=await createProofBackedSimulationTransport(options());
 for(const validation of [false,true]){
  const p=payload(calls,validation),reference=rpc('eth_simulateV1',[p,'0x0']);
  const result=await transport.request({method:'eth_simulateV1',params:[p,'0x0']});
  assert.deepEqual(result,reference,'every result/header/root/hash/receipt/transaction field must match native Geth');
  assert.deepEqual(result.map(b=>b.calls[0].status),Array(5).fill('0x1'));
  assert.ok(result.every(b=>BigInt(b.transactions[0].gas)===200_000_000n));
  record(`full five-call original 200M envelopes match Geth byte-for-byte, validation=${validation}`,{roots:result.map(b=>b.stateRoot),totalGasUsed:result.reduce((s,b)=>s+BigInt(b.calls[0].gasUsed),0n).toString()});
 }
 const big={...calls[0],gas:toHex(170_000_000n),data:data('write',[1300n])},bigPayload=payload([big]);
 const bigResult=await transport.request({method:'eth_simulateV1',params:[bigPayload,'0x0']});assert.deepEqual(bigResult,rpc('eth_simulateV1',[bigPayload,'0x0']));assert.ok(BigInt(bigResult[0].calls[0].maxUsedGas)>140_000_000n);
 record('state-heavy atomic-sized original envelope above 140M matches Geth with real updated root',{gas:bigResult[0].transactions[0].gas,maximumUsedGas:bigResult[0].calls[0].maxUsedGas,stateRoot:bigResult[0].stateRoot});
 const delegatePayload=payload([{...calls[0],from:delegated,to:delegated,gas:toHex(16_000_000n)}]);assert.deepEqual(await transport.request({method:'eth_simulateV1',params:[delegatePayload,'0x0']}),rpc('eth_simulateV1',[delegatePayload,'0x0']));record('existing EIP-7702 delegation matches exact Geth output');
 const compare=async(name,program,check=()=>{})=>{
  const p=payload(program),reference=rpc('eth_simulateV1',[p,'0x0']);
  const result=await transport.request({method:'eth_simulateV1',params:[p,'0x0']});
  assert.deepEqual(result,reference);check(result);record(name,{inputBytes:Buffer.byteLength(JSON.stringify(p)),blocks:program.length});return result;
 };
 const contextCall=(name,args=[],i=0)=>({...calls[0],to:contexts,data:contextData(name,args),nonce:toHex(i)});
 await compare('block context, canonical and simulated BLOCKHASH, CREATE and code/storage continuity match Geth',[
  contextCall('context'),contextCall('create',[],1),contextCall('observeChild',[],2),contextCall('context',[],3),contextCall('createAndDestroy',[],4)
 ],result=>{assert.ok(result.every(b=>b.calls[0].status==='0x1'));assert.equal(result[2].calls[0].returnData,encodeAbiParameters([{type:'uint256'}],[42n]));});
 await compare('canonical storage deletion with complete witness and pre-refund gas match Geth',[contextCall('clear',[true])],result=>{
  assert.equal(result[0].calls[0].status,'0x1');assert.ok(BigInt(result[0].calls[0].maxUsedGas)>BigInt(result[0].calls[0].gasUsed));
 });
 await assert.rejects(transport.request({method:'eth_simulateV1',params:[payload([contextCall('clear',[false])]),'0x0']}));
 assert.match(lastNativeDiagnostic,/incomplete authenticated witness|missing trie node/);record('missing sibling witness rejects deletion without fabricating a state root');
 const wide=Array.from({length:40},(_,i)=>contextCall('accept',[`0x${'ab'.repeat(50000)}`],i));
 assert.ok(Buffer.byteLength(JSON.stringify(payload(wide)))>=3_856_986);
 await compare('40-call saved-program-sized body above 3.85 MB retains every original 200M envelope',wide,result=>assert.ok(result.every(b=>b.calls[0].status==='0x1'&&BigInt(b.transactions[0].gas)===200_000_000n)));
 const plan={planFingerprint:`0x${'aa'.repeat(32)}`,chainId:11155111,blockNumber:0n,reader,readerRuntimeCodeHash:keccak256(runtime),preparationCalls:calls,assertions:calls.map((_,i)=>({callIndex:i,returnData:encodeAbiParameters([{type:'uint256'}],[BigInt((i+1)*100)])})),requiredReaderCalls:[{call:{from:owner,to:reader,data:data('read'),value:'0x0',gas:toHex(1_000_000n)},expectedReturn:encodeAbiParameters([{type:'uint256'}],[500n]),gasMargin:10_000n}],metadataCall:{from:owner,to:reader,data:data('tokenURI',[1n]),value:'0x0',gas:toHex(1_000_000n)},expectedTokenURI,maximumTokenUriBytes:2_000_000,maximumReadGas:1_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:200_000_000n};
 const proof=await simulateKeelPublicationBeforeFunding(plan,transport);assert.equal(proof.schema,'keel-publication-simulation@1');assert.equal(proof.signing,'not-performed');record('unchanged plan completes SDK discovery, strict replay, exact reader and tokenURI checks',{simulationFingerprint:proof.simulationFingerprint});
 const atomic={...calls[0],from:batchOwner,to:batchOwner,data:encodeKeelAtomicWalletBatch(calls.map(({to,data,value})=>({to,data,value})))};
 await compare('unchanged atomic ABI program on synthetic existing delegation matches Geth',[atomic],result=>assert.equal(result[0].calls[0].status,'0x1'));
 const atomicProof=await simulateKeelPublicationBeforeFunding({...plan,transactionContext:'atomic-wallet',preparationCalls:[atomic],assertions:[{callIndex:0,returnData:'0x'}]},transport);
 assert.equal(atomicProof.schema,'keel-publication-simulation@1');record('unchanged synthetic atomic plan completes every SDK phase with explicit nonce and fees');
 for(const [name,call] of [['nonce',{...calls[0],nonce:'0x5'}],['fee',{...calls[0],gasPrice:'0x0'}],['balance',{...calls[0],from:`0x${'33'.repeat(20)}`} ]]){
  await assert.rejects(transport.request({method:'eth_simulateV1',params:[payload([call]),'0x0']}));record(`strict invalid ${name} is rejected`);
 }
 for(const fault of ['account-proof','storage-proof','code','read-outage']){
  let injected=false;
  const brokenReader={request:async input=>{const r=await stateReader.request(input);if(!injected&&((fault==='account-proof'||fault==='read-outage')&&input.method==='eth_getProof'||fault==='storage-proof'&&input.method==='eth_getProof'&&input.params[1].length>0||fault==='code'&&input.method==='eth_getCode')){injected=true;if(fault==='read-outage')throw new Error('SECRET upstream failed');const copy=structuredClone(r);if(fault==='account-proof')copy.accountProof[0]='0xc0';else if(fault==='storage-proof')copy.storageProof[0].value='0x1';else return '0x6000';return copy;}return r;}};
  const broken=await createProofBackedSimulationTransport({...options(),stateReader:brokenReader});await assert.rejects(broken.request({method:'eth_simulateV1',params:[payload([calls[0]]),'0x0']}));assert.equal(injected,true);await broken.close();record(`invalid ${fault} yields no passing execution`);
 }
 const smallBudget=await createProofBackedSimulationTransport({...options(),limits:{...options().limits,gasBudget:50_000_000}});await assert.rejects(smallBudget.request({method:'eth_simulateV1',params:[payload([big]),'0x0']}));await smallBudget.close();record('local resource limits reject original envelopes instead of lowering them');
 await assert.rejects(transport.request({method:'eth_sendRawTransaction',params:['0x']}));
 const before=upstream.length;await assert.rejects(transport.request({method:'eth_simulateV1',params:[{...payload([calls[0]]),stateOverrides:{}},'0x0']}));assert.ok(upstream.slice(before).every(r=>r.method!=='eth_getProof'),'overrides rejected before state acquisition');record('signing and state overrides are refused');
 const controller=new AbortController();controller.abort();await assert.rejects(createProofBackedSimulationTransport({...options(),signal:controller.signal}).then(t=>t.request({method:'eth_simulateV1',params:[payload([calls[0]]),'0x0']})));record('cancelled request cannot start execution');
 // These tests use fresh native processes and synthetic state only; they are not UI recovery receipts.
 const tiny={...calls[0],data:data('write',[1n])},tinyRequest={method:'eth_simulateV1',params:[payload([tiny]),'0x0']};
 const cancelled=new AbortController();let reachedRead,releaseRead;
 const pendingRead=new Promise(resolve=>{reachedRead=resolve;}),blockedRead=new Promise(resolve=>{releaseRead=resolve;});
 let blockedReads=0;
 const inFlight=await createProofBackedSimulationTransport({...options(),signal:cancelled.signal,stateReader:{request:async input=>{
  const result=await stateReader.request(input);if(input.method==='eth_getProof'){blockedReads++;reachedRead();await blockedRead;}return result;
 }}});
 const execution=inFlight.request(tinyRequest),rejected=assert.rejects(execution,/cancelled/);
 await pendingRead;await assert.rejects(inFlight.request(tinyRequest),/already in progress/);cancelled.abort();await rejected;
 const noProofCount=evidence.executions.length;releaseRead();await delay(30);
 assert.equal(blockedReads,1);assert.equal(evidence.executions.length,noProofCount);await inFlight.close();
 assert.equal(docker('ps','-aq','--filter',`name=^/${container}-executor-`).trim(),'');
 record('in-flight cancellation kills the actual isolated process; late reads cannot publish proof');
 const retry=await createProofBackedSimulationTransport(options());assert.deepEqual(await retry.request(tinyRequest),rpc('eth_simulateV1',tinyRequest.params));await retry.close();
 const reload=await createProofBackedSimulationTransport(options());assert.deepEqual(await reload.request(tinyRequest),rpc('eth_simulateV1',tinyRequest.params));await reload.close();
 record('retry and recreated transport start cleanly without persisting simulated writes');
 const original=structuredClone(tinyRequest),mutable=structuredClone(tinyRequest),inProgress=transport.request(mutable);mutable.params[0].blockStateCalls[0].calls[0].data='0x';
 assert.deepEqual(await inProgress,rpc('eth_simulateV1',original.params));record('caller mutation cannot alter the snapshotted native program');
 for(const offset of [181000,-31000]){
  const old=await createProofBackedSimulationTransport({...options(),now:()=>Number(BigInt(base.timestamp))*1000+offset}),before=processCount;
  await assert.rejects(old.request(tinyRequest),/stale or in the future/);assert.equal(processCount,before);await old.close();
 }record('stale and future snapshots fail before native state acquisition');
 let clockReads=0;
 const expires=await createProofBackedSimulationTransport({...options(),now:()=>Number(BigInt(base.timestamp))*1000+(clockReads++?181000:0)});
 const evidenceBefore=evidence.executions.length;await assert.rejects(expires.request(tinyRequest),/stale/);assert.equal(evidence.executions.length,evidenceBefore);await expires.close();record('snapshot expiry during execution cannot emit a successful proof');
 let blockReads=0;
 const reorg=await createProofBackedSimulationTransport({...options(),stateReader:{request:async input=>{
  const result=await stateReader.request(input);return input.method==='eth_getBlockByNumber'&&++blockReads>1?{...result,hash:`0x${'ff'.repeat(32)}`}:result;
 }}});
 await assert.rejects(reorg.request(tinyRequest),error=>error.kind==='chain-reorganized');await reorg.close();record('canonical reorg after execution discards the result');
 const stalled=await createProofBackedSimulationTransport({...options(),limits:{...options().limits,wallTimeMs:30},stateReader:{request:async()=>new Promise(()=>{})}});
 const timedAt=Date.now();await assert.rejects(stalled.request(tinyRequest),/deadline|timed out/);assert.ok(Date.now()-timedAt<2000);await stalled.close();record('deadline includes an unresponsive initial state source');
 for(const [key,value] of [['requests',1],['witnessBytes',1],['responseBytes',1]]){
  const bounded=await createProofBackedSimulationTransport({...options(),limits:{...options().limits,[key]:value}});await assert.rejects(bounded.request(tinyRequest));await bounded.close();record(`${key} quota exhaustion yields no passing execution`);
 }
 for(const status of [403,429]){
  let attempted=0;
  const denied=await createProofBackedSimulationTransport({...options(),stateReader:{request:async input=>{
   if(input.method==='eth_getProof'){attempted++;throw Object.assign(new Error('SECRET provider URL, artwork or credential'),{status});}return stateReader.request(input);
  }}});
  await assert.rejects(denied.request(tinyRequest),error=>error.diagnostic?.httpStatus===status&&!JSON.stringify(error).includes('SECRET')&&!error.message.includes('SECRET'));
  assert.equal(attempted,1);await denied.close();record(`state source HTTP ${status} stops once with sanitized diagnostic and no retry`);
 }
 assert.equal(BigInt(rpc('eth_getStorageAt',[reader,'0x0','0x0'])),0n);assert.equal(BigInt(rpc('eth_getTransactionCount',[owner,'0x0'])),0n);assert.equal(rpc('eth_getBlockByNumber',['0x0',false]).hash,base.hash);await transport.close();
 base=rpc('eth_getBlockByNumber',['0x4',false]);assert.equal(base.number,'0x4');evidence.nonGenesisBase=base;
 const historyCall=contextCall('historical',[1n]),historyRequest={method:'eth_simulateV1',params:[payload([historyCall]),'0x4']};
 const historical=await createProofBackedSimulationTransport(options()),historyStart=upstream.length;
 const historyResult=await historical.request(historyRequest);assert.deepEqual(historyResult,rpc('eth_simulateV1',historyRequest.params));
 assert.equal(historyResult[0].calls[0].returnData,rpc('eth_getBlockByNumber',['0x1',false]).hash);
 const ancestorReads=upstream.slice(historyStart).filter(r=>r.method==='eth_getBlockByHash');assert.ok(ancestorReads.length>=2);
 await historical.close();record('non-genesis canonical ancestor acquisition and historical BLOCKHASH match native Geth',{anchor:base.hash,ancestorReads:ancestorReads.length});
 for(const fault of ['unavailable','wrong-root','wrong-number','wrong-parent']){
  let changed=false;
  const broken=await createProofBackedSimulationTransport({...options(),stateReader:{request:async input=>{
   if(input.method==='eth_getBlockByHash'){
    changed=true;if(fault==='unavailable')throw new Error('synthetic ancestor unavailable');
    const h=await stateReader.request(input);return {...h,...(fault==='wrong-root'?{stateRoot:`0x${'ff'.repeat(32)}`}:fault==='wrong-number'?{number:'0xff'}:{parentHash:`0x${'ff'.repeat(32)}`})};
   }return stateReader.request(input);
  }}});
  const before=evidence.executions.length;await assert.rejects(broken.request(historyRequest));assert.equal(changed,true);assert.equal(evidence.executions.length,before);await broken.close();record(`historical ancestor ${fault} cannot turn missing context into a passing zero hash`);
 }
 assert.ok(upstream.every(r=>!['eth_call','eth_simulateV1','eth_sendRawTransaction'].includes(r.method)));evidence.upstream={requestCount:upstream.length,methods:[...new Set(upstream.map(r=>r.method))]};
 for(const execution of evidence.executions){assert.match(execution.requestSha256,/^[a-f0-9]{64}$/);assert.ok(execution.processPeakRSSBytes>0&&execution.processPeakRSSBytes<=768*1024*1024);assert.ok(execution.processCPUMicroseconds>0);assert.ok(execution.nativeWallTimeMs>=0&&execution.nativeWallTimeMs<=180000);}
 evidence.resources={completedExecutions:evidence.executions.length,peakProcessRSSBytes:Math.max(...evidence.executions.map(e=>e.processPeakRSSBytes)),maximumNativeWallTimeMs:Math.max(...evidence.executions.map(e=>e.nativeWallTimeMs)),maximumReadRequests:Math.max(...evidence.executions.map(e=>e.readRequests)),maximumWitnessBytes:Math.max(...evidence.executions.map(e=>e.witnessBytes))};console.log(`RESOURCES ${JSON.stringify(evidence.resources)}`);
 record('canonical state, nonce and header unchanged; upstream received no execution or calldata',{processCount});
}catch(error){evidence.failure={name:error.name,message:error.message,code:error.code,nativeDiagnostic:lastNativeDiagnostic};process.exitCode=1;console.error(error);if(lastNativeDiagnostic)console.error(lastNativeDiagnostic);}
finally{if(process.env.KEEL_PROOF_EXECUTOR_EVIDENCE)writeFileSync(process.env.KEEL_PROOF_EXECUTOR_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');if(started){try{docker('rm','-f',container);}catch{}}rmSync(tmp,{recursive:true,force:true});}
