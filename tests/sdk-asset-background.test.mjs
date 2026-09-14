import test from 'node:test';
import assert from 'node:assert/strict';
import {keelAssetBackground} from '../packages/sdk/dist/asset-display.js';
const pixels=(...rows)=>rows.flat();
test('metadata color wins and unsafe or invalid values do not become CSS',()=>{assert.equal(keelAssetBackground('AABBCC',[]),'#aabbcc');assert.equal(keelAssetBackground('#383e7b',[]),'#383e7b');assert.equal(keelAssetBackground('url(https://example.com)',[]),'#05060b');});
test('dominant opaque border determines surround without using transparent pixel RGB',()=>{assert.equal(keelAssetBackground(null,pixels(...Array(7).fill([56,62,123,255]),...Array(3).fill([0,0,0,255]))),'#383e7b');assert.equal(keelAssetBackground(null,pixels(...Array(10).fill([255,255,255,0]))),'#05060b');});
test('busy or mostly transparent edges retain a neutral surround',()=>{assert.equal(keelAssetBackground(null,pixels(...Array(5).fill([56,62,123,255]),...Array(5).fill([120,230,60,255]))),'#05060b');assert.equal(keelAssetBackground(null,pixels(...Array(3).fill([56,62,123,255]),...Array(7).fill([0,0,0,0]))),'#05060b');});
test('normal media commits an explicit metadata background and rejects invalid CSS',async()=>{
 const {buildKeelInlineShellFragments,buildKeelInlineNormalMediaDocument}=await import('../packages/sdk/dist/inline-viewer-graph.js');
 const shell=await buildKeelInlineShellFragments();
 const asset={id:'image.png',mediaType:'image/png',source:new Uint8Array([1,2,3]),backgroundColor:'#383E7B'};
 const doc=await buildKeelInlineNormalMediaDocument({shell,asset});
 assert.match(new TextDecoder().decode(doc.parts[2].bytes),/"backgroundColor":"383e7b"/);
 await assert.rejects(()=>buildKeelInlineNormalMediaDocument({shell,asset:{...asset,backgroundColor:'red;display:none'}}),/six hex digits/);
});
