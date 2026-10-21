import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const root = process.env.KEEL_STAGING_TEST_SDK_ROOT;
const { stageKeelStudioProject } = await import(root ? pathToFileURL(root+'/packages/sdk/dist/studio-upload.js').href : '../packages/sdk/dist/studio-upload.js');
const { defaultKeelStudioPublicationIntent } = await import(root ? pathToFileURL(root+'/packages/sdk/dist/studio-publication.js').href : '../packages/sdk/dist/studio-publication.js');
const crc = bytes => { let c=0xffffffff; for(const byte of bytes){c^=byte;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0; };
function chunk(type,data=Buffer.alloc(0)){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;}
function png(size){const parts=[Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0])),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),chunk('IEND')];const length=parts.reduce((n,p)=>n+p.length,0);parts.splice(2,0,chunk('tEXt',Buffer.alloc(size-length-12,120)));return Buffer.concat(parts);}
async function stage(bytes,extra={}){
  let metadata;
  await stageKeelStudioProject({studioUrl:'https://studio.example',agentToken:'k'.repeat(48),title:'Actual staging authority',storageStrategy:'onchain',files:[{path:'original.png',mediaType:'image/png',bytes,role:'image',format:'asset'}],...extra,fetchImplementation:async(_url,init)=>{
    metadata=JSON.parse(init.body.get('metadata'));assert.deepEqual(Buffer.from(await init.body.get('files').arrayBuffer()),bytes);
    return Response.json({schema:'keel-studio-project-handoff@1',id:'same-project',handoffUrl:'https://studio.example/studio/projects/new?handoff=secret',expiresAt:'2027-09-01T00:00:00Z',fileCount:1,totalBytes:bytes.length,wallet:{signing:'not-performed',submission:'not-performed'}},{status:201});
  }});return metadata;
}
test('automatic staging cannot persist artifact-only from an unqualified still-byte recommendation',async()=>{
  for(const size of [499999,500000,500001,1999999,2000000,2000001]){
    const metadata=await stage(png(size));assert.equal(metadata.viewer,'keel-verification-shell');assert.deepEqual(metadata.publicationIntent,defaultKeelStudioPublicationIntent());assert.equal(metadata.assetPresentation,'automatic');
  }
});
test('explicit shell choice retains the same default publication intent',async()=>{
  for(const assetPresentationSelection of ['canonical-inline','canonical-hybrid']){
    const metadata=await stage(png(500001),{assetPresentationSelection});assert.equal(metadata.viewer,'keel-verification-shell');assert.deepEqual(metadata.publicationIntent,defaultKeelStudioPublicationIntent());assert.equal(metadata.assetPresentationSelection,assetPresentationSelection);
  }
});
test('explicit creator no-shell choices remain explicit and never claim canonical publication intent',async()=>{
  for(const extra of [{viewer:'none'},{assetPresentationSelection:'image-only-inline'},{mediaSlots:{image:{resourceId:'original.png',presentation:'direct',delivery:'onchain'},animation_url:null}}]){
    const metadata=await stage(png(500001),extra);assert.equal(metadata.viewer,'none');assert.equal(metadata.publicationIntent,undefined);
  }
});
