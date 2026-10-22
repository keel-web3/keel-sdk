import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../packages/builder/package.json',import.meta.url)),sharp=require('sharp');
import {createHash} from 'node:crypto';
import {prepareMediaCandidate,compareMediaFrames,verifyActualMediaPair,ORIGINAL_MEDIA_EDIT_RECIPE} from '../packages/builder/dist/media-preparation.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function source(delays,loop,format='gif'){
 const rgba=Buffer.alloc(4*4*4*3);for(let i=0;i<48;i++){rgba[i*4+Math.floor(i/16)]=255;rgba[i*4+3]=255;}
 const image=sharp(rgba,{raw:{width:4,height:12,channels:4,pageHeight:4}});
 return new Uint8Array(await image[format]({delay:delays,loop,lossless:true}).toBuffer());
}
for(const [name,delays,loop,time,index] of [['finite',[120,240,200],2,150,1],['clamped',[10,20,30],0,15,1]]){
 test(`${name} native GIF exposes all declared frames without approving altered playback`,async()=>{
  const bytes=await source(delays,loop),before=bytes.slice(),result=await compareMediaFrames({bytes,mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:time});
  assert.deepEqual(result.sourceInfo.frameDurationsMs,delays);assert.equal(result.sourceInfo.frameCount,3);assert.equal(result.sourceFrameTimeMs,delays.slice(0,index).reduce((a,b)=>a+b,0));
  assert.equal(result.sourceIntegrity.digest,`0x${sha(bytes)}`);assert.equal(result.verification.losslessPixelsVerified,false);assert.equal(result.verification.completeDecode,false);
  assert.match(result.warnings.join(' '),/declared frame delays.*not conversion/);
  const expected=await sharp(bytes,{page:index,pages:1}).ensureAlpha().raw().toBuffer();
  assert.equal(sha(await sharp(result.originalFrame).ensureAlpha().raw().toBuffer()),sha(expected));assert.deepEqual(result.processedFrame,result.originalFrame);assert.deepEqual(bytes,before);
 });
 test(`${name} GIF remains unavailable to strict preparation, edited comparison and actual-pair proof`,async()=>{
  const bytes=await source(delays,loop),before=bytes.slice(),recipe={...ORIGINAL_MEDIA_EDIT_RECIPE,mode:'lossless',format:'webp'},candidate=await sharp(bytes,{animated:true}).webp({lossless:true,delay:delays,loop}).toBuffer();
  for(const operation of [()=>prepareMediaCandidate({bytes,mediaType:'image/gif',recipe}),()=>compareMediaFrames({bytes,mediaType:'image/gif',recipe,timeMs:0}),()=>verifyActualMediaPair({sourceBytes:bytes,candidateBytes:new Uint8Array(candidate),recipe})])await assert.rejects(operation(),/Finite, interactive or clamped/);
  const retained=await prepareMediaCandidate({bytes,mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE});assert.deepEqual(retained.bytes,bytes);assert.deepEqual(bytes,before);
 });
}
test('native finite WebP retains complete intrinsic timing and existing loop admission',async()=>{
 const bytes=await source([120,240,200],2,'webp'),result=await compareMediaFrames({bytes,mediaType:'image/webp',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:150});
 assert.equal(result.sourceInfo.frameCount,3);assert.deepEqual(result.sourceInfo.frameDurationsMs,[120,240,200]);assert.equal(result.verification.losslessPixelsVerified,false);
});
test('native GIF inspection still refuses incomplete or interactive complete controls, exact export remains available',async()=>{
 const bytes=await source([120,240,200],2),interactive=bytes.slice();let at=Buffer.from(interactive).indexOf(Buffer.from([0x21,0xf9,4]));assert.ok(at>=0);interactive[at+3]|=2;
 for(const input of [bytes.subarray(0,bytes.length-1),interactive]){
  await assert.rejects(compareMediaFrames({bytes:input,mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE,timeMs:0}));
  assert.deepEqual((await prepareMediaCandidate({bytes:input,mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE})).bytes,input);
 }
});

for(const [name,delays,loop] of [['finite',[120,240,200],2],['clamped',[10,20,30],0]])test(`actual MCP native ${name} comparison/export stays byte bound and strict conversion still rejects`,async()=>{
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),path=await import('node:path');
 const {MEDIA_EDIT_TOOL_DEFINITIONS}=await import('../packages/mcp/dist/media-edit-tools.js'),{createWorkspace}=await import('../packages/mcp/dist/paths.js');
 const root=await mkdtemp(path.join(tmpdir(),'keel-native-gif-mcp-'));
 try{const bytes=await source(delays,loop);await writeFile(path.join(root,'source.gif'),bytes);const workspace=await createWorkspace(root),context={workspace},args={inputPath:'source.gif',mediaType:'image/gif',recipe:ORIGINAL_MEDIA_EDIT_RECIPE};
 const compare=MEDIA_EDIT_TOOL_DEFINITIONS.find(tool=>tool.descriptor.name==='keel-media-compare'),candidate=MEDIA_EDIT_TOOL_DEFINITIONS.find(tool=>tool.descriptor.name==='keel-media-candidate');
 const frame=await compare.run(context,args);assert.equal(frame.sourceInfo.frameCount,3);assert.deepEqual(frame.sourceInfo.frameDurationsMs,delays);assert.equal(frame.verification.losslessPixelsVerified,false);assert.equal(frame.persisted,false);
 const retained=await candidate.run(context,args);assert.deepEqual(Buffer.from(retained.bytesBase64,'base64'),Buffer.from(bytes));assert.equal(retained.persisted,false);
 await assert.rejects(candidate.run(context,{...args,recipe:{...ORIGINAL_MEDIA_EDIT_RECIPE,mode:'lossless',format:'webp'}}),/Finite, interactive or clamped/);assert.deepEqual(await readFile(path.join(root,'source.gif')),Buffer.from(bytes));
 }finally{await rm(root,{recursive:true,force:true});}
});
