/** Read-only Sepolia reuse check and calldata-specific chunk storage estimate. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,encodeFunctionData,formatEther,keccak256} from 'viem';
const root='apps/desktop/artifacts/gator-inline-sepolia/3750-objects';
const c=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:30000,retryCount:1})});
const hold='0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267',account='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
const abi=parseAbi(['function slugPointer(bytes32) view returns(address)','function castSlugs(bytes[]) returns(bytes32[])']);
if(await c.getChainId()!==11155111)throw Error('Wrong chain');
const files=await readdir(root+'/chunks'),chunks=await Promise.all(files.map(async f=>{const bytes=await readFile(root+'/chunks/'+f);if(keccak256(bytes)!=='0x'+f)throw Error('Chunk digest mismatch');return {id:'0x'+f,bytes};}));
const rows=[];
for(let i=0;i<chunks.length;i+=4)await Promise.all(chunks.slice(i,i+4).map(async r=>{const pointer=await c.readContract({address:hold,abi,functionName:'slugPointer',args:[r.id]});if(pointer!=='0x0000000000000000000000000000000000000000'){if(await c.getCode({address:pointer})!=='0x00'+r.bytes.toString('hex'))throw Error('Reuse differs');rows.push({id:r.id,bytes:r.bytes.length,reused:true,gas:'0'});}else {const gas=await c.estimateGas({account,to:hold,data:encodeFunctionData({abi,functionName:'castSlugs',args:[['0x'+r.bytes.toString('hex')]]})});rows.push({id:r.id,bytes:r.bytes.length,reused:false,gas:String(gas)});}}));
const [fees,balance,block]=await Promise.all([c.estimateFeesPerGas(),c.getBalance({address:account}),c.getBlockNumber()]);
const gas=rows.reduce((s,r)=>s+BigInt(r.gas),0n),cost=gas*fees.maxFeePerGas;
const report={schema:'gator-native-layer-storage-quote@1',chainId:11155111,account,hold,block:String(block),checkedAt:new Date().toISOString(),rows,newBytes:rows.filter(r=>!r.reused).reduce((s,r)=>s+r.bytes,0),reusedBytes:rows.filter(r=>r.reused).reduce((s,r)=>s+r.bytes,0),transactions:rows.filter(r=>!r.reused).length,gas:String(gas),maxFeePerGas:String(fees.maxFeePerGas),chunkUploadMaxCostETH:formatEther(cost),balanceETH:formatEther(balance),fundedForChunks:balance>=cost,excludes:['Object registrations','Canonical module and shell binding','Metadata adapter deployment and collection update'],published:false};
await writeFile(root+'/storage-quote.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
