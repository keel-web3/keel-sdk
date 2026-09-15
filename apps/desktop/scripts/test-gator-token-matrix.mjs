/** Local full-route acceptance: original Gator clone -> URI -> shared KEEL
 * matrix resolver -> shared values and numeric rows. Never sends a public transaction.
 */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,http,toHex,sha256,keccak256,encodeFunctionData} from 'viem';
import {createKeelManagedObjectPlan,createKeelManagedCompositePlan} from '@keel/sdk/native-publication';
import {gatorStack} from '@keel/sdk/gator-assembly';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
import {Client} from '/tmp/keel-web3-jpeg-proof/node_modules/web3protocol/src/index.js';
import {assertGatorInlineMetadata,GATOR_INLINE_ROOT} from './gator-inline-metadata.mjs';

const root=process.env.KEEL_GATOR_MEASUREMENT_DIR??GATOR_INLINE_ROOT;
const collectionMatrixPath=process.env.KEEL_GATOR_COLLECTION_MATRIX;
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const artifact=async name=>json(`/Users/ravonus/dev/keel-contracts/out/${name}.sol/${name}.json`);
const [holdBuild,resolverBuild,original,source,graph,mcp]=await Promise.all([
 artifact('KeelHold'),artifact('KeelTokenMatrix'),json('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),
 json('apps/desktop/artifacts/gator-sepolia/mainnet-source.json'),json(root+'/json-graph.json'),json(root+'/mcp-prepare.json')]);
assert.equal(graph.integrity.digest,mcp.result.structuredContent.web3Metadata.integrity.digest);
assert.equal(mcp.result.structuredContent.web3Metadata.tokenId,'0');
const parts=await Promise.all(graph.parts.map(async p=>({...p,bytes:await readFile(p.path)})));
for(const p of parts)assert.equal(sha256(p.bytes),p.integrity.digest);
const expected=Buffer.concat(parts.map(p=>p.bytes));assert.equal(sha256(expected),graph.integrity.digest);
assert.equal(expected.length,graph.integrity.byteLength);
const sourceMetadata=await readFile('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json');
const provenance=await json('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json.proof.json');
assert.equal(sha256(sourceMetadata),'0x'+provenance.sha256);
const audit=(await json('apps/desktop/artifacts/gator-ape-rebuild/layer-audit.json')).tokens.find(t=>t.tokenId===0);
assert.equal(audit.metadataSHA256,provenance.sha256);
const snapshot=await json('apps/desktop/artifacts/gator-inline-sepolia/offline-project-snapshot.json');
assert.deepEqual(gatorStack(snapshot.project.layered.assembly,audit.assetTraits).stack.map(p=>p.path),audit.stack);
const assets=await json('apps/desktop/artifacts/gator-ape-rebuild/mixed-codec-test-3750/selected.json');
const storedParts=parts;
const sharedAssetSlots=parts.filter(p=>p.role==='image-asset').length===assets.length*2;
let tokens=[{tokenId:0,parts:storedParts}];
if(collectionMatrixPath){
 const manifest=await json(collectionMatrixPath),dictionary=new Map();
 assert.equal(manifest.tokenCount,4000);
 for(const part of manifest.parts)dictionary.set(part.id,{role:part.role,bytes:await readFile(part.path)});
 tokens=manifest.tokens.map(token=>({tokenId:token.tokenId,parts:token.partIds.map(id=>id===0?{role:'token-id',bytes:Buffer.from(String(token.tokenId))}:dictionary.get(id))}));
}
const matrix=compileKeelTokenMatrix(tokens,4000);
await mkdir(root+'/matrix-source-parts',{recursive:true});
const sourceParts=[];
for (const [index,part] of storedParts.entries()) {
 const path=root+'/matrix-source-parts/'+index+'.bin';await writeFile(path,part.bytes);
 sourceParts.push({role:part.role,path});
}
if(sharedAssetSlots&&!collectionMatrixPath) {
 assert.equal(storedParts.filter(p=>p.role==='image-asset').length,assets.length*2,'Both renderers must use every selected binary layer');
 assert.equal(matrix.table.filter(p=>p.roles.includes('image-asset')).length,assets.length);
}
assert.deepEqual(Buffer.from(readKeelTokenMatrix(matrix,0)),expected);
await writeFile(root+'/matrix-input.json',JSON.stringify({tokenCount:4000,tokens:[{tokenId:0,parts:sourceParts}]}));
const server=await createMcpServer({workspaceRoot:process.cwd()});
await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'matrix-test',version:'1'}}});
const matrixPlanPath=collectionMatrixPath?root+'/collection-matrix-plan.json':root+'/matrix-plan.json';
const prepared=await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath:collectionMatrixPath??root+'/matrix-input.json',outputPath:matrixPlanPath}}});
assert.ok(!prepared.result.isError,JSON.stringify(prepared));
const mcpMatrix=await json(matrixPlanPath);
assert.equal(mcpMatrix.reads[0].digest,sha256(expected));
assert.deepEqual(mcpMatrix.templates,matrix.templates);
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit',process.env.KEEL_DIAGNOSE_READ==='1'?'300000000':'60000000'],{stdio:['ignore','pipe','pipe']});
try {
 const url=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Local EVM timeout')),15000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.stdout.on('data',d=>{log+=d;const m=log.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timeout);resolve('http://'+m[1]);}});});
 const c=createPublicClient({transport:http(url,{timeout:60000})}),w=createWalletClient({transport:http(url,{timeout:60000})});
 assert.equal(await c.getChainId(),31337);const [account]=await w.getAddresses();
 let setupGas=0n;
 const receipt=async hash=>{const r=await c.waitForTransactionReceipt({hash});assert.equal(r.status,'success');setupGas+=r.gasUsed;return r;};
 const hold=(await receipt(await w.deployContract({account,chain:null,abi:holdBuild.abi,bytecode:holdBuild.bytecode.object}))).contractAddress;
 const args=source.decoded_constructor_args.map(([v,t])=>t.type.startsWith('uint')?BigInt(v):v);
 const collection=(await receipt(await w.deployContract({account,chain:null,abi:original.abi,bytecode:'0x'+original.evm.bytecode.object,args}))).contractAddress;
 const resolver=(await receipt(await w.deployContract({account,chain:null,abi:resolverBuild.abi,bytecode:resolverBuild.bytecode.object,args:[hold,collection,account,4000n,matrix.rowStride,matrix.rowsPerBlock,matrix.maxReadDepth ?? 8]}))).contractAddress;
 const uploaded=new Set();let storedBytes=0;
 async function publishFixture(bytes,mediaType='text/plain') {
  const plan=await createKeelManagedObjectPlan(bytes,{hold,mediaType,compression:'none'});
  const missing=plan.chunks.filter(x=>!uploaded.has(x.id));
  for(let i=0;i<missing.length;i+=3){const batch=missing.slice(i,i+3);await receipt(await w.writeContract({account,chain:null,address:hold,abi:holdBuild.abi,functionName:'castSlugs',args:[batch.map(x=>toHex(x.bytes))]}));for(const x of batch){uploaded.add(x.id);storedBytes+=x.bytes.length;}}
  for(const operation of plan.operations)await receipt(await w.sendTransaction({account,chain:null,to:hold,data:operation.data}));
  return plan;
 }
 const tablePlans=[];
 for(const value of matrix.table)tablePlans.push(await publishFixture(value.bytes));
 for(let at=0;at<matrix.table.length;at+=100)await receipt(await w.writeContract({account,chain:null,address:resolver,abi:resolverBuild.abi,functionName:'bindTable',args:[matrix.table.slice(at,at+100).map(v=>v.id),tablePlans.slice(at,at+100).map(p=>p.objectId)]}));
 for(const template of matrix.templates){
  const commands=Buffer.alloc(template.commands.length*2);template.commands.forEach((v,i)=>commands.writeUInt16BE(v,i*2));
  await receipt(await w.writeContract({account,chain:null,address:resolver,abi:resolverBuild.abi,functionName:'bindTemplate',args:[template.id,toHex(commands)]}));
 }
 for(const block of matrix.blocks){
  await receipt(await w.writeContract({account,chain:null,address:hold,abi:holdBuild.abi,functionName:'castSlugs',args:[[toHex(block.bytes)]]}));
  storedBytes+=block.bytes.length;
  await receipt(await w.writeContract({account,chain:null,address:resolver,abi:resolverBuild.abi,functionName:'bindRowBlock',args:[BigInt(block.index),keccak256(block.bytes)]}));
 }
 const call=async(name,args)=>receipt(await w.writeContract({account,chain:null,address:collection,abi:original.abi,functionName:name,args}));
 await call('ownerMint',[collectionMatrixPath?4000:2,account]);
 assert.equal(await c.readContract({address:collection,abi:original.abi,functionName:'totalSupply'}),BigInt(collectionMatrixPath?4000:2));
 const baseURI=`web3://${resolver}:31337/tokenJSON/`,suffix='?mime.type=json';
 await call('setTokenURISuffix',[suffix]);await call('setBaseURI',[baseURI]);
 const tokenURI=await c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});assert.equal(tokenURI,baseURI+'0'+suffix);
 const data=encodeFunctionData({abi:resolverBuild.abi,functionName:'tokenJSON',args:[0n]});
 const readGas=await c.estimateGas({to:resolver,data,gas:process.env.KEEL_DIAGNOSE_READ==='1'?300_000_000n:60_000_000n});console.log(JSON.stringify({measuredReadGas:String(readGas),uniqueStoredBytes:storedBytes,setupGas:String(setupGas)}));assert.ok(readGas<60_000_000n);
 const w3=new Client([{id:31337,name:'Local KEEL test',rpcUrls:[url]}]);const result=await w3.fetchUrl(tokenURI);assert.equal(result.httpCode,200);
 const actual=Buffer.from(await new Response(result.output).arrayBuffer());assert.deepEqual(actual,expected);
 assertGatorInlineMetadata(actual,{svg:await readFile(root+'/image.svg'),html:await readFile(root+'/viewer.html'),original:JSON.parse(sourceMetadata),layerCount:audit.stack.length});
 const returned=JSON.parse(actual);const decode=uri=>Buffer.from(decodeURIComponent(uri.slice(uri.indexOf(',')+1)));
 assert.deepEqual(decode(returned.image),await readFile(root+'/image.svg'));
 assert.deepEqual(decode(returned.animation_url),await readFile(root+'/viewer.html'));
 const {image:_image,animation_url:_animation,...fields}=returned;const {image:_oldImage,animation_url:_oldAnimation,...originalFields}=JSON.parse(sourceMetadata);assert.deepEqual(fields,originalFields);
 const missingToken=Array.from({length:4000},(_,id)=>id).find(id=>!tokens.some(t=>t.tokenId===id));
 if(missingToken!==undefined)await assert.rejects(c.readContract({address:resolver,abi:resolverBuild.abi,functionName:'tokenJSON',args:[BigInt(missingToken)]}));
 const additionalReads=[];
 for(const token of tokens.filter(t=>t.tokenId!==0)){
  const data=encodeFunctionData({abi:resolverBuild.abi,functionName:'tokenJSON',args:[BigInt(token.tokenId)]});
  const gas=await c.estimateGas({to:resolver,data,gas:60_000_000n});assert.ok(gas<60_000_000n);
  const read=await c.readContract({address:resolver,abi:resolverBuild.abi,functionName:'tokenJSON',args:[BigInt(token.tokenId)]});
  const expectedBytes=Buffer.from(readKeelTokenMatrix(matrix,token.tokenId));assert.deepEqual(Buffer.from(read),expectedBytes);
  additionalReads.push({tokenId:token.tokenId,gas:String(gas),bytes:expectedBytes.length,digest:sha256(expectedBytes)});
 }
 const selection=await c.readContract({address:resolver,abi:resolverBuild.abi,functionName:'tokenSelection',args:[0n]});
 assert.equal(Number(selection[0]),matrix.rows[0].templateId);
 const report={schema:'gator-token-matrix-local-acceptance@1',localOnly:true,published:false,sharedAssetSlots,readTimeEncoding:false,sharedLayerObjects:matrix.table.filter(v=>v.roles.includes('image-asset')).length,storedLayerBytes:matrix.table.filter(v=>v.roles.includes('image-asset')).reduce((n,v)=>n+v.bytes.length,0),readGas:String(readGas),jsonBytes:actual.length,jsonDigest:sha256(actual),sharedTableEntries:matrix.table.length,templates:matrix.templates.length,tokenCount:matrix.tokenCount,populatedTokens:matrix.populatedTokens,rowBytes:matrix.rowStride,matrixBytes:matrix.matrixBytes,uniqueStoredBytes:storedBytes,completeJSONObjectsStored:0,setupGas:String(setupGas),originalContractURIControls:true,web3Client:'web3protocol@0.6.3',web3ContentType:result.httpHeaders,originalMetadataExact:true,sdkMcpMatrixExact:true,svgExact:true,verifiedHTMLExact:true,unmappedTokenRejected:true,selectedChainShellModuleBindingsVerified:false};
 const evidence={...report,populatedTokens:matrix.populatedTokens,tokensMintedLocally:collectionMatrixPath?4000:2,unmappedTokenRejected:missingToken!==undefined,additionalReads};
 await writeFile(root+(collectionMatrixPath?'/collection-matrix-acceptance.json':'/matrix-acceptance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {child.kill('SIGTERM');}
