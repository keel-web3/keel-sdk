/** Prepare token zero from the exact registered shell and shared runtime.
 * Keeps preparation, storage and collection URI activation separate. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sha256,parseAbi} from 'viem';
import {buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment} from '@keel/sdk/inline-viewer-graph';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
import {openSession,readJSON,HOLD,CHAIN} from './gator-sepolia-session.mjs';
import {prepareGatorInlineProject} from './gator-inline-project.mjs';
export const LIVE_ROOT='apps/desktop/artifacts/gator-inline-sepolia/live-token-0';
export async function prepareLiveToken(imageResolver='0x1111111111111111111111111111111111111111'){
 await mkdir(LIVE_ROOT+'/shared',{recursive:true});
 const s=await openSession(LIVE_ROOT);
 const catalog=await readJSON('apps/desktop/artifacts/gator-inline-sepolia/canonical-bindings/active-catalog.json');
 assert.equal(catalog.chainId,CHAIN);assert.equal(catalog.store,HOLD);
 const abi=parseAbi(['function shells(bytes32) view returns(bytes32 prefixObjectId,bytes32 suffixObjectId,uint8 payloadMode,bool exists)','function shellMetadataObjectId(bytes32) view returns(bytes32)']);
 const shellRecord=await s.c.readContract({address:catalog.builder,abi,functionName:'shells',args:[catalog.shell.shellId]});
 assert.equal(shellRecord[0],catalog.shell.prefix.objectId);assert.equal(shellRecord[1],catalog.shell.suffix.objectId);assert.equal(shellRecord[2],2);assert.equal(shellRecord[3],true);
 assert.equal(await s.c.readContract({address:catalog.builder,abi,functionName:'shellMetadataObjectId',args:[catalog.shell.shellId]}),catalog.shell.metadataObjectId);
 const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate'};
 for(const name of ['prefix','suffix']){
  const binding=catalog.shell[name],bytes=await s.read(binding.objectId);assert.equal(sha256(bytes),binding.digest);assert.equal(bytes.length,binding.byteLength);
  // Alignment spaces are part of the registered carriage. Preserve them.
  const decoded=decodeKeelInlineGraphFragment(bytes,binding.mediaType);
  shell[name]={bytes:decoded,integrity:{algorithm:'sha256',digest:sha256(decoded),byteLength:decoded.length}};
 }
 const runtime=await readFile(LAYERED_RUNTIME.localPath),sourceProof=await readJSON('apps/desktop/artifacts/gator-inline-sepolia/runtime-source-publication/object-proof.json');
 assert.equal(sha256(runtime),LAYERED_RUNTIME.integrity.digest);assert.deepEqual(await s.read(sourceProof.objectId),runtime);
 const module=await buildKeelInlineModuleFragment({moduleId:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,mediaType:'text/javascript',aliases:[LAYERED_RUNTIME.id],decodedBytes:runtime,execution:'classic',phase:'runtime',weight:0});
 const source='apps/desktop/artifacts/gator-ape-rebuild',audit=(await readJSON(source+'/layer-audit.json')).tokens.find(t=>t.tokenId===0);
 const metadataBytes=await readFile(source+'/metadata/0.json');assert.equal(sha256(metadataBytes),'0x'+audit.metadataSHA256);
 const selected=new Map((await readJSON(source+'/collection-layers-3750/selected.json')).map(r=>[r.path,r]));
 for(const r of await readJSON(source+'/mixed-codec-test-3750/selected.json'))selected.set(r.path,r);
 const prepared=await prepareGatorInlineProject({tokenId:0,rows:audit.stack.map(p=>selected.get(p)),metadata:JSON.parse(metadataBytes),shell,module,web3Image:{chainId:CHAIN,resolver:imageResolver},resolve:async r=>{const bytes=await readFile(r.file);assert.equal(sha256(bytes),'0x'+r.objectId);return bytes;}});
 const {graph,document,svg}=prepared;
 assert.deepEqual(Buffer.from(graph.imageResponse.bytes),svg);
 const matrices={metadata:compileKeelTokenMatrix([{tokenId:0,parts:graph.parts}],4000),image:compileKeelTokenMatrix([{tokenId:0,parts:graph.imageResponse.parts}],4000)};
 const mcp=await createMcpServer({workspaceRoot:process.cwd()});await mcp.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-live-token',version:'1'}}});
 for(const [name,parts] of [['metadata',graph.parts],['image',graph.imageResponse.parts]]){
  const manifest={tokenCount:4000,tokens:[{tokenId:0,parts:[]}]};
  for(const p of parts){const path=LIVE_ROOT+'/shared/'+sha256(p.bytes).slice(2)+'.bin';await writeFile(path,p.bytes);manifest.tokens[0].parts.push({role:p.role,path});}
  await writeFile(LIVE_ROOT+'/'+name+'-input.json',JSON.stringify(manifest));
  const r=await mcp.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath:LIVE_ROOT+'/'+name+'-input.json',outputPath:LIVE_ROOT+'/'+name+'-plan.json'}}});assert.ok(!r.result.isError,JSON.stringify(r));
  const plan=await readJSON(LIVE_ROOT+'/'+name+'-plan.json');assert.equal(plan.reads[0].digest,sha256(readKeelTokenMatrix(matrices[name],0)));
 }
 await writeFile(LIVE_ROOT+'/metadata-candidate.json',graph.bytes);await writeFile(LIVE_ROOT+'/image.svg',svg);await writeFile(LIVE_ROOT+'/viewer.html',document.rootBytes);
 const report={chainId:CHAIN,tokenId:0,imageResolver,resolverIsPlaceholder:imageResolver==='0x1111111111111111111111111111111111111111',jsonDigest:graph.integrity.digest,jsonBytes:graph.byteLength,svgDigest:sha256(svg),svgBytes:svg.length,htmlBytes:document.rootBytes.length,shellId:catalog.shell.shellId,shellRegistry:catalog.builder,registeredShellSourceVerified:true,exactSDKMCP:true,sourceRuntimeVerified:true,publicTokenVerified:false};
 await writeFile(LIVE_ROOT+'/preparation.json',JSON.stringify(report,null,2));
 return {...prepared,matrices,report,shell,module};
}
if(import.meta.url===new URL(process.argv[1],'file:').href)console.log(JSON.stringify((await prepareLiveToken()).report));
