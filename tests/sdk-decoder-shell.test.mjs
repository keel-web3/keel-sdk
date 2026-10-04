import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeLzmaCommittedSync} from '../packages/sdk/dist/decoders/node.js';
import {createHash} from 'node:crypto';
import {buildCompactInlineKeelShell,buildEmbeddedKeelViewerSlot,buildKeelDecoderModule} from '../packages/sdk/dist/verification-shell.js';
import {KEEL_DECODER_PROVENANCE} from '../packages/sdk/dist/decoders/index.js';
import {readFile} from 'node:fs/promises';
const text=Buffer.from('水🔥 Pokémon Pikachu 世界\u0000 café 😀'.repeat(200));
const packed=Buffer.from('5d00004000ffffffffffffffff00732c128f0547c025e5f60ea58c23438240b2d61003acfca78a3ec03339e06c3f814421a8b06628b1c69c08c0499022e4a50ef1a531f4c0f4d991fd81ee280f0b86f575c10e6978a1338cd2a1a97ebbeb63f84ab9f1fa81fff5060800','hex');
test('declared decoder profiles are deterministic and native remains the default',async()=>{
 const a=await buildCompactInlineKeelShell();const b=await buildCompactInlineKeelShell({codecProfile:'native'});assert.deepEqual(a.prefix,b.prefix);assert.deepEqual(a.suffix,b.suffix);assert.deepEqual(a.supportedCodecs,['none','gzip','deflate']);assert.equal(a.decoderIntegrity,undefined);
 for(const codecProfile of ['brotli-js','lzma-js','brotli-lzma-js']){
  const first=await buildCompactInlineKeelShell({codecProfile}),second=await buildCompactInlineKeelShell({codecProfile});assert.deepEqual(first.suffix,second.suffix);assert.ok(first.decoderIntegrity);assert.ok(first.suffix.length>b.suffix.length);assert.equal(first.supportedCodecs.includes('brotli'),codecProfile!=='lzma-js');assert.equal(first.supportedCodecs.includes('lzma'),codecProfile!=='brotli-js');
 }
 await assert.rejects(buildCompactInlineKeelShell({codecProfile:'unknown'}),/profile/);
});
test('LZMA slot build verifies explicit packed data against exact original commitment',async()=>{
 const slot=await buildEmbeddedKeelViewerSlot({id:'object.data',role:'data',mediaType:'application/octet-stream',bytes:text,compression:'lzma',storedBytes:packed});assert.equal(slot.item.embedded.compression,'lzma');assert.equal(slot.item.integrity.byteLength,text.length);assert.equal(Buffer.from(slot.item.embedded.storedBase64,'base64').toString('hex'),packed.toString('hex'));
 await assert.rejects(buildEmbeddedKeelViewerSlot({id:'object.data',role:'data',mediaType:'application/octet-stream',bytes:Buffer.from('wrong'),compression:'lzma',storedBytes:packed}));
 await assert.rejects(buildEmbeddedKeelViewerSlot({id:'object.data',role:'data',mediaType:'application/octet-stream',bytes:text,compression:'lzma'}),/storedBytes/);
});
test('vendored attribution and content-pinned provenance match exact source files',async()=>{
 for(const codec of ['brotli','lzma']){
  const source=await readFile(new URL('../packages/sdk/src/decoders/vendor/'+codec+'.ts',import.meta.url));assert.equal(createHash('sha256').update(source).digest('hex'),KEEL_DECODER_PROVENANCE[codec].derivedSha256);assert.match(source.toString(),/Permission is hereby granted/);
 }
 const lzma=await buildKeelDecoderModule({codecs:['lzma']});assert.ok(lzma.javascriptBytes.length<20000);assert.match(lzma.javascript,/Nathan Rugg/);assert.doesNotMatch(lzma.javascript,/Brotli error code/);assert.doesNotMatch(lzma.javascript,/(?:^|[;{}\n])\s*onmessage\s*=/); // no global worker handler
});

test('host-only committed LZMA scan is exact and has the same dictionary/work bounds',()=>{
 assert.deepEqual(Buffer.from(decodeLzmaCommittedSync(packed,{decodedByteLength:text.length})),text);
 assert.throws(()=>decodeLzmaCommittedSync(packed,{decodedByteLength:text.length-1}));
 assert.throws(()=>decodeLzmaCommittedSync(packed,{decodedByteLength:text.length,maxWork:1}),/work/);
 assert.throws(()=>decodeLzmaCommittedSync(packed,{decodedByteLength:text.length,maxDecodedBytes:100}),/bounds/);
 assert.throws(()=>decodeLzmaCommittedSync(packed.subarray(0,packed.length-1),{decodedByteLength:text.length}),/truncated/);
 const oversized=Buffer.from(packed);oversized[4]=255;
 assert.throws(()=>decodeLzmaCommittedSync(oversized,{decodedByteLength:text.length}),/dictionary/);
});
