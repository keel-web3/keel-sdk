import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE} from './packages/builder/dist/media-preparation.js';
const root=new URL('../evidence/browser-results/',import.meta.url),finite=new Uint8Array(await readFile(new URL('reviewer-native-finite.gif',root))),short=new Uint8Array(await readFile(new URL('reviewer-native-clamped.gif',root)));
const digest=b=>'0x'+createHash('sha256').update(b).digest('hex');
test('native compare binds frame and declared timeline to the same initial actual source bytes',async t=>{
 const bytes=finite.slice(),input={bytes,mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:15};
 const pending=compareMediaFrames(input);bytes.set(short);const result=await pending;
 t.diagnostic(JSON.stringify({committed:result.sourceIntegrity.digest,initial:digest(finite),mutated:digest(short),sourceFrameTimeMs:result.sourceFrameTimeMs,declared:result.sourceInfo.frameDurationsMs}));
 assert.equal(result.sourceIntegrity.digest,digest(finite));
 assert.deepEqual(result.sourceInfo.frameDurationsMs,[120,240,200],'inspection must not relabel another actual source timeline with the initial digest');
 assert.equal(result.sourceFrameTimeMs,0);
});
