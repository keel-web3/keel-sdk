import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {promisify} from 'node:util';
import {syncBuiltinESMExports} from 'node:module';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const real=promisify(cp.execFile);let launches=[];
const wrapper=(...args)=>cp.execFile(...args);
wrapper[promisify.custom]=async(...args)=>{launches.push(args[1]);return real(...args)};cp.execFile=wrapper;syncBuiltinESMExports();
const {prepareMediaCandidate,getMediaPreparationCapabilities,parseKeelMediaEditRecipe,ORIGINAL_MEDIA_EDIT_RECIPE:original}=await import('../packages/builder/dist/media-preparation.js');
const {createMcpServer}=await import('../packages/mcp/dist/index.js');
const fixtures=new URL('./fixtures/media-conversion-capabilities/',import.meta.url),source=new Uint8Array(await readFile(new URL('fixture.mov',fixtures))),webm=new Uint8Array(await readFile(new URL('fixture.webm',fixtures)));
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(source.length,1927);assert.equal(hash(source),'ea3b962dc878b4514ae1798fa10c90a10bac04d3f96459eccfec1d8ce8a4e736');assert.equal(webm.length,1489);assert.equal(hash(webm),'6013f6fd732009e925ecdeb7db2f784e7c7faa64c569efce3bcf7c3b5ca54015');
for(const mode of ['lossless','lossy'])test(`edited WebM ${mode} refuses before probing while retaining source and saved recipe`,async()=>{
 const recipe={...original,mode,format:'webm'},before=source.slice(),saved=structuredClone(recipe);assert.deepEqual(parseKeelMediaEditRecipe(recipe),saved);launches=[];
 await assert.rejects(prepareMediaCandidate({bytes:source,mediaType:'video/quicktime',recipe}),error=>{assert.ok(error instanceof TypeError);assert.match(error.message,/WebM conversion is unavailable/);assert.match(error.message,/metadata.*semantics/);assert.match(error.message,/Keep original/);return true});
 assert.deepEqual(launches,[]);assert.deepEqual(source,before);assert.deepEqual(recipe,saved);
});
test('candidate formats exclude unavailable WebM and keep conditional qualified adapters',async()=>{
 const caps=await getMediaPreparationCapabilities();assert.deepEqual(caps.movie.formats,['webp','avif','mp4','mov']);assert.deepEqual(caps.image.formats,['webp','avif']);assert.match(caps.movie.input,/conditional/i);assert.equal(caps.original.bytePreserving,true);assert.equal(caps.browserDecode,'requires-runtime-check');
});
test('native Original WebM and MOV exports remain exact without decoder or lossless claims',async()=>{
 for(const [bytes,mediaType]of [[webm,'video/webm'],[source,'video/quicktime']]){launches=[];const result=await prepareMediaCandidate({bytes,mediaType,recipe:original});assert.deepEqual(result.bytes,bytes);assert.equal(result.mediaType,mediaType);assert.equal(result.sourceIntegrity.digest,'0x'+hash(bytes));assert.equal(result.verification.completeDecode,false);assert.equal(result.verification.losslessPixelsVerified,false);assert.deepEqual(launches,[])}
});
test('real portable MCP has identical capabilities, actionable WebM refusal and unchanged native Original',async()=>{
 const server=await createMcpServer({workspaceRoot:fixtures.pathname});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'media-capability-regression',version:'1'}}});let id=1;
 const call=(name,args)=>server.handle({jsonrpc:'2.0',id:id++,method:'tools/call',params:{name,arguments:args}});
 const caps=await call('keel-media-capabilities',{});assert.equal(caps.result.isError,undefined);assert.deepEqual(caps.result.structuredContent.movie,(await getMediaPreparationCapabilities()).movie);
 const recipe={...original,mode:'lossless',format:'webm'},saved=structuredClone(recipe);launches=[];const refused=await call('keel-media-candidate',{inputPath:'fixture.mov',mediaType:'video/quicktime',recipe});assert.equal(refused.result.isError,true);assert.match(refused.result.content[0].text,/WebM conversion is unavailable/);assert.match(refused.result.content[0].text,/Keep original/);assert.deepEqual(launches,[]);assert.deepEqual(recipe,saved);
 const kept=await call('keel-media-candidate',{inputPath:'fixture.webm',mediaType:'video/webm',recipe:original});assert.notEqual(kept.result.isError,true);assert.deepEqual(Buffer.from(kept.result.structuredContent.bytesBase64,'base64'),Buffer.from(webm));assert.equal(kept.result.structuredContent.verification.completeDecode,false);assert.deepEqual(new Uint8Array(await readFile(new URL('fixture.mov',fixtures))),source);assert.deepEqual(new Uint8Array(await readFile(new URL('fixture.webm',fixtures))),webm);
});
