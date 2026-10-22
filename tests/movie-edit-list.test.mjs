import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {prepareMediaCandidate,verifyActualMediaPair} from '../packages/builder/dist/media-preparation.js';
import {assertMoviePresentationSemantics} from '../packages/builder/dist/movie-presentation-semantics.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static'),sharp=require('sharp');
const recipe={schema:'keel-media-edit@1',mode:'lossless',format:'webp',quality:82,noSound:false},original={...recipe,mode:'original',format:'original'};
async function inDir(run){const dir=await mkdtemp(path.join(tmpdir(),'keel-edit-grammar-'));try{return await run(dir)}finally{await rm(dir,{recursive:true,force:true})}}
async function movie(dir){const p=path.join(dir,'source.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','0.6','-c:v','libx264rgb','-crf','0','-color_primaries','bt709','-color_trc','iec61966-2-1','-colorspace','rgb','-color_range','pc','-threads','2','-an','-y',p]);return new Uint8Array(await readFile(p));}
function rewrite(buffer,names,replace){const b=Buffer.from(buffer),parts=[];for(let p=0;p<b.length;){const n=b.readUInt32BE(p),kind=b.toString('latin1',p+4,p+8);assert.ok(n>=8&&p+n<=b.length);let box=Buffer.from(b.subarray(p,p+n));if(kind===names[0]){if(names.length===1)box=replace(box);else{const body=rewrite(box.subarray(8),names.slice(1),replace);box=Buffer.concat([box.subarray(0,8),body]);box.writeUInt32BE(box.length)}}parts.push(box);p+=n}return new Uint8Array(Buffer.concat(parts))}
function version1(box){assert.equal(box[8],0);assert.equal(box.readUInt32BE(12),1);const b=Buffer.alloc(36);b.writeUInt32BE(36);b.write('elst',4);b[8]=1;b.writeUInt32BE(1,12);b.writeBigUInt64BE(BigInt(box.readUInt32BE(16)),16);b.writeBigInt64BE(BigInt(box.readInt32BE(20)),24);b.writeInt32BE(box.readInt32BE(24),32);return b;}
async function nativeExact(bytes){const result=await prepareMediaCandidate({bytes,recipe:original});assert.deepEqual(result.bytes,bytes);assert.equal(result.verification.completeDecode,false);}
test('well-formed version0 and version1 identity edits retain all real decoded frames and exact timing',()=>inDir(async dir=>{
 const source=await movie(dir),v1=rewrite(source,['moov','trak','edts','elst'],version1);
 for(const bytes of [source,v1]){const c=await prepareMediaCandidate({bytes,recipe});assert.equal(c.bytes.length,464);const p=await verifyActualMediaPair({sourceBytes:bytes,candidateBytes:c.bytes,recipe});assert.equal(p.eligibility,'requires-canonical-player-proof');assert.equal(p.source.info.frameCount,3);assert.deepEqual(p.source.frameHashes,p.candidate.frameHashes);assert.deepEqual(p.source.info.frameTimesMs,[0,200,400]);assert.deepEqual(p.source.info.frameDurationsMs,[200,200,200]);await nativeExact(bytes);}
}));
test('edit-list length, segment, signed media-time, clocks and dwell/reverse forms reject with unchanged originals',()=>inDir(async dir=>{
 const source=await movie(dir),edit=['moov','trak','edts','elst'];
 const invalid=[
  rewrite(source,edit,b=>{b.writeUInt32BE(0,16);return b}),
  rewrite(source,edit,b=>{b.writeUInt32BE(601,16);return b}),
  rewrite(source,edit,b=>{b.writeUInt32BE(300,16);return b}),
  rewrite(source,edit,b=>{b.writeInt32BE(-1,20);return b}),
  rewrite(source,edit,b=>{b.writeInt32BE(1,20);return b}),
  rewrite(source,edit,b=>{b.writeInt32BE(6144,20);return b}),
  rewrite(source,edit,b=>{b.writeInt32BE(0,24);return b}),
  rewrite(source,edit,b=>{b.writeInt32BE(-65536,24);return b}),
  rewrite(source,edit,b=>{const q=Buffer.concat([b,Buffer.from([0])]);q.writeUInt32BE(q.length);return q}),
  rewrite(source,edit,b=>{const q=version1(b);q.writeBigUInt64BE(0xffffffffffffffffn,16);return q}),
  rewrite(source,edit,b=>{const q=version1(b);q.writeBigInt64BE(-1n,24);return q}),
  rewrite(source,['moov','mvhd'],b=>{b.writeUInt32BE(0,20);return b}),
  rewrite(source,['moov','trak','mdia','mdhd'],b=>{b.writeUInt32BE(0,20);return b}),
  rewrite(source,['moov','trak','mdia','mdhd'],b=>{b[11]=1;return b}),
  rewrite(source,['moov','trak','tkhd'],b=>{b.writeUInt32BE(601,28);return b}),
  rewrite(source,['moov','trak','edts'],b=>b.subarray(0,8).map((v,i)=>i===3?8:v)),
 ];
 for(const bytes of invalid){await assert.rejects(prepareMediaCandidate({bytes,recipe}),/edit|clock|segment|rate|bounds|semantics/i);await nativeExact(bytes);}
}));
test('an AVIF brand cannot grant repeat-edit authority to a real H264 movie',()=>inDir(async dir=>{
 const source=await movie(dir),flags=rewrite(source,['moov','trak','edts','elst'],b=>{b[11]=1;return b}),spoof=rewrite(flags,['ftyp'],b=>{b.write('avis',8);b.write('avif',16);return b});
 await assert.rejects(prepareMediaCandidate({bytes:spoof,recipe}),/AVIF|repeat|flags|edit|semantics/i);await nativeExact(spoof);
}));
test('coherently shortened header clocks cannot hide unchanged full sample timing',()=>inDir(async dir=>{
 const source=await movie(dir);
 let changed=rewrite(source,['moov','mvhd'],b=>{b.writeUInt32BE(300,24);return b});
 changed=rewrite(changed,['moov','trak','tkhd'],b=>{b.writeUInt32BE(300,28);return b});
 changed=rewrite(changed,['moov','trak','mdia','mdhd'],b=>{b.writeUInt32BE(3072,24);return b});
 changed=rewrite(changed,['moov','trak','edts','elst'],b=>{b.writeUInt32BE(300,16);return b});
 await assert.rejects(prepareMediaCandidate({bytes:changed,recipe}),/complete sample timeline|edit|bounds|semantics/i);await nativeExact(changed);
 const badCount=rewrite(source,['moov','trak','mdia','minf','stbl','stts'],b=>{b.writeUInt32BE(0,12);return b});
 assert.throws(()=>assertMoviePresentationSemantics(badCount,'','Video: h264, gbrp(pc), 32x24 [SAR 1:1 DAR 4:3]',32,24),/timeline|count|edit|semantics/i);
 await assert.rejects(prepareMediaCandidate({bytes:badCount,recipe}),/missing mandatory atoms|broken header/i);await nativeExact(badCount);
}));
test('actual AV1 AVIF default infinite repeat remains supported; finite or inconsistent repeat profiles retain native',async()=>{
 const rgba=Buffer.alloc(4*4*4*2);for(let i=0;i<32;i++){rgba[i*4+(i<16?0:1)]=255;rgba[i*4+3]=255;}
 const gif=new Uint8Array(await sharp(rgba,{raw:{width:4,height:8,channels:4,pageHeight:4}}).gif({delay:[120,240],loop:0}).toBuffer());
 const avif=await prepareMediaCandidate({bytes:gif,recipe:{...recipe,format:'avif'}}),mp4=await prepareMediaCandidate({bytes:avif.bytes,recipe:{...recipe,format:'mp4'}});
 assert.deepEqual(mp4.sourceInfo.frameDurationsMs,[120,240]);assert.deepEqual(mp4.candidateInfo.frameDurationsMs,[120,240]);
 const finite=rewrite(avif.bytes,['moov','trak','tkhd'],b=>{assert.equal(b[8],1);b.writeBigUInt64BE(720n,36);return b});
 const badFlags=rewrite(avif.bytes,['moov','trak','edts','elst'],b=>{b[11]=3;return b});
 for(const bytes of [finite,badFlags]){await assert.rejects(prepareMediaCandidate({bytes,recipe:{...recipe,format:'mp4'}}),/AVIF|repeat|flags|edit|semantics/i);await nativeExact(bytes);}
});
