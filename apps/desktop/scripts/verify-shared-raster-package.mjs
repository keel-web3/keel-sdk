/** Independent file-backed acceptance of the complete compact package. */
import {readFile,writeFile} from 'node:fs/promises';
import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const source='apps/desktop/artifacts/gator-raster-study/full-1080/native-4000/single-idat',root=`${source}/shared-maps-4`,json=async p=>JSON.parse(await readFile(p));
const report=await json(`${source}/report.json`),shared=await json(`${root}/report.json`),catalog=await json(`${source}/catalog.json`),units=await json(`${root}/unit-catalog.json`);
async function loadPages(folder,count){const pages=[];for(let at=0;at<count;at+=32)pages.push(...await Promise.all(Array.from({length:Math.min(32,count-at)},(_,i)=>readFile(`${folder}/${at+i}.bin`))));return pages;}
const dataPages=await loadPages(`${source}/pages`,report.carrierPages),unitPages=await loadPages(`${root}/units`,shared.unitPages);
function encodeRanges(records,pages){const encoded=Buffer.alloc(records.length*6);records.forEach(([page,offset,length],i)=>{assert.ok(page<65536&&offset+length<=pages[page].length&&length>0);[page,offset,length].forEach((n,j)=>encoded.writeUInt16BE(n,i*6+j*2));});return encoded;}
const dataRanges=encodeRanges(catalog,dataPages),unitRanges=encodeRanges(units,unitPages);await writeFile(`${root}/data-ranges.bin`,dataRanges);await writeFile(`${root}/instruction-ranges.bin`,unitRanges);
let mapsChecked=0,pngsChecked=0;
for(const token of report.results){const map=await readFile(`${root}/token-${token.tokenId}.map`),flat=await readFile(`${source}/token-${token.tokenId}.map`);let cursor=0;const parts=[];
    for(let at=0;at<map.length;at+=3){const unit=map.readUIntBE(at,3),entry=unit*6,p=unitRanges.readUInt16BE(entry),o=unitRanges.readUInt16BE(entry+2),n=unitRanges.readUInt16BE(entry+4);assert.ok(n%3===0&&n<=12);const bytes=unitPages[p];for(let i=o;i<o+n;i+=3){const id=bytes.readUIntBE(i,3);assert.equal(id,flat.readUInt32BE(cursor),`Token ${token.tokenId} at ${cursor}`);cursor+=4;const d=id*6,dp=dataRanges.readUInt16BE(d),offset=dataRanges.readUInt16BE(d+2),length=dataRanges.readUInt16BE(d+4);parts.push(dataPages[dp].subarray(offset,offset+length));}}
    assert.equal(cursor,flat.length);mapsChecked++;const png=Buffer.concat(parts);assert.equal(png.length,token.pngBytes);assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1080);let dataChunks=0;
    for(let at=8;at<png.length;){const n=png.readUInt32BE(at),end=at+n+12;assert.ok(end<=png.length);assert.equal(crc32(png.subarray(at+4,end-4)),png.readUInt32BE(end-4));if(png.subarray(at+4,at+8).toString()==='IDAT')dataChunks++;at=end;}assert.equal(dataChunks,1);pngsChecked++;
}
const hash=b=>createHash('sha256').update(b).digest('hex'),result={allFileBackedMapsIdentical:mapsChecked===4000,mapsChecked,validSingleIDATPNGContainers:pngsChecked,dataRangeBytes:dataRanges.length,instructionRangeBytes:unitRanges.length,dataRangesSHA256:hash(dataRanges),instructionRangesSHA256:hash(unitRanges),pixelProof:'The expanded IDs equal the flat maps whose compressed streams matched all 4000 native pixel-verified images; 128 also have independent PNG decoder comparisons.'};
await writeFile(`${root}/file-verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
