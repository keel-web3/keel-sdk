import test from 'node:test';
import assert from 'node:assert/strict';
import {buildKeelMintRewardSeedProfile,buildKeelCreatorSeedProfile} from '../packages/sdk/dist/creator-collections.js';
const archive='0x0000000000000000000000000000000000000001',provider='0x0000000000000000000000000000000000000002',zero='0x0000000000000000000000000000000000000000';
test('reward and creator profiles use the same future-block default',()=>{
 const profile=buildKeelMintRewardSeedProfile({archive});assert.equal(profile.futureBlockDelay,buildKeelCreatorSeedProfile().futureBlockDelay);assert.equal(profile.provider,zero);assert.equal(profile.archive,archive);
 assert.equal(buildKeelMintRewardSeedProfile({archive,futureBlockDelay:2}).futureBlockDelay,'2');
});
test('shared providers do not create a second block or funding configuration',()=>{
 assert.deepEqual(buildKeelMintRewardSeedProfile({provider}),{provider,archive:zero,futureBlockDelay:'0'});
 assert.throws(()=>buildKeelMintRewardSeedProfile({provider,archive}));assert.throws(()=>buildKeelMintRewardSeedProfile({provider,futureBlockDelay:1}));
});
test('missing or invalid seed settings fail before a deployment is encoded',()=>{
 assert.throws(()=>buildKeelMintRewardSeedProfile({}));assert.throws(()=>buildKeelMintRewardSeedProfile({archive,futureBlockDelay:0}));assert.throws(()=>buildKeelMintRewardSeedProfile({archive,futureBlockDelay:2n**32n}));
});
