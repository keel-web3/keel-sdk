import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createMcpServer} from '../../mcp/dist/server.js';
test('existing KEEL MCP exposes all six schemas and dispatches structured plan/errors',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'keel-trailer-mcp-'));
 try{
  const server=await createMcpServer({workspaceRoot:root});
  await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'trailer-test',version:'1'}}});
  await server.handle({jsonrpc:'2.0',method:'notifications/initialized'});
  const list=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
  const names=['trailer-plan','trailer-capture','trailer-beats','trailer-render','trailer-verify','trailer-stills'];
  for(const name of names){const descriptor=list.result.tools.find(t=>t.name===name);assert.ok(descriptor);assert.equal(descriptor.inputSchema.additionalProperties,false);}
  const plan=await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'trailer-plan',arguments:{brief:'World, play, launch',sources:[{id:'a',kind:'image',path:'a.png'}]}}});
  assert.equal(plan.result.structuredContent.timeline.version,1);assert.equal(plan.result.isError,undefined);
  const bad=await server.handle({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'trailer-render',arguments:{outDir:'out',timeline:{version:999}}}});
  assert.equal(bad.result.isError,true);assert.match(bad.result.content[0].text,/INVALID_SCHEMA/);
 }finally{await rm(root,{recursive:true,force:true});}
});
