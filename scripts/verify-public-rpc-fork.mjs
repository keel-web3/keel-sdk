/** Differential local-fork investigation, never a publication proof or production backend.
 * All upstream state is synthetic. Three containers share an isolated network namespace.
 * The upstream proxy denies call/simulation/submission so private execution cannot escape.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import solc from 'solc';
import { encodeFunctionData, encodeAbiParameters, keccak256, toHex } from 'viem';
import { simulateKeelPublicationBeforeFunding } from '../packages/sdk/dist/publication-preflight.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const images={geth:'ethereum/client-go@sha256:abf3605177f8bdcfce436985a8054cca4ae59256323a4ffb72c56c04f3d1fadd',anvil:'ghcr.io/foundry-rs/foundry@sha256:32c8ea9ef052a440cb1620175987a3f49eff8b068a0c6a3d09ebf7f5f9a0e043',proxy:'node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3'};
const tmp=mkdtempSync(join(tmpdir(),'keel-rpc-fork-')),base=`keel-fork-${process.pid}`,names=[];
const owner=`0x${'11'.repeat(20)}`,target=`0x${'22'.repeat(20)}`,delegated=`0x${'44'.repeat(20)}`;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
const evidence={schema:'keel-public-rpc-fork-investigation@1',images,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),synthetic:true,productionStateUsed:false,externalNetwork:'none',signing:'not-performed',submission:'not-performed',checks:[]};
const record=(name,details={})=>{evidence.checks.push({name,...details});console.log(`PASS ${name}`);};
const compile=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'StateSequence.sol':{content:readFileSync(join(root,'tests/fixtures/native-geth-publication/StateSequence.sol'),'utf8')},'ForkSequence.sol':{content:readFileSync(join(root,'tests/fixtures/public-rpc-fork/ForkSequence.sol'),'utf8')}},settings:{evmVersion:'osaka',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}})));
assert.deepEqual((compile.errors??[]).filter(e=>e.severity==='error'),[]);
const artifact=compile.contracts['ForkSequence.sol'].ForkSequence;
const genesis=JSON.parse(readFileSync(join(root,'tests/fixtures/native-geth-publication/genesis.json'),'utf8'));
genesis.alloc[target.slice(2)]={balance:'0x0',code:`0x${artifact.evm.deployedBytecode.object}`};
genesis.alloc[delegated.slice(2)]={balance:genesis.alloc[owner.slice(2)].balance,code:`0xef0100${target.slice(2)}`};
writeFileSync(join(tmp,'genesis.json'),JSON.stringify(genesis));
writeFileSync(join(tmp,'proxy.mjs'),`import http from 'node:http';import {appendFileSync} from 'node:fs';
const allowed=new Set(['eth_chainId','net_version','web3_clientVersion','eth_blockNumber','eth_gasPrice','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getTransactionCount','eth_getCode','eth_getStorageAt','eth_getProof','eth_getAccountInfo']);
http.createServer(async(req,res)=>{let body='';for await(const c of req){body+=c;if(body.length>1048576){res.writeHead(413).end();return;}}
try{const parsed=JSON.parse(body),items=Array.isArray(parsed)?parsed:[parsed];
for(const item of items)appendFileSync('/fixture/upstream.jsonl',JSON.stringify({method:item.method,params:item.params,allowed:allowed.has(item.method)})+'\\n');
if(items.some(item=>!allowed.has(item.method))){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:parsed.id,error:{code:-32601,message:'Only upstream state acquisition is allowed'}}));return;}
const response=await fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},body});res.setHeader('Content-Type','application/json');res.end(await response.text());
}catch{res.writeHead(500).end();}}).listen(8546,'127.0.0.1');`);
const allowedLocal=new Set(['eth_chainId','web3_clientVersion','eth_getBlockByNumber','eth_getBalance','eth_getTransactionCount','eth_getStorageAt','eth_getCode','eth_call','eth_simulateV1','eth_accounts']);
function rpc(port,method,params=[]){assert.ok(allowedLocal.has(method));writeFileSync(join(tmp,'request.json'),JSON.stringify({jsonrpc:'2.0',id:1,method,params}));const r=JSON.parse(docker('exec',base,'wget','-Y','off','-q','-O','-','--header=Content-Type: application/json','--post-file=/fixture/request.json',`http://127.0.0.1:${port}`));if(r.error)throw Object.assign(new Error(r.error.message),{code:r.error.code});return r.result;}
const run=(name,image,args,entrypoint)=>{names.push(name);docker('run','--pull=never','-d','--name',name,'--network',name===base?'none':`container:${base}`,'--user',`${process.getuid()}:${process.getgid()}`,'--memory','768m','--cpus','2','-v',`${tmp}:/fixture`,...(entrypoint?['--entrypoint',entrypoint]:[]),image,...args);};
const ready=async port=>{for(let i=0;;i++){try{rpc(port,'eth_chainId');return;}catch(e){if(i>=100)throw e;await delay(100);}}};
const data=(functionName,args=[])=>encodeFunctionData({abi:artifact.abi,functionName,args});
const calls=Array.from({length:5},(_,i)=>({from:owner,to:target,data:data('write',[100n]),value:'0x0',gas:toHex(16_000_000n),nonce:toHex(i),gasPrice:'0x30'}));
const simulate=(port,program,validation=true)=>rpc(port,'eth_simulateV1',[{blockStateCalls:program.map(call=>({calls:[call]})),validation,traceTransfers:false,returnFullTransactions:true},'0x0']);
const summary=blocks=>blocks.map(b=>({number:b.number,parentHash:b.parentHash,hash:b.hash,stateRoot:b.stateRoot,blockAccessListHash:b.blockAccessListHash,gasLimit:b.gasLimit,gas:b.transactions[0]?.gas,status:b.calls[0]?.status,gasUsed:b.calls[0]?.gasUsed,maxUsedGas:b.calls[0]?.maxUsedGas,returnData:b.calls[0]?.returnData,errorCode:b.calls[0]?.error?.code}));
try{
for(const image of Object.values(images))docker('image','inspect',image);
docker('run','--pull=never','--rm','--network','none','--user',`${process.getuid()}:${process.getgid()}`,'-v',`${tmp}:/fixture`,images.geth,'--datadir','/fixture/data','init','/fixture/genesis.json');
run(base,images.geth,['--datadir','/fixture/data','--networkid','31337','--syncmode','full','--nodiscover','--maxpeers','0','--cache','64','--ipcdisable','--http','--http.addr','127.0.0.1','--http.vhosts','localhost','--http.api','eth,net,web3','--rpc.gascap','500000000','--rpc.evmtimeout','30s']);await ready(8545);
run(`${base}-proxy`,images.proxy,['/fixture/proxy.mjs'],'node');await ready(8546);
run(`${base}-anvil`,images.anvil,['--host','127.0.0.1','--port','8547','--fork-url','http://127.0.0.1:8546','--fork-block-number','0','--no-fork-node-info','--no-bal','--no-storage-caching','--retries','0','--timeout','5000','--accounts','0','--no-mining','--hardfork','amsterdam','--enable-tx-gas-limit'],'anvil');await ready(8547);
evidence.clients={geth:rpc(8545,'web3_clientVersion'),anvil:rpc(8547,'web3_clientVersion')};
assert.deepEqual(rpc(8547,'eth_accounts'),[]);
for(const method of ['eth_getBalance','eth_getTransactionCount'])assert.equal(rpc(8547,method,[owner,'0x0']),rpc(8545,method,[owner,'0x0']));
assert.equal(rpc(8547,'eth_getBlockByNumber',['0x0',false]).hash,rpc(8545,'eth_getBlockByNumber',['0x0',false]).hash);
record('fork retains pinned synthetic header, owner balance and nonce without dev-account prefunding');
for(const validation of [false,true]){
const geth=simulate(8545,calls.slice(0,2),validation),anvil=simulate(8547,calls.slice(0,2),validation);
evidence.checks.push({name:`two-call differential validation=${validation}`,geth:summary(geth),anvil:summary(anvil)});
assert.deepEqual(anvil.map(b=>b.calls[0].status),['0x1','0x1']);
assert.deepEqual(anvil.map(b=>b.calls[0].returnData),geth.map(b=>b.calls[0].returnData));
assert.deepEqual(anvil.map(b=>[b.calls[0].gasUsed,b.calls[0].maxUsedGas]),geth.map(b=>[b.calls[0].gasUsed,b.calls[0].maxUsedGas]));
assert.ok(anvil.every(b=>b.stateRoot===`0x${'00'.repeat(32)}`),'stock Anvil sparse fork exposes zero state roots');
record(`local fork carries state and agrees on gas across two calls validation=${validation}`);
}
const delegateCall={...calls[0],from:delegated,to:delegated};
const delegateGeth=simulate(8545,[delegateCall]),delegateAnvil=simulate(8547,[delegateCall]);
assert.equal(delegateAnvil[0].calls[0].status,'0x1');
assert.deepEqual(delegateAnvil[0].calls[0],delegateGeth[0].calls[0]);
record('existing EIP-7702 delegation executes locally with matching gas and results',{geth:summary(delegateGeth),anvil:summary(delegateAnvil)});
const refundCalls=[calls[0],{...calls[1],data:data('clear',[100n])}];
const refundsGeth=simulate(8545,refundCalls),refundsAnvil=simulate(8547,refundCalls);
for(let i=0;i<2;i++)assert.deepEqual([refundsAnvil[i].calls[0].gasUsed,refundsAnvil[i].calls[0].maxUsedGas],[refundsGeth[i].calls[0].gasUsed,refundsGeth[i].calls[0].maxUsedGas]);
assert.ok(BigInt(refundsAnvil[1].calls[0].maxUsedGas)>BigInt(refundsAnvil[1].calls[0].gasUsed));
record('pre-refund maximum remains distinct from refunded gas on both engines',{geth:summary(refundsGeth),anvil:summary(refundsAnvil)});
const geth=simulate(8545,calls),anvil=simulate(8547,calls);
assert.deepEqual(geth.map(b=>b.calls[0].status),Array(5).fill('0x1'));
assert.deepEqual(anvil.map(b=>b.calls[0].status),['0x1','0x1','0x1','0x1','0x0']);
assert.ok(BigInt(anvil[4].transactions[0].gas)<16_000_000n);
record('original five-call program measured on both engines',{geth:summary(geth),anvil:summary(anvil)});
const blank={from:owner,to:owner,data:'0x',value:'0x0',gas:toHex(200_000_000n),nonce:'0x0',gasPrice:'0x30'};
const broadGeth=simulate(8545,[blank]),broadAnvil=simulate(8547,[blank]);
assert.equal(BigInt(broadAnvil[0].transactions[0].gas),50_000_000n);
assert.equal(BigInt(broadGeth[0].transactions[0].gas),200_000_000n);
record('blanket 200M probe measured on both engines',{geth:summary(broadGeth),anvil:summary(broadAnvil)});
const budgetCalls=[0,1].map(i=>({...blank,gas:toHex(50_000_000n),nonce:toHex(i)}));
const sharedBudget=simulate(8547,budgetCalls);
assert.deepEqual(sharedBudget.map(b=>BigInt(b.transactions[0].gas)),[50_000_000n,49_988_000n]);
assert.deepEqual(sharedBudget.map(b=>BigInt(b.calls[0].gasUsed)),[12_000n,12_000n]);
record('operator shared-budget and 12000-base-gas observations reproduced locally',{anvil:summary(sharedBudget)});
const big={...calls[0],gas:toHex(170_000_000n),data:data('write',[1300n])};
const bigGeth=simulate(8545,[big]),bigAnvil=simulate(8547,[big]);
assert.equal(bigGeth[0].calls[0].status,'0x1');assert.ok(BigInt(bigGeth[0].calls[0].maxUsedGas)>140_000_000n);
assert.equal(bigAnvil[0].calls[0].status,'0x0');assert.equal(BigInt(bigAnvil[0].transactions[0].gas),50_000_000n);
record('one legal state-heavy 170M transaction cannot fit the stock Anvil budget',{geth:summary(bigGeth),anvil:summary(bigAnvil)});
for(const [name,call] of [['nonce-too-high',{...calls[0],nonce:'0x5'}],['fee-below-base',{...calls[0],gasPrice:'0x0'}],['insufficient-balance',{...calls[0],from:`0x${'33'.repeat(20)}`} ]]){
let result;try{result={returned:summary(simulate(8547,[call]))};}catch(e){result={rpcCode:e.code,message:e.message};}assert.ok(result.rpcCode<0,'strict failures must not return successful evidence');record(`strict ${name}`,result);
}
const sensitive={...blank,to:target,data:data('gasSensitive',[8_000_000n])};
const broadSensitive=simulate(8545,[sensitive]),narrowSensitive=simulate(8545,[{...sensitive,gas:toHex(5_000_000n)}]);
assert.equal(BigInt(broadSensitive[0].calls[0].returnData),1n);assert.equal(BigInt(narrowSensitive[0].calls[0].returnData),2n);
record('lowering a discovery ceiling can change contract state and return data',{original:summary(broadSensitive),lowered:summary(narrowSensitive)});
const expectedTokenURI='data:application/json,{"name":"Synthetic bounded sequence"}';
const smallPlan={chainId:11155111,blockNumber:0n,planFingerprint:`0x${'aa'.repeat(32)}`,reader:target,readerRuntimeCodeHash:keccak256(`0x${artifact.evm.deployedBytecode.object}`),preparationCalls:calls.slice(0,2),
assertions:[0,1].map(i=>({callIndex:i,returnData:encodeAbiParameters([{type:'uint256'}],[BigInt((i+1)*100)])})),metadataCall:{from:owner,to:target,data:data('tokenURIFor',[200n]),value:'0x0',gas:toHex(1_000_000n)},expectedTokenURI,maximumTokenUriBytes:2000000,maximumReadGas:1_000_000n,maximumTransactionGas:200_000_000n,collectionOverheadGas:10_000n};
const localTransport={request:async ({method,params})=>rpc(8547,method,params)};
await assert.rejects(simulateKeelPublicationBeforeFunding({...smallPlan,preparationCalls:smallPlan.preparationCalls.map(c=>({...c,gas:toHex(200_000_000n)}))},localTransport),e=>e.kind==='provider-limit');
const boundedProof=await simulateKeelPublicationBeforeFunding(smallPlan,localTransport);
record('blanket 200M discovery rejects a smaller program whose separately bounded 16M plan completes all SDK phases',{boundedSimulationFingerprint:boundedProof.simulationFingerprint,warning:'Different input gas ceilings; NOT proof of the original 200M envelopes. Stock sparse-fork zero-root limitation remains.'});
for(const port of [8545,8547])assert.equal(BigInt(rpc(port,'eth_getStorageAt',[target,'0x0','0x0'])),0n);
const upstream=readFileSync(join(tmp,'upstream.jsonl'),'utf8').trim().split('\n').map(JSON.parse);evidence.upstream={requests:upstream.length,methods:[...new Set(upstream.map(r=>r.method))],denied:upstream.filter(r=>!r.allowed),reads:upstream};
assert.deepEqual(evidence.upstream.denied,[],'private execution must never be forwarded upstream');
const pinnedHash=rpc(8545,'eth_getBlockByNumber',['0x0',false]).hash;
for(const read of upstream.filter(r=>['eth_getAccountInfo','eth_getBalance','eth_getCode','eth_getTransactionCount','eth_getStorageAt'].includes(r.method)))assert.deepEqual(read.params.at(-1),{blockHash:pinnedHash},'all lazy state reads stay pinned to the same block hash');
assert.ok(upstream.every(r=>!JSON.stringify(r.params??[]).includes(calls[0].data.slice(2))));
record('no private execution forwarded; both canonical and local pinned storage remain unchanged');
}catch(error){evidence.failure={message:error.message,code:error.code};for(const name of names){try{evidence[`${name}-log`]=docker('logs','--tail','12',name);}catch{}}process.exitCode=1;console.error(error.message);}
finally{if(process.env.KEEL_FORK_EVIDENCE)writeFileSync(process.env.KEEL_FORK_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');for(const name of names.reverse()){try{docker('rm','-f',name);}catch{}}rmSync(tmp,{recursive:true,force:true});}
