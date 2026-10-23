import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareMediaCandidate,getMediaPreparationCapabilities,ORIGINAL_MEDIA_EDIT_RECIPE as original} from './packages/builder/dist/media-preparation.js';
const source=new Uint8Array(readFileSync(new URL('../evidence/acceptance-owned-temp/keel-acceptance-media-alg2BC/fixture.mov',import.meta.url)));
assert.equal(source.length,1927);assert.equal(createHash('sha256').update(source).digest('hex'),'ea3b962dc878b4514ae1798fa10c90a10bac04d3f96459eccfec1d8ce8a4e736');
for(const format of ['webp','avif'])test(`unchanged unqualified MOV ${format} cannot invent lossless color authority`,async()=>{
 const before=source.slice();await assert.rejects(prepareMediaCandidate({bytes:source,mediaType:'video/quicktime',recipe:{...original,mode:'lossless',format,noSound:true}}),/unspecified color semantics/);
 assert.deepEqual((await prepareMediaCandidate({bytes:source,mediaType:'video/quicktime',recipe:original})).bytes,before);assert.deepEqual(source,before);
});
test('server capability must not advertise a WebM conversion absent a preserving WebM verifier',async()=>{
 await assert.rejects(prepareMediaCandidate({bytes:source,mediaType:'video/quicktime',recipe:{...original,mode:'lossless',format:'webm',noSound:true}}),/metadata|semantics/);
 const capabilities=await getMediaPreparationCapabilities();
 assert.equal(capabilities.movie.formats.includes('webm'),false,'WebM has no complete preserving verifier; do not advertise it as an available server candidate');
});
