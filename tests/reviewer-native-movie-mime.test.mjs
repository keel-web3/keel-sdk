import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,decodeKeelInlineGraphFragment,buildKeelInlineRawPercentTokenURIGraph,buildKeelPreparedOneOfOneTokenURI} from '../packages/sdk/dist/inline-viewer-graph.js';
import {createKeelRegisteredNativeGzipProof,assertKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE as p} from '../packages/sdk/dist/registered-native-gzip.js';
import {inspectKeelInlinePayloadCarriage,assertKeelFreshPayloadCarriage,assertKeelFreshPayloadAudit,auditKeelInlineTokenURI} from '../packages/sdk/dist/inline-transport-audit.js';
import {createKeelPublishReviewPlan,verifyKeelPublishReviewPlan} from '../packages/sdk/dist/publish-plan.js';
import {inferMediaType,normalizeAssets} from '../packages/studio-core/dist/media.js';
import {keelAssetDisplayKind} from '../packages/sdk/dist/asset-display.js';
const hash=b=>'0x'+createHash('sha256').update(b).digest('hex');
const integrity=b=>({algorithm:'sha256',digest:hash(b),byteLength:b.length});
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const half=side=>{const bytes=decodeKeelInlineGraphFragment(Buffer.from(fixture.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');assert.equal(bytes.length,p[side+'ByteLength']);assert.equal(hash(bytes),p[side+'Digest']);return{bytes,integrity:integrity(bytes)}};
const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:half('prefix'),suffix:half('suffix')};
const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(k=>[k,p[k]]));
Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
const mp4=readFileSync(new URL('./fixtures/registered-native-none/normal-artwork.mp4',import.meta.url));
assert.equal(mp4.length,1786);assert.equal(hash(mp4),'0xa421a05635b124a135c770d3c9cc814c515cfcdaa4a7b3e68f24a332033e5561');
const displaySource=readFileSync(new URL('./fixtures/asset-display-1.1.0.js',import.meta.url));
assert.equal(displaySource.length,6172);assert.equal(hash(displaySource),'0x53957405312b1fe3b187a5c49b13d13a08fd6e960953c815c6e49b53637d97f4');
const display=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.1.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:displaySource,execution:'classic',phase:'render',weight:0,compression:'gzip'});
async function document(source=mp4,mediaType='video/mp4') {return buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'artwork.mp4',mediaType,source}})}
const proof=root=>createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});
const entries=root=>JSON.parse('[null'+Buffer.from(root.rootBytes).toString().slice(p.prefixByteLength,-p.suffixByteLength)+']').slice(1);
const fromEntries=items=>({rootBytes:Buffer.concat([shell.prefix.bytes,Buffer.from(items.map(item=>','+JSON.stringify(item).replaceAll('<','\\u003c')).join('')),shell.suffix.bytes])});
function changeSource(item,bytes) {item.integrity=integrity(bytes);item.embedded={compression:'none',storedBase64:Buffer.from(bytes).toString('base64'),storedIntegrity:integrity(bytes)}}
async function assetDocument(source,mediaType) {return buildKeelInlineLocalDocument({shell,modules:[display],assets:[{id:'native-original',role:'asset',mediaType,source,compression:'none'}],entry:{id:'probe.html',mediaType:'text/html',source:Buffer.from('<!doctype html><html><body>verified original asset</body></html>'),compression:'gzip'}})}

const m4v=readFileSync(new URL('./fixtures/registered-native-none/normal-artwork.m4v',import.meta.url));
assert.equal(hash(m4v),'0xeb417767725dbb6fc81fd5e88313f1c2d2a6e91206d2bc8d88075854d5d2f719');
const mutations={
 'compatible image brand':b=>{b.write('avif',16)},
 'QuickTime major brand':b=>{b.write('qt  ',8)},
 'zero geometry':b=>{const at=b.indexOf('avc1',b.indexOf('stsd'));assert.ok(at>0);b.writeUInt16BE(0,at+28)},
 'wrong timing total':b=>{const at=b.indexOf('stts');assert.ok(at>0);b.writeUInt32BE(999,at+12)},
 'sample outside mdat':b=>{const at=b.indexOf('stco');assert.ok(at>0);b.writeUInt32BE(b.length+8,at+12)},
 'external fragment':b=>{b.write('moof',b.indexOf('mdat'))},
};
for(const compression of ['none','gzip']) {
 for(const [name,mutate] of Object.entries(mutations))test(`independent M4V ${compression} rejects ${name}`,async()=>{
  const bytes=Buffer.from(m4v);mutate(bytes);
  const root=await buildKeelInlineLocalDocument({shell,modules:[display],entry:{id:'original.m4v',mediaType:'video/x-m4v',source:bytes,compression}});
  assert.throws(()=>proof(root));
 });
 test(`independent M4V ${compression} role/source survives nonzero byte offset`,async()=>{
  const backing=Buffer.concat([Buffer.from('prefix'),m4v,Buffer.from('suffix')]);const source=backing.subarray(6,-6);
  assert.deepEqual(source,m4v);
  const root=await buildKeelInlineLocalDocument({shell,modules:[display],assets:[{id:'original',role:'asset',mediaType:'video/x-m4v',source,compression}],entry:{id:'index.html',mediaType:'text/html',source:Buffer.from('<!doctype html><p>actual retained original asset</p>'),compression:'gzip'}});
  const item=entries(root).find(item=>item.id==='original');const stored=Buffer.from(item.embedded.storedBase64,'base64');
  assert.deepEqual(compression==='gzip'?gunzipSync(stored):stored,m4v);assert.deepEqual(item.integrity,integrity(m4v));assert.doesNotThrow(()=>proof(root));
 });
}
test('independent MIME inference preserves explicit creator declaration and bytes',()=>{
 for(const fileName of ['ART.M4V','art.m4v','original.MOV']){
  const declared='video/webm';const n=normalizeAssets([{fileName,mediaType:declared,bytes:m4v}])[0];assert.equal(n.mediaType,declared);assert.deepEqual(n.bytes,m4v);
 }
 assert.equal(inferMediaType('ART.M4V','application/octet-stream'),'video/x-m4v');assert.equal(inferMediaType('ORIGINAL.MOV'),'video/quicktime');
});
