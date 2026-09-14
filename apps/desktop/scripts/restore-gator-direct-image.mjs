/** Restore the creator-selected direct web3 image route. One Sepolia binding update. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,http,encodeFunctionData,keccak256,parseEther,formatEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const root='apps/desktop/artifacts/gator-sepolia',out=`${root}/jpeg-direct-restored`;
await mkdir(out,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const direct=await json(`${root}/jpeg-web3-compat/proof.json`),inline=await json(`${root}/jpeg-web3-compat-inline/proof.json`),original=await json(`${root}/compiled-original.json`),initial=await json(`${root}/jpeg-live/proof.json`);
const rpc='https://ethereum-sepolia-rpc.publicnode.com',chainId=11155111;
const c=createPublicClient({transport:http(rpc,{timeout:30000,retryCount:1})});
assert.equal(await c.getChainId(),chainId);
const collection=direct.collection,owner=initial.owner;
assert.equal((await c.readContract({address:collection,abi:original.abi,functionName:'owner'})).toLowerCase(),owner.toLowerCase());
const current=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});
assert.ok([inline.tokenURI,direct.tokenURI].includes(current),'Unexpected current URI; preserve external changes');
const {Client}=await import('/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js');
async function verify(uri){
 const client=new Client([{id:chainId,name:'Sepolia',rpcUrls:[rpc]}]);
 const m=await client.fetchUrl(uri);assert.equal(m.httpCode,200);assert.equal(m.httpHeaders['Content-Type'],'application/json');
 const metadata=Buffer.from(await new Response(m.output).arrayBuffer()),value=JSON.parse(metadata.toString());
 assert.equal(value.image,direct.imageURI);assert.ok(value.image.startsWith('web3://'));
 const old=await json(`${root}/jpeg-live/public-token-0.json`);assert.deepEqual({...value,image:old.image},old);
 const r=await client.fetchUrl(value.image);assert.equal(r.httpCode,200);assert.equal(r.httpHeaders['Content-Type'],'image/jpeg');
 const image=Buffer.from(await new Response(r.output).arrayBuffer());assert.equal(keccak256(image),initial.jpegDigest);
 return {metadata,value,image};
}
await verify(direct.tokenURI);
const data=encodeFunctionData({abi:original.abi,functionName:'setBaseURI',args:[direct.tokenURI.slice(0,-'0.json'.length)]});
const gas=await c.estimateGas({account:owner,to:collection,data}),fees=await c.estimateFeesPerGas(),gasLimit=gas*110n/100n,budget=parseEther('0.001');
assert.ok(gasLimit*fees.maxFeePerGas<=budget);
console.log(JSON.stringify({phase:'verified restoration plan',chainId,collection,imageURI:direct.imageURI,changes:'Only collection base URI; no deployments, uploads, or mints',maximumFeeETH:formatEther(gasLimit*fees.maxFeePerGas),alreadyRestored:current===direct.tokenURI}));
if(process.env.KEEL_RESTORE_DIRECT_EXECUTE!=='1')process.exit(0);
const journalPath=`${out}/journal.json`;let j;
try{j=await json(journalPath);}catch(e){if(e.code!=='ENOENT')throw e;}
const save=async()=>{await writeFile(`${journalPath}.tmp`,JSON.stringify(j,null,2),{mode:0o600});await rename(`${journalPath}.tmp`,journalPath);};
if(current!==direct.tokenURI || j){
 if(!j){
  const pending=await c.getTransactionCount({address:owner,blockTag:'pending'});assert.equal(pending,await c.getTransactionCount({address:owner,blockTag:'latest'}));
  assert.ok(await c.getBalance({address:owner})>=gasLimit*fees.maxFeePerGas);
  let account;try{const env=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8'),m=env.match(/^\s*(?:export\s+)?KEEL_DEPLOYER_PK\s*=\s*(.*?)\s*$/m);account=privateKeyToAccount(m[1].replace(/^(['"])(.*)\1$/,'$2'));}catch{throw Error('Cannot load existing deployer');}
  assert.equal(account.address.toLowerCase(),owner.toLowerCase());
  const raw=await account.signTransaction({type:'eip1559',chainId,nonce:pending,to:collection,data,value:0n,gas:gasLimit,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
  j={chainId,collection,dataDigest:keccak256(data),hash:keccak256(raw),raw};await save();
 }
 assert.equal(j.chainId,chainId);assert.equal(j.collection,collection);assert.equal(j.dataDigest,keccak256(data));
 let receipt;try{receipt=await c.getTransactionReceipt({hash:j.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
 if(!receipt){try{await c.request({method:'eth_sendRawTransaction',params:[j.raw]});}catch{console.log(JSON.stringify({phase:'reconcile',hash:j.hash}));}console.log(JSON.stringify({phase:'submitted',hash:j.hash}));receipt=await c.waitForTransactionReceipt({hash:j.hash,timeout:180000});}
 j.receipt={status:receipt.status,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash};j.paidWei=String(receipt.gasUsed*receipt.effectiveGasPrice);await save();assert.equal(receipt.status,'success');
}
const uri=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});assert.equal(uri,direct.tokenURI);
const {metadata,value,image}=await verify(uri);
await writeFile(`${out}/metadata.json`,metadata);await writeFile(`${out}/image.jpg`,image);
const proof={chainId,collection,tokenId:0,tokenURI:uri,imageURI:value.image,imageType:'image/jpeg',imageBytes:image.length,imageDigest:keccak256(image),metadataBytes:metadata.length,imageEmbeddedInJSON:false,byteExact:true,transactionHash:j?.hash??null,spentETH:formatEther(BigInt(j?.paidWei??0)),verifiedAt:new Date().toISOString()};
await writeFile(`${out}/proof.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({phase:'restored and verified',...proof}));
