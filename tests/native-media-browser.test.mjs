import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument} from '../packages/sdk/dist/inline-viewer-graph.js';
import {audioCases,nativeFixture,nativeManifest,sha,currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
import {withNativeMediaBrowser,wait} from './helpers/native-media-browser.mjs';
const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});
async function retain(name,report){if(process.env.KEEL_NATIVE_MEDIA_EVIDENCE_DIR){await mkdir(process.env.KEEL_NATIVE_MEDIA_EVIDENCE_DIR,{recursive:true});await writeFile(`${process.env.KEEL_NATIVE_MEDIA_EVIDENCE_DIR}/${name}.json`,JSON.stringify({...report,scope:'Actual local canonical shell and sandboxed native browser rendering; no selected-chain registration, deployment, hardware audio-output or publication claim'},null,2)+'\n')}}
for(const name of ['still','smil','css'])test(`actual canonical ${name} SVG renders original XML and preserves native motion`,{timeout:30000},async()=>{
  const source=await nativeFixture(`${name}.svg`),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'original',mediaType:'image/svg+xml',source}});
  const report=await withNativeMediaBrowser(document,async({childEvaluate,capture})=>{
    assert.equal(await childEvaluate('document.querySelector("#keel-asset-display").firstElementChild.tagName'),'IMG');
    assert.equal(await childEvaluate('document.querySelector("#keel-asset-display img").src'),`data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`);
    const samples=[],start=Date.now();do{samples.push({elapsedMs:Date.now()-start,...await capture('#keel-asset-display img')});await wait(40)}while(Date.now()-start<(name==='still'?200:2300));
    const colors=[...new Set(samples.map(sample=>sample.centerRGBA.join(',')))];assert.ok(colors.includes('255,0,0,255'));
    if(name==='still')assert.deepEqual(colors,['255,0,0,255']);else{assert.deepEqual(colors.sort(),['0,0,255,255','255,0,0,255']);const transitions=samples.map(s=>s.centerRGBA.join(',')).filter((v,i,a)=>!i||v!==a[i-1]);assert.ok(transitions.length>=4,'Original native SVG animation must keep looping')}
    return{input:nativeManifest.files.find(f=>f.path===`${name}.svg`),documentBytes:document.byteLength,samples};
  });await retain(name,report);assert.equal(sha(await nativeFixture(`${name}.svg`)),sha(source));
});
for(const audio of audioCases)test(`actual canonical ${audio.mediaType} decodes exact original, displays cover and starts only with native play gesture`,{timeout:30000},async()=>{
  const source=await nativeFixture(audio.name),cover=new Uint8Array(await readFile(new URL('./fixtures/media-viewers/still.png',import.meta.url))),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'original-audio',...audio,source},preview:{id:'cover',mediaType:'image/png',source:cover}});
  const report=await withNativeMediaBrowser(document,async({childEvaluate,capture,clickNativeAudioPlay})=>{
    const deadline=Date.now()+3000;while(Date.now()<deadline&&!await childEvaluate('Number.isFinite(document.querySelector("audio").duration)&&document.querySelector("audio").duration>0'))await wait(20);
    const initial=await childEvaluate('(()=>{const a=document.querySelector("audio");return{paused:a.paused,autoplay:a.autoplay,controls:a.controls,currentTime:a.currentTime,duration:a.duration,src:a.src,cover:document.querySelector("#keel-asset-display img").src}})()');
    assert.equal(initial.paused,true);assert.equal(initial.autoplay,false);assert.equal(initial.controls,true);assert.equal(initial.currentTime,0);assert.ok(initial.duration>=.9&&initial.duration<1.4);assert.equal(initial.src,`data:${audio.mediaType};base64,${Buffer.from(source).toString('base64')}`);assert.equal(initial.cover,`data:image/png;base64,${Buffer.from(cover).toString('base64')}`);
    const coverPixels=await capture('#keel-asset-display img');assert.deepEqual(coverPixels.centerRGBA,[255,0,0,255]);
    // Decode the very same committed bytes in the actual browser, not an ffmpeg surrogate.
    const decoded=await childEvaluate('(async()=>{const c=new AudioContext(),b=await c.decodeAudioData(__KEEL_CONTENT__.bytes("original-audio").buffer);const data=b.getChannelData(0);let square=0,crossings=0;for(let i=0;i<data.length;i++){square+=data[i]*data[i];if(i&&data[i-1]<0&&data[i]>=0)crossings++}const result={duration:b.duration,sampleRate:b.sampleRate,channels:b.numberOfChannels,rms:Math.sqrt(square/data.length),frequency:crossings/b.duration};await c.close();return result})()');
    assert.equal(decoded.channels,1);assert.ok(decoded.duration>=.9&&decoded.duration<1.4);assert.ok(decoded.rms>.15&&decoded.rms<.35);assert.ok(decoded.frequency>350&&decoded.frequency<470);
    await clickNativeAudioPlay();const start=Date.now();let playback;do{playback=await childEvaluate('(()=>{const a=document.querySelector("audio");return{paused:a.paused,currentTime:a.currentTime,error:a.error?.code??null}})()');if(playback.currentTime>.1)break;await wait(20)}while(Date.now()-start<1500);
    assert.equal(playback.error,null);assert.equal(playback.paused,false);assert.ok(playback.currentTime>.1,'The native controls gesture must advance actual audio playback');await childEvaluate('document.querySelector("audio").pause()');
    return{input:nativeManifest.files.find(f=>f.path===audio.name),documentBytes:document.byteLength,initial:{...initial,srcSHA256:sha(source),coverSHA256:sha(cover),src:undefined,cover:undefined},coverPixels,decoded,playback};
  });await retain(audio.name,report);assert.equal(sha(await nativeFixture(audio.name)),sha(source));
});

test('actual retained current reader frames decode and play exact native-Gzip audio with the new module',{timeout:30000},async()=>{
  const recipe=await currentNativeMediaRecipe(),source=await nativeFixture('tone.wav'),document=await buildKeelInlineNormalMediaDocument({...recipe,asset:{id:'original-audio',mediaType:'audio/wav',source}});
  assert.equal(document.registeredNativeGzip.members.filter(row=>row.id==='original-audio').length,1);
  const report=await withNativeMediaBrowser(document,async({childEvaluate,clickNativeAudioPlay})=>{
    assert.equal(await childEvaluate('__KEEL_CONTENT__.resources().find(row=>row.id==="original-audio").digest'),sha(source));
    assert.equal(await childEvaluate('document.querySelector("audio").paused'),true);await clickNativeAudioPlay();
    const start=Date.now();let time=0;do{time=await childEvaluate('document.querySelector("audio").currentTime');if(time>.1)break;await wait(20)}while(Date.now()-start<1500);
    assert.ok(time>.1);await childEvaluate('document.querySelector("audio").pause()');return{originalSHA256:sha(source),documentBytes:document.byteLength,currentTime:time};
  });await retain('current-native-gzip-wav',report);
});
