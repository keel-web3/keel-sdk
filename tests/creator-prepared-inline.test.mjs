import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeFunctionData } from 'viem';
import { prepareKeelCreatorInline, buildKeelCreatorPreparedCopyBindingCall, KEEL_CREATOR_PREPARED_COPY_ABI, decodeKeelPreparedDenseCopyFragment, inspectKeelInlinePayloadCarriage } from '../packages/sdk/dist/index.js';
const store='0xd820e337692a6eb7a4878e42ce88cbcff49b55cf';
const poster={mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')};
const resources=[{id:'game.html',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<!doctype html><p>Hello🔥</p><script src="game.js"></script>'+('<!--compression-->' .repeat(100)))},{id:'game.js',role:'module',mediaType:'text/javascript',bytes:Buffer.from('globalThis.gameReady=true;'.repeat(100))}];
test('creator files automatically become modular Brotli/Base90 COPY objects with exact table commitments',async()=>{
 const plan=await prepareKeelCreatorInline({chainId:11155111,store,resources,poster});
 assert.equal(plan.resources.length,2);assert.equal(plan.objects.length,8);assert.equal(plan.request.bodyObjectIds.length,6);
 for(const r of plan.resources){assert.equal(r.compression,'brotli');assert.equal(r.encoding,'base90-v1');assert.equal(r.encryption,'none');assert.ok(plan.objects.some(o=>o.objectId===r.carrier.objectId));assert.equal(r.binding.objectId,r.carrier.objectId);}
 const html=[plan.shell.prefix,...plan.objects.slice(0,6),plan.shell.suffix].map(o=>Buffer.from(decodeKeelPreparedDenseCopyFragment(o.bytes)).toString()).join('');
 const audit=inspectKeelInlinePayloadCarriage(Buffer.from(html));assert.equal(audit.payloadCount,2);assert.equal(audit.preparedDenseCopy.contractOperation,'verified-copy');
 assert.equal(plan.completeTokenURIBytes,null);assert.ok(plan.requiredGates.includes('keel-inline-publication-check'));
 const call=buildKeelCreatorPreparedCopyBindingCall({renderer:'0x'+'11'.repeat(20),collection:'0x'+'22'.repeat(20),tokenId:1n,plan});
 const decoded=decodeFunctionData({abi:KEEL_CREATOR_PREPARED_COPY_ABI,data:call.data});assert.equal(decoded.functionName,'bindPreparedTokenPresentation');assert.deepEqual(decoded.args[2].bodyObjectIds,plan.request.bodyObjectIds);
 const rows=plan.resources;assert.equal(plan.table.bytes.length,64+128*rows.length);for(let i=0;i<rows.length;i++)assert.equal('0x'+Buffer.from(plan.table.bytes).subarray(128+i*128,160+i*128).toString('hex'),rows[i].carrier.objectId);
});
test('missing or duplicate entrypoints, empty resources and unsupported bindings reject before publication',async()=>{
 for(const bad of [[],[resources[1]], [resources[0],resources[0]], [{...resources[0],bytes:new Uint8Array()}]])await assert.rejects(prepareKeelCreatorInline({chainId:11155111,store,resources:bad,poster}));
 await assert.rejects(prepareKeelCreatorInline({chainId:11155111,store,resources,poster,shellRevision:1n<<64n}));
});
test('address spelling cannot change registered shell bytes or container commitments',async()=>{
 const lower=await prepareKeelCreatorInline({chainId:11155111,store,resources,poster});
 const checksum=await prepareKeelCreatorInline({chainId:11155111,store:'0xD820e337692A6Eb7a4878e42ce88CBCFF49B55CF',resources,poster});
 assert.equal(lower.shell.prefix.objectId,checksum.shell.prefix.objectId);
 assert.equal(lower.shell.suffix.objectId,checksum.shell.suffix.objectId);
 assert.deepEqual(lower.request.bodyObjectIds,checksum.request.bodyObjectIds);
 assert.equal(lower.request.containerTableObjectId,checksum.request.containerTableObjectId);
});
