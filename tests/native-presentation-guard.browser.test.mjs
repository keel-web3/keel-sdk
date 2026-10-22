import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareMediaCandidate} from '../packages/builder/dist/media-preparation.js';
import {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument} from '../packages/sdk/dist/inline-viewer-graph.js';
import {withNativeMediaBrowser,wait} from './helpers/native-media-browser.mjs';
const original={schema:'keel-media-edit@1',mode:'original',format:'original',quality:82,noSound:false};
for(const [name,width] of [['sar',64],['title',32]])test(`current canonical player keeps native ${name} bytes and actual browser display geometry`,{timeout:30000},async()=>{
 const source=new Uint8Array(await readFile(new URL('../docs/review/temporal-display-metadata-20261022/reviewer-inputs/'+name+'.mp4',import.meta.url))),native=await prepareMediaCandidate({bytes:source,mediaType:'video/mp4',recipe:original});
 assert.deepEqual(native.bytes,source);
 const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),document=await buildKeelInlineNormalMediaDocument({shell,asset:{id:'native-semantic-source',mediaType:'video/mp4',source:native.bytes}});
 const result=await withNativeMediaBrowser(document,async({childEvaluate})=>{
  let geometry;for(let i=0;i<100;i++){geometry=await childEvaluate(`(()=>{const v=document.querySelector('#keel-asset-display video');return v?{tag:v.tagName,readyState:v.readyState,width:v.videoWidth,height:v.videoHeight,fit:getComputedStyle(v).objectFit}:null})()`);if(geometry?.readyState>=2)break;await wait(25);}
  assert.equal(geometry.tag,'VIDEO');assert.equal(geometry.width,width);assert.equal(geometry.height,24);assert.equal(geometry.fit,'contain');
  const digest=await childEvaluate(`(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',__KEEL_CONTENT__.bytes('native-semantic-source'))),n=>n.toString(16).padStart(2,'0')).join(''))()`);
  assert.equal(digest,createHash('sha256').update(source).digest('hex'));return{...geometry,sourceSHA256:digest,sourceBytes:source.length,scope:'local current canonical player; no chain, remote upload, signing or publication'};
 });
 if(process.env.KEEL_TEMPORAL_EVIDENCE_DIR){await mkdir(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,{recursive:true});await writeFile(path.join(process.env.KEEL_TEMPORAL_EVIDENCE_DIR,'native-'+name+'.json'),JSON.stringify(result,null,2)+'\n');}
});
