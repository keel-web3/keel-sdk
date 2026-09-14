// Explicitly invoked integration check against a disposable local Anvil instance only.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {readKeelSVG} from '../packages/sdk/dist/svg-renderer.js';
import {previewSVGRenderer} from '../packages/sdk/dist/svg-renderer-authoring.js';
const root=process.argv[2];if(!root)throw Error('Pass isolated Foundry harness root.');
const client=createPublicClient({transport:http('http://127.0.0.1:18564')});assert.equal(await client.getChainId(),31337);
// Public Anvil fixture key, unrelated to application or user wallets.
const wallet=createWalletClient({transport:http('http://127.0.0.1:18564'),account:privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')});
async function deploy(file,name,args=[]){const a=JSON.parse(await readFile(path.join(root,'out',`${file}.sol`,`${name}.json`),'utf8'));const receipt=await client.waitForTransactionReceipt({hash:await wallet.deployContract({chain:null,abi:a.abi,bytecode:a.bytecode.object,args,gas:10_000_000n})});assert.equal(receipt.status,'success');return {address:receipt.contractAddress,abi:a.abi,gas:receipt.gasUsed.toString(),runtimeBytes:(a.deployedBytecode.object.length-2)/2};}
const nft=await deploy('SVGAuthoring.t','SVGAuthoringCollection');
assert.equal((await client.waitForTransactionReceipt({hash:await wallet.writeContract({chain:null,address:nft.address,abi:nft.abi,functionName:'mint',gas:2_000_000n})})).status,'success');
const fixtures=JSON.parse(await readFile(path.join(root,'artifacts/renderer-recipes.json'),'utf8'));
const renderers=[];for(const f of fixtures)renderers.push({...f,contract:await deploy(f.recipe.name,f.recipe.name,[nft.address])});
await client.request({method:'anvil_mine',params:['0x80']});
const checks=[];
for(const f of renderers){
 for(const tokenId of ['1','2','255']){
  const preview=previewSVGRenderer(f.recipe,tokenId),live=await readKeelSVG(client,{chainId:31337,address:f.contract.address,tokenId});
  assert.equal(live.artwork,preview.artwork);assert.equal(live.provenance.generation.seed,preview.seed);
  assert.equal(live.provenance.generation.source.toLowerCase(),nft.address.toLowerCase());assert.equal(live.provenance.proof,null);
  const gas=await client.estimateContractGas({address:f.contract.address,abi:f.contract.abi,functionName:'svg',args:[BigInt(tokenId)]});
  const image=await client.readContract({address:f.contract.address,abi:f.contract.abi,functionName:'imageURI',args:[BigInt(tokenId)]});assert.equal(decodeURIComponent(image.slice(image.indexOf(',')+1)),live.source);
  checks.push({preset:f.preset,tokenId,exactArtwork:true,exactSeed:true,proof:null,svgGas:gas.toString()});
 }
 await assert.rejects(readKeelSVG(client,{chainId:31337,address:f.contract.address,tokenId:'256'}));
}
const report={status:'PASS',network:'isolated-local-anvil',checks,renderers:renderers.map(f=>({preset:f.preset,...f.contract,abi:undefined})),missingTokensRejected:true,published:false};
await writeFile(path.join(root,'artifacts/svg-authoring-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
