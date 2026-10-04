/** Local-only KEEL raw storage and ERC-7617 direct-image proof. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,keccak256,toHex,hexToBytes,concatHex} from 'viem';
import {gatorStack} from '../../../packages/sdk/dist/gator-assembly.js';
const root='apps/desktop/artifacts/gator-sepolia',recovery='apps/desktop/artifacts/gator-recovery';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const compiled=await json(`${root}/compiled-original.json`),source=await json(`${root}/mainnet-source.json`);
const renderBuild=await json(`${root}/renderer-solc-output.json`);
if(renderBuild.errors?.some(e=>e.severity==='error'))throw Error(JSON.stringify(renderBuild.errors));
const rendererBuild=renderBuild.contracts['KeelGatorImageRenderer.sol'].KeelGatorImageRenderer;
const holdBuild=await json('/Users/ravonus/dev/keel-contracts/out/KeelHold.sol/KeelHold.json');
const child=spawn('anvil',['--port','0','--chain-id','31337','--prune-history'],{stdio:['ignore','pipe','pipe']});
try{
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Local EVM startup timed out')),20000);child.on('error',reject);child.on('exit',()=>reject(Error('Local EVM exited')));child.stdout.on('data',chunk=>{output+=chunk;const m=output.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const client=createPublicClient({transport:http(url,{timeout:60000})}),wallet=createWalletClient({transport:http(url,{timeout:60000})});assert.equal(await client.getChainId(),31337);const [account,other]=await wallet.getAddresses();
 const receipts=[];async function receipt(hash){const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');receipts.push({hash,gas:String(r.gasUsed)});return r;}
 async function deploy(abi,bytecode,args=[]){return (await receipt(await wallet.deployContract({account,chain:null,abi,bytecode,args}))).contractAddress;}
 async function write(address,abi,functionName,args){return receipt(await wallet.writeContract({account,chain:null,address,abi,functionName,args}));}
 const hold=await deploy(holdBuild.abi,holdBuild.bytecode.object);
 const collection=await deploy(compiled.abi,'0x'+compiled.evm.bytecode.object,source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v));
 await write(collection,compiled.abi,'ownerMint',[1,account]);
 const renderer=await deploy(rendererBuild.abi,'0x'+rendererBuild.evm.bytecode.object,[hold,collection,4000n,2160n]);
 const rows=await json(`${recovery}/png-2160.json`),{manifest}=await json('/tmp/keel-gator-original-manifest.json'),ids=await json(`${root}/source-data/ids.json`),metadata=await json(`${root}/source-data/metadata.json`);
 const selected=gatorStack(manifest.assembly,metadata[ids.find(r=>r['Token ID']===0).ID]).stack;
 const unique=new Map();const add=bytes=>{const id=keccak256(bytes);unique.set(id,bytes);return id;};
 const descriptors=[],expected=[];
 for(const part of selected){const row=rows.find(r=>r.path===part.path),bytes=await readFile(`${recovery}/png-2160/${row.file}`);expected.push(bytes);const chunks=[];for(let offset=0;offset<bytes.length;offset+=22998)chunks.push(add(bytes.subarray(offset,offset+22998)));descriptors.push(add(hexToBytes(concatHex(chunks))));}
 const recipe=add(hexToBytes(concatHex(descriptors)));
 const original=await json('/tmp/gator-token-0.json');const {image,...otherFields}=original;const prefix=JSON.stringify(otherFields).slice(0,-1)+',"image":"',suffix='"}';const prefixBytes=Buffer.from(prefix),length=Buffer.alloc(2);length.writeUInt16BE(prefixBytes.length);const meta=add(Buffer.concat([length,prefixBytes,Buffer.from(suffix)]));
 const chunks=[...unique.values()];for(let i=0;i<chunks.length;i+=3)await write(hold,holdBuild.abi,'castSlugs',[chunks.slice(i,i+3).map(toHex)]);
 await write(renderer,rendererBuild.abi,'setTokens',[0n,[{metadata:meta,recipe}]]);
 await write(collection,compiled.abi,'setTokenURISuffix',['']);await write(collection,compiled.abi,'setBaseURI',[`web3://${renderer}:31337/tokenJSON/`]);
 const read=(functionName,args)=>client.readContract({address:renderer,abi:rendererBuild.abi,functionName,args});
 const uri=await client.readContract({address:collection,abi:compiled.abi,functionName:'tokenURI',args:[0n]});assert.equal(uri,`web3://${renderer}:31337/tokenJSON/0`);
 const returned=JSON.parse(await read('tokenJSON',[0n]));assert.deepEqual({...returned,image},{...original});assert.equal(returned.image,`web3://${renderer.toLowerCase()}:31337/image/0`);
 let path=['image','0'],bodies=[],calls=0;const visited=new Set();let firstGas;
 while(path){const key=path.join('/');assert.ok(!visited.has(key));visited.add(key);const [status,body,headers]=await read('request',[path,[]]);assert.equal(status,200);assert.equal(headers.find(h=>h.key==='Content-Type').value,'image/svg+xml');if(calls===0)firstGas=String(await client.estimateContractGas({address:renderer,abi:rendererBuild.abi,functionName:'request',args:[path,[]]}));bodies.push(body);calls++;assert.ok(calls<1000);const next=headers.find(h=>h.key==='web3-next-chunk')?.value;path=next?next.split('/').filter(Boolean):null;}
 const svg=bodies.join('');const actual=[...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)].map(m=>Buffer.from(m[1],'base64'));assert.equal(actual.length,expected.length);actual.forEach((bytes,i)=>assert.deepEqual(bytes,expected[i]));assert.ok(svg.endsWith('</svg>'));assert.equal(svg.includes('<script'),false);
 await assert.rejects(()=>read('imageChunk',[4000n,0n,0n]));await assert.rejects(()=>read('imageChunk',[0n,99n,0n]));
 await assert.rejects(()=>client.simulateContract({account:other,address:renderer,abi:rendererBuild.abi,functionName:'setTokens',args:[0n,[{metadata:meta,recipe}]]}));
 await writeFile(`${root}/contract-token-0.svg`,svg);
 const proof={schema:'gator-direct-image-local-proof@1',localOnly:true,publicChainPublished:false,chainId:31337,hold,collection,renderer,tokenId:0,layerCount:expected.length,chunkCalls:calls,storedRawBytes:chunks.reduce((n,b)=>n+b.length,0),storedChunks:chunks.length,svgBytes:Buffer.byteLength(svg),firstResponseGas:firstGas,metadataPreservedExceptImage:true,exactPNGReconstruction:true,unauthorizedChangesRejected:true,invalidTokenAndLayerRejected:true,receipts};await writeFile(`${root}/direct-image-local-proof.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,receipts:undefined}));
}finally{child.kill('SIGTERM');}
