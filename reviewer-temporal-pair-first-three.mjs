import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const api=await import(process.env.REVIEW_BUILDER_MODULE ? pathToFileURL(process.env.REVIEW_BUILDER_MODULE).href : './packages/builder/dist/media-preparation.js');
const require=createRequire(new URL('./packages/builder/package.json',import.meta.url));
const sharp=require('sharp'),ffmpeg=require('ffmpeg-static');
const recipe={schema:'keel-media-edit@1',mode:'lossless',format:'webp',quality:82,noSound:false};
const sha=b=>createHash('sha256').update(b).digest('hex');
async function withDir(f){const d=await mkdtemp(path.join(tmpdir(),'keel-review-actual-pair-'));try{return await f(d)}finally{await rm(d,{recursive:true,force:true})}}
async function video(d,extra=[]){const name=path.join(d,'source.mp4');execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-t','0.6','-c:v','libx264rgb','-crf','0','-threads','2',...extra,'-an','-y',name]);return new Uint8Array(await readFile(name))}
const diag=(t,extra)=>t.diagnostic(JSON.stringify(extra));
test('independent exact APNG regression: all three frames cannot be certified as one',async t=>withDir(async d=>{execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=32x24:rate=5','-frames:v','3','-plays','0','-threads','2','-y',path.join(d,'source.apng')]);const source=new Uint8Array(await readFile(path.join(d,'source.apng'))),candidate=new Uint8Array(await sharp(source).webp({lossless:true}).toBuffer());diag(t,{source:{bytes:source.length,sha256:sha(source)},candidate:{bytes:candidate.length,sha256:sha(candidate)}});await assert.rejects(api.verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate,recipe}),/APNG|complete.*sequence|container.*motion/)}));
test('independent lossless verification must reject changed sample aspect ratio',async t=>withDir(async d=>{const source=await video(d,['-vf','setsar=2/1']);const candidate=await api.prepareMediaCandidate({bytes:source,mediaType:'video/mp4',recipe});diag(t,{source:{bytes:source.length,sha256:sha(source)},candidate:{bytes:candidate.bytes.length,sha256:sha(candidate.bytes)},sourceSAR:'2:1',candidateSAR:'1:1'});await assert.rejects(api.verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate.bytes,recipe}),/aspect|metadata|semantics|preserv|RGBA/i)}));
test('independent movie creator title cannot disappear behind exact RGBA',async t=>withDir(async d=>{const source=await video(d,['-metadata','title=PRIVATE_CREATOR_TITLE_REQUIRED']);const candidate=await api.prepareMediaCandidate({bytes:source,mediaType:'video/mp4',recipe});assert.ok(Buffer.from(source).includes(Buffer.from('PRIVATE_CREATOR_TITLE_REQUIRED')));assert.equal(Buffer.from(candidate.bytes).includes(Buffer.from('PRIVATE_CREATOR_TITLE_REQUIRED')),false);diag(t,{source:{bytes:source.length,sha256:sha(source)},candidate:{bytes:candidate.bytes.length,sha256:sha(candidate.bytes)}});await assert.rejects(api.verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate.bytes,recipe}),/metadata|semantics|preserv/i)}));
