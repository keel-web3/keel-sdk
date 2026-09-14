import test from 'node:test';
import assert from 'node:assert/strict';
import {newLayeredArt,defaultPlacement,layerDigest} from '@keel/sdk/layered-art';
import {newLayerCuration,addLayerCandidate,assignLayerCandidate,removeLayerCandidateFromSet,resolveLayerCandidate,layerCurationStats,layerCurationPlan,parseLayerCuration} from '@keel/sdk/layered-curation';
import {WorkspaceStore,newProject} from '../src/workspace.mjs';
import {exportLayeredPackage} from '../src/layered-export.mjs';
const bytes=new Uint8Array([1,2,3]),objectId=await layerDigest(bytes);
function art(){const item=(id,slot)=>({id,name:id,weight:1,variants:[{id:'v',name:'v',weight:1,objectId}],placements:[defaultPlacement('whole',slot)],rules:[],usage:{scope:'public',renderer:'',license:'CC0',tags:[]}});return {...newLayeredArt(),attributes:[{id:'body',name:'Body',items:[item('blue',1),item('red',2)]}]};}
async function add(state,tokenId,manifest=art(),overrides={}){return addLayerCandidate(state,manifest,{seed:'fixture',tokenId:String(tokenId),overrides});}

test('curated candidates freeze their original draw and generator version',async()=>{
 const first=await add(newLayerCuration(),91,art(),{body:'blue'});const again=await add(first.state,91,art(),{body:'blue'});assert.equal(again.added,false);
 const edited=art();edited.attributes[0].items[0].weight=0;edited.attributes[0].items[0].placements[0].slot=99;
 const next=await add(first.state,92,edited);assert.equal(next.state.versions.length,2);
 const original=await resolveLayerCandidate(next.state,first.candidate.id);assert.equal(original.selections[0].itemId,'blue');assert.equal(original.pieces[0].placement.slot,1);
 const generated=await resolveLayerCandidate(next.state,next.candidate.id);assert.equal(generated.selections[0].itemId,'red');
 const tampered=structuredClone(next.state);tampered.versions[0].manifest.attributes[0].items[0].weight=7;await assert.rejects(resolveLayerCandidate(tampered,first.candidate.id),/version has changed/);
 const changed=structuredClone(first.state);changed.candidates[0].seed='another';await assert.rejects(resolveLayerCandidate(changed,first.candidate.id),/candidate has changed/);
 const zero=await add(newLayerCuration(),0);assert.equal(parseLayerCuration(zero.state).candidates[0].tokenId,'0');await resolveLayerCandidate(zero.state,zero.candidate.id);
 await assert.rejects(add(newLayerCuration(),-1),/token number/);
 await assert.rejects(add(newLayerCuration(),1,art(),{missing:'blue'}),/no longer exists/);
});

test('pool assignment, reorder and return preserve identity and enforce supply',async()=>{
 let state=newLayerCuration();const ids=[];for(let i=1;i<=3;i++){const r=await add(state,i);state=r.state;ids.push(r.candidate.id);}
 for(const id of ids)state=assignLayerCandidate(state,id);
 state=assignLayerCandidate(state,ids[0],2);assert.deepEqual(state.set,[ids[1],ids[0],ids[2]]);
 state=assignLayerCandidate(state,ids[2],0);assert.deepEqual(state.set,[ids[2],ids[1],ids[0]]);
 state=assignLayerCandidate(state,ids[1],1);assert.deepEqual(state.set,[ids[2],ids[1],ids[0]]);
 state=removeLayerCandidateFromSet(state,ids[1]);assert.equal(state.candidates.length,3);
 state={...state,supply:2};assert.throws(()=>assignLayerCandidate(state,ids[1]),/exceeds/);
 assert.throws(()=>parseLayerCuration({...state,set:[ids[0],ids[0]]}),/Duplicate/);
 assert.throws(()=>assignLayerCandidate(state,ids[0],-1),/position/);
 const plan=await layerCurationPlan(state);assert.equal(plan.allocations[0].setPosition,1);assert.equal(plan.allocations[0].drawTokenId,'3');assert.equal(plan.publicationReady,false);assert.equal(plan.privateAuthoringData,true);
});

test('rarity counts effective exception results and exposes repeated compositions',async()=>{
 const manifest=art();manifest.exceptions=[{id:'replace',name:'Blue becomes red',enabled:true,match:'all',conditions:[{attributeId:'body',itemIds:['blue'],mode:'include'}],actions:[{kind:'replace',attributeId:'body',itemId:'red',variantId:'v'}]}];
 let state=newLayerCuration();for(let i=1;i<=3;i++){const r=await add(state,i,manifest,{body:'blue'});state=assignLayerCandidate(r.state,r.candidate.id);}
 state.targets=[{attributeId:'body',itemId:'red',count:4}];const stats=await layerCurationStats(state);assert.equal(stats.counts['body/red'],3);assert.equal(stats.counts['body/blue'],undefined);assert.equal(stats.targets[0].remaining,1);assert.equal(stats.duplicates,2);assert.deepEqual(stats.failures,[]);
});

test('workspace protects historical assets; single-manifest export cannot silently drop a curated set',async()=>{
 const store=new WorkspaceStore(':memory:');try{const snapshot=store.importObject(bytes,'original.png','image/png',0);const r=await add(newLayerCuration(),3);const project={...newProject('Curated'),objectIds:[objectId],layered:art(),layerCuration:assignLayerCandidate(r.state,r.candidate.id)};
 store.save({...snapshot.state,projects:[project]},snapshot.revision);const saved=store.read();assert.equal(saved.state.projects[0].layerCuration.set[0],r.candidate.id);
 assert.throws(()=>store.save({...saved.state,projects:[{...project,layered:newLayeredArt(),objectIds:[]}]},saved.revision),/original layer assets/);
 await assert.rejects(exportLayeredPackage(store,project,'/unused',{},'/unused'),/allocation adapter/);
 }finally{store.close();}
});

test('MCP curation uses the SDK resolver and returns local plans without side effects',async()=>{
 const {CURATION_TOOL_DEFINITIONS}=await import('../../../packages/mcp/dist/curation-tools.js');const tool=CURATION_TOOL_DEFINITIONS[0];
 const candidate=await tool.run({}, {operation:'add',manifestJson:JSON.stringify(art()),seed:'mcp',tokenId:'12',choicesJson:JSON.stringify({overrides:{body:'blue'}})});
 const state=await tool.run({}, {operation:'assign',workbenchJson:JSON.stringify(candidate.state),candidateId:candidate.candidate.id});
 const plan=await tool.run({}, {operation:'plan',workbenchJson:JSON.stringify(state)});assert.equal(plan.allocations[0].drawTokenId,'12');assert.equal(plan.publicationReady,false);assert.equal(plan.stats.counts['body/blue'],1);
 await assert.rejects(tool.run({}, {operation:'stats',index:-1}),/position/);
 await assert.rejects(tool.run({}, {operation:'add',manifestJson:JSON.stringify(art()),choicesJson:'{"extra":true}'}),/choices/);
});
