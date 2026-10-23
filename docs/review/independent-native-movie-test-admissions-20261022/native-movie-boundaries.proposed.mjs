import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareMediaFrames,prepareMediaCandidate,ORIGINAL_MEDIA_EDIT_RECIPE as original} from '../packages/builder/dist/media-preparation.js';
import {assertMoviePresentationSemantics} from '../packages/builder/dist/movie-presentation-semantics.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),ffmpeg=require('ffmpeg-static');
const fixtures=new URL('../docs/review/temporal-display-metadata-20261022/reviewer-inputs/',import.meta.url);
const sar=Buffer.from(await readFile(new URL('sar.mp4',fixtures))),title=Buffer.from(await readFile(new URL('title.mp4',fixtures)));
const stream='Video: h264, gbrp(pc, gbr/unknown/unknown), 32x24 [SAR 2:1 DAR 8:3]';
const titleStream=stream.replace('2:1 DAR 8:3','1:1 DAR 4:3'),titleReport='    Metadata:\n      title : PRIVATE_CREATOR_TITLE_REQUIRED';
function rewrite(buffer,names,replace){
 const b=Buffer.from(buffer),parts=[];let matches=0;
 for(let p=0;p<b.length;){const n=b.readUInt32BE(p),kind=b.toString('latin1',p+4,p+8);assert.ok(n>=8&&p+n<=b.length);let box=Buffer.from(b.subarray(p,p+n));
  if(kind===names[0]){matches++;if(names.length===1)box=replace(box);else{const skip=kind==='stsd'?8:kind==='meta'?4:['avc1','av01'].includes(kind)?78:0;const body=rewrite(box.subarray(8+skip),names.slice(1),replace);box=Buffer.concat([box.subarray(0,8+skip),body]);box.writeUInt32BE(box.length,0);}}
  parts.push(box);p+=n;
 }assert.equal(matches,1,'test mutation must address exactly one existing box');return Buffer.concat(parts);
}
const visual=['moov','trak','mdia','minf','stbl','stsd','avc1'];
const titlePath=['moov','udta','meta','ilst','\xa9nam'];
test('native movie geometry is exact, bounded and distinct from strict equivalence',()=>{
 assert.doesNotThrow(()=>assertMoviePresentationSemantics(sar,'',stream,32,24,'native-inspection'));
 const cases=[
  ['zero aspect',rewrite(sar,[...visual,'pasp'],box=>{box.writeUInt32BE(0,8);return box;})],
  ['fractional display',rewrite(sar,[...visual,'pasp'],box=>{box.writeUInt32BE(3,12);return box;})],
  ['track display mismatch',rewrite(sar,['moov','trak','tkhd'],box=>{box.writeUInt32BE(32*65536,84);return box;})],
  ['coded display mismatch',rewrite(sar,visual,box=>{box.writeUInt16BE(31,32);return box;})],
  ['rotation matrix',rewrite(sar,['moov','trak','tkhd'],box=>{box.writeInt32BE(-65536,48);return box;})],
  ['duplicate aspect',rewrite(sar,visual,box=>{const aspect=box.subarray(box.indexOf(Buffer.from('pasp'))-4);const out=Buffer.concat([box,aspect]);out.writeUInt32BE(out.length);return out;})],
 ];
 for(const [name,bytes]of cases)assert.throws(()=>assertMoviePresentationSemantics(bytes,'',stream,32,24,'native-inspection'),/native|aspect|geometry|matrix|duplicate|semantics/i,name);
 for(const report of [stream.replace('DAR 8:3','DAR 4:3'),stream.replace('SAR 2:1','SAR 1:1'),stream.replace(/ \[SAR.*$/,'')])assert.throws(()=>assertMoviePresentationSemantics(sar,'',report,32,24,'native-inspection'),/native|aspect/i);
 assert.throws(()=>assertMoviePresentationSemantics(sar,'',stream,32,24),/aspect/i);
});
test('native title is exactly one bounded UTF-8 type1 locale0 atom matching the actual decoder report',()=>{
 assert.equal(assertMoviePresentationSemantics(title,titleReport,titleStream,32,24,'native-inspection').nativeCreatorTitle,true);
 const cases=[
  ['wrong type',rewrite(title,[...titlePath,'data'],box=>{box.writeUInt32BE(2,8);return box;})],
  ['nonzero locale',rewrite(title,[...titlePath,'data'],box=>{box.writeUInt32BE(1,12);return box;})],
  ['invalid UTF8',rewrite(title,[...titlePath,'data'],box=>{box[16]=255;return box;})],
  ['control text',rewrite(title,[...titlePath,'data'],box=>{box[16]=0;return box;})],
  ['duplicate data',rewrite(title,titlePath,box=>{const out=Buffer.concat([box,box.subarray(8)]);out.writeUInt32BE(out.length);return out;})],
  ['duplicate title',rewrite(title,['moov','udta','meta','ilst'],box=>{const atom=box.subarray(8),at=atom.indexOf(Buffer.from('\xa9nam','latin1'))-4,size=atom.readUInt32BE(at);const out=Buffer.concat([box,atom.subarray(at,at+size)]);out.writeUInt32BE(out.length);return out;})],
 ];
 for(const [name,bytes]of cases)assert.throws(()=>assertMoviePresentationSemantics(bytes,titleReport,titleStream,32,24,'native-inspection'),/title|creator|metadata|UTF|locale|semantics/i,name);
 for(const report of ['',titleReport.replace('REQUIRED','CHANGED')])assert.throws(()=>assertMoviePresentationSemantics(title,report,titleStream,32,24,'native-inspection'),/title/i);
 assert.throws(()=>assertMoviePresentationSemantics(title,titleReport,titleStream,32,24),/metadata/i);
});
test('native Original keeps complete actual audio/video checks and timed frames without granting lossless authority',async()=>{
 for(const name of ['aac-original.mp4','pcm-original.mov']){
  const source=new Uint8Array(await readFile(new URL('../docs/review/temporal-audio-binding-20261022/'+name,import.meta.url)));
  const frame=await compareMediaFrames({bytes:source,recipe:original,timeMs:200});assert.equal(frame.sourceInfo.hasAudio,true);assert.ok(frame.sourceInfo.frameCount>1);assert.equal(frame.verification.completeDecode,false);assert.equal(frame.verification.losslessPixelsVerified,false);assert.deepEqual((await prepareMediaCandidate({bytes:source,recipe:original})).bytes,source);
 }
});
test('unqualified QuickTime aperture and creator metadata remain native inspection capability refusals',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'keel-native-movie-'));
 try{
  for(const [name,extra]of [['quicktime',[]],['creator',['-metadata','artist=EXPLICIT_CREATOR']]]){
   const file=path.join(dir,name+'.mov');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','0.6','-vf','setsar=2/1','-c:v','libx264rgb','-crf','0','-threads','2','-an',...extra,'-y',file]);
   const bytes=new Uint8Array(await readFile(file));assert.deepEqual((await prepareMediaCandidate({bytes,recipe:original})).bytes,bytes);
   if(name==='creator')await assert.rejects(compareMediaFrames({bytes,recipe:original,timeMs:0}),/metadata|semantics/i);
   else await assert.rejects(compareMediaFrames({bytes,recipe:original,timeMs:200}),/tapt.*aperture|aperture.*semantics/i)
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});
