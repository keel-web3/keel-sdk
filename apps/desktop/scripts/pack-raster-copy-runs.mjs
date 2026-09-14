/** Elide the default repeat=1 operand, preserving every shared instruction's semantics. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source='apps/desktop/artifacts/gator-raster-study/full-1080/native-4000/single-idat',old=`${source}/copy-runs`,root=`${source}/copy-runs-packed`,json=async p=>JSON.parse(await readFile(p));
const report=await json(`${old}/report.json`),dataReport=await json(`${source}/report.json`),catalog=await json(`${old}/unit-catalog.json`),pages=[];
for(let at=0;at<report.unitPages;at+=32)pages.push(...await Promise.all(Array.from({length:Math.min(32,report.unitPages-at)},(_,i)=>readFile(`${old}/units/${at+i}.bin`))));
await mkdir(`${root}/units`,{recursive:true});const locations=[];let page=0,parts=[],length=0,unitBytes=0;
async function flush(){if(!length)return;await writeFile(`${root}/units/${page}.bin`,Buffer.concat(parts));page++;parts=[];length=0;}
for(const [p,o,n] of catalog){const bytes=pages[p].subarray(o,o+n),pieces=[];for(let at=0;at<n;at+=8){const size=bytes.readUInt16BE(at+4),repeat=bytes.readUInt16BE(at+6);assert.ok(size>0&&size<32768&&repeat>0);const packed=Buffer.alloc(repeat===1?6:8);bytes.copy(packed,0,at,at+6);if(repeat!==1){packed.writeUInt16BE(size|32768,4);packed.writeUInt16BE(repeat,6);}pieces.push(packed);}
    const packed=Buffer.concat(pieces);let expected=0;for(let at=0;at<packed.length;){const tagged=packed.readUInt16BE(at+4),hasRepeat=!!(tagged&32768),repeat=hasRepeat?packed.readUInt16BE(at+6):1;assert.equal(packed.readUInt16BE(at),bytes.readUInt16BE(expected));assert.equal(packed.readUInt16BE(at+2),bytes.readUInt16BE(expected+2));assert.equal(tagged&32767,bytes.readUInt16BE(expected+4));assert.equal(repeat,bytes.readUInt16BE(expected+6));at+=hasRepeat?8:6;expected+=8;}assert.equal(expected,bytes.length);
    if(length+packed.length>23000)await flush();locations.push([page,length,packed.length]);parts.push(packed);length+=packed.length;unitBytes+=packed.length;
}await flush();await writeFile(`${root}/unit-catalog.json`,JSON.stringify(locations));
for(const token of report.results)await writeFile(`${root}/token-${token.tokenId}.map`,await readFile(`${old}/token-${token.tokenId}.map`));
const addressTableBytes=(dataReport.carrierPages+page)*20,total=report.preparedBytes-report.unitBytes-report.addressTableBytes+unitBytes+addressTableBytes,result={...report,schema:'keel-raster-copy-runs@2',unitBytes,addressTableBytes,unitPages:page,preparedBytes:total,preparedWithSourcesBytes:total+report.sourceLayerBytes,under250MBWithSources:total+report.sourceLayerBytes<=250_000_000,under500MBWithSources:total+report.sourceLayerBytes<=500_000_000,allInstructionSemanticsIdentical:true,verifiedSharedInstructions:locations.length,encoding:'6-byte page/offset/length; high length bit adds an optional 2-byte repeat count'};
await writeFile(`${root}/report.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,results:undefined}));
