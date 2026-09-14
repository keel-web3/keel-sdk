/** Test a manual-mode adapter on a Sepolia fork, then optionally publish the exact build.
 * KEEL_JPEG_COMPAT_EXECUTE=1 authorizes this specific three-transaction testnet repair.
 */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,encodeDeployData,encodeFunctionData,toHex,keccak256,formatEther,parseEther} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const inline=process.env.KEEL_JPEG_COMPAT_INLINE==='1';
if(inline && process.env.KEEL_JPEG_COMPAT_EXECUTE==='1')throw Error('The creator rejected embedding the image in JSON. Inline experiments are local-only; preserve the direct web3 JPEG route.');
const root='apps/desktop/artifacts/gator-sepolia',out=`${root}/jpeg-web3-compat${inline?'-inline':''}`;
await mkdir(out,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const previous=await json(`${root}/jpeg-live/proof.json`),original=await json(`${root}/compiled-original.json`);
const sourceAddress=previous.renderer,collection=previous.collection,owner=previous.owner;
const rpc='https://ethereum-sepolia-rpc.publicnode.com',chainId=11155111;
const client=createPublicClient({transport:http(rpc,{timeout:30000,retryCount:1})});
assert.equal(await client.getChainId(),chainId);
const name=inline?'KeelJpegInlineMetadataAdapter':'KeelJpegWeb3Adapter',filename=`${name}.sol`;
const names=inline?['KeelJpegWeb3Adapter.sol',filename]:[filename];
const sources=Object.fromEntries(await Promise.all(names.map(async n=>[n,{content:await readFile(`apps/desktop/contracts/${n}`,'utf8')}])));
if(inline)sources['Base64Test.sol']={content:'pragma solidity ^0.8.20; import "./KeelJpegInlineMetadataAdapter.sol"; contract Base64Test is KeelJpegInlineMetadataAdapter { constructor(address s) KeelJpegInlineMetadataAdapter(s) {} function encode(bytes memory b) external pure returns(string memory) { return _base64(b); } }'};
const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}};
const build=JSON.parse(solc.compile(JSON.stringify(input)));
assert.ok(!build.errors?.some(e=>e.severity==='error'),JSON.stringify(build.errors));
const adapter=build.contracts[filename][name];
const bytecode='0x'+adapter.evm.bytecode.object,init=encodeDeployData({abi:adapter.abi,bytecode,args:[sourceAddress]});
await writeFile(`${out}/solc-input.json`,JSON.stringify(input));await writeFile(`${out}/solc-output.json`,JSON.stringify(build));
const expected=await readFile(`${root}/jpeg-live/public-token-0.jpg`),oldMetadata=await json(`${root}/jpeg-live/public-token-0.json`);
const {Client}=await import('/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js');
async function verify(c,url,address,tokenURI){
 assert.equal(await c.readContract({address,abi:adapter.abi,functionName:'resolveMode'}),toHex('manual',{size:32}));
 const w3=new Client([{id:chainId,name:'Sepolia',rpcUrls:[url]}]);
 async function fetch(uri){const r=await w3.fetchUrl(uri);assert.equal(r.httpCode,200);return {bytes:Buffer.from(await new Response(r.output).arrayBuffer()),headers:r.httpHeaders};}
 const meta=await fetch(tokenURI),parsed=JSON.parse(meta.bytes.toString());
 assert.deepEqual({...parsed,image:oldMetadata.image},oldMetadata);
 const directImageURI=`web3://${address.toLowerCase()}:${chainId}/image/0.jpg`;
 if(inline)assert.equal(parsed.image,'data:image/jpeg;base64,'+expected.toString('base64'));
 else assert.equal(parsed.image,directImageURI);
 const image=await fetch(directImageURI);assert.deepEqual(image.bytes,expected);
 assert.equal(image.headers['Content-Type'],'image/jpeg');assert.equal(meta.headers['Content-Type'],'application/json');
 const imageGas=await c.estimateGas({to:address,data:toHex('/image/0.jpg'),gas:60_000_000n});
 const metadataGas=await c.estimateGas({to:address,data:toHex('/tokenJSON/0.json'),gas:60_000_000n});
 assert.ok(imageGas<60_000_000n);assert.ok(metadataGas<60_000_000n);
 return {tokenURI,imageURI:inline?'data:image/jpeg;base64,[generated on read]':parsed.image,directImageURI,metadataBytes:meta.bytes.length,imageBytes:image.bytes.length,imageDigest:keccak256(image.bytes),imageGas:String(imageGas),metadataGas:String(metadataGas),byteExact:true,metadataPreservedExceptImage:true,contentTypesCorrect:true,inlineImage:inline};
}
const forkBlock=await client.getBlockNumber();
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id',String(chainId),'--fork-url',rpc,'--fork-block-number',String(forkBlock),'--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});child.stderr.on('data',()=>{});
let local;
try {
 const url=await new Promise((resolve,reject)=>{let b='';const timer=setTimeout(()=>reject(Error('Local fork startup timed out')),45000);child.once('error',reject);child.once('exit',()=>reject(Error('Local fork exited')));child.stdout.on('data',part=>{b=(b+part).slice(-4096);const m=b.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url,{timeout:60000})}),wallet=createWalletClient({transport:http(url)});const[account]=await wallet.getAddresses();
 const receipt=async hash=>{const r=await c.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
 const deployed=await receipt(await wallet.deployContract({account,chain:null,abi:adapter.abi,bytecode,args:[sourceAddress]}));
 const address=deployed.contractAddress;
 if(inline){
  const test=build.contracts['Base64Test.sol'].Base64Test;
  const testAddress=(await receipt(await wallet.deployContract({account,chain:null,abi:test.abi,bytecode:'0x'+test.evm.bytecode.object,args:[sourceAddress]}))).contractAddress;
  for(let n=0;n<68;n++){const bytes=Buffer.from(Array.from({length:n},(_,i)=>(i*37+n*19)%256));assert.equal(await c.readContract({address:testAddress,abi:test.abi,functionName:'encode',args:[toHex(bytes)]}),bytes.toString('base64'));}
 }
 await c.request({method:'anvil_impersonateAccount',params:[owner]});
 for(const[functionName,args]of [['setTokenURISuffix',['.json']],['setBaseURI',[`web3://${address.toLowerCase()}:${chainId}/tokenJSON/`]]])await receipt(await wallet.writeContract({account:owner,chain:null,address:collection,abi:original.abi,functionName,args}));
 const tokenURI=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});
 local=await verify(c,url,address,tokenURI);
 for(const path of ['/','/image/0','/image/00.jpg','/image/-1.jpg','/image/a.jpg','/image/1.jpg','/image/99999999999.jpg','/image/0.jpg?x=1','/tokenJSON/1.json','/tokenJSON/0.json/extra'])await assert.rejects(()=>c.call({to:address,data:toHex(path),gas:60_000_000n}),e=>e.shortMessage?.includes('revert')||e.details?.includes('revert'));
 local={...local,chainFork:chainId,forkBlock:String(forkBlock),initHash:keccak256(init),deploymentGas:String(deployed.gasUsed),invalidPathsAndUnmintedTokensRejected:true,compiler:solc.version()};
 await writeFile(`${out}/local-proof.json`,JSON.stringify(local,null,2));console.log(JSON.stringify({phase:'local verified',...local}));
} finally {child.kill('SIGTERM');}
if(process.env.KEEL_JPEG_COMPAT_EXECUTE!=='1')process.exit(0);
// Existing creator authorization: repair the same Sepolia test, reusing every stored section.
const budget=parseEther('0.005'),journalPath=`${out}/journal.json`;
let journal;try{journal=await json(journalPath);}catch(e){if(e.code!=='ENOENT')throw e;journal={chainId,collection,sourceAddress,owner,initHash:keccak256(init),steps:{}};}
assert.equal(journal.initHash,keccak256(init));assert.equal(journal.collection,collection);assert.equal(journal.chainId,chainId);
const save=async()=>{await writeFile(`${journalPath}.tmp`,JSON.stringify(journal,null,2),{mode:0o600});await rename(`${journalPath}.tmp`,journalPath);};
const spent=()=>Object.values(journal.steps).reduce((a,s)=>a+BigInt(s.paidWei??0),0n);
const originalURI=await client.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});
if(!Object.keys(journal.steps).length)assert.equal(originalURI,inline?(await json(`${root}/jpeg-web3-compat/proof.json`)).tokenURI:previous.tokenURI);
assert.equal((await client.readContract({address:collection,abi:original.abi,functionName:'owner'})).toLowerCase(),owner.toLowerCase());
let account;try{const env=await readFile('/Users/ravonus/dev/keel-contracts/.env.deployer','utf8'),m=env.match(/^\s*(?:export\s+)?KEEL_DEPLOYER_PK\s*=\s*(.*?)\s*$/m);account=privateKeyToAccount(m[1].replace(/^(['"])(.*)\1$/,'$2'));}catch{throw Error('Could not load the existing KEEL deployer');}
assert.equal(account.address.toLowerCase(),owner.toLowerCase());
async function send(label,data,to){
 let s=journal.steps[label];
 if(s){assert.equal(s.dataDigest,keccak256(data));assert.equal(s.to,to??null);}
 if(s?.receipt){const r=await client.getTransactionReceipt({hash:s.hash});assert.equal(r.status,'success');assert.equal(r.blockHash,s.receipt.blockHash);return r;}
 if(!s){
  const pending=await client.getTransactionCount({address:owner,blockTag:'pending'}),confirmed=await client.getTransactionCount({address:owner,blockTag:'latest'});assert.equal(pending,confirmed);if(journal.nextNonce!==undefined)assert.equal(pending,journal.nextNonce);
  const gas=(await client.estimateGas({account:owner,data,...(to?{to}:{})}))*110n/100n,fees=await client.estimateFeesPerGas();assert.ok(gas<16_777_216n);assert.ok(spent()+gas*fees.maxFeePerGas<=budget);assert.ok(await client.getBalance({address:owner})>=gas*fees.maxFeePerGas);
  const raw=await account.signTransaction({type:'eip1559',chainId,nonce:pending,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas,value:0n,data,...(to?{to}:{})});
  s={hash:keccak256(raw),raw,nonce:pending,to:to??null,dataDigest:keccak256(data)};journal.steps[label]=s;await save();
 }
 let receipt;try{receipt=await client.getTransactionReceipt({hash:s.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
 if(!receipt){try{await client.request({method:'eth_sendRawTransaction',params:[s.raw]});}catch{console.log(JSON.stringify({phase:'reconcile',label,hash:s.hash}));}console.log(JSON.stringify({phase:'submitted',label,hash:s.hash}));receipt=await client.waitForTransactionReceipt({hash:s.hash,timeout:180000});}
 s.receipt={blockHash:receipt.blockHash,status:receipt.status,contractAddress:receipt.contractAddress};s.paidWei=String(receipt.gasUsed*receipt.effectiveGasPrice);journal.nextNonce=s.nonce+1;await save();assert.equal(receipt.status,'success');console.log(JSON.stringify({phase:'confirmed',label,hash:s.hash,spentETH:formatEther(spent())}));return receipt;
}
console.log(JSON.stringify({phase:'repair plan',chainId,collection,sourceAddress,owner,transactions:inline?2:3,newArtworkBytes:0,reusedPreparedPackageBytes:90433,maximumSpendETH:'0.005',initHash:keccak256(init),localImageGas:local.imageGas,localMetadataGas:local.metadataGas,inlineImage:inline}));
const address=(await send('deploy manual adapter',init)).contractAddress;
// Verify the live adapter before changing any collection URL.
await verify(client,rpc,address,`web3://${address.toLowerCase()}:${chainId}/tokenJSON/0.json`);
await send('set compatibility base URI',encodeFunctionData({abi:original.abi,functionName:'setBaseURI',args:[`web3://${address.toLowerCase()}:${chainId}/tokenJSON/`]}),collection);
if(!inline)await send('set JSON suffix',encodeFunctionData({abi:original.abi,functionName:'setTokenURISuffix',args:['.json']}),collection);
const tokenURI=await client.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});
const verified=await verify(client,rpc,address,tokenURI);
const proof={...verified,chainId,collection,sourceAddress,adapter:address,publicChainPublished:true,newArtworkBytes:0,spentETH:formatEther(spent()),transactions:Object.entries(journal.steps).map(([label,s])=>({label,hash:s.hash})),verifiedAt:new Date().toISOString(),inspectorVerified:false};
await writeFile(`${out}/proof.json`,JSON.stringify(proof,null,2));journal.status='verified';await save();console.log(JSON.stringify({phase:'public verified',...proof}));
