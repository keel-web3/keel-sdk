#!/usr/bin/env node
import {readFile,mkdir,rename,chmod,open,unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHmac} from 'node:crypto';
import {createPublicClient,createWalletClient,http,isAddress,keccak256,encodeAbiParameters} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ABIS} from '../../packages/sdk/dist/abis/keel-mint-access.generated.js';
import {mintTurnNotice} from '../../packages/sdk/dist/mint-queue.js';
import {collectQueuePage,deliverTurnNotification,resolveTurnBinding,safeUintNumber} from './lib/mint-queue-worker-core.mjs';
import {runWorkerTransaction} from './lib/worker-transaction.mjs';

// Read-only unless --execute is explicitly supplied. No contacts or signing
// keys enter journal files. Provider integrations resolve verified opt-in
// preferences from the wallet; phone numbers/email never go onto the chain.
const execute=process.argv.includes('--execute'),once=process.argv.includes('--once');
const rpc=process.env.KEEL_QUEUE_RPC,chainId=Number(process.env.KEEL_QUEUE_CHAIN_ID),queue=process.env.KEEL_QUEUE_ADDRESS;
if(!rpc||!Number.isSafeInteger(chainId)||chainId<=0||!isAddress(queue??''))throw new Error('Set KEEL_QUEUE_RPC, KEEL_QUEUE_CHAIN_ID and KEEL_QUEUE_ADDRESS.');
const confirmationCount=Number(process.env.KEEL_QUEUE_CONFIRMATIONS??'2');
if(!Number.isSafeInteger(confirmationCount)||confirmationCount<0||confirmationCount>1024)throw new Error('Invalid confirmation count');
const client=createPublicClient({transport:http(rpc)});if(await client.getChainId()!==chainId)throw new Error('RPC is on the wrong selected chain');
const account=execute?privateKeyToAccount(process.env.KEEL_QUEUE_WORKER_KEY??''):undefined;
const wallet=account?createWalletClient({account,transport:http(rpc)}):null;
const source=await client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'entropySource'});
const directory=path.resolve(process.env.KEEL_QUEUE_STATE_DIR??'.keel-queue-worker',String(chainId),queue.toLowerCase());
const file=path.join(directory,'journal.json');const lockFile=path.join(directory,'worker.lock');let lockHandle=null;let journal={cursor:null,hash:null,tasks:{},sent:{},transactions:{},advanceSequence:0};
if(execute){
  await mkdir(directory,{recursive:true,mode:0o700});
  let acquired=false;
  try{lockHandle=await open(lockFile,'wx',0o600);acquired=true;await lockHandle.writeFile(JSON.stringify({pid:process.pid}));}
  catch(error){
    if(lockHandle){await lockHandle.close().catch(()=>{});if(acquired)await unlink(lockFile).catch(()=>{});}
    throw new Error('Queue worker requires one execute process; journal lock exists at '+lockFile,{cause:error});
  }
}
try{journal=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT'){await releaseLock();throw error;}}
if(!journal||typeof journal!=='object'||Array.isArray(journal)){await releaseLock();throw new Error('Queue worker journal must be an object');}
journal={cursor:journal.cursor??null,hash:journal.hash??null,tasks:journal.tasks??{},sent:journal.sent??{},transactions:journal.transactions??{},advanceSequence:journal.advanceSequence??0};
async function save(){
  if(!execute)return;
  await mkdir(directory,{recursive:true,mode:0o700});
  const handle=await open(file+'.tmp','w',0o600);
  try{await handle.chmod(0o600);await handle.writeFile(JSON.stringify(journal,null,2));await handle.sync();}finally{await handle.close();}
  await rename(file+'.tmp',file);
  await chmod(file,0o600);
}
async function releaseLock(){if(!lockHandle)return;await lockHandle.close().catch(()=>{});lockHandle=null;await unlink(lockFile).catch(error=>{if(error.code!=='ENOENT')console.error('worker lock cleanup: '+error.message);});}
async function transact(address,abi,functionName,args,operationId){
  if(!wallet)return;
  return runWorkerTransaction({client,wallet,account,chainId,address,abi,functionName,args,operationId,confirmations:confirmationCount,journal,save});
}
async function collect(head){
  const blockTimes=new Map();
  const result=await collectQueuePage({
    journal,
    head,
    initialFrom:BigInt(process.env.KEEL_QUEUE_FROM_BLOCK??'0'),
    pageSize:2000n,
    getBlock:(blockNumber)=>client.getBlock({blockNumber}),
    getEvents:(fromBlock,toBlock)=>client.getContractEvents({address:queue,abi:ABIS.KeelMintQueue,fromBlock,toBlock,strict:true}),
    buildTask:async(event)=>{
      const a=event.args;
      if(event.eventName==='EntropyRequested')return ['entropy:'+a.cohort,{kind:'entropy',id:a.cohort.toString()}];
      if(event.eventName!=='TurnReady')return null;
      const binding=await resolveTurnBinding({event,chainId,queue,getJoined:(ticketId,toBlock)=>
        client.getContractEvents({address:queue,abi:ABIS.KeelMintQueue,eventName:'Joined',args:{ticketId},fromBlock:0n,toBlock,strict:true})});
      const eventBlockNumber=event.blockNumber;
      const eventBlockKey=eventBlockNumber.toString();
      let eventTimestamp=blockTimes.get(eventBlockKey);
      if(eventTimestamp===undefined){
        const eventBlock=await client.getBlock({blockNumber:eventBlockNumber});
        eventTimestamp=safeUintNumber(eventBlock.timestamp,'event block timestamp');
        blockTimes.set(eventBlockKey,eventTimestamp);
      }
      const notice=mintTurnNotice({
        chainId,
        queue,
        transactionHash:event.transactionHash,
        logIndex:event.logIndex,
        blockNumber:eventBlockNumber,
        name:'TurnReady',
        account:a.account,
        ticketId:a.ticketId,
        quantity:safeUintNumber(a.quantity,'TurnReady quantity'),
        deadline:safeUintNumber(a.deadline,'TurnReady deadline'),
      },eventTimestamp,binding);
      return notice&&!journal.sent[notice.key]?[notice.key,{kind:'notice',notice}]:null;
    },
  });
  if(result.advanced||result.reset)await save();
}
async function entropy(t){
  const id=BigInt(t.id),abi=ABIS.KeelMintRewardEntropy;
  const key=keccak256(encodeAbiParameters([{type:'address'},{type:'uint64'},{type:'bool'}],[queue,id,false]));
  const request=await client.readContract({address:source,abi,functionName:'requested',args:[key]});
  if(request===0n){await transact(source,abi,'request',[queue,id,false]);return false;}
  const delivery=await client.readContract({address:source,abi,functionName:'deliveries',args:[request]});
  if(delivery[4])return true;
  if(!delivery[3])return false;
  await transact(source,abi,'deliver',[request]);return execute;
}
async function notify(t){
  const block=await client.getBlock();
  const n=t.notice;
  const blockNumber=block.number;
  const result=await deliverTurnNotification({
    notice:n,now:block.timestamp,sent:journal.sent,
    readState:async()=>{
      const [allowance,ticket,enabled]=await Promise.all([
        client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'allowance',args:[n.account],blockNumber}),
        client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'ticketOf',args:[n.account],blockNumber}),
        client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'enabled',blockNumber}),
      ]);
      const current=await client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'walletTicket',args:[n.account],blockNumber})
        .catch(()=>client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'tickets',args:[ticket],blockNumber}));
      if(current[0].toLowerCase()!==n.account.toLowerCase())throw new Error('Queue notification owner mismatch');
      return {allowance,ticketId:ticket,enabled,currentState:current[3],currentDeadline:current[1],currentRemaining:current[2]};
    },
    send:async({key,payload})=>{
      const endpoint=process.env.KEEL_QUEUE_NOTIFY_WEBHOOK;if(!endpoint||!execute)throw new Error('Notification delivery is not configured for execution');
      const url=new URL(endpoint);if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Notification webhook requires HTTPS');
      const secret=process.env.KEEL_QUEUE_NOTIFY_SECRET;if(!secret)throw new Error('Notification webhook secret is missing');
      const body=JSON.stringify(payload);
      const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),body,
        headers:{'content-type':'application/json','idempotency-key':key,'x-keel-signature':createHmac('sha256',secret).update(body).digest('hex')}});
      if(!response.ok)throw new Error('Notification provider returned '+response.status);
    },
  });
  return result.done;
}
function pendingAdvanceRecord(){
  return Object.values(journal.transactions).find(record=>record&&record.chainId===chainId&&String(record.to).toLowerCase()===queue.toLowerCase()&&record.functionName==='advance'&&(record.status==='prepared'||record.status==='broadcast'));
}
async function nextAdvanceOperationId(block){
  const sequence=Number(journal.advanceSequence);
  if(!Number.isSafeInteger(sequence)||sequence<0||sequence>=Number.MAX_SAFE_INTEGER)throw new Error('Invalid advance operation sequence');
  if(typeof block.hash!=='string'||block.hash.length===0)throw new Error('Advance scope requires a canonical latest block hash');
  journal.advanceSequence=sequence+1;
  const operationId='advance:'+block.number.toString()+':'+block.hash+':'+journal.advanceSequence;
  await save();
  return operationId;
}
async function tick(){
  const latest=await client.getBlock();const confirmations=BigInt(confirmationCount);
  await collect(latest.number>confirmations?latest.number-confirmations:0n);
  if(!execute){console.log(JSON.stringify({mode:'read-only',chainId,queue,indexedThrough:journal.cursor,pending:Object.keys(journal.tasks).length}));return;}
  for(const [key,t] of Object.entries(journal.tasks).slice(0,32)){
    try{const done=t.kind==='entropy'?await entropy(t):await notify(t);delete journal.tasks[key];if(!done)journal.tasks[key]=t;}
    catch(error){delete journal.tasks[key];journal.tasks[key]=t;console.error(`${t.kind}: ${error.shortMessage??error.message}`);}
  }
  const pending=pendingAdvanceRecord();
  const needs=await client.readContract({address:queue,abi:ABIS.KeelMintQueue,functionName:'needsAdvance'});
  if(pending)await transact(queue,ABIS.KeelMintQueue,'advance',[32],pending.operationId??undefined);
  else if(needs)await transact(queue,ABIS.KeelMintQueue,'advance',[32],await nextAdvanceOperationId(latest));
  await save();
}
try{
  do{try{await tick();}catch(error){console.error(error.shortMessage??error.message);if(once||!execute)process.exitCode=1;}if(once||!execute)break;await new Promise(resolve=>setTimeout(resolve,5000));}while(true);
}finally{await releaseLock();}
