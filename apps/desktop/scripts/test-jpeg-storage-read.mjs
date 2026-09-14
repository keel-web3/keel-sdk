/** Isolated local EVM: actual KEEL storage, original collection, and JPEG web3 image reads. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import solc from 'solc';
import {createPublicClient,createWalletClient,http,toHex,keccak256,hexToBytes,encodeFunctionData,decodeAbiParameters} from 'viem';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../../../packages/studio-core/package.json',import.meta.url))('sharp');
const quality=Number(process.env.KEEL_JPEG_QUALITY||85);
const base='apps/desktop/artifacts/gator-raster-study',gators='apps/desktop/artifacts/gator-sepolia';
const root=process.env.KEEL_JPEG_PACKAGE_ROOT||`${base}/full-1080/jpeg-shared-huffman-q${quality}-r2/substrings-24/overlap-packed/compact`;
const out=`${root}/storage-test${process.env.KEEL_JPEG_HOLD_BUILD?'-sepolia-hold':''}`;await mkdir(out,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const packageReport=await json(`${root}/report.json`),ids=packageReport.tokenIds??await json('apps/desktop/artifacts/gator-raster-study/sample-ids.json');
const localMintCount=process.env.KEEL_JPEG_PACKAGE_ROOT?Math.max(...ids)+1:4000;
const names=['KeelSharedRasterReader.sol','KeelJpegCopyReader.sol'];
const sources=Object.fromEntries(await Promise.all(names.map(async n=>[n,{content:await readFile(`apps/desktop/contracts/${n}`,'utf8')}])));
const build=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
assert.ok(!build.errors?.some(e=>e.severity==='error'),JSON.stringify(build.errors));
await writeFile(`${out}/solc-output.json`,JSON.stringify(build));
const readerBuild=build.contracts['KeelJpegCopyReader.sol'].KeelJpegCopyReader;
assert.ok(readerBuild.evm.deployedBytecode.object.length/2<=24576);
const holdBuild=await json(process.env.KEEL_JPEG_HOLD_BUILD||'/Users/ravonus/dev/keel-contracts/out/KeelHold.sol/KeelHold.json');
const originalBuild=await json(`${gators}/compiled-original.json`),originalSource=await json(`${gators}/mainnet-source.json`);
const codec=await readFile(`${root}/codec.bin`),pw=codec[4],iw=codec[5],ow=codec[6];
const loadPages=async kind=>new Map(await Promise.all((await readdir(`${root}/${kind}`)).filter(p=>p.endsWith('.bin')).map(async p=>[Number(p.slice(0,-4)),await readFile(`${root}/${kind}/${p}`)])));
const data=await loadPages('data'),instructions=await loadPages('instructions'),catalog=await readFile(`${root}/instruction-ranges.bin`);
function expectedImage(map){const parts=[];for(let at=0;at<map.length;at+=iw){const id=map.readUIntBE(at,iw),p=catalog.readUInt16BE(id*6),o=catalog.readUInt16BE(id*6+2),n=catalog.readUInt16BE(id*6+4);const ops=instructions.get(p).subarray(o,o+n);for(let j=0;j<ops.length;j+=ow){const p=ops.readUIntBE(j,pw),o=ops.readUInt16BE(j+pw),n=ops.readUInt16BE(j+pw+2);parts.push(data.get(p).subarray(o,o+n));}}return Buffer.concat(parts);}
const maps=new Map(),images=new Map();for(const id of ids){const map=await readFile(`${root}/token-${id}.map`);maps.set(id,map);images.set(id,expectedImage(map));}
 const originals=new Map(),metadataBuffers=[],metadataIds=[];
 for(const id of ids){let original;try{original=await json(`${gators}/metadata-bafybeibpujaxcaofx3jbjuefivz7cmlbqutm2nggtapbbrxxnzjdmylzp4/${id}.json`);}catch(error){if(error.code==='ENOENT')continue;throw error;}metadataIds.push(id);originals.set(id,original);const{image,...rest}=original;const prefix=Buffer.from(JSON.stringify(rest).slice(0,-1)+',"image":"'),n=Buffer.alloc(2);n.writeUInt16BE(prefix.length);metadataBuffers.push(Buffer.concat([n,prefix,Buffer.from('"}')]));}
assert.ok(originals.has(0),'Original token 0 metadata required for the URI replacement proof');
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});child.stderr.on('data',()=>{});
try {
 const url=await new Promise((resolve,reject)=>{let out='';const timer=setTimeout(()=>reject(Error('Local EVM startup timed out')),20000);child.once('error',reject);child.once('exit',()=>reject(Error('Local EVM exited')));child.stdout.on('data',b=>{out=(out+b).slice(-4096);const m=out.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
 const client=createPublicClient({transport:http(url,{timeout:60000})}),wallet=createWalletClient({transport:http(url,{timeout:60000})});assert.equal(await client.getChainId(),31337);const[account,other]=await wallet.getAddresses();
 const receipts=[];let phase='deploy';
 async function receipt(hash){const r=await client.waitForTransactionReceipt({hash,timeout:60000});assert.equal(r.status,'success');receipts.push({phase,hash,gasUsed:String(r.gasUsed)});return r;}
 async function deploy(abi,bytecode,args=[]){return(await receipt(await wallet.deployContract({account,chain:null,abi,bytecode,args}))).contractAddress;}
 async function write(address,abi,functionName,args){return receipt(await wallet.writeContract({account,chain:null,address,abi,functionName,args}));}
 const hold=await deploy(holdBuild.abi,holdBuild.bytecode.object);
 if(holdBuild.provenance)assert.equal(await client.getCode({address:hold}),holdBuild.deployedBytecode.object);
 const collection=await deploy(originalBuild.abi,'0x'+originalBuild.evm.bytecode.object,originalSource.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v));
 const renderer=await deploy(readerBuild.abi,'0x'+readerBuild.evm.bytecode.object,[hold,collection,toHex(codec)]);
 phase='local original collection mint';await write(collection,originalBuild.abi,'setMaxMintableSupply',[4000n]);for(let i=0;i<localMintCount;i+=100)await write(collection,originalBuild.abi,'ownerMint',[Math.min(100,localMintCount-i),account]);
 const pointers=new Map(),stored=new Map();
 async function upload(buffers,label){phase=label;const unique=[...new Map(buffers.map(b=>[keccak256(b),b])).entries()].filter(([slug])=>!pointers.has(slug));
  for(let at=0;at<unique.length;at+=3){const batch=unique.slice(at,at+3);await write(hold,holdBuild.abi,'castSlugs',[batch.map(([,b])=>toHex(b))]);for(const[slug,b]of batch){const p=await client.readContract({address:hold,abi:holdBuild.abi,functionName:'slugPointer',args:[slug]});const code=await client.getCode({address:p});assert.equal(code,'0x00'+b.toString('hex'));pointers.set(slug,p);stored.set(slug,{bytes:b.length,label});}if(at%90===0)console.log(JSON.stringify({phase:label,done:Math.min(at+3,unique.length),total:unique.length}));}
  return buffers.map(b=>keccak256(b));
 }
 const dataIds=[...data.keys()].sort((a,b)=>a-b),instructionIds=[...instructions.keys()].sort((a,b)=>a-b);
 const dataSlugs=await upload(dataIds.map(i=>data.get(i)),'JPEG shared bytes'),instructionSlugs=await upload(instructionIds.map(i=>instructions.get(i)),'JPEG shared instructions');
 async function directories(kind,indexes,buffers){const slugs=await upload(buffers,`directory ${kind}`);phase='register directory';for(let i=0;i<indexes.length;i+=100)await write(renderer,readerBuild.abi,'registerDirectory',[kind,indexes.slice(i,i+100).map(BigInt),slugs.slice(i,i+100)]);}
 async function addresses(kind,indexes,slugs){const p=new Map(indexes.map((id,i)=>[id,pointers.get(slugs[i])])),max=Math.max(...indexes),pages=[];for(let first=0;first<=max;first+=1150){const b=Buffer.alloc(Math.min(1150,max+1-first)*20);for(let i=0;i<b.length/20;i++)if(p.has(first+i))b.set(hexToBytes(p.get(first+i)),i*20);pages.push(b);}await directories(kind,pages.map((_,i)=>i),pages);}
 await addresses(0,dataIds,dataSlugs);await addresses(2,instructionIds,instructionSlugs);
 const rangePages=[];for(let i=0;i<catalog.length;i+=22998)rangePages.push(catalog.subarray(i,i+22998));await directories(3,rangePages.map((_,i)=>i),rangePages);
 await upload([codec],'codec descriptor');

 const metaSlugs=await upload(metadataBuffers,'original metadata envelopes');
 await upload([...maps.values()],'token assembly maps');
 phase='register tokens';for(let i=0;i<ids.length;i++){const id=ids[i],map=maps.get(id);assert.ok(map.length<=23000);await write(renderer,readerBuild.abi,'registerToken',[BigInt(id),[keccak256(map)],BigInt(map.length/iw),BigInt(images.get(id).length)]);if(originals.has(id))await write(renderer,readerBuild.abi,'registerMetadata',[BigInt(id),metaSlugs[metadataIds.indexOf(id)]]);}
 phase='collection URI update';await write(collection,originalBuild.abi,'setTokenURISuffix',['']);await write(collection,originalBuild.abi,'setBaseURI',[`web3://${renderer.toLowerCase()}:31337/tokenJSON/`]);
 const abi=readerBuild.abi;
 const call=async(name,args)=>{const data=encodeFunctionData({abi,functionName:name,args});const response=await client.call({to:renderer,data,gas:60_000_000n});return{data,response};};
 const shape=[{type:'uint16'},{type:'bytes'},{type:'tuple[]',components:[{name:'key',type:'string'},{name:'value',type:'string'}]}];
 // Start from the actual tokenURI, including resolveMode, rather than assuming a renderer address.
 async function fetchWeb3(uri){const m=uri.match(/^web3:\/\/(0x[0-9a-f]{40}):31337\/(.*)$/);assert.ok(m);assert.equal(m[1],renderer.toLowerCase());assert.equal(await client.readContract({address:m[1],abi,functionName:'resolveMode'}),toHex('5219',{size:32}));let path=m[2].split('/'),parts=[],gas=[],headers,visited=new Set();while(path){assert.ok(!visited.has(path.join('/')));visited.add(path.join('/'));const{data,response}=await call('request',[path,[]]);const[status,body,h]=decodeAbiParameters(shape,response.data);assert.equal(status,200);if(headers)assert.equal(h[0].value,headers[0].value);headers=h;parts.push(Buffer.from(hexToBytes(body)));gas.push(Number(await client.estimateGas({to:renderer,data,gas:60_000_000n})));const next=h.find(v=>v.key==='web3-next-chunk')?.value;path=next?next.split('/').filter(Boolean):null;assert.ok(gas.length<1000);}return{bytes:Buffer.concat(parts),gas,headers};}
 const measurements=[];
 for(const id of ids){const tokenURI=await client.readContract({address:collection,abi:originalBuild.abi,functionName:'tokenURI',args:[BigInt(id)]});assert.equal(tokenURI,`web3://${renderer.toLowerCase()}:31337/tokenJSON/${id}`);let metadataGas=null,imageURI=`web3://${renderer.toLowerCase()}:31337/image/${id}`;if(originals.has(id)){const meta=await fetchWeb3(tokenURI);assert.equal(meta.headers[0].value,'application/json');const returned=JSON.parse(meta.bytes.toString());assert.deepEqual({...returned,image:originals.get(id).image},originals.get(id));metadataGas=meta.gas.reduce((a,b)=>a+b,0);imageURI=returned.image;}const response=await fetchWeb3(imageURI);assert.equal(response.headers[0].value,'image/jpeg');assert.deepEqual(response.bytes,images.get(id));
  const{data,response:single}=await call('image',[BigInt(id),0n,1_000_000n]);const[bytes,next]=decodeAbiParameters([{type:'bytes'},{type:'uint256'}],single.data);assert.equal(next,0n);assert.deepEqual(Buffer.from(hexToBytes(bytes)),images.get(id));const singleGas=Number(await client.estimateGas({to:renderer,data,gas:60_000_000n}));
  const decoded=await sharp(response.bytes).raw().toBuffer({resolveWithObject:true});assert.equal(decoded.info.width,1080);assert.equal(decoded.info.height,1080);
  const totalGas=response.gas.reduce((a,b)=>a+b,0);assert.ok(totalGas<60_000_000);assert.ok(singleGas<60_000_000);
  const row={tokenId:id,jpegBytes:response.bytes.length,singleCallGas:singleGas,imageCalls:response.gas.length,imageTotalGas:totalGas,maxImageCallGas:Math.max(...response.gas),metadataGas,byteExact:true,jpegDecoded:true};measurements.push(row);
  if([0,31,2790,3193].includes(id))await writeFile(`${out}/onchain-local-${id}.jpg`,response.bytes);
  if(measurements.length%16===0){await writeFile(`${out}/measurements.json`,JSON.stringify(measurements,null,2));console.log(JSON.stringify({phase:'contract image verification',done:measurements.length,total:ids.length,worstAggregateGas:Math.max(...measurements.map(r=>r.imageTotalGas))}));}
 }
 // Authorization, missing-token and malformed-input behavior on the actual reader.
 const directoryAddress=await client.readContract({address:renderer,abi,functionName:'directories',args:[0,0n]});
 const directorySlug=keccak256('0x'+(await client.getCode({address:directoryAddress})).slice(4));
 for(const [name,args]of [['registerMetadata',[0n,metaSlugs[metadataIds.indexOf(0)]]],['registerToken',[0n,[keccak256(maps.get(0))],BigInt(maps.get(0).length/iw),BigInt(images.get(0).length)]],['registerDirectory',[0,[0n],[directorySlug]]]]){await client.simulateContract({address:renderer,abi,functionName:name,args,account});await assert.rejects(()=>client.simulateContract({address:renderer,abi,functionName:name,args,account:other}),e=>e.walk?.(e=>e.data?.errorName==='Unauthorized')?.data?.errorName==='Unauthorized');}
 for(const [name,args]of [['image',[4000n,0n,1n]],['image',[0n,0n,0n]],['image',[0n,1_000_000n,1n]],['request',[['image','x'],[]]],['request',[['unknown','0'],[]]]])await assert.rejects(()=>client.readContract({address:renderer,abi,functionName:name,args}));
 assert.equal(await client.readContract({address:collection,abi:originalBuild.abi,functionName:'totalSupply'}),BigInt(localMintCount));
 const phases={};for(const r of receipts)phases[r.phase]=(phases[r.phase]||0)+Number(r.gasUsed);
 const proof={schema:'keel-jpeg-storage-proof@1',localOnly:true,publicChainPublished:false,quality,size:1080,tokensTested:ids.length,localOriginalCloneMinted:localMintCount,holdDeploymentProvenance:holdBuild.provenance??null,hold,collection,renderer,chainId:31337,codec:toHex(codec),packageBytes:packageReport.preparedBinaryBytes,storedUniqueBytes:[...stored.values()].reduce((n,r)=>n+r.bytes,0),storedSlugs:stored.size,storageIncludes:'actual data, instructions, directories, token maps, original metadata envelopes and codec; excludes source archive and chain state',allStoredBytesReadBack:true,metadataPreservedExceptImage:true,metadataTokensTested:metadataIds,missingOriginalMetadataTokens:ids.filter(id=>!originals.has(id)),allImagesByteExact:true,allImagesDecoded:true,unauthorizedChangesRejected:true,invalidRequestsRejected:true,worstSingleCallGas:Math.max(...measurements.map(r=>r.singleCallGas)),worstAggregateImageGas:Math.max(...measurements.map(r=>r.imageTotalGas)),under60MillionEveryTestedImage:measurements.every(r=>r.singleCallGas<60_000_000&&r.imageTotalGas<60_000_000),gasByPhase:phases,readerBytecodeHash:keccak256('0x'+readerBuild.evm.bytecode.object),compiler:solc.version(),measurements,receipts,publicRPCAndMarketplace:'not tested'};
 await writeFile(`${out}/proof.json`,JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,measurements:undefined,receipts:undefined}));
 if(process.env.KEEL_WEB3_CLIENT_MODULE){const{Client}=await import(process.env.KEEL_WEB3_CLIENT_MODULE);const w3=new Client([{id:31337,name:'Local KEEL proof',rpcUrls:[url]}]);const tokenURI=await client.readContract({address:collection,abi:originalBuild.abi,functionName:'tokenURI',args:[0n]});const read=async uri=>{const r=await w3.fetchUrl(uri);assert.equal(r.httpCode,200);const b=Buffer.from(await new Response(r.output).arrayBuffer());return{r,b};};const meta=await read(tokenURI);const image=await read(JSON.parse(meta.b.toString()).image);assert.deepEqual(image.b,images.get(0));await writeFile(`${out}/web3-client-proof.json`,JSON.stringify({client:'web3protocol',tokenURI,imageURI:JSON.parse(meta.b.toString()).image,imageBytes:image.b.length,byteExact:true,httpHeaders:image.r.httpHeaders,localOnly:true},null,2));}
} finally {child.kill('SIGTERM');}
