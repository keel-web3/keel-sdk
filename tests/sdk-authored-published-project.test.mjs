import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createKeelAuthoredProject,assertKeelAuthoredProjectFiles} from '../packages/sdk/dist/authored-project.js';
import {stageKeelStudioProject} from '../packages/sdk/dist/studio-upload.js';
import {authoredFixture} from './helpers/authored-project-fixture.mjs';
import {publishedThreeFixture} from './helpers/authored-published-fixture.mjs';
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
test('real MCP author and stage revalidate the private public-source cache without uploading libraries',async()=>{
 const fixture=await publishedThreeFixture(),root=await mkdtemp('/private/tmp/keel-authored-reuse-mcp-');const prior={fetch:globalThis.fetch,url:process.env.KEEL_STUDIO_URL,token:process.env.KEEL_STUDIO_AGENT_TOKEN};
 try{for(const module of fixture.publishedModules)await writeFile(path.join(root,module.binding.moduleId+'.js'),module.source);
 const server=await createMcpServer({workspaceRoot:root,pluginConfig:false});await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'shared-case',version:'1'}}});const call=(id,name,args)=>server.handle({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
 const spec=specification(fixture.publishedModules);const args={...spec,publishedModules:fixture.publishedModules.map(module=>({binding:module.binding,sourcePath:module.binding.moduleId+'.js'})),out:'work'};
 const authored=await call(2,'keel-project-author',args);assert.equal(authored.result.isError,undefined);const result=authored.result.structuredContent;assert.equal(result.sharedReuse.publishedBytesStaged,0);
 process.env.KEEL_STUDIO_URL='https://studio.invalid';process.env.KEEL_STUDIO_AGENT_TOKEN='keel_agent_'+'x'.repeat(32);let requests=0;globalThis.fetch=async(url,input)=>{requests++;const files=input.body.getAll('files');assert.equal(files.length,7);assert.ok(files.every(file=>file.size<10000));return new Response(JSON.stringify({schema:'keel-studio-project-handoff@1',id:'fixture',handoffUrl:'https://studio.invalid/fixture',expiresAt:'2026-10-23T00:00:00Z',fileCount:7,totalBytes:files.reduce((n,file)=>n+file.size,0),wallet:{signing:'not-performed',submission:'not-performed'}}))};
 assert.equal((await call(3,'keel-studio-stage-project',{...result.stageArguments,studioUrl:'https://studio.invalid'})).result.isError,undefined);assert.equal(requests,1);
 await writeFile(path.join(root,fixture.publishedModules[0].binding.moduleId+'.js'),'corrupt cached public source');assert.equal((await call(4,'keel-studio-stage-project',{...result.stageArguments,studioUrl:'https://studio.invalid'})).result.isError,true);assert.equal(requests,1);
 }finally{globalThis.fetch=prior.fetch;if(prior.url===undefined)delete process.env.KEEL_STUDIO_URL;else process.env.KEEL_STUDIO_URL=prior.url;if(prior.token===undefined)delete process.env.KEEL_STUDIO_AGENT_TOKEN;else process.env.KEEL_STUDIO_AGENT_TOKEN=prior.token;await rm(root,{recursive:true,force:true})}
});
