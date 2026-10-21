import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
const sdkRoot = process.env.KEEL_STILL_TEST_SDK_ROOT;
const p = await import(sdkRoot ? pathToFileURL(sdkRoot + '/packages/protocol/dist/index.js').href : '../packages/protocol/dist/index.js');
const sha = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
const hash = n => '0x' + n.repeat(64), addr = n => '0x' + n.repeat(40);
const caps = { directAsset: 'qualified', shellInline: 'qualified', shellHybrid: 'qualified', inlineImageTypes: ['image/png','image/jpeg','image/webp','image/gif'], inlineMediaTypes: ['audio/mpeg','video/mp4','text/plain'], identity: { chainId: 11155111, blockNumber: '1', blockHash: hash('1'), factory: addr('2'), creationCodeHash: hash('3'), reader: addr('4'), runtimeCodeHash: hash('5') } };
const source = { resourceId: 'original', mediaType: 'image/png', byteLength: 500001, digest: hash('a') };
const base = extra => ({ source, execution: 'static', capabilities: caps, ...extra });
function shell(plan) { assert.equal(plan.viewer, 'keel-verification-shell'); assert.equal(plan.publicationReady, false); }
const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let n = 0; n < 8; n++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; };
function pngChunk(type, payload = Buffer.alloc(0)) { const b = Buffer.alloc(payload.length + 12); b.writeUInt32BE(payload.length); b.write(type,4); payload.copy(b,8); b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4); return b; }
function png({ size, animated = false } = {}) {
  const header = Buffer.from([0,0,0,1,0,0,0,1,8,6,0,0,0]);
  const parts = [Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR',header)];
  if (animated) { const actl=Buffer.alloc(8); actl.writeUInt32BE(2); parts.push(pngChunk('acTL',actl)); }
  parts.push(pngChunk('IDAT',deflateSync(Buffer.from([0,255,0,0,255]))),pngChunk('IEND'));
  const plain = Buffer.concat(parts);
  if (!size) return plain;
  assert.ok(size >= plain.length + 12); parts.splice(2,0,pngChunk('tEXt',Buffer.alloc(size-plain.length-12,120))); return Buffer.concat(parts);
}
function riffChunk(name, bytes) { const h=Buffer.alloc(8);h.write(name);h.writeUInt32LE(bytes.length,4);return Buffer.concat([h,bytes,Buffer.alloc(bytes.length%2)]); }
function webp(animated = false) {
  // Container-only motion fixture; image decoding is a separate compiler check.
  const flags=Buffer.alloc(10); flags[0]=animated?2:0;
  const body=Buffer.concat([Buffer.from('WEBP'),riffChunk('VP8X',flags),...(animated?[riffChunk('ANIM',Buffer.alloc(6)),riffChunk('ANMF',Buffer.alloc(16))]:[]),riffChunk('VP8 ',Buffer.from([1,2,3,4]))]);
  const h=Buffer.alloc(8);h.write('RIFF');h.writeUInt32LE(body.length,4);return Buffer.concat([h,body]);
}
test('known still same-source raster retains the decimal 500KB shortcut and 2MB split boundary', () => {
  for (const n of [499999,500000,500001,1999999,2000000,2000001]) {
    const plan=p.planKeelSmartAssetPresentation(base({ source:{...source,byteLength:n}, sourceMotion:'still' }));
    assert.equal(plan.selectedCandidateId,n>2000000?'canonical-hybrid':n>500000?'image-only-inline':'canonical-inline');
    assert.equal(plan.source.digest,source.digest); assert.equal(plan.publicationReady,false);
  }
});
test('a distinct grid preview is not the duplicated-still exception', () => {
  for (const preview of [{...source,resourceId:'thumbnail',byteLength:100,digest:hash('b')},{...source,resourceId:'thumbnail',mediaType:'image/webp'}]) shell(p.planKeelSmartAssetPresentation(base({sourceMotion:'still',preview})));
  const same=p.planKeelSmartAssetPresentation(base({sourceMotion:'still',preview:{...source,resourceId:'same-bytes-alias'}}));assert.equal(same.viewer,'none');
});
test('nonexecutable is not still: animation, scripts and unknown motion keep verification', () => {
  for (const mediaType of ['image/gif','image/apng','video/mp4','audio/mpeg','text/plain','image/svg+xml','model/gltf-binary','application/octet-stream']) {
    for (const sourceMotion of [undefined,'unknown','animated','still']) shell(p.planKeelSmartAssetPresentation(base({source:{...source,mediaType},...(sourceMotion===undefined?{}:{sourceMotion})})));
  }
  for (const mediaType of ['image/png','image/webp','image/jpeg']) for (const sourceMotion of [undefined,'unknown','animated']) shell(p.planKeelSmartAssetPresentation(base({source:{...source,mediaType},...(sourceMotion===undefined?{}:{sourceMotion})})));
  for (const execution of ['script','unknown']) shell(p.planKeelSmartAssetPresentation(base({sourceMotion:'still',execution})));
  shell(p.planKeelSmartAssetPresentation(base({sourceMotion:'still',source:{...source,mediaType:'text/html'}})));
});
test('inline and hybrid explicit verifier choices stay selected for a shortcut-eligible still', () => {
  for (const animation of ['inline-shell','hybrid-shell']) {
    const plan=p.planKeelSmartAssetPresentation(base({sourceMotion:'still',selection:{image:'inline',animation}}));shell(plan);assert.equal(plan.selectionSource,'explicit');assert.equal(plan.animation.delivery,animation);
  }
  shell(p.planKeelSmartAssetPresentation(base({sourceMotion:'still',assetPresentation:'inline-image-hybrid-verifier'})));
});
test('complete-return and actual reader limits stay separate from the still-size recommendation', () => {
  for (const size of [1999999,2000000,2000001]) {
    const plan=p.planKeelSmartAssetPresentation(base({sourceMotion:'still',candidateMeasurements:{'image-only-inline':{completeTokenUriBytes:size,maximumTokenUriBytes:2000000}}}));
    if(size>2000000)shell(plan);else assert.equal(plan.viewer,'none');assert.equal(plan.publicationReady,false);
  }
  for (const key of ['executionGas','stateGas','readGas']) {
    const maximum={executionGas:'maxExecutionGas',stateGas:'maxStateGas',readGas:'maxReadGas'}[key];
    const plan=p.planKeelSmartAssetPresentation(base({sourceMotion:'still',candidateMeasurements:{'image-only-inline':{[key]:'101',[maximum]:'100'}}}));shell(plan);
  }
});
test('PNG/APNG motion uses the actual full chunk sequence, not PNG MIME or first chunk', () => {
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:png()}),'still');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:png({animated:true})}),'animated');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/apng',bytes:png({animated:true})}),'animated');
  const still=png({size:500001}),copy=Buffer.from(still);assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:still}),'still');assert.deepEqual(still,copy);
  for (const bytes of [still.subarray(0,-1),Buffer.concat([still,Buffer.from([0])]),Buffer.from('not PNG')]) assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes}),'unknown');
});
test('WebP animation flags and frame chunks prevent a still shortcut', () => {
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/webp',bytes:webp()}),'still');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/webp',bytes:webp(true)}),'animated');
  const partial=webp();partial.writeUInt32LE(999999,4);assert.equal(p.classifyKeelAssetMotion({mediaType:'image/webp',bytes:partial}),'unknown');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/webp',bytes:webp().subarray(0,-1)}),'unknown');
});
test('GIF including one frame, video/audio and unfamiliar containers never get a MIME-only still claim', () => {
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/gif',bytes:gif}),'animated');
  for (const mediaType of ['audio/mpeg','video/mp4','image/avif','image/svg+xml','application/pdf']) assert.notEqual(p.classifyKeelAssetMotion({mediaType,bytes:png()}),'still');
  assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:Buffer.from('<html><script>work()</script>')}),'unknown');
});
test('corruption, huge lengths and scan budgets return unknown without decoding or changing source', () => {
  const bad=png();bad[bad.length-1]^=1;assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:bad}),'unknown');
  const overflow=png();overflow.writeUInt32BE(0xffffffff,8);assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:overflow}),'unknown');
  const large=Buffer.alloc(32*1024*1024+1);assert.equal(p.classifyKeelAssetMotion({mediaType:'image/png',bytes:large}),'unknown');
});
test('motion is bound into review identity and invalid values are rejected', () => {
  const still=p.planKeelSmartAssetPresentation(base({sourceMotion:'still'})),animation=p.planKeelSmartAssetPresentation(base({sourceMotion:'animated'}));assert.notEqual(still.planKey,animation.planKey);
  assert.throws(()=>p.planKeelSmartAssetPresentation(base({sourceMotion:'moving-maybe'})));
});

const { stageKeelStudioProject } = await import(sdkRoot ? pathToFileURL(sdkRoot + '/packages/sdk/dist/studio-upload.js').href : '../packages/sdk/dist/studio-upload.js');
const { planKeelMediaSlots, defaultKeelImageViewer } = await import(sdkRoot ? pathToFileURL(sdkRoot + '/packages/builder/dist/media-slot-plan.js').href : '../packages/builder/dist/media-slot-plan.js');
async function stage(bytes, mediaType, explicit = {}) {
  let metadata;
  await stageKeelStudioProject({studioUrl:'https://studio.example',agentToken:'k'.repeat(48),title:'Still or animation policy',storageStrategy:'onchain',files:[{path:'source',mediaType,bytes,role:'image',format:'asset'}],...explicit,
    fetchImplementation:async(_url,init)=>{
      metadata=JSON.parse(init.body.get('metadata'));assert.deepEqual(Buffer.from(await init.body.get('files').arrayBuffer()),bytes);
      return Response.json({schema:'keel-studio-project-handoff@1',id:'same-source',handoffUrl:'https://studio.example/studio/projects/new?handoff=secret',expiresAt:'2027-09-01T00:00:00Z',fileCount:1,totalBytes:bytes.length,wallet:{signing:'not-performed',submission:'not-performed'}},{status:201});
    }});return metadata;
}
test('real SDK staging keeps canonical intent until server qualification and preserves exact source bytes',async()=>{
  for(const size of [499999,500000,500001,1999999,2000000,2000001]){
    const metadata=await stage(png({size}),'image/png');assert.equal(metadata.viewer,'keel-verification-shell');assert.equal(metadata.publicationIntent?.schema,'keel-studio-publication-intent@1');assert.equal(metadata.publicationIntent?.viewer.required,true);
  }
  assert.equal((await stage(png({size:500001,animated:true}),'image/png')).viewer,'keel-verification-shell');
  assert.equal((await stage(png({size:500001,animated:true}),'image/apng')).viewer,'keel-verification-shell');
});
test('real SDK staging keeps verifier for large GIF and byte-sniffed scripts and retains explicit shell/preview options',async()=>{
  const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64');
  const comments=[gif.subarray(0,-1),Buffer.from([0x21,0xfe])];for(let left=600000;left>0;){const n=Math.min(left,255);comments.push(Buffer.from([n]),Buffer.alloc(n,120));left-=n;}comments.push(Buffer.from([0,0x3b]));
  assert.equal((await stage(Buffer.concat(comments),'image/gif')).viewer,'keel-verification-shell');
  assert.equal((await stage(Buffer.from('<!doctype html><script>work()</script>'),'image/png')).viewer,'keel-verification-shell');
  const bytes=png({size:500001});
  for(const assetPresentationSelection of ['canonical-inline','canonical-hybrid'])assert.equal((await stage(bytes,'image/png',{assetPresentationSelection})).viewer,'keel-verification-shell');
  const external=await stage(bytes,'image/png',{assetPresentation:'external-preview',externalPreviewUri:'ipfs://bafycreator/preview.png'});assert.equal(external.viewer,'keel-verification-shell');assert.equal(external.externalPreviewUri,'ipfs://bafycreator/preview.png');
  assert.equal((await stage(bytes,'image/png',{viewer:'none'})).viewer,'none');
});
test('builder intent accepts explicit motion evidence but never assumes GIF or a distinct thumbnail is still duplication',()=>{
  for(const mediaType of ['image/png','image/webp','image/jpeg']){
    assert.equal(defaultKeelImageViewer(mediaType,500001),'keel-verification-shell');
    assert.equal(defaultKeelImageViewer(mediaType,500001,'still'),'none');
    const plan=planKeelMediaSlots({sourceResourceId:'original',mediaType,sourceByteLength:500001,sourceMotion:'still',thumbnailResourceId:'separate-thumbnail'});assert.equal(plan.viewer,'keel-verification-shell');assert.equal(plan.image.resourceId,'separate-thumbnail');
  }
  for(const mediaType of ['image/gif','image/apng','video/mp4','audio/mpeg'])assert.equal(defaultKeelImageViewer(mediaType,500001,'still'),'keel-verification-shell');
});
