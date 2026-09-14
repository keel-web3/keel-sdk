/** Required shared runtime object only. Review-only unless explicitly enabled.
 * Explicit reviewed fee caps; signed attempts persist before broadcast. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {brotliCompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createPublicClient,http,parseAbi,sha256,keccak256,toHex,encodeFunctionData,formatEther,parseTransaction} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {keelHoldAbi} from '@keel/sdk/abi';
import {createKeelManagedObjectPlan,readKeelManagedObject} from '@keel/sdk/native-publication';
import {buildKeelInlineModuleFragment,buildKeelInlineShellFragments,buildKeelInlineLocalDocument,buildKeelWeb3TokenJSONGraph,buildKeelInlineImageURI} from '@keel/sdk/inline-viewer-graph';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
const execute=process.env.KEEL_GATOR_RUNTIME_EXECUTE==='1';
const sourceOnly=process.env.KEEL_GATOR_RUNTIME_SOURCE==='1';
const root='apps/desktop/artifacts/gator-inline-sepolia/'+(sourceOnly?'runtime-source-publication':'runtime-publication');await mkdir(root,{recursive:true});
const chainId=11155111,hold='0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267',signer='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
// Latest creator instruction supersedes the earlier 1.5-gwei replacement.
const bump=true;
const cap=1_100_000_000n,tip=140_000_000n,budget=10_000_000_000_000_000n;
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const runtime=await readFile(LAYERED_RUNTIME.localPath);assert.equal(sha256(runtime),LAYERED_RUNTIME.integrity.digest);
const source='apps/desktop/artifacts/gator-inline-sepolia/3750-shared-prepared';
const graph=await json(source+'/json-graph.json'),modulePart=graph.parts.find(p=>p.role==='module');
const fragmentBytes=await readFile(modulePart.path);assert.equal(sha256(fragmentBytes),modulePart.integrity.digest);
const bytes=sourceOnly?runtime:fragmentBytes;
const mediaType=sourceOnly?'text/javascript':'text/plain';
const mcpProof=await json(source+'/mcp-prepare.json');assert.equal(mcpProof.result.structuredContent.web3Metadata.parts.find(p=>p.role==='module').integrity.digest,sha256(fragmentBytes));
const variants=[];
for(const compression of ['none','gzip']){
 const module=await buildKeelInlineModuleFragment({moduleId:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,mediaType:'text/javascript',aliases:[LAYERED_RUNTIME.id],decodedBytes:runtime,execution:'classic',phase:'runtime',weight:0,compression});
 const document=await buildKeelInlineLocalDocument({shell:await buildKeelInlineShellFragments(),modules:[module],entry:{id:'entry',mediaType:'text/html',source:Buffer.from('<p>Runtime publication check</p>')}});
 const prepared=await buildKeelWeb3TokenJSONGraph({document,metadata:{},imageURI:buildKeelInlineImageURI(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/svg+xml'),tokenId:'0'});
 const part=prepared.parts.find(p=>p.role==='module');if(compression==='gzip')assert.deepEqual(Buffer.from(part.bytes),fragmentBytes);
 variants.push({compression,preparedSlotBytes:part.bytes.length,codeDepositGas:String(part.bytes.length*200)});
}
assert.ok(variants[1].preparedSlotBytes<variants[0].preparedSlotBytes);
const mcp=await createMcpServer({workspaceRoot:process.cwd()});await mcp.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-runtime-publish',version:'1'}}});
const response=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'upload-plan',arguments:{input:sourceOnly?LAYERED_RUNTIME.localPath:modulePart.path,objectName:'keel-layered-runtime-v4-4.0.1'+(sourceOnly?'-source':'-web3'),mediaType,compression:sourceOnly?'gzip':'none'}}});assert.ok(!response.result.isError,JSON.stringify(response));assert.equal(response.result.structuredContent.plan.integrity.digest,sha256(bytes));await writeFile(root+'/mcp-upload-plan.json',JSON.stringify(response,null,2));
const c=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:20000,retryCount:0}),pollingInterval:2000}),abi=parseAbi(keelHoldAbi);
assert.equal(await c.getChainId(),chainId);
assert.equal(await c.getCode({address:hold}),(await json('apps/desktop/artifacts/gator-sepolia/sepolia-hold-build.json')).deployedBytecode.object);
const plan=await createKeelManagedObjectPlan(bytes,{hold,mediaType,compression:sourceOnly?'auto':'none'});
const ops=[];
for(const chunk of plan.chunks){
 const pointer=await c.readContract({address:hold,abi,functionName:'slugPointer',args:[chunk.id]});
 if(pointer!=='0x'+'0'.repeat(40)){assert.equal(await c.getCode({address:pointer}),'0x00'+Buffer.from(chunk.bytes).toString('hex'));continue;}
 ops.push({label:'cast:'+chunk.id,data:encodeFunctionData({abi,functionName:'castSlugs',args:[[toHex(chunk.bytes)]]})});
}
const exists=await c.readContract({address:hold,abi,functionName:'objectExists',args:[plan.objectId]});
if(!exists)for(const operation of plan.operations)ops.push({label:'object:'+plan.objectId,data:operation.data});
const [balance,block]=await Promise.all([c.getBalance({address:signer}),c.getBlock()]);
const firstGas=ops.length?await c.estimateGas({account:signer,to:hold,data:ops[0].data}):0n;
const review={checkedAt:new Date().toISOString(),chainId,hold,signer,module:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,sourceDigest:sha256(runtime),preparedDigest:sha256(bytes),preparedBytes:bytes.length,objectId:plan.objectId,remainingOperations:ops.length,firstOperationGas:String(firstGas),firstOperationMaximumETH:formatEther(((firstGas*110n+99n)/100n)*cap),feeCapWei:String(cap),budgetETH:formatEther(budget),balanceETH:formatEther(balance),baseFeeGwei:Number(block.baseFeePerGas)/1e9,variants,brotli:{measuredSourceBytes:brotliCompressSync(runtime).length,eligible:false,reason:'No verified selected-chain decoder binding'},compression:'Gzip inside the canonical module slot; direct-copy storage stays uncompressed',published:false,registryBindingVerified:false};
await writeFile(root+'/plan.json',JSON.stringify(review,null,2));console.log(JSON.stringify({phase:'plan',...review}));if(!execute)process.exit(0);
const path=root+'/journal.json';let journal;try{journal=await json(path);}catch(error){if(error.code!=='ENOENT')throw error;journal={schema:'gator-runtime-publication@1',chainId,hold,signer,digest:sha256(bytes),objectId:plan.objectId,steps:{}};}
assert.equal(journal.digest,sha256(bytes));assert.equal(journal.chainId,chainId);assert.equal(journal.hold,hold);assert.equal(journal.signer,signer);
const save=async()=>{await writeFile(path+'.tmp',JSON.stringify(journal,null,2),{mode:0o600});await rename(path+'.tmp',path);};
let account;try{const env=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8');const value=env.match(/^\s*(?:export\s+)?KEEL_DEPLOYER_PK\s*=\s*['"]?(0x[0-9a-fA-F]{64})['"]?\s*$/m)?.[1];account=privateKeyToAccount(value);}catch{throw Error('Unable to load the configured KEEL signer');}assert.equal(account.address,signer);
// Reconcile every signed intent before deciding whether current state can skip it.
for(const step of Object.values(journal.steps)){if(step.receipt)continue;const r=await c.getTransactionReceipt({hash:step.hash}).catch(()=>null);if(r){step.receipt={status:r.status,blockNumber:String(r.blockNumber),gasUsed:String(r.gasUsed),feeWei:String(r.gasUsed*r.effectiveGasPrice)};await save();assert.equal(r.status,'success');}}
for(const operation of ops){
 let step=journal.steps[operation.label];
 if(step?.receipt){assert.equal(step.receipt.status,'success');continue;}
 if(!step){
  assert.ok(Object.values(journal.steps).every(s=>s.receipt),'Resolve the previous signed runtime transaction first');
  assert.equal(await c.getChainId(),chainId);const nonce=await c.getTransactionCount({address:signer});assert.equal(nonce,await c.getTransactionCount({address:signer,blockTag:'pending'}),'Another wallet transaction is pending');
  const estimate=await c.estimateGas({account:signer,to:hold,data:operation.data}),gas=(estimate*110n+99n)/100n;assert.ok(gas<=8_000_000n);
  const spent=Object.values(journal.steps).reduce((n,s)=>n+BigInt(s.receipt?.feeWei??0),0n);assert.ok(spent+gas*cap<=budget);assert.ok(await c.getBalance({address:signer})>=gas*cap);
  const raw=await account.signTransaction({type:'eip1559',chainId,nonce,to:hold,data:operation.data,value:0n,gas,maxFeePerGas:cap,maxPriorityFeePerGas:tip});
  step={hash:keccak256(raw),raw,nonce,to:hold,dataDigest:keccak256(operation.data),feeCapWei:String(cap),gas:String(gas),signedAt:new Date().toISOString()};journal.steps[operation.label]=step;await save();
 }
 assert.equal(step.dataDigest,keccak256(operation.data));
 if(bump&&BigInt(step.feeCapWei)<cap){
  const previous=parseTransaction(step.raw);assert.equal(previous.chainId,chainId);assert.equal(previous.to.toLowerCase(),hold);assert.equal(previous.value??0n,0n);assert.equal(previous.nonce,step.nonce);assert.equal(keccak256(previous.data),step.dataDigest);
  const confirmed=await c.getTransactionCount({address:signer});assert.equal(confirmed,step.nonce,'Nonce changed; reconcile the original receipt before replacing');
  assert.ok(cap>=previous.maxFeePerGas*110n/100n&&tip>=previous.maxPriorityFeePerGas*110n/100n);
  assert.ok(previous.gas*cap<=budget);assert.ok(await c.getBalance({address:signer})>=previous.gas*cap);
  const raw=await account.signTransaction({type:'eip1559',chainId,nonce:previous.nonce,to:hold,data:previous.data,value:0n,gas:previous.gas,maxFeePerGas:cap,maxPriorityFeePerGas:tip});
  const replacements=[...(step.replacements??[]),{hash:step.hash,raw:step.raw,feeCapWei:step.feeCapWei}];
  step={...step,hash:keccak256(raw),raw,feeCapWei:String(cap),replacements,signedAt:new Date().toISOString()};journal.steps[operation.label]=step;await save();
 }
 assert.equal(step.feeCapWei,String(cap));
 try{const hash=await c.sendRawTransaction({serializedTransaction:step.raw});assert.equal(hash,step.hash);step.acceptedByRPC=true;}
 catch(error){step.acceptedByRPC=false;step.rpcErrors=[];let cause=error;for(let i=0;cause&&i<6;i++,cause=cause.cause)step.rpcErrors.push(String(cause.details??cause.shortMessage??cause.message).replace(/0x[0-9a-fA-F]{130,}/g,'[transaction bytes omitted]').slice(0,400));await save();console.log(JSON.stringify({phase:'rpc-response',hash:step.hash,errors:step.rpcErrors}));}
 await save();console.log(JSON.stringify({phase:'submitted-attempt',hash:step.hash,acceptedByRPC:step.acceptedByRPC,maxFeeGwei:Number(cap)/1e9}));
 let r;try{r=await c.waitForTransactionReceipt({hash:step.hash,timeout:45000,confirmations:1});}catch{const tx=await c.getTransaction({hash:step.hash}).catch(()=>null);journal.status=tx?'pending':'not-confirmed';await save();console.log(JSON.stringify({phase:journal.status,hash:step.hash,acceptedByRPC:step.acceptedByRPC,feeCapGwei:Number(cap)/1e9}));process.exit(2);}
 step.receipt={status:r.status,blockNumber:String(r.blockNumber),gasUsed:String(r.gasUsed),feeWei:String(r.gasUsed*r.effectiveGasPrice)};await save();assert.equal(r.status,'success');console.log(JSON.stringify({phase:'confirmed',hash:step.hash,gasUsed:String(r.gasUsed)}));
}
const object=await c.readContract({address:hold,abi,functionName:'getObject',args:[plan.objectId]});assert.ok(object.exists);assert.equal(object.digest,sha256(bytes));assert.equal(Number(object.byteLength),bytes.length);
const onchain=await readKeelManagedObject(plan.objectId,{
 record:async id=>{const r=await c.readContract({address:hold,abi,functionName:'getObject',args:[id]});return {...r,chunkCount:Number(r.chunkCount)};},
 parts:(id,count)=>c.readContract({address:hold,abi,functionName:'getObjectPartIds',args:[id,0n,BigInt(count)]}),
 slug:(id,index)=>c.readContract({address:hold,abi,functionName:'readSlug',args:[id,BigInt(index)]}),
});assert.deepEqual(Buffer.from(onchain),bytes);
journal.status='object-verified';journal.exactReadback=true;await save();await writeFile(root+'/object-proof.json',JSON.stringify({chainId,hold,objectId:plan.objectId,digest:sha256(bytes),byteLength:bytes.length,exactReadback:true,registryBindingVerified:false,transactions:Object.values(journal.steps).map(s=>({hash:s.hash,receipt:s.receipt}))},null,2));console.log(JSON.stringify({phase:'object-verified',objectId:plan.objectId,registryBindingVerified:false}));
