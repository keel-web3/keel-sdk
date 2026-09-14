import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {newLayeredArt,defaultPlacement,selectLayeredArt} from '@keel/sdk/layered-art';
import {renderLayeredSVG} from '@keel/sdk/layered-svg';
import {buildKeelInlineShellFragments,buildKeelInlineModuleFragment,buildKeelInlineLocalDocument,buildKeelInlineImageURI,buildKeelWeb3TokenJSONGraph} from '@keel/sdk/inline-viewer-graph';
import {createMcpServer} from '../../../packages/mcp/dist/server.js';
const root=process.env.KEEL_GATOR_MEASUREMENT_DIR??'apps/desktop/artifacts/gator-inline-sepolia';await mkdir(root,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const rows=await json(process.env.KEEL_CODEC_SELECTION??'apps/desktop/artifacts/gator-ape-rebuild/webp-token-0.json');const token=(await json('apps/desktop/artifacts/gator-ape-rebuild/layer-audit.json')).tokens.find(t=>t.tokenId===0);
const selected=token.stack.map(p=>rows.find(r=>r.path===p));if(selected.some(r=>!r))throw Error('Missing original token layer');
const dimensions={width:selected[0].width,height:selected[0].height};
const manifest={...newLayeredArt('TokenGator #0'),...dimensions,attributes:selected.map((r,i)=>({id:'layer-'+i,name:r.path,items:[{id:'original',name:r.path,weight:1,variants:[{id:'original',name:'Original',objectId:r.objectId,weight:1}],placements:[defaultPlacement('original',i)],rules:[],usage:{scope:'renderer',renderer:'gator-inline-test',license:'',tags:[]}}]}))};
const mediaTypes=Object.fromEntries(selected.map(r=>[r.objectId,r.type??'image/webp']));
const entry=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#383e7b}body{display:grid;place-items:center}img{max-width:100%;max-height:100%}canvas{display:none}</style></head><body><canvas></canvas><img alt="TokenGator #0"><script>(async()=>{const art=${JSON.stringify(manifest)},types=${JSON.stringify(mediaTypes)};const c=document.querySelector('canvas');const selected=await KEEL_LAYERS.selectLayeredArt(art,'apechain-contract-snapshot','0');await KEEL_LAYERS.renderLayeredArt(c,art,selected,async id=>({bytes:await __KEEL_CONTENT__.bytes('asset-'+id),type:types[id]}));document.querySelector('img').src=c.toDataURL('image/png');})().catch(error=>{document.body.textContent=error.message;throw error});</script></body></html>`;
await writeFile(root+'/entry.html',entry);
const runtimePath='packages/sdk/dist/layered-runtime.js';
// The source is measured locally; this does not assert a selected-chain module binding.
const {LAYERED_RUNTIME:runtime}=await import('@keel/sdk/layered-runtime-info');
const shell=await buildKeelInlineShellFragments(),module=await buildKeelInlineModuleFragment({moduleId:runtime.id,version:runtime.version,mediaType:'text/javascript',aliases:[runtime.id],decodedBytes:await readFile(runtimePath),execution:'classic',phase:'runtime',weight:0});
const assets=await Promise.all(selected.map(async r=>({id:'asset-'+r.objectId,mediaType:r.type??'image/webp',source:await readFile(r.file),compression:process.env.KEEL_ASSET_COMPRESSION??'none'})));
const document=await buildKeelInlineLocalDocument({shell,modules:[module],assets,entry:{id:'entry',mediaType:'text/html',source:Buffer.from(entry)}});
const draw=await selectLayeredArt(manifest,'apechain-contract-snapshot','0');
const svg=Buffer.from((await renderLayeredSVG(manifest,draw,async id=>{const a=assets.find(a=>a.id==='asset-'+id);return {bytes:a.source,type:a.mediaType};})).source);
await writeFile(root+'/image.svg',svg);
// Measure the complete original metadata with both self-contained fields. This
// local candidate is not a deployed adapter or a live tokenURI read-back.
const textURI=(type,source)=>'data:'+type+';charset=utf-8,'+encodeURI(source).replaceAll('#','%23').replaceAll('?','%3F');
const metadata=await json('apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json');
const tokenIdFields={name:{prefix:'TokenGator #',suffix:''},mml:{prefix:'https://storage.googleapis.com/tokengators/apechain/mml/',suffix:'.mml'}};
const metadataGraph=await buildKeelWeb3TokenJSONGraph({document,metadata,imageURI:buildKeelInlineImageURI(svg,'image/svg+xml'),tokenId:'0',tokenIdFields});
const metadataJSON=Buffer.from(metadataGraph.bytes).toString();
await mkdir(root+'/json-parts',{recursive:true});
const partRecords=[];
for(const [index,part] of metadataGraph.parts.entries()){
 const path=root+'/json-parts/'+String(index).padStart(3,'0')+'.bin';await writeFile(path,part.bytes);
 partRecords.push({path,role:part.role,sourceKind:part.sourceKind,integrity:part.integrity});
}
await writeFile(root+'/json-graph.json',JSON.stringify({schema:metadataGraph.schema,tokenId:'0',mediaType:'application/json',integrity:metadataGraph.integrity,parts:partRecords,selectedChainBindingsVerified:false,published:false},null,2));
const metadataURI=textURI('application/json',metadataJSON);
await writeFile(root+'/metadata-candidate.json',metadataJSON);
await writeFile(root+'/metadata-candidate-uri.txt',metadataURI);
await writeFile(root+'/viewer.html',document.rootBytes);
const minWords=(n)=>BigInt(Math.ceil(n/32)),memoryGas=n=>{const words=minWords(n);return String(3n*words+words*words/512n);};
const report={tokenId:0,...dimensions,sourceLayerBytes:assets.reduce((n,a)=>n+a.source.length,0),layerCount:assets.length,formats:[...new Set(assets.map(a=>a.mediaType))],canonicalHTMLBytes:document.byteLength,svgBytes:svg.length,svgBase64DataURIBytes:Math.ceil(svg.length/3)*4+26,htmlAloneMemoryGasLowerBound:memoryGas(document.byteLength),svgAloneMemoryGasLowerBound:memoryGas(svg.length),publicReadGasBudget:60000000,preferredInlineBytes:1000000,maximumInlineBytes:1750000,viewerFitsMaximum:document.byteLength<=1750000,published:false};
Object.assign(report,{metadataJSONBytes:Buffer.byteLength(metadataJSON),completeMetadataURIBytes:Buffer.byteLength(metadataURI),completeReturnMaximumBytes:2000000,completeReturnFitsMaximum:Buffer.byteLength(metadataURI)<=2000000,metadataRouteProof:'local-generated-candidate-only'});
const server=await createMcpServer({workspaceRoot:process.cwd()});await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'gator-inline-measure',version:'1'}}});
const request={entry:root+'/entry.html',entryMediaType:'text/html',modules:[{moduleId:runtime.id,version:runtime.version,path:runtimePath,mediaType:'text/javascript'}],assets:selected.map(r=>({assetId:'asset-'+r.objectId,path:r.file.replace(process.cwd()+'/',''),mediaType:r.type??'image/webp',compression:process.env.KEEL_ASSET_COMPRESSION??'none'})),chainId:11155111,collection:'0xab2e21bffafdae462e9392375a413d36ea7c247c',collectionName:'TokenGators',imagePath:root+'/image.svg',metadataTransport:'web3-json',metadataPath:'apps/desktop/artifacts/gator-ape-rebuild/metadata/0.json',tokenId:'0',tokenIdFieldsJson:JSON.stringify(tokenIdFields)};
const prepared=await server.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'keel-inline-prepare',arguments:request}});
await writeFile(root+'/mcp-prepare.json',JSON.stringify(prepared,null,2));report.mcpError=prepared.result?.isError?prepared.result.content[0].text:null;
if(report.mcpError)throw Error(report.mcpError);
if(prepared.result.structuredContent.web3Metadata.integrity.digest!==metadataGraph.integrity.digest)throw Error('SDK and MCP metadata graph differ');
await writeFile(root+'/measurements.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
