import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {prepareMediaCandidate} from '../packages/builder/dist/media-preparation.js';
import {resolveBundledFfmpeg} from '../packages/builder/dist/media-optimization.js';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument,buildKeelInlineLocalDocument,buildKeelInlineAssetDisplayModuleFragment,buildKeelInlineTokenURIGraph,buildKeelPreparedOneOfOneTokenURI} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof} from '../packages/sdk/dist/registered-native-gzip.js';
import {currentNativeMediaRecipe,sha} from './helpers/native-media-fixtures.mjs';
import {withNativeMediaBrowser,wait} from './helpers/native-media-browser.mjs';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
const exec=promisify(execFile), recipe={schema:'keel-media-edit@1',mode:'lossless',format:'webp',quality:82,noSound:false};
const sourceRGBA=Buffer.alloc(32*24*4*3),colors=[[255,0,0,255],[0,0,255,255],[0,255,0,255]],delays=[120,240,200];
for(let frame=0;frame<3;frame++)for(let pixel=0;pixel<32*24;pixel++)sourceRGBA.set(colors[frame],(frame*32*24+pixel)*4);
const gif=new Uint8Array(await sharp(sourceRGBA,{raw:{width:32,height:72,channels:4,pageHeight:24}}).gif({delay:delays,loop:0}).toBuffer());
const silentMovie=await prepareMediaCandidate({bytes:gif,mediaType:'image/gif',recipe:{...recipe,format:'mp4'}});
assert.deepEqual(silentMovie.sourceInfo.frameDurationsMs,delays);assert.deepEqual(silentMovie.candidateInfo.frameDurationsMs,delays);
const expectedFrameDigests=colors.map((_,index)=>sha(sourceRGBA.subarray(index*32*24*4,(index+1)*32*24*4)));
async function retain(name,report){if(process.env.KEEL_TEMPORAL_EVIDENCE_DIR){await mkdir(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,{recursive:true});await writeFile(path.join(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,name+'.json'),JSON.stringify(report,null,2)+'\n')}}
for(const format of ['webp','avif'])test(`real variable-rate MP4 to ${format}: complete RGBA/timeline verification and current canonical playback`,{timeout:45000},async()=>{
  const original=silentMovie.bytes.slice(),candidate=await prepareMediaCandidate({bytes:silentMovie.bytes,mediaType:'video/mp4',recipe:{...recipe,format}});
  assert.equal(candidate.verification.losslessPixelsVerified,true);assert.equal(candidate.verification.framesAndTimingPreserved,true);
  assert.equal(candidate.sourceInfo.hasAudio,false);assert.equal(candidate.candidateInfo.hasAudio,false);
  assert.deepEqual(candidate.candidateInfo.frameTimesMs,[0,120,360]);assert.deepEqual(candidate.candidateInfo.frameDurationsMs,delays);
  const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'exact-temporal',mediaType:candidate.mediaType,source:candidate.bytes}});
  const report=await withNativeMediaBrowser(document,async({childEvaluate,capture})=>{
    assert.equal(await childEvaluate('document.querySelector("#keel-asset-display").firstElementChild.tagName'),'IMG');
    const frames=await childEvaluate(`(async()=>{const d=new ImageDecoder({data:__KEEL_CONTENT__.bytes('exact-temporal'),type:${JSON.stringify(candidate.mediaType)},preferAnimation:true,colorSpaceConversion:'none'});await d.tracks.ready;const frames=[];for(let i=0;i<d.tracks.selectedTrack.frameCount;i++){const {image}=await d.decode({frameIndex:i,completeFramesOnly:true});try{const pixels=new Uint8Array(image.allocationSize({format:'RGBA'}));await image.copyTo(pixels,{format:'RGBA'});frames.push({timestamp:image.timestamp,duration:image.duration,sha:'0x'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),n=>n.toString(16).padStart(2,'0')).join('')})}finally{image.close()}}d.close();return frames})()`);
    assert.equal(frames.length,3);assert.deepEqual(frames.map(f=>f.sha),expectedFrameDigests,'every browser decoded RGBA byte must match the complete source, not selected pixels');
    assert.deepEqual(frames.map(f=>f.timestamp),[0,120000,360000]);assert.deepEqual(frames.map(f=>f.duration),[120000,240000,200000]);
    const samples=[],start=Date.now();while(Date.now()-start<1900){samples.push({elapsedMs:Date.now()-start,...await capture('#keel-asset-display img')});await wait(18)}
    const states=samples.map(s=>s.centerRGBA.join(',')),transitions=states.filter((v,i)=>!i||v!==states[i-1]);
    assert.deepEqual([...new Set(states)].sort(),colors.map(c=>c.join(',')).sort());
    assert.ok(transitions.join(';').includes(colors.map(c=>c.join(',')).join(';')+';'+colors[0].join(',')),'actual passive renderer must display the whole sequence and loop');
    return{frames,samples};
  });
  assert.deepEqual(silentMovie.bytes,original);
  await retain(format,{schema:'keel-temporal-carrier-browser@1',scope:'Actual local current canonical shell and installed Chromium; no registration/live/deployment claim',
    source:{mediaType:'video/mp4',byteLength:original.length,digest:sha(original)},candidate:{mediaType:candidate.mediaType,byteLength:candidate.bytes.length,digest:sha(candidate.bytes)},timeline:candidate.sourceInfo,...report});
});
test('current native-Gzip graph includes actual shell/player, preview and metadata in both measured alternatives',{timeout:30000},async()=>{
  const binding=await currentNativeMediaRecipe(),display=await buildKeelInlineAssetDisplayModuleFragment(),preview=new Uint8Array(await sharp(sourceRGBA.subarray(0,32*24*4),{raw:{width:32,height:24,channels:4}}).png().toBuffer());
  const imageURI='data:image/png;base64,'+Buffer.from(preview).toString('base64'),measurements=[];
  for(const format of ['original','webp','avif']){
    const selected=format==='original'?{bytes:silentMovie.bytes,mediaType:'video/mp4'}:await prepareMediaCandidate({bytes:silentMovie.bytes,mediaType:'video/mp4',recipe:{...recipe,format}});
    const document=await buildKeelInlineLocalDocument({shell:binding.shell,modules:[display],entry:{id:'exact-temporal',mediaType:selected.mediaType,source:selected.bytes,compression:'gzip'}}),proof=createKeelRegisteredNativeGzipProof({binding:binding.registeredNativeGzipBinding,documentBytes:document.rootBytes});
    const graph=await buildKeelInlineTokenURIGraph(document,{registeredNativeGzip:proof});
    const prepared=await buildKeelPreparedOneOfOneTokenURI({graph,registeredNativeGzip:proof,chainId:11155111,collection:'0x'+'12'.repeat(20),collectionName:'Variable temporal art',description:'Same exact source timeline; generated test fixture',imageURI,manifestURI:'',manifestDigest:'0x'+'34'.repeat(32)});
    assert.ok(prepared.tokenURI.startsWith('data:application/json;charset=utf-8,'));
    const metadata=JSON.parse(decodeURIComponent(prepared.tokenURI.slice(prepared.tokenURI.indexOf(',')+1)));
    assert.equal(metadata.image,imageURI);assert.ok(metadata.animation_url.startsWith('data:text/html;charset=utf-8,'));
    measurements.push({format,sourceBytes:selected.bytes.length,completeHTMLBytes:graph.htmlBytes.length,completeTokenURIBytes:Buffer.byteLength(prepared.tokenURI),completeTokenURIDigest:sha(Buffer.from(prepared.tokenURI)),storedGraphBytes:document.byteLength,shellAndModuleBytes:document.parts.filter(p=>p.kind==='existing').reduce((n,p)=>n+p.bytes.length,0)});
  }
  assert.ok(measurements[1].completeTokenURIBytes<measurements[0].completeTokenURIBytes);
  await retain('complete-cost',{schema:'keel-temporal-complete-graph-measurement@1',scope:'Actual SDK compiler plus retained current registered frame/profile recipe under explicit synthetic metadata context; no selected-chain/live or normal Studio recommendation integration claim',measurements});
});
test('audio movie image carriers fail closed; native MP4 retains every decoded PCM sample',{timeout:30000},async()=>{
  const runtime=await resolveBundledFfmpeg();assert.equal(runtime.available,true);assert.ok(runtime.binary);
  const dir=await mkdtemp(path.join(tmpdir(),'keel-temporal-audio-'));
  try{
    await exec(runtime.binary,['-hide_banner','-nostdin','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264rgb','-crf','0','-c:a','aac','-threads','2','-n','source.mp4'],{cwd:dir,timeout:15000});
    const bytes=new Uint8Array(await readFile(path.join(dir,'source.mp4'))),before=bytes.slice();
    for(const format of ['webp','avif'])await assert.rejects(prepareMediaCandidate({bytes,mediaType:'video/mp4',recipe:{...recipe,format}}),/cannot retain audio/);
    const selected=await prepareMediaCandidate({bytes,mediaType:'video/mp4',recipe:{...recipe,format:'mp4'}});assert.equal(selected.sourceInfo.hasAudio,true);assert.equal(selected.candidateInfo.hasAudio,true);assert.equal(selected.verification.losslessPixelsVerified,true);
    await writeFile(path.join(dir,'candidate.mp4'),selected.bytes,{flag:'wx'});
    const pcm=async input=>(await exec(runtime.binary,['-hide_banner','-nostdin','-loglevel','error','-protocol_whitelist','file,pipe','-i',input,'-map','0:a:0','-vn','-c:a','pcm_s16le','-f','s16le','pipe:1'],{cwd:dir,encoding:'buffer',maxBuffer:4*1024*1024,timeout:15000})).stdout;
    const originalPCM=await pcm('source.mp4'),candidatePCM=await pcm('candidate.mp4');assert.ok(originalPCM.length>0);assert.deepEqual(candidatePCM,originalPCM);
    assert.deepEqual(bytes,before);await retain('audio',{schema:'keel-temporal-audio-preservation@1',source:{byteLength:bytes.length,digest:sha(bytes)},candidate:{byteLength:selected.bytes.length,digest:sha(selected.bytes)},audio:{decodedPCMBytes:originalPCM.length,digest:sha(originalPCM),allSamplesEqual:true},timeline:selected.sourceInfo,scope:'Pinned actual full source/movie decoders; image carriers rejected before audio removal. No live or hardware audio output claim'});
  }finally{await rm(dir,{recursive:true,force:true})}
});
