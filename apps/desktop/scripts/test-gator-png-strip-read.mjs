/** Local EVM read-cost measurement of an original Gator assembled from prepared PNG strips. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,keccak256,toHex,hexToBytes,concatHex,encodeFunctionData,decodeAbiParameters} from 'viem';
import {decodeRasterPNG,compilePNGStrips,assemblePNGStrips,verifyStripPNG,pngStripEnvelope} from '../../../packages/sdk/dist/raster-strips.js';
const root='apps/desktop/artifacts/gator-sepolia',out='apps/desktop/artifacts/gator-raster-study',json=async p=>JSON.parse(await readFile(p,'utf8'));
const compiled=await json(`${root}/compiled-original.json`),source=await json(`${root}/mainnet-source.json`),build=await json(`${root}/png-solc-output.json`),rendererBuild=build.contracts['KeelGatorPngReader.sol'].KeelGatorPngReader,holdBuild=await json('/Users/ravonus/dev/keel-contracts/out/KeelHold.sol/KeelHold.json');
const size=Number(process.env.KEEL_RASTER_SIZE||2160);if(![1080,2160].includes(size))throw Error('Unsupported test size');
const pixels=await decodeRasterPNG(await readFile(size===2160?`${root}/original-set-render/gator-1.png`:`${out}/canonical-1080.png`)),prepared=compilePNGStrips(pixels,16),expected=await assemblePNGStrips(prepared.recipe,async id=>prepared.chunks.get(id).bytes),{header,footer}=pngStripEnvelope(prepared.recipe);
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});
try{
 const url=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('EVM startup timeout')),20000);child.once('error',reject);child.once('exit',()=>reject(Error('EVM exited')));child.stdout.on('data',c=>{text+=c;const m=text.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const client=createPublicClient({transport:http(url,{timeout:60000})}),wallet=createWalletClient({transport:http(url,{timeout:60000})});assert.equal(await client.getChainId(),31337);const [account]=await wallet.getAddresses();
 async function receipt(hash){const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;}
 async function deploy(abi,bytecode,args=[]){return (await receipt(await wallet.deployContract({account,chain:null,abi,bytecode,args}))).contractAddress;}
 async function write(address,abi,functionName,args){return receipt(await wallet.writeContract({account,chain:null,address,abi,functionName,args}));}
 const hold=await deploy(holdBuild.abi,holdBuild.bytecode.object),collection=await deploy(compiled.abi,'0x'+compiled.evm.bytecode.object,source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v));await write(collection,compiled.abi,'ownerMint',[1,account]);
 const renderer=await deploy(rendererBuild.abi,'0x'+rendererBuild.evm.bytecode.object,[hold,collection,4000n,BigInt(size)]);
 const objects=new Map(),add=bytes=>{const id=keccak256(bytes);objects.set(id,bytes);return id;},refs=[];
 // Split within each prepared strip only when KEEL's storage limit requires it. Shared strips retain shared references.
 for(const part of [header,...prepared.recipe.strips.map(r=>prepared.chunks.get(r.digest).bytes),footer])for(let p=0;p<part.length;p+=23000)refs.push(add(part.subarray(p,p+23000)));
 const descriptor=add(hexToBytes(concatHex(refs))),prefix=Buffer.from('{"name":"TokenGator #0","image":"'),length=Buffer.alloc(2);length.writeUInt16BE(prefix.length);const metadata=add(Buffer.concat([length,prefix,Buffer.from('"}')]));
 let setupGas=0n;const chunks=[...objects.values()];for(let i=0;i<chunks.length;i+=3)setupGas+=(await write(hold,holdBuild.abi,'castSlugs',[chunks.slice(i,i+3).map(toHex)])).gasUsed;
 await write(renderer,rendererBuild.abi,'setTokens',[0n,[{metadata,png:descriptor}]]);
 let next=['image','0'],bodies=[],gas=[],wireBytes=0;const start=Date.now();
 while(next){const data=encodeFunctionData({abi:rendererBuild.abi,functionName:'request',args:[next,[]]});const response=await client.call({to:renderer,data});wireBytes+=(response.data.length-2)/2;
  // string and bytes have identical ABI layouts. Decode as bytes to preserve arbitrary PNG octets.
  const [status,body,headers]=decodeAbiParameters([{type:'uint16'},{type:'bytes'},{type:'tuple[]',components:[{name:'key',type:'string'},{name:'value',type:'string'}]}],response.data);assert.equal(status,200);assert.equal(headers.find(h=>h.key==='Content-Type').value,'image/png');bodies.push(hexToBytes(body));gas.push(Number(await client.estimateGas({to:renderer,data})));
  const follow=headers.find(h=>h.key==='web3-next-chunk')?.value;next=follow?follow.split('/').filter(Boolean):null;assert.ok(gas.length<719);
 }
 const actual=Buffer.concat(bodies);assert.deepEqual(actual,expected);verifyStripPNG(actual,pixels);
 let singleCall;
 try{const data=encodeFunctionData({abi:rendererBuild.abi,functionName:'pngImage',args:[0n]}),estimated=await client.estimateGas({to:renderer,data,gas:60_000_000n}),response=await client.call({to:renderer,data,gas:60_000_000n});const [body]=decodeAbiParameters([{type:'bytes'}],response.data);assert.deepEqual(Buffer.from(hexToBytes(body)),expected);singleCall={gas:Number(estimated),under60Million:estimated<60_000_000n,exactBytes:true};}catch(e){singleCall={under60Million:false,error:e.shortMessage??e.message};}
 const report={singleCall,localOnly:true,publicChainPublished:false,tokenId:0,resolution:[size,size],pngBytes:actual.length,stripRows:16,strips:prepared.recipe.strips.length,rpcCalls:gas.length,responseABIBytes:wireBytes,estimatedJSONHexBytes:wireBytes*2,minGasPerRead:Math.min(...gas),maxGasPerRead:Math.max(...gas),sumGasAcrossReads:gas.reduce((a,b)=>a+b,0),localReadAndEstimateSeconds:(Date.now()-start)/1000,uniqueStorageBytes:chunks.reduce((n,b)=>n+b.length,0),localStorageTransactionGas:String(setupGas),exactCanonicalPreviewPixels:true,readMode:'ERC-7617 chunked binary PNG from prepared reusable strip references',publicRPCAndMarketplaceCompatibility:'not-tested'};
 await writeFile(`${out}/read-cost-batched-${size}.json`,JSON.stringify(report,null,2));await writeFile(`${out}/contract-token-0-${size}.png`,actual);console.log(JSON.stringify(report,null,2));
}finally{child.kill('SIGTERM');}
