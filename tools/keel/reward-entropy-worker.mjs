#!/usr/bin/env node
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createPublicClient,createWalletClient,http,isAddress,zeroAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ABIS} from '../../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {collectQueuePage} from './lib/mint-queue-worker-core.mjs';
import {processMintAccessEntropy} from './lib/mint-access-entropy.mjs';
import {runWorkerTransaction} from './lib/worker-transaction.mjs';

// Read-only by default. This worker fulfills existing random draws; it never
// creates campaigns, chooses random words, claims benefits, or sends contacts.
const execute=process.argv.includes('--execute'),once=process.argv.includes('--once');
const rpc=process.env.KEEL_REWARD_RPC,chainId=Number(process.env.KEEL_REWARD_CHAIN_ID),consumer=process.env.KEEL_REWARD_ADDRESS;
if(!rpc||!Number.isSafeInteger(chainId)||chainId<=0||!isAddress(consumer??''))throw new Error('Set KEEL_REWARD_RPC, KEEL_REWARD_CHAIN_ID and KEEL_REWARD_ADDRESS');
const confirmations=Number(process.env.KEEL_REWARD_CONFIRMATIONS??'2');
if(!Number.isSafeInteger(confirmations)||confirmations<0||confirmations>1024)throw new Error('Invalid confirmations');
const initialFrom=BigInt(process.env.KEEL_REWARD_FROM_BLOCK??'0');if(initialFrom<0n)throw new Error('Invalid start block');
const client=createPublicClient({transport:http(rpc)});if(await client.getChainId()!==chainId)throw new Error('Wrong selected chain');
const source=await client.readContract({address:consumer,abi:ABIS.KeelRewardClaims,functionName:'entropySource'});
if(source===zeroAddress)throw new Error('This claims contract has random rewards disabled');
// Authorization is checked for new commitments; revoked consumers may finish existing draws.
const account=execute?privateKeyToAccount(process.env.KEEL_REWARD_WORKER_KEY??''):undefined;
const wallet=account?createWalletClient({account,transport:http(rpc)}):null;
const directory=path.resolve(process.env.KEEL_REWARD_STATE_DIR??'.keel-reward-worker',String(chainId),consumer.toLowerCase());
const file=path.join(directory,'journal.json');
const lockFile=path.join(directory,'worker.lock');let lock=null;
if(execute){
  await mkdir(directory,{recursive:true,mode:0o700});
  lock=await open(lockFile,'wx',0o600).catch(error=>{throw new Error('Another reward worker owns this journal, or a stopped worker left a lock. Verify process ownership before removing it.',{cause:error});});
  await lock.writeFile(JSON.stringify({pid:process.pid}));
}
let journal={schema:'keel-reward-worker/v1',chainId,consumer,cursor:null,hash:null,tasks:{},sent:{},transactions:{}};
try{
  const saved=JSON.parse(await readFile(file,'utf8'));
  if(saved.schema!==journal.schema||saved.chainId!==chainId||saved.consumer!==consumer||typeof saved.tasks!=='object'||saved.tasks===null)throw new Error('Journal does not match this worker');
  journal=saved;
}catch(error){if(error.code!=='ENOENT'){await releaseLock();throw error;}}
async function releaseLock(){if(lock){await lock.close();lock=null;await unlink(lockFile);}}
async function save(){
  if(!execute)return;
  await mkdir(directory,{recursive:true,mode:0o700});
  const handle=await open(file+'.tmp','w',0o600);
  try{await handle.chmod(0o600);await handle.writeFile(JSON.stringify(journal,null,2));await handle.sync();}finally{await handle.close();}
  await rename(file+'.tmp',file);
}
async function transact(address,abi,functionName,args){
  if(!wallet||!account)throw new Error('Execution is disabled');
  return runWorkerTransaction({client,wallet,account,chainId,address,abi,functionName,args,confirmations,journal,save});
}
async function tick(){
  const head=await client.getBlockNumber(),depth=BigInt(confirmations);
  await collectQueuePage({journal,head:head>depth?head-depth:0n,initialFrom,
    getBlock:blockNumber=>client.getBlock({blockNumber}),
    getEvents:(fromBlock,toBlock)=>client.getContractEvents({address:consumer,abi:ABIS.KeelRewardClaims,eventName:'DrawRequested',fromBlock,toBlock,strict:true}),
    buildTask:event=>event.eventName==='DrawRequested'?[`reward:${event.args.request}`,{id:String(event.args.request)}]:null,
  });
  await save();
  if(!execute){console.log(JSON.stringify({mode:'read-only',chainId,consumer,source,indexedThrough:journal.cursor,pending:Object.keys(journal.tasks).length}));return;}
  for(const [key,task] of Object.entries(journal.tasks).slice(0,32)){
    try{const result=await processMintAccessEntropy({client,source,consumer,id:task.id,reward:true,transact});delete journal.tasks[key];if(!result.done)journal.tasks[key]=task;}
    catch(error){delete journal.tasks[key];journal.tasks[key]=task;if(once)process.exitCode=1;console.error(`reward draw ${task.id}: ${error.shortMessage??error.message}`);}
    await save();
  }
}
try{do{
  try{await tick();}catch(error){console.error(error.shortMessage??error.message);if(once||!execute)process.exitCode=1;}
  if(once||!execute)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
}while(true);}finally{await releaseLock();}
