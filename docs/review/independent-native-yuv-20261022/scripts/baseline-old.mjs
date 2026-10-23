import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {compareMediaFrames,prepareMediaCandidate,ORIGINAL_MEDIA_EDIT_RECIPE as original} from '/private/tmp/keel-independent-composed-site-20261022-01/keel-sdk/packages/builder/dist/media-preparation.js';
const bytes=new Uint8Array(await readFile(new URL('./keel-sdk/tests/fixtures/native-yuv-preview/media-preview.mp4',import.meta.url)));
assert.deepEqual((await prepareMediaCandidate({bytes,mediaType:'video/mp4',recipe:original})).bytes,bytes);
let error;
try {await compareMediaFrames({bytes,mediaType:'video/mp4',recipe:original,timeMs:150});}catch(caught){error={name:caught.name,message:caught.message,stack:caught.stack};}
assert.ok(error,'The exact older native-inspection failure must remain reproducible');
assert.match(error.message,/color, field or sample-depth semantics/);
await writeFile(new URL('./evidence/baseline-old-native-yuv.json',import.meta.url),JSON.stringify({sdk:'8d9e23ee4e3f99cf9cf7cf18cd6dc593257021c9',runtime:'Previously independently fresh built immutable own 8d9 outputs, read-only; no new old build claim',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),nativeExport:'byte exact',nativeInspect:'FAIL',error},null,2)+'\n');
console.log('Exact older Original inspection failure reproduced; Original export remains byte exact.');
