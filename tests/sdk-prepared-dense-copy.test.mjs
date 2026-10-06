import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';
import {buildKeelPreparedDenseCopyShell,prepareKeelDensePayload,prepareKeelDenseCopyFragment,decodeKeelDenseTransport,decodeKeelPreparedDenseCopyFragment,inspectKeelInlinePayloadCarriage,inspectKeelPreparedDenseCopyDocument,assertKeelFreshPayloadCarriage,assertKeelFreshPayloadAudit,encodeKeelDenseTransport,serializeKeelDenseTransportJSON,toKeelDenseTransportDataURL,decodeKeelInlineDataURI} from '../packages/sdk/dist/index.js';
const sha=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');
const delivery={chainId:11155111,store:'0x1111111111111111111111111111111111111111'};
test('COPY fragment preparation round-trips URI-valid characters rejected by deployed older readers',()=>{
 const source='? & \' " # % 🔥 </script>';
 const prepared=prepareKeelDenseCopyFragment(source);
 assert.doesNotMatch(Buffer.from(prepared).toString(),/[?&']/);
 assert.equal(Buffer.from(decodeKeelPreparedDenseCopyFragment(prepared)).toString(),source);
});
test('fresh preparation compresses with Brotli before Base90 and nested escaping; incompressible and explicit none stay uncompressed',async()=>{
 const {brotliDecompressSync}=await import('node:zlib');
 const source=Buffer.from('Hello world🔥%#"</script>\0'.repeat(100));
 const prepared=prepareKeelDensePayload(source);
 assert.equal(prepared.compression,'brotli');assert.equal(prepared.transportProfile,'base90-v1');
 assert.ok(prepared.compressedBytes.length<source.length);
 const json=Buffer.from(decodeKeelPreparedDenseCopyFragment(prepared.preparedBytes)).toString();
 const dense=JSON.parse('"'+json+'"');assert.equal(dense,prepared.storedDense);
 const bytes=decodeKeelDenseTransport(dense,{profile:prepared.transportProfile,byteLength:prepared.storedIntegrity.byteLength});
 assert.deepEqual(brotliDecompressSync(bytes),source);assert.equal(sha(bytes),prepared.storedIntegrity.digest);
 assert.equal(sha(prepared.preparedBytes),prepared.preparedIntegrity.digest);assert.equal(sha(source),prepared.decodedIntegrity.digest);
 assert.equal(prepareKeelDensePayload(randomBytes(4096)).compression,'none');
 const raw=prepareKeelDensePayload(source,{compression:'none'});assert.equal(raw.compression,'none');assert.deepEqual(Buffer.from(raw.compressedBytes),source);
 assert.throws(()=>prepareKeelDensePayload(source,{compression:'gzip'}),/compression/);
});
async function fixture(carriage='base90'){
 const shell=await buildKeelPreparedDenseCopyShell({codecProfile:'lzma-js',embeddedContainerDelivery:delivery,binaryPayloadCarriage:carriage});const profile={base90:'base90-v1',base91:'base91-v1','base90-block':'base90-block-v2',uri81:'uri81-block-v1'}[carriage];
 const bytes=randomBytes(4096),pack={containerId:'0x'+'22'.repeat(32),objectId:'0x'+'33'.repeat(32),storedIntegrity:{algorithm:'sha256',digest:sha(bytes),byteLength:bytes.length},storedDense:encodeKeelDenseTransport(bytes,profile)};
 const item={id:'example',onchain:{containerId:pack.containerId,offset:0}};
 const body=Buffer.from(shell.prefix).toString()+serializeKeelDenseTransportJSON(pack)+Buffer.from(shell.containerBridge).toString()+','+serializeKeelDenseTransportJSON(item)+Buffer.from(shell.suffix).toString();return{shell,bytes,profile,pack,body};
}
test('prepared dense shell defaults to escaped Base90 and rejects incompatible explicit choices',async()=>{
 const shell=await buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:delivery});assert.equal(shell.payloadPreparation,'build-time');assert.equal(shell.contractOperation,'verified-copy');assert.equal(shell.resourceProfile,'embedded-shared-containers-base90@1');assert.equal(shell.shellBootEncoding,'base64');assert.equal(shell.codecProfile,'brotli-js');assert.ok(shell.supportedCodecs.includes('brotli'));
 for(const binaryPayloadCarriage of ['as-is','base64'])await assert.rejects(buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:delivery,binaryPayloadCarriage}),/dense payload format/);
});
for(const carriage of ['base90','base91','base90-block','uri81'])test(`${carriage}: inspect literal shell framing and exact packed commitments without execution`,async()=>{
 const f=await fixture(carriage),unwrapped=inspectKeelPreparedDenseCopyDocument(f.body);assert.equal(unwrapped.transportProfile,f.profile);assert.match(unwrapped.html,/globalThis\.__KEEL_EMBEDDED_CONTAINERS__/);const audit=inspectKeelInlinePayloadCarriage(Buffer.from(f.body));assert.equal(audit.payloadCount,1);assert.equal(audit.packedPayloadBytes,f.bytes.length);assert.equal(audit.payloads[0].encoding,'dense');assert.equal(audit.preparedDenseCopy.contractOperation,'verified-copy');assertKeelFreshPayloadCarriage(Buffer.from(f.body));assertKeelFreshPayloadAudit(audit);
 const changed=f.body.replace(f.pack.storedIntegrity.digest,'0x'+'00'.repeat(32));assert.throws(()=>inspectKeelInlinePayloadCarriage(Buffer.from(changed)),/stored commitment/);
 const invalid=structuredClone(audit);invalid.preparedDenseCopy.payloadPreparation='read-time';assert.throws(()=>assertKeelFreshPayloadAudit(invalid),/prepared dense COPY audit/);
});
test('question marks and following markup survive both URL parsers byte for byte',async()=>{
 const text='before?after< > " # % & `\n🔥';const html=toKeelDenseTransportDataURL('html',text);assert.equal(await(await fetch(new URL(html).href)).text(),text);
 const uri=toKeelDenseTransportDataURL('metadata',JSON.stringify({animation_url:html,name:'name?'}));const metadata=JSON.parse(await(await fetch(uri)).text());assert.equal(metadata.animation_url,html);assert.equal(await(await fetch(metadata.animation_url)).text(),text);
});
test('prepared body is readable through standard metadata and HTML data URIs',async()=>{
 const f=await fixture(),animation=toKeelDenseTransportDataURL('html',f.body),uri=toKeelDenseTransportDataURL('metadata',JSON.stringify({animation_url:animation}));const metadata=JSON.parse(await(await fetch(uri)).text());const body=await(await fetch(new URL(metadata.animation_url).href)).text();assert.equal(body,f.body);assert.equal(inspectKeelInlinePayloadCarriage(Buffer.from(body)).packedPayloadBytes,4096);
});


test('gzip shell boot restores the exact canonical document in a browser-compatible environment',async()=>{
 const {runInNewContext}=await import('node:vm');
 const f=await fixture();const expected=inspectKeelPreparedDenseCopyDocument(f.body).html;
 let task,actual;const document={open(){},write(value){actual=value},close(){}};
 const start=f.body.indexOf('<script>')+8,end=f.body.lastIndexOf('</script>');
 runInNewContext(f.body.slice(start,end),{document,queueMicrotask:fn=>{task=fn()},TextDecoder,Uint8Array,atob,Blob,Response,DecompressionStream});await task;
 assert.equal(actual,expected);assert.equal(f.shell.shellBootCompression,'gzip');
 const raw=await buildKeelPreparedDenseCopyShell({codecProfile:'lzma-js',embeddedContainerDelivery:delivery,shellBootCompression:'none'});
 assert.ok(f.shell.suffix.length<raw.suffix.length/2);assert.equal(raw.shellBootCompression,'none');
 await assert.rejects(buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:delivery,shellBootCompression:'brotli'}),/boot compression/);
});

test('publication inspection accepts byte-preserving query normalization and rejects byte loss',()=>{
 const text='prefix?quoted "markup" <b>💧</b> # %';const uri=toKeelDenseTransportDataURL('html',text);
 assert.equal(new TextDecoder().decode(decodeKeelInlineDataURI(uri,'text/html')),text);
 assert.throws(()=>decodeKeelInlineDataURI('data:text/html,tab\tstripped','text/html'),/normalization/);
 assert.throws(()=>decodeKeelInlineDataURI('data:text/html,fragment#lost','text/html'),/fragment/);
});

test('prepared fragment decodes JSON escapes and both percent layers exactly',async()=>{
 const {decodeKeelPreparedDenseCopyFragment}=await import('../packages/sdk/dist/index.js');
 const text='<script>const q="? < > # % 💧";</script>';
 const inner=toKeelDenseTransportDataURL('html',text).split(',').slice(1).join(',');
 const middle=JSON.stringify(inner).slice(1,-1);
 const outer=toKeelDenseTransportDataURL('metadata',middle).split(',').slice(1).join(',');
 assert.equal(Buffer.from(decodeKeelPreparedDenseCopyFragment(Buffer.from(outer))).toString(),text);
 for(const bad of ['space here','#','%aF','%','%0','%GG','%FF'])assert.throws(()=>decodeKeelPreparedDenseCopyFragment(Buffer.from(bad)));
});
