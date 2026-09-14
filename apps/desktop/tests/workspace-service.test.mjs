import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {WorkspaceStore,newProject} from '../src/workspace.mjs';
import {serveWorkspace} from '../src/workspace-service.mjs';
import {createKeelEditorClient} from '@keel/sdk/editor-client';
import {EDITOR_TOOL_DEFINITIONS} from '../../../packages/mcp/dist/editor-tools.js';

test('external SDK edits the same saved workspace without any agent chat',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'keel-shared-')),database=path.join(dir,'workspace.sqlite'),socketPath=path.join(dir,'workspace.sock');
 const store=new WorkspaceStore(database),editor=new WorkspaceStore(database);let events=0,server;const opened=[];const previousSocket=process.env.KEEL_EDITOR_SOCKET;
 try{
  const a=newProject('Gators'),b=newProject('Keep this');store.save({...store.read().state,projects:[a,b]},0);
  server=await serveWorkspace({store,socketPath,changed:()=>events++,openProject:id=>opened.push(id)});const sdk=createKeelEditorClient(socketPath);
  assert.equal((await stat(socketPath)).mode&0o777,0o600);
  const listed=await sdk.listProjects();assert.equal(listed.projects.length,2);
  const before=await sdk.readProject(a.id);
  assert.deepEqual(await sdk.openProject(a.id),{projectId:a.id,navigationRequested:true});
  await assert.rejects(sdk.openProject(newProject('Missing').id),/not found/);
  assert.deepEqual(opened,[a.id]);assert.equal((await sdk.readProject(a.id)).revision,before.revision);
  const updated=await sdk.updateProject(a.id,before.revision,{title:'Gators corrected'});
  assert.equal(editor.read().state.projects[0].title,'Gators corrected');assert.deepEqual(editor.read().state.projects[1],b);
  await assert.rejects(sdk.updateProject(a.id,before.revision,{title:'Stale'}),/changed/);
  await assert.rejects(sdk.updateProject(a.id,updated.revision,{publication:{}}),/Unsupported/);
  const imported=await sdk.importObject(Buffer.from('original artwork'),'art.txt','text/plain',updated.revision);
  const linked=await sdk.updateProject(a.id,imported.revision,{objectIds:[imported.object.id]});assert.equal(linked.project.objectIds[0],imported.object.id);
  assert.equal(editor.object(imported.object.id).toString(),'original artwork');assert.equal(events,3);
  await assert.rejects(sdk.updateProject(a.id,linked.revision,{objectIds:['a'.repeat(64)]}),/unavailable/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'agent_%'").get().count,0);
  process.env.KEEL_EDITOR_SOCKET=socketPath;
  await EDITOR_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-editor-project-open').run({}, {projectId:a.id});
  assert.deepEqual(opened,[a.id,a.id]);
  const tool=EDITOR_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-editor-project-update');
  await tool.run({}, {projectId:a.id,revision:linked.revision,patch:{notes:'Updated through MCP without chat'}});
  assert.equal((await sdk.readProject(a.id)).project.notes,'Updated through MCP without chat');
  assert.equal(editor.read().state.projects[0].notes,'Updated through MCP without chat');
  const large=Buffer.alloc(8*1024*1024,173),latest=await sdk.readProject(a.id);
  const asset=await sdk.importObject(large,'large-layer.png','image/png',latest.revision);
  assert.deepEqual(editor.object(asset.object.id),large);
 }finally{if(previousSocket===undefined)delete process.env.KEEL_EDITOR_SOCKET;else process.env.KEEL_EDITOR_SOCKET=previousSocket;await server?.close();store.close();editor.close();await rm(dir,{recursive:true,force:true});}
});
