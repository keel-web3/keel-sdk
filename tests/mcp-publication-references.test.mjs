import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKeelPublicationReferences} from '../packages/mcp/dist/publication-references.js';
import {searchKeelIndexes} from '../packages/mcp/dist/fray-agent.js';

test('SDK publication references expose an existing REDLINE token without claiming live authentication', async()=>{
 const refs=await searchKeelPublicationReferences({query:'REDLINE'});
 assert.equal(refs.length,2);
 const uri81=refs.find(ref=>ref.transport.payload==='uri81-block-v1');
 assert.equal(uri81.collection,'0x8c5731dc35301fA5c222e82bd5405414BDc45Ca2');
 assert.equal(uri81.uriCompatibility.tokenURI.strictURICompatible,true);
 assert.equal(uri81.managedRoute.manager,'0x560AeEFAE5e9a9cC94198B25Dc359C1579763DB6');
 assert.equal(uri81.managedRoute.inspectionTool,'keel-manager-modules-inspect');
 assert.ok(refs.some(ref=>ref.collection==='0xAe73eC8A4867C3886E8987371f0D57943f0f6BDB'));
 assert.equal(refs[0].authenticatedThisRun,false);
 assert.equal(refs[0].verification,'requires-selected-chain-readback');
 assert.match(refs[0].next,/keel-inline-reuse-plan/);
});

test('empty or unavailable Studio feeds retain reuse candidates and never authorize engine uploads', async()=>{
 const original=globalThis.fetch;
 try {
  for(const failed of [false,true]){
   globalThis.fetch=async url=>failed ? new Response('',{status:503})
     : Response.json(String(url).includes('/api/library')?{assets:[]}:{modules:[]});
   const result=await searchKeelIndexes({query:'redline',studioUrl:'https://example.com'});
   assert.equal(result.publicationReferences.length,2);
   assert.equal(result.publicationReferences[0].authenticatedThisRun,false);
   assert.equal(result.reuse.unchangedEngineUploads,0);
   assert.match(result.reuse.action,/selected-chain.*keel-inline-reuse-plan/);
   if(failed) assert.equal(result.status,'partial');
  }
 } finally { globalThis.fetch=original; }
});

test('core MCP handshake and policy declare URI81, automatic compression and mandatory reuse',async()=>{
 const {createMcpServer}=await import('../packages/mcp/dist/server.js');
 const {PREPARED_COPY_POLICY}=await import('../packages/mcp/dist/prepared-copy-guidance.js');
 assert.equal(PREPARED_COPY_POLICY.collectorInlineBinaryDefault.transportProfile,'uri81-block-v1');
 const server=await createMcpServer({workspaceRoot:process.cwd(),pluginConfig:false});
 const init=await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'standards-test',version:'1'}}});
 assert.match(init.result.instructions,/URI81 applies to both compressed and uncompressed/);
 assert.match(init.result.instructions,/keel-inline-reuse-plan/);
 assert.match(init.result.instructions,/Compression never makes Base90 URI-safe/);
 assert.match(init.result.instructions,/Before declaring a KEEL route immutable/);
 const list=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
 assert.ok(list.result.tools.some(tool=>tool.name==='keel-manager-modules-inspect'));
 assert.ok(list.result.tools.some(tool=>tool.name==='keel-manager-module-replacement-prepare'));
});
