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
import { simulateKeelPublicationBeforeFunding } from '../packages/sdk/dist/publication-preflight.js';
const image='ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd';
const runnerImage='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3';
const build=process.env.KEEL_NATIVE_BUILD_DIR??'/tmp/keel-proof-executor-build';
const binary=join(build,'keel-proof-executor'),binarySha256=createHash('sha256').update(readFileSync(binary)).digest('hex');
const receipt=JSON.parse(readFileSync(join(build,'receipt.json'),'utf8'));assert.equal(receipt.binarySha256,binarySha256);
const tmp=mkdtempSync(join(tmpdir(),'keel-proof-state-')),container=`keel-proof-state-${process.pid}`;
const owner=`0x${'11'.repeat(20)}`,reader=`0x${'22'.repeat(20)}`,delegated=`0x${'44'.repeat(20)}`;
const expectedTokenURI='data:application/json,{"name":"Synthetic state sequence"}';
const evidence={schema:'keel-proof-executor-differential@1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),receipt,synthetic:true,externalNetwork:'none',productionStateUsed:false,signing:'not-performed',submission:'not-performed',checks:[],executions:[]};
const record=(name,data={})=>{evidence.checks.push({name,...data});console.log(`PASS ${name}`);};
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:40*1024*1024,stdio:['ignore','pipe','pipe']});
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'StateSequence.sol':{content:readFileSync('tests/fixtures/native-geth-publication/StateSequence.sol','utf8')}},settings:{evmVersion:'osaka',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}})));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=compiled.contracts['StateSequence.sol'].StateSequence,runtime=`0x${artifact.evm.deployedBytecode.object}`;
const genesis=JSON.parse(readFileSync('tests/fixtures/native-geth-publication/genesis.json','utf8'));
genesis.alloc[reader.slice(2)]={balance:'0x0',code:runtime};genesis.alloc[delegated.slice(2)]={balance:genesis.alloc[owner.slice(2)].balance,code:`0xef0100${reader.slice(2)}`};
writeFileSync(join(tmp,'genesis.json'),JSON.stringify(genesis));
const data=(name,args=[])=>encodeFunctionData({abi:artifact.abi,functionName:name,args});
const calls=Array.from({length:5},(_,i)=>({from:owner,to:reader,data:data('write',[100n]),value:'0x0',gas:toHex(200_000_000n),nonce:toHex(i),gasPrice:'0x30'}));
const payload=(program,validation=true)=>({blockStateCalls:program.map(c=>({calls:[c]})),validation,traceTransfers:false,returnFullTransactions:true});
const allowed=new Set(['web3_clientVersion','eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode','eth_getProof','eth_getBalance','eth_getTransactionCount','eth_getStorageAt','eth_simulateV1']);
function rpc(method,params=[]){assert.ok(allowed.has(method));writeFileSync(join(tmp,'request.json'),JSON.stringify({jsonrpc:'2.0',id:1,method,params}));const r=JSON.parse(docker('exec',container,'wget','-Y','off','-q','-O','-','--header=Content-Type: application/json','--post-file=/fixture/request.json','http://127.0.0.1:8545'));if(r.error)throw Object.assign(new Error(r.error.message),{code:r.error.code});return r.result;}
let started=false,processCount=0,base,lastNativeDiagnostic='';
const upstream=[];
const stateReader={request:async({method,params})=>{assert.ok(['eth_chainId','eth_getBlockByNumber','eth_getBlockByHash','eth_getProof','eth_getCode'].includes(method),'upstream execution forbidden');upstream.push({method,params});return rpc(method,params);}};
function isolatedRunner(){processCount++;lastNativeDiagnostic='';const child=spawn('docker',['run','--pull=never','--rm','-i','--network','none','--memory','768m','--cpus','2','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${process.getuid()}:${process.getgid()}`,'-e','GOMEMLIMIT=512MiB','-e','GOMAXPROCS=2','-v',`${binary}:/executor:ro`,'--entrypoint','/executor',runnerImage],{stdio:['pipe','pipe','pipe']});child.stderr.on('data',chunk=>{lastNativeDiagnostic=(lastNativeDiagnostic+chunk.toString()).slice(-8000);});return child;}
const options=()=>({binaryPath:binary,binarySha256,spawnExecutor:isolatedRunner,stateReader,block:{number:0n,hash:base.hash},onEvidence:e=>evidence.executions.push(e),limits:{gasBudget:500_000_000,requests:5000,witnessBytes:32*1024*1024,responseBytes:128*1024*1024,wallTimeMs:180000}});
try{
 docker('image','inspect',image);docker('image','inspect',runnerImage);
 docker('run','--pull=never','--rm','--network','none','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,image,'--datadir','/fixture/data','init','/fixture/genesis.json');
 docker('run','--pull=never','-d','--name',container,'--network','none','--memory','768m','--cpus','2','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,image,'--datadir','/fixture/data','--networkid','31337','--nodiscover','--maxpeers','0','--cache','64','--ipcdisable','--http','--http.addr','127.0.0.1','--http.vhosts','localhost','--http.api','eth,net,web3','--rpc.gascap','500000000','--rpc.evmtimeout','30s','--rpc.http-body-limit','40');started=true;
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
 const plan={planFingerprint:`0x${'aa'.repeat(32)}`,chainId:11155111,blockNumber:0n,reader,readerRuntimeCodeHash:keccak256(runtime),preparationCalls:calls,assertions:calls.map((_,i)=>({callIndex:i,returnData:encodeAbiParameters([{type:'uint256'}],[BigInt((i+1)*100)])})),requiredReaderCalls:[{call:{from:owner,to:reader,data:data('read'),value:'0x0',gas:toHex(1_000_000n)},expectedReturn:encodeAbiParameters([{type:'uint256'}],[500n]),gasMargin:10_000n}],metadataCall:{from:owner,to:reader,data:data('tokenURI',[1n]),value:'0x0',gas:toHex(1_000_000n)},expectedTokenURI,maximumTokenUriBytes:2_000_000,maximumReadGas:1_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:200_000_000n};
 const proof=await simulateKeelPublicationBeforeFunding(plan,transport);assert.equal(proof.schema,'keel-publication-simulation@1');assert.equal(proof.signing,'not-performed');record('unchanged plan completes SDK discovery, strict replay, exact reader and tokenURI checks',{simulationFingerprint:proof.simulationFingerprint});
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
 assert.equal(BigInt(rpc('eth_getStorageAt',[reader,'0x0','0x0'])),0n);assert.equal(BigInt(rpc('eth_getTransactionCount',[owner,'0x0'])),0n);assert.equal(rpc('eth_getBlockByNumber',['0x0',false]).hash,base.hash);await transport.close();
 assert.ok(upstream.every(r=>!['eth_call','eth_simulateV1','eth_sendRawTransaction'].includes(r.method)));evidence.upstream={requestCount:upstream.length,methods:[...new Set(upstream.map(r=>r.method))]};
 record('canonical state, nonce and header unchanged; upstream received no execution or calldata',{processCount});
}catch(error){evidence.failure={name:error.name,message:error.message,code:error.code,nativeDiagnostic:lastNativeDiagnostic};process.exitCode=1;console.error(error);if(lastNativeDiagnostic)console.error(lastNativeDiagnostic);}
finally{if(process.env.KEEL_PROOF_EXECUTOR_EVIDENCE)writeFileSync(process.env.KEEL_PROOF_EXECUTOR_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');if(started){try{docker('rm','-f',container);}catch{}}rmSync(tmp,{recursive:true,force:true});}
