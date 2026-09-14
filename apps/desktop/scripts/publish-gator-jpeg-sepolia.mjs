/** Resumable, budget-capped Sepolia token-0 proof using the existing KEEL deployer.
 * Default is read-only planning. Never targets mainnet or exports key material.
 */
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,http,keccak256,toHex,hexToBytes,encodeFunctionData,encodeDeployData,formatEther,parseEther,decodeAbiParameters} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const execute=process.env.KEEL_GATOR_JPEG_EXECUTE==='1';
const root='apps/desktop/artifacts/gator-sepolia/jpeg-token0-package',out='apps/desktop/artifacts/gator-sepolia/jpeg-live';
await mkdir(out,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const pack=await json(`${root}/report.json`),proof=await json(`${root}/storage-test-sepolia-hold/proof.json`);
assert.equal(pack.exactJPEGBytes,true);assert.equal(proof.allImagesByteExact,true);assert.equal(proof.under60MillionEveryTestedImage,true);
const reader=(await json(`${root}/storage-test-sepolia-hold/solc-output.json`)).contracts['KeelJpegCopyReader.sol'].KeelJpegCopyReader;
assert.equal(keccak256('0x'+reader.evm.bytecode.object),proof.readerBytecodeHash);
const original=await json('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),source=await json('apps/desktop/artifacts/gator-sepolia/mainnet-source.json');
const holdBuild=await json('apps/desktop/artifacts/gator-sepolia/sepolia-hold-build.json');
const hold='0x0a4f31d5ab08029e4c68f6f3227d9fa3a2d66267',chainId=11155111,rpc='https://ethereum-sepolia-rpc.publicnode.com';
const signerAddress='0x5E2a993c132A6869b9e636D139E1Ba698F7918F0',budget=parseEther('0.045');
const c=createPublicClient({transport:http(rpc,{timeout:60000,retryCount:1}),pollingInterval:2000});
assert.equal(await c.getChainId(),chainId);assert.equal(await c.getCode({address:hold}),holdBuild.deployedBytecode.object);
const codec=await readFile(`${root}/codec.bin`),map=await readFile(`${root}/token-0.map`),ranges=await readFile(`${root}/instruction-ranges.bin`),expected=await readFile(`${root}/preview-0.jpg`);
assert.equal(keccak256(expected),pack.imageDigest);
const data=[];for(let i=0;i<Math.ceil(pack.dataBytes/23000);i++)data.push(await readFile(`${root}/data/${i}.bin`));
const instructions=await readFile(`${root}/instructions/0.bin`);
const metadata=await json('apps/desktop/artifacts/gator-sepolia/metadata-bafybeibpujaxcaofx3jbjuefivz7cmlbqutm2nggtapbbrxxnzjdmylzp4/0.json');
const{image,...rest}=metadata,prefix=Buffer.from(JSON.stringify(rest).slice(0,-1)+',"image":"'),length=Buffer.alloc(2);length.writeUInt16BE(prefix.length);const envelope=Buffer.concat([length,prefix,Buffer.from('"}')] );
const sourceCommitment=keccak256(Buffer.concat([codec,map,ranges,...data,instructions,envelope,Buffer.from(original.evm.bytecode.object,'hex'),Buffer.from(reader.evm.bytecode.object,'hex')]));
const journalPath=`${out}/journal.json`;let journal;
try{journal=await json(journalPath);}catch(e){if(e.code!=='ENOENT')throw e;journal={schema:'gator-jpeg-sepolia-journal@1',chainId,signer:signerAddress,sourceCommitment,budgetWei:String(budget),steps:{},createdAt:new Date().toISOString()};}
assert.equal(journal.chainId,chainId);assert.equal(journal.signer,signerAddress);assert.equal(journal.sourceCommitment,sourceCommitment);
async function save(){await writeFile(`${journalPath}.tmp`,JSON.stringify(journal,null,2),{mode:0o600});await rename(`${journalPath}.tmp`,journalPath);}
const[balance,fees,pending,confirmed]=await Promise.all([c.getBalance({address:signerAddress}),c.estimateFeesPerGas(),c.getTransactionCount({address:signerAddress,blockTag:'pending'}),c.getTransactionCount({address:signerAddress,blockTag:'latest'})]);
const spent=()=>Object.values(journal.steps).reduce((n,s)=>n+BigInt(s.feePaidWei||0),0n);
const localGas=Object.values(proof.gasByPhase).reduce((a,b)=>a+b,0)-Number(proof.receipts[0].gasUsed);
// Reuse Sepolia's existing Hold; add ten percent to the remaining measured local setup gas.
const conservativeGas=BigInt(Math.ceil(localGas*1.10)),quote=conservativeGas*fees.maxFeePerGas;
const plan={chainId,signer:signerAddress,recipient:signerAddress,hold,sourceCommitment,quality:85,resolution:[1080,1080],tokenId:0,preparedPackageBytes:pack.preparedBinaryBytes,expectedJPEGBytes:expected.length,localTestGas:localGas,conservativeGas:String(conservativeGas),feeQuoteAt:new Date().toISOString(),maxFeePerGas:String(fees.maxFeePerGas),maxPriorityFeePerGas:String(fees.maxPriorityFeePerGas),conservativeFeeETH:formatEther(quote),maximumSpendETH:formatEther(budget),balanceETH:formatEther(balance),pendingNonce:pending,confirmedNonce:confirmed,steps:'Deploy original-design clone and KJC1 reader; upload exact shared sections and directories to existing Hold; register token-0 program and original metadata; mint one token to deployer; update clone URI; public byte readback.',rawCarrierPayloads:'binary only; no Base64 artwork objects',full128LibraryPublished:false,mainnetChanges:false};await writeFile(`${out}/plan.json`,JSON.stringify(plan,null,2));console.log(JSON.stringify({phase:'plan',...plan}));
if(!execute)process.exit(0);
if(Object.keys(journal.steps).length===0){assert.equal(pending,confirmed,'Existing deployer transaction pending; resolve it first');assert.ok(quote<=budget,'Fee quote exceeds fixed test budget');assert.ok(balance>=budget,'Insufficient test balance');journal.nextNonce=pending;await save();}
let account;
try {const text=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8'),env={};for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}account=privateKeyToAccount(env.KEEL_DEPLOYER_PK);}catch{throw Error('Unable to load the configured KEEL deployer');}
assert.equal(account.address,signerAddress);
async function transact(label,data,to){
 let step=journal.steps[label];
 if(step?.receipt){const receipt=await c.getTransactionReceipt({hash:step.hash});assert.equal(receipt.status,'success');assert.equal(receipt.blockHash,step.receipt.blockHash);return receipt;}
 if(!step){assert.equal(await c.getChainId(),chainId);assert.equal(await c.getTransactionCount({address:signerAddress,blockTag:'pending'}),journal.nextNonce,'Deployer nonce changed outside this job');const estimated=await c.estimateGas({account:signerAddress,data,...(to?{to}:{})}),gas=(estimated*110n+99n)/100n;assert.ok(gas<=16_777_216n,'Split this upload into smaller transactions');const live=await c.estimateFeesPerGas();const maxFeePerGas=live.maxFeePerGas,maxPriorityFeePerGas=live.maxPriorityFeePerGas;assert.ok(spent()+gas*maxFeePerGas<=budget,'Remaining fixed test budget is insufficient');assert.ok(await c.getBalance({address:signerAddress})>=gas*maxFeePerGas,'Insufficient signer balance');const transaction={type:'eip1559',chainId,nonce:journal.nextNonce,gas,maxFeePerGas,maxPriorityFeePerGas,value:0n,data,...(to?{to}:{})};const raw=await account.signTransaction(transaction);step={hash:keccak256(raw),raw,nonce:transaction.nonce,to:to??null,dataDigest:keccak256(data),calldata:data,gasLimit:String(gas),maxFeePerGas:String(maxFeePerGas),signedAt:new Date().toISOString()};journal.steps[label]=step;await save();}
 assert.equal(step.dataDigest,keccak256(data));assert.equal(step.to,to??null);
 let receipt;try{receipt=await c.getTransactionReceipt({hash:step.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
 if(!receipt){try{await c.request({method:'eth_sendRawTransaction',params:[step.raw]});}catch{console.log(JSON.stringify({phase:'reconcile submitted hash',label,hash:step.hash}));}console.log(JSON.stringify({phase:'submitted',label,hash:step.hash}));receipt=await c.waitForTransactionReceipt({hash:step.hash,timeout:180000,confirmations:1});}
 step.receipt={blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,status:receipt.status,contractAddress:receipt.contractAddress};step.feePaidWei=String(receipt.gasUsed*receipt.effectiveGasPrice);step.gasUsed=String(receipt.gasUsed);journal.nextNonce=step.nonce+1;await save();assert.equal(receipt.status,'success',`${label} reverted`);console.log(JSON.stringify({phase:'confirmed',label,hash:step.hash,gasUsed:step.gasUsed,spentETH:formatEther(spent())}));return receipt;
}
const args=source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v);
const collection=(await transact('deploy collection',encodeDeployData({abi:original.abi,bytecode:'0x'+original.evm.bytecode.object,args}))).contractAddress;
const renderer=(await transact('deploy JPEG reader',encodeDeployData({abi:reader.abi,bytecode:'0x'+reader.evm.bytecode.object,args:[hold,collection,toHex(codec)]}))).contractAddress;
journal.collection=collection;journal.renderer=renderer;await save();
assert.equal((await c.readContract({address:collection,abi:original.abi,functionName:'owner'})).toLowerCase(),signerAddress.toLowerCase());
assert.equal((await c.readContract({address:renderer,abi:reader.abi,functionName:'owner'})).toLowerCase(),signerAddress.toLowerCase());
assert.equal(await c.readContract({address:renderer,abi:reader.abi,functionName:'codec'}),toHex(codec));
const pointers=new Map();
async function verify(b){const slug=keccak256(b),p=await c.readContract({address:hold,abi:holdBuild.abi,functionName:'slugPointer',args:[slug]});if(p==='0x0000000000000000000000000000000000000000')return false;assert.equal(await c.getCode({address:p}),'0x00'+b.toString('hex'));pointers.set(slug,p);return true;}
async function upload(label,buffers){for(let i=0;i<buffers.length;i+=2){const batch=buffers.slice(i,i+2),missing=[];for(const b of batch)if(!await verify(b))missing.push(b);const key=`${label} ${i/2}`;if(missing.length||journal.steps[key]){const callData=journal.steps[key]?.calldata??encodeFunctionData({abi:holdBuild.abi,functionName:'castSlugs',args:[missing.map(toHex)]});await transact(key,callData,hold);}for(const b of batch)assert.ok(await verify(b));}return buffers.map(b=>keccak256(b));}
// Stable batch content is retained even when every slug already exists after a resumed transaction.
const dataSlugs=await upload('image data',data),instructionSlugs=await upload('instructions',[instructions]);
const dataAddresses=Buffer.concat(dataSlugs.map(s=>Buffer.from(hexToBytes(pointers.get(s))))),instructionAddresses=Buffer.from(hexToBytes(pointers.get(instructionSlugs[0])));
const dynamic=[dataAddresses,instructionAddresses,ranges,map,envelope,codec];
const slugs=await upload('directories maps metadata',dynamic);
async function write(label,address,abi,functionName,args){return transact(label,encodeFunctionData({abi,functionName,args}),address);}
for(const[kind,slug]of [[0,slugs[0]],[2,slugs[1]],[3,slugs[2]]]){await write(`register directory ${kind}`,renderer,reader.abi,'registerDirectory',[kind,[0n],[slug]]);assert.equal((await c.readContract({address:renderer,abi:reader.abi,functionName:'directories',args:[kind,0n]})).toLowerCase(),pointers.get(slug).toLowerCase());}
await write('register token program',renderer,reader.abi,'registerToken',[0n,[slugs[3]],BigInt(map.length/codec[5]),BigInt(expected.length)]);
await write('register original metadata',renderer,reader.abi,'registerMetadata',[0n,slugs[4]]);
await write('original supply cap',collection,original.abi,'setMaxMintableSupply',[4000n]);
await write('mint test token zero',collection,original.abi,'ownerMint',[1,signerAddress]);
await write('clear original URI suffix',collection,original.abi,'setTokenURISuffix',['']);
const baseURI=`web3://${renderer.toLowerCase()}:11155111/tokenJSON/`;
await write('set JPEG metadata route',collection,original.abi,'setBaseURI',[baseURI]);
assert.equal(await c.readContract({address:collection,abi:original.abi,functionName:'totalSupply'}),1n);
assert.equal((await c.readContract({address:collection,abi:original.abi,functionName:'ownerOf',args:[0n]})).toLowerCase(),signerAddress.toLowerCase());
const tokenURI=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});assert.equal(tokenURI,baseURI+'0');
const modulePath=process.env.KEEL_WEB3_CLIENT_MODULE||'/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js';const{Client}=await import(modulePath);const w3=new Client([{id:chainId,name:'Ethereum Sepolia',rpcUrls:[rpc]}]);
async function fetchURI(uri){const r=await w3.fetchUrl(uri);assert.equal(r.httpCode,200);return{bytes:Buffer.from(await new Response(r.output).arrayBuffer()),headers:r.httpHeaders};}
const meta=await fetchURI(tokenURI),returned=JSON.parse(meta.bytes.toString());assert.deepEqual({...returned,image},metadata);assert.equal(returned.image,`web3://${renderer.toLowerCase()}:11155111/image/0`);const result=await fetchURI(returned.image);assert.equal(result.headers['Content-Type'],'image/jpeg');assert.deepEqual(result.bytes,expected);
const callData=encodeFunctionData({abi:reader.abi,functionName:'image',args:[0n,0n,1_000_000n]}),single=await c.call({to:renderer,data:callData,gas:60_000_000n});const[body,next]=decodeAbiParameters([{type:'bytes'},{type:'uint256'}],single.data);assert.equal(next,0n);assert.equal(body,toHex(expected));const readGas=await c.estimateGas({to:renderer,data:callData,gas:60_000_000n});assert.ok(readGas<60_000_000n);
await writeFile(`${out}/public-token-0.jpg`,result.bytes);await writeFile(`${out}/public-token-0.json`,JSON.stringify(returned,null,2));
const evidence={schema:'gator-jpeg-sepolia-proof@1',publicChainPublished:true,chainId,hold,collection,renderer,owner:signerAddress,tokenId:0,quality:85,width:1080,height:1080,tokenURI,imageURI:returned.image,jpegBytes:result.bytes.length,jpegDigest:keccak256(result.bytes),exactJPEGReadback:true,metadataPreservedExceptImage:true,independentClient:'web3protocol@0.6.3',singleCallGas:String(readGas),transactionCount:Object.keys(journal.steps).length,spentETH:formatEther(spent()),verifiedAt:new Date().toISOString(),full128LibraryPublished:false,marketplaceIndexing:'not verified'};await writeFile(`${out}/proof.json`,JSON.stringify(evidence,null,2));journal.status='verified';await save();console.log(JSON.stringify({phase:'verified',...evidence}));
