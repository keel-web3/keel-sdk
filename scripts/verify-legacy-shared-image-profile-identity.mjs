import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildCompactInlineKeelShell} from '../packages/sdk/dist/verification-shell.js';
import {buildKeelPreparedDenseCopyShell} from '../packages/sdk/dist/prepared-dense-copy.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const previous=process.env.KEEL_LEGACY_SHARED_IMAGE_BASELINE_SDK;
const delivery={chainId:11155111,store:'0x'+'11'.repeat(20)};
test('six existing canonical/legacy profile byte commitments remain identical to qualified baseline',async()=>{
 assert.ok(previous,'An explicit unchanged qualified SDK baseline is required');
 const old=await import(pathToFileURL(resolve(previous,'packages/sdk/dist/verification-shell.js')));
 const dense=await import(pathToFileURL(resolve(previous,'packages/sdk/dist/prepared-dense-copy.js')));
 const profiles=[['native',{codecProfile:'native'}],['brotli',{codecProfile:'brotli-js'}],['lzma',{codecProfile:'lzma-js'}],['embedded-base90',{codecProfile:'brotli-js',embeddedContainerDelivery:delivery,binaryPayloadCarriage:'base90'}],['legacy-dense-gzip',{legacyPreparedDenseDelivery:{chainId:11155111},shellBootCompression:'gzip'}],['legacy-dense-none',{legacyPreparedDenseDelivery:{chainId:11155111},shellBootCompression:'none'}]];
 const proof=[];
 for(const[name,options]of profiles){
  const legacy=name.startsWith('legacy-');
  const before=await(legacy?dense.buildKeelPreparedDenseCopyShell:old.buildCompactInlineKeelShell)(options);
  const after=await(legacy?buildKeelPreparedDenseCopyShell:buildCompactInlineKeelShell)(options);
  const parts={};for(const part of ['prefix','containerBridge','suffix'])if(before[part]||after[part]){assert.deepEqual(Buffer.from(after[part]),Buffer.from(before[part]),name+' '+part);parts[part]={bytes:after[part].length,sha256:sha(after[part])};}
  proof.push({profile:name,parts});
 }
 console.log(JSON.stringify({schema:'keel-existing-six-profile-identity@1',baselineSDK:previous,profiles:proof}));
});
