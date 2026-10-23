import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {prepareMediaCandidate,compareMediaFrames,verifyActualMediaPair,ORIGINAL_MEDIA_EDIT_RECIPE} from '../packages/builder/dist/media-preparation.js';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
const hash=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
const expected={sar:{size:2918,sha:'0x66f1276bd4fdeafa2b3eb370598250b40248bb7ed356829c7bf257635512cab3',width:64,height:24},title:{size:2972,sha:'0x7c41053e177dd103e6a2a40e4b634a9cdaa48288b3ac3a028d64facffff636a7',width:32,height:24}};
for(const name of ['sar','title']){
 const source=new Uint8Array(await readFile(new URL('./fixtures/native-movie-inspection/'+name+'.mp4',import.meta.url))),identity=expected[name];assert.equal(source.length,identity.size);assert.equal(hash(source),identity.sha);
 test(`retained ${name} Original export stays byte exact without conversion`,async()=>{const result=await prepareMediaCandidate({bytes:source,mediaType:'video/mp4',recipe:ORIGINAL_MEDIA_EDIT_RECIPE});assert.deepEqual(result.bytes,source);assert.equal(result.sourceIntegrity.digest,identity.sha);assert.equal(result.verification.losslessPixelsVerified,false)});
 test(`retained ${name} native inspection returns complete displayed frame geometry and original identity`,async()=>{const result=await compareMediaFrames({bytes:source,mediaType:'video/mp4',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0});assert.equal(result.sourceIntegrity.digest,identity.sha);assert.equal(result.sourceInfo.frameCount,3);assert.equal(result.sourceInfo.hasAudio,false);assert.equal(result.sourceInfo.width,identity.width);assert.equal(result.sourceInfo.height,identity.height);const frame=await sharp(result.originalFrame).metadata();assert.equal(frame.width,identity.width);assert.equal(frame.height,identity.height);assert.deepEqual(result.originalFrame,result.processedFrame);assert.equal(result.verification.losslessPixelsVerified,false);assert.equal(result.verification.completeDecode,false);assert.deepEqual(source,new Uint8Array(await readFile(new URL('./fixtures/native-movie-inspection/'+name+'.mp4',import.meta.url))))});
 test(`retained ${name} still cannot grant strict conversion or actual pair equivalence`,async()=>{const recipe={...ORIGINAL_MEDIA_EDIT_RECIPE,mode:'lossless',format:'webp'},candidate=new Uint8Array(await readFile(new URL('./fixtures/native-movie-inspection/'+name+'.webp',import.meta.url)));for(const operation of [()=>prepareMediaCandidate({bytes:source,mediaType:'video/mp4',recipe}),()=>compareMediaFrames({bytes:source,mediaType:'video/mp4',recipe,timeMs:0}),()=>verifyActualMediaPair({sourceBytes:source,candidateBytes:candidate,recipe})])await assert.rejects(operation(),/aspect|metadata|semantics|preserv/)});
}
