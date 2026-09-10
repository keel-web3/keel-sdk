import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFunctionData} from 'viem';
import {keelPauseBits,keelPausePresets,keelSystemPauseAbi,buildKeelPauseAction,buildKeelResumeAction,readKeelPauseState} from '../packages/sdk/dist/admin-pauses.js';
const manager='0x0000000000000000000000000000000000001234';
test('all mints combines only issuance bits',()=>{
 assert.equal(Object.entries(keelPauseBits).filter(([name])=>name.startsWith('mint')).reduce((mask,[,bit])=>mask|bit,0n),keelPausePresets.allMints);
 assert.equal(keelPausePresets.allMints&(keelPauseBits.viewers|keelPauseBits.chunking),0n);
});
test('admin stop and governance resume carry different authority and preserve the mask',()=>{
 const pause=buildKeelPauseAction(manager,keelPauseBits.chunking|keelPauseBits.viewers);
 assert.equal(pause.authorization,'admin');assert.deepEqual(decodeFunctionData({abi:keelSystemPauseAbi,data:pause.data}).args,[3n]);
 const resume=buildKeelResumeAction(manager,keelPauseBits.viewers,9n);
 assert.equal(resume.authorization,'governance');assert.deepEqual(decodeFunctionData({abi:keelSystemPauseAbi,data:resume.data}).args,[2n,9n]);
 assert.throws(()=>buildKeelPauseAction(manager,0n),/supported/);assert.throws(()=>buildKeelPauseAction(manager,1n<<100n),/supported/);
});
test('admin controls are read from a fresh block',async()=>{
 const client={getBlockNumber:async options=>{assert.equal(options.cacheTime,0);return 7n},readContract:async call=>{assert.equal(call.blockNumber,7n);return [keelPauseBits.viewers|keelPausePresets.allMints,3n]}};
 const state=await readKeelPauseState(client,manager);assert.equal(state.revision,3n);assert.equal(state.allMintsPaused,true);
 assert.equal(state.controls.find(c=>c.id==='viewers').paused,true);assert.equal(state.controls.find(c=>c.id==='chunking').paused,false);
});


test("local minter controls stay separate from the platform layer",async()=>{
  const sdk=await import("../packages/sdk/dist/admin-pauses.js");
  const target="0x0000000000000000000000000000000000000001";
  assert.equal(sdk.buildKeelMinterPauseAction(target,sdk.keelPauseBits.mintOne).authorization,"module-pause-role");
  assert.equal(sdk.buildKeelMinterResumeAction(target,sdk.keelPauseBits.mintOne,2n).authorization,"module-resume-role");
  assert.throws(()=>sdk.buildKeelMinterPauseAction(target,sdk.keelPauseBits.treasury),RangeError);
  const result=await sdk.readKeelMinterPauseState({getBlockNumber:async()=>3n,readContract:async request=>{
    assert.equal(request.blockNumber,3n);
    return request.functionName==="systemPauseState"?[sdk.keelPauseBits.mintOne,2n]:[sdk.keelPauseBits.mint721,4n];
  }},target,target);
  assert.equal(result.effectiveFlags,sdk.keelPauseBits.mintOne|sdk.keelPauseBits.mint721);
  assert.equal(result.platformRevision,2n);assert.equal(result.localRevision,4n);
});
