import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { prepareMediaCandidate, compareMediaFrames, getMediaPreparationCapabilities, parseMediaEditRecipe } from '../packages/builder/dist/media-preparation.js';
const require=createRequire(new URL('../packages/builder/dist/media-preparation.js',import.meta.url));
const sharp=require('sharp');
const original={schema:'keel-media-edit@1',mode:'original',format:'original',quality:82,noSound:false};
const lossless={...original,mode:'lossless',format:'webp'};
async function image(){return new Uint8Array(await sharp({create:{width:16,height:12,channels:4,background:{r:120,g:80,b:33,alpha:1}}}).png().toBuffer());}
test('original mode preserves arbitrary container bytes without decode or format eligibility claims',async()=>{
 const bytes=new Uint8Array([0,1,2,255]);const r=await prepareMediaCandidate({bytes,mediaType:'video/quicktime',recipe:original});
 assert.deepEqual(r.bytes,bytes);assert.notEqual(r.bytes,bytes);assert.equal(r.outputIntegrity.digest,r.sourceIntegrity.digest);assert.equal(r.verification.completeDecode,false);
 assert.throws(()=>parseMediaEditRecipe({...original,noSound:true}),/Original/);
 assert.throws(()=>parseMediaEditRecipe({...lossless,unknown:true}),/unsupported/);
});
test('still lossless WebP fully decodes and verifies pixel identity with measured bytes',async()=>{
 const bytes=await image(),snapshot=bytes.slice();const r=await prepareMediaCandidate({bytes,recipe:lossless});assert.deepEqual(bytes,snapshot);assert.equal(r.verification.losslessPixelsVerified,true);assert.equal(r.sourceInfo.width,16);assert.equal(r.candidateInfo.height,12);assert.equal(r.measurements.afterBytes,r.bytes.length);
});
test('explicit still edits create a reversible recipe, preserve source and distinguish encoding lossless from source pixels',async()=>{
 const bytes=await image();const r=await prepareMediaCandidate({bytes,recipe:{...lossless,crop:{left:2,top:1,width:8,height:6},width:4,height:3}});assert.equal(r.candidateInfo.width,4);assert.equal(r.candidateInfo.height,3);assert.equal(r.verification.losslessPixelsVerified,false);
 await assert.rejects(prepareMediaCandidate({bytes,recipe:{...lossless,crop:{left:12,top:0,width:8,height:6}}}),/beyond/);
});
test('compare returns decoded PNG frames at the same timestamp with original and processed geometry',async()=>{
 const bytes=await image();const r=await compareMediaFrames({bytes,recipe:{...lossless,width:8,height:6},timeMs:0});assert.equal(r.sourceFrameTimeMs,0);assert.equal(r.candidateFrameTimeMs,0);assert.equal(r.sourceInfo.width,16);assert.equal(r.candidateInfo.width,8);assert.equal((await sharp(r.originalFrame).metadata()).format,'png');
});
test('animated GIF retains all frames and their delays, comparison selects same source instant',async()=>{
 const rgba=Buffer.alloc(4*4*4*2);for(let p=0;p<32;p++){rgba[p*4+(p<16?0:1)]=255;rgba[p*4+3]=255;}
 const bytes=new Uint8Array(await sharp(rgba,{raw:{width:4,height:8,channels:4,pageHeight:4}}).gif({delay:[120,240],loop:0}).toBuffer());
 const r=await prepareMediaCandidate({bytes,recipe:lossless});assert.equal(r.sourceInfo.frameCount,2);assert.deepEqual(r.candidateInfo.frameDurationsMs,[120,240]);assert.equal(r.verification.losslessPixelsVerified,true);
 const c=await compareMediaFrames({bytes,recipe:lossless,timeMs:150});assert.equal(c.sourceFrameTimeMs,120);assert.equal(c.candidateFrameTimeMs,120);assert.deepEqual(await sharp(c.originalFrame).ensureAlpha().raw().toBuffer(),await sharp(c.processedFrame).ensureAlpha().raw().toBuffer());
 const avif=await prepareMediaCandidate({bytes,recipe:{...lossless,format:'avif'}});assert.deepEqual(avif.candidateInfo.frameDurationsMs,[120,240]);
 const mp4=await prepareMediaCandidate({bytes,recipe:{...lossless,format:'mp4'}});assert.deepEqual(mp4.candidateInfo.frameDurationsMs,[120,240]);
 await assert.rejects(compareMediaFrames({bytes,recipe:lossless,timeMs:400}),/outside/);
});
test('actual capability report and cancellation do not claim universal decode support',async()=>{
 const cap=await getMediaPreparationCapabilities();assert.equal(cap.original.available,true);assert.equal(cap.browserDecode,'requires-runtime-check');
 const abort=new AbortController();abort.abort();await assert.rejects(prepareMediaCandidate({bytes:await image(),recipe:lossless,signal:abort.signal}),/abort/i);
 await assert.rejects(prepareMediaCandidate({bytes:new TextEncoder().encode('#EXTM3U\nfile:///etc/passwd'),recipe:{...lossless,format:'mp4'}}),/self-contained/);
});
test('MOV input is decoded by capability and exports MP4/MOV without changing source',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');const {execFileSync}=await import('node:child_process');
 const dir=await mkdtemp(path.join(tmpdir(),'keel-movie-test-')), ffmpeg=require('ffmpeg-static');
 try {
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','1','-c:v','libx264rgb','-crf','0','-threads','2','-y',path.join(dir,'source.mov')]);
  const bytes=new Uint8Array(await readFile(path.join(dir,'source.mov')));
  for(const format of ['mov','mp4','webp','avif']) {
   const r=await prepareMediaCandidate({bytes,mediaType:'video/quicktime',recipe:{...lossless,format,noSound:true}});
   assert.equal(r.sourceInfo.frameCount,5);assert.equal(r.candidateInfo.frameCount,5);assert.equal(r.verification.losslessPixelsVerified,true);assert.equal(r.sourceInfo.width,r.candidateInfo.width);
   if(format === 'webp') {const exported=await prepareMediaCandidate({bytes:r.bytes,mediaType:'image/webp',recipe:{...lossless,format:'mp4'}});assert.equal(exported.candidateInfo.frameCount,5);assert.equal(exported.verification.losslessPixelsVerified,true);}
  }
  const c=await compareMediaFrames({bytes,mediaType:'video/quicktime',recipe:{...lossless,format:'mp4'},timeMs:250});assert.equal(c.sourceFrameTimeMs,200);assert.equal(c.candidateFrameTimeMs,200);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('still layers compose ordered source copies with explicit alpha, rotation and output bounds',async()=>{
 const raw=Buffer.alloc(8*6*4);for(let y=0;y<6;y++)for(let x=0;x<8;x++){const p=(y*8+x)*4;raw[p]=x*30;raw[p+1]=y*40;raw[p+3]=255;}
 const bytes=new Uint8Array(await sharp(raw,{raw:{width:8,height:6,channels:4}}).png().toBuffer());
 const snapshot=bytes.slice(), layer={left:2,top:1,width:3,height:2,opacity:0.5,rotate:90};
 const result=await prepareMediaCandidate({bytes,recipe:{...lossless,layers:[layer]}});
 const overlay=await sharp(bytes).resize(3,2,{fit:'fill'}).rotate(90).ensureAlpha().raw().toBuffer();for(let p=3;p<overlay.length;p+=4)overlay[p]=Math.round(overlay[p]*0.5);
 const expected=await sharp(bytes).composite([{input:await sharp(overlay,{raw:{width:2,height:3,channels:4}}).png().toBuffer(),left:2,top:1}]).ensureAlpha().raw().toBuffer();
 assert.deepEqual(await sharp(result.bytes).ensureAlpha().raw().toBuffer(),expected);assert.deepEqual(bytes,snapshot);assert.equal(result.verification.losslessPixelsVerified,false);
 await assert.rejects(prepareMediaCandidate({bytes,recipe:{...lossless,layers:[{...layer,left:7}]}}),/beyond.*canvas/);
 assert.throws(()=>parseMediaEditRecipe({...lossless,rotate:'90'}),/Rotation/);
 assert.throws(()=>parseMediaEditRecipe({...original,layers:[layer]}),/Original/);
 const hidden=await prepareMediaCandidate({bytes,recipe:{...lossless,layers:[{...layer,opacity:0}]}});assert.deepEqual(await sharp(hidden.bytes).ensureAlpha().raw().toBuffer(),raw);
});
test('animated layers fail closed rather than silently ignoring composition',async()=>{
 const rgba=Buffer.alloc(4*8*4,255); for(let p=0;p<16;p++)rgba[p*4]=0; const bytes=await sharp(rgba,{raw:{width:4,height:8,channels:4,pageHeight:4}}).gif({delay:[100,200]}).toBuffer();
 await assert.rejects(prepareMediaCandidate({bytes:new Uint8Array(bytes),recipe:{...lossless,layers:[{left:0,top:0,width:2,height:2,opacity:1,rotate:0}]}}),/animated.*geometry/);
});
