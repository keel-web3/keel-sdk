import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compileRasterRegions,newRegionCatalog,assembleRasterRegions} from '../../../packages/sdk/dist/raster-regions.js';
import {decodeRasterPNG,verifyStripPNG} from '../../../packages/sdk/dist/raster-strips.js';
const size=Number(process.env.KEEL_RASTER_SIZE||1080),minSpan=Number(process.env.KEEL_REGION_MIN||16),maxSpan=Number(process.env.KEEL_REGION_MAX||256),limit=Number(process.env.KEEL_REGION_COUNT||128),filter=process.env.KEEL_REGION_FILTER||'up';
const root=`apps/desktop/artifacts/gator-raster-study/adaptive-${size}`,output=`${root}/spans-${filter}-v2-${minSpan}-${maxSpan}`;
await mkdir(output,{recursive:true});const inputs=JSON.parse(await readFile(`${root}/inputs.json`,'utf8')).slice(0,limit),catalog=newRegionCatalog(),decoded=new Map(),sourceSizes=new Map(),results=[];let refBytes=0;const started=Date.now();
async function layer(id){if(decoded.has(id)){const p=decoded.get(id);decoded.delete(id);decoded.set(id,p);return p;}const bytes=await readFile(`${root}/assets/${id}.png`),p=await decodeRasterPNG(bytes);sourceSizes.set(id,bytes.length);decoded.set(id,p);if(decoded.size>24)decoded.delete(decoded.keys().next().value);return p;}
for(const [index,input] of inputs.entries()){
 const sources=[];for(const id of input.sources)sources.push(await layer(id));const reference=await decodeRasterPNG(await readFile(`${root}/references/${input.tokenId}.png`)),result=compileRasterRegions(reference,sources,catalog,{minSpan,maxSpan,filter}),png=assembleRasterRegions(result.refs,catalog);if(result.filter!==filter)throw Error('Rebuild the SDK before benchmarking this algorithm.');verifyStripPNG(png,reference);
 const independent=await decodeRasterPNG(png);if(Buffer.compare(Buffer.from(independent.data),Buffer.from(reference.data)))throw Error('Independent PNG decoder failed exact pixel check.');refBytes+=result.packed.length;
 const record={tokenId:input.tokenId,pngBytes:png.length,referenceBytes:result.packed.length,newChunkBytes:result.newChunkBytes,newChunks:result.newChunks,...result.stats};results.push(record);
 await writeFile(`${output}/token-${input.tokenId}.map`,result.packed);
 if(index===0){await writeFile(`${output}/token-0.png`,png);await writeFile(`${output}/token-0.json`,JSON.stringify({...result,packed:undefined},null,2));}
 if((index+1)%8===0)console.log(JSON.stringify({tokens:index+1,size,minSpan,maxSpan,uniqueChunkBytes:catalog.bytes,uniqueChunks:catalog.chunks.length,mapBytes:refBytes,catalogRecordBytes:catalog.chunks.length*24,preparedBytes:catalog.bytes+refBytes+catalog.chunks.length*24,seconds:(Date.now()-started)/1000}));
 if(catalog.bytes+refBytes+catalog.chunks.length*24>600_000_000)break;
}
// Persist the actual compact catalog for local EVM testing. Records use packed page/offset/length
// here; a deployed catalog replaces the page number with a KEEL carrier pointer (24 bytes).
await mkdir(`${output}/pages`,{recursive:true});const locations=[];let parts=[],pageBytes=0,page=0;
async function flush(){if(!pageBytes)return;await writeFile(`${output}/pages/${page}.bin`,Buffer.concat(parts));page++;parts=[];pageBytes=0;}
for(const bytes of catalog.chunks){if(bytes.length>23000)throw Error('Fragment exceeds KEEL carrier limit');if(pageBytes+bytes.length>23000)await flush();locations.push([page,pageBytes,bytes.length]);parts.push(bytes);pageBytes+=bytes.length;}await flush();
await writeFile(`${output}/catalog.json`,JSON.stringify(locations));
const summary={schema:'keel-adaptive-raster-study@1',size,minSpan,maxSpan,filter,tokens:results.length,uniqueChunks:catalog.chunks.length,uniqueChunkBytes:catalog.bytes,catalogRecordBytes:catalog.chunks.length*24,mapBytes:refBytes,preparedBytes:catalog.bytes+refBytes+catalog.chunks.length*24,sourceLayerBytes:[...sourceSizes.values()].reduce((a,b)=>a+b,0),carrierPages:page,exactRGBA:true,independentDecoder:'squoosh-png',sourceReference:'Pillow composition of the resolved original Gator stack at the selected size',seconds:(Date.now()-started)/1000,results,scope:'Sample only; no full-collection size claim or public-chain publication'};await writeFile(`${output}/report.json`,JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,results:undefined}));
