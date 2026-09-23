/** Disposable local EVM proof of the unchanged contract. Never broadcasts to a public RPC. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http} from 'viem';
const root='apps/desktop/artifacts/gator-sepolia';
const source=JSON.parse(await readFile(`${root}/mainnet-source.json`,'utf8'));
const compiled=JSON.parse(await readFile(`${root}/compiled-original.json`,'utf8'));
const child=spawn('anvil',['--port','0','--chain-id','31337','--prune-history'],{stdio:['ignore','pipe','pipe']});
try{
  const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Local EVM startup timed out')),20000);child.on('error',reject);child.on('exit',()=>reject(Error('Local EVM exited')));child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Listening on (127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve('http://'+match[1]);}});});
  const publicClient=createPublicClient({transport:http(url)}),wallet=createWalletClient({transport:http(url)});
  assert.equal(await publicClient.getChainId(),31337);const [account]=await wallet.getAddresses();
  const args=source.decoded_constructor_args.map(([value,type])=>type.type.startsWith('uint')?BigInt(value):value);
  const receipt=await publicClient.waitForTransactionReceipt({hash:await wallet.deployContract({account,chain:null,abi:compiled.abi,bytecode:'0x'+compiled.evm.bytecode.object,args})});
  assert.equal(receipt.status,'success');const address=receipt.contractAddress;
  const read=(functionName,args=[])=>publicClient.readContract({address,abi:compiled.abi,functionName,args});
  const receipts=[];async function write(functionName,args){const r=await publicClient.waitForTransactionReceipt({hash:await wallet.writeContract({account,chain:null,address,abi:compiled.abi,functionName,args})});assert.equal(r.status,'success');receipts.push({functionName,gasUsed:String(r.gasUsed),transactionHash:r.transactionHash});}
  // Preserve constructor behavior, then reproduce the observed live cap and URI configuration.
  await write('setMaxMintableSupply',[4000n]);
  const originalBase='ipfs://bafybeibpujaxcaofx3jbjuefivz7cmlbqutm2nggtapbbrxxnzjdmylzp4/';
  await write('setBaseURI',[originalBase]);await write('ownerMint',[1,account]);assert.equal(await read('tokenURI',[0n]),originalBase+'0.json');
  for(let minted=1;minted<4000;){const qty=Math.min(100,4000-minted);await write('ownerMint',[qty,account]);minted+=qty;}
  assert.equal(await read('totalSupply'),4000n);assert.equal(await read('ownerOf',[0n]),account);assert.equal(await read('ownerOf',[3999n]),account);
  const before=await read('tokenURI',[3999n]);
  // A syntactic URI update test; the image renderer is verified separately before public use.
  const testBase=`web3://${address}:11155111/tokenJSON/`;
  await write('setTokenURISuffix',['']);await write('setBaseURI',[testBase]);
  assert.equal(await read('tokenURI',[0n]),testBase+'0');assert.equal(await read('tokenURI',[3999n]),testBase+'3999');assert.equal(await read('totalSupply'),4000n);
  const proof={schema:'gator-original-clone-local-proof@1',chainId:31337,sourceModified:false,sourceAddress:'0x4fb7363cf6d0a546cc0ed8cc0a6c99069170a623',localAddress:address,localOwner:account,tokenRange:[0,3999],supply:4000,originalLastURI:before,updatedLastURI:await read('tokenURI',[3999n]),deployGas:String(receipt.gasUsed),receipts,proof:'local-original-contract-mint-and-uri-update-only',publicChainPublished:false,imageEndpointVerified:false};
  await writeFile(`${root}/local-clone-proof.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({supply:4000,firstToken:0,lastToken:3999,originalContract:true,uriUpdate:true,localOnly:true,deployGas:proof.deployGas,mintGas:receipts.filter(r=>r.functionName==='ownerMint').reduce((n,r)=>n+Number(r.gasUsed),0)}));
}finally{child.kill('SIGTERM');}
