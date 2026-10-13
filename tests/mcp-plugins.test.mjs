import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMcpServer} from '../packages/mcp/dist/server.js';
import {loadMcpPlugins,validateMcpPlugin} from '../packages/mcp/dist/plugins.js';
const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'plugin-test',version:'1'}}};
const fixture=(id='test/example',name='example-tool')=>`export const keelPlugin={apiVersion:1,id:${JSON.stringify(id)},version:'1.0.0',instructions:'Read the actual engine state.',tools:[{descriptor:{name:${JSON.stringify(name)},description:'Example',inputSchema:{type:'object',properties:{value:{type:'string'}},additionalProperties:false}},async run({workspace},input){return {root:workspace.root,value:input.value}}}]};`;
test('explicit registry loads optional tools with workspace and initialize guidance; no-plugin remains usable',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'keel-plugins-'));
 try {
  const entry=path.join(dir,'plugin.mjs'),config=path.join(dir,'plugins.json');await writeFile(entry,fixture());
  await writeFile(config,JSON.stringify({schema:'keel-plugins@1',plugins:[{id:'test/example',entry}]}));
  const server=await createMcpServer({workspaceRoot:dir,pluginConfig:config});
  assert.match((await server.handle(init)).result.instructions,/actual engine state/);
  const list=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.ok(list.result.tools.some(x=>x.name==='example-tool'));for(const tool of list.result.tools)assert.equal(tool.inputSchema.type,'object',tool.name);
  const result=await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'example-tool',arguments:{value:'hello'}}});assert.deepEqual(result.result.structuredContent,{root:await realpath(dir),value:'hello'});
  const info=await server.handle({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'keel-plugins-list',arguments:{}}});assert.equal(info.result.structuredContent.plugins[0].id,'test/example');
  const plain=await createMcpServer({workspaceRoot:dir,pluginConfig:false});await plain.handle(init);
  const baseline=await plain.handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.equal(baseline.result.tools.some(x=>x.name==='example-tool'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('registry fails on collisions, mismatched identity, unsupported API and malformed schemas',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'keel-plugin-invalid-'));
 try {
  const a=path.join(dir,'a.mjs'),b=path.join(dir,'b.mjs');await writeFile(a,fixture());await writeFile(b,fixture('test/other'));
  await assert.rejects(loadMcpPlugins({pluginConfig:false,plugins:[a,b]}),/Duplicate MCP tool/);
  await assert.rejects(loadMcpPlugins({pluginConfig:false,plugins:[a]},[{descriptor:{name:'example-tool'}}]),/Duplicate MCP tool/);
  await assert.rejects(loadMcpPlugins({pluginConfig:false,plugins:['https://example.test/plugin.mjs']}),/local file paths/);
  assert.throws(()=>validateMcpPlugin({apiVersion:2}),/API version/);
  assert.throws(()=>validateMcpPlugin({apiVersion:1,id:'a',version:'1.0.0',tools:[{descriptor:{name:'a',description:'a',inputSchema:{}},run(){}}]}),/type object/);
  const config=path.join(dir,'config.json');await writeFile(config,JSON.stringify({schema:'keel-plugins@1',plugins:[{id:'wrong',entry:a}]}));
  await assert.rejects(loadMcpPlugins({pluginConfig:config}),/identity mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
