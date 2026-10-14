import assert from 'node:assert/strict';
import test from 'node:test';
import {uploadKeelStudioArtifact,stageKeelStudioProject} from '../packages/sdk/dist/studio-upload.js';

const preparation={route:'creator-prepared-copy',status:'source-staged',sourceRevision:'0x'+'11'.repeat(32),reviewPath:'/artifacts/exact-project?studio=1',publicationReady:false};
const upload=body=>uploadKeelStudioArtifact({endpoint:'https://studio.invalid/api/artifacts',formData:new FormData(),fetchImplementation:async()=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})});

test('Studio upload preserves the source-only preparation contract and rejects readiness or external route substitution',async()=>{
 assert.deepEqual(await upload({id:'exact-project',preparation}),{id:'exact-project',preparation});
 assert.deepEqual(await upload({id:'legacy-project'}),{id:'legacy-project'});
 for(const bad of [{...preparation,publicationReady:true},{...preparation,reviewPath:'//other.invalid/approve'},{...preparation,reviewPath:'/\\other.invalid/approve'},{...preparation,sourceRevision:'unverified'},{...preparation,status:'funded'}, {...preparation,unknown:true}])await assert.rejects(upload({id:'exact-project',preparation:bad}),/preparation/);
});

test('stage preserves explicit metadata slots, Raw and creator-owned shell without rewriting original file bytes',async()=>{
 const original=Buffer.from('<!doctype html><p>Original🔥</p>');
 const mediaSlots={image:null,animation_url:{resourceId:'index.html',presentation:'direct',delivery:'onchain'}};
 let received;
 const result=await stageKeelStudioProject({studioUrl:'https://studio.invalid',agentToken:'fixture-'.repeat(8),title:'Creator source',storageStrategy:'onchain',payloadStorage:'raw',viewer:'none',mediaSlots,
  files:[{path:'index.html',bytes:original,mediaType:'text/html',role:'entrypoint',format:'asset'}],fetchImplementation:async(_url,input)=>{
   received=JSON.parse(input.body.get('metadata'));assert.deepEqual(Buffer.from(await input.body.get('files').arrayBuffer()),original);
   return new Response(JSON.stringify({schema:'keel-studio-project-handoff@1',id:'exact-stage',handoffUrl:'https://studio.invalid/studio/import/exact-stage',expiresAt:'2026-10-15T00:00:00.000Z',fileCount:1,totalBytes:original.length,wallet:{signing:'not-performed',submission:'not-performed'}}));
  }});
 assert.equal(received.payloadStorage,'raw');assert.equal(received.viewer,'none');assert.deepEqual(received.mediaSlots,mediaSlots);
 assert.equal(received.publicationIntent,undefined);assert.equal(result.wallet.submission,'not-performed');
});
