import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore,newProject } from '../src/workspace.mjs';
import { ConversationStore } from '../src/conversations.mjs';
import { AgentStore } from '../src/agent-store.mjs';
import { AgentService } from '../src/agent-service.mjs';
import { buildAgentContext } from '../src/agent-context.mjs';
import { createAgentTools, publicationIntentForProject } from '../src/agent-tools.mjs';

function fixture(){const workspace=new WorkspaceStore(':memory:');const a=newProject('Signal Garden');const b=newProject('Private Other Work');workspace.save({...workspace.read().state,projects:[a,b],memories:[{id:randomUUID(),title:'Palette',content:'Use violet and warm cream',projectId:a.id},{id:randomUUID(),title:'Other palette',content:'OTHER_PRIVATE_NOTE',projectId:b.id},{id:randomUUID(),title:'Paused palette',content:'PAUSED_PRIVATE_NOTE',enabled:false}]},0);return {workspace,a,b};}
const hooks={workRoot:'/tmp/keel-agent-test-tools',view:()=>({page:'Projects'}),networks:()=>[],wallets:()=>[],readKey:()=>{throw Error('Tests do not use credentials.');}};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('assistant creates a tiny Three.js project using pinned shared references', async () => {
  const {workspace} = fixture(); const chats = new AgentStore(workspace.db); const chat = chats.create({}); const run = chats.begin(chat.id, 'Make a Three scene', null);
  try {
    const tools = createAgentTools({workspace,chats,chat,run,hooks,signal:new AbortController().signal,emit:()=>{}});
    const result = JSON.parse(await tools.find(tool=>tool.name==='keel_create_project').invoke({title:'Shared scene',runtime:'three',html:'<!doctype html><script type="module">import * as THREE from "three";</script>'}));
    const project = workspace.read().state.projects.find(p=>p.id===result.projectId);
    assert.equal(project.runtimeModules.length, 2); assert.equal(project.files.length, 1);
    assert.equal(project.intent.runtime, 'three'); assert.ok(project.files[0].content.length < 100);
  } finally { workspace.close(); }
});
async function settled(service,id){for(let i=0;i<100;i++){if(!service.active.has(id))return service.store.history(id).runs.at(-1);await wait(5);}throw Error('Agent did not finish.');}

test('legacy conversations migrate once; archive, restore, pin, search and pagination survive restart',()=>{
  const {workspace,a}=fixture();const old=new ConversationStore(workspace.db);const prior=old.begin('codex',a.id,'Saved old conversation',true);old.finish(prior,{text:'Old reply'},null);
  let chats=new AgentStore(workspace.db);assert.equal(chats.list().total,1);const chat=chats.list().chats[0];assert.equal(chats.history(chat.id).runs[0].reply,'Old reply');
  for(let i=0;i<34;i++){const run=chats.begin(chat.id,`Message ${i}`,null);chats.saveRun({...run,status:'completed',reply:`Answer ${i}`});}
  const page=chats.history(chat.id);assert.equal(page.runs.length,30);assert.equal(chats.history(chat.id,page.nextBefore).runs.length,5);
  chats.update(chat.id,{archived:true,pinned:true,title:'Release discussion'});assert.equal(chats.list().total,0);assert.equal(chats.list({archived:true,search:'Message 20'}).total,1);
  chats=new AgentStore(workspace.db);assert.equal(chats.list({archived:true}).total,1);chats.update(chat.id,{archived:false});assert.equal(chats.list().chats[0].pinned,true);
  const running=chats.begin(chat.id,'Interrupted request',null);chats=new AgentStore(workspace.db);assert.equal(chats.run(running.id).status,'interrupted');assert.equal(chats.list().total,1);workspace.close();
});

test('automatic context stays bounded, includes relevant source and excludes unrelated or paused memory',()=>{
  const {workspace,a,b}=fixture();const context=buildAgentContext({chat:{projectId:a.id,contextMode:'auto'},prompt:'Fix the palette in my HTML animation',workspace:workspace.read(),view:{page:'Projects',projectId:a.id}});
  const text=JSON.stringify(context);assert.match(text,/warm cream/);assert.match(text,/index.html/);assert.ok(!text.includes('OTHER_PRIVATE_NOTE'));assert.ok(!text.includes('PAUSED_PRIVATE_NOTE'));assert.ok(!text.includes(b.title));assert.ok(context.characters<=42000);
  const off=buildAgentContext({chat:{projectId:a.id,contextMode:'none'},prompt:'HTML',workspace:workspace.read()});assert.equal(off.parts.length,1);assert.ok(!JSON.stringify(off).includes(a.title));workspace.close();
});

test('tools enforce project scope, validate navigation, and cannot send or approve wallet actions',async()=>{
  const {workspace,a,b}=fixture();const chats=new AgentStore(workspace.db);const chat=chats.create({projectId:a.id});const run=chats.begin(chat.id,'Help',null);const abort=new AbortController();
  let sent=0;const tools=createAgentTools({workspace,chats,chat,run,hooks:{...hooks,sendTransaction:()=>{sent++;}},signal:abort.signal,emit:()=>{}});
  const invoke=(name,input)=>tools.find(t=>t.name===name).invoke(input);
  assert.ok(!tools.some(t=>/send|approve|sign/.test(t.name)));
  await assert.rejects(invoke('keel_read_project',{projectId:b.id}),/limited/);
  await assert.rejects(invoke('keel_open_view',{page:'https://evil.example'}));
  const result=JSON.parse(await invoke('keel_read_source',{projectId:a.id,fileId:a.files[0].id}));assert.match(result.content,/Your next world/);
  abort.abort();await assert.rejects(invoke('keel_read_project',{projectId:a.id}));assert.equal(sent,0);workspace.close();
});

test('real local edits are reviewable, preserve newer work, and wallet reviews cannot replay',async()=>{
  const {workspace,a}=fixture();let sends=0;
  const service=new AgentService({workspace,hooks:{...hooks,sendTransaction:async()=>{sends++;await wait(10);return {hash:'local-test-hash'};}},runner:async({tools})=>{
    await tools.find(t=>t.name==='keel_edit_project').invoke({projectId:a.id,summary:'Add description',metadataJson:'{"name":"Signal Garden","description":"Artist description"}'});
    return {text:'Review the metadata edit.'};
  }});
  const chat=service.create({projectId:a.id});service.start(chat.id,'Improve metadata');let run=await settled(service,chat.id);const edit=service.store.actions(run.id)[0];assert.equal(workspace.read().state.projects[0].metadata.description,undefined);
  await service.apply(edit.id);assert.equal(workspace.read().state.projects[0].metadata.description,'Artist description');await assert.rejects(service.apply(edit.id),/already/);
  service.start(chat.id,'Improve again');run=await settled(service,chat.id);const stale=service.store.actions(run.id)[0];const current=workspace.read();workspace.save({...current.state,projects:current.state.projects.map(p=>({...p,notes:'newer user work'}))},current.revision);await assert.rejects(service.apply(stale.id),/changed/);assert.equal(workspace.read().state.projects[0].notes,'newer user work');
  const tx=service.store.action(run,'wallet-review','Local test only',{family:'ethereum',review:{id:randomUUID()}});
  const sending=service.apply(tx.id);await assert.rejects(service.apply(tx.id),/already/);await sending;assert.equal(sends,1);
  service.close();workspace.close();
});

test('streaming, cancellation, chat isolation and durable partial replies work without replay',async()=>{
  const {workspace,a}=fixture();const service=new AgentService({workspace,hooks,runner:async({onText,signal,messages})=>{onText('Partial progress');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));return {text:'impossible'};}});
  const chat=service.create({projectId:a.id});const run=service.start(chat.id,'Explain');assert.throws(()=>service.start(chat.id,'Duplicate'),/already/);assert.throws(()=>service.store.update(chat.id,{provider:'claude'}),/Stop/);service.stop(chat.id);const result=await settled(service,chat.id);assert.equal(result.status,'interrupted');assert.equal(result.reply,'Partial progress');assert.equal(service.store.history(chat.id).runs.length,1);
  const other=service.create({});assert.equal(service.store.history(other.id).runs.length,0);service.close();workspace.close();
});

test('context-off chats expose only chat search and SDK reference, without any workspace reads',async()=>{
  const {workspace}=fixture();const chats=new AgentStore(workspace.db);const chat=chats.create({contextMode:'none'});const run=chats.begin(chat.id,'Explain',null);
  const tools=createAgentTools({workspace:{read:()=>{throw Error('Workspace must not be accessed.');}},chats,chat,run,hooks,signal:new AbortController().signal,emit:()=>{}});
  assert.deepEqual(tools.map(t=>t.name).sort(),['keel_sdk_catalog','keel_search_chat']);
  const history=JSON.parse(await tools.find(t=>t.name==='keel_search_chat').invoke({query:'Explain'}));assert.equal(history[0].prompt,'Explain');
  const catalog=JSON.parse(await tools.find(t=>t.name==='keel_sdk_catalog').invoke({query:'keel-project-decisions'}));assert.ok(catalog.matches>0);assert.equal(catalog.tools[0].execution,'requires-workspace-access');
  const revision=JSON.parse(await tools.find(t=>t.name==='keel_sdk_catalog').invoke({query:'keel-revision-plan'}));assert.equal(revision.tools[0].execution,'requires-workspace-access');
  assert.equal(workspace.read().state.projects.length,2);workspace.close();
});

test('desktop derives publication intent and blocks a new-object bypass for published projects',async()=>{
  const {workspace,a}=fixture();
  assert.equal(publicationIntentForProject(a),'new-object');
  const current=workspace.read();
  workspace.save({...current.state,projects:current.state.projects.map(project=>project.id===a.id?{...project,publication:{chainId:11155111,contractAddress:'0x1111111111111111111111111111111111111111',tokenId:'1',standard:'erc721'}}:project)},current.revision);
  const published=workspace.read().state.projects.find(project=>project.id===a.id);
  assert.equal(publicationIntentForProject(published),'existing-graph-revision');
  const chats=new AgentStore(workspace.db);const chat=chats.create({projectId:a.id});const run=chats.begin(chat.id,'Update the viewer',null);
  const tools=createAgentTools({workspace,chats,chat,run,hooks,signal:new AbortController().signal,emit:()=>{}});
  const invoke=(name,input)=>tools.find(tool=>tool.name===name).invoke(input);
  const catalog=JSON.parse(await invoke('keel_sdk_catalog',{query:'keel-revision-plan'}));assert.equal(catalog.tools[0].execution,'local-tool');
  await assert.rejects(invoke('keel_sdk_call',{name:'publish-plan',argumentsJson:'{"publicationIntent":"new-object"}'}),/already published.*existing graph revision.*reuse unchanged objects/iu);
  workspace.close();
});

test('an old unchecked snapshot does not disable memory search; explicit chat choices survive restart',async()=>{
  const {workspace,a}=fixture();const old=new ConversationStore(workspace.db);const prior=old.begin('codex',a.id,'What is my palette?',false);old.finish(prior,{text:'Old reply'},null);
  const service=new AgentService({workspace,hooks,runner:async({tools,systemPrompt})=>{
    assert.match(systemPrompt,/Saved workspace access is ON/);
    const notes=JSON.parse(await tools.find(t=>t.name==='keel_search_memory').invoke({query:'palette'}));
    assert.deepEqual(notes.map(note=>note.title),['Palette']);
    const project=JSON.parse(await tools.find(t=>t.name==='keel_read_project').invoke({projectId:a.id}));assert.equal(project.title,a.title);
    return {text:notes[0].content};
  }});
  const chat=service.store.list().chats[0];assert.equal(chat.contextMode,'auto');assert.equal(service.store.history(chat.id).runs[0].id,prior.id);
  service.start(chat.id,'Search my palette memory');let result=await settled(service,chat.id);assert.equal(result.status,'completed');assert.match(result.reply,/warm cream/);assert.ok(!result.events.some(e=>e.status==='failed'));
  service.update(chat.id,{contextMode:'none',draft:'Keep this draft'});service.close();
  const restored=new AgentStore(workspace.db);assert.equal(restored.chat(chat.id).contextMode,'none');assert.equal(restored.chat(chat.id).draft,'Keep this draft');assert.equal(restored.history(chat.id).runs.length,2);
  restored.update(chat.id,{contextMode:'auto'});const enabled=restored.chat(chat.id);assert.equal(enabled.projectId,a.id);assert.equal(enabled.draft,'Keep this draft');assert.equal(restored.history(chat.id).runs.length,2);
  assert.equal(new AgentStore(workspace.db).chat(chat.id).contextMode,'auto');workspace.close();
});

test('current access settings reach providers on every reply, including re-enabled chats',async()=>{
  const {workspace,a}=fixture();let invocation=0;
  const service=new AgentService({workspace,hooks,runner:async({tools,systemPrompt})=>{
    if(invocation++===0){assert.match(systemPrompt,/Saved workspace access is OFF/);assert.match(systemPrompt,/Use saved work/);assert.deepEqual(tools.map(t=>t.name).sort(),['keel_sdk_catalog','keel_search_chat']);return {text:'Enable saved work to search your memories.'};}
    assert.match(systemPrompt,/Saved workspace access is ON/);assert.match(systemPrompt,/Draft creation and suggested edits are off/);
    for(const name of ['keel_create_project','keel_edit_project','keel_attach_asset','keel_track_contract','keel_remember'])assert.ok(!tools.some(t=>t.name===name),name);
    const notes=JSON.parse(await tools.find(t=>t.name==='keel_search_memory').invoke({query:'palette'}));return {text:notes[0].content};
  }});
  const chat=service.create({projectId:a.id,contextMode:'none',allowEdits:false});service.start(chat.id,'Find my palette');assert.equal((await settled(service,chat.id)).status,'completed');
  service.update(chat.id,{contextMode:'auto'});service.start(chat.id,'Try now');const result=await settled(service,chat.id);assert.equal(result.status,'completed');assert.equal(result.context.mode,'auto');assert.match(result.reply,/warm cream/);assert.ok(!result.events.some(e=>e.status==='failed'));assert.equal(service.store.history(chat.id).runs.length,2);
  service.close();workspace.close();
});

test('contract tracking creates exact reviews and preserves contract identity',async()=>{
  const {workspace,a}=fixture();const service=new AgentService({workspace,hooks,runner:async({tools})=>{
    await tools.find(t=>t.name==='keel_track_contract').invoke({projectId:a.id,name:'Artist collection',address:'0x1111111111111111111111111111111111111111',chainId:31337,kind:'collection',abiJson:'[]'});
    return {text:'Review this collection.'};
  }});
  const chat=service.create({projectId:a.id});service.start(chat.id,'Track my collection');const run=await settled(service,chat.id);const review=service.store.actions(run.id)[0];
  assert.equal(workspace.read().state.contracts.length,0);await service.apply(review.id);assert.equal(workspace.read().state.contracts[0].authority,'unverified');assert.deepEqual(workspace.read().state.projects[0].contractIds,[review.payload.id]);await assert.rejects(service.apply(review.id),/already/);
  service.close();workspace.close();
});
test('layer agents retain encryption flags, drill into traits, preserve source and propose scoped edits',async()=>{
 const {newLayeredArt,defaultPlacement}=await import('@keel/sdk/layered-art');const {safeContext}=await import('../src/agent-context.mjs');const {workspace,a}=fixture();
 try{assert.deepEqual(safeContext({encrypted:true,nested:{encrypted:'ciphertext'},privateKey:'secret'}),{encrypted:true,nested:{encrypted:'[private]'},privateKey:'[private]'});
 const imported=workspace.importObject(Buffer.from([1]),'layer.png','image/png',workspace.read().revision),id=imported.state.objects[0].id;
 const art={...newLayeredArt(),reveal:{mode:'chainlink',encrypted:true,revealAt:1900000000},attributes:[{id:'hair',name:'Hair',items:[{id:'blue',name:'Blue',weight:1,variants:[{id:'v',name:'First',objectId:id,weight:1}],placements:[defaultPlacement('back',1)],rules:[],usage:{scope:'renderer',renderer:a.id,license:'',tags:[]}}]}]};const p={...a,layered:art,objectIds:[id],files:[{...a.files[0],name:'keel-layered.html',content:'USER ORIGINAL SOURCE'}]};workspace.save({...imported.state,projects:imported.state.projects.map(x=>x.id===p.id?p:x)},imported.revision);
 const chats=new AgentStore(workspace.db),chat=chats.create({projectId:p.id}),run=chats.begin(chat.id,'Change hair',null);const tools=createAgentTools({workspace,chats,chat,run,hooks,signal:new AbortController().signal,emit:()=>{}});const invoke=async(name,input)=>JSON.parse(await tools.find(t=>t.name===name).invoke(input));
 assert.equal((await invoke('keel_read_project',{projectId:p.id})).layered.reveal.encrypted,true);assert.equal((await invoke('keel_read_layers',{projectId:p.id,attributeId:'hair',itemId:'blue'})).placements[0].slot,1);
 await invoke('keel_edit_layer_part',{projectId:p.id,summary:'Move hair behind the face',kind:'piece',attributeId:'hair',itemId:'blue',valueJson:JSON.stringify({...defaultPlacement('back',1),slot:-1})});const review=chats.actions(run.id).at(-1);assert.equal(review.payload.next.files[0].content,'USER ORIGINAL SOURCE');assert.equal(review.payload.next.layered.attributes[0].items[0].placements[0].slot,-1);assert.equal(workspace.read().state.projects[0].layered.attributes[0].items[0].placements[0].slot,1);assert.equal((await invoke('keel_check_layered_project',{projectId:p.id,operation:'check'})).ready,true);
 const exception={id:'hair-rule',name:'Hair in front',enabled:true,match:'all',conditions:[{attributeId:'hair',itemIds:['blue'],mode:'include'}],actions:[{kind:'move',attributeId:'hair',itemId:'blue',slot:8}]};
 await invoke('keel_edit_layer_part',{projectId:p.id,summary:'Add a combination exception',kind:'exception',valueJson:JSON.stringify(exception)});const proposal=chats.actions(run.id).at(-1).payload.next;assert.deepEqual(proposal.layered.exceptions,[exception]);assert.equal(workspace.read().state.projects[0].layered.exceptions,undefined);const snapshot=workspace.read();workspace.save({...snapshot.state,projects:snapshot.state.projects.map(x=>x.id===p.id?proposal:x)},snapshot.revision);
 assert.deepEqual(await invoke('keel_read_layers',{projectId:p.id,exceptionId:'hair-rule'}),exception);const selected=await invoke('keel_check_layered_project',{projectId:p.id,operation:'select'});assert.equal(selected.appliedRules[0].id,'hair-rule');assert.equal(selected.pieces[0].placement.slot,8);
 await invoke('keel_layer_curation',{projectId:p.id,operation:'generate',count:3,seed:'curation'});const poolProposal=chats.actions(run.id).at(-1).payload.next;
 assert.equal(poolProposal.layerCuration.candidates.length,3);assert.equal(workspace.read().state.projects[0].layerCuration,undefined);
 const poolSnapshot=workspace.read();workspace.save({...poolSnapshot.state,projects:poolSnapshot.state.projects.map(x=>x.id===p.id?poolProposal:x)},poolSnapshot.revision);
 assert.equal((await invoke('keel_layer_curation',{projectId:p.id,operation:'read'})).total,3);
 await invoke('keel_layer_curation',{projectId:p.id,operation:'assign',candidateId:poolProposal.layerCuration.candidates[0].id});assert.equal(chats.actions(run.id).at(-1).payload.next.layerCuration.set.length,1);assert.equal(workspace.read().state.projects[0].layerCuration.set.length,0);
 await assert.rejects(invoke('keel_layer_curation',{projectId:'00000000-0000-4000-8000-000000000000',operation:'read'}),/limited/);
 const readOnlyTools=createAgentTools({workspace,chats,chat:{...chat,allowEdits:false},run,hooks,signal:new AbortController().signal,emit:()=>{}});const readOnly=readOnlyTools.find(t=>t.name==='keel_layer_curation');assert.ok(readOnly);await assert.rejects(readOnly.invoke({projectId:p.id,operation:'generate',count:1}),/disabled/);


 }finally{workspace.close();}
});
