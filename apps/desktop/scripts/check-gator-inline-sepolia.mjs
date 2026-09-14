/** Read-only selected-chain preflight. Never sends artwork calldata or signs. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,formatEther,sha256,keccak256} from 'viem';
import {keelHoldAbi} from '@keel/sdk/abi';
import {createKeelManagedObjectPlan} from '@keel/sdk/native-publication';
import {loadGatorInlineMetadata,GATOR_INLINE_ROOT} from './gator-inline-metadata.mjs';

const root=process.env.KEEL_GATOR_MEASUREMENT_DIR??GATOR_INLINE_ROOT;
const candidate=await loadGatorInlineMetadata(root);
// Creator selected a hard 0.5-gwei ceiling. Never replace it with RPC fee suggestions.
const maxFeePerGas=500_000_000n,maxPriorityFeePerGas=500_000_000n;
const matrix=JSON.parse(await readFile(root+'/matrix-plan.json','utf8'));
const client=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:20000,retryCount:1})});
const chainId=await client.getChainId();assert.equal(chainId,11155111);
const blockNumber=await client.getBlockNumber(),hold='0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267';
const collection='0xab2e21bffafdae462e9392375a413d36ea7c247c',wallet='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
const abi=parseAbi(keelHoldAbi);
const read=(address,abi,functionName,args=[])=>client.readContract({address,abi,functionName,args,blockNumber});
const [balance,gasPrice,tokenURI,owner]=await Promise.all([
  client.getBalance({address:wallet,blockNumber}),client.getGasPrice(),
  read(collection,parseAbi(['function tokenURI(uint256) view returns(string)']),'tokenURI',[0n]),
  read(collection,parseAbi(['function owner() view returns(address)']),'owner'),
]);
assert.equal(owner.toLowerCase(),wallet.toLowerCase());
const cache=new Map(),chunks=new Map(),values=[];
async function readSlug(id){
  if(!cache.has(id))cache.set(id,(async()=>{
    const pointer=await read(hold,abi,'slugPointer',[id]);
    if(pointer==='0x0000000000000000000000000000000000000000')return null;
    const code=await client.getCode({address:pointer,blockNumber});
    assert.ok(code?.startsWith('0x00'),'Invalid KEEL storage carrier');
    const bytes=Buffer.from(code.slice(4),'hex');assert.equal(keccak256(bytes),id);return bytes;
  })());
  return cache.get(id);
}
for(const value of matrix.table){
  const bytes=await readFile(value.path);assert.equal(sha256(bytes),value.digest);
  const plan=await createKeelManagedObjectPlan(bytes,{hold,mediaType:'text/plain',compression:'none',readSlug});
  for(const chunk of plan.chunks)chunks.set(chunk.id,chunk.bytes);
  values.push({id:value.id,objectId:plan.objectId,digest:plan.digest,byteLength:bytes.length,newBytes:plan.newBytes,reusedBytes:plan.reusedBytes,roles:value.roles,path:value.path});
}
// This web3 JSON preparation cannot establish an active Studio binding from
// an old legacy shell record. Resolve and verify the configured compact catalog
// through Studio separately; never label a local candidate chain-ready here.
const newStoredBytes=[...chunks.values()].reduce((n,b)=>n+b.length,0);
// Native slug code deposit is 200 gas/byte before calldata, creation, objects,
// matrix bindings, deployment, or the collection update. This is a lower bound.
const codeDepositGas=BigInt(newStoredBytes)*200n,minimumCost=codeDepositGas*maxFeePerGas;
const measuredSetupCost=BigInt(candidate.acceptance.setupGas)*maxFeePerGas;
const report={schema:'gator-inline-sepolia-preflight@1',checkedAt:new Date().toISOString(),chainId,block:String(blockNumber),collection,wallet,hold,currentTokenURI:tokenURI,
  candidate:candidate.proof,localReadGas:candidate.acceptance.readGas,values,newStoredBytes,reusedStoredBytes:values.reduce((n,v)=>n+v.reusedBytes,0),missingChunks:chunks.size,
  balanceETH:formatEther(balance),observedGasPriceWei:String(gasPrice),executionFeeCaps:{maxFeePerGas:String(maxFeePerGas),maxPriorityFeePerGas:String(maxPriorityFeePerGas),automaticFeeIncrease:false},codeDepositGasLowerBound:String(codeDepositGas),codeDepositCostLowerBoundETH:formatEther(minimumCost),fundedForMinimum:balance>=minimumCost,
  measuredLocalSetupCostAtCapETH:formatEther(measuredSetupCost),measuredSetupShortfallETH:formatEther(measuredSetupCost>balance?measuredSetupCost-balance:0n),quoteScope:'Token zero local setup only; the full collection and required shared-module registrations are not yet quoted.',
  selectedChainShellBindingVerified:false,requiredRuntime:'keel-layered-runtime-v4@4.0.1',selectedChainModuleBindingVerified:false,
  published:false,blockers:['Resolve receipt-backed compact shell and layered runtime bindings through the active Studio catalog.',...(balance<minimumCost?['Wallet balance is below the code-deposit-only lower bound.']:[])]};
await writeFile(root+'/sepolia-preflight.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,values:undefined}));
