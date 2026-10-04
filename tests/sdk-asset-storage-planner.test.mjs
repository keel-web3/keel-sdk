import test from 'node:test';
import assert from 'node:assert/strict';
import {planCreatorAssetStorage} from '../packages/sdk/dist/engine.js';
const digest='0x'+'ab'.repeat(32);
test('artists receive a measured lossless choice without selecting a codec',()=>{
 const [a]=planCreatorAssetStorage([{id:'painting.png',digest,options:[
 {kind:'raw',verified:true,lossless:true,totalGas:100n},
 {kind:'brotli',verified:false,lossless:true,totalGas:1n},
 {kind:'gzip',verified:true,lossless:true,totalGas:50n}]}]);
 assert.equal(a.selected.kind,'gzip');assert.equal(a.preserveOriginal,true);
});
test('verified existing objects win equal-cost choices and retain identity',()=>{
 const [a]=planCreatorAssetStorage([{id:'style.css',digest,options:[
 {kind:'raw',verified:true,lossless:true,totalGas:10n},
 {kind:'existing',verified:true,lossless:true,totalGas:10n,objectId:'0x'+'cd'.repeat(32)}]}]);
 assert.equal(a.selected.kind,'existing');assert.equal(a.id,'style.css');
});
test('missing measurements never masquerade as a free upload',()=>{
 assert.equal(planCreatorAssetStorage([{id:'image',digest,options:[]}])[0].status,'measurement-required');
 assert.throws(()=>planCreatorAssetStorage([{id:'image',digest,options:[{kind:'raw',verified:true,lossless:true,totalGas:-1n}]}]));
});
