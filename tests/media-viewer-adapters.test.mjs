import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {KEEL_ASSET_DISPLAY_MODULE_ID,KEEL_ASSET_DISPLAY_MODULE_VERSION,keelAssetDisplayModuleBytes,keelAssetDisplayModuleRevision} from '../packages/sdk/dist/asset-display.js';
import {KEEL_NATIVE_RASTER_VIEWER_ADAPTER,qualifyKeelNativeRasterViewer} from '../packages/sdk/dist/media-viewer-adapters.js';
const animatedWebp=new Uint8Array(await readFile(new URL('./fixtures/media-viewers/animation.webp',import.meta.url))),stillWebp=new Uint8Array(await readFile(new URL('./fixtures/media-viewers/still.webp',import.meta.url))),animatedAvif=new Uint8Array(await readFile(new URL('./fixtures/media-viewers/animation.avif',import.meta.url)));
const images={'image/gif':new Uint8Array(await readFile(new URL('./fixtures/media-viewers/animation.gif',import.meta.url))),'image/png':new Uint8Array(await readFile(new URL('./fixtures/media-viewers/still.png',import.meta.url))),'image/jpeg':new Uint8Array(await readFile(new URL('./fixtures/media-viewers/still.jpg',import.meta.url)))};
const profile=(version=KEEL_ASSET_DISPLAY_MODULE_VERSION,mediaType='image/webp',source=animatedWebp)=>({moduleId:KEEL_ASSET_DISPLAY_MODULE_ID,version,...keelAssetDisplayModuleRevision(version),mediaType,source});
test('native raster adapter authenticates its exact animation-capable decoded module bytes',()=>{
 const bytes=keelAssetDisplayModuleBytes(),record=keelAssetDisplayModuleRevision(KEEL_ASSET_DISPLAY_MODULE_VERSION);
 assert.equal(bytes.length,record.byteLength);assert.equal('0x'+createHash('sha256').update(bytes).digest('hex'),record.digest);
 assert.equal(qualifyKeelNativeRasterViewer(profile()).version,'1.4.0');assert.deepEqual(KEEL_NATIVE_RASTER_VIEWER_ADAPTER.dependencies,[]);
});
test('native animation profile preserves existing catalog GIF, PNG and JPEG routes without a Three dependency',()=>{
 for(const version of ['1.1.0','1.2.0','1.3.0','1.4.0'])for(const mime of ['image/gif','image/png','image/jpeg']){
  const adapter=qualifyKeelNativeRasterViewer(profile(version,mime,images[mime]));assert.equal(adapter.version,version);assert.deepEqual(adapter.dependencies,[]);
 }
});
test('older draw-once WebP/AVIF cannot be reused for actually animated or inconclusive source bytes',()=>{
 for(const version of ['1.1.0','1.2.0']){
  for(const mime of ['image/webp','image/avif'])assert.throws(()=>qualifyKeelNativeRasterViewer(profile(version,mime,mime==='image/webp'?animatedWebp:animatedAvif)),/would change the work/);
  assert.throws(()=>qualifyKeelNativeRasterViewer(profile(version,'image/webp',new Uint8Array([1,2,3]))),/would change the work/);
  assert.equal(qualifyKeelNativeRasterViewer(profile(version,'image/webp',stillWebp)).version,version);
 }
 for(const mime of ['image/webp','image/avif'])assert.equal(qualifyKeelNativeRasterViewer(profile('1.3.0',mime,mime==='image/webp'?animatedWebp:animatedAvif)).version,'1.3.0');
});
test('altered module identity, bytes or version never establishes native-media compatibility',()=>{
 for(const changed of [{moduleId:'creator-image-copy'},{version:'3.0.0'},{digest:'0x'+'00'.repeat(32)},{byteLength:1}])assert.throws(()=>qualifyKeelNativeRasterViewer({...profile(),...changed}),/exact animation-capable/);
});
test('artwork category cannot imply unsupported audio, executable SVG or model playback',()=>{
 for(const mediaType of ['Artwork','image/svg+xml','audio/mpeg','model/gltf-binary','model/gltf+json','model/obj'])assert.throws(()=>qualifyKeelNativeRasterViewer({...profile(),mediaType}),/does not support/);
});
