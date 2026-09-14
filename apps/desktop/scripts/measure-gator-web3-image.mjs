/** Read-only comparison of separate SVG reads using the SDK and MCP matrix
 * compiler. The resolver address below is a planning placeholder, not live. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sha256} from 'viem';
import {buildKeelInlineShellFragments,buildKeelInlineModuleFragment,buildKeelInlineImageURI} from '@keel/sdk/inline-viewer-graph';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
import {prepareGatorInlineProject} from './gator-inline-project.mjs';
const source='apps/desktop/artifacts/gator-ape-rebuild';
const selectedToken=process.env.KEEL_GATOR_MEASURE_TOKEN_ID;
if(selectedToken!==undefined)assert.ok(/^(0|[1-9][0-9]*)$/.test(selectedToken)&&Number(selectedToken)<4000);
const root='apps/desktop/artifacts/gator-inline-sepolia/web3-image-comparison'+(selectedToken===undefined?'':'/token-'+selectedToken);
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const audit=await json(source+'/layer-audit.json');
const previous=await json('apps/desktop/artifacts/gator-inline-sepolia/collection-matrix/report.json');
const selected=new Map((await json(source+'/collection-layers-3750/selected.json')).map(r=>[r.path,r]));
for(const r of await json(source+'/mixed-codec-test-3750/selected.json'))selected.set(r.path,r);
const shell=await buildKeelInlineShellFragments();
const module=await buildKeelInlineModuleFragment({moduleId:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,mediaType:'text/javascript',aliases:[LAYERED_RUNTIME.id],decodedBytes:await readFile(LAYERED_RUNTIME.localPath),execution:'classic',phase:'runtime',weight:0});
const web3Image={chainId:11155111,resolver:'0x1111111111111111111111111111111111111111'};
const ids=selectedToken===undefined?[...new Set([0,3184,...previous.failures.slice(0,8).map(r=>r.tokenId)])]:[Number(selectedToken)];
const cache=new Map(),results=[],matrices={metadata:[],image:[]};
const resolve=async r=>{if(!cache.has(r.objectId)){const b=await readFile(r.file);assert.equal(sha256(b),'0x'+r.objectId);cache.set(r.objectId,b);}return cache.get(r.objectId);};
await mkdir(root+'/shared',{recursive:true});
for(const tokenId of ids){
 const token=audit.tokens.find(t=>t.tokenId===tokenId);
 const original=await readFile(`${source}/metadata/${tokenId}.json`);assert.equal(sha256(original),'0x'+token.metadataSHA256);
 try {
  const {graph,svg,document}=await prepareGatorInlineProject({tokenId,rows:token.stack.map(p=>selected.get(p)),metadata:JSON.parse(original),shell,module,resolve,web3Image});
  assert.deepEqual(Buffer.from(graph.imageResponse.bytes),svg);
  const html=Buffer.from(decodeURIComponent(graph.metadata.animation_url.slice(graph.metadata.animation_url.indexOf(',')+1)));
  assert.deepEqual(html,Buffer.from(document.rootBytes));
  const originalInlineJSONBytes=Buffer.byteLength(JSON.stringify({...graph.metadata,image:buildKeelInlineImageURI(svg,'image/svg+xml')}));
  const htmlSlots=new Set(graph.parts.filter(p=>p.role==='image-asset').map(p=>p.integrity.digest));
  assert.ok(graph.imageResponse.parts.filter(p=>p.role==='image-asset').every(p=>htmlSlots.has(p.integrity.digest)));
  results.push({tokenId,originalInlineJSONBytes,linkedJSONBytes:graph.byteLength,svgBytes:svg.length,htmlBytes:html.length,savedJSONBytes:originalInlineJSONBytes-graph.byteLength,metadataDigest:graph.integrity.digest,svgDigest:graph.imageResponse.integrity.digest,sharedLayerSlots:true});
  matrices.metadata.push({tokenId,parts:graph.parts});matrices.image.push({tokenId,parts:graph.imageResponse.parts});
 }catch(error){results.push({tokenId,error:error.message});}
}
const server=await createMcpServer({workspaceRoot:process.cwd()});
await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-web3-image-measurement',version:'1'}}});
const evidence={};
for(const [name,tokens] of Object.entries(matrices)){
 const matrix=compileKeelTokenMatrix(tokens,4000),dictionary=[],byDigest=new Map();
 const manifest={tokenCount:4000,parts:dictionary,tokens:[]};
 for(const token of tokens){
  const partIds=[];
  for(const part of token.parts){
   if(part.role==='token-id'){partIds.push(0);continue;}
   const digest=sha256(part.bytes),key=part.role+':'+digest;
   if(!byDigest.has(key)){const path=`${root}/shared/${digest.slice(2)}.bin`;await writeFile(path,part.bytes);const id=dictionary.length+1;dictionary.push({id,role:part.role,path});byDigest.set(key,id);}
   partIds.push(byDigest.get(key));
  }
  manifest.tokens.push({tokenId:token.tokenId,partIds});
 }
 const manifestPath=`${root}/${name}-input.json`,outputPath=`${root}/${name}-plan.json`;
 await writeFile(manifestPath,JSON.stringify(manifest));
 const response=await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath,outputPath}}});
 assert.ok(!response.result.isError,JSON.stringify(response));
 const plan=await json(outputPath);
 for(const read of plan.reads)assert.equal(read.digest,sha256(readKeelTokenMatrix(matrix,read.tokenId)));
 evidence[name]={populatedTokens:plan.populatedTokens,sharedValueBytes:plan.sharedValueBytes,matrixBytes:plan.matrixBytes,exactSDKMCPReads:true};
}
const report={checkedAt:new Date().toISOString(),published:false,resolverIsPlaceholder:true,selectedChainBindingsVerified:false,scope:'Sample size and byte reconstruction only; no RPC gas or marketplace acceptance claim',results,matrices:evidence};
await writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
