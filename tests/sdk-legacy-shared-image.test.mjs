import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAbiParameters,encodeAbiParameters,hexToBytes} from 'viem';
import {buildKeelLegacyPreparedDenseDocument,readKeelLegacyPreparedDenseSources} from '../packages/sdk/dist/legacy-prepared-dense-copy.js';
import {encodeKeelLegacySharedImageCopyProgram,readKeelLegacySharedImageCopyProgram} from '../packages/sdk/dist/legacy-shared-image-program.js';
import {replaceKeelSharedImageCSSAliases} from '../packages/sdk/dist/legacy-shared-image-reader.js';
import {sharedFixture,poster,sha} from './support/legacy-shared-image-fixture.mjs';

test('shared native image program retains the exact complete original resource table and stores image payload once',async()=>{
 const f=await sharedFixture();const replay=await readKeelLegacySharedImageCopyProgram({bytes:f.program.bytes,readObject:async id=>f.objects.get(id).bytes});
 assert.deepEqual(Buffer.from(replay.bytes),Buffer.from(f.graph.fragmentBytes));
 const sources=await readKeelLegacyPreparedDenseSources({htmlBytes:f.built.document.rootBytes});
 assert.deepEqual(sources.resources.map(({id,aliases,role,mediaType,bytes})=>({id,aliases,role,mediaType,bytes:Buffer.from(bytes)})),f.resources.map(r=>({...r,bytes:Buffer.from(r.bytes)})));
 assert.equal(f.program.storage.nativeImagePayloadBytes,poster.length);assert.equal(f.program.storage.encodedImagePayloadBytes,0);
 assert.equal([...f.objects.values()].filter(x=>sha(x.bytes)===sha(poster)).length,1);
 assert.ok([...f.objects.values()].every(x=>!Buffer.from(x.bytes).includes(Buffer.from(poster.toString('base64')))));
 assert.ok(f.graph.parts.length<=64);assert.equal(f.built.optimization.leafDecodedBytes,512*1024);
});
test('encoded image upload, unknown image binding and tampered source objects fail closed',async()=>{
 const f=await sharedFixture();
 const bad=[...f.fragments];bad[f.program.imagePartIndex]={objectId:f.imageObjectId,digest:sha(poster)};
 assert.throws(()=>encodeKeelLegacySharedImageCopyProgram({graph:f.graph,sharedCollectorImage:f.built.sharedCollectorImage,imageObjectId:f.imageObjectId,fragments:bad}),/binding/);
 await assert.rejects(readKeelLegacySharedImageCopyProgram({bytes:f.program.bytes,readObject:async id=>id===f.imageObjectId?Buffer.from('tampered'):f.objects.get(id).bytes}),/SHA-256/);
 const p=[{type:'bytes32'},{type:'uint256'},{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'bytes32[]'},{type:'bytes32[]'},{type:'uint8[]'}];
 const fields=[...decodeAbiParameters(p,'0x'+Buffer.from(f.program.bytes).toString('hex'))];fields[3]='0x'+'ff'.repeat(32);
 await assert.rejects(readKeelLegacySharedImageCopyProgram({bytes:hexToBytes(encodeAbiParameters(p,fields)),readObject:async id=>f.objects.get(id).bytes}),/Unknown shared image/);
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
