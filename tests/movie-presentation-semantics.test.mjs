import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareMediaCandidate,compareMediaFrames,verifyActualMediaPair} from '../packages/builder/dist/media-preparation.js';
import {assertMoviePresentationSemantics} from '../packages/builder/dist/movie-presentation-semantics.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static');
const recipe={schema:'keel-media-edit@1',mode:'lossless',format:'webp',quality:82,noSound:false};
const original={schema:'keel-media-edit@1',mode:'original',format:'original',quality:82,noSound:false};
const fixtures=new URL('../docs/review/temporal-display-metadata-20261022/reviewer-inputs/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const identities={sar:'66f1276bd4fdeafa2b3eb370598250b40248bb7ed356829c7bf257635512cab3',title:'7c41053e177dd103e6a2a40e4b634a9cdaa48288b3ac3a028d64facffff636a7'};
for(const kind of ['sar','title'])test(`exact retained ${kind}: shared preparation/comparison and actual candidate proof reject; original mode is byte exact`,async()=>{
 const source=new Uint8Array(await readFile(new URL(kind+'.mp4',fixtures))),candidate=new Uint8Array(await readFile(new URL(kind+'.webp',fixtures))),snapshot=source.slice();
 assert.equal(hash(source),identities[kind]);assert.equal(hash(candidate),'15e160de0827a42f62a73490d690561125232cff77877db53148cbc1ece035db');
 for(const operation of [()=>prepareMediaCandidate({bytes:source,recipe}),()=>compareMediaFrames({bytes:source,recipe,timeMs:0}),()=>verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate,recipe})])await assert.rejects(operation(),/aspect|metadata|semantics|preserv/i);
 const native=await prepareMediaCandidate({bytes:source,recipe:original,mediaType:'video/mp4'});assert.deepEqual(native.bytes,snapshot);assert.equal(native.verification.completeDecode,false);assert.deepEqual(source,snapshot);
});
async function inDir(run){const dir=await mkdtemp(path.join(tmpdir(),'keel-movie-semantics-'));try{return await run(dir)}finally{await rm(dir,{recursive:true,force:true})}}
async function movie(dir,name,extra=[]){const file=path.join(dir,name+'.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','0.6','-c:v','libx264rgb','-crf','0','-threads','2',...extra,'-an','-y',file]);return new Uint8Array(await readFile(file));}
test('creator, creation-time, stream title and language metadata are never stripped behind a lossless flag',()=>inDir(async dir=>{
 for(const [name,extra] of [['artist',['-metadata','artist=CREATOR']],['comment',['-metadata','comment=PRIVATE_NOTE']],['created',['-metadata','creation_time=2026-01-01T00:00:00Z']],['language',['-metadata:s:v:0','language=eng']],['handler',['-metadata:s:v:0','handler_name=CREATOR_HANDLER']]]){
  const source=await movie(dir,name,extra);await assert.rejects(prepareMediaCandidate({bytes:source,recipe}),/metadata|semantics/i,name);assert.deepEqual((await prepareMediaCandidate({bytes:source,recipe:original})).bytes,source);
 }
}));
test('real remuxed display rotation is rejected instead of being baked into lossless pixels',()=>inDir(async dir=>{
 const source=await movie(dir,'plain');await writeFile(path.join(dir,'plain.mp4'),source);const target=path.join(dir,'rotated.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-i',path.join(dir,'plain.mp4'),'-c','copy','-metadata:s:v:0','rotate=180','-y',target]);const rotated=new Uint8Array(await readFile(target));
 await assert.rejects(prepareMediaCandidate({bytes:rotated,recipe}),/display|matrix|rotation|semantics/i);assert.deepEqual((await prepareMediaCandidate({bytes:rotated,recipe:original})).bytes,rotated);
}));
// Rebuild complete ancestor sizes when adding a valid semantic box. moov is
// after mdat in these fixtures, so sample offsets stay unchanged.
function rewrite(buffer,names,replace){
 const b=Buffer.from(buffer),parts=[];for(let p=0;p<b.length;){const n=b.readUInt32BE(p),kind=b.toString('latin1',p+4,p+8);assert.ok(n>=8&&p+n<=b.length);let box=Buffer.from(b.subarray(p,p+n));
  if(kind===names[0]){if(names.length===1)box=replace(box);else{const skip=kind==='stsd'?8:['avc1','av01'].includes(kind)?78:0;const body=rewrite(box.subarray(8+skip),names.slice(1),replace);box=Buffer.concat([box.subarray(0,8+skip),body]);box.writeUInt32BE(box.length,0);}}
  parts.push(box);p+=n;
 }return Buffer.concat(parts);
}
function atom(kind,payload){const b=Buffer.alloc(8+payload.length);b.writeUInt32BE(b.length);b.write(kind,4,4,'latin1');Buffer.from(payload).copy(b,8);return b;}
const report='Video: h264, gbrp(pc), 32x24 [SAR 1:1 DAR 4:3]';
test('raw movie and track matrix, display dimensions, clean aperture and explicit color boxes fail closed',()=>inDir(async dir=>{
 const source=Buffer.from(await movie(dir,'plain'));
 const cases=[
  ['track matrix',rewrite(source,['moov','trak','tkhd'],box=>{box.writeInt32BE(-65536,48);return box;})],
  ['disabled track',rewrite(source,['moov','trak','tkhd'],box=>{box[11]=0;return box;})],
  ['movie playback volume',rewrite(source,['moov','mvhd'],box=>{box.writeUInt16BE(128,32);return box;})],
  ['movie playback rate',rewrite(source,['moov','mvhd'],box=>{box.writeUInt32BE(32768,28);return box;})],
  ['movie matrix',rewrite(source,['moov','mvhd'],box=>{box.writeInt32BE(-65536,44);return box;})],
  ['track geometry',rewrite(source,['moov','trak','tkhd'],box=>{box.writeUInt32BE(64*65536,84);return box;})],
  ['unexposed creation',rewrite(source,['moov','trak','mdia','mdhd'],box=>{box.writeUInt32BE(1,12);return box;})],
  ['compressor creator',rewrite(source,['moov','trak','mdia','minf','stbl','stsd','avc1'],box=>{box[50]=7;box.write('CREATOR',51);return box;})],
  ['clean aperture',rewrite(source,['moov','trak','mdia','minf','stbl','stsd','avc1'],box=>{const values=Buffer.alloc(32);[32,1,24,1,0,1,0,1].forEach((v,i)=>values.writeUInt32BE(v,i*4));const b=Buffer.concat([box,atom('clap',values)]);b.writeUInt32BE(b.length);return b;})],
  ['HDR color',rewrite(source,['moov','trak','mdia','minf','stbl','stsd','avc1'],box=>{const colr=Buffer.from('6e636c7800090010000980','hex'),b=Buffer.concat([box,atom('colr',colr)]);b.writeUInt32BE(b.length);return b;})],
  ['duplicate pixel aspect',rewrite(source,['moov','trak','mdia','minf','stbl','stsd','avc1'],box=>{const b=Buffer.concat([box,atom('pasp',Buffer.from('0000000100000001','hex'))]);b.writeUInt32BE(b.length);return b;})],
  ['unknown creator box',rewrite(source,['moov','udta'],box=>{const b=Buffer.concat([box,atom('XMP_',Buffer.from('CREATOR'))]);b.writeUInt32BE(b.length);return b;})],
 ];
 assert.doesNotThrow(()=>assertMoviePresentationSemantics(source,'',report,32,24));
 for(const [name,bytes] of cases){assert.throws(()=>assertMoviePresentationSemantics(bytes,'',report,32,24),/metadata|matrix|geometry|aperture|color|semantics/i,name);await assert.rejects(prepareMediaCandidate({bytes:new Uint8Array(bytes),recipe}),undefined,name);assert.deepEqual(Buffer.from((await prepareMediaCandidate({bytes:new Uint8Array(bytes),recipe:original})).bytes),bytes);}
}));
test('conflicting DAR, multiline metadata, extra side data and incomplete boxes cannot manufacture admission',()=>inDir(async dir=>{
 const source=await movie(dir,'plain');
 assert.doesNotThrow(()=>assertMoviePresentationSemantics(source,'',report.replace(/ \[SAR.*$/,''),32,24),'identity track dimensions and complete pasp remain authoritative when the textual probe omits SAR');
 for(const [probe,stream] of [['',report.replace('DAR 4:3','DAR 1:1')],['    Metadata:\n      title : original\n      continuation : hidden',report],['    Side data:\n      stereo3d: side by side',report]])assert.throws(()=>assertMoviePresentationSemantics(source,probe,stream,32,24),/metadata|aspect|semantics/i);
 assert.throws(()=>assertMoviePresentationSemantics(source.subarray(0,source.length-1),'',report,32,24),/bounds|semantics/i);
}));
test('original untagged movie fixtures retain native bytes instead of acquiring invented image color semantics',()=>inDir(async dir=>{
 const source=await movie(dir,'untagged'),candidate=new Uint8Array(await readFile(new URL('sar.webp',fixtures)));
 for(const format of ['webp','avif'])await assert.rejects(prepareMediaCandidate({bytes:source,recipe:{...recipe,format}}),/unspecified color semantics/i);
 await assert.rejects(verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate,recipe}),/color semantics/i);
 assert.deepEqual((await prepareMediaCandidate({bytes:source,recipe:original})).bytes,source);
 const mov=path.join(dir,'original-untagged.mov');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','1','-c:v','libx264rgb','-crf','0','-threads','2','-y',mov]);const oldMOV=new Uint8Array(await readFile(mov));
 await assert.rejects(prepareMediaCandidate({bytes:oldMOV,recipe:{...recipe,format:'avif',noSound:true}}),/unspecified color semantics/i);
 assert.deepEqual((await prepareMediaCandidate({bytes:oldMOV,recipe:original})).bytes,oldMOV);
}));
