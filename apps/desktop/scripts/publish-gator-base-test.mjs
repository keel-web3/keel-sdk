/** One reviewed Base deployment; persistent signed intent prevents duplicate mints. */
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createPublicClient,http,sha256,keccak256,formatEther,parseAbi,parseTransaction} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {base} from 'viem/chains';
import {estimateL1Fee} from 'viem/op-stack';
const tinyTest=process.argv.includes('--tiny-web3');
const crossTest=process.argv.includes('--cross-chain-comparison');
assert.ok(!(tinyTest&&crossTest),'Choose one test deployment');
const root='apps/desktop/artifacts/'+(crossTest?'base-web3-cross-chain-comparison':tinyTest?'base-web3-16x16-test':'gator-base-cross-chain-test');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=async(p,value,mode=0o644)=>{await writeFile(p+'.tmp',JSON.stringify(value,null,2),{mode});await rename(p+'.tmp',p);};
let phase='prepare';
try {
 const p=await json(root+'/preparation.json'),artifact=await json(root+'/compiled.json'),data=(await readFile(root+'/deployment-data.txt','utf8')).trim();
 assert.equal(p.localTestsPassed,true);assert.equal(p.targetChainId,8453);assert.equal(sha256(data),p.initDataDigest);
 const c=createPublicClient({chain:base,transport:http('https://mainnet.base.org',{timeout:20000,retryCount:1}),pollingInterval:2000});
 assert.equal(await c.getChainId(),8453);
 let intent;try{intent=await json(root+'/transaction.private.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!intent){
  const balance=await c.getBalance({address:p.recipient}),nonce=await c.getTransactionCount({address:p.recipient});
  assert.equal(nonce,await c.getTransactionCount({address:p.recipient,blockTag:'pending'}),'Existing wallet transaction is pending');
  const estimate=await c.estimateGas({account:p.recipient,data}),gas=(estimate*120n+99n)/100n,fees=await c.estimateFeesPerGas();
  const l1=await estimateL1Fee(c,{account:p.recipient,data}),operator=await c.readContract({address:'0x420000000000000000000000000000000000000F',abi:parseAbi(['function getOperatorFee(uint256) view returns(uint256)']),functionName:'getOperatorFee',args:[gas]});
  const maximum=gas*fees.maxFeePerGas+2n*(l1+operator);
  console.log(JSON.stringify({phase:'preflight',chainId:8453,balanceETH:formatEther(balance),maximumBudgetETH:formatEther(maximum),tokenCount:p.tests?.length??1,metadataChainId:p.metadataChainId}));
  assert.ok(maximum<=((tinyTest||crossTest)?20_000_000_000_000n:10_000_000_000_000n),'Quote exceeds this test deployment budget');assert.ok(balance>=maximum,'Waiting for sufficient Base ETH');
  const env=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8');
  const key=env.match(/^\s*(?:export\s+)?KEEL_DEPLOYER_PK\s*=\s*['"]?(0x[0-9a-fA-F]{64})['"]?\s*$/m)?.[1];assert.ok(key,'Configured signer unavailable');
  const account=privateKeyToAccount(key);assert.equal(account.address,p.recipient);
  const raw=await account.signTransaction({type:'eip1559',chainId:8453,nonce,data,value:0n,gas,...fees});
  intent={chainId:8453,hash:keccak256(raw),nonce,dataDigest:p.initDataDigest,raw,createdAt:new Date().toISOString()};
  await save(root+'/transaction.private.json',intent,0o600);
 }
 assert.equal(intent.chainId,8453);assert.equal(intent.dataDigest,p.initDataDigest);assert.equal(keccak256(intent.raw),intent.hash);
 const tx=parseTransaction(intent.raw);assert.equal(tx.chainId,8453);assert.equal(tx.data,data);assert.equal(tx.value??0n,0n);assert.equal(tx.to,undefined);
 await save(root+'/transaction.json',{chainId:8453,hash:intent.hash,nonce:intent.nonce,recipient:p.recipient,tokenId:0,tokenURI:p.tokenURI});
 phase='receipt';
 let receipt=await c.getTransactionReceipt({hash:intent.hash}).catch(()=>null);
 if(!receipt){
  try{assert.equal(await c.sendRawTransaction({serializedTransaction:intent.raw}),intent.hash);}catch(e){console.log(JSON.stringify({phase:'broadcast-check',hash:intent.hash,message:e.shortMessage??'Checking signed transaction receipt'}));}
  console.log(JSON.stringify({phase:'submitted',hash:intent.hash}));
  receipt=await c.waitForTransactionReceipt({hash:intent.hash,timeout:45000});
 }
 assert.equal(receipt.status,'success');assert.ok(receipt.contractAddress);
 phase='block-read';
 assert.ok(await c.getBlockNumber({cacheTime:0})>=receipt.blockNumber,'RPC state has not caught up with the deployment');
 const address=receipt.contractAddress,read=async(functionName,args=[])=>{
  // Public Base RPCs rate-limit rapid bursts of sequential contract reads.
  for(let attempt=0;attempt<3;attempt++){
   await new Promise(resolve=>setTimeout(resolve,attempt?1500:500));
   try{return await c.readContract({address,abi:artifact.abi,functionName,args});}
   catch(error){if(attempt===2)throw error;}
  }
 };
 phase='runtime-read';
 assert.equal(await c.getCode({address}),'0x'+artifact.evm.deployedBytecode.object,'Runtime differs from locally tested code');
 const tests=p.tests??[{tokenId:0,tokenURI:p.tokenURI}];
 phase='supply-read';
 assert.equal(await read('totalSupply'),BigInt(tests.length));
 for(const test of tests){
  phase='token-read:'+test.tokenId;
  assert.equal(await read('ownerOf',[BigInt(test.tokenId)]),p.recipient);
  assert.equal(await read('tokenURI',[BigInt(test.tokenId)]),test.tokenURI.replaceAll('{address}',address.toLowerCase()));
 }
 const l2=receipt.gasUsed*receipt.effectiveGasPrice,l1=BigInt(receipt.l1Fee??0);
 const resolvedTests=tests.map(test=>({...test,tokenURI:test.tokenURI.replaceAll('{address}',address.toLowerCase())}));
 const report={...p,tokenURI:resolvedTests[0].tokenURI,...(p.tests?{tests:resolvedTests}:{}),checkedAt:new Date().toISOString(),publicChainPublished:true,address,transactionHash:intent.hash,blockNumber:String(receipt.blockNumber),gasUsed:String(receipt.gasUsed),executionFeeETH:formatEther(l2),l1FeeETH:formatEther(l1),totalFeeETH:formatEther(l2+l1),owner:p.recipient,runtimeExact:true,tokenURIReadback:true,openSeaURL:`https://opensea.io/assets/base/${address}/0`,inspectorURL:`https://nftinspector.xyz/8453/${address}/0`};
 await save(root+'/publication.json',report);console.log(JSON.stringify(report));
}catch(e){console.error(JSON.stringify({phase,error:e.shortMessage??e.message}));process.exitCode=1;}
