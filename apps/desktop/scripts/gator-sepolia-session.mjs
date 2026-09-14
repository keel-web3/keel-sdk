/** Durable, capped host adapter for the creator-approved Sepolia publication.
 * SDK/MCP prepare bytes and calls; this adapter handles receipts and recovery. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createPublicClient,http,keccak256,encodeFunctionData,encodeDeployData,toHex,parseAbi,sha256,parseTransaction} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {keelHoldAbi} from '@keel/sdk/abi';
import {createKeelManagedObjectPlan,readKeelManagedObject} from '@keel/sdk/native-publication';
export const SIGNER='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0';
export const HOLD='0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267';
export const CHAIN=11155111, CAP=1_400_000_000n;
export const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
export const artifact=async name=>readJSON(`/Users/ravonus/dev/keel-contracts/out/${name}.sol/${name}.json`);
export async function openSession(root,{execute=false,budget=250_000_000_000_000_000n}={}) {
 await mkdir(root,{recursive:true});
 const c=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:30000,retryCount:1}),pollingInterval:2500});
 assert.equal(await c.getChainId(),CHAIN);
 const holdABI=parseAbi(keelHoldAbi),path=root+'/transactions.private.json';
 let j;try{j=await readJSON(path);}catch(e){if(e.code!=='ENOENT')throw e;j={chainId:CHAIN,signer:SIGNER,hold:HOLD,steps:{}};}
 assert.equal(j.chainId,CHAIN);assert.equal(j.signer,SIGNER);assert.equal(j.hold,HOLD);
 const save=async()=>{await writeFile(path+'.tmp',JSON.stringify(j,null,2),{mode:0o600});await rename(path+'.tmp',path);};
 const publicSave=async()=>writeFile(root+'/transactions.json',JSON.stringify({chainId:CHAIN,signer:SIGNER,feeCapWei:String(CAP),steps:Object.entries(j.steps).map(([label,s])=>({label,hash:s.hash,nonce:s.nonce,receipt:s.receipt}))},null,2));
 const record=async(s,r)=>{s.receipt={status:r.status,blockNumber:String(r.blockNumber),gasUsed:String(r.gasUsed),feeWei:String(r.gasUsed*r.effectiveGasPrice),contractAddress:r.contractAddress};await save();await publicSave();assert.equal(r.status,'success');};
 const reconcile=async()=>{for(const s of Object.values(j.steps))if(!s.receipt){for(const hash of [s.hash,...(s.replacements??[]).map(x=>x.hash)]){const r=await c.getTransactionReceipt({hash}).catch(()=>null);if(r){s.confirmedHash=hash;await record(s,r);break;}}}};
 await reconcile();
 let account;
 async function signer(){
  if(!account){const env=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8');const key=env.match(/^\s*(?:export\s+)?KEEL_DEPLOYER_PK\s*=\s*['"]?(0x[0-9a-fA-F]{64})['"]?\s*$/m)?.[1];assert.ok(key,'Configured signer missing');account=privateKeyToAccount(key);assert.equal(account.address,SIGNER);}
  return account;
 }
 async function send(label,to,data){
  assert.ok(execute,'Publication is review-only until explicitly executed');
  let s=j.steps[label];if(s){assert.equal(s.to,to??null);assert.equal(s.dataDigest,keccak256(data));if(s.receipt){assert.equal(s.receipt.status,'success');return s.receipt;}}
  if(!s){
   await reconcile();
   assert.ok(Object.values(j.steps).every(x=>x.receipt),'An earlier signed intent is unresolved');
   assert.equal(await c.getChainId(),CHAIN);
   const nonce=await c.getTransactionCount({address:SIGNER});assert.equal(nonce,await c.getTransactionCount({address:SIGNER,blockTag:'pending'}),'Another wallet transaction is pending');
   const estimate=await c.estimateGas({account:SIGNER,...(to?{to}:{}),data}),gas=(estimate*110n+99n)/100n;
   assert.ok(gas<=16_000_000n,'Split this operation within the transaction gas limit');
   const spent=Object.values(j.steps).reduce((n,x)=>n+BigInt(x.receipt?.feeWei??0),0n);
   assert.ok(spent+gas*CAP<=budget,'Publication budget reached');assert.ok(await c.getBalance({address:SIGNER})>=gas*CAP,'Insufficient balance for this operation');
   await signer();
   const raw=await account.signTransaction({type:'eip1559',chainId:CHAIN,nonce,...(to?{to}:{}),data,value:0n,gas,maxFeePerGas:CAP,maxPriorityFeePerGas:140_000_000n});
   s={hash:keccak256(raw),raw,nonce,to:to??null,dataDigest:keccak256(data),feeCapWei:String(CAP),signedAt:new Date().toISOString()};j.steps[label]=s;await save();
  }
  const confirmed=await c.getTransactionReceipt({hash:s.hash}).catch(()=>null);
  if(confirmed){await record(s,confirmed);return s.receipt;}
  if(BigInt(s.feeCapWei)<CAP){
   const old=parseTransaction(s.raw);
   assert.equal(old.chainId,CHAIN);assert.equal(old.nonce,s.nonce);
   assert.equal((old.to??null)?.toLowerCase(),(to??null)?.toLowerCase());
   assert.equal(old.data,data);assert.equal(old.value??0n,0n);
   assert.equal(await c.getTransactionCount({address:SIGNER}),s.nonce,'Pending nonce was consumed; reconcile before replacing');
   const spent=Object.values(j.steps).reduce((n,x)=>n+BigInt(x.receipt?.feeWei??0),0n);
   assert.ok(spent+old.gas*CAP<=budget,'Publication budget reached');
   assert.ok(await c.getBalance({address:SIGNER})>=old.gas*CAP,'Insufficient replacement balance');
   const tip=((old.maxPriorityFeePerGas??0n)*113n+99n)/100n;
   assert.ok(CAP*100n>=(old.maxFeePerGas??0n)*113n,'Replacement cap must increase sufficiently');
   const raw=await (await signer()).signTransaction({type:'eip1559',chainId:CHAIN,nonce:s.nonce,...(to?{to}:{}),data,value:0n,gas:old.gas,maxFeePerGas:CAP,maxPriorityFeePerGas:tip>200_000_000n?tip:200_000_000n});
   const replacedHash=s.hash;
   s.replacements??=[];s.replacements.push({hash:s.hash,raw:s.raw,feeCapWei:s.feeCapWei});
   s.hash=keccak256(raw);s.raw=raw;s.feeCapWei=String(CAP);s.signedAt=new Date().toISOString();await save();
   console.log(JSON.stringify({phase:'replacement',label,replacedHash,hash:s.hash,capGwei:Number(CAP)/1e9}));
  }
  assert.equal(s.feeCapWei,String(CAP));
  try{assert.equal(await c.sendRawTransaction({serializedTransaction:s.raw}),s.hash);}
  catch(e){let cause=e,detail='RPC did not acknowledge rebroadcast';for(let i=0;cause&&i<6;i++,cause=cause.cause)detail=String(cause.details??cause.shortMessage??detail);console.log(JSON.stringify({phase:'broadcast-response',hash:s.hash,detail:detail.replace(/0x[0-9a-fA-F]{130,}/g,'[transaction omitted]').slice(0,250)}));}
  console.log(JSON.stringify({phase:'submitted',label,hash:s.hash,capGwei:Number(CAP)/1e9}));await publicSave();
  let r;
  for(let attempt=0;attempt<12&&!r;attempt++){
   try{r=await c.waitForTransactionReceipt({hash:s.hash,timeout:45000});}
   catch{console.log(JSON.stringify({phase:'pending',label,hash:s.hash,capGwei:Number(CAP)/1e9}));}
  }
  if(!r)throw new Error('Transaction remains unconfirmed; resume this journal: '+s.hash);
  await record(s,r);console.log(JSON.stringify({phase:'confirmed',label,hash:s.hash,gas:String(r.gasUsed)}));return s.receipt;
 }
 const call=(label,address,abi,functionName,args)=>send(label,address,encodeFunctionData({abi,functionName,args}));
 const deploy=async(label,build,args)=>(await send(label,undefined,encodeDeployData({abi:build.abi,bytecode:build.bytecode.object,args}))).contractAddress;
 const ports={record:async id=>{const r=await c.readContract({address:HOLD,abi:holdABI,functionName:'getObject',args:[id]});return {...r,chunkCount:Number(r.chunkCount)};},parts:(id,n)=>c.readContract({address:HOLD,abi:holdABI,functionName:'getObjectPartIds',args:[id,0n,BigInt(n)]}),slug:(id,n)=>c.readContract({address:HOLD,abi:holdABI,functionName:'readSlug',args:[id,BigInt(n)]})};
 async function precast(values){
  const chunks=new Map();
  for(const value of values){const plan=await createKeelManagedObjectPlan(value.bytes,{hold:HOLD,mediaType:'text/plain',compression:'none'});for(const chunk of plan.chunks)chunks.set(chunk.id,chunk);}
  const missing=[];
  for(const chunk of chunks.values()){
   const pointer=await c.readContract({address:HOLD,abi:holdABI,functionName:'slugPointer',args:[chunk.id]});
   if(pointer==='0x'+'0'.repeat(40))missing.push(chunk);
   else assert.equal(await c.getCode({address:pointer}),'0x00'+Buffer.from(chunk.bytes).toString('hex'));
  }
  for(let at=0;at<missing.length;){
   const batch=[];let bytes=0;
   while(at<missing.length&&batch.length<3&&(batch.length===0||bytes+missing[at].bytes.length<=46000)){const chunk=missing[at++];batch.push(chunk);bytes+=chunk.bytes.length;}
   await call('precast-batch:'+keccak256(toHex(batch.map(x=>x.id).join(','))),HOLD,holdABI,'castSlugs',[batch.map(x=>toHex(x.bytes))]);
  }
 }
 async function publish(bytes,mediaType='text/plain',compression='none'){
  const p=await createKeelManagedObjectPlan(bytes,{hold:HOLD,mediaType,compression});
  const missing=[];
  for(const chunk of p.chunks){const pointer=await c.readContract({address:HOLD,abi:holdABI,functionName:'slugPointer',args:[chunk.id]});if(pointer!=='0x'+'0'.repeat(40)){assert.equal(await c.getCode({address:pointer}),'0x00'+Buffer.from(chunk.bytes).toString('hex'));continue;}missing.push(chunk);}
  // Two standard SDK chunks per transaction remain comfortably below the
  // transaction gas bound. Preserve any earlier signed single-chunk intent.
  for(let at=0;at<missing.length;){const first=missing[at],single=j.steps['cast:'+first.id];const batch=single&&!single.receipt?[first]:missing.slice(at,at+2);const label=batch.length===1?'cast:'+first.id:'cast-batch:'+keccak256(toHex(batch.map(x=>x.id).join(',')));await call(label,HOLD,holdABI,'castSlugs',[batch.map(x=>toHex(x.bytes))]);at+=batch.length;}
  if(!await c.readContract({address:HOLD,abi:holdABI,functionName:'objectExists',args:[p.objectId]}))for(const [i,op] of p.operations.entries())await send('object:'+p.objectId+':'+i,HOLD,op.data);
  assert.deepEqual(Buffer.from(await readKeelManagedObject(p.objectId,ports)),Buffer.from(bytes));return p;
 }
 async function weldPrepared(values){
  const plans=new Map();
  for(const value of values){const p=await createKeelManagedObjectPlan(value.bytes,{hold:HOLD,mediaType:'text/plain',compression:'none'});plans.set(p.objectId,p);}
  const operations=[];
  for(const p of plans.values())if(!await c.readContract({address:HOLD,abi:holdABI,functionName:'objectExists',args:[p.objectId]}))operations.push(...p.operations);
  if(!operations.length)return;
  const build=await artifact('KeelCarrierBatcher');
  const batcher=await deploy('deploy:carrier-batcher',build,[HOLD]);
  assert.equal((await c.readContract({address:batcher,abi:build.abi,functionName:'keelHold'})).toLowerCase(),HOLD.toLowerCase());
  assert.equal(await c.readContract({address:batcher,abi:build.abi,functionName:'MAX_OBJECT_OPERATIONS'}),128n);
  // KEEL's restricted batcher forwards only immutable Hold descriptor writes;
  // creator-bound reader/collection calls remain direct wallet operations.
  for(let at=0;at<operations.length;at+=64){const batch=operations.slice(at,at+64).map(op=>op.data);await call('weld-batch:'+keccak256(encodeFunctionData({abi:build.abi,functionName:'execute',args:[[],batch]})),batcher,build.abi,'execute',[[],batch]);}
 }
 return {c,send,call,deploy,publish,precast,weldPrepared,ports,steps:j.steps,read:async id=>Buffer.from(await readKeelManagedObject(id,ports))};
}
