import assert from 'node:assert/strict';
import test from 'node:test';
import {inspectKeelNativeSVG,inspectKeelNativeAudio,KeelNativeMediaError} from '../packages/sdk/dist/native-media-inspection.js';
import {qualifyKeelNativeMediaViewer} from '../packages/sdk/dist/media-viewer-adapters.js';
import {keelAssetDisplayModuleBytes,keelAssetDisplayModuleRevision,KEEL_ASSET_DISPLAY_MODULE_VERSION} from '../packages/sdk/dist/asset-display.js';
import {nativeFixture,audioCases,sha} from './helpers/native-media-fixtures.mjs';
const encode=s=>new TextEncoder().encode(s),svg=body=>encode(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
for(const [name,motion]of [['still','still'],['smil','animated'],['css','animated']])test(`strict native ${name} SVG retains exact XML and motion semantics`,async()=>{
  const bytes=await nativeFixture(`${name}.svg`),before=bytes.slice(),result=inspectKeelNativeSVG(bytes);
  assert.equal(result.motion,motion);assert.equal(result.rendering,'native-image');assert.equal(result.browserDecode,'required');assert.deepEqual(bytes,before);
});
for(const [name,bytes,code]of [
  ['encoding mismatch',encode('<?xml version="1.0" encoding="UTF-16"?><svg xmlns="http://www.w3.org/2000/svg"/>'),'invalid-container'],
  ['mismatched tags',svg('<g></path>'),'invalid-container'],
  ['duplicate XML attribute',svg('<path fill="red" fill="blue"/>'),'invalid-container'],
  ['invalid XML entity',svg('<text>&notdeclared;</text>'),'invalid-container'],
  ['DTD',encode('<!DOCTYPE svg [<!ENTITY x "red">]><svg xmlns="http://www.w3.org/2000/svg"/>'),'unsupported-execution'],
  ['script',svg('<script>window.originalMustNotExecute=1</script>'),'unsupported-execution'],
  ['event handler',svg('<rect onload="alert(1)"/>'),'unsupported-execution'],
  ['foreignObject',svg('<foreignObject/>'),'unsupported-execution'],
  ['interactive link',svg('<a href="#x"><text>x</text></a>'),'unsupported-execution'],
  ['SMIL executable target',svg('<set attributeName="onload" to="alert(1)"/>'),'unsupported-execution'],
  ['external image',svg('<image href="https://example.com/x.png"/>'),'external-dependency'],
  ['external CSS URL',svg('<style>path{fill:url(https://example.com/x)}</style>'),'external-dependency'],
  ['escaped CSS URL',svg('<style>path{fill:u\\72l(https://example.com/x)}</style>'),'external-dependency'],
  ['extra namespace',svg('<x:thing xmlns:x="urn:unqualified"/>'),'unsupported-execution'],
])test(`native SVG rejects ${name} without changing the original`,()=>{
  const original=bytes.slice();assert.throws(()=>inspectKeelNativeSVG(bytes),error=>error instanceof KeelNativeMediaError&&error.code===code&&/Original source bytes were not changed/.test(error.message));assert.deepEqual(bytes,original);
});
test('native SVG accepts exact internal definitions and rejects invalid UTF-8',()=>{
  assert.equal(inspectKeelNativeSVG(svg('<defs><linearGradient id="x"><stop stop-color="red"/></linearGradient></defs><path fill="url(#x)"/>')).motion,'still');
  assert.throws(()=>inspectKeelNativeSVG(new Uint8Array([255])),/UTF-8 XML/);
});
for(const audio of audioCases)test(`native ${audio.mediaType} requires complete real container and exact retained samples`,async()=>{
  const source=await nativeFixture(audio.name),before=source.slice();const result=inspectKeelNativeAudio({...audio,source});
  assert.equal(result.kind,'audio');assert.equal(result.mediaType,audio.mediaType);assert.equal(result.byteLength,source.length);assert.equal(result.browserDecode,'required');assert.deepEqual(source,before);
  for(const broken of [source.subarray(0,4),source.subarray(0,source.length-1),new Uint8Array(100)])assert.throws(()=>inspectKeelNativeAudio({...audio,source:broken}),KeelNativeMediaError);
});
test('WAV validates format fields and sample alignment, never MIME-only admission',async()=>{
  const source=await nativeFixture('tone.wav');for(const at of [22,24,28,32,34]){const broken=source.slice();broken[at]=0;assert.throws(()=>inspectKeelNativeAudio({mediaType:'audio/wav',source:broken}),/WAV/)}
  assert.throws(()=>inspectKeelNativeAudio({mediaType:'audio/mpeg',source}),/MP3/);
});
test('native adapter requires exact new module; old/counterfeit profiles cannot bless SVG/audio',async()=>{
  const source=await nativeFixture('tone.wav'),revision=keelAssetDisplayModuleRevision(KEEL_ASSET_DISPLAY_MODULE_VERSION),profile={moduleId:'keel.asset-display',...revision,mediaType:'audio/wav',source};
  assert.equal(keelAssetDisplayModuleBytes().length,revision.byteLength);assert.equal(sha(keelAssetDisplayModuleBytes()),revision.digest);
  assert.equal(qualifyKeelNativeMediaViewer(profile).playback,'gesture-start-native-audio-controls');
  for(const change of [{version:'1.4.0',...keelAssetDisplayModuleRevision('1.4.0')},{digest:'0x'+'00'.repeat(32)},{byteLength:1},{moduleId:'fake'}])assert.throws(()=>qualifyKeelNativeMediaViewer({...profile,...change}),/exact current/);
  assert.equal(qualifyKeelNativeMediaViewer({...profile,mediaType:'image/svg+xml',source:await nativeFixture('still.svg')}).id,'native-svg');
});

test('MP4 sample tables cannot authorize payload ranges beyond actual media data',async()=>{
  const bytes=await nativeFixture('tone.m4a'),broken=bytes.slice(),at=Buffer.from(broken).indexOf(Buffer.from('stsz'));assert.ok(at>0);new DataView(broken.buffer).setUint32(at+16,0x7fffffff);
  assert.throws(()=>inspectKeelNativeAudio({mediaType:'audio/mp4',source:broken}),/sample/);
});
