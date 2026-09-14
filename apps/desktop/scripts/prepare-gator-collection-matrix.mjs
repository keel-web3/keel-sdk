/** Stream all contract-selected Gators through the existing SDK graph builder,
 * interning shared fragments before retaining token rows. Complete per-token
 * JSON/SVG/HTML outputs are measured and discarded, never stored as objects. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sha256} from 'viem';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {buildKeelInlineShellFragments,buildKeelInlineModuleFragment} from '@keel/sdk/inline-viewer-graph';
import {LAYERED_RUNTIME} from '@keel/sdk/layered-runtime-info';
import {prepareGatorInlineProject} from './gator-inline-project.mjs';
const web3Image=process.env.KEEL_COLLECTION_WEB3_IMAGE==='1'?{chainId:11155111,resolver:'0x1111111111111111111111111111111111111111'}:undefined;
const source='apps/desktop/artifacts/gator-ape-rebuild',root='apps/desktop/artifacts/gator-inline-sepolia/'+(web3Image?'collection-web3-image-matrix':'collection-matrix');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const audit=await json(source+'/layer-audit.json');
assert.equal(audit.tokens.length,4000);
const progress=await json(source+'/collection-layers-3750/progress.json');
const selected=await json(source+'/collection-layers-3750/selected.json');
const byPath=new Map(selected.map(r=>[r.path,r]));
// The accepted fixture remains usable during bulk preparation, never replaced
// with guessed or lower quality bytes while other traits are being prepared.
for(const r of await json(source+'/mixed-codec-test-3750/selected.json'))byPath.set(r.path,r);
const limit=Number(process.env.KEEL_COLLECTION_TEST_LIMIT??4000);
assert.ok(Number.isInteger(limit)&&limit>0&&limit<=4000);
await mkdir(root+'/shared',{recursive:true});
const shell=web3Image?(await (await import('./prepare-gator-live-token.mjs')).prepareLiveToken()).shell:await buildKeelInlineShellFragments();
const module=await buildKeelInlineModuleFragment({moduleId:LAYERED_RUNTIME.id,version:LAYERED_RUNTIME.version,mediaType:'text/javascript',aliases:[LAYERED_RUNTIME.id],decodedBytes:await readFile(LAYERED_RUNTIME.localPath),execution:'classic',phase:'runtime',weight:0});
const assets=new Map(),values=new Map(),tokens=[],reads=[],failures=[],pending=[];
async function resolve(row){
 if(!assets.has(row.objectId)){
  const bytes=await readFile(row.file);assert.equal(sha256(bytes),'0x'+row.objectId);
  assets.set(row.objectId,bytes);
 }
 return assets.get(row.objectId);
}
const records=[...audit.tokens].sort((a,b)=>a.tokenId-b.tokenId);
for(const token of records){
 if(tokens.length>=limit)break;
 const rows=token.stack.map(p=>byPath.get(p));
 if(rows.some(r=>!r)){pending.push(token.tokenId);continue;}
 const original=await readFile(`${source}/metadata/${token.tokenId}.json`);
 assert.equal(sha256(original),'0x'+token.metadataSHA256);
 let prepared;
 try {prepared=await prepareGatorInlineProject({tokenId:token.tokenId,rows,metadata:JSON.parse(original),shell,module,resolve,web3Image});}
 catch(error){failures.push({tokenId:token.tokenId,error:error.message});continue;}
 const parts=[];
 for(const part of prepared.graph.parts){
  if(part.role==='token-id'){parts.push(part);continue;}
  const digest=part.integrity.digest;
  let value=values.get(digest);
  if(!value){value={bytes:part.bytes,path:`${root}/shared/${digest.slice(2)}.bin`};values.set(digest,value);await writeFile(value.path,value.bytes);}
  else assert.deepEqual(value.bytes,part.bytes);
  parts.push({role:part.role,bytes:value.bytes});
 }
 tokens.push({tokenId:token.tokenId,parts});
 reads.push({tokenId:token.tokenId,digest:prepared.graph.integrity.digest,byteLength:prepared.graph.byteLength,layers:rows.length,uniqueLayers:prepared.uniqueLayers});
 if(tokens.length%25===0)console.log(JSON.stringify({preparedTokens:tokens.length,pending:pending.length,failed:failures.length}));
}
assert.ok(tokens.length,'No complete token can be prepared');
const matrix=compileKeelTokenMatrix(tokens,4000);
for(const read of reads){const bytes=readKeelTokenMatrix(matrix,read.tokenId);assert.equal(sha256(bytes),read.digest);assert.equal(bytes.length,read.byteLength);}
const dictionary=[],partIDs=new Map();
const manifest={tokenCount:4000,parts:dictionary,tokens:tokens.map(token=>({tokenId:token.tokenId,partIds:token.parts.map(part=>{
 if(part.role==='token-id')return 0;
 const digest=sha256(part.bytes),key=part.role+':'+digest;
 let id=partIDs.get(key);if(id===undefined){id=dictionary.length+1;partIDs.set(key,id);dictionary.push({id,role:part.role,path:values.get(digest).path});}return id;
})}))};
await writeFile(root+'/mcp-input.json',JSON.stringify(manifest));
const report={schema:'gator-collection-matrix-preparation@1',complete:matrix.complete,tokenCount:4000,preparedTokens:tokens.length,imageTransport:web3Image?'web3-svg':'inline',resolverIsPlaceholder:!!web3Image,
 layerPreparationComplete:progress.complete,sharedValues:matrix.table.length,sharedValueBytes:matrix.sharedValueBytes,matrixBytes:matrix.matrixBytes,
 templates:matrix.templates.length,maximumJSONBytes:Math.max(...reads.map(r=>r.byteLength)),largestTokens:[...reads].sort((a,b)=>b.byteLength-a.byteLength).slice(0,10),
 failures,pendingTokens:pending,reads,completeTokenObjectsStored:0,readTimeEncoding:false,published:false,selectedChainBindingsVerified:false};
await writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({...report,reads:undefined,pendingTokens:pending.length}));
