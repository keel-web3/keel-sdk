import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE} from '../packages/builder/dist/media-preparation.js';
const finite=new Uint8Array(await readFile(new URL('../../evidence/browser-results/reviewer-native-finite.gif',import.meta.url))),short=new Uint8Array(await readFile(new URL('../../evidence/browser-results/reviewer-native-clamped.gif',import.meta.url)));
const digest=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');

test('comparison captures time, MIME, recipe and source before any async continuation',async()=>{
 const recipe=structuredClone(ORIGINAL_MEDIA_EDIT_RECIPE),input={bytes:finite.slice(),mediaType:'image/gif',recipe,timeMs:15};const operation=compareMediaFrames(input);input.timeMs=150;input.mediaType='video/mp4';recipe.mode='lossless';recipe.format='webp';input.bytes.set(short);
 const result=await operation;assert.equal(result.timeMs,15);assert.equal(result.sourceFrameTimeMs,0);assert.deepEqual(result.sourceInfo.frameDurationsMs,[120,240,200]);assert.equal(result.sourceIntegrity.digest,digest(finite));assert.equal(result.recipe.mode,'original');assert.equal(result.recipe.format,'original');assert.equal(result.verification.losslessPixelsVerified,false);
});

test('replacing the request signal cannot cancel another captured source or hide its real abort',async()=>{
 const source=new AbortController(),other=new AbortController(),input={bytes:finite.slice(),mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:15,signal:source.signal};const operation=compareMediaFrames(input);other.abort();input.signal=other.signal;assert.equal((await operation).sourceIntegrity.digest,digest(finite));
 const active=new AbortController(),next=new AbortController(),second={...input,signal:active.signal};const cancelled=compareMediaFrames(second);second.signal=next.signal;active.abort();await assert.rejects(cancelled,{name:'AbortError'});
});

test('strict edited comparison uses the same entry source snapshot rather than processed candidate bytes',async()=>{
 const bytes=finite.slice(),at=Buffer.from(bytes).indexOf(Buffer.from('NETSCAPE2.0'));assert.ok(at>=0);bytes[at+13]=0;bytes[at+14]=0;
 const initial=bytes.slice(),input={bytes,mediaType:'image/gif',recipe:{...ORIGINAL_MEDIA_EDIT_RECIPE,mode:'lossless',format:'webp'},timeMs:15};const operation=compareMediaFrames(input);bytes.set(short);input.timeMs=150;
 const result=await operation;assert.equal(result.sourceIntegrity.digest,digest(initial));assert.deepEqual(result.sourceInfo.frameDurationsMs,[120,240,200]);assert.deepEqual(result.candidateInfo.frameDurationsMs,[120,240,200]);assert.equal(result.timeMs,15);assert.equal(result.sourceFrameTimeMs,0);assert.equal(result.candidateFrameTimeMs,0);assert.equal(result.recipe.mode,'lossless');assert.equal(result.verification.losslessPixelsVerified,true);
});

test('comparison rejects an oversized entry before copying its supplied byte view',async()=>{
 const source=new Uint8Array(256*1024*1024+1);await assert.rejects(compareMediaFrames({bytes:source,recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0}),/Media must contain/);
});
