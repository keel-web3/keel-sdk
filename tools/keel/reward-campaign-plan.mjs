#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,http,encodeFunctionData} from 'viem';
import {ABIS} from '../../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {rewardPlan} from './lib/reward-plan.mjs';
import {rewardCapabilities} from './lib/reward-capabilities.mjs';
function option(name){const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];}
const rpc=option('--rpc'),file=option('--input'),output=option('--output');
if(!rpc||!file||!output)throw new Error('Provide --rpc, --input, --output. This command never signs or submits.');
const input=JSON.parse(await readFile(file,'utf8'));
const client=createPublicClient({transport:http(rpc)}),abi=ABIS.KeelRewardClaims;
if(await client.getChainId()!==input.chainId)throw new Error('Wrong selected chain');
const block=await client.getBlock(),base={address:input.claims,abi,blockNumber:block.number};
const [owner,count]=await Promise.all([client.readContract({...base,functionName:'owner'}),client.readContract({...base,functionName:'campaignCount'})]);
const plan=rewardPlan(input,{chainId:input.chainId,claims:input.claims,nextId:count+1});
if(BigInt(plan.terms.end)<=block.timestamp)throw new Error('Claim window has already ended at the reviewed block');
const args=[plan.campaignId,plan.terms,plan.pool,plan.weights];
await client.simulateContract({...base,account:owner,functionName:'createAt',args});
const benefits=await Promise.all(plan.pool.map(id=>client.readContract({...base,functionName:'benefits',args:[id]})));
const entropySource=await client.readContract({...base,functionName:'entropySource'});
const capabilities=await rewardCapabilities(client,{plan,benefits,entropySource,blockNumber:block.number,probeTokenId:input.probeTokenId,probeAccount:input.probeAccount});
if((await client.getBlock({blockNumber:block.number})).hash!==block.hash)throw new Error('Chain history changed; rebuild the plan');
const result={...plan,owner,blockNumber:String(block.number),blockHash:block.hash,capabilities,benefits:benefits.map((b,i)=>({id:plan.pool[i],receiver:b[0],item:String(b[1]),amount:b[2]})),
  create:{to:input.claims,value:'0',data:encodeFunctionData({abi,functionName:'createAt',args})},
  walletCalls:plan.walletBatches.map(accounts=>({to:input.claims,value:'0',data:encodeFunctionData({abi,functionName:'listWallets',args:[plan.campaignId,accounts]})})),
  nextStep:plan.walletBatches.length?'Keep paused. After the create receipt confirms this campaign ID, submit the reviewed wallet batches and read back every walletList entry before unpausing. The owner can extend this list later; use Merkle for immutable recipients.':'Review the create call and benefit receivers before signing.',
  proofBoundary:'Unsigned, simulated plan only. No transaction, entitlement, or reward has been issued.'};
await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(`Unsigned campaign ${plan.campaignId} plan saved to ${output}`);
