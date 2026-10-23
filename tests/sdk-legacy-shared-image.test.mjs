import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAbiParameters,encodeAbiParameters,hexToBytes} from 'viem';
import {buildKeelLegacyPreparedDenseDocument,readKeelLegacyPreparedDenseSources} from '../packages/sdk/dist/legacy-prepared-dense-copy.js';
import {encodeKeelLegacySharedImageCopyProgram,readKeelLegacySharedImageCopyProgram} from '../packages/sdk/dist/legacy-shared-image-program.js';
import {replaceKeelSharedImageCSSAliases} from '../packages/sdk/dist/legacy-shared-image-reader.js';
import {sharedFixture,poster,sha} from './support/legacy-shared-image-fixture.mjs';

test('retired shared-image constructor rejects the unchanged original fixture',async()=>{
 await assert.rejects(sharedFixture(),/retired for fresh publication/);
});

test('retired program encoding cannot bypass registration or source integrity with malformed inputs',()=>{
 for(const input of [{},{graph:{},sharedCollectorImage:{},imageObjectId:'0x'+'ff'.repeat(32),fragments:[]}])assert.throws(()=>encodeKeelLegacySharedImageCopyProgram(input),/retired for fresh publication/);
});

test('CSS url grammar handles escaped filenames, quotes and escaped parentheses without changing unrelated text',()=>{
 const aliases=new Map([['poster.png',()=> 'data:image/png;base64,AA=='],['p)oster.png',()=> 'data:image/png;base64,AQ==']]);
 for(const text of ['url("p\\6f ster.png")',"url('p\\00006fster.png')",'url(p\\6f ster.png)'])assert.equal(replaceKeelSharedImageCSSAliases(text,aliases),'url("data:image/png;base64,AA==")');
 assert.equal(replaceKeelSharedImageCSSAliases('url(p\\)oster.png)',aliases),'url("data:image/png;base64,AQ==")');
 assert.equal(replaceKeelSharedImageCSSAliases('untouched p\\6f ster.png',aliases),'untouched p\\6f ster.png');
});
test('explicit Raw/compressed image choices and unsupported metadata bindings remain explicit',async()=>{
 const resources=[{id:'i',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<p>x</p>')},{id:'p',role:'asset',mediaType:'image/png',bytes:poster}];
 for(const options of [{payloadStorage:'raw'},{compression:'brotli'},{sharedCollectorImageResourceId:'missing'}])await assert.rejects(buildKeelLegacyPreparedDenseDocument({chainId:11155111,entryId:'i',resources,sharedCollectorImageResourceId:'p',...options}));
});
