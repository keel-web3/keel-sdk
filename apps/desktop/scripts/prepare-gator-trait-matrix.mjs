/** Compile and round-trip every available authoritative metadata record and its
 * audited original-generator layer selection. This is local preparation only.
 */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {sha256,toHex} from 'viem';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk';
import {gatorStack} from '@keel/sdk/gator-assembly';
const source='apps/desktop/artifacts/gator-ape-rebuild';
const output='apps/desktop/artifacts/gator-inline-sepolia/trait-matrix';
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const audit=await load(source+'/layer-audit.json');
const recovery='/tmp/keel-gator-recovery';
const config=await load(recovery+'/src/data/generatorConfig.json');
const files=[];for(const folder of await readdir(recovery+'/public/layers',{withFileTypes:true})){if(!folder.isDirectory())continue;for(const name of await readdir(recovery+'/public/layers/'+folder.name))if(name.endsWith('.png'))files.push({path:folder.name+'/'+name,objectId:'0'.repeat(64)});}
const assembly={kind:'token-gators@1',config,files};
const tokens=[],expected=new Map();let originalBytes=0;
for(const row of audit.tokens){
 const bytes=await readFile(`${source}/metadata/${row.tokenId}.json`);
 assert.equal(sha256(bytes),'0x'+row.metadataSHA256);
 const metadata=JSON.parse(bytes);originalBytes+=bytes.length;
 assert.deepEqual(gatorStack(assembly,row.assetTraits).stack.map(x=>x.path),row.stack);
 const parts=[];const add=(role,value)=>parts.push({role,bytes:Buffer.from(value)});
 add('metadata-open','{"metadata":{');
 for(const [index,[key,value]] of Object.entries(metadata).entries()){
  add('metadata-field',(index?',':'')+JSON.stringify(key)+':');
  if(key==='name'&&value===`TokenGator #${row.tokenId}`){add('name-prefix','"TokenGator #');add('token-id',String(row.tokenId));add('name-suffix','"');}
  else if(key==='mml'&&value===`https://storage.googleapis.com/tokengators/apechain/mml/${row.tokenId}.mml`){add('mml-prefix','"https://storage.googleapis.com/tokengators/apechain/mml/');add('token-id',String(row.tokenId));add('mml-suffix','.mml"');}
  else if(key==='attributes'&&Array.isArray(value)){
   add('attributes-open','[');for(const [i,trait] of value.entries()){if(i)add('separator',',');add('trait',JSON.stringify(trait));}add('attributes-close',']');
  }else add('metadata-value',JSON.stringify(value));
 }
 add('layer-field','},"layers":[');
 for(const [i,path] of row.stack.entries()){if(i)add('separator',',');add('layer-path',JSON.stringify(path));}
 add('close',']}');
 tokens.push({tokenId:row.tokenId,parts});expected.set(row.tokenId,{metadata,layers:row.stack});
}
const matrix=compileKeelTokenMatrix(tokens,4000);
for(const row of matrix.rows)assert.deepEqual(JSON.parse(Buffer.from(readKeelTokenMatrix(matrix,row.tokenId))),expected.get(row.tokenId));
await mkdir(output+'/shared',{recursive:true});
const table=[];for(const entry of matrix.table){const path=`${output}/shared/${entry.digest.slice(2)}.bin`;await writeFile(path,entry.bytes);table.push({id:entry.id,digest:entry.digest,byteLength:entry.bytes.length,roles:entry.roles,path});}
const prepared={schema:matrix.schema,tokenCount:4000,populatedTokens:matrix.populatedTokens,complete:matrix.complete,rowStride:matrix.rowStride,rowsPerBlock:matrix.rowsPerBlock,table,templates:matrix.templates,blocks:matrix.blocks.map(x=>({index:x.index,bytes:toHex(x.bytes)})),published:false};
await writeFile(output+'/matrix.json',JSON.stringify(prepared));
const inputParts=[],inputIDs=new Map();
const manifest={tokenCount:4000,parts:inputParts,tokens:tokens.map(token=>({tokenId:token.tokenId,partIds:token.parts.map(part=>{
 if(part.role==='token-id')return 0;
 const digest=sha256(part.bytes),key=part.role+'\0'+digest;
 let id=inputIDs.get(key);if(id===undefined){id=inputParts.length+1;inputIDs.set(key,id);inputParts.push({id,role:part.role,path:`${output}/shared/${digest.slice(2)}.bin`});}return id;
})}))};
await writeFile(output+'/mcp-input.json',JSON.stringify(manifest));
const report={schema:'gator-trait-matrix-audit@1',tokenCount:4000,verifiedMetadataRows:matrix.populatedTokens,missingRows:4000-matrix.populatedTokens,sharedTraitValues:matrix.table.filter(x=>x.roles.includes('trait')).length,sharedLayerPaths:matrix.table.filter(x=>x.roles.includes('layer-path')).length,sharedValues:matrix.table.length,templates:matrix.templates.length,rowBytes:matrix.rowStride,matrixBytes:matrix.matrixBytes,sharedValueBytes:matrix.sharedValueBytes,templateBytes:matrix.templates.reduce((n,x)=>n+x.commands.length*2,0),originalMetadataFileBytes:originalBytes,allAvailableMetadataExact:true,originalGeneratorLayerSelectionsExact:true,artworkPayloadIncluded:false,pixelMatchesVerified:false,published:false};
await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
