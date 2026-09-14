/** Share repeated row instructions; compact page pointers without changing PNG bytes. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source=process.env.KEEL_RASTER_REPORT_ROOT||'apps/desktop/artifacts/gator-raster-study/full-1080/native-4000',unitSize=Number(process.env.KEEL_MAP_UNIT_REFS||32);
assert.ok([4,8,16,32].includes(unitSize));
const root=`${source}/shared-maps-${unitSize}`, report=JSON.parse(await readFile(`${source}/report.json`)), catalog=JSON.parse(await readFile(`${source}/catalog.json`));
await mkdir(root,{recursive:true});await mkdir(`${root}/units`,{recursive:true});
assert.ok(catalog.length<2**24,'This compact fixture must select a wider ID codec for larger catalogs.');
const rawStream=report.schema==='keel-single-idat-study@1',markerBytes=Buffer.from(rawStream?[0,1,0,254,255,2]:[0,0,0,6,73,68,65,84,0,1,0,254,255,2]);
const first=await readFile(`${source}/token-${report.results[0].tokenId}.map`), pages=new Map();let marker;
for(let at=0;at<first.length;at+=4){const id=first.readUInt32BE(at),[page,offset,length]=catalog[id];if(length!==(rawStream?6:18))continue;let b=pages.get(page);if(!b){b=await readFile(`${source}/pages/${page}.bin`);pages.set(page,b);}if(b.subarray(offset,offset+markerBytes.length).equals(markerBytes)){marker=id;break;}}
assert.ok(marker!==undefined,'Find the real PNG row marker, not a guessed chunk ID.');
const units=[],known=new Map(),tokenMaps=[];let oldMapBytes=0;
for(const token of report.results){const original=await readFile(`${source}/token-${token.tokenId}.map`);oldMapBytes+=original.length;const unitIds=[];let sequence=[];
    const flush=()=>{if(!sequence.length)return;const packed=Buffer.alloc(sequence.length*3);sequence.forEach((id,i)=>packed.writeUIntBE(id,i*3,3));const key=createHash('sha256').update(packed).digest('hex');let id=known.get(key);if(id===undefined){id=units.length;known.set(key,id);units.push(packed);}unitIds.push(id);sequence=[];};
    for(let at=0;at<original.length;at+=4){const id=original.readUInt32BE(at);if(id===marker||sequence.length===unitSize)flush();sequence.push(id);}flush();
    const expanded=Buffer.alloc(original.length);let cursor=0;for(const unit of unitIds){const bytes=units[unit];for(let at=0;at<bytes.length;at+=3){expanded.writeUInt32BE(bytes.readUIntBE(at,3),cursor);cursor+=4;}}
    assert.ok(expanded.equals(original),`Shared map changed token ${token.tokenId}`);tokenMaps.push({id:token.tokenId,units:unitIds});
}
assert.ok(units.length<2**24,'This compact fixture must select a wider unit codec for larger dictionaries.');
let unitPage=0,buffer=[],length=0;const unitLocations=[];
async function flushPage(){if(!length)return;await writeFile(`${root}/units/${unitPage}.bin`,Buffer.concat(buffer));unitPage++;buffer=[];length=0;}
for(const bytes of units){if(length+bytes.length>23000)await flushPage();unitLocations.push([unitPage,length,bytes.length]);buffer.push(bytes);length+=bytes.length;}await flushPage();
await writeFile(`${root}/unit-catalog.json`,JSON.stringify(unitLocations));
let tokenMapBytes=0;for(const token of tokenMaps){const packed=Buffer.alloc(token.units.length*3);token.units.forEach((id,i)=>packed.writeUIntBE(id,i*3,3));await writeFile(`${root}/token-${token.id}.map`,packed);tokenMapBytes+=packed.length;}
// Six-byte records: page index, offset, length. Addresses are shared once per page.
const unitBytes=units.reduce((n,b)=>n+b.length,0),dataCatalogBytes=catalog.length*6,unitCatalogBytes=unitLocations.length*6,addressTableBytes=(report.carrierPages+unitPage)*20,tokenRecordBytes=tokenMaps.length*6;
assert.ok(report.carrierPages<65536&&unitPage<65536,'Use wider page fields when necessary; this is not a storage-size limit.');
const total=report.imageBytes+dataCatalogBytes+unitBytes+unitCatalogBytes+addressTableBytes+tokenMapBytes+tokenRecordBytes;
const result={schema:'keel-shared-raster-maps@1',size:1080,unitSize,tokens:tokenMaps.length,imageBytes:report.imageBytes,dataCatalogBytes,unitBytes,unitCatalogBytes,addressTableBytes,tokenMapBytes,tokenRecordBytes,preparedBytes:total,sourceLayerBytes:report.sourceLayerBytes,preparedWithSourcesBytes:total+report.sourceLayerBytes,under250MBWithSources:total+report.sourceLayerBytes<=250_000_000,under500MBWithSources:total+report.sourceLayerBytes<=500_000_000,originalFlatMapBytes:oldMapBytes,uniqueUnits:units.length,unitPages:unitPage,allExpandedMapsIdentical:true,pngProof:'All 4000 expanded maps match the previously pixel-verified PNG maps exactly.',readGas:'Not measured for this compact codec yet.',scope:'Binary rendering resources, shared catalogs and instructions, plus explicit source-layer total; NFT metadata and contract bytecode are separate.'};
await writeFile(`${root}/report.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
