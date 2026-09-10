import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeErrorResult,toFunctionSelector} from 'viem';
import {keelHoldErrorsAbi,decodeKeelHoldError} from '../packages/sdk/dist/hold-errors.js';

test('Hold errors have one declaration per signature and unchanged wire selectors',()=>{
 const signatures=keelHoldErrorsAbi.map(e=>`${e.name}(${e.inputs.map(i=>i.type).join(',')})`);
 assert.equal(new Set(signatures).size,signatures.length);
 assert.equal(new Set(signatures.map(toFunctionSelector)).size,signatures.length,'error selectors must not collide');
 assert.equal(signatures.filter(s=>s==='FeeTransferFailed()').length,1);
 for(const signature of ['ObjectMissing(bytes32)','SliceOutOfBounds()','ReadDepthExceeded()','UnauthorizedGovernance()','FeeTransferFailed()'])assert.ok(signatures.includes(signature));
 const data=encodeErrorResult({abi:keelHoldErrorsAbi,errorName:'TooManyChildren',args:[129n,128n]});
 assert.equal(data.slice(0,10),toFunctionSelector('TooManyChildren(uint256,uint256)'));
 const decoded=decodeKeelHoldError(data);
 assert.equal(decoded.errorName,'TooManyChildren');assert.deepEqual(decoded.args,[129n,128n]);
});

test('the shared decoder preserves object IDs and distinguishes permission and payment failures',()=>{
 const objectId=`0x${'ab'.repeat(32)}`;
 const missing=decodeKeelHoldError(encodeErrorResult({abi:keelHoldErrorsAbi,errorName:'ObjectMissing',args:[objectId]}));
 assert.deepEqual(missing.args,[objectId]);
 for(const errorName of ['UnauthorizedGovernance','UnauthorizedUploader','FeeTransferFailed']) {
   assert.equal(decodeKeelHoldError(encodeErrorResult({abi:keelHoldErrorsAbi,errorName})).errorName,errorName);
 }
});

test('malformed and unknown revert data are left to the calling application',()=>{
 for(const data of ['0x','0x01','0xffffffff','0xgggggggg'])assert.equal(decodeKeelHoldError(data),null);
 const truncated=toFunctionSelector('ObjectMissing(bytes32)');
 assert.equal(decodeKeelHoldError(truncated),null);
});
