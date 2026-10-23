import assert from 'node:assert/strict';
import test from 'node:test';
import {compareMediaFrames,ORIGINAL_MEDIA_EDIT_RECIPE} from './packages/builder/dist/media-preparation.js';
test('actual257MiB source is rejected before its copy iterator can run',async()=>{
 const bytes=new Uint8Array(257*1024*1024);let copied=false;Object.defineProperty(bytes,Symbol.iterator,{value(){copied=true;throw new Error('caller source copied before bound');}});
 await assert.rejects(compareMediaFrames({bytes,recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0}),/Media must contain/);assert.equal(copied,false);
});
