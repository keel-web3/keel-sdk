import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),ts=require('typescript');
for(const name of ['media-edit-tools','paths']){const source=new URL('../packages/mcp/src/'+name+'.ts',import.meta.url),code=ts.transpileModule(await readFile(source,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;await writeFile(new URL('../packages/mcp/dist/native-movie-test-'+name+'.mjs',import.meta.url),code)}
const {MEDIA_EDIT_TOOL_DEFINITIONS}=await import('../packages/mcp/dist/native-movie-test-media-edit-tools.mjs'),{createWorkspace}=await import('../packages/mcp/dist/native-movie-test-paths.mjs');
const workspace=await createWorkspace(new URL('../docs/review/temporal-display-metadata-20261022/reviewer-inputs/',import.meta.url).pathname),recipe={schema:'keel-media-edit@1',mode:'original',format:'original',quality:82,noSound:false};
for(const [name,width]of [['sar',64],['title',32]])test(`actual portable MCP native ${name} inspection uses displayed geometry and retains exact original bytes`,async()=>{
 const inputPath=name+'.mp4',source=await readFile(await workspace.resolveExistingFile(inputPath,32*1024*1024));
 const compare=await MEDIA_EDIT_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-media-compare').run({workspace},{inputPath,recipe});
 assert.equal(compare.sourceInfo.width,width);assert.equal(compare.sourceInfo.height,24);assert.equal(compare.sourceInfo.frameCount,3);assert.equal(compare.verification.completeDecode,false);assert.equal(compare.verification.losslessPixelsVerified,false);assert.equal(compare.persisted,false);
 const candidate=await MEDIA_EDIT_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-media-candidate').run({workspace},{inputPath,recipe});assert.deepEqual(Buffer.from(candidate.bytesBase64,'base64'),source);assert.equal(candidate.publication,'not-performed');
 for(const action of ['candidate','compare'])await assert.rejects(MEDIA_EDIT_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-media-'+action).run({workspace},{inputPath,recipe:{...recipe,mode:'lossless',format:'webp'}}),/aspect|metadata|semantics/i);
 assert.deepEqual(await readFile(await workspace.resolveExistingFile(inputPath,32*1024*1024)),source);
});
