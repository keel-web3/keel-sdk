import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareMediaCandidate,verifyActualMediaPair} from '../packages/builder/dist/media-preparation.js';
import {assertMoviePresentationSemantics} from '../packages/builder/dist/movie-presentation-semantics.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static');
const recipe={schema:'keel-media-edit@1',mode:'lossless',format:'webp',quality:82,noSound:false},original={...recipe,mode:'original',format:'original'};
const report='Video: h264, gbrp(pc), 32x24 [SAR 1:1 DAR 4:3]';
async function inDir(run){const dir=await mkdtemp(path.join(tmpdir(),'keel-track-binding-'));try{return await run(dir)}finally{await rm(dir,{recursive:true,force:true})}}
async function source(dir,audio=false){const file=path.join(dir,audio?'source.mov':'source.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5',...(audio?['-f','lavfi','-i','sine=frequency=440:sample_rate=48000']:[]),'-t','0.6','-c:v','libx264rgb','-crf','0','-color_primaries','bt709','-color_trc','iec61966-2-1','-colorspace','rgb','-color_range','pc','-threads','2',...(audio?['-c:a','pcm_f64le']:['-an']),'-use_editlist','0','-y',file]);return new Uint8Array(await readFile(file))}
function rewrite(buffer,names,replace){const b=Buffer.from(buffer),parts=[];for(let p=0;p<b.length;){const n=b.readUInt32BE(p),kind=b.toString('latin1',p+4,p+8);assert.ok(n>=8&&p+n<=b.length);let box=Buffer.from(b.subarray(p,p+n));if(kind===names[0]){if(names.length===1)box=replace(box);else{const body=rewrite(box.subarray(8),names.slice(1),replace);box=Buffer.concat([box.subarray(0,8),body]);box.writeUInt32BE(box.length)}}parts.push(box);p+=n}return new Uint8Array(Buffer.concat(parts))}
const table=kind=>['moov','trak','mdia','minf','stbl',kind];
async function exactNative(bytes){assert.deepEqual((await prepareMediaCandidate({bytes,recipe:original})).bytes,bytes)}
test('ordinary no-edit video remains complete and equivalent through the actual shared APIs',()=>inDir(async dir=>{
 const bytes=await source(dir);assert.equal(Buffer.from(bytes).includes(Buffer.from('edts')),false);
 const candidate=await prepareMediaCandidate({bytes,recipe}),proof=await verifyActualMediaPair({sourceBytes:bytes,candidateBytes:candidate.bytes,recipe});
 assert.equal(proof.source.info.frameCount,3);assert.deepEqual(proof.source.info.frameDurationsMs,[200,200,200]);assert.deepEqual(proof.source.frameHashes,proof.candidate.frameHashes);await exactNative(bytes);
}));
test('STSZ fullbox, fixed/variable byte bounds, counts, zero sizes, duplicate and compact ambiguity fail closed',()=>inDir(async dir=>{
 const bytes=await source(dir),stsz=table('stsz');
 const invalid=[
  rewrite(bytes,stsz,b=>{b[8]=1;return b}),rewrite(bytes,stsz,b=>{b[11]=1;return b}),
  rewrite(bytes,stsz,b=>{b.writeUInt32BE(0,16);return b}),rewrite(bytes,stsz,b=>{b.writeUInt32BE(4,16);return b}),
  rewrite(bytes,stsz,b=>{b.writeUInt32BE(0,20);return b}),rewrite(bytes,stsz,b=>{b.writeUInt32BE(1,12);return b}),
  rewrite(bytes,stsz,b=>{const q=b.subarray(0,20);q.writeUInt32BE(q.length);q.writeUInt32BE(0xffffffff,12);return q}),
  rewrite(bytes,stsz,b=>{const q=Buffer.concat([b,Buffer.from([0])]);q.writeUInt32BE(q.length);return q}),
  rewrite(bytes,stsz,b=>Buffer.concat([b,b])),rewrite(bytes,stsz,()=>Buffer.alloc(0)),
  rewrite(bytes,stsz,b=>{b.write('stz2',4);return b})
 ];
 for(const changed of invalid){assert.throws(()=>assertMoviePresentationSemantics(changed,'',report,32,24),/sample|count|bounds|duplicate|semantics/i);await assert.rejects(prepareMediaCandidate({bytes:changed,recipe}));await exactNative(changed)}
}));
test('fixed-size PCM sample tables and the video track each bind their own no-edit clocks and counts',()=>inDir(async dir=>{
 const bytes=await source(dir,true);let fixed=0;
 rewrite(bytes,table('stsz'),b=>{if(b.readUInt32BE(12)>0){fixed++;assert.equal(b.length,20);assert.equal(b.readUInt32BE(12),8);assert.equal(b.readUInt32BE(16),28800)}return b});assert.equal(fixed,1);
 assert.doesNotThrow(()=>assertMoviePresentationSemantics(bytes,'',report,32,24));await exactNative(bytes);
 for(const kind of ['stsz','stts']){let index=0;const changed=rewrite(bytes,table(kind),b=>{if(index++===1){const at=kind==='stsz'?16:16;b.writeUInt32BE(b.readUInt32BE(at)+1,at)}return b});assert.throws(()=>assertMoviePresentationSemantics(changed,'',report,32,24),/sample|timeline|bounds|semantics/i);await exactNative(changed)}
 let mdhd=0;const changed=rewrite(bytes,['moov','trak','mdia','mdhd'],b=>{if(mdhd++===1)b.writeUInt32BE(b.readUInt32BE(24)+1,24);return b});assert.throws(()=>assertMoviePresentationSemantics(changed,'',report,32,24),/sample|timeline|bounds|semantics/i);await exactNative(changed);
}));
