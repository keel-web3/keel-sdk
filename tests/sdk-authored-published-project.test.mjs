import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createKeelAuthoredProject,assertKeelAuthoredProjectFiles,planKeelAuthoredProjectChanges} from '../packages/sdk/dist/authored-project.js';
import {stageKeelStudioProject} from '../packages/sdk/dist/studio-upload.js';
import {authoredFixture} from './helpers/authored-project-fixture.mjs';
import {publishedThreeFixture,authoredRuntimeResolutionFixture} from './helpers/authored-published-fixture.mjs';
import {createMcpServer} from '../packages/mcp/dist/server.js';
function specification(publishedModules){const spec=authoredFixture();spec.publishedModules=publishedModules;spec.modules[0].source='import {Vector3} from "three.module.min.js";\n'+spec.modules[0].source.replace('return [','const point=new Vector3(x,y,0);return [');return spec}
test('exact maintained core/main closure contributes real imports without entering staged creator bytes',async()=>{
 const fixture=await publishedThreeFixture(),spec=specification(fixture.publishedModules),project=await createKeelAuthoredProject(spec);
 assert.equal(project.graph.publishedModules.length,2);assert.equal(project.files.length,5);assert.ok(project.graph.edges.some(edge=>edge.consumer==='modules/scene-state.js'&&edge.dependency==='published:three-r180-module'));assert.ok(project.graph.edges.some(edge=>edge.consumer==='published:three-r180-module'&&edge.dependency==='published:three-r180-core'));
 await assertKeelAuthoredProjectFiles(project.graph,project.files,fixture.publishedModules);
 let requests=0;await stageKeelStudioProject({studioUrl:'https://studio.invalid',agentToken:'test-'.repeat(8),title:'Shared artwork',storageStrategy:'onchain',files:project.files,authoredProject:project.graph,fetchImplementation:async(url,input)=>{requests++;const files=input.body.getAll('files');assert.equal(files.length,7);assert.ok(files.every(file=>file.size<10000));const declaration=JSON.parse(await files.at(-1).text());assert.deepEqual(declaration.module.moduleBindings,fixture.publishedModules.map(module=>module.binding));return new Response(JSON.stringify({schema:'keel-studio-project-handoff@1',id:'fixture',handoffUrl:'https://studio.invalid/fixture',expiresAt:'2026-10-23T00:00:00Z',fileCount:7,totalBytes:files.reduce((sum,file)=>sum+file.size,0),wallet:{signing:'not-performed',submission:'not-performed'}}))}});assert.equal(requests,1);
});
for(const kind of ['missing-core','wrong-chain','wrong-hash','different-store','unsupported-custom','bad-interface','source-corruption'])test(`published authored ${kind} fails closed`,async()=>{
 const {publishedModules}=await publishedThreeFixture(),spec=specification(structuredClone(publishedModules));
 if(kind==='missing-core')spec.publishedModules.shift();if(kind==='wrong-chain')spec.publishedModules[0].binding.chain='eip155:1';if(kind==='wrong-hash')spec.publishedModules[0].binding.digest='sha256:'+'1'.repeat(64);if(kind==='different-store')spec.publishedModules[1].binding.store='0x'+'1'.repeat(40);if(kind==='unsupported-custom')spec.publishedModules[0].binding.moduleId='unreviewed';if(kind==='bad-interface')spec.modules[0].source=spec.modules[0].source.replace('{Vector3}','{DefinitelyMissing}');if(kind==='source-corruption')spec.publishedModules[0].source[0]^=1;
 await assert.rejects(createKeelAuthoredProject(spec));
});
test('normal MCP author infers Three, resolves its current catalog and privately caches public sources before staging zero library bytes',async()=>{
 const root=await mkdtemp('/private/tmp/keel-authored-reuse-mcp-'),wire=await authoredRuntimeResolutionFixture();const prior={fetch:globalThis.fetch,url:process.env.KEEL_STUDIO_URL,token:process.env.KEEL_STUDIO_AGENT_TOKEN};
 try{
 process.env.KEEL_STUDIO_URL='https://studio.invalid';process.env.KEEL_STUDIO_AGENT_TOKEN='keel_agent_'+'x'.repeat(32);let gets=0,posts=0;
 globalThis.fetch=async(url,input)=>{const target=new URL(url);assert.equal(target.origin,'https://studio.invalid');assert.equal(target.pathname,'/api/agent/staging');
  if(input.method==='GET'){gets++;assert.equal(target.searchParams.get('runtime'),'three');assert.equal(target.searchParams.get('version'),'0.180.0');assert.equal(target.searchParams.get('chainId'),'11155111');assert.equal(input.headers.authorization,'Bearer '+process.env.KEEL_STUDIO_AGENT_TOKEN);return new Response(JSON.stringify(wire),{headers:{'content-type':'application/json'}})}
  posts++;const files=input.body.getAll('files');assert.equal(files.length,7);assert.ok(files.every(file=>file.size<10000));return new Response(JSON.stringify({schema:'keel-studio-project-handoff@1',id:'fixture',handoffUrl:'https://studio.invalid/fixture',expiresAt:'2026-10-23T00:00:00Z',fileCount:7,totalBytes:files.reduce((n,file)=>n+file.size,0),wallet:{signing:'not-performed',submission:'not-performed'}}));
 };
 const server=await createMcpServer({workspaceRoot:root,pluginConfig:false});await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'automatic-shared-case',version:'1'}}});const call=(id,name,args)=>server.handle({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
 const planned=await call(2,'keel-project-decisions',{outcome:'storage-only',runtime:'three',family:'ethereum',chainId:11155111,storage:'inline'});assert.equal(planned.result.isError,undefined);assert.ok(planned.result.structuredContent.nextTools.includes('keel-project-author'));assert.deepEqual(planned.result.structuredContent.questions,[]);
 const spec=authoredFixture();spec.modules[0].source='import {Vector3} from "three";\n'+spec.modules[0].source.replace('return [','const point=new Vector3(x,y,0);return [');
 const authored=await call(3,'keel-project-author',{...spec,out:'work'});assert.equal(authored.result.isError,undefined,JSON.stringify(authored));const result=authored.result.structuredContent;assert.equal(result.sharedReuse.publishedBytesStaged,0);assert.equal(gets,1);assert.equal(posts,0);assert.equal(result.graph.publishedModules.length,2);
 assert.equal((await call(4,'keel-studio-stage-project',{...result.stageArguments,studioUrl:'https://studio.invalid'})).result.isError,undefined);assert.equal(posts,1);
 const cached=path.join(root,'.keel-mcp/public-runtime-cache/11155111',wire.modules[0].binding.digest.slice(7)+'.js');await writeFile(cached,'corrupt cached public source');assert.equal((await call(5,'keel-studio-stage-project',{...result.stageArguments,studioUrl:'https://studio.invalid'})).result.isError,true);assert.equal(posts,1);
 }finally{globalThis.fetch=prior.fetch;if(prior.url===undefined)delete process.env.KEEL_STUDIO_URL;else process.env.KEEL_STUDIO_URL=prior.url;if(prior.token===undefined)delete process.env.KEEL_STUDIO_AGENT_TOKEN;else process.env.KEEL_STUDIO_AGENT_TOKEN=prior.token;await rm(root,{recursive:true,force:true})}
});
test('a changed shared runtime binding cannot masquerade as an unchanged creator-only revision',async()=>{
 const fixture=await publishedThreeFixture(),before=await createKeelAuthoredProject(specification(fixture.publishedModules)),changed=structuredClone(fixture.publishedModules);changed[1].binding.objectId='0x'+'3'.repeat(64);const after=await createKeelAuthoredProject(specification(changed));assert.throws(()=>planKeelAuthoredProjectChanges(before.graph,after.graph),/published runtime dependency changed/);
});
