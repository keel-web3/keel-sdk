import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStudioArtifact} from '../packages/studio-core/dist/index.js';
import {sharedFixture,poster} from './support/legacy-shared-image-fixture.mjs';
test('retired shared-image construction is not a current Studio entrypoint',async()=>{
 await assert.rejects(sharedFixture(),/retired for fresh publication/);
});

test('current original HTML and native poster remain separate exact uncompressed Studio resources',async()=>{
 const source=Buffer.from('<!doctype html><p>original art</p>');
 const prepared=await prepareStudioArtifact({id:'current-source',name:'Original release',assets:[
  {id:'native-image',fileName:'poster.png',mediaType:'image/png',role:'image',bytes:poster},
  {id:'creator-html',fileName:'index.html',mediaType:'text/html',role:'entrypoint',entrypoint:true,executable:true,bytes:source}],payloadStorage:'raw',compression:'none',contractReadableFallback:true});
 assert.equal(prepared.manifest.entrypoint.resource,'creator-html');
 const entry=prepared.resources.find(x=>x.resource.id==='creator-html');assert.deepEqual(Buffer.from(entry.storedBytes),source);assert.equal(entry.compression,'none');
 assert.equal(prepared.resources.length,2);
 const native=prepared.resources.find(x=>x.resource.id==='native-image');assert.deepEqual(Buffer.from(native.decodedBytes),poster);assert.equal(native.compression,'none');
});
