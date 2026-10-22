import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE} from '../packages/builder/dist/media-preparation.js';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument} from '../packages/sdk/dist/inline-viewer-graph.js';
import {withNativeMediaBrowser,wait} from './helpers/native-media-browser.mjs';
for(const [name,width]of [['sar',64],['title',32]])test(`native ${name} PNG inspection and canonical original movie agree on actual browser geometry`,{timeout:30000},async()=>{
 const source=new Uint8Array(await readFile(new URL('../docs/review/temporal-display-metadata-20261022/reviewer-inputs/'+name+'.mp4',import.meta.url))),frame=await compareMediaFrames({bytes:source,mediaType:'video/mp4',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0});
 assert.equal(frame.sourceInfo.width,width);assert.equal(frame.sourceInfo.height,24);assert.equal(frame.verification.losslessPixelsVerified,false);
 const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'native-preview-geometry',mediaType:'video/mp4',source}});
 const result=await withNativeMediaBrowser(document,async({childEvaluate})=>{
  const png='data:image/png;base64,'+Buffer.from(frame.originalFrame).toString('base64');
  const geometry=await childEvaluate(`(async()=>{const v=document.querySelector('#keel-asset-display video');while(v.readyState<2)await new Promise(r=>setTimeout(r,20));v.pause();const image=new Image();image.src=${JSON.stringify(png)};await image.decode();v.style.width=image.style.width='320px';v.style.height=image.style.height='auto';document.body.append(image);const vr=v.getBoundingClientRect(),ir=image.getBoundingClientRect();return{video:{width:v.videoWidth,height:v.videoHeight,cssWidth:vr.width,cssHeight:vr.height},png:{width:image.naturalWidth,height:image.naturalHeight,cssWidth:ir.width,cssHeight:ir.height}}})()`);
  assert.equal(geometry.video.width,width);assert.equal(geometry.png.width,width);assert.equal(geometry.video.height,24);assert.equal(geometry.png.height,24);assert.equal(geometry.video.cssWidth,320);assert.equal(geometry.png.cssWidth,320);assert.equal(geometry.video.cssHeight,320*24/width);assert.equal(geometry.png.cssHeight,320*24/width);return{...geometry,scope:'local native inspector plus current canonical original player, no conversion or chain proof'};
 },{mountSelector:'#keel-asset-display video'});
 if(process.env.KEEL_TEMPORAL_EVIDENCE_DIR){await mkdir(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,{recursive:true});await writeFile(path.join(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,'native-inspector-'+name+'.json'),JSON.stringify(result,null,2)+'\n')}
});
