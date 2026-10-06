import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createMcpServer} from '../packages/mcp/dist/index.js';
import {verifyKeelPreReveal} from '../packages/sdk/dist/pre-reveal.js';

test('MCP prepares a discoverable optional root and keeps salt-bearing proofs private',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'keel-prereveal-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'public'));await mkdir(path.join(root,'private'));
  const token={tokenId:'1',attributes:[{trait_type:'Color',value:'Secret amber'}]};
  await writeFile(path.join(root,'allocation.json'),JSON.stringify({chainId:11155111,collection:'0x'+'11'.repeat(20),mode:'attributes',tokens:[token]}));
  const server=await createMcpServer({workspaceRoot:root});
  await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'prereveal-test',version:'1'}}});
  const tools=await server.handle({jsonrpc:'2.0',id:2,method:'tools/list'});assert.ok(tools.result.tools.some(x=>x.name==='keel-prereveal-prepare'));
  const call=arguments_=>server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'keel-prereveal-prepare',arguments:arguments_}});
  const result=await call({manifestPath:'allocation.json',outputDirectory:'public',privateOutputDirectory:'private'});
  assert.equal(result.result.isError,undefined,JSON.stringify(result));
  const output=result.result.structuredContent;assert.equal(output.published,false);
  assert.ok(!JSON.stringify(output).match(/Secret amber|"salt"\s*:|"siblings"\s*:/));
  const manifest=JSON.parse(await readFile(output.publicManifestPath)),proofs=JSON.parse(await readFile(output.privateProofsPath));
  assert.ok(!JSON.stringify(manifest).includes('Secret amber'));
  assert.equal((await stat(output.privateProofsPath)).mode&0o777,0o600);
  assert.equal((await verifyKeelPreReveal({manifest,token,reveal:proofs[0]})).attributeAssignmentMatched,true);
  const denied=await call({manifestPath:'allocation.json',outputDirectory:'public',privateOutputDirectory:'public'});assert.equal(denied.result.isError,true);
  const escape=await call({manifestPath:'allocation.json',outputDirectory:'public',privateOutputDirectory:'../escape'});assert.equal(escape.result.isError,true);
});
