/** Remove repeated per-fragment PNG envelopes; preserve the exact DEFLATE stream. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import assert from 'node:assert/strict';
import {decodeRasterPNG} from '../../../packages/sdk/dist/raster-strips.js';
const source='apps/desktop/artifacts/gator-raster-study/full-1080/native-4000',root=`${source}/single-idat`;
const original=JSON.parse(await readFile(`${source}/report.json`)),oldCatalog=JSON.parse(await readFile(`${source}/catalog.json`));
await mkdir(`${root}/pages`,{recursive:true});
const oldPages=[];for(let i=0;i<original.carrierPages;i+=32)oldPages.push(...await Promise.all(Array.from({length:Math.min(32,original.carrierPages-i)},(_,j)=>readFile(`${source}/pages/${i+j}.bin`))));
const oldBytes=id=>{const[p,o,n]=oldCatalog[id];return oldPages[p].subarray(o,o+n);};
const known=new Map(),pieces=[],catalog=[],cached=new Map(),maps=[];let page=0,parts=[],pageBytes=0,imageBytes=0;
async function flush(){if(!pageBytes)return;await writeFile(`${root}/pages/${page}.bin`,Buffer.concat(parts));page++;parts=[];pageBytes=0;}
async function store(bytes){const ids=[];for(let at=0;at<bytes.length;at+=23000){const b=bytes.subarray(at,at+23000),key=createHash('sha256').update(b).digest('hex');let id=known.get(key);if(id===undefined){if(pageBytes+b.length>23000)await flush();id=catalog.length;known.set(key,id);catalog.push([page,pageBytes,b.length]);pieces.push(b);parts.push(b);pageBytes+=b.length;imageBytes+=b.length;}ids.push(id);}return ids;}
let decodedChecks=0,largest=0,mostRefs=0;const sampleIds=new Set(JSON.parse(await readFile('apps/desktop/artifacts/gator-raster-study/sample-ids.json'))),started=Date.now();
for(const token of original.results){
    const map=await readFile(`${source}/token-${token.tokenId}.map`),ids=[];for(let i=0;i<map.length;i+=4)ids.push(map.readUInt32BE(i));
    const head=oldBytes(ids[0]),tail=oldBytes(ids.at(-1));assert.equal(head.subarray(-10,-6).toString(),'IDAT');
    const prefix=head.subarray(0,head.length-14),payloads=[head.subarray(head.length-6,head.length-4)],newIds=[];
    newIds.push(...await store(payloads[0]));
    for(let i=1;i<ids.length-1;){const first=ids[i],b=oldBytes(first);let entry=cached.get(first);
        if(entry&&entry.oldIds.every((id,j)=>ids[i+j]===id)){newIds.push(...entry.newIds);payloads.push(entry.payload);i+=entry.oldIds.length;continue;}
        assert.equal(b.subarray(4,8).toString(),'IDAT');const fullLength=b.readUInt32BE(0)+12,group=[],oldIds=[];let size=0;
        while(size<fullLength){const id=ids[i++],piece=oldBytes(id);oldIds.push(id);group.push(piece);size+=piece.length;}
        assert.equal(size,fullLength);const chunk=group.length===1?group[0]:Buffer.concat(group),payload=chunk.subarray(8,chunk.length-4);assert.equal(crc32(chunk.subarray(4,chunk.length-4)),chunk.readUInt32BE(chunk.length-4));
        entry={oldIds,newIds:await store(payload),payload};cached.set(first,entry);newIds.push(...entry.newIds);payloads.push(payload);
    }
    assert.equal(tail.subarray(4,8).toString(),'IDAT');const finalPayload=tail.subarray(8,8+tail.readUInt32BE(0));payloads.push(finalPayload);newIds.push(...await store(finalPayload));
    const stream=Buffer.concat(payloads),mappedStream=Buffer.concat(newIds.map(id=>pieces[id]));assert.ok(stream.equals(mappedStream),`Compressed stream changed for ${token.tokenId}`);
    const newHead=Buffer.alloc(prefix.length+8);prefix.copy(newHead);newHead.writeUInt32BE(stream.length,prefix.length);newHead.write('IDAT',prefix.length+4);
    const newTail=Buffer.alloc(16);newTail.writeUInt32BE(crc32(stream,crc32(Buffer.from('IDAT'))));tail.subarray(tail.length-12).copy(newTail,4);
    const refs=[...await store(newHead),...newIds,...await store(newTail)],png=Buffer.concat(refs.map(id=>pieces[id]));
    if(sampleIds.has(token.tokenId)){const previous=Buffer.concat(ids.map(oldBytes));const a=await decodeRasterPNG(previous),b=await decodeRasterPNG(png);assert.ok(Buffer.from(a.data).equals(Buffer.from(b.data)),`Independent PNG pixels changed for ${token.tokenId}`);decodedChecks++;}
    const packed=Buffer.alloc(refs.length*4);refs.forEach((id,i)=>packed.writeUInt32BE(id,i*4));await writeFile(`${root}/token-${token.tokenId}.map`,packed);
    if(token.tokenId===0||png.length>largest||refs.length>mostRefs)await writeFile(`${root}/token-${token.tokenId}.png`,png);largest=Math.max(largest,png.length);mostRefs=Math.max(mostRefs,refs.length);
    maps.push({...token,pngBytes:png.length,references:refs.length,mapBytes:packed.length});if(maps.length%256===0)console.log(JSON.stringify({phase:'single-IDAT',done:maps.length,total:original.tokens,seconds:(Date.now()-started)/1000}));
}
await flush();await writeFile(`${root}/catalog.json`,JSON.stringify(catalog));const mapBytes=maps.reduce((n,t)=>n+t.mapBytes,0),report={schema:'keel-single-idat-study@1',size:1080,tokens:maps.length,imageBytes,catalogBytes:catalog.length*24,mapBytes,preparedBytes:imageBytes+catalog.length*24+mapBytes,sourceLayerBytes:original.sourceLayerBytes,carrierPages:page,allDeflateStreamsIdentical:true,independentPixelChecks:decodedChecks,results:maps,scope:'Identical compressed pixels under one PNG IDAT envelope. Compact mapping is measured separately.'};
await writeFile(`${root}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,results:undefined}));
