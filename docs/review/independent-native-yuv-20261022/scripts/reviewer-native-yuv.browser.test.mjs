import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE as original} from './packages/builder/dist/media-preparation.js';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument} from './packages/sdk/dist/inline-viewer-graph.js';
import {withNativeMediaBrowser} from './tests/helpers/native-media-browser.mjs';

test('exact ordinary YUV source mounts in the current verified canonical shell and matches native preview geometry', {timeout:30000},async()=>{
 const source=new Uint8Array(await readFile(new URL('./tests/fixtures/native-yuv-preview/media-preview.mp4',import.meta.url)));
 const hash=createHash('sha256').update(source).digest('hex');
 assert.equal(hash,'41bc415d0a2a142ee23db0de0089fb7d1675cc6718516a15da3f306bffb13193');
 const frame=await compareMediaFrames({bytes:source,mediaType:'video/mp4',recipe:original,timeMs:150});
 const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()});
 const document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'independent-original-yuv',mediaType:'video/mp4',source}});
 const result=await withNativeMediaBrowser(document,async({childEvaluate})=>{
  const geometry=await childEvaluate(`(async()=>{const v=document.querySelector('#keel-asset-display video');while(v.readyState<2)await new Promise(r=>setTimeout(r,20));v.pause();const image=new Image();image.src=${JSON.stringify('data:image/png;base64,'+Buffer.from(frame.originalFrame).toString('base64'))};await image.decode();const bytes=__KEEL_CONTENT__.bytes('independent-original-yuv');return {video:{width:v.videoWidth,height:v.videoHeight,duration:v.duration},png:{width:image.naturalWidth,height:image.naturalHeight},sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join(''),bytes:bytes.length}})()`);
  assert.deepEqual(geometry.video,{width:16,height:16,duration:0.4});
  assert.deepEqual(geometry.png,{width:16,height:16});
  assert.equal(geometry.sha256,hash);assert.equal(geometry.bytes,1828);
  return geometry;
 },{mountSelector:'#keel-asset-display video'});
 assert.equal(frame.verification.losslessPixelsVerified,false);
 await writeFile(new URL('../evidence/actual-canonical-yuv-result.json',import.meta.url),JSON.stringify({...result,verification:frame.verification,scope:'Actual installed browser + current canonical local shell and exact source; no hosted or chain/signing proof'},null,2)+'\n');
});
