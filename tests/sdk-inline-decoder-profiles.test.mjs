import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {gzipSync} from "node:zlib";
import {assertKeelInlineNoExternalDependencies,buildKeelInlineShellFragments,buildKeelInlineModuleFragment,buildKeelInlineLocalDocument} from '../packages/sdk/dist/inline-viewer-graph.js';
const source=new TextEncoder().encode('globalThis.REPEATABLE={water:1,fire:2,label:"日本語 ☄"};');
const html=new TextEncoder().encode('<!doctype html><script src="fixture.engine"></script>');
const packed=execFileSync('xz',['--format=lzma','--stdout','--lzma1=dict=4MiB'],{input:source});
const module=codec=>buildKeelInlineModuleFragment({moduleId:'fixture.engine',version:'test',mediaType:'text/javascript',decodedBytes:source,execution:'classic',compression:codec,...(codec==='lzma'?{storedBytes:packed}:{})});
test('default shell rejects undeclared codecs in modules, entry and asset',async()=>{
 const shell=await buildKeelInlineShellFragments();
 for(const codec of ['brotli','lzma']){
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[await module(codec)],entry:{id:'fixture.entry',mediaType:'text/html',source:html}}),/declared.*decoder/);
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'fixture.entry',mediaType:'text/html',source:html,compression:codec}}),/declared.*decoder/);
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[],assets:[{id:'fixture.asset',mediaType:'application/octet-stream',source,compression:codec}],entry:{id:'fixture.entry',mediaType:'text/html',source:html}}),/declared.*decoder/);
 }
});
test('each official opt-in profile composes only its declared verified slots',async()=>{
 for(const [codec,codecProfile] of [['brotli','brotli-js'],['lzma','lzma-js']]){
  const shell=await buildKeelInlineShellFragments({codecProfile});
  const result=await buildKeelInlineLocalDocument({shell,modules:[await module(codec)],entry:{id:'fixture.entry',mediaType:'text/html',source:html}});
  assert.equal(result.parts.length,4);assert.equal(result.byteLength,result.parts.reduce((n,p)=>n+p.bytes.length,0));
  assert.match(shell.codecProfile,new RegExp(codec));
  await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[await module(codec==='brotli'?'lzma':'brotli')],entry:{id:'fixture.entry',mediaType:'text/html',source:html}}),/declared.*decoder/);
 }
});
test('LZMA precompression must reconstruct exact final source and survive wrapping rules',async()=>{
 await assert.rejects(buildKeelInlineModuleFragment({moduleId:'fixture.engine',version:'test',mediaType:'text/javascript',decodedBytes:source,compression:'lzma'}),/precompressed/);
 await assert.rejects(buildKeelInlineModuleFragment({moduleId:'fixture.engine',version:'test',mediaType:'text/javascript',decodedBytes:new Uint8Array(source).fill(32),compression:'lzma',storedBytes:packed}),/exact|match|decode/i);
 const shell=await buildKeelInlineShellFragments({codecProfile:'lzma-js'});
 await assert.rejects(buildKeelInlineLocalDocument({shell,modules:[],entry:{id:'fixture.entry',mediaType:'text/javascript',source,compression:'lzma',storedBytes:packed}}),/final HTML|wrapping/);
});

test('nested compressed locator scanning uses commitments and refuses expansion past its cap',()=>{
 const encode=value=>new TextEncoder().encode(JSON.stringify(value));
 const safe={embedded:{compression:'lzma',storedBase64:packed.toString('base64')},integrity:{byteLength:source.length}};
 assert.doesNotThrow(()=>assertKeelInlineNoExternalDependencies(encode(safe)));
 const remote=new TextEncoder().encode('fetch("https://external.example/data")');
 const remotePacked=execFileSync('xz',['--format=lzma','--stdout','--lzma1=dict=4MiB'],{input:remote});
 assert.throws(()=>assertKeelInlineNoExternalDependencies(encode({embedded:{compression:'lzma',storedBase64:remotePacked.toString('base64')},integrity:{byteLength:remote.length}})),/external resource/);
 assert.throws(()=>assertKeelInlineNoExternalDependencies(encode({...safe,integrity:{byteLength:source.length+1}})),/decode|length|bound/);
 assert.throws(()=>assertKeelInlineNoExternalDependencies(new TextEncoder().encode('const nested='+JSON.stringify(safe))),/exact JSON output commitment/);
 const bomb=gzipSync(Buffer.alloc(33*1024*1024));
 assert.throws(()=>assertKeelInlineNoExternalDependencies(encode({embedded:{compression:'gzip',storedBase64:bomb.toString('base64')}})),/scan bounds/);
});
