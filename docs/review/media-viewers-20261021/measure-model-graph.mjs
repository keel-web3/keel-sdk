import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {completeModelDocument,currentRecipeModelDocument} from '../../../tests/helpers/model-viewer-fixtures.mjs';
import {buildKeelInlineRawPercentTokenURIGraph} from '../../../packages/sdk/dist/inline-viewer-graph.js';
import {keelAssetDisplayModuleBytes,keelAssetDisplayModuleRevision} from '../../../packages/sdk/dist/asset-display.js';
const rows=[];
for(const format of ['glb','gltf','obj'])for(const recipe of ['compiled-local','retained-current-native-frame']){
 const input=await(recipe==='compiled-local'?completeModelDocument(format):currentRecipeModelDocument(format)),{document}=input;
 const graph=recipe==='retained-current-native-frame'?await buildKeelInlineRawPercentTokenURIGraph(document,{registeredNativeGzip:document.registeredNativeGzip}):undefined;
 assert.equal(document.modelPresentation.byteCounts.completeHTML,document.rootBytes.length);
 rows.push({format,recipe,original:document.modelPresentation.originalEntry,dependencies:document.modelPresentation.originalDependencies,generatedPresentation:document.modelPresentation.generatedEntry,byteCounts:document.modelPresentation.byteCounts,sourceStorage:document.modelPresentation.sourceStorage,modules:input.modules.map(m=>({id:m.moduleId,version:m.version,decodedBytes:m.item.integrity.byteLength,descriptorBytes:m.bytes.length})),rawPercentGraphBytes:graph?.fragmentBytes.length??null,authority:'synthetic retained-byte fixture only; no live chain authentication, registration, token metadata, RPC simulation, quotation or wallet approval'});
}
const before=keelAssetDisplayModuleRevision('1.3.0'),after=keelAssetDisplayModuleRevision('1.4.0');assert.equal(after.byteLength,keelAssetDisplayModuleBytes().length);
const report={scope:'S3 complete local typed graphs; every occurrence counted, never raw source alone',raster:{before,after,savedDecodedSharedBytes:before.byteLength-after.byteLength,threeOrLoaderDependencies:0},rows};
const json=JSON.stringify(report,null,2)+'\n';if(process.env.KEEL_MODEL_GRAPH_REPORT)await writeFile(process.env.KEEL_MODEL_GRAPH_REPORT,json);else process.stdout.write(json);
