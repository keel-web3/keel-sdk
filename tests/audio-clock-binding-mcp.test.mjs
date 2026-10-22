import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url),ts=require('typescript');
for(const name of ['media-edit-tools','paths']){const file=new URL('../packages/mcp/src/'+name+'.ts',import.meta.url),code=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;await writeFile(new URL('../packages/mcp/dist/audio-test-'+name+'.mjs',import.meta.url),code)}
const {MEDIA_EDIT_TOOL_DEFINITIONS}=await import('../packages/mcp/dist/audio-test-media-edit-tools.mjs'),{createWorkspace}=await import('../packages/mcp/dist/audio-test-paths.mjs');
const workspace=await createWorkspace(new URL('../docs/review/temporal-audio-binding-20261022/',import.meta.url).pathname),recipe={schema:'keel-media-edit@1',mode:'lossless',format:'mov',quality:82,noSound:false};
for(const name of ['pcm-coherent-count.mov','aac-one-tick-tail.mp4'])for(const action of ['candidate','compare'])test(`real MCP ${action} rejects unmodeled complete audio ${name} with no persistence`,async()=>{
 const bytes=await readFile(new URL('../docs/review/temporal-audio-binding-20261022/'+name,import.meta.url)),tool=MEDIA_EDIT_TOOL_DEFINITIONS.find(item=>item.descriptor.name==='keel-media-'+action);
 await assert.rejects(tool.run({workspace},{inputPath:name,recipe:{...recipe,format:name.endsWith('.mp4')?'mp4':'mov'}}),/audio|sample|timeline|duration|bounds|semantics|preserv/i);
 assert.deepEqual(await readFile(new URL('../docs/review/temporal-audio-binding-20261022/'+name,import.meta.url)),bytes);
});
test('real MCP normal AAC candidate and comparison retain audio and remain unpublished',async()=>{
 for(const action of ['candidate','compare']){const tool=MEDIA_EDIT_TOOL_DEFINITIONS.find(item=>item.descriptor.name==='keel-media-'+action),result=await tool.run({workspace},{inputPath:'aac-original.mp4',recipe:{...recipe,format:'mp4'}});assert.equal(result.sourceInfo.hasAudio,true);assert.equal(result.candidateInfo.hasAudio,true);assert.equal(result.persisted,false);assert.equal(result.verification.completeDecode,true)}
});
