/** Local contract acceptance for metadata -> web3 SVG, using the same shared
 * KEEL matrix and storage planner. No signer credentials or public writes. */
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,toHex,sha256,keccak256,encodeFunctionData,formatEther} from 'viem';
import {createKeelManagedObjectPlan} from '@keel/sdk/native-publication';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {buildKeelInlineShellFragments,buildKeelInlineModuleFragment} from '@keel/sdk/inline-viewer-graph';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
import {Client} from '/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js';
import {prepareGatorInlineProject} from './gator-inline-project.mjs';
const tokenId=Number(process.env.KEEL_GATOR_TEST_TOKEN_ID??0);
assert.ok(Number.isInteger(tokenId)&&tokenId>=0&&tokenId<3999);
const root='apps/desktop/artifacts/gator-inline-sepolia/web3-image-comparison'+(process.env.KEEL_GATOR_TEST_TOKEN_ID===undefined?'':'/token-'+tokenId);
const source='apps/desktop/artifacts/gator-ape-rebuild';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const artifact=async name=>json(`/Users/ravonus/dev/keel-contracts/out/${name}.sol/${name}.json`);
const [holdBuild,matrixBuild,original,constructorSource,imageManifest,imagePlan]=await Promise.all([
 artifact('KeelHold'),artifact('KeelTokenMatrix'),json('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),
 json('apps/desktop/artifacts/gator-sepolia/mainnet-source.json'),json(root+'/image-input.json'),json(root+'/image-plan.json')]);
const dictionary=new Map(await Promise.all(imageManifest.parts.map(async p=>[p.id,{role:p.role,bytes:await readFile(p.path)}])));
const token=imageManifest.tokens.find(t=>t.tokenId===tokenId);
const imageMatrix=compileKeelTokenMatrix([{tokenId,parts:token.partIds.map(id=>dictionary.get(id))}],4000);
const expectedSVG=Buffer.from(readKeelTokenMatrix(imageMatrix,tokenId));
assert.equal(sha256(expectedSVG),imagePlan.reads.find(r=>r.tokenId===tokenId).digest);
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','60000000'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Local EVM timeout')),15000);child.once('error',error=>{clearTimeout(timeout);reject(error);});child.stdout.on('data',data=>{log+=data;const match=log.match(/Listening on (127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve('http://'+match[1]);}});});
 const c=createPublicClient({transport:http(url,{timeout:60000})}),w=createWalletClient({transport:http(url,{timeout:60000})});
 assert.equal(await c.getChainId(),31337);const [account]=await w.getAddresses();
 let setupGas=0n,storedBytes=0;const uploaded=new Set(),objects=new Map();
 const receipt=async hash=>{const r=await c.waitForTransactionReceipt({hash});assert.equal(r.status,'success');setupGas+=r.gasUsed;return r;};
 const deploy=async(build,args=[])=> (await receipt(await w.deployContract({account,chain:null,abi:build.abi,bytecode:build.bytecode.object,args}))).contractAddress;
 const hold=await deploy(holdBuild);const holdSetupGas=setupGas;
 const collection=await deploy({...original,bytecode:{object:'0x'+original.evm.bytecode.object}},constructorSource.decoded_constructor_args.map(([value,type])=>type.type.startsWith('uint')?BigInt(value):value));
 async function cast(bytes){const id=keccak256(bytes);if(!uploaded.has(id)){await receipt(await w.writeContract({account,chain:null,address:hold,abi:holdBuild.abi,functionName:'castSlugs',args:[[toHex(bytes)]]}));uploaded.add(id);storedBytes+=bytes.length;}return id;}
 async function publishMatrix(matrix){
  const resolver=await deploy(matrixBuild,[hold,collection,account,4000n,matrix.rowStride]),ids=[];
  for(const value of matrix.table){
   let object=objects.get(value.digest);
   if(!object){
    const plan=await createKeelManagedObjectPlan(value.bytes,{hold,mediaType:'text/plain',compression:'none'});
    for(const chunk of plan.chunks)await cast(chunk.bytes);
    for(const operation of plan.operations)await receipt(await w.sendTransaction({account,chain:null,to:hold,data:operation.data}));
    object=plan.objectId;objects.set(value.digest,object);
   }
   ids.push(object);
  }
  for(let at=0;at<ids.length;at+=100)await receipt(await w.writeContract({account,chain:null,address:resolver,abi:matrixBuild.abi,functionName:'bindTable',args:[matrix.table.slice(at,at+100).map(v=>v.id),ids.slice(at,at+100)]}));
  for(const template of matrix.templates){const bytes=Buffer.alloc(template.commands.length*2);template.commands.forEach((v,i)=>bytes.writeUInt16BE(v,i*2));await receipt(await w.writeContract({account,chain:null,address:resolver,abi:matrixBuild.abi,functionName:'bindTemplate',args:[template.id,toHex(bytes)]}));}
  for(const block of matrix.blocks)await receipt(await w.writeContract({account,chain:null,address:resolver,abi:matrixBuild.abi,functionName:'bindRowBlock',args:[BigInt(block.index),await cast(block.bytes)]}));
  return resolver;
 }
 const imageResolver=await publishMatrix(imageMatrix);
 const imageStoredBytes=storedBytes;
 const byPath=new Map((await json(source+'/collection-layers-3750/selected.json')).map(r=>[r.path,r]));
 for(const r of await json(source+'/mixed-codec-test-3750/selected.json'))byPath.set(r.path,r);
 const audit=(await json(source+'/layer-audit.json')).tokens.find(t=>t.tokenId===tokenId);
 const metadataSource=await readFile(source+'/metadata/'+tokenId+'.json');assert.equal(sha256(metadataSource),'0x'+audit.metadataSHA256);
 const module=await buildKeelInlineModuleFragment({moduleId:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,mediaType:'text/javascript',aliases:[LAYERED_RUNTIME.id],decodedBytes:await readFile(LAYERED_RUNTIME.localPath),execution:'classic',phase:'runtime',weight:0});
 const {graph,document,svg}=await prepareGatorInlineProject({tokenId,rows:audit.stack.map(path=>byPath.get(path)),metadata:JSON.parse(metadataSource),shell:await buildKeelInlineShellFragments(),module,resolve:async r=>{const b=await readFile(r.file);assert.equal(sha256(b),'0x'+r.objectId);return b;},web3Image:{chainId:31337,resolver:imageResolver}});
 assert.deepEqual(svg,expectedSVG);
 const matrix=compileKeelTokenMatrix([{tokenId,parts:graph.parts}],4000);
 // Run the actual MCP compiler for this deployed image address, not a placeholder.
 const manifest={tokenCount:4000,tokens:[{tokenId,parts:[]}]};
 for(const part of graph.parts){const path=`${root}/shared/${part.integrity.digest.slice(2)}.bin`;await writeFile(path,part.bytes);manifest.tokens[0].parts.push({role:part.role,path});}
 const manifestPath=root+'/local-metadata-input.json',outputPath=root+'/local-metadata-plan.json';await writeFile(manifestPath,JSON.stringify(manifest));
 const server=await createMcpServer({workspaceRoot:process.cwd()});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-svg-contract',version:'1'}}});
 const result=await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath,outputPath}}});assert.ok(!result.result.isError,JSON.stringify(result));assert.equal((await json(outputPath)).reads[0].digest,graph.integrity.digest);
 const sharedLayers=matrix.table.filter(v=>v.roles.includes('image-asset'));
 assert.ok(sharedLayers.every(v=>objects.has(v.digest)),'HTML must reuse already uploaded SVG layer objects');
 const metadataResolver=await publishMatrix(matrix);
 await receipt(await w.writeContract({account,chain:null,address:collection,abi:original.abi,functionName:'ownerMint',args:[tokenId+2,account]}));
 for(const [functionName,value] of [['setTokenURISuffix','?mime.type=json'],['setBaseURI',`web3://${metadataResolver}:31337/tokenJSON/`]])await receipt(await w.writeContract({account,chain:null,address:collection,abi:original.abi,functionName,args:[value]}));
 const tokenURI=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[BigInt(tokenId)]});
 const client=new Client([{id:31337,name:'Local KEEL',rpcUrls:[url]}]);
 const fetch=async uri=>{const result=await client.fetchUrl(uri);assert.equal(result.httpCode,200);return {headers:result.httpHeaders,bytes:Buffer.from(await new Response(result.output).arrayBuffer())};};
 const metadataRead=await fetch(tokenURI);assert.deepEqual(metadataRead.bytes,Buffer.from(graph.bytes));
 const metadata=JSON.parse(metadataRead.bytes);const imageRead=await fetch(metadata.image);assert.deepEqual(imageRead.bytes,expectedSVG);
 const header=read=>Object.entries(read.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1];
 assert.equal(header(metadataRead),'application/json');assert.equal(header(imageRead),'image/svg+xml');
 const html=Buffer.from(decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',')+1)));assert.deepEqual(html,Buffer.from(document.rootBytes));
 const {image:_image,animation_url:_animation,...fields}=metadata,{image:_oldImage,animation_url:_oldAnimation,...originalFields}=JSON.parse(metadataSource);assert.deepEqual(fields,originalFields);
 const gas=async address=>c.estimateGas({to:address,data:encodeFunctionData({abi:matrixBuild.abi,functionName:'tokenJSON',args:[BigInt(tokenId)]}),gas:60_000_000n});
 const [jsonGas,svgGas]=await Promise.all([gas(metadataResolver),gas(imageResolver)]);assert.ok(jsonGas<60_000_000n&&svgGas<60_000_000n);
 for(const address of [metadataResolver,imageResolver])await assert.rejects(c.readContract({address,abi:matrixBuild.abi,functionName:'tokenJSON',args:[BigInt(tokenId+1)]}));
 const report={schema:'gator-web3-image-contract-acceptance@1',checkedAt:new Date().toISOString(),localOnly:true,published:false,chainId:31337,tokenId,jsonBytes:metadataRead.bytes.length,svgBytes:imageRead.bytes.length,jsonReadGas:String(jsonGas),svgReadGas:String(svgGas),metadataContentType:header(metadataRead),imageContentType:header(imageRead),exactOriginalMetadata:true,exactSVG:true,exactCanonicalHTML:true,exactSDKMCP:true,sharedLayerObjects:sharedLayers.length,imageStoredBytes,uniqueStoredBytes:storedBytes,setupGas:String(setupGas),localSetupAtHalfGweiETH:formatEther(setupGas*500_000_000n),localSetupAtThreeQuarterGweiETH:formatEther(setupGas*750_000_000n),holdDeploymentGas:String(holdSetupGas),unmappedTokenRejected:true,selectedChainBindingsVerified:false,marketplaceAcceptanceVerified:false};
 await writeFile(root+'/contract-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{child.kill('SIGTERM');}
