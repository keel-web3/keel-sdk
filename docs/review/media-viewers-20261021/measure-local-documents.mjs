import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildKeelInlineShellFragments,buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,buildKeelInlineNormalMediaDocument} from '../../../packages/sdk/dist/inline-viewer-graph.js';
import {keelAssetDisplayModuleBytes} from '../../../packages/sdk/dist/asset-display.js';
const sha=b=>createHash('sha256').update(b).digest('hex'),base=await readFile(new URL('./evidence/baseline-asset-display-1.2.0.js',import.meta.url)),current=keelAssetDisplayModuleBytes();
assert.equal(sha(base),'9db2505b726d6c0b9821ce2c90df96c4e37b6c1607fe4dd565f883b3531bed8b');assert.equal(sha(current),'4f88f47a332061125a3a6a0133d2a70f5b6d641c4d0c84dd7c0302626f8034dc');
const shell=await buildKeelInlineShellFragments({repositoryRoot:process.cwd()}),rows=[];
for(const format of ['webp','avif']){
 const source=await readFile(new URL(`../../../tests/fixtures/media-viewers/animation.${format}`,import.meta.url)),entry={id:'original-artwork',mediaType:`image/${format}`,source};
 const oldModule=await buildKeelInlineModuleFragment({moduleId:'keel.asset-display',version:'1.2.0',mediaType:'text/javascript',aliases:['keel.asset-display'],decodedBytes:base,compression:'none',execution:'classic',phase:'render'});
 const before=await buildKeelInlineLocalDocument({shell,modules:[oldModule],entry}),after=await buildKeelInlineNormalMediaDocument({shell,asset:entry});
 assert.equal(before.parts.length,after.parts.length);assert.equal(before.parts.filter(p=>p.role==='module').length,1);assert.equal(after.parts.filter(p=>p.role==='module').length,1);
 const beforeEntry=before.parts.find(p=>p.kind==='creator'&&p.role==='entrypoint'),afterEntry=after.parts.find(p=>p.kind==='creator'&&p.role==='entrypoint');assert.deepEqual(beforeEntry.bytes,afterEntry.bytes);
 rows.push({format,input:{bytes:source.length,sha256:sha(source)},before:{version:'1.2.0',decodedModuleBytes:base.length,documentBytes:before.byteLength,documentSHA256:sha(before.rootBytes)},after:{version:'1.3.0',decodedModuleBytes:current.length,documentBytes:after.byteLength,documentSHA256:sha(after.rootBytes)},deltaBytes:after.byteLength-before.byteLength,entryFragmentUnchanged:true,moduleCount:1,additionalThreeOrDecoderDependencies:0});
}
const report={schema:'keel-media-local-document-measurement@1',scope:'Complete local canonical HTML only. Not NFT metadata/tokenURI, serialized RPC body, paid storage quotation, registration or live deployment.',rows};
if(process.env.KEEL_MEDIA_SIZE_REPORT)await writeFile(process.env.KEEL_MEDIA_SIZE_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
