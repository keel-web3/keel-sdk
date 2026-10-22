import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {build} from 'esbuild';
import {createIntegrity,canonicalJson} from '../packages/protocol/dist/index.js';
import {createKeelAuthoredProject,assertKeelAuthoredProjectFiles,planKeelAuthoredProjectChanges,buildKeelAuthoredInlineDocument} from '../packages/sdk/dist/authored-project.js';
import {stageKeelStudioProject} from '../packages/sdk/dist/studio-upload.js';
import {createMcpServer} from '../packages/mcp/dist/server.js';
import {planKeelProject} from '../packages/sdk/dist/engine.js';
import {authoredFixture} from './helpers/authored-project-fixture.mjs';
import {currentNativeMediaRecipe} from './helpers/native-media-fixtures.mjs';
const decode=bytes=>new TextDecoder().decode(bytes);
const call=(server,id,name,args)=>server.handle({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
async function serverFor(root){const server=await createMcpServer({workspaceRoot:root,pluginConfig:false});await server.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'authored-case',version:'1'}}});return server;}
test('new executable planning defaults to actual authored tool without technical creator questions',()=>{
 const plan=planKeelProject({outcome:'storage-only',runtime:'html',family:'ethereum',chainId:11155111,storage:'inline'});
 assert.equal(plan.authoring.tool,'keel-project-author');assert.ok(plan.nextTools.includes('keel-project-author'));assert.ok(plan.nextTools.includes('keel-studio-stage-project'));for(const retiredOrAlternate of ['keel-creator-inline-prepare','keel-inline-prepare','upload-plan'])assert.ok(!plan.nextTools.includes(retiredOrAlternate));assert.deepEqual(plan.questions,[]);assert.equal(plan.authority.publicationReady,false);
 assert.equal(planKeelProject({outcome:'explore',runtime:'static-media'}).authoring,null);
});
test('author creates exact reachable functional source modules and small generated boundaries',async()=>{
 const spec=authoredFixture(),original=structuredClone(spec),result=await createKeelAuthoredProject(spec);
 assert.deepEqual(spec,original);assert.equal(result.graph.nodes.length,5);assert.equal(result.graph.edges.length,4);
 for(const module of spec.modules)assert.equal(decode(result.files.find(file=>file.path===`modules/${module.id}.js`).bytes),module.source);
 assert.match(decode(result.files.find(file=>file.path==='main.js').bytes),/import \{ mount as start \}/);assert.ok(result.files.find(file=>file.path==='main.js').bytes.length<200);
 assert.ok(result.graph.edges.some(edge=>edge.consumer==='modules/artwork-renderer.js'&&edge.dependency==='modules/scene-state.js'));
 await assertKeelAuthoredProjectFiles(result.graph,result.files);assert.equal(result.completePresentationBytes,null);assert.equal(result.publicationReady,false);
});
for(const [name,change] of [
 ['one flattened module',spec=>{spec.modules=[spec.modules[1]]}],
 ['disconnected fake module',spec=>{spec.modules.push({id:'unused-placeholder',purpose:'fake split',source:'export const unused=1;'})}],
 ['unused imported placeholder',spec=>{spec.modules.push({id:'unused-placeholder',purpose:'fake split',source:'export const unused=1;'});spec.modules[1].source='import {unused} from "./unused-placeholder.js";\n'+spec.modules[1].source}],
 ['unknown external import',spec=>{spec.modules[0].source='import x from "unknown-runtime";\n'+spec.modules[0].source}],
 ['unknown relative import',spec=>{spec.modules[1].source='import "./missing.js";\n'+spec.modules[1].source}],
 ['computed import',spec=>{spec.modules[1].source+='\nvoid import(globalThis.filename);'}],
 ['live mutable export',spec=>{spec.modules[0].source+='\nexport let changing=0;'}],
 ['reassigned exported function',spec=>{spec.modules[0].source+='\npixel=()=>[0,0,0,255];'}],
 ['cyclic modules',spec=>{spec.modules[0].source='import \"./artwork-renderer.js\";\n'+spec.modules[0].source}],
 ['top-level await',spec=>{spec.modules[0].source='await Promise.resolve();\n'+spec.modules[0].source}],
 ['import meta',spec=>{spec.modules[0].source+='\nconsole.log(import.meta.url);'}],
 ['star reexport',spec=>{spec.modules[1].source+='\nexport * from \"./scene-state.js\";'}],
 ['combined import clause',spec=>{spec.modules[1].source=spec.modules[1].source.replace('import {pixel}', 'import unused, {pixel}') }],
 ['remote fetch',spec=>{spec.modules[0].source+='\nvoid fetch(\"https://evil.invalid/asset\");'}],
 ['escaped remote URL',spec=>{spec.modules[0].source+='\nconst remote=\"ht\\u0074ps://evil.invalid/asset\";console.log(remote);'}],
 ['computed image URL',spec=>{spec.modules[1].source+='\nconst image=document.createElement(\"img\");image.src=globalThis.locator;'}],
 ['executable DOM injection',spec=>{spec.modules[1].source+='\nconst script=document.createElement(\"script\");document.body.append(script);'}],
 ['encoded executable content',spec=>{spec.modules[1].source+='\nnew Function(atob(\"ZmV0Y2goJ2h0dHBzOi8vZXZpbC5pbnZhbGlkJykn\"))();'}],
 ['external CSS URL',spec=>{spec.stylesheet='body{background:url(https://evil.invalid/background.png)}'}],
 ['CommonJS loader',spec=>{spec.modules[1].source+='\nrequire("./scene-state.js");'}],
 ['closing-over local scope cannot be faked by chunks',spec=>{spec.modules[1].source='import {scope} from "./part-1.js";'+spec.modules[1].source}],
 ['invalid UTF-8 surrogate',spec=>{spec.modules[0].source+='\nconst broken="\ud800";'}],
])test(`authored default rejects ${name}`,async()=>{const spec=authoredFixture();change(spec);await assert.rejects(createKeelAuthoredProject(spec));});
test('editing one functional module preserves paths and only changes that module fragment',async()=>{
 const first=await createKeelAuthoredProject(authoredFixture()),spec=authoredFixture();spec.modules[0].source=spec.modules[0].source.replace('x*61','x*53');const next=await createKeelAuthoredProject(spec),delta=planKeelAuthoredProjectChanges(first.graph,next.graph);
 assert.deepEqual(first.graph.nodes.map(n=>n.id),next.graph.nodes.map(n=>n.id));assert.deepEqual(delta.changedResourceIds,['modules/scene-state.js']);assert.equal(delta.unchangedResourceIds.length,4);assert.equal(delta.publicationReady,false);
 const recipe=await currentNativeMediaRecipe(),before=await buildKeelAuthoredInlineDocument({...recipe,...first,modules:[]}),after=await buildKeelAuthoredInlineDocument({...recipe,...next,modules:[]});
 const changed=after.parts.filter((part,index)=>!Buffer.from(part.bytes).equals(Buffer.from(before.parts[index].bytes)));
 assert.equal(changed.length,1,'Current physical creator fragments must isolate one module edit');assert.equal(changed[0].role,'asset');
 assert.equal(JSON.parse(decode(changed[0].bytes).slice(1)).id,'modules/scene-state.js');
 for(const source of before.authored.resources)assert.ok(source.compiledIntegrity.digest,'Separate compiled objects keep their own commitments');
});
test('source/graph drift blocks SDK stage before any request; supplied self-contained uploads remain exact',async()=>{
 const project=await createKeelAuthoredProject(authoredFixture());project.files[2].bytes[0]^=1;let requests=0;
 await assert.rejects(stageKeelStudioProject({studioUrl:'https://studio.invalid',agentToken:'test-'.repeat(8),title:'Artwork',storageStrategy:'onchain',files:project.files,authoredProject:project.graph,fetchImplementation:async()=>{requests++;throw Error('unexpected')}}),/changed/);assert.equal(requests,0);
});
test('studio-upload remains browser safe with authored commitment checking',async()=>{
 const bundled=await build({stdin:{contents:'export {stageKeelStudioProject} from "@keel/sdk/studio-upload"',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'esm',metafile:true});
 assert.ok(!Object.keys(bundled.metafile.inputs).some(file=>/authored-project\.ts$|esbuild\/lib|node:/u.test(file)));
});
test('actual MCP author/recovery/stage validates graph then sends exact stable logical source paths',async()=>{
 const root=await mkdtemp('/private/tmp/keel-mcp-authored-test-'),server=await serverFor(root),priorToken=process.env.KEEL_STUDIO_AGENT_TOKEN,priorStudioUrl=process.env.KEEL_STUDIO_URL,priorFetch=globalThis.fetch;
 try{
  const made=await call(server,2,'keel-project-author',{...authoredFixture(),out:'work'});assert.equal(made.result.isError,undefined);const prepared=made.result.structuredContent;
  const resumed=await call(server,3,'keel-project-author',{...authoredFixture(),out:'work'});assert.deepEqual(resumed.result.structuredContent,prepared);
  process.env.KEEL_STUDIO_AGENT_TOKEN='keel_agent_'+ 'x'.repeat(32);process.env.KEEL_STUDIO_URL='https://studio.invalid';let requests=0;
  globalThis.fetch=async(url,input)=>{requests++;assert.equal(new URL(url).pathname,'/api/agent/staging');const metadata=JSON.parse(input.body.get('metadata'));
   assert.deepEqual(metadata.components.map(file=>file.path),[...prepared.graph.nodes.map(node=>node.path),'keel-authored-project.json']);assert.equal(metadata.viewer,'keel-verification-shell');
   const files=input.body.getAll('files');for(let i=0;i<prepared.graph.nodes.length;i++)assert.equal((await createIntegrity(new Uint8Array(await files[i].arrayBuffer()))).digest,prepared.graph.nodes[i].integrity.digest);assert.deepEqual(JSON.parse(await files.at(-1).text()),prepared.graph);
   return new Response(JSON.stringify({schema:'keel-studio-project-handoff@1',id:'local-fixture',handoffUrl:'https://studio.invalid/studio/import/local-fixture',expiresAt:'2026-10-23T00:00:00.000Z',fileCount:files.length,totalBytes:files.reduce((n,f)=>n+f.size,0),wallet:{signing:'not-performed',submission:'not-performed'}}));
  };
  const staged=await call(server,4,'keel-studio-stage-project',{...prepared.stageArguments,studioUrl:'https://studio.invalid'});assert.equal(staged.result.isError,undefined);assert.equal(requests,1);
  const file=join(root,prepared.stageArguments.files[2].path);await writeFile(file,'import "https://unresolved.invalid/code.js";');
  const stale=await call(server,5,'keel-studio-stage-project',{...prepared.stageArguments,studioUrl:'https://studio.invalid'});assert.equal(stale.result.isError,true);assert.equal(requests,1);
  const recovery=await call(server,6,'keel-project-author',{...authoredFixture(),out:'work'});assert.equal(recovery.result.isError,true,'Never overwrite an altered immutable authored revision');
 }finally{globalThis.fetch=priorFetch;if(priorToken===undefined)delete process.env.KEEL_STUDIO_AGENT_TOKEN;else process.env.KEEL_STUDIO_AGENT_TOKEN=priorToken;if(priorStudioUrl===undefined)delete process.env.KEEL_STUDIO_URL;else process.env.KEEL_STUDIO_URL=priorStudioUrl;await rm(root,{recursive:true,force:true})}
});

test('comments and SVG namespace identifiers are not false network dependencies',async()=>{
 const spec=authoredFixture();spec.modules[0].source+='\n// import.meta and dynamic import(url) are comments, not executable syntax.\nconst namespace="http://www.w3.org/2000/svg";console.log(namespace);';
 await createKeelAuthoredProject(spec);
});
test('declared exact binary data gets a real graph edge; orphan and computed data fail closed',async()=>{
 const spec=authoredFixture();spec.assets=[{path:'assets/palette.bin',purpose:'Palette source',mediaType:'application/octet-stream',bytes:Uint8Array.of(255,0,128,42)}];
 spec.modules[0].source+='\nexport async function palette(){return __KEEL_CONTENT__.bytes("assets/palette.bin")}';
 const project=await createKeelAuthoredProject(spec);await assertKeelAuthoredProjectFiles(project.graph,project.files);assert.ok(project.graph.edges.some(edge=>edge.dependency==='assets/palette.bin'));assert.deepEqual(project.files.at(-1).bytes,spec.assets[0].bytes);
 const orphan=authoredFixture();orphan.assets=spec.assets;await assert.rejects(createKeelAuthoredProject(orphan),/Orphan/);
 spec.modules[0].source=spec.modules[0].source.replace('"assets/palette.bin"','globalThis.palettePath');await assert.rejects(createKeelAuthoredProject(spec),/exact declared/);
});
test('Raw retains separately qualified original module bytes and rejects automatic gzip',async()=>{
 const project=await createKeelAuthoredProject(authoredFixture()),recipe=await currentNativeMediaRecipe();
 const doc=await buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'raw'});
 for(const item of doc.authored.resources)assert.deepEqual(item.compiledIntegrity,item.sourceIntegrity);
 await assert.rejects(buildKeelAuthoredInlineDocument({...recipe,...project,modules:[],payloadStorage:'raw',compressionByPath:{'modules/scene-state.js':'gzip'}}),/Raw/);
});
