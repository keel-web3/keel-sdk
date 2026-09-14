/** Read-only Base quote. Local EVM transactions only; no keys or public writes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createPublicClient,createWalletClient,http,sha256,toHex,encodeFunctionData,parseAbi,formatEther} from 'viem';
import {estimateL1Fee} from 'viem/op-stack';
import {createKeelManagedObjectPlan} from '../../../packages/sdk/dist/native-managed.js';
import {KEEL_MODULES,KEEL_DEPLOYMENTS} from '../../../packages/sdk/dist/modules.js';
const root='apps/desktop/artifacts/base-library-cost';await mkdir(root,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const audit=await json('apps/desktop/artifacts/gator-ape-rebuild/layer-audit.json');
const paths=new Set(audit.tokens.flatMap(t=>t.stack));
const byPath=new Map((await json('apps/desktop/artifacts/gator-ape-rebuild/collection-layers-3750/selected.json')).map(r=>[r.path,r]));
for(const r of await json('apps/desktop/artifacts/gator-ape-rebuild/mixed-codec-test-3750/selected.json'))byPath.set(r.path,r);
const rows=new Map();for(const p of paths){const r=byPath.get(p);if(!r)throw Error('Missing '+p);rows.set(r.objectId,r);}
const chunks=new Map(),operations=[];let rawBytes=0;
for(const r of rows.values()){
 const b=await readFile(r.file);if(sha256(b)!=='0x'+r.objectId)throw Error('Digest mismatch');rawBytes+=b.length;
 const p=await createKeelManagedObjectPlan(b,{hold:'0x1111111111111111111111111111111111111111',mediaType:r.type,compression:'none'});
 for(const c of p.chunks)chunks.set(c.id,c.bytes);operations.push(...p.operations);
}
const chunkList=[...chunks.values()],storedBytes=chunkList.reduce((n,b)=>n+b.length,0);
console.log(JSON.stringify({phase:'inventory',assets:rows.size,paths:paths.size,rawBytes,storedBytes,chunks:chunks.size,registrations:operations.length}));
const artifact=await json('/Users/ravonus/dev/keel-contracts/out/KeelHold.sol/KeelHold.json');
const child=spawn('anvil',['--port','0','--chain-id','31337'],{stdio:['ignore','pipe','pipe']});
try{
 const url=await new Promise((resolve,reject)=>{let s='';child.on('error',reject);child.stdout.on('data',d=>{s+=d;const m=s.match(/Listening on (127\.0\.0\.1:\d+)/);if(m)resolve('http://'+m[1]);});setTimeout(()=>reject(Error('local startup timeout')),15000).unref();});
 const local=createPublicClient({transport:http(url)}),wallet=createWalletClient({transport:http(url)}),[account]=await wallet.getAddresses();
 const receipt=await local.waitForTransactionReceipt({hash:await wallet.sendTransaction({account,chain:null,data:artifact.bytecode.object})});
 if(receipt.status!=='success')throw Error('Local deployment failed');const hold=receipt.contractAddress;
 const rpc=createPublicClient({transport:http('https://base-rpc.publicnode.com',{timeout:20000,retryCount:3,fetchFn:async (...args)=>{await new Promise(r=>setTimeout(r,400));return fetch(...args);}})});
 if(await rpc.getChainId()!==8453)throw Error('Wrong chain');
 const gasPrice=await rpc.getGasPrice(),block=await rpc.getBlockNumber();
 const ethUSD=Number((await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot').then(r=>r.json())).data.amount);
 const holdAbi=artifact.abi;const full=chunkList.filter(b=>b.length===23000);
 const samples=[];
 for(const [label,payloads] of [['full',full.slice(0,3)],['short',[chunkList.find(b=>b.length<10000)??chunkList.at(-1)]],['middle',full.slice(Math.floor(full.length/2),Math.floor(full.length/2)+3)]]){
  const data=encodeFunctionData({abi:holdAbi,functionName:'castSlugs',args:[payloads.map(toHex)]});
  const g=await local.estimateGas({account,to:hold,data});
  const l1=await estimateL1Fee(rpc,{account,to:hold,data});
  const operator=await rpc.readContract({address:'0x420000000000000000000000000000000000000F',abi:parseAbi(['function getOperatorFee(uint256) view returns(uint256)']),functionName:'getOperatorFee',args:[g]});
  samples.push({label,bytes:payloads.reduce((n,b)=>n+b.length,0),chunks:payloads.length,gas:Number(g),l1Wei:Number(l1),operatorWei:Number(operator)});
 }
 // Derive marginal payload gas and per-carrier overhead from two measured calls.
 const a=samples[0],b=samples[1],perByte=(a.gas-3*b.gas+2*21000)/(a.bytes-3*b.bytes),perChunk=b.gas-21000-perByte*b.bytes;
 const batches=Math.ceil(chunks.size/3);const carrierGas=Math.ceil(storedBytes*perByte+chunks.size*perChunk+batches*21000);
 // Store one complete layer locally and execute its exact SDK descriptor operations.
 const first=rows.values().next().value;
 const fp=await createKeelManagedObjectPlan(await readFile(first.file),{hold,mediaType:first.type,compression:'none'});
 for(let i=0;i<fp.chunks.length;i+=3){const data=encodeFunctionData({abi:holdAbi,functionName:'castSlugs',args:[fp.chunks.slice(i,i+3).map(c=>toHex(c.bytes))]});await local.waitForTransactionReceipt({hash:await wallet.sendTransaction({account,chain:null,to:hold,data})});}
 let registrationSample=0;for(const op of fp.operations){const r=await local.waitForTransactionReceipt({hash:await wallet.sendTransaction({account,chain:null,to:hold,data:op.data})});if(r.status!=='success')throw Error('Registration failed');registrationSample+=Number(r.gasUsed);}
 const maxReferences=Math.max(...operations.map(x=>(x.data.length-2)/2));
 // Use 250k per descriptor for collection-wide allowance, above measured first layer.
 const registrationGas=operations.length*Math.max(250000,registrationSample/fp.operations.length);
 const l1PerByte=Math.max(...samples.map(s=>s.l1Wei/s.bytes));
 const l1Wei=Math.ceil(l1PerByte*(storedBytes+operations.reduce((n,o)=>n+(o.data.length-2)/2,0)));
 const operatorPerGas=Math.max(...samples.map(s=>s.operatorWei/s.gas));
 const fees=g=>Number(gasPrice)*g+operatorPerGas*g;
 const layerWei=fees(carrierGas+registrationGas)+l1Wei;
 const contracts=[];for(const m of KEEL_MODULES)for(const name of m.deployable){
  // Catalog templates are included conservatively; this is an envelope, not a deployment manifest.
  let ar;try{ar=await json('/Users/ravonus/dev/keel-contracts/out/'+name+'.sol/'+name+'.json');}catch{contracts.push({module:m.id,name,missingArtifact:true});continue;}
  const initBytes=(ar.bytecode.object.length-2)/2,runtimeBytes=(ar.deployedBytecode.object.length-2)/2;
  contracts.push({module:m.id,name,initBytes,runtimeBytes,gasAllowance:Math.ceil((53200+initBytes*16+runtimeBytes*200)*1.5)});
 }
 const contractGas=contracts.reduce((n,c)=>n+(c.gasAllowance??5000000),0);
 const contractBytes=contracts.reduce((n,c)=>n+(c.initBytes??0),0);
 const contractWei=fees(contractGas)+l1PerByte*contractBytes;
 const catalog=await json('apps/desktop/artifacts/gator-inline-sepolia/canonical-bindings/active-catalog.json');
 const moduleCatalog=await json('apps/desktop/artifacts/gator-inline-sepolia/canonical-bindings/active-module-catalog.json');
 const objects=new Map();function walk(x){if(!x||typeof x!=='object')return;if(x.objectId&&x.byteLength)objects.set(x.objectId,x.storedByteLength??x.byteLength);for(const v of Object.values(x))if(typeof v==='object')walk(v);}
 walk(catalog);for(const r of moduleCatalog.releases)for(const c of r.carriers??[])if(c.objectId)objects.set(c.objectId,r.byteLength);
 // Include current Gator runtime source + packed fragment if absent from older catalog.
 const runtime=await json('apps/desktop/artifacts/gator-inline-sepolia/runtime-source-publication/object-proof.json');walk(runtime);
 const runtimeFragment=await json('apps/desktop/artifacts/gator-inline-sepolia/runtime-publication/object-proof.json');walk(runtimeFragment);
 const moduleBytes=[...objects.values()].reduce((a,b)=>a+b,0);
 const moduleGas=moduleBytes*perByte+Math.ceil(moduleBytes/23000)*(perChunk+7000)+objects.size*250000;
 const moduleWei=fees(moduleGas)+l1PerByte*moduleBytes;
 const cost=wei=>({ETH:wei/1e18,USD:wei/1e18*ethUSD});
 const report={schema:'keel-base-library-estimate@1',checkedAt:new Date().toISOString(),chainId:8453,block:String(block),gasPriceWei:String(gasPrice),ethUSD,readOnly:true,liveTransactionsSent:0,baseDeploymentsInSDK:KEEL_DEPLOYMENTS.filter(d=>d.chainId===8453),layers:{uniqueAssets:rows.size,usedPaths:paths.size,rawBytes,storedBytes,uniqueChunks:chunks.size,carrierTransactions:batches,descriptorOperations:operations.length,registrationSampleGas:registrationSample,maxDescriptorCalldataBytes:maxReferences,carrierGas,registrationGas,l1Wei,...cost(layerWei)},calibration:{samples,perByte,perChunk,operatorPerGas,l1PerByte},protocolContracts:{count:contracts.length,contracts,gasAllowance:contractGas,...cost(contractWei)},catalogResources:{objects:objects.size,bytes:moduleBytes,modules:moduleCatalog.releases.map(r=>r.identity.name),...cost(moduleWei)},total:cost(layerWei+contractWei+moduleWei),buffered30Percent:cost((layerWei+contractWei+moduleWei)*1.3),limitations:['Fresh deployment assumed; no Base SDK module deployments registered, which does not prove no uncatalogued deployment exists.','Layer upload estimated from exact SDK deduped bytes and sampled local KeelHold gas plus current Base L1 oracle.','All catalog deployables counted conservatively, including optional/template/test variants; final selected deployment manifest can be smaller.','Contract deployment estimate is bytecode-based allowance, not exact constructor execution or configured dependencies.','Browser modules cover saved active catalog and Gator runtime, not arbitrary unlisted modules.','No token minting, new token matrices, hosting, recurring oracle services, or protocol escrow included.','Metadata and all 4000 compositions are not certified by this price estimate.']};
 await writeFile(root+'/estimate.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{child.kill();}
