import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStudioArtifact} from '../packages/studio-core/dist/index.js';
import {sharedFixture,poster} from './support/legacy-shared-image-fixture.mjs';
test('new explicit shared-image program remains the uncompressed Studio entrypoint and image bytes exist once',async()=>{
 const f=await sharedFixture();
 const prepared=await prepareStudioArtifact({id:'shared-image-program',name:'Original release',assets:[
  {id:'native-image',fileName:'poster.png',mediaType:'image/png',role:'image',bytes:poster},
  {id:'reader-program',fileName:'reader.program',mediaType:f.program.mediaType,role:'entrypoint',entrypoint:true,executable:true,bytes:f.program.bytes}],
  payloadStorage:'compact',compression:'auto',contractReadableFallback:true});
 assert.equal(prepared.manifest.entrypoint.resource,'reader-program');
 const program=prepared.resources.find(x=>x.resource.id==='reader-program');
 assert.deepEqual(Buffer.from(program.storedBytes),Buffer.from(f.program.bytes));assert.equal(program.compression,'none');
 assert.equal(prepared.resources.length,2);
 const native=prepared.resources.find(x=>x.resource.id==='native-image');assert.deepEqual(Buffer.from(native.decodedBytes),poster);assert.equal(native.compression,'none');
});
